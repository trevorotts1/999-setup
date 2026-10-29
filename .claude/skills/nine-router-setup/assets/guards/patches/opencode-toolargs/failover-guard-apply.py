#!/usr/bin/env python3
"""Failover guard for 9Router combos (the combo module's export Pr: module 18910 up to 0.5.104, 25308 from 0.5.109).
A combo member that answers 200 with a tool call missing required arguments (e.g. Bash input {})
is treated as a failure: its reply is discarded and the same request goes to the next model.
Content-anchored (shapes, not names: the minified locals change between builds); each anchor must be unique.
Usage: failover-guard-apply.py [--check] [9router_root]. Idempotent: already-patched files are left alone."""
import sys, os, shutil, time, subprocess
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
MARK='/*failover-guard-v2*/'
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
def __locate(mark, anchor):
    # Chunk file names are renumbered between 9router releases, so find the target by content. `anchor` is a compiled regex.
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    hit=[f for f in fs if mark in open(f,errors='ignore').read()]
    if hit: return hit[0]
    hit=[f for f in fs if anchor.search(open(f,errors='ignore').read())]
    if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
def __prune(pattern_prefix):
    # keep only the newest backup of this kind (Trevor: backups must not pile up)
    import glob
    old=sorted(glob.glob(pattern_prefix+'*'),key=os.path.getmtime)[:-1]
    for o in old: os.remove(o)
# The combo function: 0.5.104 `async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){`,
# 0.5.109+ the same head with five more optional smart-routing parameters after autoSwitch. Body, handler and log names are captured.
ID=r'[A-Za-z_$][\w$]*'
import re
SIG_RX=re.compile(r'async function (?P<fn>'+ID+r')\(\{body:(?P<a>'+ID+r'),models:(?P<b>'+ID+r'),handleSingleModel:(?P<c>'+ID+r'),log:(?P<g>'+ID+r'),'
                  r'comboName:'+ID+r',comboStrategy:'+ID+r',comboStickyLimit:'+ID+r'=1,autoSwitch:'+ID+r'=!0(?:,[^{}]*)?\}\)\{')
F=__locate(MARK,SIG_RX)
s=open(F).read()
if MARK in s: print('already patched:',F); sys.exit(0)
if '/*failover-guard-v' in s: print('an older failover guard is in',F,'- restore its .bak-pre-failoverguard-* original first'); sys.exit(2)

