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
#   D. root coverage         -> an existing CLAUDE_CONFIG_DIR root is written, a
#      missing ~/.claude-nine root is never created.
#   E. (U2-a) only env.KIE_API_KEY is written, no ANTHROPIC_* key, and a stored
#      value never starts with "Bearer " — planted bad + clean.
#   F. (U2-b) ANTHROPIC_* at api.kie.ai is reported and never edited or
#      deleted — planted bad + clean.
#   G. (U2-c) kie-models / kie-chat-agents folders are reported and never
#      removed — planted bad + clean.
#   H. (U2-d) failed credits prints the 401 / 402 cause in plain words —
#      planted bad (401, 402) + clean (other failure shows neither phrase).
#   I. golden-rule exception: a planted settings.json keeps every other key
#      byte-for-byte; only KIE_API_KEY is added.
#   J. declined fallback: --decline-settings-write writes nothing, prints the
#      single paste line, skill 74 stays in shadow mode.
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

# ---------------------------------------------------------------------------
# D. root coverage — an existing CLAUDE_CONFIG_DIR root is written, a missing
#    ~/.claude-nine root is never created (failing credits: shadow stays)
# ---------------------------------------------------------------------------
d="$work/d"
mkdir -p "$d/home/.claude" "$d/alt-config"
printf '{"model":"opus"}\n' >"$d/home/.claude/settings.json"
printf '{"model":"opus"}\n' >"$d/alt-config/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$d/api-docs.md"
start_server '{"code":500,"msg":"boom"}' 500

if clean_env HOME="$d/home" CLAUDE_CONFIG_DIR="$d/alt-config" \
     KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$d/api-docs.md" --non-interactive \
     </dev/null >"$d/stdout.txt" 2>"$d/stderr.txt"; then
  ok "D: step exits 0"
else
  bad "D: step exited non-zero"
fi
if [ -d "$d/home/.claude-nine" ]; then
  bad "D: created a ~/.claude-nine root that did not exist"
else
  ok "D: a config root that does not exist is never created"
fi
if grep -qF "$KEY" "$d/stdout.txt" "$d/stderr.txt"; then
  bad "D: key value present in captured stdout/stderr"
else
  ok "D: key value absent from captured stdout and stderr"
fi
if clean_env python3 - "$KEY" "$d/home/.claude/settings.json" "$d/alt-config/settings.json" <<'PY'
import json, os, stat, sys
key, paths = sys.argv[1], sys.argv[2:]
for p in paths:
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600, "%s not mode 600" % p
    assert (json.load(open(p)).get("env") or {}).get("KIE_API_KEY") == key, "%s does not hold the key" % p
pass
PY
then
  ok "D: both EXISTING roots hold the key at mode 600 (default root + CLAUDE_CONFIG_DIR)"
else
  bad "D: existing-root storage check failed"
fi
if [ -e "$d/home/.claude/kie-live-adapter-mode.conf" ] || [ -e "$d/alt-config/kie-live-adapter-mode.conf" ]; then
  bad "D: a mode file was created after a failing credits call"
else
  ok "D: mode files stay absent (shadow default) in every existing root"
fi
no_key_outside_settings "$d" "$d/api-docs.md" "D"

# ---------------------------------------------------------------------------
# E. (U2-a) only env.KIE_API_KEY is written, never an ANTHROPIC_* key, and the
#    stored value never starts with "Bearer ". Planted bad: the client pasted
#    the whole authorization value. Clean: the plain key.
# ---------------------------------------------------------------------------
e="$work/e"
mkdir -p "$e/home/.claude" "$e/home/.claude-nine"
printf '{"model":"opus"}\n' >"$e/home/.claude/settings.json"
printf '{"model":"opus"}\n' >"$e/home/.claude-nine/settings.json"
printf 'KIE_API_KEY=Bearer %s\n' "$KEY" >"$e/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$e/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$e/api-docs.md" --non-interactive \
     </dev/null >"$e/stdout.txt" 2>"$e/stderr.txt"; then
  ok "E(bad): step exits 0 with a Bearer-prefixed paste"
else
  bad "E(bad): step exited non-zero with a Bearer-prefixed paste"
