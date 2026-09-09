#!/usr/bin/env bash
#==============================================================================
# watch-tick.sh — the S1–S13 instrument, run every five minutes
#==============================================================================
#
# PURPOSE
#   SKILL.md RULE 5 is a table of standards. references/loops.md Loop 9 is the
#   loop that enforces them. Until this script existed, both were prose: the
#   only thing standing between a stalled swarm and a client who walked away
#   was the conductor remembering to look. This is the half that does not
#   depend on the model.
#
#   THE TWO HALVES (references/loops.md Loop 9, SKILL.md RULE 5, step 3 which
#   ARMS the tick and step 21 which PROVES it ran):
#     THE CRON HALF — this script, on the crontab line `--arm` writes and the
#       skill announces at step 3 (step 21 proves it ran; it never re-arms):
#         */5 * * * * bash <skill>/tools/watch-tick.sh <project> \
#                     >> <project>/CONTROL/watch-tick.log 2>&1
#       It runs whether or not a session is alive, whether or not the model is
#       thinking, whether or not anybody is awake. It NEVER dispatches: scripts
#       cannot call session tools. It reconciles, counts, and writes.
#     THE MODEL HALF — the conductor's in-session `/loop 5m`, which reads the
#       ACTION lines this script prints (and the same lines in the log) and
#       does the dispatching. Command-shaped, never free-form.
#   Either half alone is a partial machine. The cron half proves the state; the
#   model half acts on it. `--arm <project>` WRITES that line at step 3, so the
#   arming is an instrument rather than a snippet a model is asked to paste,
#   and `--cron-line` still prints it verbatim for step 21 to prove against.
#
# WHAT IT CHECKS (the standards it owns; the table in SKILL.md RULE 5 is the
# roster's only owner and this header never restates it)
#   first    tools/anchor.sh --mode reconcile — the three-way reconcile (S10),
#            the repeated-intent alarm (S14), the recovery ladder and the
#            TERMINAL-DRIFT stop. Its verdict rides in this tick's S-CHECK line
#            as anchor=<…>, so the contract's state is visible without a second
#            read.
#   S2       runnable > 0 and open == 0            -> ACTION|dispatch-now
#   S3       an open row with no [<model> x<N>]    -> ACTION|relabel-and-redispatch
#   S5       open rows < CLIENT_CAP x running trees while runnable > 0
#                                                  -> ACTION|widen
#   S6       an open row whose CONTROL/HEARTBEAT.md line is older than 10
#            minutes (20 for a merge stage)        -> ACTION|reap-and-redispatch
#   S13      a RESULT is written for the unit and its heartbeat is STILL fresh
#                                                  -> ACTION|reap
#   bar      the two files the client status bar reads, through
#            tools/bar-check.sh: CONTROL/setup_progress.json and
#            CONTROL/project_state.json tasks.counts
#                                                  -> ACTION|write-bar-inputs
#            (or ACTION|fix-bar-input when one is present and unparseable).
#            NOT an S-number: RULE 5's table owns those, and this is the
#            enforcement half of SKILL.md §12's bar instruction. A bar segment
#            with no file behind it renders as nothing, silently, for a whole
#            run — the client never asks why, so the tick has to.
#
# THE DEFINITIONS, MECHANICALLY (so two readers count the same numbers)
#   runnable  an OPEN box in CONTROL/CHECKLIST.md (`- [ ] …`) whose unit id has
#             no open dispatch row.
#   open      a row in CONTROL/dispatch-log.md (document 12's shape,
#             `timestamp | work item | stage | full label | run id`) whose unit
#             has no `| RESULT |` line in CONTROL/LEDGER.md. Rows are keyed by
#             unit + stage and the LATEST row wins, so a re-dispatch after a
#             reap replaces the dead agent's row instead of counting twice.
#   trees     distinct run ids among the open rows — one workflow tree per run
#             id. A row with no run id falls into one `(unkeyed)` bucket and the
#             S-CHECK line says how many rows that was; it is never silently
#             promoted into a tree count.
#   unit id   the value of a `unit=` field when the line carries one, otherwise
#             the FIRST whitespace token of the work-item field (checklist: the
#             first token after the box). The same rule on both sides, which is
#             what lets `- [ ] U-02 qc the parser` match `… | U-02 build | …`.
#
# THE NEGATIVE-RESULT CONTRACT (this script's own rule)
#   A zero it cannot prove is UNDETERMINED and says so in the `undetermined=`
#   field of its S-CHECK line, never a violation and never a pass:
#     - no CAPACITY-LEDGER.md, or no CLIENT_CAP/clientCap value in it -> S5 is
#       UNDETERMINED (it cannot compare against a width it never read);
#     - a dispatch log with content but no parseable row -> the open count is
#       UNDETERMINED, and S2 does not fire on it (an unparseable log is not a
#       proven zero);
#     - a heartbeat timestamp it cannot parse -> that row's age is UNDETERMINED,
#       so neither S6 nor S13 fires on it;
#     - no tools/bar-check.sh, or a bar-check exit it does not recognise -> the
#       bar is UNDETERMINED and says so in `bar=`, never a silent pass. A
#       project with no plan yet whose CONTROL/setup_progress.json IS being
#       written reads `bar=getting-ready`: that is the segment the bar shows
#       before the plan exists, so it is a pass, not a finding.
#   And it proves its own instruments against embedded fixtures before it
#   trusts them (a positive that MUST match, negatives that MUST NOT, including
#   the bracket-with-no-count trap). Control failure is exit 2 — BROKEN
#   INSTRUMENT is never ALL CLEAR.
#
# EXIT-CODE CONTRACT (the same shape as anchor.sh, on purpose)
#   0  clean       one `S-CHECK | violations=0 | runnable=<n> open=<n> trees=<n>`
#                  line written through tools/ledger.sh; nothing fired
#   2  TOOLING FAILURE / BROKEN INSTRUMENT — loud, never a verdict
#   3  violations  ACTION|verb|target|evidence on stdout; the S-CHECK line
#                  carries the count and the verbs
#   4  CONTROL/TERMINAL-DRIFT.flag exists (anchor.sh's capture-proof stop).
#      Nothing dispatches, and this tick writes no S-CHECK line: anchor.sh
#      already wrote the TERMINAL-DRIFT record and the flag IS the state.
#
# WRITES
#   Exactly one line per run, through tools/ledger.sh (locked, atomic,
#   verified), to CONTROL/LEDGER.md. `S-CHECK` is already in anchor.sh's
#   SELF_AUTHORED_RE, so this tick's own line can never reset the no-delta
#   counter it depends on. It never prints secrets and never reads credential
#   files. It never mutates task state and it never dispatches — a script
#   cannot call session tools. It emits ACTION lines; the model half executes
#   them.
#
# USAGE
#   watch-tick.sh <project-home>
#   watch-tick.sh <project-home> --cron-line     # PRINT the crontab line
#   watch-tick.sh --arm <project-home>           # WRITE it (step 3), idempotently:
#                                                #   0 armed, 3 already present,
#                                                #   2 crontab unavailable (named)
#   watch-tick.sh --selftest
#
# ENVIRONMENT KNOBS (all optional; defaults are the doctrine's numbers)
#   WATCH_STALE_MIN=10          heartbeat freshness threshold, minutes (S6/S13)
#   WATCH_MERGE_STALE_MIN=20    the same threshold for a merge stage
#   WATCH_CLIENT_CAP=<n>        override the width read from CAPACITY-LEDGER.md
#   WATCH_SKIP_ANCHOR=1         selftest/diagnostic only: skip the reconcile and
#                               record anchor=skipped(WATCH_SKIP_ANCHOR)
#   WATCH_TICK_SELFTEST_BREAK_LABEL=1  sabotage the label detector (selftest)
#   WATCH_TICK_CRONTAB_FILE=<path>  --arm only: arm against this FIXTURE table
#                               instead of the live crontab, which is then
#                               neither read nor written. Every selftest case
#                               uses it; nothing else should.
#   WATCH_TICK_CRONTAB_CMD=<cmd>    --arm only: the crontab command used for
#                               BOTH the read and the write. A path that cannot
#                               run is the "crontab unavailable" arm, provable
#                               without going near a real crontab; a command
#                               that runs writes through the same command, so
#                               a fixture command can never leak into the
#                               operator's table.
#==============================================================================

set -euo pipefail

