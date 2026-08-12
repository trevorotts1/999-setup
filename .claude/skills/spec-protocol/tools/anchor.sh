#!/usr/bin/env bash
#==============================================================================
# anchor.sh — spec-protocol's THREE-WAY RECONCILER and capture-proof drift stop
#==============================================================================
#
# PURPOSE
#   RECONCILE TASKS NOW (execution-architecture doctrine section 12) as a tool.
#   It reconciles the three state layers against each other AND against the
#   artifacts on disk, and it carries the TERMINAL-DRIFT stop:
#
#     layer 1  PROJECT MANIFEST   SPEC/PROJECT-MANIFEST.md          how it operates
#     layer 2  NATIVE TASK GRAPH  CONTROL/task-graph-snapshot.json  a TaskList export
#     layer 3  PROJECT STATE      CONTROL/project_state.json        the scoreboard
#     + disk   repos/ CONTROL/ captures/                            what actually exists
#
#   It DETECTS and LOGS. It never mutates task state — scripts cannot call
#   session tools. It emits ACTION lines; the conductor executes them with
#   TaskUpdate and re-runs this script to confirm clean.
#
# THE RITUAL POINTS (references/anti-drift.md section 2)
#   every phase boundary; every loop or cron tick start; the FIRST action of a
#   post-compaction turn; before every dispatch; at least every 30 minutes of
#   continuous conductor work.
#
# EXIT-CODE CONTRACT
#   0  clean          a RE-ANCHOR or RECONCILE line was written; nothing fired
#   2  TOOLING FAILURE / BROKEN INSTRUMENT — loud, never silent, never a verdict
#   3  drift found    DRIFT-ALARM written; ACTION|verb|target|evidence on stdout
#   4  TERMINAL-DRIFT CONTROL/TERMINAL-DRIFT.flag created; escalation written
#
#   Exit 2 is never "no drift". A detector that cannot prove itself reports
#   BROKEN INSTRUMENT. UNDETERMINED is a correct answer; a false all-clear is not.
#
# THE EMBEDDED FIXTURES (why they exist)
#   The real ledger this tool was designed against carries 740 contentless
#   ticks in 2,366 lines. The obvious literal pattern
#       heartbeat (ledger auto-tick)
#   matches ZERO of them, because the timestamp sits BETWEEN the words:
#       - heartbeat 2026-08-06T20:10:38Z (ledger auto-tick)
#   A brittle pattern reported "no drift" on a file that is 31.3% drift. So
#   every invocation first proves its own instrument against embedded fixtures
#   — a positive that MUST match, a negative that MUST NOT, and the brittle
#   literal which MUST NOT match the positive (that is the trap, kept live as
#   a control). Control failure is exit 2, never an all-clear.
#
# WRITES
#   Every project-file write goes THROUGH tools/ledger.sh (locked, atomic,
#   append-only, verified). This script writes exactly three things itself:
#   CONTROL/.anchor-fingerprint (transient counter state),
#   CONTROL/TERMINAL-DRIFT.flag (the stop gate), and its own temp files.
#   It never prints secrets and never reads credential files.
#
# USAGE
#   anchor.sh <project-home> [current-unit]
#             [--mode anchor|reconcile]
#             [--tasks <task-graph-snapshot.json>]
#             [--state <project_state.json>]
#             [--intents <file of the last K stated-intent lines>]
#   anchor.sh --selftest
#
# ENVIRONMENT KNOBS (all optional; defaults are the doctrine's numbers)
#   ANCHOR_MAX_AGE_MIN=35          stale-anchor threshold, minutes
#   ANCHOR_TERMINAL_N=6            consecutive no-delta reconciles => TERMINAL-DRIFT
#   ANCHOR_STALE_MIN=10            liveness threshold for a running task, minutes
#   ANCHOR_INTENT_K=5              repeated-intent window size
#   ANCHOR_INTENT_OVERLAP_PCT=60   repeated-intent core-share threshold
#   ANCHOR_CENSUS_DEPTH=6          filesystem census depth under repos/
#   ANCHOR_HARD_CAP=200            class 6 hard agent-execution cap (STOPPED_CAP)
#   ANCHOR_BUDGET_TOL=5            class 6 claimed-vs-dispatched tolerance
#   ANCHOR_SELFTEST_BREAK_PATTERN=1  sabotage the tick pattern (selftest only)
#==============================================================================

set -euo pipefail

#------------------------------------------------------------------------------
# 0. Instruments. Resolve them by absolute path where the doctrine requires it
#    (the bare `grep` shim on the operator box is broken), and prove them below.
#------------------------------------------------------------------------------
GREP="/usr/bin/grep"
if [[ ! -x "$GREP" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"
  else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

SELF="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
# Re-express SELF as an ABSOLUTE path. Invoked as `bash anchor.sh --selftest`
# from its own directory, a bare "anchor.sh" does not resolve as a command and
# the selftest's own child calls come back 127 — a shell abort, never a fact
# about drift. Absolute path, always.
SELF="${SCRIPT_DIR}/$(basename "$SELF")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

MODE="anchor"
HOME_DIR=""
UNIT=""
TASKS=""
STATE=""
INTENTS=""
DO_SELFTEST=0

MAX_AGE_MIN="${ANCHOR_MAX_AGE_MIN:-35}"
TERMINAL_N="${ANCHOR_TERMINAL_N:-6}"
STALE_MIN="${ANCHOR_STALE_MIN:-10}"
INTENT_K="${ANCHOR_INTENT_K:-5}"
INTENT_PCT="${ANCHOR_INTENT_OVERLAP_PCT:-60}"
CENSUS_DEPTH="${ANCHOR_CENSUS_DEPTH:-6}"
HARD_CAP="${ANCHOR_HARD_CAP:-200}"
BUDGET_TOL="${ANCHOR_BUDGET_TOL:-5}"

WORKDIR=""
SELFTEST_TMP=""
cleanup() {
  [[ -n "$WORKDIR" && -d "$WORKDIR" ]] && rm -rf "$WORKDIR"
  [[ -n "$SELFTEST_TMP" && -d "$SELFTEST_TMP" ]] && rm -rf "$SELFTEST_TMP"
  return 0
}
trap cleanup EXIT

#------------------------------------------------------------------------------
# 1. Failure primitives. A tooling failure is LOUD and is never a verdict.
#------------------------------------------------------------------------------
die_tool() {
  printf 'anchor.sh: TOOLING FAILURE (exit 2): %s\n' "$*" >&2
  printf 'anchor.sh: this is NOT an all-clear. Nothing about drift was determined.\n' >&2
  exit 2
}
die_instrument() {
  printf 'anchor.sh: BROKEN INSTRUMENT (exit 2): %s\n' "$*" >&2
  printf 'anchor.sh: the detector failed its own control, so it may not report "clean".\n' >&2
  printf 'anchor.sh: BROKEN INSTRUMENT is never ALL CLEAR.\n' >&2
  exit 2
}
note() { printf '%s\n' "$*" >&2; }

#------------------------------------------------------------------------------
# 2. grep wrappers. rc 0 = matched, rc 1 = no match, rc >= 2 = ERROR (never
#    "zero matches"). Every call captures stderr and checks $?.
#
#    Each wrapper SAVES and RESTORES the caller's errexit setting rather than
#    hardcoding `set -e` on the way out. Hardcoding it was a real, reproduced
#    bug in this file: a wrapper called from inside a `set +e` region switched
#    errexit back on behind the caller's back, and the next honest `return 3`
#    (drift found) killed the script before it could write its DRIFT-ALARM.
#    A detector that dies at the moment it finds something is worse than none.
#------------------------------------------------------------------------------
_e_save() { case $- in *e*) printf '1\n' ;; *) printf '0\n' ;; esac; }
_e_restore() { if [[ "$1" == "1" ]]; then set -e; else set +e; fi; }

g_count() {  # g_count <extended-regex> <file> [-i]  -> prints an integer
  local re="$1" f="$2" ci="${3:-}" out rc e
  if [[ ! -f "$f" ]]; then printf '0\n'; return 0; fi
  e="$(_e_save)"; set +e
  if [[ "$ci" == "-i" ]]; then out="$("$GREP" -ciE -- "$re" "$f" 2>&1)"; else out="$("$GREP" -cE -- "$re" "$f" 2>&1)"; fi
  rc=$?
  _e_restore "$e"
  if (( rc >= 2 )); then die_tool "grep rc=${rc} on ${f} (pattern: ${re}) -> ${out}"; fi
  printf '%s\n' "$out"
}

g_has() {  # g_has <extended-regex> <file> [-i] -> rc 0 if matched
  local re="$1" f="$2" ci="${3:-}" out rc e
  [[ -f "$f" ]] || return 1
  e="$(_e_save)"; set +e
  if [[ "$ci" == "-i" ]]; then out="$("$GREP" -qiE -- "$re" "$f" 2>&1)"; else out="$("$GREP" -qE -- "$re" "$f" 2>&1)"; fi
  rc=$?
  _e_restore "$e"
  if (( rc >= 2 )); then die_tool "grep rc=${rc} on ${f} (pattern: ${re}) -> ${out}"; fi
  return $rc
}

s_has() {  # s_has <extended-regex> <string> [-i] -> rc 0 if the STRING matches
  local re="$1" s="$2" ci="${3:-}" out rc e
  e="$(_e_save)"; set +e
  if [[ "$ci" == "-i" ]]; then out="$(printf '%s\n' "$s" | "$GREP" -qiE -- "$re" 2>&1)"; else out="$(printf '%s\n' "$s" | "$GREP" -qE -- "$re" 2>&1)"; fi
  rc=$?
  _e_restore "$e"
  if (( rc >= 2 )); then die_tool "grep rc=${rc} on a literal string (pattern: ${re}) -> ${out}"; fi
  return $rc
}

s_has_fixed() {  # s_has_fixed <literal> <string> -> rc 0 if the STRING contains it
  local lit="$1" s="$2" out rc e
  e="$(_e_save)"; set +e
  out="$(printf '%s\n' "$s" | "$GREP" -qF -- "$lit" 2>&1)"
  rc=$?
  _e_restore "$e"
  if (( rc >= 2 )); then die_tool "grep -F rc=${rc} on a literal string -> ${out}"; fi
  return $rc
}

