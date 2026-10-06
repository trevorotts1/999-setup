#!/bin/bash
# 9router-ping-keepalive-guard.sh — keeps the 9Router Anthropic-stream keepalive applied.
#
# THE BUG (found 2026-10-03): while Codex (cx/*) reasons for 30-60+ s, the
# openai-responses -> openai -> claude translation emits no bytes. Claude Code's
# idle-stream watchdog then aborts with "API Error: The response stopped arriving".
# The only existing keepalive (failover-guard) sends an SSE *comment* (": keepalive")
# and only while a failover chain is pending; SDK parsers drop comments, so the
# watchdog never sees them.
#
# THE FIX: wrap the chat handler's export (module `P:()=>z` in the chunk that holds
# "Invalid JSON body"). For a text/event-stream reply to a /messages request, re-emit
# the body and, whenever the upstream has been silent for NINEROUTER_PING_MS (default
# 10000) AND the last forwarded byte ended an SSE event ("\n\n"), enqueue the real
# Anthropic event:  event: ping / data: {"type":"ping"}.
# Timer is cleared on end, error and cancel.
#
# Locates the chunk by CONTENT (chunk numbers change on update). Idempotent via the
# marker /*ping-keepalive-v1*/. No backup copy is made (operator order); the patched
# text is node --check'ed before the file is replaced.
#
# Modes: (none)=apply, --quiet=apply silently, --check=report only (exit 1 if missing)
# Exit: 0 = patch present, 1 = missing/could not apply.
set -uo pipefail
MODE="${1:-}"
say() { [ "$MODE" = "--quiet" ] || echo "$@" >&2; }

NODE=""
for p in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do [ -x "$p" ] && { NODE="$p"; break; }; done
[ -z "$NODE" ] && NODE="$(command -v node 2>/dev/null || true)"
CHUNKS=""
for d in "$HOME/.npm-global/lib/node_modules/9router" /opt/homebrew/lib/node_modules/9router /usr/local/lib/node_modules/9router /usr/lib/node_modules/9router "$HOME/.local/share/999/npm/lib/node_modules/9router"; do
  [ -d "$d/app/.next-cli-build/server/chunks" ] && { CHUNKS="$d/app/.next-cli-build/server/chunks"; break; }
done
[ -z "$CHUNKS" ] && { say "9router-ping: no 9router chunks dir found - NOT guarded."; exit 1; }
PY="$(command -v python3 2>/dev/null || echo /usr/bin/python3)"
export PING_MODE="$MODE" PING_NODE="$NODE"

"$PY" - "$CHUNKS" <<'PYEOF'
import glob, os, re, subprocess, sys, tempfile
chunks = sys.argv[1]; mode = os.environ.get("PING_MODE", ""); node = os.environ.get("PING_NODE", "")
def say(*a):
    if mode != "--quiet": print(*a, file=sys.stderr)
MARK = "/*ping-keepalive-v3*/"
HELPER = MARK + r'''function __pkWrap(r,q,pr){let ms=Number(process.env.NINEROUTER_PING_MS)||1e4,te=new TextEncoder,ping=te.encode('event: ping\ndata: {"type":"ping"}\n\n'),rd,tm,last=Date.now(),ok=!0,dead=!1,sse=x=>/text\/event-stream/.test(x.headers.get("content-type")||"");return new Response(new ReadableStream({start(c){let tick=()=>{if(ok&&Date.now()-last>=ms)try{c.enqueue(ping);last=Date.now()}catch{}};tm=setInterval(tick,Math.max(500,ms/4));pr&&(c.enqueue(ping),last=Date.now());let go=async x=>{try{if(!x.body||!sse(x)){if(pr){let t=(await x.text()).slice(0,500);c.enqueue(te.encode("event: error\ndata: "+JSON.stringify({type:"error",error:{type:"api_error",message:"upstream "+x.status+": "+t}})+"\n\n"))}clearInterval(tm);return c.close()}rd=x.body.getReader();for(;;){let{value:v,done:d}=await rd.read();if(d)break;if(dead)return;if(v&&v.length){let n=v.length;ok=n>=2&&v[n-1]===10&&v[n-2]===10||n>=4&&v[n-1]===10&&v[n-2]===13&&v[n-3]===10&&v[n-4]===13;last=Date.now()}c.enqueue(v)}clearInterval(tm);c.close()}catch(e){clearInterval(tm);try{c.error(e)}catch{}}};pr?pr.then(go,e=>go(new Response(String(e&&e.message||e),{status:502}))):go(r)},cancel(){dead=!0;clearInterval(tm);rd&&rd.cancel().catch(()=>{})}}),pr?{status:200,headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Access-Control-Allow-Origin":"*"}}:{status:r.status,statusText:r.statusText,headers:r.headers})}async function __pkGo(fn,a,b){let m=!1;try{m=/\/messages$/.test(new URL(a.url).pathname)&&!0===(await a.clone().json()).stream}catch{}let p=fn(a,b);if(!m)return p;let T={},h=Number(process.env.NINEROUTER_PING_HOLD_MS)||8e3,r=await Promise.race([p,new Promise(f=>setTimeout(f,h,T))]);return r===T?__pkWrap(null,a,p):r&&r.body&&/text\/event-stream/.test(r.headers.get("content-type")||"")?__pkWrap(r,a):r}'''