fi
if clean_env python3 - "$KEY" "$e/home/.claude/settings.json" "$e/home/.claude-nine/settings.json" <<'PY'
import json, sys
key, paths = sys.argv[1], sys.argv[2:]
for p in paths:
    env = json.load(open(p)).get("env") or {}
    stored = env.get("KIE_API_KEY")
    assert stored == key, "%s stored %r instead of the plain key" % (p, stored)
    assert not str(stored).startswith("Bearer "), "%s stored a Bearer-prefixed value" % p
    gained = [k for k in env if k.startswith("ANTHROPIC_")]
    assert not gained, "%s gained ANTHROPIC_* keys: %s" % (p, gained)
pass
PY
then
  ok "E(bad): stored value is the plain key, never Bearer-prefixed, no ANTHROPIC_* written"
else
  bad "E(bad): U2-a storage check failed"
fi
if grep -qF -- "$KEY" "$e/stdout.txt" "$e/stderr.txt" || grep -qF -- "Bearer" "$e/stdout.txt" "$e/stderr.txt"; then
  bad "E(bad): key material present in captured stdout/stderr"
else
  ok "E(bad): key value and the Bearer token absent from stdout/stderr"
fi

e2="$work/e2"
mkdir -p "$e2/home/.claude"
printf '{"model":"opus"}\n' >"$e2/home/.claude/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$e2/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$e2/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$e2/api-docs.md" --non-interactive \
     </dev/null >"$e2/stdout.txt" 2>"$e2/stderr.txt"; then
  ok "E(clean): step exits 0 with the plain key"
else
  bad "E(clean): step exited non-zero with the plain key"
fi
if clean_env python3 - "$KEY" "$e2/home/.claude/settings.json" <<'PY'
import json, os, stat, sys
key, path = sys.argv[1], sys.argv[2]
assert stat.S_IMODE(os.stat(path).st_mode) == 0o600, "%s not mode 600" % path
env = json.load(open(path)).get("env") or {}
assert env.get("KIE_API_KEY") == key, "plain key stored incorrectly"
assert not [k for k in env if k.startswith("ANTHROPIC_")], "ANTHROPIC_* key written"
pass
PY
then
  ok "E(clean): plain key stored at mode 600 with no ANTHROPIC_* written"
else
  bad "E(clean): U2-a clean-case check failed"
fi

# ---------------------------------------------------------------------------
# F. (U2-b) ANTHROPIC_* whose base URL contains api.kie.ai is reported and
#    never edited and never deleted. Planted bad + clean.
# ---------------------------------------------------------------------------
f="$work/f"
mkdir -p "$f/home/.claude" "$f/home/.claude-nine"
cat >"$f/home/.claude/settings.json" <<'JSON'
{"model":"opus","env":{"ANTHROPIC_BASE_URL":"https://api.kie.ai/v1","ANTHROPIC_AUTH_TOKEN":"planted-token-not-a-secret-f2"}}
JSON
cp "$f/home/.claude/settings.json" "$f/planted-claude.json"
printf '{"model":"opus"}\n' >"$f/home/.claude-nine/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$f/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$f/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$f/api-docs.md" --non-interactive \
     </dev/null >"$f/stdout.txt" 2>"$f/stderr.txt"; then
  ok "F(bad): step exits 0 with a kie-pointing base URL present"
else
  bad "F(bad): step exited non-zero"
fi
if grep -qF 'ANTHROPIC_BASE_URL points at api.kie.ai' "$f/stdout.txt"; then
  ok "F(bad): env.ANTHROPIC_BASE_URL pointing at api.kie.ai is reported"
else
  bad "F(bad): no report line for the api.kie.ai base URL (got: $(tr '\n' ' ' <"$f/stdout.txt"))"
fi
if grep -qF 'ANTHROPIC_AUTH_TOKEN present' "$f/stdout.txt"; then
  ok "F(bad): env.ANTHROPIC_AUTH_TOKEN beside it is reported"
else
  bad "F(bad): no report line for the ANTHROPIC_AUTH_TOKEN"
fi
if grep -qF 'planted-token-not-a-secret-f2' "$f/stdout.txt" "$f/stderr.txt"; then
  bad "F(bad): the token value was printed"
else
  ok "F(bad): the token value is never printed"
fi
if clean_env python3 - "$f/planted-claude.json" "$f/home/.claude/settings.json" <<'PY'
import json, sys
orig = json.load(open(sys.argv[1]))["env"]
env = json.load(open(sys.argv[2])).get("env") or {}
assert env.get("ANTHROPIC_BASE_URL") == orig["ANTHROPIC_BASE_URL"], "base URL was edited or deleted"
assert env.get("ANTHROPIC_AUTH_TOKEN") == orig["ANTHROPIC_AUTH_TOKEN"], "token was edited or deleted"
pass
PY
then
  ok "F(bad): both ANTHROPIC_* entries are still present and unchanged (reported, never edited)"
