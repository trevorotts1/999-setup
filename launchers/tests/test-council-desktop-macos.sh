#!/bin/bash
# WER-021 companion (999 side): macOS desktop launcher tests.
# Style follows the repository's test-*.sh convention: PASS/FAIL lines,
# nonzero exit on failure, no test framework.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$REPO/launchers/macos/blackceo-council-desktop"
T="$(mktemp -d "${TMPDIR:-/tmp}/operator-mac-W08-U003-XXXXXX")" || exit 1
STUB_PIDS=""
cleanup() {
  for pid in $STUB_PIDS; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$T"
}
trap cleanup EXIT

fail=0
pass() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fail=1; }

free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
}

wait_for_port() {
  local port="$1" i=0
  while [ "$i" -lt 100 ]; do
    if curl -sS --max-time 1 -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null; then return 0; fi
    sleep 0.1; i=$((i + 1))
  done
  return 1
}

# --- fixtures --------------------------------------------------------------
cat > "$T/stub.cjs" <<'STUB'
const http = require('node:http');
const fs = require('node:fs');
const [port, mode, pidfile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  if (req.url !== '/api/health') { res.writeHead(404); res.end('not found'); return; }
  const body = mode === 'council'
    ? { service: 'council', sessionUrl: `http://127.0.0.1:${port}/session/test-1` }
    : { service: 'unrelated', name: 'not a council service' };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
server.listen(Number(port), '127.0.0.1', () => {
  if (pidfile) fs.writeFileSync(pidfile, String(process.pid));
});
STUB

cat > "$T/fake-run-council.cjs" <<'ENTRY'
import http from 'node:http';
import fs from 'node:fs';
const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = '';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--host') host = args[i + 1];
  if (args[i] === '--port') port = args[i + 1];
}
const server = http.createServer((req, res) => {
  if (req.url !== '/api/health') { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'council', sessionUrl: `http://${host}:${port}/session/started-1` }));
});
server.listen(Number(port), host, () => {
  if (process.env.FAKE_COUNCIL_PIDFILE) fs.writeFileSync(process.env.FAKE_COUNCIL_PIDFILE, String(process.pid));
});
ENTRY

# --- 0. syntax -------------------------------------------------------------
if bash -n "$LAUNCHER"; then pass "macOS launcher parses with bash -n"; else bad "macOS launcher has a syntax error"; fi

# --- 1. reuse a verified service and preserve the URL when open fails ------
P1="$(free_port)"
node "$T/stub.cjs" "$P1" council "$T/stub1.pid" & STUB_PIDS="$STUB_PIDS $!"
wait_for_port "$P1" || bad "stub council listener did not start on $P1"
OUT1="$(BLACKCEO_COUNCIL_PROFILE="$T/profile1" BLACKCEO_COUNCIL_PORT="$P1" \
  BLACKCEO_COUNCIL_OPEN_CMD=/usr/bin/false "$LAUNCHER" 2>&1)"
RC1=$?
case "$OUT1" in *"COUNCIL_SESSION_URL=http://127.0.0.1:$P1/session/test-1"*) pass "reused service prints the verified session URL";; *) bad "verified URL missing: $OUT1";; esac
case "$OUT1" in *"COUNCIL_BROWSER_OPEN_FAILED"*) pass "browser-open failure is reported";; *) bad "browser-open failure warning missing: $OUT1";; esac
[ "$RC1" -eq 0 ] && pass "URL still delivered when the browser cannot open (exit 0)" || bad "exit $RC1 when the browser cannot open"
kill "$(cat "$T/stub1.pid" 2>/dev/null)" 2>/dev/null || true

# --- 2. refuse an unrelated listener and never kill it ---------------------
P2="$(free_port)"
node "$T/stub.cjs" "$P2" unrelated "$T/stub2.pid" & STUB_PIDS="$STUB_PIDS $!"
wait_for_port "$P2" || bad "unrelated stub did not start on $P2"
OUT2="$(BLACKCEO_COUNCIL_PROFILE="$T/profile2" BLACKCEO_COUNCIL_PORT="$P2" \
  BLACKCEO_COUNCIL_OPEN_CMD=/usr/bin/false "$LAUNCHER" --no-open 2>&1)"
