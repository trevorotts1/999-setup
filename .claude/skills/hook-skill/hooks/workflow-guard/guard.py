#!/usr/bin/env python3
"""Workflow launch validation and independent journal stall detection. No worker killing."""
import argparse, hashlib, json, os, re, shlex, shutil, sqlite3, subprocess, sys, time, unicodedata
from pathlib import Path
ROOT=Path(__file__).resolve().parent
STATE=Path(os.environ.get('WORKFLOW_GUARD_STATE',str(ROOT/'state')))
NODE=os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''
_STAFFING=[]

def _staffing():
 # The single implementation of the swarm-plan rules lives in staffing.py beside this file.
 if not _STAFFING:
  import importlib.util
  spec=importlib.util.spec_from_file_location('staffing_rules',ROOT/'staffing.py')
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);_STAFFING.append(m)
 return _STAFFING[0]

def db():
 STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
 c=sqlite3.connect(STATE/'guard.sqlite3',timeout=10)
 c.row_factory=sqlite3.Row
 try:c.execute('PRAGMA busy_timeout=10000')
 except sqlite3.Error:pass
 c.executescript('''CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,session TEXT,transcript TEXT,created REAL,script_hash TEXT,state TEXT,name TEXT,peak INTEGER,receipt TEXT); CREATE TABLE IF NOT EXISTS watches(path TEXT PRIMARY KEY,session TEXT,last_change REAL,signature TEXT,state TEXT,detail TEXT); CREATE TABLE IF NOT EXISTS notices(session TEXT PRIMARY KEY,fingerprint TEXT); CREATE TABLE IF NOT EXISTS health(id INTEGER PRIMARY KEY,checked REAL); CREATE TABLE IF NOT EXISTS failures(session TEXT,fingerprint TEXT,tool TEXT,count INTEGER,last_error TEXT,updated REAL,PRIMARY KEY(session,fingerprint)); CREATE TABLE IF NOT EXISTS continuations(session TEXT PRIMARY KEY,count INTEGER,latched INTEGER,updated REAL); CREATE TABLE IF NOT EXISTS programs(session TEXT PRIMARY KEY,run_root TEXT,registered REAL); CREATE TABLE IF NOT EXISTS session_liveness(session TEXT PRIMARY KEY,last_seen REAL NOT NULL); CREATE TABLE IF NOT EXISTS omission(session TEXT PRIMARY KEY,fingerprint TEXT,count INTEGER,updated REAL,alert TEXT); CREATE TABLE IF NOT EXISTS scratch(path TEXT PRIMARY KEY,session TEXT,workflow TEXT,run_root TEXT,registered REAL,ended REAL,status TEXT); CREATE TABLE IF NOT EXISTS plan_alerts(key TEXT PRIMARY KEY,session TEXT,workflow TEXT,state TEXT,detail TEXT,updated REAL); CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,session TEXT,plan TEXT,workflow_id TEXT,attempt TEXT,created REAL); CREATE TABLE IF NOT EXISTS human_prompts(session TEXT PRIMARY KEY,at REAL); CREATE TABLE IF NOT EXISTS launch_units(id TEXT PRIMARY KEY,units INTEGER);''')
 _staffing().migrate(c)  # launch_tags (workflowId per launch), launch_attempts, session_plans: idempotent
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
# Two-phase admission. PreToolUse writes a RESERVED launch (+ a reservations row): it counts toward the caps and toward
# "already running" while it lives (RESERVE_TTL seconds) and nothing else. Only the PostToolUse of the same tool_use_id
# confirms it (launch_tags, attempt id, pin, plan arming, handback count). A launch another PreToolUse hook refused never
# gets a PostToolUse, so its reservation lapses to UNCONFIRMED and leaves no trace in the plan accounting. An UNCONFIRMED
# row is kept for a day so a late PostToolUse (slow permission prompt) can still confirm a launch that really ran.
RESERVED='RESERVED';UNCONFIRMED='UNCONFIRMED';RESERVE_TTL=120;UNCONFIRMED_KEEP=86400
COUNTED=LIVE_STATES+(RESERVED,)

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
 return (now-float(row['last_seen']))<=lease_s()

def _backfill_liveness(c):
 # Seed the plane from each launch's own creation time so a row written before
 # this plane existed is aged honestly instead of reading live forever.
 rows=c.execute("SELECT session,MAX(created) last FROM launches WHERE state IN (?,?,?) AND session NOT IN (SELECT session FROM session_liveness) GROUP BY session",LIVE_STATES).fetchall()
 for r in rows:c.execute('INSERT OR IGNORE INTO session_liveness(session,last_seen) VALUES(?,?)',(str(r['session']),float(r['last'] or 0)))

def _armed_pinned(c,session):
 try:
  for r in c.execute('SELECT plan FROM session_pins WHERE session=?',(str(session),)).fetchall():
   d=_jload(r['plan'])
   if isinstance(d,dict) and str(d.get('status') or '').lower()=='running':return True
 except sqlite3.Error:pass
 return False

def reap_dead(c,now=None,commit=True):
 # Release dead launches so they stop counting. Returns freed count.
 # commit=False when already inside a caller's write transaction (admit_launch),
 # so the release joins that transaction atomically instead of committing early;
 # on the read path it must commit, or the release is silently rolled back.
 now=time.time() if now is None else now
 lease=lease_s()
 c.execute("UPDATE launches SET state=? WHERE state=? AND created<?",(UNCONFIRMED,RESERVED,now-RESERVE_TTL))
 for r in c.execute("SELECT id FROM launches WHERE state=? AND created<?",(UNCONFIRMED,now-UNCONFIRMED_KEEP)).fetchall():
  c.execute('DELETE FROM launches WHERE id=?',(r['id'],));c.execute('DELETE FROM reservations WHERE id=?',(r['id'],))
 _backfill_liveness(c)
 # A session holding an ARMED plan pin is never silently released: its runs stay live until they finish or are cancelled.
 dead=[r for r in c.execute('SELECT session FROM session_liveness WHERE last_seen < ?',(now-lease,)).fetchall() if not _armed_pinned(c,r['session'])]
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

def _wf_root(r):
 # The workflows directory holding this launch's run journals: the Transcript dir the Workflow tool itself reported
 # (receipt transcript_dir = .../workflows/<run id>), else the one the launching transcript implies. The tool's own
 # report wins: a session started in one cwd and moved to another keeps its transcript under the START slug while
 # the run lives elsewhere, so a slug derived from the launch cwd can point at the wrong tree.
 try:td=(json.loads(r['receipt'] or '{}') or {}).get('transcript_dir')
 except (ValueError,AttributeError):td=None
 if td:return str(Path(td).parent)
 if not r['transcript']:return None
 p=Path(r['transcript']);return str(p.parent/p.stem/'subagents'/'workflows')

def _own_watches(r,d,ws):
 # Only this launch's own journals, by RUN ID. A launch with no run id in its receipt owns no journal: no sibling
 # journal can ever finish it (a main session cannot forge a "finished" neighbour either).
 rid=_run_id(r['receipt'])
 if not rid:return []
 return [w for w in ws if w['path'].startswith(d+'/') and Path(w['path']).parent.name==rid]