else
  bad "F(bad): an ANTHROPIC_* entry was edited or deleted"
fi

f2="$work/f2"
mkdir -p "$f2/home/.claude"
cat >"$f2/home/.claude/settings.json" <<'JSON'
{"model":"opus","env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_AUTH_TOKEN":"planted-token-not-a-secret-f2"}}
JSON
cp "$f2/home/.claude/settings.json" "$f2/planted-claude.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$f2/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$f2/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$f2/api-docs.md" --non-interactive \
     </dev/null >"$f2/stdout.txt" 2>"$f2/stderr.txt"; then
  ok "F(clean): step exits 0 with an anthropic.com base URL"
else
  bad "F(clean): step exited non-zero"
fi
if grep -qF 'points at api.kie.ai' "$f2/stdout.txt" "$f2/stderr.txt"; then
  bad "F(clean): a base URL that does not point at api.kie.ai was reported"
else
  ok "F(clean): no api.kie.ai report for a base URL that points elsewhere"
fi
if clean_env python3 - "$f2/planted-claude.json" "$f2/home/.claude/settings.json" <<'PY'
import json, sys
orig = json.load(open(sys.argv[1]))["env"]
env = json.load(open(sys.argv[2])).get("env") or {}
assert env.get("ANTHROPIC_BASE_URL") == orig["ANTHROPIC_BASE_URL"], "base URL was edited"
assert env.get("ANTHROPIC_AUTH_TOKEN") == orig["ANTHROPIC_AUTH_TOKEN"], "token was edited"
pass
PY
then
  ok "F(clean): the clean-case ANTHROPIC_* entries are untouched"
else
  bad "F(clean): an ANTHROPIC_* entry changed"
fi

# ---------------------------------------------------------------------------
# G. (U2-c) kie-models / kie-chat-agents folders are reported and never
#    removed. Planted bad + clean.
# ---------------------------------------------------------------------------
g="$work/g"
mkdir -p "$g/home/.claude/skills/kie-models" \
         "$g/home/.claude-nine/skills/kie-chat-agents" \
         "$g/home/.agents/skills/kie-models"
printf '{"model":"opus"}\n' >"$g/home/.claude/settings.json"
printf '{"model":"opus"}\n' >"$g/home/.claude-nine/settings.json"
printf 'KIE_API_KEY=replace_with_real_key\n' >"$g/api-docs.md"

if clean_env HOME="$g/home" bash "$STEP" --api-docs "$g/api-docs.md" --non-interactive \
     </dev/null >"$g/stdout.txt" 2>"$g/stderr.txt"; then
  ok "G(bad): step exits 0 with kie folders planted"
else
  bad "G(bad): step exited non-zero"
fi
for planted in "$g/home/.claude/skills/kie-models" \
               "$g/home/.claude-nine/skills/kie-chat-agents" \
               "$g/home/.agents/skills/kie-models"; do
  if grep -qF "$planted present" "$g/stdout.txt"; then
    ok "G(bad): $planted is reported"
  else
    bad "G(bad): $planted is not reported"
  fi
  if [ -d "$planted" ]; then
    ok "G(bad): $planted still exists (never removed)"
  else
    bad "G(bad): $planted was removed"
  fi
done

g2="$work/g2"
mkdir -p "$g2/home/.claude/skills/shared-utils" "$g2/home/.claude-nine/skills/74-kie-live-adapter"
printf '{"model":"opus"}\n' >"$g2/home/.claude/settings.json"
printf 'KIE_API_KEY=replace_with_real_key\n' >"$g2/api-docs.md"

if clean_env HOME="$g2/home" bash "$STEP" --api-docs "$g2/api-docs.md" --non-interactive \
     </dev/null >"$g2/stdout.txt" 2>"$g2/stderr.txt"; then
  ok "G(clean): step exits 0 with no kie folders present"
else
  bad "G(clean): step exited non-zero"
fi
if grep -qE 'kie-models|kie-chat-agents' "$g2/stdout.txt" "$g2/stderr.txt"; then
  bad "G(clean): a folder report fired when no kie folder exists"
else
  ok "G(clean): no folder report when none exists"
fi