RC2=$?
[ "$RC2" -eq 3 ] && pass "unrelated listener refused with exit 3" || bad "expected exit 3, got $RC2"
case "$OUT2" in *"REFUSING"*"not a council service"*) pass "refusal names the unrelated listener";; *) bad "refusal message missing: $OUT2";; esac
case "$OUT2" in *"COUNCIL_SESSION_URL="*) bad "refusal must not print a session URL";; *) pass "refusal prints no session URL";; esac
STUB2_PID="$(cat "$T/stub2.pid" 2>/dev/null)"
if [ -n "$STUB2_PID" ] && kill -0 "$STUB2_PID" 2>/dev/null; then
  pass "unrelated listener was NOT killed (pid $STUB2_PID still alive)"
else
  bad "unrelated listener is gone after refusal"
fi
kill "$STUB2_PID" 2>/dev/null || true

# --- 3. start the service when the port is down ----------------------------
P3="$(free_port)"
mkdir -p "$T/profile3/runtime/current"
cp "$T/fake-run-council.cjs" "$T/profile3/runtime/current/run-council.mjs"
OUT3="$(FAKE_COUNCIL_PIDFILE="$T/started.pid" BLACKCEO_COUNCIL_PROFILE="$T/profile3" \
  BLACKCEO_COUNCIL_PORT="$P3" BLACKCEO_COUNCIL_READY_TIMEOUT=10 \
  BLACKCEO_COUNCIL_OPEN_CMD=/usr/bin/false "$LAUNCHER" --no-open 2>&1)"
RC3=$?
[ "$RC3" -eq 0 ] && pass "started service and delivered its URL (exit 0)" || bad "start path exit $RC3: $OUT3"
case "$OUT3" in *"COUNCIL_SESSION_URL=http://127.0.0.1:$P3/session/started-1"*) pass "started service URL is the true session URL";; *) bad "started service URL missing: $OUT3";; esac
STARTED_PID="$(cat "$T/started.pid" 2>/dev/null)"
if [ -n "$STARTED_PID" ] && kill -0 "$STARTED_PID" 2>/dev/null; then
  pass "started service is running (pid $STARTED_PID)"
  kill "$STARTED_PID" 2>/dev/null || true
else
  bad "started service pid was not recorded"
fi

# --- 4. --print-command emits command + readiness, registers nothing -------
OUT4="$(BLACKCEO_COUNCIL_PROFILE="$T/profile3" BLACKCEO_COUNCIL_PORT=4555 "$LAUNCHER" --print-command 2>&1)"
RC4=$?
[ "$RC4" -eq 0 ] && pass "--print-command exits 0" || bad "--print-command exit $RC4"
case "$OUT4" in *"COUNCIL_LAUNCH_COMMAND="*"run-council.mjs"*"serve --host 127.0.0.1 --port 4555"*) pass "launch command emitted with the requested port";; *) bad "launch command missing: $OUT4";; esac
case "$OUT4" in *"COUNCIL_READINESS_CHECK=curl -fsS http://127.0.0.1:4555/api/health"*) pass "readiness check emitted";; *) bad "readiness check missing: $OUT4";; esac
case "$OUT4" in *"Registration as a launchd/system service is out of scope"*) pass "registration out of scope is stated";; *) bad "out-of-scope statement missing: $OUT4";; esac

# --- 5. no file outside launchers/ is modified -----------------------------
OUTSIDE="$(cd "$REPO" && git status --porcelain -- ':(exclude)launchers')"
if [ -z "$OUTSIDE" ]; then pass "no file outside launchers/ is modified"; else bad "files outside launchers/ changed: $OUTSIDE"; fi

[ "$fail" -eq 0 ] && echo "RESULT PASS (macOS launcher)" || echo "RESULT FAIL (macOS launcher)"
exit "$fail"
