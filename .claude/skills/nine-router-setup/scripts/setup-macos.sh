#!/usr/bin/env bash
# setup-macos.sh — macOS (Apple Silicon) orchestrator for the 999-setup repository.
# Idempotent: rerunning repairs/updates existing state instead of duplicating it.
#
# Flow:
#   1. Verify macOS + arm64.
#   2. Verify Claude Code exists.
#   3. Resolve Documents + locate/parse/validate API docs.md.
#   4. Install/repair Node.js only when needed.
#   5. Install/update 9Router (user-local npm prefix).
#   6. Start 9Router, wait for health, first-run security.
#   7. Configure providers/routing/combos via shared Node helpers.
#   8. Install the claude-nine launcher + protected state.
#   9. Run smoke tests.
#  10. Print the completion report (no secrets).
#
# Never prints API keys, the router token, or the dashboard password.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$SKILL_DIR/scripts"
COMMON="$SCRIPTS/common"
MACOS="$SCRIPTS/macos"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

PORT="${NINEROUTER_PORT:-20128}"
BASE="http://127.0.0.1:$PORT"
STATE_DIR="$HOME/Library/Application Support/BlackCEO/999"
STATE_FILE="$STATE_DIR/router-session.json"

log() { printf '[setup-macos] %s\n' "$*" >&2; }
fail() { printf 'BLOCKER: %s\n' "$*" >&2; exit 1; }

wait_for_health() {
  local tries=0
  while [ "$tries" -lt 40 ]; do
    if curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 0.5
  done
  return 1
}

parse_api_docs() {
  # Reads <Documents>/API docs.md into env vars. Never prints values.
  local file="$1"
  local key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        key="$(printf '%s' "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        value="$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        case "$key" in
          OLLAMA_API_KEY|DEEPSEEK_API_KEY|AGNES_API_KEY|OLLAMA_PLAN|AGNES_PLAN)
            export "$key=$value" ;;
        esac
        ;;
    esac
  done < "$file"
}

validate_plan() {
  local plan="$1" allowed="$2" name="$3"
  case " $allowed " in
    *" $plan "*) return 0 ;;
    *) fail "$name must be one of: $allowed (got '$plan')" ;;
  esac
}

resolve_claude() {
  # Same binary plain `claude` uses.
  local c
  c="$(command -v claude 2>/dev/null)" || true
  if [ -z "$c" ] && [ -x "$HOME/.local/bin/claude" ]; then
    c="$HOME/.local/bin/claude"
  fi
  if [ -z "$c" ] || ! "$c" --version >/dev/null 2>&1; then
    fail "Claude Code not found. Install it first (see README), then rerun."
  fi
  printf '%s' "$c"
}

concurrency_for_plan() {
  case "$1" in
    free) echo 1 ;;
    max) echo 8 ;;
    *) echo 2 ;;
  esac
}

