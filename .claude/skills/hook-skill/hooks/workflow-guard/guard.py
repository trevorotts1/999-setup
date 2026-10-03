#!/usr/bin/env python3
"""Workflow launch validation and independent journal stall detection. No worker killing."""
import argparse, hashlib, json, os, re, shutil, sqlite3, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
STATE=Path(os.environ.get('WORKFLOW_GUARD_STATE',str(ROOT/'state')))
NODE=os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''

def db():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 c=sqlite3.connect(STATE/'guard.sqlite3',timeout=10)
 c.row_factory=sqlite3.Row
 try:c.execute('PRAGMA busy_timeout=10000')
 except sqlite3.Error:pass
 c.executescript('''CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,session TEXT,transcript TEXT,created REAL,script_hash TEXT,state TEXT,name TEXT,peak INTEGER,receipt TEXT); CREATE TABLE IF NOT EXISTS watches(path TEXT PRIMARY KEY,session TEXT,last_change REAL,signature TEXT,state TEXT,detail TEXT); CREATE TABLE IF NOT EXISTS notices(session TEXT PRIMARY KEY,fingerprint TEXT); CREATE TABLE IF NOT EXISTS health(id INTEGER PRIMARY KEY,checked REAL); CREATE TABLE IF NOT EXISTS failures(session TEXT,fingerprint TEXT,tool TEXT,count INTEGER,last_error TEXT,updated REAL,PRIMARY KEY(session,fingerprint)); CREATE TABLE IF NOT EXISTS continuations(session TEXT PRIMARY KEY,count INTEGER,latched INTEGER,updated REAL); CREATE TABLE IF NOT EXISTS programs(session TEXT PRIMARY KEY,run_root TEXT,registered REAL); CREATE TABLE IF NOT EXISTS session_liveness(session TEXT PRIMARY KEY,last_seen REAL NOT NULL); CREATE TABLE IF NOT EXISTS scratch(path TEXT PRIMARY KEY,session TEXT,workflow TEXT,run_root TEXT,registered REAL,ended REAL,status TEXT);''')
 return c

_LOCKED_RETRY_DELAYS=(0.05,0.1,0.2,0.4,0.8)

def _is_locked(exc):
 return isinstance(exc,sqlite3.OperationalError) and 'locked' in str(exc).lower()

def write_txn(statements):
 # Bounded contention handling: short write transaction, retries on lock only.
 # Callers must finish all scans, subprocess runs, and file writes BEFORE calling.
 last=None
 for n,delay in enumerate((0,)+_LOCKED_RETRY_DELAYS):
  if n:time.sleep(delay)
  try:
   c=db()
   try:
    if isinstance(statements,str):c.execute(statements)
    else:
     for sql,params in statements:
      if params is None:c.execute(sql)
      else:c.execute(sql,params)
    c.commit();return
   finally:c.close()
  except sqlite3.OperationalError as e:
   last=e
   if not _is_locked(e):raise
 raise last

def read_rows(query,params=()):
 last=None
 for n,delay in enumerate((0,)+_LOCKED_RETRY_DELAYS):
  if n:time.sleep(delay)
  try:
   c=db()
   try:
    rows=c.execute(query,params).fetchall()
    c.commit();return rows
   finally:c.close()
  except sqlite3.OperationalError as e:
   last=e
   if not _is_locked(e):raise
 raise last

def atomic(path,text):
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_name(path.name+f'.{os.getpid()}.tmp');tmp.write_text(text);os.chmod(tmp,0o600);os.replace(tmp,path)
# ---- Operator-configured caps and running-at-once accounting ----
# The three ceilings are safety guards, never approval or activation gates. They
# live in state/limits.json so the operator raises or lowers them without editing
# code; the defaults reproduce the original 10/50/500 domain ceilings exactly, so
# nothing changes until the file is edited.
LIMITS_FILE=STATE/'limits.json'
LIMITS_DEFAULTS={'concurrent_agents_per_workflow':10,'concurrent_workflows_per_program':50,'concurrent_agents_total':500,'session_lease_seconds':3600}
LIMITS_DOC='''{
  "concurrent_agents_per_workflow": 10,
  "concurrent_workflows_per_program": 50,
  "concurrent_agents_total": 500,
  "session_lease_seconds": 3600
}
'''
LIVE_STATES=('VALIDATED','RETURNED','LAUNCH_UNVERIFIED')

def lease_s():
 # How long a session's silence still counts as its runs being live. A parked
 # conductor must not lose a genuinely running workflow, so the default is an
 # hour; the operator tunes it in limits.json or WORKFLOW_GUARD_LEASE_S.
 raw=os.environ.get('WORKFLOW_GUARD_LEASE_S')
 if raw:
  try:return float(raw)
  except ValueError:pass
 return float(limits()['session_lease_seconds'])

def limits():
 # Operator limits win; an unreadable file, a wrong type or a non-positive value
 # falls back to the default for that key alone, so one bad key never raises another.
 out=dict(LIMITS_DEFAULTS)
 try:doc=json.loads(LIMITS_FILE.read_text())
 except (OSError,ValueError):doc=None
 if isinstance(doc,dict):
  for k in out:
   v=doc.get(k)
   if isinstance(v,bool):continue
   if isinstance(v,int) and v>0:out[k]=v
 return out

def write_limits():
 # Seed the operator-editable file once; never overwrite an operator's values.
 if not LIMITS_FILE.exists():atomic(LIMITS_FILE,LIMITS_DOC)
 return LIMITS_FILE

def heartbeat(session):
 try:write_txn([('INSERT INTO session_liveness(session,last_seen) VALUES(?,?) ON CONFLICT(session) DO UPDATE SET last_seen=excluded.last_seen',(str(session),time.time()))])
 except Exception:pass

def touch_session(c,session,now=None):
 now=time.time() if now is None else now
 c.execute('INSERT INTO session_liveness(session,last_seen) VALUES(?,?) ON CONFLICT(session) DO UPDATE SET last_seen=excluded.last_seen',(str(session),now))

def session_live(c,session,now=None):
 # A session never seen here reads live: absence is not evidence of death.
 now=time.time() if now is None else now
 row=c.execute('SELECT last_seen FROM session_liveness WHERE session=?',(str(session),)).fetchone()
 if row is None:return True
 return (now-float(row['last_seen']))<=LEASE_S

