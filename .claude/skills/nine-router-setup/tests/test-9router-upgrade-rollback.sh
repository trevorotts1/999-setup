#!/usr/bin/env bash
# Rollback and acceptance-probe coverage for install-9router-guards.sh --upgrade.
# Offline and synthetic: a scratch HOME, a fake npm that rebuilds a real-shaped stock bundle per
# version, a fake claude-nine, and a local /api/health. No network, no real 9Router, no key,
# provider, combo, model or database touched.
#   A  a rollback stages its own guard toolchain, re-applies the guards and re-proves them
#   B  a rollback that cannot re-apply names the guard, its rc, the MISSING row, the end state, the fix
#   C  the rolled-back bundle is node --checked, so markers alone cannot pass a bundle that cannot parse
#   D  the acceptance probe passes an explicit --model, so an unusable client default pin cannot fail it
#   E  a client model/credential prerequisite warns and keeps the new version instead of rolling back
#   F  real breakage (probe 5xx, router health down) still rolls back, re-applies and exits 3
# Usage: test-9router-upgrade-rollback.sh   (INSTALLER=path overrides the script under test)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
I="${INSTALLER:-$HERE/../scripts/macos/install-9router-guards.sh}"
PY=/usr/bin/python3; [ -x "$PY" ] || PY="$(command -v python3 || true)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] && [ -n "$PY" ] || { echo "SKIP: node and python3 are required"; exit 0; }

T="$(mktemp -d)"; HPID=""
trap '[ -n "$HPID" ] && kill "$HPID" 2>/dev/null; rm -rf "$T"' EXIT
PORT="$("$PY" -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# ---- synthetic box pieces ---------------------------------------------------
# mkbundle.sh PKG VER MARK(0|1) SHAPE(normal|noanchor|badsyntax)
cat >"$T/mkbundle.sh" <<'MKB'
#!/usr/bin/env bash
set -uo pipefail
PKG="$1"; VER="$2"; MARK="${3:-0}"; SHAPE="${4:-normal}"
rm -rf "$PKG"
mkdir -p "$PKG/app/.next-cli-build/server/chunks" "$PKG/app/.next-cli-build/server/app/api/usage/stream"
printf '{"name": "9router", "version": "%s"}\n' "$VER" >"$PKG/package.json"
printf 'module.exports={};\n' >"$PKG/cli.js"
printf 'module.exports={};\n' >"$PKG/app/.next-cli-build/server/app/api/usage/stream/route.js"
MK=""; [ "$MARK" = 1 ] && MK='/*ping-keepalive-v3*/'
C="$PKG/app/.next-cli-build/server/chunks/8901.js"
HANDLER='async function zz(a,b=null){let c;try{c=await a.json()}catch(e){c=null}return new Response("Invalid JSON body / Missing model")}'
case "$SHAPE" in
  noanchor)  # the exported handler shape the guard keys on is gone: the guard must refuse, not guess
    printf '%s\n' "var b={};b.P=0;c.d(b,{P:()=>zz});async function zz(a,b,c){let c2;c2=await a.json()}/*Invalid JSON body / Missing model*/" >"$C" ;;
  badsyntax) # the proof marker is present and the file does not parse
    printf '%s\n' "${MK}var b={};b.P=0;c.d(b,{P:()=>zz});${HANDLER}" >"$C"
    printf '%s\n' 'function (/' >>"$C" ;;
  *)
    printf '%s\n' "${MK}var b={};b.P=0;c.d(b,{P:()=>zz});${HANDLER}" >"$C" ;;
esac
exit 0
MKB
chmod +x "$T/mkbundle.sh"

cat >"$T/npm" <<'NPM'
#!/usr/bin/env bash
set -uo pipefail
case "${1:-}" in
  view) printf '%s\n' "${2#9router@}"; exit 0 ;;
  install) ;;
  *) exit 0 ;;
esac
P=""; V=""; shift
while [ $# -gt 0 ]; do
  case "$1" in --prefix) P="${2:-}"; shift ;; 9router@*) V="${1#9router@}" ;; esac
  shift
done
[ -n "$P" ] && [ -n "$V" ] || { echo "fake-npm: bad install args" >&2; exit 1; }
if [ -n "${FAKE_FORCE_WHEN:-}" ] && [ "$V" = "$FAKE_FORCE_WHEN" ] && [ -n "${FAKE_FORCE_TO:-}" ]; then V="$FAKE_FORCE_TO"; fi
bash "$FAKE_MKBUNDLE" "$P/lib/node_modules/9router" "$V" "${FAKE_MARK:-0}" "${FAKE_SHAPE:-normal}" || exit 1
echo "added 1 package (fake 9router@$V)" >&2
exit 0
NPM
chmod +x "$T/npm"

