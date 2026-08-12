#!/usr/bin/env bash
# enable-agent-teams.sh — turn on Claude Code Agent Teams and split-pane
# teammates for FUTURE Claude Code sessions on macOS. CONFIGURATION ONLY.
#
# THE CONFIG ROOTS — Agent Teams are gated PER CONFIG ROOT, so this script
# configures EVERY root that exists, not just one:
#   ~/.claude       the root the `claude` launcher uses.
#   ~/.claude-nine  the root the `claude-nine` launcher uses. The `claude-codex`
#                   launcher execs claude-nine and therefore SHARES this same
#                   root — it is NOT a third root and needs no separate step.
#                   This root is configured ONLY when its directory already
#                   exists: a routed profile the operator never created is never
#                   invented here.
#   Enabling one root is INVISIBLE to the other launcher. Configuring a single
#   root was this script's headline defect; the backup, merge, and
#   validate/restore phases now all run PER ROOT, each with its own backup.
#   `--settings PATH` still forces a single-root run against exactly that file.
#
# Implements the operator's binding enablement procedure phase by phase:
#   P0  read-only tmux DETECTION. It decides the DISPLAY MODE and nothing else.
#       tmux is NOT required for Agent Teams: the documented default display
#       mode is in-process, which "works in any terminal, no extra setup
#       required" (https://code.claude.com/docs/en/agent-teams.md). P0 runs
#       AFTER the version gate, so a version-blocked run probes nothing and
#       still reports TMUX: NOT CHECKED rather than a finding it never made.
#       DETECTION IS AN INVOCATION, NEVER A NAME LOOKUP. P0 RUNS `tmux -V`,
#       captures its stdout and its stderr, and reads its EXIT CODE. PRESENT
#       means rc 0 AND a version string on stdout — nothing less. `command -v`
#       proves a NAME resolves and never that the program runs, so it decides
#       nothing here: a name resolving to a broken, half-installed, or
#       wrong-architecture binary would otherwise get `teammateMode: "tmux"`
#       written against a program that cannot start, which is the exact failure
#       this phase exists to prevent.
#       When the probe fails, P0 records WHY, and the two reasons are DIFFERENT
#       FACTS that the report keeps apart instead of blurring into "missing":
#         rc 127       NAME DID NOT RESOLVE — the shell found nothing to run.
#                      A shell abort, not a program's verdict about anything.
#         any other rc RESOLVED BUT FAILED TO RUN — a binary WAS found, it ran,
#                      and it failed. Something IS installed and it is broken.
#       Either way the outcome is ABSENT and teammateMode is omitted; only the
#       sentence in the report differs, because only the sentence should.
#       (references/agent-team.md §5.5 steps 4-5: a split-pane host is PROVEN
#       PRESENT BY RUNNING IT — `tmux -V`, with its exit code read.)
#       P0 is also placed ahead of P2 so that P2's read-only session listing
#       consumes this PROOF instead of resolving the name a second time.
#   P1  read-only Claude Code version check (floor 2.1.178). Never runs the
#       Claude Code self-update command, never reinstalls Claude Code — the
#       operator decides when to update, never this script.
#   P2  read-only inspection of running Claude/tmux work. Observation only.
#   P3  timestamped backup of EVERY targeted settings file, ONE PER ROOT; never
#       overwrites a backup, and every backup path is printed in the report.
#   P4  MERGE "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" into the existing
#       "env" object of EVERY root — add/update ONLY that key.
#   P5  MERGE top-level "teammateMode": "tmux" into every root — ONLY when P0
#       PROVED tmux is present, and P0's proof is a real `tmux -V` run whose
#       exit code was read, never a name that merely resolves. A display mode is
#       never pointed at an absent binary: with no tmux the key is not written at
#       all and Claude Code's built-in in-process display mode applies. Nor is it
#       ever pointed at a binary that resolves but cannot run — that case is
#       treated as ABSENT, identically. If P6 installs tmux, P5 is
#       re-run per root so the written mode matches reality.
#   P6  tmux: already installed -> record the path, never reinstall. Absent and
#       Homebrew present -> `brew install tmux`. Absent and no Homebrew ->
#       report the DEGRADATION (teams are enabled and usable in the in-process
#       display mode) and keep validating. Homebrew is NEVER installed here
#       (repo rule 11) — that rule is unchanged; only the wording of the
#       outcome changed, from "blocked" to "degraded", because tmux absence
#       does not block Agent Teams. A tmux that P6 installs here is RE-PROVED
#       the same way P0 proves one — by RUNNING `tmux -V` — so a `brew install`
#       that reports success while leaving nothing runnable is caught at this
#       step and reported as ABSENT rather than believed.
#   P7  timestamped backup of ~/.tmux.conf when it exists.
#   P8  ensure the three Claude Code tmux lines exist, idempotently, never
#       duplicated, never replacing an existing conflicting choice. Written
#       even when tmux is absent, so a later `brew install tmux` needs no
#       further edit.
#   P9  validate the settings JSON OF EVERY ROOT, the configured key(s), and
#       EVERY pre-existing leaf value of that root. On ANY failure RESTORE THAT
#       ROOT'S BACKUP — never leave a broken settings.json.
#   P10 validate the tmux configuration.
#   P11 no Agent Team, teammate, pane, tmux server, or Claude session is created.
#   P12 the current session is never restarted, reloaded, or signalled.
#   P13 final report on stdout, in the procedure's exact format, PER ROOT.
#   P14 print the next command — told, never run — matching the display mode
#       that was actually configured.
#
# MODELS ARE NEVER WRITTEN. When a routed (~/.claude-nine) root has no
# "teammateDefaultModel", the report WARNS and recommends — it never writes a
# model key of any kind. Model choice belongs to the operator and to the client,
# absolutely. The validator proves the key was not introduced.
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
#   the settings file of each targeted root, writing the tmux configuration file,
#   copying backups, and (only when tmux is missing and Homebrew already exists)
#   installing tmux.
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
SETTINGS_OVERRIDE=0
if [ -n "${AGENT_TEAMS_SETTINGS:-}" ]; then SETTINGS_OVERRIDE=1; fi
TMUX_CONF="${AGENT_TEAMS_TMUX_CONF:-$HOME/.tmux.conf}"
NINE_PROFILE="${AGENT_TEAMS_NINE_SETTINGS:-$HOME/.claude-nine/settings.json}"
ALLOW_INSTALL=1

# The exact degradation wording. tmux absence is a DISPLAY downgrade, never a
# blocker: Agent Teams are enabled and usable without it.
TMUX_DEGRADE_LINE="TMUX ABSENT — TEAMS ENABLED IN IN-PROCESS DISPLAY MODE (no action required; split panes appear if tmux is ever installed)"

# The routed-profile model warning. REPORT ONLY — this string is printed, and
# the key it names is never written by this script under any circumstance.
NINE_MODEL_WARNING="WARNING: routed profile has no teammateDefaultModel — teammates spawned without an explicit model will fail at start
(observed 2026-08-12: claude-opus-5 rejected by the local router). Recommendation: set teammateDefaultModel to null
(inherit the lead) or to a router-served alias. NOT WRITTEN — models are the operator's."

# Per-root state. Parallel arrays (bash 3.2 has no associative arrays), always
# indexed 0..ROOT_COUNT-1 and always fully initialised by add_root, so `set -u`
# can never trip on an unset element.
ROOT_COUNT=0
ROOT_LABEL=()        # "CLAUDE ROOT" / "CLAUDE-NINE ROOT"
ROOT_PATH=()         # absolute settings.json path
ROOT_KIND=()         # claude | nine
ROOT_BACKUP=()       # display string for the report
ROOT_BACKUP_PATHS=() # the real backup file path, or "" when none was needed
ROOT_JSON=()
ROOT_FLAG=()
ROOT_MODE=()
ROOT_EXISTING=()
ROOT_NOTE=()

