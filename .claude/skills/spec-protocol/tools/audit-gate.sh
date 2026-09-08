#!/usr/bin/env bash
# audit-gate.sh — THE STEP-20 APPARATUS AUDIT GATE (RC-1; wave-6 work item WI-30).
#
# Usage:
#   audit-gate.sh <project> [findings=<path>]
#   audit-gate.sh --selftest
#   audit-gate.sh --help
#
# WHAT IT IS FOR. SKILL.md step 20 used to end "Any FAIL → fix, re-judge,
# repeat; hand over only on a PASS." That loop has no cap, no severity and no
# carry mechanism, so it ran on literal document shape until the run died in
# it: four cycles, 17 → 23 → 29 → 28 findings, five of eight workflow trees
# spent on the audit and its fixes, and not one builder ever dispatched.
# Thirteen of the seventeen cycle-1 blockers were paperwork conformance.
#
# This is the instrument that ends it. The audit is now BOUNDED — one fix pass
# dispatched as a workflow, one re-judge, two cycles at most — and this script
# is what decides the outcome. It counts the auditor's findings by severity
# class and answers in an exit code. Only HALT, HARM and SCOPE stop a builder;
# everything else is CARRY, logged and carried into the build as a named work
# item. The classes are defined in references/gauntlet.md §7.1, which also
# fixes the finding-line shape this script reads:
#
#   HALT  | <unit or document> | <what is wrong, in one sentence>
#   HARM  | <unit or document> | <the exposure>
#   SCOPE | <unit or document> | <the unratified feature>
#   CARRY | <unit or document> | <the defect, and which unit will absorb it>
#
# A finding line opens with its class at the start of the line. An optional
# list marker (- or *), an optional table pipe, and optional ** bold markers
# are tolerated; the class is then followed by | or :. Nothing else on the
# line is parsed, and a class word in the middle of a sentence is not a
# finding.
#
# INPUTS, all read from disk and all named when they are missing:
#   <project>/QUALITY-CONTROL/AUDIT-FINDINGS.md   the findings (findings=<path> overrides)
#   <project>/CONTROL/LEDGER.md                   the AUDIT-CYCLE: and FIX-PASS: records
#   <project>/CONTROL/dispatch-log.md             the run=wf-fix-* rows
#
# EXIT CODES
#   0  PASS     — zero HALT, HARM and SCOPE findings remain. CARRY findings may
#                 be open, and usually are: a CARRY-only audit is a PASS
#                 (references/gauntlet.md §7.1). The carry count goes on the
#                 ledger line and into the build as work items.
#   2  TOOLING FAILURE — the gate could not run: bad usage, an input file that
#                 is missing or unreadable, a grep that fails its own
#                 known-positive control, ledger.sh absent, the ledger write
#                 failed. NEVER a verdict about the audit. An exit 2 is
#                 "UNDETERMINED", said out loud with the exact path named — the
#                 one thing this gate must never do is report a zero it cannot
#                 prove.
#   3  BLOCKED  — one or more HALT/HARM/SCOPE findings remain. Every one of
#                 them is printed, with its line number, on stderr. Fix pass,
#                 re-judge, run the gate again.
#   5  CEILING  — a third cycle was attempted with blocking findings still
#                 open. Two cycles is the ceiling. The run proceeds with its
#                 full CARRY list and the open blocking findings escalate in
#                 writing with their history (GL-007, Law 50: an operational
#                 limit is never a PASS).
#   9  REFUSED  — the ledger records a fix pass with no matching run=wf-fix-*
#                 rows in CONTROL/dispatch-log.md. That is the conductor fixing
#                 the apparatus in its own context instead of dispatching a
#                 workflow of fixer agents (RC-7). The fix pass is dispatched,
#                 not performed.
#  10  OUT-OF-SCOPE DRIFT — a finding of any class names
#                 CONTROL/OPERATOR-OVERRIDE.json, the OPERATOR OVERRIDE. That
#                 file is read-only for every agent (references/pipeline.md, the
#                 scope fence) and is never in the in-scope set, so a finding
#                 that proposes changing or removing it is working outside the
#                 scope set — which the fence calls DRIFT: reject, log,
#                 do not re-dispatch. Tested BEFORE the cycle count and the
#                 verdict, because it is not a finding to be counted, carried or
#                 fixed. Like 4, 6 and 9 it is a fact about the RUN and is kept
#                 out of exit 2.
#
# THE LEDGER LINE. Exactly one, written through tools/ledger.sh on every run
# that reaches a verdict (0, 3, 5 and 9 — never on a tooling failure, which
# claims nothing):
#
#   AUDIT-GATE | cycle=<n> | halt=<n> harm=<n> scope=<n> carry=<n> | verdict=<PASS|BLOCKED|CEILING|OUT-OF-SCOPE>
#
# The cycle number is COUNTED, never passed in: it is the number of
# "AUDIT-CYCLE:" lines in <project>/CONTROL/LEDGER.md. A gate that took the
# cycle number as an argument would be a gate the caller could reset.
#
# --selftest proves the instrument before any verdict is believed. Eleven
# numbered fixtures, each printing one PASS/FAIL report line: the grep
# controls, zero findings, CARRY-only, one HALT, one HARM, one SCOPE, the
# third-cycle ceiling, a named tooling failure, the exit-9 pair (a
# recorded fix pass without wf-fix dispatch rows, and the control with them),
# and the exit-10 pair (one findings file with and without a line naming
# CONTROL/OPERATOR-OVERRIDE.json: rc 10 with it, an ordinary rc 3 without).
# The CARRY-only fixture is the discriminating one — it must PASS with
# findings still open, which is the whole point of the change — and it is run
# against the same file as the HALT fixture with only the class word changed,
# so a gate that simply refused (or simply passed) everything fails the pair.