# Fake launcher. Default ("pin") models a box whose DEFAULT model is unusable and whose explicit
# --model routes fine; the other modes model a client prerequisite and a genuine router fault.
cat >"$T/claude-nine" <<'CLI'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${FAKE_CLI_LOG:-/dev/null}"
case "${FAKE_CLI_MODE:-pin}" in
  prereq)    printf 'API Error: 400 Upstream request failed: Model is unavailable\n' >&2; exit 1 ;;
  router5xx) printf 'API Error: 502 Bad Gateway\n' >&2; exit 1 ;;
esac
for a in "$@"; do case "$a" in --model) printf 'routing works\n'; exit 0 ;; esac; done
printf 'API Error: 400 Upstream request failed: Model is unavailable\n' >&2; exit 1
CLI
chmod +x "$T/claude-nine"

cat >"$T/health.py" <<'HPY'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"status":"ok"}'
        self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
HPY

newhome() {  # name mark shape -> HOME with 0.5.104 installed
  local h="$T/home-$1"
  mkdir -p "$h/bin" "$h/.npm-global/lib/node_modules"
  bash "$T/mkbundle.sh" "$h/.npm-global/lib/node_modules/9router" 0.5.104 "$2" "$3" || exit 1
  cp "$T/npm" "$h/bin/npm"; cp "$T/claude-nine" "$h/bin/claude-nine"; chmod 755 "$h/bin/npm" "$h/bin/claude-nine"
  printf '%s\n' "$h"
}
run_upgrade() {  # HOME args... -> sets RC and OUT
  local h="$1"; shift
  OUT="$(env -i HOME="$h" PATH="$h/bin:$PATH" NINEROUTER_PORT="$PORT" NINEROUTER_UPGRADE_PROBE_TIMEOUT=30 \
        NINEROUTER_NPM="$h/bin/npm" FAKE_MKBUNDLE="$T/mkbundle.sh" FAKE_CLI_LOG="$h/cli.log" \
        FAKE_MARK="${FAKE_MARK:-0}" FAKE_SHAPE="${FAKE_SHAPE:-normal}" FAKE_CLI_MODE="${FAKE_CLI_MODE:-pin}" \
        FAKE_FORCE_WHEN="${FAKE_FORCE_WHEN:-}" FAKE_FORCE_TO="${FAKE_FORCE_TO:-}" \
        bash "$I" --upgrade "$@" 2>&1)"
  RC=$?
}
check() {  # HOME ROOT guard -> sets CRC and COUT
  COUT="$(env -i HOME="$1" PATH="$PATH" NINEROUTER_PORT="$PORT" bash "$I" --check --root "$2" "$3" 2>&1)"
  CRC=$?
}
pkgv() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1/package.json" | head -1; }

# ---------------------------------------------------------------- A
H="$(newhome a 0 normal)"; ROOT="$H/.npm-global/lib/node_modules/9router"
FAKE_FORCE_WHEN=0.5.112; FAKE_FORCE_TO=0.5.111
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 3 ] && ok "A rollback reached before the toolchain was staged: exit 3" || { bad "A exit $RC, expected 3"; printf '%s\n' "$OUT" | tail -8; }
printf '%s\n' "$OUT" | grep -q 'rollback OK: 9router@0.5.104 reinstalled, patches re-proven present' \
  && ok "A rollback re-applied and re-proved the guards" || bad "A rollback not proven"
check "$H" "$ROOT" ping-keepalive; RC=$CRC
[ "$RC" = 0 ] && printf '%s' "$COUT" | grep -q 'OK   ping-keepalive' \
  && ok "A box left on a PATCHED 0.5.104" || { bad "A post-rollback --check rc=$RC"; printf '%s\n' "$COUT"; }
[ -d "$H/.local/bin" ] && ok "A rollback staged the guard toolchain itself" || bad "A toolchain not staged by the rollback"

# ---------------------------------------------------------------- B
H="$(newhome b 0 noanchor)"; FAKE_SHAPE=noanchor; ROOT="$H/.npm-global/lib/node_modules/9router"
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 4 ] && ok "B an unappliable guard fails the rollback (exit 4)" || bad "B exit $RC, expected 4"
printf '%s\n' "$OUT" | grep -q 'rollback: guard ping-keepalive failed (rc=1)' \
  && ok "B rollback names the guard and its rc" || bad "B failing guard not named"
printf '%s\n' "$OUT" | grep -q 'MISSING ping-keepalive' && ok "B rollback prints the corresponding MISSING row" || bad "B MISSING row absent"
printf '%s\n' "$OUT" | grep -q 'box left on an UNPATCHED 9Router bundle' && ok "B end state stated in words" || bad "B end state line absent"
printf '%s\n' "$OUT" | grep -q "fix: bash .*install-9router-guards.sh --root" && ok "B single fix command printed" || bad "B fix command absent"

