#!/usr/bin/env bash
# width.sh — measure THIS machine and print the width the swarm may use.
# Usage: width.sh              print CLIENT_CAP, BROWSER_CAP, WORKFLOW_CEILING
#        width.sh --selftest   three fixtures + the no-instrument case
#        . width.sh            source it: defines the measure/formula functions
#                              and prints NOTHING (capacity-resolver.sh does this)
#
# THE RULE (owner contract, 2026-10-06; machine-measured per the owner's ruling):
#     CLIENT_CAP  = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores))
#                                              the per-workflow cap, MEASURED on THIS box
#                                              by hooks/capacity_probe.py -- the ONE place the
#                                              formula and GB_PER_AGENT (1.5 GB of RAM per
#                                              agent: a headless agent session plus its
#                                              tools) are written. A container (cgroup)
#                                              limit beats the host total. A workflow runs
#                                              agent_count = min(CLIENT_CAP, its units)
#                                              agents (references/swarm-plan.md); 10 is a
#                                              ceiling, never a floor.
#     WORKFLOW_CEILING = 50                    operator doctrine 2026-08-16, hard
#                                              (50 workflows x CLIENT_CAP, at most 500 agents)
#     BROWSER_CAP = floor((ram_gb - 6) / 1.5)  each blind visual judge holds a Chromium
# Worked values: 12 cores / 24 GB -> 10 (the operator Mac mini) | 8 cores / 8 GB -> 5 |
# 2 cores / 8 GB -> 2 | 24 cores / 64 GB -> 10 | a 4 GB / 2-core container -> 2.
#
# INSTRUMENTS, in the order they are tried (the mark names the one that answered):
#   cores  macOS/BSD  sysctl -n hw.ncpu          Linux  nproc
#          Windows    $NUMBER_OF_PROCESSORS (Git Bash) → wmic → powershell
#   ram    macOS/BSD  sysctl -n hw.memsize       Linux  /proc/meminfo MemTotal
#          Windows    wmic ComputerSystem get TotalPhysicalMemory → powershell
#
# EXIT CODES:
#   0   a width was printed (measured, or the marked fallback below)
#   2   NEITHER instrument answered (or python3 / the probe is missing) — no cap
#       could be measured. The caller then uses UNDETERMINED_CAP (4, the
#       conservative floor) AND SAYS SO in the ledger; it never stalls and never
#       asks a client how many agents their computer supports.
#   64  a malformed WIDTH_FIXTURE_* value (test-door misuse). That is a usage
#       error, never a fact about the machine.
#
# PROVENANCE — every printed line carries a bracketed mark, and the mark says
# which KIND of number it is, never just where it came from:
#   [MEASURED <instrument> <ISO8601>]   an instrument on this machine answered
#   [FIXTURE  <env names> <ISO8601>]    a WIDTH_FIXTURE_* override answered — the
#                                        selftest's door, and it can never read as
#                                        a measurement
#   [UNDETERMINED …]                    nothing answered; the sources tried are named
#   WORKFLOW_CEILING carries [DEFAULT-CONFIRMED operator-doctrine-2026-08-16 …]
#   because 50 is an operator ruling, not an instrument reading. A constant that
#   printed [MEASURED] would be a lie about its own origin.
#
# THE TEST DOOR is deliberately NOT inside measure_cores/measure_ram_gb: those two
# stay pure instruments, so sourcing this file into capacity-resolver.sh adds no
# environment read to the width path (S1: measured on this machine — never
# declared, never asked, never an environment read). WIDTH_FIXTURE_CORES,
# WIDTH_FIXTURE_RAM_GB and WIDTH_FIXTURE_NO_INSTRUMENT are read ONLY by the
# reporting layer below, and every value they produce prints [FIXTURE …].
#
# Bash 3.2 compatible: no `declare -A`, no `mapfile`, no `${var^^}`.
# The Node twin is scripts/common/width.mjs and prints the same three lines (it asks the
# same capacity_probe.py, so the two can never compute different caps).

set -u

WORKFLOW_CEILING="${WORKFLOW_CEILING:-50}"   # operator doctrine 2026-08-16, hard

