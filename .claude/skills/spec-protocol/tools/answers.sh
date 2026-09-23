#!/usr/bin/env bash
# answers.sh — the ONLY writer of <project>/00-INPUT/ANSWERS.md (#23).
#
# Usage:
#   answers.sh <project> init [--planned key1,key2,...]
#   answers.sh <project> ask <key> "<words>"       the question, the moment it is SPOKEN
#   answers.sh <project> answer <key> "<words>"    the client's answer, the moment it is GIVEN
#   answers.sh <project> stated <key> "<words>"    a fact read back from the client's own
#                                                  documents: ANSWERED, never asked
#   answers.sh <project> skip <key>                a planned key that does not apply
#   answers.sh init --hold <run-id> [--planned k1,k2]   turn 1, before any project folder exists:
#       the ledger is HELD at ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/runs/<run-id>/00-INPUT/ANSWERS.md
#   answers.sh --hold <run-id> ask|answer|stated|skip ...   the same verbs on the held ledger
#   answers.sh --flush <run-id> <project>          the project exists: move the held ledger into
#       <project>/00-INPUT/ANSWERS.md (merged by key when one is already there)
#   answers.sh --selftest
#
# One fixed format, one block per key (the shape tools/hooks/conversation-gate.py reads):
#   ## <key>
#   **Asked:** _not yet spoken_        -> **Asked:** "<words>"
#   **Answer:** _blank_                -> **Answer:** "<words>"
# stated writes **Asked:** _stated ..._ and skip writes _skipped ..._ / _skipped_; neither
# is ever read as owed or as a hanging question.
#
# RESULT LINES. init prints `ANSWERS | init | <absolute path of ANSWERS.md>` and flush prints
# `ANSWERS | flush | <absolute path>`. The conversation gate reads the ledger from THAT line in
# the tool result, never from the command text, where "$P" or "." (after a cd) is unknowable.
#
# init never overwrites: an existing file keeps every block and only gains the planned
# keys it lacks. ask/answer on a key with no block append one. Words are kept on one
# line (newlines become spaces). Every write is a temp file + mv in the same folder.
# Exit 0 written, 2 bad usage / unwritable.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
die() { echo "ANSWERS | verdict=UNDETERMINED | $*" >&2; exit 2; }

block() { printf '\n## %s\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n' "$1"; }
oneline() { printf '"%s"' "$(printf '%s' "$1" | tr '\r\n' '  ')"; }
placeholder() { case "$1" in "_not yet spoken"*|_blank*|"") return 0 ;; esac; return 1; }
abspath() { printf '%s/%s' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"; }

hold_file() {
  case "$1" in ''|*[!A-Za-z0-9_.-]*|.|..) die "run-id must be letters, digits, . _ - only" ;; esac
  printf '%s/spec-protocol/runs/%s/00-INPUT/ANSWERS.md' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$1"
}

# A key's heading is "## <key>" alone, or followed by a space or "(" and more text
# (an older file's "## idea (uncounted opening, step 3)" IS the idea block), so no
# verb ever appends a duplicate block for a key that already has one.
HEAD_AWK='function head(l, k) { return l == k || index(l, k " ") == 1 || index(l, k "(") == 1 }'
has_key() { KEY="## $2" awk "${HEAD_AWK}"' head($0, ENVIRON["KEY"]) { f = 1; exit } END { exit !f }' "$1"; }

# field <file> <key> <Asked|Answer> — the raw value after "**<field>:** " in that key's block.
field() {
  KEY="## $2" FIELD="**$3:** " awk "${HEAD_AWK}"'
    head($0, ENVIRON["KEY"]) { inb = 1; next }
    /^## / { inb = 0 }
    inb && index($0, ENVIRON["FIELD"]) == 1 { print substr($0, length(ENVIRON["FIELD"]) + 1); exit }' "$1"
}

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
    has_key "${tmp}" "${k}" || block "${k}" >> "${tmp}"
  done
  commit "${f}" "${tmp}"
  echo "ANSWERS | init | $(abspath "${f}")"
}

