#!/usr/bin/env bash
# preflight.sh — SKILL.md steps 1 through 2.10 in one silent command (#7, #51).
#
# Usage:
#   preflight.sh [--background] [--launcher claude|claude-nine|claude-codex]
#                [--compact-target <n>] [--run-id <id>]
#   preflight.sh --flush <run-id> <project>
#   preflight.sh --selftest
#
# It runs every step of 1-2.10 that is a TOOL call, in order, with every tool's
# output kept off the screen (in the holding folder's CONTROL/preflight.log):
#   gate0     tools/gate0.sh --check-session            (skipped with --background)
#   hooks     tools/hook-check.sh [--install-missing]  GATE 0b
#   gate0c    `bash --version` on Windows; platform-skip elsewhere
#   seat      tools/seat-check.sh <launcher>            (step 2; needs --launcher)
#   update    tools/check-update.sh                     (step 2.5; the offer is made later)
#   compact   tools/compact-guard.sh <root> <target>    (step 2.6; target 500000 on
#             claude, --compact-target on claude-nine / claude-codex)
#   decision  tools/jev-check.sh                        (step 2.7; never spoken)
#   companions scripts/bootstrap-companions.sh          (step 2.9)
#   statusline scripts/setup-statusline.sh              (step 2.10)
# Harness/launcher detection, OpenClaw detection, autoCompactEnabled and the
# Workflow capability probe have no tool; the conductor does those itself.
#
# It prints exactly one line:
#   PREFLIGHT | verdict=GO|GATE0-REFUSE|UNDETERMINED | run=<id> | <step=result ...>
# Exit 0 GO, 1 GATE 0 refusal (gate0 rc 1), 2 UNDETERMINED (gate0 could not
# decide, or GATE 0b hooks are not current). The other steps never gate.
#
# THE HOLDING FOLDER (#29, #30). Before the project folder exists, ledger lines
# go to "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/runs/<run-id>/CONTROL/LEDGER.md"
# through tools/ledger.sh. The run-id is $CLAUDE_CODE_SESSION_ID, else a UTC stamp
# plus the process id, unless --run-id sets it. `--flush <run-id> <project>`
# appends every held CONTROL/*.md line into the same file in <project> (ledger.sh
# keeps the stamp and does not sign twice), moves every other held file to the same
# relative path unless the project already has one, never moves
# CONTROL/.gate0-proven (it names the holding folder), then removes the holding folder.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
TOOLS="$(dirname "${SELF}")"
SCRIPTS="$(dirname "${TOOLS}")/scripts"
RUNS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/runs"

HOLD=""; LOG=""
led() { bash "${TOOLS}/ledger.sh" "${HOLD}" "CONTROL/LEDGER.md" "$1" >>"${LOG}" 2>&1; }
# run <script> [args...] — output to the log; rc is the script's, 127 when it is missing.
run() { local s="$1"; shift; [ -f "${s}" ] || return 127; bash "${s}" "$@" >>"${LOG}.out" 2>>"${LOG}"; }
out_line() { grep -m1 "^$1" "${LOG}.out" 2>/dev/null; }

