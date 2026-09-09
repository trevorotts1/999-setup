#!/usr/bin/env bash
# speech-check.sh — the client-speech lint. It reads a file of DRAFTED client
# text and refuses the token classes that must never reach the client's
# transcript (SKILL.md section 12, `references/audience.md` — the binding row
# "no operator aside in the client's transcript").
#
# WHY IT EXISTS. In the 2026-09-07 canary the conductor invented a client-facing
# operator channel that no line of this skill sanctions, and spoke file paths,
# workflow ids, finding counts, a trend, budget numbers and rule numbers into a
# bakery owner's transcript across five consecutive turns. Prose could not stop
# it; a lint that runs can. This is that lint: advisory to a model, mechanical
# in what it measures.
#
# THE TEN BANNED CLASSES — the class id is what the tool prints and what the
# ledger records:
#   path              a path-like string  (captures/, tools/ledger.sh, 00-INPUT/bar/)
#   workflow-id       a WF- / wf- id      (WF-AUDIT-20B)
#   law-number        a rule number       (Law 42, Laws 26, 40)
#   md-filename       a document name     (AUDIT-STEP20C-2026-09-07.md)
#   trend             a trend field       (trend: 17 -> 23 -> 29)
#   money             a cost              ($4.20, 12 dollars, 40 USD)
#   model-id          a model name        (claude-sonnet-4-5, opus, haiku, gpt-4)
#   operator-heading  a line that OPENS an operator aside ("Operator note.")
#   tmp-path          a scratch path      (/tmp/corner-post-backup, %TEMP%\draft)
#   backup-announcement  the words "backup at" and then a path
#
# The word "operator" in ordinary prose is NOT banned and must not be flagged:
# this tool matches the HEADING — the start of a line — never the word. The
# sanctioned status sentence of SKILL.md section 12 must also pass. Both are
# proven by --selftest, which is what makes a REJECT from this tool mean
# something: a checker that rejects everything measures nothing.
#
# COUNTS ARE NOT A CLASS. The sanctioned status sentence carries counts ("14 of
# 40 pieces done"), so a count is legal. What is illegal is the count of
# FINDINGS, which arrives wearing one of the classes above, and an UNCHANGED
# count repeated turn after turn — a stall, which is raised through the tick,
# not narrated. No lint can see the previous message, so the unchanged-count
# rule lives in SKILL.md and is enforced by the tick, not here; this tool is
# honest about that rather than pretending to check it.
#
# USAGE
#   speech-check.sh <file>                  lint the drafted message in <file>
#   speech-check.sh - [--home <dir>]        lint stdin
#   speech-check.sh --selftest              prove the instrument, then exit
#   speech-check.sh --classes               print the ten class ids, exit 0
#   speech-check.sh <file> --home <dir>     name the project home for the ledger
#
# OUTPUT — one verdict line, then one detail line per hit (the matched TOKEN
# only, never the surrounding sentence):
#   SPEECH-CHECK | verdict=CLEAN  | classes=none | file=<name>
#   SPEECH-CHECK | verdict=REJECT | classes=path,trend | file=<name>
#   SPEECH-CHECK   path | line 7 | captures/
#
# THE LEDGER. Every run records its verdict through tools/ledger.sh into
# <home>/CONTROL/LEDGER.md as `SPEECH-CHECK: clean` or `SPEECH-CHECK: <list>`.
# <home> comes from --home, else $SPEC_PROTOCOL_HOME, else a bounded upward
# walk from the linted file for a directory containing CONTROL/. If no home is
# found the degradation is NAMED on stderr — never silent — and the verdict
# still prints.
#
# EXIT CODES
#   0 — CLEAN: no banned class present
#   2 — UNDETERMINED: the input or the instrument could not be read. Never
#       reported as CLEAN and never as REJECT — a broken checker is a fact
#       about the checker, not about the text.
#   3 — REJECT: at least one banned class is present; the classes are named
#   4 — the selftest FAILED: this checker may not be believed until it is fixed
set -u

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
LEDGER_SH="${SELF_DIR}/ledger.sh"