# --- Measure cores. Never inherit a number. -----------------------------------
# Prints "<n> <instrument>" — the instrument NAMES itself so the ledger's
# [MEASURED …] mark can say which one answered (capacity.md section 13.2). A
# silent number is a number nobody can defend.
measure_cores() {
  local n="" instrument=""
  if command -v sysctl >/dev/null 2>&1; then
    n="$(sysctl -n hw.ncpu 2>/dev/null || true)"
    [[ -n "${n}" ]] && instrument="sysctl-hw.ncpu"
  fi
  if [[ -z "${n}" ]] && command -v nproc >/dev/null 2>&1; then
    n="$(nproc 2>/dev/null || true)"
    [[ -n "${n}" ]] && instrument="nproc"
  fi
  # --- Windows, in the order Git Bash can answer ---
  if [[ -z "${n}" && -n "${NUMBER_OF_PROCESSORS:-}" ]]; then
    n="${NUMBER_OF_PROCESSORS}"
    [[ -n "${n}" ]] && instrument="env-NUMBER_OF_PROCESSORS"
  fi
  if [[ -z "${n}" ]] && command -v wmic >/dev/null 2>&1; then
    n="$(wmic cpu get NumberOfLogicalProcessors 2>/dev/null | tr -d '\r' \
         | awk 'NR>1 && $1 ~ /^[0-9]+$/ { s += $1 } END { if (s > 0) print s }' || true)"
    [[ -n "${n}" ]] && instrument="wmic-NumberOfLogicalProcessors"
  fi
  if [[ -z "${n}" ]] && command -v powershell >/dev/null 2>&1; then
    n="$(powershell -NoProfile -NonInteractive -Command '[Environment]::ProcessorCount' 2>/dev/null \
         | tr -d '\r' | awk 'NR==1 { print $1 }' || true)"
    [[ -n "${n}" ]] && instrument="powershell-ProcessorCount"
  fi
  if [[ -z "${n}" ]]; then
    echo ""    # UNDETERMINED is a correct answer — the caller must ask
    return 1
  fi
  echo "${n} ${instrument}"
}

# --- Measure RAM in whole GB. Never inherit a number. -------------------------
# Prints "<gb> <instrument>", same contract as measure_cores: the instrument
# names itself so the ledger's [MEASURED …] mark can say which one answered.
measure_ram_gb() {
  local bytes="" kb="" gb="" instrument=""
  if command -v sysctl >/dev/null 2>&1; then
    bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
    if [[ "${bytes}" =~ ^[0-9]+$ ]]; then
      gb=$(( bytes / 1073741824 )); instrument="sysctl-hw.memsize"
    fi
  fi
  if [[ -z "${gb}" && -r /proc/meminfo ]]; then
    kb="$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null || true)"
    if [[ "${kb}" =~ ^[0-9]+$ ]]; then
      gb=$(( kb / 1048576 )); instrument="proc-meminfo-MemTotal"
    fi
  fi
  # --- Windows, in the order Git Bash can answer ---
  if [[ -z "${gb}" ]] && command -v wmic >/dev/null 2>&1; then
    bytes="$(wmic ComputerSystem get TotalPhysicalMemory 2>/dev/null | tr -d '\r' \
             | awk 'NR>1 && $1 ~ /^[0-9]+$/ { print $1; exit }' || true)"
    if [[ "${bytes}" =~ ^[0-9]+$ ]]; then
      gb=$(( bytes / 1073741824 )); instrument="wmic-TotalPhysicalMemory"
    fi
  fi
  if [[ -z "${gb}" ]] && command -v powershell >/dev/null 2>&1; then
    bytes="$(powershell -NoProfile -NonInteractive -Command \
             '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory' 2>/dev/null \
             | tr -d '\r' | awk 'NR==1 { print $1 }' || true)"
    if [[ "${bytes}" =~ ^[0-9]+$ ]]; then
      gb=$(( bytes / 1073741824 )); instrument="powershell-TotalPhysicalMemory"
    fi
  fi
  if [[ -z "${gb}" ]]; then
    echo ""    # UNDETERMINED is a correct answer — the harness cap then governs alone
    return 1
  fi
  echo "${gb} ${instrument}"
}