# upgrade from v1 (no backup exists): strip the v1 helper + wrapper and restore the export
V1 = re.compile(r'/\*ping-keepalive-v[12]\*/function __pkWrap.*?async function __pkZ\(a,b\)\{return (?:__pkWrap\(await (\w+)\(a,b\),a\)|__pkGo\((\w+),a,b\))\}', re.S)
if mode != "--check":
    for path in sorted(glob.glob(os.path.join(chunks, "*.js"))):
        if any(x in os.path.basename(path) for x in (".bak", ".pre", ".orig", ".ping-tmp")): continue
        src = open(path, encoding="utf8", errors="replace").read()
        if re.search(r"/\*ping-keepalive-v[12]\*/", src):
            m1 = V1.search(src)
            if m1:
                src = src[:m1.start()] + src[m1.end():]
                src = src.replace("P:()=>__pkZ", "P:()=>" + (m1.group(1) or m1.group(2)), 1)
                open(path + ".ping-tmp", "w", encoding="utf8").write(src); os.replace(path + ".ping-tmp", path)
                say(f"9router-ping: removed v1 from {os.path.basename(path)}, upgrading")

EXPORT = re.compile(r'c\.d\(b,\{P:\(\)=>(\w+)\}\)')
found = None; bad = []
for path in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    base = os.path.basename(path)
    if any(x in base for x in (".bak", ".pre", ".orig")): continue
    src = open(path, encoding="utf8", errors="replace").read()
    if "Invalid JSON body" not in src or "Missing model" not in src: continue
    if MARK in src:
        say(f"9router-ping: already patched ({base})."); sys.exit(0)
    m = EXPORT.search(src)
    if not m: continue
    fn = m.group(1)
    fm = re.search(r'async function ' + fn + r'\(a,b=null\)\{let c;try\{c=await a\.json\(\)\}', src)
    if not fm: continue
    found = (path, base, src, m, fn, fm); break
if not found:
    say("9router-ping: chat handler not found - 9router internals changed. NOT guarded."); sys.exit(1)
path, base, src, m, fn, fm = found
if mode == "--check":
    say(f"9router-ping: MISSING in {base} (patchable)."); sys.exit(1)
# wrapper replaces the exported getter; original handler untouched
new = src[:m.start()] + "c.d(b,{P:()=>__pkZ})" + src[m.end():fm.start()] + HELPER + "async function __pkZ(a,b){return __pkGo(" + fn + ",a,b)}" + src[fm.start():]
assert new.count(MARK) == 1
if node:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf8") as t:
        t.write(new); tmp = t.name
    r = subprocess.run([node, "--check", tmp], capture_output=True, text=True); os.unlink(tmp)
    if r.returncode: say("9router-ping: node --check FAILED, not written:", r.stderr[:300]); sys.exit(1)
else:
    say("9router-ping: node not found, cannot syntax-check - not written."); sys.exit(1)
tmp = path + ".ping-tmp"
open(tmp, "w", encoding="utf8").write(new); os.replace(tmp, path)
say(f"9router-ping: patched {base} - restart 9router for it to take effect.")
sys.exit(0)
PYEOF