# ---------------------------------------------------------------------------
# grep resolution — resolved ONCE. An empty GREP is never treated as "no
# match": it means the answer is UNKNOWN, and this tool says so out loud.
# ---------------------------------------------------------------------------
GREP="/usr/bin/grep"
if [ ! -x "${GREP}" ]; then
  if [ -x /bin/grep ]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

CLASS_IDS="path workflow-id law-number md-filename trend money model-id operator-heading tmp-path backup-announcement"

# ---------------------------------------------------------------------------
# The patterns. POSIX ERE only (no \b, no \d) so BSD grep and GNU grep agree.
# Each is deliberately conservative: a false REJECT teaches the conductor to
# ignore the tool, which is worse than a miss.
# ---------------------------------------------------------------------------

# path — four shapes, none of which can fire without a "/":
#   P1  an absolute, home-relative or dot-relative path        /opt, ~/x, ./x
#   P2  a slash-joined token whose segment carries an upper-case letter,
#       an underscore or a hyphen                              QUALITY-CONTROL/AUDIT-1, A1/A2
#   P3  a slash-joined token ending in a file extension        tools/ledger.sh
#   P4  a trailing directory slash                             captures/
# "and/or", "he/she", "24/7" and "km/h" match none of them, which is the point.
RE_path='(^|[^A-Za-z0-9_.~/-])(~/|\./|\.\./|/)[A-Za-z0-9_.~-]|[A-Za-z0-9_.-]*[A-Z_-][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]*[A-Z_-]|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]*\.[A-Za-z]{2,4}([^A-Za-z0-9]|$)|[A-Za-z][A-Za-z0-9_.-]+/([^A-Za-z0-9]|$)'

RE_workflow_id='(^|[^A-Za-z0-9])[Ww][Ff]-[A-Za-z0-9]'

RE_law_number='(^|[^A-Za-z])[Ll]aws?[[:space:]]+[0-9]'

RE_md_filename='[A-Za-z0-9_.-]+\.[Mm][Dd]([^A-Za-z0-9]|$)'

RE_trend='[Tt]rend:'

RE_money='[$][0-9]|[0-9][[:space:]]*(dollars?|DOLLARS?|USD|usd)([^A-Za-z]|$)'

RE_model_id='[Cc]laude-[A-Za-z0-9]|(^|[^A-Za-z])[Gg][Pp][Tt]-[0-9]|(^|[^A-Za-z])([Oo]pus|[Ss]onnet|[Hh]aiku|[Dd]eep[Ss]eek|[Gg]emini|[Mm]ini[Mm]ax|[Ll]lama)([^A-Za-z]|$)'

# operator-heading — anchored at the START of a line, after any leading
# whitespace and any markdown decoration (>, *, _, #, backtick, -). This is the
# whole reason "the operator of the bakery" passes: mid-line is not a heading.
RE_operator_heading='^[[:space:]>*_#`-]*[Oo]perator[[:space:]]+[Nn]ote'

# tmp-path — the 2026-09-08 canary's own sentence, six turns running: a scratch
# directory spoken into a client's transcript. `path` already catches it; this
# class exists so the report NAMES the second breach in that line — a project
# write outside the project folder — and so the Windows shape is named too.
RE_tmp_path='(^|[^A-Za-z0-9_.~-])/[Tt][Mm][Pp]/[A-Za-z0-9_.~-]|%[Tt][Ee][Mm][Pp]%\\'

# backup-announcement — the words "backup at" followed by a path-shaped token.
# The words alone are legal ("there is a backup, and it is safe"); the words
# plus a path are the canary line, and the client can do nothing with either.
RE_backup_announcement='[Bb]ackups?[[:space:]]+at[[:space:]]+[^[:space:]]*[/\][^[:space:]]'

re_for() {
  case "$1" in
    path)             printf '%s' "${RE_path}" ;;
    workflow-id)      printf '%s' "${RE_workflow_id}" ;;
    law-number)       printf '%s' "${RE_law_number}" ;;
    md-filename)      printf '%s' "${RE_md_filename}" ;;
    trend)            printf '%s' "${RE_trend}" ;;
    money)            printf '%s' "${RE_money}" ;;
    model-id)         printf '%s' "${RE_model_id}" ;;
    operator-heading) printf '%s' "${RE_operator_heading}" ;;
    tmp-path)         printf '%s' "${RE_tmp_path}" ;;
    backup-announcement) printf '%s' "${RE_backup_announcement}" ;;
    *)                return 1 ;;
  esac
}

