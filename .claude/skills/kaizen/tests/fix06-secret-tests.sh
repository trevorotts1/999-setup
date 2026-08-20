#!/usr/bin/env bash
# Fix 6: secret scanning tests for validate-kaizen-memory.mjs --scan-secrets.
# All planted credentials are ASSEMBLED AT RUNTIME (printf/concatenation) —
# never written as literals, so GitHub push protection cannot trip on this file.
# Self-contained fixtures under mktemp. Never touches real ~/.claude, ~/Downloads, launchd.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAL="${SCRIPT_DIR}/../scripts/common/validate-kaizen-memory.mjs"
PASS=0; FAIL=0; FAILED_TESTS=""

t() {
  local name="$1" want="$2" got="$3"
  if [ "$want" -eq "$got" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (want exit ${want}, got ${got})"; fi
}

assert_contains() {
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (output missing: ${needle})"; fi
}

assert_not_contains() {
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qF -- "$needle"; then FAIL=$((FAIL+1)); FAILED_TESTS="${FAILED_TESTS} ${name}"; echo "FAIL: ${name} (output should NOT contain: ${needle})"; else PASS=$((PASS+1)); fi
}

# --- secret builders (runtime assembly only) ------------------------------------
chars() { # chars <count> <char>
  local i out=""
  for i in $(seq 1 "$1"); do out="${out}$2"; done
  printf '%s' "$out"
}

build_anthropic()   { printf 'sk-ant-%s' "$(chars 24 A)"; }
build_openai()      { printf 'sk-%s' "$(chars 24 K)"; }
build_openai_proj() { printf 'sk-proj-%s' "$(chars 24 P)"; }
build_github_p()    { printf 'ghp_%s' "$(chars 24 G)"; }
build_github_r()    { printf 'ghr_%s' "$(chars 24 H)"; }
build_stripe_live() { printf 'sk_live_%s' "$(chars 16 L)"; }
build_stripe_rk()   { printf 'rk_test_%s' "$(chars 16 T)"; }
build_aws()         { printf 'AKIA%s' "$(chars 16 W)"; }
build_google()      { printf 'AIza%s' "$(chars 30 Z)"; }
build_slack()       { printf '%s-%s' "xo$(printf 'x')b" "$(chars 14 S)"; }
build_bearer()      { printf 'Bearer %s' "$(chars 24 B)"; }
build_jwt()         { printf 'eyJ%s.%s.%s' "$(chars 10 a)" "$(chars 10 b)" "$(chars 10 c)"; }
build_privkey()     { printf -- '-----BEGIN %s %s %s-----' RSA PRIVATE KEY; }
build_privkey_ec()  { printf -- '-----BEGIN %s %s %s-----' EC PRIVATE KEY; }
build_oauth()       { printf 's3cret-%s' "$(chars 12 O)"; }
build_router()      { printf 'rtok-%s' "$(chars 12 R)"; }
build_password()    { printf 'pw-%s' "$(chars 12 Q)"; }
build_api_key()     { printf 'ak-%s' "$(chars 12 U)"; }
build_secret_field(){ printf 'sf-%s' "$(chars 12 V)"; }
build_url_creds()   { printf 'https://user:%s@example.com' "$(chars 8 X)"; }
build_url_param()   { printf 'https://example.com/api?api_key=%s' "$(chars 8 Y)"; }

# --- fixture builder ---------------------------------------------------------
build_fixture() {
  local d="$1"
  mkdir -p "$d/cycles" "$d/evidence"
  printf '# Kaizen Contract — My Website\n\n- **Contract version:** 1\n- **Loop ID:** loop-abc123\n' > "$d/KAIZEN_CONTRACT.md"
  printf '# Kaizen Memory\n' > "$d/KAIZEN_MEMORY.md"
  printf '# Resume\n' > "$d/RESUME.md"
  printf '# Backlog\n' > "$d/BACKLOG.md"
  printf '# Decisions\n' > "$d/DECISIONS.md"
  printf '# Cycle 001\n\n- **loop_id:** loop-abc123\n' > "$d/cycles/2026-08-20-cycle-001.md"
  cat > "$d/STATE.json" <<'EOF'
{
  "schema_version": 1,
  "loop_id": "loop-abc123",
  "status": "active",
  "contract_version": 1,
  "target": {"type": "website"},
  "direction": {"user_goal": "Make it easier to use"},
  "scope": {"max_items_per_cycle": 5},
  "permission_mode": "B",
  "proof_strategy": ["tests"],
  "schedule": {"human": "every 7 days", "mechanism": "desktop-task"},
  "model": {"launcher": "claude-nine", "logical_lane": "opus"},
  "last_cycle": {"id": "cycle-001", "completed_at": null},
  "backup": {"repo": null, "status": "none"},
  "approval": {"timestamp": "2026-08-20 10:00 UTC", "approved_by": "owner"}
}
EOF
  cat > "$d/LOCAL_STATE.json" <<'EOF'
{"schema_version": 1, "loop_id": "loop-abc123", "scheduler": {"mechanism": "launchd"}}
EOF
  printf '{"schema_version": 1, "entries": []}\n' > "$d/evidence/manifest.json"
  printf '{}\n' > "$d/notes.json"
}

run_val() {
  OUT="$(node "$VAL" "$@" 2>&1)"; RC=$?
}

plant_in_notes() { # plant_in_notes <dir> <secret>  (JSON-escaped via node)
  node -e 'const fs=require("fs");const s=process.argv[2];fs.writeFileSync(process.argv[1]+"/notes.json",JSON.stringify({note:s}));' "$1" "$2"
}

plant_field() { # plant_field <dir> <key> <secret> — structured field with that key
  node -e 'const fs=require("fs");const k=process.argv[2];const s=process.argv[3];const o={};o[k]=s;fs.writeFileSync(process.argv[1]+"/notes.json",JSON.stringify(o));' "$1" "$2" "$3"
}

# run_family <name> <secret> <expected-family-name>
run_family() {
  local name="$1" secret="$2" fam="$3"
  plant_in_notes "$D" "$secret"
  run_val "$D" --scan-secrets
  t "${name} exit" 1 $RC
  assert_contains "${name} family" "$OUT" "\"family\":\"${fam}\""
  assert_not_contains "${name} no full secret" "$OUT" "$secret"
  assert_contains "${name} redacted" "$OUT" "\"redacted\":\"${secret:0:3}"
  assert_contains "${name} line number" "$OUT" '"line":'
}

# run_field_family <name> <key> <secret> <expected-family-name>
run_field_family() {
  local name="$1" key="$2" secret="$3" fam="$4"
  plant_field "$D" "$key" "$secret"
  run_val "$D" --scan-secrets
  t "${name} exit" 1 $RC
  assert_contains "${name} family" "$OUT" "\"family\":\"${fam}\""
  assert_not_contains "${name} no full secret" "$OUT" "$secret"
  assert_contains "${name} redacted" "$OUT" "\"redacted\":\"${secret:0:3}"
  assert_contains "${name} line number" "$OUT" '"line":'
}

FIX="$(mktemp -d)"; trap 'rm -rf "$FIX"' EXIT
D="$FIX/mem"; build_fixture "$D"

# --- T01-T18: every detection family, one at a time ----------------------------
run_family "T01 anthropic"        "$(build_anthropic)"   "anthropic-api-key"
run_family "T02 openai"           "$(build_openai)"      "openai-api-key"
run_family "T03 openai proj"      "$(build_openai_proj)" "openai-api-key"
run_family "T04 github ghp"       "$(build_github_p)"    "github-token"
run_family "T05 github ghr"       "$(build_github_r)"    "github-token"
run_family "T06 stripe live"      "$(build_stripe_live)" "stripe-key"
run_family "T07 stripe rk test"   "$(build_stripe_rk)"   "stripe-key"
run_family "T08 aws access key"   "$(build_aws)"         "aws-access-key"
run_family "T09 google api key"   "$(build_google)"      "google-api-key"
run_family "T10 slack token"      "$(build_slack)"       "slack-token"
run_family "T11 bearer token"     "$(build_bearer)"      "bearer-token"
run_family "T12 jwt"              "$(build_jwt)"         "jwt"
run_family "T13 rsa private key"  "$(build_privkey)"     "private-key"
run_family "T14 ec private key"   "$(build_privkey_ec)"  "private-key"
run_field_family "T15 oauth secret"     "client_secret" "$(build_oauth)"      "oauth-client-secret"
run_field_family "T16 router token"     "ROUTER_TOKEN"  "$(build_router)"     "router-token"
run_field_family "T17 password field"   "password"      "$(build_password)"   "credential-field"
run_field_family "T18 api_key field"    "api_key"       "$(build_api_key)"    "credential-field"
run_field_family "T19 secret field"     "secret"        "$(build_secret_field)" "credential-field"
plant_in_notes "$D" "$(build_url_creds)"
run_val "$D" --scan-secrets
t "T20 url user pass exit" 1 $RC
assert_contains "T20 family" "$OUT" "url-with-credentials"
assert_not_contains "T20 no full secret" "$OUT" "$(build_url_creds)"
plant_in_notes "$D" "$(build_url_param)"
run_val "$D" --scan-secrets
t "T21 url api_key param exit" 1 $RC
assert_contains "T21 family" "$OUT" "url-with-credentials"
assert_not_contains "T21 no full secret" "$OUT" "$(build_url_param)"

# restore clean notes.json
printf '{}\n' > "$D/notes.json"
run_val "$D" --scan-secrets; t "T22 clean memory passes" 0 $RC

# --- T23: secret in STATE.json.bak MUST be caught -------------------------------
cp "$D/STATE.json" "$D/STATE.json.bak"
node -e 'const fs=require("fs");const p=process.argv[1];const s=process.argv[2];const st=JSON.parse(fs.readFileSync(p+"/STATE.json","utf8"));st.backup={"repo":s};fs.writeFileSync(p+"/STATE.json.bak",JSON.stringify(st));' "$D" "$(build_openai)"
run_val "$D" --scan-secrets
t "T23 bak exit" 1 $RC
assert_contains "T23 bak names file" "$OUT" "STATE.json.bak"
assert_contains "T23 bak family" "$OUT" "openai-api-key"
assert_not_contains "T23 bak no full secret" "$OUT" "$(build_openai)"
rm -f "$D/STATE.json.bak"

# --- T24: stale lock artifact with router token caught --------------------------
STALE="$D/.cycle-lock.json.stale-999"
node -e 'const fs=require("fs");const s=process.argv[2];fs.writeFileSync(process.argv[1],JSON.stringify({pid:1,started_at:"2026-08-20T00:00:00Z",API_TOKEN:s}));' "$STALE" "$(build_router)"
run_val "$D" --scan-secrets
t "T24 stale exit" 1 $RC
assert_contains "T24 stale names file" "$OUT" ".cycle-lock.json.stale-999"
assert_contains "T24 stale family" "$OUT" "router-token"
assert_not_contains "T24 stale no full secret" "$OUT" "$(build_router)"
rm -f "$STALE"

# --- T25: broken lock artifact caught too --------------------------------------
BROKEN="$D/.cycle-lock.json.broken-777"
node -e 'const fs=require("fs");const s=process.argv[2];fs.writeFileSync(process.argv[1],"x "+s);' "$BROKEN" "$(build_anthropic)"
run_val "$D" --scan-secrets
t "T25 broken exit" 1 $RC
assert_contains "T25 broken names file" "$OUT" ".cycle-lock.json.broken-777"
assert_contains "T25 broken family" "$OUT" "anthropic-api-key"
rm -f "$BROKEN"

# --- T26: placeholder-valued fields are NOT flagged -----------------------------
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1]+"/notes.json",JSON.stringify({api_key:"your-api-key",password:"changeme"}));' "$D"
run_val "$D" --scan-secrets; t "T26 placeholders skipped" 0 $RC

# --- T27: structured credential fields in notes.json ----------------------------
node -e 'const fs=require("fs");const s=process.argv[2];fs.writeFileSync(process.argv[1]+"/notes.json",JSON.stringify({OPENCLAW_TOKEN:s}));' "$D" "$(build_router)"
run_val "$D" --scan-secrets
t "T27 OPENCLAW_TOKEN exit" 1 $RC
assert_contains "T27 family" "$OUT" "router-token"
assert_not_contains "T27 no full secret" "$OUT" "$(build_router)"
node -e 'const fs=require("fs");const s=process.argv[2];fs.writeFileSync(process.argv[1]+"/notes.json",JSON.stringify({client_secret:s}));' "$D" "$(build_oauth)"
run_val "$D" --scan-secrets
t "T27 client_secret exit" 1 $RC
assert_contains "T27 oauth family" "$OUT" "oauth-client-secret"

# restore clean
printf '{}\n' > "$D/notes.json"
run_val "$D" --scan-secrets; t "T28 clean again" 0 $RC

echo ""
echo "fix06: PASS=${PASS} FAIL=${FAIL}"
if [ "$FAIL" -gt 0 ]; then echo "failed tests:${FAILED_TESTS}"; fi
exit "$FAIL"