do_set() { # do_set <file> <Asked|Answer> <key> <raw value: already quoted, or a _marker_>
  local f="$1" field="$2" key="$3" tmp
  [ -f "${f}" ] || die "${f} does not exist — run: answers.sh <project> init"
  [ -n "${key}" ] || die "empty key"
  tmp="$(mktemp "${f}.tmp.XXXXXX")" || die "cannot write beside ${f}"
  cat "${f}" > "${tmp}"
  has_key "${tmp}" "${key}" || block "${key}" >> "${tmp}"
  KEY="## ${key}" FIELD="**${field}:**" VAL="$4" awk "${HEAD_AWK}"'
    head($0, ENVIRON["KEY"]) { inb = 1; print; next }
    /^## / { inb = 0 }
    inb && index($0, ENVIRON["FIELD"]) == 1 { print ENVIRON["FIELD"] " " ENVIRON["VAL"]; next }
    { print }' "${tmp}" > "${tmp}.2" && mv -f "${tmp}.2" "${tmp}" || { rm -f "${tmp}" "${tmp}.2"; die "rewrite failed"; }
  commit "${f}" "${tmp}"
  echo "ANSWERS | ${field} | ${key}"
}

# do_flush <held file> <project> — the held ledger joins the project's. No project ledger
# yet: a move. One already there: each held key it lacks is added, and each held value
# fills a field the project still holds as a placeholder. A recorded value is never lost.
do_flush() {
  local h="$1" f="${2%/}/00-INPUT/ANSWERS.md" k fld v
  [ -f "${h}" ] || die "no held ledger at ${h} — run: answers.sh init --hold <run-id>"
  [ -d "$2" ] || die "project folder $2 does not exist"
  mkdir -p "$(dirname "${f}")" || die "cannot create $(dirname "${f}")"
  if [ ! -f "${f}" ]; then
    mv -f "${h}" "${f}" || die "could not move ${h} to ${f}"
  else
    while IFS= read -r k; do
      k="${k#\#\# }"
      has_key "${f}" "${k}" || do_set "${f}" Answer "${k}" "_blank_" >/dev/null
      for fld in Asked Answer; do
        v="$(field "${h}" "${k}" "${fld}")"
        placeholder "${v}" && continue
        placeholder "$(field "${f}" "${k}" "${fld}")" || continue
        do_set "${f}" "${fld}" "${k}" "${v}" >/dev/null
      done
    done < <(grep '^## ' "${h}")
    rm -f "${h}"
  fi
  rmdir "$(dirname "${h}")" "$(dirname "$(dirname "${h}")")" 2>/dev/null
  echo "ANSWERS | flush | $(abspath "${f}")"
}