def expected_agents(launch_id,c=None):
 # Agents a plan-tagged launch must see return: builder + checker per launched unit (make-workflow's pipeline(units,build,qc)
 # starts each checker only AFTER its builder returns, so "nothing pending" alone is not "done"). None = legacy launch, or no
 # units recorded: keep the old rule. The native journal has no run-level terminal line (checked over real journals).
 try:
  rows=(c.execute('SELECT units FROM launch_units WHERE id=?',(launch_id,)).fetchall() if c else read_rows('SELECT units FROM launch_units WHERE id=?',(launch_id,)))
  return 2*int(rows[0][0]) if rows and rows[0][0] else None
 except Exception:return None

def run_done(summary,expected):
 return bool(summary['results'] and not summary['pending'] and (not expected or summary['results']>=expected))

def reap_finished(c):
 # A run is finished when every journal of its own has returned. A launch with no
 # journals yet stays live, and one journal still observing keeps it live, so this
 # only ever frees on positive evidence.
 freed=0;ws=c.execute('SELECT path,state FROM watches').fetchall()
 for r in c.execute("SELECT id,transcript,created,receipt FROM launches WHERE state IN (?,?,?)",LIVE_STATES).fetchall():
  d=_wf_root(r)
  if not d:continue
  rows=_own_watches(r,d,ws)
  if not rows:
   # No watch row yet: read the run's own journal directly so release is immediate.
   m=journal_summary(r)
   if m and m['events'] and not m['running'] and run_done(m,expected_agents(r['id'],c)):
    c.execute("UPDATE launches SET state='COMPLETED' WHERE id=?",(r['id'],));freed+=1
   continue
  if all(w['state'] in ('AGENTS_RETURNED','RESOLVED','CANCELLED') for w in rows):
   c.execute("UPDATE launches SET state='COMPLETED' WHERE id=?",(r['id'],))
   freed+=1
 return freed

def journal_summary(r):
 # Summary of this launch's own journal, or None when it has none yet.
 rid=_run_id(r['receipt']);d=_wf_root(r)
 if not rid or not d:return None
 j=Path(d)/rid/'journal.jsonl'
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
 for r in c.execute("SELECT session,peak,transcript,receipt FROM launches WHERE state IN (?,?,?,?)",COUNTED).fetchall():
  per[r['session']]=per.get(r['session'],0)+1
  workflows+=1
  # Live accounting: finished agents free their slots; the declared peak only
  # stands in until the run's journal exists.
  run=live_running(r);peak=int(r['peak'] or 0)
  agents+=peak if run is None else min(run,peak)
 return {'workflows':workflows,'per_program':per,'agents_total':agents}

def _can_arm(plan):
 # The plan's status can be flipped only when its directory is writable (the flip is an atomic rename). Checked BEFORE a
 # launch is reserved, so a launch is never admitted on a plan that cannot be armed.
 d=_jload(plan)
 if not isinstance(d,dict) or str(d.get('status') or '').lower()=='running':return True
 return os.access(str(Path(plan).parent),os.W_OK|os.X_OK)

def admit_launch(row,tag=None):
 # PHASE ONE: reserve a validated launch only while it fits the operator caps, atomically. Count, cap check and insert
 # share one BEGIN IMMEDIATE transaction, so two launches racing for the last slot cannot both be reserved. Returns None
 # when reserved, or a refusal message the caller turns into a block. The reservation counts toward the caps and toward
 # "already running" but writes no launch_tags / attempt_ids / pin and does not arm the plan: confirm_launch does, from the
 # PostToolUse of the same tool_use_id, so a launch refused by another hook leaves nothing behind.
 lim=limits();last=None
 if tag and not _can_arm(tag[1]):return 'plan %s cannot be armed (its directory is not writable), so a launch against it cannot be admitted; make the plan directory writable or run `staffing.py start` first.'%tag[1]
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
    if tag:
     # Plan rules re-checked INSIDE this write transaction, atomically with the insert: check_launch ran earlier, outside
     # it, so two racing hooks could both pass it. Live = confirmed live launches PLUS live reservations of other launches.
     lp=(tag[1],)+LIVE_STATES+(row[0],)
     live_ids=set(x[0] for x in c.execute("SELECT t.workflow_id FROM launch_tags t JOIN launches l ON l.id=t.id WHERE t.plan=? AND l.state IN (?,?,?) AND t.id!=?",lp))
     live_ids|=set(x[0] for x in c.execute("SELECT r.workflow_id FROM reservations r JOIN launches l ON l.id=r.id WHERE r.plan=? AND l.state=? AND r.id!=?",(tag[1],RESERVED,row[0])))
     if tag[0] in live_ids:
      c.execute('ROLLBACK')
      return 'workflow %s is already running (another launch of it was admitted first); do not launch it twice.'%tag[0]
     mx=_staffing().plan_max_active(tag[1],STATE)
     if mx and len(live_ids)>=mx:
      c.execute('ROLLBACK')
      return 'the plan runs at most %d workflows at once and %d are running (admission re-check); launch %s when one finishes.'%(mx,len(live_ids),tag[0])
     if len(tag)>2 and tag[2]:
      if c.execute('SELECT 1 FROM attempt_ids WHERE plan=? AND attempt_id=?',(tag[1],str(tag[2]))).fetchone() or c.execute("SELECT 1 FROM reservations r JOIN launches l ON l.id=r.id WHERE r.plan=? AND r.attempt=? AND l.state=? AND r.id!=?",(tag[1],str(tag[2]),RESERVED,row[0])).fetchone():
       c.execute('ROLLBACK')
       return 'args.attemptId %s was already used by an admitted launch of this plan; every launch needs a new unique attemptId.'%json.dumps(tag[2])
    c.execute('INSERT OR REPLACE INTO launches VALUES(?,?,?,?,?,?,?,?,?)',(row[0],row[1],row[2],row[3],row[4],RESERVED)+tuple(row[6:]))
    if tag and len(tag)>3 and tag[3]:c.execute('INSERT OR REPLACE INTO launch_units VALUES(?,?)',(row[0],int(tag[3])))
    if tag:c.execute('INSERT OR REPLACE INTO reservations VALUES(?,?,?,?,?,?)',(row[0],session,tag[1],tag[0],str(tag[2]) if len(tag)>2 and tag[2] else None,now))
    c.execute('COMMIT')
    return None
   finally:c.close()
  except sqlite3.OperationalError as e:
   last=e
   if not _is_locked(e):raise
 raise last

