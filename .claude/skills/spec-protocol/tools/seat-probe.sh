#!/usr/bin/env bash
# seat-probe.sh — PROVE THE SEATS BEFORE THE FIRST BUILD DISPATCH (RC-17).
#
# Usage:
#   seat-probe.sh <project>
#   seat-probe.sh --selftest
#   seat-probe.sh --help
#
# WHAT IT IS FOR. The 2026-09-08 canary entered its build phase on an unproven
# seat and spent 31 minutes discovering the leg was dead, naming it nowhere.
# This is the instrument that proves each seat CALLABLE before the first build
# dispatch: it reads the seats from the project's CAPACITY-LEDGER.md, issues
# one known-answer smoke call per seat, runs the fake-model negative control
# FIRST, and writes one SEAT-PROBE: ledger line through tools/ledger.sh.
# tools/dispatch-check.sh refuses a build dispatch with exit 11 while that
# line is absent, which is what makes this probe unskippable.
#
# EXIT CODES
#   0  every seat CALLABLE — the probe RAN and every seat answered.
#   2  UNDETERMINED or BROKEN INSTRUMENT — never a verdict about a seat. No
#      transport, no seats to read, an unreadable ledger, or the fake-model
#      control returning text (BROKEN INSTRUMENT: no CALLABLE verdicts are
#      issued this run at all).
#   3  one or more seats dead, each named on stdout. A refused-looking seat
#      spends nothing: this script writes only its one ledger line.
#
# THE TRANSPORT (SEAT_PROBE_CMD). The smoke call itself runs below the skill,
# inside the harness — a script cannot call session tools — so every call goes
# through exactly one door: the executable named by SEAT_PROBE_CMD, invoked as
#   SEAT_PROBE_CMD <resolved-model> <max_tokens> <prompt>
# Its stdout is the response: the first line `model=<id>`, the remaining lines
# the answer text. Exit 0 with answer text means answered; any other exit, or
# empty answer text, means no text on that attempt. With SEAT_PROBE_CMD unset
# every seat is UNDETERMINED (named, counted, exit 2) — an unproved seat is
# never guessed CALLABLE and never guessed dead.
#
# THE KNOWN ANSWER. The prompt is `Reply with exactly the word: ALIVE` and the
# expected answer is exactly ALIVE (references/capacity.md section 11: a
# known-answer smoke test). A seat answering anything else is dead for judged
# work, named with reason=wrong-answer.
#
# THE FLOOR. Every first attempt carries max_tokens 600 — the measured-
# sufficient value against a measured-failing 60 (references/capacity.md
# section 11) — never lower it. SEAT_PROBE_MAX_TOKENS below max_tokens 600 is
# refused with exit 2, not clamped: a silently raised floor would lie about
# what was proven.
#
# THE CONTROL. The fake-model call runs BEFORE any seat is believed
# (references/capacity.md: a smoke suite whose control passes cannot silently
# rubber-stamp). If the fake model returns text the instrument is broken: no
# CALLABLE verdict is issued for any seat this run, the ledger line records
# every seat undetermined, and the exit is 2.
#
# THE HEADROOM RETRY. An attempt with no text, or a transport error, is
# retried ONCE at max_tokens 2400 headroom — a reasoning model on a starved
# budget looks dead when it is merely under-funded, so empty text is never a
# FAIL verdict on the first try. After the retry: answered means CALLABLE,
# error means DEAD (named), still-empty means UNDETERMINED (starved and dead
# can no longer be told apart, so neither is claimed).
#
# THE VERDICT. CALLABLE needs all three: exit 0, answer text exactly ALIVE,
# AND the response's model field naming the requested seat. The model
# comparison uses the family rule (lowercase, provider prefix dropped, a
# parenthetical or bracket suffix dropped), so `ds/v4-flash(high)` and
# `v4-flash` are one model. Anything else about the model field is
# reason=model-mismatch, DEAD, named.
#
# THE LEDGER LINE. Exactly one line per run, through tools/ledger.sh:
#   SEAT-PROBE: seats=<n> callable=<n> dead=<n> undetermined=<n>
#
# WHAT IT NEVER DOES. No retry at the HTTP layer (one floor attempt plus one
# headroom retry is the whole budget — a loop is what killed turn 21), no
# routing choice, no gateway claims: it names the seat, the model id and the
# reason, and stops there. The failing call is inside the harness, below the
# skill, and a script claiming otherwise would be a false positive.
#
# ENVIRONMENT KNOBS (all optional; defaults are the doctrine's numbers)
#   SEAT_PROBE_CMD=<path>          the harness-provided smoke-call transport
#   SEAT_PROBE_MAX_TOKENS=600      floor for every first attempt (never lower)
#   SEAT_PROBE_HEADROOM_TOKENS=2400  budget for the single headroom retry
#   SEAT_PROBE_FAKE_MODEL=<name>   the negative-control model (default below)

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"
LEDGER_SH="${SCRIPT_DIR}/ledger.sh"

GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi
AWK="/usr/bin/awk"
if [[ ! -x "${AWK}" ]]; then AWK="$(command -v awk 2>/dev/null || true)"; fi

usage() { sed -n '2,10p' "${SELF}"; }

PROMPT='Reply with exactly the word: ALIVE'
EXPECTED='ALIVE'
FAKE_MODEL="${SEAT_PROBE_FAKE_MODEL:-__seat_probe_fake_model__}"
PROBE_TOKENS="${SEAT_PROBE_MAX_TOKENS:-600}"
HEADROOM_TOKENS="${SEAT_PROBE_HEADROOM_TOKENS:-2400}"
TRANSPORT="${SEAT_PROBE_CMD:-}"

is_uint() {
  case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

tooling() { printf 'SEAT-PROBE UNDETERMINED | tooling | %s\n' "$1" >&2; exit 2; }

[[ -n "${GREP}" && -x "${GREP}" ]] \
  || tooling "no usable grep (/usr/bin/grep, /bin/grep, PATH) — the probe cannot read its own inputs, so it claims nothing"
[[ -n "${AWK}" && -x "${AWK}" ]] \
  || tooling "no usable awk (/usr/bin/awk, PATH) — the probe cannot parse SEAT lines, so it claims nothing"
is_uint "${PROBE_TOKENS}" \
  || tooling "SEAT_PROBE_MAX_TOKENS='${PROBE_TOKENS}' is not a non-negative integer — the floor cannot be read, so no call is issued"
(( PROBE_TOKENS >= 600 )) \
  || tooling "SEAT_PROBE_MAX_TOKENS=${PROBE_TOKENS} is below the max_tokens 600 floor (references/capacity.md section 11: measured-sufficient against a measured-failing 60 — never lower it)"
is_uint "${HEADROOM_TOKENS}" \
  || tooling "SEAT_PROBE_HEADROOM_TOKENS='${HEADROOM_TOKENS}' is not a non-negative integer"
(( HEADROOM_TOKENS >= 600 && HEADROOM_TOKENS >= PROBE_TOKENS )) \
  || tooling "SEAT_PROBE_HEADROOM_TOKENS=${HEADROOM_TOKENS} is below the attempt floor ${PROBE_TOKENS} — a headroom retry with less headroom is not a retry"

# --- The seats, read from the Capacity Ledger --------------------------------
# One SEAT line per doctrine role (references/capacity.md section 4):
#   SEAT | seat=<role> | dispatched=<id> | resolved=<model> | lane=... | ...
list_seats() { # list_seats <capacity-ledger> -> role\tmodel per SEAT line
  "${AWK}" -F'|' '
    {
      f1 = $1; gsub(/^[ \t]+|[ \t]+$/, "", f1)
      if (f1 != "SEAT") next
      role = ""; model = ""
      for (i = 2; i <= NF; i++) {
        f = $i; gsub(/^[ \t]+|[ \t]+$/, "", f)
        if (f ~ /^seat=/) { role = f; sub(/^seat=/, "", role) }
        else if (f ~ /^resolved=/) { model = f; sub(/^resolved=/, "", model) }
      }
      gsub(/^[ \t]+|[ \t]+$/, "", role)
      gsub(/^[ \t]+|[ \t]+$/, "", model)
      if (role == "") role = "unnamed"
      printf "%s\t%s\n", role, model
    }' "$1"
}

# The family rule (references/capacity.md section 11, tools/seat-check.sh):
# lowercase, provider prefix dropped, parenthetical/bracket suffix dropped.
norm_model() {
  printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -e 's|^[^/]*/||' -e 's/(.*//' -e 's/\[.*//' -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//'
}

# --- One attempt through the transport ---------------------------------------
# probe_once <model> <max_tokens> — sets PC_RC/PC_MODEL/PC_TEXT.
# rc 0 = answered with text; rc 1 = transport error; rc 2 = empty answer.
PC_RC=0; PC_MODEL=""; PC_TEXT=""
probe_once() {
  local model="$1" toks="$2" tmp rc
  PC_RC=1; PC_MODEL=""; PC_TEXT=""
  tmp="$(mktemp "${TMPDIR:-/tmp}/seat-probe-call.XXXXXX")" || return 1
  "$TRANSPORT" "$model" "$toks" "$PROMPT" >"$tmp" 2>/dev/null
  rc=$?
  if (( rc == 0 )); then
    PC_MODEL="$(sed -n '1p' "$tmp" 2>/dev/null | sed -n 's/^model=//p' | head -n 1)"
    PC_TEXT="$(tail -n +2 "$tmp" 2>/dev/null)"
    if [[ -n "$(printf '%s' "${PC_TEXT}" | tr -d '[:space:]')" ]]; then
      PC_RC=0
    else
      PC_RC=2
    fi
  else
    PC_RC=1
  fi
  rm -f "$tmp" 2>/dev/null || true
  return 0
}

# --- The verdict for one seat ------------------------------------------------
# verdict_for_seat <role> <model> — prints verdict fields, sets V_VERDICT.
V_VERDICT=""; V_REASON=""
verdict_for_seat() {
  local role="$1" model="$2" attempt body want got
  V_VERDICT="UNDETERMINED"; V_REASON="undecided"
  for attempt in "${PROBE_TOKENS}" "${HEADROOM_TOKENS}"; do
    probe_once "$model" "$attempt"
    if (( PC_RC == 0 )); then
      want="$(norm_model "$model")"
      got="$(norm_model "${PC_MODEL}")"
      body="$(printf '%s' "${PC_TEXT}" | tr -d '[:space:]')"
      if [[ -n "$got" && "$got" == "$want" && "$body" == "${EXPECTED}" ]]; then
        V_VERDICT="CALLABLE"; V_REASON="known-answer"
        [[ "$attempt" != "${PROBE_TOKENS}" ]] && V_REASON="known-answer-after-headroom-retry"
        return 0
      fi
      if [[ "$attempt" == "${HEADROOM_TOKENS}" ]]; then
        V_VERDICT="DEAD"
        if [[ "$body" != "${EXPECTED}" ]]; then V_REASON="wrong-answer"
        else V_REASON="model-mismatch(got=${PC_MODEL:-<empty>})"; fi
      fi
    elif (( PC_RC == 2 )); then
      if [[ "$attempt" == "${HEADROOM_TOKENS}" ]]; then
        V_VERDICT="UNDETERMINED"; V_REASON="empty-after-headroom-retry"
      fi
    else
      if [[ "$attempt" == "${HEADROOM_TOKENS}" ]]; then
        V_VERDICT="DEAD"; V_REASON="transport-error"
      fi
    fi
  done
  return 0
}

write_ledger_line() { # write_ledger_line <project> <line> -> rc 0 or tooling exit
  local project="$1" line="$2" out rc
  [[ -x "${LEDGER_SH}" ]] \
    || tooling "tools/ledger.sh is missing or not executable at ${LEDGER_SH} — every project write goes through it, so an unlogged probe is refused rather than written unlocked"
  out="$("${LEDGER_SH}" "${project}" "CONTROL/LEDGER.md" "${line}" 2>&1)"; rc=$?
  (( rc == 0 )) || tooling "ledger.sh failed (rc=${rc}) writing CONTROL/LEDGER.md: ${out}"
}

run_probe() {
  local project="$1" capled seats n role model
  [[ -n "${project}" ]] || tooling "no project path given. Usage: seat-probe.sh <project>"
  [[ -d "${project}" ]] || tooling "project directory does not exist: ${project}"
  [[ ! -f "${project%/}/.spec-protocol.json" ]] \
    || tooling "PROFILE-OWNED | ${project} supplies a canonical packet observer; legacy Capacity Ledger/SEAT-PROBE writes are not applicable."
  capled="${project}/CAPACITY-LEDGER.md"
  [[ -f "${capled}" ]] || tooling "no Capacity Ledger at ${capled} — there are no seats to read (that file is the only source this probe reads; the environment is never one)"
  [[ -r "${capled}" ]] || tooling "Capacity Ledger is unreadable: ${capled}"

  seats="$(list_seats "${capled}")"
  n="$(printf '%s\n' "${seats}" | "${GREP}" -c '[^[:space:]]' || true)"
  [[ -n "${n}" ]] || n=0

  # No SEAT lines: the probe ran and found nothing to prove. That is
  # UNDETERMINED, said out loud with the ledger line written, never a pass.
  if (( n == 0 )); then
    printf 'SEAT-PROBE | seats=0 | no SEAT lines in %s — nothing was probed and nothing is proven\n' "${capled}"
    write_ledger_line "${project}" "SEAT-PROBE: seats=0 callable=0 dead=0 undetermined=0"
    exit 2
  fi

  # No transport: the call lives below the skill and nobody wired the door, so
  # every seat is UNDETERMINED rather than guessed either way.
  if [[ -z "${TRANSPORT}" ]]; then
    while IFS="$(printf '\t')" read -r role model; do
      [[ -n "${role}" ]] || continue
      printf 'SEAT-PROBE | seat=%s | resolved=%s | verdict=UNDETERMINED | reason=no-transport(SEAT_PROBE_CMD unset — the smoke call runs inside the harness, below the skill, and no transport was provided, so this seat is unproven, never guessed)\n' \
        "${role}" "${model:-<unresolved>}"
    done <<< "${seats}"
    write_ledger_line "${project}" "SEAT-PROBE: seats=${n} callable=0 dead=0 undetermined=${n}"
    exit 2
  fi
  [[ -x "${TRANSPORT}" ]] || {
    write_ledger_line "${project}" "SEAT-PROBE: seats=${n} callable=0 dead=0 undetermined=${n}" || true
    tooling "SEAT_PROBE_CMD='${TRANSPORT}' is not executable — the smoke-call door cannot be opened, so no seat is proven"
  }

  # THE CONTROL FIRST. A fake model that returns text means the transport
  # answers everything, so its positives prove nothing: BROKEN INSTRUMENT, no
  # CALLABLE verdicts issued for any seat this run.
  probe_once "${FAKE_MODEL}" "${PROBE_TOKENS}"
  if (( PC_RC == 0 )); then
    printf 'SEAT-PROBE BROKEN INSTRUMENT | fake-model=%s returned text — the transport answers an unseated model, so no seat verdict is issued this run\n' "${FAKE_MODEL}"
    write_ledger_line "${project}" "SEAT-PROBE: seats=${n} callable=0 dead=0 undetermined=${n}"
    exit 2
  fi
  printf 'SEAT-PROBE CONTROL | fake-model=%s returned no text — the transport discriminates, so the seat verdicts below can be believed\n' "${FAKE_MODEL}"

  local callable=0 dead=0 undet=0
  while IFS="$(printf '\t')" read -r role model; do
    [[ -n "${role}" ]] || continue
    if [[ -z "${model}" ]]; then
      printf 'SEAT-PROBE | seat=%s | resolved=<unresolved> | verdict=UNDETERMINED | reason=no-resolved-model(that SEAT line names no model to call)\n' "${role}"
      undet=$(( undet + 1 ))
      continue
    fi
    verdict_for_seat "${role}" "${model}"
    if [[ "${V_VERDICT}" == "CALLABLE" ]]; then
      printf 'SEAT-PROBE | seat=%s | resolved=%s | verdict=CALLABLE | reason=%s\n' "${role}" "${model}" "${V_REASON}"
      callable=$(( callable + 1 ))
    elif [[ "${V_VERDICT}" == "DEAD" ]]; then
      printf 'SEAT-PROBE | seat=%s | resolved=%s | verdict=DEAD | reason=%s\n' "${role}" "${model}" "${V_REASON}"
      dead=$(( dead + 1 ))
    else
      printf 'SEAT-PROBE | seat=%s | resolved=%s | verdict=UNDETERMINED | reason=%s\n' "${role}" "${model}" "${V_REASON}"
      undet=$(( undet + 1 ))
    fi
  done <<< "${seats}"

  write_ledger_line "${project}" "SEAT-PROBE: seats=${n} callable=${callable} dead=${dead} undetermined=${undet}"
  printf 'SEAT-PROBE SUMMARY | seats=%s callable=%s dead=%s undetermined=%s\n' "${n}" "${callable}" "${dead}" "${undet}"
  if (( dead > 0 )); then exit 3; fi
  if (( undet > 0 )); then exit 2; fi
  exit 0
}

# ============================================================================
# The selftest — the instrument proven before any verdict is believed
# ============================================================================
run_selftest() {
  local T PASSES=0 FAILS=0
  # The operator's own wiring must not move these fixtures: the transport is
  # set per arm, and the floors are reset to the doctrine's numbers here.
  unset SEAT_PROBE_CMD SEAT_PROBE_MAX_TOKENS SEAT_PROBE_HEADROOM_TOKENS SEAT_PROBE_FAKE_MODEL
  T="$(mktemp -d "${TMPDIR:-/tmp}/seat-probe-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  trap "rm -rf '${T}'" EXIT

  report() { # report <n> <name> <ok 0|1> <detail>
    if [[ "$3" == "1" ]]; then printf 'PASS %-2s %-24s %s\n' "$1" "$2" "$4"; PASSES=$(( PASSES + 1 ))
    else printf 'FAIL %-2s %-24s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
  }

  # --- case 0: the census, proven on a known positive first ------------------
  local kp_pos kp_neg
  kp_pos="$(printf 'SEAT | seat=builder | dispatched=opus | resolved=ds/v4-flash | lane=opus\n' | "${GREP}" -c '^[[:space:]]*SEAT[[:space:]]*|')"
  kp_neg="$(printf 'the seat table lists every role\n' | "${GREP}" -c '^[[:space:]]*SEAT[[:space:]]*|' || true)"
  local ok=0
  # shellcheck disable=SC2070
  [[ "${kp_pos}" == "1" && "${kp_neg}" == "0" ]] && ok=1
  report 0 "grep-controls" "${ok}" "SEAT-line known-positive=${kp_pos} (want 1), prose known-negative=${kp_neg} (want 0), both on ${GREP}"

  mk_proj() { # mk_proj <dir> — a capacity ledger with two seats
    mkdir -p "$1"
    {
      printf '# CAPACITY LEDGER — fixture — 2026-09-08T00:00:00Z\n'
      printf 'clientCap = max(2, min(harness_cap, ram_cap)) = 4   [MEASURED fixture 2026-09-08T00:00:00Z]\n'
      printf 'SEAT | seat=builder | dispatched=opus | resolved=alpha-one | lane=opus | provider-node=alpha | ceiling-class=token-balance | governing-figure=100 | burn-meter=none | headroom-floor=600 | independence=n/a | proof=none\n'
      printf 'SEAT | seat=judge | dispatched=sonnet | resolved=beta-two | lane=sonnet | provider-node=beta | ceiling-class=token-balance | governing-figure=100 | burn-meter=none | headroom-floor=600 | independence=verified-differs-from alpha-one | proof=none\n'
    } > "$1/CAPACITY-LEDGER.md"
  }
  # mk_helper <path> <mode> <log> — a fixture transport. <mode> is ok (every
  # model answers ALIVE), mixed (alpha-one always errors, everything else
  # answers), or lying (the fake model answers too — the broken instrument).
  # Every invocation appends "<model> <max_tokens>" to <log>.
  mk_helper() {
    cat > "$1" <<'HELPER'
#!/usr/bin/env bash
# fixture transport: $1=model $2=max_tokens $3=prompt; $HELPER_MODE, $HELPER_LOG, $HELPER_FAKE in env
printf '%s %s\n' "$1" "$2" >> "${HELPER_LOG}"
if [[ "$1" == "${HELPER_FAKE}" ]]; then
  if [[ "${HELPER_MODE}" == "lying" ]]; then printf 'model=impostor\nHELLO\n'; exit 0; fi
  exit 1
fi
if [[ "${HELPER_MODE}" == "mixed" && "$1" == "alpha-one" ]]; then exit 1; fi
printf 'model=%s\nALIVE\n' "$1"
exit 0
HELPER
    chmod +x "$1"
  }

  local rc out P LOG first_toks
  # --- case 1: all seats answer → 0, both named CALLABLE ---------------------
  P="${T}/all-ok"; LOG="${T}/all-ok.log"; : > "${LOG}"
  mk_proj "${P}"
  mk_helper "${T}/help-ok" ok "${LOG}"
  out="$(HELPER_MODE=ok HELPER_LOG="${LOG}" HELPER_FAKE="__seat_probe_fake_model__" SEAT_PROBE_CMD="${T}/help-ok" bash "${SELF}" "${P}" 2>&1)"; rc=$?
  ok=0
  if [[ "${rc}" == "0" ]] \
     && printf '%s' "${out}" | "${GREP}" -q 'seat=builder | resolved=alpha-one | verdict=CALLABLE' \
     && printf '%s' "${out}" | "${GREP}" -q 'seat=judge | resolved=beta-two | verdict=CALLABLE' \
     && "${GREP}" -q 'SEAT-PROBE: seats=2 callable=2 dead=0 undetermined=0' "${P}/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  first_toks="$(head -n 1 "${LOG}" 2>/dev/null | "${AWK}" '{print $2}')"
  [[ "${first_toks}" == "600" ]] || ok=0
  report 1 "all-answer" "${ok}" "rc=${rc} (want 0); both seats CALLABLE on stdout; ledger carries seats=2 callable=2 dead=0 undetermined=0; first call carried max_tokens=${first_toks:-<none>} (want 600, the floor, never lower)"

  # --- case 2: one seat errors after the headroom retry → 3, seat named -----
  P="${T}/one-dead"; LOG="${T}/one-dead.log"; : > "${LOG}"
  mk_proj "${P}"
  mk_helper "${T}/help-mixed" mixed "${LOG}"
  out="$(HELPER_MODE=mixed HELPER_LOG="${LOG}" HELPER_FAKE="__seat_probe_fake_model__" SEAT_PROBE_CMD="${T}/help-mixed" bash "${SELF}" "${P}" 2>&1)"; rc=$?
  local dead_calls retry_toks
  dead_calls="$("${GREP}" -c '^alpha-one ' "${LOG}" || true)"
  retry_toks="$(printf '%s\n' "$( "${GREP}" '^alpha-one ' "${LOG}" | head -n 2 | tail -n 1)" | "${AWK}" '{print $2}')"
  ok=0
  if [[ "${rc}" == "3" ]] \
     && printf '%s' "${out}" | "${GREP}" -q 'seat=builder | resolved=alpha-one | verdict=DEAD' \
     && printf '%s' "${out}" | "${GREP}" -q 'seat=judge | resolved=beta-two | verdict=CALLABLE' \
     && [[ "${dead_calls}" == "2" ]] \
     && "${GREP}" -q 'SEAT-PROBE: seats=2 callable=1 dead=1 undetermined=0' "${P}/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  # the retry must carry MORE headroom than the floor attempt, never less
  [[ "${retry_toks}" == "2400" ]] || ok=0
  report 2 "one-dead" "${ok}" "rc=${rc} (want 3); builder DEAD and named, judge CALLABLE; alpha-one was called ${dead_calls}x (want 2 — floor attempt plus headroom retry at max_tokens=${retry_toks:-<none>}, want 2400); ledger carries callable=1 dead=1"

  # --- case 3: THE DISCRIMINATING CASE — the control returns text → 2 -------
  # An implementation that trusts its positives passes cases 1-2 and fails
  # HERE: the transport answers the fake model, so no seat verdict may issue.
  P="${T}/lying"; LOG="${T}/lying.log"; : > "${LOG}"
  mk_proj "${P}"
  mk_helper "${T}/help-lying" lying "${LOG}"
  out="$(HELPER_MODE=lying HELPER_LOG="${LOG}" HELPER_FAKE="__seat_probe_fake_model__" SEAT_PROBE_CMD="${T}/help-lying" bash "${SELF}" "${P}" 2>&1)"; rc=$?
  ok=0
  if [[ "${rc}" == "2" ]] \
     && printf '%s' "${out}" | "${GREP}" -qi 'broken instrument' \
     && ! printf '%s' "${out}" | "${GREP}" -q 'CALLABLE' \
     && ! printf '%s' "${out}" | "${GREP}" -q 'verdict=' \
     && "${GREP}" -q 'SEAT-PROBE: seats=2 callable=0 dead=0 undetermined=2' "${P}/CONTROL/LEDGER.md" 2>/dev/null; then ok=1; fi
  report 3 "control-text-blocks-all" "${ok}" "rc=${rc} (want 2); BROKEN INSTRUMENT named; stdout carries no CALLABLE and no verdict= line at all (no seat marked callable in this arm); ledger carries callable=0 undetermined=2"

  # --- case 4: the control runs BEFORE any seat is believed ------------------
  P="${T}/order"; LOG="${T}/order.log"; : > "${LOG}"
  mk_proj "${P}"
  mk_helper "${T}/help-order" ok "${LOG}"
  out="$(HELPER_MODE=ok HELPER_LOG="${LOG}" HELPER_FAKE="__seat_probe_fake_model__" SEAT_PROBE_CMD="${T}/help-order" bash "${SELF}" "${P}" 2>&1)"; rc=$?
  local first_model
  first_model="$(head -n 1 "${LOG}" 2>/dev/null | "${AWK}" '{print $1}')"
  ok=0
  if [[ "${rc}" == "0" && "${first_model}" == "__seat_probe_fake_model__" ]]; then ok=1; fi
  report 4 "control-first" "${ok}" "rc=${rc} (want 0); first transport call was for ${first_model:-<none>} (want the fake model) — the control precedes every positive"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'seat-probe.sh selftest: ALL PASS (%s checks)\n' "$(( PASSES ))"
    exit 0
  fi
  printf 'seat-probe.sh selftest: %s FAILED — this probe is a BROKEN INSTRUMENT; prove the seats by hand and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_probe "$@" ;;
esac