def _backfill_liveness(c):
 # Seed the plane from each launch's own creation time so a row written before
 # this plane existed is aged honestly instead of reading live forever.
 rows=c.execute("SELECT session,MAX(created) last FROM launches WHERE state IN (?,?,?) AND session NOT IN (SELECT session FROM session_liveness) GROUP BY session",LIVE_STATES).fetchall()
 for r in rows:c.execute('INSERT OR IGNORE INTO session_liveness(session,last_seen) VALUES(?,?)',(str(r['session']),float(r['last'] or 0)))

def reap_dead(c,now=None,commit=True):
 # Release dead launches so they stop counting. Returns freed count.
 # commit=False when already inside a caller's write transaction (admit_launch),
 # so the release joins that transaction atomically instead of committing early;
 # on the read path it must commit, or the release is silently rolled back.
 now=time.time() if now is None else now
 lease=lease_s()
 _backfill_liveness(c)
 dead=c.execute('SELECT session FROM session_liveness WHERE last_seen < ?',(now-lease,)).fetchall()
 freed=0
 if dead:
  q=','.join('?'*len(dead));names=[r['session'] for r in dead]
  freed=c.execute("SELECT COUNT(*) n FROM launches WHERE state IN (?,?,?) AND session IN (%s)"%(q,),LIVE_STATES+tuple(names)).fetchone()['n']
  c.execute("UPDATE launches SET state='REAPED' WHERE session IN (%s) AND state IN (?,?,?)"%q,names+list(LIVE_STATES))
  c.execute('DELETE FROM session_liveness WHERE session IN (%s)'%q,names)
 freed+=reap_finished(c)
 if commit:c.commit()
 return freed

def _launch_dirs(c):
 # The journal directory a launch's own transcript implies. Keyed by transcript
 # rather than by run id, because a launch that never received a receipt carries
 # no run id at all and would otherwise be unreachable.
 out={}
 for r in c.execute("SELECT id,transcript FROM launches WHERE state IN (?,?,?)",LIVE_STATES).fetchall():
  t=r['transcript']
  if not t:continue
  p=Path(t)
  out[r['id']]=str(p.parent/p.stem/'subagents'/'workflows')
 return out

def _run_id(receipt):
 try:return (json.loads(receipt or '{}') or {}).get('run_id')
 except (ValueError,AttributeError):return None

def _own_watches(r,d,ws):
 # Only this launch's own journals: its run id when the receipt has one, otherwise
 # journals not older than the launch (a sibling's old journal never finishes it).
 rid=_run_id(r['receipt'])
 mine=[w for w in ws if w['path'].startswith(d+'/')]
 if rid:return [w for w in mine if Path(w['path']).parent.name==rid]
 out=[]
 for w in mine:
  try:
   if os.stat(w['path']).st_mtime<(r['created'] or 0)-5:continue
  except OSError:pass
  out.append(w)
 return out

def reap_finished(c):
 # A run is finished when every journal of its own has returned. A launch with no
 # journals yet stays live, and one journal still observing keeps it live, so this
 # only ever frees on positive evidence.
 freed=0;ws=c.execute('SELECT path,state FROM watches').fetchall()
 for r in c.execute("SELECT id,transcript,created,receipt FROM launches WHERE state IN (?,?,?)",LIVE_STATES).fetchall():
  if not r['transcript']:continue
  p=Path(r['transcript']);d=str(p.parent/p.stem/'subagents'/'workflows')
  rows=_own_watches(r,d,ws)
  if not rows:
   # No watch row yet: read the run's own journal directly so release is immediate.
   m=journal_summary(r)
   if m and m['events'] and m['results'] and not m['pending'] and not m['running']:
    c.execute("UPDATE launches SET state='COMPLETED' WHERE id=?",(r['id'],));freed+=1
   continue
  if all(w['state'] in ('AGENTS_RETURNED','RESOLVED','CANCELLED') for w in rows):
   c.execute("UPDATE launches SET state='COMPLETED' WHERE id=?",(r['id'],))
   freed+=1
 return freed

def journal_summary(r):
 # Summary of this launch's own journal, or None when it has none yet.
 rid=_run_id(r['receipt'])
 if not rid or not r['transcript']:return None
 p=Path(r['transcript']);j=p.parent/p.stem/'subagents'/'workflows'/rid/'journal.jsonl'
 try:return inspect_journal(j) if j.is_file() else None
 except Exception:return None

def live_running(r):
 # Agents running right now for this launch; None when its journal has no events
 # yet (the declared peak then stands in).
 m=journal_summary(r)
 return m['running'] if m and m['events'] else None

def occupancy(c,now=None,commit=True):
 # Live counts: workflows per program, agents per workflow, agents total.
 # commit=False when the caller already holds a write transaction, so the reap
 # joins it instead of ending it early.
 now=time.time() if now is None else now
 reap_dead(c,now,commit=commit)
 per={};workflows=0;agents=0
 for r in c.execute("SELECT session,peak,transcript,receipt FROM launches WHERE state IN (?,?,?)",LIVE_STATES).fetchall():
  per[r['session']]=per.get(r['session'],0)+1
  workflows+=1
  # Live accounting: finished agents free their slots; the declared peak only
  # stands in until the run's journal exists.
  run=live_running(r);peak=int(r['peak'] or 0)
  agents+=peak if run is None else min(run,peak)
 return {'workflows':workflows,'per_program':per,'agents_total':agents}

def admit_launch(row):
 # Record a validated launch only while it fits the operator caps, atomically.
 # Count, cap check and insert share one BEGIN IMMEDIATE transaction, so two
 # launches racing for the last slot cannot both be admitted. Returns None when
 # admitted, or a refusal message the caller turns into a block.
 lim=limits();last=None
 for n,delay in enumerate((0,)+_LOCKED_RETRY_DELAYS):
  if n:time.sleep(delay)
  try:
   c=db()
   try:
    c.isolation_level=None
    c.execute('BEGIN IMMEDIATE')
    now=time.time();session=str(row[1]);peak=int(row[7] or 0)
    touch_session(c,session,now)
    occ=occupancy(c,now,commit=False)
    running=occ['per_program'].get(session,0)
    if peak>lim['concurrent_agents_per_workflow']:
     c.execute('ROLLBACK')
     return ('This workflow declares %d concurrent agents, above the operator limit of %d per workflow.'%(peak,lim['concurrent_agents_per_workflow']))
    if running+1>lim['concurrent_workflows_per_program']:
     c.execute('ROLLBACK')
     return ('This program is already running %d workflows, the operator limit of %d. Let one finish before launching another.'%(running,lim['concurrent_workflows_per_program']))
    if occ['agents_total']+peak>lim['concurrent_agents_total']:
     c.execute('ROLLBACK')
     return ('Launching %d agents would reach %d concurrent agents, above the operator limit of %d total.'%(peak,occ['agents_total']+peak,lim['concurrent_agents_total']))
    c.execute('INSERT OR REPLACE INTO launches VALUES(?,?,?,?,?,?,?,?,?)',row)
    c.execute('COMMIT')
    return None
   finally:c.close()
  except sqlite3.OperationalError as e:
   last=e
   if not _is_locked(e):raise
 raise last


