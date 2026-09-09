#!/usr/bin/env bash
# seat-check.sh — WHICH LANE IS THE CONDUCTOR SITTING IN? (RC-15; wave-7 WI-48)
#
# Usage:
#   seat-check.sh <launcher>       claude | claude-nine | claude-codex
#   seat-check.sh --selftest       prove the instrument (legs 0-8)
#   seat-check.sh --help           this text
#
# Exit 0 = the conductor is on the OPUS lane. Exit 3 = it is on another lane,
# named on stdout. Exit 2 = UNDETERMINED: neither instrument answered.
#
# WHAT IT IS FOR. references/capacity.md §11's seat table says of the conductor:
# "Opus — the session model; the launcher starts the session on Opus and the
# skill reports if it is not". Nothing performed that report. On the 2026-09-08
# canary the routed launcher's chair slid from the opus lane to the router's
# sonnet default at the turn-04 -> turn-05 boundary, stayed there for seventeen
# turns, and no instrument in the skill noticed. Every claude-nine defect the
# driver recorded after that boundary happened in the wrong chair.
#
# This is the missing instrument. It answers ONE question — which lane is the
# CONDUCTOR, this session itself, sitting in — and it answers it in an exit code.
#
# IT NEVER WRITES ANY SETTINGS FILE. Not to repair the seat, not to pin it, not
# to "help". A seat check that edited the operator's config would be the exact
# defect wave 7 exists to remove (RC-20), and the operator's model configuration
# is the operator's (references/optional/agent-team.md §5.5). The only cure for
# a wrong chair is starting the session on the right lane; this script says so
# and stops there. Its selftest proves the non-write by comparing a fixture
# settings file's mtime before and after a full run.
#
# HOW IT READS — ENV FIRST, BY KEY NAME, exactly as references/capacity.md
# §11's procedure step 1 already requires:
#
#   1. THE SESSION ENVIRONMENT, `printenv <NAME>` once per NAME, never a dump
#      of the whole environment. The names, enumerated and closed:
#        ANTHROPIC_MODEL                  the chair itself
#        ANTHROPIC_DEFAULT_OPUS_MODEL     )
#        ANTHROPIC_DEFAULT_SONNET_MODEL   ) the alias map: lane -> model id
#        ANTHROPIC_DEFAULT_HAIKU_MODEL    )
#        ANTHROPIC_DEFAULT_FABLE_MODEL    )
#        CLAUDE_CODE_SUBAGENT_MODEL       the subagent lane (context, never the
#                                         conductor's own seat)
#      The session env is the only instrument that works on BOTH topologies: the
#      shipped launcher injects routing as child-process env and sets no second
#      config root, while an operator's own wrapper may set one.
#   2. ONLY WHEN THE SESSION ENV LACKS THEM, the detected launcher's config-root
#      settings file, `<config-root>/settings.json`, read through a JSON parser
#      BY KEY NAME — `.model` and the same names under `.env` — and never
#      printed. That file holds hook commands and an apiKeyHelper invocation; a
#      tool that dumped it to find a model id would leak all of it into a
#      transcript. Selftest leg 6 puts a decoy key beside the real ones and
#      fails if it ever reaches the output.
#
# WHAT IT PRINTS. Lane names and key NAMES, every one of them read by NAME — it
# will never print a value. Model ids are not secrets, but a settings file is
# not a promise, so every value read here is REDACTED out of the output as a
# class rather than trusted one at a time. An operator who wants to see a value
# runs `printenv ANTHROPIC_MODEL` themselves.
#
# On exit 0 and exit 3, one line on stdout, in the ledger's own vocabulary:
#
#   CONDUCTOR-SEAT: expected=opus resolved=<lane> launcher=<name> source=<src>
#
# <lane> is one of opus, sonnet, haiku, fable — a closed vocabulary, never a
# model id. <src> is `session-env` when the chair came from the environment, or
# the absolute settings path when the fallback answered. SKILL.md section 2
# writes that line through tools/ledger.sh on exit 3 and says NOTHING to the
# client: a seat is a machine fact and there is no operator channel in the
# client's transcript (references/audience.md §7). tools/dispatch-check.sh then
# refuses a BUILD dispatch with exit 10 while the newest such line in
# CONTROL/LEDGER.md reads anything but resolved=opus.
#
# HOW A LANE IS RESOLVED, in order, and the order is the point:
#   1. THE ALIAS MAP, on base ids. The chair's id is compared with each lane's
#      id under the FAMILY RULE of capacity.md §11 — lowercase, provider prefix
#      dropped, the thinking/pricing suffix in ( ) or [ ] dropped — so
#      `ds/v4-flash(high)` and `v4-flash` are one model. opus is compared first,
#      so a box whose opus and sonnet lanes resolve to the SAME model reads as
#      opus: the conductor is on the opus lane, whatever else shares it.
#   2. THE CHAIR'S OWN NAME, when the alias map does not place it: a bare alias
#      word (`model: "sonnet"` in a settings file) or an Anthropic tier id whose
#      family word stands as a whole token (`claude-opus-5[1m]` -> opus).
#   3. Neither -> UNDETERMINED. An unmappable chair is never reported as "not
#      opus": a negative carries the same burden of proof as a positive, and a
#      run refused on a guess is worse than a run that says it does not know.
#
# THE DISCRIMINATING POINT. The chair is read from ANTHROPIC_MODEL (or the
# settings file's `model`), NEVER from the presence of an alias key. A naive
# check that greps the environment for the string "opus" passes an opus box and
# passes a bare box, and fails the only case that matters: the canary's box,
# where ANTHROPIC_DEFAULT_OPUS_MODEL was set and populated while the chair sat
# in the sonnet lane. Selftest leg 2 is that box, and leg 3 proves the fixture
# really does carry the string "opus" so leg 2 cannot pass by accident.
#
# DIAGNOSTIC KNOB
#   SEAT_CHECK_CONFIG_ROOT   overrides the config root the fallback reads, so
#                            the selftest can prove the file path on a fixture
#                            instead of the operator's live tree.
#   SEAT_CHECK_NO_JQ=1       force the python3 reader on a box that has jq, so
#                            the second parser is proven rather than assumed.
#                            The selftest repeats the file leg under it. An
#                            untested fallback is a fallback that fails the
#                            first time it is needed.

