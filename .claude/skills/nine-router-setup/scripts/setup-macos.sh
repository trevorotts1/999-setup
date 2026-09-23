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
#   8. Run smoke tests (including the launcher itself, end to end), then
#      register spec-protocol's hooks, default claude-nine to ultracode,
#      record the operator backup owner (only if given), and sign in to GitHub.
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

# require_clt (fix #33) — Xcode Command Line Tools are REQUIRED: spec-protocol's
# tools and enforcement hooks run on git and python3, and on a fresh Mac both
# are CLT stubs until the CLT is installed. Not needed to fetch this repo (the
# curl+tar bootstrap stays CLT-free); needed to USE what it installs.
# `xcode-select --install` opens Apple's installer dialog; wait for it (bounded),
# then prove git and python3 by real execution.
require_clt() {
  local waited=0
  if ! xcode-select -p >/dev/null 2>&1; then
    log "Xcode Command Line Tools are required (git, python3). Opening Apple's installer — click Install and wait for it to finish."
    xcode-select --install >/dev/null 2>&1 || true
    while ! xcode-select -p >/dev/null 2>&1; do
      [ "$waited" -lt 3600 ] || fail "Xcode Command Line Tools were not installed within 60 minutes. Finish Apple's installer (or run: xcode-select --install), then rerun setup."
      sleep 15; waited=$((waited + 15))
    done
  fi
  probe_tool git git --version
  probe_tool python3 python3 --version
}

# ensure_gh (fix #33) — GitHub CLI, used for the one-click GitHub sign-in that
# keeps a client's work backed up online. Homebrew when present, otherwise the
# official release zip from github.com/cli/cli into $HOME/.local/bin (Homebrew
# is never a prerequisite — CLAUDE.md rule 11). Never fatal: without gh the
# build still runs and anchors locally (spec-protocol repo-anchor local-only),
# so a failure is reported BY NAME in the dependency summary.
ensure_gh() {
  local v tmp why=""
  export PATH="$HOME/.local/bin:$PATH"
  if ! gh --version >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew install gh >&2 || why="brew install gh failed"
    else
      tmp="$(mktemp -d)"
      v="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest 2>/dev/null)"; v="${v##*/v}"
      if [ -n "$v" ] \
         && curl -fsSL "https://github.com/cli/cli/releases/download/v${v}/gh_${v}_macOS_arm64.zip" -o "$tmp/gh.zip" \
         && unzip -q "$tmp/gh.zip" -d "$tmp" \
         && mkdir -p "$HOME/.local/bin" \
         && install -m 755 "$tmp/gh_${v}_macOS_arm64/bin/gh" "$HOME/.local/bin/gh"; then :
      else
        why="official gh release download failed (version '${v:-unresolved}')"
      fi
      rm -rf "$tmp"
    fi
  fi
  if gh --version >/dev/null 2>&1; then
    DEP_SUMMARY+=("$(printf '%-14s OK   %s' gh "$(gh --version 2>&1 | head -1)")")
  else
    DEP_SUMMARY+=("$(printf '%-14s MISSING — %s; GitHub backup will run local-only until gh is installed (https://cli.github.com)' gh "${why:-gh did not execute after install}")")
  fi
}

