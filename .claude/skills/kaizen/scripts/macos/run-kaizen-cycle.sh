#!/bin/bash
# Run one Kaizen cycle headlessly via the chosen launcher.
# Writes output to the loop's Memory folder (cycles/launchd-run-<ts>.log).
# Never prints secrets; exit 0 even if the cycle reports a problem, so
# launchd does not consider the Agent crashed.
#
# usage: run-kaizen-cycle.sh <loop-id> [--launcher claude-nine]

set -euo pipefail

LOOP_ID="${1:?usage: run-kaizen-cycle.sh <loop-id> [--launcher claude-nine]}"
LAUNCHER="claude-nine"
if [ "$#" -ge 3 ] && [ "$2" = "--launcher" ]; then
  LAUNCHER="$3"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(bash "$SCRIPT_DIR/resolve-kaizen-root.sh")"
LOOP_DIR="$ROOT/$LOOP_ID"

if [ ! -d "$LOOP_DIR" ]; then
  echo "run-kaizen-cycle: no Memory folder for loop: $LOOP_DIR" >&2
  exit 0
fi

if ! command -v "$LAUNCHER" >/dev/null 2>&1; then
  echo "run-kaizen-cycle: launcher not found: $LAUNCHER" >&2
  exit 0
fi

LOG_DIR="$LOOP_DIR/cycles"
mkdir -p "$LOG_DIR"
TS="$(date '+%Y-%m-%dT%H%M%S')"
LOG="$LOG_DIR/launchd-run-$TS.log"

PROMPT="/kaizen run $LOOP_ID"

"$LAUNCHER" -p "$PROMPT" >"$LOG" 2>&1
echo "run-kaizen-cycle: cycle dispatched, log: $LOG"
