#!/usr/bin/env bash
# enable-agent-teams.sh — turn on Claude Code Agent Teams and split-pane
# teammates for FUTURE Claude Code sessions on macOS. CONFIGURATION ONLY.
#
# Implements the operator's binding enablement procedure phase by phase:
#   P1  read-only Claude Code version check (floor 2.1.178). Never runs the
#       Claude Code self-update command, never reinstalls Claude Code — the
#       operator decides when to update, never this script.
#   P2  read-only inspection of running Claude/tmux work. Observation only.
#   P3  timestamped backup of the settings file; never overwrites a backup.
#   P4  MERGE "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" into the existing
#       "env" object — add/update ONLY that key.
#   P5  MERGE top-level "teammateMode": "tmux".
#   P6  tmux: already installed -> record the path, never reinstall. Absent and
#       Homebrew present -> `brew install tmux`. Absent and no Homebrew ->
#       report TMUX INSTALLATION BLOCKED — HOMEBREW NOT FOUND and keep
#       validating. Homebrew is NEVER installed here (repo rule 11).
#   P7  timestamped backup of ~/.tmux.conf when it exists.
#   P8  ensure the three Claude Code tmux lines exist, idempotently, never
#       duplicated, never replacing an existing conflicting choice.
#   P9  validate the settings JSON, both configured keys, and EVERY pre-existing
#       leaf value. On ANY failure RESTORE THE BACKUP — never leave a broken
#       settings.json.
#   P10 validate the tmux configuration.
#   P11 no Agent Team, teammate, pane, tmux server, or Claude session is created.
#   P12 the current session is never restarted, reloaded, or signalled.
#   P13 final report on stdout, in the procedure's exact format.
#   P14 print the next command — told, never run.
#
# THE SAFETY ENVELOPE (binding on every line of this script):
#   NEVER kill, restart, signal, interrupt, detach, reload, or "clean up" any
#   running Claude Code session, workflow, subagent, terminal, tmux
#   session/server, background task, build, or test — even if it looks stale.
#   Never spawn a team as a side effect of configuring. Never restart the
#   current session. Configuration is for NEW sessions. Any step that would
#   disturb running work is DEFERRED and reported with the reason.
#   Protect currently running work over completing this configuration.
#
#   This script therefore contains NO process-termination command of any kind, no
#   tmux server or session teardown, no tmux configuration reload, no signal
#   delivery, no Claude Code self-update or reinstall, and no launch of a
#   teammate-mode session. The only commands that mutate anything are: writing
#   the settings file, writing the tmux configuration file, copying backups, and
#   (only when tmux is missing and Homebrew already exists) installing tmux.
#
# Idempotent and re-run safe: a second run adds nothing, duplicates nothing, and
# reports the same READY state.
#
# Usage:
#   enable-agent-teams.sh [--settings PATH] [--tmux-conf PATH] [--no-install]
#   enable-agent-teams.sh --selftest
#
# Exit codes:
#   0  configuration complete (read the READY line for what is usable)
#   1  version-blocked — nothing was modified
#   2  tooling failure — the settings backup was restored where applicable
set -euo pipefail

TEAMS_MIN_VERSION="2.1.178"        # Agent Teams floor (the procedure's requirement)
MAILBOX_MIN_VERSION="2.1.224"      # ListAgents / SendMessage floor
FLAG_KEY="CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"
FLAG_VALUE="1"
TEAMMATE_MODE="tmux"

SETTINGS_PATH="${AGENT_TEAMS_SETTINGS:-$HOME/.claude/settings.json}"
TMUX_CONF="${AGENT_TEAMS_TMUX_CONF:-$HOME/.tmux.conf}"
NINE_PROFILE="${AGENT_TEAMS_NINE_SETTINGS:-$HOME/.claude-nine/settings.json}"
ALLOW_INSTALL=1

log() { printf '[enable-agent-teams] %s\n' "$*" >&2; }

usage() {
  sed -n '2,50p' "$0" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

# parse_version <string> -> the first x.y.z found ("2.1.227 (Claude Code)" -> 2.1.227).
# sed, not grep: this script must not depend on the caller's grep resolution.
parse_version() {
  printf '%s' "$1" | sed -n 's/^[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p'
}

# version_ge A B -> 0 when A >= B, comparing three numeric fields.
version_ge() {
  local a="$1" b="$2" i ai bi
  for i in 1 2 3; do
    ai="$(printf '%s' "$a" | cut -d. -f"$i")"
    bi="$(printf '%s' "$b" | cut -d. -f"$i")"
    case "$ai" in ''|*[!0-9]*) ai=0 ;; esac
    case "$bi" in ''|*[!0-9]*) bi=0 ;; esac
    [ "$ai" -gt "$bi" ] && return 0
    [ "$ai" -lt "$bi" ] && return 1
  done
  return 0
}

# make_backup <file> -> prints the backup path. NEVER overwrites an existing
# backup: a name collision takes the next free -N suffix.
# AGENT_TEAMS_BACKUP_STAMP is a test-only seam so --selftest can force a
# deterministic collision; production runs use the wall clock.
make_backup() {
  local src="$1" stamp b n
  stamp="${AGENT_TEAMS_BACKUP_STAMP:-$(date +%Y%m%d-%H%M%S)}"
  b="$src.backup.$stamp"
  n=1
  while [ -e "$b" ]; do
    b="$src.backup.$stamp-$n"
    n=$((n + 1))
  done
  cp -p "$src" "$b"
  printf '%s' "$b"
}

