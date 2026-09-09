#!/usr/bin/env bash
# dispatch-check.sh — THE PRE-DISPATCH GATE (finding E2; SPEC 8.3 row WI-11).
#
# Usage:
#   dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>]
#                     [unit=<work item>] [phase=<word>] [run=<run id>] [cite=<text>]
#                     [model=<role>] [plan=<one line>]
#   model= and plan= feed the CLAIM line this gate writes for every dispatch
#   it books (RC-29c): `<ts> | CLAIM | unit=<unit> | agent=<label> | model=<role>
#   | plan=<plan>`. Defaults are READ off the dispatch, never invented — the
#   model is the bracket head of the label (`[<model> x<N>]`), the plan is the
#   label with that bracket stripped. Pass plan= to state the unit's intent
#   when the label alone does not say it; that intent is what class 5 reads
#   through CONTROL/last-intents.txt.
#   run= is OPTIONAL. With no run= this gate MINTS wf-<phase>-<NN> itself, from
#   phase= (or the phase word in the label or unit) and CONTROL/.run-counter.
#   dispatch-check.sh --selftest
#   dispatch-check.sh --help
#
# WHAT IT IS FOR. RULE 2's width floor was prose with no script behind it, so
# "3 agents when 10 were possible" was a judgement call the conductor made
# alone, every time, under no instrument. This is the instrument. It is called
# BEFORE a wave fires, it answers in an exit code, and it leaves a row behind.
#
#   floor   = min(units, CLIENT_CAP)      — the skill enforces the FLOOR
#   ceiling = units × stages (default 4)  — the harness owns the real ceiling
#
# The harness caps a workflow at min(16, cores−2) and queues the rest, so a
# script can only ever pass FEWER items than it should. That is the only defect
# this gate can see, and the only one it claims to.
#
# EXIT CODES
#   0  PASS   — the dispatch is at or above the floor and not padded. The
#              dispatch-log row is written through tools/ledger.sh and
#              agents.executions_total in CONTROL/project_state.json is
#              incremented by <agents>, atomically (tmp + rename, under a lock).
#   2  TOOLING FAILURE — the gate could not run: bad usage, a file it must read
#              is missing or unreadable, CLIENT_CAP does not parse, ledger.sh is
#              absent, the state write failed. NEVER a verdict about the
#              dispatch. An exit 2 is "UNDETERMINED", said out loud, with the
#              exact path named — never a silent pass and never a silent block.
#   3  UNDER-WIDTH — agents < min(units, CLIENT_CAP) and no dep= reason was
#              given. This is the timid dispatch, refused.
#   4  REFUSED — the dispatch is malformed or its preconditions are missing:
#              the label does not match [<model> x<N>], or CONTROL/EXECUTION-PLAN.md
#              carries no "Parallelism Plan" heading ("no Parallelism Plan, no
#              dispatch" — references/execution-architecture.md, fail-closed), or
#              a CALLER-SUPPLIED run= is malformed or carries a timestamp LATER
#              than this machine's UTC clock (RC-23a: the 2026-09-07 canary
#              booked ids 55 minutes ahead of the clock and nothing caught it).
#   5  PADDED — agents > units × stages. More seats than the work has stages to
#              put them in; someone inflated the number to satisfy the floor.
#   6  NO-RIGHTSIZE — a BUILD dispatch was attempted while CONTROL/LEDGER.md
#              carries no OVER-ENGINEERING-CHECK: line. The over-engineering
#              check (Law 42) is mandated by SKILL.md step 13 and defined in
#              references/pipeline.md, and the 2026-09-07 canary proved it can
#              be skipped in silence — it was never run and recorded nowhere,
#              and the apparatus outgrew the job unmeasured. This is what makes
#              it unskippable: the run cannot reach a builder without it. Run
#              tools/right-size.sh first; it writes that line, and only on a
#              pass. Like exit 4 this is a fact about the RUN, not a broken
#              tool, so it is kept out of exit 2.
#   7  BUDGET PAUSE — CONTROL/project_state.json says the run is AT or PAST its
#              pause line: agents.executions_total >= agents.first_pause ×
#              (agents.pause_blocks_granted + 1). The 2026-09-07 canary walked
#              from 20 executions to 72 with nothing refusing a single dispatch,
#              because the pause lived in exactly ONE instrument — tools/anchor.sh
#              — which only decides when the five-minute tick runs, and the tick
#              was armed at a step the run never reached. This is that same
#              decision, taken where the dispatch actually happens: deploy the
#              best stable build, write the plain report, ask the one question
#              (SKILL.md section 6). Each "keep going" increments
#              agents.pause_blocks_granted, which moves the wall up by one block
#              and the run resumes at full width. A PAUSE is never a STOP.
#   8  BUDGET CEILING — agents.executions_total >= agents.ceiling (2,000 per
#              project; operator decision 2026-09-07, finding G6). The absolute
#              stop: stop dispatching, run_status=STOPPED_CAP, preserve the best
#              stable build, write the blocker report. It is tested BEFORE the
#              pause, for the reason anchor.sh gives in its own budget audit: a
#              run at the ceiling is also past its pause line, and reporting
#              that as a pause would leave a project able to answer "keep going"
#              past a line it can never cross.
#  10  WRONG SEAT — a BUILD dispatch was attempted while the MOST RECENT
#              CONDUCTOR-SEAT: line in CONTROL/LEDGER.md reads anything other
#              than resolved=opus. The conductor's chair is Opus (the one seat
#              table, references/capacity.md section 11); on the 2026-09-08
#              canary it slid into the router's sonnet default at the turn-04
#              boundary and nothing in the skill noticed for seventeen turns.
#              tools/seat-check.sh reads the chair and SKILL.md section 2 writes
#              that line. This is a PHASE GATE, never a hard stop: a conductor
#              off the Opus lane may finish the apparatus, and only the BUILD
#              phase is held. The operator clears it by starting the session on
#              the Opus lane, which records a newer line. ABSENCE of any
#              CONDUCTOR-SEAT line is NOT a refusal — a run predating
#              seat-check.sh still works — and the missing line is named in a
#              WARNING on stderr instead. Like 4, 6, 7 and 8 it is a fact about
#              the RUN, not a broken tool, so it is kept out of exit 2.
#  12  NO-AUDIT-GATE — a BUILD dispatch was attempted while CONTROL/LEDGER.md
#              carries no AUDIT-GATE line. SKILL.md step 20 runs
#              tools/audit-gate.sh, which writes exactly one
#                AUDIT-GATE | cycle=<n> | halt=<n> harm=<n> scope=<n> carry=<n> | verdict=<v>
#              line through tools/ledger.sh on every run that reaches a verdict.
#              The 2026-09-07 canary proved that gate can be skipped in silence:
#              it shipped, it had a selftest, and it never ran — a recursive
#              grep for 'audit-gate|AUDIT-FINDINGS' over the whole project
#              returned rc=1, zero, with 'grep -ci audit CONTROL/*.md'
#              non-empty in four files as the control. This is what makes it
#              unskippable: the run cannot reach a builder without it. The
#              match is on the LINE SHAPE, never on the word "audit" — a ledger
#              that merely discusses an audit in prose has not run the gate. The
#              VERDICT is deliberately not read: a CEILING verdict means the run
#              PROCEEDS with its full CARRY list (references/gauntlet.md 7.1),
#              so demanding verdict=PASS here would contradict the ceiling rule
#              and re-decide a verdict this gate does not own. Like 4 and 6 it
#              is a fact about the RUN, not a broken tool, so it is kept out of
#              exit 2.
#
# THE OPERATOR OVERRIDE. CONTROL/OPERATOR-OVERRIDE.json is read BEFORE
# CONTROL/project_state.json and its `first_pause` REPLACES agents.first_pause
# in the arithmetic above; SPEC_PROTOCOL_FIRST_PAUSE does the same for a
# headless driver that cannot write into a folder that does not exist yet, and
# the FILE WINS when both are present. Whichever source decided, the PASS line
# and the PAUSED line carry `override=first_pause:<n>(source=<…>)`, so the
# override is never silent. A malformed override is exit 2 — never ignored,
# never a pass. See "THE OPERATOR OVERRIDE" below the width helpers for the
# contract in full.
#
# The four the row enumerates are 0/3/5/2. Exits 4, 6, 10 and 12 are the
# fail-closed precondition refusals — a missing Parallelism Plan, a missing
# over-engineering check, a conductor off the Opus lane and a missing step-20
# audit gate; all four are kept separate from 2 on purpose, because calling a
# real refusal a tooling failure would let it read as a broken tool.
# Exits 7 and 8 are the BUDGET refusals and are kept out of 2 for the same
# reason: the instrument worked perfectly, the RUN is out of budget. When the
# four budget keys cannot be READ, though, the gate does not fall through to a
# pass — it exits 2 and names tools/state-check.sh, because a gate that cannot
# read the budget cannot licence a dispatch against it.
#
# THE RUN ID (RC-23a). `run=` is OPTIONAL and, when absent, is MINTED here:
# wf-<phase>-<NN>, where <phase> is phase= when given, otherwise the first phase
# word found in the label and the unit, and <NN> is a per-project counter
# persisted in CONTROL/.run-counter, zero-padded to two digits. The counter is
# spent only by a dispatch that PASSES every gate, so a refusal never burns an
# id. When no phase can be determined the minted id NAMES that — wf-pending-<NN>,
# with a note saying so — instead of passing the old bare `pending` default off
# as a run id. A CALLER-SUPPLIED run= is validated rather than trusted: it must
# match wf-<phase>-<suffix> (the shape tools/audit-gate.sh:123 already reads as
# run=wf-fix-*), and any timestamp component later than this machine's own UTC
# clock is REFUSED with exit 4. That refusal is the one that would have caught
# the canary's 55-minute forward skew. `cite=<text>` appends its text to the end
# of the row verbatim, which is how a research dispatch carries the two
# RESEARCH-READY citations (SKILL.md section 5) inside a booked row instead of a
# hand-written one.
#
# THE STATE FILE (RC-23c). CONTROL/project_state.json is CREATED by this gate at
# the first dispatch when it is absent, carrying the canonical budget block —
# agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted
# and agents.ceiling, the five paths tools/state-check.sh validates — so a run
# cannot reach its first dispatch without a state file and CONTROL/
# OPERATOR-OVERRIDE.json is readable on every launcher. The numbers are the
# documented formulas computed from THIS dispatch's unit count (SKILL.md section
# 6 rewrites them with the run's own figures); the floors, max(150, …) and
# max(200, …), mean the created file is never laxer than the schema's minimum.
#
# CLIENT_CAP is read from <project>/CAPACITY-LEDGER.md, never declared, never
# asked, never inherited from the environment (finding S1). Two shapes are
# accepted, in this order:
#   1.  CLIENT_CAP=10                                     (tools/width.sh output)
#   2.  clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED …]
# A line whose value is still the template placeholder (`= <k>`) parses as
# NOTHING, not as a number — an unfilled ledger is undetermined (exit 2), never
# a cap of 2 read out of `max(2, …)`.
#
# --selftest proves the instrument before any verdict is believed. It runs the
# three cases the work item names (10/10 at cap 10 → 0; 10 units, 3 agents,
# no dep= → 3; 4 units, 40 agents → 5), the executions_total arithmetic, both
# CLIENT_CAP parse shapes, the dep= escape hatch, both exit-4 refusals, the
# exit-6 pair (ONE build fixture refused without the OVER-ENGINEERING-CHECK:
# line and passed with it — a pass/fail pair on one fixture, so a broken check
# cannot show as a class-wide refusal), the exit-12 quartet (ONE build fixture
# refused with no AUDIT-GATE line, refused again on a ledger that only says the
# word "audit" in prose — the leg a word-search implementation fails — passed
# once the canonical AUDIT-GATE line is added, and a non-build dispatch on the
# same bare fixture passing throughout), the missing-ledger tooling failure, and
# a known-positive control for every grep it relies on. The budget wall is
# proven on ONE fixture, all three legs: executions_total=19 against a
# first_pause of 20 passes, the SAME fixture at 20 exits 7 naming pause_at=20,
# and one granted block passes it again at 20 — a run where all three legs
# answer alike is a broken test, not a finding. The OPERATOR OVERRIDE is proven
# the same way on one more fixture, five legs: no override at all passes at
# executions_total=20 against first_pause=200; the override file at 20 refuses
# the identical dispatch with rc 7; the variable alone does the same and names
# itself; the file beats a disagreeing variable; and a malformed override is
# rc 2, never rc 0. THE CONDUCTOR'S SEAT is proven on one more fixture, four
# legs: no CONDUCTOR-SEAT line at all passes with a warning naming the missing
# line; the same build dispatch after a resolved=sonnet line exits 10 and spends
# nothing; after a resolved=opus line it passes again; and a JUDGE dispatch under
# that same resolved=sonnet line passes, which is what proves the gate reads the
# BUILD phase and is not a class-wide refusal. A gate whose known-positive comes
# back negative reports BROKEN INSTRUMENT, never "clean".

set -uo pipefail

# --- The greps. Named, absolute, and proven in the selftest. -----------------
GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

DEFAULT_STAGES=4
LABEL_RE='\[[A-Za-z0-9.-]+ x[0-9]+\]'