#------------------------------------------------------------------------------
# 3. THE DETECTOR — two stages, because one stage gets it wrong in BOTH
#    directions and both errors are fatal.
#
#    STAGE 1, the MARKER, robust to timestamp POSITION and FORMAT:
#      case-insensitive "heartbeat" AND "auto tick" (any order, anything
#      between, hyphen/underscore/space tolerated). A single anchored literal
#      MISSES the real lines — the timestamp sits between the words, which is
#      how a brittle pattern once reported a 31.3%-drift ledger clean.
#
#    STAGE 2, the RESIDUE: strip the timestamp, the marker words, and all
#      punctuation. If NOTHING is left, the line is a CONTENTLESS TICK — a
#      timestamp and nothing else, the banned write. If anything is left, the
#      line is a REAL heartbeat that carries state, and it is NOT drift.
#
#    Stage 2 is not a refinement, it is the other half of the discrimination.
#    Measured on the operator's real ledger (2,366 lines): 740 contentless
#    ticks — matching the strict anchored control exactly — and 140 auto-tick
#    lines that carry real content (unit progress, PR numbers, blockers), plus
#    5 capitalized "Heartbeat" lines inside WATCHDOG entries that correct a
#    stale count. Those 145 are the behaviour this skill is trying to INSTALL.
#    A one-stage pattern flags them as the disease. That detector is broken,
#    and it is broken in the direction that punishes the cure.
#
#    BRITTLE_LIT is the pattern that hid 31% of that ledger. It is kept as a
#    live control, never as the detector.
#------------------------------------------------------------------------------
AWK="/usr/bin/awk"
if [[ ! -x "$AWK" ]]; then AWK="$(command -v awk 2>/dev/null || true)"; fi

TICK_M1='heartbeat'
TICK_M2='auto[ _-]?tick'
BRITTLE_LIT='heartbeat (ledger auto-tick)'
STATE_RE='(counts=|tasks=|violations=|RECONCILE|RE-ANCHOR|CLAIM|RESULT|VERDICT|MERGED)'
# Lines this reconciler itself authors, plus the OBSERVATIONAL lines the
# freshness machinery emits. All are excluded from the state-delta fingerprint:
# appending a line is exactly what the captured system kept doing.
#
# CAPACITY-EVENT (capacity.md section 6.1 — the burn governor's mid-run
# re-checks: 429 clusters, low balances, a dead provider, a tier tripwire) is
# excluded for the same reason and one more: RE-MEASURING THE WORLD IS NOT
# PROGRESSING THE WORK. A run that emits nothing but capacity events while
# runnable work exists must still walk into TERMINAL-DRIFT, or the freshness
# machinery becomes a new way to look alive while doing nothing — the exact
# disease anti-drift.md section 1 documents.
# BUDGET-CAP is this script's own class-6 line and is excluded on the same
# self-authored ground as the rest.
SELF_AUTHORED_RE='(RE-ANCHOR|RECONCILE|DRIFT-ALARM|TERMINAL-DRIFT|S-CHECK|OPERATOR-ESCALATION|CAPACITY-EVENT|BUDGET-CAP)'

if [[ "${ANCHOR_SELFTEST_BREAK_PATTERN:-0}" == "1" ]]; then
  # Deliberate sabotage: swap the robust marker for the brittle literal that
  # matches nothing. The self-prove below MUST catch this.
  TICK_M1='heartbeat \\(ledger auto-tick\\)'
  TICK_M2='heartbeat \\(ledger auto-tick\\)'
fi

# The classifier. MODE=count -> "<contentless> <contentful>"; MODE=state ->
# print every line that is NOT a contentless tick; MODE=classify -> print the
# class of each line (TICK | TICK-CONTENTFUL | STATE).
AWK_CLASSIFY='
function residue(l,   r) {
  r = l
  gsub(/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][t ][0-9][0-9]:[0-9][0-9]:[0-9][0-9](\.[0-9]+)?z?/, " ", r)
  gsub(/[0-9][0-9]:[0-9][0-9](:[0-9][0-9])?/, " ", r)
  gsub(/heartbeat/, " ", r)
  gsub(/auto[ _-]?tick/, " ", r)
  gsub(/ledger/, " ", r)
  gsub(/tick/, " ", r)
  gsub(/auto/, " ", r)
  gsub(/[^a-z0-9]/, "", r)
  return r
}
{
  low = tolower($0); cls = "STATE"
  if (low ~ M1 && low ~ M2) {
    r = residue(low)
    if (r == "" || r ~ /^[0-9][0-9]?[0-9]?[0-9]?$/) cls = "TICK"; else cls = "TICK-CONTENTFUL"
  }
  if (MODE == "classify") print cls
  else if (MODE == "state") { if (cls != "TICK") print $0 }
  else n[cls]++
}
END { if (MODE != "classify" && MODE != "state") printf "%d %d %d\n", n["TICK"], n["TICK-CONTENTFUL"], n["STATE"] }
'

classify_line() {  # classify_line <line> -> TICK | TICK-CONTENTFUL | STATE
  printf '%s\n' "$1" | "$AWK" -v M1="$TICK_M1" -v M2="$TICK_M2" -v MODE=classify "$AWK_CLASSIFY"
}
classify_file() {  # classify_file <file> -> "<contentless> <contentful> <state>"
  if [[ ! -f "$1" ]]; then printf '0 0 0\n'; return 0; fi
  "$AWK" -v M1="$TICK_M1" -v M2="$TICK_M2" -v MODE=count "$AWK_CLASSIFY" "$1"
}
state_lines() {  # state_lines <file> -> every line that is not a contentless tick
  [[ -f "$1" ]] || return 0
  "$AWK" -v M1="$TICK_M1" -v M2="$TICK_M2" -v MODE=state "$AWK_CLASSIFY" "$1"
}

# --- the fixtures. Two positives (the banned write), THREE negatives taken
#     verbatim from the same real ledger (the required write), and the trap.
FIXTURE_POS='- heartbeat 2026-08-06T20:10:38Z (ledger auto-tick)'
FIXTURE_POS2='[2026-08-06 20:13:38] HEARTBEAT — auto tick'
# a REAL contentful auto-tick from the same file (line 413) — must NOT be drift
FIXTURE_NEG1='- heartbeat 2026-08-06T20:30:38Z (ledger auto-tick) — E2E driver solving standard-intake (GATE 0) via derive_legacy_fields; transcript 981KB/238 lines, progressing'
# a REAL WATCHDOG heartbeat from the same file (line 1989) — the worked example
# of a heartbeat that carries state AND corrects a stale count. NOT drift.
FIXTURE_NEG2='- WATCHDOG 2026-08-07T19:00:51Z — **Heartbeat: 0 active / 0 stalled.** All 68 workflow records in terminal states (55 completed, 9 killed, 4 failed). The earlier 44 active / 16 stalled line was a stale count — corrected here. Nothing to restart.'
FIXTURE_NEG3='2026-08-06T20:16:38Z | RECONCILE | anchor=1a2b3c4d | unit=U-07 | result=clean | counts=done:12/open:3/blocked:0'

self_prove() {
  local ctl rc cls
  # (a) the instruments themselves: known-good controls on the same transport.
  [[ -n "$GREP" && -x "$GREP" ]] || die_instrument "no usable grep binary (tried /usr/bin/grep, /bin/grep, PATH)"
  [[ -n "$AWK"  && -x "$AWK"  ]] || die_instrument "no usable awk binary (tried /usr/bin/awk, PATH) — the tick classifier cannot run"
  set +e
  ctl="$(printf 'alpha\nbeta\n' | "$GREP" -c 'beta' 2>&1)"; rc=$?
  set -e
  (( rc == 0 )) || die_instrument "grep control failed: rc=${rc} output=${ctl}"
  [[ "$ctl" == "1" ]] || die_instrument "grep control returned ${ctl}, expected 1 — the instrument is lying"
  set +e
  ctl="$(printf 'alpha\nbeta\n' | "$AWK" 'END{print NR}' 2>&1)"; rc=$?
  set -e
  { (( rc == 0 )) && [[ "$ctl" == "2" ]]; } || die_instrument "awk control failed: rc=${rc} output=${ctl}"

  # (b) the positive fixture — the REAL banned-write format — must be TICK.
  cls="$(classify_line "$FIXTURE_POS")"
  [[ "$cls" == "TICK" ]] || die_instrument "the known contentless tick classified as ${cls}, not TICK: ${FIXTURE_POS}"
  # (c) a format-drifted positive (timestamp first, different punctuation).
  cls="$(classify_line "$FIXTURE_POS2")"
  [[ "$cls" == "TICK" ]] || die_instrument "the detector is not robust to timestamp position/format (classified ${cls}): ${FIXTURE_POS2}"
  # (d) THE KNOWN-NEGATIVE CONTROLS — real lines that carry state. Flagging any
  #     of these punishes the exact behaviour the skill is installing.
  cls="$(classify_line "$FIXTURE_NEG1")"
  [[ "$cls" == "TICK-CONTENTFUL" ]] || die_instrument "a REAL state-carrying auto-tick classified as ${cls} — the detector would flag the cure as the disease"
  cls="$(classify_line "$FIXTURE_NEG2")"
  [[ "$cls" == "STATE" ]] || die_instrument "a REAL WATCHDOG heartbeat (counts + a stale-count correction) classified as ${cls} — the detector does not discriminate"
  cls="$(classify_line "$FIXTURE_NEG3")"
  [[ "$cls" == "STATE" ]] || die_instrument "a state-carrying RECONCILE line classified as ${cls} — the detector does not discriminate"
  s_has "$STATE_RE" "$FIXTURE_NEG3" \
    || die_instrument "state pattern does not match the known state-carrying fixture"
  # (e) the trap, kept live: the brittle literal must NOT match the real line.
  #     If it ever does, the fixture is wrong and the whole exhibit is invalid.
  if s_has_fixed "$BRITTLE_LIT" "$FIXTURE_POS"; then
    die_instrument "the brittle literal matched the real fixture — the fixture is wrong, refusing to report"
  fi
  # (f) shasum must exist; the fingerprint is meaningless without it.
  command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 \
    || die_instrument "neither shasum nor sha256sum is available — no fingerprint can be computed"
  return 0
}

sha_stdin() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
}

#------------------------------------------------------------------------------
# 4. Small portable helpers.
#------------------------------------------------------------------------------
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch_now() { date -u +%s; }