set -uo pipefail

# --- The greps. Named, absolute, and proven before any count is believed. ---
GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

DEFAULT_FINDINGS_REL="QUALITY-CONTROL/AUDIT-FINDINGS.md"
LEDGER_REL="CONTROL/LEDGER.md"
DISPATCH_REL="CONTROL/dispatch-log.md"

# One expression per class, built the same way, so no class can be checked
# more loosely than another.
class_re() { printf '^[[:space:]]*([-*|][[:space:]]*)?(\\*\\*)?%s(\\*\\*)?[[:space:]]*[|:]' "$1"; }
# A finding — any class — that names CONTROL/OPERATOR-OVERRIDE.json. Built from
# the same shape as class_re so no class is checked more loosely than another.
OVERRIDE_DRIFT_RE='^[[:space:]]*([-*|][[:space:]]*)?(\*\*)?(HALT|HARM|SCOPE|CARRY)(\*\*)?[[:space:]]*[|:].*OPERATOR-OVERRIDE'
CYCLE_RE='^[[:space:]]*([-*|][[:space:]]*)?(\*\*)?AUDIT-CYCLE(\*\*)?[[:space:]]*:'
FIXPASS_RE='^[[:space:]]*([-*|][[:space:]]*)?(\*\*)?(AUDIT-)?FIX-PASS(\*\*)?[[:space:]]*[|:]'
WFFIX_RE='run=wf-fix-[A-Za-z0-9._-]+'

usage() {
  sed -n '2,7p' "${SELF}"
}

tooling() {
  printf 'AUDIT-GATE UNDETERMINED | tooling | %s\n' "$1" >&2
  exit 2
}

# count_matches <regex> <file> — prints the count. Returns 2 when grep itself
# failed (rc >= 2: unreadable file, bad expression), which is NOT zero matches.
count_matches() {
  local re="$1" f="$2" n rc
  n="$("${GREP}" -cE "${re}" "${f}" 2>/dev/null)"; rc=$?
  if (( rc >= 2 )); then return 2; fi
  [[ -n "${n}" ]] || n=0
  printf '%s' "${n}"
  return 0
}

# show_matches <regex> <file> — prints matching lines with line numbers.
show_matches() {
  local re="$1" f="$2" rc
  "${GREP}" -nE "${re}" "${f}" 2>/dev/null; rc=$?
  (( rc <= 1 ))
}

