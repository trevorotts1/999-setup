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

# HELPER INVOCATION CONVENTION: every helper in $MACOS is called through an
# explicit `bash` prefix, never executed directly. The repo's shell scripts are
# tracked mode 755 so a plain `git clone` lands them executable, but the exec bit
# is the one piece of a checkout that does NOT reliably survive every delivery
# path — a GitHub source .zip, a copy across an exFAT/SMB volume, an extraction
# under a restrictive umask, or a clone with core.fileMode=false all strip it.
# When that happens a direct `"$MACOS/foo.sh"` dies with `Permission denied`
# (exit 126) partway through provisioning. The `bash` prefix depends on the mode
# bit not at all, so the install completes either way. Every helper here carries
# `#!/usr/bin/env bash`, so running it under `bash` is exactly what its shebang
# already asks for. The .mjs helpers follow the same rule via "$NODE_BIN".

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
          OLLAMA_API_KEY|DEEPSEEK_API_KEY|AGNES_API_KEY|OPENROUTER_API_KEY|OLLAMA_PLAN|AGNES_PLAN)
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

# Link the bundled skills into one Claude config root. Idempotent: `ln -sfn`
# re-points an existing symlink instead of nesting a new one inside it, so
# re-runs converge rather than accumulate. Never creates a config root it was
# not handed — callers decide which roots are real.
link_skills_into_root() {
  local root="$1"
  local s src dst_real
  [ -n "$root" ] || return 0
  mkdir -p "$root/skills" 2>/dev/null || return 0
  for s in nine-router-setup spec-protocol; do
    src=""
    if [ -d "$REPO_SKILL_DIR/../$s" ]; then
      src="$(cd "$REPO_SKILL_DIR/../$s" && pwd -P)" || src=""
    elif [ -d "$HOME/.claude/skills/$s" ]; then
      src="$(cd "$HOME/.claude/skills/$s" && pwd -P)" || src=""
    fi
    [ -n "$src" ] || continue
    # Never point a path at itself — the shared-root case, where the source of
    # the link and its destination are the same directory.
    dst_real="$(cd "$root/skills/$s" 2>/dev/null && pwd -P)" || dst_real=""
    [ "$src" != "$dst_real" ] || continue
    if ln -sfn "$src" "$root/skills/$s" 2>/dev/null; then
      echo "skill linked: $s -> $root/skills/$s"
    fi
  done
  return 0
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
  NODE_BIN="$(bash "$MACOS/install-node.sh")" || fail "Node.js install/verify failed."
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

  # 9Router: install-nine-router.sh installs only when missing or broken;
  # existing working installs are kept as-is, and it PROVES the binary executes
  # (a real `--version` run, not a file-exists check) before returning its
  # absolute path.
  NINE_BIN="$(bash "$MACOS/install-nine-router.sh")" || exit 1
  [ -n "$NINE_BIN" ] && [ -x "$NINE_BIN" ] || fail "install-nine-router.sh did not return an executable path (got: '$NINE_BIN')."
  NINE_VER="$("$NINE_BIN" --version 2>&1)" || fail "9router at $NINE_BIN does not execute (--version failed): $NINE_VER"
  DEP_SUMMARY+=("$(printf '%-14s OK   v%s (%s)' 9router "$NINE_VER" "$NINE_BIN")")
  NINE_MODE_RAW="$(head -1 "${NINE_ROUTER_NPM_PREFIX:-$HOME/.local/share/999/npm}/last-install-mode" 2>/dev/null || true)"
  case "$NINE_MODE_RAW" in
    kept) NINE_MODE="existing install kept (no reinstall, no upgrade)" ;;
    reinstalled-broken) NINE_MODE="was present but broken - reinstalled" ;;
    fresh-install) NINE_MODE="freshly installed" ;;
    *) NINE_MODE="unknown" ;;
  esac

  log "Dependency preflight complete:"
  for line in "${DEP_SUMMARY[@]}"; do
    log "  $line"
  done

  # 4. Documents + API docs.md
  API_DOCS="$(bash "$MACOS/get-api-docs.sh")" || exit 1
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

  # OPENROUTER_API_KEY is OPTIONAL: absent/placeholder = skip the lane, never a blocker.
  case "${OPENROUTER_API_KEY:-}" in
    ""|replace_with_real_key|changeme|your-key-here) export OPENROUTER_API_KEY="" ;;
  esac
  if [ -n "${OPENROUTER_API_KEY:-}" ]; then
    log "OpenRouter: optional key found - lane will be wired"
  else
    log "OpenRouter: no OPENROUTER_API_KEY in API docs.md - lane will be skipped"
  fi

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
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
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
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
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
  # value (verified 0.5.45; re-verified 0.5.50), so list then create-if-absent
  # is reliable.
  # Keep stderr OUT of the captured token — an error string stored as the token
  # would later surface as a confusing 401 from the router instead of a clean
  # setup failure.
  TOKEN_ERR="$(mktemp)"
  if ! TOKEN="$(cd "$COMMON" && NINEROUTER_BASE="$BASE" NINEROUTER_DASHBOARD_PW="$DASHBOARD_PW" "$NODE_BIN" -e '
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

  bash "$MACOS/protect-local-state.sh" set-token "$TOKEN"
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
          effortLevel: "xhigh",
          claudeBinary: process.env.CLAUDE_BIN,
          nineRouterBinary: process.env.NINE_BIN,
          port: Number(process.env.PORT || 20128),
          tokenRef: "BlackCEO-999:9router-api-token",
        }));
      });
    '
  )"
  printf '%s' "$STATE_INPUT" | "$NODE_BIN" "$COMMON/write-routing-state.mjs"
  bash "$MACOS/protect-local-state.sh" ensure-600

  # 9. Install launchers (claude-nine, and claude-codex alongside it).
  export CLAUDE_NINE_SOURCE="$REPO_ROOT/launchers/macos/claude-nine"
  export CLAUDE_CODEX_SOURCE="$REPO_ROOT/launchers/macos/claude-codex"
  bash "$MACOS/install-claude-nine.sh"

  # 9.5. Enable Agent Teams (merge-only, backed up; never disturbs running work).
  #      Turns the experimental Agent Teams flag on in ~/.claude/settings.json and
  #      sets the tmux split-pane teammate display, for FUTURE Claude Code
  #      sessions only. The enabler backs the file up first, MERGES exactly two
  #      keys, validates the result, restores the backup on any failure, and
  #      defers anything that would disturb work that is running right now.
  #      NEVER fatal to setup: a blocked or failed enablement is reported
  #      honestly in the completion report and the rest of the install still
  #      completes (a routed Claude Code does not depend on Agent Teams).
  #      Its Phase-13 report arrives on stdout; its progress log goes to stderr
  #      and stays visible live.
  AGENT_TEAMS_REPORT=""
  AGENT_TEAMS_STATUS="SKIPPED - enable-agent-teams.sh not found"
  if [ -f "$MACOS/enable-agent-teams.sh" ]; then
    set +e
    AGENT_TEAMS_REPORT="$(NODE_BIN="$NODE_BIN" CLAUDE_BIN="$CLAUDE_BIN" bash "$MACOS/enable-agent-teams.sh")"
    AGENT_TEAMS_RC=$?
    set -e
    case "$AGENT_TEAMS_RC" in
      0) AGENT_TEAMS_STATUS="$(printf '%s\n' "$AGENT_TEAMS_REPORT" | awk '/^AGENT TEAMS:$/ { getline; print; exit }')" ;;
      1) AGENT_TEAMS_STATUS="BLOCKED - Claude Code is below the Agent Teams version floor. Nothing was modified; Claude Code was NOT updated (never automatic)." ;;
      *) AGENT_TEAMS_STATUS="NOT ENABLED - the enabler reported a tooling failure; the settings backup was restored where one existed." ;;
    esac
    [ -n "$AGENT_TEAMS_STATUS" ] || AGENT_TEAMS_STATUS="UNKNOWN (the enabler produced no status line)"
    log "Agent Teams enablement: $AGENT_TEAMS_STATUS"
  fi

  # 9.6. Clear the ultracode/effort override (detect + remediate, backed up;
  #      never disturbs running work). CLAUDE_CODE_EFFORT_LEVEL in the
  #      environment OVERRIDES the in-session /effort picker, so `/effort
  #      ultracode` snaps back to whatever the variable says. The launcher fix
  #      (v1.2.0) stopped THIS repo exporting it; it cannot reach a box where
  #      the variable comes from a shell startup file, the launchd user domain,
  #      a settings.json env map, or a parent process. This step is that reach,
  #      so a fleet roll fixes every box regardless of source.
  #      The fixer proves its own scanner on a planted control before accepting
  #      any "clean", backs every file up before editing it (never overwriting
  #      an existing backup), COMMENTS OUT offending shell lines behind a dated
  #      marker rather than deleting them, MERGE-removes only that one key from
  #      settings env maps with validation and restore-on-failure, and refuses
  #      to touch anything it cannot remediate safely — reporting the exact
  #      manual command instead. It takes effect in NEW shells and NEW sessions:
  #      nothing running is signalled, restarted, or interrupted.
  #      NEVER fatal to setup: rc 1 (a source needing one manual command) and
  #      rc 2 (a tooling failure, backups restored) are both reported honestly
  #      in the completion report and the install still completes.
  #      Its report arrives on stdout; its progress log goes to stderr.
  ULTRACODE_FIX_REPORT=""
  ULTRACODE_FIX_STATUS="SKIPPED - fix-ultracode-override.sh not found"
  if [ -f "$MACOS/fix-ultracode-override.sh" ]; then
    set +e
    ULTRACODE_FIX_REPORT="$(NODE_BIN="$NODE_BIN" bash "$MACOS/fix-ultracode-override.sh")"
    ULTRACODE_FIX_RC=$?
    set -e
    ULTRACODE_FIX_STATUS="$(printf '%s\n' "$ULTRACODE_FIX_REPORT" | awk '/^ULTRACODE OVERRIDE:$/ { getline; print; exit }')"
    [ -n "$ULTRACODE_FIX_STATUS" ] || ULTRACODE_FIX_STATUS="UNKNOWN (the fixer produced no status line, rc=$ULTRACODE_FIX_RC)"
    case "$ULTRACODE_FIX_RC" in
      0|1|2) : ;;
      *) ULTRACODE_FIX_STATUS="UNKNOWN (the fixer exited $ULTRACODE_FIX_RC, which it does not define)" ;;
    esac
    log "Ultracode override: $ULTRACODE_FIX_STATUS"
  fi

  # Extract verified-probe results from the config report NOW (moved ahead of
  # the completion report so OPENROUTER_PROBE_ROUTE is available to the smoke
  # tests below) — restructured to parse the JSON once into `rep`.
  VERIFIED_EXPORTS="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e '
    let s="";
    process.stdin.on("data",c=>s+=c).on("end",()=>{
      let rep={};
      try { rep = JSON.parse(s) || {}; } catch {}
      const v = rep.verified || {};
      const esc=(x)=>JSON.stringify(String(x==null?"unknown":x));
      process.stdout.write(
        "V_FABLE="+esc(v.fable)+"\n"+
        "V_OPUS="+esc(v.opus)+"\n"+
        "V_SONNET="+esc(v.sonnet)+"\n"+
        "V_HAIKU="+esc(v.haiku)+"\n"+
        "V_AGNES="+esc(v.agnes)+"\n"+
        "V_OPENROUTER="+esc(v.openrouter)+"\n"+
        "OPENROUTER_PROBE_ROUTE="+esc(rep.openrouterProbe||"")+"\n"
      );
    })' 2>/dev/null)" || VERIFIED_EXPORTS=""
  eval "$VERIFIED_EXPORTS"
  : "${V_FABLE:=unknown}"; : "${V_OPUS:=unknown}"; : "${V_SONNET:=unknown}"; : "${V_HAIKU:=unknown}"; : "${V_AGNES:=unknown}"; : "${V_OPENROUTER:=unknown}"
  : "${OPENROUTER_PROBE_ROUTE:=}"

  # 10. Smoke tests. This MUST execute the launcher itself (not just check the
  #     file exists and call the router directly) so a launcher that fails to
  #     start the router is caught here, not on the client's next boot.
  log "Running smoke tests..."
  NINEROUTER_BASE="$BASE" NINEROUTER_TOKEN="$(bash "$MACOS/protect-local-state.sh" get-token)" \
    OLLAMA_PLAN="$OLLAMA_PLAN" \
    OPENROUTER_PROBE_ROUTE="$OPENROUTER_PROBE_ROUTE" \
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
  #     (V_FABLE..V_OPENROUTER and OPENROUTER_PROBE_ROUTE were already
  #     extracted above, ahead of the smoke tests.)

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

  # Skill visibility: an actual filesystem check, not an assumption.
  #
  # TOPOLOGY. The shipped claude-nine launcher never sets CLAUDE_CONFIG_DIR. It
  # injects routing — base URL, Keychain token, alias exports — into the child
  # process only, and leaves the Claude config root exactly as it found it
  # (CLAUDE.md rule 10; nine-router-setup SKILL.md step 10). The config root is
  # therefore the ordinary $HOME/.claude, and that is where the skills must
  # land for a claude-nine session to see them. An operator whose own wrapper
  # exports CLAUDE_CONFIG_DIR is honored automatically by resolving from the
  # live environment, so no topology is assumed in either direction.
  CLAUDE_SKILLS_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  SKILL_CHECK_PATH="$CLAUDE_SKILLS_ROOT/skills/nine-router-setup/SKILL.md"
  REPO_SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

  # Secondary root, linked ONLY when $HOME/.claude-nine already exists as a real
  # config root — proved by its own settings.json, not by the bare directory.
  # That is an operator-style box, and linking there as well means both
  # topologies see the skills. This never CREATES the directory: conjuring
  # $HOME/.claude-nine on a box running the shipped launcher would plant a
  # false signal for anything that probes for that path to identify the harness.
  CLAUDE_SKILLS_ROOT_ALT=""
  if [ -f "$HOME/.claude-nine/settings.json" ] \
     && [ "$HOME/.claude-nine" != "$CLAUDE_SKILLS_ROOT" ]; then
    CLAUDE_SKILLS_ROOT_ALT="$HOME/.claude-nine"
  fi

  if [ ! -f "$SKILL_CHECK_PATH" ]; then
    link_skills_into_root "$CLAUDE_SKILLS_ROOT"
  fi
  if [ -n "$CLAUDE_SKILLS_ROOT_ALT" ]; then
    link_skills_into_root "$CLAUDE_SKILLS_ROOT_ALT"
  fi
  if [ -f "$SKILL_CHECK_PATH" ]; then
    SKILL_VISIBLE="OK"
  else
    SKILL_VISIBLE="MISSING at $SKILL_CHECK_PATH"
  fi

  # claude-codex launcher: a real filesystem check, never a hardcoded OK. It is
  # installed alongside claude-nine, but it pins a `cx/` Codex route and this
  # setup wires DeepSeek/Ollama/Agnes/OpenRouter only — so INSTALLED is the
  # honest claim here, and it is deliberately NOT smoke-tested end to end the way
  # claude-nine is (there is no provisioned route to test it against).
  if [ -x "$HOME/.local/bin/claude-codex" ]; then
    CODEX_LINE="INSTALLED - needs a cx/ Codex provider added in 9Router (not wired by this setup)"
  else
    CODEX_LINE="NOT INSTALLED"
  fi

  # Route strings come from the config report; fall back to the new defaults only
  # if the report lacks them (it never should after a successful configure run).
  R_FABLE="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.fable||"ds/deepseek-v4-flash(max)")}catch{process.stdout.write("ds/deepseek-v4-flash(max)")}})' 2>/dev/null || echo 'ds/deepseek-v4-flash(max)')"
  R_OPUS="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.opus||"ds-max/deepseek-v4-pro(max)")}catch{process.stdout.write("ds-max/deepseek-v4-pro(max)")}})' 2>/dev/null || echo 'ds-max/deepseek-v4-pro(max)')"
  R_SONNET="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.sonnet||"ds/deepseek-v4-flash(max)")}catch{process.stdout.write("ds/deepseek-v4-flash(max)")}})' 2>/dev/null || echo 'ds/deepseek-v4-flash(max)')"
  R_HAIKU="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.haiku||"ds-light/deepseek-v4-flash")}catch{process.stdout.write("ds-light/deepseek-v4-flash")}})' 2>/dev/null || echo 'ds-light/deepseek-v4-flash')"
  R_VISION="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s).resolvedRoutes||{};process.stdout.write(r.vision||"ollama/kimi-k2.6")}catch{process.stdout.write("ollama/kimi-k2.6")}})' 2>/dev/null || echo 'ollama/kimi-k2.6')"
  DASHBOARD_URL="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.dashboardUrl||"http://127.0.0.1:20128")}catch{process.stdout.write("http://127.0.0.1:20128")}})' 2>/dev/null || echo "http://127.0.0.1:20128")"
  # Thinking verification from the config report: one line per verified lane
  # ("verified max" / "verified off"), with downgrades surfaced as warnings.
  THINKING_LINES="$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e '
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
  if [ "$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.dashboardPasswordRotated?"true":"false")}catch{process.stdout.write("false")}})' 2>/dev/null || echo false)" = "true" ]; then
    ROTATED_NOTE="