die_undetermined() {
  echo "SPEECH-CHECK | verdict=UNDETERMINED | reason=$1" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# find_home <start-dir> — bounded upward walk (6 levels) for a directory that
# holds CONTROL/. Prints nothing and returns 1 when there is none.
# ---------------------------------------------------------------------------
find_home() {
  local d="$1" i=0
  [ -d "${d}" ] || return 1
  d="$(cd "${d}" 2>/dev/null && pwd)" || return 1
  while [ "${i}" -lt 6 ]; do
    if [ -d "${d}/CONTROL" ]; then printf '%s' "${d}"; return 0; fi
    [ "${d}" = "/" ] && return 1
    d="$(dirname "${d}")"
    i=$((i + 1))
  done
  return 1
}

# ---------------------------------------------------------------------------
# write_ledger <home> <verdict-payload> <file-label>
# The payload is exactly `clean` or the comma-and-space list of class ids, so
# the recorded line reads `SPEECH-CHECK: clean` or `SPEECH-CHECK: path, trend`.
# ---------------------------------------------------------------------------
write_ledger() {
  local home="$1" payload="$2" label="$3" ts line
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown-time)"
  line="${ts} | SPEECH-CHECK: ${payload} | file=${label}"
  if [ -z "${home}" ]; then
    echo "SPEECH-CHECK | ledger=SKIPPED | reason=no project home found (no --home, no \$SPEC_PROTOCOL_HOME, no CONTROL/ within 6 levels above the linted file) — the verdict above stands, but it is NOT recorded" >&2
    return 0
  fi
  if [ ! -x "${LEDGER_SH}" ] && [ ! -f "${LEDGER_SH}" ]; then
    echo "SPEECH-CHECK | ledger=SKIPPED | reason=${LEDGER_SH} not found — the verdict above stands, but it is NOT recorded" >&2
    return 0
  fi
  if ! bash "${LEDGER_SH}" "${home}" "CONTROL/LEDGER.md" "${line}" >/dev/null; then
    echo "SPEECH-CHECK | ledger=FAILED | reason=ledger.sh refused or errored writing to ${home}/CONTROL/LEDGER.md" >&2
  fi
  return 0
}

# ---------------------------------------------------------------------------
# lint <path-to-real-file> <label> <home-or-empty>
# ---------------------------------------------------------------------------
lint() {
  local src="$1" label="$2" home="$3"
  local cls re out rc hits found="" payload

  [ -n "${GREP}" ] || die_undetermined "no usable grep (/usr/bin/grep, /bin/grep, PATH) — this tool cannot answer"

  for cls in ${CLASS_IDS}; do
    re="$(re_for "${cls}")"
    out="$("${GREP}" -n -o -E -- "${re}" "${src}" 2>/dev/null)"
    rc=$?
    if [ "${rc}" -ge 2 ]; then
      die_undetermined "grep exited ${rc} on class ${cls} — an error, not an empty result"
    fi
    if [ "${rc}" -eq 0 ] && [ -n "${out}" ]; then
      found="${found}${found:+ }${cls}"
      # Keep at most three sample tokens per class; never echo the sentence.
      hits="$(printf '%s\n' "${out}" | head -n 3)"
      HIT_LINES="${HIT_LINES}$(printf '%s\n' "${hits}" | while IFS= read -r h; do
        printf 'SPEECH-CHECK   %-19s | line %s | %s\n' "${cls}" "${h%%:*}" "${h#*:}"
      done)
"
    fi
  done

  if [ -z "${found}" ]; then
    echo "SPEECH-CHECK | verdict=CLEAN | classes=none | file=${label}"
    write_ledger "${home}" "clean" "${label}"
    return 0
  fi

  payload="$(printf '%s' "${found}" | tr ' ' ',')"
  echo "SPEECH-CHECK | verdict=REJECT | classes=${payload} | file=${label}"
  printf '%s' "${HIT_LINES}"
  write_ledger "${home}" "$(printf '%s' "${found}" | sed 's/ /, /g')" "${label}"
  return 3
}

