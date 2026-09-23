#!/usr/bin/env bash
# morning-note.sh — puts the morning report on the client's Desktop (step 22).
#
# The project folder copy of the morning report (document 14,
# <project>/MORNING-REPORT-YYYY-MM-DD.md) is the whole report. The Desktop copy,
# `Your project is ready.txt`, is the same report with the "Operator notes"
# section cut off (`references/audience.md`, "The morning report"). This tool
# makes that cut mechanically, lints the result with tools/speech-check.sh, and
# only then puts it on the Desktop — a note that fails the lint never lands.
#
# USAGE
#   morning-note.sh <project-home>   newest MORNING-REPORT-*.md in that folder
#   morning-note.sh <report-file>    that report
#   morning-note.sh --selftest       prove the cut and the refusal, then exit
#
# The Desktop is $HOME/Desktop (Git Bash on Windows: HOME is %USERPROFILE%).
#
# EXIT CODES
#   0 — written: NOTE-WRITTEN: <path>
#   2 — UNDETERMINED: no report found, unreadable, or the lint could not run
#   3 — REFUSED: the Desktop copy failed speech-check; nothing was written
#   4 — the selftest FAILED
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
SELF="${SELF_DIR}/$(basename "${BASH_SOURCE[0]}")"
SPEECH="${SELF_DIR}/speech-check.sh"
NOTE_NAME="Your project is ready.txt"

undetermined() { echo "MORNING-NOTE: UNDETERMINED: $*" >&2; exit 2; }

# Everything ABOVE the first "Operator notes" heading, minus the template's
# "---- everything below this line ... ----" divider and trailing blank lines.
cut_operator_notes() {
  awk '
    /^#+[[:space:]]*Operator notes/ { exit }
    /^-{3,}[[:space:]]*everything below this line/ { next }
    { buf[++n] = $0 }
    END { while (n > 0 && buf[n] ~ /^[[:space:]]*(-{3,})?[[:space:]]*$/) n--
          for (i = 1; i <= n; i++) print buf[i] }
  ' "$1"
}

run() {
  local arg="${1%/}" report home desk tmp rc
  if [ -f "${arg}" ]; then
    report="${arg}"; home="$(cd "$(dirname "${arg}")" && pwd)"
  elif [ -d "${arg}" ]; then
    home="$(cd "${arg}" && pwd)"
    report="$(ls -1 "${home}"/MORNING-REPORT-*.md 2>/dev/null | sort | tail -n 1)"
    [ -n "${report}" ] || undetermined "no MORNING-REPORT-*.md in ${home}"
  else
    undetermined "not a project folder or report file: ${arg}"
  fi
  [ -r "${report}" ] || undetermined "cannot read ${report}"
  [ -f "${SPEECH}" ] || undetermined "speech-check.sh missing beside this tool"

  desk="${HOME}/Desktop"
  mkdir -p "${desk}" || undetermined "cannot create ${desk}"
  tmp="$(mktemp "${desk}/.morning-note.XXXXXX")" || undetermined "cannot write in ${desk}"
  cut_operator_notes "${report}" > "${tmp}" || { rm -f "${tmp}"; undetermined "cannot cut ${report}"; }
  [ -s "${tmp}" ] || { rm -f "${tmp}"; undetermined "report is empty above Operator notes"; }

  bash "${SPEECH}" "${tmp}" --home "${home}"; rc=$?
  case "${rc}" in
    0) mv -f "${tmp}" "${desk}/${NOTE_NAME}" || { rm -f "${tmp}"; undetermined "cannot place the note"; }
       echo "NOTE-WRITTEN: ${desk}/${NOTE_NAME}"; exit 0 ;;
    3) rm -f "${tmp}"
       echo "MORNING-NOTE: REFUSED: the Desktop copy failed speech-check (classes above); fix the report and re-run" >&2
       exit 3 ;;
    *) rm -f "${tmp}"; undetermined "speech-check rc=${rc}" ;;
  esac
}

selftest() {
  local t fail=0 rc
  t="$(mktemp -d "${TMPDIR:-/tmp}/morning-note-selftest.XXXXXX")" || { echo "SELFTEST | UNDETERMINED | cannot mktemp" >&2; exit 4; }
  mkdir -p "${t}/home/Desktop" "${t}/proj/CONTROL"
  cat > "${t}/proj/MORNING-REPORT-2026-01-01.md" <<'EOF'
# Your project is ready — Sample Shop — 2026-01-01

Your website is live at https://example.com. Its files are saved on your computer, not online yet.

## What was built

A shop page with a contact form.

---- everything below this line is in the project folder copy ONLY ----

## Operator notes

SECRET-OPERATOR-LINE seats 6 of 10.
EOF
  # Case 1: operator notes cut, clean copy written to the FIXTURE Desktop.
  HOME="${t}/home" bash "${SELF}" "${t}/proj" >/dev/null 2>&1; rc=$?
  if [ "${rc}" -eq 0 ] && [ -f "${t}/home/Desktop/${NOTE_NAME}" ] \
     && ! grep -q "SECRET-OPERATOR-LINE\|Operator notes\|everything below" "${t}/home/Desktop/${NOTE_NAME}" \
     && grep -q "A shop page with a contact form." "${t}/home/Desktop/${NOTE_NAME}"; then
    echo "SELFTEST | PASS | operator notes cut, clean copy written"
  else echo "SELFTEST | FAIL | clean case rc=${rc}"; fail=1; fi

  # Case 2: a jargon line above the cut -> refused, nothing written.
  rm -f "${t}/home/Desktop/${NOTE_NAME}"
  cat > "${t}/proj/MORNING-REPORT-2026-01-02.md" <<'EOF'
# Your project is ready — Sample Shop — 2026-01-02

The database server is up.
EOF
  HOME="${t}/home" bash "${SELF}" "${t}/proj" >/dev/null 2>&1; rc=$?
  if [ "${rc}" -eq 3 ] && [ ! -e "${t}/home/Desktop/${NOTE_NAME}" ] \
     && [ -z "$(ls -A "${t}/home/Desktop")" ]; then
    echo "SELFTEST | PASS | jargon line refused, nothing written"
  else echo "SELFTEST | FAIL | jargon case rc=${rc}"; fail=1; fi

  rm -rf "${t}"
  [ "${fail}" -eq 0 ] && { echo "SELFTEST | OK"; exit 0; }
  echo "SELFTEST | FAILED" >&2; exit 4
}

case "${1:-}" in
  --selftest) selftest ;;
  ""|--help|-h) sed -n '2,23p' "${SELF}" | sed 's/^# \{0,1\}//'; [ -n "${1:-}" ] && exit 0; exit 2 ;;
  *) run "$1" ;;
esac