set -uo pipefail

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"

usage() { sed -n '2,10p' "${SELF}"; }

# --- The instruments, named and absolute -------------------------------------
GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

PRINTENV="/usr/bin/printenv"
if [[ ! -x "${PRINTENV}" ]]; then PRINTENV="$(command -v printenv 2>/dev/null || true)"; fi

SETTINGS_BASENAME="settings.json"

# The enumerated names. Closed lists: this script reads these and nothing else.
ALIAS_LANES="opus sonnet haiku fable"
SEAT_ENV_NAME="ANTHROPIC_MODEL"
SUBAGENT_ENV_NAME="CLAUDE_CODE_SUBAGENT_MODEL"

# und <message> — UNDETERMINED. Names what was read and what was not, never a
# value, and never a verdict about the seat.
und() {
  printf 'SEAT-CHECK UNDETERMINED | %s\n' "$1" >&2
  exit 2
}

# --- Value handling. Nothing read here is ever printed. ----------------------
# sanitize keeps model-id characters and caps the length, so a pathological
# settings value cannot travel far even inside this process. It is a belt on
# top of the braces: the output carries lane names only.
sanitize() {
  printf '%s' "$1" | LC_ALL=C tr -cd 'A-Za-z0-9._:/+()[]-' | cut -c1-64
}

# env_by_name <NAME> — one name, one read. Never `env`, never `printenv` with
# no argument, never a process list: this is the whole environment-reading
# surface of this script.
env_by_name() {
  local v=""
  if [[ -n "${PRINTENV}" && -x "${PRINTENV}" ]]; then
    v="$("${PRINTENV}" "$1" 2>/dev/null | head -n 1 || true)"
  else
    # No printenv binary on this box. Bash's own indirect expansion reads the
    # same one name; the source line says which instrument answered.
    v="${!1-}"
    v="$(printf '%s' "${v}" | head -n 1)"
  fi
  sanitize "${v}"
}