log() { printf '[enable-agent-teams] %s\n' "$*" >&2; }

usage() {
  # The whole header block, through the Usage and Exit codes sections.
  # The end line tracks the header: it currently ends on the "2  tooling
  # failure" exit-code line, immediately above `set -euo pipefail`.
  sed -n '2,119p' "$0" >&2
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

# ---------------------------------------------------------------------------
# PROVING A PROGRAM IS THERE — BY RUNNING IT
#
# THE BINDING RULE: `command -v` proves a NAME resolves, and NEVER that the
# program runs. A split-pane host is therefore proven the only way a program can
# honestly be proven — by INVOKING it and READING ITS EXIT CODE.
# (references/agent-team.md §5.5 steps 4-5.)
#
# There is no iTerm2 / `it2` split-pane detection anywhere in this script — it
# has never had one, so there was no name-based it2 probe to convert. If one is
# ever added it goes through run_version_probe below, exactly like tmux, and it
# is PRESENT only on rc 0 with a version string on stdout. Never a name lookup.
# ---------------------------------------------------------------------------

# run_version_probe <program> <version-flag> — RUN it, capture stdout and stderr
# SEPARATELY, and report the real exit code. Sets, in the caller's scope:
#   PROBE_RC   the exit code actually observed (127 = the shell aborted because
#              the name did not resolve; anything else non-zero means a program
#              really ran and really failed — different facts, kept apart)
#   PROBE_OUT  stdout only, trimmed of trailing newlines
#   PROBE_ERR  stderr only, trimmed of trailing newlines
# Returns the probed program's exit code. Nothing is signalled, started,
# attached to, or torn down: `tmux -V` starts no server and touches no session.
run_version_probe() {
  local prog="$1" flag="$2" errf=""
  PROBE_RC=0
  PROBE_OUT=""
  PROBE_ERR=""
  errf="$(mktemp "${TMPDIR:-/tmp}/enable-agent-teams-probe.XXXXXX" 2>/dev/null || printf '')"
  if [ -n "$errf" ]; then
    set +e
    PROBE_OUT="$("$prog" "$flag" 2>"$errf")"
    PROBE_RC=$?
    set -e
    PROBE_ERR="$(cat "$errf" 2>/dev/null || true)"
    rm -f "$errf"
  else
    # No writable temp file. Still RUN it — the exit code is the proof, and the
    # missing stderr is reported as missing rather than silently invented.
    set +e
    PROBE_OUT="$("$prog" "$flag" 2>/dev/null)"
    PROBE_RC=$?
    set -e
    PROBE_ERR="(stderr not captured: no writable temp file was available)"
  fi
  return "$PROBE_RC"
}

# path_label <program> — an absolute path FOR THE REPORT ONLY, and only ever
# called AFTER that program has already been PROVEN to run by a real invocation
# whose exit code was read. Name resolution is a LABEL here and is never the
# proof; the proof is the exit code. An empty result is a missing label, never a
# finding about the program.
path_label() {
  command -v "$1" 2>/dev/null || true
}

# probe_tmux — PROVE, BY RUNNING IT, whether a tmux split-pane host exists.
# PRESENT means one thing only: `tmux -V` RAN, exited 0, and printed a version
# string on stdout. Sets, in the caller's scope:
#   TMUX_PRESENT        1 only when rc 0 AND a version string was printed
#   TMUX_VERSION        that version string (empty when absent)
#   TMUX_PROBE_RC       the exit code actually observed
#   TMUX_ABSENT_REASON  WHY it is absent, distinguishing the two different facts
#                       named in the header (rc 127 = the name did not resolve;
#                       any other non-zero rc = it resolved, ran, and failed).
#                       Empty when present.
#   TMUX_BIN            the path, for the report only, and only once presence is
#                       already proven. A label, never the proof.
# Returns 0 when present, 1 when absent.
probe_tmux() {
  TMUX_PRESENT=0
  TMUX_VERSION=""
  TMUX_PROBE_RC=""
  TMUX_ABSENT_REASON=""
  TMUX_BIN=""
  run_version_probe tmux -V || true
  TMUX_PROBE_RC="$PROBE_RC"
  if [ "$PROBE_RC" -eq 0 ] && [ -n "$PROBE_OUT" ]; then
    TMUX_PRESENT=1
    TMUX_VERSION="$PROBE_OUT"
    TMUX_BIN="$(path_label tmux)"
    if [ -z "$TMUX_BIN" ]; then
      TMUX_BIN="(ran successfully; path not resolvable for display)"
    fi
    return 0
  fi
  if [ "$PROBE_RC" -eq 0 ]; then
    TMUX_ABSENT_REASON="RAN AND EXITED 0 BUT PRINTED NO VERSION STRING (rc 0, empty stdout) — not a usable tmux, so it is treated as ABSENT"
  elif [ "$PROBE_RC" -eq 127 ]; then
    TMUX_ABSENT_REASON="NAME DID NOT RESOLVE (rc 127 — the shell found nothing to run; a shell abort, not a program's verdict)"
  else
    TMUX_ABSENT_REASON="RESOLVED BUT FAILED TO RUN (rc $PROBE_RC — a tmux binary WAS found and executing it failed; something is installed and it is broken)"
  fi
  if [ -n "$PROBE_ERR" ]; then
    TMUX_ABSENT_REASON="$TMUX_ABSENT_REASON [stderr: $(printf '%s' "$PROBE_ERR" | tr '\n' ' ')]"
  fi
  return 1
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

# add_root <label> <settings path> <kind> — registers one config root with every
# report field pre-filled. Nothing is read or written here.
add_root() {
  ROOT_LABEL[$ROOT_COUNT]="$1"
  ROOT_PATH[$ROOT_COUNT]="$2"
  ROOT_KIND[$ROOT_COUNT]="$3"
  ROOT_BACKUP[$ROOT_COUNT]="N/A"
  ROOT_BACKUP_PATHS[$ROOT_COUNT]=""
  ROOT_JSON[$ROOT_COUNT]="NOT VALIDATED"
  ROOT_FLAG[$ROOT_COUNT]="NOT CONFIRMED"
  ROOT_MODE[$ROOT_COUNT]="NOT CONFIRMED"
  ROOT_EXISTING[$ROOT_COUNT]="PRESERVED (nothing was modified)"
  ROOT_NOTE[$ROOT_COUNT]=""
  ROOT_COUNT=$((ROOT_COUNT + 1))
}

# root_kind_for_path <path> -> claude | nine. Used only for the --settings
# single-root override, so an override aimed at the routed profile still gets
# the routed-profile model check.
root_kind_for_path() {
  case "$1" in
    *claude-nine*) printf 'nine' ;;
    *) printf 'claude' ;;
  esac
}

# build_root_set — the DEFAULT target set is every config root that exists.
build_root_set() {
  local kind label
  if [ "$SETTINGS_OVERRIDE" -eq 1 ]; then
    kind="$(root_kind_for_path "$SETTINGS_PATH")"
    if [ "$kind" = "nine" ]; then label="CLAUDE-NINE ROOT (single-root override)"; else label="CLAUDE ROOT (single-root override)"; fi
    add_root "$label" "$SETTINGS_PATH" "$kind"
    return 0
  fi
  add_root "CLAUDE ROOT" "$SETTINGS_PATH" "claude"
  # The routed root is configured only when the operator already has one.
  if [ -d "$(dirname "$NINE_PROFILE")" ]; then
    add_root "CLAUDE-NINE ROOT" "$NINE_PROFILE" "nine"
  fi
}

# ---------------------------------------------------------------------------
# Node helpers. Node is already a hard dependency of this repo's setup flow and
# is the only JSON parser guaranteed present (python3 is optional on macOS —
# see setup-macos.sh probe_python3). Every write is atomic: temp file in the
# same directory, original mode preserved, then rename.
# ---------------------------------------------------------------------------