def deny(message):
 print('WORKFLOW GUARD BLOCKED: '+message+'\nFix the specific error, then retry at most twice. Use '+str(ROOT/'make-workflow.py')+' to generate a validated template. Do not bypass hooks.',file=sys.stderr)
 return 2

def refuse(message):
 # Targeted denial with no Workflow boilerplate, so the contract messages stay exact.
 print('WORKFLOW GUARD BLOCKED: '+message,file=sys.stderr)
 return 2

def context(event,message):
 print(json.dumps({'hookSpecificOutput':{'hookEventName':event,'additionalContext':message}}))

# ---- Enforcement state: retry cap, model canary, continuation cap, orchestrator fence ----
# Reserved fingerprints. Never collide with sha256 hex, so counters and real failures share one table.
TOTAL='__total__'
UNPARSED='__unparsed__'
COUNTER='__counter__'
UNPARSED_KEY='__unparsedToolInput'
SECRET=re.compile(r'sk-[A-Za-z0-9_\-]{3,}|token[A-Za-z0-9_\-]*\s*[=:]\s*\S+|key=\S+',re.I)
FENCE_EDIT=('Edit','Write','MultiEdit','NotebookEdit')
FENCE_MUTATE=re.compile(r'git (commit|push|merge|rebase|cherry-pick)|sed -i|>[^&]|>>|\bmv |\bcp |\brm |npm (install|publish)|pip install')
FENCE_FLEET=re.compile(r'\bssh\b|scp\b|rsync\b')
PM2_ENV_DUMP=re.compile(r'\bpm2\b(?:\s+-{1,2}[A-Za-z-]+)*\s+(?:jlist|describe)\b',re.I)
ABSPATH=re.compile(r'(/[^\s\'"]+)')
HUMAN_PROMPT_SOURCES=('user','sdk')
# ── STOP DETECTION: INTENT, NOT THE LETTERS s-t-o-p ─────────────────────────
# The old rule matched a bare \bstop\b anywhere in the prompt. That latched on
# "it stopped", "I never said stop", "don't stop", an agent report ending
# "Then stop.", or any discussion of the word — and a latched session refuses
# every Agent/Workflow spawn. A kill switch must fire on an ORDER AIMED AT THIS
# SESSION and be deaf to everything else.
#
# Rules, in order:
#   1. Strip fenced code, inline code, and quoted spans — a stop quoted from a
#      document or a log is never an order.
#   2. An UNAMBIGUOUS kill phrase fires at any length ("stop all agents",
#      "stand down", "abort the run", "kill the agents").
#   3. A BARE "stop" fires only as a short standalone imperative — the whole
#      remaining message is essentially just that command.
#   4. Negation always wins ("never said stop", "don't stop", "not a stop").
#   5. Machine traffic can never arm the latch (see user_prompt below).
_CODE_FENCE=re.compile(r'```.*?```|`[^`\n]*`',re.S)
_QUOTED=re.compile(r'"[^"\n]{0,400}"|\u201c[^\u201d\n]{0,400}\u201d|^\s*>.*$',re.M)

STOP_EXPLICIT=re.compile(
  r'\b(?:'
  r'stop\s+(?:all\s+)?(?:the\s+)?(?:agents?|subagents?|workflows?|run|runs|everything|work|working|spawning|dispatching|launching)'
  r'|halt\s+(?:all\s+)?(?:the\s+)?(?:agents?|workflows?|run|everything)'
  r'|abort\s+(?:all\s+)?(?:the\s+)?(?:agents?|workflows?|run|everything)'
  r'|kill\s+(?:all\s+)?(?:the\s+)?(?:agents?|workflows?)'
  r'|stand\s+down'
  r'|cease\s+(?:all\s+)?work'
  r')\b',re.I)

STOP_BARE=re.compile(r'^\s*(?:please\s+|just\s+|now\s+)?stop(?:\s+(?:it|now|please))?\s*[.!]*\s*$',re.I)

STOP_NEGATED=re.compile(
  r"\b(?:never|didn'?t|did\s+not|don'?t|do\s+not|dont|no\s+one|nobody|not)\b[^\n]{0,60}?\bstop"
  r"|\bstop[^\n]{0,60}?\b(?:is|was|isn'?t|wasn'?t)\b",re.I)

def _strip_noise(text):
  t=_CODE_FENCE.sub(' ',text or '')
  t=_QUOTED.sub(' ',t)
  return t

def stop_intent(prompt):
  """True only when the human is ORDERING this session to stop dispatching."""
  t=_strip_noise(prompt)
  if not t.strip(): return False
  if STOP_NEGATED.search(t): return False
  if STOP_EXPLICIT.search(t): return True
  # Bare "stop" counts only if the message is essentially nothing else.
  compact=' '.join(t.split())
  if len(compact)<=24 and STOP_BARE.match(compact): return True
  return False

# Kept for compatibility with any other reference; now intent-aware.
class _StopWordShim:
  def search(self,text): return stop_intent(text)
STOP_WORD=_StopWordShim()

def redact(text):
 # Redact before truncating so a clipped secret cannot survive the clip.
 return SECRET.sub('<redacted>',str(text))

def call_fingerprint(tool,tool_input):
 try:body=json.dumps(tool_input,sort_keys=True,separators=(',',':'),default=str)
 except (TypeError,ValueError):body=repr(tool_input)
 return hashlib.sha256((str(tool)+body).encode()).hexdigest()

def bump(session,fp,tool,error=None,now=None):
 now=time.time() if now is None else now
 return ('INSERT INTO failures(session,fingerprint,tool,count,last_error,updated) VALUES(?,?,?,1,?,?) ON CONFLICT(session,fingerprint) DO UPDATE SET count=failures.count+1,tool=excluded.tool,last_error=COALESCE(excluded.last_error,failures.last_error),updated=excluded.updated',(session,fp,tool,redact(error)[:200] if error else None,now))