resolve_node() {
  local n="${NODE_BIN:-}"
  if [ -n "$n" ] && [ -x "$n" ]; then printf '%s' "$n"; return 0; fi
  n="$(command -v node 2>/dev/null || true)"
  if [ -n "$n" ]; then printf '%s' "$n"; return 0; fi
  return 1
}

resolve_claude() {
  local c="${CLAUDE_BIN:-}"
  if [ -n "$c" ] && [ -x "$c" ]; then printf '%s' "$c"; return 0; fi
  c="$(command -v claude 2>/dev/null || true)"
  if [ -z "$c" ] && [ -x "$HOME/.local/bin/claude" ]; then c="$HOME/.local/bin/claude"; fi
  if [ -n "$c" ]; then printf '%s' "$c"; return 0; fi
  return 1
}

# ---------------------------------------------------------------------------
# Node helpers. Node is already a hard dependency of this repo's setup flow and
# is the only JSON parser guaranteed present (python3 is optional on macOS —
# see setup-macos.sh probe_python3). Every write is atomic: temp file in the
# same directory, original mode preserved, then rename.
# ---------------------------------------------------------------------------

# merge_settings — P4 + P5 in ONE atomic write, so the file is never observed
# half-configured. Both keys are still validated independently in P9.
# stdout: EXISTED=0|1 / PREV_FLAG=... / PREV_MODE=...
# exit 3: the existing file is unparseable or structurally unexpected — nothing
#         is written (an unreadable settings.json is never treated as empty).
merge_settings() {
  SETTINGS_PATH="$1" FLAG_KEY="$FLAG_KEY" FLAG_VALUE="$FLAG_VALUE" \
  TEAMMATE_MODE="$TEAMMATE_MODE" "$NODE" -e '
    const fs = require("fs");
    const p = process.env.SETTINGS_PATH;
    let existed = false, raw = null;
    try { raw = fs.readFileSync(p, "utf8"); existed = true; }
    catch (e) { if (e.code !== "ENOENT") { console.error("READ_FAILED: " + e.message); process.exit(3); } }
    let obj = {};
    if (existed) {
      const text = raw.replace(/^\uFEFF/, "");
      if (text.trim() !== "") {
        try { obj = JSON.parse(text); }
        catch (e) { console.error("PARSE_FAILED: " + e.message); process.exit(3); }
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
        console.error("NOT_A_JSON_OBJECT"); process.exit(3);
      }
    }
    const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const prevMode = hasOwn(obj, "teammateMode") ? obj.teammateMode : undefined;
    if (!hasOwn(obj, "env") || obj.env === undefined) obj.env = {};
    const env = obj.env;
    if (env === null || typeof env !== "object" || Array.isArray(env)) {
      console.error("ENV_NOT_A_JSON_OBJECT"); process.exit(3);
    }
    const prevFlag = hasOwn(env, process.env.FLAG_KEY) ? env[process.env.FLAG_KEY] : undefined;
    // MERGE: add/update ONLY these two keys. Nothing else is touched.
    env[process.env.FLAG_KEY] = process.env.FLAG_VALUE;
    obj.teammateMode = process.env.TEAMMATE_MODE;
    const out = JSON.stringify(obj, null, 2) + "\n";
    const dir = require("path").dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = p + ".999tmp." + process.pid;
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    if (existed) { try { fs.chmodSync(tmp, fs.statSync(p).mode & 0o7777); } catch (e) {} }
    fs.renameSync(tmp, p);
    console.log("EXISTED=" + (existed ? "1" : "0"));
    console.log("PREV_FLAG=" + (prevFlag === undefined ? "<absent>" : String(prevFlag)));
    console.log("PREV_MODE=" + (prevMode === undefined ? "<absent>" : String(prevMode)));
  '
}

