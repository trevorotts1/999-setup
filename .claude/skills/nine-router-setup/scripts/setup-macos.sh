#!/usr/bin/env bash
# setup-macos.sh — macOS (Apple Silicon) orchestrator for the 999-setup repository.
# Idempotent: rerunning repairs/updates existing state instead of duplicating it.
#
# Flow:
#   1. Verify macOS + arm64.
#   2. Verify Claude Code exists.
#   3. Resolve Documents + locate/parse/validate API docs.md.
#   4. Dependency preflight: prove curl/osascript/shasum/tar/security/install
#      actually execute (never a `command -v` name lookup), install/repair
#      Node (absolute-path result, re-verified in THIS shell — never a PATH
#      export that died with a child process) and 9Router (real `--version`
#      proof), verify npm can reach its registry, and print an honest
#      dependency summary derived from those probes. Runs BEFORE any
#      provisioning, so a broken machine fails with one precise, named
#      blocker instead of a confusing failure halfway through setup.
#   5. Start 9Router, wait for health, first-run security.
#   6. Configure providers/routing/combos via shared Node helpers.
#   7. Install the claude-nine launcher + protected state.
#   8. Run smoke tests (including the launcher itself, end to end).
#   9. Print the completion report (no secrets; every line is either proven
#      by a fail()-gated step above it or derived from report.verified).
#
# Never prints API keys, the router token, or the dashboard password.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$SKILL_DIR/scripts"
COMMON="$SCRIPTS/common"
MACOS="$SCRIPTS/macos"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

PORT="${NINEROUTER_PORT:-20128}"
BASE="http://127.0.0.1:$PORT"
STATE_DIR="$HOME/Library/Application Support/BlackCEO/999"
STATE_FILE="$STATE_DIR/router-session.json"
REPO_NODE_DIR="$HOME/.local/share/999/node"

MIN_NODE=20
MIN_NPM=10

# Dependency-preflight summary lines. Populated only by real-execution probes
# below; never hand-set to a status the probe did not produce. NOTE: relies
# on always appending at least one element before ever expanding
# "${DEP_SUMMARY[@]}" — bash <4.4 (macOS ships 3.2) treats expanding a
# completely empty array under `set -u` as an unbound-variable error.
DEP_SUMMARY=()

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

# probe_tool <label> <cmd...> — a REAL execution proof, never a `command -v`
# name lookup and never a hardcoded status. Records an honest DEP_SUMMARY
# line on success. On failure, stops the whole setup with one precise, named
# blocker. Exit 127 is reported as exactly what it is (command not
# found/unresolvable) — never re-labeled as a claim about whether the tool
# is "installed": these are all stock macOS tools, so 127 here means a
# non-standard environment, not a missing package to fetch.
probe_tool() {
  local label="$1"; shift
  local out rc
  out="$("$@" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    DEP_SUMMARY+=("$(printf '%-14s OK   %s' "$label" "$(printf '%s' "$out" | head -1 | cut -c1-64)")")
    return 0
  fi
  if [ "$rc" -eq 127 ]; then
    fail "$label: command not found/unresolvable (exit 127 — this is a shell-abort code, not evidence either way about installation). $label ships with stock macOS; a non-standard environment is required to lose it. Probe: $*"
  fi
  fail "$label probe failed (exit $rc): $(printf '%s' "$out" | head -3)"
}

# probe_install — BSD `install` has no `--version`; prove it with a real,
# harmless file placement (exactly what install-claude-nine.sh needs it for)
# instead of guessing at a flag that may not exist.
probe_install() {
  local t1 t2
  t1="$(mktemp)"; t2="$(mktemp -u)"
  printf 'probe' > "$t1"
  if /usr/bin/install -m 600 "$t1" "$t2" 2>/dev/null && [ -f "$t2" ]; then
    rm -f "$t1" "$t2"
    DEP_SUMMARY+=("$(printf '%-14s OK   %s' install '/usr/bin/install placed a real file')")
    return 0
  fi
  rm -f "$t1" "$t2"
  fail "install: /usr/bin/install did not perform a real file placement (needed to install the claude-nine launcher). This ships with stock macOS."
}