# Link the bundled skills into one Claude config root. Idempotent: re-runs
# converge to exactly one current link per manifest skill — an existing link
# to the SAME source is left alone ("up to date"), a stale link is removed
# (the link only, never its target) and recreated, and an existing REAL
# directory is moved to an EXTERNAL timestamped backup
# ($HOME/.claude-skill-backups/<skill>.<timestamp>, never inside any Claude
# config root) that is verified to exist BEFORE the fresh link is created.
# Missing sources fail per-skill with a clear error; other skills continue
# and the function returns the failure count (nonzero = at least one failed).
# Never creates a config root it was not handed — callers decide which roots
# are real.
#
# The skill list comes from CONTROL/bundled-skills.txt (one skill per line,
# # and blank lines ignored) when running from a repo checkout; standalone
# installs (no repo above the skill) fall back to the hard-coded baseline.
bundled_skills() {
  local manifest=""
  [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/CONTROL/bundled-skills.txt" ] \
    && manifest="$REPO_ROOT/CONTROL/bundled-skills.txt"
  if [ -n "$manifest" ]; then
    sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
      -e '/^$/d' "$manifest"
  else
    printf '%s\n' nine-router-setup spec-protocol kaizen eli5 bro
  fi
}

# resolve_skill_source <name> — absolute physical path of the repo skill dir
# (or the already-installed ~/.claude copy as a standalone fallback); empty
# when the manifest skill has no source on this box.
resolve_skill_source() {
  local s="$1"
  if [ -d "$REPO_SKILL_DIR/../$s/SKILL.md" ] || [ -f "$REPO_SKILL_DIR/../$s/SKILL.md" ]; then
    (cd "$REPO_SKILL_DIR/../$s" 2>/dev/null && pwd -P) || true
  elif [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then
    (cd "$HOME/.claude/skills/$s" 2>/dev/null && pwd -P) || true
  fi
}

# link_one_skill <src> <dst> <name> — converge ONE skill to a link at <dst>
# pointing at physical <src>. Order of operations is load-bearing:
#   up-to-date check -> backup real dir EXTERNALLY -> VERIFY backup ->
#   replace. An existing destination is never deleted before its backup is
#   proven to exist. A symlink is removed as a link only (never rm -rf, never
#   its target). Prints one status line per skill; returns 1 on failure.
# Sourced by the fixture tests and called directly with fixture paths.
link_one_skill() {
  local src="$1" dst="$2" name="$3"
  local dst_real ts backup
  [ -n "$src" ] && [ -n "$dst" ] && [ -n "$name" ] || {
    echo "skill ERROR: $name: internal missing src/dst/name" >&2; return 1; }
  dst_real="$(cd -P "$dst" 2>/dev/null && pwd -P)" || dst_real=""
  if [ -n "$dst_real" ] && [ "$dst_real" = "$src" ]; then
    echo "skill up to date: $name -> $dst"
    return 0
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    if [ -L "$dst" ]; then
      rm -f "$dst" || { echo "skill ERROR: $name: could not remove stale link at $dst" >&2; return 1; }
    else
      ts="$(date +%Y%m%dT%H%M%S)"
      backup="$HOME/.claude-skill-backups/$name.$ts"
      mkdir -p "$HOME/.claude-skill-backups" || { echo "skill ERROR: $name: could not create backup parent $HOME/.claude-skill-backups" >&2; return 1; }
      mv "$dst" "$backup" || { echo "skill ERROR: $name: could not move $dst to $backup" >&2; return 1; }
      if [ ! -d "$backup" ]; then
        echo "skill ERROR: $name: backup verification failed for $backup; leaving everything intact" >&2
        return 1
      fi
      echo "skill backed up: $name: $dst -> $backup"
    fi
  fi
  mkdir -p "$(dirname "$dst")" 2>/dev/null || true
  if ! ln -sfn "$src" "$dst"; then
    echo "skill ERROR: $name: link creation failed for $dst -> $src" >&2
    return 1
  fi
  if [ ! -f "$dst/SKILL.md" ]; then
    echo "skill ERROR: $name: linked but SKILL.md missing at $dst" >&2
    return 1
  fi
  # Never create a nested skills/<name>/<name>: the link must resolve straight
  # to the source, with no same-named child directory at the destination.
  dst_real="$(cd -P "$dst" 2>/dev/null && pwd -P)" || dst_real=""
  if [ "$dst_real" != "$src" ] || [ -d "$dst/$name" ]; then
    echo "skill ERROR: $name: post-link assertion failed (dest resolves to '$dst_real', expected '$src'; nested '$dst/$name' present: $([ -d "$dst/$name" ] && echo yes || echo no))" >&2
    return 1
  fi
  echo "skill linked: $name -> $dst"
  return 0
}

link_skills_into_root() {
  local root="$1"
  local s src dst failures=0
  [ -n "$root" ] || return 0
  mkdir -p "$root/skills" 2>/dev/null || return 0
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    src="$(resolve_skill_source "$s")"
    if [ -z "$src" ]; then
      echo "skill ERROR: $s: no source found (manifest skill absent from repo and ~/.claude/skills)" >&2
      failures=$((failures + 1))
      continue
    fi
    dst="$root/skills/$s"
    # Never point a path at itself — the shared-root case, where the source of
    # the link and its destination are the same directory.
    [ "$src" != "$dst" ] || { echo "skill up to date: $s -> $dst"; continue; }
    link_one_skill "$src" "$dst" "$s" || failures=$((failures + 1))
  done < <(bundled_skills)
  return "$failures"
}

# Fix #52: the claude-nine launcher sources claude-code-lib.sh from its own
# directory, refuses to start without $HOME/.claude-nine/settings.json, and
# that settings file names get-9router-key.sh as its apiKeyHelper. Install
# both helpers next to the launcher ($HOME/.local/bin, where
# install-claude-nine.sh puts it).
install_launcher_support() {
  local f
  mkdir -p "$HOME/.local/bin"
  for f in claude-code-lib.sh get-9router-key.sh; do
    [ -f "$REPO_ROOT/launchers/macos/$f" ] || fail "launcher helper missing from the repo: launchers/macos/$f"
    install -m 755 "$REPO_ROOT/launchers/macos/$f" "$HOME/.local/bin/$f"
  done
  # The launcher re-applies the 9Router catalog fix on every launch.
  install -m 644 "$COMMON/fix-9router-catalog.mjs" "$HOME/.local/bin/fix-9router-catalog.mjs"
  log "installed claude-code-lib.sh, get-9router-key.sh and fix-9router-catalog.mjs in $HOME/.local/bin"
}

# Create $HOME/.claude-nine/settings.json ONLY when absent (never overwrites a
# user's file). Lane pins come from the configure report's resolvedRoutes (the
# routes this run actually built — references/model-routing.md); output and
# tool-concurrency caps follow model-routing.md's policy. The context cap is
# 1M (DeepSeek V4). Reads the config report on stdin. No secret is written:
# the token stays in the Keychain, fetched by the apiKeyHelper.
write_nine_settings() {
  local dir="$HOME/.claude-nine"
  if [ -f "$dir/settings.json" ]; then
    log "claude-nine settings.json already present — left untouched"
    return 0
  fi
  mkdir -p "$dir"
  SETTINGS_OUT="$dir/settings.json" HELPER="$HOME/.local/bin/get-9router-key.sh" \
  PORT="$PORT" CONCURRENCY="$1" "$NODE_BIN" -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c)).on("end", () => {
      const r = (JSON.parse(s) || {}).resolvedRoutes || {};
      for (const k of ["fable", "opus", "sonnet", "haiku", "subagent"]) {
        if (!r[k]) { console.error("config report has no " + k + " route"); process.exit(1); }
      }
      const out = {
        apiKeyHelper: process.env.HELPER,
        model: "opus",
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:" + process.env.PORT + "/v1",
          ANTHROPIC_DEFAULT_FABLE_MODEL: r.fable,
          ANTHROPIC_DEFAULT_OPUS_MODEL: r.opus,
          ANTHROPIC_DEFAULT_SONNET_MODEL: r.sonnet,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: r.haiku,
          CLAUDE_CODE_SUBAGENT_MODEL: r.subagent,
          CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000",
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
          CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: String(process.env.CONCURRENCY || 2),
        },
      };
      require("fs").writeFileSync(process.env.SETTINGS_OUT, JSON.stringify(out, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    });
  ' || fail "could not create $dir/settings.json"
  log "created $dir/settings.json (routes from this run, key via Keychain helper)"
}

# set_operator_key <config-root> <KEY> <value> — merge ONE key into
# <root>/spec-protocol/operator.env: other keys are kept, an older value of
# this key is replaced, the file stays mode 600 (written via a 600 temp file
# and renamed). Never prints the value.
set_operator_key() {
  local f="$1/spec-protocol/operator.env" tmp
  mkdir -p "$1/spec-protocol" || return 1
  tmp="$(mktemp "$f.XXXXXX")" || return 1
  chmod 600 "$tmp"
  { if [ -f "$f" ]; then grep -v "^$2=" "$f" || true; fi; printf '%s=%s\n' "$2" "$3"; } > "$tmp" && mv "$tmp" "$f"
}

main() {
  # Optional: the operator's GitHub org for client backups (fix #6). Taken ONLY
  # from --operator-remote-owner <org> or SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER;
  # never guessed. Validated as a GitHub owner name before anything is written.
  OPERATOR_REMOTE_OWNER="${SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER:-}"
  # Operator secrets come from the ENVIRONMENT only (never a flag: argv is
  # visible to every process on the machine). Written to operator.env (mode
  # 600) only when supplied; never printed, never guessed.
  OPERATOR_GH_TOKEN="${SPEC_PROTOCOL_OPERATOR_GH_TOKEN:-}"
  OPERATOR_VERCEL_TOKEN="${VERCEL_TOKEN:-}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --operator-remote-owner) OPERATOR_REMOTE_OWNER="${2:-}"; shift ;;
      --operator-remote-owner=*) OPERATOR_REMOTE_OWNER="${1#*=}" ;;
      *) fail "unknown argument: $1 (the only option is --operator-remote-owner <github-org>)" ;;
    esac
    shift
  done
  case "$OPERATOR_REMOTE_OWNER" in
    "") ;;
    -*|*[!A-Za-z0-9-]*) fail "--operator-remote-owner must be a GitHub user or org name (letters, digits, hyphens); got '$OPERATOR_REMOTE_OWNER'" ;;
  esac
  case "$OPERATOR_GH_TOKEN$OPERATOR_VERCEL_TOKEN" in
    *[[:space:]]*) fail "SPEC_PROTOCOL_OPERATOR_GH_TOKEN / VERCEL_TOKEN must be a single token with no spaces or line breaks (value not shown)" ;;
  esac

  # 1. OS + arch
  [ "$(uname -s)" = "Darwin" ] || fail "This orchestrator is macOS-only (uname -s = $(uname -s))."
  [ "$(uname -m)" = "arm64" ] || fail "Unsupported Mac architecture $(uname -m); requires Apple Silicon (arm64)."

  # 2. Claude Code
  CLAUDE_BIN="$(resolve_claude)"
  log "Claude Code: $CLAUDE_BIN"
  CLAUDE_VER="$("$CLAUDE_BIN" --version 2>&1 | head -1)"
  DEP_SUMMARY+=("$(printf '%-14s OK   %s (%s)' claude "$CLAUDE_VER" "$CLAUDE_BIN")")

  # 3. Dependency preflight. Repository ACQUISITION is not this script's job
  #    (Claude Code performs it per AGENT_INSTALL.md), but git and python3 are
  #    required to RUN spec-protocol, so require_clt proves both below.
  #    jq and openssl were audited and are unused by any script in this
  #    repository.
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
  require_clt
  ensure_gh

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
  # Correct 9Router's catalog limits (DeepSeek V4 Flash 1M context) BEFORE the
  # router starts, so no restart is needed. A router that is already running
  # keeps its loaded catalog, so leave it: the claude-nine launcher applies the
  # fix and restarts the router on its next launch. Never fatal.
  if ! curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
    CAT_RC=0
    "$NODE_BIN" "$COMMON/fix-9router-catalog.mjs" >&2 || CAT_RC=$?
    case "$CAT_RC" in
      0|10) DEP_SUMMARY+=("$(printf '%-14s OK   catalog limits correct' '9router fix')") ;;
      *) DEP_SUMMARY+=("$(printf '%-14s WARN catalog fix undetermined (exit %s) - see above' '9router fix' "$CAT_RC")") ;;
    esac
  fi

  # Vercel CLI, for publishing the finished product. Installed into the SAME
  # npm prefix as 9Router (spec-protocol's publish.sh looks there, then falls
  # back to `npx vercel`). Never fatal: publishing reports HOSTING-BLOCKED
  # by name when the CLI is missing.
  NINE_PREFIX="${NINE_ROUTER_NPM_PREFIX:-$HOME/.local/share/999/npm}"
  VERCEL_BIN="$NINE_PREFIX/bin/vercel"
  if ! "$VERCEL_BIN" --version >/dev/null 2>&1; then
    log "Installing the Vercel CLI into $NINE_PREFIX..."
    "$NPM_BIN" install -g --prefix "$NINE_PREFIX" vercel@latest >&2 || true
  fi
  if VERCEL_VER="$("$VERCEL_BIN" --version 2>/dev/null | tail -1)" && [ -n "$VERCEL_VER" ]; then
    DEP_SUMMARY+=("$(printf '%-14s OK   %s (%s)' vercel "$VERCEL_VER" "$VERCEL_BIN")")
  else
    DEP_SUMMARY+=("$(printf '%-14s MISSING — npm install -g --prefix %s vercel@latest failed; publishing falls back to npx vercel' vercel "$NINE_PREFIX")")
  fi

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
  # SETUP_ROUTER_PID is set ONLY when this run started the router; the smoke
  # test stops exactly that router to prove the launcher's cold start.
  SETUP_ROUTER_PID=""
  if ! curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
    mkdir -p "$HOME/Library/Logs/BlackCEO-999"
    # --host 127.0.0.1 is a security requirement: default binds 0.0.0.0 and
    # exposes the dashboard + /v1 (holding provider keys) to the LAN.
    nohup "$NINE_BIN" --no-browser --host 127.0.0.1 > "$HOME/Library/Logs/BlackCEO-999/9router.log" 2>&1 &
    SETUP_ROUTER_PID=$!
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

  # No dashboard password rotation: the configure helper never changes the
  # password, so DASHBOARD_PW stays whatever was passed in (default 123456).
  # The report's mustChangePassword flag is advisory messaging only.

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
          concurrency: Number(process.env.CONCURRENCY || 10),
          maxOutputTokens: 32000,
          effortLevel: "xhigh",
          lastEffortSelection: null,
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
  install_launcher_support
  printf '%s' "$CONFIG_REPORT" | write_nine_settings "$CONCURRENCY"

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

  # COLD START. A router that setup itself started would mask a launcher that
  # cannot start one after a reboot. Stop ONLY the router this run started
  # (a router that was already running before setup is left alone), so the
  # probe below has to bring it up the way the client's next boot will.
  COLD_START_LINE="not re-proven (9Router was already running before setup; it was left alone)"
  if [ -n "$SETUP_ROUTER_PID" ]; then
    log "Stopping the router this setup started, to prove claude-nine cold-starts it..."
    kill "$SETUP_ROUTER_PID" $(/usr/sbin/lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null) 2>/dev/null || true
    for _ in $(seq 1 40); do
      /usr/bin/nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if /usr/bin/nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
      fail "could not stop the 9Router this setup started (port $PORT still listening), so the cold-start probe cannot run"
    fi
    COLD_START_LINE="OK (claude-nine started 9Router itself)"
  fi

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
  # TOPOLOGY. The shipped claude-nine launcher sets CLAUDE_CONFIG_DIR to
  # ${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}; routing (base URL, apiKeyHelper
  # for the Keychain token, lane pins) lives in that root's settings.json,
  # which step 9 above creates when absent. Plain `claude` keeps the ordinary
  # $HOME/.claude, so the skills are linked there first, and into
  # $HOME/.claude-nine as the secondary root below. A CLAUDE_CONFIG_DIR in the
  # live environment is honored as the primary root.
  CLAUDE_SKILLS_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  REPO_SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  # The config dir the shipped claude-nine launcher uses.
  NINE_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}"

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

  # Always link (idempotent): a re-run on an already-provisioned box must still
  # pick up bundled skills added after the first install. The linker reports
  # per-skill failures itself and returns the failure count; never fatal here
  # (a missing manifest source must not block the rest of setup).
  SKILL_LINK_FAILURES=0
  link_skills_into_root "$CLAUDE_SKILLS_ROOT" || SKILL_LINK_FAILURES=$?
  if [ -n "$CLAUDE_SKILLS_ROOT_ALT" ]; then
    link_skills_into_root "$CLAUDE_SKILLS_ROOT_ALT" || SKILL_LINK_FAILURES=$((SKILL_LINK_FAILURES + $?))
  fi
  if [ "$SKILL_LINK_FAILURES" -gt 0 ]; then
    SKILL_LINK_STATUS="WARNING: $SKILL_LINK_FAILURES skill link failure(s) - see 'skill ERROR' lines above"
  else
    SKILL_LINK_STATUS="OK"
  fi
  SKILL_MISSING=""
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    if [ ! -f "$CLAUDE_SKILLS_ROOT/skills/$s/SKILL.md" ]; then
      SKILL_MISSING="${SKILL_MISSING:+$SKILL_MISSING, }$s"
    fi
  done < <(bundled_skills)
  if [ -z "$SKILL_MISSING" ]; then
    SKILL_VISIBLE="OK"
  else
    SKILL_VISIBLE="MISSING: $SKILL_MISSING"
  fi
  # claude-nine reads skills from ITS OWN root — check that root, not the
  # plain-claude one.
  NINE_SKILL_MISSING=""
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    [ -f "$NINE_ROOT/skills/$s/SKILL.md" ] || NINE_SKILL_MISSING="${NINE_SKILL_MISSING:+$NINE_SKILL_MISSING, }$s"
  done < <(bundled_skills)
  NINE_SKILL_VISIBLE="OK"
  [ -z "$NINE_SKILL_MISSING" ] || NINE_SKILL_VISIBLE="MISSING in $NINE_ROOT: $NINE_SKILL_MISSING"
  # Per-skill visibility from the actual filesystem (OK/MISSING per manifest
  # entry), and the linker's own failure summary (Fix 10 idempotency report).
  SKILL_VISIBLE_DETAIL=""
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    if [ -f "$CLAUDE_SKILLS_ROOT/skills/$s/SKILL.md" ]; then
      SKILL_VISIBLE_DETAIL="${SKILL_VISIBLE_DETAIL}  $s: OK