# validate_settings — P9. Valid JSON, both keys exactly right, and every leaf
# value that existed in the backup still present and unchanged (model aliases,
# routing, env vars, permissions, hooks, MCP, provider config — all of it).
# exit 0 clean; exit 4 with a named reason on stderr.
validate_settings() {
  SETTINGS_PATH="$1" BACKUP_PATH="${2:-}" FLAG_KEY="$FLAG_KEY" \
  FLAG_VALUE="$FLAG_VALUE" TEAMMATE_MODE="$TEAMMATE_MODE" "$NODE" -e '
    const fs = require("fs");
    const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
    let cur;
    try { cur = readJson(process.env.SETTINGS_PATH); }
    catch (e) { console.error("INVALID_JSON: " + e.message); process.exit(4); }
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      console.error("NOT_A_JSON_OBJECT"); process.exit(4);
    }
    const flagKey = process.env.FLAG_KEY;
    if (!cur.env || typeof cur.env !== "object" || cur.env[flagKey] !== process.env.FLAG_VALUE) {
      console.error("FLAG_NOT_CONFIRMED"); process.exit(4);
    }
    if (cur.teammateMode !== process.env.TEAMMATE_MODE) {
      console.error("TEAMMATE_MODE_NOT_CONFIRMED"); process.exit(4);
    }
    const bak = process.env.BACKUP_PATH;
    if (bak) {
      let old;
      try { old = readJson(bak); }
      catch (e) { console.error("BACKUP_UNREADABLE: " + e.message); process.exit(4); }
      const leaves = (o, prefix, out) => {
        if (o !== null && typeof o === "object") {
          if (Array.isArray(o)) {
            out.push([prefix + "#len", String(o.length)]);
            o.forEach((v, i) => leaves(v, prefix + "[" + i + "]", out));
          } else {
            const ks = Object.keys(o);
            if (!ks.length) out.push([prefix, "{}"]);
            ks.forEach((k) => leaves(o[k], prefix ? prefix + "." + k : k, out));
          }
        } else {
          out.push([prefix, JSON.stringify(o)]);
        }
      };
      const oldLeaves = []; leaves(old, "", oldLeaves);
      const newLeaves = []; leaves(cur, "", newLeaves);
      const newMap = new Map(newLeaves);
      const allowed = new Set(["env." + flagKey, "teammateMode"]);
      const lost = [];
      for (const [path, val] of oldLeaves) {
        if (allowed.has(path)) continue;
        if (!newMap.has(path) || newMap.get(path) !== val) lost.push(path);
      }
      if (lost.length) {
        console.error("PRE_EXISTING_SETTINGS_LOST: " + lost.slice(0, 10).join(", "));
        process.exit(4);
      }
    }
  '
}