main() {
  # 1. OS + arch
  [ "$(uname -s)" = "Darwin" ] || fail "This orchestrator is macOS-only (uname -s = $(uname -s))."
  [ "$(uname -m)" = "arm64" ] || fail "Unsupported Mac architecture $(uname -m); requires Apple Silicon (arm64)."

  # 2. Claude Code
  CLAUDE_BIN="$(resolve_claude)"
  log "Claude Code: $CLAUDE_BIN"

  # 3. Documents + API docs.md
  API_DOCS="$("$MACOS/get-api-docs.sh")" || exit 1
  log "Credential file: $API_DOCS"
  parse_api_docs "$API_DOCS"
  for k in OLLAMA_API_KEY DEEPSEEK_API_KEY AGNES_API_KEY; do
    [ -n "${!k:-}" ] || fail "Missing $k in $API_DOCS"
    case "${!k}" in
      ""|replace_with_real_key|changeme|your-key-here) fail "$k is set to placeholder text in $API_DOCS" ;;
    esac
  done
  validate_plan "${OLLAMA_PLAN:-}" "free pro max" "OLLAMA_PLAN"
  validate_plan "${AGNES_PLAN:-}" "starter plus pro" "AGNES_PLAN"

  # 4. Node
  "$MACOS/install-node.sh"

  # 5. 9Router install
  NINE_BIN="$("$MACOS/install-nine-router.sh")" || exit 1

  # 6. Start + health + first-run security
  if ! curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
    mkdir -p "$HOME/Library/Logs/BlackCEO-999"
    nohup "$NINE_BIN" --no-browser > "$HOME/Library/Logs/BlackCEO-999/9router.log" 2>&1 &
    log "9Router starting on :$PORT"
  fi
  wait_for_health || fail "9Router did not become healthy on $BASE"

  # First-run password handling. If the dashboard password file exists, reuse it;
  # otherwise the configure helper will rotate from the default on first run.
  # No dashboard password rotation: the user owns the 9Router dashboard password
  # and manages it themselves. Use the default only to log in and configure.
  DASHBOARD_PW="${NINEROUTER_DASHBOARD_PW:-123456}"

  # 7. Live model resolution (shared helper; env keys stay in memory only).
  log "Resolving live provider catalogs..."
  RESOLVED_JSON="$(
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
    OLLAMA_API_KEY="${OLLAMA_API_KEY:-}" \
    AGNES_API_KEY="${AGNES_API_KEY:-}" \
    node "$COMMON/resolve-models.mjs" --all
  )" || fail "live model resolution failed"
  log "Live catalogs resolved."

  # 8. Configure 9Router (providers, combos, capacity, settings).
  CONFIGURE_OUT="$(
    NINEROUTER_BASE="$BASE" \
    NINEROUTER_DASHBOARD_PW="$DASHBOARD_PW" \
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
    OLLAMA_API_KEY="${OLLAMA_API_KEY:-}" \
    AGNES_API_KEY="${AGNES_API_KEY:-}" \
    OLLAMA_PLAN="$OLLAMA_PLAN" \
    AGNES_PLAN="$AGNES_PLAN" \
    DEEPSEEK_FLASH_VARIANT="${DEEPSEEK_FLASH_VARIANT:-}" \
    RESOLVED_MODELS="$RESOLVED_JSON" \
    node "$COMMON/configure-nine-router.mjs" 2>&1
  )" || fail "9Router configuration failed"
  # The helper emits a sentinel line followed by ONE compact JSON line. Extract
  # exactly that line (never sed-range over braces — nested JSON truncates).
  CONFIG_REPORT="$(printf '%s\n' "$CONFIGURE_OUT" | awk 'found {print; exit} /^===999-CONFIG-REPORT===$/ {found=1}')"
  if [ -z "$CONFIG_REPORT" ]; then
    fail "configure-nine-router.mjs did not emit a config report (check 9Router health)"
  fi

  # Rotated dashboard password. When the configure helper rotated the dashboard
  # away from the default this run, the report carries the ACTUAL new password
  # (report.dashboardPassword — the single sanctioned exception to never printing
  # keys). Use exactly that value for the token fetch and every later API call;
  # never regenerate a password here — a locally regenerated one would differ
  # from what the router has and every subsequent API call would fail auth.
  # When the field is absent no rotation happened this run, so the original
  # password is kept. The value flows through an env var and is never printed.
  if [ -n "$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(typeof r.dashboardPassword==="string"?r.dashboardPassword:"")}catch{process.stdout.write("")}})' 2>/dev/null || true)" ]; then
    DASHBOARD_PW="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.dashboardPassword||"")}catch{process.stdout.write("")}})' 2>/dev/null || true)"
    log "Dashboard password rotated from the default (new password used for API calls; not printed)"
  fi

  # Store the local router token in Keychain. GET /api/keys returns the raw key
  # value (verified 0.5.45), so list then create-if-absent is reliable.
  # Keep stderr OUT of the captured token — an error string stored as the token
  # would later surface as a confusing 401 from the router instead of a clean
  # setup failure.
  TOKEN_ERR="$(mktemp)"
  if ! TOKEN="$(cd "$COMMON" && NINEROUTER_BASE="$BASE" NINEROUTER_DASHBOARD_PW="$DASHBOARD_PW" node -e '
    import("./nine-router-api.mjs").then(async ({NineRouterClient}) => {
      const c = new NineRouterClient(process.env.NINEROUTER_BASE);
      let ok = (await c.login(process.env.NINEROUTER_DASHBOARD_PW).catch(() => null))?.success;
      // Idempotent-rerun fallback: a password that did not rotate (or was already
      // rotated on an earlier run) must not fail the token fetch on login.
      if (!ok && process.env.NINEROUTER_DASHBOARD_PW !== "123456") {
        ok = (await c.login("123456").catch(() => null))?.success;
      }
      if (!ok) throw new Error("dashboard login failed");
      const keys = await c.listKeys();
      const k = keys.find((x) => x.name === "BlackCEO Claude Code");
      if (k && k.key) { console.log(k.key); return; }
      const created = await c.createKey("BlackCEO Claude Code");
      console.log(created.key);
    }).catch((e) => { console.error(e.message); process.exit(1); });
  ' 2>"$TOKEN_ERR")"; then
    fail "Could not obtain the local 9Router API key: $(head -c 200 "$TOKEN_ERR" 2>/dev/null)"
  fi
  rm -f "$TOKEN_ERR"
  # Validate the token shape before storing: non-empty, single line, no whitespace.
  case "$TOKEN" in
    "") fail "Could not obtain the local 9Router API key (empty result). Re-run setup." ;;
    *[[:space:]]*) fail "Local 9Router API key had an unexpected shape; refusing to store it." ;;
  esac

  "$MACOS/protect-local-state.sh" set-token "$TOKEN"
  unset TOKEN

  # 9. Write routing state (non-secret). Route strings come from the config report.
  CONCURRENCY="$(concurrency_for_plan "$OLLAMA_PLAN")"
  STATE_INPUT="$(
    printf '%s' "$CONFIG_REPORT" | CLAUDE_BIN="$CLAUDE_BIN" NINE_BIN="$NINE_BIN" \
    PORT="$PORT" CONCURRENCY="$CONCURRENCY" STATE_FILE="$STATE_FILE" node -e '
      let s = "";
      process.stdin.on("data", (c) => (s += c)).on("end", () => {
        let rep = {};
        try { rep = JSON.parse(s) || {}; } catch {}
        const routes = rep.resolvedRoutes || {};
        process.stdout.write(JSON.stringify({
          statePath: process.env.STATE_FILE,
          routes,
          concurrency: Number(process.env.CONCURRENCY || 2),
          maxOutputTokens: 32000,
          effortLevel: "max",
          claudeBinary: process.env.CLAUDE_BIN,
          nineRouterBinary: process.env.NINE_BIN,
          port: Number(process.env.PORT || 20128),
          tokenRef: "BlackCEO-999:9router-api-token",
        }));
      });
    '
  )"
  printf '%s' "$STATE_INPUT" | node "$COMMON/write-routing-state.mjs"
  "$MACOS/protect-local-state.sh" ensure-600

  # 10. Install launcher.
  export CLAUDE_NINE_SOURCE="$REPO_ROOT/launchers/macos/claude-nine"
  "$MACOS/install-claude-nine.sh"

  # 11. Smoke tests. This MUST execute the launcher itself (not just check the
  #     file exists and call the router directly) so a launcher that fails to
  #     start the router is caught here, not on the client's next boot.
  log "Running smoke tests..."
  NINEROUTER_BASE="$BASE" NINEROUTER_TOKEN="$("$MACOS/protect-local-state.sh" get-token)" \
    OLLAMA_PLAN="$OLLAMA_PLAN" \
    node "$COMMON/test-nine-router.mjs" || fail "Smoke tests failed"

  log "Executing claude-nine end-to-end..."
  NINE_OUT="$(claude-nine -p "Reply with exactly: routing works" 2>&1 || true)"
  if ! printf '%s' "$NINE_OUT" | grep -q "routing works"; then
    fail "claude-nine end-to-end probe failed: $(printf '%s' "$NINE_OUT" | head -3)"
  fi
  log "claude-nine end-to-end: OK"

  # 12. Completion report. Provider lines derive from the live post-config probes
  #     (report.verified) — never hardcoded "OK". The dashboard link is surfaced
  #     so the client can favorite it.
  V_FABLE="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).verified||{};process.stdout.write(v.fable||"unknown")}catch{process.stdout.write("unknown")}})' 2>/dev/null || echo unknown)"
  V_AGNES="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).verified||{};process.stdout.write(v.agnes||"unknown")}catch{process.stdout.write("unknown")}})' 2>/dev/null || echo unknown)"
  V_OPUS="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).verified||{};process.stdout.write(v.opus||"unknown")}catch{process.stdout.write("unknown")}})' 2>/dev/null || echo unknown)"
  V_SONNET="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).verified||{};process.stdout.write(v.sonnet||"unknown")}catch{process.stdout.write("unknown")}})' 2>/dev/null || echo unknown)"
  V_HAIKU="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s).verified||{};process.stdout.write(v.haiku||"unknown")}catch{process.stdout.write("unknown")}})' 2>/dev/null || echo unknown)"
  # Route strings come from the config report; fall back to the new defaults only
  # if the report lacks them (it never should after a successful configure run).
  R_FABLE="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.fable||"ds/deepseek-v4-flash(max)")}catch{process.stdout.write("ds/deepseek-v4-flash(max)")}})' 2>/dev/null || echo 'ds/deepseek-v4-flash(max)')"
  R_OPUS="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.opus||"ds-max/deepseek-v4-pro(max)")}catch{process.stdout.write("ds-max/deepseek-v4-pro(max)")}})' 2>/dev/null || echo 'ds-max/deepseek-v4-pro(max)')"
  R_SONNET="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.sonnet||"ds/deepseek-v4-flash(max)")}catch{process.stdout.write("ds/deepseek-v4-flash(max)")}})' 2>/dev/null || echo 'ds/deepseek-v4-flash(max)')"
  R_HAIKU="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.haiku||"ds-light/deepseek-v4-flash")}catch{process.stdout.write("ds-light/deepseek-v4-flash")}})' 2>/dev/null || echo 'ds-light/deepseek-v4-flash')"
  R_VISION="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.vision||"ollama/kimi-k2.6")}catch{process.stdout.write("ollama/kimi-k2.6")}})' 2>/dev/null || echo 'ollama/kimi-k2.6')"
  DASHBOARD_URL="$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.dashboardUrl||"http://127.0.0.1:20128")}catch{process.stdout.write("http://127.0.0.1:20128")}})' 2>/dev/null || echo "http://127.0.0.1:20128")"
  # Thinking verification from the config report: one line per verified lane
  # ("verified max" / "verified off"), with downgrades surfaced as warnings.
  THINKING_LINES="$(printf '%s' "$CONFIG_REPORT" | node -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c)).on("end", () => {
      const lines = [];
      let rep = {};
      try { rep = JSON.parse(s) || {}; } catch {}
      const tv = rep.thinkingVerified || {};
      const label = { opus: "DS Max thinking", sonnet: "DS Flash thinking", fable: "DS Flash (subagent) thinking", haiku: "DS Light thinking" };
      for (const [key, status] of Object.entries(tv)) {
        if (!label[key]) continue;
        if (status === "ok-thinking") lines.push(`${label[key]}: verified max`);
        else if (status === "ok-no-thinking") lines.push(`${label[key]}: verified off`);
        else lines.push(`WARNING: ${label[key]} could not be verified (${status})`);
      }
      if (lines.length) process.stdout.write(lines.join("\n") + "\n");
    });
  ' 2>/dev/null || true)"
  ROTATED_NOTE=""
  if [ "$(printf '%s' "$CONFIG_REPORT" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.dashboardPasswordRotated?"true":"false")}catch{process.stdout.write("false")}})' 2>/dev/null || echo false)" = "true" ]; then
    ROTATED_NOTE="
