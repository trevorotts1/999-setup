#!/usr/bin/env bash
#==============================================================================
# anchor.sh — spec-protocol's THREE-WAY RECONCILER, capture-proof drift stop,
# and the anti-drift contract's CLAIM-before/RESULT-after ledger-provenance
# check (class 7)
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
# THE RECOVERY LADDER (references/anti-drift.md section 6)
#   Exit 4 is the LAST rung, never the first. When the no-delta counter reaches
#   N the script climbs, one rung per reconcile, and each rung is a thing the
#   run can do for itself while the client sleeps:
#     rung 1  ACTION|redispatch-from-checkpoint for every in-flight unit (a
#             dispatch-log row with no RESULT line) — TaskStop it, then re-fire
#             it from its last checkpoint;
#     rung 2  if the last recorded state change was a CAPACITY-EVENT, the
#             counter does NOT count toward drift for up to two hours: N rises
#             to max(ANCHOR_TERMINAL_N, ceil(120min / cadence)) while the grace
#             holds. A provider outage is the world moving, not a captured run;
#     rung 3  ACTION|switch-to-fallback-seats — the fallback table in
#             references/capacity.md, before any escalation;
#     rung 4  only now CONTROL/TERMINAL-DRIFT.flag, exit 4.
#   And the flag is not a dead end: a fresh session that writes the NAMED
#   blocker into CONTROL/TODO.md as
#       - [x] BLOCKER-NAMED | <the blocker, one line> | session=<this session>
#   clears the flag on its next reconcile, here, without a human. Recovery is
#   no longer a human act only.
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
#   ANCHOR_TERMINAL_N=6            consecutive no-delta reconciles => the ladder
#   ANCHOR_RECONCILE_CADENCE_MIN=5 the reconcile cadence the ladder assumes
#   ANCHOR_CAPACITY_GRACE_MIN=120  capacity-event grace window, minutes (rung 2)
#   ANCHOR_STALE_MIN=10            liveness threshold for a running task, minutes
#   ANCHOR_INTENT_K=5              repeated-intent window size
#   ANCHOR_INTENT_OVERLAP_PCT=60   repeated-intent core-share threshold
#   ANCHOR_CENSUS_DEPTH=6          filesystem census depth under repos/
#   ANCHOR_HARD_CAP=200            class 6 pause-line FALLBACK when the state file
#                                  carries no agents.first_pause (PAUSED_CAP)
#   SPEC_PROTOCOL_FIRST_PAUSE      THE OPERATOR OVERRIDE, for a headless driver
#                                  that cannot write into a project folder that
#                                  does not exist yet. It replaces
#                                  agents.first_pause. CONTROL/OPERATOR-OVERRIDE.json
#                                  WINS over it when both are present, and the
#                                  RECONCILE line names whichever source was
#                                  used (see "THE OPERATOR OVERRIDE" below). A
#                                  value that is set and cannot be honoured is
#                                  exit 2, never an ignored one.
#   ANCHOR_CEILING=2000            class 6 absolute per-project ceiling (STOPPED_CAP)
#   ANCHOR_BUDGET_TOL=5            class 6 claimed-vs-dispatched tolerance
#   ANCHOR_CLAIM_UNPAIRED_TOL=3    class 7 unpaired-claim tolerance (0 = strict)
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
CADENCE_MIN="${ANCHOR_RECONCILE_CADENCE_MIN:-5}"
CAPACITY_GRACE_MIN="${ANCHOR_CAPACITY_GRACE_MIN:-120}"
STALE_MIN="${ANCHOR_STALE_MIN:-10}"
INTENT_K="${ANCHOR_INTENT_K:-5}"
INTENT_PCT="${ANCHOR_INTENT_OVERLAP_PCT:-60}"
CENSUS_DEPTH="${ANCHOR_CENSUS_DEPTH:-6}"
HARD_CAP="${ANCHOR_HARD_CAP:-200}"
CEILING="${ANCHOR_CEILING:-2000}"
BUDGET_TOL="${ANCHOR_BUDGET_TOL:-5}"
CLAIM_TOL="${ANCHOR_CLAIM_UNPAIRED_TOL:-3}"

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
# CLASS 7 (ledger provenance) — the anti-drift contract, mechanically checked
# (SKILL.md "Atomic ledger writes"; references/anti-drift.md section 8): every
# ledger line that REFERENCES a unit as a CLAIM (the before-write) must be
# matched by a RESULT line for the SAME unit (the after-write). A RESULT line
# alone — a unit whose claim was never written before it — is the run working
# on something nobody wrote down, the ledger failing as the single source of
# truth. The marker is deliberately the pipe-separated `| CLAIM |` form so a
# prose word "claim" in a narrative line never matches. No RESULT marker for
# IDLE lines: an IDLE reconcile is a non-unit tick and claims nothing. The
# [|] form is BSD-awk-safe (a backslash-pipe is an illegal regex there).
LEDGER_CLAIM_RE='[|][[:space:]]*CLAIM[[:space:]]*[|]'
# The capacity-event marker for rung 2 of the recovery ladder. It is the
# pipe-DELIMITED field form (`ts | CAPACITY-EVENT | provider=… `,
# references/capacity.md section 6.2), never the bare word, for the same
# reason the CLAIM marker is: this script's own RECOVERY-LADDER lines name the
# marker in their evidence text, and a bare-word search matched THOSE — the
# grace then found its own writing and held forever, one reconcile after the
# ladder said the grace did not apply. A detector that can match its own
# output is not a detector.
LEDGER_CAPACITY_RE='[|][[:space:]]*CAPACITY-EVENT[[:space:]]*[|]'
LEDGER_RESULT_RE='[|][[:space:]]*RESULT[[:space:]]*[|]'
LEDGER_UNIT_RE='(^|[[:space:]|])unit=([^[:space:]|]+)'
CLAIM_UNPAIRED_TOL="${ANCHOR_CLAIM_UNPAIRED_TOL:-3}"
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
# BUDGET-CAP and BUDGET-PAUSE are this script's own class-6 lines and are
# excluded on the same self-authored ground as the rest, and so is
# RECOVERY-LADDER: the rungs this script climbs before the flag are its OWN
# writes. A ladder line that moved the fingerprint would reset the very counter
# that produced it, and the run would climb rung 1 forever without ever
# reaching the flag.
SELF_AUTHORED_RE='(RE-ANCHOR|RECONCILE|DRIFT-ALARM|TERMINAL-DRIFT|RECOVERY-LADDER|S-CHECK|OPERATOR-ESCALATION|CAPACITY-EVENT|BUDGET-CAP|BUDGET-PAUSE)'

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