"
    else
      SKILL_VISIBLE_DETAIL="${SKILL_VISIBLE_DETAIL}  $s: MISSING
"
    fi
  done < <(bundled_skills)

  # 9.7 spec-protocol enforcement, operator remote, ultracode default, GitHub
  #     sign-in. All AFTER the claude-nine smoke probe above, so the probe runs
  #     exactly as before.
  #
  #     NINE_ROOT (set above) is the config dir the shipped claude-nine
  #     launcher uses (${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}).

  #     (a) Hooks (fix #1): copy + MERGE-register spec-protocol's four
  #     enforcement hooks into each root that already holds a settings.json
  #     chain (the same two roots the skills were linked into). install-hooks.sh
  #     backs settings.json up first and keeps every existing entry. The
  #     claude-nine root's settings.json already exists here (step 9 creates
  #     it when absent), so the hooks merge into it; install-hooks.sh itself
  #     never creates one. Never fatal.
  HOOKS_DETAIL=""
  HOOKS_STATUS="OK"
  SPEC_SRC="$(resolve_skill_source spec-protocol)"
  if [ -z "$SPEC_SRC" ] || [ ! -f "$SPEC_SRC/tools/install-hooks.sh" ]; then
    HOOKS_STATUS="NOT INSTALLED - spec-protocol tools/install-hooks.sh not found"
  else
    while IFS= read -r root; do
      [ -n "$root" ] || continue
      set +e
      HOOKS_OUT="$(bash "$SPEC_SRC/tools/install-hooks.sh" --root "$root" 2>&1)"
      HOOKS_RC=$?
      set -e
      HOOKS_DETAIL="${HOOKS_DETAIL}$(printf '%s\n' "$HOOKS_OUT" | sed 's/^/  /')
