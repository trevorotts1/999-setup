#!/usr/bin/env bash
# answers.sh — the ONLY writer of <project>/00-INPUT/ANSWERS.md (#23).
#
# Usage:
#   answers.sh <project> init [--planned key1,key2,...]
#   answers.sh <project> ask <key> "<words>"       the question, the moment it is SPOKEN
#   answers.sh <project> answer <key> "<words>"    the client's answer, the moment it is GIVEN
#   answers.sh --selftest
#
# One fixed format, one block per key (the shape tools/hooks/conversation-gate.py reads):
#   ## <key>
#   **Asked:** _not yet spoken_        -> **Asked:** "<words>"
#   **Answer:** _blank_                -> **Answer:** "<words>"
#
# init never overwrites: an existing file keeps every block and only gains the planned
# keys it lacks. ask/answer on a key with no block append one. Words are kept on one
# line (newlines become spaces). Every write is a temp file + mv in the same folder.
# Exit 0 written, 2 bad usage / unwritable.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
die() { echo "ANSWERS | verdict=UNDETERMINED | $*" >&2; exit 2; }

block() { printf '\n## %s\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n' "$1"; }

# write <file> <content-file> — atomic replace.
commit() { mv -f "$2" "$1" || { rm -f "$2"; die "could not replace $1"; }; }

do_init() {
  local f="$1" planned="${2:-}" tmp k
  mkdir -p "$(dirname "${f}")" || die "cannot create $(dirname "${f}")"
  tmp="$(mktemp "${f}.tmp.XXXXXX")" || die "cannot write beside ${f}"
  if [ -f "${f}" ]; then cat "${f}" > "${tmp}"; else printf '# Answers\n' > "${tmp}"; fi
  IFS=',' read -r -a keys <<< "${planned}"
  for k in "${keys[@]+"${keys[@]}"}"; do
    k="$(printf '%s' "${k}" | sed 's/^ *//; s/ *$//')"
    [ -n "${k}" ] || continue
    grep -qxF "## ${k}" "${tmp}" || block "${k}" >> "${tmp}"
  done
  commit "${f}" "${tmp}"
  echo "ANSWERS | init | ${f}"
}

do_set() { # do_set <file> <Asked|Answer> <key> <words>
  local f="$1" field="$2" key="$3" words tmp
  [ -f "${f}" ] || die "${f} does not exist — run: answers.sh <project> init"
  [ -n "${key}" ] || die "empty key"
  words="$(printf '%s' "$4" | tr '\r\n' '  ')"
  tmp="$(mktemp "${f}.tmp.XXXXXX")" || die "cannot write beside ${f}"
  cat "${f}" > "${tmp}"
  grep -qxF "## ${key}" "${tmp}" || block "${key}" >> "${tmp}"
  KEY="## ${key}" FIELD="**${field}:**" VAL="\"${words}\"" awk '
    $0 == ENVIRON["KEY"] { inb = 1; print; next }
    /^## / { inb = 0 }
    inb && index($0, ENVIRON["FIELD"]) == 1 { print ENVIRON["FIELD"] " " ENVIRON["VAL"]; next }
    { print }' "${tmp}" > "${tmp}.2" && mv -f "${tmp}.2" "${tmp}" || { rm -f "${tmp}" "${tmp}.2"; die "rewrite failed"; }
  commit "${f}" "${tmp}"
  echo "ANSWERS | ${field} | ${key}"
}

selftest() {
  local T f fails=0
  T="$(mktemp -d)" || { echo "SELFTEST | UNDETERMINED | cannot mktemp"; exit 2; }
  trap 'rm -rf "${T}"' EXIT
  f="${T}/p/00-INPUT/ANSWERS.md"
  ok() { if [ "$2" = 1 ]; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
  # init: planned keys pre-filled; a re-init keeps an existing answer and adds only new keys.
  bash "${SELF}" "${T}/p" init --planned idea,audience >/dev/null
  printf '**Answer:** "kept"\n' >> "${f}"
  bash "${SELF}" "${T}/p" init --planned idea,audience,budget >/dev/null
  ok "init" "$([ "$(grep -c '^\*\*Asked:\*\* _not yet spoken_' "${f}")" = 3 ] && grep -q '"kept"' "${f}" \
    && [ "$(grep -cx '## idea' "${f}")" = 1 ] && grep -qx '## budget' "${f}" && echo 1)"
  # ask: sets Asked on that key only.
  bash "${SELF}" "${T}/p" ask audience "Who is it for?" >/dev/null
  ok "ask" "$(awk '/^## audience/{b=1;next} /^## /{b=0} b' "${f}" | grep -qx '\*\*Asked:\*\* "Who is it for?"' \
    && awk '/^## idea/{b=1;next} /^## /{b=0} b' "${f}" | grep -q '_not yet spoken_' && echo 1)"
  # answer: sets Answer, one line, and no temp file is left behind.
  bash "${SELF}" "${T}/p" answer audience $'bakery\nregulars' >/dev/null
  ok "answer" "$(awk '/^## audience/{b=1;next} /^## /{b=0} b' "${f}" | grep -qx '\*\*Answer:\*\* "bakery regulars"' \
    && [ -z "$(ls "${T}/p/00-INPUT" | grep tmp)" ] && echo 1)"
  [ "${fails}" = 0 ] && { echo "SELFTEST PASS | 3 cases"; exit 0; }
  echo "SELFTEST FAIL | ${fails} case(s)"; exit 1
}

[ "${1:-}" = "--selftest" ] && selftest
[ $# -ge 2 ] || die "usage: answers.sh <project> init [--planned k1,k2] | ask <key> \"<words>\" | answer <key> \"<words>\""
F="${1%/}/00-INPUT/ANSWERS.md"
case "$2" in
  init) [ "${3:-}" = "--planned" ] && do_init "${F}" "${4:-}" || do_init "${F}" "" ;;
  ask) [ $# -eq 4 ] || die "usage: ask <key> \"<words>\""; do_set "${F}" Asked "$3" "$4" ;;
  answer) [ $# -eq 4 ] || die "usage: answer <key> \"<words>\""; do_set "${F}" Answer "$3" "$4" ;;
  *) die "unknown verb $2" ;;
esac