# Helpers, injected at module scope just before Pr (q). Only requests carrying `tools` are touched,
# only for a model that is not the last in the chain, and only when that chain member is served by
# provider id opencode (oc/) or opencode-zen (ocz/). Every other provider streams exactly as unpatched.
#  __fgOn:    resolves the member with the router's own resolver (module 38775 mA, the one the chat
#             handler uses), via the module factory's own webpack require (its 3rd parameter); true only for those two ids.
#  __fgTools: tool name -> required keys, from Claude (input_schema), OpenAI chat (function.parameters)
#             or Responses (parameters) tool lists.
#  __fgBad:   reads a complete client-format reply (Claude/OpenAI/Responses, SSE or JSON) and returns
#             {tool,reason} for the first tool call with unparseable/non-object args or missing required keys.
#  __fgLog:   console warn (which cli.js only keeps in a crash buffer) plus an append to
#             ~/.9router/logs/failover-guard.log, the audit trail.
#  __fgRun:   buffers the reply, validates, walks the rest of the chain on a bad one. The last model and
#             any non-opencode member are passed through live and unvalidated; if no later model answers, the original reply is returned
#             (never worse than unpatched). Streaming: headers go out at once and SSE comment keepalives
#             flow while buffering, so clients do not time out; a client disconnect stops the walk.
HELPERS=MARK+r'''function __fgTools(a){let t=a&&Array.isArray(a.tools)?a.tools:null;if(!t||!t.length)return null;let m=new Map;for(let x of t){let n=x?.name||x?.function?.name,s=x?.input_schema||x?.parameters||x?.function?.parameters;n&&m.set(n,Array.isArray(s?.required)?s.required:[])}return m.size?m:null}function __fgCalls(t){let r=[],by=new Map,g=(k,n)=>{let c=by.get(k);return c||(c={name:"",json:""},by.set(k,c),r.push(c)),n&&!c.name&&(c.name=n),c},j=null;try{j=JSON.parse(t)}catch{}if(j&&"object"==typeof j){for(let b of Array.isArray(j.content)?j.content:[])"tool_use"===b?.type&&r.push({name:b.name,json:"",init:b.input});for(let h of Array.isArray(j.choices)?j.choices:[])for(let c of h?.message?.tool_calls||[])r.push({name:c?.function?.name,json:c?.function?.arguments??""});for(let o of Array.isArray(j.output)?j.output:[])"function_call"===o?.type&&r.push({name:o.name,json:o.arguments??""});return r}for(let v of t.split(/\r?\n\r?\n/)){let d=v.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n"),e;if(!d||"[DONE]"===d)continue;try{e=JSON.parse(d)}catch{continue}if(!e||"object"!=typeof e)continue;if("content_block_start"===e.type&&"tool_use"===e.content_block?.type)g("c"+e.index,e.content_block.name).init=e.content_block.input;else if("content_block_delta"===e.type&&"input_json_delta"===e.delta?.type)g("c"+e.index).json+=e.delta.partial_json||"";else if(Array.isArray(e.choices)){for(let h of e.choices)for(let c of h?.delta?.tool_calls||[])g("o"+(c.index??0),c.function?.name).json+=c.function?.arguments||""}else if(("response.output_item.added"===e.type||"response.output_item.done"===e.type)&&"function_call"===e.item?.type){let c=g("r"+e.item.id,e.item.name);e.item.arguments&&(c.done=e.item.arguments)}else"response.function_call_arguments.delta"===e.type?g("r"+e.item_id).json+=e.delta||"":"response.function_call_arguments.done"===e.type&&e.arguments&&(g("r"+e.item_id).done=e.arguments)}return r}function __fgBad(t,m){for(let c of __fgCalls(t)){let s=c.done??c.json,a;if(s)try{a=JSON.parse(s)}catch{return{tool:c.name,reason:"unparseable arguments"}}else a=c.init??{};if(!a||"object"!=typeof a||Array.isArray(a))return{tool:c.name,reason:"arguments not an object"};let q=m.get(c.name);if(!q)continue;let x=q.filter(k=>null==a[k]);if(x.length)return{tool:c.name,reason:(Object.keys(a).length?"missing required ":"empty arguments, missing required ")+x.join(",")}}return null}function __fgLog(g,t){g.warn("COMBO",t);try{process.getBuiltinModule("fs").appendFileSync(process.env.NINEROUTER_FG_LOG||process.getBuiltinModule("os").homedir()+"/.9router/logs/failover-guard.log",new Date().toISOString()+" "+t+"\n")}catch{}}let __fgIds=new Set(["opencode","opencode-zen"]);async function __fgOn(m){try{return __fgIds.has((await @R@(38775).mA(m))?.provider)}catch{return!1}}async function __fgRun(a,o,i,f,c,g){let m=__fgTools(a),dead=!1,chain=async()=>{let r=f,k=i,fb=null;for(;;){if(k>=o.length-1||k>i&&!await __fgOn(o[k]))return fb&&__fgLog(g,`failover-guard: retry served by ${o[k]} (not validated: last in chain or not opencode)`),{res:r};let t=null,b=null;try{t=await r.text()}catch(e){g.warn("COMBO",`failover-guard: ${o[k]} reply stream failed, trying next`,{error:e?.message||String(e)})}if(null!=t){try{b=__fgBad(t,m)}catch{}if(!b)return fb&&__fgLog(g,`failover-guard: retry served by ${o[k]}`),{res:r,text:t};__fgLog(g,`failover-guard: ${o[k]} returned tool "${b.tool}" with ${b.reason} - discarding reply, trying next model`),fb||(fb={res:r,text:t})}for(r=null;!r&&!dead&&++k<o.length;){g.info("COMBO",`Trying model ${k+1}/${o.length}: ${o[k]}`);try{let x=await c(a,o[k]);if(x.ok)r=x;else{g.warn("COMBO",`failover-guard: ${o[k]} failed, trying next`,{status:x.status});try{await x.body?.cancel()}catch{}}}catch(e){g.warn("COMBO",`failover-guard: ${o[k]} threw, trying next`,{error:e?.message||String(e)})}}if(!r)return dead||__fgLog(g,"failover-guard: no later model answered - returning the original reply"),fb}};if(!(f.headers.get("content-type")||"").includes("text/event-stream")){let x=await chain();return x?null==x.text?x.res:new Response(x.text,{status:x.res.status,statusText:x.res.statusText,headers:x.res.headers}):f}let n=new TextEncoder,tm,rd;return new Response(new ReadableStream({start(l){tm=setInterval(()=>{try{l.enqueue(n.encode(": keepalive\n\n"))}catch{}},Number(process.env.NINEROUTER_FG_KEEPALIVE_MS)||15e3),(async()=>{let x=await chain();if(clearInterval(tm),dead)return;try{if(!x)return l.close();if(null!=x.text)return l.enqueue(n.encode(x.text)),l.close();for(rd=x.res.body.getReader();;){let{value:v,done:d}=await rd.read();if(d)break;l.enqueue(v)}l.close()}catch(e){try{l.error(e)}catch{}}})()},cancel(){dead=!0,clearInterval(tm),rd?.cancel().catch(()=>{})}}),{status:f.status,statusText:f.statusText,headers:f.headers})}'''