# prove_greps — the known-positive AND known-negative control, on this box,
# with this grep, before any count below is trusted. A gate whose own
# expressions come back negative on a line it wrote itself is BROKEN, and says
# so instead of reporting a clean zero.
prove_greps() {
  local T="$1" pos neg
  {
    printf 'HALT  | U04 | control line\n'
    printf 'HARM  | U07 | control line\n'
    printf 'SCOPE | U08 | control line\n'
    printf 'CARRY | DOC | control line\n'
    printf 'AUDIT-CYCLE: 1\n'
    printf 'FIX-PASS: control\n'
    printf 'run=wf-fix-control\n'
    printf 'The word HALT appears mid-sentence here and is not a finding.\n'
  } > "${T}/control.txt" 2>/dev/null || return 2

  local c
  for c in HALT HARM SCOPE CARRY; do
    pos="$(count_matches "$(class_re "${c}")" "${T}/control.txt")" || return 2
    [[ "${pos}" == "1" ]] || { printf '%s' "${c}=${pos}"; return 1; }
  done
  pos="$(count_matches "${CYCLE_RE}" "${T}/control.txt")" || return 2
  [[ "${pos}" == "1" ]] || { printf 'AUDIT-CYCLE=%s' "${pos}"; return 1; }
  pos="$(count_matches "${FIXPASS_RE}" "${T}/control.txt")" || return 2
  [[ "${pos}" == "1" ]] || { printf 'FIX-PASS=%s' "${pos}"; return 1; }
  pos="$(count_matches "${WFFIX_RE}" "${T}/control.txt")" || return 2
  [[ "${pos}" == "1" ]] || { printf 'wf-fix=%s' "${pos}"; return 1; }

  # known-negative: a class word in prose must NOT be counted as a finding.
  printf 'A sentence that merely mentions HALT and SCOPE in passing.\n' > "${T}/control-neg.txt" 2>/dev/null || return 2
  neg="$(count_matches "$(class_re HALT)" "${T}/control-neg.txt")" || return 2
  [[ "${neg}" == "0" ]] || { printf 'known-negative HALT=%s' "${neg}"; return 1; }

  # The out-of-scope-drift expression, proven on its own pair. The positive is a
  # finding that names the operator override; the negatives are the ordinary
  # findings above (no override named) and a line that mentions the file in
  # prose without being a finding at all.
  {
    printf 'SCOPE | CONTROL/OPERATOR-OVERRIDE.json | remove the unexplained override file\n'
    printf 'The run reads CONTROL/OPERATOR-OVERRIDE.json, which is prose and not a finding.\n'
  } > "${T}/control-ov.txt" 2>/dev/null || return 2
  pos="$(count_matches "${OVERRIDE_DRIFT_RE}" "${T}/control-ov.txt")" || return 2
  [[ "${pos}" == "1" ]] || { printf 'override-drift known-positive=%s' "${pos}"; return 1; }
  neg="$(count_matches "${OVERRIDE_DRIFT_RE}" "${T}/control.txt")" || return 2
  [[ "${neg}" == "0" ]] || { printf 'override-drift known-negative=%s' "${neg}"; return 1; }
  return 0
}

# write_ledger_line <project> <cycle> <halt> <harm> <scope> <carry> <verdict>
write_ledger_line() {
  local project="$1" cycle="$2" h="$3" a="$4" s="$5" c="$6" v="$7" row out rc
  [[ -x "${LEDGER_SH}" ]] \
    || tooling "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every project write goes through it, so an unrecorded verdict is refused rather than written unlocked"
  row="AUDIT-GATE | cycle=${cycle} | halt=${h} harm=${a} scope=${s} carry=${c} | verdict=${v}"
  out="$("${LEDGER_SH}" "${project}" "${LEDGER_REL}" "${row}" 2>&1)"; rc=$?
  (( rc == 0 )) \
    || tooling "ledger.sh failed (rc=${rc}) writing ${LEDGER_REL}: ${out}"
  return 0
}