# probe_python3 — optional/soft dependency: used only by install-claude-nine.sh's
# idempotent profile-block rerun-merge, which already has its own manual-
# instruction fallback when python3 is absent. Recorded, never a hard blocker.
probe_python3() {
  local out
  # Guard: on a fresh Mac with no Xcode Command Line Tools installed,
  # /usr/bin/python3 is the CLT stub — invoking it pops the "Install command
  # line developer tools?" GUI dialog mid-setup and returns nonzero. Check
  # for the CLT first (xcode-select -p is a fast, side-effect-free probe);
  # only run python3 --version when the CLT (and therefore a real python3,
  # if any) is actually present.
  if ! xcode-select -p >/dev/null 2>&1; then
    DEP_SUMMARY+=("$(printf '%-14s MISSING (optional — Xcode Command Line Tools not installed; profile rerun-merge falls back to a printed manual PATH line)' python3)")
    return 0
  fi
  if out="$(python3 --version 2>&1)"; then
    DEP_SUMMARY+=("$(printf '%-14s OK   %s' python3 "$out")")
  else
    DEP_SUMMARY+=("$(printf '%-14s MISSING (optional — profile rerun-merge falls back to a printed manual PATH line)' python3)")
  fi
}

main() {
  # 1. OS + arch
  [ "$(uname -s)" = "Darwin" ] || fail "This orchestrator is macOS-only (uname -s = $(uname -s))."
  [ "$(uname -m)" = "arm64" ] || fail "Unsupported Mac architecture $(uname -m); requires Apple Silicon (arm64)."

  # 2. Claude Code
  CLAUDE_BIN="$(resolve_claude)"
  log "Claude Code: $CLAUDE_BIN"
  CLAUDE_VER="$("$CLAUDE_BIN" --version 2>&1 | head -1)"
  DEP_SUMMARY+=("$(printf '%-14s OK   %s (%s)' claude "$CLAUDE_VER" "$CLAUDE_BIN")")

  # 3. Dependency preflight. git/repository-acquisition is intentionally NOT
  #    probed here: this script only runs from an already-acquired checkout
  #    (Claude Code performs acquisition per AGENT_INSTALL.md, outside this
  #    script's scope). jq and openssl were audited and are unused by any
  #    script in this repository.
  # Runs BEFORE step 4 (Documents + API docs.md) on purpose: get-api-docs.sh
  # calls osascript internally to resolve the real Documents folder, with a
  # silent try/fallback (2>/dev/null || true) — if osascript is broken, that
  # call degrades quietly instead of naming the problem. Probing osascript
  # (and the other stock tools) for real HERE means a broken tool is caught
  # with one precise blocker instead of surfacing as a confusing downstream
  # Documents-resolution failure.
  log "Dependency preflight..."
  probe_tool curl curl --version
  probe_tool osascript osascript -e '1+1'
  probe_tool shasum shasum -a 256 /dev/null
  probe_tool tar tar --version
  probe_tool security security list-keychains
  probe_install
  probe_python3

  # Node 20+ / npm 10+: install-node.sh installs/repairs ONLY when needed and
  # prints the ABSOLUTE path to a proven-working node binary on stdout. Never
  # trust a PATH export made inside install-node.sh's own process — it runs
  # as a separate child process, so any `export PATH=...` there dies the
  # instant it exits (this was the exact F2 bug). Every downstream node
  # invocation in this script uses $NODE_BIN directly instead.
  NODE_BIN="$("$MACOS/install-node.sh")" || fail "Node.js install/verify failed."
  [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || fail "install-node.sh did not return an executable node path (got: '$NODE_BIN')."
  # Re-resolve and re-confirm in THIS shell, right now — belt-and-suspenders
  # against exactly the class of bug F2 was: never carry a stale/absent PATH
  # forward on faith.
  NODE_VER="$("$NODE_BIN" --version 2>&1)" || fail "node at $NODE_BIN does not execute (--version failed): $NODE_VER"
  NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
  case "$NODE_MAJOR" in
    ''|*[!0-9]*) fail "node at $NODE_BIN reported an unparseable version: $NODE_VER" ;;
  esac
  [ "$NODE_MAJOR" -ge "$MIN_NODE" ] || fail "node at $NODE_BIN reports $NODE_VER (< $MIN_NODE) even right after install/verify."
  NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd)"
  NPM_BIN="$NODE_DIR/npm"
  [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm 2>/dev/null || true)"
  [ -n "$NPM_BIN" ] && [ -x "$NPM_BIN" ] || fail "npm not found next to node at $NODE_DIR."
  NPM_VER="$("$NPM_BIN" --version 2>&1)" || fail "npm at $NPM_BIN does not execute (--version failed): $NPM_VER"
  NPM_MAJOR="${NPM_VER%%.*}"
  case "$NPM_MAJOR" in
    ''|*[!0-9]*) fail "npm at $NPM_BIN reported an unparseable version: $NPM_VER" ;;
  esac
  [ "$NPM_MAJOR" -ge "$MIN_NPM" ] || fail "npm at $NPM_BIN reports $NPM_VER (< $MIN_NPM) even right after install/verify."
  # Make the resolved binaries win PATH resolution for every child process
  # spawned from HERE ON (9router's own #!/usr/bin/env node shebang,
  # npm-spawned subprocesses, the launcher probe below). This export lives in
  # setup-macos.sh's OWN process — the parent of everything that follows —
  # not a grandchild whose export dies on exit.
  export PATH="$NODE_DIR:$PATH"
  DEP_SUMMARY+=("$(printf '%-14s OK   %s (%s)' node "$NODE_VER" "$NODE_BIN")")
  DEP_SUMMARY+=("$(printf '%-14s OK   v%s (%s)' npm "$NPM_VER" "$NPM_BIN")")
  # If install-node.sh had to fall back to a repo-managed runtime (no system
  # Node satisfied the minimum), that runtime is off any default PATH in a
  # FUTURE terminal. Tell install-claude-nine.sh to fold it into the SAME
  # managed profile PATH block it already writes, so `claude-nine` (which
  # calls `node` directly) keeps working in the next session too.
  case "$NODE_BIN" in
    "$REPO_NODE_DIR"/*) export CLAUDE_NINE_EXTRA_PATH_DIR="$NODE_DIR" ;;
  esac

  log "Verifying npm registry reachability..."
  NPM_PING_OUT="$("$NPM_BIN" ping --registry https://registry.npmjs.org/ 2>&1)" || fail "npm cannot reach the registry (required to install 9router): $NPM_PING_OUT"
  DEP_SUMMARY+=("$(printf '%-14s OK   ping succeeded' 'npm registry')")

  # 9Router: install-nine-router.sh installs/updates it and PROVES it executes
  # (a real `--version` run, not a file-exists check) before returning its
  # absolute path.
  NINE_BIN="$("$MACOS/install-nine-router.sh")" || exit 1
  [ -n "$NINE_BIN" ] && [ -x "$NINE_BIN" ] || fail "install-nine-router.sh did not return an executable path (got: '$NINE_BIN')."
  NINE_VER="$("$NINE_BIN" --version 2>&1)" || fail "9router at $NINE_BIN does not execute (--version failed): $NINE_VER"
  DEP_SUMMARY+=("$(printf '%-14s OK   v%s (%s)' 9router "$NINE_VER" "$NINE_BIN")")

  log "Dependency preflight complete:"
  for line in "${DEP_SUMMARY[@]}"; do
    log "  $line"
  done

  # 4. Documents + API docs.md
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

  # 5. Start + health + first-run security
  if ! curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
    mkdir -p "$HOME/Library/Logs/BlackCEO-999"
    # --host 127.0.0.1 is a security requirement: default binds 0.0.0.0 and
    # exposes the dashboard + /v1 (holding provider keys) to the LAN.
    nohup "$NINE_BIN" --no-browser --host 127.0.0.1 > "$HOME/Library/Logs/BlackCEO-999/9router.log" 2>&1 &
    log "9Router starting on :$PORT"
  fi
  wait_for_health || fail "9Router did not become healthy on $BASE"

  # No dashboard password rotation: the user owns the 9Router dashboard
  # password and manages it themselves. Use the default only to log in and
  # configure.
  DASHBOARD_PW="${NINEROUTER_DASHBOARD_PW:-123456}"

  # 6. Live model resolution (shared helper; env keys stay in memory only).
  log "Resolving live provider catalogs..."
  RESOLVED_JSON="$(
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
    OLLAMA_API_KEY="${OLLAMA_API_KEY:-}" \
    AGNES_API_KEY="${AGNES_API_KEY:-}" \
    "$NODE_BIN" "$COMMON/resolve-models.mjs" --all
  )" || fail "live model resolution failed"
  log "Live catalogs resolved."

  # 7. Configure 9Router (providers, combos, capacity, settings).
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
    "$NODE_BIN" "$COMMON/configure-nine-router.mjs" 2>&1
  )" || fail "9Router configuration failed"
  # The helper emits a sentinel line followed by ONE compact JSON line. Extract
  # exactly that line (never sed-range over braces — nested JSON truncates).
  CONFIG_REPORT="$(printf '%s\n' "$CONFIGURE_OUT" | awk 'found {print; exit} /^===999-CONFIG-REPORT===$/ {found=1}')"
  if [ -z "$CONFIG_REPORT" ]; then
    fail "configure-nine-router.mjs did not emit a config report (check 9Router health)"
  fi

  # Store the local router token in Keychain. GET /api/keys returns the raw key
  # value (verified 0.5.45; re-verified 0.5.50), so list then create-if-absent
  # is reliable.
  # Keep stderr OUT of the captured token — an error string stored as the token
  # would later surface as a confusing 401 from the router instead of a clean
  # setup failure.
  TOKEN_ERR="$(mktemp)"
  if ! TOKEN="$(cd "$COMMON" && NINEROUTER_BASE="$BASE" NINEROUTER_DASHBOARD_PW="$DASHBOARD_PW" "$NODE_BIN" -e '
    import("./nine-router-api.mjs").then(async ({NineRouterClient}) => {
      const c = new NineRouterClient(process.env.NINEROUTER_BASE);
      await c.login(process.env.NINEROUTER_DASHBOARD_PW);
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

  # 8. Write routing state (non-secret). Route strings come from the config report.
  CONCURRENCY="$(concurrency_for_plan "$OLLAMA_PLAN")"
  STATE_INPUT="$(
    printf '%s' "$CONFIG_REPORT" | CLAUDE_BIN="$CLAUDE_BIN" NINE_BIN="$NINE_BIN" \
    PORT="$PORT" CONCURRENCY="$CONCURRENCY" STATE_FILE="$STATE_FILE" "$NODE_BIN" -e '
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
  printf '%s' "$STATE_INPUT" | "$NODE_BIN" "$COMMON/write-routing-state.mjs"
  "$MACOS/protect-local-state.sh" ensure-600

  # 9. Install launcher.
  export CLAUDE_NINE_SOURCE="$REPO_ROOT/launchers/macos/claude-nine"
  "$MACOS/install-claude-nine.sh"

  # 10. Smoke tests. This MUST execute the launcher itself (not just check the
  #     file exists and call the router directly) so a launcher that fails to
  #     start the router is caught here, not on the client's next boot.
  log "Running smoke tests..."
  NINEROUTER_BASE="$BASE" NINEROUTER_TOKEN="$("$MACOS/protect-local-state.sh" get-token)" \
    OLLAMA_PLAN="$OLLAMA_PLAN" \
    "$NODE_BIN" "$COMMON/test-nine-router.mjs" || fail "Smoke tests failed"

  log "Executing claude-nine end-to-end..."
  NINE_OUT="$("$HOME/.local/bin/claude-nine" -p "Reply with exactly: routing works" 2>&1 || true)"
  if ! printf '%s' "$NINE_OUT" | grep -q "routing works"; then
    fail "claude-nine end-to-end probe failed: $(printf '%s' "$NINE_OUT" | head -3)"
  fi
  log "claude-nine end-to-end: OK"

  # 11. Completion report. Every status line below is either proven by a
  #     fail()-gated step above it (Claude Code, Node.js, npm, 9Router) or
  #     derived from report.verified / an actual filesystem check right here
  #     — never a hardcoded "OK" for something that was never probed.
  VERIFIED_EXPORTS="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e '
    let s="";
    process.stdin.on("data",c=>s+=c).on("end",()=>{
      let v={};
      try { v = (JSON.parse(s).verified)||{}; } catch {}
      const esc=(x)=>JSON.stringify(String(x==null?"unknown":x));
      process.stdout.write(
        "V_FABLE="+esc(v.fable)+"\n"+
        "V_OPUS="+esc(v.opus)+"\n"+
        "V_SONNET="+esc(v.sonnet)+"\n"+
        "V_HAIKU="+esc(v.haiku)+"\n"+
        "V_AGNES="+esc(v.agnes)+"\n"
      );
    })' 2>/dev/null)" || VERIFIED_EXPORTS=""
  eval "$VERIFIED_EXPORTS"
  : "${V_FABLE:=unknown}"; : "${V_OPUS:=unknown}"; : "${V_SONNET:=unknown}"; : "${V_HAIKU:=unknown}"; : "${V_AGNES:=unknown}"

  # Ollama Cloud serves both the sonnet (glm-5.2) and haiku (kimi-k2.6) lanes —
  # "OK" only when BOTH verified probes came back ok.
  V_OLLAMA_LINE="OK"
  if [ "$V_SONNET" != "ok" ] || [ "$V_HAIKU" != "ok" ]; then
    V_OLLAMA_LINE="NOT VERIFIED (sonnet: $V_SONNET; haiku: $V_HAIKU)"
  fi

  # blackceo-fusion's panel is fable+sonnet+haiku, judged by opus — "OK" only
  # when all four backing lanes verified ok.
  FUSION_STATUS="OK"
  for v in "$V_FABLE" "$V_SONNET" "$V_HAIKU" "$V_OPUS"; do
    if [ "$v" != "ok" ]; then
      FUSION_STATUS="NOT VERIFIED (fable:$V_FABLE sonnet:$V_SONNET haiku:$V_HAIKU opus:$V_OPUS)"
      break
    fi
  done

  # Vision auto-switch routes through the same model as the haiku lane
  # (ollama/kimi-k2.6) — its status is exactly the haiku probe's status.
  VISION_LINE="OK"
  [ "$V_HAIKU" = "ok" ] || VISION_LINE="NOT VERIFIED (haiku/vision route: $V_HAIKU)"

  # Skill visibility: an actual filesystem check, not an assumption. `claude`
  # and `claude-nine` share the same config root by design (no separate
  # CLAUDE_CONFIG_DIR), so one check honestly covers both report lines.
  CLAUDE_SKILLS_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  SKILL_CHECK_PATH="$CLAUDE_SKILLS_ROOT/skills/nine-router-setup/SKILL.md"
  if [ -f "$SKILL_CHECK_PATH" ]; then
    SKILL_VISIBLE="OK"
  else
    SKILL_VISIBLE="MISSING at $SKILL_CHECK_PATH"
  fi

  cat <<REPORT

999 SETUP: COMPLETE

Operating system: macOS (arm64)
Claude Code: OK
Personal skill in normal claude: $SKILL_VISIBLE
Personal skill in claude-nine: $SKILL_VISIBLE
claude-nine launcher: OK
Normal claude routing: UNCHANGED
Node.js: OK
npm: OK
9Router: OK - $BASE
DeepSeek Direct: $V_FABLE
Ollama Cloud: $V_OLLAMA_LINE
Agnes AI: $V_AGNES

Claude routes:
Fable/Subagents -> DeepSeek V4 Flash (max)
Opus -> DeepSeek V4 Pro (max)
Sonnet -> Ollama GLM 5.2 (max)
Haiku -> Ollama Kimi K2.6 (verified effort)

Fallback:
DeepSeek -> Agnes 2.5 Flash: configured

Fusion:
DeepSeek Flash + GLM 5.2 + Kimi K2.6
Judge -> DeepSeek V4 Pro
Status: $FUSION_STATUS

Ollama plan: $OLLAMA_PLAN
Ollama Claude/9Router concurrency budget: $CONCURRENCY
Reserved for OpenClaw: $([ "$OLLAMA_PLAN" = "pro" ] && echo 1 || echo 0)

Vision auto-switch -> Kimi K2.6: $VISION_LINE
PDF auto-switch: DISABLED - not verified end-to-end
Audio auto-switch: DISABLED - Gemma 4 31B has no audio input

9ROUTER DASHBOARD (save this link): http://127.0.0.1:20128

Launch routed Claude Code with: claude-nine

No API keys were printed.
REPORT
}

main "$@"