#------------------------------------------------------------------------------
# 0. Instruments. Absolute paths where the doctrine requires it (the bare
#    `grep` shim on the operator box is broken), and proved below.
#------------------------------------------------------------------------------
GREP="/usr/bin/grep"
if [[ ! -x "$GREP" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"
  else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi
AWK="/usr/bin/awk"
if [[ ! -x "$AWK" ]]; then AWK="$(command -v awk 2>/dev/null || true)"; fi

SELF="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
# Absolute, always: invoked as `bash watch-tick.sh --selftest` from its own
# directory, a bare basename does not resolve as a command and the selftest's
# child calls come back 127 — a shell abort, never a fact about the swarm.
SELF="${SCRIPT_DIR}/$(basename "$SELF")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"
ANCHOR_SH="${SCRIPT_DIR}/anchor.sh"
BAR_CHECK_SH="${SCRIPT_DIR}/bar-check.sh"

HOME_DIR=""
DO_SELFTEST=0
DO_CRON_LINE=0
DO_ARM=0

STALE_MIN="${WATCH_STALE_MIN:-10}"
MERGE_STALE_MIN="${WATCH_MERGE_STALE_MIN:-20}"

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
  printf 'watch-tick.sh: TOOLING FAILURE (exit 2): %s\n' "$*" >&2
  printf 'watch-tick.sh: this is NOT an all-clear. Nothing about the swarm was determined.\n' >&2
  exit 2
}
die_instrument() {
  printf 'watch-tick.sh: BROKEN INSTRUMENT (exit 2): %s\n' "$*" >&2
  printf 'watch-tick.sh: the detector failed its own control, so it may not report "clean".\n' >&2
  printf 'watch-tick.sh: BROKEN INSTRUMENT is never ALL CLEAR.\n' >&2
  exit 2
}

#------------------------------------------------------------------------------
# 2. Small portable helpers.
#------------------------------------------------------------------------------
iso_now()   { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch_now() { date -u +%s; }

iso_to_epoch() {  # prints epoch, or nothing + rc 1 when UNDETERMINED
  local ts="$1" out
  out="$(TZ=UTC date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null)" && { printf '%s\n' "$out"; return 0; }
  out="$(date -u -d "$ts" +%s 2>/dev/null)" && { printf '%s\n' "$out"; return 0; }
  return 1
}

sanitize() {  # one line, no pipes (the field separator), bounded length
  printf '%s' "$1" | tr -d '\n\r' | tr '|' '/' | cut -c1-160
}

# The same, with room for two or three notes. The `undetermined=` field is the
# one place a truncation would be a LIE — a note cut in half reads as a shorter
# list of unknowns than the tick actually has — so it gets its own budget, and
# every note it carries names a path RELATIVE to the project home.
sanitize_long() {
  printf '%s' "$1" | tr -d '\n\r' | tr '|' '/' | cut -c1-600
}

ledger_write() {  # ledger_write <relative-file> <line>
  local f="$1" line="$2" out rc
  [[ -x "$LEDGER_SH" ]] || die_tool "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every write goes through it"
  set +e
  out="$("$LEDGER_SH" "$HOME_DIR" "$f" "$line" 2>&1)"; rc=$?
  set -e
  if (( rc != 0 )); then die_tool "ledger.sh failed (rc=${rc}) writing ${f}: ${out}"; fi
}

#------------------------------------------------------------------------------
# 3. THE PARSERS, as awk programs, plus the detector they carry.
#
#    The label test is the one thing here that can be wrong in both directions,
#    so it is a function with its own controls below:
#      - a row whose label is `[opus x10] WF01 builder` MUST pass;
#      - a row with `[sonnet ×4]` (the multiplication sign the research-row
#        format in SKILL.md uses) MUST pass — the sign is normalised to `x`
#        before the test, so a bracket byte-class can never half-match it;
#      - a row with a bare `WF01 builder` and no bracket MUST NOT pass;
#      - `[WF01 builder]` — a bracket with no count — MUST NOT pass. That is
#        the trap: a bracket is not a label. A test that accepts it reports a
#        swarm as labelled when nothing tells the operator how wide it is.
#
#    No `{n}` interval regexes anywhere: they are not portable across the awk
#    that ships on macOS and the one that ships on Linux, and a regex that
#    silently fails to compile is a detector that silently passes everything.
#------------------------------------------------------------------------------
AWK_LIB='
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function unit_of(line, fallback,   u) {
  u = ""
  if (match(line, /(^|[ \t|])unit=[^ \t|]+/)) {
    u = substr(line, RSTART, RLENGTH); sub(/^[^=]*=/, "", u); return trim(u)
  }
  u = trim(fallback); sub(/[ \t].*$/, "", u); return u
}
function label_ok(s,   b) {
  if (BREAK_LABEL == 1) return 1
  gsub(MUL, "x", s)
  while (match(s, /\[[^]]*\]/)) {
    b = substr(s, RSTART, RLENGTH)
    if (b ~ /^\[[ \t]*[^]\] \t][^]]*[ \t][xX][0-9][0-9]*[ \t]*\]$/) return 1
    s = substr(s, RSTART + RLENGTH)
  }
  return 0
}
'

# A dispatch row is document 12's shape: a leading ISO date then pipe fields.
# Written out digit by digit for the same portability reason as above.
AWK_ROWS="${AWK_LIB}"'
BEGIN { FS = "|" }
/^[ \t]*(- )?[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
  ts = trim($1); sub(/^-[ \t]*/, "", ts)
  item  = (NF >= 2 ? $2 : "")
  stage = (NF >= 3 ? trim($3) : "")
  label = (NF >= 4 ? trim($4) : "")
  tree  = (NF >= 5 ? trim($5) : "")
  u = unit_of($0, item)
  if (u == "") next
  ok = label_ok(label) ? "1" : "0"
  key = u "\t" stage
  if (!(key in seen)) { order[++n] = key; seen[key] = 1 }
  rec[key] = u "\t" stage "\t" ok "\t" tree "\t" ts "\t" label
}
END { for (i = 1; i <= n; i++) print rec[order[i]] }
'

AWK_CHECKLIST="${AWK_LIB}"'
/^[ \t]*[-*][ \t]*\[[ \t]*\]/ {
  rest = $0
  sub(/^[ \t]*[-*][ \t]*\[[ \t]*\][ \t]*/, "", rest)
  u = unit_of($0, rest)
  if (u != "" && !(u in seen)) { seen[u] = 1; print u }
}
'

AWK_HEARTBEAT="${AWK_LIB}"'
BEGIN { FS = "|" }
NF >= 2 {
  ts = trim($1); sub(/^-[ \t]*/, "", ts)
  if (ts !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) next
  agent = trim($2)
  item  = (NF >= 3 ? $3 : "")
  u = unit_of($0, item)
  print u "\t" agent "\t" ts
}
'

AWK_RESULTS="${AWK_LIB}"'
/[|][ \t]*RESULT[ \t]*[|]/ {
  if (match($0, /(^|[ \t|])unit=[^ \t|]+/)) {
    u = substr($0, RSTART, RLENGTH); sub(/^[^=]*=/, "", u)
    u = trim(u)
    if (u != "" && !(u in seen)) { seen[u] = 1; print u }
  } else { unkeyed++ }
}
END { if (unkeyed > 0) print "\t__UNKEYED__\t" unkeyed > "/dev/stderr" }
'

MUL='×'
BREAK_LABEL="${WATCH_TICK_SELFTEST_BREAK_LABEL:-0}"

awk_rows()      { "$AWK" -v MUL="$MUL" -v BREAK_LABEL="$BREAK_LABEL" "$AWK_ROWS"      "$1"; }
awk_checklist() { "$AWK" -v MUL="$MUL" -v BREAK_LABEL="$BREAK_LABEL" "$AWK_CHECKLIST" "$1"; }
awk_heartbeat() { "$AWK" -v MUL="$MUL" -v BREAK_LABEL="$BREAK_LABEL" "$AWK_HEARTBEAT" "$1"; }
awk_results()   { "$AWK" -v MUL="$MUL" -v BREAK_LABEL="$BREAK_LABEL" "$AWK_RESULTS"   "$1" 2>/dev/null; }

#------------------------------------------------------------------------------
# 3b. THE SELF-PROOF. Every invocation proves the row parser and the label
#     detector against embedded fixtures BEFORE it reports anything. A
#     detector that cannot prove itself does not get to say "clean".
#------------------------------------------------------------------------------
FIX_POS_LABEL='2026-09-07T12:00:00Z | U-01 build | build | [opus x10] WF01 builder | run-abc'
FIX_POS_MUL='2026-09-07T12:00:00Z | U-02 qc | qc | [sonnet ×4] WF02 judge | run-def'
FIX_NEG_NOBRACKET='2026-09-07T12:00:00Z | U-03 build | build | WF03 builder | run-ghi'
FIX_NEG_NOCOUNT='2026-09-07T12:00:00Z | U-04 build | build | [WF04 builder] | run-jkl'
FIX_NEG_HEADER='# Dispatch log — one line written BEFORE each agent fires'

