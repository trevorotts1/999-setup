#!/usr/bin/env bash
# width.sh — measure THIS machine and print the width the swarm may use.
# Usage: width.sh              print CLIENT_CAP, BROWSER_CAP, WORKFLOW_CEILING
#        width.sh --selftest   three fixtures + the no-instrument case
#        . width.sh            source it: defines the measure/formula functions
#                              and prints NOTHING (capacity-resolver.sh does this)
#
# THE FORMULA (S1, 2026-09-07) — one formula, everywhere, measured:
#     harness_cap = min(16, cores − 2)         the Workflow tool's own per-workflow
#                                              limit; it queues everything above this
#     ram_cap     = floor((ram_gb − 6) / 1.5)  ~1.5 GB per live agent after 6 GB for
#                                              the OS, the browser, and Claude itself
#     CLIENT_CAP  = max(2, min(harness_cap, ram_cap))
#                 = max(2, min(16, cores−2, floor((ram_gb−6)/1.5)))
#     BROWSER_CAP = floor((ram_gb − 6) / 1.5)  each blind visual judge holds a Chromium
#     WORKFLOW_CEILING = 50                    operator doctrine 2026-08-16, hard
# Worked values: 12 cores / 24 GB → 10 · 8 cores / 16 GB → 6 · 24 cores / 64 GB → 16.
# THE BAR NEVER CHANGES WITH THE MACHINE — ONLY THE WIDTH DOES.
#
# INSTRUMENTS, in the order they are tried (the mark names the one that answered):
#   cores  macOS/BSD  sysctl -n hw.ncpu          Linux  nproc
#          Windows    $NUMBER_OF_PROCESSORS (Git Bash) → wmic → powershell
#   ram    macOS/BSD  sysctl -n hw.memsize       Linux  /proc/meminfo MemTotal
#          Windows    wmic ComputerSystem get TotalPhysicalMemory → powershell
#
# EXIT CODES:
#   0   a width was printed (measured, or the marked fallback below)
#   2   NEITHER instrument answered — no cores AND no RAM. The caller then uses
#       clientCap 4 AND SAYS SO in the ledger; it never stalls and never asks a
#       client how many agents their computer supports.
#   64  a malformed WIDTH_FIXTURE_* value (test-door misuse). That is a usage
#       error, never a fact about the machine.
#
# PROVENANCE — every printed line carries a bracketed mark, and the mark says
# which KIND of number it is, never just where it came from:
#   [MEASURED <instrument> <ISO8601>]   an instrument on this machine answered
#   [FIXTURE  <env names> <ISO8601>]    a WIDTH_FIXTURE_* override answered — the
#                                        selftest's door, and it can never read as
#                                        a measurement
#   [ASSUMED  …]                        cores unmeasurable → the fallback 4
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
# The Node twin is scripts/common/width.mjs and prints the same three lines.

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

# --- THE WIDTH FORMULA (S1) ---------------------------------------------------
# harness_cap = min(16, cores − 2)          the Workflow tool's own limit; it
#                                           queues everything above this itself
# ram_cap     = floor((ram_gb − 6) / 1.5)   ~1.5 GB per live agent after 6 GB for
#                                           the OS, the browser, and Claude
# clientCap   = max(2, min(harness_cap, ram_cap))
# An unmeasurable RAM figure drops ram_cap from the min() and says so — it never
# invents one. THE BAR NEVER SHRINKS; only the width does.
harness_cap_of() {
  local cores="$1" w
  w=$(( cores - 2 ))
  (( w > 16 )) && w=16
  (( w < 1 )) && w=1
  echo "${w}"
}

ram_cap_of() {
  # floor((ram_gb − 6) / 1.5) in integer arithmetic: ((ram_gb − 6) * 2) / 3
  local ram_gb="$1" r
  if (( ram_gb <= 6 )); then echo 0; return 0; fi
  r=$(( ( (ram_gb - 6) * 2 ) / 3 ))
  echo "${r}"
}

client_cap_of() {
  # client_cap_of <harness_cap> [<ram_cap|"">]  — an empty ram_cap means
  # UNDETERMINED RAM: the harness cap governs alone.
  local h="$1" r="${2:-}" c="$1"
  if [[ -n "${r}" ]] && (( r < c )); then c="${r}"; fi
  (( c < 2 )) && c=2
  echo "${c}"
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

  # --- NEITHER instrument answered: the only exit 2 ---------------------------
  if [[ "${cores_kind}" == "UNDETERMINED" && "${ram_kind}" == "UNDETERMINED" ]]; then
    echo "CLIENT_CAP=UNDETERMINED   [UNDETERMINED cores: ${cores_instr}; ram: ${ram_instr} ${now}]"
    echo "BROWSER_CAP=UNDETERMINED   [UNDETERMINED ram: ${ram_instr} ${now}]"
    echo "WORKFLOW_CEILING=${WORKFLOW_CEILING}   ${ceiling_mark}"
    echo "NOTE: neither instrument answered — cores tried ${WIDTH_CORE_SOURCES}; ram tried ${WIDTH_RAM_SOURCES}." >&2
    echo "      The caller uses clientCap 4 AND SAYS SO in the ledger. It never stalls, and it never asks." >&2
    return 2
  fi

  # --- The two caps -----------------------------------------------------------
  local harness_cap="" ram_cap="" client_cap="" browser_cap="" cap_kind="" cap_instr=""
  if [[ "${cores_kind}" == "UNDETERMINED" ]]; then
    # Cores unmeasurable but RAM answered: the harness cap is unknown, so the
    # width is the marked fallback 4 — the same fallback capacity-resolver.sh
    # uses — and it is ASSUMED, never MEASURED.
    client_cap=4
    cap_kind="ASSUMED"
    cap_instr="no-instrument — cores unmeasurable (tried ${WIDTH_CORE_SOURCES}), clientCap fallback 4"
  else
    harness_cap="$(harness_cap_of "${cores}")"
    if [[ "${ram_kind}" == "UNDETERMINED" ]]; then
      client_cap="$(client_cap_of "${harness_cap}" "")"
      cap_kind="${cores_kind}"
      cap_instr="${cores_instr} ${now}; ram UNDETERMINED (tried ${WIDTH_RAM_SOURCES}) — harness cap governs"
    else
      ram_cap="$(ram_cap_of "${ram}")"
      client_cap="$(client_cap_of "${harness_cap}" "${ram_cap}")"
      if [[ "${cores_kind}" == "FIXTURE" || "${ram_kind}" == "FIXTURE" ]]; then
        cap_kind="FIXTURE"
      else
        cap_kind="MEASURED"
      fi
      cap_instr="${cores_instr}+${ram_instr} ${now}"
    fi
  fi

  echo "CLIENT_CAP=${client_cap}   [${cap_kind} ${cap_instr}]"

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

  echo "SELFTEST — width.sh"
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
  _w_case "8-core, 16 GB laptop"      8 16  6  6
  _w_case "24-core, 64 GB Studio"    24 64 16 38

  echo "NO INSTRUMENT — neither answers → exit 2, and the sources are named"
  local rc=0
  ( WIDTH_FIXTURE_NO_INSTRUMENT=1 width_report ) > "${tmp}/noinst.out" 2>"${tmp}/noinst.err" || rc=$?
  if (( rc == 2 )); then
    echo "  [PASS] no instrument → exit 2 (the caller uses 4 and says so)"
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
  if (( rc == 0 )) && [[ "${livecap}" =~ ^[0-9]+$ ]] && (( livecap >= 2 )) \
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
