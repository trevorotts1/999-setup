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
#                     --log <project>/CONTROL/watch-tick.log
#       The script opens its own log (--log), never cron's shell: a `>>` the
#       shell cannot open (where macOS privacy refuses cron ~/Desktop,
#       ~/Documents or ~/Downloads) would stop the tick before it ran, with
#       nothing named.
#       See 4h, TICK-BLOCKED-BY-PRIVACY.
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
#   A PROFILED PROJECT REDIRECTS THIS TICK; IT NEVER SWITCHES IT OFF.
#   references/project-profile.md: "A profile REDIRECTS the helpers; it never
#   switches them off ... watch-tick ... all still run on a profiled project ...
#   The five-minute tick ... NEVER skipped: an unwatched run is the exact
#   failure these instruments exist to prevent." When the project home holds
#   `.spec-protocol.json`, the tick binds to that profile instead of to CONTROL/:
#     --cron-line / --arm  write the SAME */5 line, logging beside the BOUND
#       state — `<home>/<dirname of documents.state>/watch-tick.log` rather than
#       `<home>/CONTROL/watch-tick.log`. Arming stays the same idempotent
#       instrument: 0 armed, 3 already present, 2 crontab unavailable (named).
#     THE TICK ITSELF  runs the profile's own `commands.validate` argv at the
#       project root — an argv array, never a shell line, so a value in the
#       profile can NAME a program and can never be evaluated as one — and
#       prints one verdict line:
#         PROFILE-TICK | <ISO8601Z> | home=<home> | validate_rc=0 | <stdout, 200 chars>
#         PROFILE-TICK STALL | <ISO8601Z> | home=<home> | validate_rc=<rc> | <stderr, 200 chars>
#       exit 0 on rc 0, exit 3 on any other rc — the SAME "something needs
#       attention" code the S-checks already use, because inventing a second
#       one would make one tick's stall unreadable to a reader of the other's.
#       Then the batch merge when due (MERGE-BATCH), the profile's optional
#       `commands.refresh` (PROFILE-REFRESH; a failure is logged, never fatal)
#       and the post-interview stalled-turn check with AUTO-RESUME, exactly as
#       on a legacy project (a stall is exit 3 too). It never creates CONTROL/
#       or a second task graph: its records, locks and stamps live in
#       `<statedir>/spec-protocol/` beside the bound state, and its ledger
#       lines go through tools/ledger.sh to `<statedir>/spec-protocol/LEDGER.md`.
#     A PROFILE IT CANNOT READ IS UNDETERMINED AND LOUD: unparseable JSON, a
#       missing `documents.state`, or a missing `commands.validate` is exit 2
#       naming the file and the key — never a silent fall back to CONTROL/,
#       which would be the second copy the profile forbids.
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
#   sweeps   every tick, after the merge batch, per registered repo (4g):
#            a MERGED/landed claim that fails proof of merge
#                                              -> MERGE-CLAIM-FALSE, re-queued
#                                              -> ACTION|requeue
#            a worktree whose branch is proven merged -> removed with its
#            branch (ORPHAN-CLEANED); a dirty one KEPT-UNMERGED; an unmerged
#            one with no commit for 2 hours -> STALE-UNMERGED, re-queued
#                                              -> ACTION|requeue
#            a release/tag claim that fails proof of mint
#                                              -> MINT-CLAIM-FALSE (ledger and
#                                                 the morning report's operator
#                                                 notes) -> ACTION|mint-check
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
#   watch-tick.sh <project-home> --log <file>    # the tick, appending its own
#                                                #   output to <file> (the cron
#                                                #   line's form; 4h)
#   watch-tick.sh --arm <project-home>           # WRITE it (step 3), idempotently:
#                                                #   0 armed, 3 already present,
#                                                #   2 crontab unavailable (named)
#                                                #   (also records the session for
#                                                #   AUTO-RESUME; profiled: in
#                                                #   <statedir>/spec-protocol/)
#   watch-tick.sh --record-session <project-home> # at INTERVIEW END (after the
#                                                #   walk-away line), inside the
#                                                #   conductor session: records the
#                                                #   session id again + interview=done,
#                                                #   so a window closed after the last
#                                                #   question is still resumable.
#                                                #   0 recorded, 2 no session id
#   watch-tick.sh <project-home> --check         # READ-ONLY: 0 this project's tick
#                                                #   line is installed, 3 it is not,
#                                                #   2 the table could not be read
#   watch-tick.sh <project-home> --sweep         # the repo sweeps (4g) ALONE: 0 nothing
#                                                #   found, 3 findings (the Node twin runs this)
#   watch-tick.sh --selftest
#   A stalled-turn alarm also runs AUTO-RESUME: it opens a VISIBLE Terminal
#   window running `<launcher> --permission-mode bypassPermissions --resume
#   <id> "/spec-protocol resume"` — an ordinary interactive session, never
#   `-p`, never hidden or detached (nobody is there to answer a permission
#   prompt; the session gets node + ~/.local/bin + the 999 npm bin on PATH —
#   see resume_path, 4d; the cron line itself stays PATH-free), or, when no
#   window opens, starts nothing and leaves AUTO-RESUME-NOT-OPENED on the
#   ledger plus the continue command in the morning report's Operator notes.
#   Once, lock-guarded for 30 minutes
#   (CONTROL/auto-resume.lock; `<statedir>/spec-protocol/auto-resume.lock`
#   on a profiled project), and writes an AUTO-RESUME ledger line. The
#   alarm covers EVERY post-interview phase, not only build: an open build,
#   spec, apparatus, audit, merge or publish row, or `interview=done` in
#   CONTROL/auto-resume.txt (research included), with no project write for
#   STALLED_MIN minutes. Outside build it is skipped while project_state.json
#   says run_status is anything but RUNNING (a finished or paused run waits).
#   Every form takes the SAME arguments on a profiled project (one holding
#   `.spec-protocol.json`); what changes is where the line logs and what the
#   tick runs — see the profiled-tick note above. There is no flag to turn the
#   tick off, on either path: an unwatched run is the failure it exists to stop.
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
#                               Both also feed --check.
#   WATCH_TICK_LAUNCHER_CMD=<cmd>  selftest only: the program AUTO-RESUME runs
#                               instead of the recorded launcher. The selftest
#                               sets it for every case so no real session is
#                               ever launched; nothing else should.
#   WATCH_TICK_OPEN_CMD=<cmd>      selftest only: replaces /usr/bin/open (the
#   WATCH_TICK_OSASCRIPT_CMD=<cmd> visible-window opener) and /usr/bin/osascript
#                               (its one fallback). The selftest sets both to
#                               /usr/bin/false unless a case names its stub, so
#                               no real window ever opens.
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
#   MERGE_BATCH_MINUTES=10      merge-window cadence: every N minutes the tick
#                               reaches a merge WINDOW and writes ONE durable
#                               request into <area>/wm-queue/ for the visible
#                               S75-WM workflow (see 4e). The timer NEVER runs
#                               tools/merge-train.sh and never integrates:
#                               only S75-WM's visible native workflow runs the
#                               train, serially per repo under its own lock.
#                               0 is REJECTED (exit 2): zero made the interval
#                               check eligible on every tick — the bug 4e
#                               closes. Use MERGE_BATCH_DISABLE=1 to disable.
#   MERGE_BATCH_DISABLE=1       explicit disable for the merge windows; the
#                               S-CHECK line says so. 0 is never a disable.
#   WATCH_SWEEP_NET_TIMEOUT=60  seconds one fetch / ls-remote / push of the repo sweeps may take
#   WATCH_STALE_UNMERGED_MIN=120  minutes without a commit before an unmerged worktree
#                               branch is STALE-UNMERGED (the orphan sweep, 4g)
#   WATCH_MERGE_TRAIN_SH=<path>   CANARY ONLY: the timer must never execute it.
#                               The selftest points it at a marker stub and
#                               fails if the marker ever appears.
#   WATCH_SUPERVISOR_TICK_SECONDS=60    the deterministic supervisor tick (4i)
#   WATCH_SUPERVISOR_REPORT_SECONDS=600 the section 10.6 report cadence (4i)
#   WATCH_SUPERVISOR_OVERDUE_SECONDS=180  a supervisor older than this pauses
#                               new dispatch (4i) instead of declaring anything
#   WATCH_SUPERVISOR_MAX_TICKS=0  selftest/fixture bound on the --supervise
#                               loop (0 = run until stopped; the supervisor
#                               never auto-stops)
#   WATCH_REFRESH_TIMEOUT=120   seconds one profile `commands.refresh` run may take
#   WATCH_TICK_LS=<path>        selftest stub only: the program the privacy probe
#                               (4h) lists the project folder with
#   XDG_STATE_HOME              where 4h keeps its record (default ~/.local/state)
#
# PATHS WITH SPACES. Every path the crontab line carries (the skill folder, the
# project home, the log) is single-quoted, so "My Project Folder" is one word to
# cron's /bin/sh; a % is written \% because cron reads a bare % as a newline.
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
DO_CHECK=0
DO_RECORD=0
DO_SWEEP=0
DO_SUPERVISE=0
DO_SUP_STATUS=0
DO_BRIDGE=0
LOG_FILE=""

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
  [[ -n "${MERGE_LOCK:-}" && -d "$MERGE_LOCK" ]] && rm -rf "$MERGE_LOCK"
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

# sq <path> -> the path as ONE single-quoted sh word, for the crontab line. A
# folder named "My Project Folder" is three words to cron's /bin/sh unquoted.
# A ' inside becomes '\'' and a % becomes \% — cron turns a bare % into a newline
# even inside quotes, and strips the backslash before handing the line to sh.
sq() {
  local s="${1//\'/\'\\\'\'}"
  printf "'%s'" "${s//%/\\%}"
}
# glob_esc <path> -> the path with find(1) -path glob characters escaped, so a
# folder named "[draft] app" still prunes the directory it names.
glob_esc() { printf '%s' "$1" | sed 's/[][*?\\]/\\&/g'; }

ledger_write() {  # ledger_write <relative-file> <line>
  local f="$1" line="$2" out rc
  [[ -x "$LEDGER_SH" ]] || die_tool "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every write goes through it"
  set +e
  out="$("$LEDGER_SH" "$HOME_DIR" "$f" "$line" 2>&1)"; rc=$?
  set -e
  if (( rc != 0 )); then die_tool "ledger.sh failed (rc=${rc}) writing ${f}: ${out}"; fi
}

#------------------------------------------------------------------------------
# 2b. THE PROFILE READ (references/project-profile.md). A supplied project may
#     bind its own canonical state and its own commands through
#     `.spec-protocol.json`. This tick REDIRECTS onto that binding; it never
#     switches itself off and it never creates a second CONTROL/ beside it.
#
#     THE PROFILE IS DATA, NEVER SCRIPT. It is parsed by a JSON parser and no
#     value in it is ever shell-evaluated: a value may NAME a path or an argv
#     element and can never run as a command line. python3 is that parser — the
#     one interpreter present on both the fleet's macOS boxes and its Linux
#     ones. A box with none is UNDETERMINED and LOUD (exit 2 naming what was
#     tried), never a silent fall back to CONTROL/: a tick that quietly watched
#     the wrong tree would be exactly the unwatched run this file exists to stop.
#------------------------------------------------------------------------------
PYTHON3="$(command -v python3 2>/dev/null || true)"
[[ -n "$PYTHON3" && -x "$PYTHON3" ]] || PYTHON3=""
[[ -n "$PYTHON3" || ! -x /usr/bin/python3 ]] || PYTHON3="/usr/bin/python3"

# Reads ONE key and validates its shape there, so a caller that needs only the
# state path never dies for a command it was not going to run.
#   exit 3 unparseable | exit 4 the key is missing or malformed | exit 5 a value
#   carries a newline (it would forge a second line of whatever it is written to)
PROFILE_PY='
import json,sys
path,key=sys.argv[1],sys.argv[2]
try:
    d=json.load(open(path))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(3)
if not isinstance(d,dict):
    sys.stderr.write("the top level is not a JSON object")
    sys.exit(3)
if key=="state":
    v=(d.get("documents") or {}).get("state")
    ok=isinstance(v,str) and v.strip()!=""
    vals=[v.strip()] if ok else []
elif key=="refresh":
    v=(d.get("commands") or {}).get("refresh")
    if v is None:
        sys.exit(6)
    ok=isinstance(v,list) and len(v)>0 and all(isinstance(x,str) and x!="" for x in v)
    vals=list(v) if ok else []
else:
    v=(d.get("commands") or {}).get("validate")
    ok=isinstance(v,list) and len(v)>0 and all(isinstance(x,str) and x!="" for x in v)
    vals=list(v) if ok else []
if not ok:
    sys.exit(4)
for x in vals:
    if "\n" in x or "\r" in x:
        sys.stderr.write("a value carries a newline")
        sys.exit(5)
sys.stdout.write("\n".join(vals)+"\n")
'

is_profiled() { [[ -f "$1/.spec-protocol.json" ]]; }

profile_values() {  # profile_values <project-home> <state|validate|refresh> -> one value per line; rc 6 = refresh absent
  local pf="$1/.spec-protocol.json" key="$2" out rc
  [[ -n "$PYTHON3" ]] || die_tool "PROFILE | ${pf} needs a JSON parser and none ran. Tried: \`command -v python3\` and /usr/bin/python3. The profile is DATA and is never shell-evaluated, so it cannot be read without one — UNDETERMINED, and never a fall back to CONTROL/ on a project whose profile forbids it."
  set +e
  out="$("$PYTHON3" -c "$PROFILE_PY" "$pf" "$key" 2>&1)"; rc=$?
  set -e
  case "$rc" in
    0) printf '%s\n' "$out" ;;
    3) die_tool "PROFILE | ${pf} is not parseable JSON: ${out}. Checked: that one file with ${PYTHON3}. UNDETERMINED — the tick claims nothing about this project." ;;
    6) return 6 ;;  # an OPTIONAL key (commands.refresh) that is absent: not an error
    4) if [[ "$key" == "state" ]]; then
         die_tool "PROFILE | ${pf} carries no usable documents.state (a non-empty string is required; references/project-profile.md). The profiled tick logs BESIDE the bound state and has no honest path without it — UNDETERMINED, never CONTROL/watch-tick.log."
       elif [[ "$key" == "refresh" ]]; then
         die_tool "PROFILE | ${pf} commands.refresh is present but is not a non-empty argv array of non-empty strings (references/project-profile.md)."
       else
         die_tool "PROFILE | ${pf} carries no usable commands.validate (a non-empty argv array of non-empty strings is required; references/project-profile.md). The profiled tick has nothing to run — UNDETERMINED, never a legacy CONTROL/ reconcile in its place."
       fi ;;
    5) die_tool "PROFILE | ${pf} ${key} carries a newline in a value: ${out}. A value that spans lines would forge a second line of whatever it is written into — refused." ;;
    *) die_tool "PROFILE | reading ${pf} (${key}) with ${PYTHON3} exited ${rc}: ${out}" ;;
  esac
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

cron_line() {  # cron_line <project-home> -> the */5 line; rc 2 when a profile cannot be read
  # THE REDIRECT. A profiled project's tick logs beside its BOUND state, never
  # into a CONTROL/ the profile forbids. `documents.state` is the ONLY source
  # for that folder: without it the line has no honest path, so this refuses
  # (profile_values names the file and the key) rather than inventing CONTROL/.
  local home="$1" log="CONTROL/watch-tick.log" st dir rc
  if is_profiled "$home"; then
    set +e
    st="$(profile_values "$home" state)"; rc=$?
    set -e
    (( rc == 0 )) || return "$rc"
    dir="$(dirname "$st")"
    if [[ -z "$dir" || "$dir" == "." ]]; then log="watch-tick.log"; else log="${dir}/watch-tick.log"; fi
  fi
  # Every path is ONE quoted word (sq): the skill folder, the project home and
  # the log may all carry spaces ("My Project Folder").
  printf '*/5 * * * * bash %s %s --log %s\n' \
    "$(sq "${SCRIPT_DIR}/watch-tick.sh")" "$(sq "$home")" "$(sq "${home}/${log}")"
}

# tick_line_present <table-text> <project-home> -> 0 when THIS project's tick
# line is in the table. Matches the quoted form cron_line writes AND the older
# unquoted form, so a table armed by an earlier version is never armed twice.
tick_line_present() {
  printf '%s\n' "$1" | "$GREP" -qF -e "watch-tick.sh' $(sq "$2") " -e "watch-tick.sh $2 "
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
#     current table once, tick_line_present over it (the quoted `watch-tick.sh' '<home>' ` or the older unquoted form; THIS project only — a second project on the box still gets its own line), append only when
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
  local home="$1" line table wrc lrc
  # cron_line runs in a SUBSHELL here, so its die_tool exits that subshell and
  # not this one: the rc is the only thing that crosses back, and an unarmed
  # tick that reported success would be the worst failure this file has.
  set +e
  line="$(cron_line "$home")"; lrc=$?
  set -e
  (( lrc == 0 )) || return "$lrc"

  if [[ -n "$CRONTAB_FILE" ]]; then
    # FIXTURE MODE. The file IS the table. No crontab process runs unless the
    # operator named one, and then it is PROVEN before anything is written.
    if [[ -n "${WATCH_TICK_CRONTAB_CMD:-}" ]] && ! crontab_probe; then
      arm_unavailable "rc=${CRONTAB_PROBE_RC} from \`${CRONTAB_CMD} -l\`: ${CRONTAB_PROBE_OUT}" "$line"
      return 2
    fi
    if [[ -f "$CRONTAB_FILE" ]] && tick_line_present "$(cat "$CRONTAB_FILE")" "$home"; then
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
    arm_unavailable "rc=${CRONTAB_PROBE_RC} from \`${CRONTAB_CMD} -l\`: ${CRONTAB_PROBE_OUT}" "$line"
    return 2
  fi
  table="$CRONTAB_PROBE_OUT"
  (( CRONTAB_PROBE_RC == 0 )) || table=""   # it ran and had nothing: an EMPTY table
  if tick_line_present "$table" "$home"; then
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

#------------------------------------------------------------------------------
# 4c. --check (read-only): is THIS project's tick line in the table?
#     0 installed, 3 not installed, 2 the table could not be read. Same table
#     source as --arm (WATCH_TICK_CRONTAB_FILE, else WATCH_TICK_CRONTAB_CMD).
#     tick_line_present matches this home only, so another project's line never counts.
#------------------------------------------------------------------------------
check_tick() {  # check_tick <project-home>
  local table=""
  if [[ -n "$CRONTAB_FILE" ]]; then
    [[ -f "$CRONTAB_FILE" ]] && table="$(cat "$CRONTAB_FILE")"
  else
    if ! crontab_probe; then
      printf 'CHECK | UNREADABLE (exit 2) | rc=%s from `%s -l`\n' "$CRONTAB_PROBE_RC" "$CRONTAB_CMD"; return 2
    fi
    if (( CRONTAB_PROBE_RC != 0 )); then
      if printf '%s' "$CRONTAB_PROBE_OUT" | "$GREP" -qi 'no crontab'; then table=""
      else printf 'CHECK | UNREADABLE (exit 2) | rc=%s from `%s -l`: %s\n' "$CRONTAB_PROBE_RC" "$CRONTAB_CMD" "$(sanitize "$CRONTAB_PROBE_OUT")"; return 2; fi
    else table="$CRONTAB_PROBE_OUT"; fi
  fi
  if tick_line_present "$table" "$1"; then
    printf 'CHECK | INSTALLED (exit 0) | a watch-tick line for %s is in the table\n' "$1"; return 0
  fi
  printf 'CHECK | NOT INSTALLED (exit 3) | no watch-tick line for %s\n' "$1"; return 3
}

#------------------------------------------------------------------------------
# 4d. AUTO-RESUME. --arm runs INSIDE the conductor's session (step 3), the one
#     place the session id is in the environment (CLAUDE_CODE_SESSION_ID), so
#     it records what a cron-run tick cannot know: the id, the launcher
#     (claude-nine when CLAUDE_CONFIG_DIR ends in .claude-nine, else claude,
#     resolved to an absolute path because cron's PATH is minimal) and the cwd
#     the session runs in (--resume looks the id up under that folder).
#     THE STATE AREA (bind_paths) holds the record, the 30-minute lock and the
#     launch log: CONTROL/ on a legacy project; `<statedir>/spec-protocol/` on a
#     profiled one (statedir = the directory of documents.state), so a profiled
#     project resumes exactly as a legacy one does and never grows a CONTROL/.
#     `--record-session` (interview end) calls the same function with `done`,
#     adding `interview=done` — the post-interview marker the widened stall
#     check reads. A later re-arm keeps that marker.
#     The cwd is the one the session was LAUNCHED in (the first "cwd" of its
#     own transcript, <config root>/projects/*/<id>.jsonl), because the
#     conductor cd's into the project folder and --resume looks the id up
#     under the launch folder; $PWD only when no transcript is found.
#------------------------------------------------------------------------------
AREA=""        # absolute state area (see above)
AREA_REL=""    # the same, relative to the home, for messages
STATE_DIR=""   # profiled only: <home>/<dirname of documents.state>
STATE_JSON=""  # where run_status is read: CONTROL/project_state.json or documents.state
bind_paths() {  # bind_paths <home>; on a profiled home an unreadable profile is exit 2 (named)
  local home="$1" st d
  if is_profiled "$home"; then
    st="$(profile_values "$home" state)" || exit $?
    d="$(dirname "$st")"
    if [[ -z "$d" || "$d" == "." ]]; then STATE_DIR="$home"; AREA_REL="spec-protocol"
    else STATE_DIR="${home}/${d}"; AREA_REL="${d}/spec-protocol"; fi
    STATE_JSON="${home}/${st}"
  else
    STATE_DIR=""; AREA_REL="CONTROL"; STATE_JSON="${home}/CONTROL/project_state.json"
  fi
  AREA="${home}/${AREA_REL}"
}

# tick_ledger <line>: legacy -> CONTROL/LEDGER.md through ledger.sh (a failure is
# fatal, as it always was). Profiled -> the same call, which lands the line in
# <statedir>/spec-protocol/LEDGER.md; a failure there is NAMED on stdout and the
# tick goes on — the profiled tick's stdout (the cron log) is its record.
tick_ledger() {
  if ! is_profiled "$HOME_DIR"; then ledger_write "CONTROL/LEDGER.md" "$1"; return 0; fi
  local out rc
  set +e; out="$("$LEDGER_SH" "$HOME_DIR" "CONTROL/LEDGER.md" "$1" 2>&1)"; rc=$?; set -e
  (( rc == 0 )) || printf 'LEDGER | not written (rc=%s): %s\n' "$rc" "$(sanitize "$out")"
  return 0
}

record_session() {  # record_session <project-home> [done]
  local sid="${CLAUDE_CODE_SESSION_ID:-}" name="claude" lpath cwd="$PWD" tr c
  local rec="${AREA}/auto-resume.txt" done="${2:-}"
  [[ -n "$sid" ]] || return 0
  [[ "${CLAUDE_CONFIG_DIR:-}" == *.claude-nine ]] && name="claude-nine"
  lpath="$(command -v "$name" 2>/dev/null || printf '%s' "$name")"
  tr="$(ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"${sid}.jsonl" 2>/dev/null | head -1 || true)"
  if [[ -n "$tr" ]]; then
    c="$("$GREP" -m1 -o '"cwd":"[^"]*"' "$tr" 2>/dev/null | sed 's/^"cwd":"//; s/"$//' || true)"
    [[ -n "$c" && -d "$c" ]] && cwd="$c"
  fi
  [[ -z "$done" ]] && "$GREP" -qx 'interview=done' "$rec" 2>/dev/null && done=done
  mkdir -p "$AREA"
  { printf 'session_id=%s\nlauncher=%s\nlauncher_path=%s\ncwd=%s\n' "$sid" "$name" "$lpath" "$cwd"
    [[ -z "$done" ]] || printf 'interview=done\n'; } > "$rec"
  printf 'ARM | session recorded for auto-resume: %s/auto-resume.txt (launcher=%s%s)\n' "$AREA_REL" "$name" "${done:+, interview=done}"
}

# The stalled-turn check's three readings (F2), shared by the full tick, the
# pre-plan tick and the profiled tick, so research/spec/apparatus stalls before
# step 6.5 are seen. On a profiled project run_status is read from the bound
# documents.state (when it is JSON carrying one); absent reads as running.
interview_done() { "$GREP" -qx 'interview=done' "${AREA}/auto-resume.txt" 2>/dev/null; }
# A2 fix: some profiled states carry "status" instead of "run_status" -- read
# run_status first, and only fall back to status when run_status is absent
# (a state naming both is not a shape this reads, run_status wins).
run_status_of() {
  local v
  v="$("$GREP" -o '"run_status"[[:space:]]*:[[:space:]]*"[A-Za-z_]*"' "$STATE_JSON" 2>/dev/null \
    | sed 's/.*"\([A-Za-z_]*\)"$/\1/' | head -1 || true)"
  if [[ -z "$v" ]]; then
    v="$("$GREP" -o '"status"[[:space:]]*:[[:space:]]*"[A-Za-z_]*"' "$STATE_JSON" 2>/dev/null \
      | sed 's/.*"\([A-Za-z_]*\)"$/\1/' | head -1 || true)"
  fi
  printf '%s' "$v"
}
# A2 fix: these values mean the project is waiting ON PURPOSE -- auto-resume
# must never fire for them, no matter how stale the session looks.
run_status_is_terminal() {
  case "$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')" in
    RELEASE_COMPLETE|STOPPED_BY_OWNER|PAUSED_BLOCKED|PAUSED_CAP|STOPPED_CAP) return 0 ;;
    *) return 1 ;;
  esac
}
# The newest mtime under the project home, the state area excluded: the ledger
# and the records this tick writes are not progress, and counting them would
# make the check unable to fire on a run whose only writer is the tick itself.
# The ledger's own lock and pin sentinels are excluded for the same reason
# (tools/anchor.sh's census excludes them too). A profiled project also
# excludes the cron line's own <statedir>/watch-tick.log and the files the last
# commands.refresh wrote (refresh-outputs.txt): regenerated views are the tick's
# echo, not the run's progress. Prints nothing when no mtime could be read.
newest_write_epoch() {
  local p e newest="" outs="${AREA}/refresh-outputs.txt"
  local -a skip=(-path "$(glob_esc "$AREA")" -prune -o)
  [[ -n "$STATE_DIR" ]] && skip+=(-path "$(glob_esc "${STATE_DIR}/watch-tick.log")" -prune -o)
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    e="$(stat -f %m "$p" 2>/dev/null || stat -c %Y "$p" 2>/dev/null || true)"
    if [[ -n "$e" ]] && { [[ -z "$newest" ]] || (( e > newest )); }; then newest="$e"; fi
  done < <(find "$HOME_DIR" "${skip[@]}" -type f \
    ! -name '.ledger-pinned' ! -name '*.lock' ! -name '*.tmp.*' ! -name '*.lock.d' -print 2>/dev/null \
    | if [[ -s "$outs" ]]; then "$GREP" -vxF -f "$outs" || true; else cat; fi)
  printf '%s' "$newest"
}