mtime_of() { stat -f %m "$1" 2>/dev/null && return 0; stat -c %Y "$1" 2>/dev/null && return 0; return 1; }

iso_to_epoch() {  # prints epoch, or nothing + rc 1 when UNDETERMINED
  local ts="$1" out
  out="$(TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null)" && { printf '%s\n' "$out"; return 0; }
  out="$(date -u -d "$ts" +%s 2>/dev/null)" && { printf '%s\n' "$out"; return 0; }
  return 1
}

sanitize() {  # one line, no pipes (the field separator), bounded length
  printf '%s' "$1" | tr -d '\n\r' | tr '|' '/' | cut -c1-160
}

re_escape() { printf '%s' "$1" | sed 's/[][\.*^$(){}?+|\\/]/\\&/g'; }

ledger_write() {  # ledger_write <relative-file> <line>
  local f="$1" line="$2" out rc
  [[ -x "$LEDGER_SH" ]] || die_tool "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every write goes through it"
  set +e
  out="$("$LEDGER_SH" "$HOME_DIR" "$f" "$line" 2>&1)"; rc=$?
  set -e
  if (( rc != 0 )); then die_tool "ledger.sh failed (rc=${rc}) writing ${f}: ${out}"; fi
}

#------------------------------------------------------------------------------
# 5. Usage
#------------------------------------------------------------------------------
usage() {
  sed -n '2,80p' "$SELF" | sed 's/^# \{0,1\}//'
}

