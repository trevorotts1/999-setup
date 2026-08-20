#!/bin/bash
# Run one Kaizen cycle headlessly via the chosen launcher.
# Truthful exit: exit 0 only when the launcher exited 0.
# Writes the raw log and a run JSON under the loop's cycles/ folder.
# Never prints secrets; on failure only the log path is printed.
#
# usage: run-kaizen-cycle.sh <loop-id> [--launcher claude-nine]

set -uo pipefail

LOOP_ID="${1:?usage: run-kaizen-cycle.sh <loop-id> [--launcher claude-nine]}"
LAUNCHER="claude-nine"
if [ "$#" -ge 3 ] && [ "$2" = "--launcher" ]; then
  LAUNCHER="$3"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
STATE_MJS="$SCRIPT_DIR/../common/kaizen-state.mjs"
NODE_BIN="${KAIZEN_NODE_BIN:-node}"

if ! [[ "$LOOP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]]; then
  echo "run-kaizen-cycle: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}" >&2
  exit 2
fi

# --- Resolve the loop dir: kaizen-state.mjs locate-loop first, then the
# registry root/<loop-id> fallback, then resolve-kaizen-root. Fail only when
# no path with a STATE.json exists.
LOOP_DIR=""
if REG_OUT="$("$NODE_BIN" "$STATE_MJS" locate-loop "$LOOP_ID" 2>/dev/null)"; then
  LOOP_DIR="$REG_OUT"
else
  REG_ROOT="$("$NODE_BIN" "$STATE_MJS" locate 2>/dev/null || true)"
  if [ -n "$REG_ROOT" ] && [ -d "$REG_ROOT/$LOOP_ID" ]; then
    LOOP_DIR="$REG_ROOT/$LOOP_ID"
  else
    ROOT_DIR="$(bash "$SCRIPT_DIR/resolve-kaizen-root.sh")"
    [ -d "$ROOT_DIR/$LOOP_ID" ] && LOOP_DIR="$ROOT_DIR/$LOOP_ID"
  fi
fi

if [ -z "$LOOP_DIR" ] || [ ! -f "$LOOP_DIR/STATE.json" ]; then
  echo "run-kaizen-cycle: no Memory folder with STATE.json for loop: $LOOP_ID" >&2
  exit 0
fi

# --- Duplicate-run guard: never start a second cycle while one is running.
# kaizen-state.mjs is-locked prints {"locked":true|false,...} and exits 0,
# so the JSON decides. Lock-file fallback for older kaizen-state.mjs.
LOCKED=0
LOCK_JSON="$("$NODE_BIN" "$STATE_MJS" is-locked "$LOOP_ID" 2>/dev/null)" || LOCK_JSON=""
case "$LOCK_JSON" in
  *'"locked":true'*) LOCKED=1 ;;
esac
if [ "$LOCKED" = "0" ] && [ -f "$LOOP_DIR/.cycle-lock.json" ]; then
  STALE="$("$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
try {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const t = Date.parse(j.started_at);
  process.stdout.write(Number.isNaN(t) || Date.now() - t > 6 * 3600 * 1000 ? "stale" : "fresh");
} catch (e) { process.stdout.write("broken"); }
' "$LOOP_DIR/.cycle-lock.json")"
  [ "$STALE" = "fresh" ] && LOCKED=1
fi
if [ "$LOCKED" = "1" ]; then
  TS="$(date '+%Y-%m-%dT%H%M%S')"
  echo "run-kaizen-cycle: skipped: $LOOP_ID (cycle already in progress)"
  printf '{"skipped":true,"loop_id":"%s","at":"%s","reason":"cycle lock held"}\n' "$LOOP_ID" "$(date '+%Y-%m-%dT%H:%M:%SZ')"
  exit 0
fi

if ! command -v "$LAUNCHER" >/dev/null 2>&1; then
  echo "run-kaizen-cycle: launcher not found: $LAUNCHER" >&2
  exit 0
fi

# --- Working directory: target_local_path when set and it exists, else the
# loop dir (safe fallback).
WORK_DIR="$LOOP_DIR"
if [ -f "$LOOP_DIR/LOCAL_STATE.json" ]; then
  TARGET="$("$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
process.stdout.write((j && typeof j.local_target_path === "string" && j.local_target_path) || "");
' "$LOOP_DIR/LOCAL_STATE.json")"
  if [ -n "$TARGET" ] && [ -d "$TARGET" ]; then
    WORK_DIR="$TARGET"
  fi
fi

# --- Skill dir: explicit env, then ~/.claude/skills/kaizen, then the repo
# location of this script (../.. from scripts/macos). Exported so the
# launcher's model can find the skill.
if [ -z "${KAIZEN_SKILL_DIR:-}" ] && [ -d "$HOME/.claude/skills/kaizen" ]; then
  KAIZEN_SKILL_DIR="$HOME/.claude/skills/kaizen"
fi
if [ -z "${KAIZEN_SKILL_DIR:-}" ]; then
  REPO_LOC="$SCRIPT_DIR/../.."
  if [ -f "$REPO_LOC/SKILL.md" ]; then
    KAIZEN_SKILL_DIR="$(cd "$REPO_LOC" && pwd -P)"
  fi
fi
export KAIZEN_SKILL_DIR

LOG_DIR="$LOOP_DIR/cycles"
mkdir -p "$LOG_DIR"
TS="$(date '+%Y-%m-%dT%H%M%S')"
LOG="$LOG_DIR/launchd-run-$TS.log"
RUN_JSON="$LOG_DIR/launchd-run-$TS.json"

# Natural-language prompt: the skill is auto-selected from the description,
# so no slash command inside -p.
PROMPT="Use the kaizen skill. Run one approved Kaizen cycle for Loop ID $LOOP_ID. Read its Kaizen Contract and Kaizen Memory first. Follow the approved Contract exactly. Do not merge or deploy. Update Memory and record fresh proof."

START_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
set +e
(
  cd "$WORK_DIR" || exit 0
  exec "$LAUNCHER" -p "$PROMPT"
) >"$LOG" 2>&1
RC=$?
set -e
END_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

printf '{"loop_id":"%s","started_at":"%s","ended_at":"%s","launcher":"%s","exit_code":%s,"result":"%s","log":"%s"}\n' \
  "$LOOP_ID" "$START_TS" "$END_TS" "$LAUNCHER" "$RC" \
  "$([ "$RC" -eq 0 ] && printf 'ok' || printf 'failed')" \
  "$LOG" > "$RUN_JSON"

if [ "$RC" -eq 0 ]; then
  echo "run-kaizen-cycle: cycle ok, log: $LOG"
  exit 0
fi

echo "run-kaizen-cycle: cycle FAILED (exit $RC), log: $LOG" >&2

# Record scheduler_failure in LOCAL_STATE.json atomically. Never print the
# log contents; only the log path is surfaced.
if [ -f "$LOOP_DIR/LOCAL_STATE.json" ]; then
  FAIL_JSON="{\"at\":\"$END_TS\",\"exit_code\":$RC,\"log\":\"$LOG\"}"
  if ! printf '%s' "$FAIL_JSON" | "$NODE_BIN" -e '
const fs = require("fs");
const f = process.argv[1];
let j = {};
try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
const e = JSON.parse(fs.readFileSync(0, "utf8"));
j.scheduler_failure = j.scheduler_failure || [];
j.scheduler_failure.push(e);
const t = f + ".tmp-" + process.pid;
fs.writeFileSync(t, JSON.stringify(j, null, 2) + "\n");
fs.renameSync(t, f);
' "$LOOP_DIR/LOCAL_STATE.json" 2>/dev/null; then
    echo "run-kaizen-cycle: warning: could not record scheduler_failure in LOCAL_STATE.json" >&2
  fi
fi

exit "$RC"