self_prove() {
  [[ -n "$AWK"  && -x "$AWK"  ]] || die_tool "no usable awk (tried /usr/bin/awk then PATH)"
  [[ -n "$GREP" && -x "$GREP" ]] || die_tool "no usable grep (tried /usr/bin/grep, /bin/grep, PATH)"
  local f out
  f="$(mktemp "${TMPDIR:-/tmp}/watch-tick-selfprove.XXXXXX")"
  printf '%s\n%s\n%s\n%s\n%s\n' \
    "$FIX_POS_LABEL" "$FIX_POS_MUL" "$FIX_NEG_NOBRACKET" "$FIX_NEG_NOCOUNT" "$FIX_NEG_HEADER" > "$f"
  set +e
  out="$(awk_rows "$f" 2>&1)"
  local rc=$?
  set -e
  rm -f "$f"
  (( rc == 0 )) || die_instrument "the row parser failed to run (rc=${rc}): ${out}"

  # The header line must NOT parse as a row: four rows in, four rows out.
  local rows
  rows="$(printf '%s\n' "$out" | "$GREP" -c '[^[:space:]]' || true)"
  [[ "$rows" == "4" ]] || die_instrument "the row parser returned ${rows} rows for a fixture of 4 rows + 1 header — it is either eating rows or parsing prose as a dispatch"

  # unit ids must come out of field 2's first token.
  printf '%s\n' "$out" | "$GREP" -q '^U-01	build	1	' \
    || die_instrument "the POSITIVE control failed: '${FIX_POS_LABEL}' did not parse as unit=U-01 stage=build with a valid [<model> x<N>] label"
  printf '%s\n' "$out" | "$GREP" -q '^U-02	qc	1	' \
    || die_instrument "the POSITIVE control failed: the multiplication-sign label in '${FIX_POS_MUL}' was not accepted (the research-row format in SKILL.md writes [<model> ×1])"
  printf '%s\n' "$out" | "$GREP" -q '^U-03	build	0	' \
    || die_instrument "the NEGATIVE control failed: '${FIX_NEG_NOBRACKET}' has no bracketed label and was accepted anyway"
  printf '%s\n' "$out" | "$GREP" -q '^U-04	build	0	' \
    || die_instrument "the NEGATIVE control failed (THE TRAP): '${FIX_NEG_NOCOUNT}' is a bracket with no count and was accepted as a [<model> x<N>] label"
  return 0
}

#------------------------------------------------------------------------------
# 4. Usage, the crontab line, and the step-3 arming.
#------------------------------------------------------------------------------
usage() { sed -n '2,140p' "$SELF" | sed 's/^# \{0,1\}//'; }

cron_line() {  # cron_line <project-home>
  printf '*/5 * * * * bash %s/watch-tick.sh %s >> %s/CONTROL/watch-tick.log 2>&1\n' \
    "$SCRIPT_DIR" "$1" "$1"
}

#------------------------------------------------------------------------------
# 4b. THE ARMING (step 3). `--cron-line` PRINTS the line; `--arm` WRITES it, so
#     GATE 0b has an instrument instead of a snippet a model is asked to paste
#     — the defect this arm exists to close: nothing armed the tick mechanically,
#     so a run could reach step 21 having never ticked at all. `--arm` builds
#     the line by calling cron_line, never by rewriting it, so the line the
#     skill proves is byte-identical to the line it installs.
#
#     THE GUARD is exactly the one SKILL.md section 12 spells out: read the
#     current table once, `grep -qF watch-tick.sh` over it, append only when
#     that finds nothing. A second arm therefore adds nothing and SAYS so
#     (exit 3) rather than doubling the tick.
#
#     THE FIXTURE MODE, and why it exists. WATCH_TICK_CRONTAB_FILE names a file
#     that stands in for the table. The selftest arms against that file only:
#     the operator's live crontab is never read and never written by any
#     selftest case. Proving this code and experimenting on the machine that
#     runs the fleet are not the same act.
#
#     THE UNAVAILABLE ARM is proven by RUNNING the command, never by a name
#     lookup: `command -v` proves a NAME resolves, not that the program runs,
#     and rc 126/127 is a shell abort rather than a fact about the table. A
#     command that ran and said "no crontab for <user>" is an EMPTY table — the
#     normal first-arm state — and is never reported as unavailability.
#     WATCH_TICK_CRONTAB_CMD names the command for BOTH the read and the
#     write, so the write can never reach a different table than the read
#     proved (a fixture command that "ran" but leaked its write into the real
#     crontab would be a test that arms the operator's machine); a value that
#     is set and cannot be honoured is never ignored.
#------------------------------------------------------------------------------
CRONTAB_CMD="${WATCH_TICK_CRONTAB_CMD:-crontab}"
CRONTAB_FILE="${WATCH_TICK_CRONTAB_FILE:-}"
CRONTAB_PROBE_OUT=""
CRONTAB_PROBE_RC=0

crontab_probe() {  # rc 0 = the command RAN (whatever it exited); rc 1 = it could not
  local out rc
  set +e
  out="$("$CRONTAB_CMD" -l 2>&1)"; rc=$?
  set -e
  CRONTAB_PROBE_OUT="$out"
  CRONTAB_PROBE_RC="$rc"
  case "$rc" in 126|127) return 1 ;; *) return 0 ;; esac
}

arm_unavailable() {  # arm_unavailable <reason> <cron-line>; the degradation on STDOUT
  printf 'ARM | UNAVAILABLE (exit 2) | %s\n' "$(sanitize "$1")"
  printf 'ARM | nothing was written and the tick is NOT armed.\n'
  printf 'ARM | THE DEGRADATION, NAMED: the five-minute cron half does not exist on this box. Write that to the ledger, tell the client "the checker runs whenever I check in, rather than on its own", run the model half (/loop 5m) alone, and run this by hand at every ritual point:\n'
  printf 'ARM | %s\n' "$2"
  printf 'ARM | this is NOT an all-clear: the tick stays unarmed until something else arms it, and step 21 will find zero S-CHECK lines.\n'
}

arm_tick() {  # arm_tick <project-home> -> 0 armed, 3 already present, 2 unavailable
  local home="$1" line table wrc
  line="$(cron_line "$home")"

  if [[ -n "$CRONTAB_FILE" ]]; then
    # FIXTURE MODE. The file IS the table. No crontab process runs unless the
    # operator named one, and then it is PROVEN before anything is written.
    if [[ -n "${WATCH_TICK_CRONTAB_CMD:-}" ]] && ! crontab_probe; then
      arm_unavailable "\`${CRONTAB_CMD} -l\` came back rc=${CRONTAB_PROBE_RC}: ${CRONTAB_PROBE_OUT}" "$line"
      return 2
    fi
    if [[ -f "$CRONTAB_FILE" ]] && "$GREP" -qF watch-tick.sh "$CRONTAB_FILE"; then
      printf 'ARM | ALREADY PRESENT (exit 3) | %s already carries a watch-tick.sh line; nothing written\n' "$CRONTAB_FILE"
      return 3
    fi
    { if [[ -f "$CRONTAB_FILE" ]]; then cat "$CRONTAB_FILE"; fi
      printf '%s\n' "$line"
    } > "${CRONTAB_FILE}.tmp.$$" || die_tool "could not stage the arming into ${CRONTAB_FILE}.tmp.$$"
    mv "${CRONTAB_FILE}.tmp.$$" "$CRONTAB_FILE" || die_tool "could not install the arming into ${CRONTAB_FILE}"
    printf 'ARM | ARMED (exit 0) | one line appended to the fixture table %s: %s\n' "$CRONTAB_FILE" "$line"
    return 0
  fi

  # LIVE MODE. The probe IS the read, so the table is read exactly once.
  if ! crontab_probe; then
    arm_unavailable "\`${CRONTAB_CMD} -l\` came back rc=${CRONTAB_PROBE_RC}: ${CRONTAB_PROBE_OUT}" "$line"
    return 2
  fi
  table="$CRONTAB_PROBE_OUT"
  (( CRONTAB_PROBE_RC == 0 )) || table=""   # it ran and had nothing: an EMPTY table
  if printf '%s\n' "$table" | "$GREP" -qF watch-tick.sh; then
    printf 'ARM | ALREADY PRESENT (exit 3) | the crontab already carries a watch-tick.sh line; nothing written\n'
    return 3
  fi
  set +e
  { if [[ -n "$table" ]]; then printf '%s\n' "$table"; fi
    printf '%s\n' "$line"
  } | "$CRONTAB_CMD" -
  wrc=$?
  set -e
  if (( wrc != 0 )); then
    arm_unavailable "the write itself failed: the pipe into the crontab command returned rc=${wrc}" "$line"
    return 2
  fi
  printf 'ARM | ARMED (exit 0) | one line installed: %s\n' "$line"
  return 0
}

#==============================================================================
# ARGUMENT PARSING
#==============================================================================
while (( $# )); do
  case "$1" in
    --selftest)  DO_SELFTEST=1; shift ;;
    --cron-line) DO_CRON_LINE=1; shift ;;
    --arm)       DO_ARM=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    --*)         die_tool "unknown option: $1" ;;
    *)
      if [[ -z "$HOME_DIR" ]]; then HOME_DIR="$1"
      else die_tool "unexpected argument: $1"; fi
      shift ;;
  esac
done

[[ "$STALE_MIN"       =~ ^[0-9]+$ ]] || die_tool "WATCH_STALE_MIN must be a non-negative integer (got: ${STALE_MIN})"
[[ "$MERGE_STALE_MIN" =~ ^[0-9]+$ ]] || die_tool "WATCH_MERGE_STALE_MIN must be a non-negative integer (got: ${MERGE_STALE_MIN})"