def confirm_launch(row):
 # PHASE TWO (PostToolUse success, same tool_use_id). Arming FIRST: the plan status must read "running" before any tag,
 # attempt id or pin is written, so there is never an admitted launch on an unarmed plan. If the flip fails the launch
 # (which really ran) stays counted live but untagged, and a PLAN_ARM_FAILED alert is raised for the owner.
 rs=read_rows('SELECT * FROM reservations WHERE id=?',(row['id'],));r=rs[0] if rs else None
 armed=True
 if r:
  try:
   _staffing().set_running(r['plan'])
   d=_jload(r['plan']);armed=isinstance(d,dict) and str(d.get('status') or '').lower()=='running'
  except Exception:armed=False
 now=time.time();stmts=[("UPDATE launches SET state='VALIDATED' WHERE id=? AND state IN (?,?)",(row['id'],RESERVED,UNCONFIRMED))]
 if r and armed:
  if r['attempt']:stmts.append(('INSERT OR IGNORE INTO attempt_ids VALUES(?,?,?,?,?)',(r['plan'],r['attempt'],r['workflow_id'],row['id'],now)))
  stmts.append(('INSERT OR REPLACE INTO launch_tags VALUES(?,?,?,?,?)',(row['id'],r['session'],r['workflow_id'],r['plan'],now)))
  stmts.append(('INSERT OR IGNORE INTO session_pins VALUES(?,?,?)',(r['session'],r['plan'],now)))
 if r:stmts.append(('DELETE FROM reservations WHERE id=?',(row['id'],)))
 write_txn(stmts)
 if r and not armed:
  try:raise_alert('armfail|'+row['id'],r['session'],r['workflow_id'],'PLAN_ARM_FAILED','Launch of %s ran but plan %s could not be set to running; the launch is counted live but NOT recorded against the plan. Run `staffing.py start` (the owner).'%(r['workflow_id'],r['plan']))
  except Exception:pass
  print('WORKFLOW GUARD WARNING: launch ran but plan %s could not be armed; not recorded against the plan.'%r['plan'],file=sys.stderr)

def drop_reservation(row):
 write_txn([('DELETE FROM launches WHERE id=? AND state IN (?,?)',(row['id'],RESERVED,UNCONFIRMED)),('DELETE FROM reservations WHERE id=?',(row['id'],))])


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

# ---- Unit verdict files are written by checker SUBAGENTS only ----
# The main (conductor) session may not write any *.verdict.json ANYWHERE (no plan condition, same as Write/Edit): Write/Edit/
# MultiEdit/NotebookEdit are refused outright, and Bash commands that write such a path (redirect >, >>, tee, cp/mv/install/ln
# to it, sed -i, dd of=, python open(..,'w')/write_text) are refused best-effort. A SUBAGENT (hook payload carries agent_id; agent_type
# alone proves nothing) may write a verdict only with the Write tool, only a *.verdict.json, only inside a plan's evidence tree and
# only when its agent_id belongs to the admitted run (by run id) of the owning workflow; Bash verdict writes are refused for it too.
# The verdict is journaled from PostToolUse (the write succeeded) with the sha256 of the content written.
# RESIDUAL BYPASS (honest): the Bash rule is a pattern match on the command text. A conductor that builds the path
# indirectly (shell variables, base64/printf-assembled names, a script file it wrote first and then runs, git checkout/restore,
# a tool that is not named above) can still write a verdict file. The in-file provenance (unit_id, an attempt_id the guard
# recorded at admission, different builder and reviewer models) is what makes a forged file costly, not this check.
VERDICT_TOKEN=r"[^\s'\"<>|;&()=]*\.verdict\.json"
VERDICT_BASH_WRITE=[re.compile(p,re.I|re.S) for p in (
 r">>?\s*['\"]?"+VERDICT_TOKEN,
 r"\btee\b[^|;&\n]*"+VERDICT_TOKEN,
 r"\b(?:cp|mv|install|ln|rsync)\b[^|;&\n]*"+VERDICT_TOKEN+r"['\"]?\s*(?:[;&|\n]|$)",
 r"\bsed\b[^|;&\n]*\s-[a-zA-Z]*i[^|;&\n]*"+VERDICT_TOKEN,
 r"\bof=['\"]?"+VERDICT_TOKEN,
 r"open\s*\([^)]*\.verdict\.json[^)]*,\s*['\"][^'\"]*[wax+]",
 r"\.verdict\.json['\"]?\s*\)\s*\.(?:write_text|write_bytes|open)\b",
 r"\.verdict\.json[^\n]*\b(?:write_text|write_bytes|writeFileSync|writeFile)\b",
)]

def verdict_write_block(data,tool,ti,session):
 # Bash only (Write/Edit are handled by protected_write_block): a shell command that writes a *.verdict.json, with or without a plan.
 if tool!='Bash':return None  # subagents too: a verdict is written with the Write tool only
 cmd=str(ti.get('command') or '')
 if '.verdict.json' not in cmd.lower() or not any(r.search(cmd) for r in VERDICT_BASH_WRITE):return None
 found=_staffing().resolve_plan(data.get('cwd') or os.getcwd(),session,STATE)
 return refuse(VERDICT_MSG%('a .verdict.json path in the command',found[0] if found else NO_PLAN_NOTE))

NO_PLAN_NOTE='no plan needed: this rule holds everywhere'
VERDICT_MSG='The conductor session may not write unit verdict files (%s, plan %s). A verdict is written only by the checker agent that judged the unit: dispatch that checker and let it write {"verdict","unit_id","attempt_id","builder_model","reviewer_model"} with the Write tool. Do not bypass hooks.'

# ---- The governed session may not tamper with what governs it ----
# Main-session Write/Edit/MultiEdit/NotebookEdit are refused for: any file whose lowercased basename ends .verdict.json (anywhere, no
# plan condition), the armed/pinned plan file, its evidence/ tree, the guard state dir and the question-gate state dir. Every comparison is on
# realpath, lowercased on both sides (APFS is case-insensitive, symlinks resolve). Bash is best effort: a command that names one of
# those paths AND carries a write/move/delete verb is refused; `staffing.py start|status` is the one allowed invocation.
# RESIDUAL (honest): Bash is text matching. A path assembled in a variable or by a script file the conductor wrote earlier, an
# interpreter one-liner that builds the path, or a symlink created earlier can still reach these files.
WRITE_VERB=re.compile(r'(?:^|[\s;&|(`])(?:mv|cp|rm|ln|tee|rsync|install|dd|truncate|touch|sqlite3|unzip|chmod|rmdir|patch)\b|>>?|\bsed\b[^|;&\n]*\s-[a-zA-Z]*i|\b(?:python3?|node|ruby|perl)\b[^\n]*(?:open|write|connect|unlink|remove|rename|replace|shutil|sqlite3|-i)|\btar\b[^\n]*\s-?[a-zA-Z]*x|\bgit\s+(?:checkout|restore)\b',re.I)
QUIET_REDIRECT=re.compile(r'\d*>&\d+|&?\d*>\s*/dev/null')
def _staffing_ok(cmd):
 # Only THIS guard's own staffing.py (resolved real path), `start` or `status`, with no shell metacharacters.
 c=QUIET_REDIRECT.sub(' ',cmd)
 if re.search(r'[;&|<>`$()\n]',c):return False
 try:t=shlex.split(c)
 except ValueError:return False
 if t and 'python' in os.path.basename(t[0]).lower():t=t[1:]
 if len(t)<2 or t[1] not in ('start','status'):return False
 try:return os.path.realpath(os.path.expanduser(t[0]))==os.path.realpath(str(ROOT/'staffing.py'))
 except (OSError,ValueError):return False

def _rl(p):
 return os.path.realpath(os.path.expanduser(str(p))).lower()

def _under_l(p,root):
 return p==root or p.startswith(root.rstrip(os.sep)+os.sep)

def _state_roots():
 h=Path.home()
 return {STATE,ROOT/'state',QG_STATE,h/'.claude/hooks/workflow-guard/state',h/'.claude/hooks/question-gate/state',h/'.claude-nine/hooks/workflow-guard/state',h/'.claude-nine/hooks/question-gate/state'}