# merge_settings <settings path> <write teammateMode 0|1>
# P4 (+ P5 when the second argument is 1) in ONE atomic write, so the file is
# never observed half-configured. Every key is still validated independently in
# P9. This function touches EXACTLY the flag key, plus teammateMode when and
# only when tmux was proven present. It never writes a model key.
# stdout: EXISTED=0|1 / PREV_FLAG=... / PREV_MODE=... / HAS_TEAMMATE_DEFAULT_MODEL=0|1
# exit 3: the existing file is unparseable or structurally unexpected — nothing
#         is written (an unreadable settings.json is never treated as empty).
merge_settings() {
  SETTINGS_PATH="$1" WRITE_MODE="$2" FLAG_KEY="$FLAG_KEY" FLAG_VALUE="$FLAG_VALUE" \
  TEAMMATE_MODE="$TEAMMATE_MODE" "$NODE" -e '
    const fs = require("fs");
    const p = process.env.SETTINGS_PATH;
    const writeMode = process.env.WRITE_MODE === "1";
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
    const hadModelKey = hasOwn(obj, "teammateDefaultModel");
    if (!hasOwn(obj, "env") || obj.env === undefined) obj.env = {};
    const env = obj.env;
    if (env === null || typeof env !== "object" || Array.isArray(env)) {
      console.error("ENV_NOT_A_JSON_OBJECT"); process.exit(3);
    }
    const prevFlag = hasOwn(env, process.env.FLAG_KEY) ? env[process.env.FLAG_KEY] : undefined;
    // MERGE: add/update ONLY these keys. Nothing else is touched.
    env[process.env.FLAG_KEY] = process.env.FLAG_VALUE;
    // teammateMode is DISPLAY ONLY and is written only when tmux was proven
    // present. With no tmux the key is left exactly as it was (usually absent),
    // so the mode never names a binary that is not there.
    if (writeMode) obj.teammateMode = process.env.TEAMMATE_MODE;
    // Hard guard: this script never introduces a model key, ever.
    if (!hadModelKey && hasOwn(obj, "teammateDefaultModel")) {
      console.error("REFUSED_TO_WRITE_MODEL_KEY"); process.exit(3);
    }
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
    console.log("HAS_TEAMMATE_DEFAULT_MODEL=" + (hadModelKey ? "1" : "0"));
  '
}

