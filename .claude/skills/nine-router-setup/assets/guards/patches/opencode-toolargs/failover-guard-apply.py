#!/usr/bin/env python3
"""Failover guard for 9Router combos (module 18910, function Pr, chunk 8910.js).
A combo member that answers 200 with a tool call missing required arguments (e.g. Bash input {})
is treated as a failure: its reply is discarded and the same request goes to the next model.
Content-anchored; each anchor must be unique.
Usage: failover-guard-apply.py [--check] [9router_root]. Idempotent: already-patched files are left alone."""
import sys, os, shutil, time, subprocess
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
MARK='/*failover-guard-v2*/'
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
def __locate(mark, anchor):
    # Chunk file names are renumbered between 9router releases, so find the target by content.
    fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
    hit=[f for f in fs if mark in open(f,errors='ignore').read()]
    if hit: return hit[0]
    hit=[f for f in fs if anchor in open(f,errors='ignore').read()]
    if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
    return hit[0]
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
def __prune(pattern_prefix):
    # keep only the newest backup of this kind (Trevor: backups must not pile up)
    import glob
    old=sorted(glob.glob(pattern_prefix+'*'),key=os.path.getmtime)[:-1]
    for o in old: os.remove(o)
F=__locate(MARK,'async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){')
s=open(F).read()
if MARK in s: print('already patched:',F); sys.exit(0)
if '/*failover-guard-v' in s: print('an older failover guard is in',F,'- restore its .bak-pre-failoverguard-* original first'); sys.exit(2)

