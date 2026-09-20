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
#            minutes (20 for a merge stage)        -> ACTION|reconcile-native-identity
#   S13      a RESULT is written for the unit and its heartbeat is STILL fresh
#                                                  -> ACTION|reconcile-native-identity
#   bar      the two files the client status bar reads, through
#            tools/bar-check.sh: CONTROL/setup_progress.json and
#            CONTROL/project_state.json tasks.counts
#                                                  -> ACTION|write-bar-inputs
#            (or ACTION|fix-bar-input when one is present and unparseable).
#            NOT an S-number: RULE 5's table owns those, and this is the
#            enforcement half of SKILL.md §12's bar instruction. A bar segment
#            with no file behind it renders as nothing, silently, for a whole
#            run — the client never asks why, so the tick has to.
#   speech   every drafted client message under CONTROL/.speech/ has a
#            `SPEECH-CHECK: … | file=<name>` line on CONTROL/LEDGER.md, which
#            tools/speech-check.sh — RULE 5's sixth instrument — writes when it
#            lints one.  A draft with no such line is a turn boundary that
#            passed with a client-visible message nobody checked
#                                              -> DRIFT-ALARM speech-unchecked
#                                              -> ACTION|speech-check
#            Also not an S-number, and deliberately evidence-only: a script
#            cannot read a spoken message, so an ABSENT or empty
#            CONTROL/.speech/ is UNDETERMINED, never a pass. A hook cannot see
#            speech either; the draft file is the only thing that can be seen.
#   stalled-turn  a BUILD-phase run whose newest file mtime anywhere under the
#            project folder has not advanced for `STALLED_MIN` minutes or more
#            (default 15) — the 2026-09-08 canary burned 31 wall-clock minutes
#            with zero file writes while a provider leg hung
#                                              -> DRIFT-ALARM stalled-turn
#                                              -> ACTION|stalled-turn
#            Also not an S-number, and deliberately evidence-only: the tick runs
#            every five minutes, so a 15-minute ceiling is three silent ticks,
#            never one slow write. The BUILD-phase read is the dispatch log's
#            own census (a build-stage open row), never a state word any model
#            may rewrite at will.
#   published every served `PUBLISHED:` line on CONTROL/LEDGER.md has a
#            `SHIP-GUARD: rc=0` line at an EARLIER timestamp (WI-69 wires in
#            WI-60's guard: references/publish.md runs tools/ship-guard.sh
#            AGAIN at the live origin and rc 0 is a precondition of the
#            publish). A publish with no earlier guard line is a page that
#            went live unguarded
#                                              -> DRIFT-ALARM published-unguarded
#                                              -> ACTION|ship-guard
#            Also not an S-number. ORDER is the whole check: a guard line
#            written AFTER the publish is a receipt, not a guard, so the
#            comparison is on timestamps, never on mere presence — the LAST
#            publish line is the live address (references/publish.md's
#            measured upsert caveat) and a guard counts only when strictly
#            earlier than it. A `status=n/a` no-URL release is excluded: its
#            artifact/signing/install/runtime/export evidence is the release
#            guard, not an invented origin. A missing or unreadable ledger is
#            UNDETERMINED, never a pass: absence is not proof nothing published.
#
#   speech-lint  the tick RUNS tools/speech-check.sh on the newest unchecked
#            draft under CONTROL/.speech/ (one file per tick, default timeout
#            25s via WATCH_SPEECH_TIMEOUT): a REJECT names its classes and is
#            reported never edited; a lint that cannot run at all (missing,
#            not executable, exit 4, timeout) raises DRIFT-ALARM
#            speech-unchecked; an older draft causes no new run
#                                              -> DRIFT-ALARM speech-unchecked (lint unrunnable only)
#                                              -> ACTION|speech-check
#            Also not an S-number, and deliberately evidence-only: the lint
#            writes its own SPEECH-CHECK verdict through ledger.sh, so the tick
#            never stamps a verdict it did not run.
#
#   group-abort  two or more agents of one dispatch row ending at an identical
#            timestamp with no completion record (the RC-26 kill signature:
#            the three WAVE4 builders sharing 10:43:46.087Z)
#                                              -> DRIFT-ALARM group-abort
#                                              -> ACTION|reconcile-native-identity
#            Also not an S-number, and deliberately evidence-only: the row is
#            named by its run id, the shared stamp is read off
#            CONTROL/HEARTBEAT.md (one line per live agent — a killed agent's
#            line freezes, so agents killed in one event share their last
#            stamp), and completion is the ledger's RESULT set. A lone agent
#            with no completion record is the existing stall path's business
#            (S6), never this alarm's.
# THE DEFINITIONS, MECHANICALLY (so two readers count the same numbers)
#   runnable  an OPEN box in CONTROL/CHECKLIST.md (`- [ ] …`) whose unit id has
#             no open dispatch row.
#   open      a row in CONTROL/dispatch-log.md (document 12's shape,
#             `timestamp | work item | stage | full label | run id`) whose unit
#             has no `| RESULT |` line in CONTROL/LEDGER.md. Rows are keyed by
#             unit + stage and the LATEST row wins, so a re-dispatch after a
#             identity-first re-dispatch replaces a proven-absent worker's row
#             instead of counting twice.
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
#     - no drafted client message under CONTROL/.speech/ -> `speech=` is
#       UNDETERMINED. An absent draft folder is not proof that nothing was said
#       to the client, so it is never reported as a speech pass;
#     - a missing or unreadable CONTROL/LEDGER.md -> `published=` is
#       UNDETERMINED. An absent ledger is not proof nothing published, so it
#       is never reported as a publish pass — and the publish direction is
#       fail-closed: the DRIFT-ALARM still fires, named
#       `published-unguarded(undetermined)` with the reason, because a publish
#       is irreversible and the guard is the last thing between a run and a
#       client's live page;
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
#   WATCH_STALLED_MIN=<n>       stalled-turn ceiling, minutes (default 15).
#                               Same style as anchor.sh's BUDGET_TOL honored
#                               through ANCHOR_BUDGET_TOL: the constant carries
#                               the doctrine's number and the environment only
#                               overrides it.
#   WATCH_SPEECH_CHECK_SH=<path>  fixture only: the lint the speech section
#                               runs instead of tools/speech-check.sh. Every
#                               selftest case that needs a broken lint uses it;
#                               nothing else should.
#   WATCH_SPEECH_TIMEOUT=<secs>   fixture only: how long one lint run may take
#                               before the tick moves on without it (default 25).
#                               Nothing else should.
#==============================================================================

set -euo pipefail
# Never inherit a parent shell's xtrace: `bash -x` exports SHELLOPTS, and an
# inheriting child would spray `++ ...` lines into captured output —
# self_prove counts parser rows, so one leaked line turns a proven instrument
# into BROKEN-INSTRUMENT exit 2. Off, always (SHELLOPTS is readonly, so unset
# it through the environment for every child this script spawns).
if [[ "${SHELLOPTS:-}" == *xtrace* ]]; then
  export SHELLOPTS=""
  set +x
fi

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
# WATCH_SPEECH_CHECK_SH names the lint to run (fixture only: the default is the
# sixth instrument beside this script). A value that is set and cannot be
# honoured is never ignored — it IS the lint for this run.
SPEECH_CHECK_SH="${WATCH_SPEECH_CHECK_SH:-${SCRIPT_DIR}/speech-check.sh}"

HOME_DIR=""
DO_SELFTEST=0
DO_CRON_LINE=0
DO_ARM=0

STALE_MIN="${WATCH_STALE_MIN:-10}"
MERGE_STALE_MIN="${WATCH_MERGE_STALE_MIN:-20}"
# The stalled-turn ceiling (RC-17): a BUILD-phase run with no file write for
# this long raises DRIFT-ALARM stalled-turn. Same style as anchor.sh's
# BUDGET_TOL honored through ANCHOR_BUDGET_TOL — the constant is the doctrine's
# number and WATCH_STALLED_MIN only overrides it.
STALLED_MIN="${WATCH_STALLED_MIN:-15}"

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