# --- THE RUN ID (RC-23a) ----------------------------------------------------
RUN_COUNTER_REL="CONTROL/.run-counter"
# The minted shape, and the only shape a caller may pass. Deliberately the same
# family tools/audit-gate.sh:123 counts as run=wf-fix-<...>, so an id this gate
# mints is an id that gate can already read.
RUN_ID_RE='^wf-[a-z][a-z0-9]*-[A-Za-z0-9._-]+$'
# The phase vocabulary a minted id draws on, in priority order. A label or unit
# carrying none of these words is not guessed at: the id names the phase
# "pending" and says so on stderr.
PHASE_WORDS="research build rebuild fix judge pen merge audit council repair deploy publish qc plan design scaffold content verify ship"

usage() {
  sed -n '2,14p' "${SELF}"
}

# --- Exit helpers. Every one of them says WHICH path it read. ----------------
tooling() { printf 'DISPATCH-CHECK UNDETERMINED | tooling | %s\n' "$1" >&2; exit 2; }
refuse()  { printf 'DISPATCH-CHECK REFUSED | %s\n' "$1" >&2; exit 4; }

is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# derive_phase <label> <unit> — the first PHASE_WORDS word appearing in either,
# or rc 1 when neither names a phase. The [<model> x<N>] bracket is stripped
# first so a model name can never be read as a phase.
derive_phase() {
  local text w
  text="$(printf '%s %s' "$1" "$2" \
          | tr '[:upper:]' '[:lower:]' \
          | sed -e 's/\[[^]]*\]//g' -e 's/[^a-z][^a-z]*/ /g')"
  for w in ${PHASE_WORDS}; do
    case " ${text} " in *" ${w} "*) printf '%s' "${w}"; return 0 ;; esac
  done
  return 1
}

# mint_run_seq <project> — the per-project counter in CONTROL/.run-counter,
# incremented under a mkdir lock and written tmp+rename, printed zero-padded to
# two digits. rc 1 (never a guessed number) when it cannot be read or written.
mint_run_seq() {
  local f="${1%/}/${RUN_COUNTER_REL}" d waited=0 n tmp
  mkdir -p "$(dirname "${f}")" 2>/dev/null || return 1
  d="${f}.lock.d"
  while ! mkdir "${d}" 2>/dev/null; do
    if (( waited >= 20 )); then return 1; fi
    if (( waited >= 10 )); then
      printf 'DISPATCH-CHECK NOTE | reclaiming stale run-counter lock %s after %ss\n' "${d}" "${waited}" >&2
      rm -rf "${d}" 2>/dev/null || true
      waited=$(( waited + 1 ))
      continue
    fi
    sleep 1
    waited=$(( waited + 1 ))
  done
  n="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\).*$/\1/p' "${f}" 2>/dev/null | head -n 1)"
  is_uint "${n}" || n=0
  n=$(( n + 1 ))
  tmp="${f}.tmp.$$"
  if printf '%s\n' "${n}" > "${tmp}" 2>/dev/null && mv "${tmp}" "${f}" 2>/dev/null; then
    rm -rf "${d}" 2>/dev/null || true
    printf '%02d' "${n}"
    return 0
  fi
  rm -f "${tmp}" 2>/dev/null || true
  rm -rf "${d}" 2>/dev/null || true
  return 1
}