# ============================================================================
# The run
# ============================================================================
run_gate() {
  (( $# >= 1 )) \
    || tooling "usage: audit-gate.sh <project> [findings=<path>] — got $# argument(s)"

  local project="$1"; shift
  local findings="" a
  for a in "$@"; do
    case "${a}" in
      findings=*) findings="${a#findings=}" ;;
      *) tooling "unrecognised argument '${a}' — the only optional argument is findings=<path>" ;;
    esac
  done

  [[ -n "${GREP}" && -x "${GREP}" ]] \
    || tooling "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the gate cannot read its own inputs, so it claims nothing"
  [[ -n "${project}" ]] || tooling "the project argument is empty"
  [[ -d "${project}" ]] || tooling "project directory does not exist: ${project}"

  local T ctl rc
  T="$(mktemp -d "${TMPDIR:-/tmp}/audit-gate.XXXXXX")" \
    || tooling "cannot create a temp dir for the grep controls; the instrument cannot be proven, so no count is reported"
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT
  ctl="$(prove_greps "${T}")"; rc=$?
  if (( rc == 2 )); then
    tooling "the grep controls could not be run at all (grep=${GREP}) — every count below would be unproven"
  elif (( rc != 0 )); then
    tooling "BROKEN INSTRUMENT: the gate's own expressions do not match the control lines it just wrote (${ctl}) with grep=${GREP}. No count and no zero from this run can be believed."
  fi

  [[ -n "${findings}" ]] || findings="${project}/${DEFAULT_FINDINGS_REL}"
  [[ -e "${findings}" ]] \
    || tooling "no findings file at ${findings} — that path is the only source this gate reads (pass findings=<path> if the auditor wrote it elsewhere). An absent file is UNDETERMINED, never zero findings."
  [[ -f "${findings}" && -r "${findings}" ]] \
    || tooling "findings file is not a readable regular file: ${findings}"

  local ledger_md="${project}/${LEDGER_REL}"
  [[ -e "${ledger_md}" ]] \
    || tooling "no ledger at ${ledger_md} — the cycle count is read from its AUDIT-CYCLE: lines and cannot be assumed. Write the ledger (document 6) before the gate runs."
  [[ -f "${ledger_md}" && -r "${ledger_md}" ]] \
    || tooling "ledger is not a readable regular file: ${ledger_md}"

  # --- the counts, by class -------------------------------------------------
  local halt harm scope carry
  halt="$(count_matches  "$(class_re HALT)"  "${findings}")" || tooling "grep failed reading ${findings} (HALT)"
  harm="$(count_matches  "$(class_re HARM)"  "${findings}")" || tooling "grep failed reading ${findings} (HARM)"
  scope="$(count_matches "$(class_re SCOPE)" "${findings}")" || tooling "grep failed reading ${findings} (SCOPE)"
  carry="$(count_matches "$(class_re CARRY)" "${findings}")" || tooling "grep failed reading ${findings} (CARRY)"

  # --- exit 10: a finding that proposes touching the OPERATOR OVERRIDE -------
  # CONTROL/OPERATOR-OVERRIDE.json is the operator's own file. It is read-only
  # for every agent (references/pipeline.md, the scope fence), it is never in
  # the in-scope set, and a finding that proposes changing or removing it is by
  # definition working outside the scope set — which the fence calls DRIFT and
  # says to reject, log, and not re-dispatch.
  #
  # It is tested BEFORE the cycle count, the fix-pass check and the verdict, on
  # purpose: this is not a finding to be counted, carried or fixed, so nothing
  # downstream may be allowed to act on it first. The 2026-09-07 canary is the
  # reason the rule is mechanical rather than written down — that run classified
  # an injected pause line as a defect and reverted it (canary-notes.md:63-68).
  # An override an audit may repair is not an override.
  local ovdrift
  ovdrift="$(count_matches "${OVERRIDE_DRIFT_RE}" "${findings}")" \
    || tooling "grep failed reading ${findings} (OPERATOR-OVERRIDE drift)"
  if (( ovdrift >= 1 )); then
    local ovcycle
    ovcycle="$(count_matches "${CYCLE_RE}" "${ledger_md}")" \
      || tooling "grep failed reading ${ledger_md} (AUDIT-CYCLE)"
    write_ledger_line "${project}" "${ovcycle}" "${halt}" "${harm}" "${scope}" "${carry}" "OUT-OF-SCOPE"
    printf 'AUDIT-GATE OUT-OF-SCOPE | cycle=%s | %s finding(s) in %s name CONTROL/OPERATOR-OVERRIDE.json\n' \
      "${ovcycle}" "${ovdrift}" "${findings}" >&2
    printf 'AUDIT-GATE OUT-OF-SCOPE | the operator override is READ-ONLY for every agent and is never in the in-scope set. A finding that proposes changing or removing it is DRIFT (references/pipeline.md, the scope fence): it is refused here, logged, and NOT re-dispatched. Delete these lines from the findings file and run the gate again; the rest of the audit is not judged until they are gone.\n' >&2
    show_matches "${OVERRIDE_DRIFT_RE}" "${findings}" >&2
    exit 10
  fi

  # --- the cycle number, counted from the ledger ----------------------------
  local cycle
  cycle="$(count_matches "${CYCLE_RE}" "${ledger_md}")" || tooling "grep failed reading ${ledger_md} (AUDIT-CYCLE)"
  if [[ "${cycle}" == "0" ]]; then
    printf 'AUDIT-GATE NOTE | no "AUDIT-CYCLE:" line in %s — the cycle is recorded as 0, not assumed. The auditor writes one per cycle.\n' "${ledger_md}" >&2
  fi

  # --- exit 9: a fix pass the conductor performed instead of dispatching ----
  local fixpass
  fixpass="$(count_matches "${FIXPASS_RE}" "${ledger_md}")" || tooling "grep failed reading ${ledger_md} (FIX-PASS)"
  if (( fixpass >= 1 )); then
    local dispatch_md="${project}/${DISPATCH_REL}" wf_runs=0 dispatch_note=""
    if [[ -e "${dispatch_md}" ]]; then
      [[ -f "${dispatch_md}" && -r "${dispatch_md}" ]] \
        || tooling "dispatch log exists but is not a readable regular file: ${dispatch_md} — whether the fix pass was dispatched is UNDETERMINED"
      wf_runs="$("${GREP}" -oE "${WFFIX_RE}" "${dispatch_md}" 2>/dev/null | sort -u | wc -l | tr -d '[:space:]')"
      [[ -n "${wf_runs}" ]] || wf_runs=0
      dispatch_note="${dispatch_md} carries ${wf_runs} distinct run=wf-fix-* tree(s)"
    else
      dispatch_note="${dispatch_md} does not exist, so no gated dispatch has ever been recorded for this project"
    fi
    if (( wf_runs < fixpass )); then
      write_ledger_line "${project}" "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" "BLOCKED"
      printf 'AUDIT-GATE REFUSED | %s records %s fix pass(es) and %s\n' "${ledger_md}" "${fixpass}" "${dispatch_note}" >&2
      printf 'AUDIT-GATE REFUSED | the fix pass is DISPATCHED as a workflow of fixer agents, one per HALT/HARM/SCOPE finding, never performed by the conductor in its own context. Dispatch it through tools/dispatch-check.sh with run=wf-fix-<n>, then run this gate again.\n' >&2
      exit 9
    fi
  fi

  # --- the verdict ----------------------------------------------------------
  local blocking=$(( halt + harm + scope ))

  if (( blocking == 0 )); then
    write_ledger_line "${project}" "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" "PASS"
    printf 'AUDIT-GATE PASS | cycle=%s | halt=0 harm=0 scope=0 carry=%s | %s\n' \
      "${cycle}" "${carry}" "${findings}"
    if (( carry >= 1 )); then
      printf 'AUDIT-GATE PASS | %s CARRY finding(s) remain OPEN and are not blocking (references/gauntlet.md §7.1). Log each as a CARRY: line through tools/ledger.sh and carry it into the build as a named work item, fixed by the unit that next touches that document.\n' "${carry}"
    fi
    exit 0
  fi

  if (( cycle >= 3 )); then
    write_ledger_line "${project}" "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" "CEILING"
    printf 'AUDIT-GATE CEILING | cycle=%s | halt=%s harm=%s scope=%s carry=%s | two cycles is the ceiling; a third is refused\n' \
      "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" >&2
    printf 'AUDIT-GATE CEILING | the run PROCEEDS with its full CARRY list. These findings stay open and escalate in writing with their full history — an operational limit is never a PASS (GL-007, Law 50):\n' >&2
    show_matches "$(class_re HALT)"  "${findings}" >&2
    show_matches "$(class_re HARM)"  "${findings}" >&2
    show_matches "$(class_re SCOPE)" "${findings}" >&2
    exit 5
  fi

  write_ledger_line "${project}" "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" "BLOCKED"
  printf 'AUDIT-GATE BLOCKED | cycle=%s | halt=%s harm=%s scope=%s carry=%s | %s\n' \
    "${cycle}" "${halt}" "${harm}" "${scope}" "${carry}" "${findings}" >&2
  printf 'AUDIT-GATE BLOCKED | these must clear before a builder runs (references/gauntlet.md §7.1):\n' >&2
  show_matches "$(class_re HALT)"  "${findings}" >&2
  show_matches "$(class_re HARM)"  "${findings}" >&2
  show_matches "$(class_re SCOPE)" "${findings}" >&2
  printf 'AUDIT-GATE BLOCKED | ONE fix pass, dispatched as a workflow of fixer agents (one finding each), then ONE re-judge, then this gate again. The %s CARRY finding(s) are NOT fixed in this pass.\n' "${carry}" >&2
  exit 3
}