def counters(session):
 rows=read_rows('SELECT fingerprint,count FROM failures WHERE session=? AND fingerprint IN (?,?)',(session,TOTAL,UNPARSED))
 seen={r['fingerprint']:(r['count'] or 0) for r in rows}
 return seen.get(TOTAL,0),seen.get(UNPARSED,0)

def failure_count(session,fp):
 rows=read_rows('SELECT count FROM failures WHERE session=? AND fingerprint=?',(session,fp))
 return (rows[0]['count'] or 0) if rows else 0

def continuation_state(session):
 rows=read_rows('SELECT count,latched FROM continuations WHERE session=?',(session,))
 return ((rows[0]['count'] or 0),(rows[0]['latched'] or 0)) if rows else (0,0)

def program_root(session):
 rows=read_rows('SELECT run_root FROM programs WHERE session=?',(session,))
 return rows[0]['run_root'] if rows and rows[0]['run_root'] else None

def under(path,root):
 try:
  p=os.path.normpath(os.path.abspath(os.path.expanduser(str(path))))
  r=os.path.normpath(os.path.abspath(os.path.expanduser(str(root))))
 except (TypeError,ValueError,OSError):return False
 return p==r or p.startswith(r+os.sep)

def canary(session):
 total,unparsed=counters(session)
 return {'session':session,'total':total,'unparsed':unparsed,'rate':(unparsed/total if total else 0.0)}

def canary_denial(session):
 # Decision 8: the conductor seat must sit on a model whose tool JSON parses.
 c=canary(session)
 if c['total']>=5 and c['rate']>0.02:
  return refuse('conductor seat is on a model whose tool JSON does not parse; move the conductor seat. Measured '+str(c['unparsed'])+' unparsed of '+str(c['total'])+' tool calls this session, rate '+format(100.0*c['rate'],'.2f')+' percent, threshold 2 percent.')
 return None

def fence(data,tool,root):
 # Decision 11: a registered conductor session records and dispatches; it does not build.
 note=' Orchestrator fence: this session is running program '+str(root)+'. Dispatch a builder or QC agent for this; the conductor only records.'
 allowed=(root,str(STATE))
 ti=data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {}
 if tool in FENCE_EDIT:
  target=ti.get('file_path') or ti.get('notebook_path')
  if not target:return None
  if any(under(target,a) for a in allowed):return None
  return refuse('Write target '+str(target)+' is outside the program run root.'+note)
 if tool=='Bash':
  cmd=str(ti.get('command') or '')
  if FENCE_FLEET.search(cmd) and os.environ.get('SKILL_REVIEW_TEST_MODE')!='1':
   return refuse('Remote-host and fleet commands are denied while a program is active.'+note)
  if FENCE_MUTATE.search(cmd):
   paths=ABSPATH.findall(cmd)
   if not paths:return refuse('Mutating shell command with no absolute path cannot be proven to stay inside the program run root.'+note)
   outside=[p for p in paths if not any(under(p,a) for a in allowed)]
   if outside:return refuse('Mutating shell command touches '+outside[0]+', outside the program run root.'+note)
 return None

def pre_checks(data,tool,session):
 # Runs for every PreToolUse the guard is registered for. Returns an exit code to deny, or None.
 ti=data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {}
 fp=call_fingerprint(tool,ti)
 unparsed=UNPARSED_KEY in ti
 prior=failure_count(session,fp)
 stmts=[bump(session,TOTAL,COUNTER)]
 if unparsed:
  stmts.append(bump(session,UNPARSED,COUNTER))
  stmts.append(bump(session,fp,tool,'PreToolUse received unparseable model output ('+UNPARSED_KEY+').'))
 write_txn(stmts)
 count,latched=continuation_state(session)
 if latched and tool in ('Workflow','Agent','Task'):
  return refuse('The user gave a stop order. Report status and end the turn.')
 if prior>=2:
  return refuse('Third identical attempt of a failed call. Change the input, change the approach, or dispatch a subagent to diagnose. Fingerprint '+fp[:8]+'.')
 if tool=='Bash' and PM2_ENV_DUMP.search(str(ti.get('command') or '')):
  return refuse('pm2 jlist/pm2 describe dump process environments (secrets). Use `pm2 list` (no env) instead.')
 root=program_root(session)
 if root and 'agent_id' not in data:
  return fence(data,tool,root)
 return None

def user_prompt(data):
 # Verified against the Claude Code 2.1.263 binary: UserPromptSubmit input carries `prompt`
 # plus an optional `source` of user|sdk|system|loop_wakeup|schedule_wakeup|poll_event.
 session=data.get('session_id','unknown');prompt=''
 for key in ('prompt','user_prompt','message','current_prompt'):
  value=data.get(key)
  if isinstance(value,str) and value:prompt=value;break
 source=data.get('source') or 'user'
 stop=1 if (STOP_WORD.search(prompt) and not STOP_NEGATED.search(prompt)) else 0
 if source not in HUMAN_PROMPT_SOURCES:
  # Machine-injected wakeups are not human messages: they never reset the count or clear the latch.
  # A machine message (agent report, teammate notice, wakeup) must NEVER arm the
  # latch: subagents echo "Then stop." constantly and would disarm the operator.
  # Only a human stop counts. Machine traffic still never CLEARS it.
  return 0
 write_txn([('INSERT INTO continuations(session,count,latched,updated) VALUES(?,0,?,?) ON CONFLICT(session) DO UPDATE SET count=0,latched=excluded.latched,updated=excluded.updated',(session,stop,time.time()))])
 return 0