# validate_settings <settings path> <backup path or ""> <write teammateMode 0|1>
# P9, per root. Valid JSON, the configured key(s) exactly right, and every leaf
# value that existed in that root's backup still present and unchanged (model
# aliases, routing, env vars, permissions, hooks, MCP, provider config — all of
# it). Also proves no model key was introduced.
# exit 0 clean; exit 4 with a named reason on stderr.
validate_settings() {
  SETTINGS_PATH="$1" BACKUP_PATH="${2:-}" WRITE_MODE="${3:-1}" FLAG_KEY="$FLAG_KEY" \
  FLAG_VALUE="$FLAG_VALUE" TEAMMATE_MODE="$TEAMMATE_MODE" "$NODE" -e '
    const fs = require("fs");
    const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
    const writeMode = process.env.WRITE_MODE === "1";
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
    if (writeMode) {
      if (cur.teammateMode !== process.env.TEAMMATE_MODE) {
        console.error("TEAMMATE_MODE_NOT_CONFIRMED"); process.exit(4);
      }
    }
    const bak = process.env.BACKUP_PATH;
    let old = null;
    if (bak) {
      try { old = readJson(bak); }
      catch (e) { console.error("BACKUP_UNREADABLE: " + e.message); process.exit(4); }
    }
    // MODEL SOVEREIGNTY: prove this run did not introduce a model key. Without
    // a backup the file was created by this run, so the key must be absent.
    const oldHadModel = old !== null && typeof old === "object" && !Array.isArray(old)
      ? hasOwn(old, "teammateDefaultModel") : false;
    if (!oldHadModel && hasOwn(cur, "teammateDefaultModel")) {
      console.error("MODEL_KEY_WRITTEN"); process.exit(4);
    }
    if (bak) {
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
      // Only the keys this script is allowed to touch may differ. teammateMode
      // is allowed to differ ONLY when it was actually written this run.
      const allowed = new Set(["env." + flagKey]);
      if (writeMode) allowed.add("teammateMode");
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
  local R_TMUX_MODE_LINE="NOT CHECKED"
  local R_MODE_VALUE="NOT DECIDED"
  local R_TMUX_CONF="NOT CHECKED" R_TMUX_CONF_BACKUP="N/A"
  local R_EXISTING="PRESERVED (nothing was modified)" R_ACTIVE="UNKNOWN" R_READY="NO"
  local R_NINE="NOT PRESENT — NOT CREATED (no claude-nine profile directory exists; this installer never creates one)"
  local DEFERRED=""
  local i=0

  NODE="$(resolve_node || true)"
  if [ -z "${NODE:-}" ]; then
    log "BLOCKER: node was not found (set NODE_BIN or put node on PATH)."
    log "Nothing was inspected, backed up, or modified."
    exit 2
  fi

  # ---- TARGET SET ----------------------------------------------------------
  # Read-only: this only decides which files WILL be processed, and is built
  # before the version gate so even a blocked run reports its targets honestly.
  build_root_set
  if [ "$SETTINGS_OVERRIDE" -eq 1 ]; then
    log "single-root override in effect: ${ROOT_PATH[0]}"
  else
    i=0
    while [ "$i" -lt "$ROOT_COUNT" ]; do
      log "target root: ${ROOT_LABEL[$i]} -> ${ROOT_PATH[$i]}"
      i=$((i + 1))
    done
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

  # ---- P0. TMUX DETECTION — DISPLAY MODE ONLY, READ-ONLY -------------------
  # tmux is NOT required for Agent Teams. The documented default display mode is
  # in-process and needs no extra setup; teammateMode selects DISPLAY ONLY.
  # This probe decides whether P5 may write teammateMode at all: a display mode
  # is never pointed at an absent binary.
  #
  # THE PROBE IS AN INVOCATION. `tmux -V` is RUN and its EXIT CODE is read;
  # PRESENT requires rc 0 AND a version string on stdout. `command -v` proves a
  # NAME resolves and never that the program runs, so it decides nothing here —
  # a name resolving to a binary that cannot start would otherwise get
  # teammateMode written against a program that cannot start.
  #
  # This phase now runs BEFORE P2, so P2's read-only session listing uses this
  # PROOF rather than resolving the name a second time. It is still AFTER the
  # version gate, so a version-blocked run still probes nothing at all and still
  # reports TMUX: NOT CHECKED rather than a finding it never made.
  local TMUX_PRESENT=0 TMUX_VERSION="" TMUX_PROBE_RC="" TMUX_ABSENT_REASON="" TMUX_BIN=""
  local WRITE_TEAMMATE_MODE=0
  probe_tmux || true
  if [ "$TMUX_PRESENT" -eq 1 ]; then
    WRITE_TEAMMATE_MODE=1
    log "P0 display-mode detection: tmux PROVED PRESENT BY RUNNING IT — \`tmux -V\` exited 0 and printed \"$TMUX_VERSION\" ($TMUX_BIN) — teammateMode will be set to \"$TEAMMATE_MODE\""
  else
    WRITE_TEAMMATE_MODE=0
    log "P0 display-mode detection: tmux ABSENT — $TMUX_ABSENT_REASON"
    log "P0 display-mode detection: teammateMode will NOT be written (in-process display mode applies)"
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
  # Gated on P0's PROOF, not on a name: asking a binary that cannot run to list
  # sessions tells you nothing, and a name that resolves is not a running tmux.
  if [ "$TMUX_PRESENT" -eq 1 ]; then
    TMUX_SESSIONS="$(tmux list-sessions 2>/dev/null || true)"
  fi
  log "Read-only inspection: $R_ACTIVE"
  if [ -n "$TMUX_SESSIONS" ]; then
    log "tmux sessions observed (left exactly as they are):"
    printf '%s\n' "$TMUX_SESSIONS" | while IFS= read -r l; do log "  $l"; done
  fi
  # Regardless of what was found: ASSUME ACTIVE WORK MUST BE PRESERVED.

  # ---- P3. BACK UP CLAUDE CODE SETTINGS — PER ROOT -------------------------
  local B
  i=0
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    mkdir -p "$(dirname "${ROOT_PATH[$i]}")"
    if [ -f "${ROOT_PATH[$i]}" ]; then
      B="$(make_backup "${ROOT_PATH[$i]}")"
      ROOT_BACKUP_PATHS[$i]="$B"
      ROOT_BACKUP[$i]="$B"
      log "${ROOT_LABEL[$i]} settings backup: $B"
    else
      ROOT_BACKUP_PATHS[$i]=""
      ROOT_BACKUP[$i]="N/A (no settings.json existed at this root; a new one was created)"
      log "${ROOT_LABEL[$i]}: no settings.json at ${ROOT_PATH[$i]} — a new one will be created"
    fi
    i=$((i + 1))
  done

  # ---- P4 + P5. MERGE THE KEY(S) — PER ROOT, one atomic write each ---------
  merge_all_roots

  # ---- P6. VERIFY TMUX ------------------------------------------------------
  # P0 already PROVED the answer by RUNNING `tmux -V`. This phase re-proves it
  # the same way, and only if an install actually runs — a `brew install` that
  # reports success is a claim, and it is checked, not believed.
  local TMUX_INSTALLED_HERE=0
  if [ "$TMUX_PRESENT" -eq 1 ]; then
    R_TMUX="INSTALLED (PROVED BY RUNNING \`tmux -V\`: rc 0, \"$TMUX_VERSION\")"
    R_TMUX_PATH="$TMUX_BIN"
    log "tmux already installed at $TMUX_BIN ($TMUX_VERSION) — not reinstalled"
  elif [ "$ALLOW_INSTALL" -eq 1 ] && command -v brew >/dev/null 2>&1; then
    log "tmux did not run ($TMUX_ABSENT_REASON); Homebrew is present — installing tmux (no terminal or session is touched)"
    if brew install tmux >&2; then
      # RE-PROVE BY RUNNING IT. "brew said it worked" is not a proof that a
      # program runs, and it is not accepted as one here.
      probe_tmux || true
      if [ "$TMUX_PRESENT" -eq 1 ]; then
        R_TMUX="INSTALLED (installed here, then PROVED BY RUNNING \`tmux -V\`: rc 0, \"$TMUX_VERSION\")"
        R_TMUX_PATH="$TMUX_BIN"
        TMUX_INSTALLED_HERE=1
      else
        R_TMUX="NOT INSTALLED (brew install reported success, but \`tmux -V\` still did not prove a runnable tmux: $TMUX_ABSENT_REASON)"
      fi
    else
      R_TMUX="NOT INSTALLED (brew install tmux failed — see the log above)"
    fi
  elif [ "$ALLOW_INSTALL" -eq 0 ]; then
    R_TMUX="NOT INSTALLED (probed by RUNNING \`tmux -V\`: $TMUX_ABSENT_REASON; install skipped: --no-install)"
  else
    # Homebrew is NEVER installed by this task (repo rule 11 and the procedure).
    R_TMUX="NOT INSTALLED (running \`tmux -V\` proved no usable tmux: $TMUX_ABSENT_REASON; and command -v brew found no Homebrew)"
  fi

  if [ "$TMUX_PRESENT" -ne 1 ]; then
    # DEGRADATION, NOT BLOCKAGE. tmux is a DISPLAY choice; Agent Teams are
    # enabled and fully usable without it in the in-process display mode.
    R_TMUX_MODE_LINE="$TMUX_DEGRADE_LINE"
    log "$TMUX_DEGRADE_LINE"
    DEFERRED="$DEFERRED
- $TMUX_DEGRADE_LINE
  Homebrew is never installed by this step, and tmux was not installed here.
  Everything else was still validated. Agent Teams are ENABLED and usable right
  now in the in-process display mode — Claude Code's documented default, which
  works in any terminal with no extra setup. Install tmux yourself whenever you
  want split panes, then rerun this step to switch the display mode over.
  WHY tmux was judged absent, from the probe that RAN it: $TMUX_ABSENT_REASON"
  else
    R_TMUX_MODE_LINE="tmux (split panes) — $TMUX_BIN — $TMUX_VERSION (proved by running \`tmux -V\`)"
  fi

  # ---- P5 (reconciliation) -------------------------------------------------
  # If P6 installed tmux just now, the display mode decided in P0 is stale. Redo
  # the merge per root so the written mode matches reality, instead of making
  # the operator run this step twice.
  if [ "$TMUX_INSTALLED_HERE" -eq 1 ] && [ "$WRITE_TEAMMATE_MODE" -eq 0 ]; then
    WRITE_TEAMMATE_MODE=1
    log "tmux became available during P6 — re-merging teammateMode=\"$TEAMMATE_MODE\" per root"
    merge_all_roots
  fi

  if [ "$WRITE_TEAMMATE_MODE" -eq 1 ]; then
    R_MODE_VALUE="$TEAMMATE_MODE"
  else
    R_MODE_VALUE="in-process (Claude Code's documented default — no teammateMode key was written)"
  fi

  # ---- P7. BACK UP TMUX CONFIGURATION --------------------------------------
  if [ -f "$TMUX_CONF" ]; then
    R_TMUX_CONF_BACKUP="$(make_backup "$TMUX_CONF")"
    log "tmux config backup: $R_TMUX_CONF_BACKUP"
  fi

  # ---- P8. CONFIGURE TMUX FOR CLAUDE CODE ----------------------------------
  # Written even when tmux is absent: the file is inert without tmux, and a
  # later install then needs no further edit.
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

  # ---- P9. VALIDATE SETTINGS.JSON — PER ROOT -------------------------------
  # Each root is validated against ITS OWN backup, and a failure restores THAT
  # root's backup. A root that already validated stays configured: rolling back
  # a good root because a different root failed would delete a landed, verified
  # change the operator asked for.
  local VALID_OUT VALID_RC ANY_INVALID=0
  i=0
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    VALID_RC=0
    set +e
    VALID_OUT="$(validate_settings "${ROOT_PATH[$i]}" "${ROOT_BACKUP_PATHS[$i]}" "$WRITE_TEAMMATE_MODE" 2>&1)"
    VALID_RC=$?
    set -e
    # Test-only seam: --selftest uses it to prove the restore path really restores.
    if [ -n "${AGENT_TEAMS_FORCE_VALIDATION_FAILURE:-}" ]; then
      VALID_RC=4
      VALID_OUT="FORCED_VALIDATION_FAILURE (selftest seam)"
    fi
    if [ "$VALID_RC" -eq 0 ]; then
      ROOT_JSON[$i]="VALID"
      ROOT_FLAG[$i]="CONFIRMED"
      ROOT_EXISTING[$i]="PRESERVED"
      if [ "$WRITE_TEAMMATE_MODE" -eq 1 ]; then
        ROOT_MODE[$i]="CONFIRMED (\"$TEAMMATE_MODE\")"
      fi
    else
      ANY_INVALID=1
      ROOT_JSON[$i]="INVALID"
      ROOT_FLAG[$i]="NOT CONFIRMED"
      ROOT_MODE[$i]="NOT CONFIRMED"
      log "${ROOT_LABEL[$i]}: settings validation FAILED: $VALID_OUT"
      case "$VALID_OUT" in
        *PRE_EXISTING_SETTINGS_LOST*) ROOT_EXISTING[$i]="PROBLEM FOUND ($VALID_OUT)" ;;
        *MODEL_KEY_WRITTEN*) ROOT_EXISTING[$i]="PROBLEM FOUND (a model key appeared — refused and rolled back)" ;;
      esac
      if [ -n "${ROOT_BACKUP_PATHS[$i]}" ] && [ -f "${ROOT_BACKUP_PATHS[$i]}" ]; then
        cp -p "${ROOT_BACKUP_PATHS[$i]}" "${ROOT_PATH[$i]}"
        log "RESTORED the backup: ${ROOT_BACKUP_PATHS[$i]} -> ${ROOT_PATH[$i]}"
        ROOT_EXISTING[$i]="PRESERVED (restored from backup — no change landed)"
      else
        log "${ROOT_LABEL[$i]}: no backup existed (the file was created by this run); the new file was left in place for inspection"
      fi
    fi
    i=$((i + 1))
  done

  if [ "$ANY_INVALID" -eq 0 ]; then
    R_JSON="VALID"
    R_FLAG="CONFIRMED"
    R_TEAMS="ENABLED"
    R_EXISTING="PRESERVED"
    if [ "$WRITE_TEAMMATE_MODE" -eq 1 ]; then
      R_MODE="CONFIRMED"
    else
      R_MODE="NOT WRITTEN — tmux is absent, and a display mode is never pointed at a binary that is not installed"
    fi
  else
    R_JSON="INVALID"
    R_TEAMS="FAILED"
    R_FLAG="NOT CONFIRMED"
    R_MODE="NOT CONFIRMED"
    R_EXISTING="PRESERVED (restored from backup — no change landed)"
    print_report
    printf '\nAgent Teams were NOT enabled on at least one root. That root was restored from its backup above.\n'
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
  # It is a CONFIG ROOT, not a footnote: `claude-nine` (and `claude-codex`,
  # which execs it) reads settings from there and from nowhere else, so leaving
  # it alone left routed sessions with Agent Teams switched off.
  if [ "$SETTINGS_OVERRIDE" -eq 1 ]; then
    if [ -f "$NINE_PROFILE" ]; then
      R_NINE="PRESENT — NOT PROCESSED (--settings single-root override was in effect; rerun without --settings to configure every root)"
    fi
  else
    i=0
    while [ "$i" -lt "$ROOT_COUNT" ]; do
      if [ "${ROOT_KIND[$i]}" = "nine" ]; then
        R_NINE="CONFIGURED — ${ROOT_PATH[$i]} (see CLAUDE-NINE ROOT above; \`claude-codex\` shares this root)"
      fi
      i=$((i + 1))
    done
  fi

  # ---- P11 / P12 -----------------------------------------------------------
  # Nothing above spawned a teammate, created a team, opened a pane, launched
  # tmux, started another Claude Code instance, or restarted this session.

  # ---- READY ----------------------------------------------------------------
  # Teams are READY whenever the settings validated. tmux only decides HOW
  # teammates are displayed, so its absence downgrades the display, never the
  # readiness.
  if [ "$R_JSON" = "VALID" ]; then
    if [ "$TMUX_PRESENT" -eq 1 ]; then
      if [ "$R_TMUX_CONF" = "READY" ] || [ "$R_TMUX_CONF" = "RELOAD DEFERRED" ]; then
        R_READY="YES"
      else
        R_READY="YES (in-process display mode; the tmux config is not complete — see DEFERRED below)"
      fi
    else
      R_READY="YES (in-process display mode — split panes need tmux, which is not installed)"
    fi
  else
    R_READY="NO"
  fi

  print_report

  # ---- P14. THE NEXT COMMAND — TOLD, NEVER RUN -----------------------------
  # Two branches, and the one printed is the one that matches what was actually
  # configured on this machine.
  local NINE_CONFIGURED=0
  i=0
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    if [ "${ROOT_KIND[$i]}" = "nine" ]; then NINE_CONFIGURED=1; fi
    i=$((i + 1))
  done

  printf '\nWHEN YOU ARE READY, open a SEPARATE NEW terminal window and run:\n\n'
  # Branch on the PROOF, never on a name: telling the operator to run a program
  # that cannot start is the same defect one step further downstream.
  if [ "$TMUX_PRESENT" -eq 1 ]; then
    printf '    tmux\n'
    printf '    claude --teammate-mode tmux\n'
    if [ "$NINE_CONFIGURED" -eq 1 ]; then
      printf '\nFor the routed launcher, the same two lines with claude-nine:\n\n'
      printf '    tmux\n'
      printf '    claude-nine --teammate-mode tmux\n'
    fi
  else
    printf '    claude\n'
    if [ "$NINE_CONFIGURED" -eq 1 ]; then
      printf '    claude-nine        # the routed launcher, same setting, its own root\n'
    fi
    printf '\n%s\n' "$TMUX_DEGRADE_LINE"
    printf 'No --teammate-mode flag is needed or wanted: teammates run in the in-process\n'
    printf 'display mode, which works in any terminal. Install tmux later and rerun this\n'
    printf 'step if you want split panes.\n'
  fi
  cat <<'NEXT'