# --- The family rule (references/capacity.md §11) ----------------------------
# Base id: lowercase, provider prefix dropped, thinking/pricing/version suffix
# in ( ) or [ ] dropped. Same-base lanes differing only in thinking level are
# ONE model, which is exactly what the seat table's "must differ" cells mean.
norm() {
  local v
  v="$(printf '%s' "$1" | LC_ALL=C tr 'A-Z' 'a-z')"
  v="${v##*/}"
  v="${v%%(*}"
  v="${v%%[*}"
  printf '%s' "${v}"
}

# --- The config root, per launcher -------------------------------------------
# THE SESSION SAYS FIRST. CLAUDE_CONFIG_DIR is read by name before any default
# is guessed, because a root the session actually has beats a root a table
# expects. The shipped claude-nine reuses plain claude's one root and sets no
# CLAUDE_CONFIG_DIR at all (repo rule 10); an operator's personal wrapper does
# set one, which is the topology capacity.md §11 warns about and the canary ran
# on. So ~/.claude-nine is taken only when it EXISTS — the same file evidence
# SKILL.md section 2's harness detection already uses — and never as a guess.
config_root_for() {
  local launcher="$1" dir=""
  if [[ -n "${SEAT_CHECK_CONFIG_ROOT:-}" ]]; then printf '%s' "${SEAT_CHECK_CONFIG_ROOT}"; return 0; fi
  dir="$(env_by_name CLAUDE_CONFIG_DIR)"
  if [[ -n "${dir}" ]]; then printf '%s' "${dir}"; return 0; fi
  case "${launcher}" in
    claude) printf '%s' "${HOME}/.claude" ;;
    claude-nine|claude-codex)
      if [[ -d "${HOME}/.claude-nine" ]]; then printf '%s' "${HOME}/.claude-nine"
      else printf '%s' "${HOME}/.claude"; fi ;;
    *) return 1 ;;
  esac
  return 0
}

# --- The settings reader. BY KEY NAME. Read-only. ----------------------------
PARSER=""
JQ=""
resolve_parser() {
  if [[ "${SEAT_CHECK_NO_JQ:-0}" == "1" ]]; then JQ=""              # diagnostic knob
  elif [[ -x /usr/bin/jq ]]; then JQ="/usr/bin/jq"
  else JQ="$(command -v jq 2>/dev/null || true)"; fi
  if [[ -n "${JQ}" ]]; then PARSER="jq"; return 0; fi
  if command -v python3 >/dev/null 2>&1; then PARSER="python3"; return 0; fi
  return 1
}

# The seven names, and no others. A key that is absent, null or non-scalar
# yields nothing at all rather than a placeholder that could be mistaken for a
# model id.
JQ_KEYS='
def scalar(v): if v == null then empty
               elif (v|type) == "object" or (v|type) == "array" then empty
               else (v|tostring) end;
if type != "object" then "NOTOBJECT"
else
  ( "model\t" + scalar(.model) ),
  ( "ANTHROPIC_MODEL\t" + scalar(.env.ANTHROPIC_MODEL) ),
  ( "ANTHROPIC_DEFAULT_OPUS_MODEL\t" + scalar(.env.ANTHROPIC_DEFAULT_OPUS_MODEL) ),
  ( "ANTHROPIC_DEFAULT_SONNET_MODEL\t" + scalar(.env.ANTHROPIC_DEFAULT_SONNET_MODEL) ),
  ( "ANTHROPIC_DEFAULT_HAIKU_MODEL\t" + scalar(.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ),
  ( "ANTHROPIC_DEFAULT_FABLE_MODEL\t" + scalar(.env.ANTHROPIC_DEFAULT_FABLE_MODEL) ),
  ( "CLAUDE_CODE_SUBAGENT_MODEL\t" + scalar(.env.CLAUDE_CODE_SUBAGENT_MODEL) )
end
'

# read_settings_keys <file> — one "name<TAB>value" line per name that is
# present. Never the file, never another key.
read_settings_keys() {
  case "${PARSER}" in
    jq)
      "${JQ}" -r "${JQ_KEYS}" "$1" 2>/dev/null || printf 'BADJSON\n'
      ;;
    python3)
      python3 - "$1" 2>/dev/null <<'PY' || printf 'BADJSON\n'