def validate(data):
 blocked=canary_denial(data.get('session_id','unknown'))
 if blocked is not None:return blocked
 ti=dict(data.get('tool_input') or {});s=ti.get('script');argument_note=''
 if not s:
  p=ti.get('scriptPath')
  if not p:return deny('Name-only launch cannot be inspected. Supply scriptPath or inline script.')
  p=Path(p).expanduser()
  if not p.is_absolute():p=Path(data.get('cwd') or os.getcwd())/p
  try:s=p.read_text()
  except OSError:return deny('Workflow scriptPath cannot be read.')
 if not isinstance(s,str) or len(s.encode())>2_000_000:return deny('Script must be nonempty JavaScript under 2 MB.')
 # Compatibility for older generated scripts. Never guess arguments from another run.
 if ti.get('args') is None and ti.get('scriptPath') and re.search(r'\bargs\s*\.\s*units\b',s):
  source=Path(ti['scriptPath']).expanduser()
  if not source.is_absolute():source=Path(data.get('cwd') or os.getcwd())/source
  source=source.resolve()
  match=re.fullmatch(r'workflow-(\d+)\.js',source.name)
  if match:
   sidecar=source.with_name('launch-'+match.group(1)+'.json')
   if sidecar.is_file():
    try:
     saved=json.loads(sidecar.read_text());reference=Path(saved.get('scriptPath','')).expanduser()
     if not reference.is_absolute():reference=sidecar.parent/reference
     if reference.resolve()==source and 'args' in saved:
      ti['args']=saved['args'];argument_note=' Recovered legacy args from the matching launch JSON.'
    except (OSError,ValueError,TypeError):return deny('Legacy launch JSON is unreadable or malformed. Regenerate a self-contained workflow; no args extraction is needed.')
 if isinstance(ti.get('args'),str):
  try:decoded=json.loads(ti['args'])
  except ValueError:return deny('args contains invalid JSON text. Pass a JSON object/array or regenerate a self-contained script. Do not escape Python inside a shell one-liner.')
  if not isinstance(decoded,(dict,list)):return deny('Decoded args must be a JSON object or array, not another string or scalar.')
  ti['args']=decoded;argument_note+=' Converted legacy JSON text args to a structured JSON value.'
 if not NODE:
  # No Node.js on this machine: the static validator cannot run. Fail open (never block the user's launch) and say so.
  context('PreToolUse','Workflow guard: Node.js was not found, so the launch was not statically validated. Install Node.js 18+ to enable validation.')
  return 0
 try:
  out=subprocess.run([NODE,str(ROOT/'validate.mjs')],input=json.dumps({'script':s,'args':ti.get('args')}),text=True,capture_output=True,timeout=15)
  result=json.loads(out.stdout)
 except Exception as e:return deny('Validator unavailable; repair the checker before launch ('+type(e).__name__+').')
 if not result.get('ok'):return deny('\n'.join(result.get('errors',['Validation failed'])))
 sha=hashlib.sha256(s.encode()).hexdigest();snap=STATE/'scripts'/(sha+'.js');atomic(snap,s)
 ident=str(data.get('tool_use_id') or hashlib.sha256((str(data.get('session_id'))+sha+str(time.time_ns())).encode()).hexdigest())
 refusal=admit_launch((ident,data.get('session_id','unknown'),data.get('transcript_path',''),time.time(),sha,'VALIDATED',result.get('name'),result['conservativePeak'],''))
 if refusal:return deny(refusal)
 # Launch the exact bytes checked, retaining all other tool arguments and permission policy.
 updated=dict(ti);updated.pop('scriptPath',None);updated.pop('name',None);updated['script']=s
 print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','updatedInput':updated,'additionalContext':f"Workflow guard validated {result['conservativePeak']} maximum active lanes; cap {result['cap']}. Explicit phases checked.{argument_note} After launch verify the returned workflow ID and native /workflows tree. Workers must not spawn helpers. Poll no longer than 60 seconds at a time; read watchdog alerts and continue ready units. A validated file does not prove rendered visibility."}}))
 return 0

def scan_watches(transcript,session,after):
 # Filesystem scan only: no DB access, safe to run outside any transaction.
 found=[]
 if not transcript:return found
 p=Path(transcript)
 try:paths=list((p.parent/p.stem/'subagents/workflows').glob('*/journal.jsonl'))
 except OSError:return found
 for j in paths:
  try:recent=j.stat().st_mtime>=after-5
  except OSError:continue
  if recent:found.append((str(j),session,time.time(),'','OBSERVING',''))
 return found

def inspect_journal(path):
 # Read only event identity/status, never save prompts, output bodies, tokens or secrets.
 # Journals are append-only with only type/key/agentId/result lines, so the sweep must stay in
 # order: started is +1, result or failed is -1, and the high-water mark is the runtime peak.
 pending=set();results=set();failed=set();bad=0;total=0;live=0;peak=0
 with path.open() as f:
  for line in f:
   total+=1
   try:e=json.loads(line)
   except json.JSONDecodeError:bad+=1;continue
   key=e.get('key');kind=e.get('type')
   if kind=='started' and key:
    pending.add(key);live+=1
    if live>peak:peak=live
   if kind in ('result','failed') and key:live-=1
   if kind=='result' and key:results.add(key)
   if kind=='failed' and key:failed.add(key)
 pending-=results|failed
 return {'started':len(pending|results),'results':len(results),'pending':len(pending),'runtime_peak':peak,'running':max(0,live),'malformed_lines':bad,'events':total,'event_identity_hash':hashlib.sha256(json.dumps([sorted(pending),sorted(results)]).encode()).hexdigest()}

def dedupe_alerts(alerts):
 # The same run can be journaled under more than one project root (Claude Code and
 # Claude Nine). Report each (session,workflow,state) once.
 seen=set();out=[]
 for a in alerts:
  k=(a.get('session'),a.get('workflow'),a.get('state'))
  if k in seen:continue
  seen.add(k);out.append(a)
 return out