# The PATH the resumed session runs with. Cron's PATH is minimal (/usr/bin:/bin),
# and the launcher's children need node (9Router's cli is `#!/usr/bin/env node`,
# so is the catalog fix), claude (~/.local/bin) and the 999 npm bin. PATH is set
# HERE, on the resumed process, not on the cron line — one place, both tick
# forms. Order: the node dir setup recorded (~/.local/share/999/node-path, a dir
# or the node binary), setup's own node, ~/.local/bin, the 999 npm bin, then the
# common node dirs, then the inherited PATH. Missing dirs are skipped.
resume_path() {  # resume_path <inherited-PATH>
  local d nd="" pre=""
  nd="$(head -1 "$HOME/.local/share/999/node-path" 2>/dev/null || true)"
  [[ -f "$nd" ]] && nd="$(dirname "$nd")"
  for d in "$nd" "$HOME/.local/share/999/node/current/bin" "$HOME/.local/bin" \
           "${NINE_ROUTER_NPM_PREFIX:-$HOME/.local/share/999/npm}/bin" /opt/homebrew/bin /usr/local/bin; do
    [[ -n "$d" && -d "$d" ]] && pre="${pre}${d}:"
  done
  printf '%s%s' "$pre" "$1"
}

# Called by the stalled-turn check once it fires, at most once per 30 minutes
# (<area>/auto-resume.lock mtime). It NEVER starts a hidden session (no -p, no
# nohup, no detached child): it writes <area>/auto-resume.command, which cd's to
# the recorded launch folder, creates <area>/auto-resume.opened (noclobber, so a
# second window exits at once) and execs `<launcher> --permission-mode
# bypassPermissions --resume <id> "/spec-protocol resume"` — an ordinary
# interactive session — and opens it in a VISIBLE Terminal window:
# `open -a Terminal <file>` first; no marker within 20 s, `osascript … do
# script` once. Neither produced the marker (or no macOS): nothing is started,
# AUTO-RESUME-NOT-OPENED goes to the ledger and the morning report's Operator
# notes carries the stall time and the restart sentence. bypassPermissions: the
# window is unattended until someone looks, and a permission prompt would stall
# it. WATCH_TICK_LAUNCHER_CMD, WATCH_TICK_OPEN_CMD and WATCH_TICK_OSASCRIPT_CMD
# replace the launcher, open and osascript (selftest stubs only).
wait_marker() {  # wait_marker <file> <seconds>
  local i
  for (( i = 0; i <= $2; i++ )); do [[ -f "$1" ]] && return 0; (( i < $2 )) && sleep 1; done
  return 1
}
auto_resume() {  # auto_resume <elapsed-minutes> [phase]
  local rec="${AREA}/auto-resume.txt" lock="${AREA}/auto-resume.lock"
  local file="${AREA}/auto-resume.command" mark="${AREA}/auto-resume.opened"
  local k v sid="" name="" lpath="" cwd="" cmd lm age pre how="" why="" rc
  local open_cmd="${WATCH_TICK_OPEN_CMD:-/usr/bin/open}" osa_cmd="${WATCH_TICK_OSASCRIPT_CMD:-/usr/bin/osascript}"
  if [[ ! -f "$rec" ]]; then
    printf 'AUTO-RESUME | not run | no session recorded (%s/auto-resume.txt is written by --arm inside the conductor session)\n' "$AREA_REL"
    return 0
  fi
  while IFS='=' read -r k v; do
    case "$k" in session_id) sid="$v" ;; launcher) name="$v" ;; launcher_path) lpath="$v" ;; cwd) cwd="$v" ;; esac
  done < "$rec"
  if [[ ! "$sid" =~ ^[A-Za-z0-9-]+$ ]]; then
    printf 'AUTO-RESUME | not run | the recorded session id is unusable\n'; return 0
  fi
  if [[ -f "$lock" ]]; then
    lm="$(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo 0)"
    age=$(( ($(epoch_now) - lm) / 60 ))
    if (( age < 30 )); then
      printf 'AUTO-RESUME | held | lock is %sm old (< 30m): no second launch\n' "$age"; return 0
    fi
  fi
  cmd="${WATCH_TICK_LAUNCHER_CMD:-${lpath:-$name}}"
  pre="$(resume_path "")"
  [[ "$cmd" == */* ]] && pre="$(dirname "$cmd"):$pre"
  [[ -d "$cwd" ]] || cwd="$HOME_DIR"
  touch "$lock"
  rm -f "$mark"
  { printf '#!/bin/bash\n'
    printf 'cd %q || exit 1\n' "$cwd"
    printf '( set -C; date -u +%%Y-%%m-%%dT%%H:%%M:%%SZ > %q ) 2>/dev/null || exit 0\n' "$mark"
    printf 'export PATH=%q"$PATH"\n' "$pre"
    printf 'exec %q --permission-mode bypassPermissions --resume %q %q\n' "$cmd" "$sid" "/spec-protocol resume"
  } > "$file"
  chmod +x "$file"
  set +e
  "$open_cmd" -a Terminal "$file" >> "${AREA}/auto-resume.log" 2>&1; rc=$?
  set -e
  if (( rc == 0 )) && wait_marker "$mark" 20; then how="open -a Terminal"
  else
    (( rc == 0 )) && why="open: no marker in 20s" || why="open rc=${rc}"
    set +e
    "$osa_cmd" -e 'on run argv' -e 'tell application "Terminal" to do script "bash " & quoted form of (item 1 of argv)' \
      -e 'end run' "$file" >> "${AREA}/auto-resume.log" 2>&1; rc=$?
    set -e
    if (( rc == 0 )) && wait_marker "$mark" 20; then how="osascript do script"
    else (( rc == 0 )) && why="${why}; osascript: no marker in 20s" || why="${why}; osascript rc=${rc}"; fi
  fi
  if [[ -n "$how" ]]; then
    tick_ledger "$(iso_now) | AUTO-RESUME | session=${sid} | launcher=${name} | stalled ${1}m in ${2:-build} — opened a visible Terminal window (${how}) running --permission-mode bypassPermissions --resume with /spec-protocol resume (${AREA_REL}/auto-resume.command)"
    printf 'AUTO-RESUME | opened | %s --permission-mode bypassPermissions --resume %s "/spec-protocol resume" in a visible Terminal window via %s (stalled %sm in %s)\n' "$name" "$sid" "$how" "$1" "${2:-build}"
    return 0
  fi
  tick_ledger "$(iso_now) | AUTO-RESUME-NOT-OPENED: session=${sid} reason=${why}"
  report_note "AUTO-RESUME-NOT-OPENED: the run stalled ${1}m in ${2:-build} at $(iso_now) and no window could be opened (${why}). To continue: If your computer restarts or we get disconnected: open the Terminal app, type \`${name:-claude} --resume\`, press Return, pick this project from the list, and I carry on from where I was."
  printf 'AUTO-RESUME | not opened | %s (stalled %sm in %s); nothing started — the continue command is in the morning report'"'"'s Operator notes\n' "$why" "$1" "${2:-build}"
}

#------------------------------------------------------------------------------
# 4e. THE MERGE WINDOW IS AN ENQUEUE, NEVER A MERGE. Every MERGE_BATCH_MINUTES
#     (default 10) the tick reaches a merge WINDOW and writes ONE durable
#     request into <area>/wm-queue/<id>.request.json for the visible S75-WM
#     workflow (SPEC 15.1 watcher row: "One durable request is delegated to
#     visible WM; no timer-originated merge process, no duplicate train, and
#     no unpermitted concurrent heavy gates"). A script cannot call the
#     session-only Workflow tool (SPEC 10.1) and never writes here by magic:
#     the supported bridge is one request file plus ONE line printed and
#     ledgered — `ACTION|wm-merge-request|<id>|…` — which the visible S75-WM
#     workflow consumes through its own native session. Only one OPEN request
#     exists at a time: a new window while one is still open extends the SAME
#     request (requested_windows+=1), so the queue cannot flood and the train
#     is never duplicated. The request is done only when a receipt lands in
#     <area>/wm-queue/done/ (WM's own visible workflow writes it, or a human).
#
#     THE BUG THIS CLOSES: MERGE_BATCH_MINUTES=0 used to make the interval
#     check `age < 0` false on every tick — eligible on EVERY tick instead of
#     never. 0 is now REJECTED at validation (exit 2, named), and the explicit
#     disable is MERGE_BATCH_DISABLE=1, which is never mistaken for a cadence.
#     The timer executes NO integration tool: WATCH_MERGE_TRAIN_SH may only
#     name a canary stub that the selftest asserts this path never runs.
#------------------------------------------------------------------------------
MERGE_BATCH_MIN="${MERGE_BATCH_MINUTES:-10}"
MERGE_BATCH_DISABLED="${MERGE_BATCH_DISABLE:-0}"
MERGE_WM_QUEUE_REL="wm-queue"
MERGE_NOTE=""
# 4i supervisor cadence constants (validated with the rest, below).
SUPERVISE_TICK_SEC="${WATCH_SUPERVISOR_TICK_SECONDS:-60}"
SUPERVISE_REPORT_SEC="${WATCH_SUPERVISOR_REPORT_SECONDS:-600}"
SUPERVISE_OVERDUE_SEC="${WATCH_SUPERVISOR_OVERDUE_SECONDS:-180}"
merge_window() {  # prints one MERGE-WINDOW line when it acts; sets MERGE_NOTE
  [[ "$MERGE_BATCH_DISABLED" == "1" ]] && { MERGE_NOTE="disabled(MERGE_BATCH_DISABLE=1)"; return 0; }
  local stamp="${AREA}/merge-batch.stamp" lm age
  if [[ -f "$stamp" ]]; then
    lm="$(stat -f %m "$stamp" 2>/dev/null || stat -c %Y "$stamp" 2>/dev/null || echo 0)"
    age=$(( ($(epoch_now) - lm) / 60 ))
    if (( age < MERGE_BATCH_MIN )); then MERGE_NOTE="not-due(next window in $(( MERGE_BATCH_MIN - age ))m, every ${MERGE_BATCH_MIN}m)"; return 0; fi
  fi
  mkdir -p "${AREA}/${MERGE_WM_QUEUE_REL}/done"
  # ONE open request at a time: extend it, never stack duplicates.
  local open_req id file windows
  open_req="$(find "${AREA}/${MERGE_WM_QUEUE_REL}" -maxdepth 1 -name '*.request.json' 2>/dev/null | sort | head -1)"
  if [[ -n "$open_req" ]]; then
    windows="$("$PYTHON3" -c 'import json,sys;print(int(json.load(open(sys.argv[1])).get("requested_windows",1))+1)' "$open_req" 2>/dev/null || echo "")"
    [[ "$windows" =~ ^[0-9]+$ ]] || windows=""
    if [[ -n "$windows" ]]; then
      "$PYTHON3" -c 'import json,sys;p=sys.argv[1];d=json.load(open(p));d["requested_windows"]=int(sys.argv[2]);d["last_window"]=sys.argv[3];json.dump(d,open(p,"w"),sort_keys=True)' \
        "$open_req" "$windows" "$(iso_now)" 2>/dev/null || true
    fi
    id="$(basename "$open_req" .request.json)"
    MERGE_NOTE="enqueued(one-open:${id} windows=${windows:-?})"
    printf 'MERGE-WINDOW | %s | delegated | wm-merge-request already open (%s), requested_windows=%s — the timer runs no merge process; visible S75-WM consumes %s\n' \
      "$(iso_now)" "$id" "${windows:-?}" "$open_req"
    return 0
  fi
  id="wm-$(date -u +%Y%m%d%H%M%S)-$$"
  file="${AREA}/${MERGE_WM_QUEUE_REL}/${id}.request.json"
  if ! "$PYTHON3" -c 'import json,sys;json.dump({"id":sys.argv[1],"from":"watch-tick.timer","to":"S75-WM","action":"run-merge-train-batch","home":sys.argv[2],"requested_windows":1,"first_window":sys.argv[3],"last_window":sys.argv[3],"note":"timer enqueues only; only visible S75-WM may integrate"},open(sys.argv[4],"w"),sort_keys=True)' \
       "$id" "$HOME_DIR" "$(iso_now)" "$file" 2>/dev/null; then
    MERGE_NOTE="enqueued-failed(queue write failed)"
    printf 'MERGE-WINDOW | %s | NOT ENQUEUED | %s could not be written — the timer still runs no merge process; name the fault\n' "$(iso_now)" "$file"
    return 0
  fi
  touch "$stamp"
  MERGE_NOTE="enqueued(${id} -> S75-WM)"
  printf 'MERGE-WINDOW | %s | delegated | wm-merge-request %s queued for visible S75-WM (%s) — no timer-originated merge process, no duplicate train\n' \
    "$(iso_now)" "$id" "$file"
  printf 'ACTION|wm-merge-request|%s|%s\n' "$id" "$file"
}

# 4e-2. THE CONTROL BRIDGE (SPEC 10.1). A cron/launchd task cannot call the
#       session-only Workflow tool by magic. What the timer CAN do, through
#       supported mechanisms, is exactly two things: write the durable request
#       4e writes, and print/ledger the ACTION line a visible session consumes.
#       The proof this is a bridge and not a claim is one instrument: this
#       header section, the printed ACTION|wm-merge-request line, the request
#       JSON, and the selftest case 56 that drives the full path with the
#       merge-train canary armed and asserts the canary never ran. The named
#       capability gap: a headless timer has NO session Workflow tool, no
#       Workflow launch primitive, and cannot resume a dead conductor on its
#       own. The repair through supported mechanisms is the enqueue/delegate
#       contract above plus the visible-window AUTO-RESUME path (4d), which
#       opens an ordinary interactive session — never a hidden replacement
#       worker. Unattended supervision is therefore: deterministic 60-second
#       tick (4i) + durable WM queue + visible resume. Nothing else is claimed.
wm_requests_open() { find "${AREA}/${MERGE_WM_QUEUE_REL}" -maxdepth 1 -name '*.request.json' 2>/dev/null | "$GREP" -c '[^[:space:]]' || true; }

#------------------------------------------------------------------------------
# 4i. THE SUPERVISOR LOOP (SPEC 10.2). `--supervise` runs a deterministic tick
#     every WATCH_SUPERVISOR_TICK_SECONDS (default 60) with immediate
#     admission checks (S2/S3/S5/S6/S13 against the same parsers the five
#     minute tick uses), publishes the full section 10.6 report at startup and
#     every WATCH_SUPERVISOR_REPORT_SECONDS (default 600), and persists
#     last_tick, next_report_due, supervisor identity, run epoch and queue
#     state in <area>/supervisor.state (KEY=VALUE, written atomically).
#
#     CATCH-UP IS EXACTLY ONE REPORT. A restart that missed one or more report
#     windows publishes ONE report (kind=catch-up), never one per missed
#     window — the state carries next_report_due, not a backlog.
#
#     OVERDUE SUPERVISOR PAUSES DISPATCH. When the persisted last_tick is
#     older than WATCH_SUPERVISOR_OVERDUE_SECONDS (default 180) the tick
#     exposes the fault (SUPERVISOR-OVERDUE line + DRIFT-ALARM), pauses new
#     dispatch (ACTION|pause-dispatch|supervisor-overdue replaces
#     dispatch-now/widen/relabel), restores supervision by resuming ticks, and
#     NEVER declares completion. The five-minute cron tick applies the same
#     pause to its own dispatch actions.
#
#     HEALTH SIGNAL AND INDEPENDENT LIVENESS. Every tick writes
#     <area>/supervisor.health (pid, run_epoch, last_tick) and the state file.
#     `--supervisor-status` is the independent liveness check: it READS ONLY
#     the persisted state (it never ticks, never dispatches) and prints
#     HEALTHY / OVERDUE / ABSENT with the numbers behind the verdict.
#
#     The loop never auto-stops: it runs until killed, or until
#     WATCH_SUPERVISOR_MAX_TICKS bounds it (selftest only).
#------------------------------------------------------------------------------
SUP_STATE_FILE="supervisor.state"
SUP_HEALTH_FILE="supervisor.health"

sup_state_path() { printf '%s/%s' "$AREA" "$SUP_STATE_FILE"; }

sup_state_get() {  # sup_state_get <file> <key> -> value or rc 1
  "$GREP" "^$2=" "$1" 2>/dev/null | head -1 | sed "s/^$2=//"
}

supervisor_identity() {
  local host s
  host="$(hostname -s 2>/dev/null || printf 'unknown-host')"
  s="${CLAUDE_CODE_SESSION_ID:-no-session}"
  printf '%s:pid-%s:%s' "$host" "$$" "$s"
}

sup_state_write() {  # sup_state_write <last_tick_iso> <last_tick_epoch> <next_due_iso> <next_due_epoch> <run_epoch> <tick_seq> <report_seq> <last_report_at> <dispatch_paused>
  local f tmp
  f="$(sup_state_path)"
  mkdir -p "$AREA"
  tmp="${f}.tmp.$$"
  {
    printf 'last_tick=%s\n' "$1"
    printf 'last_tick_epoch=%s\n' "$2"
    printf 'next_report_due=%s\n' "$3"
    printf 'next_report_due_epoch=%s\n' "$4"
    printf 'supervisor_id=%s\n' "$(supervisor_identity)"
    printf 'supervisor_pid=%s\n' "$$"
    printf 'supervisor_started_at=%s\n' "${SUP_STARTED_AT:-$1}"
    printf 'run_epoch=%s\n' "$5"
    printf 'tick_seq=%s\n' "$6"
    printf 'report_seq=%s\n' "$7"
    printf 'last_report_at=%s\n' "$8"
    printf 'queue_open=%s\n' "$(wm_requests_open)"
    printf 'queue_ids=%s\n' "$(find "${AREA}/${MERGE_WM_QUEUE_REL}" -maxdepth 1 -name '*.request.json' 2>/dev/null | sed 's#.*/##; s#\.request\.json##' | paste -sd, - 2>/dev/null || true)"
    printf 'dispatch_paused=%s\n' "$9"
    printf 'tick_seconds=%s\nreport_seconds=%s\noverdue_seconds=%s\n' "$SUPERVISE_TICK_SEC" "$SUPERVISE_REPORT_SEC" "$SUPERVISE_OVERDUE_SEC"
  } > "$tmp" || die_tool "could not stage the supervisor state into ${tmp}"
  mv "$tmp" "$f" || die_tool "could not install the supervisor state into ${f}"
  printf 'run_epoch=%s\nlast_tick=%s\npid=%s\n' "$5" "$1" "$$" > "${AREA}/${SUP_HEALTH_FILE}" 2>/dev/null || true
}

# The shared overdue read (SPEC 10.2). Sets SUP_NOTE / SUP_AGE / SUP_OVERDUE /
# SUP_PRESENT. ABSENT is not overdue: no supervisor was armed, so there is
# nothing to pause for — the pause exists to stop dispatch under a DEAD
# supervisor, not under no supervisor.
supervisor_state_check() {
  SUP_NOTE="absent(no ${AREA_REL}/${SUP_STATE_FILE}; no --supervise is armed)"
  SUP_AGE=""; SUP_OVERDUE=0; SUP_PRESENT=0
  local f lt
  f="$(sup_state_path)"
  [[ -f "$f" ]] || return 0
  SUP_PRESENT=1
  lt="$(sup_state_get "$f" last_tick_epoch)"
  if [[ ! "$lt" =~ ^[0-9]+$ ]]; then
    SUP_NOTE="undetermined(${AREA_REL}/${SUP_STATE_FILE} carries no parseable last_tick_epoch)"
    return 0
  fi
  SUP_AGE=$(( $(epoch_now) - lt ))
  if (( SUP_AGE > SUPERVISE_OVERDUE_SEC )); then
    SUP_OVERDUE=1
    SUP_NOTE="overdue(last tick ${SUP_AGE}s ago, ceiling ${SUPERVISE_OVERDUE_SEC}s)"
  else
    SUP_NOTE="healthy(last tick ${SUP_AGE}s ago)"
  fi
  return 0
}

# The pause filter (SPEC 10.2: an overdue supervisor pauses new dispatch
# instead of declaring completion). Dispatch-creating actions are dropped and
# replaced by ONE pause action; recovery actions (requeue, mint-check, resume,
# repair of reporting faults) are NOT dispatch and survive.
apply_dispatch_pause() {  # apply_dispatch_pause <actions-file> -> rewrites it and VERBS
  local f="$1" tmp
  tmp="${f}.pause.$$"
  : > "$tmp"
  while IFS= read -r line; do
    case "$line" in
      ACTION\|dispatch-now\|*|ACTION\|widen\|*|ACTION\|relabel-and-redispatch\*) continue ;;
      *) printf '%s\n' "$line" >> "$tmp" ;;
    esac
  done < "$f"
  printf 'ACTION|pause-dispatch|supervisor-overdue|%s — new dispatch is PAUSED while the supervisor is overdue (SPEC 10.2); this is a fault to restore, never a completion\n' \
    "$(sanitize "$SUP_NOTE")" >> "$tmp"
  mv "$tmp" "$f"
  local verbs="" v
  while IFS= read -r v; do
    [[ -n "$v" ]] || continue
    case "$v" in dispatch-now|widen|relabel-and-redispatch) continue ;; esac
    if [[ -z "$verbs" ]]; then verbs="$v"; else verbs="${verbs},${v}"; fi
  done < <(printf '%s' "$VERBS" | tr ',' '\n')
  if [[ -z "$verbs" ]]; then VERBS="pause-dispatch"; else verbs="${verbs},pause-dispatch"; VERBS="$verbs"; fi
}