#==============================================================================
# THE TICK
#==============================================================================
run_tick() {
  [[ -n "$HOME_DIR" ]] || die_tool "no project home given. Usage: watch-tick.sh <project-home> [--cron-line|--arm]"
  [[ -d "$HOME_DIR" ]] || die_tool "project home does not exist: ${HOME_DIR}"
  HOME_DIR="$(cd "$HOME_DIR" && pwd)"

  if (( DO_CRON_LINE )); then cron_line "$HOME_DIR"; exit 0; fi

  # --arm is the step-3 half and runs BEFORE self_prove and before any project
  # file is read: arming a project the plan has not reached yet is the whole
  # point of it (RC-19), so it may never depend on a plan file existing.
  if (( DO_ARM )); then
    local arc=0
    set +e; arm_tick "$HOME_DIR"; arc=$?; set -e
    exit "$arc"
  fi

  self_prove

  local CHK DL LED HB FLAG CAPLED
  CHK="$HOME_DIR/CONTROL/CHECKLIST.md"
  DL="$HOME_DIR/CONTROL/dispatch-log.md"
  LED="$HOME_DIR/CONTROL/LEDGER.md"
  HB="$HOME_DIR/CONTROL/HEARTBEAT.md"
  FLAG="$HOME_DIR/CONTROL/TERMINAL-DRIFT.flag"
  CAPLED="$HOME_DIR/CAPACITY-LEDGER.md"

  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick.XXXXXX")"

  #--------------------------------------------------------------------------
  # (1) THE RECONCILE — always first. It carries S10, S14, the recovery ladder
  #     and the capture-proof stop, and this tick has no standing to count
  #     anything on a project whose state layers disagree.
  #--------------------------------------------------------------------------
  local ANCHOR_NOTE="" ARC=0 AOUT="" PRE_PLAN=0
  if [[ "${WATCH_SKIP_ANCHOR:-0}" == "1" ]]; then
    ANCHOR_NOTE="skipped(WATCH_SKIP_ANCHOR)"
  else
    [[ -x "$ANCHOR_SH" ]] || die_tool "tools/anchor.sh is missing or not executable at ${ANCHOR_SH} — the tick reconciles before it counts"
    local -a AARGS
    AARGS=("$HOME_DIR" "IDLE" "--mode" "reconcile")
    [[ -f "$HOME_DIR/CONTROL/task-graph-snapshot.json" ]] && AARGS+=("--tasks" "$HOME_DIR/CONTROL/task-graph-snapshot.json")
    [[ -f "$HOME_DIR/CONTROL/project_state.json"       ]] && AARGS+=("--state" "$HOME_DIR/CONTROL/project_state.json")
    [[ -f "$HOME_DIR/CONTROL/last-intents.txt"         ]] && AARGS+=("--intents" "$HOME_DIR/CONTROL/last-intents.txt")
    set +e
    AOUT="$(bash "$ANCHOR_SH" "${AARGS[@]}" 2>&1)"; ARC=$?
    set -e
    case "$ARC" in
      0) if printf '%s\n' "$AOUT" | "$GREP" -q '^PRE-PLAN |'; then
           # anchor.sh's pre-plan arm exits 0 without checking for drift. Calling
           # that "reconcile-clean" would be an all-clear this tick cannot prove.
           ANCHOR_NOTE="pre-plan(no drift verdict claimed)"
           PRE_PLAN=1
         else ANCHOR_NOTE="reconcile-clean"; fi ;;
      3) ANCHOR_NOTE="reconcile-drift(exit 3)" ;;
      4) ANCHOR_NOTE="terminal-drift(exit 4)" ;;
      *) printf '%s\n' "$AOUT" >&2
         die_tool "anchor.sh exited ${ARC} (BROKEN INSTRUMENT or TOOLING FAILURE) — the reconcile did not complete, so no S-check verdict is claimed" ;;
    esac
    printf '%s\n' "$AOUT"
  fi

  # The stop gate. anchor.sh clears the flag itself when a fresh session has
  # named the blocker on CONTROL/TODO.md, so the flag is read AFTER the
  # reconcile, never before it.
  if (( ARC == 4 )) || [[ -f "$FLAG" ]]; then
    printf 'TERMINAL-DRIFT | flag present: %s\n' "$FLAG"
    printf 'TERMINAL-DRIFT | the tick counts nothing and writes no S-CHECK line while this file exists — the flag IS the state, and anchor.sh already recorded it. Name the blocker in %s/CONTROL/TODO.md as a row starting "- [x] BLOCKER-NAMED | <the blocker> | session=<this session>" and the next tick clears it.\n' "$HOME_DIR"
    exit 4
  fi

  # THE PRE-PLAN TICK (RC-19). anchor.sh said the plan files are not due yet —
  # the run has not reached step 6.5. The S-checks below read CHECKLIST.md for
  # their runnable count, and dying there would put the TOOLING FAILURE back in
  # watch-tick.log every five minutes: the exact canary failure this arm
  # exists to end. So the tick degrades the same way the reconcile did: the
  # counts it cannot take are named undetermined(pre-plan), no verdict line is
  # written (a violations=0 count would be an all-clear it cannot prove), exit 0.
  # Once the plan exists this branch never fires and the full S-check runs.
  if (( PRE_PLAN == 1 )); then
    printf 'PRE-PLAN | the tick takes no counts before step 6.5: runnable/open/trees=undetermined(pre-plan: CONTROL/CHECKLIST.md not yet written — the runnable count has no source) | S2,S3,S5,S6,S13,bar=undetermined(pre-plan: the plan files they read do not exist yet)\n'
    printf 'PRE-PLAN | this line carries no verdict — an all-clear before the plan exists is not provable, and a TOOLING FAILURE for files the run has not reached is the failure RC-19 closed. Exit 0.\n'
    return 0
  fi

  [[ -f "$CHK" ]] || die_tool "CONTROL/CHECKLIST.md is missing at ${CHK} — the runnable count has no source. Checked: ${CHK}. Not checked: the dispatch log and the heartbeat, because the run stopped here."

  #--------------------------------------------------------------------------
  # (2) THE THREE COUNTS.
  #--------------------------------------------------------------------------
  local UNDET=""
  add_undet() { if [[ -z "$UNDET" ]]; then UNDET="$1"; else UNDET="${UNDET},$1"; fi; }

  # --- results: units with a `| RESULT |` line in the ledger
  : > "$WORKDIR/results.txt"
  if [[ -f "$LED" ]]; then awk_results "$LED" > "$WORKDIR/results.txt" || true; fi

  # --- rows: unit \t stage \t label-ok \t tree \t ts \t label
  : > "$WORKDIR/rows.tsv"
  local DL_STATE="proven"
  if [[ -f "$DL" ]]; then
    awk_rows "$DL" > "$WORKDIR/rows.tsv" || die_tool "the dispatch-log parser failed on ${DL}"
    if [[ ! -s "$WORKDIR/rows.tsv" ]]; then
      # Content but no parseable row is a PARSE FAILURE, never an empty log.
      local nonblank heads content
      nonblank="$("$GREP" -c '[^[:space:]]' "$DL" || true)"
      heads="$("$GREP" -cE '^[[:space:]]*(#|-{3,}|\|)' "$DL" || true)"
      content=$(( nonblank - heads ))
      if (( content > 0 )); then
        DL_STATE="undetermined"
        add_undet "open=undetermined(dispatch-log-unparseable: CONTROL/dispatch-log.md has content but no timestamped row)"
      fi
    fi
  else
    DL_STATE="undetermined"
    add_undet "open=undetermined(no-dispatch-log: CONTROL/dispatch-log.md does not exist — an absent log is not a census of zero)"
  fi

  # --- split the rows into open (no RESULT for the unit) and closed
  : > "$WORKDIR/open.tsv"
  : > "$WORKDIR/closed.tsv"
  local u stage lok tree ts label
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    if "$GREP" -qxF -- "$u" "$WORKDIR/results.txt" 2>/dev/null; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$stage" "$lok" "$tree" "$ts" "$label" >> "$WORKDIR/closed.tsv"
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$stage" "$lok" "$tree" "$ts" "$label" >> "$WORKDIR/open.tsv"
    fi
  done < "$WORKDIR/rows.tsv"

  local OPEN
  OPEN="$("$GREP" -c '[^[:space:]]' "$WORKDIR/open.tsv" || true)"
  [[ -n "$OPEN" ]] || OPEN=0

  # --- open units, for the runnable count
  cut -f1 "$WORKDIR/open.tsv" | LC_ALL=C sort -u > "$WORKDIR/open-units.txt"

  # --- runnable: open checklist boxes with no open row
  awk_checklist "$CHK" | LC_ALL=C sort -u > "$WORKDIR/open-boxes.txt"
  comm -23 "$WORKDIR/open-boxes.txt" "$WORKDIR/open-units.txt" > "$WORKDIR/runnable.txt"
  local RUNNABLE
  RUNNABLE="$("$GREP" -c '[^[:space:]]' "$WORKDIR/runnable.txt" || true)"
  [[ -n "$RUNNABLE" ]] || RUNNABLE=0

  # --- trees: distinct run ids among the open rows; unkeyed rows are named,
  #     never promoted into a tree count.
  cut -f4 "$WORKDIR/open.tsv" | "$GREP" -v '^[[:space:]]*$' | LC_ALL=C sort -u > "$WORKDIR/trees.txt" || true
  local TREES UNKEYED
  TREES="$("$GREP" -c '[^[:space:]]' "$WORKDIR/trees.txt" || true)"
  [[ -n "$TREES" ]] || TREES=0
  UNKEYED="$(cut -f4 "$WORKDIR/open.tsv" | "$GREP" -c '^[[:space:]]*$' || true)"
  [[ -n "$UNKEYED" ]] || UNKEYED=0
  local TREE_NOTE="$TREES"
  if (( UNKEYED > 0 )); then
    TREE_NOTE="${TREES}(+${UNKEYED} rows with no run id)"
    add_undet "trees=partial(${UNKEYED} open rows carry no run id, so they are in no tree)"
  fi

  # --- the width, for S5
  local CAP="" CAP_NOTE=""
  if [[ -n "${WATCH_CLIENT_CAP:-}" ]]; then
    [[ "${WATCH_CLIENT_CAP}" =~ ^[0-9]+$ ]] || die_tool "WATCH_CLIENT_CAP must be a non-negative integer (got: ${WATCH_CLIENT_CAP})"
    CAP="$WATCH_CLIENT_CAP"; CAP_NOTE="${CAP}[env WATCH_CLIENT_CAP]"
  elif [[ -f "$CAPLED" ]]; then
    CAP="$(sed -n 's/.*CLIENT_CAP[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$CAPLED" | head -1)"
    if [[ -z "$CAP" ]]; then
      CAP="$(sed -n 's/.*clientCap[^=]*=[^=]*=[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$CAPLED" | head -1)"
    fi
    if [[ -z "$CAP" ]]; then
      CAP_NOTE="undetermined(CAPACITY-LEDGER.md present but carries no CLIENT_CAP= or clientCap … = <n> value)"
      add_undet "S5=undetermined(no width in CAPACITY-LEDGER.md)"
    else
      CAP_NOTE="${CAP}[CAPACITY-LEDGER.md]"
    fi
  else
    CAP_NOTE="undetermined(no CAPACITY-LEDGER.md — an absent ledger is not a width of zero)"
    add_undet "S5=undetermined(no CAPACITY-LEDGER.md)"
  fi

  #--------------------------------------------------------------------------
  # (3) THE HEARTBEAT MAP — newest stamp per unit and per agent label.
  #--------------------------------------------------------------------------
  : > "$WORKDIR/hb-unit.tsv"
  : > "$WORKDIR/hb-label.tsv"
  local HB_UNPARSED=0
  if [[ -f "$HB" ]]; then
    local hu hl hts hep
    while IFS=$'\t' read -r hu hl hts; do
      [[ -n "$hts" ]] || continue
      if hep="$(iso_to_epoch "$hts")"; then
        [[ -n "$hu" ]] && printf '%s\t%s\n' "$hu" "$hep" >> "$WORKDIR/hb-unit.tsv"
        [[ -n "$hl" ]] && printf '%s\t%s\n' "$hl" "$hep" >> "$WORKDIR/hb-label.tsv"
      else
        HB_UNPARSED=$(( HB_UNPARSED + 1 ))
      fi
    done < <(awk_heartbeat "$HB")
  fi
  if (( HB_UNPARSED > 0 )); then
    add_undet "heartbeat=partial(${HB_UNPARSED} lines in CONTROL/HEARTBEAT.md carry a timestamp this tick cannot parse; those rows' ages are UNDETERMINED and neither S6 nor S13 fires on them)"
  fi

  hb_epoch_for() {  # hb_epoch_for <unit> <label> -> newest epoch, or rc 1
    local want_u="$1" want_l="$2" best="" k v
    while IFS=$'\t' read -r k v; do
      [[ "$k" == "$want_u" ]] || continue
      if [[ -z "$best" || "$v" -gt "$best" ]]; then best="$v"; fi
    done < "$WORKDIR/hb-unit.tsv"
    if [[ -z "$best" && -n "$want_l" ]]; then
      while IFS=$'\t' read -r k v; do
        [[ "$k" == "$want_l" ]] || continue
        if [[ -z "$best" || "$v" -gt "$best" ]]; then best="$v"; fi
      done < "$WORKDIR/hb-label.tsv"
    fi
    [[ -n "$best" ]] || return 1
    printf '%s\n' "$best"
  }

  stale_min_for() {  # stale_min_for <stage> -> the threshold in minutes
    local s
    s="$(printf '%s' "$1" | tr 'A-Z' 'a-z')"
    case "$s" in *merge*) printf '%s\n' "$MERGE_STALE_MIN" ;; *) printf '%s\n' "$STALE_MIN" ;; esac
  }

  #--------------------------------------------------------------------------
  # (4) THE S-CHECKS.
  #--------------------------------------------------------------------------
  local V=0 VERBS="" NOW
  NOW="$(epoch_now)"
  : > "$WORKDIR/actions.txt"
  emit() {  # emit <verb> <target> <evidence>
    printf 'ACTION|%s|%s|%s\n' "$1" "$(sanitize "$2")" "$(sanitize "$3")" >> "$WORKDIR/actions.txt"
    V=$(( V + 1 ))
    case ",${VERBS}," in *",$1,"*) : ;; *) if [[ -z "$VERBS" ]]; then VERBS="$1"; else VERBS="${VERBS},$1"; fi ;; esac
  }

  # S10/S14 — anchor.sh's own finding is this tick's finding. Its ACTION lines
  # are already on stdout above; they are counted here so the S-CHECK line's
  # violation count is the whole tick's, not this script's half of it.
  if (( ARC == 3 )); then
    V=$(( V + 1 ))
    VERBS="anchor-drift"
  fi

  # S2 — ZERO-WORKFLOW, the worst violation. Only on a PROVEN zero: an absent
  # or unparseable dispatch log is undetermined, and this check does not fire
  # on an undetermined open count.
  if (( RUNNABLE > 0 )) && (( OPEN == 0 )) && [[ "$DL_STATE" == "proven" ]]; then
    emit "dispatch-now" "$(head -3 "$WORKDIR/runnable.txt" | tr '\n' ' ')" \
      "S2 zero-workflow: runnable=${RUNNABLE} open=0 — runnable work with no open dispatch row is an EMERGENCY; dispatch every runnable unit in the SAME turn (SKILL.md RULE 5 S2)"
  fi

  # S3 — every open row carries a visible [<model> x<N>] label.
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    if [[ "$lok" != "1" ]]; then
      emit "relabel-and-redispatch" "$u" \
        "S3 label: the open row for unit=${u} stage=${stage} carries no [<model> x<N>] label (label field: '${label:-<empty>}') — the operator cannot see how wide this tree is; kill it and re-launch with the prefix (SKILL.md RULE 5 S3)"
    fi
  done < "$WORKDIR/open.tsv"

  # S5 — no capacity sits idle while dispatchable work exists.
  if [[ -n "$CAP" ]] && (( RUNNABLE > 0 )) && (( TREES > 0 )); then
    local ROOM=$(( CAP * TREES ))
    if (( OPEN < ROOM )); then
      emit "widen" "${TREES} tree(s)" \
        "S5 idle capacity: open=${OPEN} < CLIENT_CAP ${CAP} x trees ${TREES} = ${ROOM} while runnable=${RUNNABLE} — widen the running trees or launch another one; never under-dispatch (SKILL.md RULE 5 S5)"
    fi
  fi

  # S6 — heartbeat freshness on every OPEN row. A row with no heartbeat AT ALL
  # is judged by its own dispatch timestamp: an agent that died before its
  # first stamp leaves no line, so the heartbeat can never be the only witness
  # (references/loops.md Loop 5's trap). A row younger than the threshold with
  # no stamp yet is not late; it is new.
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    local thr age src ep
    thr="$(stale_min_for "$stage")"
    if ep="$(hb_epoch_for "$u" "$label")"; then src="heartbeat"
    elif ep="$(iso_to_epoch "$ts")"; then src="dispatch row (no heartbeat line at all — died at launch, or never stamped)"
    else
      add_undet "S6=undetermined(unit=${u}: neither a parseable heartbeat nor a parseable dispatch timestamp '${ts}')"
      continue
    fi
    age=$(( (NOW - ep) / 60 ))
    if (( age > thr )); then
      emit "reap-and-redispatch" "$u" \
        "S6 stale: unit=${u} stage=${stage} last stamped ${age} min ago by its ${src}, past the ${thr}-minute threshold — stale is DEAD, not slow; TaskStop it and re-dispatch from its slice (SKILL.md RULE 5 S6)"
    fi
  done < "$WORKDIR/open.tsv"

  # S13 — finished but alive. A RESULT is on the ledger and the agent is still
  # stamping: a done agent that keeps running reads as work, and a ticking
  # timer is never progress.
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    local thr age ep
    thr="$(stale_min_for "$stage")"
    if ep="$(hb_epoch_for "$u" "$label")"; then
      age=$(( (NOW - ep) / 60 ))
      if (( age <= thr )); then
        emit "reap" "$u" \
          "S13 finished-but-alive: unit=${u} has a RESULT line on CONTROL/LEDGER.md and its heartbeat is still fresh (${age} min old, threshold ${thr}) — TaskStop it and note the reap in the ledger (SKILL.md RULE 5 S13)"
      fi
    fi
  done < "$WORKDIR/closed.tsv"

  # THE BAR — the two files SKILL.md §12 tells the conductor to write, proven
  # by tools/bar-check.sh. The bar's own contract (references/progress-visibility.md
  # §6) decides when a missing input is a finding rather than a normal state:
  #
  #   project_state.json present, tasks.counts absent  -> FINDING. The plan
  #     exists and the pieces segment still has nothing to read. This is the
  #     live shape from the canary run: a state file carrying task_graph.units
  #     and no tasks key at all.
  #   neither input present                            -> FINDING. The bar has
  #     no progress segment it can render, in either phase of the run.
  #   no project_state.json yet, setup_progress.json being written -> PASS.
  #     Before the plan exists `Getting ready: step n of 9` IS the segment.
  #   present but unparseable                          -> FINDING (fix-bar-input):
  #     a file the bar cannot read renders exactly as blank as a missing one.
  #
  # bar-check.sh writes nothing and never touches the project.
  local BAR_NOTE="" BRC=0 BOUT="" BMISS="" BMAL=""
  if [[ ! -f "$BAR_CHECK_SH" ]]; then
    BAR_NOTE="undetermined(no bar-check.sh at ${BAR_CHECK_SH})"
    add_undet "bar=undetermined(tools/bar-check.sh absent — the two status-bar inputs were not checked)"
  else
    set +e
    BOUT="$(bash "$BAR_CHECK_SH" "$HOME_DIR" 2>&1)"; BRC=$?
    set -e
    BMISS="$(printf '%s\n' "$BOUT" | "$AWK" '/^BAR-CHECK /{for(i=1;i<=NF;i++) if ($i ~ /^missing=/)   { sub(/^missing=/,   "", $i); print $i; exit } }')"
    BMAL="$( printf '%s\n' "$BOUT" | "$AWK" '/^BAR-CHECK /{for(i=1;i<=NF;i++) if ($i ~ /^malformed=/) { sub(/^malformed=/, "", $i); print $i; exit } }')"
    bar_missing() { case ",${BMISS}," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
    case "$BRC" in
      0)
        BAR_NOTE="ok(both inputs present)" ;;
      3)
        if bar_missing "CONTROL/project_state.json:tasks.counts"; then
          BAR_NOTE="missing(${BMISS})"
          emit "write-bar-inputs" "${BMISS}" \
            "BAR: the plan exists and the pieces segment has no counts to read — write tasks.counts at every checkpoint (SKILL.md §12; shapes in references/progress-visibility.md §6)"
        elif bar_missing "CONTROL/project_state.json" \
             && { bar_missing "CONTROL/setup_progress.json" || bar_missing "CONTROL/setup_progress.json:step"; }; then
          BAR_NOTE="missing(${BMISS})"
          emit "write-bar-inputs" "${BMISS}" \
            "BAR: no file behind either progress segment, so the client bar shows nothing there all run — write them (SKILL.md §12; shapes in references/progress-visibility.md §6)"
        else
          BAR_NOTE="getting-ready(pre-plan; ${BMISS})"
        fi ;;
      2)
        if [[ -n "$BMAL" && "$BMAL" != "none" ]]; then
          BAR_NOTE="malformed(${BMAL})"
          emit "fix-bar-input" "${BMAL}" \
            "BAR: present and unparseable, so the bar drops that segment — a file it cannot read is as blank as one that is not there (references/progress-visibility.md §6)"
        else
          BAR_NOTE="undetermined(bar-check.sh exit 2, no file named)"
          add_undet "bar=undetermined(bar-check.sh could not run: $(printf '%s' "$BOUT" | "$GREP" -m1 'UNDETERMINED (exit 2)' || printf 'no reason line'))"
        fi ;;
      *)
        BAR_NOTE="undetermined(bar-check.sh exit ${BRC})"
        add_undet "bar=undetermined(bar-check.sh exited ${BRC}, an exit this tick does not recognise — the bar inputs were not proven)" ;;
    esac
  fi

  #--------------------------------------------------------------------------
  # (5) THE LINE. Every watch line carries the violation count, even when it
  #     is zero: `S-CHECK | violations=0` is state; a contentless tick is the
  #     disease this loop exists to stop (references/loops.md Loop 9).
  #--------------------------------------------------------------------------
  [[ -s "$WORKDIR/actions.txt" ]] && cat "$WORKDIR/actions.txt"

  local ACTS="none"
  [[ -n "$VERBS" ]] && ACTS="$VERBS"
  local UND="none"
  [[ -n "$UNDET" ]] && UND="$UNDET"

  local LINE
  LINE="$(iso_now) | S-CHECK | violations=${V} | runnable=${RUNNABLE} open=${OPEN} trees=${TREES} | cap=${CAP_NOTE} | anchor=${ANCHOR_NOTE} | bar=$(sanitize "$BAR_NOTE") | trees-detail=${TREE_NOTE} | actions=$(sanitize "$ACTS") | undetermined=$(sanitize_long "$UND")"
  ledger_write "CONTROL/LEDGER.md" "$LINE"
  printf '%s\n' "$LINE"

  if (( V > 0 )); then return 3; fi
  return 0
}