do_preflight() {
  local bg=0 launcher="" target="" run_id="${CLAUDE_CODE_SESSION_ID:-}" rc s verdict=GO fields=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --background) bg=1 ;;
      --launcher) launcher="${2:?--launcher needs a name}"; shift ;;
      --compact-target) target="${2:?--compact-target needs a number}"; shift ;;
      --run-id) run_id="${2:?--run-id needs an id}"; shift ;;
      *) echo "PREFLIGHT | verdict=UNDETERMINED | unknown option $1"; exit 2 ;;
    esac; shift
  done
  [ -n "${run_id}" ] || run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  HOLD="${RUNS}/${run_id}"; LOG="${HOLD}/CONTROL/preflight.log"
  mkdir -p "${HOLD}/CONTROL" || { echo "PREFLIGHT | verdict=UNDETERMINED | run=${run_id} | hold=unwritable"; exit 2; }
  add() { fields="${fields} | $1"; }
  finish() {
    local line="PREFLIGHT | verdict=${verdict} | run=${run_id}${fields}"
    led "${line}"; rm -f "${LOG}.out"; echo "${line}"
    case "${verdict}" in GO) exit 0 ;; GATE0-REFUSE) exit 1 ;; *) exit 2 ;; esac
  }

  # 1. GATE 0 — the conductor already ran it before the greeting when --background.
  if [ "${bg}" = 1 ]; then add "gate0=skipped-background"
  else
    run "${TOOLS}/gate0.sh" --check-session; rc=$?
    case "${rc}" in
      0) add "gate0=pass" ;;
      1) add "gate0=refuse"; verdict=GATE0-REFUSE; finish ;;
      *) add "gate0=undetermined(rc=${rc})"; verdict=UNDETERMINED; finish ;;
    esac
  fi

  # GATE 0b — hooks current (install the missing ones when hook-check can).
  s="${TOOLS}/hook-check.sh"
  if grep -q -- '--install-missing' "${s}" 2>/dev/null; then run "${s}" --install-missing --home "${HOLD}"; else run "${s}" --home "${HOLD}"; fi
  rc=$?
  case "${rc}" in 0) add "hooks=match" ;; 3) add "hooks=stale"; verdict=UNDETERMINED ;;
    4) add "hooks=absent"; verdict=UNDETERMINED ;; *) add "hooks=undetermined(rc=${rc})"; verdict=UNDETERMINED ;; esac

  # GATE 0c — Git Bash on Windows only.
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) if bash --version >/dev/null 2>&1; then add "gate0c=ok"; else add "gate0c=absent"; fi ;;
    *) add "gate0c=platform-skip" ;;
  esac

  # 2. conductor seat — needs the launcher the conductor detected.
  if [ -n "${launcher}" ]; then
    run "${TOOLS}/seat-check.sh" "${launcher}"; rc=$?
    s="$(out_line 'CONDUCTOR-SEAT:')"; [ -n "${s}" ] && led "${s}"
    case "${rc}" in 0) add "seat=opus" ;; 3) add "seat=off-lane" ;; *) add "seat=undetermined(rc=${rc})" ;; esac
  else add "seat=skipped-no-launcher"; fi

  # 2.5 version check — recorded; the offer is made after entry mode.
  run "${TOOLS}/check-update.sh"; rc=$?
  s="$(grep '^UPDATE AVAILABLE' "${LOG}.out" 2>/dev/null | sed 's/^UPDATE AVAILABLE //; s/  */ /g' | paste -sd, -)"
  case "${rc}" in 0) add "update=current"; led "UPDATE-CHECK: verdict=current" ;;
    1) add "update=available"; led "UPDATE-CHECK: verdict=available stale=${s}" ;;
    *) add "update=undetermined(rc=${rc})"; led "UPDATE-CHECK: verdict=undetermined rc=${rc}" ;; esac

  # 2.6 auto-compaction floor — own config root only.
  [ -z "${target}" ] && [ "${launcher}" = "claude" ] && target=500000
  if [ -n "${target}" ]; then
    run "${TOOLS}/compact-guard.sh" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${target}"; rc=$?
    s="$(out_line 'AUTOCOMPACT:')"; [ -n "${s}" ] && led "${s}"
    case "${rc}" in 0) add "compact=raised" ;; 3|4) add "compact=kept" ;; *) add "compact=undetermined(rc=${rc})" ;; esac
  else add "compact=skipped-no-target"; fi

  # 2.7 decision engine — ledger only, never spoken (#10).
  run "${TOOLS}/jev-check.sh"; rc=$?
  s="$(out_line 'DECISION-ENGINE:')"; [ -n "${s}" ] && led "${s}"
  case "${rc}" in 0) add "decision=present" ;; 1) add "decision=absent" ;; *) add "decision=undetermined(rc=${rc})" ;; esac

  # 2.9 companions, 2.10 status line — never block.
  run "${SCRIPTS}/bootstrap-companions.sh"; add "companions=rc${?}"
  run "${SCRIPTS}/setup-statusline.sh"; add "statusline=rc${?}"
  finish
}