JOURNAL_SEG='/subagents/workflows/'
SUB_NAMES=('guard.sqlite3','limits.json','capacity-probe-cache.json','swarm-plan.json')
EXTRA_BASH_REFS=['subagents/workflows','limits.json','capacity-probe-cache']

def _plan_of_evidence(real):
 # The plan file whose evidence/ tree contains this real path, found by walking up (any plan on disk), or None.
 d=os.path.dirname(real)
 while d and d!=os.path.dirname(d):
  if os.path.basename(d).lower()=='evidence' and os.path.exists(os.path.join(os.path.dirname(d),'SWARM-PLAN.json')):return os.path.join(os.path.dirname(d),'SWARM-PLAN.json')
  d=os.path.dirname(d)
 return None

def _sub_verdict_authorized(data,rp,session,cwd,extra_plan):
 # A subagent may write a verdict into a plan's evidence tree only when its agent_id belongs to the ADMITTED run (by run id) of
 # the workflow that owns that verdict file. Returns True/False.
 st=_staffing();aid=data.get('agent_id')
 cands=[str(x[0]) for x in st.resolve_plans(cwd,session,STATE)]
 if extra_plan:cands.append(str(extra_plan))
 for path in dict.fromkeys(cands):
  doc=_jload(path)
  for wf in st.workflows(doc or {}):
   for u in wf.get('units') or []:
    if not isinstance(u,dict) or not u.get('verdict_file') or _rl(Path(path).parent/u['verdict_file'])!=rp:continue
    for r in read_rows("SELECT l.transcript,l.receipt FROM launch_tags t JOIN launches l ON l.id=t.id WHERE t.plan=? AND t.workflow_id=? AND l.state IN (?,?,?,'COMPLETED')",(str(Path(path).resolve()),wf['workflow_id'])+LIVE_STATES):
     if _agent_in_run(r['transcript'],r['receipt'],aid,data):return True
 return False

def protected_write_block(data,tool,ti,session):
 # Main session AND subagents (agent_id present; agent_type alone proves nothing, the main thread of `claude --agent` sends it).
 sub=bool(data.get('agent_id'))
 who='A subagent' if sub else 'The governed session'
 cwd=data.get('cwd') or os.getcwd()
 try:plans=_staffing().protected_plan_paths(cwd,session,STATE)
 except Exception:plans=[]
 if tool in FENCE_EDIT:
  t=ti.get('file_path') or ti.get('notebook_path')
  if not t:return None
  p=Path(str(t)).expanduser();p=p if p.is_absolute() else Path(cwd)/p
  rp=_rl(p);base=os.path.basename(rp)
  isv=os.path.basename(str(p)).lower().endswith('.verdict.json') or base.endswith('.verdict.json')
  if isv and not sub:return refuse(VERDICT_MSG%(t,plans[0] if plans else NO_PLAN_NOTE))
  for r in _state_roots():
   if _under_l(rp,_rl(r)):return refuse('%s may not write the guard or question-gate state (%s). That state is the owner\'s enforcement record. Do not bypass hooks.'%(who,t))
  if JOURNAL_SEG in rp:return refuse('%s may not write a workflow run journal (%s): only the runtime writes <transcript>/subagents/workflows/**. Do not bypass hooks.'%(who,t))
  for pp in plans:
   if rp==_rl(pp):return refuse('%s may not write or rename the armed plan file %s; it governs this session. Use `staffing.py start|status`. Do not bypass hooks.'%(who,pp))
   if not sub and _under_l(rp,_rl(Path(pp).parent/'evidence')):return refuse('The governed session may not write the evidence tree of armed plan %s (%s); checker agents write verdicts. Do not bypass hooks.'%(pp,t))
  if sub:
   if base in SUB_NAMES:return refuse('A subagent may not write %s (guard limits, state, capacity cache or a plan file). Do not bypass hooks.'%t)
   ev=_plan_of_evidence(os.path.realpath(str(p)))
   if ev is None:
    for pp in plans:
     if _under_l(rp,_rl(Path(pp).parent/'evidence')):ev=str(pp);break
   if ev is not None:
    if tool!='Write':return refuse('Write unit verdicts with the Write tool (full content) so the guard can journal them; %s edits in a plan evidence tree are refused.'%tool)
    if not isv:return refuse('A subagent may write only *.verdict.json files in a plan evidence tree (%s). Do not bypass hooks.'%t)
    if not _sub_verdict_authorized(data,rp,session,cwd,ev):return refuse('This agent is not part of the admitted run of the workflow that owns %s, so it may not write that verdict. Do not bypass hooks.'%t)
   elif isv:return refuse('A verdict file is written only inside its plan\'s evidence tree by an agent of the admitted run (%s).'%t)
  return None
 if tool=='Bash':
  cmd=str(ti.get('command') or '')
  if _staffing_ok(cmd):return None
  low=cmd.lower();refs=[]
  for r in _state_roots():refs+=[str(r).lower(),_rl(r),str(r).lower().replace(str(Path.home()).lower(),'~')]
  refs+=['workflow-guard/state','question-gate/state','guard.sqlite3','workflow_guard_state','question_gate_state']+EXTRA_BASH_REFS
  if sub:refs+=['swarm-plan.json','evidence/']
  for pp in plans:refs+=[str(pp).lower(),Path(pp).name.lower(),str(Path(pp).parent/'evidence').lower(),'evidence/']
  hit=next((x for x in refs if x and x in low),None)
  if hit and (WRITE_VERB.search(QUIET_REDIRECT.sub(' ',cmd)) or 'staffing.py' in low):  # a staffing.py that _staffing_ok did not vouch for, aimed at a governed path, may do anything
   return refuse('This command writes, moves or deletes something that governs the session (%s: plan file, evidence tree, run journal, guard or question-gate state). %s may not do that. Only `staffing.py start|status` is allowed. Do not bypass hooks.'%(hit,who))
 return None

# ---- DONE needs a journal record (defect 11) ----
# When a SUBAGENT (hook payload carries agent_id) Writes a *.verdict.json, the guard journals {unit_id, attempt_id, sha256 of the
# content, agent_id, launch_id} in verdict_records IF the agent provably belongs to a live or finished ADMITTED launch of that
# workflow: the verdict's attempt_id must be the one admitted for that launch, and agent_id must appear in that launch's run (the
# agent-<agent_id>.jsonl transcript or a journal.jsonl "agentId" under <launch transcript>/subagents/workflows/<run>/). staffing.is_done
# requires the file's CURRENT sha256 to match such a record. PROVEN: a hand-written, conductor-written, later-edited or
# unlinked-agent verdict never counts. NOT PROVEN: that the judging agent was an independent checker or really looked (any agent of
# the run can write a PASS for any unit of that workflow), nor that the hook's agent_id equals the journal agentId in every Claude
# Code build (verified only by the file naming of real runs: agent-<agentId>.jsonl); if they ever differ, verdicts are simply never
# recorded and DONE is unreachable (fail closed), never forged.
def _agent_in_run(transcript,receipt,agent_id,data=None):
 # By RUN ID only: a launch whose receipt carries no run id credits nobody (no other workflow's run is ever searched).
 rid=_run_id(receipt)
 if not transcript or not agent_id or not rid or '/' in str(rid) or '..' in str(rid):return False
 tp=Path(transcript);base=tp.parent/tp.stem/'subagents'/'workflows'
 for d in [base/rid]:
  if (d/('agent-%s.jsonl'%agent_id)).exists():return True
  try:
   if '"agentId":"%s"'%agent_id in (d/'journal.jsonl').read_text():return True
  except OSError:pass
 return False

