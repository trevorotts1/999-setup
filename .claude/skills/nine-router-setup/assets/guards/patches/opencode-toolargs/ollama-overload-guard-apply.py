#!/usr/bin/env python3
"""Ollama overload guard for 9Router combos. Two content-anchored edits, each in its own chunk file:
 A. combo loop (the combo module's export Pr: module 18910 up to 0.5.104, 25308 from 0.5.109), marker /*ollama-overload-guard-v1*/:
    a 200 from a non-last chain member served by provider ollama / ollama-local is buffered and checked.
    Error-shaped JSON, a JSON body that is not a message, an SSE error event, or a stream that ends
    without its finish (message_stop / finish_reason / response.completed) is discarded and the rest of
    the chain is tried by the combo loop itself. Needs failover-guard-v2 (reuses its __fgLog, extends its line).
 B. non-stream response path (module 5016, chunk 8895.js), marker /*ollama-nonstream-claude-v1*/:
    a non-streaming Ollama reply was converted to OpenAI chat.completion and never on to the client's
    format, so Claude clients got 200 "JSON but not a Message". Now it goes OpenAI -> client format.
Usage: ollama-overload-guard-apply.py [--check] [9router_root]. Idempotent: already-patched files are left alone."""
import sys, os, shutil, time, subprocess, glob
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
def __locate(mark, anchor):
    # Chunk file names are renumbered between 9router releases, so find the target by content. `anchor` is a compiled regex.
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    hit=[f for f in fs if mark in open(f,errors='ignore').read()]
    if hit: return hit[0]
    hit=[f for f in fs if anchor.search(open(f,errors='ignore').read())]
    if len(hit)!=1: print(f'{mark} target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
def __prune(pattern_prefix):
    # keep only the newest backup of this kind (Trevor: backups must not pile up)
    for o in sorted(glob.glob(pattern_prefix+'*'),key=os.path.getmtime)[:-1]: os.remove(o)

MARK_A='/*ollama-overload-guard-v1*/'
ID=r'[A-Za-z_$][\w$]*'
import re
# The combo function: 0.5.104 `async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){`,
# 0.5.109+ the same head with five more optional smart-routing parameters. Same anchor as the failover guard's.
SIG=re.compile(r'async function (?P<fn>'+ID+r')\(\{body:(?P<a>'+ID+r'),models:(?P<b>'+ID+r'),handleSingleModel:(?P<c>'+ID+r'),log:(?P<g>'+ID+r'),'
               r'comboName:'+ID+r',comboStrategy:'+ID+r',comboStickyLimit:'+ID+r'=1,autoSwitch:'+ID+r'=!0(?:,[^{}]*)?\}\)\{')
# Module scope, just before the combo function. @R@ is the module factory's webpack require (as in v2's __fgOn); @Q@ is the combo
# function's own name (__ogRun re-enters it for the rest of the chain); inside __ogRun `c` is handleSingleModel.
#  __ogOn:  true when the member resolves (router's own resolver, module 38775 mA, via @R@) to ollama or ollama-local.
#  __ogBad: reason string when a complete client-format reply is not a usable answer, else null.
#  __ogRun: buffers the reply; a bad one is logged and the remaining members go through q itself (errors,
#           cooldowns, v2, this guard on a later ollama member, all-failed reply: the loop's own logic).
#           Streaming: headers go out at once, SSE comment keepalives flow while buffering; if no later model
#           answers, the original reply is sent (never worse than unpatched). A client disconnect stops the walk.
HELPERS=MARK_A+r'''let __ogIds=new Set(["ollama","ollama-local"]);async function __ogOn(m){try{return __ogIds.has((await @R@(38775).mA(m))?.provider)}catch{return!1}}function __ogBad(t,sse){let r=e=>String(e?.message||e?.error?.message||e||"").slice(0,200);if(!sse){let j;try{j=JSON.parse(t)}catch{return"body is not JSON"}if(!j||"object"!=typeof j||Array.isArray(j))return"body is not an object";if(j.error)return"an error body: "+r(j.error);return"message"===j.type&&Array.isArray(j.content)||Array.isArray(j.choices)&&j.choices[0]?.message||"response"===j.object&&"failed"!==j.status?null:"a body that is not a message"}let end=!1;for(let v of t.split(/\r?\n\r?\n/)){let d=v.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n"),e;if(!d||"[DONE]"===d)continue;try{e=JSON.parse(d)}catch{continue}if(!e||"object"!=typeof e)continue;if(e.error||"error"===e.type||"response.failed"===e.type)return"an error event: "+r(e.error||e.response?.error);("message_stop"===e.type||"response.completed"===e.type||"response.incomplete"===e.type||Array.isArray(e.choices)&&e.choices.some(h=>h?.finish_reason))&&(end=!0)}return end?null:"a stream that ended without finishing"}async function __ogRun(a,o,i,f,c,g){let sse=(f.headers.get("content-type")||"").includes("text/event-stream"),dead=!1,rest=async t=>{let b=null==t?"a reply stream that failed":null;if(!b)try{b=__ogBad(t,sse)}catch{}if(!b||dead)return null;__fgLog(g,`ollama-overload-guard: ${o[i]} answered 200 with ${b} - discarding reply, trying next model`);let by=null,x=await @Q@({body:a,models:o.slice(i+1),handleSingleModel:(b,m)=>(by=m,c(b,m)),log:g,comboName:"ollama-overload-guard",comboStrategy:"fallback",autoSwitch:!1});return __fgLog(g,x.ok?`ollama-overload-guard: retry served by ${by}`:`ollama-overload-guard: no later model answered (status ${x.status})`+(sse?" - returning the original reply":"")),x};if(!sse){let t=null;try{t=await f.text()}catch{}let x=await rest(t);return x||new Response(t,{status:f.status,statusText:f.statusText,headers:f.headers})}let n=new TextEncoder,tm,rd;return new Response(new ReadableStream({start(l){tm=setInterval(()=>{try{l.enqueue(n.encode(": keepalive\n\n"))}catch{}},Number(process.env.NINEROUTER_FG_KEEPALIVE_MS)||15e3),(async()=>{let t=null,x=null;try{t=await f.text()}catch{}try{x=await rest(t)}catch{}if(clearInterval(tm),dead)return void x?.body?.cancel().catch(()=>{});try{if(!x?.ok)return x?.body?.cancel().catch(()=>{}),null!=t&&l.enqueue(n.encode(t)),l.close();for(rd=x.body.getReader();;){let{value:v,done:d}=await rd.read();if(d)break;l.enqueue(v)}l.close()}catch(e){try{l.error(e)}catch{}}})()},cancel(){dead=!0,clearInterval(tm),rd?.cancel().catch(()=>{})}}),{status:f.status,statusText:f.statusText,headers:f.headers})}'''
# Short local identifiers are renamed between 9Router builds (0.5.104 renamed the combo loop's reply variable), so the
# v2 hook is matched by shape with the body, handler, log, reply and models variables captured; the edit rewrites it into a nested
# ternary. 0.5.109+ has the hook twice (the plain reply and the reply committed after the stream peek, `A.response`), 0.5.104 once;
# every copy is rewritten. The body/handler/log may be the function's own parameters (0.5.104 form) or the loop-head copies
# __fgb/__fgc/__fgl (0.5.109 form): whichever v2 wrote is carried over.
RE_V2=re.compile(r'(?P<pre>__fgi<(?P<o>'+ID+r')\.length-1&&__fgTools\((?P<a>'+ID+r')\)&&await __fgOn\((?P<e>'+ID+r')\)\?await __fgRun\((?P=a),(?P=o),__fgi,(?P<r>'+ID+r'(?:\.response)?),(?P<c>'+ID+r'),(?P<g>'+ID+r')\):)(?P=r)(?![\w$])')
def __helpers_a(s,F):
    """HELPERS for the combo function in s: its module's webpack require and its own name filled in."""
    sg=SIG.search(s)
    hdr=[h for h in re.finditer(r'(?<![\w$])\d+:\(('+ID+r'),('+ID+r'),('+ID+r')\)=>\{',s[:sg.start()])]
    if not hdr: print(f'{os.path.basename(F)}: combo module factory header not found - bundle changed, not patching'); sys.exit(2)
    R_,Q_=hdr[-1].group(3),sg['fn']
    # the helpers' own parameters and locals must not shadow the two names they borrow from module scope
    if R_ in ('m',) or Q_ in set('aoifcgbmxtnlvde')|{'by','tm','rd','sse','dead','rest'}: print(f'{os.path.basename(F)}: module require ({R_}) or combo function ({Q_}) would be shadowed by the helpers - bundle changed, not patching'); sys.exit(2)
    return HELPERS.replace('@R@',R_).replace('@Q@',Q_)
EDITS_A=[(SIG,lambda m:m.group(0)),(RE_V2,lambda m:m['pre']+f'__fgi<{m["o"]}.length-1&&await __ogOn({m["e"]})?await __ogRun({m["a"]},{m["o"]},__fgi,{m["r"]},{m["c"]},{m["g"]}):{m["r"]}')]

MARK_B='/*ollama-nonstream-claude-v1*/'
# The non-stream translator is an anonymous function expression; naming it lets the ollama branch recurse
# OpenAI -> client format through the router's own OPENAI->CLAUDE / OPENAI->RESPONSES branches.
# Located by the inner, rename-proof text: every module alias and local name is captured (0.5.91 renamed the
# handler's locals L,t,s,F / N -> M,u,t,G / O; 0.5.104 changed the surrounding module aliases again).
NS_HEAD=re.compile(r'let [A-Za-z_$][\w$]*=\(0,'+ID+r'\.'+ID+r'\)\('+ID+r','+ID+r'\)\?function\(a,b,c,e=null\)\{if\(b===c\)return a;')
NS_TAIL=re.compile(r'return b===(?P<E>'+ID+r'\.'+ID+r')\.OLLAMA\?\(0,(?P<G>'+ID+r'\.'+ID+r')\)\(a\):a\}\((?P<args>'+ID+r','+ID+r','+ID+r','+ID+r')\):(?P<L>'+ID+r')(?![\w$])')
def __ns_tail(m):
    E,G=m['E'],m['G']
    return MARK_B+f'return b==={E}.OLLAMA?(c==={E}.OPENAI?(0,{G})(a):__ogNs((0,{G})(a),{E}.OPENAI,c,e)):a}}({m["args"]}):{m["L"]}'
EDITS_B=[(NS_HEAD,lambda m:m.group(0).replace('function(a,b,c','function __ogNs(a,b,c')),(NS_TAIL,__ns_tail)]
def __count(s,old): return len(list(old.finditer(s))) if hasattr(old,'finditer') else s.count(old)
def __apply(s,old,new):
    if old is RE_V2: return old.sub(new,s)   # every copy of the v2 hook
    if hasattr(old,'sub'): return old.sub(new,s,count=1)
    return s.replace(old,new,1)

def __locate_b():
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    txt={f:open(f,errors='ignore').read() for f in fs}
    hit=[f for f in fs if MARK_B in txt[f]]
    if hit: return hit[0]
    hit=[f for f in fs if NS_TAIL.search(txt[f])]
    if len(hit)!=1: print(f'{MARK_B} target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]

plan=[]
for mark,edits,need in ((MARK_A,EDITS_A,'/*failover-guard-v2*/'),(MARK_B,EDITS_B,None)):
    F=__locate(mark,SIG) if mark==MARK_A else __locate_b(); s=open(F).read()
    if mark in s: print('already patched:',F); continue
    if need and need not in s:
        if not CHECK: print(f'{os.path.basename(F)} lacks {need} - run failover-guard-apply.py first'); sys.exit(2)
        edits=edits[:1]   # --check on a fresh bundle: the loop anchor only exists once v2 is in
    for i,(old,new) in enumerate(edits,1):
        n=__count(s,old)
        if n!=1 and not (old is RE_V2 and n==2): print(f'{mark} ANCHOR {i} matched {n} times (need 1, or 2 for the v2 hook) - bundle changed, not patching'); sys.exit(2)
    plan.append((F,s,edits))
if CHECK: plan and print(f'{len(plan)} file(s) would be patched, all anchors unique; --check only, nothing written'); sys.exit(0)
stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
for F,s,edits in plan:
    bak=F+'.bak-pre-ollamaguard-'+stamp
    shutil.copy2(F,bak)
    for old,new in edits:
        if old is SIG: hl=__helpers_a(s,F); s=SIG.sub(lambda m:hl+m.group(0),s,count=1)   # last-in-file order is irrelevant: the loop regexes skip HELPERS
        else: s=__apply(s,old,new)
    open(F,'w').write(s)
    r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
    if r.returncode!=0:
        shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
    __prune(F+'.bak-pre-ollamaguard-')
    print('patched',F,'\nbackup',bak)