# --- THE WIDTH RULE -----------------------------------------------------------
# clientCap = clamp(1, 10, min(floor(ram_gb / GB_PER_AGENT), cores)), computed by
# hooks/capacity_probe.py and by nothing else: this file carries NO copy of the
# formula or of GB_PER_AGENT.
UNDETERMINED_CAP=4   # used (and named in the ledger) only when no cap could be measured
WIDTH_PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hooks"
WIDTH_PY=""
for _py in python3 python; do
  if command -v "${_py}" >/dev/null 2>&1 && "${_py}" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then WIDTH_PY="${_py}"; break; fi
done

# measure_capacity -> "<cap> <ram_gb> <cores> <source>" for THIS box, container limits applied. rc 1 = no answer.
measure_capacity() {
  [[ -n "${WIDTH_PY}" && -r "${WIDTH_PROBE_DIR}/capacity_probe.py" ]] || return 1
  "${WIDTH_PY}" "${WIDTH_PROBE_DIR}/capacity_probe.py" 2>/dev/null \
    | "${WIDTH_PY}" -c 'import json,sys; r=json.load(sys.stdin); print(r["per_workflow_cap"], r["ram_gb"], r["cores"], r["source"])' 2>/dev/null
}

# client_cap_of <ram_gb> <cores> -> the cap for SUPPLIED inputs (fixtures, answers files); same formula, same file.
client_cap_of() {
  [[ -n "${WIDTH_PY}" && -r "${WIDTH_PROBE_DIR}/capacity_probe.py" ]] || return 1
  "${WIDTH_PY}" -c 'import sys; sys.path.insert(0, sys.argv[1]); import capacity_probe as c; print(c.compute(float(sys.argv[2]), float(sys.argv[3]), "supplied")["per_workflow_cap"])' \
    "${WIDTH_PROBE_DIR}" "$1" "$2" 2>/dev/null
}

ram_cap_of() {
  # floor((ram_gb - 6) / 1.5) in integer arithmetic: ((ram_gb - 6) * 2) / 3
  local ram_gb="$1" r
  if (( ram_gb <= 6 )); then echo 0; return 0; fi
  r=$(( ( (ram_gb - 6) * 2 ) / 3 ))
  echo "${r}"
}

browser_cap_of() {
  # BROWSER_CAP = floor((ram_gb − 6) / 1.5) — the same RAM arithmetic as ram_cap:
  # each blind visual judge holds a Chromium, so the browser lane is RAM-bound and
  # nothing else. Named separately because the two caps answer different questions.
  ram_cap_of "$1"
}

width_now_utc() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# The sources tried, named — a negative result names what it checked or it is not
# a result (capacity.md section 13.2; the operator's negative-result contract).
WIDTH_CORE_SOURCES="sysctl-hw.ncpu, nproc, \$NUMBER_OF_PROCESSORS, wmic, powershell"
WIDTH_RAM_SOURCES="sysctl-hw.memsize, /proc/meminfo MemTotal, wmic, powershell"