def record_subagent_verdict(data,tool,ti,session):
 # Runs from PostToolUse (the Write succeeded), never before the write: the record carries the sha256 of the content written.
 if not data.get('agent_id') or tool!='Write':return None
 t=ti.get('file_path') or ti.get('notebook_path')
 if not t or not os.path.basename(str(t)).lower().endswith('.verdict.json'):return None
 content=ti.get('content')
 if not isinstance(content,str):return None
 try:d=json.loads(content)
 except ValueError:return None
 if not isinstance(d,dict):return None
 cwd=data.get('cwd') or os.getcwd()
 p=Path(str(t)).expanduser();p=p if p.is_absolute() else Path(cwd)/p
 rp=_rl(p);sha=hashlib.sha256(content.encode('utf-8')).hexdigest()
 st=_staffing()
 for path,doc in st.resolve_plans(cwd,session,STATE):
  for wf in st.workflows(doc or {}):
   for u in wf.get('units') or []:
    if not isinstance(u,dict) or u.get('unit_id')!=d.get('unit_id') or not u.get('verdict_file'):continue
    if _rl(Path(path).parent/u['verdict_file'])!=rp:continue
    for r in read_rows("SELECT l.id,l.transcript,l.receipt FROM launch_tags t JOIN launches l ON l.id=t.id JOIN attempt_ids a ON a.launch_id=l.id WHERE t.plan=? AND t.workflow_id=? AND a.plan=? AND a.attempt_id=? AND l.state IN (?,?,?,'COMPLETED')",(str(path),wf['workflow_id'],str(path),str(d.get('attempt_id')))+LIVE_STATES):
     if _agent_in_run(r['transcript'],r['receipt'],data['agent_id'],data):
      write_txn([('INSERT OR IGNORE INTO verdict_records VALUES(?,?,?,?,?,?,?,?)',(str(path),wf['workflow_id'],u['unit_id'],str(d.get('attempt_id')),sha,str(data['agent_id']),r['id'],time.time()))])
      return None
 return None

# ---- Plan Agent/Task rule (mirror of dispatch-gate.py PLAN-STRICT AGENT/TASK RULE; keep in step with it) ----
# Under a found plan an Agent/Task call is allowed only for subagent_type Explore, Plan or claude-code-guide with no write
# intent and no mention of guard-owned files; anything else, or any error while deciding, is refused (fail closed).
PLAN_READONLY_TYPES = ("Explore", "Plan", "claude-code-guide")
PLAN_WRITE_VERBS = (
    "build implement fix repair write edit create generate code commit merge deploy refactor patch modify "
    "install delete change update save add replace set append put store record populate rename move remove "
    "mkdir touch chmod apply emit produce forge").split()
# Homoglyph skeleton: Cyrillic/Greek lookalikes -> Latin (applied after lower-casing).
_HOMOGLYPHS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w", "к": "k", "м": "m", "т": "t", "н": "h", "в": "b", "ѵ": "v",
    "α": "a", "ε": "e", "ο": "o", "ρ": "p", "ι": "i", "κ": "k", "τ": "t", "υ": "u", "χ": "x", "ν": "v",
    "β": "b", "η": "n", "μ": "u", "ω": "w", "ς": "s", "ϲ": "c", "ӏ": "l", "ѕ": "s", "ɡ": "g", "ℓ": "l"})