#------------------------------------------------------------------------------
# CLASS 8's counter — CAN THIS LEDGER BE TIME-ORDERED AT ALL? (RC-18.)
#
# Every non-tick line is either a RECORD or markdown STRUCTURE, and a record
# with no ISO8601Z at its head cannot be placed in time by anything. The three
# categories below MIRROR tools/ledger.sh's LEDGER_STRUCT_RE exactly, so the
# writer and this reader agree by construction: every line ledger.sh stamps is
# a line this counts, and every line ledger.sh leaves alone is a line this
# skips. Read that constant's comment for why a checklist row is not a record.
#
# The stamped test tolerates a leading `- ` bullet because document 12's rows
# are allowed one (the dispatch census below reads the same optional bullet):
# `- 2026-…` already carries its clock and is not a defect.
#
# THE SELF-REFERENCE TRAP, avoided by construction rather than by exclusion:
# every line THIS script writes — RECONCILE, DRIFT-ALARM, RECOVERY-LADDER,
# TERMINAL-DRIFT, BUDGET-CAP — opens with iso_now(), so this counter can never
# be inflated by its own output the way the capacity grace once was by its own
# ladder lines. No SELF_AUTHORED_RE filter is needed and none is applied: an
# unstamped self-written line would be a real defect and must be counted.
#
# Digits are spelled out rather than written as {4}: interval expressions are
# not portable across the awks this script runs on, and inflight_units below
# already spells them out for the same reason. `[|]` not `\|`, which is an
# illegal regex in BSD awk.
#------------------------------------------------------------------------------
AWK_LEDGER_STAMP='
{
  if ($0 ~ /^[ \t]*$/) { next }
  if ($0 ~ /^[ \t]*(#|>|---|[|])/) { st++; next }
  if ($0 ~ /^[ \t]*[-*+][ \t]*\[[ xX]\]/) { st++; next }
  rec++
  if ($0 ~ /^[ \t]*(- )?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z/) ok++
  else un++
}
END { printf "%d %d %d %d\n", rec+0, ok+0, un+0, st+0 }
'

# ledger_stamp_census <ledger-path> -> "<records> <stamped> <unstamped> <structure>"
# Prints NOTHING and returns 1 when the answer is UNDETERMINED — no awk, no
# such file, unreadable. An absent ledger is never counted as a proven zero.
ledger_stamp_census() {
  [[ -n "$AWK" && -x "$AWK" ]] || return 1
  [[ -f "$1" ]] || return 1
  local sf="$WORKDIR/ledger.nontick.txt"
  state_lines "$1" > "$sf" 2>/dev/null || return 1
  [[ -f "$sf" ]] || return 1
  "$AWK" "$AWK_LEDGER_STAMP" "$sf" 2>/dev/null || return 1
  return 0
}

# ledger.cmd <file> <marker-re> <unit-re> -> the unit tokens of every line
# carrying <marker-re>, in file order, deduplicated. CLASS 7 (ledger
# provenance) uses it twice: units with a `| CLAIM |` line and units with a
# `| RESULT |` line. A missing or unreadable ledger prints NOTHING and returns
# 0 — but callers classify an ABSENT ledger as undetermined BEFORE reaching
# this, so a negative here is only ever read against a ledger that was proven
# to exist.
ledger.cmd() {
  [[ -f "$1" ]] || return 0
  "$AWK" -v MR="$2" -v UR="$3" '
    $0 ~ MR {
      u = ""
      if (match($0, UR)) { u = substr($0, RSTART, RLENGTH) }
      sub(/^[^=]*=/, "", u)
      if (u != "") { if (!seen[u]++) { print u } }
    }' "$1"
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
  sed -n '2,95p' "$SELF" | sed 's/^# \{0,1\}//'
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
[[ "$CEILING"    =~ ^[0-9]+$ ]] || die_tool "ANCHOR_CEILING must be a non-negative integer (got: ${CEILING})"
[[ "$BUDGET_TOL" =~ ^[0-9]+$ ]] || die_tool "ANCHOR_BUDGET_TOL must be a non-negative integer (got: ${BUDGET_TOL})"
[[ "$CLAIM_TOL"  =~ ^[0-9]+$ ]] || die_tool "ANCHOR_CLAIM_UNPAIRED_TOL must be a non-negative integer (got: ${CLAIM_TOL})"
[[ "$TERMINAL_N" =~ ^[0-9]+$ ]] || die_tool "ANCHOR_TERMINAL_N must be a non-negative integer (got: ${TERMINAL_N})"
[[ "$CAPACITY_GRACE_MIN" =~ ^[0-9]+$ ]] || die_tool "ANCHOR_CAPACITY_GRACE_MIN must be a non-negative integer (got: ${CAPACITY_GRACE_MIN})"
# The cadence DIVIDES. A zero or non-numeric value would abort the shell inside
# (( )) or silently produce a nonsense threshold, so it is rejected loudly.
[[ "$CADENCE_MIN" =~ ^[0-9]+$ ]] && (( CADENCE_MIN >= 1 )) \
  || die_tool "ANCHOR_RECONCILE_CADENCE_MIN must be an integer >= 1 minute (got: ${CADENCE_MIN})"

# THE CAPACITY-EVENT THRESHOLD (rung 2 of the recovery ladder). When the last
# recorded state change is a CAPACITY-EVENT, the no-delta counter must be
# allowed to run for two hours before it means anything: a 429 cluster or a
# dead provider is the world moving under the run, not the run capturing
# itself. N = max(ANCHOR_TERMINAL_N, ceil(120 min / cadence)) — 24 at the
# 5-minute cadence. The grace is bounded twice, by this count AND by the
# wall-clock window, so a slower cadence cannot buy an unlimited stall.
CAPACITY_N=$(( (CAPACITY_GRACE_MIN + CADENCE_MIN - 1) / CADENCE_MIN ))
if (( CAPACITY_N < TERMINAL_N )); then CAPACITY_N="$TERMINAL_N"; fi

#==============================================================================
# THE OPERATOR OVERRIDE — CONTROL/OPERATOR-OVERRIDE.json (WI-35, wave 6)
#
# THE CONTRACT. A FLAT JSON object. One honoured key today:
#
#     { "first_pause": 20, "set_by": "operator", "reason": "canary proof D" }
#
#   first_pause  a non-negative integer. It REPLACES agents.first_pause from
#                CONTROL/project_state.json in the pause arithmetic, and it is
#                read BEFORE that file. Granted blocks still multiply it and the
#                ceiling still clamps it: an override MOVES the pause line, it
#                never abolishes the ceiling.
#   set_by       free text. Recorded on stderr, never parsed.
#   reason       free text. Recorded on stderr, never parsed.
#
#   Nothing is nested, and no key appears twice. Both are REFUSED rather than
#   tolerated, because the readers that decide the pause (jnum, below, and the
#   character-for-character copy of it in tools/dispatch-check.sh) match a
#   quoted key at ANY depth and, being greedy, return the LAST occurrence — so a
#   nested or duplicated first_pause resolves unpredictably (RC-3). A file this
#   parser accepts is a file both readers agree about.
#
# WHY IT EXISTS. The 2026-09-07 canary injected agents.first_pause=20 into the
# state file to force the pause. The run classified the injection as a defect,
# reverted it to the computed 200, and moved the key path three times underneath
# it (canary-notes.md:63-68). An override the run is free to repair is not an
# override. This file lives outside the state file and outside the audit's
# reach: references/pipeline.md's scope fence makes it READ-ONLY for every
# agent, and tools/audit-gate.sh refuses an audit finding that proposes changing
# or removing it as out-of-scope drift.
#
# SPEC_PROTOCOL_FIRST_PAUSE is the same override for a headless driver that
# cannot write into a project folder that does not exist yet. THE FILE WINS when
# both are present, and the emitted line always NAMES the source it used, so a
# run can never be paused by a number nobody can point at.
#
# FAIL LOUD. An override that exists and cannot be honoured is a TOOLING FAILURE
# (exit 2) — never an ignored file, never a pass. An operator whose override is
# silently dropped is in precisely the position this file exists to end.
# ABSENCE is not a failure: no file and no variable means no override, and the
# state file decides exactly as it did before.
#==============================================================================
OV_AWK="/usr/bin/awk"
if [[ ! -x "$OV_AWK" ]]; then OV_AWK="$(command -v awk 2>/dev/null || true)"; fi

OVERRIDE_REL="CONTROL/OPERATOR-OVERRIDE.json"
OVERRIDE_PAUSE=""    # the honoured first_pause, or "" for no override
OVERRIDE_SOURCE=""   # the path or the variable name the number came from
OVERRIDE_TAG=""      # override=first_pause:<n>(source=<...>), or ""

# override_parse <file> — a STRICT flat-object reader. Emits one
# `key<TAB>type<TAB>value` line per member and a final OVERRIDE-OK, or one
# OVERRIDE-ERROR line and rc 1. It is deliberately dependency-free (no jq, no
# node, no python): this runs on a client's machine before anything dispatches.
# Paths are the point — a regex over the text cannot tell a flat first_pause
# from one buried two levels down, which is the exact defect RC-3 records.
override_parse() {
  LC_ALL=C "$OV_AWK" '
    function ovfail(m) { printf("OVERRIDE-ERROR\t%s\n", m); exit 1 }
    function ws() { while (i <= n && substr(s,i,1) ~ /[ \t\r\n]/) i++ }
    function jstr(   out, c) {
      if (substr(s,i,1) != "\"") ovfail("expected a quoted key or string at byte " i)
      i++; out = ""
      while (i <= n) {
        c = substr(s,i,1)
        if (c == "\\") { out = out substr(s,i,2); i += 2; continue }
        if (c == "\"") { i++; return out }
        out = out c; i++
      }
      ovfail("unterminated string")
    }
    function jval(   c, st, t) {
      ws(); c = substr(s,i,1)
      if (c == "\"") { VT = "string"; VV = jstr(); return }
      if (c == "{" || c == "[") ovfail("a nested value is not allowed here: the override file is a FLAT object")
      st = i
      while (i <= n && index(",}", substr(s,i,1)) == 0 && substr(s,i,1) !~ /[ \t\r\n]/) i++
      t = substr(s, st, i - st)
      if (t ~ /^-?[0-9]+$/)            { VT = "int";    VV = t; return }
      if (t ~ /^-?[0-9]+\.[0-9]+$/)    { VT = "number"; VV = t; return }
      if (t == "true" || t == "false") { VT = "bool";   VV = t; return }
      if (t == "null")                 { VT = "null";   VV = t; return }
      ovfail("unparseable value: " t)
    }
    { s = s $0 "\n" }
    END {
      n = length(s); i = 1
      ws()
      if (substr(s,i,1) != "{") ovfail("the override file must be exactly one JSON object")
      i++; ws()
      if (substr(s,i,1) == "}") { i++ } else {
        while (1) {
          ws(); k = jstr()
          if (k in seen) ovfail("duplicate key: " k)
          seen[k] = 1
          ws(); if (substr(s,i,1) != ":") ovfail("expected : after key " k); i++
          jval()
          printf("%s\t%s\t%s\n", k, VT, VV)
          ws(); c = substr(s,i,1)
          if (c == ",") { i++; continue }
          if (c == "}") { i++; break }
          ovfail("expected , or } after key " k)
        }
      }
      ws()
      if (i <= n) ovfail("trailing content after the object")
      print "OVERRIDE-OK"
    }
  ' "$1"
}

# override_resolve <project-home> — sets OVERRIDE_PAUSE / OVERRIDE_SOURCE /
# OVERRIDE_TAG, or leaves all three empty when there is no override at all.
# It NEVER returns quietly on an override it could not honour: that path calls
# die_tool and the whole run exits 2.
override_resolve() {
  local home="$1" f="${1%/}/${OVERRIDE_REL}" out rc fp ty envv setby reason
  OVERRIDE_PAUSE=""; OVERRIDE_SOURCE=""; OVERRIDE_TAG=""
  [[ -n "$OV_AWK" && -x "$OV_AWK" ]] \
    || die_tool "no awk found (tried /usr/bin/awk then \$PATH) — ${f} cannot be read, so whether an operator override is in force is UNDETERMINED"

  # --- (1) THE FILE, read BEFORE CONTROL/project_state.json, and winning ----
  if [[ -e "$f" ]]; then
    [[ -f "$f" ]] || die_tool "${f} exists but is not a regular file — an operator override that cannot be read is never ignored"
    [[ -r "$f" ]] || die_tool "${f} is unreadable — an operator override that cannot be read is never ignored"
    set +e
    out="$(override_parse "$f" 2>&1)"; rc=$?
    set -e
    if (( rc != 0 )) || ! printf '%s\n' "$out" | "$GREP" -q '^OVERRIDE-OK$'; then
      die_tool "MALFORMED OPERATOR OVERRIDE at ${f}: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300). The contract is one FLAT JSON object, no nesting and no repeated key: {\"first_pause\": <int>, \"set_by\": \"...\", \"reason\": \"...\"}. A malformed override is never ignored and never a pass."
    fi
    ty="$(printf '%s\n' "$out" | LC_ALL=C "$OV_AWK" -F '\t' '$1 == "first_pause" { print $2; exit }')"
    fp="$(printf '%s\n' "$out" | LC_ALL=C "$OV_AWK" -F '\t' '$1 == "first_pause" { print $3; exit }')"
    [[ -n "$ty" ]] \
      || die_tool "MALFORMED OPERATOR OVERRIDE at ${f}: it carries no first_pause. first_pause is the only honoured key, so an override file without one overrides nothing — which is exactly the silent no-op this file exists to prevent. Remove the file or give it a first_pause."
    [[ "$ty" == "int" && "$fp" =~ ^[0-9]+$ ]] \
      || die_tool "MALFORMED OPERATOR OVERRIDE at ${f}: first_pause is '${fp}' (${ty}), which is not a non-negative integer"
    setby="$(printf '%s\n' "$out" | LC_ALL=C "$OV_AWK" -F '\t' '$1 == "set_by" { print $3; exit }')"
    reason="$(printf '%s\n' "$out" | LC_ALL=C "$OV_AWK" -F '\t' '$1 == "reason" { print $3; exit }')"
    OVERRIDE_PAUSE="$fp"
    OVERRIDE_SOURCE="$f"
    OVERRIDE_TAG="override=first_pause:${fp}(source=${f})"
    note "anchor.sh: OPERATOR OVERRIDE in force — first_pause=${fp} from ${f} (set_by=${setby:-unstated}; reason=${reason:-unstated}). It is read BEFORE ${home%/}/CONTROL/project_state.json and it wins; no agent may edit this file and no audit finding may propose removing it."
    if [[ -n "${SPEC_PROTOCOL_FIRST_PAUSE:-}" ]]; then
      note "anchor.sh: SPEC_PROTOCOL_FIRST_PAUSE=${SPEC_PROTOCOL_FIRST_PAUSE} is also set and is NOT used — the file wins when both are present, and the line above names the file as the source."
    fi
    return 0
  fi

  # --- (2) the environment variable, for a driver with nowhere to write -----
  envv="${SPEC_PROTOCOL_FIRST_PAUSE:-}"
  envv="${envv//[[:space:]]/}"
  [[ -n "$envv" ]] || return 0     # no file, no variable: no override. Not a failure.
  [[ "$envv" =~ ^[0-9]+$ ]] \
    || die_tool "MALFORMED OPERATOR OVERRIDE: SPEC_PROTOCOL_FIRST_PAUSE='${SPEC_PROTOCOL_FIRST_PAUSE:-}' is not a non-negative integer. A variable that is set and cannot be honoured is never ignored."
  OVERRIDE_PAUSE="$envv"
  OVERRIDE_SOURCE="env:SPEC_PROTOCOL_FIRST_PAUSE"
  OVERRIDE_TAG="override=first_pause:${envv}(source=env:SPEC_PROTOCOL_FIRST_PAUSE)"
  note "anchor.sh: OPERATOR OVERRIDE in force — first_pause=${envv} from the environment variable SPEC_PROTOCOL_FIRST_PAUSE (no ${f} on disk). Write the file once CONTROL/ exists; the file wins over the variable."
  return 0
}

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
  #
  #     The flag is a stop, not a grave. It holds out for exactly one thing —
  #     the blocker NAMED IN WRITING — and a fresh session can supply that as
  #     well as a person can. So the gate has two doors: with the named blocker
  #     on CONTROL/TODO.md the flag clears itself here and the run continues;
  #     without it, nothing dispatches, exactly as before.
  #
  #     The token is a CHECKLIST ROW whose first field is BLOCKER-NAMED:
  #       - [x] BLOCKER-NAMED | <the blocker, one line> | session=<this session>
  #     Anchored to the row start on purpose. An unanchored marker would match
  #     this script's own OPERATOR-ESCALATION item — the instruction to write
  #     the line would satisfy itself, and the stop would clear on the next
  #     tick without anyone naming anything.
  if [[ -f "$FLAG" ]]; then
    local BLOCKER="" brc=0
    if [[ -f "$TODO" ]]; then
      set +e
      BLOCKER="$("$GREP" -m1 -E '^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]*BLOCKER-NAMED[[:space:]]*\|[[:space:]]*[^|[:space:]]' "$TODO" 2>&1)"; brc=$?
      set -e
      if (( brc >= 2 )); then die_tool "grep rc=${brc} reading ${TODO} for the fresh-session blocker line: ${BLOCKER}"; fi
      (( brc == 0 )) || BLOCKER=""
    fi
    if [[ -n "$BLOCKER" ]]; then
      rm -f "$FLAG" || die_tool "the named blocker is on ${TODO} but ${FLAG} could not be removed"
      # Reset the counter and the ladder with it. Leaving them at the top rung
      # would re-fire the flag on the next tick and make the clear cosmetic.
      if [[ -f "$FPFILE" ]]; then
        local _fp _ba
        _fp="$(sed -n 's/^fp=//p' "$FPFILE" | head -1)"
        _ba="$(sed -n 's/^budget_advisory=//p' "$FPFILE" | head -1)"
        printf 'fp=%s\ncount=0\nsince=%s\nts=%s\nbudget_advisory=%s\nrecovery_rung=0\n' \
          "${_fp}" "$(iso_now)" "$(iso_now)" "${_ba:-0}" > "${FPFILE}.tmp.$$"
        mv "${FPFILE}.tmp.$$" "$FPFILE"
      fi
      ledger_write "CONTROL/LEDGER.md" "$(iso_now) | TERMINAL-DRIFT-CLEARED | cleared-by=fresh-session | unit=${UNIT} | blocker=$(sanitize "$BLOCKER") | flag=CONTROL/TERMINAL-DRIFT.flag removed | counter=reset | note=the blocker is named in CONTROL/TODO.md; dispatch may resume"
      printf 'TERMINAL-DRIFT-CLEARED | the blocker is named on %s | %s\n' "$TODO" "$(sanitize "$BLOCKER")"
      printf 'TERMINAL-DRIFT-CLEARED | flag removed, no-delta counter reset; dispatch may resume.\n'
    else
      printf 'TERMINAL-DRIFT | flag present: %s\n' "$FLAG"
      printf 'TERMINAL-DRIFT | nothing dispatches while this file exists. Name the blocker in %s as a row starting "- [x] BLOCKER-NAMED | <the blocker> | session=<this session>" and the next reconcile clears the flag itself; a person may also remove it by hand.\n' "$TODO"
      if [[ -r "$FLAG" ]]; then sed -n '1,24p' "$FLAG"; fi
      exit 4
    fi
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
  #     (ii) agents.executions_total against TWO lines. Reaching either is NOT
  #          drift: both are legitimate, declared events, and both exit 3 (so
  #          the conductor acts) rather than exit 4, which is reserved for the
  #          stall. The PAUSE line (agents.first_pause × blocks+1) emits
  #          pause-and-ask + set-run-status|PAUSED_CAP with the best stable
  #          build deployed; only the per-project CEILING (agents.ceiling,
  #          2,000) emits stop-dispatching + set-run-status|STOPPED_CAP.
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

  #--------------------------------------------------------------------------
  # THE RECOVERY LADDER's two inputs (references/anti-drift.md section 6).
  #--------------------------------------------------------------------------
  # inflight_units — every unit with a dispatch-log row and no RESULT line in
  # the ledger. This is the SAME definition references/resume.md step 4 uses
  # for what to TaskStop: workflow agents and subagents are not OS processes,
  # so the dispatch log paired against the ledger is the only census of what is
  # still in flight. An absent or unparseable dispatch log prints NOTHING —
  # never a fabricated zero — and the caller says which path it read.
  inflight_units() {
    [[ -f "$DL" ]] || return 0
    local dispatched
    dispatched="$("$AWK" '
      /^[[:space:]]*(- )?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
        u = ""
        if (match($0, /(^|[ \t|])unit=[^ \t|]+/)) {
          u = substr($0, RSTART, RLENGTH); sub(/^[^=]*=/, "", u)
        } else {
          n = split($0, f, "|")
          if (n >= 2) { u = f[2]; gsub(/^[ \t]+/, "", u); gsub(/[ \t]+$/, "", u) }
        }
        if (u != "" && !seen[u]++) print u
      }' "$DL")"
    [[ -n "$dispatched" ]] || return 0
    local resulted
    resulted="$(ledger.cmd "$LED" "$LEDGER_RESULT_RE" "$LEDGER_UNIT_RE")"
    comm -23 <(printf '%s\n' "$dispatched" | "$GREP" -v '^[[:space:]]*$' | LC_ALL=C sort -u) \
             <(printf '%s\n' "$resulted"   | "$GREP" -v '^[[:space:]]*$' | LC_ALL=C sort -u)
    return 0
  }

  # capacity_grace_holds — rc 0 when the LAST recorded state change is a
  # CAPACITY-EVENT and the grace has not run out. Two independent bounds, and
  # both must hold: the no-delta count under CAPACITY_N, and the wall-clock
  # window under ANCHOR_CAPACITY_GRACE_MIN. Sets CAPACITY_GRACE_NOTE either way
  # so the ledger line says WHY the grace did or did not apply — a grace that
  # cannot explain itself is indistinguishable from a broken counter.
  capacity_grace_holds() {  # capacity_grace_holds <no-delta-count> <window-min>
    local n="$1" win="$2" cap_ln="" after_state=0 rc
    # NOTE: every note below says "capacity event" in lowercase prose on
    # purpose. The uppercase marker must never appear in a line this script
    # writes to the ledger, or the next pass finds its own text.
    CAPACITY_GRACE_NOTE="grace=n/a(no capacity event recorded in ${LED})"
    [[ -f "$LED" ]] || { CAPACITY_GRACE_NOTE="grace=n/a(no ledger at ${LED})"; return 1; }
    set +e
    cap_ln="$("$GREP" -nE "$LEDGER_CAPACITY_RE" "$LED" 2>&1 | tail -n 1 | cut -d: -f1)"; rc=$?
    set -e
    if (( rc >= 2 )); then die_tool "grep rc=${rc} scanning ${LED} for capacity-event lines: ${cap_ln}"; fi
    [[ -n "$cap_ln" && "$cap_ln" =~ ^[0-9]+$ ]] || return 1
    # Anything state-carrying AFTER that line means the world moved on and the
    # capacity event is no longer the last thing that happened.
    tail -n "+$(( cap_ln + 1 ))" "$LED" > "$WORKDIR/after-capacity.txt" 2>/dev/null || : > "$WORKDIR/after-capacity.txt"
    set +e
    after_state="$(state_lines "$WORKDIR/after-capacity.txt" 2>/dev/null | "$GREP" -cvE "$SELF_AUTHORED_RE" 2>/dev/null)"
    set -e
    [[ "$after_state" =~ ^[0-9]+$ ]] || after_state=0
    if (( after_state > 0 )); then
      CAPACITY_GRACE_NOTE="grace=no(${after_state} state line(s) after the last capacity event)"
      return 1
    fi
    if (( win >= CAPACITY_GRACE_MIN )); then
      CAPACITY_GRACE_NOTE="grace=expired(window=${win}min >= ${CAPACITY_GRACE_MIN}min)"
      return 1
    fi
    if (( n >= CAPACITY_N )); then
      CAPACITY_GRACE_NOTE="grace=expired(no-delta=${n} >= N=${CAPACITY_N} at cadence ${CADENCE_MIN}min)"
      return 1
    fi
    CAPACITY_GRACE_NOTE="grace=holds(no-delta=${n}/N=${CAPACITY_N}, window=${win}min/${CAPACITY_GRACE_MIN}min, last state change was a capacity event at ${LED}:${cap_ln})"
    return 0
  }

  budget_audit() {  # sets BUDGET_NOTE; may alarm, act, and write BUDGET-CAP
    # THE OPERATOR OVERRIDE IS READ FIRST — before CONTROL/project_state.json,
    # and before the "no --state given" return below. Order is the point twice
    # over: the override WINS over agents.first_pause, and a malformed override
    # must exit 2 even on a run that would otherwise have claimed nothing about
    # the budget. An override nobody can point at is the defect, not the fix.
    override_resolve "$HOME_DIR"

    BUDGET_NOTE="budget-undetermined(no --state given)"
    [[ -n "$STATE" && -f "$STATE" ]] || return 0

    local flat="$WORKDIR/state.budget.flat"
    if ! tr -d '\n\r' < "$STATE" > "$flat" 2>/dev/null; then
      BUDGET_NOTE="budget-undetermined(state-unreadable:${STATE})"
      return 0
    fi

    local init rem exec_t warn_at cap_state pause_state ceil_state blocks
    init="$(jnum   "$flat" 'budget_initial'           || true)"
    rem="$(jnum    "$flat" 'session_budget_remaining' || true)"
    exec_t="$(jnum "$flat" 'executions_total'         || true)"
    warn_at="$(jnum "$flat" 'warn_at'                 || true)"
    cap_state="$(jnum "$flat" 'hard_stop_at'          || true)"
    pause_state="$(jnum "$flat" 'first_pause'          || true)"
    ceil_state="$(jnum  "$flat" 'ceiling'              || true)"
    blocks="$(jnum      "$flat" 'pause_blocks_granted' || true)"

    if [[ -z "$init" && -z "$rem" && -z "$exec_t" ]]; then
      BUDGET_NOTE="budget-undetermined(no-budget-fields)"
      note "anchor.sh: CLASS 6 UNDETERMINED — ${STATE} carries none of agents.budget_initial, agents.session_budget_remaining, agents.executions_total. Checked that file only; the dispatch log was NOT consulted, and no budget verdict is claimed."
      return 0
    fi

    # --- (ii) the two lines. Independent of the dispatch log; run first so a
    #     run that is over a line acts even when the census is undetermined.
    #
    #     TWO numbers, never one (operator decision 2026-09-07, finding G6):
    #
    #       CEIL  = agents.ceiling, else ANCHOR_CEILING (2,000 per PROJECT).
    #               The only hard stop. STOPPED_CAP lives here and nowhere else.
    #       PAUSE = agents.first_pause × (agents.pause_blocks_granted + 1),
    #               falling back to a legacy agents.hard_stop_at and then to
    #               ANCHOR_HARD_CAP (200). Each "keep going" the client gives
    #               increments pause_blocks_granted, so the line walks up by one
    #               block at a time and is clamped at CEIL.
    #
    #     The ceiling is tested FIRST. Order is the whole point: a run at 2,000
    #     is also past its pause line, and reporting that as a pause would leave
    #     a project able to answer "keep going" past the absolute ceiling. A run
    #     BELOW the ceiling is never STOPPED_CAP — it has budget left, so it
    #     pauses with its best build live and asks one question instead.
    #
    #     AND THE OPERATOR OVERRIDE OUTRANKS ALL THREE SOURCES OF THE PAUSE
    #     LINE. CONTROL/OPERATOR-OVERRIDE.json (or SPEC_PROTOCOL_FIRST_PAUSE)
    #     replaces agents.first_pause outright, and the line it produces names
    #     the source, so the override is never silent. It moves the PAUSE only:
    #     granted blocks still multiply it and CEIL still clamps it, because an
    #     operator moving the pause line has not moved the absolute ceiling.
    local CEIL="$CEILING" PAUSE WARN capnote=""
    if [[ -n "$ceil_state" ]] && (( ceil_state < CEIL )); then CEIL="$ceil_state"; fi
    if   [[ -n "$OVERRIDE_PAUSE" ]]; then PAUSE="$OVERRIDE_PAUSE"
    elif [[ -n "$pause_state" ]]; then PAUSE="$pause_state"
    elif [[ -n "$cap_state"   ]]; then PAUSE="$cap_state"
    else                               PAUSE="$HARD_CAP"; fi
    PAUSE=$(( PAUSE * ( ${blocks:-0} + 1 ) ))
    if (( PAUSE > CEIL )); then PAUSE="$CEIL"; fi
    WARN="${warn_at:-150}"
    if [[ -n "$exec_t" ]] && (( exec_t >= CEIL )); then
      local bts; bts="$(iso_now)"
      ledger_write "CONTROL/LEDGER.md" "${bts} | BUDGET-CAP | executions=${exec_t} | cap=${CEIL} | remaining=${rem:-undetermined} | unit=${UNIT} | required=run_status=STOPPED_CAP; stop dispatching; preserve the best stable build; produce the blocker report"
      action "stop-dispatching" "$UNIT" "absolute per-project ceiling reached: executions=${exec_t} >= ceiling=${CEIL}"
      action "set-run-status" "STOPPED_CAP" "executions=${exec_t} >= ceiling=${CEIL}; preserve the best stable build and produce the blocker report. The ceiling is a LIMIT REACHED stop, never a PASS and never drift, and it is never crossed without the operator."
      if (( SEVERITY < 3 )); then SEVERITY=3; fi
      capnote="budget-cap(executions=${exec_t}/ceiling=${CEIL})"
    elif [[ -n "$exec_t" ]] && (( exec_t >= PAUSE )); then
      local pts; pts="$(iso_now)"
      ledger_write "CONTROL/LEDGER.md" "${pts} | BUDGET-PAUSE | executions=${exec_t} | pause_at=${PAUSE} | ceiling=${CEIL} | remaining=${rem:-undetermined} | unit=${UNIT} | required=run_status=PAUSED_CAP; deploy the best stable build; write the plain report; ask 'Keep going?'"
      action "pause-and-ask" "$UNIT" "pause line reached: executions=${exec_t} >= pause_at=${PAUSE} (ceiling=${CEIL}). Deploy the best stable build, write the plain report, then ask the one question. Each 'keep going' increments agents.pause_blocks_granted and the run resumes at full width."
      action "set-run-status" "PAUSED_CAP" "executions=${exec_t} >= pause_at=${PAUSE}; ceiling=${CEIL} is not reached, so this is a PAUSE and the run has not stopped. The build is live and the run resumes on one word."
      if (( SEVERITY < 3 )); then SEVERITY=3; fi
      capnote="budget-pause(executions=${exec_t}/pause_at=${PAUSE}/ceiling=${CEIL})"
    elif [[ -n "$exec_t" ]] && (( exec_t >= WARN )); then
      if (( BUDGET_ADVISED == 0 )); then
        action "review-budget" "$UNIT" "advisory (emitted once): executions=${exec_t} crossed the review threshold ${WARN}; pause line ${PAUSE}; ceiling ${CEIL}"
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
      # THE NEAR-MISS PROBE, run BEFORE the undetermined verdict (RC-3).
      #
      # "Undetermined" is the right word for a state file we were never given.
      # It is the WRONG word for one that was written to a path no reader
      # reads: the canary run computed its budget correctly and wrote it to
      # agents.project_budget.{initial,warn,first_pause,ceiling}, and every
      # reconcile after that said "budget-undetermined" — so the writer's
      # defect read as our own missing input, and BUDGET-PAUSE never fired.
      #
      # The probe looks for the near-miss CONTAINER, not for a missing key,
      # and the distinction is the whole point: jnum matches a quoted key at
      # ANY nesting depth, so the nested first_pause above comes back as
      # PRESENT. A "first_pause is absent" test would therefore never fire on
      # the very file this branch exists for. An agents.project_budget or
      # agents.budget OBJECT is proof on its own that the five canonical flat
      # paths were not written, because the canonical schema has no such key
      # (references/documents.md "The budget block, in full").
      #
      # tools/state-check.sh is the instrument that decides this properly, on
      # paths rather than on text; the action names it rather than guessing.
      local nearkey=""
      nearkey="$(sed -n 's/.*"\(project_budget\)"[[:space:]]*:[[:space:]]*{.*/\1/p' "$flat" | head -1)"
      if [[ -z "$nearkey" ]]; then
        nearkey="$(sed -n 's/.*"\(budget\)"[[:space:]]*:[[:space:]]*{.*/\1/p' "$flat" | head -1)"
      fi
      if [[ -n "$nearkey" ]]; then
        # The evidence field is truncated at 160 characters by sanitize(), so
        # the instrument's name goes in it and the full explanation goes to
        # stderr, where the other UNDETERMINED explanations already live.
        action "run-state-check" "$UNIT" "tools/state-check.sh (exit 4 names it): WRITER DEFECT, not an absent state file — agents.${nearkey} sits where the canonical flat agents.* paths belong"
        note "anchor.sh: CLASS 6 WRITER DEFECT — ${STATE} carries an agents.${nearkey} OBJECT instead of the canonical flat paths agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted, agents.ceiling (SKILL.md section 6). The numbers were computed and written where no reader reads them, which is why the pause line could not be read. Run tools/state-check.sh <project> — it exits 4 and names the key — and rewrite the block at the canonical paths before the next dispatch."
        cmp="budget-writer-defect(agents.${nearkey})"
      else
        cmp="budget-undetermined(no-claimed-spend: budget_initial and/or session_budget_remaining absent from ${STATE})"
      fi
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

  #--------------------------------------------------------------------------
  # CLASS 7 — LEDGER PROVENANCE (the anti-drift contract, mechanically
  #     checked). Skips for IDLE units: an IDLE reconcile is a non-unit tick
  #     and claims nothing. Otherwise, the contract (SKILL.md "Atomic ledger
  #     writes"; references/anti-drift.md section 8): every unit carries a
  #     CLAIM line written BEFORE it (the claim) and a RESULT line written
  #     AFTER it (the result) — never only at the end. A CLAIM unit with no
  #     RESULT is incomplete-but-claimed; a RESULT unit with no CLAIM is the
  #     run working on something nobody wrote down, which is the ledger
  #     failing as the single source of truth. A unit that never got either
  #     line is not yet dispatched and is not drift. An ABSENT ledger is
  #     undetermined, never clean — an absent ledger cannot prove its own
  #     provenance. Pairing is by exact unit id, so a cross-typod pair is
  #     caught rather than blessed.
  #--------------------------------------------------------------------------
  if [[ "$MODE" == "reconcile" && "$UNIT" != "IDLE" ]]; then
    if [[ ! -f "$LED" ]]; then
      CLAIM_NOTE="ledger-undetermined(LEDGER.md absent)"
      note "anchor.sh: CLASS 7 UNDETERMINED — ${LED} does not exist. No ledger provenance claim is made."
    else
      local claim_units result_units unclaimed n_claim
      n_claim=0
      claim_units="$(ledger.cmd "$LED" "$LEDGER_CLAIM_RE" "$LEDGER_UNIT_RE")"
      result_units="$(ledger.cmd "$LED" "$LEDGER_RESULT_RE" "$LEDGER_UNIT_RE")"
      unclaimed="$(comm -13 <(printf '%s\n' "$claim_units" | LC_ALL=C sort -u) \
                            <(printf '%s\n' "$result_units" | LC_ALL=C sort -u))"
      if [[ -n "$unclaimed" ]]; then
        n_claim="$(printf '%s\n' "$unclaimed" | "$GREP" -c '[^[:space:]]' || true)"
      fi
      if (( n_claim > CLAIM_TOL )); then
        alarm "unpaired-claim" "RESULT without a prior CLAIM for ${n_claim} unit(s): $(printf '%s\n' "$unclaimed" | head -c 240) — every action must reference a ledger line written BEFORE the unit (the claim) and AFTER it (the result), never only at the end (the anti-drift contract)"
        action "write-missing-claims" "${UNIT}" "RESULT lines exist without their BEFORE-the-unit CLAIM lines (tolerance ${CLAIM_TOL}); write each missing claim into CONTROL/LEDGER.md and re-run anchor.sh"
        CLAIM_NOTE="unpaired-claim(${n_claim} of $(printf '%s\n' "$result_units" | "$GREP" -c '[^[:space:]]' || true) RESULT units / tol=${CLAIM_TOL})"
      else
        CLAIM_NOTE="ledger-ok(claimed=$(printf '%s\n' "$claim_units" | "$GREP" -c '[^[:space:]]' || true)/resulted=$(printf '%s\n' "$result_units" | "$GREP" -c '[^[:space:]]' || true)/unpaired=${n_claim}/tol=${CLAIM_TOL})"
      fi
    fi
  fi

  #--------------------------------------------------------------------------
  # CLASS 8 — CAN THIS LEDGER BE TIME-ORDERED AT ALL? (RC-18.)
  #     Its own gate: the ledger itself, and it runs for IDLE units too — a
  #     ledger nobody can order in time is a defect of the FILE, not of the
  #     unit being reconciled.
  #
  #     Every RECORD line must open with an ISO8601Z timestamp. Until
  #     tools/ledger.sh became the writer of record there was nothing anywhere
  #     that required one: ledger.sh appended the caller's string verbatim, so
  #     a caller that supplied no clock produced a clockless line and no
  #     reader complained. One real project ledger reached 30 lines carrying
  #     exactly ONE timestamp (its GATE0 line) while the control project, same
  #     instrument and same day, carried 254. Nothing in this script noticed:
  #     the only timestamp it ever read was the LAST RE-ANCHOR/RECONCILE line,
  #     for the staleness field below, which reports
  #     `undetermined(no-timestamp-field)` in a DISPLAY field and alarms on
  #     nothing.
  #
  #     THIS IS A DETECTION AND NEVER A REPAIR. Not one line is rewritten,
  #     back-dated, re-ordered or removed here, and no future version of this
  #     class may do so: rewriting a ledger's history is precisely the thing a
  #     ledger must never do, and a back-dated line is a worse artifact than a
  #     clockless one because it looks trustworthy. A run that finds old
  #     unstamped lines REPORTS them and leaves them standing.
  #
  #     The counter is ledger_stamp_census (top of this file), which mirrors
  #     tools/ledger.sh's own LEDGER_STRUCT_RE exactly, so the writer and this
  #     reader agree by construction: every line ledger.sh stamps is a line
  #     this counts, and every line ledger.sh leaves alone (a checklist row, a
  #     heading, a table row, a rule, a blockquote, a blank) is a line this
  #     skips. Contentless ticks are already excluded upstream by state_lines.
  #
  #     FAIL-CLOSED like every other class here: an absent ledger, or a census
  #     that could not run, is UNDETERMINED and says which path it checked. It
  #     is never a silent zero and never a pass.
  #--------------------------------------------------------------------------
  STAMP_NOTE=""
  if [[ "$MODE" == "reconcile" ]]; then
    if [[ ! -f "$LED" ]]; then
      STAMP_NOTE="ledger-stamp-undetermined(LEDGER.md absent)"
      note "anchor.sh: CLASS 8 UNDETERMINED — ${LED} does not exist. An absent ledger is not a proven zero, so no ledger-unstamped verdict is made."
    else
      local _sc _src _n_rec _n_ok _n_un _n_st
      set +e
      _sc="$(ledger_stamp_census "$LED")"
      _src=$?
      set -e
      if (( _src != 0 )) || [[ -z "$_sc" ]]; then
        STAMP_NOTE="ledger-stamp-undetermined(census-unavailable: awk=${AWK:-none})"
        note "anchor.sh: CLASS 8 UNDETERMINED — the stamp census could not read ${LED} (awk=${AWK:-none}, rc=${_src}). This is NOT reported as zero unstamped lines."
      else
        _n_rec="$(printf '%s' "$_sc" | cut -d' ' -f1)"
        _n_ok="$(printf '%s' "$_sc" | cut -d' ' -f2)"
        _n_un="$(printf '%s' "$_sc" | cut -d' ' -f3)"
        _n_st="$(printf '%s' "$_sc" | cut -d' ' -f4)"
        if (( _n_un > 0 )); then
          STAMP_NOTE="ledger-unstamped(n=${_n_un})"
          alarm "ledger-unstamped(n=${_n_un})" "n=${_n_un} record line(s) carry no ISO8601Z prefix (records=${_n_rec} stamped=${_n_ok} structure=${_n_st}); this ledger cannot be time-ordered. DETECTION ONLY: no line is rewritten, back-dated or removed. Fix the WRITER, never the file. Ledger: ${LED}"
          action "route-writes-through-ledger.sh" "${UNIT}" "${_n_un} of ${_n_rec} record line(s) in ${LED} open with no ISO8601Z. Find what wrote them and route it through tools/ledger.sh, which supplies the clock and the writer=ledger.sh signature. Do NOT edit the ledger."
          note "anchor.sh: CLASS 8 — ${_n_un} of ${_n_rec} record line(s) in ${LED} open with no ISO8601Z timestamp (stamped=${_n_ok}, markdown structure skipped=${_n_st}). This ledger cannot be placed in time by anything, so the staleness field, the plateau curve and every after-the-fact audit read it as guesswork. tools/ledger.sh is now the writer of record: it prefixes the clock to any record line that arrives without one and appends ' | writer=ledger.sh', so a line still missing both was written by something that did not go through it, or predates it. THE FIX IS THE WRITER, NOT THE FILE: nothing in this script rewrites, back-dates, re-orders or deletes a ledger line, and nothing in it ever may."
        else
          STAMP_NOTE="ledger-stamped(records=${_n_rec}/unstamped=0/structure=${_n_st})"
        fi
      fi
    fi
  fi

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
  # (7) THE EIGHT DETECTION CLASSES (reconcile mode)
  #     Classes 1-4 need --tasks AND --state. Class 5 needs --intents (below,
  #     with the fingerprint). CLASS 6 (budget) needs --state only, so it runs
  #     on its own gate — a run that cannot supply a task snapshot can still be
  #     audited against its own spend. CLASS 7 (ledger provenance — the
  #     anti-drift contract's claim-before/result-after pairing) needs the
  #     ledger only, so it runs on its own gate below even when --tasks and
  #     --state are absent; it skips for IDLE units. CLASS 8 (ledger-unstamped
  #     — whether the file can be time-ordered at all) needs the ledger only
  #     too, and unlike class 7 it runs for IDLE units as well: a clockless
  #     ledger is a defect of the FILE, not of the unit.
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
    # The operator override goes on the RECONCILE line whenever one is in
    # force, whatever the budget branch decided — including the undetermined
    # ones. A pause line moved by an override that the ledger does not record
    # is a number nobody can account for later, which is the whole failure this
    # override was built to end.
    if [[ -n "$OVERRIDE_TAG" ]]; then CLASSES="${CLASSES},${OVERRIDE_TAG}"; fi

    # CLASS 7 — the ledger provenance check. Its own gate: the ledger itself.
    if [[ -n "${CLAIM_NOTE:-}" ]]; then
      CLASSES="${CLASSES},${CLAIM_NOTE}"
    fi

    # CLASS 8 — can this ledger be time-ordered? Emitted exactly as the budget
    # classes are, unconditionally, so the five-minute tick REPORTS it: a
    # verdict that only appears when it is bad is a verdict nobody trusts when
    # it is good. The undetermined forms ride here too, for the same reason
    # budget-undetermined does.
    if [[ -n "${STAMP_NOTE:-}" ]]; then
      CLASSES="${CLASSES},${STAMP_NOTE}"
    fi
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

    local PREV_FP="" PREV_N=0 PREV_SINCE="" PREV_RUNG=0
    if [[ -f "$FPFILE" ]]; then
      PREV_FP="$(sed -n 's/^fp=//p' "$FPFILE" | head -1)"
      PREV_N="$(sed -n 's/^count=//p' "$FPFILE" | head -1)"
      PREV_SINCE="$(sed -n 's/^since=//p' "$FPFILE" | head -1)"
      PREV_RUNG="$(sed -n 's/^recovery_rung=//p' "$FPFILE" | head -1)"
      [[ -n "$PREV_N" ]] || PREV_N=0
      [[ "$PREV_RUNG" =~ ^[0-9]+$ ]] || PREV_RUNG=0
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

    # The ladder's own state. It rides in CONTROL/.anchor-fingerprint, the file
    # this script already owns, and it is RESET the moment real state moves —
    # a run that started progressing again must start the ladder from the
    # bottom, never resume mid-climb toward a stop it has left behind.
    local RUNG="$PREV_RUNG"
    if (( NEWN == 0 )); then RUNG=0; fi
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

    #------------------------------------------------------------------------
    # THE RECOVERY LADDER, then the flag (references/anti-drift.md section 6).
    #
    # The old behaviour was one rung: count to N, write a file only a human
    # removes. For a client asleep at 3 a.m. that turned a thirty-minute
    # provider outage into a permanent stop, which is the opposite of "runs
    # until done". The stop stays — it is what makes the machinery
    # capture-proof — but it is now the LAST thing tried, not the first.
    # One rung per reconcile, each one a thing the run can do for itself:
    #
    #   rung 1  re-dispatch every in-flight unit from its last checkpoint
    #   rung 2  hold, without counting toward drift, while a CAPACITY-EVENT is
    #           the last recorded state change (up to two hours)
    #   rung 3  switch the affected seats to their named fallback
    #   rung 4  the flag
    #
    # The rungs are recorded through ledger.sh as RECOVERY-LADDER lines, which
    # are excluded from the fingerprint like every other line this script
    # authors, so climbing the ladder can never look like progress.
    #------------------------------------------------------------------------
    CAPACITY_GRACE_NOTE="grace=not-evaluated"
    if (( NEWN >= TERMINAL_N )); then
      local ts; ts="$(iso_now)"
      if (( RUNG < 1 )); then
        # --- RUNG 1: TaskStop and re-fire what is in flight.
        local inf n_inf=0 u shown=0 dl_note
        if [[ -f "$DL" ]]; then dl_note="${DL}"; else dl_note="${DL} (absent — no in-flight census was possible)"; fi
        inf="$(inflight_units)"
        if [[ -n "$inf" ]]; then
          set +e
          n_inf="$(printf '%s\n' "$inf" | "$GREP" -c '[^[:space:]]')"
          set -e
          [[ "$n_inf" =~ ^[0-9]+$ ]] || n_inf=0
        fi
        if (( n_inf > 0 )); then
          while IFS= read -r u; do
            [[ -n "$u" ]] || continue
            shown=$(( shown + 1 ))
            if (( shown > 20 )); then break; fi
            action "redispatch-from-checkpoint" "$u" "in flight: a row in ${DL} with no RESULT line in ${LED}. TaskStop it, then re-dispatch it from its last checkpoint. This is rung 1 of the recovery ladder — it runs BEFORE any escalation."
          done <<< "$inf"
          if (( n_inf > shown )); then
            action "redispatch-from-checkpoint" "+$(( n_inf - shown )) more" "the in-flight list was truncated at ${shown} ACTION lines; the full census is ${DL} rows with no RESULT line in ${LED}"
          fi
        else
          action "redispatch-from-checkpoint" "$UNIT" "no dispatch row is missing its RESULT line (census read: ${dl_note}). Re-dispatch the current unit from its last checkpoint anyway — rung 1 runs before any escalation."
        fi
        ledger_write "CONTROL/LEDGER.md" "${ts} | RECOVERY-LADDER | rung=1/4 | action=redispatch-from-checkpoint | in-flight=${n_inf} | no-delta-reconciles=${NEWN} | window=${WINDOW_MIN}min | fp=${FP} | unit=${UNIT} | next-rung=capacity-grace-then-fallback-seats-then-flag"
        RUNG=1
        if (( SEVERITY < 3 )); then SEVERITY=3; fi
      elif capacity_grace_holds "$NEWN" "$WINDOW_MIN"; then
        # --- RUNG 2: the capacity grace. NOT drift, on purpose — the counter
        #     keeps climbing (observation is still not progress) but it does
        #     not mean anything until the grace runs out, by count or by clock.
        #     Severity is deliberately left alone: a provider outage is not a
        #     captured conductor, and calling it one trains the operator to
        #     ignore the alarm that matters.
        action "wait-for-capacity" "$UNIT" "recovery ladder rung 2: ${CAPACITY_GRACE_NOTE}. Back off and re-check on the next tick; the fallback table in references/capacity.md is rung 3 when the grace runs out."
        ledger_write "CONTROL/LEDGER.md" "${ts} | RECOVERY-LADDER | rung=2/4 | action=capacity-grace | ${CAPACITY_GRACE_NOTE} | no-delta-reconciles=${NEWN} | window=${WINDOW_MIN}min | fp=${FP} | unit=${UNIT} | note=a capacity event is the world moving, not a captured run; it does not count toward drift inside the grace"
        RUNG=2
      elif (( RUNG < 3 )); then
        # --- RUNG 3: the named fallback seats.
        action "switch-to-fallback-seats" "$UNIT" "recovery ladder rung 3: re-dispatching from checkpoint did not move the state (${CAPACITY_GRACE_NOTE}). Move the affected seats to their named fallback (references/capacity.md fallback table, Loop 8 throttle order) and re-dispatch there before any escalation."
        ledger_write "CONTROL/LEDGER.md" "${ts} | RECOVERY-LADDER | rung=3/4 | action=switch-to-fallback-seats | ${CAPACITY_GRACE_NOTE} | no-delta-reconciles=${NEWN} | window=${WINDOW_MIN}min | fp=${FP} | unit=${UNIT} | next-rung=flag"
        RUNG=3
        if (( SEVERITY < 3 )); then SEVERITY=3; fi
      else
        # --- RUNG 4: the flag. Every rung below it has been climbed and the
        #     state still has not moved.
        local CAPEV=0
        CAPEV="$(g_count "$LEDGER_CAPACITY_RE" "$LED")"
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
          printf 'capacity-events-in-ledger=%s\n' "$CAPEV"
          printf 'recovery-ladder=rung 1 redispatch-from-checkpoint CLIMBED; rung 2 capacity-grace %s; rung 3 switch-to-fallback-seats CLIMBED; rung 4 this flag\n' "$CAPACITY_GRACE_NOTE"
          printf 'REQUIRED: set run_status=STOPPED_STALL, stop dispatching, produce the\n'
          printf 'diagnose-the-blocker report (what was in flight, what each of the three\n'
          printf 'layers claims, where they disagree, the last real state change, and the\n'
          printf 'capacity events above), then write the blocker into CONTROL/TODO.md as a\n'
          printf 'row of exactly this shape:\n'
          printf '  - [x] BLOCKER-NAMED | <the blocker, one line> | session=<this session>\n'
          printf 'The next reconcile clears this flag itself once that row exists — a fresh\n'
          printf 'session can do it, a person can do it, and a person may also just delete\n'
          printf 'this file. Nothing dispatches while it exists.\n'
        } > "$FLAG"
        ledger_write "CONTROL/LEDGER.md" "${ts} | TERMINAL-DRIFT | no-delta-reconciles=${NEWN} | window=${WINDOW_MIN}min | fp=${FP} | unit=${UNIT} | tasks=${TASKSTR} | counts=${COUNTS} | ladder=rungs 1-3 climbed | capacity-events=${CAPEV} | flag=CONTROL/TERMINAL-DRIFT.flag"
        ledger_write "CONTROL/TODO.md" "- [ ] OPERATOR-ESCALATION | TERMINAL-DRIFT after ${NEWN} no-delta reconciles (${WINDOW_MIN} min) | unit=${UNIT} | the recovery ladder was climbed first (re-dispatch, capacity grace, fallback seats) | name the blocker here in the row shape CONTROL/TERMINAL-DRIFT.flag prints, and the next reconcile clears the flag itself"
        printf 'ACTION|stop-dispatching|%s|TERMINAL-DRIFT after %s no-delta reconciles (%s min); the recovery ladder was climbed first\n' "$UNIT" "$NEWN" "$WINDOW_MIN"
        printf 'ACTION|escalate-to-operator|%s|CONTROL/TERMINAL-DRIFT.flag created; run_status=STOPPED_STALL; name the blocker in CONTROL/TODO.md and the next reconcile clears the flag itself\n' "$UNIT"
        RUNG=4
        SEVERITY=4
      fi
    fi

    # The fingerprint file is written LAST, so it carries the rung this pass
    # actually reached rather than the one it intended to reach.
    printf 'fp=%s\ncount=%s\nsince=%s\nts=%s\nbudget_advisory=%s\nrecovery_rung=%s\n' \
      "$FP" "$NEWN" "$SINCE" "$(iso_now)" "$BUDGET_ADVISED" "$RUNG" > "${FPFILE}.tmp.$$"
    mv "${FPFILE}.tmp.$$" "$FPFILE"
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
    LINE="${ts} | RECONCILE | anchor=${ANCHOR} | unit=${UNIT} | result=${result} | tasks=${TASKSTR} | counts=${COUNTS} | classes=${CLASSES} | ledger=${CLAIM_NOTE:-skipped(unit=IDLE)} | intents=${INTENT_VERDICT:-n/a} | ticks=${TICKS} | stateful-heartbeats=${TICKS_FULL} | fp=${FP} | nodelta=${NODELTA} | rung=${RUNG:-0}/4 | age=${STALENESS} | next=${NEXT}"
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
CAPACITY_GRACE_NOTE="grace=not-evaluated"
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
# SELFTEST — the cases enumerated below, in a temp home. The count printed by
# the SELFTEST COMPLETE line is the authoritative one; do not restate it here.
# It proves the detector still
# DISCRIMINATES: every case asserts both what must fire and what must not.
#
#   1-7   the original drift cases (clean, unit-not-in-plan, missing file,
#         sabotaged fixture + the real-corpus check, false-complete,
#         terminal-drift, repeated-intent with its negative control)
#   8     CAPACITY-EVENT lines are EXCLUDED from the state-delta fingerprint
#         (positive: only capacity events => the no-delta counter still
#         climbs; negative control: a real state line still resets it)
#   9-12  CLASS 6 BUDGET AUDIT, the first four controls: agree (must NOT fire),
#         diverge past tolerance (MUST fire), the FIRST PAUSE (MUST emit
#         BUDGET-PAUSE, pause-and-ask and PAUSED_CAP at exit 3, not 4, and MUST
#         NOT emit STOPPED_CAP), fields absent (MUST report undetermined and
#         MUST NOT alarm)
#   15    CLASS 6 BUDGET AUDIT, the per-project CEILING at 2,000 (MUST emit
#         BUDGET-CAP and STOPPED_CAP, and MUST NOT pause — the ceiling is
#         tested before the pause line so granted blocks cannot launder it)
#   13    CLASS 6 BUDGET AUDIT, negative claimed spend (MUST alarm as
#         budget-negative-spend — never laundered into budget-ok by the
#         tolerance, never downgraded to budget-undetermined by an absent
#         dispatch log)
#   14    CLASS 7 LEDGER PROVENANCE — RESULT without a prior CLAIM MUST alarm
#         (unpaired-claim, exit 3), a CLAIM+RESULT pair MUST NOT, and the
#         pair's RECONCILE line carries ledger=ledger-ok(...)
#   15    THE RECOVERY LADDER, rung 2 — six no-delta reconciles whose last
#         recorded state change is a capacity event do NOT write the flag
#         inside two hours (case 6 is the negative control: the same fixtures
#         with no capacity event reach the flag on the third crossing), and a
#         real state line after the capacity event ends the grace
#   16    THE FRESH-SESSION CLEAR — the flag holds while nothing is named
#         (including against this script's own escalation line), and clears
#         itself once the BLOCKER-NAMED row is on CONTROL/TODO.md
#   19    CLASS 6 BUDGET AUDIT, THE OPERATOR OVERRIDE — the file at
#         first_pause=20 beats a state file that says 200 (BUDGET-PAUSE fires
#         and the RECONCILE line carries override=first_pause:20(source=…));
#         the SAME fixture with no override does NOT pause and carries no
#         override= token; the variable alone does the same job and names
#         itself as the source; the file wins over a disagreeing variable; and
#         a malformed override file is exit 2, never rc 0
#   18    CLASS 6 BUDGET AUDIT, the WRITER DEFECT — a state file carrying
#         agents.project_budget.first_pause and no canonical flat path MUST
#         report budget-writer-defect(agents.project_budget) and raise
#         ACTION|run-state-check naming tools/state-check.sh, never
#         budget-undetermined; the control fixture with the canonical keys
#         MUST still report budget-ok (the probe discriminates)
#   20    CLASS 8 LEDGER-UNSTAMPED — a legacy ledger holding the three
#         clockless shapes the canary photographed MUST raise DRIFT-ALARM |
#         ledger-unstamped(n=3) at exit 3 and name n=3 (3, not 5: a heading
#         and a contentless tick are not records); the same shape fully
#         stamped MUST NOT alarm and MUST report unstamped=0; the reconcile
#         MUST REPAIR NOTHING (sha256 of the fixture's own lines identical
#         before and after); and a SECOND reconcile MUST still say n=3, which
#         is what rules out a quiet backfill behind the alarm
#==============================================================================
selftest() {
  local T PASSES=0 FAILS=0
  SELFTEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/anchor-selftest.XXXXXX")"
  T="$SELFTEST_TMP"

  # The override variable is cleared before the first fixture and set only by
  # the legs that mean to set it. A selftest that inherits an operator's own
  # SPEC_PROTOCOL_FIRST_PAUSE would report a pause it never proved.
  unset SPEC_PROTOCOL_FIRST_PAUSE

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
  # The corpus is named by the environment or it is not run: there is NO default
  # path. A path baked in here would point at one operator's machine, and an
  # absent file there would masquerade as a clean corpus check.
  local CORPUS="${ANCHOR_SELFTEST_REAL_LEDGER:-}"
  local corpus_note="ANCHOR_SELFTEST_REAL_LEDGER unset — corpus check SKIPPED, not passed"
  if [[ -n "$CORPUS" && ! -f "$CORPUS" ]]; then
    corpus_note="ANCHOR_SELFTEST_REAL_LEDGER names a path that does not exist (${CORPUS}) — corpus check SKIPPED, not passed"
  fi
  if [[ -n "$CORPUS" && -f "$CORPUS" ]]; then
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

  # --- case 6: TERMINAL-DRIFT with the counter primed to N-1 — and the
  #     RECOVERY LADDER that now runs before it, IN ORDER. The flag is the
  #     LAST rung, never the first: crossing N emits
  #     ACTION|redispatch-from-checkpoint (rung 1), the next no-delta pass
  #     emits ACTION|switch-to-fallback-seats (rung 3 — rung 2, the capacity
  #     grace, does not apply here because this ledger carries no
  #     CAPACITY-EVENT), and only the pass after that writes the flag. Each
  #     rung asserts BOTH what fired and that the flag did NOT yet exist, so a
  #     ladder that silently collapsed back into "flag immediately" fails here.
  mk_home "$T/c6"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c6/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c6/CONTROL/project_state.json"
  # two dispatched units, neither carrying a RESULT line: the in-flight census
  # rung 1 reads. (Written literally — mk_dispatch_log is defined further down,
  # with case 9, and a function is not defined until its definition is reached.)
  {
    printf '# Dispatch log\n\n'
    printf '2026-08-12T01:01:00Z | U-001 | build | builder-1 | run-000001\n'
    printf '2026-08-12T02:02:00Z | U-002 | build | builder-2 | run-000002\n'
  } > "$T/c6/CONTROL/dispatch-log.md"
  local c6args=( "$T/c6" "U-02" --mode reconcile --tasks "$T/c6/CONTROL/task-graph-snapshot.json" --state "$T/c6/CONTROL/project_state.json" )
  runa "${c6args[@]}"
  local primed=$(( TERMINAL_N - 1 ))
  sed -e "s/^count=.*/count=${primed}/" "$T/c6/CONTROL/.anchor-fingerprint" > "$T/c6/CONTROL/.anchor-fingerprint.new"
  mv "$T/c6/CONTROL/.anchor-fingerprint.new" "$T/c6/CONTROL/.anchor-fingerprint"

  runa "${c6args[@]}"                     # crossing N -> rung 1
  local rc_r1="$RC" ok_r1=0
  if (( RC == 3 )) && [[ ! -f "$T/c6/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|redispatch-from-checkpoint|U-001|' \
     && "$GREP" -qE '\| RECOVERY-LADDER \| rung=1/4 \| action=redispatch-from-checkpoint \| in-flight=2 \|' "$T/c6/CONTROL/LEDGER.md" 2>/dev/null; then ok_r1=1; fi

  runa "${c6args[@]}"                     # still nothing moved -> rung 3
  local rc_r3="$RC" ok_r3=0
  if (( RC == 3 )) && [[ ! -f "$T/c6/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|switch-to-fallback-seats|U-02|' \
     && "$GREP" -qE '\| RECOVERY-LADDER \| rung=3/4 \| action=switch-to-fallback-seats \|' "$T/c6/CONTROL/LEDGER.md" 2>/dev/null; then ok_r3=1; fi

  runa "${c6args[@]}"                     # the ladder is exhausted -> the flag
  ok=0
  if (( RC == 4 )) && (( ok_r1 == 1 )) && (( ok_r3 == 1 )) \
     && [[ -f "$T/c6/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && "$GREP" -qE '\| TERMINAL-DRIFT \| no-delta-reconciles=' "$T/c6/CONTROL/LEDGER.md" 2>/dev/null \
     && "$GREP" -q 'OPERATOR-ESCALATION' "$T/c6/CONTROL/TODO.md" 2>/dev/null \
     && "$GREP" -q 'recovery-ladder=rung 1 redispatch-from-checkpoint CLIMBED' "$T/c6/CONTROL/TERMINAL-DRIFT.flag" 2>/dev/null; then ok=1; fi
  report 6 "terminal-drift-after-the-ladder" "$ok" "rung 1 rc=${rc_r1} (want 3, no flag, ACTION|redispatch-from-checkpoint for the 2 in-flight dispatch rows); rung 3 rc=${rc_r3} (want 3, no flag, ACTION|switch-to-fallback-seats); rung 4 rc=${RC} (want 4); flag created only on the third crossing and it records the ladder it climbed; escalation in LEDGER.md and TODO.md"

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
  # mk_state_budget <home> <initial> <remaining> <executions> [first_pause] [ceiling] [blocks]
  # The three optional fields default to the doctrine's numbers: a 200 first
  # pause, the 2,000 per-project ceiling, and no granted blocks.
  mk_state_budget() {
    printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","agents":{"executions_total":%s,"budget_initial":%s,"session_budget_remaining":%s,"warn_at":150,"first_pause":%s,"ceiling":%s,"pause_blocks_granted":%s},"workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' \
      "$4" "$2" "$3" "${5:-200}" "${6:-2000}" "${7:-0}" > "$1/CONTROL/project_state.json"
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
  # --- CLASS 6, control C (case 11): the FIRST PAUSE. executions_total has
  #     reached agents.first_pause exactly, and the per-project ceiling (2,000)
  #     is nowhere near. The decided behaviour (finding G6, 2026-09-07) is
  #     PAUSE AND ASK — deploy the best stable build, write the plain report,
  #     set run_status=PAUSED_CAP, ask "Keep going?" — so the case asserts
  #     ACTION|pause-and-ask and, as the negative control that matters most,
  #     that STOPPED_CAP is NOT emitted: a run with ceiling left has not
  #     stopped, and reporting it as stopped is the failure this replaced.
  #     Exit is 3 (the conductor must act), never 4 (the stall), and no
  #     DRIFT-ALARM: a declared pause is not a defect. Claimed and dispatched
  #     AGREE here so the case can only be firing on the pause line.
  #--------------------------------------------------------------------------
  mk_home "$T/c11"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c11/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c11" 1000 800 200 200 2000 0
  mk_dispatch_log "$T/c11" 200
  runa "$T/c11" "U-02" --mode reconcile --tasks "$T/c11/CONTROL/task-graph-snapshot.json" --state "$T/c11/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) \
     && "$GREP" -qE '\| BUDGET-PAUSE \| executions=200 \| pause_at=200 \| ceiling=2000 \|' "$T/c11/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|pause-and-ask|U-02|pause line reached' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|set-run-status|PAUSED_CAP|' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'STOPPED_CAP' \
     && ! "$GREP" -qE '\| BUDGET-CAP \|' "$T/c11/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE 'DRIFT-ALARM \| budget-mismatch' "$T/c11/CONTROL/LEDGER.md" 2>/dev/null \
     && [[ ! -f "$T/c11/CONTROL/TERMINAL-DRIFT.flag" ]]; then ok=1; fi
  report 11 "budget-first-pause" "$ok" "rc=${RC} (want 3, NOT 4); BUDGET-PAUSE | executions=200 | pause_at=200 | ceiling=2000 written through ledger.sh; ACTION|pause-and-ask and ACTION|set-run-status|PAUSED_CAP emitted; STOPPED_CAP and BUDGET-CAP both ABSENT (the negative control: a run under the ceiling never stops); no budget-mismatch; no TERMINAL-DRIFT.flag"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control C2 (case 15): the CEILING. 2,000 executions per
  #     project is the one hard stop, and it is tested BEFORE the pause line
  #     on purpose: a run at 2,000 is also past its pause line, and calling
  #     that a pause would let a project answer "keep going" past the absolute
  #     ceiling. The granted blocks are deliberately generous here (9 blocks ×
  #     200 = 1,800 < 2,000) so the case proves the ORDER, not an accident of
  #     arithmetic. Claimed and dispatched AGREE so nothing else can fire.
  #--------------------------------------------------------------------------
  mk_home "$T/c15"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c15/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c15" 3000 1000 2000 200 2000 9
  mk_dispatch_log "$T/c15" 2000
  runa "$T/c15" "U-02" --mode reconcile --tasks "$T/c15/CONTROL/task-graph-snapshot.json" --state "$T/c15/CONTROL/project_state.json"
  ok=0
  if (( RC == 3 )) \
     && "$GREP" -qE '\| BUDGET-CAP \| executions=2000 \| cap=2000 \|' "$T/c15/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|stop-dispatching|U-02|absolute per-project ceiling reached' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|set-run-status|STOPPED_CAP|' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'PAUSED_CAP' \
     && ! "$GREP" -qE '\| BUDGET-PAUSE \|' "$T/c15/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE 'DRIFT-ALARM \| budget-mismatch' "$T/c15/CONTROL/LEDGER.md" 2>/dev/null \
     && [[ ! -f "$T/c15/CONTROL/TERMINAL-DRIFT.flag" ]]; then ok=1; fi
  report 15 "budget-ceiling" "$ok" "rc=${RC} (want 3, NOT 4); BUDGET-CAP | executions=2000 | cap=2000 written through ledger.sh; ACTION|stop-dispatching and ACTION|set-run-status|STOPPED_CAP emitted; PAUSED_CAP and BUDGET-PAUSE both ABSENT (the ceiling is tested first, so nine granted blocks cannot launder it into a pause); no budget-mismatch; no TERMINAL-DRIFT.flag"

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

  #--------------------------------------------------------------------------
  # --- CLASS 7 (case 14): LEDGER PROVENANCE — the anti-drift contract,
  #     mechanically checked (SKILL.md "Atomic ledger writes";
  #     references/anti-drift.md section 8). Three controls:
  #       (i)   a RESULT line with NO prior CLAIM for that unit MUST alarm
  #             (unpaired-claim, exit 3, ACTION|write-missing-claims)
  #       (ii)  a CLAIM+RESULT pair MUST NOT alarm — the contract held; the
  #             RECONCILE line carries ledger=ledger-ok(...)
  #       (iii) a unit with neither line is not yet dispatched: NOT drift
  #     The same-unit control is exact: a RESULT for U-03 with a CLAIM for a
  #     different unit (U-02) is a cross-typod pair and MUST alarm.
  #--------------------------------------------------------------------------
  mk_home "$T/c14"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c14/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c14/CONTROL/project_state.json"
  # An established project's ledger EXISTS before any unit runs (it holds the
  # baseline/creation lines). Without it the first reconcile would correctly
  # report ledger-undetermined — the absent-ledger case — which is a different
  # fixture. This fixture is the empty-ledger case: zero units claimed.
  : > "$T/c14/CONTROL/LEDGER.md"
  # (iii) baseline run — no CLAIM, no RESULT: not drift (rc 0)
  runa "$T/c14" "U-02" --mode reconcile --tasks "$T/c14/CONTROL/task-graph-snapshot.json" --state "$T/c14/CONTROL/project_state.json"
  local rc_base="$RC" ok_base=0
  if (( RC == 0 )) && printf '%s' "$OUT" | "$GREP" -q 'ledger=ledger-ok(claimed=0/resulted=0/unpaired=0/tol='; then ok_base=1; fi

  # (i) the violation: RESULT for U-03 with no prior CLAIM (default tolerance 3
  #     > 1 unpaired unit -> clean, proving the tolerance is a wall, not a
  #     hair-trigger); then ANCHOR_CLAIM_UNPAIRED_TOL=0 -> MUST alarm.
  "$SCRIPT_DIR/ledger.sh" "$T/c14" "CONTROL/LEDGER.md" \
    "2026-08-12T02:30:00Z | RESULT | unit=U-03 | PASS | evidence=repos/app/src/parser.ts" >/dev/null 2>&1
  runa "$T/c14" "U-02" --mode reconcile --tasks "$T/c14/CONTROL/task-graph-snapshot.json" --state "$T/c14/CONTROL/project_state.json"
  local rc_tol="$RC" ok_tol=0
  if (( RC == 0 )) && printf '%s' "$OUT" | "$GREP" -q 'ledger=ledger-ok(.*unpaired=1/tol=3)'; then ok_tol=1; fi

  set +e
  OUT="$(ANCHOR_CLAIM_UNPAIRED_TOL=0 "$SELF" "$T/c14" "U-02" --mode reconcile --tasks "$T/c14/CONTROL/task-graph-snapshot.json" --state "$T/c14/CONTROL/project_state.json" 2>&1)"; RC=$?
  set -e
  local rc_strict="$RC" ok_strict=0
  if (( RC == 3 )) \
     && "$GREP" -qE 'DRIFT-ALARM \| unpaired-claim \| unit=U-02' "$T/c14/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|write-missing-claims' \
     && printf '%s' "$OUT" | "$GREP" -q 'unpaired-claim(1 of 1 RESULT units'; then ok_strict=1; fi

  # (ii) the negative control: a CLAIM for U-03 written BEFORE its RESULT must
  #      clear the alarm. The claim line is appended AFTER the result in file
  #      order (an end-ledger claim, which the contract already forbids as a
  #      writing rule) — the pair check is ORDER-INDEPENDENT on purpose, so a
  #      repaired claim restores provenance without rewriting history.
  "$SCRIPT_DIR/ledger.sh" "$T/c14" "CONTROL/LEDGER.md" \
    "2026-08-12T02:31:00Z | CLAIM | unit=U-03 | agent=builder | model=Opus | plan=land the parser" >/dev/null 2>&1
  runa "$T/c14" "U-02" --mode reconcile --tasks "$T/c14/CONTROL/task-graph-snapshot.json" --state "$T/c14/CONTROL/project_state.json"
  local rc_pair="$RC" ok_pair=0
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'DRIFT-ALARM \| unpaired-claim' \
     && printf '%s' "$OUT" | "$GREP" -q 'ledger=ledger-ok(claimed=1/resulted=1/unpaired=0/'; then ok_pair=1; fi

  # One aggregated report for the whole case so the case count in the
  # SELFTEST COMPLETE line stays truthful (PASSES counts report() calls).
  ok=0
  if (( ok_base == 1 && ok_tol == 1 && ok_strict == 1 && ok_pair == 1 )); then ok=1; fi
  report 14 "ledger-provenance" "$ok" "baseline rc=${rc_base} (want 0; RECONCILE carries ledger=ledger-ok(claimed=0/resulted=0/unpaired=0/tol=3)); tolerated rc=${rc_tol} (want 0; unpaired=1 reported but under tol=3); strict rc=${rc_strict} (want 3 at ANCHOR_CLAIM_UNPAIRED_TOL=0; DRIFT-ALARM | unpaired-claim written; ACTION|write-missing-claims emitted); paired rc=${rc_pair} (want 0; claimed=1/resulted=1/unpaired=0; no unpaired-claim alarm — the negative control)"

  #--------------------------------------------------------------------------
  # --- case 16: THE RECOVERY LADDER, rung 2 — the CAPACITY-EVENT grace.
  #     R2 of the review: "a thirty-minute provider outage or a 429 cluster
  #     becomes a permanent stop." Six no-delta reconciles whose last recorded
  #     state change is a capacity event must NOT write the flag inside two
  #     hours; N rises to max(ANCHOR_TERMINAL_N, ceil(120min/cadence)) = 24 at
  #     the 5-minute cadence, and the counter goes on climbing (case 8's rule
  #     is untouched: observation is still not progress).
  #
  #     Its negative control is case 6, run on the same fixtures with no
  #     capacity event in the ledger: THAT run reaches the flag on its third
  #     crossing. Same counter, same cadence, one difference — so this case
  #     proves a grace, not a blinded detector. The in-case control is the
  #     second half below: a real state line written after the capacity event
  #     ends the grace, because the capacity event is then no longer the last
  #     thing that happened.
  #--------------------------------------------------------------------------
  mk_home "$T/c16"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c16/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c16/CONTROL/project_state.json"
  local c16args=( "$T/c16" "U-02" --mode reconcile --tasks "$T/c16/CONTROL/task-graph-snapshot.json" --state "$T/c16/CONTROL/project_state.json" )
  runa "${c16args[@]}"                            # establish the fingerprint
  "$SCRIPT_DIR/ledger.sh" "$T/c16" "CONTROL/LEDGER.md" \
    "2026-08-12T02:14:00Z | CAPACITY-EVENT | provider=deepseek | event=429-cluster | evidence=rc429x4/1tick | response=throttle" >/dev/null 2>&1
  runa "${c16args[@]}"                            # the capacity event is now the last state change
  sed -e "s/^count=.*/count=$(( TERMINAL_N - 1 ))/" "$T/c16/CONTROL/.anchor-fingerprint" > "$T/c16/CONTROL/.anchor-fingerprint.new"
  mv "$T/c16/CONTROL/.anchor-fingerprint.new" "$T/c16/CONTROL/.anchor-fingerprint"
  local c16_i=1 c16_flag=0 c16_rc=0
  while (( c16_i <= 6 )); do
    runa "${c16args[@]}"
    c16_rc="$RC"
    if [[ -f "$T/c16/CONTROL/TERMINAL-DRIFT.flag" ]]; then c16_flag=1; break; fi
    c16_i=$(( c16_i + 1 ))
  done
  local c16_count c16_win
  c16_count="$(sed -n 's/^count=//p' "$T/c16/CONTROL/.anchor-fingerprint" | head -1)"
  c16_win="$("$GREP" -oE '\| RECOVERY-LADDER \| rung=2/4 \| action=capacity-grace \| grace=holds\([^)]*\)' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null | tail -1 || true)"
  local ok15a=0
  if (( c16_flag == 0 )) && (( c16_rc != 4 )) && [[ -n "$c16_count" ]] && (( c16_count > TERMINAL_N )) \
     && "$GREP" -qE '\| RECOVERY-LADDER \| rung=1/4 \| action=redispatch-from-checkpoint' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null \
     && "$GREP" -qE '\| RECOVERY-LADDER \| rung=2/4 \| action=capacity-grace \| grace=holds' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE '\| TERMINAL-DRIFT \|' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -qE 'rung=3/4' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null; then ok15a=1; fi
  # The in-case control: real state after the capacity event ends the grace,
  # and the ladder resumes at rung 3 on the way to the flag.
  "$SCRIPT_DIR/ledger.sh" "$T/c16" "CONTROL/LEDGER.md" \
    "2026-08-12T03:00:00Z | RESULT | unit=U-09 | verdict=8.6 | artifact=repos/app/src/api.ts" >/dev/null 2>&1
  runa "${c16args[@]}"                            # the state moved: counter resets to 0
  sed -e "s/^count=.*/count=$(( TERMINAL_N - 1 ))/" "$T/c16/CONTROL/.anchor-fingerprint" > "$T/c16/CONTROL/.anchor-fingerprint.new"
  mv "$T/c16/CONTROL/.anchor-fingerprint.new" "$T/c16/CONTROL/.anchor-fingerprint"
  runa "${c16args[@]}"                            # rung 1 again (the ladder restarted)
  runa "${c16args[@]}"                            # grace is over -> rung 3, not rung 2
  local c16_rc3="$RC" ok15b=0
  if (( RC == 3 )) && [[ ! -f "$T/c16/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|switch-to-fallback-seats|U-02|' \
     && "$GREP" -qE '\| RECOVERY-LADDER \| rung=3/4 \| action=switch-to-fallback-seats \| grace=no\(' "$T/c16/CONTROL/LEDGER.md" 2>/dev/null; then ok15b=1; fi
  ok=0
  if (( ok15a == 1 && ok15b == 1 )); then ok=1; fi
  report 16 "capacity-event-grace" "$ok" \
    "6 no-delta reconciles past N with a capacity event as the last state change: flag written=${c16_flag} (must be 0), last rc=${c16_rc} (must not be 4), counter=${c16_count} (past N=${TERMINAL_N}, held under N=${CAPACITY_N} for ${CAPACITY_GRACE_MIN}min); rung 2 held [${c16_win}] and rung 3 was never reached; then a real state line after the capacity event ended the grace and the ladder resumed at rung 3 with rc=${c16_rc3} (want 3) — the grace is bounded, not blind. Negative control: case 6, same fixtures with no capacity event, reaches the flag on the third crossing."

  #--------------------------------------------------------------------------
  # --- case 17: THE FRESH-SESSION CLEAR. R2's second half: a file called
  #     TERMINAL-DRIFT.flag "is not something a sixty-year-old will find and
  #     delete", so the flag must be clearable by the run itself once the one
  #     thing it holds out for — the blocker, NAMED IN WRITING — exists.
  #     Three controls, all in one case:
  #       (i)   the ladder is climbed to the flag (rungs 1, 3, then 4);
  #       (ii)  with the flag present and NO named blocker, every reconcile
  #             still exits 4 and the flag survives — the stop is real;
  #       (iii) with the BLOCKER-NAMED row on CONTROL/TODO.md, the next
  #             reconcile removes the flag itself, writes TERMINAL-DRIFT-
  #             CLEARED through ledger.sh, resets the counter and the ladder,
  #             and the run continues.
  #     Control (iv) is the one that keeps (iii) honest: this script's own
  #     OPERATOR-ESCALATION line is already sitting in that TODO file and
  #     talks ABOUT the blocker row, so a sloppy marker would have cleared the
  #     flag on the very next tick with nobody naming anything. Step (ii)
  #     proves it does not.
  #--------------------------------------------------------------------------
  mk_home "$T/c17"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c17/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c17/CONTROL/project_state.json"
  local c17args=( "$T/c17" "U-02" --mode reconcile --tasks "$T/c17/CONTROL/task-graph-snapshot.json" --state "$T/c17/CONTROL/project_state.json" )
  runa "${c17args[@]}"
  sed -e "s/^count=.*/count=$(( TERMINAL_N - 1 ))/" "$T/c17/CONTROL/.anchor-fingerprint" > "$T/c17/CONTROL/.anchor-fingerprint.new"
  mv "$T/c17/CONTROL/.anchor-fingerprint.new" "$T/c17/CONTROL/.anchor-fingerprint"
  runa "${c17args[@]}"    # rung 1
  runa "${c17args[@]}"    # rung 3
  runa "${c17args[@]}"    # rung 4: the flag
  local ok16a=0
  if (( RC == 4 )) && [[ -f "$T/c17/CONTROL/TERMINAL-DRIFT.flag" ]]; then ok16a=1; fi
  # (ii) the stop holds while nothing is named — including against this
  #      script's own OPERATOR-ESCALATION line, which is already in the file.
  runa "${c17args[@]}"
  local c17_rc_hold="$RC" ok16b=0
  if (( RC == 4 )) && [[ -f "$T/c17/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'BLOCKER-NAMED' \
     && "$GREP" -q 'OPERATOR-ESCALATION' "$T/c17/CONTROL/TODO.md" 2>/dev/null; then ok16b=1; fi
  # (iii) the fresh session names the blocker and the flag clears itself.
  "$SCRIPT_DIR/ledger.sh" "$T/c17" "CONTROL/TODO.md" \
    "- [x] BLOCKER-NAMED | the deepseek seat stopped answering at 02:14 and both fallbacks were rate-limited | session=fresh-2026-08-12T04:00Z" >/dev/null 2>&1
  runa "${c17args[@]}"
  local c17_rc_clear="$RC" c17_rung ok16c=0
  c17_rung="$(sed -n 's/^recovery_rung=//p' "$T/c17/CONTROL/.anchor-fingerprint" | head -1)"
  if (( RC != 4 )) && [[ ! -f "$T/c17/CONTROL/TERMINAL-DRIFT.flag" ]] \
     && "$GREP" -qE '\| TERMINAL-DRIFT-CLEARED \| cleared-by=fresh-session \|' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null \
     && "$GREP" -q 'the deepseek seat stopped answering' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null \
     && [[ "${c17_rung:-9}" == "0" ]]; then ok16c=1; fi
  ok=0
  if (( ok16a == 1 && ok16b == 1 && ok16c == 1 )); then ok=1; fi
  report 17 "fresh-session-clears-the-flag" "$ok" \
    "ladder climbed to the flag (rc=4, flag present)=${ok16a}; with no named blocker the stop HELD across another reconcile (rc=${c17_rc_hold}, want 4, flag survived, and the script's own OPERATOR-ESCALATION line did not satisfy the marker)=${ok16b}; after a '- [x] BLOCKER-NAMED | … | session=…' row landed on CONTROL/TODO.md the reconcile cleared the flag itself (rc=${c17_rc_clear}, want not-4; TERMINAL-DRIFT-CLEARED written through ledger.sh naming the blocker; recovery_rung reset to ${c17_rung})=${ok16c}"

  #--------------------------------------------------------------------------
  # --- CLASS 6, control F (case 18): THE WRITER DEFECT. The state file carries
  #     agents.project_budget.first_pause — the shape the canary run actually
  #     wrote — and none of the canonical flat paths. Before this case the
  #     branch reported "budget-undetermined(no-claimed-spend …)", which reads
  #     as "you never gave me a state file" for a file that WAS given and was
  #     written wrong. The verdict must NAME the near-miss key so the conductor
  #     fixes the WRITER, and the action must name the instrument that decides
  #     it properly (tools/state-check.sh).
  #
  #     The control is the half that matters: the SAME run shape with the
  #     canonical keys must still come back budget-ok. A probe that cannot stay
  #     quiet on a correct file would turn every honest run into a defect
  #     report.
  #--------------------------------------------------------------------------
  mk_home "$T/c18"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c18/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","agents":{"executions_total":72,"session_budget_remaining":936,"session_budget_total":1000,"project_budget":{"initial":41,"warn":150,"first_pause":200,"ceiling":2000}},"workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c18/CONTROL/project_state.json"
  mk_dispatch_log "$T/c18" 72
  runa "$T/c18" "U-02" --mode reconcile --tasks "$T/c18/CONTROL/task-graph-snapshot.json" --state "$T/c18/CONTROL/project_state.json"
  local c18_rc="$RC" ok18a=0
  if printf '%s' "$OUT" | "$GREP" -q 'budget-writer-defect(agents.project_budget)' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|run-state-check|U-02|' \
     && printf '%s' "$OUT" | "$GREP" -q 'tools/state-check.sh' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-undetermined'; then ok18a=1; fi
  # the control: canonical keys, same census — must be budget-ok and must NOT
  # mention a writer defect.
  mk_home "$T/c18ctl"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c18ctl/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c18ctl" 1000 928 72
  mk_dispatch_log "$T/c18ctl" 72
  runa "$T/c18ctl" "U-02" --mode reconcile --tasks "$T/c18ctl/CONTROL/task-graph-snapshot.json" --state "$T/c18ctl/CONTROL/project_state.json"
  local c18_rc_ctl="$RC" ok18b=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-ok(claimed=72/dispatched=72)' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-writer-defect'; then ok18b=1; fi
  ok=0
  if (( ok18a == 1 && ok18b == 1 )); then ok=1; fi
  report 18 "budget-writer-defect" "$ok" \
    "near-miss fixture (agents.project_budget.first_pause, no flat path): rc=${c18_rc}; classes carry budget-writer-defect(agents.project_budget) and ACTION|run-state-check names tools/state-check.sh; NOT budget-undetermined=${ok18a}. Control (the same run with the canonical agents.* keys): rc=${c18_rc_ctl} (want 0), budget-ok(claimed=72/dispatched=72), no writer-defect verdict=${ok18b} — the probe discriminates instead of firing on everything."

  #--------------------------------------------------------------------------
  # --- CLASS 6, control G (case 19): THE OPERATOR OVERRIDE. Five legs on ONE
  #     fixture shape, because a run where every leg answers alike is a broken
  #     test and not a finding:
  #
  #       a  the FILE at first_pause=20 against a state file that says 200,
  #          executions_total=20 → BUDGET-PAUSE fires at pause_at=20 and the
  #          RECONCILE line carries override=first_pause:20(source=<the file>)
  #       b  the CONTROL — the identical fixture with NO override file and no
  #          variable → NO pause at all (20 is far under 200) and no override=
  #          token anywhere. This is the half that proves the override moved
  #          the line, and not a script that pauses everything
  #       c  the VARIABLE alone, no file → the same pause, the source named as
  #          env:SPEC_PROTOCOL_FIRST_PAUSE
  #       d  BOTH, disagreeing (file 20, variable 50) → the FILE wins: the line
  #          names the file and the arithmetic is 20, never 50
  #       e  a MALFORMED file → rc 2, a named TOOLING FAILURE, and never rc 0.
  #          An override that cannot be honoured is never quietly ignored
  #--------------------------------------------------------------------------
  local ov19a=0 ov19b=0 ov19c=0 ov19d=0 ov19e=0 rc19a rc19b rc19c rc19d rc19e
  mk_home "$T/c19"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c19/CONTROL/task-graph-snapshot.json"
  mk_state_budget "$T/c19" 1000 980 20 200 2000 0
  mk_dispatch_log "$T/c19" 20

  # (b) THE CONTROL FIRST — the fixture with nothing overriding it.
  runa "$T/c19" "U-02" --mode reconcile --tasks "$T/c19/CONTROL/task-graph-snapshot.json" --state "$T/c19/CONTROL/project_state.json"
  rc19b="$RC"
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'override=' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'budget-pause'; then ov19b=1; fi

  # (a) the FILE.
  printf '{"first_pause": 20, "set_by": "operator", "reason": "canary proof D"}\n' > "$T/c19/CONTROL/OPERATOR-OVERRIDE.json"
  runa "$T/c19" "U-02" --mode reconcile --tasks "$T/c19/CONTROL/task-graph-snapshot.json" --state "$T/c19/CONTROL/project_state.json"
  rc19a="$RC"
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -qE "override=first_pause:20\(source=.*/CONTROL/OPERATOR-OVERRIDE\.json\)" \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-pause(executions=20/pause_at=20/ceiling=2000)' \
     && "$GREP" -qE '\| BUDGET-PAUSE \| executions=20 \| pause_at=20 ' "$T/c19/CONTROL/LEDGER.md" 2>/dev/null; then ov19a=1; fi

  # (d) BOTH, disagreeing. The file must win and must be the named source.
  export SPEC_PROTOCOL_FIRST_PAUSE=50
  runa "$T/c19" "U-02" --mode reconcile --tasks "$T/c19/CONTROL/task-graph-snapshot.json" --state "$T/c19/CONTROL/project_state.json"
  rc19d="$RC"
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -qE "override=first_pause:20\(source=.*/CONTROL/OPERATOR-OVERRIDE\.json\)" \
     && printf '%s' "$OUT" | "$GREP" -q 'pause_at=20' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'override=first_pause:50'; then ov19d=1; fi

  # (c) the VARIABLE alone: the same fixture with the file removed.
  rm -f "$T/c19/CONTROL/OPERATOR-OVERRIDE.json"
  export SPEC_PROTOCOL_FIRST_PAUSE=20
  runa "$T/c19" "U-02" --mode reconcile --tasks "$T/c19/CONTROL/task-graph-snapshot.json" --state "$T/c19/CONTROL/project_state.json"
  rc19c="$RC"
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'override=first_pause:20(source=env:SPEC_PROTOCOL_FIRST_PAUSE)' \
     && printf '%s' "$OUT" | "$GREP" -q 'budget-pause(executions=20/pause_at=20/ceiling=2000)'; then ov19c=1; fi
  unset SPEC_PROTOCOL_FIRST_PAUSE

  # (e) MALFORMED — nested, which is the shape jnum resolves unpredictably.
  printf '{"first_pause": {"value": 20}, "set_by": "operator"}\n' > "$T/c19/CONTROL/OPERATOR-OVERRIDE.json"
  runa "$T/c19" "U-02" --mode reconcile --tasks "$T/c19/CONTROL/task-graph-snapshot.json" --state "$T/c19/CONTROL/project_state.json"
  rc19e="$RC"
  if (( RC == 2 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'MALFORMED OPERATOR OVERRIDE' \
     && printf '%s' "$OUT" | "$GREP" -q 'TOOLING FAILURE'; then ov19e=1; fi
  rm -f "$T/c19/CONTROL/OPERATOR-OVERRIDE.json"

  ok=0
  if (( ov19a == 1 && ov19b == 1 && ov19c == 1 && ov19d == 1 && ov19e == 1 )); then ok=1; fi
  report 19 "operator-override" "$ok" \
    "file override 20 over a state file saying 200 at executions_total=20: rc=${rc19a} (want 3), BUDGET-PAUSE at pause_at=20 and classes carry override=first_pause:20(source=<the file>)=${ov19a}. CONTROL, the same fixture with no override at all: rc=${rc19b} (want 0), no pause and no override= token=${ov19b} — the pass/fail pair that proves the override moved the line. Variable alone: rc=${rc19c} (want 3) with source=env:SPEC_PROTOCOL_FIRST_PAUSE=${ov19c}. File 20 vs variable 50: rc=${rc19d} (want 3), the FILE named as the source and the arithmetic 20=${ov19d}. Malformed (nested first_pause): rc=${rc19e} (want 2, NEVER 0), named TOOLING FAILURE=${ov19e}"


  #--------------------------------------------------------------------------
  # --- CLASS 8 (case 20): LEDGER-UNSTAMPED — can this ledger be time-ordered
  #     at all? (RC-18.) Four legs, and the last two are the ones that make it
  #     a test rather than a demonstration:
  #
  #       a  THE POSITIVE. A legacy-shaped ledger carrying the three clockless
  #          shapes the canary photographed verbatim (`ENTRY-MODE: interview`,
  #          `BUILD-TARGET: WEBSITE`, `CAPACITY-LEDGER: …`) MUST raise
  #          DRIFT-ALARM | ledger-unstamped(n=3), exit 3, name n=3 on the
  #          RECONCILE line's classes, and emit the ACTION. n is 3 and not 5:
  #          the same fixture also holds a markdown heading and a contentless
  #          tick, neither of which is a record, so the count proves the
  #          census discriminates instead of counting lines.
  #       b  THE NEGATIVE CONTROL. The SAME fixture with every record stamped
  #          MUST NOT alarm, MUST exit 0, and MUST report
  #          ledger-stamped(...unstamped=0...). A class that fires on every
  #          ledger is not a detector.
  #       c  IT REPAIRS NOTHING. sha256 of the fixture's own lines is captured
  #          before the reconcile and re-computed after: byte-identical. The
  #          whole file legitimately GREW — this script appends its own
  #          (stamped) DRIFT-ALARM and RECONCILE lines, which is its job — but
  #          not one pre-existing byte may change. Rewriting a ledger's
  #          history is precisely what a ledger must never do, and a
  #          back-dated line is a worse artifact than a clockless one because
  #          it looks trustworthy.
  #       d  AND IT DOES NOT QUIETLY BACKFILL. A SECOND reconcile still says
  #          n=3. A class that repaired on the first pass would report 0 here
  #          and leg (c) alone could not tell the difference between "left it
  #          alone" and "fixed it before I looked".
  #--------------------------------------------------------------------------
  mk_home "$T/c20"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c20/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c20/CONTROL/project_state.json"
  # The fixture is written with printf, NOT through ledger.sh, ON PURPOSE:
  # ledger.sh is now the writer of record and would stamp these, so the only
  # way to photograph a legacy ledger is to write one directly. Three stamped
  # records, three clockless ones, one heading, one contentless tick.
  {
    printf '## Project log\n'
    printf '2026-09-08T13:00:00Z | GATE0 | ultracode=on | writer=ledger.sh\n'
    printf 'ENTRY-MODE: interview\n'
    printf 'BUILD-TARGET: WEBSITE\n'
    printf '2026-09-08T13:02:00Z | NOTE | unit=U-02 | the design direction is locked | writer=ledger.sh\n'
    printf 'CAPACITY-LEDGER: written 2026-09-08T13:06Z, clientCap=10 [MEASURED]\n'
    printf -- '- heartbeat (ledger auto-tick)\n'
    printf '2026-09-08T13:08:00Z | NOTE | unit=U-02 | copy drafted | writer=ledger.sh\n'
  } > "$T/c20/CONTROL/LEDGER.md"
  local c20_fixn c20_sha_before c20_sha_after c20args
  c20_fixn="$(wc -l < "$T/c20/CONTROL/LEDGER.md" | tr -d ' ')"
  c20_sha_before="$(head -n "$c20_fixn" "$T/c20/CONTROL/LEDGER.md" | sha_stdin)"
  c20args=( "$T/c20" "U-02" --mode reconcile --tasks "$T/c20/CONTROL/task-graph-snapshot.json" --state "$T/c20/CONTROL/project_state.json" )
  runa "${c20args[@]}"
  local c20_rc="$RC" ok20a=0 ok20b=0 ok20c=0 ok20d=0
  if (( RC == 3 )) \
     && "$GREP" -qE '\| DRIFT-ALARM \| ledger-unstamped\(n=3\) \| unit=U-02 \|' "$T/c20/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'ledger-unstamped(n=3)' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION|route-writes-through-ledger.sh|U-02|'; then ok20a=1; fi
  # (c) not one pre-existing byte changed.
  c20_sha_after="$(head -n "$c20_fixn" "$T/c20/CONTROL/LEDGER.md" | sha_stdin)"
  if [[ -n "$c20_sha_before" && "$c20_sha_before" == "$c20_sha_after" ]]; then ok20c=1; fi
  # (d) and nothing was backfilled behind the alarm.
  runa "${c20args[@]}"
  local c20_rc2="$RC"
  if (( RC == 3 )) && printf '%s' "$OUT" | "$GREP" -q 'ledger-unstamped(n=3)'; then ok20d=1; fi
  # (b) THE CONTROL: the same shape, fully stamped.
  mk_home "$T/c20ctl"
  printf '{"tasks":[{"taskId":"T-02","subject":"qc","status":"pending"}]}\n' > "$T/c20ctl/CONTROL/task-graph-snapshot.json"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","workstreams":{"passed":[],"failed":[],"in_repair":[]}}\n' > "$T/c20ctl/CONTROL/project_state.json"
  {
    printf '## Project log\n'
    printf '2026-09-08T13:00:00Z | GATE0 | ultracode=on | writer=ledger.sh\n'
    printf '2026-09-08T13:01:00Z | ENTRY-MODE: interview | writer=ledger.sh\n'
    printf '2026-09-08T13:01:30Z | BUILD-TARGET: WEBSITE | writer=ledger.sh\n'
    printf '2026-09-08T13:02:00Z | NOTE | unit=U-02 | the design direction is locked | writer=ledger.sh\n'
    printf '2026-09-08T13:06:00Z | CAPACITY-LEDGER: clientCap=10 [MEASURED] | writer=ledger.sh\n'
    printf -- '- heartbeat (ledger auto-tick)\n'
    printf '2026-09-08T13:08:00Z | NOTE | unit=U-02 | copy drafted | writer=ledger.sh\n'
  } > "$T/c20ctl/CONTROL/LEDGER.md"
  runa "$T/c20ctl" "U-02" --mode reconcile --tasks "$T/c20ctl/CONTROL/task-graph-snapshot.json" --state "$T/c20ctl/CONTROL/project_state.json"
  local c20_rc_ctl="$RC"
  if (( RC == 0 )) \
     && ! "$GREP" -q 'ledger-unstamped' "$T/c20ctl/CONTROL/LEDGER.md" 2>/dev/null \
     && ! printf '%s' "$OUT" | "$GREP" -q 'ledger-unstamped' \
     && printf '%s' "$OUT" | "$GREP" -q 'ledger-stamped(records=6/unstamped=0/structure=1)'; then ok20b=1; fi
  ok=0
  if (( ok20a == 1 && ok20b == 1 && ok20c == 1 && ok20d == 1 )); then ok=1; fi
  report 20 "ledger-unstamped" "$ok" \
    "3 clockless records among 6 records + 1 heading + 1 contentless tick: rc=${c20_rc} (want 3), DRIFT-ALARM | ledger-unstamped(n=3) written, classes and ACTION|route-writes-through-ledger.sh name it, and n is 3 not 5 (the heading and the tick are not records)=${ok20a}. CONTROL, the same shape fully stamped: rc=${c20_rc_ctl} (want 0), ledger-stamped(records=6/unstamped=0/structure=1), no alarm anywhere=${ok20b} — the pass/fail pair that proves this is a detector and not a siren. REPAIRS NOTHING: sha256 of the fixture's ${c20_fixn} pre-existing lines identical before and after=${ok20c} (before=${c20_sha_before%% *} after=${c20_sha_after%% *}); the file grew only by this script's own stamped DRIFT-ALARM and RECONCILE lines. NO SILENT BACKFILL: a second reconcile still reports n=3, rc=${c20_rc2}=${ok20d}"
  printf 'SELFTEST COMPLETE | %s of 20 cases passed | %s failed\n' "$PASSES" "$FAILS"
  if (( FAILS > 0 )); then exit 1; fi
  exit 0
}

#==============================================================================
if (( DO_SELFTEST == 1 )); then
  self_prove
  selftest
fi
run_anchor
