#!/usr/bin/env bash
# right-size.sh — THE OVER-ENGINEERING GATE (Law 42; WAVE6 RC-2, row WI-31).
#
# Usage:
#   right-size.sh <project> [removed=<n>]
#   right-size.sh --selftest
#   right-size.sh --help
#
# WHAT IT IS FOR. SKILL.md step 13 and references/pipeline.md both MANDATE the
# over-engineering check, and until this script existed nothing enforced it:
# no ledger line, no script, no gate. The 2026-09-07 canary proved the cost —
# audit blocker 15 found the check "was never run and is recorded nowhere", and
# the 12-card, 166 KB apparatus is what grew in the space where it should have
# run. This is the instrument. It runs ONCE, after the specification is written
# and before the first builder dispatches, it answers in an exit code, and the
# line it leaves in CONTROL/LEDGER.md is what tools/dispatch-check.sh demands
# before it will gate a build dispatch (its exit 6). No line, no builder.
#
#   budget_kb = max(40, units × 6)        — the apparatus scales with the job
#   apparatus = SPEC/ + LOOPS/ + CONTROL/EXECUTION-PLAN.md, in real bytes
#
# It extends Law 42 past the specification. pipeline.md's check asks whether the
# SPEC builds more than was asked; nothing asked whether the APPARATUS had
# outgrown the job. This measures both sides of that: the unit count is the job,
# the byte count is the apparatus, and 6 KB per unit with a 40 KB floor is the
# ratio a run has to justify crossing.
#
# EXIT CODES
#   0  PASS (removed=0) or TRIMMED (removed>0) — the apparatus is at or under
#              budget. The OVER-ENGINEERING-CHECK: line is written to
#              CONTROL/LEDGER.md through tools/ledger.sh, and ONLY here. A
#              refusal writes nothing: the line is the gate dispatch-check.sh
#              reads, so writing it on a failure would open the gate the failure
#              exists to close.
#   2  TOOLING FAILURE / REFUSAL TO MEASURE — the gate could not run, or ran and
#              could not prove what it measured: bad usage, no project, no
#              master spec, a document it cannot size, an apparatus that
#              measures zero bytes, a unit count of zero, ledger.sh absent —
#              and the scope refusal: SPEC/DECISIONS.md carries no RATIFIED
#              feature list. That last one is not a technicality. The client's
#              confirmed list is the ONLY legitimate source of scope
#              (references/pipeline.md, "the user's brainstorm is the source of
#              truth for scope"); with no ratified list there is nothing to
#              measure "more than was asked" against, and a gate that cannot
#              tell over-scope from scope must say UNDETERMINED out loud rather
#              than pass. Every exit 2 names the exact path it read.
#   3  OVER BUDGET — apparatus_kb > budget_kb. Prints every document carrying
#              the overage, largest first, with the number of KB that has to
#              come off each one. Nothing is deleted by this script; a document
#              belonging to the client's project is trimmed by the conductor,
#              which then re-runs with removed=<n>.
#
# NEVER A ZERO IT CANNOT PROVE. An absent LOOPS/ or CONTROL/EXECUTION-PLAN.md is
# a real zero at step 13 — both are written later (steps 16 and 18) — so it is
# counted as zero AND NAMED as absent on the PASS line, never silently summed
# in. A directory that exists but cannot be read, a file wc(1) cannot size, or a
# total of zero bytes across everything is exit 2, not a pass.
#
# --selftest proves the instrument before any verdict is believed. It runs the
# four fixtures the work item names — 8 units at 40 KB (0); 8 units at 200 KB
# (3, naming the two largest offenders); the same 8-unit project with its
# feature-list decision flipped to NOT RATIFIED (2); and 40 units at 200 KB (0,
# which is the discriminating one: a fixed threshold would fail it, and it
# passes only because the budget scaled to 240 KB) — plus a known-positive
# control for every grep it relies on. Fixtures 1 and 3 differ in exactly one
# character sequence, so a pass/fail split between them is a fact about
# ratification and not a class-wide refusal.

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

KB=1024
BUDGET_FLOOR_KB=40          # the small-project floor: a 3-unit job still needs docs
KB_PER_UNIT=6               # the ratio a run has to justify crossing

usage() {
  sed -n '2,7p' "${SELF}"
}

# --- Exit helpers. Every one of them says WHICH path it read. ----------------
tooling() { printf 'RIGHT-SIZE UNDETERMINED | tooling | %s\n' "$1" >&2; exit 2; }