These commands were NOT run for you. The setting applies to NEW Claude Code
sessions only; anything running right now keeps running exactly as it is.
NEXT
  if [ -n "$DEFERRED" ]; then
    printf '\nDEFERRED (reported, not performed — running work comes first):%s\n' "$DEFERRED"
  fi
  exit 0
}

# merge_all_roots — P4 (+P5) across every targeted root. Split out so the P6
# reconciliation can rerun it without duplicating the failure handling.
merge_all_roots() {
  local i=0 MERGE_OUT MERGE_RC
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    MERGE_RC=0
    set +e
    MERGE_OUT="$(merge_settings "${ROOT_PATH[$i]}" "$WRITE_TEAMMATE_MODE" 2>&1)"
    MERGE_RC=$?
    set -e
    if [ "$MERGE_RC" -ne 0 ]; then
      log "${ROOT_LABEL[$i]}: settings merge failed: $MERGE_OUT"
      if [ -n "${ROOT_BACKUP_PATHS[$i]}" ] && [ -f "${ROOT_BACKUP_PATHS[$i]}" ]; then
        cp -p "${ROOT_BACKUP_PATHS[$i]}" "${ROOT_PATH[$i]}"
        log "RESTORED the backup: ${ROOT_BACKUP_PATHS[$i]} -> ${ROOT_PATH[$i]}"
        ROOT_EXISTING[$i]="PRESERVED (restored from backup — no change landed)"
      fi
      ROOT_JSON[$i]="INVALID"
      R_JSON="INVALID"
      R_TEAMS="FAILED"
      print_report
      exit 2
    fi

    # teammateMode reporting, per root.
    if [ "$WRITE_TEAMMATE_MODE" -eq 1 ]; then
      case "$MERGE_OUT" in
        *"PREV_MODE=<absent>"*|*"PREV_MODE=$TEAMMATE_MODE"*) : ;;
        *) DEFERRED="$DEFERRED