run_one() {
  local src="$1" home="$2" label tmp rc
  HIT_LINES=""
  if [ "${src}" = "-" ]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/speech-check.XXXXXX")" || die_undetermined "cannot mktemp for stdin"
    cat > "${tmp}"
    label="(stdin)"
    lint "${tmp}" "${label}" "${home}"; rc=$?
    rm -f "${tmp}"
    return "${rc}"
  fi
  [ -e "${src}" ] || die_undetermined "no such file: ${src}"
  [ -r "${src}" ] || die_undetermined "file not readable: ${src}"
  label="$(basename "${src}")"
  if [ -z "${home}" ]; then
    home="$(find_home "$(dirname "${src}")" || true)"
  fi
  lint "${src}" "${label}" "${home}"
}

# ---------------------------------------------------------------------------
# --selftest — twelve fixtures. THREE of them are CONTROLS that must PASS: the
# sanctioned status sentence of SKILL.md section 12, a sentence using the word
# "operator" in ordinary prose, and the verbatim opening script of SKILL.md
# lines 148-152 — Candace's own words, and a lint that rejects those is worse
# than no lint at all. A selftest in which every fixture is caught is a BROKEN
# tool, not a strict one, and those three are what prove the difference. The
# other nine carry the banned classes, and each must be caught AND named.
#
# The selftest also exercises the ledger path for real: it builds a throwaway
# project home with a CONTROL/ directory and asserts that twelve SPEECH-CHECK
# lines landed in it — nine lists and three `clean`.
# ---------------------------------------------------------------------------
selftest() {
  local tmp fails=0 n=0 home
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/speech-check-selftest.XXXXXX")" || { echo "SELFTEST | UNDETERMINED | cannot mktemp" >&2; exit 4; }
  trap 'rm -rf "${tmp}"' EXIT
  home="${tmp}/home"
  mkdir -p "${home}/CONTROL"

  _fixture() { # _fixture <label> <want-rc> <want-class(es)-or-none> <text>
    local label="$1" wantrc="$2" wantcls="$3" text="$4" f out rc gotcls
    n=$((n + 1))
    f="${tmp}/${label}.txt"
    printf '%s\n' "${text}" > "${f}"
    out="$("$0" "${f}" --home "${home}" 2>/dev/null)"; rc=$?
    gotcls="$(printf '%s\n' "${out}" | sed -n 's/^SPEECH-CHECK | verdict=[A-Z]* | classes=\([a-z,-]*\).*/\1/p' | head -n 1)"
    if [ "${rc}" != "${wantrc}" ]; then
      echo "SELFTEST FAIL | ${label} | rc=${rc} (want ${wantrc}) classes=${gotcls}"
      fails=$((fails + 1)); return
    fi
    if [ "${wantcls}" = "none" ]; then
      if [ "${gotcls}" != "none" ]; then
        echo "SELFTEST FAIL | ${label} | expected a CLEAN pass, got classes=${gotcls}"
        fails=$((fails + 1)); return
      fi
    else
      local w
      for w in ${wantcls}; do
        case ",${gotcls}," in
          *",${w},"*) : ;;
          *) echo "SELFTEST FAIL | ${label} | class ${w} not named (got classes=${gotcls})"
             fails=$((fails + 1)); return ;;
        esac
      done
    fi
    echo "SELFTEST ok   | ${label} | rc=${rc} classes=${gotcls}"
  }

  # --- CONTROL 1: the sanctioned status sentence (SKILL.md section 12). It
  # carries counts and a colon and must PASS. If this one is ever caught, the
  # tool has started rejecting the very sentence the skill mandates.
  _fixture control-sanctioned-status 0 none \
    'Still working: 14 of 40 pieces done, 6 being checked right now, nothing waiting on you. Next: the contact page.'

  # --- CONTROL 2: the word "operator" in ordinary prose. The banned thing is
  # the heading that opens an operator aside, not the word.
  _fixture control-operator-in-prose 0 none \
    'I spoke to the operator of the bakery this morning, and she is happy with the opening hours as they read on the page.'

  # --- The eight banned classes, one per fixture, in isolation.
  _fixture banned-path 3 path \
    'The evidence for the form test now sits in captures/ and the checker copy lives in tools/ledger.sh, not in the published folder.'

  _fixture banned-workflow-id 3 workflow-id \
    'The second inspection ran as WF-AUDIT-20B and it failed on all seven dimensions.'

  _fixture banned-law-number 3 law-number \
    'That extra search markup is exactly what Law 42 exists to catch, so I took it out.'

  _fixture banned-md-filename 3 md-filename \
    'Every finding from this round is written down in AUDIT-STEP20C-2026-09-07.md for the next pass.'

  _fixture banned-trend 3 trend \
    'The trend: 17 then 23 then 29 then 28 across the four rounds of checking.'

  _fixture banned-money 3 money \
    'The whole run has cost about $4.20 in helper time so far this evening.'

  _fixture banned-model-id 3 model-id \
    'I put the harshest checking seat on claude-sonnet-4-5 for this round.'

  _fixture banned-operator-heading 3 operator-heading \
    '**Operator note.** The gate is green and nothing needs you.'

  # --- THE CANARY LINE, verbatim from the 2026-09-08 claude-nine run, spoken
  # to a picture-framer on six consecutive turns. Two breaches in one sentence:
  # a project write outside the project folder, and a filesystem path in
  # client-visible text. BOTH names must appear in the report — `path` because
  # it is a path, `tmp-path` because of where it points.
  _fixture canary-tmp-backup 3 'path tmp-path' \
    'Details saved — backup at `/tmp/corner-post-framing-backup-20260908T1315Z`.'

  # --- CONTROL 3: THE DISCRIMINATING CONTROL. The verbatim opening script,
  # SKILL.md lines 148-152 — the first words the client ever hears. A lint that
  # rejects Candace's own words is worse than no lint, so if this fixture ever
  # goes red the new patterns are over-broad and the tool is the defect.
  _fixture control-opening-script 0 none \
    "