# ---------------------------------------------------------------------------
# H. (U2-d) a failed credits read prints the cause in plain words.
#    Planted bad: 401, then 402. Clean: another failure shows neither phrase.
# ---------------------------------------------------------------------------
h1="$work/h1"
mkdir -p "$h1/home/.claude"
printf '{"model":"opus"}\n' >"$h1/home/.claude/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$h1/api-docs.md"
start_server '{"code":401,"msg":"invalid key"}' 401

if clean_env HOME="$h1/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$h1/api-docs.md" --non-interactive \
     </dev/null >"$h1/stdout.txt" 2>"$h1/stderr.txt"; then
  ok "H(bad 401): step exits 0"
else
  bad "H(bad 401): step exited non-zero"
fi
if grep -qF 'key wrong, expired or rejected; check kie.ai/api-key' "$h1/stdout.txt"; then
  ok "H(bad 401): code 401 prints the plain-words cause"
else
  bad "H(bad 401): 401 cause line missing (got: $(tr '\n' ' ' <"$h1/stdout.txt"))"
fi

h2="$work/h2"
mkdir -p "$h2/home/.claude"
printf '{"model":"opus"}\n' >"$h2/home/.claude/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$h2/api-docs.md"
start_server '{"code":402,"msg":"no balance"}' 402

if clean_env HOME="$h2/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$h2/api-docs.md" --non-interactive \
     </dev/null >"$h2/stdout.txt" 2>"$h2/stderr.txt"; then
  ok "H(bad 402): step exits 0"
else
  bad "H(bad 402): step exited non-zero"
fi
if grep -qF 'not enough credits; top up at kie.ai/pricing' "$h2/stdout.txt"; then
  ok "H(bad 402): code 402 prints the plain-words cause"
else
  bad "H(bad 402): 402 cause line missing (got: $(tr '\n' ' ' <"$h2/stdout.txt"))"
fi

h3="$work/h3"
mkdir -p "$h3/home/.claude"
printf '{"model":"opus"}\n' >"$h3/home/.claude/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$h3/api-docs.md"
start_server '{"code":500,"msg":"boom"}' 500

if clean_env HOME="$h3/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$h3/api-docs.md" --non-interactive \
     </dev/null >"$h3/stdout.txt" 2>"$h3/stderr.txt"; then
  ok "H(clean): step exits 0 on a non-401/402 failure"
else
  bad "H(clean): step exited non-zero"
fi
if grep -qF 'KIE credits: CHECK FAILED' "$h3/stdout.txt" \
   && ! grep -qF 'key wrong, expired or rejected' "$h3/stdout.txt" \
   && ! grep -qF 'not enough credits' "$h3/stdout.txt"; then
  ok "H(clean): a different failure prints CHECK FAILED and neither 401 nor 402 phrase"
else
  bad "H(clean): wrong failure wording (got: $(tr '\n' ' ' <"$h3/stdout.txt"))"
fi
if [ -e "$h3/home/.claude/kie-live-adapter-mode.conf" ]; then
  bad "H(clean): mode file became active after a failed credits read"
else
  ok "H(clean): mode file stays absent (shadow default)"
fi