- ${ROOT_LABEL[$i]}: teammateMode already had a different value; it was set to
  \"$TEAMMATE_MODE\" as the procedure requires. The previous value is preserved in
  that root's backup above." ;;
      esac
      ROOT_MODE[$i]="WRITTEN (\"$TEAMMATE_MODE\")"
    else
      case "$MERGE_OUT" in
        *"PREV_MODE=<absent>"*)
          ROOT_MODE[$i]="NOT WRITTEN — in-process display mode (tmux is not installed)" ;;
        *)
          ROOT_MODE[$i]="NOT WRITTEN — your existing teammateMode was left untouched (tmux is not installed)" ;;
      esac
    fi

    # ---- ROUTED-PROFILE MODEL CHECK — REPORT ONLY, NEVER A WRITE -----------
    # A routed root serves models through the local router. A teammate spawned
    # with no explicit model falls back to the provider default, which the
    # router may not serve at all — the teammate then presents as a spinner and
    # only fails hours later. The fix key is named and recommended here and is
    # NEVER written: models belong to the operator and to the client.
    if [ "${ROOT_KIND[$i]}" = "nine" ]; then
      case "$MERGE_OUT" in
        *"HAS_TEAMMATE_DEFAULT_MODEL=1"*)
          ROOT_NOTE[$i]="  TEAMMATE DEFAULT MODEL: present — left exactly as it is (never read for its value, never written)" ;;
        *)
          ROOT_NOTE[$i]="$NINE_MODEL_WARNING"
          printf '%s\n' "$NINE_MODEL_WARNING" >&2 ;;
      esac
    fi

    log "${ROOT_LABEL[$i]}: merged $FLAG_KEY=\"$FLAG_VALUE\" into env (${ROOT_MODE[$i]})"
    i=$((i + 1))
  done
}

# build_roots_report — the PER ROOT section of the report. Each root prints its
# own label, its own file, and its own backup path.
build_roots_report() {
  local i=0 out=""
  if [ "$ROOT_COUNT" -eq 0 ]; then
    printf 'NONE (no target root was resolved)'
    return 0
  fi
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    out="$out${ROOT_LABEL[$i]}: ${ROOT_PATH[$i]}
  SETTINGS JSON:     ${ROOT_JSON[$i]}
  EXPERIMENTAL FLAG: ${ROOT_FLAG[$i]}
  TEAMMATE MODE:     ${ROOT_MODE[$i]}
  BACKUP:            ${ROOT_BACKUP[$i]}
  EXISTING VALUES:   ${ROOT_EXISTING[$i]}
"
    if [ -n "${ROOT_NOTE[$i]}" ]; then
      out="$out${ROOT_NOTE[$i]}
"
    fi
    i=$((i + 1))
  done
  printf '%s' "$out"
}

# build_backups_report — every backup path, one line per root.
build_backups_report() {
  local i=0 out=""
  if [ "$ROOT_COUNT" -eq 0 ]; then
    printf 'N/A'
    return 0
  fi
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    if [ "$i" -gt 0 ]; then
      out="$out
"
    fi
    out="$out${ROOT_LABEL[$i]}: ${ROOT_BACKUP[$i]}"
    i=$((i + 1))
  done
  printf '%s' "$out"
}