do_flush() {
  local run_id="${1:-}" project="${2:-}" f rel n=0 m=0 bad=0 line
  [ -n "${run_id}" ] && [ -d "${project}" ] || { echo "PREFLIGHT-FLUSH | verdict=UNDETERMINED | usage: --flush <run-id> <existing project>"; exit 2; }
  HOLD="${RUNS}/${run_id}"
  [ -d "${HOLD}" ] || { echo "PREFLIGHT-FLUSH | run=${run_id} | verdict=NOTHING-HELD"; exit 0; }
  while IFS= read -r f; do
    rel="${f#"${HOLD}"/}"
    case "${rel}" in CONTROL/.gate0-proven|.ledger-pinned|*.lock|*.lock/*|*.tmp*) continue ;; esac
    case "${rel}" in
      CONTROL/*.md)
        while IFS= read -r line || [ -n "${line}" ]; do
          [ -n "${line}" ] || continue
          if bash "${TOOLS}/ledger.sh" "${project}" "${rel}" "${line}" >/dev/null 2>&1; then n=$((n+1)); else bad=$((bad+1)); fi
        done < "${f}" ;;
      *)
        [ -e "${project}/${rel}" ] && continue
        mkdir -p "$(dirname "${project}/${rel}")" && mv "${f}" "${project}/${rel}" && m=$((m+1)) || bad=$((bad+1)) ;;
    esac
  done < <(find "${HOLD}" -type f)
  if [ "${bad}" -gt 0 ]; then
    echo "PREFLIGHT-FLUSH | run=${run_id} | project=${project} | lines=${n} | moved=${m} | failed=${bad} | verdict=UNDETERMINED (holding folder kept)"; exit 2
  fi
  rm -rf "${HOLD}"
  echo "PREFLIGHT-FLUSH | run=${run_id} | project=${project} | lines=${n} | moved=${m} | verdict=OK"
}

selftest() {
  local T sk out rc fails=0 L
  T="$(mktemp -d)" || { echo "SELFTEST | UNDETERMINED | cannot mktemp"; exit 2; }
  trap 'rm -rf "${T}"' EXIT
  sk="${T}/skill"; mkdir -p "${sk}/tools" "${sk}/scripts" "${T}/cfg" "${T}/proj"
  cp "${SELF}" "${sk}/tools/preflight.sh"; cp "${TOOLS}/ledger.sh" "${sk}/tools/"
  printf 'exit ${STUB_GATE0_RC:-0}\n' > "${sk}/tools/gate0.sh"
  printf 'exit 0\n' > "${sk}/tools/hook-check.sh"
  printf 'echo "CONDUCTOR-SEAT: expected=opus resolved=opus launcher=$1 source=stub"\n' > "${sk}/tools/seat-check.sh"
  printf 'echo "UPDATE AVAILABLE kaizen  1.0 -> 1.1"; exit 1\n' > "${sk}/tools/check-update.sh"
  printf 'echo "AUTOCOMPACT: root=$1 live=1 target=$2 action=raised"\n' > "${sk}/tools/compact-guard.sh"
  printf 'echo "DECISION-ENGINE: verdict=ABSENT source=none model=none latency_ms=n/a detail=stub"; exit 1\n' > "${sk}/tools/jev-check.sh"
  printf 'exit 0\n' | tee "${sk}/scripts/bootstrap-companions.sh" > "${sk}/scripts/setup-statusline.sh"
  ok() { if [ "$2" = 1 ]; then echo "PASS $1"; else echo "FAIL $1 | ${out}"; fails=$((fails+1)); fi; }
  L="${T}/cfg/spec-protocol/runs/r1/CONTROL/LEDGER.md"

  # #7/#51: one line, GO, every step's ledger line in the holding folder.
  out="$(CLAUDE_CONFIG_DIR="${T}/cfg" bash "${sk}/tools/preflight.sh" --launcher claude --run-id r1 2>&1)"; rc=$?
  ok "go-one-line" "$([ "${rc}" = 0 ] && [ "$(printf '%s\n' "${out}" | wc -l | tr -d ' ')" = 1 ] \
    && case "${out}" in "PREFLIGHT | verdict=GO | run=r1 | gate0=pass"*"compact=raised"*) true ;; *) false ;; esac \
    && grep -q 'AUTOCOMPACT: .*target=500000' "${L}" && grep -q 'DECISION-ENGINE:' "${L}" \
    && grep -q 'UPDATE-CHECK: verdict=available stale=kaizen 1.0 -> 1.1' "${L}" && grep -q 'PREFLIGHT | verdict=GO' "${L}" && echo 1)"
  # #7: gate0 rc 1 is a refusal (exit 1); --background never runs gate0.
  out="$(STUB_GATE0_RC=1 CLAUDE_CONFIG_DIR="${T}/cfg" bash "${sk}/tools/preflight.sh" --run-id r2 2>&1)"; rc=$?
  ok "gate0-refuse" "$([ "${rc}" = 1 ] && case "${out}" in *verdict=GATE0-REFUSE*) true ;; *) false ;; esac && echo 1)"
  out="$(STUB_GATE0_RC=1 CLAUDE_CONFIG_DIR="${T}/cfg" bash "${sk}/tools/preflight.sh" --background --run-id r3 2>&1)"; rc=$?
  ok "background-skips-gate0" "$([ "${rc}" = 0 ] && case "${out}" in *gate0=skipped-background*) true ;; *) false ;; esac && echo 1)"
  # #29/#30: flush moves the held lines into the project ledger and removes the holding folder.
  : > "${T}/cfg/spec-protocol/runs/r1/.spec-protocol-opened-2026-01-01T00:00:00Z"
  out="$(CLAUDE_CONFIG_DIR="${T}/cfg" bash "${sk}/tools/preflight.sh" --flush r1 "${T}/proj" 2>&1)"; rc=$?
  ok "flush" "$([ "${rc}" = 0 ] && grep -q 'PREFLIGHT | verdict=GO | run=r1' "${T}/proj/CONTROL/LEDGER.md" \
    && [ "$(grep -c 'writer=ledger.sh' "${T}/proj/CONTROL/LEDGER.md")" = "$(grep -c . "${T}/proj/CONTROL/LEDGER.md")" ] \
    && ! grep -q 'writer=ledger.sh | writer=ledger.sh' "${T}/proj/CONTROL/LEDGER.md" \
    && [ -e "${T}/proj/.spec-protocol-opened-2026-01-01T00:00:00Z" ] && [ ! -d "${T}/cfg/spec-protocol/runs/r1" ] && echo 1)"
  [ "${fails}" = 0 ] && { echo "SELFTEST PASS | 4 cases"; exit 0; }
  echo "SELFTEST FAIL | ${fails} case(s)"; exit 1
}

case "${1:-}" in
  --selftest) selftest ;;
  --flush) shift; do_flush "$@" ;;
  *) do_preflight "$@" ;;
esac