def plan_normalize(text):
    """NFKD, drop format (Cf) and combining (Mn) chars, lower-case, map homoglyphs to Latin."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if unicodedata.category(c) not in ("Cf", "Mn"))
    return text.lower().translate(_HOMOGLYPHS)


def _verb_re(v):
    # letters may be split by ONE space/dot/dash/underscore ("im plement", "w.r.i.t.e"); re-/over- prefixes;
    # inflections incl. doubled consonant and dropped -e; matches inside rewrite/overwrite/readd.
    sep = r"[\s_.\-]?"
    spell = lambda s: sep.join(map(re.escape, s))
    if v.endswith("e"):
        stem, suf = v[:-1], "(?:e|es|ed|ing)"
    else:
        stem, suf = v, "(?:s|es|ed|d|ing|%sing|%sed)?" % (v[-1], v[-1])
    return r"\b(?:(?:re|over)[\s_.\-]?)?" + spell(stem) + suf + r"\b"


PLAN_WRITE_RE = re.compile(
    "|".join(_verb_re(v) for v in PLAN_WRITE_VERBS)
    + r"|\b(?:built|wrote|written|rewrote|overwrote|output[\s_.\-]?to)\b")
PLAN_READ_RE = re.compile(
    r"\b(?:read\w*|research\w*|explor\w*|audit\w*|qc|judge|verif\w*|review\w*|survey|summari[sz]e|list)\b", re.I)
# Guard-owned artefacts: naming one next to ANY write verb or shell writer is refused (forged-verdict chain).
PLAN_SENSITIVE = (".verdict.json", "evidence/", "swarm-plan.json", "guard.sqlite3", "question-gate")
PLAN_SHELL_WRITE_RE = re.compile(r">|\b(?:cp|mv|tee|dd|rsync|ln|sed|echo|printf)\b")


# Guard-owned files and tools: under a plan a prompt may not NAME any of these at all (lower-cased match).
PLAN_GUARD_NAMES = ("guard.sqlite3", "verdict_records", "launch_tags", "workflow-guard/state", "question-gate",
                    "swarm-plan.json", "limits.json", "capacity-probe-cache", ".verdict.json", "evidence/",
                    "subagents/workflows", "journal.jsonl", "sqlite3", "staffing.py")
# "Run this file" instructions: a shell/interpreter given a path, pipes into a shell, eval/source, "follow every instruction in".
_PATHISH = r"""["']?(?:[~/.$]|\S+\.\w{1,4}\b)"""
PLAN_RUNFILE_RE = re.compile(
    r"\b(?:bash|sh|zsh|dash|ksh|source)\s+(?:-\S+\s+)*" + _PATHISH
    + r"|\b(?:python[0-9.]*|node|perl|ruby|php)\s+(?:-c\b|(?:-\S+\s+)*" + _PATHISH + r")"
    + r"|\|\s*(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl)\b|\beval\b|\bexec\s+\S|(?:^|\s)\.\s+[~/.$]"
    + r"|\b(?:follow|obey|execute|run|carry out|source)\s+(?:(?:every|all|any|the|these|those|each)\s+)*"
      r"(?:instructions?|commands?|steps?|scripts?|files?|directives?)\s+(?:in|from|at|of|inside)\b")


def plan_text_allowed(text):
    """Shared prompt check under a plan (Agent/Task prompt+description, SendMessage message)."""
    text = plan_normalize(text)
    if PLAN_WRITE_RE.search(text):
        return False
    if any(n in text for n in PLAN_GUARD_NAMES):
        return False
    if PLAN_RUNFILE_RE.search(text):
        return False
    return True


def plan_agent_allowed(ti):
    """Under a plan: an Agent/Task call passes only if it is demonstrably read-only. The write-intent
    veto scans the WHOLE normalised prompt+description and beats any READ-ONLY marker."""
    if not plan_text_allowed("\n".join(ti.get(k) for k in ("description", "prompt") if isinstance(ti.get(k), str))):
        return False
    kind = ti.get("subagent_type") if isinstance(ti.get("subagent_type"), str) else ""
    return kind in PLAN_READONLY_TYPES



def plan_agent_block(data,session):
 try:
  cwd=data.get('cwd') or os.getcwd();found=None
  try:found=_staffing().resolve_plan(cwd,session,STATE)
  except Exception:found=_staffing().find_plan(cwd)
  if not found:return None
  ti=data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {}
  if plan_agent_allowed(ti):return None
  return refuse('HIDDEN BUILD (plan %s): under a swarm plan an Agent/Task call must be read-only (subagent_type Explore, Plan or claude-code-guide; no write/build intent and no mention of guard-owned files or run-this-file instructions anywhere in prompt or description). Builds go through the planned Workflow launch.'%found[0])
 except Exception as e:
  return refuse('HIDDEN BUILD check could not be completed under a plan (%s); refused, fail closed.'%type(e).__name__)

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
 if tool in FENCE_EDIT or tool=='Bash':
  vb=verdict_write_block(data,tool,ti,session)
  if vb is not None:return vb
  pb=protected_write_block(data,tool,ti,session)
  if pb is not None:return pb
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
 write_txn([('INSERT INTO human_prompts(session,at) VALUES(?,?) ON CONFLICT(session) DO UPDATE SET at=excluded.at',(str(session),time.time())),('INSERT INTO continuations(session,count,latched,updated) VALUES(?,0,?,?) ON CONFLICT(session) DO UPDATE SET count=0,latched=excluded.latched,updated=excluded.updated',(session,stop,time.time())),('UPDATE omission SET count=0 WHERE session=?',(session,))])
 return 0

def plan_tag(data,ti):
 # (workflowId, plan path) when this launch carries a workflowId under a plan governing the session.
 try:
  a=ti.get('args');wid=a.get('workflowId') if isinstance(a,dict) else None
  if not (isinstance(wid,str) and wid):return None
  f=_staffing().plan_for_launch(data.get('cwd') or os.getcwd(),data.get('session_id','unknown'),STATE,wid)
  aid=a.get('attemptId');aid=aid if isinstance(aid,str) and aid.strip() else None
  u=a.get('units');return (wid,str(f[0]),aid,len(u) if isinstance(u,list) else 0) if f else None
 except Exception:return None

def validate(data):
 # Refused launches are never recorded: only an ADMITTED launch (admit_launch) writes launch_tags/attempt_ids.
 return _validate(data,{})

def _validate(data,ctx):
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
 ti['script']=s  # ONE read of the script: staffing.check_launch, validate.mjs and the launched bytes all use this copy
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
 ctx['tag']=plan_tag(data,ti)
 # Plan launch contract FIRST, without recording: nothing is journaled unless every check below passes.
 sess=data.get('session_id','unknown');cwd=data.get('cwd') or os.getcwd();env=dict(os.environ)
 try:reap_now()
 except Exception:pass
 ok,why=_staffing().check_launch(ti,cwd,session=sess,state_dir=STATE,attempt_id=data.get('tool_use_id'),reap=False,record=False)
 if not ok:return refuse(why)
 a_=ti.get('args');found=_staffing().plan_for_launch(cwd,sess,STATE,a_.get('workflowId') if isinstance(a_,dict) else None)
 if found and isinstance(found[1],dict):env['WORKFLOW_GUARD_CAP']=str(_staffing().launch_agent_cap(found[1],STATE,sess))
 try:
  out=subprocess.run([NODE,str(ROOT/'validate.mjs')],input=json.dumps({'script':s,'args':ti.get('args'),'windowHelper':_staffing().WINDOW_HELPER}),text=True,capture_output=True,timeout=15,env=env)
  result=json.loads(out.stdout)
 except Exception as e:return deny('Validator unavailable; repair the checker before launch ('+type(e).__name__+').')
 if not result.get('ok'):return deny('\n'.join(result.get('errors',['Validation failed'])))
 sha=hashlib.sha256(s.encode()).hexdigest();snap=STATE/'scripts'/(sha+'.js');atomic(snap,s)
 ident=str(data.get('tool_use_id') or hashlib.sha256((str(data.get('session_id'))+sha+str(time.time_ns())).encode()).hexdigest())
 refusal=admit_launch((ident,data.get('session_id','unknown'),data.get('transcript_path',''),time.time(),sha,'VALIDATED',result.get('name'),result['conservativePeak'],''),ctx['tag'])
 if refusal:return deny(refusal)
 # Launch the exact bytes checked, retaining all other tool arguments and permission policy.
 updated=dict(ti);updated.pop('scriptPath',None);updated.pop('name',None);updated['script']=s
 print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','updatedInput':updated,'additionalContext':f"Workflow guard validated {result['conservativePeak']} maximum active lanes; cap {result['cap']}. Explicit phases checked.{argument_note} After launch verify the returned workflow ID and native /workflows tree. Workers must not spawn helpers. Poll no longer than 60 seconds at a time; read watchdog alerts and continue ready units. A validated file does not prove rendered visibility."}}))
 return 0

def scan_watches(transcript,session,after,root=None):
 # Filesystem scan only: no DB access, safe to run outside any transaction.
 found=[]
 if not transcript and not root:return found
 p=Path(transcript or 'x/x')
 try:paths=list((Path(root) if root else p.parent/p.stem/'subagents/workflows').glob('*/journal.jsonl'))
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
 run2state={};run2exp={}
 for l in read_rows('SELECT id,state,receipt FROM launches'):
  try:r=json.loads(l['receipt'] or '{}')
  except ValueError:continue
  rid=r.get('run_id')
  if rid:run2state[rid]=l['state'];run2exp[rid]=expected_agents(l['id'])
 discovered=[]
 for l in launches:
  discovered.extend(scan_watches(l['transcript'],l['session'],l['created'],_wf_root(l)))
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
   state=('MALFORMED_JOURNAL' if summary['malformed_lines'] else 'AGENTS_RETURNED' if run_done(summary,run2exp.get(path.parent.name)) else 'STALE_REVIEW_REQUIRED' if age>=600 else 'NO_RESULT_WARNING' if age>=300 else 'OBSERVING')
   # Decision 14: runtime cap is an alert, never a block. It never hides a stall, a malformed
   # journal or a finished run, so it clears on its own once the run returns.
   if summary['runtime_peak']>10 and state in ('OBSERVING','NO_RESULT_WARNING'):state='RUNTIME_CAP_EXCEEDED'
   detail=json.dumps({**summary,'seconds_without_journal_progress':round(age),'note':'Journal progress is a signal, not proof of useful work or wave/QC completion.'})
  # A terminal parent means this journal is residue, not a live stall. Preserve the
  # pre-resolution state and evidence so the record stays auditable. RETURNED is NOT terminal: it is the state a
  # confirmed launch holds while its background run is still going (the tool returns at once); resolving on it
  # released the launch as COMPLETED seconds into a live run.
  owned=run2state.get(path.parent.name)
  if owned in ('CANCELLED','FAILED','COMPLETED','REAPED') and state!='RESOLVED':
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
  d=_wf_root(l)
  if not d:continue
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
 try:
  for o in read_rows('SELECT session,workflow,state,detail FROM plan_alerts'):alerts.append({'session':o['session'],'workflow':o['workflow'],'state':o['state'],'detail':o['detail']})
 except Exception:pass
 alerts=dedupe_alerts(alerts)
 atomic(STATE/'alerts.json',json.dumps({'checked_at':now,'alerts':alerts},indent=2)+'\n')
 lines=['# Workflow watchdog status',f'Checked at epoch {now:.0f}.',f'Active alerts: {len(alerts)}.','This observer does not kill workers, restart sessions, or certify QC.','']
 for a in alerts:lines.append(f"- {a['state']}: {a['detail']}" if a['state'] in PLAN_ALERT_STATES else f"- {a['state']}: {a['workflow']} ({a['session']}). Inspect actual worker progress, dependencies and provider status before any restart.")
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

def cleanup_scratch(now=None):
 # Delete only folders registered for a run that is terminal for CLEANUP_GRACE_S.
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
  shutil.rmtree(real);mark('DELETED')
 if stmts:write_txn(stmts)

def response_text(value):
 if isinstance(value,str):return value
 if isinstance(value,list):return '\n'.join(response_text(v) for v in value)
 if isinstance(value,dict):return '\n'.join(response_text(v) for v in value.values())
 return ''

# ---- Stop check: planned workflows owed by the swarm plan must not be left unlaunched ----
# The plan decides the numbers (staffing.py holds the rules). A launch hook only sees what the
# model launches; only a check at Stop sees what it never launched.
QG_STATE=Path(os.environ.get('QUESTION_GATE_STATE',str(Path.home()/'.claude/hooks/question-gate/state')))
PLAN_ALERT_STATES=('STOP_OMISSION_UNRESOLVED','WORKFLOW_HANDBACK','PLAN_ARM_FAILED')

def _jload(p):
 try:d=json.loads(Path(p).read_text());return d
 except (OSError,ValueError):return None

QUESTION_SKEW_S=10

def question_only(session):
 # The question-gate writes its state for EVERY prompt, machine ones included. Only the most recent HUMAN prompt (the guard
 # records the time of each human prompt in user_prompt) may set question-only: the state must be stamped within seconds of it.
 d=_jload(QG_STATE/(re.sub(r'[^A-Za-z0-9_.-]','_',str(session or 'nosession'))+'.json'))
 if not (isinstance(d,dict) and d.get('mode')=='question'):return False
 try:
  rows=read_rows('SELECT at FROM human_prompts WHERE session=?',(str(session),));at=float(d.get('at'))
  return bool(rows) and abs(at-float(rows[0]['at']))<=QUESTION_SKEW_S
 except (TypeError,ValueError,sqlite3.Error):return False

def raise_alert(key,session,workflow,state,detail):
 # Durable (survives tick) and immediate: DB row, alerts.json and STATUS.md. Idempotent per key.
 write_txn([('INSERT OR REPLACE INTO plan_alerts(key,session,workflow,state,detail,updated) VALUES(?,?,?,?,?,?)',(key,session,workflow,state,detail,time.time()))])
 rep_=_jload(STATE/'alerts.json') or {'checked_at':time.time(),'alerts':[]}
 rep_['alerts']=[a for a in rep_.get('alerts',[]) if not (a.get('state')==state and a.get('workflow')==workflow and a.get('session')==session)]+[{'session':session,'workflow':workflow,'state':state,'detail':detail}]
 atomic(STATE/'alerts.json',json.dumps(rep_,indent=2)+'\n')
 try:old=(STATE/'STATUS.md').read_text()
 except OSError:old='# Workflow watchdog status\n'
 line='- %s: %s'%(state,detail)
 if line not in old:atomic(STATE/'STATUS.md',old.rstrip('\n')+'\n'+line+'\n')

def clear_alerts(prefix,keep=()):
 for r in read_rows('SELECT key FROM plan_alerts WHERE key LIKE ?',(prefix+'%',)):
  if r['key'] not in keep:write_txn([('DELETE FROM plan_alerts WHERE key=?',(r['key'],))])

def _rearm_launched(session):
 # A plan with an admitted (confirmed) launch of this session is armed. If its status was put back to planned-not-running by
 # something outside the tool fence (the tools themselves are refused), put it back to running before Stop reads it.
 for r in read_rows('SELECT DISTINCT plan FROM launch_tags WHERE session=?',(str(session),)):
  try:_staffing().set_running(r['plan'])
  except Exception:pass

def plan_snapshots(data,session):
 # Every plan governing this session (cwd-found, and each pinned armed unfinished plan) with its computed state.
 # Raises on journal trouble: the Stop caller turns that into a fail-closed block when a running plan is at stake.
 c=db()
 try:occupancy(c)
 finally:c.close()
 _rearm_launched(session)
 return [x for x in _staffing().snapshots(data.get('cwd') or os.getcwd(),STATE,session,reap=False) if x]

def plan_snapshot(data,session):
 try:
  r=plan_snapshots(data,session)
  return r[0] if r else None
 except Exception:return None

def stop_omission(data,session):
 # Block reason when ANY armed plan governing the session (cwd-found or pinned; several can be pinned) owes workflows that are
 # unlaunched or is invalid; the owed list is the union. None to allow.
 # Releases, the only ones: (a) the user's stop latch (checked by the caller), (b) a question-only HUMAN turn,
 # There is no count-based release: three failed launches hand the workflow back (alert), they never free the Stop.
 if question_only(session):return None
 reasons=[];snaps=plan_snapshots(data,session)
 for snap in snaps:
  r=_stop_omission_one(snap,session)
  if r:reasons.append(('[plan %s] '%snap['path'] if len(snaps)>1 else '')+r)
 return '\n'.join(reasons) if reasons else None

def _stop_omission_one(snap,session):
 if not snap['armed']:return None
 if snap['errors']:
  return 'Plan %s is armed but INVALID, so nothing can be launched against it. Fix the plan (then continue the owed work):\n  - %s'%(snap['path'],'\n  - '.join(snap['errors'][:12]))
 st=snap['state'];plan=str(snap['path'])
 hb_keys=[]
 for wid in st['handback']:
  k=plan+'|'+wid+'|HANDBACK';hb_keys.append(k)
  raise_alert(k,session,wid,'WORKFLOW_HANDBACK','Workflow %s of plan %s was launched %d times without becoming done. It is not owed; the owner must decide.'%(wid,plan,_staffing().HANDBACK_LAUNCHES))
 clear_alerts(plan+'|',hb_keys)
 owed=st['owed'];okey='owed|'+session+'|'+plan
 if not owed:
  clear_alerts(okey);return None
 clear_alerts(okey)
 return 'Owed now: %s. Launch each now with args.workflowId and its exact planned units. Do not end the turn while planned workflows are unlaunched.'%_staffing().describe_owed(st)

def stop_unavailable(data,session,err):
 # Fail closed when the enforcement machinery breaks while a plan is RUNNING (status read straight from the plan file, journal-independent):
 # the cwd-found plan, and every plan pinned to the session when the pin table is still readable. Other errors stay fail-open.
 plans=[]
 try:
  f=_staffing().find_plan(data.get('cwd') or os.getcwd())
  if f:plans.append(f[0])
 except Exception:pass
 try:plans+=[Path(r['plan']) for r in read_rows('SELECT plan FROM session_pins WHERE session=?',(session,))]
 except Exception:pass
 for p in plans:
  d=_jload(p)
  if isinstance(d,dict) and str(d.get('status') or '').lower()=='running':
   return 'guard unavailable: %s: %s. Plan %s has status running, so Stop cannot be released while the enforcement journal is unreadable. Repair the guard state (the owner) and continue the owed work.'%(type(err).__name__,err,p)
 return None

def plan_line(data,session):
 # One reminder line: each governing plan's own numbers, else the neutral ceilings.
 lim=limits();snaps=plan_snapshots(data,session);parts=[]
 for snap in snaps:
  if snap['errors']:
   parts.append('Plan %s is %s and INVALID: %s'%(snap['path'],'armed (Stop will hold)' if snap['armed'] else 'found, not started',' | '.join(snap['errors'][:6])));continue
  if not snap['armed']:
   wfs=_staffing().workflows(snap['doc'])
   if wfs and not all(_staffing().is_done(snap['path'].parent,w,snap['view']['attempts'].get(w.get('workflow_id'),()),snap['view']['records'].get(w.get('workflow_id'),())) for w in wfs):
    parts.append('Plan %s found, not started. Start the build with: python3 ~/.claude/hooks/workflow-guard/staffing.py start --cwd %s'%(snap['path'],snap['path'].parent))
   continue
  st=snap['state']
  parts.append('Plan %s: owed now: %s; running %d/%d.'%(snap['path'],_staffing().describe_owed(st) or 'none',len(st['running']),st['max_active']))
 if parts:return ' | '.join(parts)
 return "Ceilings: %d workflows / %d agents per workflow / %d agents; a plan's own numbers govern when present."%(lim['concurrent_workflows_per_program'],lim['concurrent_agents_per_workflow'],lim['concurrent_agents_total'])

def hook(data):
 event=data.get('hook_event_name','PreToolUse');tool=data.get('tool_name','');session=data.get('session_id','unknown')
 heartbeat(session)
 if event=='UserPromptSubmit':
  try:rc=user_prompt(data)
  except Exception:rc=0
  try:context(event,plan_line(data,session))
  except Exception:pass
  return rc
 if event=='PostToolUseFailure':
  # Decision 9: record a failure for every tool, not just Workflow, so the retry cap can see it.
  try:
   ti=data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {}
   write_txn([bump(session,call_fingerprint(tool,ti),tool,response_text(data.get('tool_response',{})) or 'Tool reported failure with no text.')])
  except Exception:pass
  if tool!='Workflow':return 0
 if event=='PreToolUse' and tool in ('Agent','Task'):
  b=plan_agent_block(data,session)
  if b is not None:return b
 if event=='PostToolUse' and tool=='Write' and data.get('agent_id'):
  try:record_subagent_verdict(data,tool,data.get('tool_input') if isinstance(data.get('tool_input'),dict) else {},session)
  except Exception:pass
  return 0
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
   latest=read_rows("SELECT * FROM launches WHERE session=? AND state NOT IN (?,?) ORDER BY created DESC LIMIT 1",(session,RESERVED,UNCONFIRMED))
   row=latest[0] if latest else None
  if row:
   response=json.dumps(data.get('tool_response',{})).lower()
   failed=failed or 'invalid workflow script' in response or 'iserror": true' in response
   if row['state'] in (RESERVED,UNCONFIRMED):
    # Phase two. A failed launch never became admitted: its reservation is simply dropped.
    if failed:
     try:drop_reservation(row)
     except Exception:pass
     row=None
    else:
     try:confirm_launch(row)
     except Exception as e:print('WORKFLOW GUARD WARNING: could not confirm launch %s (%s: %s)'%(row['id'],type(e).__name__,e),file=sys.stderr)
  if row:
   text=response_text(data.get('tool_response',{}))
   task=re.search(r'(?:Task ID:\s*)?\b(w[a-z0-9]{8})\b',text);run=re.search(r'(?:Run ID:\s*)?\b(wf_[A-Za-z0-9-]+)\b',text)
   resp=data.get('tool_response');tdir=resp.get('transcriptDir') if isinstance(resp,dict) else None
   if not isinstance(tdir,str) or not tdir:
    m=re.search(r'Transcript dir:\s*(\S+)',text);tdir=m.group(1) if m else None
   receipt={'response_keys':list(data.get('tool_response',{})) if isinstance(data.get('tool_response'),dict) else [],'event':event,'task_id':task.group(1) if task else None,'run_id':run.group(1) if run else None,'transcript_dir':tdir,'visibility':'UNVERIFIED'}
   write_txn([('UPDATE launches SET state=?,receipt=? WHERE id=?',('FAILED' if failed else 'RETURNED' if task and run else 'LAUNCH_UNVERIFIED',json.dumps(receipt),row['id']))])
   for found in scan_watches(row['transcript'],session,row['created'],_wf_root({'receipt':json.dumps(receipt),'transcript':row['transcript']})):
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
  try:line=plan_line(data,session)
  except Exception:line=''
  context(event,('Workflow tools need explicit model/label/declared phase. Limits read from '+str(LIMITS_FILE)+', counted running-at-once with finished and dead runs reaped; '+running+'. Use '+str(ROOT/'make-workflow.py')+' (with --plan and --workflow-id under a swarm plan). Review '+str(STATE/'STATUS.md')+' for stale-run alerts. Caps are safety guards only; keep existing authorization/cancellation boundaries.\n'+line))
  return 0
 if event in ('PreToolUse','Stop'):
  try:continued,latched=continuation_state(session)
  except Exception as e:
   if event!='Stop':raise
   un=stop_unavailable(data,session,e)
   if un:print(json.dumps({'decision':'block','reason':un}))
   return 0
  # Decision 10: while the stop latch is set the Stop hook never blocks and says nothing.
  if event=='Stop' and latched:return 0
  if event=='Stop':
   try:owed=stop_omission(data,session)
   except Exception as e:owed=stop_unavailable(data,session,e)
   if owed:print(json.dumps({'decision':'block','reason':owed}));return 0
  if not (STATE/'alerts.json').exists():return 0
  try:report=json.loads((STATE/'alerts.json').read_text())
  except (OSError,ValueError):return 0
  alerts=[a for a in report['alerts'] if a['session']==session and a.get('state') not in PLAN_ALERT_STATES]
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
 p=argparse.ArgumentParser();p.add_argument('command',choices=['hook','tick','watch','resolve','status','register','canary'],nargs='?',default='hook');p.add_argument('--session');p.add_argument('--journal');p.add_argument('--reason');p.add_argument('--run-root',dest='run_root');p.add_argument('--workflow');p.add_argument('--dir',action='append',default=[]);a=p.parse_args()
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