"
      [ "$HOOKS_RC" -eq 0 ] || HOOKS_STATUS="WARNING: install-hooks.sh exited $HOOKS_RC for at least one root - see below"
    done < <(printf '%s\n' "$CLAUDE_SKILLS_ROOT" ${CLAUDE_SKILLS_ROOT_ALT:+"$CLAUDE_SKILLS_ROOT_ALT"})
  fi
  log "spec-protocol hooks: $HOOKS_STATUS"

  #     (b) Operator keys (fix #6, A6): each recorded ONLY when the operator
  #     supplied it; a key not supplied on this run keeps whatever an earlier
  #     run wrote. operator.env is mode 600; values are never printed.
  #       SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER  backup org (repo-anchor)
  #       SPEC_PROTOCOL_OPERATOR_GH_TOKEN      token for that org (repo-anchor)
  #       VERCEL_TOKEN                         publishing (publish.sh)
  OPERATOR_REMOTE_LINE="not supplied (builds keep work local-only when GitHub sign-in is declined)"
  OPERATOR_KEYS_LINE=""
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    [ -z "$OPERATOR_REMOTE_OWNER" ] || set_operator_key "$root" SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER "$OPERATOR_REMOTE_OWNER"
    [ -z "$OPERATOR_GH_TOKEN" ] || set_operator_key "$root" SPEC_PROTOCOL_OPERATOR_GH_TOKEN "$OPERATOR_GH_TOKEN"
    [ -z "$OPERATOR_VERCEL_TOKEN" ] || set_operator_key "$root" VERCEL_TOKEN "$OPERATOR_VERCEL_TOKEN"
  done < <(printf '%s\n' "$CLAUDE_SKILLS_ROOT" "$NINE_ROOT" | awk '!seen[$0]++')
  [ -z "$OPERATOR_REMOTE_OWNER" ] || OPERATOR_REMOTE_LINE="$OPERATOR_REMOTE_OWNER (spec-protocol/operator.env in $CLAUDE_SKILLS_ROOT and $NINE_ROOT)"
  [ -z "$OPERATOR_GH_TOKEN" ] || OPERATOR_KEYS_LINE="SPEC_PROTOCOL_OPERATOR_GH_TOKEN"
  [ -z "$OPERATOR_VERCEL_TOKEN" ] || OPERATOR_KEYS_LINE="${OPERATOR_KEYS_LINE:+$OPERATOR_KEYS_LINE, }VERCEL_TOKEN"
  OPERATOR_KEYS_LINE="${OPERATOR_KEYS_LINE:-none supplied on this run} (values never shown)"
  unset OPERATOR_GH_TOKEN OPERATOR_VERCEL_TOKEN

  #     (c) Ultracode on by default (fix #8): the launcher re-applies
  #     `--effort ultracode` whenever <config dir>/.last-effort reads
  #     "ultracode", so the client's first session already has it and
  #     spec-protocol's ultracode gate never opens with a refusal.
  #     `claude-nine --no-ultracode` turns it off and records "off" in the
  #     same file, so it is seeded ONLY when absent: a re-run never re-enables
  #     it for a client who opted out.
  mkdir -p "$NINE_ROOT"
  if [ -e "$NINE_ROOT/.last-effort" ]; then
    ULTRACODE_DEFAULT_LINE="kept (a saved effort choice already exists: $NINE_ROOT/.last-effort)"
  else
    printf 'ultracode\n' > "$NINE_ROOT/.last-effort"
    ULTRACODE_DEFAULT_LINE="ON ($NINE_ROOT/.last-effort)"
  fi

  #     (d) GitHub sign-in, once (fix #33): opens github.com in the browser
  #     with a one-time code. Skipped when already signed in; never fatal.
  if ! gh --version >/dev/null 2>&1; then
    GH_AUTH_LINE="SKIPPED - gh is not installed (see the dependency summary)"
  elif gh auth status >/dev/null 2>&1; then
    GH_AUTH_LINE="OK (already signed in)"
  elif [ ! -t 0 ]; then
    # Run in the background (AGENT_INSTALL.md step 7): the one-time code would
    # land in a log nobody sees and the device flow would stall setup. The
    # installing agent runs `gh auth login --web` as its own visible step.
    GH_AUTH_LINE="PENDING - run as its own step: gh auth login --web --hostname github.com --git-protocol https"
  else
    log "Signing in to GitHub: a browser window opens; enter the one-time code shown below."
    if gh auth login --web --hostname github.com --git-protocol https; then
      GH_AUTH_LINE="OK (signed in during setup)"
    else
      GH_AUTH_LINE="NOT SIGNED IN - run: gh auth login --web (until then builds keep work local-only)"
    fi
  fi

  # 9.8 Auto-compaction settings key at 500k tokens (both platforms). The
  #     claude-nine launcher additionally exports CLAUDE_CODE_AUTO_COMPACT_WINDOW
  #     =200000, which outranks this key, so routed sessions compact below the
  #     smallest fallback lane's window (kimi-k2.6, 256K). The shared helper
  #     merges exactly two keys (autoCompactEnabled, autoCompactWindow) into
  #     each config root's settings.json: it creates the file when missing,
  #     backs it up before changing it, preserves every other key, and REFUSES
  #     a file it cannot parse (reported honestly, never fatal). Applies to
  #     NEW sessions only; nothing running is signalled or restarted.
  AUTO_COMPACT_HELPER="$COMMON/apply-auto-compact.mjs"
  AUTO_COMPACT_FAILURES=0
  AUTO_COMPACT_DETAIL=""
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    set +e
    AUTO_COMPACT_OUT="$("$NODE_BIN" "$AUTO_COMPACT_HELPER" --settings "$root/settings.json" 2>&1)"
    AUTO_COMPACT_RC=$?
    set -e
    case "$AUTO_COMPACT_OUT" in
      "already set: "*) AUTO_COMPACT_RESULT="already set" ;;
      "set: "*) AUTO_COMPACT_RESULT="set" ;;
      "refusing: "*) AUTO_COMPACT_RESULT="refused" ;;
      *) AUTO_COMPACT_RESULT="failed" ;;
    esac
    [ "$AUTO_COMPACT_RC" -eq 0 ] || AUTO_COMPACT_FAILURES=$((AUTO_COMPACT_FAILURES + 1))
    AUTO_COMPACT_DETAIL="${AUTO_COMPACT_DETAIL}  settings.json ($root): $AUTO_COMPACT_RESULT