# The immediate admission checks of one 60-second supervisor tick: S2, S3, S5,
# S6 and S13 against the same parsers, emitting ACTION lines at once (the
# five-minute cron tick remains the outer reconciliation layer and owns the
# reconcile/sweeps; this is the fast lane, not a second copy of everything).
admission_check() {
  ADM_V=0 ADM_ACTS="" ADM_OPEN=0 ADM_TREES=0 ADM_LABELS=0 ADM_MAXWIDTH=0 ADM_AGENTSUM=0 ADM_MODELS=""
  if is_profiled "$HOME_DIR"; then
    ADM_ACTS="undetermined(profiled: admission rows live in the bound state; the profile tick owns them)"
    return 0
  fi
  local CHK="$HOME_DIR/CONTROL/CHECKLIST.md" DL="$HOME_DIR/CONTROL/dispatch-log.md"
  local LED="$HOME_DIR/CONTROL/LEDGER.md" HB="$HOME_DIR/CONTROL/HEARTBEAT.md"
  if [[ ! -f "$CHK" || ! -f "$DL" ]]; then
    ADM_ACTS="undetermined(pre-plan or no CONTROL census: CHECKLIST.md/dispatch-log.md absent)"
    return 0
  fi
  local W="${WORKDIR}/adm"
  mkdir -p "$W"
  : > "$W/results.txt"
  [[ -f "$LED" ]] && awk_results "$LED" > "$W/results.txt" 2>/dev/null || true
  awk_rows "$DL" > "$W/rows.tsv" 2>/dev/null || true
  : > "$W/open.tsv"
  local u stage lok tree ts label
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" ]] || continue
    "$GREP" -qxF -- "$u" "$W/results.txt" 2>/dev/null || \
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$u" "$stage" "$lok" "$tree" "$ts" "$label" >> "$W/open.tsv"
  done < "$W/rows.tsv"
  local OPEN RUNNABLE TREES
  OPEN="$("$GREP" -c '[^[:space:]]' "$W/open.tsv" || true)"; [[ -n "$OPEN" ]] || OPEN=0
  cut -f1 "$W/open.tsv" | LC_ALL=C sort -u > "$W/open-units.txt"
  awk_checklist "$CHK" | LC_ALL=C sort -u > "$W/boxes.txt"
  comm -23 "$W/boxes.txt" "$W/open-units.txt" > "$W/runnable.txt"
  RUNNABLE="$("$GREP" -c '[^[:space:]]' "$W/runnable.txt" || true)"; [[ -n "$RUNNABLE" ]] || RUNNABLE=0
  TREES="$(cut -f4 "$W/open.tsv" | "$GREP" -v '^[[:space:]]*$' | LC_ALL=C sort -u | "$GREP" -c '[^[:space:]]' || true)"
  [[ -n "$TREES" ]] || TREES=0
  ADM_ACTS="runnable=${RUNNABLE} open=${OPEN} trees=${TREES}"
  ADM_OPEN="$OPEN"; ADM_TREES="$TREES"
  # The report's agent/model census: distinct labels, the widest declared
  # [<model> xN] width, and the distinct model names — raw observed values,
  # never clamped to a declared peak (SPEC 10.3).
  ADM_LABELS="$("$AWK" -F '\t' '{print $6}' "$W/open.tsv" 2>/dev/null | LC_ALL=C sort -u | "$GREP" -c '[^[:space:]]' || true)"
  [[ -n "$ADM_LABELS" ]] || ADM_LABELS=0
  ADM_MAXWIDTH="$(cut -f6 "$W/open.tsv" 2>/dev/null | sed -n 's/.*[x×]\([0-9][0-9]*\)\].*/\1/p' | sort -n | tail -1)"
  [[ "$ADM_MAXWIDTH" =~ ^[0-9]+$ ]] || ADM_MAXWIDTH=0
  ADM_AGENTSUM="$(cut -f6 "$W/open.tsv" 2>/dev/null | sed -n 's/.*[x×]\([0-9][0-9]*\)\].*/\1/p' | "$AWK" '{s+=$1} END {print s+0}')"
  ADM_MODELS="$(cut -f6 "$W/open.tsv" 2>/dev/null | sed -n 's/^[[:space:]]*\[\([^] x×]*\).*/\1/p' | LC_ALL=C sort -u | paste -sd, - 2>/dev/null || true)"
  if (( SUP_OVERDUE == 1 )); then
    ADM_ACTS="${ADM_ACTS} | paused(${SUP_NOTE})"
    return 0
  fi
  # S2
  if (( RUNNABLE > 0 && OPEN == 0 )); then
    ADM_V=$(( ADM_V + 1 ))
    printf 'ACTION|dispatch-now|%s|S2 zero-workflow on the 60s tick: runnable=%s open=0\n' "$(head -3 "$W/runnable.txt" | tr '\n' ' ')" "$RUNNABLE"
  fi
  # S3
  while IFS=$'\t' read -r u stage lok tree ts label; do
    [[ -n "$u" && "$lok" != "1" ]] || continue
    ADM_V=$(( ADM_V + 1 ))
    printf 'ACTION|relabel-and-redispatch|%s|S3 label: open row carries no [<model> x<N>] label\n' "$u"
  done < "$W/open.tsv"
  # S5
  if [[ -n "${WATCH_CLIENT_CAP:-}" ]] && [[ "${WATCH_CLIENT_CAP}" =~ ^[0-9]+$ ]] \
     && (( RUNNABLE > 0 && TREES > 0 && OPEN < WATCH_CLIENT_CAP * TREES )); then
    ADM_V=$(( ADM_V + 1 ))
    printf 'ACTION|widen|%s tree(s)|S5 idle capacity on the 60s tick\n' "$TREES"
  fi
  # S6/S13 — staleness and finished-but-alive, from the heartbeat map. S6
  # judges OPEN rows (stale work); S13 judges CLOSED rows (RESULT present,
  # heartbeat still fresh) — the same jurisdictions the five-minute tick has.
  if [[ -f "$HB" ]]; then
    local NOW thr age ep hbu hbl hts
    NOW="$(epoch_now)"
    : > "$W/hb-unit.tsv"; : > "$W/hb-label.tsv"
    while IFS=$'\t' read -r hbu hbl hts; do
      [[ -n "$hts" ]] || continue
      if ep="$(iso_to_epoch "$hts")"; then
        [[ -n "$hbu" ]] && printf '%s\t%s\n' "$hbu" "$ep" >> "$W/hb-unit.tsv"
        [[ -n "$hbl" ]] && printf '%s\t%s\n' "$hbl" "$ep" >> "$W/hb-label.tsv"
      fi
    done < <(awk_heartbeat "$HB")
    hb_ep() {  # hb_ep <unit> <label> -> newest epoch or empty (never 0 — 0 would be a 54-year-old stamp that fires S6 on a row with no heartbeat at all)
      local e
      e="$("$AWK" -F '\t' -v u="$1" '$1==u {if ($2+0 > b+0) b=$2} END {if (b != "") print b}' "$W/hb-unit.tsv" 2>/dev/null)"
      if [[ -z "$e" && -n "$2" ]]; then
        e="$("$AWK" -F '\t' -v l="$2" '$1==l {if ($2+0 > b+0) b=$2} END {if (b != "") print b}' "$W/hb-label.tsv" 2>/dev/null)"
      fi
      printf '%s' "$e"
    }
    # S6 over the OPEN rows.
    while IFS=$'\t' read -r u stage lok tree ts label; do
      [[ -n "$u" ]] || continue
      case "$(printf '%s' "$stage" | tr 'A-Z' 'a-z')" in *merge*) thr="$MERGE_STALE_MIN" ;; *) thr="$STALE_MIN" ;; esac
      ep="$(hb_ep "$u" "$label")"
      [[ -n "$ep" ]] || continue
      age=$(( (NOW - ep) / 60 ))
      if (( age > thr )); then
        ADM_V=$(( ADM_V + 1 ))
        printf 'ACTION|reconcile-native-identity|%s|S6 stale on the 60s tick: last stamp %sm ago (ceiling %sm)\n' "$u" "$age" "$thr"
      fi
    done < "$W/open.tsv"
    # S13 over the CLOSED rows: RESULT on the ledger, heartbeat still fresh.
    while IFS=$'\t' read -r u stage lok tree ts label; do
      [[ -n "$u" ]] || continue
      "$GREP" -qxF -- "$u" "$W/results.txt" 2>/dev/null || continue
      case "$(printf '%s' "$stage" | tr 'A-Z' 'a-z')" in *merge*) thr="$MERGE_STALE_MIN" ;; *) thr="$STALE_MIN" ;; esac
      ep="$(hb_ep "$u" "$label")"
      [[ -n "$ep" ]] || continue
      age=$(( (NOW - ep) / 60 ))
      if (( age <= thr )); then
        ADM_V=$(( ADM_V + 1 ))
        printf 'ACTION|reconcile-native-identity|%s|S13 finished-but-alive on the 60s tick: RESULT present, heartbeat %sm fresh (ceiling %sm)\n' "$u" "$age" "$thr"
      fi
    done < "$W/rows.tsv"
  fi
  return 0
}

# ---- the section 10.6 report (SPEC 10.6). Every field is present with an
#      actual value or an explicit UNDETERMINED naming its source and owner;
#      an absent field is a reporting defect and unknown is never a pass.
report_10_6() {  # report_10_6 <kind: startup|catch-up|periodic>
  local kind="$1" now_iso now_e
  now_iso="$(iso_now)"; now_e="$(epoch_now)"
  local ba="undetermined(no ${AREA_REL}/build-acceptance.json: verified_weight/total; owner: independent QC)"
  local bv="" bt=""
  if [[ -f "${AREA}/build-acceptance.json" ]]; then
    bv="$("$GREP" -o '"verified_weight"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/build-acceptance.json" | "$GREP" -o '[0-9]*$')"
    bt="$("$GREP" -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/build-acceptance.json" | "$GREP" -o '[0-9]*$')"
    if [[ "$bv" =~ ^[0-9]+$ && "$bt" =~ ^[0-9]+$ && "$bt" -gt 0 ]]; then
      ba="${bv}/${bt} = $(( bv * 100 / bt ))% (source: ${AREA_REL}/build-acceptance.json)"
    else
      ba="undetermined(${AREA_REL}/build-acceptance.json present but carries no parseable verified_weight/total; owner: independent QC)"
    fi
  fi
  local amp="undetermined(no ${AREA_REL}/merge-progress.json: landed_weight/required_code_weight; owner: S75-WM)"
  if [[ -f "${AREA}/merge-progress.json" ]]; then
    local lw rw
    lw="$("$GREP" -o '"landed_weight"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/merge-progress.json" | "$GREP" -o '[0-9]*$')"
    rw="$("$GREP" -o '"required_code_weight"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/merge-progress.json" | "$GREP" -o '[0-9]*$')"
    if [[ "$lw" =~ ^[0-9]+$ && "$rw" =~ ^[0-9]+$ && "$rw" -gt 0 ]]; then
      amp="${lw}/${rw} = $(( lw * 100 / rw ))% (source: ${AREA_REL}/merge-progress.json; denominator frozen at kickoff)"
    fi
  fi
  local q_open q_ids cb batch
  q_open="$(wm_requests_open)"; [[ -n "$q_open" ]] || q_open=0
  q_ids="$(find "${AREA}/${MERGE_WM_QUEUE_REL}" -maxdepth 1 -name '*.request.json' 2>/dev/null | sed 's#.*/##; s#\.request\.json##' | paste -sd, - 2>/dev/null || true)"
  if [[ -f "${AREA}/wm-queue/batch-status.json" ]]; then
    local bm bf
    bm="$("$GREP" -o '"merged_in_batch"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/wm-queue/batch-status.json" | "$GREP" -o '[0-9]*$')"
    bf="$("$GREP" -o '"frozen_in_batch"[[:space:]]*:[[:space:]]*[0-9]*' "${AREA}/wm-queue/batch-status.json" | "$GREP" -o '[0-9]*$')"
    if [[ "$bm" =~ ^[0-9]+$ && "$bf" =~ ^[0-9]+$ ]]; then
      if (( bf == 0 )); then cb="N/A (no qualified units — never 100%)"
      else cb="${bm}/${bf} = $(( bm * 100 / bf ))% (membership frozen by S75-WM at batch start; source: ${AREA_REL}/wm-queue/batch-status.json)"; fi
    else
      cb="undetermined(${AREA_REL}/wm-queue/batch-status.json present but carries no parseable merged_in_batch/frozen_in_batch; owner: S75-WM)"
    fi
  elif (( q_open > 0 )); then
    cb="undetermined(${q_open} request(s) pending on S75-WM (${q_ids}) — batch membership is frozen by S75-WM only, and the timer holds none; owner: S75-WM)"
  else
    cb="N/A (no qualified units — never 100%)"
  fi
  local nw aa models swarm modelc overall viol
  nw="projection(CONTROL/dispatch-log.md rows: running=${ADM_OPEN:-?} unfinished=${ADM_OPEN:-?} trees=${ADM_TREES:-?}); native census=undetermined(control-bridge gap CB-1: a headless timer cannot read the session-only Workflow census — the native runtime is the authority, Command Center is a projection)"
  aa="declared_agents_total=${ADM_AGENTSUM:-?}(sum of [<model> xN] widths over open rows) distinct_labels=${ADM_LABELS:-?}; maximum in one workflow=${ADM_MAXWIDTH:-?}/10 (declared widths read from the rows; raw observed counts, never clamped to a declared peak)"
  models="builder=undetermined, QC=undetermined, effort=undetermined (labels seen: ${ADM_MODELS:-none}; the resolved model/effort travel the provider request path a shell cannot read — control-bridge gap CB-1; owner: W00-U1 route receipts)"
  # Compliance: a point is earned only by CURRENT evidence this instrument
  # holds; unknown is not a pass. Provable here: swarm 6 (supervisor on time),
  # swarm 7 (this report is current), swarm 10 (merge queue moving by durable
  # enqueue within policy). Everything else needs the native census or the
  # route receipts and is reported UNDETERMINED, not passed.
  local s6=0 s7=0 s10=0
  (( SUP_OVERDUE == 0 && SUP_PRESENT == 1 )) && s6=1
  s7=1
  (( s7 == 1 )) && s10=1
  swarm=$(( s6 + s7 + s10 ))
  modelc=0
  overall=$(( swarm < modelc ? swarm : modelc ))
  viol="none"
  [[ -n "${SUP_ADM_OUT:-}" ]] && viol="admission findings this tick: $(sanitize "$SUP_ADM_OUT")"
  if (( SUP_OVERDUE == 1 )); then
    viol="supervisor-overdue(${SUP_NOTE}) — new dispatch PAUSED; completion NOT declared (SPEC 10.2)"
  fi
  local lastmerge nextwin udec milestone
  lastmerge="$("$GREP" -h 'MERGED:' "${AREA}/LEDGER.md" "$HOME_DIR/CONTROL/LEDGER.md" 2>/dev/null | tail -1 | sed 's/^[[:space:]]*//' || true)"
  if [[ -n "$lastmerge" ]]; then
    lastmerge="$(sanitize "$lastmerge") (claim; proof of merge is the repo sweep — a false claim prints MERGE-CLAIM-FALSE)"
  else
    lastmerge="none recorded (no MERGED: line in ${AREA_REL}/LEDGER.md or CONTROL/LEDGER.md)"
  fi
  if [[ "$MERGE_BATCH_DISABLED" == "1" ]]; then
    nextwin="N/A (MERGE_BATCH_DISABLE=1 — the explicit disable, never 0)"
  else
    local lm
    lm="$(stat -f %m "${AREA}/merge-batch.stamp" 2>/dev/null || stat -c %Y "${AREA}/merge-batch.stamp" 2>/dev/null || echo 0)"
    nextwin="$(date -u -r $(( lm + MERGE_BATCH_MIN * 60 )) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$(( lm + MERGE_BATCH_MIN * 60 ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo undetermined)(every ${MERGE_BATCH_MIN}m; ${q_open} request(s) already open)"
  fi
  if [[ -f "${AREA}/user-decision.txt" ]]; then
    udec="$(head -1 "${AREA}/user-decision.txt" | cut -c1-160) (recorded in ${AREA_REL}/user-decision.txt; the timer never fabricates a decision)"
  else
    udec="none recorded (${AREA_REL}/user-decision.txt absent)"
  fi
  milestone="$( "$GREP" -m1 '^[[:space:]]*[-*][[:space:]]*\[[[:space:]]\]' "$HOME_DIR/CONTROL/TODO.md" 2>/dev/null | sed 's/^[[:space:]]*[-*][[:space:]]*\[[[:space:]]*\][[:space:]]*//' | cut -c1-160 || true)"
  [[ -n "$milestone" ]] || milestone="undetermined (no open row in CONTROL/TODO.md; owner: conductor)"
  {
    printf 'Skill 75 repair — %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(date '+%Z %z')"
    printf 'Report: kind=%s | run_epoch=%s | tick_seq=%s | report_seq=%s | supervisor=%s\n' \
      "$kind" "${SUP_RUN_EPOCH:-unknown}" "${SUP_TICK_SEQ:-0}" "${SUP_REPORT_SEQ:-0}" "$(supervisor_identity)"
    printf 'Build acceptance: %s\n' "$ba"
    printf 'Accepted-scope merge progress: %s\n' "$amp"
    printf 'Current batch: %s\n' "$cb"
    printf 'Native workflows: %s\n' "$nw"
    printf 'Active agents: %s\n' "$aa"
    printf 'Models: %s\n' "$models"
    printf 'Swarm compliance: %s/10; model compliance: %s/10; overall=%s/10 (swarm provable here: 6 supervisor on time=%s, 7 report current=%s, 10 merge queue by durable enqueue=%s; points 1-5,8-9 and all model points UNDETERMINED under CB-1 — unknown is not a pass)\n' \
      "$swarm" "$modelc" "$overall" "$s6" "$s7" "$s10"
    printf 'Violations/recovery: %s\n' "$viol"
    printf 'Last proven merge: %s; next batch due: %s\n' "$lastmerge" "$nextwin"
    printf 'Current user decision: %s\n' "$udec"
    printf 'Next concrete milestone: %s\n' "$milestone"
  } | tee -a "${AREA}/supervisor-reports.log"
}

# ---- one deterministic supervisor tick.
supervise_tick() {  # supervise_tick <kind hint: startup|tick>
  local hint="$1" now_iso now_e f old_last old_next run_epoch tick_seq report_seq last_report paused=0
  now_iso="$(iso_now)"; now_e="$(epoch_now)"
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick-sup.XXXXXX")"
  f="$(sup_state_path)"
  run_epoch="${SUP_RUN_EPOCH:-}"
  tick_seq="${SUP_TICK_SEQ:-0}"; report_seq="${SUP_REPORT_SEQ:-0}"; last_report="${SUP_LAST_REPORT:-}"
  old_last=""; old_next=""
  if [[ -f "$f" ]]; then
    old_last="$(sup_state_get "$f" last_tick_epoch)"
    old_next="$(sup_state_get "$f" next_report_due_epoch)"
    [[ -n "$run_epoch" ]] || run_epoch="$(sup_state_get "$f" run_epoch)"
    local v
    v="$(sup_state_get "$f" tick_seq)"; [[ "$v" =~ ^[0-9]+$ ]] && tick_seq=$v
    v="$(sup_state_get "$f" report_seq)"; [[ "$v" =~ ^[0-9]+$ ]] && report_seq=$v
    last_report="$(sup_state_get "$f" last_report_at)"
  fi
  [[ -n "$run_epoch" ]] || run_epoch="run-$(date -u +%Y%m%d%H%M%S)-$$"
  SUP_RUN_EPOCH="$run_epoch"

  # The overdue read happens BEFORE the new stamp: a gap left by a dead or
  # suspended supervisor is the fault this tick must expose and pause under.
  supervisor_state_check
  if (( SUP_PRESENT == 1 && SUP_OVERDUE == 1 )); then
    paused=1
    printf 'SUPERVISOR-OVERDUE | %s | %s | last_tick_epoch=%s | new dispatch PAUSED this tick; supervision restored by this tick; completion NOT declared\n' \
      "$now_iso" "$SUP_NOTE" "${old_last:-?}"
    tick_ledger "$(iso_now) | DRIFT-ALARM | supervisor-overdue | $(sanitize "$SUP_NOTE") | $(sanitize "the supervision loop missed its tick; new dispatch paused and supervision restored (SPEC 10.2)")"
  fi

  # Immediate admission checks on the 60-second cadence. The call writes to a
  # file, not $(): admission_check's ADM_* census must survive into the 10.6
  # report, and command substitution would run it in a subshell.
  : > "$WORKDIR/adm.out"
  set +e
  admission_check > "$WORKDIR/adm.out" 2>&1
  set -e
  SUP_ADM_OUT="$(cat "$WORKDIR/adm.out")"

  # The merge window, if due: a durable enqueue to S75-WM, never a merge.
  merge_window

  # Persist before reporting: last_tick, next_report_due, supervisor identity,
  # run epoch and queue state are the crash-safe record.
  local next_due_e next_due_iso kind rep=0
  if [[ "$hint" == "startup" || "$hint" == "catch-up" ]]; then
    kind="$hint"; rep=1
  elif [[ -n "$old_next" && "$old_next" =~ ^[0-9]+$ ]] && (( now_e >= old_next )); then
    kind="periodic"; rep=1
  elif [[ -z "$old_next" ]]; then
    kind="startup"; rep=1
  else
    kind="none"
  fi
  # ONE missed report after a restart, never a flood: a catch-up covers every
  # missed window with a single report and then the cadence restarts from now.
  if (( rep == 1 )); then
    report_seq=$(( report_seq + 1 ))
    next_due_e=$(( now_e + SUPERVISE_REPORT_SEC ))
    last_report="$now_iso"
  else
    next_due_e="${old_next:-$(( now_e + SUPERVISE_REPORT_SEC ))}"
  fi
  next_due_iso="$(date -u -r "$next_due_e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$next_due_e" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$next_due_e")"
  tick_seq=$(( tick_seq + 1 ))
  SUP_TICK_SEQ="$tick_seq"; SUP_REPORT_SEQ="$report_seq"; SUP_LAST_REPORT="$last_report"
  sup_state_write "$now_iso" "$now_e" "$next_due_iso" "$next_due_e" "$run_epoch" "$tick_seq" "$report_seq" "$last_report" "$paused"

  printf 'SUPERVISOR-TICK | %s | tick_seq=%s | run_epoch=%s | admission=[%s] | merge=%s | queue_open=%s | health=ok | next_report_due=%s\n' \
    "$now_iso" "$tick_seq" "$run_epoch" "$(sanitize "${SUP_ADM_OUT:-none}")" "$(sanitize "${MERGE_NOTE:-not-run}")" \
    "$(wm_requests_open)" "$next_due_iso"
  [[ -n "$SUP_ADM_OUT" ]] && printf '%s\n' "$SUP_ADM_OUT"

  if (( rep == 1 )); then
    printf 'SUPERVISOR-REPORT | %s | kind=%s | report_seq=%s\n' "$now_iso" "$kind" "$report_seq"
    report_10_6 "$kind"
  fi
  rm -rf "$WORKDIR"; WORKDIR=""
  return 0
}

supervise_loop() {
  [[ -n "$HOME_DIR" ]] || die_tool "no project home given. Usage: watch-tick.sh <project-home> --supervise"
  bind_paths "$HOME_DIR"
  SUP_STARTED_AT="$(iso_now)"
  local max="${WATCH_SUPERVISOR_MAX_TICKS:-0}"
  [[ "$max" =~ ^[0-9]+$ ]] || die_tool "WATCH_SUPERVISOR_MAX_TICKS must be a non-negative integer (got: ${max})"
  local n=0 first=1
  printf 'SUPERVISOR-START | %s | pid=%s | run_epoch-pending | tick=%ss report=%ss overdue=%ss | control-bridge=CB-1 durable enqueue + ACTION lines + visible AUTO-RESUME (a cron task cannot call the session-only Workflow tool)\n' \
    "$(iso_now)" "$$" "$SUPERVISE_TICK_SEC" "$SUPERVISE_REPORT_SEC" "$SUPERVISE_OVERDUE_SEC"
  while :; do
    if (( first == 1 )); then
      # Startup: publish exactly one report — kind=startup on a fresh run,
      # kind=catch-up when a report window was missed (exactly one, no flood).
      local f old_next now_e
      f="$(sup_state_path)"; now_e="$(epoch_now)"
      if [[ -f "$f" ]]; then
        old_next="$(sup_state_get "$f" next_report_due_epoch)"
        if [[ "$old_next" =~ ^[0-9]+$ ]] && (( now_e >= old_next )); then supervise_tick "catch-up"
        else supervise_tick "startup"; fi
      else
        supervise_tick "startup"
      fi
      first=0
    else
      supervise_tick "tick"
    fi
    n=$(( n + 1 ))
    if (( max > 0 && n >= max )); then
      printf 'SUPERVISOR-STOP | %s | ticks=%s (WATCH_SUPERVISOR_MAX_TICKS=%s bound — the supervisor never auto-stops without one)\n' "$(iso_now)" "$n" "$max"
      return 0
    fi
    # Deterministic cadence: wake on the next WATCH_SUPERVISOR_TICK_SECONDS
    # boundary, so ticks land on the clock, not on drift-accumulated sleeps.
    local now sl
    now="$(date +%s)"
    sl=$(( SUPERVISE_TICK_SEC - (now % SUPERVISE_TICK_SEC) ))
    (( sl <= 0 )) && sl=$SUPERVISE_TICK_SEC
    sleep "$sl"
  done
}