def tick(now=None):
 now=now or time.time();alerts=[]
 # Short reads first; all filesystem scans happen outside any transaction.
 launches=read_rows("SELECT * FROM launches WHERE state IN ('VALIDATED','RETURNED','LAUNCH_UNVERIFIED')")
 watches=read_rows('SELECT * FROM watches')
 # Terminal-launch index: a watch whose owning run already returned/cancelled/failed
 # is residue, not a live stall. Keyed by the run id recorded in the launch receipt.
 run2state={}
 for l in read_rows('SELECT state,receipt FROM launches'):
  try:r=json.loads(l['receipt'] or '{}')
  except ValueError:continue
  rid=r.get('run_id')
  if rid:run2state[rid]=l['state']
 discovered=[]
 for l in launches:
  discovered.extend(scan_watches(l['transcript'],l['session'],l['created']))
 computed=[]
 for w in watches:
  if w['state'] in ('CANCELLED','RESOLVED'):continue
  path=Path(w['path'])
  try:summary=inspect_journal(path)
  except (OSError,ValueError) as e:
   state='JOURNAL_UNAVAILABLE';detail=type(e).__name__;sig=w['signature'];last=w['last_change']
  else:
   # runtime_peak is excluded from the signature: it is a monotonic high-water mark, so
   # including it would reset the stall clock on history rather than on new progress.
   sig=json.dumps({k:v for k,v in summary.items() if k not in ('events','malformed_lines','runtime_peak','running')},sort_keys=True)
   # First observation preserves last event time so existing multi-hour stalls are caught.
   try:mt=path.stat().st_mtime
   except OSError:mt=now
   last=(min(now,mt) if not w['signature'] else now) if sig!=w['signature'] else w['last_change']
   age=now-last
   state=('MALFORMED_JOURNAL' if summary['malformed_lines'] else 'AGENTS_RETURNED' if summary['pending']==0 and summary['results'] else 'STALE_REVIEW_REQUIRED' if age>=600 else 'NO_RESULT_WARNING' if age>=300 else 'OBSERVING')
   # Decision 14: runtime cap is an alert, never a block. It never hides a stall, a malformed
   # journal or a finished run, so it clears on its own once the run returns.
   if summary['runtime_peak']>10 and state in ('OBSERVING','NO_RESULT_WARNING'):state='RUNTIME_CAP_EXCEEDED'
   detail=json.dumps({**summary,'seconds_without_journal_progress':round(age),'note':'Journal progress is a signal, not proof of useful work or wave/QC completion.'})
  # A terminal parent means this journal is residue, not a live stall. Preserve the
  # pre-resolution state and evidence so the record stays auditable.
  owned=run2state.get(path.parent.name)
  if owned in ('RETURNED','CANCELLED','FAILED') and state!='RESOLVED':
   prior=state
   try:prior_evidence=json.loads(detail)
   except ValueError:prior_evidence=detail
   state='RESOLVED';detail=json.dumps({'resolved_by':'owning_launch_terminal','launch_state':owned,'prior_state':prior,'prior_evidence':prior_evidence,'note':'Parent workflow is terminal, so this journal is residue rather than a live stall. Resolution is not QC or wave acceptance.'})
  computed.append((w,path,state,detail,sig,last))
  if state in ('STALE_REVIEW_REQUIRED','NO_RESULT_WARNING','JOURNAL_UNAVAILABLE','MALFORMED_JOURNAL','RUNTIME_CAP_EXCEEDED'):
   alerts.append({'session':w['session'],'workflow':path.parent.name,'journal':str(path),'state':state,'detail':detail})
 # Single short write transaction: no scans, no subprocess, no file writes inside.
 stmts=[]
 for j,session,ts,sig0,st,det in discovered:
  stmts.append(('INSERT OR IGNORE INTO watches VALUES(?,?,?,?,?,?)',(j,session,ts,sig0,st,det)))
 for l in launches:
  if now-l['created']>120 and l['state']=='VALIDATED':
   stmts.append(("UPDATE launches SET state='LAUNCH_UNVERIFIED' WHERE id=?",(l['id'],)))
 for l in launches:
  if not l['transcript']:continue
  tp=Path(l['transcript']);d=str(tp.parent/tp.stem/'subagents'/'workflows')
  own=_own_watches(l,d,watches)
  if own and all(w['state'] in ('AGENTS_RETURNED','RESOLVED','CANCELLED') for w in own):
   stmts.append(("UPDATE launches SET state='COMPLETED' WHERE id=?",(l['id'],)))
 for w,path,state,detail,sig,last in computed:
  stmts.append(('UPDATE watches SET last_change=?,signature=?,state=?,detail=? WHERE path=?',(last,sig,state,detail,w['path'])))
 unverified=read_rows("SELECT * FROM launches WHERE state='LAUNCH_UNVERIFIED'")
 for l in unverified:
  alerts.append({'session':l['session'],'workflow':l['name'],'state':'LAUNCH_UNVERIFIED','detail':'No matching successful PostToolUse receipt. Inspect the actual tool result; do not claim launched/visible.'})
 stmts.append(('INSERT OR REPLACE INTO health VALUES(1,?)',(now,)))
 write_txn(stmts)
 try:reap_now()
 except Exception:pass
 try:cleanup_scratch(now)
 except Exception as e:log_cleanup({'action':'error','error':type(e).__name__})
 alerts=dedupe_alerts(alerts)
 atomic(STATE/'alerts.json',json.dumps({'checked_at':now,'alerts':alerts},indent=2)+'\n')
 lines=['# Workflow watchdog status',f'Checked at epoch {now:.0f}.',f'Active alerts: {len(alerts)}.','This observer does not kill workers, restart sessions, or certify QC.','']
 for a in alerts:lines.append(f"- {a['state']}: {a['workflow']} ({a['session']}). Inspect actual worker progress, dependencies and provider status before any restart.")
 atomic(STATE/'STATUS.md','\n'.join(lines)+'\n')
 return alerts

def reap_now():
 # Release dead, stopped and finished launches now so their slots free immediately.
 c=db()
 try:return reap_dead(c)
 finally:c.close()

# ---- Cleanup of a finished run's own registered scratch folders ----
CLEANUP_GRACE_S=1800
TERMINAL=('COMPLETED','CANCELLED','FAILED','REAPED')

def log_cleanup(entry):
 try:
  with (STATE/'cleanup.log').open('a') as f:f.write(json.dumps({'at':time.time(),**entry})+'\n')
 except OSError:pass

def _git(args,cwd):
 return subprocess.run(['git','-C',str(cwd)]+args,capture_output=True,text=True,timeout=20)

def unsafe_repo(path):
 # A git repo with uncommitted changes or commits on no remote is never deleted.
 # Any git failure counts as unsafe. Returns a reason string or None.
 for dirpath,dirs,files in os.walk(path):
  if '.git' in dirs or '.git' in files:
   try:
    st=_git(['status','--porcelain'],dirpath)
    if st.returncode!=0 or st.stdout.strip():return 'uncommitted changes or git error in '+dirpath
    ah=_git(['rev-list','--branches','--not','--remotes','--count'],dirpath)
    if ah.returncode!=0 or ah.stdout.strip()!='0':return 'unpushed commits or git error in '+dirpath
   except (OSError,subprocess.SubprocessError):return 'git unavailable in '+dirpath
   dirs[:]=[d for d in dirs if d!='.git']
 return None

def register_scratch(session,workflow,run_root,paths):
 now=time.time()
 write_txn([('INSERT OR IGNORE INTO scratch(path,session,workflow,run_root,registered,ended,status) VALUES(?,?,?,?,?,NULL,NULL)',(os.path.normpath(str(p)),session,workflow,os.path.normpath(str(run_root)),now)) for p in paths])