# ---------------------------------------------------------------- C
H="$(newhome c 1 badsyntax)"; FAKE_SHAPE=badsyntax; FAKE_MARK=1; ROOT="$H/.npm-global/lib/node_modules/9router"
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 4 ] && ok "C a rolled-back bundle that does not parse fails the rollback (exit 4)" || bad "C exit $RC, expected 4"
printf '%s\n' "$OUT" | grep -q 'SYNTAX FAIL: .*8901\.js' && ok "C rollback names the file that does not parse" || bad "C SYNTAX FAIL by filename absent"
printf '%s\n' "$OUT" | grep -q 'rollback OK' && bad 'C rollback OK despite an unparsable bundle' || ok 'C markers alone did not pass it (no rollback OK)'
grep -q 'ping-keepalive-v3' "$ROOT/app/.next-cli-build/server/chunks/8901.js" && ok 'C the rolled-back bundle carries the proof marker, so only the parse check can fail it' || bad 'C marker absent from the rolled-back bundle'
printf '%s\n' "$OUT" | grep -q 'box left on an UNPATCHED 9Router bundle' && ok "C end state stated in words" || bad "C end state line absent"

# ---------------------------------------------------------------- D, E, F1 share a health endpoint
FAKE_FORCE_WHEN=""; FAKE_FORCE_TO=""; FAKE_MARK=1; FAKE_SHAPE=normal
"$PY" "$T/health.py" "$PORT" >/dev/null 2>&1 & HPID=$!; sleep 0.6

H="$(newhome d 1 normal)"; ROOT="$H/.npm-global/lib/node_modules/9router"
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 0 ] && ok "D an unusable default model pin does not roll back a proved upgrade (exit 0)" || { bad "D exit $RC, expected 0"; printf '%s\n' "$OUT" | tail -8; }
[ "$(pkgv "$ROOT")" = 0.5.112 ] && ok "D new version kept" || bad "D package at $(pkgv "$ROOT"), expected 0.5.112"
printf '%s\n' "$OUT" | grep -q 'upgrade verified' && ok "D upgrade verified" || bad "D 'upgrade verified' absent"
printf '%s\n' "$OUT" | grep -q 'rolling back' && bad "D rolled back anyway" || ok "D no rollback"
grep -q -- '--model' "$H/cli.log" 2>/dev/null && ok "D probe argv carries an explicit --model" || bad "D probe ran without --model"

H="$(newhome e 1 normal)"; ROOT="$H/.npm-global/lib/node_modules/9router"
FAKE_CLI_MODE=prereq
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 0 ] && ok "E a client model prerequisite does not roll back (exit 0)" || { bad "E exit $RC, expected 0"; printf '%s\n' "$OUT" | tail -8; }
[ "$(pkgv "$ROOT")" = 0.5.112 ] && ok "E new version kept" || bad "E package at $(pkgv "$ROOT"), expected 0.5.112"
[ "$(printf '%s\n' "$OUT" | grep -c 'WARNING:')" = 1 ] && ok "E exactly one WARNING line" || bad "E WARNING count $(printf '%s\n' "$OUT" | grep -c 'WARNING:')"
printf '%s\n' "$OUT" | grep 'WARNING:' | grep -q 'Model is unavailable' && ok "E the WARNING names the prerequisite" || bad "E WARNING does not name the prerequisite"
printf '%s\n' "$OUT" | grep -q 'rolling back' && bad "E rolled back anyway" || ok "E no rollback"

H="$(newhome f1 1 normal)"; ROOT="$H/.npm-global/lib/node_modules/9router"
FAKE_CLI_MODE=router5xx
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 3 ] && ok "F a genuine router fault still rolls back (exit 3)" || bad "F exit $RC, expected 3"
[ "$(pkgv "$ROOT")" = 0.5.104 ] && ok "F rolled back to the recorded previous version" || bad "F package at $(pkgv "$ROOT"), expected 0.5.104"
printf '%s\n' "$OUT" | grep -q 'rollback OK' && ok "F rollback re-applied and re-proved the guards" || bad "F rollback not proven"
FAKE_CLI_MODE=pin; kill "$HPID" 2>/dev/null; HPID=""

H="$(newhome f2 1 normal)"; ROOT="$H/.npm-global/lib/node_modules/9router"
run_upgrade "$H" 0.5.112 --no-restart --root "$ROOT" ping-keepalive
[ "$RC" = 3 ] && ok "F router health never answering still rolls back (exit 3)" || bad "F health-down exit $RC, expected 3"
[ "$(pkgv "$ROOT")" = 0.5.104 ] && ok "F health-down rolled back to the recorded previous version" || bad "F health-down package at $(pkgv "$ROOT")"

echo "--- $([ "$fail" = 0 ] && echo PASS || echo FAIL) ---"
exit "$fail"
