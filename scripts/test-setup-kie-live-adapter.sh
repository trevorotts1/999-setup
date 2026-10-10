#!/usr/bin/env bash
# Self-test for setup-kie-live-adapter.sh (KIE gap fix item (c)).
#
# Every case RUNS the real installer step against a throwaway, deliberately
# non-secret key and a localhost credits endpoint that the real
# kie_live_adapter.py talks to — no skips, no fixture-only proof:
#
#   A. working credits call  -> key stored in the env block of BOTH config roots
#      at mode 600, `active` written, and the value appears nowhere in captured
#      stdout/stderr or in any other file (logs, backups, temp).
#   B. no key                -> `NOT SET`, mode file stays the shadow default
#      (absent stays absent, a pre-existing `active` is demoted to `shadow`).
#   C. failing credits call  -> key still stored, `CHECK FAILED`, mode file
#      never becomes `active`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
STEP="$REPO_ROOT/scripts/setup-kie-live-adapter.sh"
ADAPTER="$REPO_ROOT/installer-registration/helpers/74-kie-live-adapter/scripts/kie_live_adapter.py"

# Throwaway non-secret. The whole point of the leak assertions below is that
# this exact string is written ONLY into each root's settings.json env block.
KEY="THROWAWAY-not-a-secret-kie-key-3fa7c219"
BALANCE="123.5"

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf 'PASS: %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

[ -f "$STEP" ]   || { echo "FAIL: step missing: $STEP" >&2; exit 1; }
[ -f "$ADAPTER" ] || { echo "FAIL: adapter missing: $ADAPTER" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/kie-u2-kie-setup-test.XXXXXX")"
server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

cat >"$work/credits-server.py" <<'PY'
import http.server, sys
port, body, code = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *args):
        pass

http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
PY

start_server() { # $1 = JSON body, $2 = HTTP status
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
  PORT="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  python3 "$work/credits-server.py" "$PORT" "$1" "$2" &
  server_pid=$!
  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if python3 -c "import socket,sys;s=socket.socket();s.settimeout(0.2);sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.1
  done
  [ "$ready" -eq 1 ] || { echo "FAIL: localhost credits server did not start" >&2; exit 1; }
}

# Clean environment: nothing inherited from the machine running the test may
# supply a key, an API base, a config root or an adapter path.
clean_env() {
  env -u KIE_API_KEY -u KIE_LIVE_API_BASE -u KIE_LIVE_ADAPTER_MODE -u KIE_LIVE_ADAPTER_PY \
      -u API_DOCS_PATH -u CLAUDE_CONFIG_DIR -u OC_CONFIG "$@"
}

no_key_outside_settings() { # $1 = scenario dir, $2 = api-docs file to excuse
  local hits
  hits="$(find "$1" -type f ! -path "$2" ! -name settings.json \
            -exec grep -lF -- "$KEY" {} \; 2>/dev/null || true)"
  if [ -z "$hits" ]; then
    ok "$3: key value absent from stdout, stderr, logs and every non-settings file"
  else
    bad "$3: key value LEAKED into: $hits"
  fi
}

# ---------------------------------------------------------------------------
# A. working credits call -> stored in both roots, mode 600, active, no leak
# ---------------------------------------------------------------------------
a="$work/a"
mkdir -p "$a/home/.claude" "$a/home/.claude-nine"
printf '{"model":"opus"}\n' >"$a/home/.claude/settings.json"
printf '{"permissions":{"defaultMode":"bypassPermissions"}}\n' >"$a/home/.claude-nine/settings.json"
chmod 644 "$a/home/.claude/settings.json"   # deliberately not 600: the step must re-lock
chmod 600 "$a/home/.claude-nine/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$a/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$a/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$a/api-docs.md" --non-interactive \
     </dev/null >"$a/stdout.txt" 2>"$a/stderr.txt"; then
  ok "A: step exits 0"
else
  bad "A: step exited non-zero"
fi
if grep -qF 'KIE key: SET' "$a/stdout.txt"; then
  ok "A: prints KIE key: SET"
else
  bad "A: did not print KIE key: SET"
fi
if grep -qF "KIE credits: $BALANCE" "$a/stdout.txt"; then
  ok "A: prints only the balance from the credits read"
else
  bad "A: balance line missing (got: $(tr '\n' ' ' <"$a/stdout.txt"))"
fi
if grep -qF -- "$KEY" "$a/stdout.txt" "$a/stderr.txt"; then
  bad "A: key value present in captured stdout/stderr"
else
  ok "A: key value absent from captured stdout and stderr"
fi
if clean_env python3 - "$KEY" "$a/home/.claude/settings.json" "$a/home/.claude-nine/settings.json" <<'PY'
import json, os, stat, sys
key, paths = sys.argv[1], sys.argv[2:]
for p in paths:
    mode = stat.S_IMODE(os.stat(p).st_mode)
    assert mode == 0o600, "%s mode is %o, expected 600" % (p, mode)
    doc = json.load(open(p))
    assert isinstance(doc.get("env"), dict), "%s has no env block" % p
    assert doc["env"].get("KIE_API_KEY") == key, "%s env block does not hold the key" % p
pass
PY
then
  ok "A: both config roots hold the key in their env block at mode 600"
else
  bad "A: settings env block or mode 600 check failed"
fi
for root in "$a/home/.claude" "$a/home/.claude-nine"; do
  if [ "$(cat "$root/kie-live-adapter-mode.conf" 2>/dev/null || echo missing)" = "active" ]; then
    ok "A: active written to $root/kie-live-adapter-mode.conf after a passing credits call"
  else
    bad "A: mode file for $root is not active"
  fi