import json, sys
NAMES = ("ANTHROPIC_MODEL",
         "ANTHROPIC_DEFAULT_OPUS_MODEL",
         "ANTHROPIC_DEFAULT_SONNET_MODEL",
         "ANTHROPIC_DEFAULT_HAIKU_MODEL",
         "ANTHROPIC_DEFAULT_FABLE_MODEL",
         "CLAUDE_CODE_SUBAGENT_MODEL")
def scalar(v):
    if v is None or isinstance(v, (dict, list)):
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)
try:
    with open(sys.argv[1], "rb") as fh:
        d = json.load(fh)
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    print("NOTOBJECT")
else:
    m = scalar(d.get("model"))
    if m is not None:
        print("model\t%s" % m)
    e = d.get("env")
    if isinstance(e, dict):
        for n in NAMES:
            v = scalar(e.get(n))
            if v is not None:
                print("%s\t%s" % (n, v))
PY
      ;;
    *) printf 'BADJSON\n' ;;
  esac
}

# ============================================================================
# The run
# ============================================================================
SEAT_ID=""          # the chair's model id, sanitized. NEVER printed.
SEAT_SOURCE=""      # session-env, or the absolute settings path
A_OPUS=""; A_SONNET=""; A_HAIKU=""; A_FABLE=""; A_SUBAGENT=""
ENV_ANSWERED=0
FILE_ANSWERED=0
FILE_PATH=""
FILE_NOTE=""

read_env_instrument() {
  local lane v
  SEAT_ID="$(env_by_name "${SEAT_ENV_NAME}")"
  if [[ -n "${SEAT_ID}" ]]; then SEAT_SOURCE="session-env"; ENV_ANSWERED=1; fi
  for lane in ${ALIAS_LANES}; do
    v="$(env_by_name "ANTHROPIC_DEFAULT_$(printf '%s' "${lane}" | LC_ALL=C tr 'a-z' 'A-Z')_MODEL")"
    [[ -n "${v}" ]] && ENV_ANSWERED=1
    case "${lane}" in
      opus)   A_OPUS="${v}" ;;
      sonnet) A_SONNET="${v}" ;;
      haiku)  A_HAIKU="${v}" ;;
      fable)  A_FABLE="${v}" ;;
    esac
  done
  A_SUBAGENT="$(env_by_name "${SUBAGENT_ENV_NAME}")"
  [[ -n "${A_SUBAGENT}" ]] && ENV_ANSWERED=1
  return 0
}