# reference_now — the UTC clock this gate dates a caller-supplied id against,
# as YYYYMMDDHHMMSS. It is `date -u`, with ONE injection point that can only
# ever make the check STRICTER: SPEC_PROTOCOL_NOW_UTC is honoured only when it
# parses AND is EARLIER than the real clock. A value in the future is IGNORED
# and named on stderr, so the variable can never be used to walk a
# forward-stamped id past this gate — it can only pull "now" backwards, which
# refuses MORE ids, never fewer. That is what makes the forward-skew refusal
# reproducible on any date: set the clock back to the canary's 2026-09-08T13:14Z
# and the canary's own id is refused, exactly as it should have been that day.
reference_now() {
  local real inj
  real="$(date -u +%Y%m%d%H%M%S 2>/dev/null)"
  is_uint "${real}" || return 1
  inj="${SPEC_PROTOCOL_NOW_UTC:-}"
  if [[ -n "${inj}" ]]; then
    inj="$(printf '%s' "${inj}" | tr -d 'TZ:- ')"
    while (( ${#inj} < 14 )); do inj="${inj}0"; done
    inj="${inj:0:14}"
    if ! is_uint "${inj}"; then
      printf 'DISPATCH-CHECK NOTE | SPEC_PROTOCOL_NOW_UTC=%s does not parse as a UTC stamp and is IGNORED; the real clock %s is used.\n' \
        "${SPEC_PROTOCOL_NOW_UTC}" "${real}" >&2
    elif (( 10#${inj} > 10#${real} )); then
      printf 'DISPATCH-CHECK NOTE | SPEC_PROTOCOL_NOW_UTC=%s is LATER than the real clock %s and is IGNORED — this variable may only move the reference clock BACKWARDS, so it can never walk a forward-stamped run id past this gate.\n' \
        "${SPEC_PROTOCOL_NOW_UTC}" "${real}" >&2
    else
      printf 'DISPATCH-CHECK NOTE | reference clock moved BACK to SPEC_PROTOCOL_NOW_UTC=%s (real clock %s); this only refuses MORE ids, never fewer.\n' \
        "${inj}" "${real}" >&2
      printf '%s' "${inj}"
      return 0
    fi
  fi
  printf '%s' "${real}"
  return 0
}

# validate_run_id <id> — a caller-supplied run= is CHECKED, never trusted. It
# refuses (exit 4) the old bare `pending`, any id outside RUN_ID_RE, and any id
# whose timestamp component is later than this machine's UTC clock. A clock it
# cannot read is exit 2: an id this gate cannot date never books a dispatch.
validate_run_id() {
  local id="$1" stamp d t now cand
  [[ "${id}" != "pending" ]] \
    || refuse "run=pending is not a run id — it was this gate's old default, and every dispatch booked under it is untraceable (RC-23). Omit run= and the gate mints wf-<phase>-<NN>, naming the phase it used."
  printf '%s' "${id}" | "${GREP}" -qE "${RUN_ID_RE}" \
    || refuse "run='${id}' does not match ${RUN_ID_RE} — the shape is wf-<phase>-<suffix>, minted here as wf-<phase>-<NN> and read by tools/audit-gate.sh as run=wf-fix-*. Omit run= to have this gate mint one."
  stamp="$(printf '%s' "${id}" | sed -n 's/.*[^0-9]\([0-9]\{8\}T[0-9]\{4,6\}\)Z\{0,1\}.*$/\1/p')"
  [[ -n "${stamp}" ]] || return 0
  d="${stamp%%T*}"; t="${stamp#*T}"
  while (( ${#t} < 6 )); do t="${t}0"; done
  cand="${d}${t}"
  now="$(reference_now)" \
    || tooling "date -u failed, so whether run=${id} is stamped in the future is UNDETERMINED — and an id this gate cannot date never books a dispatch"
  is_uint "${now}" \
    || tooling "date -u failed, so whether run=${id} is stamped in the future is UNDETERMINED — and an id this gate cannot date never books a dispatch"
  if (( 10#${cand} > 10#${now} )); then
    refuse "run='${id}' carries the timestamp ${stamp}, which is LATER than this machine's UTC clock (${now}). A booking stamped in the future is a skewed clock or a hand-written id; it is refused rather than logged. The 2026-09-07 canary carried a 55-minute forward skew and nothing caught it."
  fi
  return 0
}

# --- CLIENT_CAP, read from the Capacity Ledger ------------------------------
parse_cap() {
  local f="$1" v=""
  v="$(sed -n 's/^[[:space:]]*CLIENT_CAP[[:space:]]*=[[:space:]]*\([0-9][0-9]*\).*$/\1/p' "${f}" 2>/dev/null | head -n 1)"
  if [[ -n "${v}" ]]; then printf '%s' "${v}"; return 0; fi
  # Bracketed provenance marks are stripped first ([MEASURED …] carries digits
  # of its own), then the LAST "= <n>" on a clientCap line is the value.
  v="$(sed -e 's/\[[^]]*\]//g' "${f}" 2>/dev/null \
       | sed -n 's/.*[Cc]lient[Cc]ap.*=[[:space:]]*\([0-9][0-9]*\)[[:space:]]*$/\1/p' | head -n 1)"
  if [[ -n "${v}" ]]; then printf '%s' "${v}"; return 0; fi
  return 1
}

# --- The Parallelism Plan gate (fail-closed) --------------------------------
has_parallelism_plan() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  "${GREP}" -qE '^[[:space:]]*#{1,6}[[:space:]].*Parallelism Plan' "${f}" 2>/dev/null && return 0
  "${GREP}" -qE '^[[:space:]]*(\*\*)?Parallelism Plan' "${f}" 2>/dev/null && return 0
  return 1
}

# --- The over-engineering check gate (fail-closed) ---------------------------
# tools/right-size.sh writes "OVER-ENGINEERING-CHECK: units=… verdict=…" into
# CONTROL/LEDGER.md, and writes it ONLY on a pass. So the presence of the line
# is the proof the check ran and cleared; its absence is the proof it did not.
has_rightsize_line() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  [[ -r "${f}" ]] || return 1
  "${GREP}" -q 'OVER-ENGINEERING-CHECK:' "${f}" 2>/dev/null && return 0
  return 1
}

# --- The conductor's seat (RC-15) -------------------------------------------
# tools/seat-check.sh resolves which lane the CONDUCTOR is sitting in and
# SKILL.md section 2 writes its verdict into CONTROL/LEDGER.md as
#
#   CONDUCTOR-SEAT: expected=opus resolved=<lane> launcher=<name> source=<src>
#
# The NEWEST such line is the only one that counts: a run that opened in the
# wrong chair and was restarted in the right one records a second line, and the
# second line is the truth about the session dispatching now. This gate reads
# the line; it never reads the environment and never resolves a seat itself —
# one instrument owns that question, and it is not this one.
last_seat_line() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  [[ -r "${f}" ]] || return 1
  "${GREP}" -h 'CONDUCTOR-SEAT:' "${f}" 2>/dev/null | tail -n 1
}

# seat_lane_of <line> — the resolved= field, or empty when the line carries none.
# An empty field is NOT read as opus: a malformed seat line is a wrong seat.
seat_lane_of() {
  printf '%s' "$1" | sed -n 's/.*resolved=\([A-Za-z0-9._-][A-Za-z0-9._-]*\).*/\1/p' | head -n 1
}

# Deliberately broad: any label carrying "build" in any case is a build
# dispatch, "rebuild" included. Fail-closed is the safe direction here — the
# cost of gating one extra dispatch is a re-run of right-size.sh; the cost of
# missing one is the defect this exists to end.
is_build_label() {
  printf '%s' "$1" | "${GREP}" -qi 'build'
}

# --- The step-20 audit gate (fail-closed; RC-24 substance A) -----------------
# tools/audit-gate.sh writes exactly ONE line of this shape through
# tools/ledger.sh on every run that reaches a verdict (audit-gate.sh, its
# write_ledger_line):
#
#   AUDIT-GATE | cycle=<n> | halt=<n> harm=<n> scope=<n> carry=<n> | verdict=<v>
#
# The SHAPE is the proof the gate RAN. The word "audit" is not: a ledger can
# discuss an audit at length without one ever having been executed, which is
# exactly what the 2026-09-07 canary's ledger did. So the expression below
# demands all five counters and the verdict field, in order, and a leading
# timestamp or list marker is tolerated because ledger.sh's callers may add one.
# The verdict VALUE is not read here — see exit 12 in the header.
AUDIT_GATE_RE='AUDIT-GATE[[:space:]]*\|[[:space:]]*cycle=[0-9]+[[:space:]]*\|[[:space:]]*halt=[0-9]+[[:space:]]+harm=[0-9]+[[:space:]]+scope=[0-9]+[[:space:]]+carry=[0-9]+[[:space:]]*\|[[:space:]]*verdict=[A-Za-z][A-Za-z-]*'
has_audit_gate_line() {
  local f="$1"
  [[ -f "${f}" ]] || return 1
  [[ -r "${f}" ]] || return 1
  "${GREP}" -qE "${AUDIT_GATE_RE}" "${f}" 2>/dev/null && return 0
  return 1
}

# --- THE OPERATOR OVERRIDE — CONTROL/OPERATOR-OVERRIDE.json (WI-35) ----------
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
#   tolerated, because jnum above matches a quoted key at ANY depth and, being
#   greedy, returns the LAST occurrence — so a nested or duplicated first_pause
#   resolves unpredictably (RC-3). A file this parser accepts is a file this
#   gate and tools/anchor.sh agree about.
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
# both are present, and both the PASS and the PAUSED line NAME the source used,
# so a run can never be paused by a number nobody can point at.
#
# FAIL LOUD. An override that exists and cannot be honoured is a TOOLING FAILURE
# (exit 2) — never an ignored file, never a pass. ABSENCE is not a failure: no
# file and no variable means no override, and the state file decides as before.
#
# The parser below is COPIED, deliberately, into tools/anchor.sh: two
# instruments that decide the same pause must never disagree about how the
# override parses. Only the failure primitive differs (tooling here, die_tool
# there), and both are exit 2.
OV_AWK="/usr/bin/awk"
if [[ ! -x "${OV_AWK}" ]]; then OV_AWK="$(command -v awk 2>/dev/null || true)"; fi

OVERRIDE_REL="CONTROL/OPERATOR-OVERRIDE.json"
OVERRIDE_PAUSE=""    # the honoured first_pause, or "" for no override
OVERRIDE_SOURCE=""   # the path or the variable name the number came from
OVERRIDE_TAG=""      # override=first_pause:<n>(source=<...>), or ""

# override_parse <file> — a STRICT flat-object reader. Emits one
# `key<TAB>type<TAB>value` line per member and a final OVERRIDE-OK, or one
# OVERRIDE-ERROR line and rc 1. Dependency-free (no jq, no node, no python):
# this runs on a client's machine before anything dispatches. Paths are the
# point — a regex over the text cannot tell a flat first_pause from one buried
# two levels down, which is the exact defect RC-3 records.
override_parse() {
  LC_ALL=C "${OV_AWK}" '
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

# override_resolve <project> — sets OVERRIDE_PAUSE / OVERRIDE_SOURCE /
# OVERRIDE_TAG, or leaves all three empty when there is no override at all.
# It NEVER returns quietly on an override it could not honour: that path calls
# tooling() and the gate exits 2, because an undetermined pause line never
# licences a dispatch.
override_resolve() {
  local f="${1%/}/${OVERRIDE_REL}" out rc fp ty envv setby reason
  OVERRIDE_PAUSE=""; OVERRIDE_SOURCE=""; OVERRIDE_TAG=""
  [[ -n "${OV_AWK}" && -x "${OV_AWK}" ]] \
    || tooling "no awk found (tried /usr/bin/awk then \$PATH) — ${f} cannot be read, so whether an operator override is in force is UNDETERMINED, and an undetermined pause line never licences a dispatch"

  # --- (1) THE FILE, read BEFORE CONTROL/project_state.json, and winning ----
  if [[ -e "${f}" ]]; then
    [[ -f "${f}" ]] || tooling "${f} exists but is not a regular file — an operator override that cannot be read is never ignored"
    [[ -r "${f}" ]] || tooling "${f} is unreadable — an operator override that cannot be read is never ignored"
    out="$(override_parse "${f}" 2>&1)"; rc=$?
    if (( rc != 0 )) || ! printf '%s\n' "${out}" | "${GREP}" -q '^OVERRIDE-OK$'; then
      tooling "MALFORMED OPERATOR OVERRIDE at ${f}: $(printf '%s' "${out}" | tr '\n' ' ' | cut -c1-300). The contract is one FLAT JSON object, no nesting and no repeated key: {\"first_pause\": <int>, \"set_by\": \"...\", \"reason\": \"...\"}. A malformed override is never ignored and never a pass."
    fi
    ty="$(printf '%s\n' "${out}" | LC_ALL=C "${OV_AWK}" -F '\t' '$1 == "first_pause" { print $2; exit }')"
    fp="$(printf '%s\n' "${out}" | LC_ALL=C "${OV_AWK}" -F '\t' '$1 == "first_pause" { print $3; exit }')"
    [[ -n "${ty}" ]] \
      || tooling "MALFORMED OPERATOR OVERRIDE at ${f}: it carries no first_pause. first_pause is the only honoured key, so an override file without one overrides nothing — which is exactly the silent no-op this file exists to prevent. Remove the file or give it a first_pause."
    [[ "${ty}" == "int" ]] && is_uint "${fp}" \
      || tooling "MALFORMED OPERATOR OVERRIDE at ${f}: first_pause is '${fp}' (${ty}), which is not a non-negative integer"
    setby="$(printf '%s\n' "${out}" | LC_ALL=C "${OV_AWK}" -F '\t' '$1 == "set_by" { print $3; exit }')"
    reason="$(printf '%s\n' "${out}" | LC_ALL=C "${OV_AWK}" -F '\t' '$1 == "reason" { print $3; exit }')"
    OVERRIDE_PAUSE="${fp}"
    OVERRIDE_SOURCE="${f}"
    OVERRIDE_TAG="override=first_pause:${fp}(source=${f})"
    printf 'DISPATCH-CHECK NOTE | OPERATOR OVERRIDE in force | first_pause=%s from %s (set_by=%s; reason=%s). It is read BEFORE CONTROL/project_state.json and it wins; no agent may edit this file and no audit finding may propose removing it.\n' \
      "${fp}" "${f}" "${setby:-unstated}" "${reason:-unstated}" >&2
    if [[ -n "${SPEC_PROTOCOL_FIRST_PAUSE:-}" ]]; then
      printf 'DISPATCH-CHECK NOTE | SPEC_PROTOCOL_FIRST_PAUSE=%s is also set and is NOT used — the file wins when both are present, and the line above names the file as the source.\n' \
        "${SPEC_PROTOCOL_FIRST_PAUSE}" >&2
    fi
    return 0
  fi

  # --- (2) the environment variable, for a driver with nowhere to write -----
  envv="${SPEC_PROTOCOL_FIRST_PAUSE:-}"
  envv="${envv//[[:space:]]/}"
  [[ -n "${envv}" ]] || return 0   # no file, no variable: no override. Not a failure.
  is_uint "${envv}" \
    || tooling "MALFORMED OPERATOR OVERRIDE: SPEC_PROTOCOL_FIRST_PAUSE='${SPEC_PROTOCOL_FIRST_PAUSE:-}' is not a non-negative integer. A variable that is set and cannot be honoured is never ignored."
  OVERRIDE_PAUSE="${envv}"
  OVERRIDE_SOURCE="env:SPEC_PROTOCOL_FIRST_PAUSE"
  OVERRIDE_TAG="override=first_pause:${envv}(source=env:SPEC_PROTOCOL_FIRST_PAUSE)"
  printf 'DISPATCH-CHECK NOTE | OPERATOR OVERRIDE in force | first_pause=%s from the environment variable SPEC_PROTOCOL_FIRST_PAUSE (no %s on disk). Write the file once CONTROL/ exists; the file wins over the variable.\n' \
    "${envv}" "${f}" >&2
  return 0
}

# --- The budget wall (RC-4b): the pause line and the ceiling -----------------
# Until this block existed, the pause decision lived in exactly one instrument,
# tools/anchor.sh, which only decides when the five-minute tick runs. The
# 2026-09-07 canary never reached the step that armed the tick, so
# executions_total walked from 20 (its own pause line) to 72 with nothing
# mechanical refusing a dispatch. The pause has to be a WALL, not a reminder,
# and a wall stands at the door the dispatch goes through.
#
# jnum below is COPIED, deliberately character for character, from
# tools/anchor.sh's budget audit (its jnum): the same sed, over the same
# newline-stripped text. Two instruments that decide the same pause must never
# disagree about how CONTROL/project_state.json parses. It matches an
# exactly-quoted key at ANY nesting depth and, being greedy, returns the LAST
# occurrence when a key appears twice — anchor.sh's override design, kept
# identical rather than "improved".
jnum() {  # jnum <flat-json-file> <key> -> integer on stdout, or rc 1
  local v
  v="$(sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\(-\{0,1\}[0-9][0-9]*\).*/\1/p' "$1" | head -1)"
  [[ -n "$v" ]] || return 1
  printf '%s\n' "$v"
}

# The absolute per-project ceiling (operator decision 2026-09-07, finding G6).
# A state file may lower it; it may never raise it, which is why the state value
# is only taken when it is SMALLER — the same clamp anchor.sh applies.
DEFAULT_CEILING=2000

# budget_gate <state-json> <project> — exits 8 at the ceiling, 7 at the pause
# line, and 2 when the budget cannot be read. Returns 0 only when the run is
# PROVABLY under both lines. It never returns 0 on a file it could not measure:
# an undetermined budget is exactly the state in which a dispatch must not be
# licensed.
budget_gate() {
  local sp="$1" project="$2" flat=""

  # THE OPERATOR OVERRIDE IS READ FIRST — before the state file below, and
  # before any of its own tooling refusals. Order is the point twice over: the
  # override WINS over agents.first_pause, and a malformed override must exit 2
  # even on a project whose state file would have been refused anyway.
  override_resolve "${project}"

  [[ -f "${sp}" ]] \
    || tooling "no state file at ${sp} — the pause line and the ceiling are UNDETERMINED, and an undetermined budget never licences a dispatch. SKILL.md section 6 writes agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted and agents.ceiling BEFORE the first dispatch; tools/state-check.sh <project> says which of them are missing."
  [[ -r "${sp}" ]] \
    || tooling "state file is unreadable: ${sp} — run tools/state-check.sh <project>; the budget is UNDETERMINED and no dispatch is licensed against it"

  flat="$(mktemp "${TMPDIR:-/tmp}/dispatch-check-state.XXXXXX" 2>/dev/null)" \
    || tooling "could not create a temp file to read ${sp} — the budget is UNDETERMINED"
  if ! tr -d '\n\r' < "${sp}" > "${flat}" 2>/dev/null; then
    rm -f "${flat}" 2>/dev/null || true
    tooling "could not read ${sp} — the budget is UNDETERMINED; run tools/state-check.sh <project>"
  fi

  local exec_t pause_state blocks ceil_state missing=""
  exec_t="$(jnum      "${flat}" 'executions_total'     || true)"
  pause_state="$(jnum "${flat}" 'first_pause'          || true)"
  blocks="$(jnum      "${flat}" 'pause_blocks_granted' || true)"
  ceil_state="$(jnum  "${flat}" 'ceiling'              || true)"
  rm -f "${flat}" 2>/dev/null || true

  [[ -n "${exec_t}"      ]] || missing="${missing} agents.executions_total"
  [[ -n "${pause_state}" ]] || missing="${missing} agents.first_pause"
  [[ -n "${blocks}"      ]] || missing="${missing} agents.pause_blocks_granted"
  [[ -n "${ceil_state}"  ]] || missing="${missing} agents.ceiling"
  [[ -z "${missing}" ]] \
    || tooling "${sp} carries no${missing} — the budget is UNDETERMINED, so this gate refuses instead of passing a dispatch it cannot measure. Run tools/state-check.sh <project>: it exits 3 naming every missing key, and exits 4 when the numbers were computed and written to a near-miss path such as agents.project_budget.* — which is a WRITER defect, not an absent budget."

  is_uint "${exec_t}"      || tooling "agents.executions_total parsed as '${exec_t}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${pause_state}" || tooling "agents.first_pause parsed as '${pause_state}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${blocks}"      || tooling "agents.pause_blocks_granted parsed as '${blocks}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"
  is_uint "${ceil_state}"  || tooling "agents.ceiling parsed as '${ceil_state}' from ${sp}, which is not a non-negative integer — run tools/state-check.sh <project>"

  # The override outranks agents.first_pause outright. It moves the PAUSE only:
  # granted blocks still multiply it and the ceiling still clamps it, because an
  # operator moving the pause line has not moved the absolute ceiling.
  local pause_src="${pause_state}"
  if [[ -n "${OVERRIDE_PAUSE}" ]]; then pause_src="${OVERRIDE_PAUSE}"; fi

  local ceil="${DEFAULT_CEILING}" pause
  (( ceil_state < ceil )) && ceil="${ceil_state}"
  pause=$(( pause_src * ( blocks + 1 ) ))
  (( pause > ceil )) && pause="${ceil}"

  # THE CEILING IS TESTED FIRST, as tools/anchor.sh tests it first in its budget
  # audit, and for the reason it gives there: a run at 2,000 is also past its
  # pause line, and reporting that as a pause would leave a project able to
  # answer "keep going" past the absolute ceiling. A run BELOW the ceiling is
  # never STOPPED_CAP — it has budget left, so it pauses and asks instead.
  if (( exec_t >= ceil )); then
    printf 'DISPATCH-CHECK CEILING | executions=%s | ceiling=%s\n' "${exec_t}" "${ceil}" >&2
    printf 'DISPATCH-CHECK NOTE | read: %s | the absolute per-project ceiling is reached: stop dispatching, set run_status=STOPPED_CAP, preserve the best stable build and write the blocker report. A LIMIT REACHED stop is never a PASS and never drift, and it is never crossed without the operator.\n' "${sp}" >&2
    exit 8
  fi
  if (( exec_t >= pause )); then
    printf 'DISPATCH-CHECK PAUSED | executions=%s | pause_at=%s | ceiling=%s%s\n' \
      "${exec_t}" "${pause}" "${ceil}" "${OVERRIDE_TAG:+ | ${OVERRIDE_TAG}}" >&2
    if [[ -n "${OVERRIDE_TAG}" ]]; then
      printf 'DISPATCH-CHECK NOTE | read: %s | pause_at = the OPERATOR OVERRIDE first_pause %s (source: %s, read before %s and outranking its agents.first_pause of %s) × (agents.pause_blocks_granted %s + 1). Deploy the best stable build, write the plain report, then ask the one question (SKILL.md section 6). Each "keep going" increments agents.pause_blocks_granted, which moves this wall up by one block, and the run resumes at full width. This is a PAUSE, not a stop.\n' \
        "${sp}" "${OVERRIDE_PAUSE}" "${OVERRIDE_SOURCE}" "${sp}" "${pause_state}" "${blocks}" >&2
    else
      printf 'DISPATCH-CHECK NOTE | read: %s | pause_at = agents.first_pause %s × (agents.pause_blocks_granted %s + 1). Deploy the best stable build, write the plain report, then ask the one question (SKILL.md section 6). Each "keep going" increments agents.pause_blocks_granted, which moves this wall up by one block, and the run resumes at full width. This is a PAUSE, not a stop.\n' "${sp}" "${pause_state}" "${blocks}" >&2
    fi
    exit 7
  fi
  return 0
}

# --- The state counter ------------------------------------------------------
# agents.executions_total is what anchor.sh line ~660 reads for the 200-pause
# and the 2,000-ceiling. Until this gate existed nothing WROTE it, so the cap
# depended on the conductor remembering a number. Written here, atomically,
# once per gated dispatch.
state_lock_dir=""
release_state_lock() {
  if [[ -n "${state_lock_dir}" ]]; then rm -rf "${state_lock_dir}" 2>/dev/null || true; state_lock_dir=""; fi
}
trap release_state_lock EXIT

acquire_state_lock() {
  local d="$1.lock.d" waited=0
  while ! mkdir "${d}" 2>/dev/null; do
    if [[ -d "${d}" ]] && (( waited >= 15 )); then
      # A holder older than any real critical section here (the whole
      # read-modify-write is milliseconds) has crashed. Reclaim once, loudly.
      printf 'DISPATCH-CHECK NOTE | reclaiming stale state lock %s after %ss\n' "${d}" "${waited}" >&2
      rm -rf "${d}" 2>/dev/null || true
      continue
    fi
    if (( waited >= 20 )); then return 1; fi
    sleep 1
    waited=$(( waited + 1 ))
  done
  printf 'pid=%s\n' "$$" > "${d}/owner" 2>/dev/null || true
  state_lock_dir="${d}"
  return 0
}

# create_state_file <state-path> <units> — RC-23c. The state file is written by
# THIS SCRIPT at the first dispatch, not waited for: on 2026-09-07 the routed
# launcher never wrote one, so the pause line, the ceiling and the operator
# override had nowhere to live and no dispatch could be measured against them.
#
# The block is the CANONICAL one tools/state-check.sh validates — the five
# integer keys DIRECTLY under "agents" — computed with the documented formulas
# from this dispatch's unit count, WF01 unknown at this point and therefore
# omitted rather than invented:
#
#     initial               = units × 3 + 4
#     warn_at               = max(150, 3 × initial)
#     first_pause           = max(200, 4 × initial)
#     pause_blocks_granted  = 0
#     ceiling               = 2000 (DEFAULT_CEILING; a later write may lower it)
#
# The two max() floors are why a file created here is never LAXER than the
# schema's minimum. SKILL.md section 6 overwrites these with the run's own
# numbers when it computes them; until it does, the run has a real budget block
# instead of none.
create_state_file() {
  local sp="$1" u="$2" tmp="$1.tmp.$$" initial warn_at first_pause
  is_uint "${u}" || return 1
  initial=$(( u * 3 + 4 ))
  warn_at=$(( 3 * initial ));     (( warn_at < 150 ))     && warn_at=150
  first_pause=$(( 4 * initial )); (( first_pause < 200 )) && first_pause=200
  mkdir -p "$(dirname "${sp}")" 2>/dev/null || return 1
  {
    printf '{\n'
    printf '  "schema": "spec-protocol/project-state@1",\n'
    printf '  "run_status": "RUNNING",\n'
    printf '  "agents": {\n'
    printf '    "executions_total": 0,\n'
    printf '    "initial": %s,\n' "${initial}"
    printf '    "warn_at": %s,\n' "${warn_at}"
    printf '    "first_pause": %s,\n' "${first_pause}"
    printf '    "pause_blocks_granted": 0,\n'
    printf '    "ceiling": %s\n' "${DEFAULT_CEILING}"
    printf '  }\n'
    printf '}\n'
  } > "${tmp}" || return 1
  mv "${tmp}" "${sp}" || return 1
  return 0
}

# bump_state <state-path> <delta> — prints the new total on success.
bump_state() {
  local sp="$1" delta="$2" tmp="$1.tmp.$$" out=""
  # DISPATCH_NO_PYTHON=1 forces the awk path. It exists so the selftest can
  # PROVE the fallback on a box that has python3 — an untested fallback is a
  # fallback that fails the first time it is needed.
  if [[ "${DISPATCH_NO_PYTHON:-0}" != "1" ]] && command -v python3 >/dev/null 2>&1; then
    out="$(python3 - "${sp}" "${tmp}" "${delta}" <<'PY' 2>&1
import json, sys
src, tmp, delta = sys.argv[1], sys.argv[2], int(sys.argv[3])
with open(src, encoding="utf-8") as fh:
    doc = json.load(fh)
if not isinstance(doc, dict):
    raise SystemExit("state file root is not a JSON object")
agents = doc.get("agents")
if not isinstance(agents, dict):
    agents = {}
    doc["agents"] = agents
cur = agents.get("executions_total", 0)
if isinstance(cur, bool) or not isinstance(cur, int):
    raise SystemExit("agents.executions_total is not an integer: %r" % (cur,))
agents["executions_total"] = cur + delta
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
print(agents["executions_total"])
PY
)"
    if [[ $? -ne 0 || -z "${out}" ]]; then rm -f "${tmp}" 2>/dev/null || true; printf '%s' "${out}"; return 1; fi
  else
    # No python3: line-based edit of the one field, same atomicity. Exits 3 when
    # the field is not on a line of its own — an unparseable state file is
    # UNDETERMINED, never a silent no-op.
    awk -v d="${delta}" '
      BEGIN { done = 0 }
      {
        if (!done && match($0, /"executions_total"[[:space:]]*:[[:space:]]*[0-9]+/)) {
          seg = substr($0, RSTART, RLENGTH)
          pre = substr($0, 1, RSTART - 1)
          post = substr($0, RSTART + RLENGTH)
          n = seg; sub(/.*:[[:space:]]*/, "", n)
          nn = n + d
          sub(/[0-9]+$/, nn, seg)
          print pre seg post
          print nn > "/dev/stderr"
          done = 1
          next
        }
        print
      }
      END { if (!done) exit 3 }
    ' "${sp}" > "${tmp}" 2>"${tmp}.n"
    if [[ $? -ne 0 ]]; then
      rm -f "${tmp}" "${tmp}.n" 2>/dev/null || true
      printf 'agents.executions_total is not on a parseable line and python3 is absent'
      return 1
    fi
    out="$(tail -n 1 "${tmp}.n" 2>/dev/null)"
    rm -f "${tmp}.n" 2>/dev/null || true
  fi
  mv "${tmp}" "${sp}" || { rm -f "${tmp}" 2>/dev/null || true; printf 'rename failed'; return 1; }
  printf '%s' "${out}"
  return 0
}

# ============================================================================
# The run
# ============================================================================
run_check() {
  (( $# >= 4 )) \
    || { printf 'DISPATCH-CHECK UNDETERMINED | tooling | %s\n' \
         "usage: dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>] — got $# argument(s)" >&2; exit 2; }
  local project units agents label
  project="$1"; units="$2"; agents="$3"; label="$4"
  shift 4

  # run_id starts EMPTY, not "pending": an empty id is the signal to MINT one
  # below (RC-23a). "pending" survives only as the phase NAME a minted id carries
  # when no phase can be determined, and it is never a run id in its own right.
  local dep="" stages="${DISPATCH_STAGES:-${DEFAULT_STAGES}}" unit="" run_id="" phase="" cite="" model="" plan=""
  local a
  for a in "$@"; do
    case "${a}" in
      dep=*)    dep="${a#dep=}" ;;
      stages=*) stages="${a#stages=}" ;;
      unit=*)   unit="${a#unit=}" ;;
      phase=*)  phase="${a#phase=}" ;;
      cite=*)   cite="${a#cite=}" ;;
      run=*)    run_id="${a#run=}" ;;
      model=*)  model="${a#model=}" ;;
      plan=*)   plan="${a#plan=}" ;;
      *) tooling "unrecognised argument '${a}' — the optional arguments are dep=, stages=, unit=, phase=, run=, cite=, model=, plan=" ;;
    esac
  done

  [[ -n "${project}" && -n "${units}" && -n "${agents}" && -n "${label}" ]] \
    || tooling "usage: dispatch-check.sh <project> <units> <agents> <label> [dep=<reason>] [stages=<n>]"
  [[ -n "${GREP}" && -x "${GREP}" ]] \
    || tooling "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the gate cannot read its own inputs, so it claims nothing"

  # A caller-supplied run= is validated HERE, before anything is read or
  # written, so a malformed or forward-stamped id costs nothing and books
  # nothing. A phase= is checked the same way: it becomes part of an id other
  # instruments grep for, so it may not carry surprises.
  if [[ -n "${run_id}" ]]; then validate_run_id "${run_id}"; fi
  if [[ -n "${phase}" ]]; then
    printf '%s' "${phase}" | "${GREP}" -qE '^[a-z][a-z0-9]*$' \
      || refuse "phase='${phase}' is not a lowercase word — the minted id is wf-<phase>-<NN> and tools/audit-gate.sh greps that shape, so the phase may only be [a-z][a-z0-9]*"
  fi
  is_uint "${units}"  || tooling "units must be a non-negative integer, got '${units}'"
  is_uint "${agents}" || tooling "agents must be a non-negative integer, got '${agents}'"
  is_uint "${stages}" || tooling "stages must be a non-negative integer, got '${stages}'"
  (( units  >= 1 ))   || tooling "units=0 — a dispatch of nothing is not a dispatch"
  (( agents >= 1 ))   || tooling "agents=0 — a dispatch of nothing is not a dispatch"
  (( stages >= 1 ))   || tooling "stages=0 — the padding ceiling would be zero"
  [[ -d "${project}" ]] || tooling "project directory does not exist: ${project}"

  local ledger_md="${project}/CAPACITY-LEDGER.md"
  local plan_md="${project}/CONTROL/EXECUTION-PLAN.md"
  local state_json="${project}/CONTROL/project_state.json"

  [[ -f "${ledger_md}" ]] \
    || tooling "no Capacity Ledger at ${ledger_md} — CLIENT_CAP is UNDETERMINED (that file is the only source this gate reads; the environment is never one). Write it at step 6.5 with tools/width.sh."
  [[ -r "${ledger_md}" ]] || tooling "Capacity Ledger is unreadable: ${ledger_md}"

  local cap
  cap="$(parse_cap "${ledger_md}")" || cap=""
  [[ -n "${cap}" ]] \
    || tooling "CLIENT_CAP does not parse from ${ledger_md} — looked for 'CLIENT_CAP=<n>' and for a clientCap line ending in '= <n>'. An unfilled template placeholder is not a number; fill the ledger."
  is_uint "${cap}" || tooling "CLIENT_CAP parsed as non-integer '${cap}' from ${ledger_md}"
  (( cap >= 1 && cap <= 64 )) \
    || tooling "CLIENT_CAP=${cap} from ${ledger_md} is outside 1..64 — that is a mis-parse or a corrupt ledger, not a width"

  # --- Fail-closed precondition: no Parallelism Plan, no dispatch ------------
  has_parallelism_plan "${plan_md}" \
    || refuse "no 'Parallelism Plan' heading in ${plan_md} — no Parallelism Plan, no dispatch (references/execution-architecture.md). Write step 12.7's plan first; it is the document this dispatch has to cite."

  # --- The label (S3): every dispatch is labelled [<model> x<N>] -------------
  printf '%s' "${label}" | "${GREP}" -qE "${LABEL_RE}" \
    || refuse "label '${label}' does not carry ${LABEL_RE} — every dispatch row and every tree name states its seat and its count, e.g. '[Opus x10] build wave-2'. An unlabelled tree is an invisible worker."

  local label_n
  label_n="$(printf '%s' "${label}" | sed -n 's/.*\[[A-Za-z0-9.-]* x\([0-9][0-9]*\)\].*/\1/p' | head -n 1)"
  if [[ -n "${label_n}" ]] && (( label_n != agents )); then
    printf 'DISPATCH-CHECK WARNING | label says x%s but agents=%s — the tree name will not match what ran\n' "${label_n}" "${agents}" >&2
  fi

  # --- Fail-closed precondition: no over-engineering check, no builder ------
  # Ahead of the width arithmetic on purpose: a dispatch that should never fire
  # is refused before its shape is argued about.
  if is_build_label "${label}"; then
    local ledger_doc="${project}/CONTROL/LEDGER.md"
    if ! has_rightsize_line "${ledger_doc}"; then
      printf 'DISPATCH-CHECK NO-RIGHTSIZE | CONTROL/LEDGER.md carries no OVER-ENGINEERING-CHECK: line\n' >&2
      printf 'DISPATCH-CHECK NOTE | read: %s | run tools/right-size.sh %s first — it writes that line, and only on a pass (Law 42, SKILL.md step 13)\n' \
        "${ledger_doc}" "${project}" >&2
      exit 6
    fi

    # --- Fail-closed precondition: the conductor's own seat (RC-15) --------
    # Second, after the over-engineering line, so the existing refusal keeps its
    # order and this one is additive. Only the BUILD phase is gated: the
    # apparatus may be finished from any chair, and a judge dispatch is never
    # touched here.
    local seat_line seat_lane
    seat_line="$(last_seat_line "${ledger_doc}" || true)"
    if [[ -z "${seat_line}" ]]; then
      printf 'DISPATCH-CHECK WARNING | no CONDUCTOR-SEAT: line in %s — which lane the conductor is sitting in is UNRECORDED, which is not the same as proven wrong, so this build dispatch is NOT refused. Run tools/seat-check.sh <launcher> at step 2; it resolves the chair and SKILL.md section 2 writes the line.\n' \
        "${ledger_doc}" >&2
    else
      seat_lane="$(seat_lane_of "${seat_line}")"
      if [[ "${seat_lane}" != "opus" ]]; then
        printf 'DISPATCH-CHECK WRONG-SEAT | the newest CONDUCTOR-SEAT: line reads resolved=%s, not resolved=opus\n' \
          "${seat_lane:-NONE}" >&2
        printf 'DISPATCH-CHECK NOTE | read: %s | the conductor is not on the Opus lane, so the BUILD phase does not open (references/capacity.md section 11 seats the conductor on Opus). This is a PHASE GATE, not a stop: the apparatus work continues and the run says so in the ledger. The operator clears it by starting the session on the Opus lane; tools/seat-check.sh then records a newer CONDUCTOR-SEAT line and this dispatch fires. Nothing here writes a settings file.\n' \
          "${ledger_doc}" >&2
        exit 10
      fi
    fi
  fi

  # --- Fail-closed precondition: no step-20 audit gate, no builder ----------
  # Same shape as the block above and for the same reason. The audit gate is a
  # shipped, selftested instrument that the canary never ran, because nothing
  # refused a builder over its absence. This refuses it. It sits AFTER the
  # over-engineering gate so the step-13 omission is still reported as exit 6
  # rather than being masked by the step-20 one, and BEFORE the budget wall and
  # the width arithmetic, because a dispatch that should never fire is refused
  # before its shape is argued about.
  if is_build_label "${label}"; then
    local audit_doc="${project}/CONTROL/LEDGER.md"
    if ! has_audit_gate_line "${audit_doc}"; then
      printf 'DISPATCH-CHECK NO-AUDIT-GATE | CONTROL/LEDGER.md carries no AUDIT-GATE line\n' >&2
      printf 'DISPATCH-CHECK NOTE | read: %s | run tools/audit-gate.sh %s first (SKILL.md step 20). It writes "AUDIT-GATE | cycle=<n> | halt=<n> harm=<n> scope=<n> carry=<n> | verdict=<v>" through tools/ledger.sh on every run that reaches a verdict. A ledger that mentions an audit in prose has not run the gate, and a CARRY-only audit PASSES with its findings still open (references/gauntlet.md 7.1) — so this refusal is about the missing RUN, never about the findings.\n' \
        "${audit_doc}" "${project}" >&2
      exit 12
    fi
  fi

  # --- The state file is CREATED, not waited for (RC-23c) -------------------
  # Ahead of the budget wall on purpose: the wall reads five keys and refuses
  # (exit 2) when it cannot, which on the 2026-09-07 routed launcher would have
  # been every dispatch of the run. A run may not reach its first dispatch
  # without a state file, so the gate writes one rather than refusing forever.
  if [[ ! -e "${state_json}" ]]; then
    create_state_file "${state_json}" "${units}" \
      || tooling "could not create ${state_json} — the pause line, the ceiling and the executions counter have nowhere to live, and an undetermined budget never licences a dispatch"
    printf 'DISPATCH-CHECK NOTE | created %s with the canonical budget block (agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted, agents.ceiling — the five paths tools/state-check.sh validates), computed from units=%s. SKILL.md section 6 overwrites these with the numbers the run computes for itself; CONTROL/OPERATOR-OVERRIDE.json is read before them either way.\n' \
      "${state_json}" "${units}" >&2
  fi

  # --- Fail-closed precondition: the budget wall (RC-4b) --------------------
  # WI-31 reserved this point between the over-engineering gate above and the
  # width arithmetic below, and this is the block it reserved it for. The order
  # is the point: a dispatch that is past the pause line must not be argued
  # about on width — it must not fire at all, at any width.
  budget_gate "${state_json}" "${project}"

  # --- The floor (S4). The only number this skill controls. -----------------
  local floor="${units}"
  (( cap < floor )) && floor="${cap}"
  if (( agents < floor )); then
    if [[ -z "${dep}" ]]; then
      printf 'DISPATCH-CHECK UNDER-WIDTH | units=%s cap=%s floor=%s agents=%s | %s\n' \
        "${units}" "${cap}" "${floor}" "${agents}" \
        "pass every dispatchable unit: re-author this dispatch at ${floor} agents, or give the wave dependency that makes it narrower as dep=<reason> (a dependency is a reason; a hunch is not)." >&2
      exit 3
    fi
    printf 'DISPATCH-CHECK NOTE | narrower than the floor by a stated dependency | floor=%s agents=%s dep=%s\n' \
      "${floor}" "${agents}" "${dep}" >&2
  fi

  # --- The padding ceiling --------------------------------------------------
  local pad_ceiling=$(( units * stages ))
  if (( agents > pad_ceiling )); then
    printf 'DISPATCH-CHECK PADDED | units=%s stages=%s ceiling=%s agents=%s | %s\n' \
      "${units}" "${stages}" "${pad_ceiling}" "${agents}" \
      "more seats than the work has stages to put them in. Either the unit count is wrong (split the work into real units) or the agent count was inflated to clear the floor." >&2
    exit 5
  fi

  # --- It passes. Now it is recorded, before anything fires. -----------------
  [[ -x "${LEDGER_SH}" ]] \
    || tooling "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every project write goes through it, so an unlogged dispatch is refused rather than written unlocked"

  # --- The run id (RC-23a). Minted HERE, after every refusal, so a dispatch
  # that never fires never spends a number from CONTROL/.run-counter.
  if [[ -z "${run_id}" ]]; then
    local seq=""
    if [[ -z "${phase}" ]]; then phase="$(derive_phase "${label}" "${unit}")" || phase=""; fi
    if [[ -z "${phase}" ]]; then
      phase="pending"
      printf 'DISPATCH-CHECK NOTE | no phase= was given and neither the label nor the unit carries one of: %s. The id names the phase as "pending" (run=wf-pending-<NN>) rather than booking under a bare "pending" — pass phase=<word> to name it.\n' \
        "${PHASE_WORDS}" >&2
    fi
    seq="$(mint_run_seq "${project}")" \
      || tooling "could not mint a run id: ${project}/${RUN_COUNTER_REL} could not be read or written (or its lock could not be taken within 20s). A dispatch with no id is exactly the unbookable dispatch this gate exists to end, so nothing was written."
    run_id="wf-${phase}-${seq}"
    printf 'DISPATCH-CHECK NOTE | minted run=%s (phase=%s, counter=%s)\n' \
      "${run_id}" "${phase}" "${project}/${RUN_COUNTER_REL}" >&2
  fi

  local total=""
  if [[ -f "${state_json}" ]]; then
    acquire_state_lock "${state_json}" \
      || tooling "could not acquire ${state_json}.lock.d within 20s — inspect its owner file before removing it; the counter was NOT touched"
    total="$(bump_state "${state_json}" "${agents}")"
    if [[ $? -ne 0 || -z "${total}" ]]; then
      release_state_lock
      tooling "could not increment agents.executions_total in ${state_json}: ${total:-no detail}. Nothing was written; the dispatch is not gated."
    fi
    release_state_lock
  else
    # Unreachable on a healthy run: the block above created this file before the
    # budget wall read it. Reaching it means something removed the file mid-
    # dispatch, which is a fact about the RUN's disk, not a licence to write a
    # second, uncounted state file over the top of it.
    tooling "${state_json} was present at the budget wall and is gone now — something removed it mid-dispatch. Nothing was written and no dispatch is gated; re-run tools/state-check.sh ${project} and look at what is deleting CONTROL/."
  fi

  local ts row out rc
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [[ -n "${unit}" ]] || unit="${units}-units"
  row="${ts} | ${unit} | dispatch | ${label} | run=${run_id} | units=${units} | agents=${agents} | cap=${cap} | floor=${floor} | stages=${stages} | dep=${dep:-none} | executions_total=${total}"
  # cite= travels at the END of the row, verbatim. It is how a research dispatch
  # carries its two RESEARCH-READY citations (SKILL.md section 5) inside a row
  # this gate wrote, instead of the hand-written row RC-23(b) retires.
  [[ -z "${cite}" ]] || row="${row} | ${cite}"
  out="$("${LEDGER_SH}" "${project}" "CONTROL/dispatch-log.md" "${row}" 2>&1)"; rc=$?
  if (( rc != 0 )); then
    # Un-bump: the counter moved for a dispatch that has no row. A counter
    # ahead of the log is exactly the drift anchor.sh's budget audit exists to
    # catch, so it is put back rather than left to be discovered later.
    if [[ -f "${state_json}" ]]; then
      if acquire_state_lock "${state_json}"; then
        bump_state "${state_json}" "-${agents}" >/dev/null 2>&1 \
          || printf 'DISPATCH-CHECK WARNING | could not roll back agents.executions_total (+%s) in %s — reconcile it by hand against CONTROL/dispatch-log.md\n' "${agents}" "${state_json}" >&2
        release_state_lock
      fi
    fi
    tooling "ledger.sh failed (rc=${rc}) writing CONTROL/dispatch-log.md: ${out}"
  fi

  # --- THE CLAIM (RC-29c). Every booked dispatch writes the anti-drift
  #     contract's before-write for its unit, which feeds CONTROL/last-intents.txt
  #     through the writer that already exists in tools/ledger.sh (class 5's
  #     only input). No new file, no new shape: the line is anti-drift.md
  #     section 8's CLAIM shape verbatim. model= and plan= default off the
  #     dispatch itself — the bracket head of the label, and the label with
  #     that bracket stripped — so a caller that passes neither still writes a
  #     shaped line. The write rides AFTER the dispatch-log row: a refused
  #     dispatch books nothing and claims nothing. A CLAIM that cannot be
  #     written never fails the booking — the row above already landed, and a
  #     store that reports failure for work it did is the defect ledger.sh's
  #     verification was rebuilt to stop reporting. It says so on stderr.
  {
    local claim_model="${model}" claim_plan="${plan}" claim_agent claim_unit
    if [[ -z "$claim_model" ]]; then
      claim_model="$(printf '%s' "${label}" | sed -n 's/^[[:space:]]*\[\([^]]*\)\].*/\1/p' | sed -n 's/^\([A-Za-z0-9.-]*\)[[:space:]].*/\1/p' | head -n 1)"
      [[ -n "$claim_model" ]] || claim_model="unlabelled"
    fi
    if [[ -z "$claim_plan" ]]; then
      claim_plan="$(printf '%s' "${label}" | sed -e 's/^[[:space:]]*\[[^]]*\][[:space:]]*//' | tr -d '\n\r' | tr '|' '/' | cut -c1-160)"
      [[ -n "$claim_plan" ]] || claim_plan="${label}"
    fi
    claim_plan="$(printf '%s' "$claim_plan" | tr -d '\n\r' | tr '|' '/' | cut -c1-160)"
    claim_agent="$(printf '%s' "${label}" | tr -d '\n\r' | tr '|' '/' | cut -c1-160)"
    claim_unit="$(printf '%s' "${unit}" | tr -d '\n\r' | tr '|' '/' | cut -c1-160)"
    local claim_line claim_out claim_rc
    claim_line="$(date -u +%Y-%m-%dT%H:%M:%SZ) | CLAIM | unit=${claim_unit} | agent=${claim_agent} | model=${claim_model} | plan=${claim_plan}"
    set +e
    claim_out="$("${LEDGER_SH}" "${project}" "CONTROL/LEDGER.md" "${claim_line}" 2>&1)"; claim_rc=$?
    set -e
    if (( claim_rc != 0 )); then
      printf 'DISPATCH-CHECK WARNING | booked the dispatch row but could not write its CLAIM line (rc=%s: %s) — reconcile class 7 will report this unit unpaired until the claim is written; the booking stands\n' "${claim_rc}" "${claim_out}" >&2
    fi
  }

  # The override goes on the PASS line too, not only on the refusal. A dispatch
  # that was licensed against an operator-moved pause line must say so where the
  # row is read, or the override is silent on every turn it did not stop.
  printf 'DISPATCH-CHECK PASS | project=%s | units=%s | agents=%s | cap=%s | floor=%s | ceiling=%s | label=%s | dep=%s | executions_total=%s%s\n' \
    "${project}" "${units}" "${agents}" "${cap}" "${floor}" "${pad_ceiling}" "${label}" "${dep:-none}" "${total}" \
    "${OVERRIDE_TAG:+ | ${OVERRIDE_TAG}}"
  exit 0
}