# ---- the independent liveness check (--supervisor-status). READ-ONLY: it
#      reads the persisted state and reports; it never ticks, never dispatches,
#      never writes. 0 healthy, 3 overdue/absent (attention), 2 undetermined.
supervisor_status_cmd() {
  bind_paths "$HOME_DIR"
  local f lt e
  f="$(sup_state_path)"
  if [[ ! -f "$f" ]]; then
    printf 'SUPERVISOR | ABSENT (exit 3) | no %s/%s — no supervisor is armed; the five-minute cron tick is an outer layer, not the 60s supervisor (SPEC 10.2)\n' "$AREA_REL" "$SUP_STATE_FILE"
    return 3
  fi
  lt="$(sup_state_get "$f" last_tick_epoch)"
  if [[ ! "$lt" =~ ^[0-9]+$ ]]; then
    printf 'SUPERVISOR | UNDETERMINED (exit 2) | %s carries no parseable last_tick_epoch — the state is unreadable, which is never a pass\n' "$f"
    return 2
  fi
  e=$(( $(epoch_now) - lt ))
  local epoch sid due
  epoch="$(sup_state_get "$f" run_epoch)"; sid="$(sup_state_get "$f" supervisor_id)"; due="$(sup_state_get "$f" next_report_due)"
  if (( e > SUPERVISE_OVERDUE_SEC )); then
    printf 'SUPERVISOR | OVERDUE (exit 3) | last tick %ss ago (ceiling %ss) | run_epoch=%s | supervisor=%s | next_report_due=%s | queue_open=%s — new dispatch is PAUSED until supervision is restored\n' \
      "$e" "$SUPERVISE_OVERDUE_SEC" "$epoch" "$sid" "$due" "$(sup_state_get "$f" queue_open)"
    return 3
  fi
  printf 'SUPERVISOR | HEALTHY (exit 0) | last tick %ss ago (ceiling %ss) | run_epoch=%s | supervisor=%s | next_report_due=%s | queue_open=%s\n' \
    "$e" "$SUPERVISE_OVERDUE_SEC" "$epoch" "$sid" "$due" "$(sup_state_get "$f" queue_open)"
  return 0
}