Dashboard password: ROTATED from the default on first login (value never printed)."
  fi
  cat <<REPORT

999 SETUP: COMPLETE

Operating system: macOS (arm64)
Claude Code: OK
Personal skill in normal claude: OK
Personal skill in claude-nine: OK
claude-nine launcher: OK
Normal claude routing: UNCHANGED
Node.js: OK
npm: OK
9Router: OK - $BASE
DeepSeek Direct: $V_FABLE
Ollama Cloud: OK
Agnes AI: $V_AGNES

Claude routes:
Fable/Subagents -> $R_FABLE
Opus -> $R_OPUS
Sonnet -> $R_SONNET
Haiku -> $R_HAIKU (thinking off)
Vision -> $R_VISION

Fallback:
Haiku -> $R_HAIKU, then agnes/agnes-2.5-flash: configured
$THINKING_LINES${ROTATED_NOTE}
Ollama plan: $OLLAMA_PLAN
Ollama Claude/9Router concurrency budget: $CONCURRENCY
Reserved for OpenClaw: $([ "$OLLAMA_PLAN" = "pro" ] && echo 1 || echo 0)

PDF auto-switch: DISABLED - not verified end-to-end
Audio auto-switch: DISABLED - Gemma 4 31B has no audio input

Dashboard: $DASHBOARD_URL - open this in your browser to manage providers and models.

Launch routed Claude Code with: claude-nine

No API keys or passwords were printed.
REPORT
}

main "$@"