# Short local identifiers are renamed between 9Router builds (0.5.104 renamed the reply variable b->f and wrapped the success return in a
# block; 0.5.109 rewrote the combo loop around a stream peek), so the loop anchors are content signatures with the identifiers captured, not
# fixed strings. Every anchor must still match exactly once, else exit 2.
# 1. inject helpers at module scope, right before the combo function.
# 2. on a 200 from a non-last opencode/opencode-zen member of a tools request, validate before returning (index captured
#    because an inner `let b` shadows the loop counter):
#    2a. loop head: `for(let I=0;I<O.length;I++){let E=O[I];` -> also remember the index, and the request body, the member handler
#        and the log in locals of their own: from 0.5.109 the success path sits inside `if(f.ok){let a=...;let c=...}` whose own
#        `a`/`c` shadow the function's body and handler parameters (a `c` there would also be in its temporal dead zone).
#    2b. success returns: `return L.info("COMBO",`Model ${E} succeeded`),R` -> validate R first. 0.5.109+ has two: the plain
#        reply (above) and the one committed after the stream peek, `...succeeded${A.timedOut?...}`),A.response`.
RE_HEAD=re.compile(r'for\(let (?P<i>'+ID+r')=0;(?P=i)<(?P<o>'+ID+r')\.length;(?P=i)\+\+\)\{let (?P<e>'+ID+r')=(?P=o)\[(?P=i)\];')
sig=SIG_RX.search(s)
if len(SIG_RX.findall(s))!=1: print(f'ANCHOR 1 matched {len(SIG_RX.findall(s))} times (need 1) - bundle changed, not patching'); sys.exit(2)
A_,C_,G_=sig['a'],sig['c'],sig['g']
heads=RE_HEAD.findall(s)
if len(heads)!=1: print(f'ANCHOR 2a (combo loop head) matched {len(heads)} times (need 1) - bundle changed, not patching'); sys.exit(2)
m=RE_HEAD.search(s); I,O,Ee=m['i'],m['o'],m['e']
RE_RET=re.compile(r'return (?P<l>'+ID+r')\.info\("COMBO",`Model \$\{'+re.escape(Ee)+r'\} succeeded`\),(?P<r>'+ID+r')(?=[;}])')
RE_RET_PEEK=re.compile(r'return (?P<l>'+ID+r')\.info\("COMBO",`Model \$\{'+re.escape(Ee)+r'\} succeeded\$\{'+ID+r'\.timedOut\?" \(peek deadline; committed\)":""\}`\),(?P<r>'+ID+r'\.response)(?=[;}])')
rets,peeks=RE_RET.findall(s),RE_RET_PEEK.findall(s)
if len(rets)!=1 or len(peeks)>1: print(f'ANCHOR 2b (combo success return) matched {len(rets)} + {len(peeks)} times (need 1 + 0/1) - bundle changed, not patching'); sys.exit(2)
# Webpack require of the module that holds the router's own model resolver (38775, export mA): the guard asks it which provider serves
# a chain member. If it is not there, __fgOn would swallow the error and the guard would silently never fire, so refuse instead.
RE_RESOLVER=re.compile(r'(?<![\w$])38775:\('+ID+r','+ID+r','+ID+r'\)=>\{[^\n]{0,120}?\bmA:\(\)=>')
if not any(RE_RESOLVER.search(open(os.path.join(CHUNKS,f),errors='ignore').read()) for f in os.listdir(CHUNKS) if f.endswith('.js')):
    print('model resolver module 38775 (export mA) not found in any chunk - bundle changed, not patching'); sys.exit(2)
hdr=[h for h in re.finditer(r'(?<![\w$])\d+:\(('+ID+r'),('+ID+r'),('+ID+r')\)=>\{',s[:sig.start()])]
if not hdr: print('combo module factory header not found - bundle changed, not patching'); sys.exit(2)
REQ=hdr[-1].group(3)
if REQ=='m': print('module require is named m, which __fgOn(m) would shadow - bundle changed, not patching'); sys.exit(2)
if CHECK: print('all anchors unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-failoverguard-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
def __hook(m):
    # keep everything up to the reply expression, then validate it first
    cut=m.start('r')-m.start()
    return m.group(0)[:cut]+f'__fgi<{O}.length-1&&__fgTools(__fgb)&&await __fgOn({Ee})?await __fgRun(__fgb,{O},__fgi,{m["r"]},__fgc,__fgl):{m["r"]}'
s=RE_HEAD.sub(lambda m:m.group(0)[:-1]+f',__fgi={I},__fgb={A_},__fgc={C_},__fgl={G_};',s,count=1)
s=RE_RET.sub(__hook,s,count=1)
s=RE_RET_PEEK.sub(__hook,s,count=1)
s=s[:sig.start()]+HELPERS.replace('@R@',REQ)+s[sig.start():]   # last: the helpers must not be seen by the loop regexes
open(F,'w').write(s)
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0:
    shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
__prune(F+'.bak-pre-failoverguard-')
print('patched',F,'\nbackup',bak)