# The fallback fills ONLY the names the session env left empty. The env is the
# live truth; a file says what it intends, which is not the same thing.
read_file_instrument() {
  local launcher="$1" root sfile out line name val
  root="$(config_root_for "${launcher}")" || {
    FILE_NOTE="no config root is defined for launcher '${launcher}' (known: claude, claude-nine, claude-codex), so no settings file was read"
    return 0
  }
  [[ -n "${root}" ]] || { FILE_NOTE="the config root resolved empty"; return 0; }
  sfile="${root%/}/${SETTINGS_BASENAME}"
  FILE_PATH="${sfile}"
  [[ -f "${sfile}" && -r "${sfile}" ]] || {
    FILE_NOTE="no readable ${sfile}"
    return 0
  }
  resolve_parser || {
    FILE_NOTE="no JSON parser on this box (checked by name: jq at /usr/bin/jq then on PATH, then python3 on PATH), so ${sfile} was NOT read — this script reads JSON with a parser or not at all"
    return 0
  }
  out="$(read_settings_keys "${sfile}")"
  case "${out}" in
    NOTOBJECT*) FILE_NOTE="${sfile} is valid JSON but not an object"; return 0 ;;
    BADJSON*)   FILE_NOTE="${sfile} did not parse as JSON (parser: ${PARSER}); its contents are not printed"; return 0 ;;
  esac
  while IFS=$'\t' read -r name val; do
    [[ -n "${name}" && -n "${val}" ]] || continue
    val="$(sanitize "${val}")"
    [[ -n "${val}" ]] || continue
    FILE_ANSWERED=1
    case "${name}" in
      model|ANTHROPIC_MODEL)
        if [[ -z "${SEAT_ID}" ]]; then SEAT_ID="${val}"; SEAT_SOURCE="${sfile}"; fi ;;
      ANTHROPIC_DEFAULT_OPUS_MODEL)   [[ -n "${A_OPUS}"     ]] || A_OPUS="${val}" ;;
      ANTHROPIC_DEFAULT_SONNET_MODEL) [[ -n "${A_SONNET}"   ]] || A_SONNET="${val}" ;;
      ANTHROPIC_DEFAULT_HAIKU_MODEL)  [[ -n "${A_HAIKU}"    ]] || A_HAIKU="${val}" ;;
      ANTHROPIC_DEFAULT_FABLE_MODEL)  [[ -n "${A_FABLE}"    ]] || A_FABLE="${val}" ;;
      CLAUDE_CODE_SUBAGENT_MODEL)     [[ -n "${A_SUBAGENT}" ]] || A_SUBAGENT="${val}" ;;
    esac
  done <<EOF
${out}
EOF
  return 0
}

# resolve_lane — prints the lane on stdout, rc 0; rc 1 when the chair maps to
# nothing. opus is tested first: see the ordering note in the header.
resolve_lane() {
  local base w
  base="$(norm "${SEAT_ID}")"
  [[ -n "${base}" ]] || return 1

  [[ -n "${A_OPUS}"   && "${base}" == "$(norm "${A_OPUS}")"   ]] && { printf 'opus';   return 0; }
  [[ -n "${A_SONNET}" && "${base}" == "$(norm "${A_SONNET}")" ]] && { printf 'sonnet'; return 0; }
  [[ -n "${A_HAIKU}"  && "${base}" == "$(norm "${A_HAIKU}")"  ]] && { printf 'haiku';  return 0; }
  [[ -n "${A_FABLE}"  && "${base}" == "$(norm "${A_FABLE}")"  ]] && { printf 'fable';  return 0; }

  for w in ${ALIAS_LANES}; do
    if [[ "${base}" == "${w}" ]]; then printf '%s' "${w}"; return 0; fi
  done
  for w in ${ALIAS_LANES}; do
    if printf '%s' "${base}" | "${GREP}" -qE "(^|[^a-z0-9])${w}([^a-z0-9]|\$)"; then
      printf '%s' "${w}"; return 0
    fi
  done
  return 1
}