"
  done < <(printf '%s\n' "$CLAUDE_SKILLS_ROOT" ${CLAUDE_SKILLS_ROOT_ALT:+"$CLAUDE_SKILLS_ROOT_ALT"})
  if [ "$AUTO_COMPACT_FAILURES" -gt 0 ]; then
    AUTO_COMPACT_STATUS="WARNING: $AUTO_COMPACT_FAILURES root(s) not set — see below"
  else
    AUTO_COMPACT_STATUS="OK"
  fi
  log "Auto-compaction: $AUTO_COMPACT_STATUS"

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
  PASSWORD_NOTE=""
  if [ "$(printf '%s' "$CONFIG_REPORT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const r=JSON.parse(s)||{};process.stdout.write(r.mustChangePassword?"true":"false")}catch{process.stdout.write("false")}})' 2>/dev/null || echo false)" = "true" ]; then
    PASSWORD_NOTE="
Dashboard: the password is the default \`123456\`; change it yourself in the dashboard when you are ready."
  fi
  cat <<REPORT

999 SETUP: COMPLETE

Operating system: macOS (arm64)
Claude Code: OK
Personal skill in normal claude: $SKILL_VISIBLE
Personal skill in claude-nine: $NINE_SKILL_VISIBLE
Bundled skill links: $SKILL_LINK_STATUS
Auto-compaction: settings 500k tokens — $AUTO_COMPACT_STATUS; claude-nine compacts at 200k (launcher env, below the 256K fallback lane)
Auto-compaction per root:
$AUTO_COMPACT_DETAIL
Per-skill visibility:
$SKILL_VISIBLE_DETAIL
claude-nine launcher: OK
claude-nine cold start (router stopped, launcher restarted it): $COLD_START_LINE
claude-codex launcher: $CODEX_LINE
Ultracode default: $ULTRACODE_DEFAULT_LINE
spec-protocol hooks: $HOOKS_STATUS
$HOOKS_DETAIL
GitHub sign-in: $GH_AUTH_LINE
Operator backup owner: $OPERATOR_REMOTE_LINE
Operator keys recorded: $OPERATOR_KEYS_LINE
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
$THINKING_LINES${PASSWORD_NOTE}
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

Dashboard: $DASHBOARD_URL - open this in your browser to manage providers and models. The password is the default \`123456\`; change it yourself in the dashboard when you are ready.

Launch routed Claude Code with: claude-nine
(claude-codex is the same session pinned to a Codex model — add a cx/ provider first.)

No API keys were printed (the dashboard password is the documented default above).
REPORT
}

main "$@"