# ensure_tmux_lines — P8. Adds only the missing lines, inside one clearly marked
# managed block, never duplicating and never rewriting a line the user already
# chose. stdout: one STATUS line per required directive.
# The program is fed on stdin (a quoted heredoc), NOT `node -e '...'`, so the
# third directive can carry its single quotes verbatim exactly as tmux and the
# procedure spell it.
ensure_tmux_lines() {
  TMUX_CONF="$1" "$NODE" - <<'JS'
const fs = require("fs");
const p = process.env.TMUX_CONF;
const START = "# >>> 999-setup: claude code agent teams (tmux) >>>";
const END = "# <<< 999-setup: claude code agent teams (tmux) <<<";
const REQUIRED = [
  { name: "allow-passthrough",
    line: "set -g allow-passthrough on",
    // An explicit different value is the user's own choice: reported,
    // never overwritten, never duplicated.
    family: /^[ \t]*set(-option)?\b[^#]*\ballow-passthrough\b/,
    want: /\ballow-passthrough[ \t]+on\b/,
    conflictable: true },
  { name: "extended-keys",
    line: "set -s extended-keys on",
    family: /^[ \t]*set(-option)?\b[^#]*\bextended-keys\b/,
    want: /\bextended-keys[ \t]+on\b/,
    conflictable: true },
  { name: "terminal-features",
    // `set -as` APPENDS to the feature list, so an existing terminal-features
    // line is never a conflict — only a missing extkeys entry matters.
    line: "set -as terminal-features 'xterm*:extkeys'",
    family: /^[ \t]*set(-option)?\b[^#]*\bterminal-features\b/,
    want: /\bterminal-features\b[^#]*extkeys/,
    conflictable: false },
];
let text = "";
let existed = false;
try { text = fs.readFileSync(p, "utf8"); existed = true; } catch (e) {
  if (e.code !== "ENOENT") { console.error("READ_FAILED: " + e.message); process.exit(3); }
}
const live = text.split("\n").filter((l) => !/^[ \t]*#/.test(l));
const missing = [];
for (const r of REQUIRED) {
  if (live.some((l) => r.want.test(l))) { console.log("STATUS " + r.name + " PRESENT"); continue; }
  if (r.conflictable && live.some((l) => r.family.test(l))) {
    console.log("STATUS " + r.name + " CONFLICT");
    continue;
  }
  missing.push(r);
}
if (!missing.length) { console.log("RESULT UNCHANGED"); process.exit(0); }
let out;
const endIdx = text.indexOf(END);
if (text.indexOf(START) !== -1 && endIdx !== -1) {
  // Managed block already present: insert the missing lines inside it, so a
  // rerun never appends a second block.
  out = text.slice(0, endIdx) + missing.map((r) => r.line).join("\n") + "\n" + text.slice(endIdx);
} else {
  let head = text;
  if (head.length && !head.endsWith("\n")) head += "\n";
  if (head.length) head += "\n";
  out = head + START + "\n" + missing.map((r) => r.line).join("\n") + "\n" + END + "\n";
}
const tmp = p + ".999tmp." + process.pid;
fs.writeFileSync(tmp, out, { mode: 0o644 });
if (existed) { try { fs.chmodSync(tmp, fs.statSync(p).mode & 0o7777); } catch (e) {} }
fs.renameSync(tmp, p);
for (const r of missing) console.log("STATUS " + r.name + " ADDED");
console.log("RESULT WRITTEN");
JS
}

# check_tmux_lines — P10, read-only.
check_tmux_lines() {
  TMUX_CONF="$1" "$NODE" -e '
    const fs = require("fs");
    let text = "";
    try { text = fs.readFileSync(process.env.TMUX_CONF, "utf8"); } catch (e) { process.exit(5); }
    const live = text.split("\n").filter((l) => !/^[ \t]*#/.test(l));
    const want = [
      /\ballow-passthrough[ \t]+on\b/,
      /\bextended-keys[ \t]+on\b/,
      /\bterminal-features\b[^#]*extkeys/,
    ];
    process.exit(want.every((w) => live.some((l) => w.test(l))) ? 0 : 5);
  '
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  # Report fields (procedure Phase 13). Every one is set from a real probe.
  local R_VERSION="UNKNOWN" R_VERSION_REQ="FAIL" R_MAILBOX="UNKNOWN"
  local R_TEAMS="FAILED" R_FLAG="NOT CONFIRMED" R_MODE="NOT CONFIRMED"
  # NOT CHECKED, never a bare negative: a phase that never ran must not report a
  # finding it did not make (the version gate exits before the tmux phases).
  local R_TMUX="NOT CHECKED" R_TMUX_PATH="N/A" R_JSON="NOT VALIDATED"
  local R_SETTINGS_BACKUP="N/A" R_TMUX_CONF="NOT CHECKED" R_TMUX_CONF_BACKUP="N/A"
  local R_EXISTING="PRESERVED (nothing was modified)" R_ACTIVE="UNKNOWN" R_READY="NO"
  local R_NINE="NOT PRESENT — NOT CREATED (this installer does not own a claude-nine profile file)"
  local DEFERRED=""

  NODE="$(resolve_node || true)"
  if [ -z "${NODE:-}" ]; then
    log "BLOCKER: node was not found (set NODE_BIN or put node on PATH)."
    log "Nothing was inspected, backed up, or modified."
    exit 2
  fi

  # ---- P1. READ-ONLY VERSION CHECK -----------------------------------------
  local CLAUDE_BIN_RESOLVED VERSION_RAW VERSION
  CLAUDE_BIN_RESOLVED="$(resolve_claude || true)"
  if [ -z "${CLAUDE_BIN_RESOLVED:-}" ]; then
    R_VERSION="NOT FOUND"
    log "Claude Code was not found on PATH. Nothing was modified."
    log "AGENT TEAMS REQUIRE A NEWER CLAUDE CODE VERSION."
    print_report
    printf '\nInstall Claude Code (see README), then rerun this step.\n'
    printf 'Nothing was updated automatically — you decide when to install or update.\n'
    exit 1
  fi
  VERSION_RAW="$("$CLAUDE_BIN_RESOLVED" --version 2>&1 | head -1 || true)"
  VERSION="$(parse_version "$VERSION_RAW")"
  if [ -z "$VERSION" ]; then
    R_VERSION="UNPARSEABLE ($VERSION_RAW)"
    log "Could not parse a version from: $VERSION_RAW"
    log "Refusing to modify settings on an unproven version."
    print_report
    exit 1
  fi
  R_VERSION="$VERSION"
  if version_ge "$VERSION" "$TEAMS_MIN_VERSION"; then
    R_VERSION_REQ="PASS"
  else
    R_VERSION_REQ="FAIL"
    log "AGENT TEAMS REQUIRE A NEWER CLAUDE CODE VERSION."
    log "installed: $VERSION   required: $TEAMS_MIN_VERSION or newer"
    log "No settings were modified. Claude Code was NOT updated and NOT reinstalled —"
    log "you decide when to update (never automatic, never while sessions may be running)."
    print_report
    exit 1
  fi
  if version_ge "$VERSION" "$MAILBOX_MIN_VERSION"; then
    R_MAILBOX="PASS"
  else
    R_MAILBOX="BELOW $MAILBOX_MIN_VERSION — teammates can be spawned, but ListAgents/SendMessage are unavailable"
  fi

  # ---- P2. INSPECT CURRENTLY RUNNING WORK (READ-ONLY) ----------------------
  # The procedure's `ps aux | grep '[c]laude'`, written with awk so the result
  # never depends on how `grep` resolves in the caller's environment.
  # OBSERVATION ONLY: nothing found here is ever attached to, signalled, or
  # touched in any way.
  local CLAUDE_PROCS TMUX_SESSIONS
  CLAUDE_PROCS="$(ps aux 2>/dev/null | awk '/[c]laude/' | awk 'END { print NR + 0 }')"
  case "$CLAUDE_PROCS" in
    ''|0) R_ACTIVE="NO" ;;
    *) R_ACTIVE="YES ($CLAUDE_PROCS Claude-related processes observed; none touched)" ;;
  esac
  TMUX_SESSIONS=""
  if command -v tmux >/dev/null 2>&1; then
    TMUX_SESSIONS="$(tmux list-sessions 2>/dev/null || true)"
  fi
  log "Read-only inspection: $R_ACTIVE"
  if [ -n "$TMUX_SESSIONS" ]; then
    log "tmux sessions observed (left exactly as they are):"
    printf '%s\n' "$TMUX_SESSIONS" | while IFS= read -r l; do log "  $l"; done
  fi
  # Regardless of what was found: ASSUME ACTIVE WORK MUST BE PRESERVED.

  # ---- P3. BACK UP CLAUDE CODE SETTINGS ------------------------------------
  local BACKUP=""
  mkdir -p "$(dirname "$SETTINGS_PATH")"
  if [ -f "$SETTINGS_PATH" ]; then
    BACKUP="$(make_backup "$SETTINGS_PATH")"
    R_SETTINGS_BACKUP="$BACKUP"
    log "settings backup: $BACKUP"
  else
    R_SETTINGS_BACKUP="N/A (no settings.json existed; a new one was created)"
    log "no settings.json at $SETTINGS_PATH — a new one will be created"
  fi

  # ---- P4 + P5. MERGE THE TWO KEYS (one atomic write) ----------------------
  local MERGE_OUT MERGE_RC=0
  set +e
  MERGE_OUT="$(merge_settings "$SETTINGS_PATH" 2>&1)"
  MERGE_RC=$?
  set -e
  if [ "$MERGE_RC" -ne 0 ]; then
    log "settings merge failed: $MERGE_OUT"
    if [ -n "$BACKUP" ]; then
      cp -p "$BACKUP" "$SETTINGS_PATH"
      log "RESTORED the backup: $BACKUP -> $SETTINGS_PATH"
      R_EXISTING="PRESERVED (restored from backup — no change landed)"
    fi
    R_JSON="INVALID"
    R_TEAMS="FAILED"
    print_report
    exit 2
  fi
  case "$MERGE_OUT" in
    *"PREV_MODE=<absent>"*|*"PREV_MODE=tmux"*) : ;;
    *) DEFERRED="$DEFERRED
- teammateMode already had a different value; it was set to \"$TEAMMATE_MODE\" as the
  procedure requires. The previous value is preserved in the backup above." ;;
  esac
  log "merged $FLAG_KEY=\"$FLAG_VALUE\" into env, and top-level teammateMode=\"$TEAMMATE_MODE\""

  # ---- P6. VERIFY TMUX ------------------------------------------------------
  local TMUX_BIN
  TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
  if [ -n "$TMUX_BIN" ]; then
    R_TMUX="INSTALLED"
    R_TMUX_PATH="$TMUX_BIN"
    log "tmux already installed at $TMUX_BIN — not reinstalled"
  elif [ "$ALLOW_INSTALL" -eq 1 ] && command -v brew >/dev/null 2>&1; then
    log "tmux not found; Homebrew is present — installing tmux (no terminal or session is touched)"
    if brew install tmux >&2; then
      TMUX_BIN="$(command -v tmux 2>/dev/null || true)"
      if [ -n "$TMUX_BIN" ]; then
        R_TMUX="INSTALLED"
        R_TMUX_PATH="$TMUX_BIN"
      else
        R_TMUX="NOT INSTALLED (brew install reported success but tmux is not resolvable)"
      fi
    else
      R_TMUX="NOT INSTALLED (brew install tmux failed — see the log above)"
    fi
  elif [ "$ALLOW_INSTALL" -eq 0 ]; then
    R_TMUX="NOT INSTALLED (probed with command -v; install skipped: --no-install)"
  else
    # Homebrew is NEVER installed by this task (repo rule 11 and the procedure).
    R_TMUX="NOT INSTALLED (command -v tmux found nothing, and command -v brew found no Homebrew)"
    log "TMUX INSTALLATION BLOCKED — HOMEBREW NOT FOUND"
    DEFERRED="$DEFERRED
- TMUX INSTALLATION BLOCKED — HOMEBREW NOT FOUND. Homebrew is never installed by
  this step. Everything else was still validated. Install tmux yourself when you
  want split-pane teammates; the Agent Teams flag above is already set."
  fi

  # ---- P7. BACK UP TMUX CONFIGURATION --------------------------------------
  if [ -f "$TMUX_CONF" ]; then
    R_TMUX_CONF_BACKUP="$(make_backup "$TMUX_CONF")"
    log "tmux config backup: $R_TMUX_CONF_BACKUP"
  fi

  # ---- P8. CONFIGURE TMUX FOR CLAUDE CODE ----------------------------------
  local TMUX_LINES_OUT TMUX_LINES_RC=0
  set +e
  TMUX_LINES_OUT="$(ensure_tmux_lines "$TMUX_CONF" 2>&1)"
  TMUX_LINES_RC=$?
  set -e
  if [ "$TMUX_LINES_RC" -ne 0 ]; then
    R_TMUX_CONF="NOT READY (could not read/write $TMUX_CONF: $TMUX_LINES_OUT)"
    DEFERRED="$DEFERRED
- The tmux configuration could not be written. Your existing tmux config was not
  changed and no running tmux session was touched."
  else
    case "$TMUX_LINES_OUT" in
      *CONFLICT*)
        DEFERRED="$DEFERRED
- One or more Claude Code tmux directives already exist in $TMUX_CONF with a
  different value. Your line was left exactly as it is and nothing was
  duplicated. Split-pane teammates may not behave as documented until you
  reconcile it yourself." ;;
    esac
    printf '%s\n' "$TMUX_LINES_OUT" | while IFS= read -r l; do log "$l"; done
    # The configuration file is written and NOTHING is reloaded, torn down, or
    # signalled: reloading could change the environment of tmux sessions that are
    # running right now. New tmux sessions pick the configuration up on their own.
    case "$TMUX_LINES_OUT" in
      *WRITTEN*)
        if [ -n "$TMUX_SESSIONS" ]; then
          R_TMUX_CONF="RELOAD DEFERRED"
          log "TMUX CONFIG WRITTEN — RELOAD DEFERRED TO PROTECT ACTIVE SESSIONS."
          DEFERRED="$DEFERRED
- TMUX CONFIG WRITTEN — RELOAD DEFERRED TO PROTECT ACTIVE SESSIONS. Running tmux
  sessions were not reloaded, restarted, or signalled. New tmux sessions get the
  configuration automatically."
        else
          R_TMUX_CONF="READY"
        fi ;;
      *) R_TMUX_CONF="READY" ;;
    esac
  fi

  # ---- P9. VALIDATE SETTINGS.JSON ------------------------------------------
  local VALID_OUT VALID_RC=0
  set +e
  VALID_OUT="$(validate_settings "$SETTINGS_PATH" "$BACKUP" 2>&1)"
  VALID_RC=$?
  set -e
  # Test-only seam: --selftest uses it to prove the restore path really restores.
  if [ -n "${AGENT_TEAMS_FORCE_VALIDATION_FAILURE:-}" ]; then
    VALID_RC=4
    VALID_OUT="FORCED_VALIDATION_FAILURE (selftest seam)"
  fi
  if [ "$VALID_RC" -eq 0 ]; then
    R_JSON="VALID"
    R_FLAG="CONFIRMED"
    R_MODE="CONFIRMED"
    R_TEAMS="ENABLED"
    R_EXISTING="PRESERVED"
  else
    R_JSON="INVALID"
    R_TEAMS="FAILED"
    R_FLAG="NOT CONFIRMED"
    R_MODE="NOT CONFIRMED"
    log "settings validation FAILED: $VALID_OUT"
    case "$VALID_OUT" in
      *PRE_EXISTING_SETTINGS_LOST*) R_EXISTING="PROBLEM FOUND ($VALID_OUT)" ;;
    esac
    if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
      cp -p "$BACKUP" "$SETTINGS_PATH"
      log "RESTORED the backup: $BACKUP -> $SETTINGS_PATH"
      R_EXISTING="PRESERVED (restored from backup — no change landed)"
    else
      log "no backup existed (the file was created by this run); the new file was left in place for inspection"
    fi
    print_report
    printf '\nAgent Teams were NOT enabled. Your settings file was restored from the backup above.\n'
    printf 'Nothing that was running was touched.\n'
    exit 2
  fi

  # ---- P10. VALIDATE TMUX CONFIG -------------------------------------------
  if ! check_tmux_lines "$TMUX_CONF"; then
    case "$R_TMUX_CONF" in
      READY|"RELOAD DEFERRED") R_TMUX_CONF="NOT READY (the three Claude Code lines are not all present in $TMUX_CONF)" ;;
    esac
  fi

  # ---- The claude-nine profile ---------------------------------------------
  # The skill's own consent flow owns this file: 9Router Agent Teams
  # compatibility is UNDETERMINED until its runtime probe passes, so a hand-tuned
  # claude-nine profile is never mutated by this installer.
  if [ -f "$NINE_PROFILE" ]; then
    R_NINE="EXISTING — NOT MODIFIED ($NINE_PROFILE; the skill's consent flow owns it, 9Router Agent Teams compatibility UNDETERMINED)"
  fi

  # ---- P11 / P12 -----------------------------------------------------------
  # Nothing above spawned a teammate, created a team, opened a pane, launched
  # tmux, started another Claude Code instance, or restarted this session.

  # ---- READY ----------------------------------------------------------------
  if [ "$R_JSON" = "VALID" ] && [ "$R_TMUX" = "INSTALLED" ] && \
     { [ "$R_TMUX_CONF" = "READY" ] || [ "$R_TMUX_CONF" = "RELOAD DEFERRED" ]; }; then
    R_READY="YES"
  else
    R_READY="NO (Agent Teams are enabled in settings; split-pane teammates need tmux — see DEFERRED below)"
  fi

  print_report

  # ---- P14. THE NEXT COMMAND — TOLD, NEVER RUN -----------------------------
  cat <<'NEXT'