#==============================================================================
# SELFTEST
#
#   1  S2  runnable > 0 and open == 0            -> exit 3, ACTION|dispatch-now
#   2  S3  an open row with no [<model> x<N>]    -> exit 3, ACTION|relabel-…
#   3  S6  a heartbeat 11 minutes old            -> exit 3, ACTION|reap-and-redispatch
#   4  CLEAN — an open, labelled, freshly-stamped row and nothing runnable
#          -> exit 0 and exactly one `S-CHECK | violations=0` ledger line
#   5  THE FLAG — CONTROL/TERMINAL-DRIFT.flag present -> exit 4
#   6  S13 a RESULT on the ledger and a fresh heartbeat -> exit 3, ACTION|reap
#   7  S5  open rows below CLIENT_CAP x trees while runnable > 0 -> ACTION|widen
#   8  BROKEN INSTRUMENT — the label detector sabotaged MUST be caught (exit 2)
#   9  A MISSING PROJECT is exit 2 NAMING THE PATH, never a verdict
#  10  UNDETERMINED, not a violation — no dispatch log and no capacity ledger:
#      S2 does not fire on an unproven zero and S5 says so in writing
#  11  THE BAR with no file behind either segment -> exit 3, ACTION|write-bar-inputs
#      naming both. Cases 1-10 all write CONTROL/setup_progress.json and none of
#      them fires it: that is the negative control for this check.
#  12  THE BAR on the live shape — project_state.json present and parseable with
#      no tasks key -> exit 3, ACTION|write-bar-inputs naming tasks.counts
#  13  --arm, THE FIRST ARM, against a FIXTURE crontab file: exactly one line
#      added at exit 0, and the line already in the fixture survives
#  14  --arm again on the same fixture: exit 3, nothing written, still one line
#  15  --arm with the crontab command UNAVAILABLE: exit 2, the degradation
#      NAMED on stdout, and the fixture table left untouched
#      Cases 13-15 arm a FIXTURE FILE. No case here reads or writes the
#      operator's crontab, which is the control that makes them safe to run.
#  16  THE PRE-PLAN TICK (RC-19): a project with no plan files and no step-6.5
#      mark exits 0 with PRE-PLAN lines naming every count undetermined and NO
#      verdict line in the ledger — and the SAME project with the plan files
#      present produces one, the control proving the silence is the phase.
#==============================================================================
selftest() {
  local T PASSES=0 FAILS=0 RC OUT ok
  SELFTEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick-selftest.XXXXXX")"
  T="$SELFTEST_TMP"

  mk_home() {  # mk_home <dir>
    mkdir -p "$1/SPEC" "$1/CONTROL"
    printf 'Goal: build the thing.\n' > "$1/SPEC/GOAL.md"
    # The pre-plan bar input, written the way SKILL.md §12 instructs. Every
    # fixture below carries it, so the bar check is SILENT in all of them and
    # cases 11 and 12 are the only places it can fire — which is what proves it
    # discriminates rather than firing on everything. project_state.json is
    # deliberately NOT written here: it is anchor.sh's reconcile input, and
    # these fixtures own their anchor state.
    printf '{"step":4,"of":9}\n' > "$1/CONTROL/setup_progress.json"
    printf -- '- [x] U-01 build the parser\n- [ ] U-02 qc the parser\n' > "$1/CONTROL/CHECKLIST.md"
    printf -- '- [ ] U-02 qc the parser\n' > "$1/CONTROL/TODO.md"
  }
  stamp() {  # stamp <minutes-ago> -> an ISO8601 UTC timestamp
    local m="$1" e
    e=$(( $(date -u +%s) - m * 60 ))
    TZ=UTC date -r "$e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null && return 0
    date -u -d "@${e}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null && return 0
    return 1
  }
  report() {  # report <n> <name> <ok:0/1> <detail>
    if (( $3 == 1 )); then
      printf 'PASS | case %s | %s | %s\n' "$1" "$2" "$4"; PASSES=$(( PASSES + 1 ))
    else
      printf 'FAIL | case %s | %s | %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 ))
    fi
  }
  runw() {  # runw <args...> -> sets RC and OUT
    set +e
    OUT="$(bash "$SELF" "$@" 2>&1)"; RC=$?
    set -e
  }

  # --- case 1: S2 — runnable work and zero open dispatch rows.
  mk_home "$T/c1"
  printf -- '- [ ] U-01 build the parser\n- [ ] U-02 qc the parser\n' > "$T/c1/CONTROL/CHECKLIST.md"
  printf '# Dispatch log\n' > "$T/c1/CONTROL/dispatch-log.md"
  runw "$T/c1"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|dispatch-now|' \
     && printf '%s' "$OUT" | "$GREP" -q 'runnable=2 open=0 trees=0' \
     && "$GREP" -q 'S-CHECK | violations=1' "$T/c1/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 1 "S2-dispatch-now" "$ok" "rc=${RC} (want 3); ACTION|dispatch-now emitted; runnable=2 open=0 trees=0; the S-CHECK line carries the count"

  # --- case 2: S3 — an open row with no [<model> x<N>] label. Nothing is
  #     runnable and the heartbeat is fresh, so S3 is the ONLY thing that can
  #     fire: the case isolates the label detector.
  mk_home "$T/c2"
  printf '%s | U-02 qc | qc | WF01 judge | run-002\n' "$(stamp 1)" > "$T/c2/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c2/CONTROL/HEARTBEAT.md"
  runw "$T/c2"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|relabel-and-redispatch|U-02|' \
     && printf '%s' "$OUT" | "$GREP" -q 'runnable=0 open=1 trees=1' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|reap'; then ok=1; fi
  report 2 "S3-unlabelled-row" "$ok" "rc=${RC} (want 3); ACTION|relabel-and-redispatch for U-02; runnable=0 open=1 trees=1; no reap (the row is fresh — S3 fired alone)"

  # --- case 3: S6 — a heartbeat eleven minutes old, past the ten-minute
  #     threshold. The row IS labelled, so S3 must stay silent (the negative
  #     control for the detector, live in the same fixture).
  mk_home "$T/c3"
  printf '%s | U-02 qc | qc | [sonnet x4] WF01 judge | run-003\n' "$(stamp 12)" > "$T/c3/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 11)" > "$T/c3/CONTROL/HEARTBEAT.md"
  runw "$T/c3"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reap-and-redispatch|U-02|' \
     && printf '%s' "$OUT" | "$GREP" -q 'S6 stale' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|relabel-and-redispatch'; then ok=1; fi
  report 3 "S6-stale-heartbeat" "$ok" "rc=${RC} (want 3); ACTION|reap-and-redispatch for U-02 at 11 min > 10; the [sonnet x4] label was ACCEPTED (negative control for S3 held)"

  # --- case 4: THE CLEAN PATH. One open unit, labelled, stamped a minute ago,
  #     nothing runnable behind it. Exit 0 and exactly ONE
  #     `S-CHECK | violations=0` line in the fixture ledger.
  mk_home "$T/c4"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-004\n' "$(stamp 1)" > "$T/c4/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c4/CONTROL/HEARTBEAT.md"
  runw "$T/c4"
  ok=0
  local n_sc
  n_sc="$("$GREP" -c 'S-CHECK | violations=0 | runnable=0 open=1 trees=1' "$T/c4/CONTROL/LEDGER.md" 2>/dev/null || true)"
  if (( RC == 0 )) && [[ "$n_sc" == "1" ]] \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|'; then ok=1; fi
  report 4 "clean" "$ok" "rc=${RC} (want 0); exactly ${n_sc} 'S-CHECK | violations=0 | runnable=0 open=1 trees=1' line in the fixture ledger (want 1); no ACTION line"

  # --- case 5: THE FLAG. Nothing counts while the capture-proof stop exists.
  mk_home "$T/c5"
  printf 'TERMINAL-DRIFT after 6 no-delta reconciles\n' > "$T/c5/CONTROL/TERMINAL-DRIFT.flag"
  runw "$T/c5"
  ok=0
  if (( RC == 4 )) && printf '%s' "$OUT" | "$GREP" -q 'TERMINAL-DRIFT' \
     && ! "$GREP" -q 'S-CHECK' "$T/c5/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 5 "terminal-drift-flag" "$ok" "rc=${RC} (want 4); the flag was named; NO S-CHECK line written (the flag IS the state)"

  # --- case 6: S13 — the RESULT is written and the agent is still stamping.
  mk_home "$T/c6"
  printf '%s | U-01 build | build | [opus x10] WF01 builder | run-006\n' "$(stamp 3)" > "$T/c6/CONTROL/dispatch-log.md"
  printf '%s | WF01 builder | U-01 | build\n' "$(stamp 1)" > "$T/c6/CONTROL/HEARTBEAT.md"
  {
    printf '%s | CLAIM | unit=U-01 | plan=build the parser\n' "$(stamp 4)"
    printf '%s | RESULT | unit=U-01 | verdict=PASS\n' "$(stamp 2)"
  } > "$T/c6/CONTROL/LEDGER.md"
  runw "$T/c6"
  ok=0
  if (( RC == 3 )) && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reap|U-01|' \
     && printf '%s' "$OUT" | "$GREP" -q 'S13 finished-but-alive'; then ok=1; fi
  report 6 "S13-finished-but-alive" "$ok" "rc=${RC} (want 3); ACTION|reap for U-01 — RESULT on the ledger, heartbeat still fresh"

  # --- case 7: S5 — one tree at cap 10 holding one open row while three units
  #     wait. Idle capacity with dispatchable work is a violation.
  mk_home "$T/c7"
  printf -- '- [ ] U-02 qc\n- [ ] U-03 build\n- [ ] U-04 build\n- [ ] U-05 build\n' > "$T/c7/CONTROL/CHECKLIST.md"
  printf 'clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n' > "$T/c7/CAPACITY-LEDGER.md"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-007\n' "$(stamp 1)" > "$T/c7/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c7/CONTROL/HEARTBEAT.md"
  runw "$T/c7"
  ok=0
  if (( RC == 3 )) && printf '%s' "$OUT" | "$GREP" -q '^ACTION|widen|' \
     && printf '%s' "$OUT" | "$GREP" -q 'CLIENT_CAP 10 x trees 1 = 10' \
     && printf '%s' "$OUT" | "$GREP" -q 'cap=10\[CAPACITY-LEDGER.md\]'; then ok=1; fi
  report 7 "S5-widen" "$ok" "rc=${RC} (want 3); ACTION|widen with open=1 < 10 x 1 while runnable=3; the width was READ from CAPACITY-LEDGER.md, never assumed"

  # --- case 8: BROKEN INSTRUMENT. Sabotage the label detector so it accepts
  #     everything; the embedded controls MUST catch it and refuse to report.
  mk_home "$T/c8"
  set +e
  OUT="$(WATCH_TICK_SELFTEST_BREAK_LABEL=1 bash "$SELF" "$T/c8" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'BROKEN INSTRUMENT' \
     && printf '%s' "$OUT" | "$GREP" -q 'NEGATIVE control failed'; then ok=1; fi
  report 8 "broken-instrument" "$ok" "rc=${RC} (want 2); named BROKEN INSTRUMENT on the first NEGATIVE control (the no-bracket row) and refused to report clean; the bracket-with-no-count TRAP is the next control in line and is asserted on every ordinary run"

  # --- case 9: a missing project home is exit 2 NAMING THE PATH.
  runw "$T/does-not-exist"
  ok=0
  if (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'does-not-exist'; then ok=1; fi
  report 9 "missing-project" "$ok" "rc=${RC} (want 2); the message NAMES the path it checked"

  # --- case 10: UNDETERMINED is not a violation. No dispatch log at all and no
  #     capacity ledger: an absent log is not a proven zero, so S2 must NOT
  #     fire, and S5 must say in writing that it had no width to compare with.
  mk_home "$T/c10"
  printf -- '- [ ] U-02 qc the parser\n- [ ] U-03 build\n' > "$T/c10/CONTROL/CHECKLIST.md"
  runw "$T/c10"
  ok=0
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|dispatch-now|' \
     && printf '%s' "$OUT" | "$GREP" -q 'no-dispatch-log' \
     && printf '%s' "$OUT" | "$GREP" -q 'S5=undetermined(no CAPACITY-LEDGER.md)' \
     && "$GREP" -q 'S-CHECK | violations=0' "$T/c10/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 10 "undetermined-not-violation" "$ok" "rc=${RC} (want 0); S2 did NOT fire on an absent dispatch log; the S-CHECK line names both undetermined counts"

  # --- case 11: THE BAR, with no file behind either segment. Cases 1-10 all
  #     carry CONTROL/setup_progress.json and none of them fires this check;
  #     remove it, with no project_state.json either, and the bar has nothing
  #     to render in either phase of the run. That pair is the discrimination.
  mk_home "$T/c11"
  rm -f "$T/c11/CONTROL/setup_progress.json"
  runw "$T/c11"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|write-bar-inputs|CONTROL/setup_progress.json,CONTROL/project_state.json|' \
     && printf '%s' "$OUT" | "$GREP" -q 'bar=missing(CONTROL/setup_progress.json,CONTROL/project_state.json)'; then ok=1; fi
  report 11 "bar-inputs-missing" "$ok" "rc=${RC} (want 3); ACTION|write-bar-inputs NAMING both files; the S-CHECK line carries bar=missing(…) — and cases 1-10, which write setup_progress.json, stayed silent"

  # --- case 12: THE LIVE SHAPE. project_state.json exists and parses and
  #     carries task_graph.units instead of a tasks key, exactly as the canary
  #     run's did, so the pieces segment has no counts to read. The reconcile is
  #     skipped here because this fixture's state file is the SUBJECT of the
  #     check, not an anchor input.
  mk_home "$T/c12"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","phase":"T-07","task_graph":{"units":[]}}\n' \
    > "$T/c12/CONTROL/project_state.json"
  set +e
  OUT="$(WATCH_SKIP_ANCHOR=1 bash "$SELF" "$T/c12" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|write-bar-inputs|CONTROL/project_state.json:tasks.counts|' \
     && printf '%s' "$OUT" | "$GREP" -q 'bar=missing(CONTROL/project_state.json:tasks.counts)'; then ok=1; fi
  report 12 "bar-counts-missing" "$ok" "rc=${RC} (want 3); a state file that EXISTS and parses is still a finding when tasks.counts is absent — the canary shape, named"

  # --- case 13: --arm, THE FIRST ARM. WATCH_TICK_CRONTAB_FILE is the whole
  #     instrument, so no crontab process runs at all: the operator's table is
  #     neither read nor written here or in cases 14-15. One line is added, and
  #     the line already in the fixture survives — an append, not a clobber.
  mk_home "$T/c13"
  local CF13="$T/c13/crontab.fixture" n13 keep13
  printf '0 3 * * * /usr/bin/true\n' > "$CF13"
  set +e
  OUT="$(WATCH_TICK_CRONTAB_FILE="$CF13" bash "$SELF" --arm "$T/c13" 2>&1)"; RC=$?
  set -e
  n13="$("$GREP" -c 'watch-tick.sh' "$CF13" || true)"
  keep13="$("$GREP" -c '/usr/bin/true' "$CF13" || true)"
  ok=0
  if (( RC == 0 )) && [[ "$n13" == "1" && "$keep13" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^ARM | ARMED (exit 0)' \
     && "$GREP" -q '^\*/5 \* \* \* \* bash .*watch-tick.sh .*watch-tick.log' "$CF13"; then ok=1; fi
  report 13 "arm-first" "$ok" "rc=${RC} (want 0); the fixture table carries ${n13} watch-tick.sh line (want 1) in the shape --cron-line prints, and still carries its ${keep13} pre-existing line (want 1)"

  # --- case 14: THE SECOND ARM, same fixture. The guard SKILL.md section 12
  #     spells out, proven rather than described: exit 3, nothing written, the
  #     count STILL 1. Case 13 is this case's positive control.
  set +e
  OUT="$(WATCH_TICK_CRONTAB_FILE="$CF13" bash "$SELF" --arm "$T/c13" 2>&1)"; RC=$?
  set -e
  local n14; n14="$("$GREP" -c 'watch-tick.sh' "$CF13" || true)"
  ok=0
  if (( RC == 3 )) && [[ "$n14" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^ARM | ALREADY PRESENT (exit 3)'; then ok=1; fi
  report 14 "arm-idempotent" "$ok" "rc=${RC} (want 3); the count stayed at ${n14} (want 1) — a second arm adds nothing and says so"

  # --- case 15: THE CRONTAB IS UNAVAILABLE. The named command does not exist,
  #     so the probe comes back rc 127 — a shell abort, never a fact about the
  #     table. Exit 2, the degradation NAMED on STDOUT (stderr is discarded
  #     here on purpose, so the assertion can only pass on stdout), and the
  #     fixture table left untouched.
  mk_home "$T/c15"
  local CF15="$T/c15/crontab.fixture" n15
  : > "$CF15"
  set +e
  OUT="$(WATCH_TICK_CRONTAB_FILE="$CF15" WATCH_TICK_CRONTAB_CMD="$T/c15/no-such-crontab" \
         bash "$SELF" --arm "$T/c15" 2>/dev/null)"; RC=$?
  set -e
  n15="$("$GREP" -c 'watch-tick.sh' "$CF15" || true)"
  ok=0
  if (( RC == 2 )) && [[ "$n15" == "0" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'THE DEGRADATION, NAMED' \
     && printf '%s' "$OUT" | "$GREP" -q 'the tick is NOT armed' \
     && printf '%s' "$OUT" | "$GREP" -q 'rc=127'; then ok=1; fi
  report 15 "arm-crontab-unavailable" "$ok" "rc=${RC} (want 2); the degradation is NAMED on stdout with the probe's own rc=127; the fixture table still carries ${n15} watch-tick.sh line(s) (want 0) — nothing written, nothing claimed"

  # --- case 16: THE PRE-PLAN TICK. anchor.sh's degradation (RC-19) reports the
  #     plan files are not due yet; the tick must NOT then die on its own
  #     CHECKLIST gate — 40 TOOLING FAILUREs in the canary's watch-tick.log is
  #     the failure this closes — and must NOT write a verdict either: a
  #     violations=0 line before the plan exists is an all-clear it cannot
  #     prove. The control is the same project WITH its plan files: it gets a
  #     real S-CHECK line, so the silence is the phase and not a broken writer.
  mk_home "$T/c16pre"
  rm -f "$T/c16pre/CONTROL/CHECKLIST.md" "$T/c16pre/CONTROL/TODO.md"
  set +e
  OUT="$(bash "$SELF" "$T/c16pre" 2>&1)"; RC=$?
  set -e
  local n_sc16
  n_sc16="$("$GREP" -cF 'S-CHECK' "$T/c16pre/CONTROL/LEDGER.md" 2>/dev/null || true)"
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^PRE-PLAN [|]' \
     && printf '%s' "$OUT" | "$GREP" -q 'undetermined(pre-plan)' \
     && [[ "$n_sc16" == "0" ]]; then ok=1; fi
  report 16 "pre-plan-tick" "$ok" "rc=${RC} (want 0); PRE-PLAN lines name the unchecked counts undetermined(pre-plan); the fixture ledger carries ${n_sc16} verdict line(s) (want 0 — no verdict before the plan exists); NO TOOLING FAILURE for files the run has not reached"
  # the control: plan files restored, the SAME project writes a real verdict.
  printf -- '- [ ] U-02 qc the parser\n' > "$T/c16pre/CONTROL/CHECKLIST.md"
  printf -- '- [ ] U-02 qc the parser\n' > "$T/c16pre/CONTROL/TODO.md"
  set +e
  OUT="$(bash "$SELF" "$T/c16pre" 2>&1)"; RC=$?
  set -e
  n_sc16="$("$GREP" -cF 'S-CHECK' "$T/c16pre/CONTROL/LEDGER.md" 2>/dev/null || true)"
  ok=0
  if (( RC == 0 )) && [[ "$n_sc16" == "1" ]] \
     && ! printf '%s' "$OUT" | "$GREP" -q '^PRE-PLAN [|]'; then ok=1; fi
  report 16 "post-plan-tick-control" "$ok" "rc=${RC} (want 0); the same project with its plan files written now carries ${n_sc16} verdict line (want 1) and no PRE-PLAN lines — the silence in the first leg is the phase, not a broken writer"

  printf '\n%s\n' "-------------------------------------------------------------"
  printf 'watch-tick.sh selftest: %s passed, %s failed\n' "$PASSES" "$FAILS"
  if (( FAILS > 0 )); then return 1; fi
  return 0
}

#==============================================================================
# ENTRY
#==============================================================================
if (( DO_SELFTEST )); then
  selftest
  exit $?
fi

set +e
run_tick
RC=$?
set -e
exit $RC