selftest() {
  local T f fails=0 h out
  T="$(mktemp -d)" || { echo "SELFTEST | UNDETERMINED | cannot mktemp"; exit 2; }
  T="$(cd "${T}" && pwd)"
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
  # stated / skip: markers, and nothing is left "not yet spoken".
  bash "${SELF}" "${T}/p" stated idea "a booking page for the bakery" >/dev/null
  bash "${SELF}" "${T}/p" skip budget >/dev/null
  ok "stated+skip" "$(awk '/^## idea/{b=1;next} /^## /{b=0} b' "${f}" | grep -q '^\*\*Asked:\*\* _stated' \
    && awk '/^## budget/{b=1;next} /^## /{b=0} b' "${f}" | grep -qx '\*\*Answer:\*\* _skipped_' \
    && ! grep -q '_not yet spoken_' "${f}" && echo 1)"
  # hold + flush: the turn-1 ledger lives under the config root, then moves into the
  # project; both result lines carry absolute paths, a relative project included.
  out="$(CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" init --hold r1 --planned entry-mode,idea)"
  h="${T}/cfg/spec-protocol/runs/r1/00-INPUT/ANSWERS.md"
  CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" --hold r1 ask entry-mode "Which way?" >/dev/null
  CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" --hold r1 answer idea "cakes" >/dev/null
  mkdir -p "${T}/q"
  ok "hold+flush move" "$([ "${out}" = "ANSWERS | init | ${h}" ] \
    && [ "$(cd "${T}" && CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" --flush r1 q)" = "ANSWERS | flush | ${T}/q/00-INPUT/ANSWERS.md" ] \
    && [ ! -e "${h}" ] && grep -qx '\*\*Asked:\*\* "Which way?"' "${T}/q/00-INPUT/ANSWERS.md" && echo 1)"
  # flush into an existing ledger: a recorded value wins, a new key is added.
  CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" init --hold r2 --planned idea,extra >/dev/null
  CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" --hold r2 answer idea "replaced" >/dev/null
  CLAUDE_CONFIG_DIR="${T}/cfg" bash "${SELF}" --flush r2 "${T}/q" >/dev/null
  ok "flush merge" "$(grep -qx '\*\*Answer:\*\* "cakes"' "${T}/q/00-INPUT/ANSWERS.md" \
    && ! grep -q 'replaced' "${T}/q/00-INPUT/ANSWERS.md" && grep -qx '## extra' "${T}/q/00-INPUT/ANSWERS.md" && echo 1)"
  # init on an OLD file whose heading carries extra text after the key: recognised as
  # that key, never a duplicate block; answer lands under the old heading.
  mkdir -p "${T}/o/00-INPUT"
  printf '# Answers\n\n## idea (uncounted opening, step 3)\n**Asked:** _not yet spoken_\n**Answer:** _blank_\n' > "${T}/o/00-INPUT/ANSWERS.md"
  bash "${SELF}" "${T}/o" init --planned idea,idea-2 >/dev/null
  bash "${SELF}" "${T}/o" answer idea "a bakery site" >/dev/null
  ok "init old heading" "$([ "$(grep -c '^## idea' "${T}/o/00-INPUT/ANSWERS.md")" = 2 ] \
    && grep -qx '## idea-2' "${T}/o/00-INPUT/ANSWERS.md" && ! grep -qx '## idea' "${T}/o/00-INPUT/ANSWERS.md" \
    && [ "$(grep -c '"a bakery site"' "${T}/o/00-INPUT/ANSWERS.md")" = 1 ] && echo 1)"
  [ "${fails}" = 0 ] && { echo "SELFTEST PASS | 7 cases"; exit 0; }
  echo "SELFTEST FAIL | ${fails} case(s)"; exit 1
}

verb() { # verb <file> <verb> [args...]
  local F="$1"; shift
  case "${1:-}" in
    init) if [ "${2:-}" = "--planned" ]; then do_init "${F}" "${3:-}"; else do_init "${F}" ""; fi ;;
    ask) [ $# -eq 3 ] || die "usage: ask <key> \"<words>\""; do_set "${F}" Asked "$2" "$(oneline "$3")" ;;
    answer) [ $# -eq 3 ] || die "usage: answer <key> \"<words>\""; do_set "${F}" Answer "$2" "$(oneline "$3")" ;;
    stated) [ $# -eq 3 ] || die "usage: stated <key> \"<words>\""
      do_set "${F}" Asked "$2" "_stated — read back from the client's documents_" >/dev/null
      do_set "${F}" Answer "$2" "$(oneline "$3")" >/dev/null; echo "ANSWERS | stated | $2" ;;
    skip) [ $# -eq 2 ] || die "usage: skip <key>"
      do_set "${F}" Asked "$2" "_skipped — does not apply_" >/dev/null
      do_set "${F}" Answer "$2" "_skipped_" >/dev/null; echo "ANSWERS | skipped | $2" ;;
    *) die "unknown verb ${1:-<none>}" ;;
  esac
}

USAGE="usage: answers.sh <project> init [--planned k1,k2] | ask|answer|stated <key> \"<words>\" | skip <key>; answers.sh init --hold <run-id> [--planned ...]; answers.sh --hold <run-id> <verb> ...; answers.sh --flush <run-id> <project>"
case "${1:-}" in
  --selftest) selftest ;;
  --flush) [ $# -eq 3 ] || die "${USAGE}"; H="$(hold_file "$2")" || exit 2; do_flush "${H}" "$3" ;;
  --hold) [ $# -ge 3 ] || die "${USAGE}"; H="$(hold_file "$2")" || exit 2; shift 2; verb "${H}" "$@" ;;
  init) { [ "${2:-}" = "--hold" ] && [ $# -ge 3 ]; } || die "${USAGE}"
    H="$(hold_file "$3")" || exit 2; shift 3; verb "${H}" init "$@" ;;
  *) [ $# -ge 2 ] || die "${USAGE}"; P="$1"; shift; verb "${P%/}/00-INPUT/ANSWERS.md" "$@" ;;
esac