# ============================================================================
# The selftest — the instrument proven before any verdict is believed
# ============================================================================
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [[ "$3" == "1" ]]; then printf 'PASS %-2s %-28s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-28s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

run_selftest() {
  local T
  T="$(mktemp -d "${TMPDIR:-/tmp}/dispatch-check-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "release_state_lock; rm -rf '${T}'" EXIT

  # The override variable is cleared before the first fixture and exported only
  # by the legs that mean to set it. A selftest that inherited an operator's own
  # SPEC_PROTOCOL_FIRST_PAUSE would report a wall it never proved.
  unset SPEC_PROTOCOL_FIRST_PAUSE

  # --- control 0: the greps, proven on a known positive first ---------------
  local kp_label kp_head
  kp_label="$(printf '%s' '[Opus x10] build wave-2' | "${GREP}" -cE "${LABEL_RE}")"
  printf '## 4. Parallelism Plan\n' > "${T}/kp.md"
  kp_head="$("${GREP}" -cE '^[[:space:]]*#{1,6}[[:space:]].*Parallelism Plan' "${T}/kp.md")"
  if [[ "${kp_label}" != "1" || "${kp_head}" != "1" ]]; then
    echo "BROKEN INSTRUMENT: the gate's own greps do not match their known-positive controls (label=${kp_label} want 1, heading=${kp_head} want 1). No verdict below can be believed." >&2
    exit 2
  fi
  report 0 "grep-controls" 1 "label known-positive=1, heading known-positive=1 (both on ${GREP})"

  # --- the canonical state file every fixture that DISPATCHES now needs ------
  # The budget wall reads four keys before the width arithmetic, and refuses
  # (exit 2, naming tools/state-check.sh) when it cannot read them. That is the
  # deliberate design — an unreadable budget never licences a dispatch — so
  # every fixture below that expects a width verdict carries the canonical
  # block written at the paths SKILL.md section 6 names.
  #   write_state <path> <executions_total> <first_pause> <blocks> <ceiling>
  write_state() {
    printf '{\n  "schema": "spec-protocol/project-state@1",\n  "run_status": "RUNNING",\n  "agents": {\n    "executions_total": %s,\n    "initial": 35,\n    "warn_at": 150,\n    "first_pause": %s,\n    "pause_blocks_granted": %s,\n    "ceiling": %s\n  }\n}\n' "$2" "$3" "$4" "$5" > "$1"
  }
  # read_state_total <path> — the same sed the report lines use, one place.
  read_state_total() {
    sed -n 's/.*"executions_total"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | head -n 1
  }

  # --- a project fixture ----------------------------------------------------
  local P="${T}/proj"
  mkdir -p "${P}/CONTROL"
  printf 'CLIENT_CAP=10\nBROWSER_CAP=12\nWORKFLOW_CEILING=50\n' > "${P}/CAPACITY-LEDGER.md"
  printf '# Execution plan\n\n## Parallelism Plan\n\nwave 2: 10 units, one tree.\n' > "${P}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P}/CONTROL/project_state.json" 0 200 0 2000
  # Every fixture below that dispatches a BUILD needs the over-engineering line
  # right-size.sh writes and the AUDIT-GATE line audit-gate.sh writes, or it is
  # refused with exit 6 or exit 12 before its width is ever read.
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=2 | verdict=PASS\n' >> "${P}/CONTROL/LEDGER.md"

  local rc out total ok
  read_total() { sed -n 's/.*"executions_total"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "${P}/CONTROL/project_state.json" | head -n 1; }

  # --- 1: 10 units at cap 10 with 10 agents → 0 -----------------------------
  out="$(bash "${SELF}" "${P}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  total="$(read_total)"
  ok=0; [[ "${rc}" == "0" && "${total}" == "10" ]] && ok=1
  report 1 "at-cap-passes" "${ok}" "rc=${rc} (want 0); executions_total 0 → ${total} (want 10 = the agent count); ${out}"

  # --- 2: 10 units with 3 agents and no dep= → 3 ----------------------------
  out="$(bash "${SELF}" "${P}" 10 3 '[Opus x3] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'UNDER-WIDTH' || ok=0
  report 2 "under-width-refused" "${ok}" "rc=${rc} (want 3); message names the floor: ${out}"

  # --- 2b: the counter did NOT move on a refusal ----------------------------
  total="$(read_total)"
  ok=0; [[ "${total}" == "10" ]] && ok=1
  report 3 "refusal-does-not-count" "${ok}" "executions_total still ${total} (want 10) — a refused dispatch never spends budget"

  # --- 3: 4 units with 40 agents → 5 ----------------------------------------
  out="$(bash "${SELF}" "${P}" 4 40 '[Opus x40] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "5" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'PADDED' || ok=0
  report 4 "padding-refused" "${ok}" "rc=${rc} (want 5; ceiling = 4 units × 4 stages = 16); ${out}"

  # --- 4: the dep= escape hatch ---------------------------------------------
  out="$(bash "${SELF}" "${P}" 10 3 '[Opus x3] build wave-2' 'dep=WI-04 must land before the other 7 units unblock' 2>&1)"; rc=$?
  total="$(read_total)"
  ok=0; [[ "${rc}" == "0" && "${total}" == "13" ]] && ok=1
  report 5 "dep-reason-allows" "${ok}" "rc=${rc} (want 0); executions_total 10 → ${total} (want 13)"

  # --- 5: the dispatch-log rows are shaped so anchor.sh can census them ------
  local rows
  rows="$("${GREP}" -cE '^[[:space:]]*(- )?[0-9]{4}-[0-9]{2}-[0-9]{2}[^|]*\|[^|]*\|' "${P}/CONTROL/dispatch-log.md" 2>/dev/null)"
  ok=0; [[ "${rows}" == "2" ]] && ok=1
  report 6 "rows-are-censusable" "${ok}" "anchor.sh's own dispatch-census regex counts ${rows} rows (want 2 — one per PASS, none for the two refusals)"

  # --- 6: a bad label is refused (exit 4) -----------------------------------
  out="$(bash "${SELF}" "${P}" 10 10 'Opus x10 build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  report 7 "bad-label-refused" "${ok}" "rc=${rc} (want 4) for a label with no [<model> x<N>]"

  # --- 7: no Parallelism Plan → exit 4 (fail-closed) ------------------------
  local P2="${T}/proj-noplan"
  mkdir -p "${P2}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P2}/CAPACITY-LEDGER.md"
  printf '# Execution plan\n\nno plan section here.\n' > "${P2}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P2}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  report 8 "no-plan-refused" "${ok}" "rc=${rc} (want 4); ${out}"

  # --- 8: the real ledger line shape parses to the same 10 ------------------
  local P3="${T}/proj-realledger"
  mkdir -p "${P3}/CONTROL"
  {
    printf '# CAPACITY LEDGER — fixture — 2026-09-07T00:00:00Z\n'
    printf 'Cores: 12 · RAM: 24 GB\n'
    printf 'clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n'
  } > "${P3}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P3}/CONTROL/EXECUTION-PLAN.md"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P3}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=2 | verdict=PASS\n' >> "${P3}/CONTROL/LEDGER.md"
  write_state "${P3}/CONTROL/project_state.json" 0 200 0 2000
  # 10 units and 9 agents DISCRIMINATES: it exits 3 only if the cap parsed as
  # 10. A mis-parse of 2 (the `max(2,` on that same line) would make the floor
  # 2, and 9 agents would sail through with exit 0.
  out="$(bash "${SELF}" "${P3}" 10 9 '[Opus x9] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  report 9 "template-line-parses" "${ok}" "rc=${rc} (want 3 — cap 10 read from the 'clientCap = … = 10 [MEASURED …]' line, floor = min(10,10) = 10 > 9 agents; a mis-parse to 2 would have exited 0); ${out}"

  # --- 8b: a refused dispatch spends no budget ------------------------------
  # This fixture carries the canonical budget block (the wall requires it before
  # any width verdict), so the proof is the COUNTER, not the file's absence: the
  # exit-3 refusal above must have left executions_total exactly where it was.
  local p3_total
  p3_total="$(read_state_total "${P3}/CONTROL/project_state.json")"
  ok=0; [[ "${p3_total}" == "0" ]] && ok=1
  report 10 "no-spend-on-refusal" "${ok}" "executions_total still ${p3_total} (want 0) after the under-width refusal — a refused dispatch never spends budget"

  # --- 9: an unfilled template placeholder is UNDETERMINED, never cap 2 -----
  local P4="${T}/proj-placeholder"
  mkdir -p "${P4}/CONTROL"
  printf 'clientCap = max(2, min(harness_cap, ram_cap)) = <k>   [MEASURED <instrument> <ISO8601>]\n' > "${P4}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n' > "${P4}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P4}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'CLIENT_CAP does not parse' || ok=0
  report 11 "placeholder-undetermined" "${ok}" "rc=${rc} (want 2, NOT a cap of 2 read out of max(2, …)); ${out}"

  # --- 10: a missing Capacity Ledger is a named tooling failure -------------
  local P5="${T}/proj-noledger"
  mkdir -p "${P5}/CONTROL"
  printf '## Parallelism Plan\n' > "${P5}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P5}" 10 10 '[Opus x10] build wave-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "${P5}/CAPACITY-LEDGER.md" || ok=0
  report 12 "missing-ledger-named" "${ok}" "rc=${rc} (want 2) and the message names the exact path it read"

  # --- 11: the negative control — a project that should NOT pass -----------
  out="$(bash "${SELF}" "${T}/does-not-exist" 10 10 '[Opus x10] x' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  report 13 "missing-project-named" "${ok}" "rc=${rc} (want 2) for a project directory that does not exist"

  # --- 12: the no-python3 fallback increments the same counter --------------
  local P6="${T}/proj-awk"
  mkdir -p "${P6}/CONTROL"
  printf 'CLIENT_CAP=4\n' > "${P6}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n' > "${P6}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P6}/CONTROL/project_state.json" 7 200 0 2000
  out="$(DISPATCH_NO_PYTHON=1 bash "${SELF}" "${P6}" 4 4 '[Sonnet x4] judge wave-2' 2>&1)"; rc=$?
  local awk_total
  awk_total="$(read_state_total "${P6}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${awk_total}" == "11" ]] && ok=1
  report 14 "awk-fallback-counts" "${ok}" "rc=${rc} (want 0) with python3 forced off; executions_total 7 → ${awk_total} (want 11)"

  # --- 13: the exit-6 pair — ONE build fixture, both halves ----------------
  # A refusal that fired for every build dispatch would look identical to a
  # working gate from the failing half alone. The same fixture is therefore run
  # twice, with the OVER-ENGINEERING-CHECK: line the only thing that changes.
  local P7="${T}/proj-rightsize"
  mkdir -p "${P7}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P7}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P7}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P7}/CONTROL/project_state.json" 0 200 0 2000

  out="$(bash "${SELF}" "${P7}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "6" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'NO-RIGHTSIZE | CONTROL/LEDGER.md carries no OVER-ENGINEERING-CHECK: line' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${P7}/CONTROL/LEDGER.md" || ok=0
  local p7_total
  p7_total="$(read_state_total "${P7}/CONTROL/project_state.json")"
  [[ "${p7_total}" == "0" ]] || ok=0
  report 15 "no-rightsize-refused" "${ok}" "rc=${rc} (want 6) for a build dispatch with no OVER-ENGINEERING-CHECK: line; the message names the exact path read and no counter moved (executions_total still ${p7_total}, want 0)"

  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P7}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=2 | verdict=PASS\n' >> "${P7}/CONTROL/LEDGER.md"
  out="$(bash "${SELF}" "${P7}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  report 16 "rightsize-line-allows" "${ok}" "rc=${rc} (want 0) — the SAME dispatch, on the SAME fixture, with the ledger line added and nothing else changed. This half is what proves exit 6 is a fact about the missing line and not a class-wide refusal of build dispatches; ${out}"

  # --- 14: THE BUDGET WALL — three legs on ONE fixture (RC-4b) --------------
  # One fixture, three answers. A run where all three legs return the same code
  # is a broken test, not a finding: the pass leg proves the wall is not a
  # class-wide refusal of dispatches, the refusal leg proves it stands, and the
  # granted-block leg proves the wall MOVES rather than being a fixed number.
  local P8="${T}/proj-pause"
  mkdir -p "${P8}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P8}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P8}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P8}/CONTROL/project_state.json" 19 20 0 2000

  local p8_total
  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  p8_total="$(read_state_total "${P8}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p8_total}" == "20" ]] && ok=1
  report 17 "under-the-pause-passes" "${ok}" "rc=${rc} (want 0) at executions_total=19 against first_pause=20; the pass moved the counter 19 → ${p8_total} (want 20), which is what puts the SAME fixture on the far side of the line for the next leg"

  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "7" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK PAUSED | executions=20 | pause_at=20 | ceiling=2000' || ok=0
  p8_total="$(read_state_total "${P8}/CONTROL/project_state.json")"
  [[ "${p8_total}" == "20" ]] || ok=0
  report 18 "at-the-pause-refused" "${ok}" "rc=${rc} (want 7) on the SAME fixture one execution later; the line names pause_at=20 and the counter did not move (${p8_total}, want 20): ${out}"

  write_state "${P8}/CONTROL/project_state.json" 20 20 1 2000
  out="$(bash "${SELF}" "${P8}" 1 1 '[Sonnet x1] judge unit-3' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  report 19 "granted-block-moves-the-wall" "${ok}" "rc=${rc} (want 0) at the SAME executions_total=20 with agents.pause_blocks_granted=1 — the wall is 20 × (1+1) = 40, so a granted block resumes the run at full width rather than raising a new number"

  # --- 15: the ceiling outranks the pause -----------------------------------
  # At the ceiling a run is ALSO past its pause line. Reporting that as a pause
  # would leave a project able to answer "keep going" past a line it can never
  # cross, so the ceiling is tested first — as tools/anchor.sh tests it first.
  local P9="${T}/proj-ceiling"
  mkdir -p "${P9}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P9}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P9}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P9}/CONTROL/project_state.json" 2000 20 0 2000
  out="$(bash "${SELF}" "${P9}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "8" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK CEILING | executions=2000 | ceiling=2000' || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK PAUSED'; then ok=0; fi
  report 20 "ceiling-outranks-pause" "${ok}" "rc=${rc} (want 8, NOT 7) at executions_total=2000 against ceiling=2000 and a pause line it is also past; the output says CEILING and never PAUSED"

  # --- 16: no budget keys is UNDETERMINED, never a pass ---------------------
  local P10="${T}/proj-nobudget"
  mkdir -p "${P10}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P10}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P10}/CONTROL/EXECUTION-PLAN.md"
  printf '{\n  "schema": "spec-protocol/project-state@1",\n  "agents": { "executions_total": 5 }\n}\n' > "${P10}/CONTROL/project_state.json"
  out="$(bash "${SELF}" "${P10}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'tools/state-check.sh' || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'agents.first_pause' || ok=0
  local p10_total
  p10_total="$(read_state_total "${P10}/CONTROL/project_state.json")"
  [[ "${p10_total}" == "5" ]] || ok=0
  report 21 "no-budget-keys-undetermined" "${ok}" "rc=${rc} (want 2, NEVER 0) for a state file carrying executions_total alone; the message names tools/state-check.sh and every missing key, and the counter did not move (${p10_total}, want 5): ${out}"

  # --- 17: no state file at all — the gate CREATES one (RC-23c) -------------
  # This case is the inverse of what it asserted before wave 7. It used to
  # prove the gate refused (exit 2) and seeded nothing. RC-23 measured what
  # that produced on the routed launcher: no state file was ever written by
  # anything, so the pause line, the ceiling and CONTROL/OPERATOR-OVERRIDE.json
  # had nowhere to live and no dispatch could be measured. The gate now writes
  # the canonical block itself, and tools/state-check.sh — the instrument that
  # owns that schema — is what says the file is right, not this script's
  # opinion of its own output.
  local P11="${T}/proj-nostate"
  mkdir -p "${P11}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P11}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P11}/CONTROL/EXECUTION-PLAN.md"
  out="$(bash "${SELF}" "${P11}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  [[ -f "${P11}/CONTROL/project_state.json" ]] || ok=0
  printf '%s' "${out}" | "${GREP}" -q "created ${P11}/CONTROL/project_state.json" || ok=0
  local p11_total sc_rc=127 sc_out="state-check.sh not run"
  p11_total="$(read_state_total "${P11}/CONTROL/project_state.json")"
  [[ "${p11_total}" == "1" ]] || ok=0
  if [[ -f "${SCRIPT_DIR}/state-check.sh" ]]; then
    sc_out="$(bash "${SCRIPT_DIR}/state-check.sh" "${P11}" 2>&1)"; sc_rc=$?
  else
    sc_out="BROKEN INSTRUMENT: ${SCRIPT_DIR}/state-check.sh is absent, so the created file's schema is UNDETERMINED"
  fi
  [[ "${sc_rc}" == "0" ]] || ok=0
  report 22 "no-state-file-is-created" "${ok}" "rc=${rc} (want 0) when CONTROL/project_state.json does not exist: the gate CREATED it (note names the path), the counter starts at this dispatch (executions_total=${p11_total}, want 1), and tools/state-check.sh scores the created file rc=${sc_rc} (want 0): ${sc_out}"

  # --- 18: THE OPERATOR OVERRIDE — five legs on ONE fixture (WI-35) ---------
  # The fixture says first_pause=200 and executions_total=20, which is a run
  # comfortably under its own pause line. Every leg below changes ONLY where
  # first_pause comes from, so the pass/fail split is attributable to the
  # override and to nothing else. A run where every leg answers alike is a
  # broken test, not a finding.
  local P12="${T}/proj-override"
  mkdir -p "${P12}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P12}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P12}/CONTROL/EXECUTION-PLAN.md"
  local ovf="${P12}/CONTROL/OPERATOR-OVERRIDE.json"
  local p12_total

  # (a) THE CONTROL FIRST: the same fixture with no override at all.
  write_state "${P12}/CONTROL/project_state.json" 20 200 0 2000
  out="$(bash "${SELF}" "${P12}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  if printf '%s' "${out}" | "${GREP}" -q 'override='; then ok=0; fi
  report 23 "no-override-passes" "${ok}" "rc=${rc} (want 0) at executions_total=20 against agents.first_pause=200 and NO override file and NO variable; no override= token anywhere. This is the half that proves the legs below are moved by the override and not by a broken gate: ${out}"

  # (b) THE FILE: the same numbers, first_pause overridden to 20 → rc 7.
  write_state "${P12}/CONTROL/project_state.json" 20 200 0 2000
  printf '{"first_pause": 20, "set_by": "operator", "reason": "canary proof D"}\n' > "${ovf}"
  out="$(bash "${SELF}" "${P12}" 1 1 '[Sonnet x1] judge unit-2' 2>&1)"; rc=$?
  p12_total="$(read_state_total "${P12}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "7" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCH-CHECK PAUSED | executions=20 | pause_at=20' || ok=0
  printf '%s' "${out}" | "${GREP}" -qE 'override=first_pause:20\(source=.*/CONTROL/OPERATOR-OVERRIDE\.json\)' || ok=0
  [[ "${p12_total}" == "20" ]] || ok=0
  report 24 "override-file-pauses" "${ok}" "rc=${rc} (want 7) on the SAME fixture with CONTROL/OPERATOR-OVERRIDE.json setting first_pause=20 over the state file's 200; the line carries pause_at=20 and override=first_pause:20(source=<the file>), and the counter did not move (${p12_total}, want 20): ${out}"

  # (c) THE VARIABLE alone, no file → the same wall, the variable named.
  rm -f "${ovf}"
  export SPEC_PROTOCOL_FIRST_PAUSE=20
  out="$(bash "${SELF}" "${P12}" 1 1 '[Sonnet x1] judge unit-3' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "7" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'override=first_pause:20(source=env:SPEC_PROTOCOL_FIRST_PAUSE)' || ok=0
  report 25 "override-env-pauses" "${ok}" "rc=${rc} (want 7) with SPEC_PROTOCOL_FIRST_PAUSE=20 and NO override file — the headless driver's path — and the line names env:SPEC_PROTOCOL_FIRST_PAUSE as the source: ${out}"

  # (d) BOTH, disagreeing: file 20, variable 50. The FILE must win.
  printf '{"first_pause": 20, "set_by": "operator", "reason": "canary proof D"}\n' > "${ovf}"
  export SPEC_PROTOCOL_FIRST_PAUSE=50
  out="$(bash "${SELF}" "${P12}" 1 1 '[Sonnet x1] judge unit-4' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "7" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'pause_at=20' || ok=0
  printf '%s' "${out}" | "${GREP}" -qE 'override=first_pause:20\(source=.*/CONTROL/OPERATOR-OVERRIDE\.json\)' || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'override=first_pause:50'; then ok=0; fi
  report 26 "file-wins-over-variable" "${ok}" "rc=${rc} (want 7) with the file at 20 and SPEC_PROTOCOL_FIRST_PAUSE=50 disagreeing: the emitted line names the FILE as the source and the arithmetic is pause_at=20, never 50: ${out}"
  unset SPEC_PROTOCOL_FIRST_PAUSE

  # (e) MALFORMED — nested, the shape jnum resolves unpredictably. Exit 2,
  #     never 0: an override that cannot be honoured is never quietly ignored.
  printf '{"first_pause": {"value": 20}, "set_by": "operator"}\n' > "${ovf}"
  out="$(bash "${SELF}" "${P12}" 1 1 '[Sonnet x1] judge unit-5' 2>&1)"; rc=$?
  p12_total="$(read_state_total "${P12}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'MALFORMED OPERATOR OVERRIDE' || ok=0
  [[ "${p12_total}" == "20" ]] || ok=0
  report 27 "malformed-override-undetermined" "${ok}" "rc=${rc} (want 2, NEVER 0) for a nested first_pause; the message says MALFORMED OPERATOR OVERRIDE and names the path, and the counter did not move (${p12_total}, want 20): ${out}"
  rm -f "${ovf}"

  # --- 19: THE CONDUCTOR'S SEAT — four legs on ONE fixture (RC-15) ----------
  # One fixture, four answers, and the SPLIT is what makes this a test rather
  # than a claim. (a) No CONDUCTOR-SEAT line at all PASSES: a run that predates
  # tools/seat-check.sh must still build, so absence is a WARNING naming the
  # missing line and never a refusal. (b) The same build dispatch under a
  # resolved=sonnet line exits 10 and spends nothing. (c) A JUDGE dispatch under
  # that SAME sonnet line still passes, which is what proves the gate reads the
  # BUILD phase and is not a class-wide refusal. (d) A newer resolved=opus line
  # opens the build phase again — the operator's cure, proven rather than
  # promised. A run where all four legs answer alike is a broken test.
  local P13="${T}/proj-seat"
  mkdir -p "${P13}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P13}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P13}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P13}/CONTROL/project_state.json" 0 200 0 2000
  # --- 20: THE STEP-20 AUDIT GATE — four legs on ONE fixture (RC-24 A) ------
  # The fixture carries the OVER-ENGINEERING-CHECK: line from the start, so the
  # exit-6 gate is satisfied throughout and every answer below is attributable
  # to the AUDIT-GATE line and to nothing else. The four legs are, in order: no
  # AUDIT-GATE line at all; a ledger that says the word "audit" in prose and
  # nothing more; the canonical AUDIT-GATE line added and nothing else changed;
  # and a NON-build dispatch against the bare ledger. A gate that answered all
  # four alike would be a broken test, not a finding.
  local P15="${T}/proj-auditgate"
  mkdir -p "${P15}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P15}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P15}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P15}/CONTROL/project_state.json" 0 200 0 2000
  local seatled="${P13}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${seatled}"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=0 | verdict=PASS\n' >> "${seatled}"
  local p13_total

  # (a) THE CONTROL FIRST: no seat line at all → PASS, with the line named.
  out="$(bash "${SELF}" "${P13}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  p13_total="$(read_state_total "${P13}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p13_total}" == "10" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'WARNING | no CONDUCTOR-SEAT: line' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${seatled}" || ok=0
  report 28 "no-seat-line-warns-only" "${ok}" "rc=${rc} (want 0) for a build dispatch with NO CONDUCTOR-SEAT: line at all — a run predating seat-check.sh still builds; the warning names the missing line and the exact path read, and the counter moved 0 → ${p13_total} (want 10)"

  # (b) THE REFUSAL: the identical dispatch under a resolved=sonnet line.
  printf 'CONDUCTOR-SEAT: expected=opus resolved=sonnet launcher=claude-nine source=session-env\n' >> "${seatled}"
  out="$(bash "${SELF}" "${P13}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "10" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'WRONG-SEAT | the newest CONDUCTOR-SEAT: line reads resolved=sonnet, not resolved=opus' || ok=0
  p13_total="$(read_state_total "${P13}/CONTROL/project_state.json")"
  [[ "${p13_total}" == "10" ]] || ok=0
  report 29 "wrong-seat-refuses-build" "${ok}" "rc=${rc} (want 10) on the SAME fixture with only a resolved=sonnet CONDUCTOR-SEAT: line added; the message names the lane it read, and a refused dispatch spends nothing (counter still ${p13_total}, want 10): ${out}"

  # (c) THE PHASE CONTROL: a JUDGE dispatch under that same sonnet line passes.
  out="$(bash "${SELF}" "${P13}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  p13_total="$(read_state_total "${P13}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p13_total}" == "11" ]] && ok=1
  if printf '%s' "${out}" | "${GREP}" -q 'WRONG-SEAT'; then ok=0; fi
  report 30 "wrong-seat-gates-build-only" "${ok}" "rc=${rc} (want 0) for a JUDGE dispatch under the SAME resolved=sonnet line — exit 10 is a BUILD-phase gate, so the apparatus and the judging continue from the wrong chair — and the counter moved 10 → ${p13_total} (want 11)"

  # (d) THE CURE: a newer resolved=opus line, and the build phase opens again.
  printf 'CONDUCTOR-SEAT: expected=opus resolved=opus launcher=claude-nine source=session-env\n' >> "${seatled}"
  out="$(bash "${SELF}" "${P13}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  p13_total="$(read_state_total "${P13}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p13_total}" == "21" ]] && ok=1
  if printf '%s' "${out}" | "${GREP}" -q 'WRONG-SEAT'; then ok=0; fi
  report 31 "newer-opus-line-clears-it" "${ok}" "rc=${rc} (want 0) with a NEWER resolved=opus line appended BELOW the sonnet one: the newest line is the only one that counts, which is exactly the operator's cure, and the counter moved 11 → ${p13_total} (want 21): ${out}"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=10 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P15}/CONTROL/LEDGER.md"

  # (a) no AUDIT-GATE line → rc 12, the path named, no budget spent.
  out="$(bash "${SELF}" "${P15}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  local p15_total
  p15_total="$(read_state_total "${P15}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "12" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'NO-AUDIT-GATE | CONTROL/LEDGER.md carries no AUDIT-GATE line' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${P15}/CONTROL/LEDGER.md" || ok=0
  [[ "${p15_total}" == "0" ]] || ok=0
  report 32 "no-audit-gate-refused" "${ok}" "rc=${rc} (want 12) for a build dispatch whose CONTROL/LEDGER.md carries no AUDIT-GATE line; the message names the exact path read and no counter moved (executions_total still ${p15_total}, want 0)"

  # (b) THE DISCRIMINATING CONTROL FOR A WORD-SEARCH: the ledger now says the
  #     word "audit" — twice, in prose, including the literal string AUDIT — and
  #     the gate must STILL refuse. An implementation that greps for the word
  #     rather than the line shape passes leg (a) and fails here.
  {
    printf 'AUDIT-CYCLE: 1\n'
    printf '2026-09-08T00:03:00Z | the apparatus audit ran and the AUDIT notes are in QUALITY-CONTROL/\n'
  } >> "${P15}/CONTROL/LEDGER.md"
  out="$(bash "${SELF}" "${P15}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  local audit_words
  audit_words="$("${GREP}" -ci audit "${P15}/CONTROL/LEDGER.md")"
  ok=0; [[ "${rc}" == "12" ]] && ok=1
  [[ "${audit_words}" -ge 2 ]] || ok=0
  report 33 "prose-audit-still-refused" "${ok}" "rc=${rc} (want 12) on a ledger whose own control count says ${audit_words} line(s) contain the word 'audit' (want >= 2, including an AUDIT-CYCLE: line) — the gate matches the LINE SHAPE, so a word-search implementation passes leg (a) and fails this one"

  # (c) the canonical line added, nothing else changed → rc 0.
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=2 | verdict=PASS\n' >> "${P15}/CONTROL/LEDGER.md"
  out="$(bash "${SELF}" "${P15}" 10 10 '[Opus x10] build wave-1' 2>&1)"; rc=$?
  p15_total="$(read_state_total "${P15}/CONTROL/project_state.json")"
  ok=0; [[ "${rc}" == "0" && "${p15_total}" == "10" ]] && ok=1
  report 34 "audit-gate-line-allows" "${ok}" "rc=${rc} (want 0) on the SAME fixture with 'AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=2 | verdict=PASS' added and nothing else changed — carry=2 with a PASS verdict, the CARRY-only outcome references/gauntlet.md 7.1 requires the gate to allow; executions_total 0 -> ${p15_total} (want 10). This half is what proves exit 12 is a fact about the missing line and not a class-wide refusal of build dispatches"

  # (d) a NON-build dispatch against a bare ledger passes: the gate is scoped to
  #     the build phase, exactly as exit 6 is.
  local P16="${T}/proj-auditgate-judge"
  mkdir -p "${P16}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P16}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P16}/CONTROL/EXECUTION-PLAN.md"
  write_state "${P16}/CONTROL/project_state.json" 0 200 0 2000
  printf '# Ledger\n\nENTRY-MODE: interview\n' > "${P16}/CONTROL/LEDGER.md"
  out="$(bash "${SELF}" "${P16}" 1 1 '[Sonnet x1] judge unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  report 35 "non-build-not-audit-gated" "${ok}" "rc=${rc} (want 0) for a JUDGE dispatch on a ledger with no AUDIT-GATE line and no OVER-ENGINEERING-CHECK line — the step-20 gate is a BUILD-phase refusal, so it must not fire here: ${out}"
  # --- 21: THE RUN ID IS MINTED, and counts (RC-23a) ------------------------
  # A fresh fixture, because the point is the FIRST two ids a project ever mints.
  local P17="${T}/proj-mint"
  mkdir -p "${P17}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P17}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P17}/CONTROL/EXECUTION-PLAN.md"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=1 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P17}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=0 | verdict=PASS\n' >> "${P17}/CONTROL/LEDGER.md"
  printf 'CONDUCTOR-SEAT: expected=opus resolved=opus launcher=claude-nine source=session-env\n' >> "${P17}/CONTROL/LEDGER.md"
  write_state "${P17}/CONTROL/project_state.json" 0 200 0 2000
  local mlog="${P17}/CONTROL/dispatch-log.md"

  out="$(bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-1' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  "${GREP}" -q 'run=wf-build-01' "${mlog}" 2>/dev/null || ok=0
  report 36 "run-id-minted-01" "${ok}" "rc=${rc} (want 0) with NO run= argument at all; the row in ${mlog} carries the literal run=wf-build-01, minted from the label's phase word and ${P17}/${RUN_COUNTER_REL}: ${out}"

  out="$(bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-2' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  "${GREP}" -q 'run=wf-build-02' "${mlog}" 2>/dev/null || ok=0
  report 37 "run-id-minted-02" "${ok}" "rc=${rc} (want 0); the SECOND dispatch on the SAME fixture carries run=wf-build-02 — the counter advanced rather than repeating an id: ${out}"

  # --- 22: A CALLER-SUPPLIED id is CHECKED — the pass leg first -------------
  # The control half. Without it, a gate that refused every caller-supplied id
  # would look identical to a gate that catches a forward-stamped one.
  local past_id future_id nowstamp
  nowstamp="$(date -u +%Y%m%dT%H%M%SZ)"
  past_id="wf-build-$(date -u -v-1d +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -d '1 day ago' +%Y%m%dT%H%M%SZ 2>/dev/null || printf '20200101T000000Z')"
  future_id="wf-build-$(date -u -v+30M +%Y%m%dT%H%M%SZ 2>/dev/null || date -u -d '+30 minutes' +%Y%m%dT%H%M%SZ 2>/dev/null || printf '%s%s' "$(( ${nowstamp:0:4} + 1 ))" "${nowstamp:4}")"

  out="$(bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-3' "run=${past_id}" 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  "${GREP}" -q "run=${past_id}" "${mlog}" 2>/dev/null || ok=0
  report 38 "past-run-id-accepted" "${ok}" "rc=${rc} (want 0) for run=${past_id}, a well-shaped id stamped BEFORE this machine's clock (${nowstamp}); it is written to the log as given. This is the control for the refusal below: ${out}"

  # --- 23: THE DISCRIMINATING CASE — a forward-stamped id is REFUSED --------
  local rows_before rows_after
  rows_before="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  out="$(bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-4' "run=${future_id}" 2>&1)"; rc=$?
  rows_after="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'LATER than this machine' || ok=0
  [[ "${rows_before}" == "${rows_after}" ]] || ok=0
  report 39 "future-run-id-refused" "${ok}" "rc=${rc} (want 4, NEVER 0) for run=${future_id} against a clock reading ${nowstamp}; the message says the id is LATER than the machine's clock and the log did not grow (${rows_before} rows before, ${rows_after} after). An implementation that mints correctly but still trusts a caller-supplied id passes case 28 and fails HERE — this is the leg that would have caught the 2026-09-07 55-minute forward skew: ${out}"

  # --- 23b: THE CANARY'S OWN ID, on the day it was written ------------------
  # Case 31 dates its id forward from whatever clock the test runs on, which is
  # the general rule. This leg is the SPECIFIC one: the canary's literal id,
  # `wf-build-20260908T1410Z`, against a reference clock of 2026-09-08T13:14Z —
  # a 56-minute forward skew, the thing that actually happened. It is
  # reproducible on any date because reference_now() honours
  # SPEC_PROTOCOL_NOW_UTC only when it moves the clock BACKWARDS.
  local canary_id="wf-build-20260908T1410Z"
  rows_before="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  out="$(SPEC_PROTOCOL_NOW_UTC=20260908T131400Z bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-5' "run=${canary_id}" 2>&1)"; rc=$?
  rows_after="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'LATER than this machine' || ok=0
  [[ "${rows_before}" == "${rows_after}" ]] || ok=0
  report 40 "canary-forward-skew-refused" "${ok}" "rc=${rc} (want 4, NEVER 0) for the canary's literal run=${canary_id} against a reference clock of 20260908T131400Z — the 56-minute forward skew of 2026-09-08, refused, and the log did not grow (${rows_before} rows before, ${rows_after} after): ${out}"

  # --- 23c: the injection can only TIGHTEN — the anti-bypass control --------
  # Without this leg SPEC_PROTOCOL_NOW_UTC would be a hole: a caller could set
  # it forward and walk any id through. It is honoured only when EARLIER than
  # the real clock, so a forward value is ignored and the refusal still fires.
  rows_before="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  out="$(SPEC_PROTOCOL_NOW_UTC=20991231T235959Z bash "${SELF}" "${P17}" 1 1 '[Opus x1] build unit-6' "run=${future_id}" 2>&1)"; rc=$?
  rows_after="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  ok=0; [[ "${rc}" == "4" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'may only move the reference clock BACKWARDS' || ok=0
  [[ "${rows_before}" == "${rows_after}" ]] || ok=0
  report 41 "forward-clock-injection-ignored" "${ok}" "rc=${rc} (want 4, NEVER 0) for run=${future_id} with SPEC_PROTOCOL_NOW_UTC set to 20991231T235959Z: the variable is IGNORED because it is later than the real clock, the gate says so, and the log did not grow (${rows_before} rows before, ${rows_after} after). This is what stops the test hook from being a bypass: ${out}"

  # --- 24: a RESEARCH dispatch books like every other one (RC-23b) ----------
  out="$(bash "${SELF}" "${P17}" 1 1 '[Haiku x1] reader — three competitor sites' \
        'unit=research website' \
        'cite=BUILD-TARGET: website | INPUT-CAPTURED: 00-INPUT/brainstorm-verbatim.md' 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  "${GREP}" -q 'run=wf-research-' "${mlog}" 2>/dev/null || ok=0
  "${GREP}" -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*research website.*agents=1' "${mlog}" 2>/dev/null || ok=0
  "${GREP}" -q 'BUILD-TARGET: website | INPUT-CAPTURED: 00-INPUT/brainstorm-verbatim.md' "${mlog}" 2>/dev/null || ok=0
  report 42 "research-dispatch-books" "${ok}" "rc=${rc} (want 0) for a reader dispatch at agents=1: the row carries agents=1, a minted run=wf-research-NN, and both RESEARCH-READY citations passed through cite= — the hand-written research row format is retired, which is what closes PROOF M's gap without loosening its tolerance-zero rule: ${out}"

  # --- 25: EVERY row this gate wrote carries agents= ------------------------
  # The measurement RC-23 made on the run: corner-post-framing's log had 6 rows
  # and zero carried agents=, which is how it was proven that not one dispatch
  # went through this gate. On a log this gate wrote, the two counts are equal.
  local all_rows agents_rows
  all_rows="$("${GREP}" -cE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' "${mlog}" 2>/dev/null || printf '0')"
  agents_rows="$("${GREP}" -c 'agents=' "${mlog}" 2>/dev/null || printf '0')"
  ok=0; [[ "${all_rows}" == "${agents_rows}" ]] && (( all_rows >= 4 )) && ok=1
  report 43 "every-row-carries-agents" "${ok}" "${mlog}: ${all_rows} timestamped rows, ${agents_rows} carrying agents= (want equal, and at least 4 rows so the equality is not vacuous)"

  # --- 26: THE CLAIM (RC-29c). One booked dispatch appends exactly one line
  #     to CONTROL/last-intents.txt — through the writer that already exists
  #     in tools/ledger.sh, not a new mechanism. The count before and after
  #     is the discrimination: a gate that books without claiming passes every
  #     case above and fails here.
  local P18="${T}/proj-claim"
  mkdir -p "${P18}/CONTROL"
  printf 'CLIENT_CAP=10\n' > "${P18}/CAPACITY-LEDGER.md"
  printf '## Parallelism Plan\n\nwave 1.\n' > "${P18}/CONTROL/EXECUTION-PLAN.md"
  printf '2026-09-08T00:00:00Z | OVER-ENGINEERING-CHECK: units=1 apparatus_kb=40 budget_kb=60 removed=0 verdict=PASS\n' > "${P18}/CONTROL/LEDGER.md"
  printf '2026-09-08T00:05:00Z | AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=0 | verdict=PASS\n' >> "${P18}/CONTROL/LEDGER.md"
  printf 'CONDUCTOR-SEAT: expected=opus resolved=opus launcher=claude-nine source=session-env\n' >> "${P18}/CONTROL/LEDGER.md"
  write_state "${P18}/CONTROL/project_state.json" 0 200 0 2000
  local int_before int_after int_last
  if [[ -f "${P18}/CONTROL/last-intents.txt" ]]; then
    int_before="$(wc -l < "${P18}/CONTROL/last-intents.txt" | tr -d ' ')"
  else
    int_before="0"
  fi
  out="$(bash "${SELF}" "${P18}" 1 1 '[Opus x1] build unit-9' 'plan=land the parser' 2>&1)"; rc=$?
  if [[ -f "${P18}/CONTROL/last-intents.txt" ]]; then
    int_after="$(wc -l < "${P18}/CONTROL/last-intents.txt" | tr -d ' ')"
  else
    int_after="0"
  fi
  int_last="$(tail -n 1 "${P18}/CONTROL/last-intents.txt" 2>/dev/null || true)"
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  [[ "${int_before}" == "0" ]] || ok=0
  [[ "${int_after}" == "1" ]] || ok=0
  [[ "${int_last}" == "land the parser" ]] || ok=0
  "${GREP}" -qE '\| CLAIM \| unit=1-units \| agent=\[Opus x1\] build unit-9 \| model=Opus \| plan=land the parser' "${P18}/CONTROL/LEDGER.md" 2>/dev/null || ok=0
  report 44 "claim-feeds-last-intents" "${ok}" "rc=${rc} (want 0); CONTROL/last-intents.txt ${int_before} -> ${int_after} lines (want 0 -> 1) with last line [${int_last}] (want [land the parser]); the ledger carries the shaped CLAIM line for unit=1-units"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'dispatch-check.sh selftest: ALL PASS (45 checks)\n'
    exit 0
  fi
  printf 'dispatch-check.sh selftest: %s FAILED — this gate is a BROKEN INSTRUMENT; do the width arithmetic by hand and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_check "$@" ;;
esac