WHEN YOU ARE READY, open a SEPARATE NEW terminal window and run:

    tmux
    claude --teammate-mode tmux

These commands were NOT run for you. The setting applies to NEW Claude Code
sessions only; anything running right now keeps running exactly as it is.
NEXT
  if [ -n "$DEFERRED" ]; then
    printf '\nDEFERRED (reported, not performed — running work comes first):%s\n' "$DEFERRED"
  fi
  exit 0
}

print_report() {
  cat <<REPORT

CLAUDE CODE VERSION:
$R_VERSION

AGENT TEAMS VERSION REQUIREMENT:
$R_VERSION_REQ (floor $TEAMS_MIN_VERSION)

LISTAGENTS / SENDMESSAGE VERSION REQUIREMENT:
$R_MAILBOX (floor $MAILBOX_MIN_VERSION)

LATEST AVAILABLE VERSION:
NOT CHECKED (no automatic update is ever performed by this step)

AGENT TEAMS:
$R_TEAMS

EXPERIMENTAL FLAG:
$FLAG_KEY=$FLAG_VALUE
$R_FLAG

TEAMMATE MODE:
$TEAMMATE_MODE
$R_MODE

TMUX:
$R_TMUX

TMUX PATH:
$R_TMUX_PATH

CLAUDE SETTINGS JSON:
$R_JSON

CLAUDE SETTINGS FILE:
$SETTINGS_PATH

CLAUDE SETTINGS BACKUP:
$R_SETTINGS_BACKUP

TMUX CONFIG:
$R_TMUX_CONF

TMUX CONFIG BACKUP:
$R_TMUX_CONF_BACKUP

EXISTING CLAUDE SETTINGS:
$R_EXISTING

CLAUDE-NINE PROFILE:
$R_NINE

ACTIVE CLAUDE WORK DETECTED:
$R_ACTIVE

ACTIVE CLAUDE WORK INTERRUPTED:
NO

ACTIVE WORKFLOWS INTERRUPTED:
NO

ACTIVE SUBAGENTS INTERRUPTED:
NO

ACTIVE TERMINALS CLOSED:
NO

ACTIVE TMUX SESSIONS TERMINATED:
NO

CURRENT CLAUDE SESSION RESTARTED:
NO

AGENT TEAM SPAWNED:
NO

READY FOR A NEW AGENT-TEAM SESSION:
$R_READY
REPORT
}