# Helpers, injected at module scope just before Pr (q). Only requests carrying `tools` are touched,
# only for a model that is not the last in the chain, and only when that chain member is served by
# provider id opencode (oc/) or opencode-zen (ocz/). Every other provider streams exactly as unpatched.
#  __fgOn:    resolves the member with the router's own resolver (module 38775 mA, the one the chat
#             handler uses), via the module-scope webpack require `c`; true only for those two ids.
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
HELPERS=MARK+r'''function __fgTools(a){let t=a&&Array.isArray(a.tools)?a.tools:null;if(!t||!t.length)return null;let m=new Map;for(let x of t){let n=x?.name||x?.function?.name,s=x?.input_schema||x?.parameters||x?.function?.parameters;n&&m.set(n,Array.isArray(s?.required)?s.required:[])}return m.size?m:null}function __fgCalls(t){let r=[],by=new Map,g=(k,n)=>{let c=by.get(k);return c||(c={name:"",json:""},by.set(k,c),r.push(c)),n&&!c.name&&(c.name=n),c},j=null;try{j=JSON.parse(t)}catch{}if(j&&"object"==typeof j){for(let b of Array.isArray(j.content)?j.content:[])"tool_use"===b?.type&&r.push({name:b.name,json:"",init:b.input});for(let h of Array.isArray(j.choices)?j.choices:[])for(let c of h?.message?.tool_calls||[])r.push({name:c?.function?.name,json:c?.function?.arguments??""});for(let o of Array.isArray(j.output)?j.output:[])"function_call"===o?.type&&r.push({name:o.name,json:o.arguments??""});return r}for(let v of t.split(/\r?\n\r?\n/)){let d=v.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n"),e;if(!d||"[DONE]"===d)continue;try{e=JSON.parse(d)}catch{continue}if(!e||"object"!=typeof e)continue;if("content_block_start"===e.type&&"tool_use"===e.content_block?.type)g("c"+e.index,e.content_block.name).init=e.content_block.input;else if("content_block_delta"===e.type&&"input_json_delta"===e.delta?.type)g("c"+e.index).json+=e.delta.partial_json||"";else if(Array.isArray(e.choices)){for(let h of e.choices)for(let c of h?.delta?.tool_calls||[])g("o"+(c.index??0),c.function?.name).json+=c.function?.arguments||""}else if(("response.output_item.added"===e.type||"response.output_item.done"===e.type)&&"function_call"===e.item?.type){let c=g("r"+e.item.id,e.item.name);e.item.arguments&&(c.done=e.item.arguments)}else"response.function_call_arguments.delta"===e.type?g("r"+e.item_id).json+=e.delta||"":"response.function_call_arguments.done"===e.type&&e.arguments&&(g("r"+e.item_id).done=e.arguments)}return r}function __fgBad(t,m){for(let c of __fgCalls(t)){let s=c.done??c.json,a;if(s)try{a=JSON.parse(s)}catch{return{tool:c.name,reason:"unparseable arguments"}}else a=c.init??{};if(!a||"object"!=typeof a||Array.isArray(a))return{tool:c.name,reason:"arguments not an object"};let q=m.get(c.name);if(!q)continue;let x=q.filter(k=>null==a[k]);if(x.length)return{tool:c.name,reason:(Object.keys(a).length?"missing required ":"empty arguments, missing required ")+x.join(",")}}return null}function __fgLog(g,t){g.warn("COMBO",t);try{process.getBuiltinModule("fs").appendFileSync(process.env.NINEROUTER_FG_LOG||process.getBuiltinModule("os").homedir()+"/.9router/logs/failover-guard.log",new Date().toISOString()+" "+t+"\n")}catch{}}let __fgIds=new Set(["opencode","opencode-zen"]);async function __fgOn(m){try{return __fgIds.has((await c(38775).mA(m))?.provider)}catch{return!1}}async function __fgRun(a,o,i,f,c,g){let m=__fgTools(a),dead=!1,chain=async()=>{let r=f,k=i,fb=null;for(;;){if(k>=o.length-1||k>i&&!await __fgOn(o[k]))return fb&&__fgLog(g,`failover-guard: retry served by ${o[k]} (not validated: last in chain or not opencode)`),{res:r};let t=null,b=null;try{t=await r.text()}catch(e){g.warn("COMBO",`failover-guard: ${o[k]} reply stream failed, trying next`,{error:e?.message||String(e)})}if(null!=t){try{b=__fgBad(t,m)}catch{}if(!b)return fb&&__fgLog(g,`failover-guard: retry served by ${o[k]}`),{res:r,text:t};__fgLog(g,`failover-guard: ${o[k]} returned tool "${b.tool}" with ${b.reason} - discarding reply, trying next model`),fb||(fb={res:r,text:t})}for(r=null;!r&&!dead&&++k<o.length;){g.info("COMBO",`Trying model ${k+1}/${o.length}: ${o[k]}`);try{let x=await c(a,o[k]);if(x.ok)r=x;else{g.warn("COMBO",`failover-guard: ${o[k]} failed, trying next`,{status:x.status});try{await x.body?.cancel()}catch{}}}catch(e){g.warn("COMBO",`failover-guard: ${o[k]} threw, trying next`,{error:e?.message||String(e)})}}if(!r)return dead||__fgLog(g,"failover-guard: no later model answered - returning the original reply"),fb}};if(!(f.headers.get("content-type")||"").includes("text/event-stream")){let x=await chain();return x?null==x.text?x.res:new Response(x.text,{status:x.res.status,statusText:x.res.statusText,headers:x.res.headers}):f}let n=new TextEncoder,tm,rd;return new Response(new ReadableStream({start(l){tm=setInterval(()=>{try{l.enqueue(n.encode(": keepalive\n\n"))}catch{}},Number(process.env.NINEROUTER_FG_KEEPALIVE_MS)||15e3),(async()=>{let x=await chain();if(clearInterval(tm),dead)return;try{if(!x)return l.close();if(null!=x.text)return l.enqueue(n.encode(x.text)),l.close();for(rd=x.res.body.getReader();;){let{value:v,done:d}=await rd.read();if(d)break;l.enqueue(v)}l.close()}catch(e){try{l.error(e)}catch{}}})()},cancel(){dead=!0,clearInterval(tm),rd?.cancel().catch(()=>{})}}),{status:f.status,statusText:f.statusText,headers:f.headers})}'''

E=[]
# 1. inject helpers at module scope, right before Pr.
E.append(('async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){',
 HELPERS+'async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){'))
# 2. on a 200 from a non-last opencode/opencode-zen member of a tools request, validate before returning (index captured
#    because the inner `let b` shadows the loop counter).
E.append(('for(let b=0;b<o.length;b++){let e=o[b];g.info("COMBO",`Trying model ${b+1}/${o.length}: ${e}`);try{let b=await c(a,e);if(b.ok)return g.info("COMBO",`Model ${e} succeeded`),b;',
 'for(let b=0;b<o.length;b++){let e=o[b],__fgi=b;g.info("COMBO",`Trying model ${b+1}/${o.length}: ${e}`);try{let b=await c(a,e);if(b.ok)return g.info("COMBO",`Model ${e} succeeded`),__fgi<o.length-1&&__fgTools(a)&&await __fgOn(e)?await __fgRun(a,o,__fgi,b,c,g):b;'))
for i,(old,new) in enumerate(E,1):
    n=s.count(old)
    if n!=1: print(f'ANCHOR {i} matched {n} times (need 1) - bundle changed, not patching'); sys.exit(2)
if CHECK: print(f'all {len(E)} anchors unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-failoverguard-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
for old,new in E: s=s.replace(old,new,1)
open(F,'w').write(s)
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0:
    shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
__prune(F+'.bak-pre-failoverguard-')
print('patched',F,'\nbackup',bak)