# build_files_report — every targeted settings file, one line per root.
build_files_report() {
  local i=0 out=""
  if [ "$ROOT_COUNT" -eq 0 ]; then
    printf 'N/A'
    return 0
  fi
  while [ "$i" -lt "$ROOT_COUNT" ]; do
    if [ "$i" -gt 0 ]; then
      out="$out
"
    fi
    out="$out${ROOT_LABEL[$i]}: ${ROOT_PATH[$i]}"
    i=$((i + 1))
  done
  printf '%s' "$out"
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
$R_MODE_VALUE
$R_MODE

TMUX:
$R_TMUX

TMUX PATH:
$R_TMUX_PATH

TMUX DISPLAY MODE:
$R_TMUX_MODE_LINE

CLAUDE SETTINGS JSON:
$R_JSON

CLAUDE SETTINGS FILE:
$(build_files_report)

CLAUDE SETTINGS BACKUP:
$(build_backups_report)

CONFIGURED ROOTS:
$(build_roots_report)
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
# --selftest — exercises the nine behaviours the safety envelope depends on, in
# a sandbox HOME. Touches nothing outside its own temp directory, installs
# nothing, and never spawns or signals anything.
#
# Every case runs the script with HOME pointed at its own throwaway directory,
# with an absolute NODE_BIN and BASH so the result never depends on the caller's
# PATH, and with a FAKE tmux so the display-mode cases are deterministic on
# hosts with and without real tmux. The fake ANSWERS `tmux -V` — because that is
# now how the script proves presence — and does nothing at all for every other
# invocation, so it never starts a server, never lists a session, and is never
# signalled.
#
# Two cases carry their own CONTROL and refuse to render a verdict unless it
# holds, because each is asserting a NEGATIVE about tmux:
#   Case 7 runs with a sanitised PATH where the tmux NAME resolves to nothing at
#          all; its control requires `tmux -V` to abort with rc 127.
#   Case 9 runs with a PATH where the tmux NAME DOES resolve, to a binary that
#          cannot run; its control requires BOTH halves of that — the name must
#          resolve, and running it must fail — or the sandbox is not reproducing
#          the defect and the case proves nothing.
# ---------------------------------------------------------------------------

selftest() {
  local box fake nobin rc fails=0 total=9
  box="$(mktemp -d "${TMPDIR:-/tmp}/enable-agent-teams-selftest.XXXXXX")"
  fake="$box/bin"
  nobin="$box/nobin"
  mkdir -p "$fake" "$nobin"
  printf '#!/bin/sh\necho "2.1.227 (Claude Code)"\n' > "$fake/claude"
  chmod 755 "$fake/claude"
  # A fake tmux that is PROVABLE BY RUNNING IT, because that is how the script
  # detects one: `tmux -V` prints a version and exits 0. EVERY OTHER invocation
  # exits 1 without doing anything, so it never starts a server, never lists a
  # session, and is never signalled.
  cat > "$fake/tmux" <<'FAKETMUX'
#!/bin/sh
case "$1" in
  -V) echo "tmux 3.5a"; exit 0 ;;
esac
exit 1
FAKETMUX
  chmod 755 "$fake/tmux"

  local NODE_T BASH_T
  NODE_T="$(resolve_node || true)"
  if [ -z "${NODE_T:-}" ]; then
    printf 'FAIL  selftest: node not found (set NODE_BIN or put node on PATH)\n'
    exit 1
  fi
  BASH_T="${BASH:-$(command -v bash)}"

  # Every seam is set EXPLICITLY on every run, including the ones being cleared,
  # so an inherited AGENT_TEAMS_* variable in the caller's environment can never
  # steer a selftest case at a real file.
  st_run() { # st_run <home> [extra args...] — single-root, fake tmux present
    local h="$1"; shift
    HOME="$h" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$fake:$PATH" \
      AGENT_TEAMS_SETTINGS="$h/.claude/settings.json" \
      AGENT_TEAMS_TMUX_CONF="$h/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h/.claude-nine/settings.json" \
      AGENT_TEAMS_BACKUP_STAMP="" AGENT_TEAMS_FORCE_VALIDATION_FAILURE="" \
      "$BASH_T" "$SELF" --no-install "$@" > "$h/report.txt" 2> "$h/log.txt"
  }

  st_run_multi() { # st_run_multi <home> [extra args...] — DEFAULT multi-root
    local h="$1"; shift
    HOME="$h" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$fake:$PATH" \
      AGENT_TEAMS_SETTINGS="" \
      AGENT_TEAMS_TMUX_CONF="$h/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h/.claude-nine/settings.json" \
      AGENT_TEAMS_BACKUP_STAMP="" AGENT_TEAMS_FORCE_VALIDATION_FAILURE="" \
      "$BASH_T" "$SELF" --no-install "$@" > "$h/report.txt" 2> "$h/log.txt"
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
  HOME="$h3" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$fake:$PATH" \
    AGENT_TEAMS_SETTINGS="$h3/.claude/settings.json" \
    AGENT_TEAMS_TMUX_CONF="$h3/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h3/.claude-nine/settings.json" \
    AGENT_TEAMS_BACKUP_STAMP="$stamp" \
    "$BASH_T" "$SELF" --no-install > "$h3/report.txt" 2> "$h3/log.txt" || rc=$?
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
  HOME="$h5" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$fake:$PATH" \
    AGENT_TEAMS_SETTINGS="$h5/.claude/settings.json" \
    AGENT_TEAMS_TMUX_CONF="$h5/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h5/.claude-nine/settings.json" \
    AGENT_TEAMS_FORCE_VALIDATION_FAILURE=1 \
    "$BASH_T" "$SELF" --no-install > "$h5/report.txt" 2> "$h5/log.txt" || rc=$?
  if [ "$rc" -eq 2 ] && cmp -s "$h5/original.json" "$h5/.claude/settings.json" && \
     awk '/^CLAUDE SETTINGS JSON:$/ { getline; if ($0 == "INVALID") found = 1 } END { exit found ? 0 : 1 }' "$h5/report.txt"; then
    printf 'PASS  5. a failed validation restores the backup and reports INVALID (exit 2)\n'
  else
    printf 'FAIL  5. validation failure -> restore (exit %s) — see %s\n' "$rc" "$h5/log.txt"
    fails=$((fails + 1))
  fi

  # 6. MULTI-ROOT — BOTH config roots configured, each with its own backup, and
  #    every hand-tuned value in each root untouched.
  local h6="$box/case6"
  mkdir -p "$h6/.claude" "$h6/.claude-nine"
  cat > "$h6/.claude/settings.json" <<'JSON'
{
  "model": "plain-root-model",
  "env": { "SENTINEL": "six-plain" },
  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] }
}
JSON
  cat > "$h6/.claude-nine/settings.json" <<'JSON'
{
  "model": "routed-alias",
  "teammateDefaultModel": null,
  "env": { "SENTINEL": "six-routed", "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999" },
  "permissions": { "allow": ["Bash(git status:*)"], "deny": [] },
  "customProviders": { "local-router": { "models": ["alias-a", "alias-b"] } }
}
JSON
  rc=0; st_run_multi "$h6" || rc=$?
  if [ "$rc" -eq 0 ] && HOME6="$h6" REPORT="$h6/report.txt" st_node '
      const fs = require("fs");
      const h = process.env.HOME6;
      const rep = fs.readFileSync(process.env.REPORT, "utf8");
      const plain = JSON.parse(fs.readFileSync(h + "/.claude/settings.json", "utf8"));
      const nine  = JSON.parse(fs.readFileSync(h + "/.claude-nine/settings.json", "utf8"));
      const baks = (d) => fs.readdirSync(d).filter((f) => /^settings\.json\.backup\./.test(f));
      const bp = baks(h + "/.claude"), bn = baks(h + "/.claude-nine");
      // Prove the per-root backups exist BEFORE reading them, so a genuine
      // failure reports one clear line instead of an unhandled ENOENT trace.
      if (bp.length !== 1 || bn.length !== 1) {
        console.error("EXPECTED exactly one backup per root; found " + bp.length +
          " in .claude and " + bn.length + " in .claude-nine");
        process.exit(1);
      }
      const bpj = JSON.parse(fs.readFileSync(h + "/.claude/" + bp[0], "utf8"));
      const bnj = JSON.parse(fs.readFileSync(h + "/.claude-nine/" + bn[0], "utf8"));
      const ok =
        plain.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
        && nine.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
        && plain.teammateMode === "tmux" && nine.teammateMode === "tmux"
        && plain.env.SENTINEL === "six-plain" && nine.env.SENTINEL === "six-routed"
        && plain.model === "plain-root-model" && nine.model === "routed-alias"
        && nine.teammateDefaultModel === null
        && nine.customProviders["local-router"].models.length === 2
        && nine.permissions.allow[0] === "Bash(git status:*)"
        // one backup per root, in that root, and each holds the PRE-merge file
        && bp.length === 1 && bn.length === 1
        && !bpj.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
        && !bnj.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
        && bpj.env.SENTINEL === "six-plain" && bnj.env.SENTINEL === "six-routed"
        // both roots are reported under their own labels, with their own backups
        && rep.indexOf("CLAUDE ROOT: " + h + "/.claude/settings.json") !== -1
        && rep.indexOf("CLAUDE-NINE ROOT: " + h + "/.claude-nine/settings.json") !== -1
        && rep.indexOf(h + "/.claude/" + bp[0]) !== -1
        && rep.indexOf(h + "/.claude-nine/" + bn[0]) !== -1;
      process.exit(ok ? 0 : 1);'; then
    printf 'PASS  6. a multi-root run configures BOTH roots, each with its own backup, nothing else touched\n'
  else
    printf 'FAIL  6. multi-root configuration (exit %s) — see %s\n' "$rc" "$h6/log.txt"
    fails=$((fails + 1))
  fi

  # 7. NO TMUX -> teammateMode ABSENT, degradation reported, NOT blocked.
  #    CONTROL FIRST, and run the same way the script now probes: `tmux -V`
  #    under the sanitised PATH must abort with rc 127, the shell's "nothing to
  #    run" code. A version printed, or any other exit code, means the sandbox
  #    is not clean — this case then proves nothing and SAYS SO rather than
  #    rendering a verdict. The control runs in a fresh `bash -c` so no command
  #    hash from this shell can make the name resolve behind the sandbox PATH.
  local h7="$box/case7" SAFE_PATH="$nobin:/usr/bin:/bin"
  local CTL7_OUT CTL7_RC=0
  mkdir -p "$h7/.claude"
  printf '{ "env": { "SENTINEL": "seven" }, "model": "seven-model" }\n' > "$h7/.claude/settings.json"
  set +e
  CTL7_OUT="$(PATH="$SAFE_PATH" "$BASH_T" -c 'tmux -V' 2>&1)"
  CTL7_RC=$?
  set -e
  if [ "$CTL7_RC" -ne 127 ]; then
    printf 'FAIL  7. no-tmux degradation — CONTROL FAILED: `tmux -V` under the sandbox PATH exited %s (want 127); output: %s. tmux is reachable there, so the case is invalid\n' "$CTL7_RC" "$CTL7_OUT"
    fails=$((fails + 1))
  else
    rc=0
    HOME="$h7" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$SAFE_PATH" \
      AGENT_TEAMS_SETTINGS="$h7/.claude/settings.json" \
      AGENT_TEAMS_TMUX_CONF="$h7/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h7/.claude-nine/settings.json" \
      "$BASH_T" "$SELF" --no-install > "$h7/report.txt" 2> "$h7/log.txt" || rc=$?
    if [ "$rc" -eq 0 ] && SETTINGS="$h7/.claude/settings.json" REPORT="$h7/report.txt" \
       DEGRADE="$TMUX_DEGRADE_LINE" st_node '
        const fs = require("fs");
        const s = JSON.parse(fs.readFileSync(process.env.SETTINGS, "utf8"));
        const rep = fs.readFileSync(process.env.REPORT, "utf8");
        const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        const ok = s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
          && !has(s, "teammateMode")            // never a mode pointing at an absent binary
          && s.env.SENTINEL === "seven" && s.model === "seven-model"
          && rep.indexOf(process.env.DEGRADE) !== -1
          // the WHY, and the RIGHT why: this is non-resolution, not a broken binary
          && rep.indexOf("NAME DID NOT RESOLVE") !== -1
          && rep.indexOf("rc 127") !== -1
          && rep.indexOf("RESOLVED BUT FAILED TO RUN") === -1
          && rep.indexOf("INSTALLATION BLOCKED") === -1
          && /READY FOR A NEW AGENT-TEAM SESSION:\nYES/.test(rep);
        process.exit(ok ? 0 : 1);'; then
      printf 'PASS  7. no tmux -> teammateMode stays ABSENT, teams still ENABLED, degradation not blockage, reason reported as rc 127 non-resolution (exit 0)\n'
    else
      printf 'FAIL  7. no-tmux degradation (exit %s) — see %s\n' "$rc" "$h7/log.txt"
      fails=$((fails + 1))
    fi
  fi

  # 8. ROUTED-PROFILE MODEL CHECK — report only, never a write. Both halves:
  #    absent -> the warning appears and NO model key is written;
  #    present -> no warning, and the operator's value is left exactly as it is.
  local h8a="$box/case8a" h8b="$box/case8b"
  mkdir -p "$h8a/.claude" "$h8a/.claude-nine" "$h8b/.claude" "$h8b/.claude-nine"
  printf '{ "env": { "SENTINEL": "eight-a-plain" } }\n' > "$h8a/.claude/settings.json"
  printf '{ "model": "routed-alias", "env": { "SENTINEL": "eight-a-routed" } }\n' > "$h8a/.claude-nine/settings.json"
  printf '{ "env": { "SENTINEL": "eight-b-plain" } }\n' > "$h8b/.claude/settings.json"
  printf '{ "model": "routed-alias", "teammateDefaultModel": null, "env": { "SENTINEL": "eight-b-routed" } }\n' > "$h8b/.claude-nine/settings.json"
  rc=0; st_run_multi "$h8a" || rc=$?
  local rc8b=0; st_run_multi "$h8b" || rc8b=$?
  if [ "$rc" -eq 0 ] && [ "$rc8b" -eq 0 ] && \
     A="$h8a" B="$h8b" WARN="$NINE_MODEL_WARNING" st_node '
      const fs = require("fs");
      const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
      const warnHead = process.env.WARN.split("\n")[0];
      const a = process.env.A, b = process.env.B;
      const aNine = JSON.parse(fs.readFileSync(a + "/.claude-nine/settings.json", "utf8"));
      const bNine = JSON.parse(fs.readFileSync(b + "/.claude-nine/settings.json", "utf8"));
      const aRep = fs.readFileSync(a + "/report.txt", "utf8");
      const bRep = fs.readFileSync(b + "/report.txt", "utf8");
      const ok =
        // absent: warned, in full, and STILL not written
        aRep.indexOf(process.env.WARN) !== -1
        && !has(aNine, "teammateDefaultModel")
        && aNine.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
        && aNine.model === "routed-alias"
        // present (the control): no warning, value untouched
        && bRep.indexOf(warnHead) === -1
        && has(bNine, "teammateDefaultModel") && bNine.teammateDefaultModel === null
        && bNine.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1";
      process.exit(ok ? 0 : 1);'; then
    printf 'PASS  8. routed root without teammateDefaultModel warns and writes NO model key (control: present -> no warning, untouched)\n'
  else
    printf 'FAIL  8. routed-profile model check (exit %s/%s) — see %s and %s\n' "$rc" "$rc8b" "$h8a/log.txt" "$h8b/log.txt"
    fails=$((fails + 1))
  fi

  # 9. A tmux NAME THAT RESOLVES TO A BINARY THAT CANNOT RUN IS *ABSENT*.
  #    THE REGRESSION TEST FOR THE `command -v` DEFECT. Name resolution said
  #    "tmux is here"; the binary exits non-zero the moment it is asked to do
  #    anything. Detection by name would have written teammateMode: "tmux"
  #    against a program that cannot start — a working setup turned into a
  #    support call. Detection by INVOCATION must call this ABSENT, omit the
  #    key, and report the degradation with the right reason.
  #
  #    CONTROL FIRST, BOTH HALVES, or the sandbox is not reproducing the defect:
  #      (a) the NAME must RESOLVE under this PATH — checked with `type -P`,
  #          which is the trap being tested, used here deliberately to prove the
  #          trap is armed, and never as the script's own presence proof; and
  #      (b) RUNNING it must FAIL with rc 3.
  #    If either half does not hold, no verdict is rendered and the case says so.
  local h9="$box/case9" broken="$box/brokenbin" BROKEN_PATH RESOLVED_TO
  local CTL9_OUT CTL9_RC=0
  mkdir -p "$broken" "$h9/.claude"
  cat > "$broken/tmux" <<'BROKENTMUX'