run_check() {
  local launcher="${1:-}" lane

  [[ -n "${launcher}" ]] \
    || und "usage: seat-check.sh <launcher>  (claude | claude-nine | claude-codex). Nothing was read and no seat is claimed."
  [[ -n "${GREP}" && -x "${GREP}" ]] \
    || und "no usable grep (checked by name: /usr/bin/grep, /bin/grep, then PATH) — the instrument cannot read its own inputs, so it claims nothing about the seat"

  read_env_instrument
  if [[ -z "${SEAT_ID}" || -z "${A_OPUS}${A_SONNET}${A_HAIKU}${A_FABLE}" ]]; then
    read_file_instrument "${launcher}"
  fi

  if (( ENV_ANSWERED == 0 && FILE_ANSWERED == 0 )); then
    und "NEITHER INSTRUMENT ANSWERED. Read, by name, one name at a time: ${SEAT_ENV_NAME}, ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL and ${SUBAGENT_ENV_NAME} in the session environment (printenv, per name — never a dump); then the launcher's own ${FILE_PATH:-settings file} by key name${FILE_NOTE:+ (${FILE_NOTE})}. NOT read, and never read by this script: any other environment name, any other file, the process list. The conductor's lane is UNDETERMINED — which is not a claim that it is wrong."
  fi

  if [[ -z "${SEAT_ID}" ]]; then
    und "the alias map answered but THE CHAIR DID NOT: ${SEAT_ENV_NAME} is unset in this session's environment and no \`model\` key was readable${FILE_PATH:+ from ${FILE_PATH}}${FILE_NOTE:+ (${FILE_NOTE})}. An alias key proves a lane EXISTS; it never proves who is sitting in it. UNDETERMINED, not a verdict."
  fi

  lane="$(resolve_lane)" || \
    und "the chair was read from ${SEAT_SOURCE} but its id maps to no lane: it matches no ANTHROPIC_DEFAULT_<ALIAS>_MODEL value under the family rule and carries no alias word as a whole token. The id is NOT printed here (values are redacted as a class); run \`printenv ${SEAT_ENV_NAME}\` to see it. UNDETERMINED — an unmappable chair is never reported as 'not opus'."

  printf 'CONDUCTOR-SEAT: expected=opus resolved=%s launcher=%s source=%s\n' \
    "${lane}" "${launcher}" "${SEAT_SOURCE}"

  if [[ "${lane}" == "opus" ]]; then exit 0; fi

  printf 'SEAT-CHECK WRONG-LANE | the conductor is on the %s lane, not opus. capacity.md §11 seats the conductor on Opus and promises the skill reports it when the session is not. This is that report. The cure is starting the session on the opus lane — this script never writes a settings file (RC-20) and nothing here repairs the seat. Write the CONDUCTOR-SEAT line above through tools/ledger.sh; say nothing to the client (audience.md §7); tools/dispatch-check.sh refuses a BUILD dispatch with exit 10 until the newest such line reads resolved=opus.\n' \
    "${lane}" >&2
  exit 3
}

# ============================================================================
# The selftest — the instrument proven before any verdict is believed
# ============================================================================
FAILS=0
report() { # report <n> <name> <ok 0|1> <detail>
  if [[ "$3" == "1" ]]; then printf 'PASS %-2s %-24s %s\n' "$1" "$2" "$4"
  else printf 'FAIL %-2s %-24s %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 )); fi
}

# mtime <file> — BSD stat first, then GNU. Empty when neither answers.
mtime() {
  local m
  m="$(stat -f %m "$1" 2>/dev/null)"
  if [[ -z "${m}" ]]; then m="$(stat -c %Y "$1" 2>/dev/null)"; fi
  printf '%s' "${m}"
}