# =============================================================================
# THE REPORT — the only layer that reads WIDTH_FIXTURE_* (see the header).
# =============================================================================
width_report() {
  local now cores="" cores_instr="" cores_kind="" ram="" ram_instr="" ram_kind=""
  local raw=""
  now="$(width_now_utc)"

  if [[ "${WIDTH_FIXTURE_NO_INSTRUMENT:-0}" == "1" ]]; then
    cores_kind="UNDETERMINED"; ram_kind="UNDETERMINED"
    cores_instr="fixture: every instrument silenced"
    ram_instr="fixture: every instrument silenced"
  else
    if [[ -n "${WIDTH_FIXTURE_CORES:-}" ]]; then
      if [[ ! "${WIDTH_FIXTURE_CORES}" =~ ^[0-9]+$ ]] || (( WIDTH_FIXTURE_CORES < 1 )); then
        echo "ERROR: WIDTH_FIXTURE_CORES must be a positive whole number (got: ${WIDTH_FIXTURE_CORES})" >&2
        return 64
      fi
      cores="${WIDTH_FIXTURE_CORES}"; cores_instr="WIDTH_FIXTURE_CORES"; cores_kind="FIXTURE"
    else
      raw="$(measure_cores)" || true
      cores="${raw%% *}"; cores_instr="${raw##* }"
      if [[ "${cores}" =~ ^[0-9]+$ ]] && (( cores >= 1 )); then
        cores_kind="MEASURED"
      else
        cores=""; cores_kind="UNDETERMINED"; cores_instr="none (tried ${WIDTH_CORE_SOURCES})"
      fi
    fi

    if [[ -n "${WIDTH_FIXTURE_RAM_GB:-}" ]]; then
      if [[ ! "${WIDTH_FIXTURE_RAM_GB}" =~ ^[0-9]+$ ]] || (( WIDTH_FIXTURE_RAM_GB < 1 )); then
        echo "ERROR: WIDTH_FIXTURE_RAM_GB must be a positive whole number of GB (got: ${WIDTH_FIXTURE_RAM_GB})" >&2
        return 64
      fi
      ram="${WIDTH_FIXTURE_RAM_GB}"; ram_instr="WIDTH_FIXTURE_RAM_GB"; ram_kind="FIXTURE"
    else
      raw="$(measure_ram_gb)" || true
      ram="${raw%% *}"; ram_instr="${raw##* }"
      if [[ "${ram}" =~ ^[0-9]+$ ]] && (( ram >= 1 )); then
        ram_kind="MEASURED"
      else
        ram=""; ram_kind="UNDETERMINED"; ram_instr="none (tried ${WIDTH_RAM_SOURCES})"
      fi
    fi
  fi

  local ceiling_mark="[DEFAULT-CONFIRMED operator-doctrine-2026-08-16 ${now}]"

  # --- THE CAP: one probe, one formula (hooks/capacity_probe.py) ---------------
  local client_cap="" cap_kind="" cap_instr="" probe_out=""
  if [[ "${cores_kind}" == "FIXTURE" || "${ram_kind}" == "FIXTURE" ]]; then
    # A fixture supplies the inputs; the cap is still the probe's formula on them.
    if [[ -n "${cores}" && -n "${ram}" ]]; then
      client_cap="$(client_cap_of "${ram}" "${cores}")" || client_cap=""
      cap_kind="FIXTURE"; cap_instr="${cores_instr}+${ram_instr} ${now}"
    fi
  elif [[ "${WIDTH_FIXTURE_NO_INSTRUMENT:-0}" != "1" ]]; then
    probe_out="$(measure_capacity)" || probe_out=""
    if [[ -n "${probe_out}" ]]; then
      client_cap="${probe_out%% *}"
      cap_kind="MEASURED"; cap_instr="capacity_probe.py ${probe_out##* } ${now}; effective $(echo "${probe_out}" | awk '{print $2" GB, "$3" cores"}') (a container limit beats the host total)"
    fi
  fi
  if [[ ! "${client_cap}" =~ ^[0-9]+$ ]]; then
    echo "CLIENT_CAP=UNDETERMINED   [UNDETERMINED capacity_probe.py unavailable or neither RAM nor cores answered (cores tried ${WIDTH_CORE_SOURCES}; ram tried ${WIDTH_RAM_SOURCES}; needs python3 3.8+) ${now}]"
    if [[ "${ram_kind}" == "UNDETERMINED" ]]; then
      echo "BROWSER_CAP=UNDETERMINED   [UNDETERMINED ram: none (tried ${WIDTH_RAM_SOURCES}) ${now}]"
    else
      echo "BROWSER_CAP=$(browser_cap_of "${ram}")   [${ram_kind} ${ram_instr} ${now}]"
    fi
    echo "WORKFLOW_CEILING=${WORKFLOW_CEILING}   ${ceiling_mark}"
    echo "NOTE: no per-workflow cap could be measured — cores tried ${WIDTH_CORE_SOURCES}; ram tried ${WIDTH_RAM_SOURCES}; capacity_probe.py needs python3 3.8+." >&2
    echo "      The caller uses UNDETERMINED_CAP=${UNDETERMINED_CAP} AND SAYS SO in the ledger. It never stalls, and it never asks." >&2
    return 2
  fi
  echo "CLIENT_CAP=${client_cap}   [${cap_kind} ${cap_instr}]"

  local browser_cap=""
  if [[ "${ram_kind}" == "UNDETERMINED" ]]; then
    echo "BROWSER_CAP=UNDETERMINED   [UNDETERMINED ram: none (tried ${WIDTH_RAM_SOURCES}) ${now}]"
  else
    browser_cap="$(browser_cap_of "${ram}")"
    echo "BROWSER_CAP=${browser_cap}   [${ram_kind} ${ram_instr} ${now}]"
  fi

  echo "WORKFLOW_CEILING=${WORKFLOW_CEILING}   ${ceiling_mark}"

  if [[ "${cores_kind}" == "FIXTURE" || "${ram_kind}" == "FIXTURE" ]]; then
    echo "NOTE: a WIDTH_FIXTURE_* override is active — this run is a FIXTURE, not a measurement." >&2
  fi
  return 0
}