#!/bin/sh
echo "dyld: Library not loaded: libevent-2.1.7.dylib" >&2
exit 3
BROKENTMUX
  chmod 755 "$broken/tmux"
  BROKEN_PATH="$broken:/usr/bin:/bin"
  printf '{ "env": { "SENTINEL": "nine" }, "model": "nine-model" }\n' > "$h9/.claude/settings.json"
  set +e
  RESOLVED_TO="$(PATH="$BROKEN_PATH" "$BASH_T" -c 'type -P tmux' 2>/dev/null)"
  CTL9_OUT="$(PATH="$BROKEN_PATH" "$BASH_T" -c 'tmux -V' 2>&1)"
  CTL9_RC=$?
  set -e
  if [ "$RESOLVED_TO" != "$broken/tmux" ] || [ "$CTL9_RC" -ne 3 ]; then
    printf 'FAIL  9. resolved-but-broken tmux — CONTROL FAILED: the NAME must resolve to %s (resolved to "%s") while RUNNING it fails with rc 3 (got rc %s: %s). The sandbox is not reproducing the defect, so the case is invalid\n' \
      "$broken/tmux" "$RESOLVED_TO" "$CTL9_RC" "$CTL9_OUT"
    fails=$((fails + 1))
  else
    rc=0
    HOME="$h9" CLAUDE_BIN="$fake/claude" NODE_BIN="$NODE_T" PATH="$BROKEN_PATH" \
      AGENT_TEAMS_SETTINGS="$h9/.claude/settings.json" \
      AGENT_TEAMS_TMUX_CONF="$h9/.tmux.conf" AGENT_TEAMS_NINE_SETTINGS="$h9/.claude-nine/settings.json" \
      AGENT_TEAMS_BACKUP_STAMP="" AGENT_TEAMS_FORCE_VALIDATION_FAILURE="" \
      "$BASH_T" "$SELF" --no-install > "$h9/report.txt" 2> "$h9/log.txt" || rc=$?
    if [ "$rc" -eq 0 ] && SETTINGS="$h9/.claude/settings.json" REPORT="$h9/report.txt" \
       DEGRADE="$TMUX_DEGRADE_LINE" st_node '
        const fs = require("fs");
        const s = JSON.parse(fs.readFileSync(process.env.SETTINGS, "utf8"));
        const rep = fs.readFileSync(process.env.REPORT, "utf8");
        const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        const ok = s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1"
          // THE WHOLE POINT: a name that resolves is not a program that runs
          && !has(s, "teammateMode")
          && s.env.SENTINEL === "nine" && s.model === "nine-model"
          && rep.indexOf(process.env.DEGRADE) !== -1
          // the WHY, and the RIGHT why: something IS installed and it is broken
          && rep.indexOf("RESOLVED BUT FAILED TO RUN") !== -1
          && rep.indexOf("rc 3") !== -1
          && rep.indexOf("NAME DID NOT RESOLVE") === -1
          && rep.indexOf("INSTALLATION BLOCKED") === -1
          && /READY FOR A NEW AGENT-TEAM SESSION:\nYES/.test(rep);
        process.exit(ok ? 0 : 1);'; then
      printf 'PASS  9. a tmux NAME that resolves to a binary that cannot run is ABSENT — teammateMode omitted, degradation reported as rc 3 resolved-but-failing (exit 0)\n'
    else
      printf 'FAIL  9. resolved-but-broken tmux treated as absent (exit %s) — see %s\n' "$rc" "$h9/log.txt"
      fails=$((fails + 1))
    fi
  fi

  printf '\nselftest: %s/%s passed\n' "$((total - fails))" "$total"
  if [ "$fails" -eq 0 ]; then
    rm -rf "$box"
    exit 0
  fi
  printf 'selftest artifacts kept for inspection: %s\n' "$box"
  exit 1
}

SELF="$0"
DO_SELFTEST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --settings) [ $# -ge 2 ] || usage; SETTINGS_PATH="$2"; SETTINGS_OVERRIDE=1; shift 2 ;;
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