# ---------------------------------------------------------------------------
# --selftest — exercises the five behaviours the safety envelope depends on, in
# a sandbox HOME. Touches nothing outside its own temp directory, installs
# nothing, and never spawns or signals anything.
# ---------------------------------------------------------------------------

selftest() {
  local box fake rc fails=0
  box="$(mktemp -d "${TMPDIR:-/tmp}/enable-agent-teams-selftest.XXXXXX")"
  fake="$box/bin"
  mkdir -p "$fake"
  printf '#!/bin/sh\necho "2.1.227 (Claude Code)"\n' > "$fake/claude"
  chmod 755 "$fake/claude"

  local NODE_T
  NODE_T="$(resolve_node || true)"
  if [ -z "${NODE_T:-}" ]; then
    printf 'FAIL  selftest: node not found (set NODE_BIN or put node on PATH)\n'
    exit 1
  fi

  st_run() { # st_run <home> [extra args...]
    local h="$1"; shift
    HOME="$h" CLAUDE_BIN="$fake/claude" AGENT_TEAMS_SETTINGS="$h/.claude/settings.json" \
      AGENT_TEAMS_TMUX_CONF="$h/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h/.claude-nine/settings.json" \
      bash "$SELF" --no-install "$@" > "$h/report.txt" 2> "$h/log.txt"
  }

  st_node() { "$NODE_T" -e "$1"; }

  # 1. MERGE INTO AN EXISTING env OBJECT — nothing else may change.
  local h1="$box/case1"
  mkdir -p "$h1/.claude"
  cat > "$h1/.claude/settings.json" <<'JSON'
{
  "model": "opus[1m]",
  "env": { "EXISTING_VAR": "keep-me", "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION": "1000" },
  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] },
  "hooks": { "Stop": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "true" } ] } ] }
}
JSON
  rc=0; st_run "$h1" || rc=$?
  if [ "$rc" -eq 0 ] && SETTINGS="$h1/.claude/settings.json" st_node '
      const s = JSON.parse(require("fs").readFileSync(process.env.SETTINGS, "utf8"));
      const ok = s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
        && s.teammateMode === "tmux"
        && s.env.EXISTING_VAR === "keep-me"
        && s.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION === "1000"
        && s.model === "opus[1m]"
        && s.permissions.allow[0] === "Bash(ls:*)"
        && s.hooks.Stop[0].hooks[0].command === "true";
      process.exit(ok ? 0 : 1);'; then
    printf 'PASS  1. merge into an existing env object (model, permissions, hooks, env vars preserved)\n'
  else
    printf 'FAIL  1. merge into an existing env object (exit %s) — see %s\n' "$rc" "$h1/log.txt"
    fails=$((fails + 1))
  fi

  # 2. CREATE FROM AN ABSENT FILE.
  local h2="$box/case2"
  mkdir -p "$h2"
  rc=0; st_run "$h2" || rc=$?
  if [ "$rc" -eq 0 ] && [ -f "$h2/.claude/settings.json" ] && SETTINGS="$h2/.claude/settings.json" st_node '
      const s = JSON.parse(require("fs").readFileSync(process.env.SETTINGS, "utf8"));
      process.exit(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1" && s.teammateMode === "tmux" ? 0 : 1);'; then
    printf 'PASS  2. create a valid settings.json when none exists\n'
  else
    printf 'FAIL  2. create a valid settings.json when none exists (exit %s) — see %s\n' "$rc" "$h2/log.txt"
    fails=$((fails + 1))
  fi

  # 3. NEVER OVERWRITE AN EXISTING BACKUP (deterministic collision via the stamp seam).
  local h3="$box/case3" stamp="20260101-000000" decoy
  mkdir -p "$h3/.claude"
  printf '{ "env": { "SENTINEL": "three" } }\n' > "$h3/.claude/settings.json"
  decoy="$h3/.claude/settings.json.backup.$stamp"
  printf 'DECOY-DO-NOT-TOUCH\n' > "$decoy"
  rc=0
  HOME="$h3" CLAUDE_BIN="$fake/claude" AGENT_TEAMS_SETTINGS="$h3/.claude/settings.json" \
    AGENT_TEAMS_TMUX_CONF="$h3/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h3/.claude-nine/settings.json" \
    AGENT_TEAMS_BACKUP_STAMP="$stamp" \
    bash "$SELF" --no-install > "$h3/report.txt" 2> "$h3/log.txt" || rc=$?
  if [ "$rc" -eq 0 ] && [ "$(cat "$decoy")" = "DECOY-DO-NOT-TOUCH" ] && [ -f "$decoy-1" ] && \
     SETTINGS="$decoy-1" st_node '
      const s = JSON.parse(require("fs").readFileSync(process.env.SETTINGS, "utf8"));
      process.exit(s.env.SENTINEL === "three" && !s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ? 0 : 1);'; then
    printf 'PASS  3. an existing backup is never overwritten (the next free name is used)\n'
  else
    printf 'FAIL  3. an existing backup is never overwritten (exit %s) — see %s\n' "$rc" "$h3/log.txt"
    fails=$((fails + 1))
  fi

  # 4. IDEMPOTENT TMUX LINES — run twice, nothing duplicated, user content kept.
  local h4="$box/case4"
  mkdir -p "$h4/.claude"
  printf '# my own tmux config\nset -g mouse on\n' > "$h4/.tmux.conf"
  rc=0; st_run "$h4" || rc=$?
  cp "$h4/.tmux.conf" "$h4/after-first.conf"
  st_run "$h4" || rc=$?
  if [ "$rc" -eq 0 ] && cmp -s "$h4/after-first.conf" "$h4/.tmux.conf" && \
     CONF="$h4/.tmux.conf" st_node '
      const t = require("fs").readFileSync(process.env.CONF, "utf8");
      const count = (re) => (t.match(re) || []).length;
      const ok = count(/allow-passthrough on/g) === 1
        && count(/extended-keys on/g) === 1
        && count(/terminal-features .xterm\*:extkeys./g) === 1
        && /set -g mouse on/.test(t)
        && count(/999-setup: claude code agent teams/g) === 2;
      process.exit(ok ? 0 : 1);'; then
    printf 'PASS  4. the three tmux lines are added once and stay once across reruns\n'
  else
    printf 'FAIL  4. idempotent tmux lines (exit %s) — see %s\n' "$rc" "$h4/log.txt"
    fails=$((fails + 1))
  fi

  # 5. VALIDATION FAILURE -> THE BACKUP IS RESTORED, byte for byte.
  local h5="$box/case5"
  mkdir -p "$h5/.claude"
  printf '{\n  "env": { "SENTINEL": "five" },\n  "model": "sonnet"\n}\n' > "$h5/.claude/settings.json"
  cp "$h5/.claude/settings.json" "$h5/original.json"
  rc=0
  HOME="$h5" CLAUDE_BIN="$fake/claude" AGENT_TEAMS_SETTINGS="$h5/.claude/settings.json" \
    AGENT_TEAMS_TMUX_CONF="$h5/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h5/.claude-nine/settings.json" \
    AGENT_TEAMS_FORCE_VALIDATION_FAILURE=1 \
    bash "$SELF" --no-install > "$h5/report.txt" 2> "$h5/log.txt" || rc=$?
  if [ "$rc" -eq 2 ] && cmp -s "$h5/original.json" "$h5/.claude/settings.json" && \
     awk '/^CLAUDE SETTINGS JSON:$/ { getline; if ($0 == "INVALID") found = 1 } END { exit found ? 0 : 1 }' "$h5/report.txt"; then
    printf 'PASS  5. a failed validation restores the backup and reports INVALID (exit 2)\n'
  else
    printf 'FAIL  5. validation failure -> restore (exit %s) — see %s\n' "$rc" "$h5/log.txt"
    fails=$((fails + 1))
  fi

  if [ "$fails" -eq 0 ]; then
    rm -rf "$box"
    exit 0
  fi
  printf '\nselftest artifacts kept for inspection: %s\n' "$box"
  exit 1
}

SELF="$0"
DO_SELFTEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --settings) [ $# -ge 2 ] || usage; SETTINGS_PATH="$2"; shift 2 ;;
    --tmux-conf) [ $# -ge 2 ] || usage; TMUX_CONF="$2"; shift 2 ;;
    --no-install) ALLOW_INSTALL=0; shift ;;
    --selftest) DO_SELFTEST=1; shift ;;
    -h|--help) usage ;;
    *) printf 'enable-agent-teams: unknown argument "%s"\n' "$1" >&2; usage ;;
  esac
done

if [ "$DO_SELFTEST" -eq 1 ]; then
  selftest
fi

main