#==============================================================================
# ARGUMENT PARSING
#==============================================================================
while (( $# )); do
  case "$1" in
    --selftest) DO_SELFTEST=1; shift ;;
    --mode)     (( $# >= 2 )) || die_tool "--mode needs a value (anchor|reconcile)"; MODE="$2"; shift 2 ;;
    --tasks)    (( $# >= 2 )) || die_tool "--tasks needs a path"; TASKS="$2"; shift 2 ;;
    --state)    (( $# >= 2 )) || die_tool "--state needs a path"; STATE="$2"; shift 2 ;;
    --intents)  (( $# >= 2 )) || die_tool "--intents needs a path"; INTENTS="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    --*)        die_tool "unknown option: $1" ;;
    *)
      if   [[ -z "$HOME_DIR" ]]; then HOME_DIR="$1"
      elif [[ -z "$UNIT"     ]]; then UNIT="$1"
      else die_tool "unexpected argument: $1"; fi
      shift ;;
  esac
done

case "$MODE" in
  anchor|reconcile) : ;;
  *) die_tool "--mode must be anchor or reconcile (got: ${MODE})" ;;
esac

# The class-6 knobs are used in arithmetic. A non-numeric value would evaluate
# to 0 inside (( )) WITHOUT an error — a tolerance of 0 that over-alarms, or a
# cap of 0 that stops every run. A knob that silently becomes zero is a lying
# instrument, so it is rejected loudly instead.
[[ "$HARD_CAP"   =~ ^[0-9]+$ ]] || die_tool "ANCHOR_HARD_CAP must be a non-negative integer (got: ${HARD_CAP})"
[[ "$BUDGET_TOL" =~ ^[0-9]+$ ]] || die_tool "ANCHOR_BUDGET_TOL must be a non-negative integer (got: ${BUDGET_TOL})"

#==============================================================================
# THE MAIN RUN
#==============================================================================
run_anchor() {
  [[ -n "$HOME_DIR" ]] || die_tool "no project home given. Usage: anchor.sh <project-home> [current-unit] [--mode anchor|reconcile]"
  [[ -d "$HOME_DIR" ]] || die_tool "project home does not exist: ${HOME_DIR}"
  HOME_DIR="$(cd "$HOME_DIR" && pwd)"
  [[ -n "$UNIT" ]] || UNIT="IDLE"

  self_prove

  local GOAL CHK TODO MAN LED DL FLAG FPFILE
  GOAL="$HOME_DIR/SPEC/GOAL.md"
  CHK="$HOME_DIR/CONTROL/CHECKLIST.md"
  TODO="$HOME_DIR/CONTROL/TODO.md"
  MAN="$HOME_DIR/SPEC/PROJECT-MANIFEST.md"
  LED="$HOME_DIR/CONTROL/LEDGER.md"
  DL="$HOME_DIR/CONTROL/dispatch-log.md"
  FLAG="$HOME_DIR/CONTROL/TERMINAL-DRIFT.flag"
  FPFILE="$HOME_DIR/CONTROL/.anchor-fingerprint"

  # --- precondition 0: the stop gate. It sits OUTSIDE the captured reasoning.
  if [[ -f "$FLAG" ]]; then
    printf 'TERMINAL-DRIFT | flag present: %s\n' "$FLAG"
    printf 'TERMINAL-DRIFT | nothing dispatches while this file exists. Name the blocker, then remove it.\n'
    if [[ -r "$FLAG" ]]; then sed -n '1,20p' "$FLAG"; fi
    exit 4
  fi

  # --- required inputs. A missing one is exit 2 NAMING THE PATH — never a verdict.
  local missing=""
  [[ -f "$GOAL" ]] || missing="${missing} ${GOAL}"
  [[ -f "$CHK"  ]] || missing="${missing} ${CHK}"
  [[ -f "$TODO" ]] || missing="${missing} ${TODO}"
  if [[ -n "$missing" ]]; then
    die_tool "required file(s) missing:${missing} (checked: SPEC/GOAL.md, CONTROL/CHECKLIST.md, CONTROL/TODO.md under ${HOME_DIR}). Not checked: the task snapshot and project state, because the run stopped here."
  fi
  local MAN_NOTE="present"
  if [[ ! -f "$MAN" ]]; then MAN_NOTE="absent(pre-16.2)"; note "anchor.sh: WARNING — no SPEC/PROJECT-MANIFEST.md yet (${MAN}); layer 1 is UNDETERMINED, continuing."; fi

  # --- resolve optional inputs relative to the home when needed
  local p
  for p in TASKS STATE INTENTS; do
    eval "local v=\${$p}"
    if [[ -n "$v" && ! -f "$v" && -f "$HOME_DIR/$v" ]]; then eval "$p=\"\$HOME_DIR/\$v\""; fi
    eval "v=\${$p}"
    if [[ -n "$v" && ! -f "$v" ]]; then die_tool "--$(printf '%s' "$p" | tr 'A-Z' 'a-z') path does not exist: ${v}"; fi
  done

  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/anchor.XXXXXX")"

  #--------------------------------------------------------------------------
  # (3) THE ANCHOR HASH — the plan's own fingerprint.
  #--------------------------------------------------------------------------
  local ANCHOR
  {
    cat "$GOAL" "$CHK" "$TODO"
    if [[ -f "$MAN" ]]; then cat "$MAN"; fi
  } > "$WORKDIR/anchor.in" 2>/dev/null || die_tool "could not read the plan files for the anchor hash"
  ANCHOR="$(sha_stdin < "$WORKDIR/anchor.in" | cut -c1-8)"

  #--------------------------------------------------------------------------
  # (4) NEXT, checklist counts, task counts.
  #--------------------------------------------------------------------------
  local NEXT_RAW NEXT rc
  set +e
  NEXT_RAW="$("$GREP" -m1 -E '^[[:space:]]*- \[ \]' "$TODO" 2>&1)"; rc=$?
  set -e
  if (( rc >= 2 )); then die_tool "grep rc=${rc} reading the TODO top item from ${TODO}: ${NEXT_RAW}"; fi
  if (( rc == 1 )); then NEXT="(no open TODO item)"; NEXT_RAW=""; else
    NEXT="$(sanitize "$(printf '%s' "$NEXT_RAW" | sed 's/^[[:space:]]*- \[ \][[:space:]]*//')")"
  fi

  local C_DONE C_OPEN C_BLOCKED
  C_DONE="$(g_count '^[[:space:]]*- \[[xX]\]' "$CHK")"
  C_OPEN="$(g_count '^[[:space:]]*- \[ \]' "$CHK")"
  C_BLOCKED="$(g_count '^[[:space:]]*- \[[^]]*\].*blocked' "$CHK" -i)"
  local COUNTS="done:${C_DONE}/open:${C_OPEN}/blocked:${C_BLOCKED}"

  local T_P T_I T_C TASKSTR="undetermined(no-snapshot)"
  T_P=""; T_I=""; T_C=""
  if [[ -n "$TASKS" ]]; then
    T_P="$(g_count '"status"[[:space:]]*:[[:space:]]*"pending"' "$TASKS" -i)"
    T_I="$(g_count '"status"[[:space:]]*:[[:space:]]*"in[_-]?progress"' "$TASKS" -i)"
    T_C="$(g_count '"status"[[:space:]]*:[[:space:]]*"completed"' "$TASKS" -i)"
    local T_ANY
    T_ANY="$(g_count '"status"[[:space:]]*:' "$TASKS" -i)"
    if (( T_ANY == 0 )); then
      die_tool "task snapshot ${TASKS} exists but contains no \"status\" field at all. That is a PARSE FAILURE, not an empty task graph — refusing to report zero tasks."
    fi
    TASKSTR="p:${T_P}/i:${T_I}/c:${T_C}"
  fi

  # Contentless ticks already sitting in the ledger — a BANNED WRITE, counted
  # and reported so it can never be invisible again. Counted SEPARATELY from
  # the contentful heartbeats, which are the required behaviour and are never
  # reported as drift.
  local TICKS=0 TICKS_FULL=0 CLS
  if [[ -f "$LED" ]]; then
    CLS="$(classify_file "$LED")"
    TICKS="$(printf '%s' "$CLS" | cut -d' ' -f1)"
    TICKS_FULL="$(printf '%s' "$CLS" | cut -d' ' -f2)"
  fi

  #--------------------------------------------------------------------------
  # (5) unit-in-plan
  #--------------------------------------------------------------------------
  local SEVERITY=0   # 0 clean, 3 drift, 4 terminal
  local ACTIONS=0
  local alarm_ts esc

  # Class-6 state. BUDGET_ADVISED rides in CONTROL/.anchor-fingerprint (a file
  # this script already owns) so the review-threshold advisory is emitted ONCE
  # per run rather than on every tick. No fourth self-written file is created.
  local BUDGET_NOTE="budget-skipped(mode=anchor)"
  local BUDGET_ADVISED=0
  if [[ -f "$FPFILE" ]]; then
    local _ba; _ba="$(sed -n 's/^budget_advisory=//p' "$FPFILE" | head -1)"
    if [[ "${_ba:-0}" == "1" ]]; then BUDGET_ADVISED=1; fi
  fi

  alarm() {  # alarm <class> <evidence>
    alarm_ts="$(iso_now)"
    ledger_write "CONTROL/LEDGER.md" "${alarm_ts} | DRIFT-ALARM | $1 | unit=${UNIT} | $(sanitize "$2")"
    if (( SEVERITY < 3 )); then SEVERITY=3; fi
  }
  action() {  # action <verb> <target> <evidence>
    printf 'ACTION|%s|%s|%s\n' "$1" "$2" "$(sanitize "$3")"
    ACTIONS=$(( ACTIONS + 1 ))
  }

  #--------------------------------------------------------------------------
  # CLASS 6 helpers — THE BUDGET AUDIT.
  #
  #   capacity.md promised twice that "the reconciler audits the ledger's
  #   claimed spend against actual executions". Until this class existed, this
  #   script contained no budget reference and no STOPPED_CAP handling at all:
  #   the doc promised what the tool did not do. This is the tool keeping it.
  #
  #   Two independent comparisons, and they are never merged into one word:
  #     (i)  CLAIMED SPEND (agents.budget_initial - agents.session_budget_
  #          remaining) vs the CONTROL/dispatch-log.md census. Divergence past
  #          ANCHOR_BUDGET_TOL is DRIFT — the scoreboard and the write-ahead
  #          log disagree about how much was spent.
  #     (ii) agents.executions_total against the hard cap. Reaching a cap is
  #          NOT drift: it is a legitimate, declared stop. It exits 3 (so the
  #          conductor stops dispatching) and emits set-run-status|STOPPED_CAP
  #          rather than exit 4, which is reserved for the stall.
  #
  #   FAIL-CLOSED EVERYWHERE. An absent field, an absent dispatch log, or a
  #   dispatch log with content but no parseable row is UNDETERMINED and says
  #   which path it checked. It is NEVER a silent zero and never a pass — the
  #   same rule as the "no status field at all" parse failure above.
  #--------------------------------------------------------------------------
  jnum() {  # jnum <flat-json-file> <key> -> integer on stdout, or rc 1
    local v
    v="$(sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p' "$1" | head -1)"
    [[ -n "$v" ]] || return 1
    printf '%s\n' "$v"
  }

  # Sets DISPATCH_ROWS to a count, or to "" meaning UNDETERMINED. It ALWAYS
  # returns 0, and is called as a plain statement, on purpose: returning a
  # status would put every call inside a condition context, where `set -e` is
  # suspended and a grep rc>=2 would quietly degrade a TOOLING FAILURE into an
  # "undetermined" verdict. Called plainly, an instrument failure still exits 2.
  dispatch_census() {
    local rows nonblank heads content
    DISPATCH_ROWS=""
    [[ -f "$DL" ]] || return 0              # absent file: never counted as zero
    # A dispatch row is document 12's shape: a leading timestamp then at least
    # two pipe-separated fields (`ts | work item | stage | label | run id`).
    rows="$(g_count '^[[:space:]]*(- )?[0-9]{4}-[0-9]{2}-[0-9]{2}[^|]*\|[^|]*\|' "$DL")"
    if (( rows > 0 )); then DISPATCH_ROWS="$rows"; return 0; fi
    nonblank="$(g_count '[^[:space:]]' "$DL")"
    heads="$(g_count '^[[:space:]]*(#|-{3,}|\|)' "$DL")"
    content=$(( nonblank - heads ))
    # Content but no parseable row is a PARSE FAILURE, not an empty log.
    if (( content > 0 )); then return 0; fi
    DISPATCH_ROWS="0"                       # genuinely empty: a PROVEN zero
    return 0
  }

  budget_audit() {  # sets BUDGET_NOTE; may alarm, act, and write BUDGET-CAP
    BUDGET_NOTE="budget-undetermined(no --state given)"
    [[ -n "$STATE" && -f "$STATE" ]] || return 0

    local flat="$WORKDIR/state.budget.flat"
    if ! tr -d '\n\r' < "$STATE" > "$flat" 2>/dev/null; then
      BUDGET_NOTE="budget-undetermined(state-unreadable:${STATE})"
      return 0
    fi

    local init rem exec_t warn_at cap_state
    init="$(jnum   "$flat" 'budget_initial'           || true)"
    rem="$(jnum    "$flat" 'session_budget_remaining' || true)"
    exec_t="$(jnum "$flat" 'executions_total'         || true)"
    warn_at="$(jnum "$flat" 'warn_at'                 || true)"
    cap_state="$(jnum "$flat" 'hard_stop_at'          || true)"

    if [[ -z "$init" && -z "$rem" && -z "$exec_t" ]]; then
      BUDGET_NOTE="budget-undetermined(no-budget-fields)"
      note "anchor.sh: CLASS 6 UNDETERMINED — ${STATE} carries none of agents.budget_initial, agents.session_budget_remaining, agents.executions_total. Checked that file only; the dispatch log was NOT consulted, and no budget verdict is claimed."
      return 0
    fi

    # --- (ii) the caps. Independent of the dispatch log; run first so a run
    #     that is over the cap stops even when the census is undetermined.
    local CAP="$HARD_CAP" WARN capnote=""
    if [[ -n "$cap_state" ]] && (( cap_state < CAP )); then CAP="$cap_state"; fi
    WARN="${warn_at:-150}"
    if [[ -n "$exec_t" ]] && (( exec_t >= CAP )); then
      local bts; bts="$(iso_now)"
      ledger_write "CONTROL/LEDGER.md" "${bts} | BUDGET-CAP | executions=${exec_t} | cap=${CAP} | remaining=${rem:-undetermined} | unit=${UNIT} | required=run_status=STOPPED_CAP; stop dispatching; preserve the best stable build; produce the blocker report"
      action "stop-dispatching" "$UNIT" "hard cap reached: executions=${exec_t} >= cap=${CAP}"
      action "set-run-status" "STOPPED_CAP" "executions=${exec_t} >= cap=${CAP}; preserve the best stable build and produce the blocker report. A cap is a LIMIT REACHED stop, never a PASS and never drift."
      if (( SEVERITY < 3 )); then SEVERITY=3; fi
      capnote="budget-cap(executions=${exec_t}/cap=${CAP})"
    elif [[ -n "$exec_t" ]] && (( exec_t >= WARN )); then
      if (( BUDGET_ADVISED == 0 )); then
        action "review-budget" "$UNIT" "advisory (emitted once): executions=${exec_t} crossed the review threshold ${WARN}; hard cap ${CAP}"
        BUDGET_ADVISED=1
      fi
      capnote="budget-warn(executions=${exec_t}/warn=${WARN})"
    fi

    # --- (i) claimed spend vs the dispatch-log census
    local claimed="" disp="" cmp
    if [[ -n "$init" && -n "$rem" ]]; then claimed=$(( init - rem )); fi
    dispatch_census
    disp="$DISPATCH_ROWS"

    if [[ -z "$claimed" ]]; then
      cmp="budget-undetermined(no-claimed-spend: budget_initial and/or session_budget_remaining absent from ${STATE})"
    elif (( claimed < 0 )); then
      # NEGATIVE CLAIMED SPEND — the scoreboard is impossible, not merely off.
      #
      # claimed = budget_initial - session_budget_remaining. A negative value
      # means the run has MORE budget left than it started with. No sequence of
      # dispatches produces that; it is a corrupt, swapped, or silently reset
      # scoreboard.
      #
      # Why this needs its own branch: the comparison below takes the ABSOLUTE
      # difference, so a small negative (claimed=-3 against a 0-row census)
      # yielded diff=3, slipped under ANCHOR_BUDGET_TOL, and reported
      # "budget-ok" — the audit blessing a state file that cannot exist. The
      # magnitude was never the point; the SIGN is. It is caught before the
      # tolerance test can launder it, and it is never a PASS at any tolerance.
      #
      # It is also tested BEFORE the dispatch-log census, on purpose: the
      # impossibility is visible in the state file alone, so a missing or
      # unparseable dispatch log must not be able to downgrade a proven
      # corruption into "undetermined".
      alarm "budget-negative-spend" "claimed=${claimed} — session_budget_remaining ${rem} EXCEEDS budget_initial ${init} in ${STATE}. A run cannot end with more budget than it began with: the scoreboard is corrupt, swapped, or was reset mid-run. The dispatch census (${disp:-undetermined}) is NOT consulted for this verdict — a census cannot validate an impossible scoreboard."
      action "reconcile-budget" "${claimed}/${disp:-undetermined}" "NEGATIVE claimed spend: budget_initial=${init} session_budget_remaining=${rem}. Re-derive the budget fields from the dispatch log before dispatching again; do NOT trust either field until they are re-grounded."
      cmp="budget-negative-spend(claimed=${claimed}/initial=${init}/remaining=${rem})"
    elif [[ -z "$disp" ]]; then
      if [[ -f "$DL" ]]; then
        cmp="budget-undetermined(dispatch-log-unparseable: ${DL} has content but no timestamped rows)"
      else
        cmp="budget-undetermined(no-dispatch-log: ${DL} does not exist — an absent log is not a census of zero)"
      fi
    else
      local diff=$(( claimed - disp ))
      if (( diff < 0 )); then diff=$(( 0 - diff )); fi
      if (( diff > BUDGET_TOL )); then
        alarm "budget-mismatch" "claimed=${claimed} dispatched=${disp} — budget_initial ${init} minus session_budget_remaining ${rem} diverges from the dispatch-log census by ${diff} > ANCHOR_BUDGET_TOL ${BUDGET_TOL}"
        action "reconcile-budget" "${claimed}/${disp}" "claimed spend ${claimed} vs ${disp} rows in ${DL}; diff=${diff} > tol=${BUDGET_TOL}"
        cmp="budget-mismatch(claimed=${claimed}/dispatched=${disp})"
      else
        cmp="budget-ok(claimed=${claimed}/dispatched=${disp})"
      fi
    fi

    if [[ -n "$capnote" ]]; then BUDGET_NOTE="${cmp}+${capnote}"; else BUDGET_NOTE="$cmp"; fi
    return 0
  }

  if [[ "$UNIT" != "IDLE" ]]; then
    local UESC; UESC="$(re_escape "$UNIT")"
    if ! g_has "$UESC" "$TODO" && ! g_has "$UESC" "$CHK"; then
      alarm "unit-not-in-plan" "unit=${UNIT} appears in neither ${TODO} nor ${CHK} — the run is working on something the plan does not contain"
      action "re-read-plan" "$UNIT" "unit not found in TODO.md or CHECKLIST.md"
    fi
  fi

  #--------------------------------------------------------------------------
  # (6) staleness of the last anchor/reconcile line
  #--------------------------------------------------------------------------
  local STALENESS="first-anchor"
  if [[ -f "$LED" ]]; then
    local LAST_TS LAST_LINE last_rc
    set +e
    LAST_LINE="$("$GREP" -E '\| (RE-ANCHOR|RECONCILE) \|' "$LED" 2>&1 | tail -n 1)"; last_rc=$?
    set -e
    if (( last_rc >= 2 )); then die_tool "grep rc=${last_rc} scanning ${LED} for the last anchor line: ${LAST_LINE}"; fi
    if [[ -n "$LAST_LINE" ]]; then
      LAST_TS="$(printf '%s' "$LAST_LINE" | sed -n 's/^\([0-9TZ:.-]\{1,\}\)[[:space:]]*|.*/\1/p')"
      if [[ -n "$LAST_TS" ]]; then
        local LAST_E NOW_E AGE_MIN
        if LAST_E="$(iso_to_epoch "$LAST_TS")"; then
          NOW_E="$(epoch_now)"
          AGE_MIN=$(( (NOW_E - LAST_E) / 60 ))
          STALENESS="${AGE_MIN}m"
          if (( AGE_MIN > MAX_AGE_MIN )); then
            alarm "stale-anchor" "last RE-ANCHOR/RECONCILE was ${AGE_MIN} minutes ago (threshold ${MAX_AGE_MIN}m) — the conductor stopped re-anchoring"
            action "reconcile-now" "${UNIT}" "anchor age ${AGE_MIN}m > ${MAX_AGE_MIN}m"
          fi
        else
          STALENESS="undetermined(unparsable-timestamp)"
        fi
      else
        STALENESS="undetermined(no-timestamp-field)"
      fi
    fi
  fi

  #--------------------------------------------------------------------------
  # (7) THE SIX DETECTION CLASSES (reconcile mode)
  #     Classes 1-4 need --tasks AND --state. Class 5 needs --intents (below,
  #     with the fingerprint). CLASS 6 (budget) needs --state only, so it runs
  #     on its own gate — a run that cannot supply a task snapshot can still be
  #     audited against its own spend.
  #--------------------------------------------------------------------------
  local CLASSES="skipped(mode=anchor)"
  if [[ "$MODE" == "reconcile" ]]; then
    if [[ -z "$TASKS" || -z "$STATE" ]]; then
      CLASSES="undetermined(no --tasks and/or --state given; classes 1-4 NOT checked)"
      note "anchor.sh: classes 1-4 UNDETERMINED — run with --tasks <snapshot> --state <project_state.json> to check them."
    else
      CLASSES="checked"
      # one JSON object per line (jq-free; jq is not required anywhere here)
      tr -d '\n\r' < "$TASKS" | sed -e 's/}[[:space:]]*,[[:space:]]*{/}\
{/g' > "$WORKDIR/tasks.lines"
      tr -d '\n\r' < "$STATE" > "$WORKDIR/state.flat"

      state_array_has() {  # state_array_has <array-key> <needle>
        local seg
        seg="$(sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$WORKDIR/state.flat" | head -1)"
        [[ -n "$seg" ]] || return 1
        printf '%s\n' "$seg" > "$WORKDIR/arr.txt"
        g_has "\"$(re_escape "$2")\"" "$WORKDIR/arr.txt"
      }
      artifact_on_disk() {  # artifact_on_disk <task-id>
        local d hit
        for d in "$HOME_DIR/repos" "$HOME_DIR/captures" "$HOME_DIR/CONTROL"; do
          [[ -d "$d" ]] || continue
          hit="$(find "$d" -maxdepth "$CENSUS_DEPTH" -name "*${1}*" -print 2>/dev/null | head -1)"
          [[ -n "$hit" ]] && return 0
        done
        return 1
      }
      jfield() {  # jfield <json-line> <key>
        printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
      }
      checklist_box() {  # checklist_box <id> -> x | space | none
        local idr line
        idr="$(re_escape "$1")"
        set +e
        line="$("$GREP" -m1 -E "^[[:space:]]*- \[[ xX]\].*${idr}" "$CHK" 2>&1)"; local r=$?
        set -e
        if (( r >= 2 )); then die_tool "grep rc=${r} scanning ${CHK} for ${1}: ${line}"; fi
        if (( r == 1 )); then printf 'none\n'; return 0; fi
        if printf '%s' "$line" | "$GREP" -qE '^[[:space:]]*- \[[xX]\]'; then printf 'x\n'; else printf 'space\n'; fi
      }

      local jline tid tname tstat box
      while IFS= read -r jline; do
        [[ -n "$jline" ]] || continue
        s_has '"status"' "$jline" -i || continue
        tid="$(jfield "$jline" 'taskId')"
        [[ -n "$tid" ]] || tid="$(jfield "$jline" 'id')"
        tname="$(jfield "$jline" 'subject')"
        [[ -n "$tname" ]] || tname="$(jfield "$jline" 'name')"
        [[ -n "$tid" ]] || tid="$tname"
        [[ -n "$tid" ]] || continue
        tstat="$(printf '%s' "$(jfield "$jline" 'status')" | tr 'A-Z' 'a-z' | tr '-' '_')"
        box="$(checklist_box "$tid")"
        if [[ "$box" == "none" && -n "$tname" ]]; then box="$(checklist_box "$tname")"; fi

        case "$tstat" in
          pending|in_progress)
            # CLASS 1 — completed-but-still-PENDING
            if [[ "$box" == "x" ]]; then
              if state_array_has "passed" "$tid" || artifact_on_disk "$tid"; then
                alarm "completed-but-pending" "task=${tid} status=${tstat} but its checklist box is [x] and its artifact/verdict exists"
                action "mark-completed" "$tid" "checklist=[x]; evidence on disk or in workstreams.passed"
              fi
            fi
            # CLASS 2 — stale IN_PROGRESS
            if [[ "$tstat" == "in_progress" && "$box" != "x" ]]; then
              local has_dispatch=1 hb_age="undetermined"
              if [[ -f "$DL" ]] && g_has "$(re_escape "$tid")" "$DL"; then has_dispatch=0; fi
              if [[ -f "$HOME_DIR/CONTROL/HEARTBEAT.md" ]]; then
                local hbm nowe
                if hbm="$(mtime_of "$HOME_DIR/CONTROL/HEARTBEAT.md")"; then
                  nowe="$(epoch_now)"; hb_age=$(( (nowe - hbm) / 60 ))
                fi
              fi
              if (( has_dispatch != 0 )); then
                alarm "stale-in-progress" "task=${tid} is IN_PROGRESS with no row in ${DL} — nothing was ever dispatched for it"
                action "redispatch-or-revert" "$tid" "no dispatch-log row; heartbeat age=${hb_age}"
              elif [[ "$hb_age" != "undetermined" ]] && (( hb_age > STALE_MIN )); then
                alarm "stale-in-progress" "task=${tid} is IN_PROGRESS and the heartbeat is ${hb_age}m old (threshold ${STALE_MIN}m)"
                action "redispatch-or-revert" "$tid" "heartbeat stale ${hb_age}m > ${STALE_MIN}m"
              fi
            fi
            ;;
          completed)
            # CLASS 3 — false-complete. NEVER PERMITTED. The worst class.
            local why=""
            if state_array_has "failed" "$tid"; then why="task is listed in workstreams.failed"; fi
            if [[ -z "$why" && "$box" == "space" ]]; then why="its checklist box is still [ ] — the deliverable was never proven"; fi
            if [[ -z "$why" ]]; then
              if ! state_array_has "passed" "$tid" && ! artifact_on_disk "$tid"; then
                why="no verdict in workstreams.passed and no artifact on disk (condition B/D/F unproven)"
              fi
            fi
            if [[ -n "$why" ]]; then
              alarm "false-complete" "task=${tid} is COMPLETED but ${why}. A failed or unproven verification is NEVER completed (completion law A-F)."
              action "revert-to-pending" "$tid" "false-complete: ${why}"
            fi
            # CLASS 4 — re-request guard
            if [[ -n "$NEXT_RAW" ]] && s_has "$(re_escape "$tid")" "$NEXT_RAW"; then
              if state_array_has "passed" "$tid" || [[ "$box" == "x" ]]; then
                alarm "re-request" "the top open TODO item names task=${tid}, which is already COMPLETED with proof — do not redo work because state lagged"
                action "skip-advance" "$tid" "TODO top item duplicates a proven-complete task"
              fi
            fi
            ;;
        esac
      done < "$WORKDIR/tasks.lines"
    fi

    # CLASS 6 — THE BUDGET AUDIT. Its own gate: --state is enough.
    budget_audit
    CLASSES="${CLASSES},${BUDGET_NOTE}"
  fi

  #--------------------------------------------------------------------------
  # (8) THE STATE-DELTA FINGERPRINT and the TERMINAL-DRIFT counter
  #--------------------------------------------------------------------------
  local FP="n/a" NODELTA="n/a" RUNNABLE=0 WINDOW_MIN=0 SINCE=""
  if [[ "$MODE" == "reconcile" ]]; then
    # runnable work: an open TODO item or a PENDING task
    if (( C_OPEN > 0 )) || [[ -n "$NEXT_RAW" ]]; then RUNNABLE=1; fi
    if [[ -n "$T_P" ]] && (( T_P > 0 )); then RUNNABLE=1; fi

    census() {
      local d
      for d in "$HOME_DIR/repos" "$HOME_DIR/CONTROL"; do
        [[ -d "$d" ]] || continue
        { find "$d" -maxdepth "$CENSUS_DEPTH" \
            \( -name .git -o -name node_modules -o -name .next -o -name dist -o -name '*.lock.d' \) -prune -o \
            -type f \
            ! -name 'LEDGER.md' \
            ! -name '.anchor-fingerprint' \
            ! -name 'TERMINAL-DRIFT.flag' \
            ! -name '.ledger-pinned' \
            ! -name '*.lock' \
            ! -name '*.tmp.*' \
            -print 2>/dev/null || true; } | LC_ALL=C sort | while IFS= read -r f; do
              printf '%s|%s\n' "$f" "$(mtime_of "$f" || printf 'NA')"
            done
      done
    }
    {
      if [[ -n "$STATE" && -f "$STATE" ]]; then cat "$STATE"; fi
      if [[ -n "$TASKS" && -f "$TASKS" ]]; then cat "$TASKS"; fi
      cat "$CHK"
      # LEDGER.md contributes only its STATE-CARRYING lines. Its CONTENTLESS
      # tick lines and this reconciler's own lines are excluded on purpose:
      # "a line got appended" is exactly what the captured system kept doing.
      # A heartbeat that CARRIES state is kept — it is a real delta, and the
      # fingerprint must move when it lands.
      if [[ -f "$LED" ]]; then
        local e_fp; e_fp="$(_e_save)"; set +e
        state_lines "$LED" 2>/dev/null | "$GREP" -vE "$SELF_AUTHORED_RE" 2>/dev/null
        _e_restore "$e_fp"
      fi
      census
    } > "$WORKDIR/fp.in" 2>/dev/null || true
    FP="$(sha_stdin < "$WORKDIR/fp.in" | cut -c1-8)"

    local PREV_FP="" PREV_N=0 PREV_SINCE=""
    if [[ -f "$FPFILE" ]]; then
      PREV_FP="$(sed -n 's/^fp=//p' "$FPFILE" | head -1)"
      PREV_N="$(sed -n 's/^count=//p' "$FPFILE" | head -1)"
      PREV_SINCE="$(sed -n 's/^since=//p' "$FPFILE" | head -1)"
      [[ -n "$PREV_N" ]] || PREV_N=0
    fi

    local NEWN=0
    if [[ -z "$PREV_FP" ]]; then
      NEWN=0; SINCE="$(iso_now)"          # first observation: nothing to compare
    elif [[ "$PREV_FP" == "$FP" ]]; then
      if (( RUNNABLE == 1 )); then
        NEWN=$(( PREV_N + 1 ))
        SINCE="${PREV_SINCE:-$(iso_now)}"
      else
        NEWN="$PREV_N"; SINCE="${PREV_SINCE:-$(iso_now)}"   # legitimately idle: not counted
      fi
    else
      NEWN=0; SINCE="$(iso_now)"          # real state moved: the run is alive
    fi

    printf 'fp=%s\ncount=%s\nsince=%s\nts=%s\nbudget_advisory=%s\n' \
      "$FP" "$NEWN" "$SINCE" "$(iso_now)" "$BUDGET_ADVISED" > "${FPFILE}.tmp.$$"
    mv "${FPFILE}.tmp.$$" "$FPFILE"
    NODELTA="${NEWN}/${TERMINAL_N}"

    if [[ -n "$SINCE" ]]; then
      local SE NOWE2
      if SE="$(iso_to_epoch "$SINCE")"; then NOWE2="$(epoch_now)"; WINDOW_MIN=$(( (NOWE2 - SE) / 60 )); fi
    fi

    # CLASS 5 — repeated-intent stall (the photographed signature)
    local INTENT_VERDICT="undetermined(no --intents)"
    if [[ -n "$INTENTS" ]]; then
      local unchanged=0
      [[ -n "$PREV_FP" && "$PREV_FP" == "$FP" ]] && unchanged=1
      local irc=0
      intent_stall "$INTENTS" "$unchanged" || irc=$?
      case "$irc" in
        0) INTENT_VERDICT="clean(score=${INTENT_SCORE:-?}%)" ;;
        3) INTENT_VERDICT="REPEATED-INTENT(score=${INTENT_SCORE:-?}%)"
           alarm "REPEATED-INTENT" "K=${INTENT_K} consecutive stated intents, core-share ${INTENT_SCORE}% >= ${INTENT_PCT}%, no named artifact or finding in any of them, state fingerprint unchanged — announcing repeatedly, progressing never"
           action "escalate-repeated-intent" "${UNIT}" "repeated-intent stall; same escalation path as TERMINAL-DRIFT" ;;
        1) INTENT_VERDICT="clean(state moved)" ;;
        2) INTENT_VERDICT="undetermined(fewer than K=${INTENT_K} intent lines)" ;;
        *) INTENT_VERDICT="undetermined(rc=${irc})" ;;
      esac
    fi

    if (( NEWN >= TERMINAL_N )); then
      local ts; ts="$(iso_now)"
      {
        printf 'TERMINAL-DRIFT\n'
        printf 'created=%s\n' "$ts"
        printf 'no-delta-reconciles=%s\n' "$NEWN"
        printf 'window-minutes=%s\n' "$WINDOW_MIN"
        printf 'fingerprint=%s\n' "$FP"
        printf 'unit=%s\n' "$UNIT"
        printf 'next=%s\n' "$NEXT"
        printf 'counts=%s\n' "$COUNTS"
        printf 'tasks=%s\n' "$TASKSTR"
        printf 'contentless-ticks-in-ledger=%s (banned writes)\n' "$TICKS"
        printf 'stateful-heartbeats-in-ledger=%s (the required kind — not drift)\n' "$TICKS_FULL"
        printf 'REQUIRED: set run_status=STOPPED_STALL, stop dispatching, produce the\n'
        printf 'diagnose-the-blocker report (what was in flight, what each of the three\n'
        printf 'layers claims, where they disagree, the last real state change), then a\n'
        printf 'human removes this file. Nothing dispatches while it exists.\n'
      } > "$FLAG"
      ledger_write "CONTROL/LEDGER.md" "${ts} | TERMINAL-DRIFT | no-delta-reconciles=${NEWN} | window=${WINDOW_MIN}min | fp=${FP} | unit=${UNIT} | tasks=${TASKSTR} | counts=${COUNTS} | flag=CONTROL/TERMINAL-DRIFT.flag"
      ledger_write "CONTROL/TODO.md" "- [ ] OPERATOR-ESCALATION | TERMINAL-DRIFT after ${NEWN} no-delta reconciles (${WINDOW_MIN} min) | unit=${UNIT} | remove CONTROL/TERMINAL-DRIFT.flag only after the blocker is named"
      printf 'ACTION|stop-dispatching|%s|TERMINAL-DRIFT after %s no-delta reconciles (%s min)\n' "$UNIT" "$NEWN" "$WINDOW_MIN"
      printf 'ACTION|escalate-to-operator|%s|CONTROL/TERMINAL-DRIFT.flag created; run_status=STOPPED_STALL\n' "$UNIT"
      SEVERITY=4
    fi
  fi

  #--------------------------------------------------------------------------
  # (9) THE LINE. Always carries state. Never a bare heartbeat.
  #--------------------------------------------------------------------------
  local ts result LINE
  ts="$(iso_now)"
  if [[ "$MODE" == "anchor" ]]; then
    LINE="${ts} | RE-ANCHOR | anchor=${ANCHOR} | unit=${UNIT} | next=${NEXT} | counts=${COUNTS} | tasks=${TASKSTR} | manifest=${MAN_NOTE} | age=${STALENESS}"
  else
    if   (( SEVERITY == 4 )); then result="TERMINAL-DRIFT"
    elif (( ACTIONS > 0 ));   then result="actions:${ACTIONS}"
    elif (( SEVERITY == 3 )); then result="alarm"
    else result="clean"; fi
    LINE="${ts} | RECONCILE | anchor=${ANCHOR} | unit=${UNIT} | result=${result} | tasks=${TASKSTR} | counts=${COUNTS} | classes=${CLASSES} | intents=${INTENT_VERDICT:-n/a} | ticks=${TICKS} | stateful-heartbeats=${TICKS_FULL} | fp=${FP} | nodelta=${NODELTA} | age=${STALENESS} | next=${NEXT}"
  fi
  ledger_write "CONTROL/LEDGER.md" "$LINE"
  printf '%s\n' "$LINE"

  exit "$SEVERITY"
}