# ---------------------------------------------------------------------------
# I. golden-rule exception: only KIE_API_KEY is added to a planted
#    settings.json — no existing line edited, none deleted, no ANTHROPIC_*.
# ---------------------------------------------------------------------------
i="$work/i"
mkdir -p "$i/home/.claude" "$i/home/.claude-nine"
cat >"$i/home/.claude/settings.json" <<'JSON'
{
  "model": "opus",
  "permissions": {"defaultMode": "bypassPermissions"},
  "hooks": {"PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "echo planted"}]}]},
  "env": {"ANTHROPIC_AUTH_TOKEN": "planted-token-keep-me", "OTHER_VAR": "keep-me"}
}
JSON
cp "$i/home/.claude/settings.json" "$i/planted-claude.json"
printf '{"model":"opus"}\n' >"$i/home/.claude-nine/settings.json"
printf 'KIE_API_KEY=%s\n' "$KEY" >"$i/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$i/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$i/api-docs.md" --non-interactive \
     </dev/null >"$i/stdout.txt" 2>"$i/stderr.txt"; then
  ok "I: step exits 0 against the planted settings.json"
else
  bad "I: step exited non-zero"
fi
if clean_env python3 - "$KEY" "$i/planted-claude.json" "$i/home/.claude/settings.json" <<'PY'
import json, os, stat, sys
key, planted_path, path = sys.argv[1], sys.argv[2], sys.argv[3]
planted = json.load(open(planted_path))
after = json.load(open(path))
assert set(after) == set(planted), "top-level keys changed: %s" % (set(after) ^ set(planted),)
for k in planted:
    if k == "env":
        continue
    assert after[k] == planted[k], "top-level %r was edited or deleted" % k
p_env, a_env = planted["env"], after["env"]
for k, v in p_env.items():
    assert k in a_env, "%r was deleted" % k
    assert a_env[k] == v, "%r was edited" % k
added = set(a_env) - set(p_env)
assert added == {"KIE_API_KEY"}, "added keys beyond KIE_API_KEY: %s" % (added,)
assert a_env["KIE_API_KEY"] == key, "KIE_API_KEY holds the wrong value"
assert "ANTHROPIC_BASE_URL" not in a_env, "an ANTHROPIC_* key was written"
assert stat.S_IMODE(os.stat(path).st_mode) == 0o600, "not mode 600"
pass
PY
then
  ok "I: only env.KIE_API_KEY was added — every other line byte-identical, no ANTHROPIC_*"
else
  bad "I: the planted settings.json was touched beyond env.KIE_API_KEY"
fi

# ---------------------------------------------------------------------------
# J. declined fallback: nothing is written, the single paste line is printed
#    (placeholder, never the value), and skill 74 stays in shadow mode even
#    though the credits call would have passed.
# ---------------------------------------------------------------------------
j="$work/j"
mkdir -p "$j/home/.claude" "$j/home/.claude-nine"
printf '{"model":"opus","env":{"OTHER_VAR":"keep-me"}}\n' >"$j/home/.claude/settings.json"
cp "$j/home/.claude/settings.json" "$j/planted-claude.json"
printf '{"model":"opus"}\n' >"$j/home/.claude-nine/settings.json"
printf 'active\n' >"$j/home/.claude-nine/kie-live-adapter-mode.conf"  # must be demoted
printf 'KIE_API_KEY=%s\n' "$KEY" >"$j/api-docs.md"
start_server "{\"data\":$BALANCE}" 200

if clean_env HOME="$j/home" KIE_LIVE_API_BASE="http://127.0.0.1:$PORT" \
     bash "$STEP" --api-docs "$j/api-docs.md" --non-interactive --decline-settings-write \
     </dev/null >"$j/stdout.txt" 2>"$j/stderr.txt"; then
  ok "J: step exits 0 when the client declines the write"
else
  bad "J: step exited non-zero on decline"
fi
if grep -qF 'PASTE_YOUR_OWN_KEY' "$j/stdout.txt"; then
  ok "J: the single paste line is printed for the client"
else
  bad "J: paste line missing (got: $(tr '\n' ' ' <"$j/stdout.txt"))"
fi
if grep -qF -- "$KEY" "$j/stdout.txt" "$j/stderr.txt"; then
  bad "J: key value present in captured stdout/stderr"
else
  ok "J: key value absent from stdout and stderr"
fi
if cmp -s "$j/planted-claude.json" "$j/home/.claude/settings.json"; then
  ok "J: settings.json is byte-identical to the planted file (nothing written)"
else
  bad "J: settings.json was modified despite the decline"
fi
if [ -e "$j/home/.claude/kie-live-adapter-mode.conf" ]; then
  bad "J: a mode file was created for .claude after a declined write"
else
  ok "J: .claude mode file stays absent (shadow default) even though credits would pass"
fi
if [ "$(cat "$j/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing)" = "shadow" ]; then
  ok "J: pre-existing active demoted to shadow on a declined write"
else
  bad "J: mode file is $(cat "$j/home/.claude-nine/kie-live-adapter-mode.conf" 2>/dev/null || echo missing), expected shadow"
fi
if grep -qF 'settings write declined' "$j/stdout.txt" \
   && grep -qF 'NOT CHECKED (settings write declined)' "$j/stdout.txt"; then
  ok "J: decline is stated and the credits call is not made"
else
  bad "J: decline wording missing (got: $(tr '\n' ' ' <"$j/stdout.txt"))"
fi
if find "$j/home" -name 'settings.json.bak-kie-*' | grep -q .; then
  bad "J: a settings backup was taken despite the decline"
else
  ok "J: no backup is taken when nothing is written"
fi

printf '\nSUITES (setup-kie-live-adapter): %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