done
no_key_outside_settings "$a" "$a/api-docs.md" "A"
if find "$a/home" -name 'settings.json.bak-kie-*' -type f ! -perm 600 | grep -q .; then
  bad "A: a settings backup is not mode 600"
else
  ok "A: any settings backup taken before the write is mode 600 (and key-free, see scan above)"
fi

# ---------------------------------------------------------------------------
# B. no key -> NOT SET, shadow stays in force
# ---------------------------------------------------------------------------
b="$work/b"
mkdir -p "$b/home/.claude" "$b/home/.claude-nine"
printf '{"model":"opus"}\n' >"$b/home/.claude/settings.json"
printf '{"model":"opus"}\n' >"$b/home/.claude-nine/settings.json"
printf 'active\n' >"$b/home/.claude-nine/kie-live-adapter-mode.conf"  # must be demoted
printf 'KIE_API_KEY=replace_with_real_key\n' >"$b/api-docs.md"        # placeholder = no key

if (cd "$b" && clean_env HOME="$b/home" bash "$STEP" --api-docs "$b/api-docs.md" --non-interactive \
      </dev/null >"$b/stdout.txt" 2>"$b/stderr.txt"); then
  ok "B: step exits 0 with no key"
else
  bad "B: step exited non-zero with no key"
fi
if grep -qF 'KIE key: NOT SET' "$b/stdout.txt"; then
  ok "B: prints KIE key: NOT SET"
else
  bad "B: did not print KIE key: NOT SET"
fi
if grep -qF 'KIE credits: NOT CHECKED' "$b/stdout.txt"; then
  ok "B: no credits call is made when the key is absent"
else
  bad "B: credits were checked without a key"
fi
if [ -e "$b/home/.claude/kie-live-adapter-mode.conf" ]; then
  bad "B: mode file created for .claude without a passing credits call"
else
  ok "B: .claude mode file stays absent (shadow default)"
fi
if [ "$(cat "$b/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing)" = "shadow" ]; then
  ok "B: pre-existing active demoted to shadow when no key is present"
else
  bad "B: mode file is $(cat "$b/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing), expected shadow"
fi
if clean_env python3 - "$b/home/.claude/settings.json" "$b/home/.claude-nine/settings.json" <<'PY'
import json, sys
for p in sys.argv[1:]:
    doc = json.load(open(p))
    assert "KIE_API_KEY" not in (doc.get("env") or {}), "%s holds a key it was never given" % p
pass
PY
then
  ok "B: settings env blocks were never populated without a key"
else
  bad "B: a settings env block holds a key"
fi

# ---------------------------------------------------------------------------
# C. failing credits call -> key stored, CHECK FAILED, never active
# ---------------------------------------------------------------------------
c="$work/c"
mkdir -p "$c/home/.claude" "$c/home/.claude-nine"
printf '{"model":"opus"}\n' >"$c/home/.claude/settings.json"
printf '{"model":"opus"}\n' >"$c/home/.claude-nine/settings.json"
printf 'active\n' >"$c/home/.claude-nine/kie-live-adapter-mode.conf"  # must be demoted
printf 'KIE_API_KEY=%s\n' "$KEY" >"$c/api-docs.md"
start_server '{"code":401,"msg":"invalid key"}' 401

if clean_env HOME="$c/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$c/api-docs.md" --non-interactive \
     </dev/null >"$c/stdout.txt" 2>"$c/stderr.txt"; then
  ok "C: step exits 0 when the credits read fails (shadow is the outcome)"
else
  bad "C: step exited non-zero on a failing credits read"
fi
if grep -qF 'KIE key: SET' "$c/stdout.txt"; then
  ok "C: prints KIE key: SET"
else
  bad "C: did not print KIE key: SET"
fi
if grep -qF 'KIE credits: CHECK FAILED' "$c/stdout.txt"; then
  ok "C: reports the failed credits read"
else
  bad "C: did not report CHECK FAILED (got: $(tr '\n' ' ' <"$c/stdout.txt"))"
fi
if grep -qF -- "$KEY" "$c/stdout.txt" "$c/stderr.txt"; then
  bad "C: key value present in captured stdout/stderr"
else
  ok "C: key value absent from captured stdout and stderr"
fi
if [ -e "$c/home/.claude/kie-live-adapter-mode.conf" ]; then
  bad "C: mode file created for .claude after a failing credits call"
else
  ok "C: .claude mode file stays absent (shadow default)"
fi
if [ "$(cat "$c/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing)" = "shadow" ]; then
  ok "C: pre-existing active demoted to shadow after a failing credits call"
else
  bad "C: mode file is $(cat "$c/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing), expected shadow"
fi
if clean_env python3 - "$KEY" "$c/home/.claude/settings.json" "$c/home/.claude-nine/settings.json" <<'PY'
import json, os, stat, sys
key, paths = sys.argv[1], sys.argv[2:]
for p in paths:
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600, "%s not mode 600" % p
    doc = json.load(open(p))
    assert (doc.get("env") or {}).get("KIE_API_KEY") == key, "%s does not hold the key" % p
pass
PY
then
  ok "C: key still stored in both roots at mode 600 while shadow stays in force"
else
  bad "C: settings storage check failed"
fi
no_key_outside_settings "$c" "$c/api-docs.md" "C"

printf '\nSUITES (setup-kie-live-adapter): %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