run_selftest() {
  local T RA RB out rc ok m0 m1 hits
  T="$(mktemp -d "${TMPDIR:-/tmp}/seat-check-selftest.XXXXXX")" || {
    echo "BROKEN INSTRUMENT: cannot create a temp dir for the selftest" >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT
  RA="${T}/root-empty"; mkdir -p "${RA}"
  RB="${T}/root-file";  mkdir -p "${RB}"

  # The names every fixture below must clear off the inherited environment. A
  # selftest that inherited the operator's own routing would report a lane it
  # never set.
  local CLEAR="-u ANTHROPIC_MODEL -u ANTHROPIC_DEFAULT_OPUS_MODEL -u ANTHROPIC_DEFAULT_SONNET_MODEL -u ANTHROPIC_DEFAULT_HAIKU_MODEL -u ANTHROPIC_DEFAULT_FABLE_MODEL -u CLAUDE_CODE_SUBAGENT_MODEL -u CLAUDE_CONFIG_DIR"

  # The canary's own alias map, as three fixtures share it.
  local MAP="ANTHROPIC_DEFAULT_OPUS_MODEL=opus-chain ANTHROPIC_DEFAULT_SONNET_MODEL=sonnet-chain ANTHROPIC_DEFAULT_HAIKU_MODEL=haiku-chain CLAUDE_CODE_SUBAGENT_MODEL=inherit"

  # --- 0: the instrument controls, proven on known positives ---------------
  local kp_env kp_grep
  kp_env="$(env ${CLEAR} ANTHROPIC_MODEL=known-positive-value "${PRINTENV:-printenv}" ANTHROPIC_MODEL 2>/dev/null)"
  kp_grep="$(printf '%s' 'claude-opus-5[1m]' | "${GREP}" -cE '(^|[^a-z0-9])opus([^a-z0-9]|$)')"
  ok=0; [[ "${kp_env}" == "known-positive-value" && "${kp_grep}" == "1" ]] && ok=1
  report 0 "instrument-controls" "${ok}" "printenv returned the one name it was given (got '${kp_env}', want 'known-positive-value'); the family-word grep counts ${kp_grep} (want 1) in a tier id. Every leg below is meaningless if this line fails."
  if [[ "${ok}" == "0" ]]; then
    printf '\nseat-check.sh selftest: the instrument fails its own control — no verdict below can be believed\n' >&2
    exit 2
  fi

  # --- 1: the OPUS lane -----------------------------------------------------
  out="$(env ${CLEAR} ${MAP} ANTHROPIC_MODEL=opus-chain SEAT_CHECK_CONFIG_ROOT="${RA}" \
        bash "${SELF}" claude-nine 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "0" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'CONDUCTOR-SEAT: expected=opus resolved=opus launcher=claude-nine source=session-env' || ok=0
  report 1 "opus-lane-exit-0" "${ok}" "rc=${rc} (want 0) with ANTHROPIC_MODEL on the value of ANTHROPIC_DEFAULT_OPUS_MODEL; the line names the lane and the source: ${out}"

  # --- 2: THE DISCRIMINATING CASE — the SONNET lane on the canary's box -----
  # The identical alias map, the identical launcher; ONE thing changes, the
  # chair. A check that greps the environment for "opus" passes legs 1 and 4
  # and fails here, which is why this leg is the one that matters.
  out="$(env ${CLEAR} ${MAP} ANTHROPIC_MODEL=sonnet-chain SEAT_CHECK_CONFIG_ROOT="${RA}" \
        bash "${SELF}" claude-nine 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'CONDUCTOR-SEAT: expected=opus resolved=sonnet launcher=claude-nine source=session-env' || ok=0
  printf '%s' "${out}" | "${GREP}" -q 'WRONG-LANE' || ok=0
  report 2 "sonnet-lane-exit-3" "${ok}" "rc=${rc} (want 3) on the SAME alias map as leg 1 with only the chair changed; the output NAMES the lane (resolved=sonnet): ${out}"

  # --- 3: the naive-grep trap is real --------------------------------------
  # Leg 2 only discriminates if its environment really does mention opus.
  hits="$(env ${CLEAR} ${MAP} ANTHROPIC_MODEL=sonnet-chain "${PRINTENV:-printenv}" ANTHROPIC_DEFAULT_OPUS_MODEL 2>/dev/null | "${GREP}" -c 'opus')"
  ok=0; [[ "${hits}" == "1" ]] && ok=1
  report 3 "naive-grep-would-pass" "${ok}" "leg 2's environment carries ${hits} (want 1) hit for 'opus' in ANTHROPIC_DEFAULT_OPUS_MODEL alone — so a check that searched the environment for that string would have called leg 2 the opus lane. The exit 3 above is a fact about the CHAIR, not about the string."

  # --- 4: no alias keys at all, and no chair → UNDETERMINED ----------------
  out="$(env ${CLEAR} SEAT_CHECK_CONFIG_ROOT="${RA}" bash "${SELF}" claude-nine 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'NEITHER INSTRUMENT ANSWERED' || ok=0
  printf '%s' "${out}" | "${GREP}" -q "${RA}/settings.json" || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'CONDUCTOR-SEAT:'; then ok=0; fi
  report 4 "no-keys-undetermined" "${ok}" "rc=${rc} (want 2) with every enumerated name unset and an empty config root; the message names both instruments including the exact path, and NO CONDUCTOR-SEAT line is emitted: ${out}"

  # --- 5: an alias map with no chair is still UNDETERMINED -----------------
  out="$(env ${CLEAR} ${MAP} SEAT_CHECK_CONFIG_ROOT="${RA}" bash "${SELF}" claude-nine 2>&1)"; rc=$?
  ok=0; [[ "${rc}" == "2" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q 'THE CHAIR DID NOT' || ok=0
  report 5 "alias-map-without-chair" "${ok}" "rc=${rc} (want 2, never 0 and never 3) when the lanes are all declared and ANTHROPIC_MODEL is unset — an alias key proves a lane exists, never who sits in it: ${out}"

  # --- 6: the settings-file fallback, and the decoy it must not print ------
  printf '%s\n' '{"model":"sonnet","apiKeyHelper":"DECOY-MUST-NEVER-BE-PRINTED","env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"opus-chain","ANTHROPIC_DEFAULT_SONNET_MODEL":"sonnet-chain"},"hooks":{"x":"y"}}' > "${RB}/settings.json"
  m0="$(mtime "${RB}/settings.json")"
  out="$(env ${CLEAR} SEAT_CHECK_CONFIG_ROOT="${RB}" bash "${SELF}" claude-nine 2>&1)"; rc=$?
  m1="$(mtime "${RB}/settings.json")"
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "CONDUCTOR-SEAT: expected=opus resolved=sonnet launcher=claude-nine source=${RB}/settings.json" || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'DECOY'; then ok=0; fi
  if printf '%s' "${out}" | "${GREP}" -q 'apiKeyHelper'; then ok=0; fi
  report 6 "file-fallback-and-decoy" "${ok}" "rc=${rc} (want 3) reading \`model\` by key name from a settings file whose env block also declares the opus lane; the source field names that exact path, and neither the decoy key's name nor its value appears anywhere in the output"

  # --- 7: THE NON-WRITE PROOF ----------------------------------------------
  ok=0; [[ -n "${m0}" && "${m0}" == "${m1}" ]] && ok=1
  report 7 "never-writes-settings" "${ok}" "the fixture settings file's mtime is ${m0:-UNREADABLE} before the full run and ${m1:-UNREADABLE} after — identical. This script never writes a settings file, and a seat-check that repaired the seat by editing the operator's config would be RC-20, the defect beside this one."

  # --- 8: the SAME file leg under the second parser -----------------------
  # Both readers select the same names by name, so both must return the same
  # lane from the same fixture. A fallback nobody runs is a fallback nobody has.
  out="$(env ${CLEAR} SEAT_CHECK_NO_JQ=1 SEAT_CHECK_CONFIG_ROOT="${RB}" bash "${SELF}" claude-nine 2>&1)"; rc=$?
  m1="$(mtime "${RB}/settings.json")"
  ok=0; [[ "${rc}" == "3" ]] && ok=1
  printf '%s' "${out}" | "${GREP}" -q "CONDUCTOR-SEAT: expected=opus resolved=sonnet launcher=claude-nine source=${RB}/settings.json" || ok=0
  if printf '%s' "${out}" | "${GREP}" -q 'DECOY'; then ok=0; fi
  [[ -n "${m0}" && "${m0}" == "${m1}" ]] || ok=0
  report 8 "second-parser-agrees" "${ok}" "rc=${rc} (want 3) on leg 6's fixture with SEAT_CHECK_NO_JQ=1 forcing the python3 reader: the same lane, the same source path, no decoy, and the mtime still ${m1:-UNREADABLE} (want ${m0:-UNREADABLE})"

  printf '\n'
  if (( FAILS == 0 )); then
    printf 'seat-check.sh selftest: ALL PASS (9 checks)\n'
    exit 0
  fi
  printf 'seat-check.sh selftest: %s FAILED — this is a BROKEN INSTRUMENT; read the seat by hand (printenv ANTHROPIC_MODEL) and say so in the ledger\n' "${FAILS}"
  exit 1
}

case "${1:-}" in
  --selftest) run_selftest ;;
  --help|-h)  usage; exit 0 ;;
  "")         usage >&2; exit 2 ;;
  *)          run_check "$@" ;;
esac