# ============================================================================
# The selftest — the instrument proven before any verdict is believed
# ============================================================================
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [[ "$3" == "1" ]]; then printf 'PASS %-2s %-26s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-26s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

run_selftest() {
  local T
  T="$(mktemp -d "${TMPDIR:-/tmp}/audit-gate-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT

  # --- 0: the grep controls, on this box, before anything else -------------
  local ctl rc ok
  mkdir -p "${T}/ctl"
  ctl="$(prove_greps "${T}/ctl")"; rc=$?
  ok=0; (( rc == 0 )) && ok=1
  report 0 "grep-controls" "${ok}" "every class expression matched its known-positive line exactly once and the known-negative (a class word in prose) matched zero, on ${GREP}${ctl:+ — detail: ${ctl}}"
  if (( ok == 0 )); then
    printf '\naudit-gate.sh selftest: the instrument fails its own controls — every verdict below would be meaningless\n' >&2
    exit 2
  fi

  # mkproj <name> <cycles> — a project fixture with <cycles> AUDIT-CYCLE lines
  mkproj() {
    local p="${T}/$1" n="$2" i
    mkdir -p "${p}/CONTROL" "${p}/QUALITY-CONTROL"
    printf '# Ledger\n\nENTRY-MODE: interview\n' > "${p}/CONTROL/LEDGER.md"
    for (( i = 1; i <= n; i++ )); do
      printf 'AUDIT-CYCLE: %s\n' "${i}" >> "${p}/CONTROL/LEDGER.md"
    done
    printf '%s' "${p}"
  }
  gate_line() { # the AUDIT-GATE line this run wrote, if any
    "${GREP}" -E '^AUDIT-GATE \| cycle=' "$1/CONTROL/LEDGER.md" 2>/dev/null | tail -n 1
  }

  local P out line

  # --- 1: zero findings → rc 0 ---------------------------------------------
  P="$(mkproj proj-empty 1)"
  printf '# Apparatus audit — cycle 1\n\nNo findings.\n' > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "0" && "${line}" == "AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=0 | verdict=PASS" ]] && ok=1
  report 1 "zero-findings-passes" "${ok}" "rc=${rc} (want 0); ledger line: ${line:-NONE}"

  # --- 2: CARRY-only → rc 0 WITH THE FINDINGS STILL OPEN (discriminating) ---
  P="$(mkproj proj-carry 1)"
  {
    printf '# Apparatus audit — cycle 1\n\n'
    printf 'CARRY | PROJECT-MANIFEST.md | twelve sections instead of eighteen labelled contents\n'
    printf 'CARRY | LOOPS/ | ten loop files for a five-loop register\n'
    printf 'CARRY | SPEC/MASTER-SPEC.md | build cards omit three Law 19 fields\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  local still_open
  still_open="$(count_matches "$(class_re CARRY)" "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md")"
  ok=0
  [[ "${rc}" == "0" && "${line}" == "AUDIT-GATE | cycle=1 | halt=0 harm=0 scope=0 carry=3 | verdict=PASS" && "${still_open}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'CARRY finding(s) remain OPEN' || ok=0
  report 2 "carry-only-passes-open" "${ok}" "rc=${rc} (want 0) with ${still_open} CARRY findings STILL OPEN (want 3) — a bounded audit hands over carrying them; ledger line: ${line:-NONE}"

  # --- 3: the same file with ONE line reclassified HALT → rc 3, named ------
  P="$(mkproj proj-halt 1)"
  {
    printf '# Apparatus audit — cycle 1\n\n'
    printf 'HALT  | U04/U05 | two mutually exclusive paths for the home page: index.html vs site/index.html\n'
    printf 'CARRY | LOOPS/ | ten loop files for a five-loop register\n'
    printf 'CARRY | SPEC/MASTER-SPEC.md | build cards omit three Law 19 fields\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "3" && "${line}" == "AUDIT-GATE | cycle=1 | halt=1 harm=0 scope=0 carry=2 | verdict=BLOCKED" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'two mutually exclusive paths for the home page' || ok=0
  report 3 "halt-blocks-and-names" "${ok}" "rc=${rc} (want 3) and the message quotes the HALT finding; the pair with fixture 2 is one file, one word changed, opposite verdicts; ledger line: ${line:-NONE}"

  # --- 4: one HARM → rc 3 --------------------------------------------------
  P="$(mkproj proj-harm 2)"
  {
    printf '# Apparatus audit — cycle 2\n\n'
    printf 'HARM | U07 | the form key is bound to a mailbox the client does not own\n'
    printf 'CARRY | DECISIONS.md | two of five per-decision fields missing\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "3" && "${line}" == "AUDIT-GATE | cycle=2 | halt=0 harm=1 scope=0 carry=1 | verdict=BLOCKED" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'mailbox the client does not own' || ok=0
  report 4 "harm-blocks-and-names" "${ok}" "rc=${rc} (want 3); ledger line: ${line:-NONE}"

  # --- 5: one SCOPE → rc 3 -------------------------------------------------
  P="$(mkproj proj-scope 2)"
  {
    printf '# Apparatus audit — cycle 2\n\n'
    printf 'SCOPE | U08 | an entire JSON-LD structured-data layer the client never ratified (Law 42)\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "3" && "${line}" == "AUDIT-GATE | cycle=2 | halt=0 harm=0 scope=1 carry=0 | verdict=BLOCKED" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'never ratified' || ok=0
  report 5 "scope-blocks-and-names" "${ok}" "rc=${rc} (want 3); cleared by REMOVAL, never by justification; ledger line: ${line:-NONE}"

  # --- 6: a third cycle with a HALT open → rc 5, verdict=CEILING -----------
  P="$(mkproj proj-ceiling 3)"
  {
    printf '# Apparatus audit — cycle 3\n\n'
    printf 'HALT  | U04/U05 | still two paths for the home page\n'
    printf 'CARRY | CONTROL/LEDGER.md | flat append log, three mandated sections absent\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "5" && "${line}" == "AUDIT-GATE | cycle=3 | halt=1 harm=0 scope=0 carry=1 | verdict=CEILING" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'PROCEEDS with its full CARRY list' || ok=0
  report 6 "third-cycle-ceiling" "${ok}" "rc=${rc} (want 5) and the ledger says verdict=CEILING; ledger line: ${line:-NONE}"

  # --- 7: a tooling failure is named, never reported as a clean zero -------
  P="$(mkproj proj-nofindings 1)"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "2" && -z "${line}" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "${P}/${DEFAULT_FINDINGS_REL}" || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'UNDETERMINED' || ok=0
  local rc_noproj
  bash "${SELF}" "${T}/does-not-exist" >/dev/null 2>&1; rc_noproj=$?
  [[ "${rc_noproj}" == "2" ]] || ok=0
  report 7 "tooling-failure-named" "${ok}" "missing findings file → rc=${rc} (want 2), path named, NO ledger line written; missing project dir → rc=${rc_noproj} (want 2)"

  # --- 8: a recorded fix pass with no wf-fix dispatch rows → rc 9 ----------
  P="$(mkproj proj-selffix 2)"
  printf 'FIX-PASS: cycle 1 findings repaired\n' >> "${P}/CONTROL/LEDGER.md"
  printf 'CARRY | DECISIONS.md | two of five per-decision fields missing\n' > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  printf '2026-09-08T00:00:00Z | 3-units | dispatch | [Opus x3] audit | run=wf-audit-20 | units=3 | agents=3\n' > "${P}/CONTROL/dispatch-log.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "9" && "${line}" == "AUDIT-GATE | cycle=2 | halt=0 harm=0 scope=0 carry=1 | verdict=BLOCKED" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'DISPATCHED as a workflow of fixer agents' || ok=0
  report 8 "self-fix-refused" "${ok}" "rc=${rc} (want 9) — a CARRY-only findings file that would otherwise PASS is refused because the fix pass has no run=wf-fix-* tree; ledger line: ${line:-NONE}"

  # --- 9: the control for 8 — the same ledger WITH wf-fix rows → rc 0 ------
  P="$(mkproj proj-dispatchedfix 2)"
  printf 'FIX-PASS: cycle 1 findings repaired\n' >> "${P}/CONTROL/LEDGER.md"
  printf 'CARRY | DECISIONS.md | two of five per-decision fields missing\n' > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  {
    printf '2026-09-08T00:00:00Z | 3-units | dispatch | [Opus x3] audit | run=wf-audit-20 | units=3 | agents=3\n'
    printf '2026-09-08T00:10:00Z | 4-units | dispatch | [Opus x4] fix | run=wf-fix-01 | units=4 | agents=4\n'
  } > "${P}/CONTROL/dispatch-log.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0; [[ "${rc}" == "0" && "${line}" == "AUDIT-GATE | cycle=2 | halt=0 harm=0 scope=0 carry=1 | verdict=PASS" ]] && ok=1
  report 9 "dispatched-fix-passes" "${ok}" "rc=${rc} (want 0) on the SAME ledger record once run=wf-fix-01 exists in the dispatch log — so exit 9 is a finding about the run, not a refusal of the class; ledger line: ${line:-NONE}"

  # --- 10: a finding that proposes touching the OPERATOR OVERRIDE → rc 10 --
  # A pass/fail pair on ONE fixture: the same findings file, with and without
  # the line that names CONTROL/OPERATOR-OVERRIDE.json. Without it the file is
  # an ordinary one-HALT audit and the gate BLOCKS at rc 3; with it the gate
  # refuses the whole findings file as out-of-scope drift at rc 10, before any
  # verdict is reached. A gate that answered alike either way would prove
  # nothing about the override.
  P="$(mkproj proj-override 1)"
  {
    printf '# Apparatus audit — cycle 1\n\n'
    printf 'HALT  | U04 | the home page has two conflicting layouts\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  local ov_ctl=0
  [[ "${rc}" == "3" && "${line}" == "AUDIT-GATE | cycle=1 | halt=1 harm=0 scope=0 carry=0 | verdict=BLOCKED" ]] && ov_ctl=1
  local rc_ctl="${rc}" line_ctl="${line}"

  P="$(mkproj proj-override-drift 1)"
  {
    printf '# Apparatus audit — cycle 1\n\n'
    printf 'HALT  | U04 | the home page has two conflicting layouts\n'
    printf 'SCOPE | CONTROL/OPERATOR-OVERRIDE.json | an unexplained override file; remove it and let the computed first_pause stand\n'
  } > "${P}/QUALITY-CONTROL/AUDIT-FINDINGS.md"
  out="$(bash "${SELF}" "${P}" 2>&1)"; rc=$?
  line="$(gate_line "${P}")"
  ok=0
  [[ "${rc}" == "10" ]] && ok=1
  printf '%s' "${line}" | "${GREP}" -q 'verdict=OUT-OF-SCOPE' || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'AUDIT-GATE OUT-OF-SCOPE' || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'READ-ONLY for every agent' || ok=0
  (( ov_ctl == 1 )) || ok=0
  report 10 "override-finding-is-drift" "${ok}" "rc=${rc} (want 10) for a findings file whose SCOPE line names CONTROL/OPERATOR-OVERRIDE.json; the ledger says verdict=OUT-OF-SCOPE and the message says the file is read-only for every agent. CONTROL, the SAME findings file with that one line removed: rc=${rc_ctl} (want 3, an ordinary BLOCKED)=${ov_ctl} — the refusal is about the override and not about findings in general; ledger lines: [${line:-NONE}] and [${line_ctl:-NONE}]"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'audit-gate.sh selftest: ALL PASS (11 checks, fixtures 0-10)\n'
    exit 0
  fi
  printf 'audit-gate.sh selftest: %s FAILED — this gate is a BROKEN INSTRUMENT; triage the audit by hand against references/gauntlet.md §7.1 and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_gate "$@" ;;
esac