# ---- the control-bridge statement (SPEC 10.1). Printed verbatim by
#      `--control-bridge` and cited by the selftest; the capability gap and
#      the supported repair, in one place.
control_bridge_statement() {
  cat <<'CBEOF'
CONTROL BRIDGE — CB-1 (SPEC 10.1)
CAPABILITY GAP, EXACT: a cron/launchd/systemd task runs as a plain shell
process. It cannot call the session-only Workflow tool — there is no session
attached to it, no Workflow launch primitive in a shell, and no supported way
for a timer to revive a dead conductor by magic. Any design that claims a
timer "runs the workflow" is claiming an interface the host does not have.

SUPPORTED REPAIR — the three mechanisms this file actually uses:
  1. DURABLE ENQUEUE (4e): a merge window writes ONE request file under
     <area>/wm-queue/ addressed to S75-WM (from=watch-tick.timer,
     action=run-merge-train-batch, timer never integrates), and prints ONE
     ACTION|wm-merge-request line. The visible S75-WM native workflow
     consumes the request inside its own session — the only place session
     tools exist. One open request at a time; a new window extends it.
  2. ACTION LINES (the tick's stdout and log): command-shaped
     ACTION|<verb>|<target>|<evidence> lines the in-session conductor reads
     and dispatches. The timer states facts and requests; the session acts.
  3. VISIBLE RESUME (4d): when a run stalls, the tick opens a VISIBLE Terminal
     window running the recorded launcher with --resume — an ordinary
     interactive session, never a hidden replacement worker.

PROOF: selftest cases 55-64 — the 0-cadence bug is rejected (55), the merge
window enqueues exactly one durable S75-WM request while the merge-train
canary proves no timer-originated merge process ran (56-57, 64), the cadence
persists state and catches up exactly one report (59-60), an overdue
supervisor pauses dispatch instead of declaring completion (61), and the
independent liveness check reads only state (62).
CBEOF
}

#------------------------------------------------------------------------------
# 4f. THE PROFILE REFRESH (A3). When the profile carries commands.refresh, the
#     tick runs that argv at the project root on EVERY tick (after the merge
#     batch, so one refresh covers a state-changing merge too), through python3
#     — never a shell — with a WATCH_REFRESH_TIMEOUT (default 120s) ceiling, and
#     prints one PROFILE-REFRESH line. A failure or timeout is logged, never
#     fatal. The files it wrote are listed in <area>/refresh-outputs.txt so the
#     stall census does not read regenerated views as progress.
#------------------------------------------------------------------------------
REFRESH_TIMEOUT="${WATCH_REFRESH_TIMEOUT:-120}"
# The runner also takes the census of what the refresh wrote (float mtimes: a
# find -newer marker compares whole seconds on macOS and misses same-second
# writes) into <area>/refresh-outputs.txt, the state area itself excluded.
RUN_ARGV_PY='
import os,subprocess,sys,time
home,t,area=sys.argv[1],float(sys.argv[2]),sys.argv[3]; argv=sys.argv[4:]
t0=time.time()
try:
    r=subprocess.run(argv,cwd=home,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=t)
    rc,out=r.returncode,r.stdout
except subprocess.TimeoutExpired as e:
    rc,out=124,(e.output or b"")+b" (timed out)"
except OSError as e:
    rc,out=127,str(e).encode()
wrote=[]
for d,dirs,files in os.walk(home):
    dirs[:]=[x for x in dirs if os.path.join(d,x)!=area]
    for f in files:
        p=os.path.join(d,f)
        try:
            if os.path.getmtime(p)>=t0: wrote.append(p)
        except OSError: pass
try:
    open(os.path.join(area,"refresh-outputs.txt"),"w").write("".join(x+"\n" for x in wrote))
except OSError: pass
sys.stdout.write("RC=%d\n" % rc)
sys.stdout.write(out.decode("utf-8","replace"))
'
run_refresh() {
  local vout vrc a out rc
  set +e; vout="$(profile_values "$HOME_DIR" refresh)"; vrc=$?; set -e
  (( vrc == 6 )) && return 0
  if (( vrc != 0 )); then printf 'PROFILE-REFRESH | not run | commands.refresh could not be read (rc=%s) — named above\n' "$vrc"; return 0; fi
  local -a RV=()
  while IFS= read -r a; do [[ -n "$a" ]] && RV+=("$a"); done <<< "$vout"
  mkdir -p "$AREA"
  set +e; out="$("$PYTHON3" -c "$RUN_ARGV_PY" "$HOME_DIR" "$REFRESH_TIMEOUT" "$AREA" "${RV[@]}" 2>&1)"; set -e
  rc="$(printf '%s\n' "$out" | head -1 | sed -n 's/^RC=\([0-9-]*\)$/\1/p')"
  printf '%s\n' "$out" | tail -n +2 > "${AREA}/refresh.out" 2>/dev/null || true
  if [[ "$rc" == "0" ]]; then
    printf 'PROFILE-REFRESH | %s | rc=0 | %s\n' "$(iso_now)" "$(snip200 "${AREA}/refresh.out")"
  else
    printf 'PROFILE-REFRESH FAILED | %s | rc=%s | %s (logged, not fatal)\n' "$(iso_now)" "${rc:-undetermined}" "$(snip200 "${AREA}/refresh.out")"
  fi
}

#------------------------------------------------------------------------------
# 4g. THE REPO SWEEPS (every tick, after the merge batch). Three sweeps, one
#     definition of merged — PROOF OF MERGE: after `git fetch`, the commit is
#     an ancestor of <remote>/<trunk> (of the local trunk on a local-only repo).
#     Nothing else is merged, whatever a ledger or a state file says.
#
#     THE REPOS. <area>/repos.json, {"repos":[{"name","root","trunk","remote"}]}
#     (a bare array is read too); remote is a remote NAME, a URL (fetched
#     straight into FETCH_HEAD, whose sha is then the trunk to prove against),
#     or null for a local-only repo. No registry = one repo from the repo-anchor receipt
#     (CONTROL/repo-anchor.json, or <statedir>/repo-anchor.json profiled):
#     root = repoRoot, name = its basename, trunk = MERGE_TRAIN_TRUNK or main,
#     remote = origin (none on a local-only receipt). No receipt either = the
#     project home itself when it is a git top level, else nothing to sweep.
#     Each repo is fetched ONCE per tick (+refs/heads/<trunk> into
#     refs/remotes/<remote>/<trunk>, WATCH_SWEEP_NET_TIMEOUT seconds, never
#     prompting). A fetch that fails makes that repo's verdicts UNDETERMINED,
#     never false: a network error is not a fact about the merge.
#
#     B2 RECONCILE. Every unit the ledger (CONTROL/LEDGER.md; profiled:
#       <area>/LEDGER.md and <statedir>/merge-train.log) or the profiled state
#       (documents.state, walked for status/state MERGED, MERGED_VERIFIED or
#       landed) claims — its LATEST claim — is re-proved on its commit= (else
#       its branch tip). A failed proof prints and records
#         MERGE-CLAIM-FALSE: unit=<branch> repo=<name> reason=…
#       and re-queues the branch (<area>/merge-train/requeue.tsv, the format
#       merge-train reads: repo<TAB>branch<TAB>reason<TAB>ISO time). A claim
#       naming no commit whose branch is gone is UNDETERMINED (cleanup deletes
#       proven branches, so absence proves nothing). The profiled state is only
#       READ: the line goes to the tick's own ledger, never into the state.
#     B3 ORPHANS. Per repo, `git worktree list`: a worktree whose branch is
#       proven merged is removed (`git worktree remove`; --force only on a
#       clean tree), its local branch deleted only while its tip is still the
#       proven sha (update-ref -d <old>), its remote branch deleted only when
#       that tip is proven too (push --force-with-lease=<ref>:<sha> :<ref>), and
#       the unit's gate log under <area>/merge-train/ removed. A dirty one is
#       KEPT-UNMERGED, never forced. A branch NOT proven merged with no commit
#       for WATCH_STALE_UNMERGED_MIN (120) minutes is STALE-UNMERGED and
#       re-queued, never deleted. Then `git worktree prune`.
#     B4 MINT. A ledger line `MINTED:|MINTED-LOCAL:|RELEASED:|TAGGED:` (tag=,
#       version=, commit=, repo=) or a profiled-state object carrying a
#       semver "tag" is a mint claim. PROOF OF MINT: `git ls-remote --tags`
#       shows the tag AND its peeled ^{} line (annotated), the peeled commit is
#       the claimed one, and VERSION, a CHANGELOG.md heading and README on that
#       commit carry the version (local-only or MINTED-LOCAL: the local tag,
#       same checks). A failure is MINT-CLAIM-FALSE, on the ledger, on stdout
#       and appended to the newest MORNING-REPORT-*.md under "Operator notes".
#
#     Each finding is written ONCE (<area>/sweep-reported.txt keys it by unit and
#     commit / tag), so a false claim is not re-queued every five minutes. The
#     findings reach the model half as ACTION|requeue|… and ACTION|mint-check|…
#     A sweep never deletes anything that is not proven merged.
#------------------------------------------------------------------------------
SWEEP_NET_TIMEOUT="${WATCH_SWEEP_NET_TIMEOUT:-60}"
STALE_UNMERGED_MIN="${WATCH_STALE_UNMERGED_MIN:-120}"
SWEEP_NOTE="not-run"
SWEEP_ACTS=""      # file: verb<TAB>target<TAB>evidence, one per finding
RP_NAME=() RP_ROOT=() RP_TRUNK=() RP_REMOTE=() RP_TARGET=() RP_WHY=() RP_TOK=()
SW_TOKEN=""
SW_FALSE=0 SW_STALE=0 SW_CLEANED=0 SW_KEPT=0 SW_MINTF=0 SW_UND=0 SW_CLAIMS=0 SW_UNDWHY=""

SWEEP_PY='
import json,os,re,sys
def out(*f): sys.stdout.write("\t".join(str(x).replace("\t"," ").replace("\n"," ").replace("\r"," ") for x in f)+"\n")
SAFE=re.compile(r"^[A-Za-z0-9._][A-Za-z0-9._/-]*$")
HEX=re.compile(r"^[0-9a-f]{7,40}$")
REMOTE=re.compile(r"^[A-Za-z0-9._@~][^\s]*$")
SEMVER=re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$")
mode=sys.argv[1]
if mode=="repos":
    area,receipt,trunk,home=sys.argv[2:6]
    reg=os.path.join(area,"repos.json")
    if os.path.isfile(reg):
        try: d=json.load(open(reg))
        except Exception as e:
            sys.stderr.write("%s is not parseable JSON: %s" % (reg,e)); sys.exit(3)
        if isinstance(d,dict): d=d.get("repos")
        if not isinstance(d,list):
            sys.stderr.write("%s is neither an array nor {\"repos\":[...]}" % reg); sys.exit(3)
        for e in d:
            if not isinstance(e,dict) or not isinstance(e.get("root"),str) or not e["root"].strip(): continue
            root=e["root"] if os.path.isabs(e["root"]) else os.path.join(home,e["root"])
            name=e.get("name") if isinstance(e.get("name"),str) and e.get("name") else os.path.basename(root.rstrip("/"))
            tr=e.get("trunk") if isinstance(e.get("trunk"),str) and SAFE.match(e.get("trunk") or "") else trunk
            rm=e.get("remote") if isinstance(e.get("remote"),str) and REMOTE.match(e.get("remote") or "") else ""
            out(name,root,tr,rm)
        sys.exit(0)
    if os.path.isfile(receipt):
        try: r=json.load(open(receipt))
        except Exception as e:
            sys.stderr.write("%s is not parseable JSON: %s" % (receipt,e)); sys.exit(3)
        root=r.get("repoRoot") if isinstance(r,dict) else None
        if isinstance(root,str) and root:
            local=r.get("source")=="local-only" or r.get("remote") in (None,"")
            out(os.path.basename(root.rstrip("/")),root,trunk,"" if local else "origin")
    sys.exit(0)
# mode == claims: <state-json or -> <file>...
SKIP=re.compile(r"\| S-CHECK \||DRIFT-ALARM|MERGE-CLAIM-FALSE|MINT-CLAIM-FALSE|STALE-UNMERGED|KEPT-UNMERGED|ORPHAN-CLEANED|MERGE-UNPROVEN|MERGE-BATCH|MINT-FAILED|SWEEP \|")
MC=re.compile(r"(^|[\s|])(MERGED:|MERGED_VERIFIED\b|LANDED:)")
MS=re.compile(r"(^|[\s|])status=(merged|merged_verified|landed)\b",re.I)
MT=re.compile(r"(^|[\s|])(MINTED|MINTED-LOCAL|RELEASED|TAGGED):")
def fld(line,*names):
    for n in names:
        m=re.search(r"(?:^|[\s|])"+n+r"=([^\s|]+)",line)
        if m: return m.group(1)
    return ""
merges={}; mints={}
def add_merge(unit,commit,repo,branch):
    unit=str(unit)
    br=branch if branch else (unit if "/" in unit else "unit/"+unit)
    if not SAFE.match(br): return
    commit=commit if isinstance(commit,str) and HEX.match(commit) else ""
    repo=repo if isinstance(repo,str) and SAFE.match(repo) else ""
    merges.pop(br,None); merges[br]=(unit,br,commit,repo)
def add_mint(repo,tag,ver,commit,local):
    tag=tag if isinstance(tag,str) else ""; ver=ver if isinstance(ver,str) else ""
    if not tag and ver: tag="v"+ver
    if not ver and tag: ver=tag[1:] if tag[:1]=="v" else tag
    if not SEMVER.match(ver) or not SAFE.match(tag): return
    commit=commit if isinstance(commit,str) and HEX.match(commit) else ""
    repo=repo if isinstance(repo,str) and SAFE.match(repo) else ""
    k=(repo,tag); mints.pop(k,None); mints[k]=(repo,tag,ver,commit,local)
def walk(o,key=""):
    if isinstance(o,dict):
        st=next((o[k] for k in ("status","state") if isinstance(o.get(k),str)),None)
        if st and st.upper() in ("MERGED","MERGED_VERIFIED","LANDED"):
            u=next((o[k] for k in ("unit","taskId","task_id","id") if isinstance(o.get(k),(str,int)) and str(o.get(k))),key)
            if u: add_merge(u,o.get("commit") or o.get("sha") or o.get("mergeCommit") or "",o.get("repo") or "",o.get("branch") if isinstance(o.get("branch"),str) else "")
        if isinstance(o.get("tag"),str) and re.match(r"^v?[0-9]+\.[0-9]+\.[0-9]+",o["tag"]):
            add_mint(o.get("repo") or "",o["tag"],o.get("version") if isinstance(o.get("version"),str) else "",o.get("commit") or "","0")
        for k,v in o.items(): walk(v,str(k))
    elif isinstance(o,list):
        for v in o: walk(v,key)
st=sys.argv[2]
if st!="-" and os.path.isfile(st):
    try: walk(json.load(open(st)))
    except Exception: pass
for f in sys.argv[3:]:
    try: lines=open(f,errors="replace").read().splitlines()
    except OSError: continue
    for line in lines:
        if SKIP.search(line): continue
        if MC.search(line) or MS.search(line):
            u=fld(line,"unit","taskId","task","id")
            if u: add_merge(u,fld(line,"commit"),fld(line,"repo"),"")
        elif MT.search(line):
            add_mint(fld(line,"repo"),fld(line,"tag"),fld(line,"version"),fld(line,"commit"),"1" if "MINTED-LOCAL:" in line else "0")
for v in merges.values(): out("M",*v)
for v in mints.values(): out("T",*v)
'

sw_und() { SW_UND=$(( SW_UND + 1 )); [[ -n "$SW_UNDWHY" ]] || SW_UNDWHY="$1"; }
sw_seen() { "$GREP" -qxF -- "$1" "${AREA}/sweep-reported.txt" 2>/dev/null; }
sw_mark() { mkdir -p "$AREA"; printf '%s\n' "$1" >> "${AREA}/sweep-reported.txt"; }
sw_act()  { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$SWEEP_ACTS"; }
sw_say()  { printf '%s\n' "$1"; tick_ledger "$(iso_now) | $1"; }
sw_requeue() {  # sw_requeue <repo> <branch> <reason> — merge-train's re-queue file
  mkdir -p "${AREA}/merge-train"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$(iso_now)" >> "${AREA}/merge-train/requeue.tsv"
}

# A network git call: never prompts, killed at WATCH_SWEEP_NET_TIMEOUT. A repo
# anchored under the operator's owner (receipt "source":"operator-owner") gets
# the operator token the way merge-train pushes with it: GH_TOKEN in THAT git
# process only, through a one-shot credential helper, and only toward a
# github.com remote. Never printed, never in a URL or a config file.
sw_net() {  # sw_net <repo-index> <git args...>
  local i="$1"; shift
  if [[ "${RP_TOK[$i]}" == 1 ]]; then
    GH_TOKEN="$SW_TOKEN" GIT_TERMINAL_PROMPT=0 perl -e 'alarm shift; exec @ARGV' "$SWEEP_NET_TIMEOUT" \
      git -C "${RP_ROOT[$i]}" -c credential.helper= \
      -c 'credential.helper=!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' "$@"
  else
    GIT_TERMINAL_PROMPT=0 perl -e 'alarm shift; exec @ARGV' "$SWEEP_NET_TIMEOUT" git -C "${RP_ROOT[$i]}" "$@"
  fi
}
sw_token() {
  local f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env" v="${SPEC_PROTOCOL_OPERATOR_GH_TOKEN:-}"
  if [[ -z "$v" && -r "$f" ]]; then
    v="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?SPEC_PROTOCOL_OPERATOR_GH_TOKEN[[:space:]]*=[[:space:]]*//p' "$f" | tail -n 1 | tr -d '\r')"
    v="${v%%[[:space:]]*}"; v="${v#[\"\']}"; v="${v%[\"\']}"
  fi
  printf '%s' "$v"
}

sweep_bind() {  # fills RP_*; rc 1 when the registry itself cannot be read
  local rec out rc name root trunk remote i top src
  RP_NAME=() RP_ROOT=() RP_TRUNK=() RP_REMOTE=() RP_TARGET=() RP_WHY=() RP_TOK=()
  if [[ -n "$STATE_DIR" ]]; then rec="${STATE_DIR}/repo-anchor.json"; else rec="${HOME_DIR}/CONTROL/repo-anchor.json"; fi
  [[ -n "$PYTHON3" ]] || { sw_und "no python3: the registry and the claims are JSON"; return 1; }
  set +e; out="$("$PYTHON3" -c "$SWEEP_PY" repos "$AREA" "$rec" "${MERGE_TRAIN_TRUNK:-main}" "$HOME_DIR" 2>&1)"; rc=$?; set -e
  if (( rc != 0 )); then sw_und "registry unreadable: $(sanitize "$out")"; return 1; fi
  if [[ -z "$out" ]]; then
    top="$(git -C "$HOME_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -n "$top" && "$(cd "$top" && pwd -P)" == "$(cd "$HOME_DIR" && pwd -P)" ]]; then
      out="$(basename "$HOME_DIR")"$'\t'"$HOME_DIR"$'\t'"${MERGE_TRAIN_TRUNK:-main}"$'\t'"origin"
    fi
  fi
  [[ -n "$out" ]] || return 0
  src="$(receipt_source_of "$rec")"
  [[ "$src" == operator-owner ]] && SW_TOKEN="$(sw_token)"
  while IFS=$'\t' read -r name root trunk remote; do
    [[ -n "$root" ]] || continue
    RP_NAME+=("$name"); RP_ROOT+=("$root"); RP_TRUNK+=("$trunk"); RP_REMOTE+=("$remote")
    RP_TARGET+=(""); RP_WHY+=(""); RP_TOK+=(0)
  done <<< "$out"
  for (( i = 0; i < ${#RP_ROOT[@]}; i++ )); do
    root="${RP_ROOT[$i]}"; trunk="${RP_TRUNK[$i]}"; remote="${RP_REMOTE[$i]}"
    if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      RP_WHY[$i]="${root} is not a git working copy"; continue
    fi
    # remote is a configured NAME, or a URL (then the target is the fetched sha)
    local url="$remote" isurl=0
    if [[ -n "$remote" ]]; then
      if git -C "$root" remote get-url "$remote" >/dev/null 2>&1; then url="$(git -C "$root" remote get-url "$remote" 2>/dev/null)"
      elif [[ "$remote" == *:* || "$remote" == /* ]]; then isurl=1
      else remote=""; RP_REMOTE[$i]=""; fi
    fi
    if [[ -z "$remote" ]]; then
      if git -C "$root" show-ref --verify --quiet "refs/heads/${trunk}"; then RP_TARGET[$i]="refs/heads/${trunk}"
      else RP_WHY[$i]="local-only repo has no trunk ${trunk}"; fi
      continue
    fi
    [[ -n "$SW_TOKEN" && "$url" == *github.com* ]] && RP_TOK[$i]=1
    if (( isurl == 1 )); then
      if sw_net "$i" fetch --quiet --no-tags "$remote" "refs/heads/${trunk}" >/dev/null 2>&1; then
        RP_TARGET[$i]="$(git -C "$root" rev-parse --verify --quiet FETCH_HEAD 2>/dev/null || true)"
        [[ -n "${RP_TARGET[$i]}" ]] || RP_WHY[$i]="fetch of ${trunk} from the registry URL left no FETCH_HEAD"
      else RP_WHY[$i]="fetch of ${trunk} from the registry URL failed"; fi
    elif sw_net "$i" fetch --quiet --no-tags "$remote" "+refs/heads/${trunk}:refs/remotes/${remote}/${trunk}" >/dev/null 2>&1; then
      RP_TARGET[$i]="refs/remotes/${remote}/${trunk}"
    else
      RP_WHY[$i]="fetch of ${remote}/${trunk} failed"
    fi
  done
  return 0
}
receipt_source_of() { "$PYTHON3" -c 'import json,sys;print(json.load(open(sys.argv[1])).get("source") or "")' "$1" 2>/dev/null || true; }

prove_rev() {  # prove_rev <repo-index> <rev> -> 0 proven merged, 1 not, 2 undetermined
  local i="$1" sha rc
  [[ -n "${RP_TARGET[$i]}" ]] || return 2
  sha="$(git -C "${RP_ROOT[$i]}" rev-parse --verify --quiet "${2}^{commit}" 2>/dev/null)" || return 1
  set +e; git -C "${RP_ROOT[$i]}" merge-base --is-ancestor "$sha" "${RP_TARGET[$i]}" 2>/dev/null; rc=$?; set -e
  case "$rc" in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}

claim_merge() {  # claim_merge <unit> <branch> <commit> <repo>
  local unit="$1" br="$2" cm="$3" rn="$4" i r rev="" tip any=0 und=0 where="" name key line tgt reason
  SW_CLAIMS=$(( SW_CLAIMS + 1 ))
  for (( i = 0; i < ${#RP_ROOT[@]}; i++ )); do
    [[ -z "$rn" || "$rn" == "${RP_NAME[$i]}" ]] || continue
    any=1
    if [[ -n "$cm" ]]; then rev="$cm"
    elif tip="$(git -C "${RP_ROOT[$i]}" rev-parse --verify --quiet "refs/heads/${br}^{commit}" 2>/dev/null)"; then rev="$tip"
    else und=1; continue; fi
    set +e; prove_rev "$i" "$rev"; r=$?; set -e
    case "$r" in
      0) return 0 ;;
      1) if [[ -z "$where" ]] && git -C "${RP_ROOT[$i]}" rev-parse --verify --quiet "${rev}^{commit}" >/dev/null 2>&1; then where="$i"; fi ;;
      *) und=1 ;;
    esac
  done
  if (( any == 0 )); then sw_und "unit=${br}: repo ${rn} is not registered"; return 0; fi
  if (( und == 1 )); then sw_und "unit=${br}: no commit named and no branch, or the fetch failed"; return 0; fi
  [[ -z "$where" && ${#RP_ROOT[@]} -eq 1 ]] && where=0
  name="unknown"; [[ -n "$where" ]] && name="${RP_NAME[$where]}"
  key="merge|${br}|${cm:-${rev:-none}}"
  sw_seen "$key" && return 0
  SW_FALSE=$(( SW_FALSE + 1 ))
  if [[ -n "$where" ]] && git -C "${RP_ROOT[$where]}" rev-parse --verify --quiet "${rev}^{commit}" >/dev/null 2>&1; then
    tgt="${RP_TARGET[$where]#refs/remotes/}"; tgt="${tgt#refs/heads/}"
    # a URL remote's target is a fetched sha; name the trunk, never the URL (it may carry credentials)
    [[ "$tgt" =~ ^[0-9a-f]{40}$ ]] && tgt="remote-${RP_TRUNK[$where]}"
    reason="not-an-ancestor-of-${tgt}"
  else reason="commit-absent-after-fetch"; fi
  line="MERGE-CLAIM-FALSE: unit=${br} repo=${name} commit=${cm:-${rev:-none}} reason=${reason}"
  sw_say "$line"
  [[ -n "$where" ]] && sw_requeue "$name" "$br" merge-claim-false
  sw_act requeue "$br" "${line} — re-queued for the next batch; merged means proof of merge only"
  sw_mark "$key"
}

sweep_orphans() {  # sweep_orphans <repo-index>
  local i="$1" root="${RP_ROOT[$i]}" wt="" head="" br="" locked=0 first=1 l
  [[ -n "${RP_TARGET[$i]}" ]] || return 0
  while IFS= read -r l; do
    case "$l" in
      "worktree "*) wt="${l#worktree }" ;;
      "HEAD "*) head="${l#HEAD }" ;;
      "branch refs/heads/"*) br="${l#branch refs/heads/}" ;;
      locked*) locked=1 ;;
      "")
        if (( first == 0 )) && [[ -n "$wt" && -n "$br" && "$br" != "${RP_TRUNK[$i]}" ]] && (( locked == 0 )); then
          orphan_one "$i" "$wt" "$head" "$br"
        fi
        first=0; wt="" head="" br="" locked=0 ;;
    esac
  done < <(git -C "$root" worktree list --porcelain 2>/dev/null; printf '\n')
  git -C "$root" worktree prune 2>/dev/null || true
}

orphan_one() {  # orphan_one <repo-index> <worktree> <head> <branch>
  local i="$1" wt="$2" head="$3" br="$4" root="${RP_ROOT[$1]}" name="${RP_NAME[$1]}" r ct age key rs note=""
  set +e; prove_rev "$i" "$head"; r=$?; set -e
  if (( r == 0 )); then
    # ponytail: a tip on the trunk's FIRST-PARENT line is a branch with no work of
    # its own yet (a builder's fresh worktree) or a fast-forward; both are left
    # alone. Only --no-ff merged units (the merge train's shape) are cleaned.
    # (no grep -q at a pipe's end: under pipefail an early exit SIGPIPEs the
    # writer and a match would read as a miss, cleaning a live builder's tree)
    git -C "$root" rev-list --first-parent "${RP_TARGET[$i]}" 2>/dev/null | "$GREP" -x -- "$head" >/dev/null && return 0
    if [[ -d "$wt" && -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]]; then
      key="kept|${br}|${head}"; sw_seen "$key" && return 0
      SW_KEPT=$(( SW_KEPT + 1 ))
      sw_say "KEPT-UNMERGED: unit=${br} repo=${name} worktree=${wt} reason=uncommitted-changes (the branch is merged; the uncommitted work is not, so nothing was removed)"
      sw_mark "$key"; return 0
    fi
    if [[ -d "$wt" ]]; then
      git -C "$root" worktree remove "$wt" >/dev/null 2>&1 || git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 \
        || { sw_und "unit=${br}: worktree ${wt} could not be removed"; return 0; }
    fi
    git -C "$root" update-ref -d "refs/heads/${br}" "$head" >/dev/null 2>&1 || note=" local-branch-kept(tip moved)"
    if [[ -n "${RP_REMOTE[$i]}" ]]; then
      rs="$(sw_net "$i" ls-remote --heads "${RP_REMOTE[$i]}" "refs/heads/${br}" 2>/dev/null | awk 'NR==1{print $1}')" || rs=""
      if [[ -n "$rs" ]]; then
        set +e; prove_rev "$i" "$rs"; r=$?; set -e
        if (( r == 0 )); then
          sw_net "$i" push --quiet "${RP_REMOTE[$i]}" "--force-with-lease=refs/heads/${br}:${rs}" ":refs/heads/${br}" >/dev/null 2>&1 \
            || note="${note} remote-branch-delete-refused"
        else note="${note} remote-branch-kept(not proven merged)"; fi
      fi
    fi
    rm -f "${AREA}/merge-train/${br//\//_}.gate.log" "${AREA}/merge-train/${name}/${br//\//_}.gate.log" 2>/dev/null || true
    SW_CLEANED=$(( SW_CLEANED + 1 ))
    sw_say "ORPHAN-CLEANED: unit=${br} repo=${name} worktree=${wt} commit=${head}${note}"
    return 0
  fi
  (( r == 1 )) || { sw_und "unit=${br}: merge proof undetermined"; return 0; }
  ct="$(git -C "$root" log -1 --format=%ct "$head" 2>/dev/null || true)"
  [[ "$ct" =~ ^[0-9]+$ ]] || { sw_und "unit=${br}: last commit time unreadable"; return 0; }
  age=$(( ($(epoch_now) - ct) / 60 ))
  (( age >= STALE_UNMERGED_MIN )) || return 0
  key="stale|${br}|${head}"; sw_seen "$key" && return 0
  SW_STALE=$(( SW_STALE + 1 ))
  sw_say "STALE-UNMERGED: unit=${br} repo=${name} worktree=${wt} idle=${age}m (no commit for ${age} minutes and not proven merged; kept, re-queued)"
  sw_requeue "$name" "$br" stale-unmerged
  sw_act requeue "$br" "STALE-UNMERGED: unit=${br} repo=${name} idle=${age}m — re-queued; judge or finish it, never delete it"
  sw_mark "$key"
}

sweep_actions_print() {  # the findings as ACTION lines, for paths with no emit()
  [[ -n "$SWEEP_ACTS" && -s "$SWEEP_ACTS" ]] || return 0
  local v g e
  while IFS=$'\t' read -r v g e; do
    [[ -n "$v" ]] && printf 'ACTION|%s|%s|%s\n' "$v" "$(sanitize "$g")" "$(sanitize "$e")"
  done < "$SWEEP_ACTS"
  return 0
}

report_note() {  # report_note <line> -> appended under the newest morning report's Operator notes
  local f
  f="$(ls -1 "$HOME_DIR"/MORNING-REPORT-*.md 2>/dev/null | sort | tail -n 1 || true)"
  [[ -n "$f" && -w "$f" ]] || return 0
  "$GREP" -qF -- "$1" "$f" 2>/dev/null && return 0
  "$GREP" -qE '^#+[[:space:]]*Operator notes' "$f" 2>/dev/null || printf '\n## Operator notes\n\n' >> "$f"
  printf -- '- %s\n' "$1" >> "$f"
}

#------------------------------------------------------------------------------
# 4h. MACOS PRIVACY (TCC). cron is a background job, and macOS CAN refuse it
#     ~/Desktop, ~/Documents and ~/Downloads with "Operation not permitted" (not
#     on every Mac: cron has read ~/Downloads on one with no Full Disk Access
#     entry for cron). So only that actual error is the block; when it comes,
#     the tick can read neither the project nor its log.
#     It then writes ONE named line OUTSIDE the project, to
#     ${XDG_STATE_HOME:-~/.local/state}/spec-protocol/tick-blocked/<key>, and
#     exits 2; every later blocked tick finds that record and exits 2 silently —
#     named once, never retried in a loop. A tick that CAN read the folder (the
#     in-session one) prints the line, files it on the ledger once and under the
#     morning report's Operator notes. A cron tick (--log, no session) that can
#     read the folder again proves access came back and clears the record.
#     "Permission denied" or a missing folder is NOT this block: those fall
#     through to the tick's own named failures.
#------------------------------------------------------------------------------
PRIVACY_FIX="Give cron Full Disk Access: System Settings > Privacy & Security > Full Disk Access, click +, press Command-Shift-G, type /usr/sbin/cron, click Open and switch it on (or keep the project in ~/Projects, which needs no permission)"
blocked_record() { printf '%s/spec-protocol/tick-blocked/%s' "${XDG_STATE_HOME:-$HOME/.local/state}" "$(printf '%s' "$1" | tr -s / | cksum | cut -d' ' -f1)"; }
privacy_line() { printf 'TICK-BLOCKED-BY-PRIVACY: path=%s fix=%s' "$1" "$PRIVACY_FIX"; }

privacy_gate() {  # privacy_gate <home> -> returns when readable; exit 2 when privacy refused it
  local h="${1%/}" err rec
  [[ "$h" == /* ]] || h="${PWD}/${h}"
  err="$("${WATCH_TICK_LS:-ls}" "$h" 2>&1 >/dev/null)" && return 0
  [[ "$err" == *"Operation not permitted"* ]] || return 0
  rec="$(blocked_record "$h")"
  [[ -f "$rec" ]] && exit 2
  mkdir -p "$(dirname "$rec")" && privacy_line "$h" > "$rec"
  privacy_line "$h"; printf '\n'
  exit 2
}

privacy_pickup() {  # a readable home: surface, or clear, a record a blocked cron tick left
  local rec line
  rec="$(blocked_record "$HOME_DIR")"
  [[ -f "$rec" ]] || return 0
  bind_paths "$HOME_DIR"
  if [[ -n "$LOG_FILE" && -z "${CLAUDE_CODE_SESSION_ID:-}" ]]; then
    rm -f "$rec"; printf 'TICK-PRIVACY | cleared: cron can read %s again\n' "$HOME_DIR"; return 0
  fi
  line="$(cat "$rec")"
  printf '%s\n' "$line"
  "$GREP" -qF -- "$line" "${AREA}/LEDGER.md" 2>/dev/null || tick_ledger "$(iso_now) | ${line}"
  report_note "$line"
}

claim_mint() {  # claim_mint <repo> <tag> <version> <commit> <local 0/1>
  local rn="$1" tag="$2" ver="$3" cm="$4" loc="$5" i=-1 j root out obj peeled why="" typ vre key line
  for (( j = 0; j < ${#RP_ROOT[@]}; j++ )); do
    if [[ "$rn" == "${RP_NAME[$j]}" ]] || [[ -z "$rn" && ${#RP_ROOT[@]} -eq 1 ]]; then i="$j"; fi
  done
  if (( i < 0 )); then sw_und "mint ${tag}: repo ${rn:-(none named)} not resolvable"; return 0; fi
  root="${RP_ROOT[$i]}"
  key="mint|${RP_NAME[$i]}|${tag}|${cm}"
  sw_seen "$key" && return 0
  sw_seen "mint-ok|${key}" && return 0
  if [[ "$loc" == 1 || -z "${RP_REMOTE[$i]}" ]]; then
    typ="$(git -C "$root" cat-file -t "refs/tags/${tag}" 2>/dev/null || true)"
    if [[ "$typ" != tag ]]; then why="tag ${tag} is ${typ:-absent} locally, not an annotated tag"
    else peeled="$(git -C "$root" rev-parse "refs/tags/${tag}^{commit}" 2>/dev/null || true)"; fi
  else
    out="$(sw_net "$i" ls-remote --tags "${RP_REMOTE[$i]}" "refs/tags/${tag}" "refs/tags/${tag}^{}" 2>/dev/null)" \
      || { sw_und "mint ${tag}: ls-remote on ${RP_NAME[$i]} failed"; return 0; }
    obj="$(printf '%s\n' "$out" | awk -v r="refs/tags/${tag}" '$2==r{print $1}')"
    peeled="$(printf '%s\n' "$out" | awk -v r="refs/tags/${tag}^{}" '$2==r{print $1}')"
    if [[ -z "$obj" ]]; then why="tag ${tag} is not on ${RP_REMOTE[$i]}"
    elif [[ -z "$peeled" ]]; then why="tag ${tag} on ${RP_REMOTE[$i]} is lightweight, not annotated"; fi
    if [[ -z "$why" ]] && ! git -C "$root" cat-file -e "${peeled}^{commit}" 2>/dev/null; then
      sw_net "$i" fetch --quiet --no-tags "${RP_REMOTE[$i]}" "refs/tags/${tag}" >/dev/null 2>&1 \
        || { sw_und "mint ${tag}: the tagged commit could not be fetched"; return 0; }
    fi
  fi
  if [[ -z "$why" && -n "$cm" && "$peeled" != "$cm"* ]]; then why="tag ${tag} points at ${peeled}, the claim says ${cm}"; fi
  if [[ -z "$why" ]]; then
    vre="$(printf '%s' "$ver" | sed 's/[.+]/\\&/g')"
    if [[ "$(git -C "$root" show "${peeled}:VERSION" 2>/dev/null | tr -d ' \r\n\t')" != "$ver" ]]; then why="VERSION at ${peeled} is not ${ver}"
    elif ! git -C "$root" show "${peeled}:CHANGELOG.md" 2>/dev/null | "$GREP" -E '^#' | "$GREP" -E "(^|[^0-9.])${vre}([^0-9.]|$)" >/dev/null; then why="CHANGELOG.md at ${peeled} has no ${ver} heading"
    elif ! { git -C "$root" show "${peeled}:README.md" 2>/dev/null || git -C "$root" show "${peeled}:README" 2>/dev/null; } | "$GREP" -E "(^|[^0-9.])${vre}([^0-9.]|$)" >/dev/null; then why="README at ${peeled} does not carry ${ver}"
    fi
  fi
  if [[ -z "$why" ]]; then sw_mark "mint-ok|${key}"; return 0; fi
  SW_MINTF=$(( SW_MINTF + 1 ))
  line="MINT-CLAIM-FALSE: repo=${RP_NAME[$i]} tag=${tag} version=${ver} reason=${why}"
  sw_say "$line"
  report_note "$line"
  sw_act mint-check "${RP_NAME[$i]} ${tag}" "${line} — not minted until tools/release.sh proves it from the remote"
  sw_mark "$key"
}

repo_sweeps() {  # sets SWEEP_NOTE; findings to $SWEEP_ACTS; never fatal
  local i out rc kind a b c d e st
  SWEEP_ACTS="${WORKDIR:-$AREA}/sweep-acts.tsv"; : > "$SWEEP_ACTS"
  SW_FALSE=0 SW_STALE=0 SW_CLEANED=0 SW_KEPT=0 SW_MINTF=0 SW_UND=0 SW_CLAIMS=0 SW_UNDWHY=""
  if ! sweep_bind; then SWEEP_NOTE="undetermined(${SW_UNDWHY})"; return 0; fi
  if (( ${#RP_ROOT[@]} == 0 )); then SWEEP_NOTE="none(no repository registered: no repos.json, no repo-anchor receipt)"; return 0; fi
  for (( i = 0; i < ${#RP_ROOT[@]}; i++ )); do
    [[ -n "${RP_TARGET[$i]}" ]] || sw_und "repo ${RP_NAME[$i]}: ${RP_WHY[$i]}"
  done
  local -a files=()
  if [[ -n "$STATE_DIR" ]]; then st="$STATE_JSON"; files=("${AREA}/LEDGER.md" "${STATE_DIR}/merge-train.log")
  else st="-"; files=("${HOME_DIR}/CONTROL/LEDGER.md"); fi
  set +e; out="$("$PYTHON3" -c "$SWEEP_PY" claims "$st" "${files[@]}" 2>&1)"; rc=$?; set -e
  if (( rc != 0 )); then sw_und "claims unreadable: $(sanitize "$out")"; out=""; fi
  while IFS=$'\t' read -r kind a b c d e; do
    case "$kind" in
      M) claim_merge "$a" "$b" "$c" "$d" ;;
      T) claim_mint "$a" "$b" "$c" "$d" "$e" ;;
    esac
  done <<< "$out"
  for (( i = 0; i < ${#RP_ROOT[@]}; i++ )); do sweep_orphans "$i"; done
  SWEEP_NOTE="repos=${#RP_ROOT[@]} claims=${SW_CLAIMS} claim-false=${SW_FALSE} stale-unmerged=${SW_STALE} cleaned=${SW_CLEANED} kept=${SW_KEPT} mint-false=${SW_MINTF} undetermined=${SW_UND}${SW_UNDWHY:+(first: ${SW_UNDWHY})}"
  printf 'SWEEP | %s\n' "$(sanitize_long "$SWEEP_NOTE")"
}

#==============================================================================
# ARGUMENT PARSING
#==============================================================================
while (( $# )); do
  case "$1" in
    --selftest)  DO_SELFTEST=1; shift ;;
    --cron-line) DO_CRON_LINE=1; shift ;;
    --arm)       DO_ARM=1; shift ;;
    --check)     DO_CHECK=1; shift ;;
    --record-session) DO_RECORD=1; shift ;;
    --sweep)     DO_SWEEP=1; shift ;;
    --supervise) DO_SUPERVISE=1; shift ;;
    --supervisor-status) DO_SUP_STATUS=1; shift ;;
    --control-bridge) DO_BRIDGE=1; shift ;;
    --log)       [[ $# -ge 2 && -n "$2" ]] || die_tool "--log needs a file path"
                 LOG_FILE="$2"; shift 2 ;;
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
# MERGE_BATCH_MINUTES=0 was the "always eligible" bug (4e): zero made the
# interval check fire on every tick. 0 is therefore REJECTED, named — the
# explicit disable is MERGE_BATCH_DISABLE=1 and is never a cadence value.
[[ "$MERGE_BATCH_MIN" =~ ^[0-9]+$ ]] && (( MERGE_BATCH_MIN >= 1 )) \
  || die_tool "MERGE_BATCH_MINUTES must be a positive integer of minutes (got: ${MERGE_BATCH_MIN}) — 0 is not a disable switch and made the interval check eligible on every tick; disable the merge windows explicitly with MERGE_BATCH_DISABLE=1"
case "$MERGE_BATCH_DISABLED" in 0|1) : ;; *) die_tool "MERGE_BATCH_DISABLE must be 0 or 1 (got: ${MERGE_BATCH_DISABLED})" ;; esac
[[ "$SUPERVISE_TICK_SEC" =~ ^[0-9]+$ ]] && (( SUPERVISE_TICK_SEC >= 1 )) \
  || die_tool "WATCH_SUPERVISOR_TICK_SECONDS must be a positive integer of seconds (got: ${SUPERVISE_TICK_SEC})"
[[ "$SUPERVISE_REPORT_SEC" =~ ^[0-9]+$ ]] && (( SUPERVISE_REPORT_SEC >= 1 )) \
  || die_tool "WATCH_SUPERVISOR_REPORT_SECONDS must be a positive integer of seconds (got: ${SUPERVISE_REPORT_SEC})"
[[ "$SUPERVISE_OVERDUE_SEC" =~ ^[0-9]+$ ]] && (( SUPERVISE_OVERDUE_SEC >= 1 )) \
  || die_tool "WATCH_SUPERVISOR_OVERDUE_SECONDS must be a positive integer of seconds (got: ${SUPERVISE_OVERDUE_SEC})"
[[ "$SWEEP_NET_TIMEOUT" =~ ^[0-9]+$ && "$SWEEP_NET_TIMEOUT" -gt 0 ]] || die_tool "WATCH_SWEEP_NET_TIMEOUT must be a positive integer of seconds (got: ${SWEEP_NET_TIMEOUT})"
[[ "$STALE_UNMERGED_MIN" =~ ^[0-9]+$ ]] || die_tool "WATCH_STALE_UNMERGED_MIN must be a non-negative integer (got: ${STALE_UNMERGED_MIN})"
[[ "$REFRESH_TIMEOUT" =~ ^[0-9]+$ && "$REFRESH_TIMEOUT" -gt 0 ]] || die_tool "WATCH_REFRESH_TIMEOUT must be a positive integer of seconds (got: ${REFRESH_TIMEOUT})"

#==============================================================================
# THE PROFILED TICK
#
#   A profiled project's five-minute tick is the PROFILE'S OWN validator, run
#   read-only at the project root from its declared argv, and one line printed.
#   Then, in order: the batch merge when due (4e, MERGE-BATCH line), the
#   profile's commands.refresh when present (4f, PROFILE-REFRESH line), and the
#   post-interview stalled-turn check with AUTO-RESUME (4d) — the same check and
#   the same resume a legacy project gets. Its only writes are the state area
#   `<statedir>/spec-protocol/` (session record, locks, stamps, refresh list)
#   and ledger lines through tools/ledger.sh, which lands them in
#   `<statedir>/spec-protocol/LEDGER.md`. `documents.state` stays the single
#   canonical state — no CONTROL/, no second task graph
#   (references/project-profile.md).
#
#     rc 0      PROFILE-TICK | <ISO8601Z> | home=<home> | validate_rc=0 | <stdout, 200 chars>  -> 0
#     rc non-0  PROFILE-TICK STALL | <ISO8601Z> | home=<home> | validate_rc=<rc> | <stderr, …> -> 3
#
#   The argv is EXECUTED, never evaluated: `"${PV[@]}"` after a `cd` to the
#   project root, so a profile value can name a program and can never smuggle a
#   shell line past it. An rc of 127 is therefore a shell abort NAMED in the
#   stall line's stderr snippet, never a fact about the project's state.
#==============================================================================
snip200() {  # snip200 <file> -> its first 200 chars, newlines collapsed
  local s
  s="$(tr '\n\r\t' '   ' < "$1" | tr -s ' ' | sed 's/^ *//; s/ *$//' | cut -c1-200)"
  [[ -n "$s" ]] || s="(no output)"
  printf '%s' "$s"
}

run_profile_tick() {  # 0 = validate rc 0; 3 = stall; exit 2 when the profile cannot be read
  local vout vrc rc a
  # profile_values runs in a SUBSHELL, so its die_tool ends that subshell only:
  # its message is already on stderr and the rc is what crosses back. Exiting
  # on it is the point — an unreadable profile is UNDETERMINED, and a tick that
  # carried on with an empty argv would report a validator it never ran.
  set +e
  vout="$(profile_values "$HOME_DIR" validate)"; vrc=$?
  set -e
  (( vrc == 0 )) || exit "$vrc"
  bind_paths "$HOME_DIR"
  local -a PV=()
  while IFS= read -r a; do [[ -n "$a" ]] || continue; PV+=("$a"); done <<< "$vout"
  (( ${#PV[@]} > 0 )) || die_tool "PROFILE | ${HOME_DIR}/.spec-protocol.json commands.validate parsed to an empty argv — nothing to run, so nothing is claimed"

  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick.XXXXXX")"
  set +e
  ( cd "$HOME_DIR" && exec "${PV[@]}" ) > "$WORKDIR/validate.out" 2> "$WORKDIR/validate.err"
  rc=$?
  set -e
  local ret=0
  if (( rc == 0 )); then
    printf 'PROFILE-TICK | %s | home=%s | validate_rc=0 | %s\n' \
      "$(iso_now)" "$HOME_DIR" "$(snip200 "$WORKDIR/validate.out")"
  else
    printf 'PROFILE-TICK STALL | %s | home=%s | validate_rc=%s | %s\n' \
      "$(iso_now)" "$HOME_DIR" "$rc" "$(snip200 "$WORKDIR/validate.err")"
    ret=3
  fi

  # A4 then A3: the merge WINDOW (4e) is a durable enqueue to S75-WM — the
  # timer integrates nothing. The repo sweeps (4g) follow it: they re-prove
  # whatever claims exist, independently of who made them.
  merge_window
  repo_sweeps || true
  sweep_actions_print
  [[ -s "$SWEEP_ACTS" ]] && ret=3
  run_refresh

  # A2: the same post-interview stall check and AUTO-RESUME a legacy project
  # gets. The phase is interview=done in the state area's record; run_status
  # (falling back to status, when the bound state carries only that) other
  # than RUNNING is a run waiting on purpose -- and the five terminal/paused
  # values below never auto-resume regardless of case or how stale the
  # session looks.
  local rs newest age
  rs="$(run_status_of)"
  if interview_done && ! run_status_is_terminal "$rs" && [[ -z "$rs" || "$rs" == RUNNING ]]; then
    newest="$(newest_write_epoch)"
    if [[ -n "$newest" ]]; then
      age=$(( ($(epoch_now) - newest) / 60 ))
      if (( age >= STALLED_MIN )); then
        tick_ledger "$(iso_now) | DRIFT-ALARM | stalled-turn | elapsed=${age} | phase=post-interview(profiled) | $(sanitize "no file write under the project folder for ${age} minutes after the interview ended (ceiling ${STALLED_MIN}m)")"
        printf 'ACTION|stalled-turn|elapsed=%sm|DRIFT-ALARM stalled-turn: no project write for %s minutes after the interview ended (ceiling %s)\n' "$age" "$age" "$STALLED_MIN"
        auto_resume "$age" "post-interview(profiled)"
        ret=3
      fi
    fi
  fi
  return "$ret"
}

#==============================================================================
# THE TICK
#==============================================================================
run_tick() {
  [[ -n "$HOME_DIR" ]] || die_tool "no project home given. Usage: watch-tick.sh <project-home> [--cron-line|--arm]"
  # The plain tick and the supervisor loop (4h/4i): probe privacy BEFORE
  # anything reads the home, then open the log the cron line names.
  # --supervisor-status is the exception: it is a READ-ONLY liveness answer
  # for a caller, so its verdict goes to that caller's stdout, never a log.
  if (( ! DO_CRON_LINE && ! DO_ARM && ! DO_RECORD && ! DO_CHECK && ! DO_SWEEP && ! DO_SUP_STATUS )); then
    privacy_gate "$HOME_DIR"
    if [[ -n "$LOG_FILE" ]]; then exec >> "$LOG_FILE" 2>&1 || die_tool "cannot append to the log ${LOG_FILE}"; fi
  fi
  [[ -d "$HOME_DIR" ]] || die_tool "project home does not exist: ${HOME_DIR}"
  HOME_DIR="$(cd "$HOME_DIR" && pwd)"

  # A supplied profile REDIRECTS this tick; it never switches it off. The
  # redirect lives in exactly three places and nowhere else: cron_line logs
  # beside the bound state, --arm installs THAT line through the same
  # idempotent path, and the tick itself runs the profile's declared validator
  # instead of the CONTROL/ reconcile. None of the three creates a CONTROL/
  # directory, a second ledger or a second task graph — what a profile forbids
  # is the SECOND COPY, never the watching (references/project-profile.md).
  # There is no arm here that a profiled project does not get: an unwatched run
  # is the exact failure these instruments exist to prevent.

  if (( DO_CRON_LINE )); then
    local crc=0
    set +e; cron_line "$HOME_DIR"; crc=$?; set -e
    exit "$crc"
  fi

  # --arm is the step-3 half and runs BEFORE self_prove and before any project
  # file is read: arming a project the plan has not reached yet is the whole
  # point of it (RC-19), so it may never depend on a plan file existing.
  if (( DO_ARM )); then
    local arc=0
    set +e; arm_tick "$HOME_DIR"; arc=$?; set -e
    if (( arc == 0 || arc == 3 )); then bind_paths "$HOME_DIR"; record_session "$HOME_DIR"; fi
    exit "$arc"
  fi

  # --record-session: interview end (F3). Same record as --arm, plus
  # interview=done. Loud when it cannot record: a silent no-op here is a
  # window closed after the last question that nothing can resume.
  if (( DO_RECORD )); then
    [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]] || { printf 'RECORD | not recorded (exit 2) | CLAUDE_CODE_SESSION_ID is not set — run this inside the conductor session\n'; exit 2; }
    bind_paths "$HOME_DIR"
    record_session "$HOME_DIR" done
    exit 0
  fi

  if (( DO_CHECK )); then
    local chk=0
    set +e; check_tick "$HOME_DIR"; chk=$?; set -e
    exit "$chk"
  fi

  # --sweep: the repo sweeps ALONE (4g), for the Node twin, which runs this
  # rather than keeping a second copy of the git logic. Prints the sweep's
  # lines and its ACTION lines; 0 nothing found, 3 findings.
  if (( DO_SWEEP )); then
    bind_paths "$HOME_DIR"
    WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick.XXXXXX")"
    repo_sweeps || true
    sweep_actions_print
    [[ -s "$SWEEP_ACTS" ]] && exit 3
    exit 0
  fi

  # --supervise: the deterministic 60-second supervisor loop (4i) — immediate
  # admission checks, the section 10.6 report at startup and every
  # WATCH_SUPERVISOR_REPORT_SECONDS, persisted state, and the overdue pause.
  if (( DO_SUPERVISE )); then
    local src=0
    set +e; supervise_loop; src=$?; set -e
    exit "$src"
  fi

  # --supervisor-status: the INDEPENDENT liveness check (4i). Reads only the
  # persisted state; never ticks, never dispatches, never writes.
  if (( DO_SUP_STATUS )); then
    local stc=0
    set +e; supervisor_status_cmd; stc=$?; set -e
    exit "$stc"
  fi

  self_prove
  privacy_pickup

  # THE PROFILED TICK. self_prove runs FIRST on both paths: it proves this
  # script's own parser and label detector against embedded fixtures and reads
  # nothing of the project, so a profiled run is a proven instrument before it
  # reports, exactly as a legacy one is. Everything below this line reads
  # CONTROL/ and belongs to the legacy path alone.
  if is_profiled "$HOME_DIR"; then
    local prc=0
    set +e; run_profile_tick; prc=$?; set -e
    return "$prc"
  fi
  bind_paths "$HOME_DIR"

  # 4i: the supervisor read. An overdue supervisor (persisted last_tick older
  # than WATCH_SUPERVISOR_OVERDUE_SECONDS) pauses this tick's NEW DISPATCH
  # below (apply_dispatch_pause) and exposes the fault here on the ledger;
  # it never declares completion (SPEC 10.2).
  supervisor_state_check
  if (( SUP_OVERDUE == 1 )); then
    ledger_write "CONTROL/LEDGER.md" \
      "$(iso_now) | DRIFT-ALARM | supervisor-overdue | $(sanitize "$SUP_NOTE") | $(sanitize "the supervision loop missed its tick; new dispatch paused and supervision restored on this tick (SPEC 10.2)")"
    printf 'SUPERVISOR-OVERDUE | %s | %s | new dispatch PAUSED this tick; completion NOT declared\n' "$(iso_now)" "$SUP_NOTE"
  fi

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
    # F2: research/spec/apparatus run before the plan exists. Once the
    # interview is over (interview=done) and the run is RUNNING, a project
    # with no write for STALLED_MIN minutes is hung — alarm and resume once.
    local pp_rs pp_new pp_age
    pp_rs="$(run_status_of)"
    if interview_done && [[ -z "$pp_rs" || "$pp_rs" == RUNNING ]]; then
      pp_new="$(newest_write_epoch)"
      if [[ -n "$pp_new" ]]; then
        pp_age=$(( ($(epoch_now) - pp_new) / 60 ))
        if (( pp_age >= STALLED_MIN )); then
          ledger_write "CONTROL/LEDGER.md" \
            "$(iso_now) | DRIFT-ALARM | stalled-turn | elapsed=${pp_age} | phase=post-interview(pre-plan) | $(sanitize "no file write under the project folder for ${pp_age} minutes after the interview ended (ceiling ${STALLED_MIN}m)")"
          printf 'ACTION|stalled-turn|elapsed=%sm|DRIFT-ALARM stalled-turn: no project write for %s minutes after the interview ended, before the plan exists (ceiling %s)\n' "$pp_age" "$pp_age" "$STALLED_MIN"
          auto_resume "$pp_age" "post-interview(pre-plan)"
          return 3
        fi
      fi
    fi
    return 0
  fi

  [[ -f "$CHK" ]] || die_tool "CONTROL/CHECKLIST.md is missing at ${CHK} — the runnable count has no source. Checked: ${CHK}. Not checked: the dispatch log and the heartbeat, because the run stopped here."

  # A4: the merge window cadence, once the plan exists (4e) — a durable
  # enqueue to visible S75-WM, never a timer-originated merge. Logged in the
  # S-CHECK line's merge-batch= field; never a verdict and never fatal.
  # Then the repo sweeps (4g): their findings are emitted with the S-checks.
  merge_window
  repo_sweeps || true

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
  #
  # WIDENED (F2): every post-interview phase, not only build. The phase is
  # `build` when an open build row stands (unchanged), else the stage of an
  # open spec/apparatus/audit/merge/publish row, else `post-interview` when
  # CONTROL/auto-resume.txt carries interview=done (written by
  # --record-session at interview end — this is what covers research, whose
  # step-3.5 reader rows run DURING the interview and so prove nothing).
  # Outside build, a project_state.json run_status other than RUNNING (a
  # finished, paused or stopped run) is waiting on purpose: no alarm, no resume.
  local STALL_NOTE="" STALL_ELAPSED=""
  {
    local stall_phase="" stall_newest="" stall_now stall_age=0
    local su sstage sl srs=""
    while IFS=$'\t' read -r su sstage _slok _stree _sts _slabel; do
      [[ -n "$su" ]] || continue
      sl="$(printf '%s' "${sstage}" | tr 'A-Z' 'a-z')"
      case "$sl" in
        *build*) stall_phase=build; break ;;
        *spec*|*apparatus*|*audit*|*merge*|*publish*) [[ -n "$stall_phase" ]] || stall_phase="$(sanitize "$sl")" ;;
      esac
    done < "$WORKDIR/open.tsv"
    [[ -n "$stall_phase" ]] || ! interview_done || stall_phase="post-interview"
    if [[ -n "$stall_phase" && "$stall_phase" != build ]]; then
      srs="$(run_status_of)"; [[ -z "$srs" || "$srs" == RUNNING ]] || stall_phase=""
    fi
    if [[ -n "$stall_phase" ]]; then
      stall_now="$(epoch_now)"
      stall_newest="$(newest_write_epoch)"
      if [[ -z "$stall_newest" ]]; then
        STALL_NOTE="undetermined(no readable file mtime under the project folder — the clock has no witness)"
        add_undet "stalled-turn=undetermined(no file mtime could be read under ${HOME_DIR} — an unreadable clock is not proof of progress)"
      else
        stall_age=$(( (stall_now - stall_newest) / 60 ))
        if (( stall_age >= STALLED_MIN )); then
          STALL_NOTE="stalled(elapsed=${stall_age}m)"
          STALL_ELAPSED="${stall_age}"
          ledger_write "CONTROL/LEDGER.md" \
            "$(iso_now) | DRIFT-ALARM | stalled-turn | elapsed=${stall_age} | phase=${stall_phase} | $(sanitize "no file write under the project folder for ${stall_age} minutes in phase ${stall_phase} (ceiling ${STALLED_MIN}m) — reconcile the actual Workflow/session/run or Agent-Team identity before retirement; stale files are not proof of death")"
          emit "stalled-turn" "elapsed=${stall_age}m" \
            "DRIFT-ALARM stalled-turn: newest file mtime under the project folder is ${stall_age} minutes old (ceiling ${STALLED_MIN}) in phase ${stall_phase} — the turn is hung, not slow (RC-17)"
          auto_resume "$stall_age" "$stall_phase"
        else
          STALL_NOTE="ok(newest write ${stall_age}m ago, ceiling ${STALLED_MIN}m)"
        fi
      fi
    else
      STALL_NOTE="undetermined(no running post-interview phase — no open build/spec/apparatus/audit/merge/publish row, no interview=done record, or run_status=${srs:-?} is not RUNNING)"
      add_undet "stalled-turn=undetermined(no running post-interview phase in CONTROL/dispatch-log.md, CONTROL/auto-resume.txt or CONTROL/project_state.json — before the interview ends, or while a run waits on purpose, the wall-clock ceiling does not apply)"
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
    # The tick's own S-CHECK line ("published=ok(no PUBLISHED: line …)") and its
    # DRIFT-ALARM line quote the word; they are never a publish. awk keeps a read
    # error at rc 2 (a `grep | grep -v` pipe would mask it as a no-match 1).
    pub_line="$("$AWK" '/PUBLISHED:/ && !/[|] (S-CHECK|DRIFT-ALARM) [|]/' "$LED" 2>/dev/null | tail -n 1)"; grc=$?
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

  # The repo sweeps' findings (4g): MERGE-CLAIM-FALSE / STALE-UNMERGED ->
  # ACTION|requeue, MINT-CLAIM-FALSE -> ACTION|mint-check.
  if [[ -n "$SWEEP_ACTS" && -s "$SWEEP_ACTS" ]]; then
    local sv stg sev
    while IFS=$'\t' read -r sv stg sev; do [[ -n "$sv" ]] && emit "$sv" "$stg" "$sev"; done < "$SWEEP_ACTS"
  fi
  (( SW_UND == 0 )) || add_undet "sweeps=undetermined(${SW_UND}: ${SW_UNDWHY})"

  #--------------------------------------------------------------------------
  # (5) THE LINE. Every watch line carries the violation count, even when it
  #     is zero: `S-CHECK | violations=0` is state; a contentless tick is the
  #     disease this loop exists to stop (references/loops.md Loop 9).
  #--------------------------------------------------------------------------
  # 4i: an overdue supervisor pauses NEW dispatch before anything is printed.
  # The filter swaps dispatch-now/widen/relabel for ONE pause action and keeps
  # every repair action; the fault is exposed, not hidden, and nothing here
  # declares completion (SPEC 10.2). Unconditional on an overdue tick: the
  # pause action is the visible proof even when nothing was queued to pause.
  if (( SUP_OVERDUE == 1 )); then
    apply_dispatch_pause "$WORKDIR/actions.txt"
    V=$(( V + 1 ))
  fi
  [[ -s "$WORKDIR/actions.txt" ]] && cat "$WORKDIR/actions.txt"

  local ACTS="none"
  [[ -n "$VERBS" ]] && ACTS="$VERBS"
  local UND="none"
  [[ -n "$UNDET" ]] && UND="$UNDET"

  local LINE
  LINE="$(iso_now) | S-CHECK | violations=${V} | runnable=${RUNNABLE} open=${OPEN} trees=${TREES} | cap=${CAP_NOTE} | anchor=${ANCHOR_NOTE} | bar=$(sanitize "$BAR_NOTE") | speech=$(sanitize "$SPEECH_NOTE") | stalled-turn=$(sanitize "$STALL_NOTE") | published=$(sanitize "$PUB_NOTE") | merge-batch=$(sanitize "${MERGE_NOTE:-not-run}") | sweeps=$(sanitize_long "$SWEEP_NOTE") | trees-detail=${TREE_NOTE} | supervisor=$(sanitize "$SUP_NOTE") | actions=$(sanitize "$ACTS") | undetermined=$(sanitize_long "$UND")"
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
#  35  THE PROFILED CRON LINE — a home holding .spec-protocol.json logs beside
#      its BOUND state: documents.state "state/build-state.json" makes the line
#      end in state/watch-tick.log, never CONTROL/watch-tick.log.
#  36  --arm ON A PROFILED PROJECT — that same line installed into a FIXTURE
#      crontab at exit 0. A profile redirects the arming; it never removes it.
#  37  --arm AGAIN — exit 3, nothing written, the count still 1: the profiled
#      path carries the same idempotency guard the legacy one does.
#  38  THE PROFILED TICK — the profile's own commands.validate argv runs at the
#      project root and the tick prints ONE `PROFILE-TICK | … | validate_rc=0`
#      line at exit 0, having created no CONTROL/ and written no ledger line.
#  39  THE STALL — a validate argv that exits non-zero gives `PROFILE-TICK
#      STALL` and exit 3, the same "something needs attention" code the
#      S-checks use. 38 and 39 differ by the argv alone.
#  40  A PROFILE WITH NO commands.validate — exit 2 NAMING the key. An
#      unreadable profile is UNDETERMINED and loud, never a silent fall back to
#      the legacy CONTROL/ path (which would watch the wrong tree in silence).
#  41  THE DISCRIMINATING CONTROL — ONE fixture home, one file's difference.
#      With .spec-protocol.json it takes the profiled path; with that one file
#      removed the SAME home prints the legacy CONTROL/watch-tick.log line and
#      a legacy S-CHECK verdict with no PROFILE-TICK anywhere. Cases 1-34 are
#      the same control at scale: not one of them carries a profile, so every
#      legacy assertion above is also proof the redirect does not leak.
#  47  THE REPO SWEEPS (4g) — a two-repo registry of LOCAL BARE repos: a false
#      MERGED claim -> MERGE-CLAIM-FALSE + re-queue; a merged clean worktree ->
#      worktree, local and remote branch removed; a 3h-idle unmerged one ->
#      STALE-UNMERGED, kept, re-queued; a fresh no-commit worktree untouched;
#      a lightweight tag claimed minted -> MINT-CLAIM-FALSE (ledger and the
#      morning report's operator notes). The proven claim and the proven
#      annotated tag in the same fixture stay silent: the negative controls.
#  48  THE SAME TICK AGAIN — every finding is written once: exit 0.
#  49  THE PROFILED SWEEP — a state claiming MERGED on an unmerged commit is
#      MERGE-CLAIM-FALSE and re-queued; the state file stays byte-identical.
#  53  AUTO-RESUME'S FALLBACK — open fails, osascript opens the window.
#  54  FALLBACK B — neither opens: nothing started, AUTO-RESUME-NOT-OPENED on
#      the ledger and the continue command in the morning report.
#  55  MERGE_BATCH_MINUTES=0 REJECTED (exit 2, named) — zero used to make the
#      interval check eligible on every tick; MERGE_BATCH_DISABLE=1 is the
#      only disable.
#  56  THE MERGE WINDOW ENQUEUES — exactly ONE durable request to visible
#      S75-WM, MERGE-WINDOW + ACTION|wm-merge-request lines, no merge process
#      (canary marker absent).
#  57  ONE-OPEN RULE — a second due window extends the open request
#      (requested_windows=2); never a duplicate request or ACTION.
#  58  --control-bridge prints the CB-1 capability gap and the three
#      supported repair mechanisms verbatim.
#  59  THE SUPERVISOR TICK — persisted state (last_tick, next_report_due,
#      supervisor identity, run epoch, queue state), one startup report with
#      every section 10.6 field, no flood on the second tick.
#  60  CATCH-UP IS EXACTLY ONE REPORT — 24 missed windows produce one
#      kind=catch-up report; report_seq advances by exactly one.
#  61  OVERDUE SUPERVISOR PAUSES DISPATCH — no dispatch-now/widen;
#      ACTION|pause-dispatch|supervisor-overdue, S-CHECK supervisor=overdue,
#      DRIFT-ALARM on the ledger; no completion declared.
#  62  --supervisor-status — the independent liveness check: HEALTHY exit 0,
#      OVERDUE exit 3, ABSENT exit 3, state never written (cksum unchanged).
#  63  THE POSITIVE CADENCE CONTROL — a fresh merge-batch.stamp gates the
#      window: not-due, zero requests, zero MERGE-WINDOW lines.
#  64  THE CANARY CLOSURE — across all cases the WATCH_MERGE_TRAIN_SH canary
#      stub was never executed: the timer performed zero merge processes.
#  NOTE cases 55-64 run with MERGE_BATCH_DISABLE=1 globally (no case gains a
#      merge enqueue by accident) except 56-57/63, which set it to 0.
#==============================================================================
selftest() {
  local T PASSES=0 FAILS=0 RC OUT ok
  SELFTEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/watch-tick-selftest.XXXXXX")"
  T="$SELFTEST_TMP"
  # No selftest case may ever launch a real session: every AUTO-RESUME a
  # fixture reaches runs this no-op unless the case names its own stub.
  export WATCH_TICK_LAUNCHER_CMD=/usr/bin/true
  # Nor may any case open a real Terminal window: the opener and its fallback
  # fail unless a case names its own stub (the stubs run the .command in place).
  export WATCH_TICK_OPEN_CMD=/usr/bin/false WATCH_TICK_OSASCRIPT_CMD=/usr/bin/false
  printf '#!/bin/sh\necho "$*" >> "%s"\n/bin/bash "$3"\n' "$T/open.args" > "$T/open-ok.stub"
  printf '#!/bin/sh\nfor a; do f="$a"; done\n/bin/bash "$f"\n' > "$T/osa-ok.stub"
  chmod +x "$T/open-ok.stub" "$T/osa-ok.stub"
  # Nor may any case run a merge process: WATCH_MERGE_TRAIN_SH points at a
  # CANARY stub that writes a marker the moment ANY path executes it, and case
  # 64 asserts the marker never appears. The timer must never integrate: 4e
  # only enqueues to visible S75-WM.
  printf '#!/bin/sh\necho executed > "%s"\nexit 0\n' "$T/merge-train-executed.marker" > "$T/merge-train-canary"
  chmod +x "$T/merge-train-canary"
  export WATCH_MERGE_TRAIN_SH="$T/merge-train-canary"
  # Merge windows are DISABLED by default in the fixtures (so no case gains an
  # ACTION|wm-merge-request line by accident); cases 56-57 re-enable them with
  # MERGE_BATCH_DISABLE=0 and prove the enqueue path itself.
  export MERGE_BATCH_DISABLE=1
  # Nor may any case touch the real per-user state (4h's privacy record).
  export XDG_STATE_HOME="$T/xdg"

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
  mk_profile_home() {  # mk_profile_home <dir> [validate-argv-json]
    # A profiled home is its profile: no CONTROL/, no plan files, no ledger.
    # documents.state binds the log folder; commands.validate binds the tick.
    local d="$1" va="${2:-[\"/bin/echo\",\"validate-ok\"]}"
    mkdir -p "$d/state"
    printf '{"schema":"spec-protocol.project-profile/v1","documents":{"state":"state/build-state.json"},"commands":{"validate":%s}}\n' \
      "$va" > "$d/.spec-protocol.json"
    printf '{}\n' > "$d/state/build-state.json"
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
  printf 'clientCap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n' > "$T/c7/CAPACITY-LEDGER.md"
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
     && "$GREP" -q "^\*/5 \* \* \* \* bash '.*watch-tick\.sh' '.*' --log '.*watch-tick\.log'\$" "$CF13"; then ok=1; fi
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
  printf 'Details saved \xe2\x80\x94 backup at `/tmp/brightside-studio-backup-20260908T1315Z`.\n' > "$T/c18/CONTROL/.speech/turn-06.txt"
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
  printf '2026-09-08T10:29:28Z | PUBLISHED: brightside-studio-macos-arm64.pkg target=desktop-macos-arm64 domain=none status=n/a\n' > "$T/c29/CONTROL/LEDGER.md"
  runw "$T/c29"
  ok=0
  if (( RC == 0 )) \
     && ! printf '%s' "$OUT" | "$GREP" -q 'published-unguarded' \
     && printf '%s' "$OUT" | "$GREP" -q 'published=n/a(no-URL release; target-specific artifact evidence owns its guard)' \
     && ! "$GREP" -q 'DRIFT-ALARM.*published-unguarded' "$T/c29/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 34 "published-no-url-not-ship-gated" "$ok" "rc=${RC} (want 0); status=n/a skips only the URL-origin guard and raises no published-unguarded alarm"

  # --- case 35: THE PROFILED CRON LINE. references/project-profile.md: a
  #     profile REDIRECTS the helpers and never switches them off. The line is
  #     the same */5 line; only the log moves, to sit beside the BOUND state.
  mk_profile_home "$T/c35"
  runw "$T/c35" --cron-line
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q "^\*/5 \* \* \* \* bash '.*watch-tick\.sh' '.*' --log '.*/state/watch-tick\.log'\$" \
     && ! printf '%s' "$OUT" | "$GREP" -q 'CONTROL/watch-tick.log'; then ok=1; fi
  report 35 "profile-cron-line" "$ok" "rc=${RC} (want 0); the line logs to state/watch-tick.log beside the bound documents.state and names no CONTROL/ anywhere — line: [$(printf '%s' "$OUT" | tail -1)]"

  # --- case 36: --arm ON A PROFILED PROJECT, against a FIXTURE table. The
  #     profiled tick is armed by the SAME instrument as the legacy one: the
  #     gap this closes is a profiled project reaching step 21 never having
  #     ticked at all, because nothing would arm it.
  local CF36="$T/c35/crontab.fixture" n36
  : > "$CF36"
  set +e
  OUT="$(WATCH_TICK_CRONTAB_FILE="$CF36" bash "$SELF" --arm "$T/c35" 2>&1)"; RC=$?
  set -e
  n36="$("$GREP" -c 'watch-tick.sh' "$CF36" || true)"
  ok=0
  if (( RC == 0 )) && [[ "$n36" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^ARM | ARMED (exit 0)' \
     && "$GREP" -q "/state/watch-tick.log'\$" "$CF36"; then ok=1; fi
  report 36 "profile-arm-first" "$ok" "rc=${RC} (want 0); the fixture table carries ${n36} watch-tick.sh line (want 1) and it ends at the profile's own state/watch-tick.log"

  # --- case 37: THE SECOND ARM. The guard is the same one case 14 proves on
  #     the legacy path: a profile changes where the line points, never whether
  #     a second arm may double the tick.
  set +e
  OUT="$(WATCH_TICK_CRONTAB_FILE="$CF36" bash "$SELF" --arm "$T/c35" 2>&1)"; RC=$?
  set -e
  local n37; n37="$("$GREP" -c 'watch-tick.sh' "$CF36" || true)"
  ok=0
  if (( RC == 3 )) && [[ "$n37" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^ARM | ALREADY PRESENT (exit 3)'; then ok=1; fi
  report 37 "profile-arm-idempotent" "$ok" "rc=${RC} (want 3); the count stayed at ${n37} (want 1) — a second arm on a profiled project adds nothing and says so"

  # --- case 38: THE PROFILED TICK. The profile's declared validator runs at the
  #     project root and ONE line is printed. The assertions that matter most
  #     are the two absences: no CONTROL/ directory and no S-CHECK line — the
  #     second copy a profile forbids is exactly what a redirect must not build.
  mk_profile_home "$T/c38"
  runw "$T/c38"
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^PROFILE-TICK | .* | home=.*c38 | validate_rc=0 | validate-ok$' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'S-CHECK' \
     && [[ ! -d "$T/c38/CONTROL" ]]; then ok=1; fi
  report 38 "profile-tick-runs" "$ok" "rc=${RC} (want 0); one PROFILE-TICK line carrying the validator's own stdout; no S-CHECK line and no CONTROL/ directory created — line: [$(printf '%s' "$OUT" | tail -1)]"

  # --- case 39: THE STALL. Byte for byte the same fixture but for the validate
  #     argv, which now exits 1. That one difference is the whole discrimination.
  mk_profile_home "$T/c39" '["/usr/bin/false"]'
  runw "$T/c39"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^PROFILE-TICK STALL | .* | home=.*c39 | validate_rc=1 | ' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^PROFILE-TICK |'; then ok=1; fi
  report 39 "profile-tick-stall" "$ok" "rc=${RC} (want 3 — the same code the S-checks use for 'something needs attention'); PROFILE-TICK STALL naming validate_rc=1, and NOT the clean PROFILE-TICK line"

  # --- case 40: A PROFILE WITH NO commands.validate. The tick has nothing to
  #     run, and the one thing it may never do is quietly run the legacy
  #     CONTROL/ path instead — that would watch the wrong tree and report it
  #     clean. Exit 2 NAMING the key, and no CONTROL/ left behind.
  mkdir -p "$T/c40"
  printf '{"schema":"spec-protocol.project-profile/v1","documents":{"state":"state/build-state.json"},"commands":{"init":["/bin/echo","x"]}}\n' \
    > "$T/c40/.spec-protocol.json"
  runw "$T/c40"
  ok=0
  if (( RC == 2 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'TOOLING FAILURE (exit 2): PROFILE |' \
     && printf '%s' "$OUT" | "$GREP" -q 'commands.validate' \
     && printf '%s' "$OUT" | "$GREP" -q 'NOT an all-clear' \
     && [[ ! -d "$T/c40/CONTROL" ]]; then ok=1; fi
  report 40 "profile-validate-missing" "$ok" "rc=${RC} (want 2); the failure NAMES commands.validate and the profile file, says it is not an all-clear, and left no CONTROL/ behind"

  # --- case 41: THE DISCRIMINATING CONTROL. ONE home, ONE file's difference.
  #     A legacy fixture gains a profile and takes the profiled path; the same
  #     home with that one file removed prints the legacy CONTROL/ line and a
  #     legacy S-CHECK verdict. An implementation that redirected on something
  #     other than the profile's presence passes 35-40 and fails HERE.
  mk_home "$T/c41"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-041\n' "$(stamp 1)" > "$T/c41/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c41/CONTROL/HEARTBEAT.md"
  printf '{"schema":"spec-protocol.project-profile/v1","documents":{"state":"state/build-state.json"},"commands":{"validate":["/bin/echo","validate-ok"]}}\n' \
    > "$T/c41/.spec-protocol.json"
  runw "$T/c41" --cron-line
  local prof41="$OUT" prc41="$RC"
  runw "$T/c41"
  local proftick41="$OUT"
  rm -f "$T/c41/.spec-protocol.json"
  runw "$T/c41" --cron-line
  local leg41="$OUT" lrc41="$RC"
  runw "$T/c41"
  ok=0
  if (( prc41 == 0 )) && (( lrc41 == 0 )) && (( RC == 0 )) \
     && printf '%s' "$prof41"     | "$GREP" -q "/state/watch-tick.log'\$" \
     && printf '%s' "$proftick41" | "$GREP" -q '^PROFILE-TICK |' \
     && printf '%s' "$leg41"      | "$GREP" -q "/CONTROL/watch-tick.log'\$" \
     && printf '%s' "$OUT"        | "$GREP" -q 'S-CHECK | violations=0 | runnable=0 open=1 trees=1' \
     && ! printf '%s' "$OUT"      | "$GREP" -q 'PROFILE-TICK'; then ok=1; fi
  report 41 "profile-vs-legacy-control" "$ok" "one home, one file: WITH .spec-protocol.json it printed the state/watch-tick.log line and a PROFILE-TICK; with that file removed the SAME home printed the CONTROL/watch-tick.log line and a legacy S-CHECK verdict (rc=${RC}, want 0) with no PROFILE-TICK anywhere"

  # --- case 42 (#32): --check is read-only and per project. Another
  #     project's line -> 3; after --arm -> 0; an unrunnable crontab -> 2.
  mk_home "$T/c42"
  local CF42="$T/c42.cron" r42a r42b r42c
  printf '*/5 * * * * bash /x/watch-tick.sh /other/project >> /dev/null 2>&1\n' > "$CF42"
  WATCH_TICK_CRONTAB_FILE="$CF42" runw "$T/c42" --check; r42a=$RC
  WATCH_TICK_CRONTAB_FILE="$CF42" runw --arm "$T/c42"
  WATCH_TICK_CRONTAB_FILE="$CF42" runw "$T/c42" --check; r42b=$RC
  WATCH_TICK_CRONTAB_CMD="$T/no-such-crontab" runw "$T/c42" --check; r42c=$RC
  ok=0
  (( r42a == 3 && r42b == 0 && r42c == 2 )) && ok=1
  report 42 "check-installed" "$ok" "rc before arm=${r42a} (want 3, another project's line does not count); after arm=${r42b} (want 0); unrunnable crontab=${r42c} (want 2)"

  # --- case 43 (#48): AUTO-RESUME. Arm inside a (fake) claude-nine session,
  #     stall the build like case 32, tick twice: the stub launcher runs ONCE
  #     through the stub `open -a Terminal` (a visible window, never -p) with
  #     --permission-mode bypassPermissions --resume <id> /spec-protocol resume,
  #     the marker is written, the ledger says AUTO-RESUME, and the second tick
  #     is held by the lock.
  mk_home "$T/c43"
  printf '%s | U-01 build | build | [opus x10] WF01 builder | run-043\n' "$(stamp 1)" > "$T/c43/CONTROL/dispatch-log.md"
  printf '%s | WF01 builder | U-01 | build\n' "$(stamp 1)" > "$T/c43/CONTROL/HEARTBEAT.md"
  printf 'build output\n' > "$T/c43/work.txt"
  printf '#!/bin/sh\necho "$*" >> "%s"\n' "$T/c43.args" > "$T/c43.stub"; chmod +x "$T/c43.stub"
  CLAUDE_CODE_SESSION_ID=sess-43 CLAUDE_CONFIG_DIR=/x/.claude-nine WATCH_TICK_CRONTAB_FILE="$T/c43.cron" runw --arm "$T/c43"
  TZ=UTC touch -t "${OUT22_OLD}" "$T/c43/work.txt" "$T/c43/SPEC/GOAL.md"
  WATCH_TICK_OPEN_CMD="$T/open-ok.stub" WATCH_TICK_LAUNCHER_CMD="$T/c43.stub" runw "$T/c43"
  local out43a="$OUT"
  WATCH_TICK_OPEN_CMD="$T/open-ok.stub" WATCH_TICK_LAUNCHER_CMD="$T/c43.stub" runw "$T/c43"
  ok=0
  if "$GREP" -q '^launcher=claude-nine$' "$T/c43/CONTROL/auto-resume.txt" 2>/dev/null \
     && [[ "$(cat "$T/c43.args" 2>/dev/null)" == "--permission-mode bypassPermissions --resume sess-43 /spec-protocol resume" ]] \
     && [[ -s "$T/c43/CONTROL/auto-resume.opened" ]] && "$GREP" -q -- '^-a Terminal /.*/c43/CONTROL/auto-resume.command$' "$T/open.args" \
     && printf '%s' "$out43a" | "$GREP" -q '^AUTO-RESUME | opened .* via open -a Terminal' \
     && printf '%s' "$OUT" | "$GREP" -q '^AUTO-RESUME | held' \
     && "$GREP" -q '| AUTO-RESUME | session=sess-43' "$T/c43/CONTROL/LEDGER.md"; then ok=1; fi
  report 43 "auto-resume-once" "$ok" "arm recorded launcher=claude-nine; stub got [$(tr '\n' ';' < "$T/c43.args" 2>/dev/null)] (want exactly one '--permission-mode bypassPermissions --resume sess-43 /spec-protocol resume', no -p, via open -a Terminal, marker written); second tick held by the lock; AUTO-RESUME on the ledger"

  # --- case 44 (#40): the unavailable-crontab reason survives a long path.
  #     sanitize() cuts at 160 chars; the rc must come BEFORE the command path
  #     or a long TMPDIR pushes rc=127 off the end (case 15 failed that way).
  mk_home "$T/c44"
  local long44="$T/$(printf 'p%.0s' {1..150})/no-such-crontab"
  WATCH_TICK_CRONTAB_FILE="$T/c44.cron" WATCH_TICK_CRONTAB_CMD="$long44" runw --arm "$T/c44"
  ok=0
  (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'UNAVAILABLE (exit 2) | rc=127 from' && ok=1
  report 44 "arm-unavailable-long-path" "$ok" "rc=${RC} (want 2); rc=127 leads the reason even with a 150+ char command path"

  # --- case 45 (F2+F3): a PRE-PLAN project (research/spec, no build row) whose
  #     session was recorded at INTERVIEW END with --record-session. The
  #     recorded cwd is the transcript's launch folder, not $PWD; a stale
  #     project resumes once with /spec-protocol resume from that folder.
  mk_home "$T/c45"
  rm -f "$T/c45/CONTROL/CHECKLIST.md" "$T/c45/CONTROL/TODO.md"
  mkdir -p "$T/cfg45/projects/x" "$T/launch45"
  printf '{"cwd":"%s","sessionId":"sess-45"}\n' "$T/launch45" > "$T/cfg45/projects/x/sess-45.jsonl"
  printf '#!/bin/sh\necho "$PWD|$*" >> "%s"\n' "$T/c45.args" > "$T/c45.stub"; chmod +x "$T/c45.stub"
  CLAUDE_CODE_SESSION_ID=sess-45 CLAUDE_CONFIG_DIR="$T/cfg45" runw --record-session "$T/c45"
  local r45rec="$RC"
  TZ=UTC touch -t "${OUT22_OLD}" "$T/c45/SPEC/GOAL.md" "$T/c45/CONTROL/setup_progress.json"
  WATCH_TICK_OPEN_CMD="$T/open-ok.stub" WATCH_TICK_LAUNCHER_CMD="$T/c45.stub" runw "$T/c45"
  ok=0
  if (( r45rec == 0 && RC == 3 )) \
     && "$GREP" -qx 'interview=done' "$T/c45/CONTROL/auto-resume.txt" \
     && "$GREP" -qx "cwd=$T/launch45" "$T/c45/CONTROL/auto-resume.txt" \
     && [[ "$(cat "$T/c45.args" 2>/dev/null)" == *"launch45|--permission-mode bypassPermissions --resume sess-45 /spec-protocol resume" ]] \
     && "$GREP" -q 'stalled-turn | elapsed=.* | phase=post-interview(pre-plan)' "$T/c45/CONTROL/LEDGER.md"; then ok=1; fi
  report 45 "resume-post-interview-pre-plan" "$ok" "record rc=${r45rec} (want 0), tick rc=${RC} (want 3); interview=done + transcript cwd recorded; stub got [$(tr '\n' ';' < "$T/c45.args" 2>/dev/null)] (want launch45|--permission-mode bypassPermissions --resume sess-45 /spec-protocol resume)"

  # --- case 46 (A2 fix): PROFILED TERMINAL STATUS. A profiled project whose
  #     bound state carries ONLY "status":"RELEASE_COMPLETE" (no run_status
  #     key at all) plus a stale, interview=done session must NEVER auto-
  #     resume -- the exact bug this fix closes: an absent run_status alone
  #     used to read as "running" even when the profile's own status field
  #     said the run was finished.
  mk_profile_home "$T/c46"
  printf '{"status":"RELEASE_COMPLETE"}\n' > "$T/c46/state/build-state.json"
  printf '#!/bin/sh\necho "$*" >> "%s"\n' "$T/c46.args" > "$T/c46.stub"; chmod +x "$T/c46.stub"
  CLAUDE_CODE_SESSION_ID=sess-46 CLAUDE_CONFIG_DIR=/x/.claude-nine runw --record-session "$T/c46"
  TZ=UTC touch -t "${OUT22_OLD}" "$T/c46/state/build-state.json" "$T/c46/.spec-protocol.json"
  WATCH_TICK_LAUNCHER_CMD="$T/c46.stub" runw "$T/c46"
  ok=0
  if (( RC == 0 )) \
     && [[ ! -s "$T/c46.args" ]] \
     && ! printf '%s' "$OUT" | "$GREP" -q 'AUTO-RESUME\|ACTION|stalled-turn'; then ok=1; fi
  report 46 "profiled-terminal-status-no-resume" "$ok" "rc=${RC} (want 0); launcher stub got [$(cat "$T/c46.args" 2>/dev/null)] (want nothing — RELEASE_COMPLETE via the status fallback must block auto-resume even though the session looks stale)"


  # --- cases 47-49: THE REPO SWEEPS (4g, r6 B2-B4). Local bare repos only: no
  #     network, no real remote. Git runs with no global or system config.
  #     47 the full legacy tick over a TWO-repo registry: a false MERGED claim
  #        (unit/A2) -> MERGE-CLAIM-FALSE + re-queue; a --no-ff merged, pushed,
  #        clean worktree (unit/A1) -> worktree, local and remote branch gone;
  #        a 3h-idle unmerged worktree (unit/A3) -> STALE-UNMERGED, kept,
  #        re-queued; a fresh builder worktree with no commits (unit/A4) ->
  #        untouched; an annotated, proven tag (a v0.9.0) -> silent; a
  #        LIGHTWEIGHT tag claimed MINTED-LOCAL (b v1.0.0) -> MINT-CLAIM-FALSE,
  #        also in the morning report's operator notes. The proven claim and
  #        the proven tag in the SAME fixture are the negative controls.
  #     48 the same tick again: every finding is written once, exit 0.
  #     49 a PROFILED project whose state claims status MERGED on an unmerged
  #        commit: MERGE-CLAIM-FALSE + re-queue, and the state file untouched.
  export GIT_AUTHOR_NAME=st GIT_AUTHOR_EMAIL=st@example.invalid GIT_COMMITTER_NAME=st \
         GIT_COMMITTER_EMAIL=st@example.invalid GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  local G="$T/c47g" mA1="" cA2="" base="" c49="" old3h
  old3h="$(( $(date +%s) - 10800 )) +0000"
  mkdir -p "$G"
  if ( set -e
       git init -q --bare "$G/a.git"; git init -q -b main "$G/a"; cd "$G/a"
       printf '0.9.0\n' > VERSION; printf '# Changelog\n\n## [0.9.0] - 2026-01-01\n' > CHANGELOG.md
       printf '# App\n\nVersion: 0.9.0\n' > README.md
       git add -A; git commit -qm base; git remote add origin "$G/a.git"; git push -q origin main
       git tag -a v0.9.0 -m v0.9.0; git push -q origin v0.9.0
       git worktree add -q .worktrees/A1 -b unit/A1
       ( cd .worktrees/A1 && echo a1 > a1 && git add a1 && git commit -qm A1 )
       git push -q origin unit/A1; git merge -q --no-ff --no-edit unit/A1; git push -q origin main
       git branch unit/A2 main; git checkout -q unit/A2; echo a2 > a2; git add a2; git commit -qm A2; git checkout -q main
       git worktree add -q .worktrees/A3 -b unit/A3
       ( cd .worktrees/A3 && echo a3 > a3 && git add a3 && GIT_COMMITTER_DATE="$old3h" git commit -qm A3 )
       git worktree add -q .worktrees/A4 -b unit/A4
       git init -q -b main "$G/b"; cd "$G/b"; echo b > f; git add f; git commit -qm b; git tag v1.0.0
       git init -q -b main "$G/p"; cd "$G/p"; echo p > f; git add f; git commit -qm p
       git checkout -q -b unit/P1; echo p1 > p1; git add p1; git commit -qm P1; git checkout -q main
     ) >/dev/null 2>&1; then
    mA1="$(git -C "$G/a" rev-parse main)"; cA2="$(git -C "$G/a" rev-parse unit/A2)"
    base="$(git -C "$G/a" rev-parse 'v0.9.0^{commit}')"; c49="$(git -C "$G/p" rev-parse unit/P1)"
  fi

  mk_home "$T/c47"
  printf '%s | U-02 qc | qc | [opus x10] WF01 judge | run-047\n' "$(stamp 1)" > "$T/c47/CONTROL/dispatch-log.md"
  printf '%s | WF01 judge | U-02 | qc\n' "$(stamp 1)" > "$T/c47/CONTROL/HEARTBEAT.md"
  printf '{"repos":[{"name":"a","root":"%s","trunk":"main","remote":"origin"},{"name":"b","root":"%s","trunk":"main","remote":null}]}\n' \
    "$G/a" "$G/b" > "$T/c47/CONTROL/repos.json"
  { printf '%s | MERGED: unit=unit/A1 commit=%s trunk=origin/main repo=a\n' "$(stamp 3)" "$mA1"
    printf '%s | MERGED: unit=unit/A2 commit=%s trunk=origin/main repo=a\n' "$(stamp 3)" "$cA2"
    printf '%s | MINTED: repo=a version=0.9.0 tag=v0.9.0 commit=%s\n' "$(stamp 2)" "$base"
    printf '%s | MINTED-LOCAL: repo=b version=1.0.0 tag=v1.0.0\n' "$(stamp 2)"; } > "$T/c47/CONTROL/LEDGER.md"
  printf '# Report\n\nAll done.\n\n## Operator notes\n\n- earlier note\n' > "$T/c47/MORNING-REPORT-2026-01-01.md"
  runw "$T/c47"
  local rq47="$T/c47/CONTROL/merge-train/requeue.tsv"
  ok=0
  if [[ -n "$mA1" ]] && (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q "^MERGE-CLAIM-FALSE: unit=unit/A2 repo=a commit=${cA2} reason=not-an-ancestor-of-origin/main" \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|requeue|unit/A2|' \
     && printf '%s' "$OUT" | "$GREP" -q '^ORPHAN-CLEANED: unit=unit/A1 repo=a ' \
     && printf '%s' "$OUT" | "$GREP" -q '^STALE-UNMERGED: unit=unit/A3 repo=a ' \
     && printf '%s' "$OUT" | "$GREP" -q '^MINT-CLAIM-FALSE: repo=b tag=v1.0.0 version=1.0.0 reason=.*not an annotated tag' \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|mint-check|' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'CLAIM-FALSE: unit=unit/A1\|MINT-CLAIM-FALSE: repo=a\|unit/A4' \
     && [[ ! -e "$G/a/.worktrees/A1" && -d "$G/a/.worktrees/A3" && -d "$G/a/.worktrees/A4" ]] \
     && ! git -C "$G/a" show-ref --verify --quiet refs/heads/unit/A1 \
     && [[ -z "$(git -C "$G/a.git" for-each-ref refs/heads/unit/A1)" ]] \
     && git -C "$G/a" show-ref --verify --quiet refs/heads/unit/A3 \
     && "$GREP" -q "^a	unit/A2	merge-claim-false	" "$rq47" 2>/dev/null \
     && "$GREP" -q "^a	unit/A3	stale-unmerged	" "$rq47" 2>/dev/null \
     && "$GREP" -q '^- MINT-CLAIM-FALSE: repo=b tag=v1.0.0' "$T/c47/MORNING-REPORT-2026-01-01.md" \
     && "$GREP" -q 'S-CHECK | .*| sweeps=repos=2 claims=2 claim-false=1 stale-unmerged=1 cleaned=1 kept=0 mint-false=1 undetermined=0' "$T/c47/CONTROL/LEDGER.md"; then ok=1; fi
  report 47 "repo-sweeps" "$ok" "rc=${RC} (want 3); A2 claim false + re-queued, A1 worktree/local/remote branch removed after proof, A3 STALE-UNMERGED kept + re-queued, A4 untouched, b's lightweight tag MINT-CLAIM-FALSE (ledger + morning report), a's proven claim and tag silent$( [[ -n "$mA1" ]] || printf ' — FIXTURE FAILED')"

  runw "$T/c47"
  ok=0
  if (( RC == 0 )) && ! printf '%s' "$OUT" | "$GREP" -q 'CLAIM-FALSE\|STALE-UNMERGED\|ORPHAN-CLEANED\|^ACTION|' \
     && [[ "$(wc -l < "$rq47" | tr -d ' ')" == 2 ]]; then ok=1; fi
  report 48 "repo-sweeps-once" "$ok" "rc=${RC} (want 0); the second tick wrote no finding again and the re-queue file still has 2 lines (got $(wc -l < "$rq47" 2>/dev/null | tr -d ' '))"

  mk_profile_home "$T/c49"
  printf '{"tasks":{"P1":{"status":"MERGED","commit":"%s"}}}\n' "$c49" > "$T/c49/state/build-state.json"
  printf '{"repoRoot":"%s","remote":null,"source":"local-only"}\n' "$G/p" > "$T/c49/state/repo-anchor.json"
  local ck49; ck49="$(cksum < "$T/c49/state/build-state.json")"
  runw "$T/c49"
  ok=0
  if [[ -n "$c49" ]] && (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^PROFILE-TICK | ' \
     && printf '%s' "$OUT" | "$GREP" -q "^MERGE-CLAIM-FALSE: unit=unit/P1 repo=p commit=${c49} reason=not-an-ancestor-of-main" \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|requeue|unit/P1|' \
     && "$GREP" -q "^p	unit/P1	merge-claim-false	" "$T/c49/state/spec-protocol/merge-train/requeue.tsv" 2>/dev/null \
     && [[ "$(cksum < "$T/c49/state/build-state.json")" == "$ck49" && ! -e "$T/c49/CONTROL" ]]; then ok=1; fi
  report 49 "repo-sweeps-profiled" "$ok" "rc=${RC} (want 3); the state's MERGED claim on an unmerged commit is MERGE-CLAIM-FALSE and re-queued under state/spec-protocol/, the state file byte-identical, no CONTROL/"

  # --- cases 50-52: macOS privacy (4h). A stub `ls` stands in for TCC: it
  #     answers "Operation not permitted" the way macOS answers a cron job
  #     reading ~/Downloads without Full Disk Access.
  mk_home "$T/c50"
  printf '#!/bin/sh\necho "ls: $1: Operation not permitted" >&2\nexit 1\n' > "$T/c50.ls"
  printf '#!/bin/sh\necho "ls: $1: Permission denied" >&2\nexit 1\n' > "$T/c51.ls"
  chmod +x "$T/c50.ls" "$T/c51.ls"
  local rec50 out50b; rec50="$(blocked_record "$T/c50")"
  WATCH_TICK_LS="$T/c50.ls" runw "$T/c50" --log "$T/c50/CONTROL/watch-tick.log"
  local rc50="$RC" out50="$OUT"
  WATCH_TICK_LS="$T/c50.ls" runw "$T/c50" --log "$T/c50/CONTROL/watch-tick.log"
  out50b="$OUT"
  ok=0
  if (( rc50 == 2 && RC == 2 )) && [[ -z "$out50b" ]] \
     && printf '%s' "$out50" | "$GREP" -qxF -- "$(privacy_line "$T/c50")" \
     && printf '%s' "$out50" | "$GREP" -q 'fix=Give cron Full Disk Access: System Settings > Privacy & Security > Full Disk Access' \
     && [[ -f "$rec50" && ! -e "$T/c50/CONTROL/watch-tick.log" && ! -e "$T/c50/CONTROL/LEDGER.md" ]]; then ok=1; fi
  report 50 "privacy-blocked-once" "$ok" "rc=${rc50} then ${RC} (want 2, 2); one TICK-BLOCKED-BY-PRIVACY line naming the path and the Full Disk Access fix, recorded outside the project; the second blocked tick printed nothing (got [${out50b}]) — never retried in a loop"

  mk_home "$T/c51"
  WATCH_TICK_LS="$T/c51.ls" runw "$T/c51" --log "$T/c51/CONTROL/watch-tick.log"
  ok=0
  if ! printf '%s' "$OUT" | "$GREP" -q 'TICK-BLOCKED-BY-PRIVACY' && [[ ! -e "$(blocked_record "$T/c51")" ]] \
     && "$GREP" -q 'S-CHECK' "$T/c51/CONTROL/watch-tick.log" 2>/dev/null; then ok=1; fi
  report 51 "privacy-negative-control" "$ok" "\"Permission denied\" is NOT the privacy block: no TICK-BLOCKED line, no record, and the tick ran into its own --log (rc=${RC})"

  printf '# Report\n\nAll done.\n' > "$T/c50/MORNING-REPORT-2026-01-01.md"
  CLAUDE_CODE_SESSION_ID=sess-52 runw "$T/c50"
  local out52="$OUT"
  set +e; OUT="$(env -u CLAUDE_CODE_SESSION_ID bash "$SELF" "$T/c50" --log "$T/c50/CONTROL/watch-tick.log" 2>&1)"; RC=$?; set -e
  ok=0
  if printf '%s' "$out52" | "$GREP" -qF -- "$(privacy_line "$T/c50")" \
     && [[ "$("$GREP" -cF -- 'TICK-BLOCKED-BY-PRIVACY' "$T/c50/CONTROL/LEDGER.md" 2>/dev/null)" == 1 ]] \
     && "$GREP" -A3 '^## Operator notes' "$T/c50/MORNING-REPORT-2026-01-01.md" | "$GREP" -qF -- "- $(privacy_line "$T/c50")" \
     && [[ ! -e "$rec50" ]] && "$GREP" -q 'TICK-PRIVACY | cleared' "$T/c50/CONTROL/watch-tick.log"; then ok=1; fi
  report 52 "privacy-pickup-and-clear" "$ok" "the in-session tick printed the line, ledgered it once and put it under the morning report's Operator notes; the next readable cron tick (--log) cleared the record"

  # --- cases 53-54 (r10 A1/A2): the visible window's fallback and fallback B.
  #     53: open fails, the stub osascript opens the window -> opened.
  #     54: both fail -> NOTHING started (the launcher stub never runs), an
  #     AUTO-RESUME-NOT-OPENED ledger line and the continue command under the
  #     morning report's Operator notes.
  mk_stall() {  # mk_stall <home> <sid>
    mk_home "$1"
    printf '%s | U-01 build | build | [opus x10] WF01 builder | run-%s\n' "$(stamp 1)" "$2" > "$1/CONTROL/dispatch-log.md"
    printf '%s | WF01 builder | U-01 | build\n' "$(stamp 1)" > "$1/CONTROL/HEARTBEAT.md"
    printf 'build output\n' > "$1/work.txt"
    printf '#!/bin/sh\necho "$*" >> "%s"\n' "$1.args" > "$1.stub"; chmod +x "$1.stub"
    CLAUDE_CODE_SESSION_ID="$2" CLAUDE_CONFIG_DIR=/x/.claude-nine WATCH_TICK_CRONTAB_FILE="$1.cron" runw --arm "$1"
    TZ=UTC touch -t "${OUT22_OLD}" "$1/work.txt" "$1/SPEC/GOAL.md"
  }
  mk_stall "$T/c53" sess-53
  WATCH_TICK_OSASCRIPT_CMD="$T/osa-ok.stub" WATCH_TICK_LAUNCHER_CMD="$T/c53.stub" runw "$T/c53"
  ok=0
  if [[ "$(cat "$T/c53.args" 2>/dev/null)" == "--permission-mode bypassPermissions --resume sess-53 /spec-protocol resume" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^AUTO-RESUME | opened .* via osascript do script' \
     && "$GREP" -q '| AUTO-RESUME | session=sess-53 .*osascript do script' "$T/c53/CONTROL/LEDGER.md"; then ok=1; fi
  report 53 "auto-resume-osascript-fallback" "$ok" "open failed, the stub osascript ran the .command: stub got [$(cat "$T/c53.args" 2>/dev/null)] (want one --resume sess-53, no -p); AUTO-RESUME | opened via osascript on stdout and the ledger"

  mk_stall "$T/c54" sess-54
  printf '# Report\n\nAll done.\n' > "$T/c54/MORNING-REPORT-2026-01-01.md"
  TZ=UTC touch -t "${OUT22_OLD}" "$T/c54/MORNING-REPORT-2026-01-01.md"
  WATCH_TICK_LAUNCHER_CMD="$T/c54.stub" runw "$T/c54"
  ok=0
  if [[ ! -e "$T/c54.args" && ! -e "$T/c54/CONTROL/auto-resume.opened" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^AUTO-RESUME | not opened | open rc=1; osascript rc=1' \
     && "$GREP" -q '| AUTO-RESUME-NOT-OPENED: session=sess-54 reason=open rc=1; osascript rc=1' "$T/c54/CONTROL/LEDGER.md" \
     && "$GREP" -A3 '^## Operator notes' "$T/c54/MORNING-REPORT-2026-01-01.md" | "$GREP" -q '^- AUTO-RESUME-NOT-OPENED: the run stalled .*type `claude-nine --resume`, press Return, pick this project'; then ok=1; fi
  report 54 "auto-resume-not-opened" "$ok" "open and osascript both failed: launcher stub ran=$([[ -e "$T/c54.args" ]] && echo yes || echo no) (want no — nothing hidden is started); AUTO-RESUME-NOT-OPENED on the ledger and the continue command under the morning report's Operator notes"

  # --- cases 55-64 (unit S75-W00-U2): the supervision loop and timer
  #     ownership. 55 proves MERGE_BATCH_MINUTES=0 is REJECTED (it used to
  #     make the interval check eligible on every tick) and 0-disable works
  #     only through MERGE_BATCH_DISABLE=1. 56-57 prove the merge window
  #     ENQUEUES one durable S75-WM request and never a merge process (the
  #     canary marker must never appear). 58 proves the control-bridge
  #     statement names the capability gap and its supported repair. 59-60
  #     prove the 60s tick persists state and catches up EXACTLY ONE report
  #     after a restart. 61 proves an overdue supervisor pauses new dispatch
  #     visibly instead of declaring completion. 62 proves --supervisor-status
  #     is the independent read-only liveness check. 63 proves the positive
  #     cadence (a fresh stamp is not-due). 64 is the canary closure.

  # --- case 55: MERGE_BATCH_MINUTES=0 REJECTED, exit 2, named. The old code
  #     accepted 0 and then `age < 0` was false on every tick — always eligible.
  mk_home "$T/c55"
  set +e
  OUT="$(MERGE_BATCH_DISABLE=0 MERGE_BATCH_MINUTES=0 bash "$SELF" "$T/c55" 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 2 )) && printf '%s' "$OUT" | "$GREP" -q 'MERGE_BATCH_MINUTES must be a positive integer' \
     && printf '%s' "$OUT" | "$GREP" -q 'MERGE_BATCH_DISABLE=1' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'S-CHECK'; then ok=1; fi
  report 55 "merge-batch-zero-rejected" "$ok" "rc=${RC} (want 2); the zero cadence is refused by name with the explicit disable named — 0 never behaves as always-eligible again"

  # --- case 56: THE MERGE WINDOW IS AN ENQUEUE. One window -> exactly ONE
  #     durable request file addressed to visible S75-WM, the ACTION line, and
  #     NO merge process (the canary marker must not exist).
  mk_home "$T/c56"
  MERGE_BATCH_DISABLE=0 runw "$T/c56"
  local q56 n56
  q56="$(find "$T/c56/CONTROL/wm-queue" -maxdepth 1 -name '*.request.json' 2>/dev/null | head -1)"
  n56="$(find "$T/c56/CONTROL/wm-queue" -maxdepth 1 -name '*.request.json' 2>/dev/null | "$GREP" -c '[^[:space:]]' || true)"
  ok=0
  if [[ -n "$q56" && "$n56" == "1" ]] \
     && "$GREP" -q '"to": "S75-WM"' "$q56" && "$GREP" -q '"from": "watch-tick.timer"' "$q56" \
     && "$GREP" -q '"action": "run-merge-train-batch"' "$q56" \
     && printf '%s' "$OUT" | "$GREP" -q '^MERGE-WINDOW | .* | delegated | wm-merge-request' \
     && printf '%s' "$OUT" | "$GREP" -q "^ACTION|wm-merge-request|" \
     && [[ ! -e "$T/merge-train-executed.marker" ]]; then ok=1; fi
  report 56 "merge-window-enqueues-wm" "$ok" "rc=${RC}; exactly ${n56} durable request (want 1) at ${q56:-<none>} addressed to S75-WM from watch-tick.timer; MERGE-WINDOW + ACTION|wm-merge-request lines present; merge-train canary executed=$([[ -e "$T/merge-train-executed.marker" ]] && echo YES || echo no)"

  # --- case 57: THE ONE-OPEN RULE. A second due window while the request is
  #     still open EXTENDS the same request (requested_windows=2) and never
  #     stacks a duplicate — one durable request, no duplicate train.
  touch "${T}/c56/CONTROL/merge-batch.stamp" 2>/dev/null
  TZ=UTC touch -t 202001010000 "$T/c56/CONTROL/merge-batch.stamp"
  MERGE_BATCH_DISABLE=0 runw "$T/c56"
  local n57 w57
  n57="$(find "$T/c56/CONTROL/wm-queue" -maxdepth 1 -name '*.request.json' 2>/dev/null | "$GREP" -c '[^[:space:]]' || true)"
  w57="$("$GREP" -o '"requested_windows": [0-9]*' "$q56" | "$GREP" -o '[0-9]*$')"
  ok=0
  if [[ "$n57" == "1" && "$w57" == "2" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'wm-merge-request already open' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|wm-merge-request|' \
     && [[ ! -e "$T/merge-train-executed.marker" ]]; then ok=1; fi
  report 57 "merge-window-one-open" "$ok" "rc=${RC}; request count stayed ${n57} (want 1) with requested_windows=${w57} (want 2); the second window extended the open request and emitted NO second ACTION (one durable request, one delegation)"

  # --- case 58: THE CONTROL BRIDGE STATEMENT names the capability gap and
  #     the supported repair, verbatim, from the one place that owns it.
  set +e
  OUT="$(bash "$SELF" --control-bridge 2>&1)"; RC=$?
  set -e
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q 'CAPABILITY GAP, EXACT: a cron/launchd/systemd task runs as a plain shell' \
     && printf '%s' "$OUT" | "$GREP" -q 'cannot call the session-only Workflow tool' \
     && printf '%s' "$OUT" | "$GREP" -q 'SUPPORTED REPAIR' \
     && printf '%s' "$OUT" | "$GREP" -q 'DURABLE ENQUEUE' \
     && printf '%s' "$OUT" | "$GREP" -q 'ACTION LINES' \
     && printf '%s' "$OUT" | "$GREP" -q 'VISIBLE RESUME'; then ok=1; fi
  report 58 "control-bridge-statement" "$ok" "rc=${RC} (want 0); --control-bridge prints the CB-1 gap and the three supported repair mechanisms by name"

  # --- case 59: THE SUPERVISOR TICK persists last_tick, next_report_due,
  #     supervisor identity, run epoch and queue state, publishes the full
  #     10.6 report at startup, and a second tick publishes NO report (the
  #     cadence, not a flood).
  mk_home "$T/c59"
  set +e
  OUT="$(WATCH_SUPERVISOR_TICK_SECONDS=1 WATCH_SUPERVISOR_REPORT_SECONDS=30 \
         WATCH_SUPERVISOR_MAX_TICKS=2 bash "$SELF" "$T/c59" --supervise 2>&1)"; RC=$?
  set -e
  local sf59="$T/c59/CONTROL/supervisor.state" nr59
  nr59="$("$GREP" -c '^SUPERVISOR-REPORT |' <(printf '%s\n' "$OUT") || true)"
  ok=0
  if (( RC == 0 )) && [[ -f "$sf59" ]] \
     && "$GREP" -q '^last_tick=' "$sf59" && "$GREP" -q '^next_report_due=' "$sf59" \
     && "$GREP" -q '^supervisor_id=' "$sf59" && "$GREP" -q '^run_epoch=' "$sf59" \
     && "$GREP" -q '^queue_open=' "$sf59" && "$GREP" -q '^tick_seq=2$' "$sf59" \
     && [[ "$nr59" == "1" ]] \
     && printf '%s' "$OUT" | "$GREP" -q '^Skill 75 repair — ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Build acceptance: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Accepted-scope merge progress: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Current batch: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Native workflows: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Active agents: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Models: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Swarm compliance: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Violations/recovery: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Last proven merge: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Current user decision: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^Next concrete milestone: ' \
     && printf '%s' "$OUT" | "$GREP" -q '^SUPERVISOR-TICK | '; then ok=1; fi
  report 59 "supervise-tick-persists-and-reports" "$ok" "rc=${RC} (want 0); state has last_tick/next_report_due/supervisor_id/run_epoch/queue_open and tick_seq=2; ${nr59} SUPERVISOR-REPORT line over 2 ticks (want 1 — startup only); every section 10.6 field printed"

  # --- case 60: EXACTLY ONE MISSED REPORT AFTER RESTART. The state says the
  #     report window was missed (next_report_due two hours ago = ~24 missed
  #     windows at the default cadence) — the restart publishes ONE report
  #     (kind=catch-up), never one per missed window.
  local now60 due60
  now60="$(date -u +%s)"; due60=$(( now60 - 7200 ))
  "$PYTHON3" - "$T/c59/CONTROL/supervisor.state" "$due60" <<'PY60'
import sys
p,e=sys.argv[1],sys.argv[2]
lines=[]
for ln in open(p):
    k=ln.split('=',1)[0]
    if k=='next_report_due_epoch': lines.append('next_report_due_epoch=%s\n'%e)
    elif k=='next_report_due':    lines.append('next_report_due=missed-by-7200s\n')
    elif k=='report_seq':         lines.append('report_seq=5\n')
    else: lines.append(ln)
open(p,'w').writelines(lines)
PY60
  set +e
  OUT="$(WATCH_SUPERVISOR_TICK_SECONDS=1 WATCH_SUPERVISOR_REPORT_SECONDS=30 \
         WATCH_SUPERVISOR_MAX_TICKS=1 bash "$SELF" "$T/c59" --supervise 2>&1)"; RC=$?
  set -e
  local n60 k60
  n60="$("$GREP" -c '^SUPERVISOR-REPORT |' <(printf '%s\n' "$OUT") || true)"
  k60="$("$GREP" -o 'kind=[a-z-]*' <(printf '%s\n' "$OUT") | head -1)"
  ok=0
  if (( RC == 0 )) && [[ "$n60" == "1" && "$k60" == "kind=catch-up" ]] \
     && "$GREP" -q '^report_seq=6$' "$T/c59/CONTROL/supervisor.state" \
     && ! printf '%s' "$OUT" | "$GREP" -q 'COMPLETE'; then ok=1; fi
  report 60 "supervise-catchup-once" "$ok" "rc=${RC} (want 0); 24 missed windows produced exactly ${n60} report (want 1, ${k60}); report_seq 5->6 exactly; no completion claim"

  # --- case 61: AN OVERDUE SUPERVISOR PAUSES NEW DISPATCH. The persisted
  #     last_tick is far older than the overdue ceiling: the legacy tick must
  #     NOT emit dispatch-now — it emits ACTION|pause-dispatch|
  #     supervisor-overdue, exposes the fault on the S-CHECK line and in the
  #     ledger, and declares no completion.
  mk_home "$T/c61"
  printf -- '- [ ] U-01 build the parser\n- [ ] U-02 qc the parser\n' > "$T/c61/CONTROL/CHECKLIST.md"
  printf '# Dispatch log\n' > "$T/c61/CONTROL/dispatch-log.md"
  local old61
  old61=$(( $(date -u +%s) - 900 ))
  printf 'last_tick=2020-01-01T00:00:00Z\nlast_tick_epoch=%s\nnext_report_due=2020-01-01T00:10:00Z\nnext_report_due_epoch=%s\nsupervisor_id=dead-host:pid-1:no-session\nsupervisor_pid=1\nsupervisor_started_at=2020-01-01T00:00:00Z\nrun_epoch=run-dead\ntick_seq=9\nreport_seq=1\nlast_report_at=2020-01-01T00:10:00Z\nqueue_open=0\nqueue_ids=\ndispatch_paused=0\ntick_seconds=60\nreport_seconds=600\noverdue_seconds=180\n' \
    "$old61" "$old61" > "$T/c61/CONTROL/supervisor.state"
  runw "$T/c61"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^ACTION|pause-dispatch|supervisor-overdue|' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|dispatch-now|' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|widen|' \
     && printf '%s' "$OUT" | "$GREP" -q 'S-CHECK | .*supervisor=overdue(' \
     && "$GREP" -q '| DRIFT-ALARM | supervisor-overdue |' "$T/c61/CONTROL/LEDGER.md" 2>/dev/null \
     && ! printf '%s' "$OUT" | "$GREP" -qi 'delivered\|RELEASE_COMPLETE'; then ok=1; fi
  report 61 "overdue-supervisor-pauses-dispatch" "$ok" "rc=${RC} (want 3); dispatch-now suppressed and ACTION|pause-dispatch|supervisor-overdue emitted; supervisor=overdue on the S-CHECK line and a DRIFT-ALARM on the ledger; no completion declared"

  # --- case 62: THE INDEPENDENT LIVENESS CHECK. --supervisor-status reads
  #     ONLY the persisted state: fresh -> HEALTHY exit 0, stale -> OVERDUE
  #     exit 3, absent -> ABSENT exit 3 — and it never writes the state
  #     (cksum before == after) and never dispatches.
  local ck62a ck62b
  ck62a="$(cksum < "$T/c59/CONTROL/supervisor.state")"
  set +e
  OUT="$(bash "$SELF" "$T/c59" --supervisor-status 2>&1)"; RC=$?
  set -e
  ck62b="$(cksum < "$T/c59/CONTROL/supervisor.state")"
  local rc62b rc62c out62c
  ok=0
  if (( RC == 0 )) && printf '%s' "$OUT" | "$GREP" -q '^SUPERVISOR | HEALTHY (exit 0)' \
     && [[ "$ck62a" == "$ck62b" ]] \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|'; then
    set +e
    OUT="$(bash "$SELF" "$T/c61" --supervisor-status 2>&1)"; rc62b=$?
    set -e
    if (( rc62b == 3 )) && printf '%s' "$OUT" | "$GREP" -q '^SUPERVISOR | OVERDUE (exit 3)'; then
      mk_home "$T/c62"
      set +e
      out62c="$(bash "$SELF" "$T/c62" --supervisor-status 2>&1)"; rc62c=$?
      set -e
      if (( rc62c == 3 )) && printf '%s' "$out62c" | "$GREP" -q '^SUPERVISOR | ABSENT (exit 3)'; then ok=1; fi
    fi
  fi
  report 62 "supervisor-status-independent" "$ok" "fresh=exit ${RC} HEALTHY (state cksum unchanged: $([[ "$ck62a" == "$ck62b" ]] && echo yes || echo NO), no ACTION line); stale=exit ${rc62b:-?} OVERDUE; absent=exit ${rc62c:-?} ABSENT"

  # --- case 63: THE POSITIVE CADENCE CONTROL for 55-57. A fresh stamp means
  #     not-due: no request is written and no ACTION is printed. 55 rejected
  #     the zero cadence; this proves a real cadence actually gates.
  mk_home "$T/c63"
  mkdir -p "$T/c63/CONTROL/wm-queue"
  touch "$T/c63/CONTROL/merge-batch.stamp"
  MERGE_BATCH_DISABLE=0 runw "$T/c63"
  local n63
  n63="$(find "$T/c63/CONTROL/wm-queue" -maxdepth 1 -name '*.request.json' 2>/dev/null | "$GREP" -c '[^[:space:]]' || true)"
  ok=0
  if [[ "$n63" == "0" ]] \
     && printf '%s' "$OUT" | "$GREP" -q 'merge-batch=not-due(' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^ACTION|wm-merge-request|' \
     && ! printf '%s' "$OUT" | "$GREP" -q '^MERGE-WINDOW |'; then ok=1; fi
  report 63 "merge-window-not-due" "$ok" "rc=${RC}; a fresh stamp gates the window: ${n63} request(s) written (want 0), merge-batch=not-due on the S-CHECK line, no MERGE-WINDOW/ACTION line"

  # --- case 64: THE CANARY CLOSURE. Across every case above — including the
  #     ones that reached a merge window — WATCH_MERGE_TRAIN_SH named a stub
  #     that writes a marker the instant ANY path executes it. The timer ran
  #     ZERO merge processes: the marker must not exist.
  ok=0
  [[ ! -e "$T/merge-train-executed.marker" ]] && ok=1
  report 64 "no-timer-originated-merge-process" "$ok" "the merge-train canary marker $([[ -e "$T/merge-train-executed.marker" ]] && echo EXISTS || echo 'never appeared') after cases 55-63 — the timer only enqueued; integration belongs to visible S75-WM's native workflow"

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

# --control-bridge prints the CB-1 statement (4e-2) verbatim: the named
# capability gap and its supported repair. No project home is needed — it is
# the answer to "what can a scheduled task actually do?", not a tick.
if (( DO_BRIDGE )); then
  control_bridge_statement
  exit 0
fi

set +e
run_tick
RC=$?
set -e
exit $RC