#------------------------------------------------------------------------------
# CLASS 5 helper — repeated-intent stall.
#   rc 0 = clean, rc 1 = state moved (not applicable), rc 2 = too few lines,
#   rc 3 = REPEATED-INTENT. Sets INTENT_SCORE.
#
#   Metric: the CORE SHARE. Tokenize each of the last K intent lines
#   (lowercased, punctuation stripped, deduplicated within a line). A token is
#   in the CORE when it appears in at least 60% of the K lines. The score is
#   |core| / (mean tokens per line). Ten near-identical intents in one minute
#   score far above the threshold; a window of real progress lines does not,
#   because progress lines share only function words.
#------------------------------------------------------------------------------
INTENT_SCORE=""
DISPATCH_ROWS=""
intent_stall() {
  local f="$1" unchanged="$2"
  (( unchanged == 1 )) || return 1
  local dir="$WORKDIR/intents"; mkdir -p "$dir"; rm -f "$dir"/t.* 2>/dev/null || true
  local n=0 line
  # last K non-empty lines
  while IFS= read -r line; do
    [[ -n "$(printf '%s' "$line" | tr -d '[:space:]')" ]] || continue
    n=$(( n + 1 ))
    printf '%s\n' "$line" >> "$dir/all.txt"
  done < "$f"
  (( n >= INTENT_K )) || return 2
  tail -n "$INTENT_K" "$dir/all.txt" > "$dir/window.txt"

  # A window that NAMES an artifact or reports a finding is progress, not a stall.
  if g_has '(/|[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}([^A-Za-z0-9]|$)|(^|[^a-z])(found|wrote|created|verified|measured|landed|merged|passed|failed|score|commit)([^a-z]|$))' "$dir/window.txt" -i; then
    INTENT_SCORE="0"
    return 0
  fi

  local i=0 total=0
  while IFS= read -r line; do
    i=$(( i + 1 ))
    printf '%s\n' "$line" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '\n' \
      | "$GREP" -vE '^$' | LC_ALL=C sort -u > "$dir/t.$i" || true
    total=$(( total + $(wc -l < "$dir/t.$i" | tr -d ' ') ))
  done < "$dir/window.txt"
  (( total > 0 )) || { INTENT_SCORE="0"; return 0; }

  local minlines core mean
  minlines=$(( (INTENT_K * 6 + 9) / 10 ))
  core="$(cat "$dir"/t.* | LC_ALL=C sort | uniq -c | awk -v m="$minlines" '$1 >= m' | wc -l | tr -d ' ')"
  mean=$(( total / INTENT_K ))
  (( mean > 0 )) || mean=1
  INTENT_SCORE=$(( core * 100 / mean ))
  (( INTENT_SCORE > 100 )) && INTENT_SCORE=100
  if (( INTENT_SCORE >= INTENT_PCT )); then return 3; fi
  return 0
}