is_uint() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Bytes → KB, rounded UP. A budget is never allowed to look smaller than the
# thing it measures because of a truncating divide.
ceil_kb() { printf '%s' $(( ( $1 + KB - 1 ) / KB )); }

# --- The unit count, from the master spec -----------------------------------
# Two shapes, in this order, matching the card grammar in references/documents.md
# ("### U<NNN> · <surface> · <priority> · <goal>"):
#   1.  a heading whose text opens with U<NNN>          — the canonical card
#   2.  a heading whose text opens with <n>.            — a plainly numbered spec
# A count of zero is never returned as a fact; the caller turns it into exit 2.
count_units() {
  local f="$1" n=""
  n="$("${GREP}" -cE '^[[:space:]]*#{1,6}[[:space:]]*U[0-9]{1,4}([^0-9]|$)' "${f}" 2>/dev/null)"
  is_uint "${n}" || n=0
  if (( n > 0 )); then printf '%s' "${n}"; return 0; fi
  n="$("${GREP}" -cE '^[[:space:]]*#{1,6}[[:space:]]+[0-9]{1,4}\.[[:space:]]' "${f}" 2>/dev/null)"
  is_uint "${n}" || n=0
  printf '%s' "${n}"
  return 0
}

# --- The scope source: a RATIFIED feature list in SPEC/DECISIONS.md ---------
# Prints "<lineno>:<line>" for the evidence, or nothing. "NOT RATIFIED" is
# excluded explicitly — it contains the word RATIFIED, and a gate that read it
# as ratification would pass exactly the run it exists to stop.
ratified_feature_list() {
  local f="$1" hit=""
  hit="$( "${GREP}" -inE 'feature[[:space:]_-]?list' "${f}" 2>/dev/null \
          | "${GREP}" -E 'RATIFIED' \
          | "${GREP}" -vE '[Nn][Oo][Tt][[:space:]]+RATIFIED' \
          | head -n 1 || true )"
  [[ -n "${hit}" ]] || return 1
  # A heading is only a list if something is under it.
  local ln="${hit%%:*}" text="${hit#*:}"
  if printf '%s' "${text}" | "${GREP}" -qE '^[[:space:]]*#'; then
    awk -v n="${ln}" '
      NR > n {
        if (stop) next
        if ($0 ~ /^[[:space:]]*#/) { stop = 1; next }
        if ($0 ~ /^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]+[^[:space:]]/) { found = 1; stop = 1 }
      }
      END { exit (found ? 0 : 1) }
    ' "${f}" || return 1
  fi
  printf '%s' "${hit}"
  return 0
}

# --- The apparatus, in real bytes -------------------------------------------
# Writes "<bytes>\t<path>" per document into <outfile>. ABSENT accumulates the
# components that are legitimately not there yet, so the PASS line can name
# them instead of pretending they were measured.
ABSENT=""
APPARATUS_BYTES=0
collect_docs() {
  local out="$1" project="$2" d f n
  : > "${out}" || tooling "cannot write the measurement scratch file ${out}"
  for d in "${project}/SPEC" "${project}/LOOPS"; do
    if [[ -e "${d}" && ! -d "${d}" ]]; then
      tooling "${d} exists but is not a directory — the apparatus size is UNDETERMINED, not zero"
    fi
    if [[ ! -d "${d}" ]]; then
      ABSENT="${ABSENT}${ABSENT:+ }${d#${project}/}/"
      continue
    fi
    [[ -r "${d}" && -x "${d}" ]] || tooling "cannot read the directory ${d} — its size is UNDETERMINED, not zero"
    while IFS= read -r -d '' f; do
      n="$(wc -c < "${f}" 2>/dev/null | tr -d '[:space:]')"
      is_uint "${n}" || tooling "wc -c could not size ${f} (got '${n}') — one unsized document makes the whole apparatus UNDETERMINED"
      APPARATUS_BYTES=$(( APPARATUS_BYTES + n ))
      printf '%s\t%s\n' "${n}" "${f}" >> "${out}"
    done < <(find "${d}" -type f -print0 2>/dev/null)
  done
  local plan="${project}/CONTROL/EXECUTION-PLAN.md"
  if [[ -f "${plan}" ]]; then
    [[ -r "${plan}" ]] || tooling "cannot read ${plan} — its size is UNDETERMINED, not zero"
    n="$(wc -c < "${plan}" 2>/dev/null | tr -d '[:space:]')"
    is_uint "${n}" || tooling "wc -c could not size ${plan} (got '${n}')"
    APPARATUS_BYTES=$(( APPARATUS_BYTES + n ))
    printf '%s\t%s\n' "${n}" "${plan}" >> "${out}"
  else
    ABSENT="${ABSENT}${ABSENT:+ }CONTROL/EXECUTION-PLAN.md"
  fi
}

