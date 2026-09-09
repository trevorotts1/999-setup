#!/usr/bin/env bash
# gate0.sh — the mechanical half of GATE 0 (SKILL.md section 2, "ultracode, hard
# stop"). GATE 0 tests three signals in order and stops at the first affirmative:
#
#   1. an ultracode system reminder in this turn        (read by the model, not here)
#   2. the word `ultracode` in the invoking message     (read by the model, not here)
#   3. CONTROL/.gate0-proven in the project folder      (THIS SCRIPT owns signal 3)
#
# Signal 3 exists so a RESUMED run passes without the client typing anything
# technical: their one restart sentence is `<launcher> --resume` and carries no
# keyword. The marker is written by `--record` only after signal 1 or 2 genuinely
# passed in some earlier turn, and it is written INTO THE PROJECT FOLDER, so it can
# never make a FRESH run skip the gate — a new project has no marker and the hard
# stop fires exactly as before.
#
# `--effort ultracode` on the command line is NOT a detectable signal: the flag is
# accepted by the launcher (a bogus value warns on stderr, `ultracode` does not) but
# it leaves nothing this skill can read, which is why a headless driver puts the word
# in the first message instead (references/terminals.md, RESUME-INVOCATION).
#
# THE MARKER — <project>/CONTROL/.gate0-proven, exactly three lines:
#
#   signal=<reminder|keyword>
#   recorded=<ISO8601Z>
#   project=<project folder's own name>
#
# Anything else is MALFORMED, and a malformed marker is UNDETERMINED (exit 2), never
# a pass. `project=` is the anti-laundering field: a marker copied out of another
# project names that project and is refused here.
#
# USAGE
#   gate0.sh <project> --check              is signal 3 present in THAT folder?
#   gate0.sh <project> --record <signal>    record a genuine pass by signal 1 or 2
#   gate0.sh --check <project>              same, flags first
#   gate0.sh --record <signal> <project>    same, flags first
#   gate0.sh --open <dir>                   first-turn engagement marker (RC-16)
#   gate0.sh --selftest                     prove the instrument, then exit
#
# `--record` writes the marker AND one line through tools/ledger.sh:
#   <ISO8601Z> | GATE0: passed via=<signal>
# It is idempotent: a project that already carries a valid marker is not rewritten
# and gets no second ledger line, so "one GATE0 line per project" holds across
# every resumed turn.
#
# THE ENGAGEMENT MARKER — <dir>/.spec-protocol-opened-<ISO8601Z>, zero bytes.
#
# `--open <dir>` is the FIRST action of step 3, before the opening script is spoken
# (SKILL.md section 3). It answers the one question nothing else could: did this
# skill engage AT ALL on turn 1? A turn where the skill never engages produces no
# project folder, no ledger, no GATE 0 pass and no GATE 0 refusal — a silent no-op
# every downstream check reads as a run that merely started later. The marker is
# written into the SESSION working directory it is handed: never a project folder
# (none exists yet at that instant), never anywhere under $HOME.
#
# It is written ONLY when that same folder already carries a believable signal-3
# marker — the one `--record` wrote. There is no second source of truth: `--open`
# asks `--check`'s own logic and writes nothing when the answer is anything but a
# pass. It is idempotent, so one launch directory carries exactly one marker
# however many turns call it, and it writes no ledger line (at step 3 there is no
# ledger yet). See EXIT CODES 0 and 2 below for the `--open` half of the contract.
#
# EXIT CODES
#   0 — PASS: the marker is present and well formed (--check), or recorded (--record),
#       or the engagement marker was written or was already there (--open; path on stdout)
#   1 — NO MARKER: this project folder carries no signal 3. Not an error — it is the
#       answer a fresh project must give, and the caller falls through to the refusal
#       only when signals 1 and 2 also failed.
#   2 — UNDETERMINED: a marker that cannot be believed (malformed, unreadable, or
#       naming another project), or an instrument failure (bad usage, unwritable
#       folder). NEVER a pass — a broken checker is a fact about the checker.
#       For `--open` it also covers "no genuine pass is recorded here", and NOTHING
#       is written: an engagement marker on a failed gate would let a canary read a
#       silent no-op as a success, which is the whole failure RC-16 exists to catch.
#   3 — REFUSED: `--record` was given a signal name other than `reminder` or
#       `keyword`. Only a signal the gate actually tests may be recorded as one, and
#       nothing is written.
#   5 — the marker was written but the ledger line was NOT. Loud, never silent.
#   6 — the selftest FAILED: this checker may not be believed until it is fixed.
set -u

