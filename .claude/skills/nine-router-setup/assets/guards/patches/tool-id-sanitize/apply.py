#!/usr/bin/env python3
"""Tool-call id sanitizer for 9Router (module 79489, chat handler y, chunk 8635.js).
Kimi K3 (nvidia/moonshotai/kimi-k3) emits tool ids like "Bash:0". Anthropic rejects any
tool_use.id / tool_use_id outside ^[a-zA-Z0-9_-]+$ with HTTP 400, so a session that ever
used Kimi 400s forever once it is routed to a Claude model. This rewrites every bad id in the
request body (Claude tool_use/tool_result, OpenAI tool_calls/tool_call_id) to a stable,
collision-free safe id before routing. Valid ids are untouched.
Usage: apply.py [--check] [9router_root]. Idempotent. Content-anchored."""
import sys, os, shutil, time, subprocess, glob
args=[a for a in sys.argv[1:] if not a.startswith('--')]; CHECK='--check' in sys.argv
ROOT=args[0] if args else os.path.expanduser('~/.npm-global/lib/node_modules/9router')
MARK='/*tool-id-sanitize-v1*/'
CHUNKS=os.path.join(ROOT,'app/.next-cli-build/server/chunks')
ANCHOR='async function y(a,b=null){let c;try{c=await a.json()}catch{return t.warn("CHAT","Invalid JSON body"),(0,n.yj)(r.gx.BAD_REQUEST,"Invalid JSON body")}'
# 0.5.91 renamed the handler and its imports (y,t,n,r -> z,u,n,s); same code. Accept any local names.
import re
ANCHOR_RE=re.compile(r'async function [A-Za-z_$][\w$]*\(a,b=null\)\{let c;try\{c=await a\.json\(\)\}catch\{return [A-Za-z_$][\w$]*\.warn\("CHAT","Invalid JSON body"\),\(0,[A-Za-z_$][\w$]*\.yj\)\([A-Za-z_$][\w$]*\.gx\.BAD_REQUEST,"Invalid JSON body"\)\}')
def __anchor(t):
    if ANCHOR in t: return ANCHOR
    m=ANCHOR_RE.findall(t); return m[0] if len(m)==1 else None
fs=[os.path.join(CHUNKS,f) for f in sorted(os.listdir(CHUNKS)) if f.endswith('.js')]
hit=[f for f in fs if MARK in open(f,errors='ignore').read()] or [f for f in fs if __anchor(open(f,errors='ignore').read())]
if len(hit)!=1: print(f'target code found in {len(hit)} chunk files (need 1) - bundle changed, not patching'); sys.exit(2)
F=hit[0]; s=open(F).read()
if MARK in s: print('already patched:',F); sys.exit(0)
ANCHOR=__anchor(s)
if s.count(ANCHOR)!=1: print('ANCHOR matched',s.count(ANCHOR),'times (need 1) - not patching'); sys.exit(2)
# __tidFix: bad id -> "t" + id with unsafe chars as "_" + "_" + 8-hex FNV-1a of the original.
# Same input always gives same output, so tool_use and its tool_result stay paired.
HELPER=MARK+r'''function __tidFix(v){if("string"!=typeof v||/^[a-zA-Z0-9_-]+$/.test(v))return v;let h=2166136261;for(let i=0;i<v.length;i++)h=Math.imul(h^v.charCodeAt(i),16777619)>>>0;return"t"+v.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,48)+"_"+h.toString(16).padStart(8,"0")}function __tidScrub(c){try{let m=c&&Array.isArray(c.messages)?c.messages:null;if(!m)return;for(let x of m){if(!x||"object"!=typeof x)continue;x.tool_call_id&&(x.tool_call_id=__tidFix(x.tool_call_id));if(Array.isArray(x.tool_calls))for(let k of x.tool_calls)k&&k.id&&(k.id=__tidFix(k.id));if(Array.isArray(x.content))for(let b of x.content)b&&"object"==typeof b&&(("tool_use"===b.type||"server_tool_use"===b.type)&&b.id&&(b.id=__tidFix(b.id)),b.tool_use_id&&(b.tool_use_id=__tidFix(b.tool_use_id)))}}catch{}}'''
NEW=HELPER+ANCHOR+'__tidScrub(c);'
if CHECK: print('anchor unique; --check only, nothing written'); sys.exit(0)
bak=F+'.bak-pre-toolidsanitize-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
shutil.copy2(F,bak)
open(F,'w').write(s.replace(ANCHOR,NEW,1))
NODE=next((p for p in ('/opt/homebrew/bin/node','/usr/local/bin/node',shutil.which('node') or '') if p and os.access(p,os.X_OK)),'node')
r=subprocess.run([NODE,'--check',F],capture_output=True,text=True)
if r.returncode!=0: shutil.copy2(bak,F); print('SYNTAX FAIL - restored original from',bak,'\n',r.stderr[:500]); sys.exit(3)
for o in sorted(glob.glob(F+'.bak-pre-toolidsanitize-*'),key=os.path.getmtime)[:-1]: os.remove(o)
print('patched',F,'\nbackup',bak)