# ============================================================================
# The run
# ============================================================================
run_check() {
  (( $# >= 1 )) \
    || { printf 'RIGHT-SIZE UNDETERMINED | tooling | %s\n' \
         "usage: right-size.sh <project> [removed=<n>] — got $# argument(s)" >&2; exit 2; }
  local project="$1"; shift
  local removed=0 a
  for a in "$@"; do
    case "${a}" in
      removed=*) removed="${a#removed=}" ;;
      *) tooling "unrecognised argument '${a}' — the only optional argument is removed=<n>" ;;
    esac
  done

  [[ -n "${GREP}" && -x "${GREP}" ]] \
    || tooling "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the gate cannot read its own inputs, so it claims nothing"
  is_uint "${removed}" || tooling "removed must be a non-negative integer, got '${removed}'"
  [[ -n "${project}" ]] || tooling "usage: right-size.sh <project> [removed=<n>]"
  [[ -d "${project}" ]] || tooling "project directory does not exist: ${project}"

  local spec_dir="${project}/SPEC"
  [[ -d "${spec_dir}" ]] \
    || tooling "no ${spec_dir} — the specification is what this gate measures against; it cannot run before step 13 has written one"

  # --- The scope source, first. No ratified list, no measurement. -----------
  local decisions="${spec_dir}/DECISIONS.md"
  [[ -f "${decisions}" ]] \
    || tooling "no ${decisions} — the client's RATIFIED feature list is the only legitimate source of scope (references/pipeline.md); with no decision register there is nothing to measure 'more than was asked' against"
  [[ -r "${decisions}" ]] || tooling "decision register is unreadable: ${decisions}"
  local evidence=""
  evidence="$(ratified_feature_list "${decisions}")" || evidence=""
  [[ -n "${evidence}" ]] \
    || tooling "${decisions} carries no RATIFIED feature list — looked for a line naming the feature list and carrying RATIFIED (a 'NOT RATIFIED' row is not one, and a ratified heading with nothing under it is not a list). Close the feature list with the client at step 11 before the spec is measured."

  # --- The master specification --------------------------------------------
  local spec_file="" count=0 f
  for f in "${spec_dir}"/MASTER-SPEC-*.md; do
    [[ -f "${f}" ]] || continue
    count=$(( count + 1 ))
    spec_file="${f}"
  done
  (( count >= 1 )) \
    || tooling "no master specification at ${spec_dir}/MASTER-SPEC-*.md — that glob is the only place this gate looks (references/documents.md, document 1)"
  if (( count > 1 )); then
    printf 'RIGHT-SIZE NOTE | %s master specifications match %s/MASTER-SPEC-*.md — measuring the newest by name, %s\n' \
      "${count}" "${spec_dir}" "${spec_file}" >&2
  fi
  [[ -r "${spec_file}" ]] || tooling "master specification is unreadable: ${spec_file}"

  local units
  units="$(count_units "${spec_file}")"
  is_uint "${units}" || tooling "the unit count parsed as non-integer '${units}' from ${spec_file}"
  (( units >= 1 )) \
    || tooling "zero work items counted in ${spec_file} — looked for '### U<NNN> …' headings and for numbered '### <n>. …' headings, and found neither. A spec with no countable units gives no budget, so this is UNDETERMINED, never a pass at the 40 KB floor."

  local budget_kb=$(( units * KB_PER_UNIT ))
  (( budget_kb >= BUDGET_FLOOR_KB )) || budget_kb="${BUDGET_FLOOR_KB}"

  # --- The apparatus --------------------------------------------------------
  local DOCS
  DOCS="$(mktemp "${TMPDIR:-/tmp}/right-size-docs.XXXXXX")" \
    || tooling "cannot create a temp file for the measurement"
  collect_docs "${DOCS}" "${project}"
  (( APPARATUS_BYTES > 0 )) || {
    rm -f "${DOCS}" 2>/dev/null || true
    tooling "the apparatus measured 0 bytes across ${project}/SPEC, ${project}/LOOPS and ${project}/CONTROL/EXECUTION-PLAN.md — the master spec alone cannot be empty, so this is a broken measurement, not a small project"
  }

  local apparatus_kb budget_bytes
  apparatus_kb="$(ceil_kb "${APPARATUS_BYTES}")"
  budget_bytes=$(( budget_kb * KB ))

  # --- Over budget: name every document carrying the overage ---------------
  if (( APPARATUS_BYTES > budget_bytes )); then
    local over_bytes=$(( APPARATUS_BYTES - budget_bytes ))
    printf 'RIGHT-SIZE OVER-BUDGET | project=%s | units=%s | apparatus_kb=%s | budget_kb=%s | over_by_kb=%s | %s\n' \
      "${project}" "${units}" "${apparatus_kb}" "${budget_kb}" "$(ceil_kb "${over_bytes}")" \
      "the apparatus outgrew the job (Law 42). Documents carrying the overage, largest first:" >&2
    local rank=0 remaining="${over_bytes}" sz path trim
    while IFS="$(printf '\t')" read -r sz path; do
      (( remaining > 0 )) || break
      is_uint "${sz}" || continue
      rank=$(( rank + 1 ))
      trim="${sz}"; (( trim > remaining )) && trim="${remaining}"
      printf '  %s. %s — %s KB (trim %s KB)\n' "${rank}" "${path}" "$(ceil_kb "${sz}")" "$(ceil_kb "${trim}")" >&2
      remaining=$(( remaining - sz ))
    done < <(sort -t"$(printf '\t')" -k1,1rn "${DOCS}")
    printf '%s\n' "  Nothing was deleted. Trim these, then re-run: right-size.sh ${project} removed=<how many were cut>" >&2
    rm -f "${DOCS}" 2>/dev/null || true
    exit 3
  fi
  rm -f "${DOCS}" 2>/dev/null || true

  # --- It passes. Now it is recorded, and only now. ------------------------
  local verdict="PASS"
  (( removed > 0 )) && verdict="TRIMMED"

  [[ -x "${LEDGER_SH}" ]] \
    || tooling "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every project write goes through it, and an unrecorded check is exactly the defect this gate exists to end"

  local ledger_md="${project}/CONTROL/LEDGER.md" existing="" ts row out rc
  if [[ -f "${ledger_md}" ]]; then
    [[ -r "${ledger_md}" ]] || tooling "cannot read ${ledger_md} — the gate will not append to a file it cannot first read"
    existing="$("${GREP}" -n 'OVER-ENGINEERING-CHECK:' "${ledger_md}" 2>/dev/null | head -n 1 || true)"
  fi

  if [[ -n "${existing}" ]]; then
    printf 'RIGHT-SIZE NOTE | %s already carries an OVER-ENGINEERING-CHECK: line (%s) — not appending a second; the check is recorded exactly once per run\n' \
      "${ledger_md}" "${existing}" >&2
  else
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    row="${ts} | OVER-ENGINEERING-CHECK: units=${units} apparatus_kb=${apparatus_kb} budget_kb=${budget_kb} removed=${removed} verdict=${verdict}"
    out="$("${LEDGER_SH}" "${project}" "CONTROL/LEDGER.md" "${row}" 2>&1)"; rc=$?
    (( rc == 0 )) \
      || tooling "ledger.sh failed (rc=${rc}) writing CONTROL/LEDGER.md: ${out}. The check ran and passed, but it is NOT recorded — dispatch-check.sh will still refuse the first build dispatch, which is the correct outcome."
  fi

  printf 'RIGHT-SIZE %s | project=%s | units=%s | apparatus_kb=%s | budget_kb=%s | removed=%s | measured=SPEC/,LOOPS/,CONTROL/EXECUTION-PLAN.md | absent=%s\n' \
    "${verdict}" "${project}" "${units}" "${apparatus_kb}" "${budget_kb}" "${removed}" "${ABSENT:-none}"
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

# pad_to <file> <target-bytes> — grows <file> to EXACTLY <target-bytes> with
# filler. Fixtures whose sizes are approximate would make the budget arithmetic
# unprovable, so they are exact.
pad_to() {
  local f="$1" want="$2" have need
  have="$(wc -c < "${f}" | tr -d '[:space:]')"
  (( want > have )) || return 0
  need=$(( want - have ))
  dd if=/dev/zero bs="${need}" count=1 2>/dev/null | LC_ALL=C tr '\0' 'x' >> "${f}"
}

# build_fixture <dir> <units> <total-bytes> <ratified 0|1>
build_fixture() {
  local P="$1" units="$2" total="$3" ratified="$4"
  local man=$(( total * 30 / 100 )) loops=$(( total * 15 / 100 )) plan=$(( total * 5 / 100 ))
  mkdir -p "${P}/SPEC" "${P}/LOOPS" "${P}/CONTROL"

  local status="RATIFIED"
  [[ "${ratified}" == "1" ]] || status="NOT RATIFIED"
  {
    printf '# Decision register — fixture\n\n'
    printf '| # | Decision | Status | Who | Gates |\n|---|---|---|---|---|\n'
    printf '| D1 | The plain-language feature list | %s | the client | U001-U%03d |\n' "${status}" "${units}"
    printf '| D2 | Deploy target | RATIFIED | the client | U001 |\n'
  } > "${P}/SPEC/DECISIONS.md"

  {
    printf '# MASTER SPEC — fixture\n\n'
    local i
    for (( i = 1; i <= units; i++ )); do
      printf '### U%03d · code · P1 · fixture unit %s\n\n**Depends on:** nothing\n\n' "${i}" "${i}"
    done
  } > "${P}/SPEC/MASTER-SPEC-2026-09-08.md"

  printf '# PROJECT MANIFEST — fixture\n' > "${P}/SPEC/PROJECT-MANIFEST.md"
  printf '# LOOP 1 — fixture\n'          > "${P}/LOOPS/loop-01.md"
  printf '# Execution plan — fixture\n\n## Parallelism Plan\n\nwave 1.\n' > "${P}/CONTROL/EXECUTION-PLAN.md"
  pad_to "${P}/SPEC/PROJECT-MANIFEST.md" "${man}"
  pad_to "${P}/LOOPS/loop-01.md"         "${loops}"
  pad_to "${P}/CONTROL/EXECUTION-PLAN.md" "${plan}"

  # The master spec absorbs the remainder so the TOTAL is exact.
  local dec spec rest
  dec="$(wc -c < "${P}/SPEC/DECISIONS.md" | tr -d '[:space:]')"
  spec="$(wc -c < "${P}/SPEC/MASTER-SPEC-2026-09-08.md" | tr -d '[:space:]')"
  rest=$(( total - man - loops - plan - dec ))
  if (( rest > spec )); then pad_to "${P}/SPEC/MASTER-SPEC-2026-09-08.md" "${rest}"; fi
}

measured_kb() { # measured_kb <dir> — what the fixture actually weighs
  local P="$1" t=0 n f
  while IFS= read -r -d '' f; do
    n="$(wc -c < "${f}" | tr -d '[:space:]')"; t=$(( t + n ))
  done < <(find "${P}/SPEC" "${P}/LOOPS" -type f -print0 2>/dev/null)
  n="$(wc -c < "${P}/CONTROL/EXECUTION-PLAN.md" | tr -d '[:space:]')"; t=$(( t + n ))
  printf '%s' $(( ( t + KB - 1 ) / KB ))
}

run_selftest() {
  local T
  T="$(mktemp -d "${TMPDIR:-/tmp}/right-size-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT

  # --- control 0: every grep this gate leans on, on a known positive -------
  local kp_unit kp_feat kp_not
  printf '### U007 · code · P1 · a card\n' > "${T}/kp.md"
  kp_unit="$("${GREP}" -cE '^[[:space:]]*#{1,6}[[:space:]]*U[0-9]{1,4}([^0-9]|$)' "${T}/kp.md")"
  printf '| D1 | The plain-language feature list | RATIFIED | the client | U001 |\n' > "${T}/kp2.md"
  kp_feat="$("${GREP}" -icE 'feature[[:space:]_-]?list' "${T}/kp2.md")"
  printf '| D1 | The feature list | NOT RATIFIED | the client | U001 |\n' > "${T}/kp3.md"
  kp_not="$("${GREP}" -cE '[Nn][Oo][Tt][[:space:]]+RATIFIED' "${T}/kp3.md")"
  if [[ "${kp_unit}" != "1" || "${kp_feat}" != "1" || "${kp_not}" != "1" ]]; then
    echo "BROKEN INSTRUMENT: the gate's own greps do not match their known-positive controls (unit=${kp_unit} want 1, feature-list=${kp_feat} want 1, not-ratified=${kp_not} want 1). No verdict below can be believed." >&2
    exit 2
  fi
  report 0 "grep-controls" 1 "unit-heading=1, feature-list=1, NOT-RATIFIED=1 (all on ${GREP})"

  local rc out ok kb

  # --- 1: 8 units, 40 KB → 0 (budget = max(40, 48) = 48) -------------------
  local P1="${T}/p1"
  build_fixture "${P1}" 8 40960 1
  kb="$(measured_kb "${P1}")"
  out="$(bash "${SELF}" "${P1}" 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" && "${kb}" == "40" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -qE 'units=8 .*apparatus_kb=40 .*budget_kb=48' || ok=0
  "${GREP}" -q 'OVER-ENGINEERING-CHECK: units=8 apparatus_kb=40 budget_kb=48 removed=0 verdict=PASS' \
    "${P1}/CONTROL/LEDGER.md" 2>/dev/null || ok=0
  report 1 "within-budget-passes" "${ok}" "rc=${rc} (want 0); fixture weighs ${kb} KB (want 40) against budget 48; the ledger line was written; ${out}"

  # --- 2: 8 units, 200 KB → 3, naming the two largest offenders ------------
  local P2="${T}/p2"
  build_fixture "${P2}" 8 204800 1
  kb="$(measured_kb "${P2}")"
  out="$(bash "${SELF}" "${P2}" 2>&1)"; rc=$?
  local named
  named="$(printf '%s\n' "${out}" | "${GREP}" -cE '^  [0-9]+\. ')"
  is_uint "${named}" || named=0
  ok=0; [[ "${rc}" == "3" && "${kb}" == "200" && "${named}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'OVER-BUDGET' || ok=0
  printf '%s\n' "${out}" | "${GREP}" -q "MASTER-SPEC-2026-09-08.md" || ok=0
  printf '%s\n' "${out}" | "${GREP}" -q "PROJECT-MANIFEST.md" || ok=0
  [[ -f "${P2}/CONTROL/LEDGER.md" ]] && ok=0
  report 2 "over-budget-refused" "${ok}" "rc=${rc} (want 3) at ${kb} KB against budget 48; ${named} offenders named (want 2 — the master spec and the manifest, the two largest); no OVER-ENGINEERING-CHECK line was written, so the dispatch gate stays shut"

  # --- 3: the same 8-unit project, feature list NOT RATIFIED → 2 ----------
  local P3="${T}/p3"
  build_fixture "${P3}" 8 40960 0
  out="$(bash "${SELF}" "${P3}" 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'no RATIFIED feature list' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${P3}/SPEC/DECISIONS.md" || ok=0
  [[ -f "${P3}/CONTROL/LEDGER.md" ]] && ok=0
  report 3 "no-ratified-list-refused" "${ok}" "rc=${rc} (want 2). This fixture is fixture 1 with the feature-list row's RATIFIED flipped to NOT RATIFIED and nothing else changed — check 1 passing and this one refusing is a fact about ratification, not a class-wide refusal; ${out}"

  # --- 4: 40 units, 200 KB → 0 (budget = max(40, 240) = 240) --------------
  local P4="${T}/p4"
  build_fixture "${P4}" 40 204800 1
  kb="$(measured_kb "${P4}")"
  out="$(bash "${SELF}" "${P4}" 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" && "${kb}" == "200" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -qE 'units=40 .*apparatus_kb=200 .*budget_kb=240' || ok=0
  "${GREP}" -q 'OVER-ENGINEERING-CHECK: units=40 apparatus_kb=200 budget_kb=240 removed=0 verdict=PASS' \
    "${P4}/CONTROL/LEDGER.md" 2>/dev/null || ok=0
  report 4 "budget-scales-with-units" "${ok}" "rc=${rc} (want 0) at ${kb} KB. THE DISCRIMINATING CASE: the identical 200 KB that fixture 2 refused passes here because 40 units buy a 240 KB budget. A fixed threshold fails this check; ${out}"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'right-size.sh selftest: ALL PASS (5 checks, all four fixtures)\n'
    exit 0
  fi
  printf 'right-size.sh selftest: %s FAILED — this gate is a BROKEN INSTRUMENT; run the over-engineering check by hand and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_check "$@" ;;
esac