> Hi, I'm Candace. I build the thing you've been wanting: a website, an app for phones or computers, or pages that sell for you. You don't need to know which; that's my job.

> Here's how it works. I ask you plain questions, one at a time. \"I don't know\" is always a fine answer; I'll choose. Then my helpers build it, check it, and put it online, around the clock. You can walk away.
"

  # --- The ledger really was written: twelve lines, three of them `clean`.
  local total clean
  total="$("${GREP}" -c 'SPEECH-CHECK: ' "${home}/CONTROL/LEDGER.md" 2>/dev/null || echo 0)"
  clean="$("${GREP}" -c 'SPEECH-CHECK: clean' "${home}/CONTROL/LEDGER.md" 2>/dev/null || echo 0)"
  if [ "${total}" = "12" ] && [ "${clean}" = "3" ]; then
    echo "SELFTEST ok   | ledger-written | lines=12 clean=3"
  else
    echo "SELFTEST FAIL | ledger-written | lines=${total} (want 12) clean=${clean} (want 3)"
    fails=$((fails + 1))
  fi

  if [ "${fails}" -eq 0 ]; then
    echo "SELFTEST PASS | ${n} fixtures (3 controls PASS, 9 banned lines caught) + ledger check"
    exit 0
  fi
  echo "SELFTEST FAILED | ${fails} check(s) failed — this checker may not be believed until it is fixed" >&2
  exit 4
}

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
HOME_ARG=""
SRC=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --selftest) selftest ;;
    --classes)  for c in ${CLASS_IDS}; do echo "${c}"; done; exit 0 ;;
    --home)     shift; [ "$#" -gt 0 ] || die_undetermined "--home given with no directory"; HOME_ARG="$1" ;;
    --help|-h)  sed -n '2,62p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -)          SRC="-" ;;
    -*)         die_undetermined "unknown option: $1" ;;
    *)          SRC="$1" ;;
  esac
  shift
done

[ -n "${SRC}" ] || die_undetermined "no input given (usage: speech-check.sh <file>|- [--home <dir>] | --selftest | --classes)"
if [ -n "${HOME_ARG}" ] && [ ! -d "${HOME_ARG}" ]; then
  die_undetermined "--home ${HOME_ARG} is not a directory"
fi

HIT_LINES=""
run_one "${SRC}" "${HOME_ARG}"