# The canonical PUBLISHED line records no-URL releases as status=n/a. They do
# not have an HTTP origin and must not be marked unguarded merely because the
# URL-only ship guard cannot run. This helper deliberately keys only on that
# explicit release field; a missing/ambiguous target remains fail-closed.
published_is_no_url() {
  printf '%s' "$1" | "$GREP" -qE '(^|[[:space:]])status=n/a([[:space:]]|$)'
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

AWK_HB_ALL="${AWK_LIB}"'
BEGIN { FS = "|" }
NF >= 2 {
  ts = trim($1); sub(/^-[ \t]*/, "", ts)
  if (ts !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) next
  agent = trim($2)
  item  = (NF >= 3 ? $3 : "")
  u = unit_of($0, item)
  if (u == "" || ts == "") next
  print ts "\t" u "\t" agent
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
awk_hb_all()    { "$AWK" -v MUL="$MUL" -v BREAK_LABEL="$BREAK_LABEL" "$AWK_HB_ALL"    "$1"; }

# ga_stamp_groups <hb-all.tsv> -> "<ts>\t<count>\t<unit1,unit2,...>" per shared stamp.
# Input rows are "ts \t unit \t agent". Units, not agents, are counted: one
# agent re-stamping one unit is one life, never a group. Output is sorted by
# timestamp so the ledger order is deterministic.
ga_stamp_groups() {
  "$AWK" -F '\t' '
    NF >= 2 && $1 != "" && $2 != "" {
      if (!(($1 SUBSEP $2) in seen)) { seen[$1 SUBSEP $2] = 1; cnt[$1]++; units[$1] = (units[$1] == "" ? $2 : units[$1] "," $2) }
    }
    END { for (t in cnt) if (cnt[t] >= 1) print t "\t" cnt[t] "\t" units[t] }
  ' "$1" | LC_ALL=C sort
}

# ga_row_for <comma-units> <dispatch-log> -> the single run id owning every
# unit, or nothing. The run id is read off the RAW dispatch log (the run=
# field of document 12's row, matched per unit id as a whole pipe field), not
# off the parsed rows — one dispatch BOOKS one wave under one run id for many
# units, while the row parser keys open counts per unit, so the raw log is the
# only place the whole wave's membership is visible. Units from two waves, or
# a unit with no wave at all, is NOT one dispatch row — the alarm names a row,
# so a group that spans rows names none.
ga_row_for() {
  local csv="$1" dl="$2" want got r u
  want="$(printf '%s' "$csv" | tr ',' '\n' | LC_ALL=C sort -u | "$GREP" -c '[^[:space:]]' || true)"
  [[ -n "$want" && "$want" -gt 0 ]] || return 0
  got=""
  while IFS= read -r u; do
    [[ -n "$u" ]] || continue
    r="$("$AWK" -F '|' -v u="$u" '
      {
        unit = $2; gsub(/^[ \t]+/, "", unit); gsub(/[ \t]+$/, "", unit)
        # A wave row books MANY units in field 2 ("U-11 build U-12 build
        # U-13 build") or in unit= fields; the unit is a member when it
        # appears as a whole token anywhere in the row, not only in first
        # position. Whole-token match: pad both sides with one space.
        hit = (index(" " $0 " ", " " u " ") > 0)
        if (!hit && match($0, /(^|[ \t|])unit=[^ \t|]+/)) {
          m = substr($0, RSTART, RLENGTH); sub(/^[^=]*=/, "", m)
          if (m == u) hit = 1
        }
        if (hit) {
          for (i = 1; i <= NF; i++) {
            f = $i; gsub(/^[ \t]+/, "", f); gsub(/[ \t]+$/, "", f)
            if (f ~ /^run=/) { sub(/^run=/, "", f); gsub(/[ \t]+$/, "", f); if (f != "") { print f; exit } }
          }
        }
      }' "$dl")"
    [[ -n "$r" ]] || return 0
    if [[ -z "$got" ]]; then got="$r"
    elif [[ "$got" != "$r" ]]; then return 0; fi
  done <<< "$(printf '%s' "$csv" | tr ',' '\n')"
  printf '%s\n' "$got"
}

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
[[ "$STALLED_MIN"     =~ ^[0-9]+$ ]] || die_tool "WATCH_STALLED_MIN must be a non-negative integer (got: ${STALLED_MIN})"

#==============================================================================
# THE TICK
#==============================================================================
run_tick() {
  [[ -n "$HOME_DIR" ]] || die_tool "no project home given. Usage: watch-tick.sh <project-home> [--cron-line|--arm]"
  [[ -d "$HOME_DIR" ]] || die_tool "project home does not exist: ${HOME_DIR}"
  HOME_DIR="$(cd "$HOME_DIR" && pwd)"

  # A supplied profile owns observation and canonical state. Refuse before
  # --arm or any CONTROL lookup so this legacy tick cannot create a second
  # scheduler/ledger path beside it.
  if [[ -f "$HOME_DIR/.spec-protocol.json" ]]; then
    die_tool "PROFILE-OWNED | ${HOME_DIR} has .spec-protocol.json; refusing legacy watch-tick/cron mutation. Use the profile-declared observer."
  fi

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
  #     (The (1b) snapshot-witness lives in section (4) beside emit(), which
  #     it calls — it cannot run inline here because emit() is defined there.)
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
  : > "$WORKDIR/hb-all.tsv"
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
    # The full stamp census for the group-abort check: every heartbeat line's
    # own timestamp (not the newest-per-unit map above — a shared LAST stamp is
    # the signature, and the map keeps only one stamp per unit).
    awk_hb_all "$HB" > "$WORKDIR/hb-all.tsv" || true
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

  #--------------------------------------------------------------------------
  # (1b) THE SNAPSHOT PRODUCER'S WITNESS (RC-29b). The reconcile's classes 1-4
  #     read CONTROL/task-graph-snapshot.json, which anchor.sh --write-tasks
  #     exports. When the Capacity Ledger exists the run is past step 6.5, so
  #     the snapshot is due: missing more than one tick after that mark is a
  #     gap that would otherwise degrade silently into `undetermined` on every
  #     RECONCILE line. One tick of grace, then DRIFT-ALARM tasks-snapshot-
  #     absent at exit 3 with ACTION|write-task-snapshot. The flag file carries
  #     the count across ticks; a present snapshot clears it. The mark is the
  #     same two witnesses anchor.sh's pre-plan gate reads (the CAPACITY-
  #     LEDGER.md file, or a CAPACITY-LEDGER: line in CONTROL/LEDGER.md), so
  #     the two gates agree on what "past step 6.5" means. Before the mark this
  #     block is silent: the snapshot is not due yet.
  #--------------------------------------------------------------------------
  {
    local SNAP="$HOME_DIR/CONTROL/task-graph-snapshot.json" SNAPFLAG="$HOME_DIR/CONTROL/.snapshot-missing"
    local cap_mark=0
    [[ -f "$HOME_DIR/CAPACITY-LEDGER.md" ]] && cap_mark=1
    if [[ -f "$LED" ]] && "$GREP" -qE '(^|[|][[:space:]]*)CAPACITY-LEDGER:' "$LED" 2>/dev/null; then cap_mark=1; fi
    if (( cap_mark == 1 )) && [[ ! -f "$SNAP" ]]; then
      local miss=1
      if [[ -f "$SNAPFLAG" ]]; then
        miss="$(cat "$SNAPFLAG" 2>/dev/null || printf '1')"
        [[ "$miss" =~ ^[0-9]+$ ]] || miss=1
        miss=$(( miss + 1 ))
      fi
      printf '%s\n' "$miss" > "$SNAPFLAG" 2>/dev/null || true
      if (( miss > 1 )); then
        ledger_write "CONTROL/LEDGER.md" \
          "$(iso_now) | DRIFT-ALARM | tasks-snapshot-absent | CONTROL/task-graph-snapshot.json missing ${miss} ticks after the Capacity Ledger exists (anchor.sh --write-tasks <project> exports it; reconcile classes 1-4 are UNDETERMINED until it exists)"
        emit "write-task-snapshot" "CONTROL/task-graph-snapshot.json" \
          "DRIFT-ALARM tasks-snapshot-absent: the snapshot is missing ${miss} ticks after the Capacity Ledger exists — export it with tools/anchor.sh --write-tasks (reconcile classes 1-4 UNDETERMINED without it)"
      fi
    elif [[ -f "$SNAP" ]]; then
      rm -f "$SNAPFLAG" 2>/dev/null || true
    fi
  }

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
  # first stamp leaves no line, so the heartbeat can never be the only witness.
  # It is still not death: only the applicable host driver can resolve actual
  # Workflow/session/run or Agent-Team identity.
  # (references/loops.md Loop 5's trap). A row younger than the threshold with
  # no stamp yet is not late; it is new.
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    local thr age src ep
    thr="$(stale_min_for "$stage")"
    if ep="$(hb_epoch_for "$u" "$label")"; then src="heartbeat"
    elif ep="$(iso_to_epoch "$ts")"; then src="dispatch row (no heartbeat line — identity must be reconciled)"
    else
      add_undet "S6=undetermined(unit=${u}: neither a parseable heartbeat nor a parseable dispatch timestamp '${ts}')"
      continue
    fi
    age=$(( (NOW - ep) / 60 ))
    if (( age > thr )); then
      emit "reconcile-native-identity" "$u" \
        "S6 stale: unit=${u} stage=${stage} last stamped ${age} min ago by its ${src}, past the ${thr}-minute threshold — stale is identity-unverified, not dead. Reconcile the actual Workflow/session/run or Agent-Team identity through the host driver: proven absent → retire and re-dispatch from its slice; proven live → retain; unknown → escalate without replacement (SKILL.md RULE 5 S6)."
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
        emit "reconcile-native-identity" "$u" \
          "S13 finished-but-alive: unit=${u} has a RESULT line on CONTROL/LEDGER.md and its heartbeat is still fresh (${age} min old, threshold ${thr}) — reconcile the matching Workflow/session/run or Agent-Team identity before any TaskStop; unknown identity is retained and escalated (SKILL.md RULE 5 S13)."
      fi
    fi
  done < "$WORKDIR/closed.tsv"

  # THE GROUP-ABORT CHECK — the RC-26 kill signature, read for its EVIDENCE.
  # A dispatch row books a wave (run=<run-id>, agents=<n>) and each agent stamps
  # CONTROL/HEARTBEAT.md on progress — one line per live agent, so a killed
  # agent's line FREEZES at its last stamp. Two or more heartbeat lines sharing
  # one identical timestamp, whose units belong to one dispatch row (the same
  # run= id in CONTROL/dispatch-log.md) and carry no RESULT line on
  # CONTROL/LEDGER.md, is the group abort the canary photographed: three WAVE4
  # builders sharing 10:43:46.087Z with no completion record. One alarm per row:
  # `DRIFT-ALARM group-abort row=<run-id> agents=<n> at=<ts>`.
  #
  #   shared stamp + one row + no RESULT   -> DRIFT-ALARM group-abort
  #   staggered stamps, or RESULT present  -> silent (completions, not deaths)
  #   one lone agent, no RESULT            -> silent (S6's stall path, not this)
  #
  # The honest limit, written down and not hidden: this detector does NOT stop
  # the process deaths — their cause is UNDETERMINED. It makes them visible
  # within five minutes and asks the rung-1 identity reconciliation below.
  local GA_NOTE=""
  if [[ -f "$HB" && -f "$DL" ]]; then
    local ga_ts ga_units ga_row ga_n
    while IFS=$'\t' read -r ga_ts ga_n ga_units; do
      [[ -n "$ga_ts" && -n "$ga_units" ]] || continue
      if (( ga_n < 2 )); then continue; fi
      # Every unit in this stamp group must be RESULT-free: one completion
      # among them means the stamp is shared life, not a shared death.
      local ga_all_open=1 ga_u
      while IFS= read -r ga_u; do
        [[ -n "$ga_u" ]] || continue
        if "$GREP" -qxF -- "$ga_u" "$WORKDIR/results.txt" 2>/dev/null; then ga_all_open=0; break; fi
      done <<< "$(printf '%s' "$ga_units" | tr ',' '\n')"
      if (( ga_all_open != 1 )); then continue; fi
      # Every unit in the group must belong to ONE dispatch row (one run= id
      # on the raw dispatch log — one booking, one wave, one row).
      ga_row="$(ga_row_for "$ga_units" "$DL")"
      if [[ -z "$ga_row" ]]; then continue; fi
      GA_NOTE="row=${ga_row} agents=${ga_n} at=${ga_ts}"
      ledger_write "CONTROL/LEDGER.md" \
        "$(iso_now) | DRIFT-ALARM | group-abort | row=${ga_row} agents=${ga_n} at=${ga_ts} | $(sanitize "units=${ga_units}") | $(sanitize "two or more agents of one dispatch row ending at an identical timestamp with no completion record — reconcile native identity before any re-dispatch")"
      emit "reconcile-native-identity" "$ga_units" \
        "DRIFT-ALARM group-abort: ${ga_n} agents of dispatch row ${ga_row} ended at the identical timestamp ${ga_ts} with no RESULT line on CONTROL/LEDGER.md — reconcile the row's actual Workflow/session/run or Agent-Team identity first; only proven-absent workers may be re-booked through tools/dispatch-check.sh from checkpoints (anchor.sh recovery-ladder rung 1)"
    done < <(ga_stamp_groups "$WORKDIR/hb-all.tsv")
  fi

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

  # THE SPEECH LINT — RULE 5's sixth instrument, read for its ABSENCE.
  # tools/speech-check.sh lints a drafted client message and records
  # `SPEECH-CHECK: <verdict> | file=<name>` on CONTROL/LEDGER.md. Nothing read
  # for the missing line until this check existed, which is how six consecutive
  # turns of the 2026-09-08 canary spoke a /tmp path to a picture-framer with a
  # working, self-testing lint sitting unused in the same tree.
  #
  #   a draft with a matching SPEECH-CHECK line   -> checked, silent
  #   the newest draft newer than the newest SPEECH-CHECK line -> RUN the lint
  #        on that file; the lint writes its own verdict through ledger.sh
  #   the lint missing, not executable, or exiting 4 -> DRIFT-ALARM
  #        speech-unchecked (the lint could not be run at all)
  #   no draft at all (no folder, or empty)       -> UNDETERMINED, never a pass
  #
  # The last row is the honest limit: this script cannot read a spoken message,
  # only a drafted one, so it runs on EVIDENCE (a draft newer than the last
  # verdict) and says so in writing when it has none. A REJECT is reported,
  # never suppressed and never edited: the lint's exit 3 and the classes it
  # named stand, and this tick does not rewrite the message. The tick's job is
  # to make the failure visible within five minutes, not to fix prose.
  local SPEECH_DIR SPEECH_NOTE="" SPEECH_LINT_RAN=0 SPEECH_LINT_RC="" SPEECH_LINT_CLASSES=""
  SPEECH_DIR="$HOME_DIR/CONTROL/.speech"
  # newest_unchecked_draft — the newest CONTROL/.speech/ file whose mtime is
  # newer than the newest SPEECH-CHECK: line on CONTROL/LEDGER.md. Empty when
  # there is nothing to run on. One tick runs the lint on this ONE file only,
  # never on the whole directory, so a tick cannot fan out unboundedly.
  newest_unchecked_draft() {  # newest_unchecked_draft <speech-dir> <ledger> -> path or nothing
    local sdir="$1" led="$2" newest_line_epoch=0 f m cand="" cand_m=0
    local -a files=()
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      files+=("$f")
    done < <(find "$sdir" -maxdepth 1 -type f 2>/dev/null | LC_ALL=C sort)
    (( ${#files[@]} > 0 )) || return 0
    if [[ -f "$led" ]]; then
      local last_line
      last_line="$("$GREP" -h 'SPEECH-CHECK:' "$led" 2>/dev/null | tail -1 || true)"
      if [[ -n "$last_line" ]]; then
        local lts
        lts="$(printf '%s' "$last_line" | "$AWK" -F'|' '{print $1}')"
        lts="$(printf '%s' "$lts" | tr -d ' \t')"
        if [[ -n "$lts" ]] && newest_line_epoch="$(iso_to_epoch "$lts" 2>/dev/null)"; then
          :
        else
          newest_line_epoch=0
        fi
      fi
    fi
    for f in "${files[@]}"; do
      m="$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)"
      [[ "$m" =~ ^[0-9]+$ ]] || m=0
      # Ties break toward the last name in sort order: fixtures write several
      # drafts inside one second, and the newest draft is the last one.
      if (( m > newest_line_epoch )) && (( m >= cand_m )); then
        cand="$f"; cand_m="$m"
      fi
    done
    [[ -n "$cand" ]] && printf '%s\n' "$cand"
    return 0
  }
  # run_speech_lint — invoke the lint on ONE draft file. Fail-loud-but-continue
  # in the style this file already uses for anchor.sh failures: a lint that
  # hangs or errors leaves the tick's other checks intact and their verdicts
  # still written. Sets SPEECH_LINT_RAN=1 with SPEECH_LINT_RC and
  # SPEECH_LINT_CLASSES on a completed run. Returns 0 in ALL cases: a REJECT
  # is carried by the emitted ACTION line and the S-CHECK count, never by a
  # nonzero return (under `set -e` a nonzero return would abort the tick
  # before the S-CHECK line is written — the exact failure this item closes).
  run_speech_lint() {  # run_speech_lint <draft-file> -> always 0; findings ride in actions.txt
    local draft="$1" lout lrc db
    db="$(basename "$draft")"
    if [[ ! -f "$SPEECH_CHECK_SH" ]]; then
      SPEECH_NOTE="unchecked(${db}; could-not-run: tools/speech-check.sh missing)"
      ledger_write "CONTROL/LEDGER.md" \
        "$(iso_now) | DRIFT-ALARM | speech-unchecked | drafts=1 unchecked=1 | $(sanitize "${db}") | $(sanitize "the lint could not be run at all: tools/speech-check.sh is missing — RULE 5 lints every client-visible message before it is spoken; an exit 3 is REWRITTEN, never overridden")"
      emit "speech-check" "$db" \
        "DRIFT-ALARM speech-unchecked: the lint could not be run at all (tools/speech-check.sh missing) with a client-visible draft ${db} present — install the lint and lint before speaking (SKILL.md RULE 5)"
      return 0
    fi
    if [[ ! -x "$SPEECH_CHECK_SH" ]]; then
      SPEECH_NOTE="unchecked(${db}; could-not-run: tools/speech-check.sh not executable)"
      ledger_write "CONTROL/LEDGER.md" \
        "$(iso_now) | DRIFT-ALARM | speech-unchecked | drafts=1 unchecked=1 | $(sanitize "${db}") | $(sanitize "the lint could not be run at all: tools/speech-check.sh is not executable — RULE 5 lints every client-visible message before it is spoken; an exit 3 is REWRITTEN, never overridden")"
      emit "speech-check" "$db" \
        "DRIFT-ALARM speech-unchecked: the lint could not be run at all (tools/speech-check.sh not executable) with a client-visible draft ${db} present — restore the lint's execute bit and lint before speaking (SKILL.md RULE 5)"
      return 0
    fi
    # `timeout` is coreutils, not POSIX: fleet Linux has it, macOS only with
    # it on PATH. Without it the lint runs unguarded rather than not at all.
    local _stimeout="${WATCH_SPEECH_TIMEOUT:-25}"
    set +e
    if command -v timeout >/dev/null 2>&1; then
      lout="$(timeout "$_stimeout" bash "$SPEECH_CHECK_SH" "$draft" --home "$HOME_DIR" 2>&1)"; lrc=$?
    else
      lout="$(bash "$SPEECH_CHECK_SH" "$draft" --home "$HOME_DIR" 2>&1)"; lrc=$?
    fi
    set -e
    if (( lrc == 124 )) || (( lrc == 142 )); then
      SPEECH_NOTE="unchecked(${db}; could-not-run: lint timed out)"
      return 0
    fi
    if (( lrc == 4 )); then
      SPEECH_NOTE="unchecked(${db}; could-not-run: lint selftest failed, exit 4)"
      ledger_write "CONTROL/LEDGER.md" \
        "$(iso_now) | DRIFT-ALARM | speech-unchecked | drafts=1 unchecked=1 | $(sanitize "${db}") | $(sanitize "the lint could not be run at all: tools/speech-check.sh exited 4 (selftest failed) — RULE 5 lints every client-visible message before it is spoken; an exit 3 is REWRITTEN, never overridden")"
      emit "speech-check" "$db" \
        "DRIFT-ALARM speech-unchecked: the lint could not be run at all (tools/speech-check.sh exited 4, selftest failed) with a client-visible draft ${db} present — fix the lint; it may not be believed until it passes (SKILL.md RULE 5)"
      return 0
    fi
    if (( lrc == 2 )); then
      SPEECH_NOTE="unchecked(${db}; lint undetermined, exit 2)"
      return 0
    fi
    SPEECH_LINT_RAN=1; SPEECH_LINT_RC="$lrc"
    SPEECH_LINT_CLASSES="$(printf '%s\n' "$lout" | sed -n 's/^SPEECH-CHECK | verdict=[A-Z]* | classes=\([A-Za-z,+_-]*\).*/\1/p' | head -1)"
    [[ -n "$SPEECH_LINT_CLASSES" ]] || SPEECH_LINT_CLASSES="none"
    if (( lrc == 3 )); then
      SPEECH_NOTE="reject(${db}; classes=${SPEECH_LINT_CLASSES})"
      emit "speech-check" "$db" \
        "SPEECH-CHECK REJECT (exit 3): ${db} names classes ${SPEECH_LINT_CLASSES} — reported, never suppressed and never edited; rewrite the message, never override (SKILL.md RULE 5)"
      return 0
    fi
    SPEECH_NOTE="ok(lint ran on ${db}; verdict=${SPEECH_LINT_CLASSES})"
    return 0
  }
  if [[ -d "$SPEECH_DIR" ]]; then
    _SPEECH_CAND="$(newest_unchecked_draft "$SPEECH_DIR" "$LED" || true)"
    if [[ -n "${_SPEECH_CAND:-}" ]]; then
      # run_speech_lint returns 0 on every path (a REJECT rides in actions.txt
      # and the S-CHECK count), so the tick always reaches its verdict line.
      run_speech_lint "$_SPEECH_CAND"
      unset _SPEECH_CAND
    else
      _SPEECH_N="$("$GREP" -c '[^[:space:]]' < <(find "$SPEECH_DIR" -maxdepth 1 -type f 2>/dev/null) 2>/dev/null || true)"
      [[ -n "${_SPEECH_N:-}" ]] || _SPEECH_N=0
      if (( _SPEECH_N > 0 )); then
        SPEECH_NOTE="ok(all drafts linted)"
      else
        SPEECH_NOTE="undetermined(no draft under CONTROL/.speech/)"
        add_undet "speech=undetermined(nothing drafted under CONTROL/.speech/ — a script cannot read a spoken message, so an absent draft is not proof the client was told nothing)"
      fi
      unset _SPEECH_N
    fi
  else
    SPEECH_NOTE="undetermined(no draft under CONTROL/.speech/)"
    add_undet "speech=undetermined(nothing drafted under CONTROL/.speech/ — a script cannot read a spoken message, so an absent draft is not proof the client was told nothing)"
  fi

  # THE STALLED TURN (RC-17) — the wall-clock ceiling on a single turn. The
  # 2026-09-08 canary burned 31 minutes with zero file writes while a provider
  # leg hung in a retry loop: nothing in the skill bounded it. This check
  # bounds it. It fires only when BOTH hold: the run is in the BUILD phase
  # (the dispatch log's own census — an OPEN row whose stage names build,
  # never a state word) AND the newest file mtime anywhere under the project
  # folder is STALLED_MIN minutes old or more. A run outside the build phase
  # is not stalled-turn material (apparatus work writes elsewhere and slower),
  # and a run with no readable clock is UNDETERMINED, never a pass and never
  # an alarm.
  local STALL_NOTE="" STALL_ELAPSED=""
  {
    local stall_build=0 stall_newest="" stall_now stall_age=0 stall_path=""
    local su sstage
    while IFS=$'\t' read -r su sstage _slok _stree _sts _slabel; do
      [[ -n "$su" ]] || continue
      case "$(printf '%s' "${sstage}" | tr 'A-Z' 'a-z')" in *build*) stall_build=1; break ;; esac
    done < "$WORKDIR/open.tsv"
    if (( stall_build == 1 )); then
      stall_now="$(epoch_now)"
      # The newest mtime under the project home, CONTROL excluded: the ledger
      # this tick writes is not progress, and counting it would make the check
      # unable to fire on a run whose only writer is the tick itself. The
      # ledger's own lock and pin sentinels are excluded for the same reason
      # (tools/anchor.sh's census excludes them too): a sentinel this tick's
      # own ledger write created is not a project write.
      while IFS= read -r stall_path; do
        [[ -n "$stall_path" ]] || continue
        local se
        se="$(stat -f %m "$stall_path" 2>/dev/null || stat -c %Y "$stall_path" 2>/dev/null || true)"
        if [[ -n "$se" ]] && { [[ -z "$stall_newest" ]] || (( se > stall_newest )); }; then
          stall_newest="$se"
        fi
      done < <(find "$HOME_DIR" -path "$HOME_DIR/CONTROL" -prune -o -type f \
        ! -name '.ledger-pinned' ! -name '*.lock' ! -name '*.tmp.*' ! -name '*.lock.d' -print 2>/dev/null)
      if [[ -z "$stall_newest" ]]; then
        STALL_NOTE="undetermined(no readable file mtime under the project folder — the clock has no witness)"
        add_undet "stalled-turn=undetermined(no file mtime could be read under ${HOME_DIR} — an unreadable clock is not proof of progress)"
      else
        stall_age=$(( (stall_now - stall_newest) / 60 ))
        if (( stall_age >= STALLED_MIN )); then
          STALL_NOTE="stalled(elapsed=${stall_age}m)"
          STALL_ELAPSED="${stall_age}"
          ledger_write "CONTROL/LEDGER.md" \
            "$(iso_now) | DRIFT-ALARM | stalled-turn | elapsed=${stall_age} | $(sanitize "no file write under the project folder for ${stall_age} minutes while an open BUILD row stands (ceiling ${STALLED_MIN}m) — reconcile the actual Workflow/session/run or Agent-Team identity before retirement; stale files are not proof of death")"
          emit "stalled-turn" "elapsed=${stall_age}m" \
            "DRIFT-ALARM stalled-turn: newest file mtime under the project folder is ${stall_age} minutes old (ceiling ${STALLED_MIN}) while a BUILD row stands open — the turn is hung, not slow (RC-17)"
        else
          STALL_NOTE="ok(newest write ${stall_age}m ago, ceiling ${STALLED_MIN}m)"
        fi
      fi
    else
      STALL_NOTE="undetermined(no open BUILD row — the ceiling applies to the build phase only)"
      add_undet "stalled-turn=undetermined(no open BUILD row in CONTROL/dispatch-log.md — outside the build phase the wall-clock ceiling does not apply)"
    fi
  }
  # THE PUBLISHED-UNGUARDED CHECK (WI-69) — the guard's wall, on the tick side.
  # references/publish.md requires `SHIP-GUARD: rc=0 checks=<n> at=<ISO8601Z>`
  # ABOVE the PUBLISHED: line: the guard runs at the live origin BEFORE the
  # address is handed to anyone. The tick judges ORDER, never mere presence —
  # a guard line written after the publish is a receipt, not a guard. The live
  # address is the LAST PUBLISHED: line (publish.md's measured upsert caveat:
  # the colon-delimited shape appends a second line instead of replacing the
  # first), and a SHIP-GUARD: rc=0 line counts only when its timestamp is
  # strictly EARLIER than that publish's.
  #
  #   LAST served PUBLISHED: with no SHIP-GUARD: rc=0 earlier -> DRIFT-ALARM
  #                                                    published-unguarded
  #   guard earlier than the last publish              -> silent
  #   no PUBLISHED: line at all                        -> silent (nothing
  #                                                    published yet — absence
  #                                                    of a publish is a pass)
  #   missing/unreadable CONTROL/LEDGER.md              -> DRIFT-ALARM
  #                                                    published-unguarded-
  #                                                    (undetermined), naming
  #                                                    why. ABSENCE IS NOT A
  #                                                    PASS: a firewall that
  #                                                    fails open when its own
  #                                                    ledger is gone is not a
  #                                                    firewall.
  #
  # The rc=0 class is closed on the right (`rc=01` is not a pass) and every
  # grep's rc is checked: rc 0 is a match, rc 1 is a proven zero match, rc>=2
  # is an ERROR, never a zero — and here an error refuses exactly like a zero
  # match does. Timestamps are compared as EPOCHS via iso_to_epoch (the same
  # converter S6 uses), never as strings: a string compare silently passes a
  # reordered ledger whenever the shape drifts. A side both this block and the
  # selftest rely on: ledger.sh prefixes every line it writes with an ISO8601Z
  # clock, so both the guard and the publish lines carry comparable stamps.
  local PUB_NOTE="" PUB_ALARM=0 PUB_WHY=""
  if [[ ! -f "$LED" ]]; then
    PUB_NOTE="undetermined(no CONTROL/LEDGER.md — an absent ledger is not proof nothing published)"
    add_undet "published=undetermined(no CONTROL/LEDGER.md — an absent ledger is not proof nothing published)"
    PUB_ALARM=1
    PUB_WHY="no CONTROL/LEDGER.md — an absent ledger is not proof nothing published, so this fires rather than passing"
  elif [[ ! -r "$LED" ]]; then
    PUB_NOTE="undetermined(CONTROL/LEDGER.md unreadable)"
    add_undet "published=undetermined(CONTROL/LEDGER.md unreadable — an unreadable ledger is not proof nothing published)"
    PUB_ALARM=1
    PUB_WHY="CONTROL/LEDGER.md unreadable — an unreadable ledger is not proof nothing published, so this fires rather than passing"
  else
    local pub_ts="" pub_line sg_ts="" grc
    set +e
    pub_line="$("$GREP" -h 'PUBLISHED:' "$LED" 2>/dev/null | tail -n 1)"; grc=$?
    set -e
    if (( grc >= 2 )); then
      PUB_NOTE="undetermined(ledger read error)"
      add_undet "published=undetermined(reading CONTROL/LEDGER.md failed — a ledger that cannot be read is not proof nothing published)"
      PUB_ALARM=1
      PUB_WHY="reading CONTROL/LEDGER.md failed — a ledger that cannot be read is not proof nothing published, so this fires rather than passing"
    elif [[ -z "$pub_line" ]]; then
      PUB_NOTE="ok(no PUBLISHED: line — nothing published yet)"
    else
      if published_is_no_url "$pub_line"; then
        PUB_NOTE="n/a(no-URL release; target-specific artifact evidence owns its guard)"
      else
      pub_ts="$(printf '%s' "$pub_line" | "$GREP" -oE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z' | head -n 1)"
      local pub_ep="" sg_line sg_ep
      if [[ -n "$pub_ts" ]] && pub_ep="$(iso_to_epoch "$pub_ts")"; then
        : > "$WORKDIR/shipguard.txt"
        set +e
        "$GREP" -hE 'SHIP-GUARD: rc=0( |$)' "$LED" > "$WORKDIR/shipguard.txt" 2>/dev/null; grc=$?
        set -e
        if (( grc >= 2 )); then
          PUB_NOTE="undetermined(guard-line read error)"
          add_undet "published=undetermined(reading the SHIP-GUARD lines failed — an unreadable ledger is not proof the publish was guarded)"
          PUB_ALARM=1
          PUB_WHY="reading the SHIP-GUARD: lines in CONTROL/LEDGER.md failed — an unreadable ledger is not proof the publish was guarded, so this fires rather than passing"
        else
          local sg_ok=0 sgt sg_last="" sg_last_ep=""
          while IFS= read -r sg_line; do
            [[ -n "$sg_line" ]] || continue
            sgt="$(printf '%s' "$sg_line" | "$GREP" -oE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z' | head -n 1)"
            [[ -n "$sgt" ]] || continue
            sg_ep="$(iso_to_epoch "$sgt")" || continue
            if [[ -z "$sg_last" ]] || (( sg_ep > sg_last_ep )); then sg_last="$sgt"; sg_last_ep="$sg_ep"; fi
            if (( sg_ep < pub_ep )); then sg_ok=1; sg_ts="$sgt"; break; fi
          done < "$WORKDIR/shipguard.txt"
          if (( sg_ok == 1 )); then
            PUB_NOTE="ok(guard ${sg_ts} earlier than publish ${pub_ts})"
          elif [[ -n "$sg_last" ]]; then
            PUB_NOTE="unguarded(publish ${pub_ts}: newest guard ${sg_last} is after the publish)"
            PUB_ALARM=1
            PUB_WHY="PUBLISHED: at ${pub_ts} but newest SHIP-GUARD: rc=0 at ${sg_last} is AFTER it — a later guard is a receipt, not a guard"
          else
            PUB_NOTE="unguarded(publish ${pub_ts}, no SHIP-GUARD: rc=0 line at all)"
            PUB_ALARM=1
            PUB_WHY="PUBLISHED: at ${pub_ts} with no SHIP-GUARD: rc=0 line at all — an unguarded publish (references/publish.md)"
          fi
        fi
      else
        PUB_NOTE="undetermined(last PUBLISHED: line carries no parseable timestamp)"
        add_undet "published=undetermined(the last PUBLISHED: line carries no parseable ISO8601Z timestamp — an undateable publish cannot be proven guarded)"
        PUB_ALARM=1
        PUB_WHY="the last PUBLISHED: line carries no parseable ISO8601Z timestamp — an undateable publish cannot be proven guarded, so this fires rather than passing"
      fi
      fi
    fi
  fi
  if (( PUB_ALARM == 1 )); then
    local PUB_ALARM_NAME="published-unguarded"
    [[ "$PUB_NOTE" == undetermined* ]] && PUB_ALARM_NAME="published-unguarded(undetermined)"
    ledger_write "CONTROL/LEDGER.md" \
      "$(iso_now) | DRIFT-ALARM | ${PUB_ALARM_NAME} | $(sanitize "${PUB_WHY}") | $(sanitize "run tools/ship-guard.sh <project> <the deployed origin>; on rc 0 record SHIP-GUARD: rc=0 BEFORE any PUBLISHED: line — order is the guard (references/publish.md)")"
    emit "ship-guard" "CONTROL/LEDGER.md" \
      "DRIFT-ALARM ${PUB_ALARM_NAME}: ${PUB_WHY}"
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
  LINE="$(iso_now) | S-CHECK | violations=${V} | runnable=${RUNNABLE} open=${OPEN} trees=${TREES} | cap=${CAP_NOTE} | anchor=${ANCHOR_NOTE} | bar=$(sanitize "$BAR_NOTE") | speech=$(sanitize "$SPEECH_NOTE") | stalled-turn=$(sanitize "$STALL_NOTE") | published=$(sanitize "$PUB_NOTE") | trees-detail=${TREE_NOTE} | actions=$(sanitize "$ACTS") | undetermined=$(sanitize_long "$UND")"
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
#   3  S6  a heartbeat 11 minutes old            -> exit 3, ACTION|reconcile-native-identity
#   4  CLEAN — an open, labelled, freshly-stamped row and nothing runnable
#          -> exit 0 and exactly one `S-CHECK | violations=0` ledger line
#   5  THE FLAG — CONTROL/TERMINAL-DRIFT.flag present -> exit 4
#   6  S13 a RESULT on the ledger and a fresh heartbeat -> exit 3, ACTION|reconcile-native-identity
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
#  17  SPEECH — the tick RUNS the lint on a draft newer than the last
#      SPEECH-CHECK line: a clean draft gains one SPEECH-CHECK line and no
#      alarm; the verbatim 2026-09-08 canary sentence REJECTS naming path
#      and tmp-path (case 18); a missing lint raises DRIFT-ALARM
#      speech-unchecked (case 19); an older draft causes no new run (case
#      20); the skill opening lints clean (case 21); five drafts yield one
#      line for the newest only (case 22); a hung lint never blocks the
#      tick (case 23).
#  18  (folded into 17 above: the speech-lint legs live in cases 17-23)
#  19  THE SNAPSHOT WITNESS (RC-29b) — a project past step 6.5 with no
#      task-graph-snapshot.json: first tick silent (one tick of grace), second
#      tick DRIFT-ALARM tasks-snapshot-absent at exit 3; the control with the
#      snapshot present stays silent.
#  29  GROUP-ABORT, THE POSITIVE — three agents of one dispatch row sharing
#      the end timestamp 2026-09-08T10:43:46Z with no completion record ->
#      exit 3, DRIFT-ALARM group-abort naming the row and agents=3, plus
#      ACTION|reconcile-native-identity. The canary's photographed signature.
#  30  THE DISCRIMINATING CONTROL — three agents of one row ending at
#      10:43:44Z, 10:43:46Z and 10:43:51Z each WITH a completion record ->
#      NO group-abort. 29 and 30 differ by the shared stamp and the RESULT
#      lines: an implementation that alarms on any three agents of one row
#      passes 29 and fails this control.
#  31  THE SECOND CONTROL — one lone agent with no completion record -> NO
#      group-abort. The rule is about the SHARED timestamp, not merely about
#      a missing completion record: the lone agent is the existing stall
#      path's business (S6 fires on it), never this alarm's.
#  26  PUBLISHED-UNGUARDED — a ledger with a PUBLISHED: line and no
#      SHIP-GUARD: rc=0 line -> exit 3, DRIFT-ALARM published-unguarded, and
#      the S-CHECK line carries published=unguarded(…).
#  27  THE CONTROL FOR 26 — SHIP-GUARD: rc=0 at an EARLIER timestamp than the
#      PUBLISHED: line -> exit 0 and no alarm. 26 and 27 differ by one ordered
#      ledger line, which is the presence half of the discrimination.
#  28  THE DISCRIMINATING CASE — PUBLISHED: at 10:29:28Z with SHIP-GUARD:
#      rc=0 at 10:35:00Z, the guard AFTER the publish -> exit 3, DRIFT-ALARM
#      published-unguarded. An implementation that greps for the presence of
#      both lines passes 26 and 27 and fails HERE: order is the guard, and a
#      guard written after the publish is a receipt, not a guard. Cases 1-25
#      carry no PUBLISHED: line at all, so none of them can fire this check —
#      that silence is the negative control for the whole section.
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
    # The operator box carries a `grep` shell shim that pretty-prints matches
    # instead of emitting them (see header §0). It is exported into this
    # shell, but command substitution runs `bash` (not sh), and a non-exported
    # function does not cross an exec boundary — so unsetting it here keeps
    # every child tick on the real grep this file already resolved into $GREP.
    unset -f grep 2>/dev/null || true
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
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reconcile-native-identity|U-02|' \
     && printf '%s' "$OUT" | "$GREP" -q 'S6 stale' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|relabel-and-redispatch'; then ok=1; fi
  report 3 "S6-stale-heartbeat" "$ok" "rc=${RC} (want 3); ACTION|reconcile-native-identity for U-02 at 11 min > 10; stale evidence alone cannot kill or replace it"

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
  if (( RC == 3 )) && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reconcile-native-identity|U-01|' \
     && printf '%s' "$OUT" | "$GREP" -q 'S13 finished-but-alive'; then ok=1; fi
  report 6 "S13-finished-but-alive" "$ok" "rc=${RC} (want 3); ACTION|reconcile-native-identity for U-01 — RESULT on the ledger, heartbeat still fresh"

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
  # --- case 17: SPEECH. A client message newer than the last SPEECH-CHECK line
  #     makes the tick RUN the lint on it: the lint writes its own verdict
  #     through ledger.sh. The row is open, labelled and freshly stamped, so
  #     nothing else can fire: the case isolates the speech run.
  mk_home "$T/c17"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-017\n' "$(stamp 1)" > "$T/c17/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c17/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c17/CONTROL/.speech"
  printf 'Your website is live. Have a look and tell me what to change.\n' > "$T/c17/CONTROL/.speech/turn-07.txt"
  local n17_before n17_after
  n17_before="$("$GREP" -c 'SPEECH-CHECK:' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n17_before" =~ ^[0-9]+$ ]] || n17_before=0
  runw "$T/c17"
  n17_after="$("$GREP" -c 'SPEECH-CHECK:' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n17_after" =~ ^[0-9]+$ ]] || n17_after=0
  ok=0
  if [[ "$n17_before" == "0" && "$n17_after" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'speech=ok(lint ran on turn-07.txt' \
     && "$GREP" -q 'SPEECH-CHECK: clean | file=turn-07.txt' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null \
     && ! "$GREP" -q 'DRIFT-ALARM | speech-unchecked' "$T/c17/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 17 "speech-lint-runs" "$ok" "rc=${RC}; SPEECH-CHECK lines before=${n17_before} after=${n17_after} (want 0 then 1); the tick RAN the lint and it wrote a clean verdict; no speech-unchecked alarm"

  # --- case 18: THE DISCRIMINATING CASE. The verbatim 2026-09-08 canary
  #     sentence must come back a REJECT naming `path` and `tmp-path` — the
  #     proof the tick ran the REAL lint rather than writing a stub line. A
  #     naive implementation that appends `SPEECH-CHECK: clean` fails here.
  mk_home "$T/c18"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-018\n' "$(stamp 1)" > "$T/c18/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c18/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c18/CONTROL/.speech"
  printf 'Details saved \xe2\x80\x94 backup at `/tmp/corner-post-framing-backup-20260908T1315Z`.\n' > "$T/c18/CONTROL/.speech/turn-06.txt"
  runw "$T/c18"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|speech-check|turn-06.txt|SPEECH-CHECK REJECT' \
     && "$GREP" -q 'SPEECH-CHECK: .*path.*tmp-path.*| file=turn-06.txt' "$T/c18/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'speech=reject(turn-06.txt'; then ok=1; fi
  report 18 "speech-reject-canary" "$ok" "rc=${RC} (want 3); the canary sentence came back a REJECT naming path and tmp-path on the ledger line for turn-06.txt — the tick ran the real lint"

  # --- case 19: THE LINT CANNOT BE RUN. speech-check.sh missing (chmod 000
  #     equivalent for the fixture: the file is not there) with a client-visible
  #     draft present still raises DRIFT-ALARM speech-unchecked — the narrowed
  #     WI-54 alarm, which now fires only when the lint could not run at all.
  mk_home "$T/c19"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-019\n' "$(stamp 1)" > "$T/c19/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c19/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c19/CONTROL/.speech"
  printf 'Your website is live. Have a look and tell me what to change.\n' > "$T/c19/CONTROL/.speech/turn-07.txt"
  set +e
  OUT="$(WATCH_SPEECH_CHECK_SH="$T/c19/no-such-speech-check.sh" bash "$SELF" "$T/c19" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|speech-check|turn-07.txt|DRIFT-ALARM speech-unchecked' \
     && printf '%s' "$OUT" | "$GREP" -q 'speech=unchecked(turn-07.txt' \
     && "$GREP" -q 'DRIFT-ALARM | speech-unchecked | drafts=1 unchecked=1' "$T/c19/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 19 "speech-unchecked-no-lint" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | speech-unchecked written for turn-07.txt with the lint missing; the narrowed alarm fires only when the lint could not be run at all"

  # --- case 20: THE CONTROL THAT PROVES IT DOES NOT OVER-FIRE. The draft is
  #     OLDER than the newest SPEECH-CHECK line, so no new lint run and no new
  #     ledger line: the counts before and after are identical.
  mk_home "$T/c20"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-020\n' "$(stamp 1)" > "$T/c20/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c20/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c20/CONTROL/.speech"
  printf 'Your website is live. Have a look and tell me what to change.\n' > "$T/c20/CONTROL/.speech/turn-07.txt"
  touch -d '2001-01-01 00:00:00 UTC' "$T/c20/CONTROL/.speech/turn-07.txt" 2>/dev/null \
    || touch -t 200101010000 "$T/c20/CONTROL/.speech/turn-07.txt"
  printf '%s | SPEECH-CHECK: clean | file=turn-07.txt\n' "$(stamp 1)" > "$T/c20/CONTROL/LEDGER.md"
  local n20_before n20_after
  n20_before="$("$GREP" -c 'SPEECH-CHECK:' "$T/c20/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n20_before" =~ ^[0-9]+$ ]] || n20_before=0
  runw "$T/c20"
  n20_after="$("$GREP" -c 'SPEECH-CHECK:' "$T/c20/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n20_after" =~ ^[0-9]+$ ]] || n20_after=0
  ok=0
  if [[ "$n20_before" == "1" && "$n20_after" == "1" ]] \
     && ! printf '%s' "$OUT" | "$GREP" -q 'speech-unchecked' \
     && printf '%s' "$OUT" | "$GREP" -q 'speech=ok(all drafts linted)'; then ok=1; fi
  report 20 "speech-no-overfire" "$ok" "rc=${RC}; SPEECH-CHECK lines before=${n20_before} after=${n20_after} (want 1 then 1); an older draft caused no new lint run and no new ledger line"

  # --- case 21: THE SKILL'S OWN WORDS. The verbatim opening from SKILL.md
  #     must come back a clean verdict, exit 0 — a lint that rejects the
  #     skill's own words is worse than no lint.
  mk_home "$T/c21"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-021\n' "$(stamp 1)" > "$T/c21/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c21/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c21/CONTROL/.speech"
  printf '> Hi, I'"'"'m Candace. I build the thing you'"'"'ve been wanting: a website, an app for phones or computers, or pages that sell for you. You don'"'"'t need to know which; that'"'"'s my job.\n\n> Here'"'"'s how it works. I ask you plain questions, one at a time. "I don'"'"'t know" is always a fine answer; I'"'"'ll choose. Then my helpers build it, check it, and put it online, around the clock. You can walk away.\n' > "$T/c21/CONTROL/.speech/turn-01.txt"
  runw "$T/c21"
  ok=0
  if (( RC == 0 )) \
     && "$GREP" -q 'SPEECH-CHECK: clean | file=turn-01.txt' "$T/c21/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 21 "speech-opening-clean" "$ok" "rc=${RC} (want 0); the verbatim opening produced a clean verdict for turn-01.txt"

  # --- case 22: ONE FILE PER TICK. Five unchecked drafts produce exactly one
  #     new SPEECH-CHECK line, for the newest draft only.
  mk_home "$T/c22"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-022\n' "$(stamp 1)" > "$T/c22/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c22/CONTROL/HEARTBEAT.md"
  mkdir -p "$T/c22/CONTROL/.speech"
  printf 'First draft, please ignore.\n' > "$T/c22/CONTROL/.speech/turn-01.txt"
  printf 'Second draft, please ignore.\n' > "$T/c22/CONTROL/.speech/turn-02.txt"
  printf 'Third draft, please ignore.\n' > "$T/c22/CONTROL/.speech/turn-03.txt"
  printf 'Fourth draft, please ignore.\n' > "$T/c22/CONTROL/.speech/turn-04.txt"
  printf 'Fifth draft, please ignore.\n' > "$T/c22/CONTROL/.speech/turn-05.txt"
  local n22_before n22_after
  n22_before="$("$GREP" -c 'SPEECH-CHECK:' "$T/c22/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n22_before" =~ ^[0-9]+$ ]] || n22_before=0
  runw "$T/c22"
  n22_after="$("$GREP" -c 'SPEECH-CHECK:' "$T/c22/CONTROL/LEDGER.md" 2>/dev/null || true)"
  [[ "$n22_after" =~ ^[0-9]+$ ]] || n22_after=0
  ok=0
  if [[ "$n22_before" == "0" && "$n22_after" == "1" ]] \
     && "$GREP" -q 'SPEECH-CHECK: clean | file=turn-05.txt' "$T/c22/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 22 "speech-one-file-per-tick" "$ok" "rc=${RC}; SPEECH-CHECK lines before=${n22_before} after=${n22_after} (want 0 then 1); the one new line is for the newest draft turn-05.txt"

  # --- case 23: THE TICK SURVIVES A BROKEN LINT. speech-check.sh replaced by
  #     a script that sleeps past its timeout: the tick's other verdicts are
  #     still written and the run is not blocked.
  mk_home "$T/c23"
  printf -- '- [ ] U-02 qc\n- [ ] U-03 build\n' > "$T/c23/CONTROL/CHECKLIST.md"
  printf '# Dispatch log\n' > "$T/c23/CONTROL/dispatch-log.md"
  mkdir -p "$T/c23/CONTROL/.speech"
  printf 'Your website is live. Have a look and tell me what to change.\n' > "$T/c23/CONTROL/.speech/turn-07.txt"
  printf '#!/usr/bin/env bash\nsleep 60\nexit 0\n' > "$T/c23/broken-speech-check.sh"
  chmod +x "$T/c23/broken-speech-check.sh"
  local OUT23 RC23
  set +e
  OUT23="$(WATCH_SPEECH_CHECK_SH="$T/c23/broken-speech-check.sh" WATCH_SPEECH_TIMEOUT=2 bash "$SELF" "$T/c23" 2>&1)"; RC23=$?
  set -e
  ok=0
  if (( RC23 == 3 )) \
     && printf '%s' "$OUT23" | "$GREP" -q '^ACTION|dispatch-now|' \
     && printf '%s' "$OUT23" | "$GREP" -q 'S-CHECK | violations=' \
     && "$GREP" -q 'S-CHECK | violations=' "$T/c23/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 23 "speech-broken-lint-survives" "$ok" "rc=${RC23} (want 3); the S2 verdict still fired and the S-CHECK line was still written while the lint slept past its 2s timeout — output quoted: [$(printf '%s' "$OUT23" | "$GREP" -m2 '^ACTION\|S-CHECK' | tr '\n' ';')]"

  # --- case 29: GROUP-ABORT, THE POSITIVE. One dispatch wave (run-090)
  #     booking three agents; all three heartbeat lines frozen at the
  #     identical end stamp 2026-09-08T10:43:46Z — the canary's photographed
  #     signature — with no completion record anywhere. The alarm MUST fire,
  #     naming the row and agents=3, with the rung-1 identity-reconcile ACTION.
  #     NOTE on the checklist: U-02 stays open with no dispatch row so S2
  #     cannot fire (runnable=1 needs open=0); the wave units U-11..U-13 are
  #     not checklist boxes, so they add no runnable count either. S6 WILL
  #     also fire on the stale wave units — an identity-unverified agent is both
  #     stale and group-aborted, and the case does not assert S6's absence.
  mk_home "$T/c29"
  printf '2026-09-08T10:40:00Z | U-11 build U-12 build U-13 build | build | [opus x10] WF04 builders | run=run-090 | units=3 | agents=3 | cap=10 | floor=3 | stages=4 | dep=none | executions_total=3\n' > "$T/c29/CONTROL/dispatch-log.md"
  {
    printf '2026-09-08T10:43:46Z | WF04 builder-a | U-11 | build\n'
    printf '2026-09-08T10:43:46Z | WF04 builder-b | U-12 | build\n'
    printf '2026-09-08T10:43:46Z | WF04 builder-c | U-13 | build\n'
  } > "$T/c29/CONTROL/HEARTBEAT.md"
  runw "$T/c29"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'DRIFT-ALARM group-abort: 3 agents of dispatch row run-090 ended at the identical timestamp 2026-09-08T10:43:46Z' \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reconcile-native-identity|U-11,U-12,U-13|' \
     && "$GREP" -q 'DRIFT-ALARM | group-abort | row=run-090 agents=3 at=2026-09-08T10:43:46Z' "$T/c29/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 29 "group-abort-positive" "$ok" "rc=${RC} (want 3); DRIFT-ALARM group-abort naming row=run-090 agents=3 at=2026-09-08T10:43:46Z written; ACTION|reconcile-native-identity for U-11,U-12,U-13 emitted"

  # --- case 30: THE DISCRIMINATING CONTROL. The same wave, but the three
  #     agents ended seconds apart (10:43:44Z, 10:43:46Z, 10:43:51Z) and each
  #     carries a completion record. No shared death stamp, no missing
  #     completion — the alarm MUST stay silent. An implementation that alarms
  #     on any three agents of one row passes 19 and fails here.
  mk_home "$T/c30"
  printf '2026-09-08T10:40:00Z | U-11 build U-12 build U-13 build | build | [opus x10] WF04 builders | run=run-090 | units=3 | agents=3 | cap=10 | floor=3 | stages=4 | dep=none | executions_total=3\n' > "$T/c30/CONTROL/dispatch-log.md"
  {
    printf '2026-09-08T10:43:44Z | WF04 builder-a | U-11 | build\n'
    printf '2026-09-08T10:43:46Z | WF04 builder-b | U-12 | build\n'
    printf '2026-09-08T10:43:51Z | WF04 builder-c | U-13 | build\n'
  } > "$T/c30/CONTROL/HEARTBEAT.md"
  {
    printf '2026-09-08T10:44:00Z | RESULT | unit=U-11 | PASS | evidence=repos/a.ts\n'
    printf '2026-09-08T10:44:01Z | RESULT | unit=U-12 | PASS | evidence=repos/b.ts\n'
    printf '2026-09-08T10:44:02Z | RESULT | unit=U-13 | PASS | evidence=repos/c.ts\n'
  } > "$T/c30/CONTROL/LEDGER.md"
  runw "$T/c30"
  ok=0
  if ! printf '%s' "$OUT" | "$GREP" -q 'group-abort' \
     && ! "$GREP" -q 'group-abort' "$T/c30/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 30 "group-abort-staggered-control" "$ok" "rc=${RC}; staggered end stamps with a RESULT per unit raised no group-abort on stdout or on the ledger — the check discriminates instead of firing on every wave"

  # --- case 31: THE SECOND CONTROL. One lone agent with no completion
  #     record. The rule is about the SHARED timestamp, not merely about a
  #     missing completion: the lone agent is the existing stall path's
  #     business (S6 fires on it below), never this alarm's.
  mk_home "$T/c31"
  printf '2026-09-08T10:40:00Z | U-11 build | build | [opus x10] WF04 builder | run=run-091 | units=1 | agents=1 | cap=10 | floor=1 | stages=4 | dep=none | executions_total=1\n' > "$T/c31/CONTROL/dispatch-log.md"
  printf '2026-09-08T10:43:46Z | WF04 builder-a | U-11 | build\n' > "$T/c31/CONTROL/HEARTBEAT.md"
  runw "$T/c31"
  ok=0
  if ! printf '%s' "$OUT" | "$GREP" -q 'group-abort' \
     && ! "$GREP" -q 'group-abort' "$T/c31/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|reconcile-native-identity|U-11|'; then ok=1; fi
  report 31 "group-abort-lone-agent-control" "$ok" "rc=${RC}; one agent with no RESULT raised no group-abort anywhere, and S6 still fired ACTION|reconcile-native-identity for U-11 — the stall path kept its jurisdiction"

  # --- case 32: STALLED-TURN. A BUILD row stands open and every file under
  #     the project folder is 20 minutes old, past the 15-minute ceiling. The
  #     mtimes are SET with touch -t and READ BACK with stat -f %m, so the
  #     ages are measured, not assumed. The row is labelled and freshly
  #     stamped with a fresh heartbeat, so S3, S6 and S13 stay silent: the
  #     case isolates the stalled-turn check.
  mk_home "$T/c32"
  printf '%s | U-01 build | build | [opus x10] WF01 builder | run-032\n' "$(stamp 1)" > "$T/c32/CONTROL/dispatch-log.md"
  printf '%s | WF01 builder | U-01 | build\n' "$(stamp 1)" > "$T/c32/CONTROL/HEARTBEAT.md"
  printf 'build output\n' > "$T/c32/work.txt"
  OUT22_OLD="$(date -u -v-20M +%Y%m%d%H%M 2>/dev/null || date -u -d '20 minutes ago' +%Y%m%d%H%M)"
  TZ=UTC touch -t "${OUT22_OLD}" "$T/c32/work.txt" "$T/c32/CONTROL/dispatch-log.md" "$T/c32/CONTROL/HEARTBEAT.md" "$T/c32/CONTROL/CHECKLIST.md" "$T/c32/CONTROL/TODO.md" "$T/c32/CONTROL/setup_progress.json" "$T/c32/SPEC/GOAL.md"
  local c22_mtime c22_age
  c22_mtime="$(stat -f %m "$T/c32/work.txt" 2>/dev/null || stat -c %Y "$T/c32/work.txt")"
  c22_age=$(( ($(date -u +%s) - c22_mtime) / 60 ))
  runw "$T/c32"
  ok=0
  if (( RC == 3 )) \
     && (( c22_age >= 15 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|stalled-turn|' \
     && printf '%s' "$OUT" | "$GREP" -q 'stalled-turn=stalled(elapsed=' \
     && "$GREP" -q 'DRIFT-ALARM | stalled-turn | elapsed=' "$T/c32/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 32 "stalled-turn-fires" "$ok" "rc=${RC} (want 3); work.txt mtime read back as ${c22_age}m old (want >= 15, set by touch -t ${OUT22_OLD}); ACTION|stalled-turn emitted; DRIFT-ALARM | stalled-turn | elapsed= on the ledger"

  # --- case 33: THE CONTROL FOR 19. Byte for byte the same fixture, backdated
  #     5 minutes. The ceiling must stay silent: a check that fires on a fresh
  #     write measures nothing. This pair is the discrimination for the whole
  #     stalled-turn section.
  mk_home "$T/c33"
  printf '%s | U-01 build | build | [opus x10] WF01 builder | run-033\n' "$(stamp 1)" > "$T/c33/CONTROL/dispatch-log.md"
  printf '%s | WF01 builder | U-01 | build\n' "$(stamp 1)" > "$T/c33/CONTROL/HEARTBEAT.md"
  printf 'build output\n' > "$T/c33/work.txt"
  OUT23_OLD="$(date -u -v-5M +%Y%m%d%H%M 2>/dev/null || date -u -d '5 minutes ago' +%Y%m%d%H%M)"
  TZ=UTC touch -t "${OUT23_OLD}" "$T/c33/work.txt" "$T/c33/CONTROL/dispatch-log.md" "$T/c33/CONTROL/HEARTBEAT.md" "$T/c33/CONTROL/CHECKLIST.md" "$T/c33/CONTROL/TODO.md" "$T/c33/CONTROL/setup_progress.json" "$T/c33/SPEC/GOAL.md"
  local c23_mtime c23_age
  c23_mtime="$(stat -f %m "$T/c33/work.txt" 2>/dev/null || stat -c %Y "$T/c33/work.txt")"
  c23_age=$(( ($(date -u +%s) - c23_mtime) / 60 ))
  runw "$T/c33"
  ok=0
  if (( RC == 0 )) \
     && (( c23_age < 15 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'DRIFT-ALARM stalled-turn' \
     && ! "$GREP" -q 'DRIFT-ALARM' "$T/c33/CONTROL/LEDGER.md" 2>/dev/null \
     && printf '%s' "$OUT" | "$GREP" -q 'stalled-turn=ok('; then ok=1; fi
  report 33 "stalled-turn-control" "$ok" "rc=${RC} (want 0); work.txt mtime read back as ${c23_age}m old (want < 15, set by touch -t ${OUT23_OLD}); no stalled-turn anywhere; the S-CHECK line carries stalled-turn=ok(…); no DRIFT-ALARM on the ledger"
  # --- case 24: THE SNAPSHOT WITNESS (RC-29b). A project past step 6.5 (the
  #     CAPACITY-LEDGER.md file) with no task-graph-snapshot.json: the first
  #     tick counts the miss in silence (one tick of grace), the second tick
  #     raises DRIFT-ALARM tasks-snapshot-absent at exit 3 with
  #     ACTION|write-task-snapshot. The control is the SAME project with the
  #     snapshot present: no alarm, no flag file, no ACTION. A witness that
  #     fires on both measures nothing.
  mk_home "$T/c24"
  printf 'CLIENT_CAP=10\n' > "$T/c24/CAPACITY-LEDGER.md"
  set +e
  OUT="$(bash "$SELF" "$T/c24" 2>&1)"; RC=$?
  set -e
  local rc24a="$RC" alarm24a=0
  "$GREP" -q 'tasks-snapshot-absent' "$T/c24/CONTROL/LEDGER.md" 2>/dev/null && alarm24a=1
  set +e
  OUT="$(bash "$SELF" "$T/c24" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 3 )) && (( alarm24a == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|write-task-snapshot|CONTROL/task-graph-snapshot.json|' \
     && "$GREP" -q 'DRIFT-ALARM | tasks-snapshot-absent' "$T/c24/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 24 "snapshot-absent-alarm" "$ok" "first tick rc=${rc24a} silent (alarm on ledger=${alarm24a}, want 0 — one tick of grace); second tick rc=${RC} (want 3) with DRIFT-ALARM | tasks-snapshot-absent and ACTION|write-task-snapshot"
  # the control: the snapshot present, the SAME project stays silent.
  bash "${SCRIPT_DIR}/anchor.sh" --write-tasks "$T/c24" >/dev/null 2>&1
  rm -f "$T/c24/CONTROL/.snapshot-missing"
  "$GREP" -v 'tasks-snapshot-absent' "$T/c24/CONTROL/LEDGER.md" > "$T/c24/CONTROL/LEDGER.md.clean" 2>/dev/null \
    && mv "$T/c24/CONTROL/LEDGER.md.clean" "$T/c24/CONTROL/LEDGER.md" || true
  set +e
  OUT="$(bash "$SELF" "$T/c24" 2>&1)"; RC=$?
  set -e
  ok=0
  if ! printf '%s' "$OUT" | "$GREP" -q 'tasks-snapshot-absent' \
     && ! "$GREP" -q 'tasks-snapshot-absent' "$T/c24/CONTROL/LEDGER.md" 2>/dev/null \
     && [[ ! -f "$T/c24/CONTROL/.snapshot-missing" ]]; then ok=1; fi
  report 25 "snapshot-present-control" "$ok" "rc=${RC}; no tasks-snapshot-absent on stdout or the ledger, and no .snapshot-missing flag file — the witness discriminates"

  # --- case 26: PUBLISHED-UNGUARDED. The row is open, labelled and freshly
  #     stamped, so nothing else can fire: the case isolates the publish check.
  mk_home "$T/c26"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-026\n' "$(stamp 1)" > "$T/c26/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c26/CONTROL/HEARTBEAT.md"
  printf '2026-09-08T10:29:28Z | PUBLISHED: https://example-026.vercel.app domain=none status=200\n' > "$T/c26/CONTROL/LEDGER.md"
  runw "$T/c26"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|ship-guard|CONTROL/LEDGER.md|DRIFT-ALARM published-unguarded:' \
     && printf '%s' "$OUT" | "$GREP" -q 'published=unguarded(publish 2026-09-08T10:29:28Z, no SHIP-GUARD: rc=0 line at all)' \
     && "$GREP" -q 'DRIFT-ALARM | published-unguarded |' "$T/c26/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 26 "published-unguarded" "$ok" "rc=${RC} (want 3); DRIFT-ALARM | published-unguarded written for the PUBLISHED: line with no guard line; ACTION|ship-guard emitted; the S-CHECK line carries published=unguarded(…)"

  # --- case 27: THE CONTROL FOR 26. Byte for byte the same fixture plus the
  #     guard line at an EARLIER timestamp. The alarm must go silent: a check
  #     that fires whether or not the guard ran is not a check.
  mk_home "$T/c27"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-027\n' "$(stamp 1)" > "$T/c27/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c27/CONTROL/HEARTBEAT.md"
  {
    printf '2026-09-08T10:20:00Z | SHIP-GUARD: rc=0 checks=14 at=2026-09-08T10:20:00Z\n'
    printf '2026-09-08T10:29:28Z | PUBLISHED: https://example-027.vercel.app domain=none status=200\n'
  } > "$T/c27/CONTROL/LEDGER.md"
  runw "$T/c27"
  ok=0
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'published-unguarded' \
     && printf '%s' "$OUT" | "$GREP" -q 'published=ok(guard 2026-09-08T10:20:00Z earlier than publish 2026-09-08T10:29:28Z)' \
     && ! "$GREP" -q 'DRIFT-ALARM' "$T/c27/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 27 "published-guarded-control" "$ok" "rc=${RC} (want 0); the earlier SHIP-GUARD: rc=0 line silenced the alarm; no DRIFT-ALARM on the ledger; the S-CHECK line carries published=ok(guard … earlier than publish …)"

  # --- case 28: THE DISCRIMINATING CASE. Both lines are present, but the
  #     guard is stamped 10:35:00Z — AFTER the 10:29:28Z publish. A guard
  #     written after the publish is a receipt, not a guard, so the alarm
  #     MUST fire. A presence-only implementation passes 19 and 20 and fails
  #     HERE, which is the leg that would have caught the canary shape (a
  #     page published while its guard sat unused in the same tree).
  mk_home "$T/c28"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-028\n' "$(stamp 1)" > "$T/c28/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c28/CONTROL/HEARTBEAT.md"
  {
    printf '2026-09-08T10:29:28Z | PUBLISHED: https://example-028.vercel.app domain=none status=200\n'
    printf '2026-09-08T10:35:00Z | SHIP-GUARD: rc=0 checks=14 at=2026-09-08T10:35:00Z\n'
  } > "$T/c28/CONTROL/LEDGER.md"
  runw "$T/c28"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|ship-guard|CONTROL/LEDGER.md|DRIFT-ALARM published-unguarded:' \
     && printf '%s' "$OUT" | "$GREP" -q 'newest SHIP-GUARD: rc=0 at 2026-09-08T10:35:00Z is AFTER it' \
     && "$GREP" -q 'DRIFT-ALARM | published-unguarded |' "$T/c28/CONTROL/LEDGER.md" 2>/dev/null \
     && "$GREP" -q 'a later guard is a receipt, not a guard' "$T/c28/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 28 "published-guard-after-publish" "$ok" "rc=${RC} (want 3); both lines present but the guard at 10:35:00Z is AFTER the publish at 10:29:28Z — DRIFT-ALARM | published-unguarded still written, because order is the guard"

  # --- case 34: a no-URL artifact release has status=n/a by contract. It has
  # no HTTP origin, so the URL-only guard must be n/a rather than an alarm; the
  # target's artifact/signing/install/runtime evidence is checked at release.
  mk_home "$T/c29"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-029\n' "$(stamp 1)" > "$T/c29/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c29/CONTROL/HEARTBEAT.md"
  printf '2026-09-08T10:29:28Z | PUBLISHED: studio-nerds-macos-arm64.pkg target=desktop-macos-arm64 domain=none status=n/a\n' > "$T/c29/CONTROL/LEDGER.md"
  runw "$T/c29"
  ok=0
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'published-unguarded' \
     && printf '%s' "$OUT" | "$GREP" -q 'published=n/a(no-URL release; target-specific artifact evidence owns its guard)' \
     && ! "$GREP" -q 'DRIFT-ALARM.*published-unguarded' "$T/c29/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 34 "published-no-url-not-ship-gated" "$ok" "rc=${RC} (want 0); status=n/a skips only the URL-origin guard and raises no published-unguarded alarm"

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