def cleanup_scratch(now=None,dry=False):
 # Delete only folders registered for a run that is terminal for CLEANUP_GRACE_S.
 # dry=True logs WOULD-DELETE and changes nothing (no rmtree, no state update).
 now=time.time() if now is None else now
 rows=read_rows("SELECT * FROM scratch WHERE status IS NULL OR status='PENDING'")
 stmts=[]
 for r in rows:
  ls=read_rows('SELECT state FROM launches WHERE session=? AND name=?',(r['session'],r['workflow']))
  if not ls or any(l['state'] not in TERMINAL for l in ls):
   if r['ended'] is not None:stmts.append(('UPDATE scratch SET ended=NULL WHERE path=?',(r['path'],)))
   continue
  if r['ended'] is None:
   stmts.append(('UPDATE scratch SET ended=? WHERE path=?',(now,r['path'])));continue
  if now-r['ended']<CLEANUP_GRACE_S:continue
  path=r['path'];root=r['run_root']
  real=os.path.realpath(path);rroot=os.path.realpath(root)
  def mark(status,reason=''):
   stmts.append(('UPDATE scratch SET status=? WHERE path=?',(status,path)));log_cleanup({'action':status,'path':path,'workflow':r['workflow'],'reason':reason})
  if not os.path.lexists(path):mark('GONE');continue
  if os.path.islink(path) or real==rroot or not real.startswith(rroot+os.sep):mark('SKIPPED','not a plain folder strictly under the run root');continue
  why=unsafe_repo(real)
  if why:mark('SKIPPED',why);continue
  if dry:log_cleanup({'action':'WOULD-DELETE','path':path,'workflow':r['workflow'],'dry_run':True});print('WOULD-DELETE '+path);continue
  shutil.rmtree(real);mark('DELETED')
 if stmts and not dry:write_txn(stmts)

def response_text(value):
 if isinstance(value,str):return value
 if isinstance(value,list):return '\n'.join(response_text(v) for v in value)
 if isinstance(value,dict):return '\n'.join(response_text(v) for v in value.values())
 return ''

def hook(data):
 event=data.get('hook_event_name','PreToolUse');tool=data.get('tool_name','');session=data.get('session_id','unknown')
 heartbeat(session)
 if event=='UserPromptSubmit':
  try:return user_prompt(data)
  except Exception:return 0
 if event=='PostToolUseFailure':
  # Decision 9: record a failure for every tool, not just Workflow, so the retry cap can see it.
  try:
   ti=data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {}
   write_txn([bump(session,call_fingerprint(tool,ti),tool,response_text(data.get('tool_response',{})) or 'Tool reported failure with no text.')])
  except Exception:pass
  if tool!='Workflow':return 0
 if event=='PreToolUse':
  try:blocked=pre_checks(data,tool,session)
  except Exception:
   if tool=='Workflow':raise
   return 0
  if blocked is not None:return blocked
 if event=='PreToolUse' and tool in ('Agent','Task','Workflow') and data.get('agent_id'):
  registered=read_rows('SELECT 1 FROM launches WHERE session=? LIMIT 1',(session,))
  if registered:return deny('This workflow worker must not spawn descendants. Return a decomposition request to the conductor so helpers remain visible and within ten slots.')
 if event=='PreToolUse' and tool=='Workflow':return validate(data)
 if event=='PostToolUse' and tool in ('Agent','Task','TaskOutput'):
  # Not in the shipped matcher; harmless if it is widened. Agent completion frees slots.
  try:reap_now()
  except Exception:pass
  return 0
 if event=='PostToolUse' and tool=='TaskStop':
  task=(data.get('tool_input') or {}).get('task_id');reply=response_text(data.get('tool_response',{}))
  if task and 'successfully stopped' in reply.lower():
   launches=read_rows('SELECT * FROM launches WHERE session=?',(session,))
   watches=read_rows('SELECT path FROM watches WHERE session=?',(session,))
   stmts=[]
   for l in launches:
    try:r=json.loads(l['receipt'])
    except ValueError:continue
    if r.get('task_id')==task:
     stmts.append(("UPDATE launches SET state='CANCELLED' WHERE id=?",(l['id'],)))
     if r.get('run_id'):
      for w in watches:
       if Path(w['path']).parent.name==r['run_id']:stmts.append(("UPDATE watches SET state='CANCELLED',detail='Verified TaskStop receipt' WHERE path=?",(w['path'],)))
   if stmts:write_txn(stmts)
  try:reap_now()
  except Exception:pass
  return 0
 if event in ('PostToolUse','PostToolUseFailure') and tool=='Workflow':
  # Keep receipts as IDs/status only. A successful tool return is not rendered-tree proof.
  failed=event=='PostToolUseFailure'
  rows=read_rows('SELECT * FROM launches WHERE id=?',(data.get('tool_use_id',''),))
  row=rows[0] if rows else None
  if row is None:
   latest=read_rows('SELECT * FROM launches WHERE session=? ORDER BY created DESC LIMIT 1',(session,))
   row=latest[0] if latest else None
  if row:
   response=json.dumps(data.get('tool_response',{})).lower()
   failed=failed or 'invalid workflow script' in response or 'iserror": true' in response
   text=response_text(data.get('tool_response',{}))
   task=re.search(r'(?:Task ID:\s*)?\b(w[a-z0-9]{8})\b',text);run=re.search(r'(?:Run ID:\s*)?\b(wf_[A-Za-z0-9-]+)\b',text)
   receipt={'response_keys':list(data.get('tool_response',{})) if isinstance(data.get('tool_response'),dict) else [],'event':event,'task_id':task.group(1) if task else None,'run_id':run.group(1) if run else None,'visibility':'UNVERIFIED'}
   write_txn([('UPDATE launches SET state=?,receipt=? WHERE id=?',('FAILED' if failed else 'RETURNED' if task and run else 'LAUNCH_UNVERIFIED',json.dumps(receipt),row['id']))])
   for found in scan_watches(row['transcript'],session,row['created']):
    write_txn([('INSERT OR IGNORE INTO watches VALUES(?,?,?,?,?,?)',found)])
  try:reap_now()
  except Exception:pass
  context(event,'Launch failed: correct the error, retry at most twice, then mark blocked with evidence.' if failed else 'Launch returned. Verify the actual workflow/task ID and visible native tree; do not substitute a saved script or journal for visibility. Read '+str(STATE/'STATUS.md')+'.')
  return 0
 if event=='PreToolUse' and tool=='TaskOutput' and (data.get('tool_input') or {}).get('timeout',0)>60000:
  ti=dict(data['tool_input']);ti['timeout']=60000
  print(json.dumps({'hookSpecificOutput':{'hookEventName':event,'updatedInput':ti,'additionalContext':'TaskOutput waits are capped at 60 seconds so the conductor can review watchdog status, report real progress and advance independent work. Read '+str(STATE/'STATUS.md')+'. A timeout is not proof a worker failed.'}}))
  return 0
 if event=='SessionStart':
  lim=limits()
  try:
   c=db()
   try:occ=occupancy(c)
   finally:c.close()
   running='running now: workflows %d/%d, agents %d/%d'%(occ['workflows'],lim['concurrent_workflows_per_program'],occ['agents_total'],lim['concurrent_agents_total'])
  except Exception as e:running='running counts unavailable ('+type(e).__name__+')'
  context(event,('For Workflow tools the local guard requires explicit model/label/declared phase and max %d concurrent agents per workflow. Operator limits read from '+str(LIMITS_FILE)+' (defaults 10 per workflow, 50 workflows per program, 500 agents total), counted running-at-once with finished and dead runs reaped; '+running+'. Use '+str(ROOT/'make-workflow.py')+'. Review '+str(STATE/'STATUS.md')+' for stale-run alerts. Caps are safety guards only; keep existing authorization/cancellation boundaries.')%lim['concurrent_agents_per_workflow'])
  return 0
 if event in ('PreToolUse','Stop'):
  continued,latched=continuation_state(session)
  # Decision 10: while the stop latch is set the Stop hook never blocks and says nothing.
  if event=='Stop' and latched:return 0
  if not (STATE/'alerts.json').exists():return 0
  try:report=json.loads((STATE/'alerts.json').read_text())
  except (OSError,ValueError):return 0
  alerts=[a for a in report['alerts'] if a['session']==session]
  if time.time()-report.get('checked_at',0)>90:
   tracked=read_rows('SELECT 1 FROM launches WHERE session=? LIMIT 1',(session,))
   if tracked:alerts.append({'session':session,'workflow':'watchdog','state':'WATCHDOG_UNHEALTHY'})
  if not alerts:return 0
  fingerprint=hashlib.sha256(json.dumps([(a['workflow'],a['state']) for a in alerts],sort_keys=True).encode()).hexdigest()
  old=read_rows('SELECT fingerprint FROM notices WHERE session=?',(session,))
  if old and old[0][0]==fingerprint:return 0
  write_txn([('INSERT OR REPLACE INTO notices VALUES(?,?)',(session,fingerprint))])
  message='Workflow watchdog: '+', '.join(a['workflow']+' '+a['state'] for a in alerts)+'. Read '+str(STATE/'STATUS.md')+'. Reconcile worker progress; preserve results; continue independent ready work. Never blindly duplicate or terminate workers. Respect cancellation and approved spend. Do not claim completion.'
  if event=='Stop':
   if not data.get('stop_hook_active'):
    # Decision 10: after three guard-issued continuations with no human message, stop
    # continuing and hand back a plain status instruction instead.
    if continued>=3:context(event,'Continuation cap reached (3). Ending turn with a status report.')
    else:
     write_txn([('INSERT INTO continuations(session,count,latched,updated) VALUES(?,1,0,?) ON CONFLICT(session) DO UPDATE SET count=continuations.count+1,updated=excluded.updated',(session,time.time()))])
     print(json.dumps({'decision':'block','reason':message}))
  else:context(event,message)
 return 0