Dashboard password: ROTATED from the default on first login (value never printed)."
  fi
  cat <<REPORT

999 SETUP: COMPLETE

Operating system: macOS (arm64)
Claude Code: OK
Personal skill in normal claude: $SKILL_VISIBLE
Personal skill in claude-nine: $SKILL_VISIBLE
claude-nine launcher: OK
claude-codex launcher: $CODEX_LINE
Normal claude routing: UNCHANGED
Node.js: OK
npm: OK
9Router: OK - $BASE ($NINE_MODE, v$NINE_VER)
DeepSeek Direct: $V_FABLE
Ollama Cloud: $V_OLLAMA_LINE
Agnes AI: $V_AGNES
OpenRouter (optional): $V_OPENROUTER

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

Vision auto-switch -> Kimi K2.6: $VISION_LINE
PDF auto-switch: DISABLED - not verified end-to-end
Audio auto-switch: DISABLED - Gemma 4 31B has no audio input

Agent Teams (experimental; applies to NEW Claude Code sessions only): $AGENT_TEAMS_STATUS
$AGENT_TEAMS_REPORT

Ultracode/effort override (applies to NEW shells and NEW sessions only): $ULTRACODE_FIX_STATUS
$ULTRACODE_FIX_REPORT

Dashboard: $DASHBOARD_URL - open this in your browser to manage providers and models.

Launch routed Claude Code with: claude-nine
(claude-codex is the same session pinned to a Codex model — add a cx/ provider first.)

No API keys or passwords were printed.
REPORT
}

main "$@"