#==============================================================================
# SELFTEST — twelve cases in a temp home. It proves the detector still
# DISCRIMINATES: every case asserts both what must fire and what must not.
#
#   1-7   the original drift cases (clean, unit-not-in-plan, missing file,
#         sabotaged fixture + the real-corpus check, false-complete,
#         terminal-drift, repeated-intent with its negative control)
#   8     CAPACITY-EVENT lines are EXCLUDED from the state-delta fingerprint
#         (positive: only capacity events => the no-delta counter still
#         climbs; negative control: a real state line still resets it)
#   9-12  CLASS 6 BUDGET AUDIT, all four controls: agree (must NOT fire),
#         diverge past tolerance (MUST fire), hard cap (MUST emit BUDGET-CAP
#         and both ACTIONs at exit 3, not 4), fields absent (MUST report
#         undetermined and MUST NOT alarm)
#==============================================================================
selftest() {
  local T PASSES=0 FAILS=0
  SELFTEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/anchor-selftest.XXXXXX")"
  T="$SELFTEST_TMP"

  mk_home() {  # mk_home <dir>
    mkdir -p "$1/SPEC" "$1/CONTROL"
    printf 'Goal: build the thing.\n' > "$1/SPEC/GOAL.md"
    printf -- '- [x] U-01 build the parser\n- [ ] U-02 qc the parser\n' > "$1/CONTROL/CHECKLIST.md"
    printf -- '- [ ] U-02 qc the parser\n' > "$1/CONTROL/TODO.md"
  }
  report() {  # report <n> <name> <ok:0/1> <detail>
    if (( $3 == 1 )); then
      printf 'PASS | case %s | %s | %s\n' "$1" "$2" "$4"; PASSES=$(( PASSES + 1 ))
    else
      printf 'FAIL | case %s | %s | %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 ))
    fi
  }
  runa() {  # runa <args...> -> sets RC and OUT
    set +e
    OUT="$("$SELF" "$@" 2>&1)"; RC=$?
    set -e
  }

  # --- case 1: the clean path (and the negative control: no alarm)
  mk_home "$T/c1"
  runa "$T/c1" "U-02"
  local ok=0
  if (( RC == 0 )) && "$GREP" -qE '\| RE-ANCHOR \|' "$T/c1/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE 'DRIFT-ALARM' "$T/c1/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 1 "clean anchor" "$ok" "rc=${RC}; RE-ANCHOR line written; no DRIFT-ALARM (negative control held)"

  # --- case 2: unit not in the plan
  mk_home "$T/c2"
  runa "$T/c2" "U-99"
  ok=0
  if (( RC == 3 )) && "$GREP" -qE 'DRIFT-ALARM \| unit-not-in-plan' "$T/c2/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 2 "unit-not-in-plan" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | unit-not-in-plan present"

  # --- case 3: a required file is missing
  mkdir -p "$T/c3/SPEC" "$T/c3/CONTROL"
  printf 'Goal\n' > "$T/c3/SPEC/GOAL.md"
  printf -- '- [ ] U-01\n' > "$T/c3/CONTROL/CHECKLIST.md"
  runa "$T/c3" "U-01"
  ok=0
  if (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'CONTROL/TODO.md'; then ok=1; fi
  report 3 "missing-file" "$ok" "rc=${RC} (want 2); the message NAMES the missing path"

  # --- case 4: BROKEN INSTRUMENT (fixture sabotage) + the real-corpus check
  mk_home "$T/c4"
  set +e
  OUT="$(ANCHOR_SELFTEST_BREAK_PATTERN=1 "$SELF" "$T/c4" "U-02" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'BROKEN INSTRUMENT'; then ok=1; fi
  # The corpus check: run the classifier over a REAL ledger when one is
  # available and require it to agree with the strict anchored control on the
  # contentless count, and to spare every state-carrying heartbeat. A corpus
  # that is present but disagrees FAILS the case — it never passes quietly.
  local CORPUS="${ANCHOR_SELFTEST_REAL_LEDGER:-$HOME/Downloads/GAUNTLET-LOOP-WORK/LEDGER.md}"
  local corpus_note="real-ledger corpus not present — corpus check SKIPPED, not passed"
  if [[ -f "$CORPUS" ]]; then
    local strict cls c_tick c_full c_state brittle
    strict="$("$GREP" -c '^- heartbeat .*(ledger auto-tick)$' "$CORPUS" || true)"
    cls="$(classify_file "$CORPUS")"
    c_tick="$(printf '%s' "$cls" | cut -d' ' -f1)"
    c_full="$(printf '%s' "$cls" | cut -d' ' -f2)"
    c_state="$(printf '%s' "$cls" | cut -d' ' -f3)"
    brittle="$("$GREP" -cF 'heartbeat (ledger auto-tick)' "$CORPUS" || true)"
    corpus_note="corpus: contentless=${c_tick} vs strict control=${strict}; stateful auto-ticks spared=${c_full}; other lines=${c_state}; brittle literal=${brittle}"
    if [[ "$c_tick" != "$strict" ]] || (( c_full < 1 )) || [[ "$brittle" != "0" ]]; then
      ok=0
      corpus_note="CORPUS MISMATCH — ${corpus_note}"
    fi
  fi
  report 4 "broken-instrument" "$ok" "rc=${RC} (want 2); named BROKEN INSTRUMENT, refused to report clean | ${corpus_note}"

  # --- case 5: false-complete (never permitted)
  mk_home "$T/c5"
  printf -- '- [ ] T-01 build the parser\n- [ ] T-02 qc\n' > "$T/c5/CONTROL/CHECKLIST.md"
  printf -- '- [ ] T-01 build the parser\n' > "$T/c5/CONTROL/TODO.md"
  printf '{"tasks":[{"taskId":"T-01","subject":"build the parser","status":"completed"},{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c5/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c5/CONTROL/project_state.json"
  runa "$T/c5" "IDLE" --mode reconcile --tasks "$T/c5/CONTROL/task-graph-snapshot.json" --state "$T/c5/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) && "$GREP" -qE 'DRIFT-ALARM \| false-complete' "$T/c5/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|revert-to-pending'; then ok=1; fi
  report 5 "false-complete" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | false-complete written; ACTION|revert-to-pending emitted"

  # --- case 6: TERMINAL-DRIFT with the counter primed to N-1
  mk_home "$T/c6"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c6/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c6/CONTROL/project_state.json"
  runa "$T/c6" "U-02" --mode reconcile --tasks "$T/c6/CONTROL/task-graph-snapshot.json" --state "$T/c6/CONTROL/project_state.json"
  local primed=$(( TERMINAL_N - 1 ))
  sed -e "s/^count=.*/count=${primed}/" "$T/c6/CONTROL/.anchor-fingerprint" > "$T/c6/CONTROL/.anchor-fingerprint.new"
  mv "$T/c6/CONTROL/.anchor-fingerprint.new" "$T/c6/CONTROL/.anchor-fingerprint"
  runa "$T/c6" "U-02" --mode reconcile --tasks "$T/c6/CONTROL/task-graph-snapshot.json" --state "$T/c6/CONTROL/project_state.json"
  ok=0
  if (( RC == 4 )) && [[ -f "$T/c6/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && "$GREP" -qE '\| TERMINAL-DRIFT \| no-delta-reconciles=' "$T/c6/CONTROL/LEDGER.md" 2>/dev/null \
     && "$GREP" -q 'OPERATOR-ESCALATION' "$T/c6/CONTROL/TODO.md" 2>/dev/null; then ok=1; fi
  report 6 "terminal-drift" "$ok" "rc=${RC} (want 4); CONTROL/TERMINAL-DRIFT.flag created; escalation in LEDGER.md and TODO.md"

  # --- case 7: repeated-intent stall, WITH its known-negative control
  mk_home "$T/c7"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c7/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c7/CONTROL/project_state.json"
  # the photographed signature, verbatim
  cat > "$T/c7/CONTROL/intents.txt" <<'EOF'
Let me understand the board API endpoints for listing and clearing tasks.
Let me find the task-listing endpoint and how to query the board.
Let me find the task-listing endpoint to see what is on the board.
Let me find the Command Center app source and its task API routes.
Let me find the task API routes in the command-center project to understand how to list and clear tasks.
EOF
  # the control: five lines of real progress, same length, same speaker
  cat > "$T/c7/CONTROL/intents-control.txt" <<'EOF'
Parser unit U-01 built; nine cases green; handing to QC.
QC verdict 8.7 on U-01; one minor finding raised as F-3.
Repaired F-3 in the tokenizer; regression suite re-run clean.
Batch B-2 landed on trunk; tag v0.4.0 cut and pushed.
Visual capture for the settings screen replaced the stale one.
EOF
  runa "$T/c7" "U-02" --mode reconcile --tasks "$T/c7/CONTROL/task-graph-snapshot.json" --state "$T/c7/CONTROL/project_state.json"
  runa "$T/c7" "U-02" --mode reconcile --tasks "$T/c7/CONTROL/task-graph-snapshot.json" --state "$T/c7/CONTROL/project_state.json" --intents "$T/c7/CONTROL/intents.txt"
  local rc_pos=$RC out_pos="$OUT"
  runa "$T/c7" "U-02" --mode reconcile --tasks "$T/c7/CONTROL/task-graph-snapshot.json" --state "$T/c7/CONTROL/project_state.json" --intents "$T/c7/CONTROL/intents-control.txt"
  local rc_neg=$RC
  ok=0
  if (( rc_pos == 3 )) && "$GREP" -qE 'DRIFT-ALARM \| REPEATED-INTENT' "$T/c7/CONTROL/LEDGER.md" 2>/dev/null \
     && (( rc_neg != 3 )); then ok=1; fi
  report 7 "repeated-intent" "$ok" "rc=${rc_pos} (want 3) on the photographed fixture; control window rc=${rc_neg} (must not be 3) — the detector discriminates"

  #--------------------------------------------------------------------------
  # --- case 8: CAPACITY-EVENT is excluded from the state-delta fingerprint.
  #     The world moving under a long run (a 429 cluster, a dead provider, a
  #     low balance) is OBSERVATION, not progress. A run that emits nothing
  #     but capacity events while runnable work exists must still march toward
  #     TERMINAL-DRIFT. The control in the other direction is in the same
  #     case: a genuine state-carrying line MUST reset the counter, or the
  #     exclusion has simply blinded the fingerprint.
  #--------------------------------------------------------------------------
  mk_home "$T/c8"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c8/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c8/CONTROL/project_state.json"
  local c8args=( "$T/c8" "U-02" --mode reconcile --tasks "$T/c8/CONTROL/task-graph-snapshot.json" --state "$T/c8/CONTROL/project_state.json" )
  runa "${c8args[@]}"                              # 1st: establishes the fingerprint
  runa "${c8args[@]}"                              # 2nd: nothing moved -> count 1
  local c8_base; c8_base="$(sed -n 's/^count=//p' "$T/c8/CONTROL/.anchor-fingerprint" | head -1)"
  # Now the world moves but the WORK does not: capacity events only, written
  # through ledger.sh exactly as capacity.md 6.2 specifies.
  "$SCRIPT_DIR/ledger.sh" "$T/c8" "CONTROL/LEDGER.md" \
    "2026-08-12T02:14:00Z | CAPACITY-EVENT | provider=deepseek | event=429-cluster | evidence=rc429x4/1tick | response=throttle" >/dev/null 2>&1
  "$SCRIPT_DIR/ledger.sh" "$T/c8" "CONTROL/LEDGER.md" \
    "2026-08-12T02:19:00Z | CAPACITY-EVENT | provider=ollama-cloud | event=tier-tripwire | evidence=reject@3-concurrent | response=fallback" >/dev/null 2>&1
  runa "${c8args[@]}"
  local c8_after; c8_after="$(sed -n 's/^count=//p' "$T/c8/CONTROL/.anchor-fingerprint" | head -1)"
  local c8_rc_pos=$RC
  # The negative control: a real state-carrying line MUST move the fingerprint.
  "$SCRIPT_DIR/ledger.sh" "$T/c8" "CONTROL/LEDGER.md" \
    "2026-08-12T02:24:00Z | RESULT | unit=U-02 | verdict=8.7 | artifact=repos/app/src/parser.ts" >/dev/null 2>&1
  runa "${c8args[@]}"
  local c8_reset; c8_reset="$(sed -n 's/^count=//p' "$T/c8/CONTROL/.anchor-fingerprint" | head -1)"
  ok=0
  if [[ -n "$c8_base" && -n "$c8_after" && -n "$c8_reset" ]] \
     && (( c8_after == c8_base + 1 )) && (( c8_reset == 0 )) && (( c8_rc_pos != 2 )); then ok=1; fi
  report 8 "capacity-event-excluded" "$ok" \
    "no-delta counter ${c8_base}->${c8_after} across 2 CAPACITY-EVENT lines (must climb: observation is not progress); a real state line reset it to ${c8_reset} (must be 0 — the control proving the fingerprint is not simply blind)"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control A (case 9): claimed spend AGREES with the dispatch
  #     census. The detector MUST NOT fire. A budget audit that cannot stay
  #     quiet on an honest ledger is an alarm, not a detector.
  #--------------------------------------------------------------------------
  mk_dispatch_log() {  # mk_dispatch_log <home> <n-rows>
    local h="$1" n="$2" i=1
    printf '# Dispatch log\n\n' > "$h/CONTROL/dispatch-log.md"
    while (( i <= n )); do
      printf '2026-08-12T0%d:%02d:00Z | U-%03d | build | builder-%d | run-%06d\n' \
        $(( i % 10 )) $(( i % 60 )) "$i" "$i" "$i" >> "$h/CONTROL/dispatch-log.md"
      i=$(( i + 1 ))
    done
  }
  mk_state_budget() {  # mk_state_budget <home> <initial> <remaining> <executions>
    printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","agents":{"executions_total":%s,"budget_initial":%s,"session_budget_remaining":%s,"warn_at":150,"hard_stop_at":200},"workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' \
      "$4" "$2" "$3" > "$1/CONTROL/project_state.json"
  }
  mk_home "$T/c9"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c9/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c9" 1000 964 36
  mk_dispatch_log "$T/c9" 36
  runa "$T/c9" "U-02" --mode reconcile --tasks "$T/c9/CONTROL/task-graph-snapshot.json" --state "$T/c9/CONTROL/project_state.json"
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-ok(claimed=36/dispatched=36)' \
     && ! "$GREP" -qE 'DRIFT-ALARM \| budget-mismatch' "$T/c9/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE '\| BUDGET-CAP \|' "$T/c9/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 9 "budget-agree" "$ok" "rc=${RC} (want 0); classes carry budget-ok(claimed=36/dispatched=36); no budget-mismatch and no BUDGET-CAP (both negative controls held)"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control B (case 10): claimed spend DIVERGES past tolerance.
  #     This is the promise capacity.md made and the tool never kept.
  #--------------------------------------------------------------------------
  mk_home "$T/c10"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c10/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c10" 1000 900 100
  mk_dispatch_log "$T/c10" 3
  runa "$T/c10" "U-02" --mode reconcile --tasks "$T/c10/CONTROL/task-graph-snapshot.json" --state "$T/c10/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) \
     && "$GREP" -qE 'DRIFT-ALARM \| budget-mismatch \| unit=U-02 \| claimed=100 dispatched=3' "$T/c10/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|reconcile-budget|100/3|'; then ok=1; fi
  report 10 "budget-mismatch" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | budget-mismatch | claimed=100 dispatched=3 written; ACTION|reconcile-budget|100/3 emitted"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control C (case 11): the HARD CAP. Reaching the cap is a
  #     legitimate declared stop, so it exits 3 (stop dispatching) and asks
  #     the conductor for run_status=STOPPED_CAP — never exit 4, which belongs
  #     to the stall, and never a DRIFT-ALARM, which would call a policy stop
  #     a defect. Claimed and dispatched AGREE here so the case can only be
  #     firing on the cap.
  #--------------------------------------------------------------------------
  mk_home "$T/c11"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c11/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c11" 1000 800 200
  mk_dispatch_log "$T/c11" 200
  runa "$T/c11" "U-02" --mode reconcile --tasks "$T/c11/CONTROL/task-graph-snapshot.json" --state "$T/c11/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) \
     && "$GREP" -qE '\| BUDGET-CAP \| executions=200 \| cap=200 \|' "$T/c11/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|stop-dispatching|U-02|hard cap' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|set-run-status|STOPPED_CAP|' \
     && ! "$GREP" -qE 'DRIFT-ALARM \| budget-mismatch' "$T/c11/CONTROL/LEDGER.md" 2>/dev/null \
     && [[ ! -f "$T/c11/CONTROL/TERMINAL-DRIFT.flag" ]]; then ok=1; fi
  report 11 "budget-hard-cap" "$ok" "rc=${RC} (want 3, NOT 4); BUDGET-CAP line written through ledger.sh; ACTION|stop-dispatching and ACTION|set-run-status|STOPPED_CAP emitted; no budget-mismatch; no TERMINAL-DRIFT.flag"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control D (case 12): the budget fields are ABSENT. The audit
  #     must say UNDETERMINED and name it. A fabricated zero here would report
  #     "claimed 0, dispatched 0, all clear" on a state file that never
  #     tracked a budget at all — a false all-clear, the one forbidden answer.
  #--------------------------------------------------------------------------
  mk_home "$T/c12"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c12/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c12/CONTROL/project_state.json"
  mk_dispatch_log "$T/c12" 7
  runa "$T/c12" "U-02" --mode reconcile --tasks "$T/c12/CONTROL/task-graph-snapshot.json" --state "$T/c12/CONTROL/project_state.json"
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-undetermined(no-budget-fields)' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-ok' \
     && ! "$GREP" -qE 'DRIFT-ALARM' "$T/c12/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 12 "budget-fields-absent" "$ok" "rc=${RC} (want 0); classes carry budget-undetermined(no-budget-fields); no fabricated budget-ok; no DRIFT-ALARM"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control E (case 13): NEGATIVE claimed spend.
  #     session_budget_remaining (1003) EXCEEDS budget_initial (1000), so
  #     claimed = -3. This is an IMPOSSIBLE scoreboard: no run ends with more
  #     budget than it began with.
  #
  #     This case exists because the magnitude test alone laundered it. The
  #     comparison takes the ABSOLUTE difference, so -3 against a 0-row census
  #     produced diff=3, slipped under ANCHOR_BUDGET_TOL (5), and reported
  #     "budget-ok" — the audit issuing a clean bill of health on a state file
  #     that cannot exist. The tolerance is the wrong instrument for a sign
  #     error, which is why the guard runs before it.
  #
  #     The dispatch log is deliberately ABSENT here, proving the second half:
  #     the verdict comes from the state file alone and is NOT downgraded to
  #     "budget-undetermined(no-dispatch-log)" by the missing census.
  #--------------------------------------------------------------------------
  mk_home "$T/c13"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c13/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c13" 1000 1003 10
  rm -f "$T/c13/CONTROL/dispatch-log.md"
  runa "$T/c13" "U-02" --mode reconcile --tasks "$T/c13/CONTROL/task-graph-snapshot.json" --state "$T/c13/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) \
     && "$GREP" -qE 'DRIFT-ALARM \| budget-negative-spend \| unit=U-02 \| claimed=-3' "$T/c13/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-negative-spend(claimed=-3/initial=1000/remaining=1003)' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-ok' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-undetermined'; then ok=1; fi
  report 13 "budget-negative-spend" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | budget-negative-spend | claimed=-3 written; classes carry budget-negative-spend(claimed=-3/initial=1000/remaining=1003); NOT laundered into budget-ok by the tolerance, and NOT downgraded to budget-undetermined by the absent dispatch log"

  printf 'SELFTEST COMPLETE | %s of 13 cases passed | %s failed\n' "$PASSES" "$FAILS"
  if (( FAILS > 0 )); then exit 1; fi
  exit 0
}

#==============================================================================
if (( DO_SELFTEST == 1 )); then
  self_prove
  selftest
fi
run_anchor