# =============================================================================
# THE SELFTEST — three fixtures, the no-instrument case, and the live control.
# A checker that cannot tell a fixture from the machine proves nothing, so the
# live run is asserted too: if the CONTROL fails, this checker is broken, not
# the box.
# =============================================================================
width_selftest() {
  local fails=0 tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/width-selftest.XXXXXX")" || {
    echo "SELFTEST: FAIL — could not create temp dir" >&2; return 1; }

  echo "SELFTEST — width.sh (the cap comes from hooks/capacity_probe.py; this file holds no formula)"
  echo

  _w_case() {   # _w_case <label> <cores> <ram_gb> <want_client> <want_browser>
    local label="$1" c="$2" r="$3" wantc="$4" wantb="$5" rc=0 gotc gotb
    ( WIDTH_FIXTURE_CORES="${c}" WIDTH_FIXTURE_RAM_GB="${r}" width_report ) \
      > "${tmp}/case.out" 2>"${tmp}/case.err" || rc=$?
    gotc="$(/usr/bin/grep -m1 '^CLIENT_CAP=' "${tmp}/case.out" | sed 's/^CLIENT_CAP=//; s/ .*$//')"
    gotb="$(/usr/bin/grep -m1 '^BROWSER_CAP=' "${tmp}/case.out" | sed 's/^BROWSER_CAP=//; s/ .*$//')"
    if (( rc != 0 )); then
      echo "  [FAIL] ${label}: exit ${rc}, expected 0"; fails=$(( fails + 1 )); return 0
    fi
    if [[ "${gotc}" != "${wantc}" ]]; then
      echo "  [FAIL] ${label}: ${c} cores, ${r} GB → CLIENT_CAP ${gotc}, expected ${wantc}"
      fails=$(( fails + 1 )); return 0
    fi
    if [[ "${gotb}" != "${wantb}" ]]; then
      echo "  [FAIL] ${label}: ${c} cores, ${r} GB → BROWSER_CAP ${gotb}, expected ${wantb}"
      fails=$(( fails + 1 )); return 0
    fi
    if ! /usr/bin/grep -qF -- '[FIXTURE ' "${tmp}/case.out"; then
      echo "  [FAIL] ${label}: a fixture run did not print a [FIXTURE …] mark"
      fails=$(( fails + 1 )); return 0
    fi
    if /usr/bin/grep -qF -- '[MEASURED ' "${tmp}/case.out"; then
      echo "  [FAIL] ${label}: a fixture run printed [MEASURED …] — a fixture may never read as a measurement"
      fails=$(( fails + 1 )); return 0
    fi
    if ! /usr/bin/grep -qF -- "WORKFLOW_CEILING=${WORKFLOW_CEILING}" "${tmp}/case.out"; then
      echo "  [FAIL] ${label}: WORKFLOW_CEILING=${WORKFLOW_CEILING} missing"
      fails=$(( fails + 1 )); return 0
    fi
    echo "  [PASS] ${label}: ${c} cores, ${r} GB → CLIENT_CAP ${gotc}, BROWSER_CAP ${gotb}, exit 0"
  }

  echo "FIXTURES — the S1 worked values"
  _w_case "operator Mac mini"        12 24 10 12
  _w_case "8-core, 16 GB laptop"      8 16  8  6
  _w_case "24-core, 64 GB Studio"    24 64 10 38
  _w_case "2-core, 8 GB small box"    2  8  2  1
  _w_case "8-core, 8 GB VPS"          8  8  5  1
  _w_case "1-core, 2 GB micro box"    1  2  1  0

  echo "NO INSTRUMENT — neither answers → exit 2, and the sources are named"
  local rc=0
  ( WIDTH_FIXTURE_NO_INSTRUMENT=1 width_report ) > "${tmp}/noinst.out" 2>"${tmp}/noinst.err" || rc=$?
  if (( rc == 2 )); then
    echo "  [PASS] no instrument → exit 2 (the caller uses UNDETERMINED_CAP ${UNDETERMINED_CAP} and says so)"
  else
    echo "  [FAIL] no instrument → exit ${rc}, expected 2"; fails=$(( fails + 1 ))
  fi
  if /usr/bin/grep -q '^CLIENT_CAP=UNDETERMINED' "${tmp}/noinst.out"; then
    echo "  [PASS] no instrument → CLIENT_CAP=UNDETERMINED, never a silent number"
  else
    echo "  [FAIL] no instrument → CLIENT_CAP was not UNDETERMINED"; fails=$(( fails + 1 ))
  fi
  if /usr/bin/grep -qF -- '[MEASURED ' "${tmp}/noinst.out"; then
    echo "  [FAIL] an unmeasurable box claimed a measurement"; fails=$(( fails + 1 ))
  else
    echo "  [PASS] an unmeasurable box never claims a measurement"
  fi
  if /usr/bin/grep -qF -- 'sysctl-hw.ncpu' "${tmp}/noinst.err"; then
    echo "  [PASS] the negative names the sources it tried"
  else
    echo "  [FAIL] the negative did not name the sources it tried"; fails=$(( fails + 1 ))
  fi

  echo "CONTROL — the live machine (if this fails, the CHECK is broken, not the box)"
  rc=0
  width_report > "${tmp}/live.out" 2>"${tmp}/live.err" || rc=$?
  local livecap
  livecap="$(/usr/bin/grep -m1 '^CLIENT_CAP=' "${tmp}/live.out" | sed 's/^CLIENT_CAP=//; s/ .*$//')"
  if (( rc == 0 )) && [[ "${livecap}" =~ ^[0-9]+$ ]] && (( livecap >= 1 && livecap <= 10 )) \
     && /usr/bin/grep -qF -- '[MEASURED ' "${tmp}/live.out"; then
    echo "  [PASS] live: CLIENT_CAP=${livecap} with a [MEASURED …] mark, exit 0"
  else
    echo "  [FAIL] live: exit ${rc}, CLIENT_CAP=${livecap:-<none>}, mark check failed — this checker cannot be trusted"
    fails=$(( fails + 1 ))
  fi

  echo "INSTRUMENT PROOF — a malformed fixture is refused, never used"
  rc=0
  ( WIDTH_FIXTURE_CORES=abc width_report ) > "${tmp}/bad.out" 2>"${tmp}/bad.err" || rc=$?
  if (( rc == 64 )) && /usr/bin/grep -q 'WIDTH_FIXTURE_CORES must be a positive whole number' "${tmp}/bad.err"; then
    echo "  [PASS] a non-numeric fixture is refused with a plain ERROR (exit 64)"
  else
    echo "  [FAIL] a non-numeric fixture was accepted (exit ${rc}) — arithmetic on it is a shell crash"
    fails=$(( fails + 1 ))
  fi

  rm -rf "${tmp}"
  echo
  if (( fails == 0 )); then
    echo "SELFTEST: PASS — all fixture, no-instrument, control and instrument checks passed"
    return 0
  fi
  echo "SELFTEST: FAIL (${fails} check(s) failed)"
  return 1
}

# =============================================================================
# Sourced (capacity-resolver.sh does this) → define and print nothing.
# Executed → report, or run the selftest.
# =============================================================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    --selftest) width_selftest; exit $? ;;
    ""|--print) width_report; exit $? ;;
    -h|--help)
      /usr/bin/sed -n '2,45p' "${BASH_SOURCE[0]}" | /usr/bin/sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "ERROR: unknown argument: ${1} (usage: width.sh [--print|--selftest|--help])" >&2
      exit 64 ;;
  esac
fi
