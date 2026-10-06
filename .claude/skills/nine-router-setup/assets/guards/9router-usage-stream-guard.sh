#!/bin/bash
# 9router-usage-stream-guard.sh — stops the dashboard usage stream from freezing 9Router.
# While /dashboard/usage is open it holds GET /api/usage/stream, and on EVERY request-completion
# `update` event that route re-ran the full usage-stats query (a synchronous SQLite scan of the last
# days of usageHistory) on the single event-loop thread. On a busy box that is 100% of the main
# thread: /api/health times out, the watchdog kickstarts, claude-nine gets ECONNREFUSED. Patch: the
# stats query result is cached process-wide for 60s (the scan blocks ~2.5s on a 1M-row table, so 10s was still a 25% duty cycle) and in-flight calls are coalesced; a stream that
# was served a cached result schedules one trailing refresh so totals still converge. Live
# activeRequests/recentRequests are still pushed on every event (cheap, not the scan).
# Located by CONTENT (cachedStats state object + `await (0,X.Y)()` stats call), never by chunk name.
# An `npm i -g 9router` reverts it. Marker: __nrUsageStats
#
# Usage: 9router-usage-stream-guard.sh [--check] [--quiet] [9router_root]
#   exit 0 applied/already (--check: would patch also exits 0, text says WOULD PATCH)
#        2 tooling · 3 anchor not found (never a silent success) · 4 node --check failed
# No backup file is written: the patched text is syntax-checked as a temp file BEFORE it replaces
# the original (atomic rename); the before-sha256 is printed.
set -uo pipefail
CHECK=0; QUIET=0; ROOT=""
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --quiet) QUIET=1 ;; *) ROOT="$a" ;; esac; done
ROOT="${ROOT:-$HOME/.npm-global/lib/node_modules/9router}"
SRV="$ROOT/app/.next-cli-build/server"
[ -d "$SRV/app" ] || { echo "FAIL: 9router server dir not found at $SRV"; exit 2; }
NODE=""; for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -n "$NODE" ] || { echo "FAIL: no node binary resolvable"; exit 2; }
PY=""; for c in /opt/homebrew/bin/python3 /usr/bin/python3 "$(command -v python3 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { PY="$c"; break; }; done
[ -n "$PY" ] || { echo "FAIL: no python3 binary resolvable"; exit 2; }
"$PY" - "$SRV" "$NODE" "$CHECK" "$QUIET" <<'PY'
import glob, hashlib, os, re, subprocess, sys, tempfile
srv, node, check, quiet = sys.argv[1], sys.argv[2], sys.argv[3]=="1", sys.argv[4]=="1"
say = (lambda *a: None) if quiet else print
MARK = "__nrUsageStats"
STATE = "cachedStats:null"                      # the stream route's per-connection state object
CALL = re.compile(r"let (\w+)=await \(0,(\w+)\.(\w+)\)\(\);(\w+)\.cachedStats=\1,")
HELP = ("(globalThis.__nrUsageStats||(globalThis.__nrUsageStats=(()=>{let t=0,v=null,p=null;return async f=>{"
        "if(v&&Date.now()-t<6e4)return v;return p||(p=Promise.resolve().then(f).then(r=>(v=r,t=Date.now(),r)).finally(()=>{p=null}))}})()))")
def new(m):
    e, mod, fn, b = m.group(1), m.group(2), m.group(3), m.group(4)
    return (f"let {e}=await {HELP}(()=>(0,{mod}.{fn})());"
            f"{e}=={b}.cachedStats&&!{b}.trail&&({b}.trail=setTimeout(()=>{{{b}.trail=null,{b}.send()}},6e4)),{b}.cachedStats={e},")
files = [f for f in glob.glob(os.path.join(srv, "**", "*.js"), recursive=True)
         if os.path.getsize(f) < 4_000_000 and STATE in (open(f, encoding="utf-8", errors="surrogateescape").read())]
files = [f for f in files if "sendPending" in open(f, encoding="utf-8", errors="surrogateescape").read()]
if not files:
    print(f"FAIL: usage-stream route (state `{STATE}`) not found under {srv} — bundle changed. NOT guarded."); sys.exit(3)
if len(files) > 1:
    print("AMBIGUOUS: usage-stream route found in", [os.path.basename(f) for f in files]); sys.exit(3)
f = files[0]; rel = os.path.relpath(f, srv)
t = open(f, encoding="utf-8", errors="surrogateescape").read()
if MARK in t:
    say(f"9router-usage-stream: already applied: {rel}"); sys.exit(0)
ms = CALL.findall(t)
if len(ms) != 1:
    print(f"FAIL: usage-stats call anchor count={len(ms)} (need 1) in {rel} — NOT guarded."); sys.exit(3)
before = hashlib.sha256(t.encode("utf-8", "surrogateescape")).hexdigest()
if check:
    say(f"WOULD PATCH: {rel} (before sha256 {before[:16]})"); say("CHECK MODE — nothing was written."); sys.exit(0)
out = CALL.sub(new, t, count=1)
d = os.path.dirname(f)
fd, tmp = tempfile.mkstemp(suffix=".js", dir=d)
with os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape") as h: h.write(out)
if subprocess.run([node, "--check", tmp], capture_output=True).returncode != 0:
    os.unlink(tmp); print(f"FAIL: node --check rejected patched {rel} — original untouched."); sys.exit(4)
os.chmod(tmp, os.stat(f).st_mode & 0o7777); os.replace(tmp, f)
if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
    print(f"FAIL: node --check failed on {rel} after write"); sys.exit(4)
say(f"9router-usage-stream: patched {rel} (before sha256 {before}, after {hashlib.sha256(out.encode('utf-8','surrogateescape')).hexdigest()})")
PY