def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['hook','tick','watch','resolve','status','register','canary','cleanup'],nargs='?',default='hook');p.add_argument('--session');p.add_argument('--journal');p.add_argument('--reason');p.add_argument('--run-root',dest='run_root');p.add_argument('--workflow');p.add_argument('--dir',action='append',default=[]);p.add_argument('--dry-run',dest='dry_run',action='store_true');a=p.parse_args()
 if a.command=='hook':
  raw=sys.stdin.read()
  try:d=json.loads(raw)
  except ValueError:
   # Decision 12: an unparseable payload must not block ordinary tools. Only a payload that
   # could still be a Workflow launch stays fail-closed.
   if 'Workflow' in raw:return deny('Invalid hook JSON; cannot validate this request.')
   return 0
  if not isinstance(d,dict):return 0
  guarded=d.get('hook_event_name','PreToolUse')=='PreToolUse' and d.get('tool_name')=='Workflow'
  try:return hook(d)
  except Exception:
   if guarded:raise
   return 0
 if a.command=='register':
  if not a.session or not a.run_root:p.error('--session and --run-root required')
  root=Path(a.run_root).expanduser()
  if not root.is_absolute():p.error('--run-root must be an absolute path')
  write_limits()
  write_txn([('INSERT INTO programs(session,run_root,registered) VALUES(?,?,?) ON CONFLICT(session) DO UPDATE SET run_root=excluded.run_root,registered=excluded.registered',(a.session,os.path.normpath(str(root)),time.time()))])
  if a.workflow and a.dir:register_scratch(a.session,a.workflow,root,[d for d in a.dir if under(d,root) and os.path.normpath(os.path.abspath(d))!=os.path.normpath(str(root))])
  print(json.dumps({'session':a.session,'run_root':os.path.normpath(str(root)),'registered':True}));return 0
 if a.command=='canary':
  if not a.session:p.error('--session required')
  print(json.dumps(canary(a.session)));return 0
 if a.command=='cleanup':cleanup_scratch(dry=a.dry_run);print(json.dumps({'cleanup':'dry-run' if a.dry_run else 'done','log':str(STATE/'cleanup.log')}));return 0
 if a.command=='tick':print(json.dumps({'alerts':len(tick())}));return 0
 if a.command=='status':print((STATE/'STATUS.md').read_text() if (STATE/'STATUS.md').exists() else 'Not checked');return 0
 if a.command=='watch':
  if not a.session or not a.journal:p.error('--session and --journal required')
  j=Path(a.journal).resolve()
  if not j.is_file():p.error('journal does not exist')
  write_txn([('INSERT OR IGNORE INTO watches VALUES(?,?,?,?,?,?)',(str(j),a.session,time.time(),'','OBSERVING',''))])
 if a.command=='resolve':
  if not a.journal or not a.reason:p.error('--journal and --reason required; first verify cancellation/completion')
  write_txn([("UPDATE watches SET state='RESOLVED',detail=? WHERE path=?",(a.reason,str(Path(a.journal).resolve())))])
 return 0
if __name__=='__main__':
 try:sys.exit(main())
 except Exception as e:
  print('Workflow guard operational error: '+type(e).__name__+': '+str(e),file=sys.stderr);sys.exit(2)