SELF="$0"
case "${SELF}" in
  /*) ;;
  *)  SELF="$(cd "$(dirname "${SELF}")" 2>/dev/null && pwd)/$(basename "${SELF}")" ;;
esac
SCRIPT_DIR="$(cd "$(dirname "${SELF}")" && pwd)"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

# grep resolved once, by absolute path first (the skill's census rule: an aliased or
# shadowed grep is not the instrument you think it is). An unresolvable grep makes
# every shape question UNKNOWN, and this script says so rather than guessing.
GGREP="/usr/bin/grep"
if [ ! -x "${GGREP}" ]; then
  if [ -x /bin/grep ]; then GGREP="/bin/grep"; else GGREP="$(command -v grep 2>/dev/null || true)"; fi
fi

MARKER_REL="CONTROL/.gate0-proven"
LEDGER_REL="CONTROL/LEDGER.md"
VALID_SIGNALS="reminder keyword"
ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

undetermined() {  # undetermined <reason>
  echo "GATE0 | verdict=UNDETERMINED | reason=$1" >&2
  exit 2
}

signal_ok() {  # signal_ok <name>
  case " ${VALID_SIGNALS} " in
    *" $1 "*) return 0 ;;
    *)        return 1 ;;
  esac
}

# field <file> <key> — prints the value of a single "key=value" line, or nothing.
field() {
  [ -n "${GGREP}" ] || return 1
  "${GGREP}" -E "^$2=" "$1" 2>/dev/null | head -1 | sed "s/^$2=//"
}

slug_of() {  # slug_of <path> — the project folder's own name, resolved when it exists
  local p="$1" r
  if [ -d "${p}" ]; then
    r="$(cd "${p}" 2>/dev/null && pwd)"
    [ -n "${r}" ] && p="${r}"
  fi
  basename "${p%/}"
}

# ============================================================================
# --check — does THIS project folder carry a believable signal 3?
# ============================================================================
do_check() {
  local project="$1" marker slug sig ts owner
  marker="${project%/}/${MARKER_REL}"
  slug="$(slug_of "${project}")"

  if [ ! -e "${marker}" ]; then
    echo "GATE0 CHECK | project=${slug} | marker=${marker} | verdict=NO-MARKER | signal3=absent"
    return 1
  fi
  [ -r "${marker}" ] || undetermined "marker exists but is not readable: ${marker}"
  [ -s "${marker}" ] || undetermined "marker is empty: ${marker}"
  [ -n "${GGREP}" ] || undetermined "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the marker's shape is UNKNOWN, and unknown is not a pass"

  sig="$(field "${marker}" signal)"
  ts="$(field "${marker}" recorded)"
  owner="$(field "${marker}" project)"

  if [ -z "${sig}" ] || ! signal_ok "${sig}"; then
    undetermined "marker names signal='${sig}' which is not one of: ${VALID_SIGNALS} (${marker})"
  fi
  if ! printf '%s' "${ts}" | "${GGREP}" -qE "${ISO_RE}"; then
    undetermined "marker carries recorded='${ts}', which is not an ISO8601Z timestamp (${marker})"
  fi
  if [ -n "${owner}" ] && [ "${owner}" != "${slug}" ]; then
    undetermined "marker was recorded for project '${owner}', not '${slug}' — a marker carried in from another project is not proof here (${marker})"
  fi

  echo "GATE0 CHECK | project=${slug} | marker=${marker} | verdict=PASS | via=${sig} | recorded=${ts}"
  return 0
}

# ============================================================================
# --record — a genuine pass by signal 1 or 2 becomes signal 3 for every later turn
# ============================================================================
do_record() {
  local project="$1" signal="$2" marker slug ts tmp out rc existing
  if ! signal_ok "${signal}"; then
    echo "GATE0 RECORD | verdict=REFUSED | signal=${signal} | valid=${VALID_SIGNALS}" >&2
    echo "Only a signal GATE 0 actually tests may be recorded as one. Nothing was written." >&2
    exit 3
  fi

  marker="${project%/}/${MARKER_REL}"
  slug="$(slug_of "${project}")"

  # Already proven, and provably so: do not rewrite, do not ledger twice.
  if [ -e "${marker}" ]; then
    if out="$(do_check "${project}" 2>/dev/null)"; then
      existing="$(field "${marker}" signal)"
      echo "GATE0 RECORD | project=${slug} | marker=${marker} | verdict=ALREADY | via=${existing} | ledger=unchanged"
      return 0
    fi
    echo "GATE0 RECORD | project=${slug} | marker=${marker} | note=repairing-malformed-marker" >&2
  fi

  mkdir -p "${project%/}/CONTROL" 2>/dev/null || undetermined "cannot create ${project%/}/CONTROL — the marker could not be written"
  [ -w "${project%/}/CONTROL" ] || undetermined "${project%/}/CONTROL is not writable — the marker could not be written"

  ts="$(iso_now)"
  tmp="${marker}.tmp.$$"
  {
    echo "signal=${signal}"
    echo "recorded=${ts}"
    echo "project=${slug}"
  } > "${tmp}" 2>/dev/null || undetermined "could not write ${tmp}"
  mv -f "${tmp}" "${marker}" 2>/dev/null || { rm -f "${tmp}" 2>/dev/null; undetermined "could not move ${tmp} into place at ${marker}"; }

  echo "GATE0 RECORD | project=${slug} | marker=${marker} | verdict=RECORDED | via=${signal} | recorded=${ts}"

  if [ ! -x "${LEDGER_SH}" ]; then
    echo "GATE0 RECORD | ledger=NOT-WRITTEN | reason=tools/ledger.sh missing or not executable at ${LEDGER_SH}" >&2
    exit 5
  fi
  out="$("${LEDGER_SH}" "${project}" "${LEDGER_REL}" "${ts} | GATE0: passed via=${signal}" 2>&1)"; rc=$?
  if [ "${rc}" != "0" ]; then
    echo "GATE0 RECORD | ledger=NOT-WRITTEN | rc=${rc} | ${out}" >&2
    exit 5
  fi
  echo "GATE0 RECORD | ledger=${project%/}/${LEDGER_REL} | line=GATE0: passed via=${signal}"
  return 0
}

# ============================================================================
# --open — the first-turn engagement marker (RC-16): proof the skill engaged
# ============================================================================
do_open() {
  local dir="$1" slug sig ts marker existing f out
  slug="$(slug_of "${dir}")"

  # The ONE authority is the pass `--record` already wrote into this same folder.
  # do_check runs in a command substitution — a subshell — so its own `exit 2`
  # cannot end this script, and BOTH of its negatives mean the same thing here:
  # rc 1 (no marker) and rc 2 (a marker that cannot be believed) are alike "nothing
  # was proven", so nothing is written and the caller is told which folder it asked.
  if ! out="$(do_check "${dir}" 2>/dev/null)"; then
    echo "GATE0 OPEN | dir=${slug} | verdict=NO-RECORDED-PASS | marker=NOT-WRITTEN | reason=${dir%/}/${MARKER_REL} does not record a genuine GATE 0 pass" >&2
    exit 2
  fi
  sig="$(field "${dir%/}/${MARKER_REL}" signal)"

  # Idempotent: one launch directory carries exactly ONE marker, however many turns
  # call --open, so the canary's census can never read one engagement as several.
  existing=""
  for f in "${dir%/}"/.spec-protocol-opened-*; do
    [ -e "${f}" ] || continue
    existing="${f}"
    break
  done
  if [ -n "${existing}" ]; then
    echo "GATE0 OPEN | dir=${slug} | verdict=ALREADY | via=${sig} | marker=${existing}"
    return 0
  fi

  [ -w "${dir%/}" ] || undetermined "${dir%/} is not writable — the engagement marker could not be written"
  ts="$(iso_now)"
  printf '%s' "${ts}" | "${GGREP}" -qE "${ISO_RE}" \
    || undetermined "date -u produced '${ts}', which is not an ISO8601Z timestamp — the marker name would be unparseable"
  marker="${dir%/}/.spec-protocol-opened-${ts}"
  : > "${marker}" 2>/dev/null || undetermined "could not write ${marker}"
  echo "GATE0 OPEN | dir=${slug} | verdict=OPENED | via=${sig} | recorded=${ts} | marker=${marker}"
  return 0
}

# ============================================================================
# --selftest — the instrument proves itself, on fixtures, before anyone trusts it
# ============================================================================
ST_FAILS=0
st_ok()  { echo "SELFTEST ok   | $1"; }
st_bad() { echo "SELFTEST FAIL | $1"; ST_FAILS=$((ST_FAILS + 1)); }

selftest() {
  local tmp A B C rc out
  tmp="$(mktemp -d)" || { echo "SELFTEST | UNDETERMINED | cannot mktemp" >&2; exit 6; }
  trap 'rm -rf "${tmp}"' EXIT
  A="${tmp}/alpha-bakery"; B="${tmp}/beta-framing"; C="${tmp}/gamma-garage"
  mkdir -p "${A}" "${B}" "${C}"
  echo "gate0.sh --selftest | self=${SELF} | fixtures=${tmp}"

  # ---- FIXTURE 1: no marker -> rc 1, and it is NOT called an error -------------
  out="$("${SELF}" "${A}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "1" ] && printf '%s' "${out}" | "${GGREP}" -q 'verdict=NO-MARKER'; then
    st_ok "FIXTURE 1 marker-absent | rc=1 NO-MARKER | ${A}"
  else
    st_bad "FIXTURE 1 marker-absent | rc=${rc} (want 1) | ${out}"
  fi

  # ---- FIXTURE 2: --record keyword -> marker + ledger line + --check passes ----
  out="$("${SELF}" "${A}" --record keyword 2>&1)"; rc=$?
  local m="${A}/${MARKER_REL}" sig ts led
  sig="$(field "${m}" signal 2>/dev/null)"
  ts="$(field "${m}" recorded 2>/dev/null)"
  led="$("${GGREP}" -c 'GATE0: passed via=keyword' "${A}/${LEDGER_REL}" 2>/dev/null)"
  [ -n "${led}" ] || led=0
  if [ "${rc}" = "0" ] && [ "${sig}" = "keyword" ] && printf '%s' "${ts}" | "${GGREP}" -qE "${ISO_RE}" && [ "${led}" = "1" ]; then
    st_ok "FIXTURE 2 record-keyword | rc=0 | signal=keyword recorded=${ts} | ledger names via=keyword (${led} line)"
  else
    st_bad "FIXTURE 2 record-keyword | rc=${rc} (want 0) signal='${sig}' recorded='${ts}' ledger-lines=${led} (want 1) | ${out}"
  fi
  out="$("${SELF}" "${A}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "0" ] && printf '%s' "${out}" | "${GGREP}" -q 'verdict=PASS | via=keyword'; then
    st_ok "FIXTURE 2b check-after-record | rc=0 PASS via=keyword"
  else
    st_bad "FIXTURE 2b check-after-record | rc=${rc} (want 0) | ${out}"
  fi

  # ---- FIXTURE 3 (THE DISCRIMINATING ONE): A's marker does nothing for B -------
  # Half one: B simply has no marker of its own while A does.
  out="$("${SELF}" "${B}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "1" ] && printf '%s' "${out}" | "${GGREP}" -q 'verdict=NO-MARKER'; then
    st_ok "FIXTURE 3 cross-project | rc=1 for ${B} while ${A} is proven — the marker is per project folder, so a fresh run cannot skip the gate"
  else
    st_bad "FIXTURE 3 cross-project | rc=${rc} (want 1) | ${out}"
  fi
  # Half two: even COPIED into B, A's marker is refused — it names another project.
  mkdir -p "${B}/CONTROL"
  cp "${A}/${MARKER_REL}" "${B}/${MARKER_REL}"
  out="$("${SELF}" "${B}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "2" ]; then
    st_ok "FIXTURE 3b copied-marker | rc=2 UNDETERMINED, never a pass — the marker names project alpha-bakery, not beta-framing"
  else
    st_bad "FIXTURE 3b copied-marker | rc=${rc} (want 2) | ${out}"
  fi
  rm -f "${B}/${MARKER_REL}"

  # ---- FIXTURE 4: a malformed marker is UNDETERMINED, never a pass -------------
  mkdir -p "${C}/CONTROL"
  printf 'proven\n' > "${C}/${MARKER_REL}"
  out="$("${SELF}" "${C}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "2" ]; then
    st_ok "FIXTURE 4 malformed-marker | rc=2 UNDETERMINED (no signal= line)"
  else
    st_bad "FIXTURE 4 malformed-marker | rc=${rc} (want 2) | ${out}"
  fi
  printf 'signal=probe\nrecorded=2026-09-08T00:00:00Z\nproject=gamma-garage\n' > "${C}/${MARKER_REL}"
  out="$("${SELF}" "${C}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "2" ]; then
    st_ok "FIXTURE 4b unknown-signal-in-marker | rc=2 UNDETERMINED (signal=probe is not a gate signal)"
  else
    st_bad "FIXTURE 4b unknown-signal-in-marker | rc=${rc} (want 2) | ${out}"
  fi
  printf 'signal=keyword\nrecorded=yesterday\nproject=gamma-garage\n' > "${C}/${MARKER_REL}"
  out="$("${SELF}" "${C}" --check 2>&1)"; rc=$?
  if [ "${rc}" = "2" ]; then
    st_ok "FIXTURE 4c bad-timestamp | rc=2 UNDETERMINED (recorded=yesterday is not ISO8601Z)"
  else
    st_bad "FIXTURE 4c bad-timestamp | rc=${rc} (want 2) | ${out}"
  fi
  rm -f "${C}/${MARKER_REL}"

  # ---- FIXTURE 5: --open after a genuine pass writes ONE zero-byte marker ------
  local nopen stamp
  out="$("${SELF}" --open "${A}" 2>&1)"; rc=$?
  nopen="$(ls -a1 "${A}" 2>/dev/null | "${GGREP}" -c '^\.spec-protocol-opened-')"
  [ -n "${nopen}" ] || nopen=0
  stamp="$(ls -a1 "${A}" 2>/dev/null | "${GGREP}" '^\.spec-protocol-opened-' | head -1 | sed 's/^\.spec-protocol-opened-//')"
  if [ "${rc}" = "0" ] && [ "${nopen}" = "1" ] && [ ! -s "${A}/.spec-protocol-opened-${stamp}" ] \
     && printf '%s' "${stamp}" | "${GGREP}" -qE "${ISO_RE}"; then
    st_ok "FIXTURE 5 open-after-pass | rc=0 | exactly 1 marker, zero bytes | .spec-protocol-opened-${stamp} parses as ISO8601Z"
  else
    st_bad "FIXTURE 5 open-after-pass | rc=${rc} (want 0) markers=${nopen} (want 1) stamp='${stamp}' | ${out}"
  fi

  # ---- FIXTURE 5b (THE DISCRIMINATING ONE): no recorded pass, nothing written --
  out="$("${SELF}" --open "${B}" 2>&1)"; rc=$?
  nopen="$(ls -a1 "${B}" 2>/dev/null | "${GGREP}" -c '^\.spec-protocol-opened-')"
  [ -n "${nopen}" ] || nopen=0
  if [ "${rc}" = "2" ] && [ "${nopen}" = "0" ]; then
    st_ok "FIXTURE 5b open-without-pass | rc=2 and 0 markers in ${B} — a marker on a FAILED gate would let the canary read a silent no-op as a success"
  else
    st_bad "FIXTURE 5b open-without-pass | rc=${rc} (want 2) markers=${nopen} (want 0) | ${out}"
  fi

  # ---- the refusal: only a signal the gate tests may be recorded as one --------
  out="$("${SELF}" "${C}" --record ultracode 2>&1)"; rc=$?
  if [ "${rc}" = "3" ] && [ ! -e "${C}/${MARKER_REL}" ]; then
    st_ok "REFUSAL bad-signal-name | rc=3 and no marker written for signal='ultracode'"
  else
    st_bad "REFUSAL bad-signal-name | rc=${rc} (want 3) marker-exists=$([ -e "${C}/${MARKER_REL}" ] && echo yes || echo no) | ${out}"
  fi
  out="$("${SELF}" "${C}" --record probe 2>&1)"; rc=$?
  [ "${rc}" = "3" ] && st_ok "REFUSAL bad-signal-name-2 | rc=3 for signal='probe' (the workflow capability probe is not a gate signal)" \
                    || st_bad "REFUSAL bad-signal-name-2 | rc=${rc} (want 3) | ${out}"

  # ---- the other legal name, and idempotence (one GATE0 line per project) ------
  out="$("${SELF}" "${C}" --record reminder 2>&1)"; rc=$?
  if [ "${rc}" = "0" ] && [ "$(field "${C}/${MARKER_REL}" signal)" = "reminder" ]; then
    st_ok "CONTROL record-reminder | rc=0 | the second legal signal name is accepted"
  else
    st_bad "CONTROL record-reminder | rc=${rc} (want 0) | ${out}"
  fi
  "${SELF}" "${C}" --record reminder >/dev/null 2>&1
  led="$("${GGREP}" -c 'GATE0: passed via=' "${C}/${LEDGER_REL}" 2>/dev/null)"
  [ -n "${led}" ] || led=0
  if [ "${led}" = "1" ]; then
    st_ok "CONTROL idempotent-record | one GATE0 line after two --record calls"
  else
    st_bad "CONTROL idempotent-record | ${led} GATE0 lines (want 1)"
  fi

  # ---- usage is undetermined, never a pass ------------------------------------
  out="$("${SELF}" 2>&1)"; rc=$?
  [ "${rc}" = "2" ] && st_ok "USAGE no-arguments | rc=2 UNDETERMINED" \
                    || st_bad "USAGE no-arguments | rc=${rc} (want 2) | ${out}"

  if [ "${ST_FAILS}" -eq 0 ]; then
    echo "SELFTEST PASS | 5 fixtures (marker-absent, record+ledger, cross-project, malformed, first-turn-open) + 9 supporting checks | marker=${MARKER_REL} | open=.spec-protocol-opened-<ISO8601Z>"
    exit 0
  fi
  echo "SELFTEST FAILED | ${ST_FAILS} check(s) failed — this checker may not be believed" >&2
  exit 6
}

# ============================================================================
# Argument handling — <project> --mode [signal], in either order
# ============================================================================
if [ "${1:-}" = "--selftest" ]; then selftest; fi

PROJECT=""
MODE=""
SIGNAL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)    MODE="check" ;;
    --open)     MODE="open" ;;
    --record)   MODE="record"; shift; SIGNAL="${1:-}"
                [ -n "${SIGNAL}" ] || undetermined "--record needs a signal name (${VALID_SIGNALS})" ;;
    --selftest) selftest ;;
    -*)         undetermined "unknown option '$1' (usage: gate0.sh <project> --check | <project> --record <signal> | --open <dir> | --selftest)" ;;
    *)          [ -z "${PROJECT}" ] || undetermined "two project paths given ('${PROJECT}' and '$1')"
                PROJECT="$1" ;;
  esac
  shift
done

[ -n "${MODE}" ]    || undetermined "no mode given (usage: gate0.sh <project> --check | <project> --record <signal> | --open <dir> | --selftest)"
[ -n "${PROJECT}" ] || undetermined "no project folder given — GATE 0's signal 3 is per project folder and cannot be answered without one"

case "${MODE}" in
  check)  do_check  "${PROJECT}" ;;
  record) do_record "${PROJECT}" "${SIGNAL}" ;;
  open)   do_open   "${PROJECT}" ;;
esac
