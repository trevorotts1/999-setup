#!/usr/bin/env bash
#==============================================================================
# bar-check.sh — the two files the client status bar reads, proven on disk
#==============================================================================
#
# PURPOSE
#   The status bar (SKILL.md §12, references/progress-visibility.md §6) has
#   exactly two inputs and, until 1.19.0, nothing was ever INSTRUCTED to write
#   them: `setup_progress` and `tasks.counts` appeared 0 times in SKILL.md
#   against 6 and 5 times in references/progress-visibility.md, and the live
#   canary run had neither file on disk — so both progress segments rendered as
#   nothing, silently, for a whole run. A bar segment with no file behind it is
#   a bar that cannot clear itself. This is the instrument that turns that
#   silence into an exit code.
#
#   THE TWO INPUTS (references/progress-visibility.md §6 owns both shapes):
#     CONTROL/setup_progress.json   {"step":n,"of":9}
#         written on entering each of the nine setup steps (2, 3, 4, 5, 6, 6.5,
#         7, 9, 13); it carries `Getting ready: step n of 9` before the plan
#         exists, and is read at scripts/setup-statusline.sh:372-373.
#     CONTROL/project_state.json    .tasks.counts
#         {"pending":<int>,"in_progress":<int>,"completed":<int>}, written at
#         every checkpoint (schema `spec-protocol/project-state@1`,
#         references/documents.md); it carries `n of N pieces (p%)` and is read
#         at scripts/setup-statusline.sh:358.
#
# USAGE
#   bar-check.sh <project>
#   bar-check.sh --selftest
#   bar-check.sh --help
#
# EXIT CODES
#   0  PASS          both inputs exist, parse, and carry the fields the bar
#                    actually reads. The values read are printed, so a pass is
#                    evidence and not an assertion.
#   2  UNDETERMINED  a file is present and does NOT parse, or is unreadable, or
#                    there is no JSON parser on this box, or the project path is
#                    unusable, or this script's own parser controls failed.
#                    Never a pass and never a MISSING verdict: a file that
#                    cannot be read is not a file that is not there.
#   3  MISSING       one or both inputs are absent — or present with the field
#                    the bar reads absent, which renders the same blank segment.
#                    The message NAMES every one it missed.
#
# THE FIRST LINE IS MACHINE-READABLE (tools/watch-tick.sh reads it):
#   BAR-CHECK result=<PASS|MISSING|UNDETERMINED> missing=<list|none>
#             malformed=<list|none> project=<abs path>
#   The list tokens are exactly:
#     CONTROL/setup_progress.json                 the file itself
#     CONTROL/setup_progress.json:step            file parses, no integer step
#     CONTROL/project_state.json                  the file itself
#     CONTROL/project_state.json:tasks.counts     file parses, no counts object
#                                                 (or a count field missing)
#
# THE NEGATIVE-RESULT CONTRACT (this script's own rule)
#   Every zero here is proven and every source is named: the run prints the two
#   absolute paths it checked, whatever the verdict. Before it trusts either
#   verdict it proves its JSON parser against a known-good fixture that MUST
#   parse and a known-bad one that MUST NOT — a detector that cannot fail is
#   not a detector — and a control failure is exit 2, never exit 0 and never
#   exit 3.
#
# ENVIRONMENT KNOB (diagnostic only)
#   BAR_CHECK_NO_JQ=1   force the python3 fallback, so the fallback is proven on
#                       a box that has jq. An untested fallback is a lie: run
#                       `BAR_CHECK_NO_JQ=1 bar-check.sh --selftest` and the same
#                       four fixtures must come back with the same four codes.
#
# WRITES NOTHING. It is a reader. It never creates, repairs, or edits either
# file, and it never writes one byte into the project it is pointed at; the
# only files it writes are its own selftest fixtures under $TMPDIR.
#==============================================================================

set -euo pipefail

SELF="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "$SELF")"

GREP="/usr/bin/grep"
if [[ ! -x "$GREP" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"
  else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi

PROJECT=""
DO_SELFTEST=0
TMPWORK=""

cleanup() {
  [[ -n "$TMPWORK" && -d "$TMPWORK" ]] && rm -rf "$TMPWORK"
  return 0
}
trap cleanup EXIT

usage() { sed -n '2,72p' "$SELF" | sed 's/^# \{0,1\}//'; }

#------------------------------------------------------------------------------
# 1. The two failure primitives. UNDETERMINED is loud and is never a verdict.
#------------------------------------------------------------------------------
und() {  # und <project-or-dash> <reason...>
  local p="$1"; shift
  printf 'BAR-CHECK result=UNDETERMINED missing=none malformed=none project=%s\n' "$p"
  printf 'bar-check.sh: UNDETERMINED (exit 2): %s\n' "$*" >&2
  printf 'bar-check.sh: nothing was proven about the status bar either way — this is not a pass and not a missing-file verdict.\n' >&2
  exit 2
}

broken() {  # broken <reason...>
  printf 'BAR-CHECK result=UNDETERMINED missing=none malformed=none project=%s\n' "${PROJECT:--}"
  printf 'bar-check.sh: BROKEN INSTRUMENT (exit 2): %s\n' "$*" >&2
  printf 'bar-check.sh: the parser failed its own control, so it may not report PASS or MISSING.\n' >&2
  exit 2
}

#------------------------------------------------------------------------------
# 2. The parser. jq first (the deployed status line already requires it), then
#    python3. Neither present is UNDETERMINED with BOTH names said out loud —
#    never a guess at the file's contents by grep.
#------------------------------------------------------------------------------
PARSER=""
JQ=""

resolve_parser() {
  if [[ "${BAR_CHECK_NO_JQ:-0}" == "1" ]]; then JQ=""            # diagnostic knob
  elif [[ -x /usr/bin/jq ]]; then JQ="/usr/bin/jq"
  else JQ="$(command -v jq 2>/dev/null || true)"; fi
  if [[ -n "$JQ" ]]; then PARSER="jq"; return 0; fi
  if command -v python3 >/dev/null 2>&1; then PARSER="python3"; return 0; fi
  return 1
}

JQ_SETUP='
def isint: (type == "number") and (. == floor);
if type != "object" then "NOTOBJECT"
elif ((.step | isint) | not) then "NOFIELD"
else "OK \(.step) \(if (.of | isint) then .of else 9 end)"
end
'

JQ_STATE='
def isint: (type == "number") and (. == floor);
. as $r
| if ($r | type) != "object" then "NOTOBJECT"
  elif (($r.tasks) | type) != "object" then "NOFIELD:tasks.counts"
  elif (($r.tasks.counts) | type) != "object" then "NOFIELD:tasks.counts"
  else ( ["pending", "in_progress", "completed"]
         | map(select((($r.tasks.counts[.]) | isint) | not))
         | if length > 0 then "NOFIELD:tasks.counts." + join(",tasks.counts.")
           else "OK \($r.tasks.counts.pending) \($r.tasks.counts.in_progress) \($r.tasks.counts.completed)"
           end )
  end
'

# probe_setup <file> -> one token on stdout, rc always 0:
#   "OK <step> <of>" | "NOFIELD" | "NOTOBJECT" | "BADJSON"
probe_setup() {
  case "$PARSER" in
    jq)
      "$JQ" -r "$JQ_SETUP" "$1" 2>/dev/null || printf 'BADJSON\n'
      ;;
    python3)
      python3 - "$1" 2>/dev/null <<'PY' || printf 'BADJSON\n'
import json, sys
def isint(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer()
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    print("NOTOBJECT")
elif not isint(d.get("step")):
    print("NOFIELD")
else:
    of = d.get("of")
    print("OK %d %d" % (int(d["step"]), int(of) if isint(of) else 9))
PY
      ;;
    *) printf 'BADJSON\n' ;;
  esac
}

# probe_state <file> -> one token on stdout, rc always 0:
#   "OK <pending> <in_progress> <completed>" | "NOFIELD:<names>" |
#   "NOTOBJECT" | "BADJSON"
probe_state() {
  case "$PARSER" in
    jq)
      "$JQ" -r "$JQ_STATE" "$1" 2>/dev/null || printf 'BADJSON\n'
      ;;
    python3)
      python3 - "$1" 2>/dev/null <<'PY' || printf 'BADJSON\n'
import json, sys
def isint(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer()
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
if not isinstance(d, dict):
    print("NOTOBJECT")
    raise SystemExit(0)
counts = d.get("tasks")
counts = counts.get("counts") if isinstance(counts, dict) else None
if not isinstance(counts, dict):
    print("NOFIELD:tasks.counts")
    raise SystemExit(0)
bad = [k for k in ("pending", "in_progress", "completed") if not isint(counts.get(k))]
if bad:
    print("NOFIELD:" + ",".join("tasks.counts." + k for k in bad))
else:
    print("OK %d %d %d" % (int(counts["pending"]), int(counts["in_progress"]),
                           int(counts["completed"])))
PY
      ;;
    *) printf 'BADJSON\n' ;;
  esac
}

#------------------------------------------------------------------------------
# 3. THE SELF-PROOF. Four embedded fixtures, run before ANY verdict: a
#    known-good of each shape that MUST parse, and a known-bad of each that
#    MUST NOT. A detector that accepts everything is not a detector.
#------------------------------------------------------------------------------
prove_parser() {
  resolve_parser || und "${PROJECT:--}" \
    "no JSON parser on this box. Checked, by name: jq (at /usr/bin/jq, then on PATH) and python3 (on PATH). Not checked: nothing else — this script reads JSON with a parser or not at all, and it never guesses at a file's contents with grep."
  TMPWORK="$(mktemp -d "${TMPDIR:-/tmp}/bar-check.XXXXXX")"
  printf '%s\n' '{"step":4,"of":9}'                                            > "$TMPWORK/good-setup.json"
  printf '%s\n' '{"step":4,'                                                   > "$TMPWORK/bad-setup.json"
  printf '%s\n' '{"tasks":{"counts":{"pending":20,"in_progress":6,"completed":14}}}' > "$TMPWORK/good-state.json"
  printf '%s\n' '{"tasks":{"snapshot_ts":"2026-09-08T00:00:00Z"}}'             > "$TMPWORK/bad-state.json"

  local t
  t="$(probe_setup "$TMPWORK/good-setup.json")"
  [[ "$t" == "OK 4 9" ]] || broken "the POSITIVE control failed: '{\"step\":4,\"of\":9}' read back as '${t}', not 'OK 4 9' (parser: ${PARSER})"
  t="$(probe_setup "$TMPWORK/bad-setup.json")"
  [[ "$t" == "BADJSON" ]] || broken "the NEGATIVE control failed: a truncated '{\"step\":4,' read back as '${t}' instead of BADJSON — the parser accepts malformed JSON (parser: ${PARSER})"
  t="$(probe_state "$TMPWORK/good-state.json")"
  [[ "$t" == "OK 20 6 14" ]] || broken "the POSITIVE control failed: a documented tasks.counts block read back as '${t}', not 'OK 20 6 14' (parser: ${PARSER})"
  t="$(probe_state "$TMPWORK/bad-state.json")"
  [[ "$t" == "NOFIELD:tasks.counts" ]] || broken "the NEGATIVE control failed: a tasks block with NO counts read back as '${t}' instead of NOFIELD:tasks.counts — the detector cannot see the live defect it exists for (parser: ${PARSER})"
}

#------------------------------------------------------------------------------
# 4. THE CHECK.
#------------------------------------------------------------------------------
MISSING=""
MALFORMED=""
add_missing()   { if [[ -z "$MISSING"   ]]; then MISSING="$1";   else MISSING="${MISSING},$1";     fi; }
add_malformed() { if [[ -z "$MALFORMED" ]]; then MALFORMED="$1"; else MALFORMED="${MALFORMED},$1"; fi; }

check() {
  [[ -n "$PROJECT" ]] || und "-" "no project given. Usage: bar-check.sh <project> | --selftest"
  [[ -d "$PROJECT" ]] || und "$PROJECT" "the project home does not exist or is not a directory: ${PROJECT}"
  PROJECT="$(cd "$PROJECT" && pwd)"

  prove_parser

  local SP="$PROJECT/CONTROL/setup_progress.json"
  local PS="$PROJECT/CONTROL/project_state.json"
  local tok step of pend inprog done_ notes=""

  # --- input 1: CONTROL/setup_progress.json -> "Getting ready: step n of 9"
  if [[ ! -e "$SP" ]]; then
    add_missing "CONTROL/setup_progress.json"
    notes="${notes}  CONTROL/setup_progress.json — ABSENT at ${SP}. The \"Getting ready: step n of 9\" segment has no file behind it, so it renders as nothing. Write {\"step\":n,\"of\":9} on entering each of the nine setup steps (2, 3, 4, 5, 6, 6.5, 7, 9, 13) — SKILL.md §12.
"
  elif [[ ! -r "$SP" ]]; then
    add_malformed "CONTROL/setup_progress.json:unreadable"
    notes="${notes}  CONTROL/setup_progress.json — PRESENT and UNREADABLE at ${SP}. Undetermined, never a missing-file verdict.
"
  else
    tok="$(probe_setup "$SP")"
    case "$tok" in
      "OK "*)
        read -r _ step of <<<"$tok"
        notes="${notes}  CONTROL/setup_progress.json — OK: step ${step} of ${of}.
" ;;
      BADJSON|NOTOBJECT)
        add_malformed "CONTROL/setup_progress.json"
        notes="${notes}  CONTROL/setup_progress.json — PRESENT and DOES NOT PARSE as a JSON object at ${SP}. Expected exactly {\"step\":n,\"of\":9}.
" ;;
      *)
        add_missing "CONTROL/setup_progress.json:step"
        notes="${notes}  CONTROL/setup_progress.json — parses, but carries no integer \"step\" at ${SP}. The segment renders as nothing, exactly as if the file were absent.
" ;;
    esac
  fi

  # --- input 2: CONTROL/project_state.json .tasks.counts -> "n of N pieces"
  if [[ ! -e "$PS" ]]; then
    add_missing "CONTROL/project_state.json"
    notes="${notes}  CONTROL/project_state.json — ABSENT at ${PS}. The \"n of N pieces (p%)\" segment has no file behind it.
"
  elif [[ ! -r "$PS" ]]; then
    add_malformed "CONTROL/project_state.json:unreadable"
    notes="${notes}  CONTROL/project_state.json — PRESENT and UNREADABLE at ${PS}. Undetermined, never a missing-file verdict.
"
  else
    tok="$(probe_state "$PS")"
    case "$tok" in
      "OK "*)
        read -r _ pend inprog done_ <<<"$tok"
        notes="${notes}  CONTROL/project_state.json tasks.counts — OK: pending ${pend}, in_progress ${inprog}, completed ${done_}.
" ;;
      BADJSON|NOTOBJECT)
        add_malformed "CONTROL/project_state.json"
        notes="${notes}  CONTROL/project_state.json — PRESENT and DOES NOT PARSE as a JSON object at ${PS}.
" ;;
      NOFIELD:*)
        add_missing "CONTROL/project_state.json:tasks.counts"
        notes="${notes}  CONTROL/project_state.json — parses, but ${tok#NOFIELD:} is absent or not an integer at ${PS}. The state file existing is NOT the same as the bar having counts to read; write tasks.counts {pending, in_progress, completed} at every checkpoint — SKILL.md §12, references/documents.md project-state@1.
" ;;
      *)
        add_malformed "CONTROL/project_state.json"
        notes="${notes}  CONTROL/project_state.json — the parser returned an unrecognised token '${tok}' at ${PS}.
" ;;
    esac
  fi

  local result rc
  if [[ -n "$MALFORMED" ]]; then result="UNDETERMINED"; rc=2
  elif [[ -n "$MISSING" ]]; then result="MISSING";      rc=3
  else                            result="PASS";        rc=0; fi

  printf 'BAR-CHECK result=%s missing=%s malformed=%s project=%s\n' \
    "$result" "${MISSING:-none}" "${MALFORMED:-none}" "$PROJECT"
  printf 'bar-check.sh: checked, by name: %s and %s (parser: %s).\n' "$SP" "$PS" "$PARSER"
  printf '%s' "$notes"

  case "$result" in
    PASS)
      printf 'bar-check.sh: PASS (exit 0) — both status-bar inputs exist, parse, and carry the fields the bar reads.\n' ;;
    MISSING)
      printf 'bar-check.sh: MISSING (exit 3) — the status bar has no file behind: %s\n' "$MISSING"
      printf 'bar-check.sh: a bar segment with no file behind it is a bar that cannot clear itself. SKILL.md §12 issues the instruction; references/progress-visibility.md §6 owns both shapes.\n' ;;
    UNDETERMINED)
      printf 'bar-check.sh: UNDETERMINED (exit 2) — present but unparseable: %s\n' "$MALFORMED"
      printf 'bar-check.sh: a file that cannot be read is not a file that is not there. Fix the JSON, then re-run.\n' ;;
  esac

  return "$rc"
}

#==============================================================================
# SELFTEST — the four fixtures (WAVE6-PLAN.md, RC-6 "Selftest")
#
#   1  both inputs present and well formed                     -> exit 0
#   2  CONTROL/setup_progress.json missing                     -> exit 3, named
#   3  CONTROL/project_state.json tasks.counts missing         -> exit 3, named
#   4  a malformed JSON input                                  -> exit 2
#
#   Case 1 is what makes the pair discriminate: without it, a script that
#   always said MISSING would pass cases 2-4.
#==============================================================================
SP_GOOD='{"step":4,"of":9}'
PS_GOOD='{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","phase":"T-07","tasks":{"snapshot_ts":"2026-09-08T00:00:00Z","counts":{"pending":20,"in_progress":6,"completed":14}}}'
PS_NOCOUNTS='{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","phase":"T-07","task_graph":{"units":[]}}'

selftest() {
  local T PASSES=0 FAILS=0 RC OUT ok
  TMPWORK="$(mktemp -d "${TMPDIR:-/tmp}/bar-check-selftest.XXXXXX")"
  T="$TMPWORK"

  mk() {  # mk <dir>
    mkdir -p "$1/CONTROL"
    printf '%s\n' "$SP_GOOD" > "$1/CONTROL/setup_progress.json"
    printf '%s\n' "$PS_GOOD" > "$1/CONTROL/project_state.json"
  }
  report() {  # report <n> <name> <ok:0/1> <detail>
    if (( $3 == 1 )); then
      printf 'PASS | case %s | %s | %s\n' "$1" "$2" "$4"; PASSES=$(( PASSES + 1 ))
    else
      printf 'FAIL | case %s | %s | %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 ))
    fi
  }
  runb() {  # runb <args...> -> sets RC and OUT
    set +e
    OUT="$(bash "$SELF" "$@" 2>&1)"; RC=$?
    set -e
  }

  # --- case 1: both present. The discriminating fixture: an always-MISSING
  #     script fails here and passes everything else.
  mk "$T/c1"
  runb "$T/c1"
  ok=0
  if (( RC == 0 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^BAR-CHECK result=PASS missing=none malformed=none ' \
     && printf '%s' "$OUT" | "$GREP" -q 'step 4 of 9' \
     && printf '%s' "$OUT" | "$GREP" -q 'pending 20, in_progress 6, completed 14'; then ok=1; fi
  report 1 "both-present" "$ok" "rc=${RC} (want 0); result=PASS with the values read back (step 4 of 9; 20/6/14)"

  # --- case 2: setup_progress.json missing. The message must NAME it.
  mk "$T/c2"; rm -f "$T/c2/CONTROL/setup_progress.json"
  runb "$T/c2"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^BAR-CHECK result=MISSING missing=CONTROL/setup_progress.json malformed=none ' \
     && printf '%s' "$OUT" | "$GREP" -q 'CONTROL/setup_progress.json — ABSENT at ' \
     && ! printf '%s' "$OUT" | "$GREP" -q 'project_state.json — ABSENT'; then ok=1; fi
  report 2 "setup-progress-missing" "$ok" "rc=${RC} (want 3); NAMED CONTROL/setup_progress.json as absent and did NOT accuse the state file"

  # --- case 3: project_state.json parses but carries no tasks.counts — the
  #     exact live shape (task_graph.units instead of tasks). A present file is
  #     not a present input.
  mk "$T/c3"; printf '%s\n' "$PS_NOCOUNTS" > "$T/c3/CONTROL/project_state.json"
  runb "$T/c3"
  ok=0
  if (( RC == 3 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^BAR-CHECK result=MISSING missing=CONTROL/project_state.json:tasks.counts malformed=none ' \
     && printf '%s' "$OUT" | "$GREP" -q 'CONTROL/project_state.json — parses, but tasks.counts is absent'; then ok=1; fi
  report 3 "tasks-counts-missing" "$ok" "rc=${RC} (want 3); NAMED CONTROL/project_state.json tasks.counts on a file that parses (the live canary shape)"

  # --- case 4: malformed JSON is UNDETERMINED, never MISSING and never a pass.
  mk "$T/c4"; printf '%s\n' '{"step":4,' > "$T/c4/CONTROL/setup_progress.json"
  runb "$T/c4"
  ok=0
  if (( RC == 2 )) \
     && printf '%s' "$OUT" | "$GREP" -q '^BAR-CHECK result=UNDETERMINED ' \
     && printf '%s' "$OUT" | "$GREP" -q 'malformed=CONTROL/setup_progress.json ' \
     && printf '%s' "$OUT" | "$GREP" -q 'DOES NOT PARSE'; then ok=1; fi
  report 4 "malformed-json" "$ok" "rc=${RC} (want 2); result=UNDETERMINED naming the file — a file that cannot be read is never reported as absent"

  printf '\n%s\n' "-------------------------------------------------------------"
  printf 'bar-check.sh selftest: %s passed, %s failed\n' "$PASSES" "$FAILS"
  if (( FAILS > 0 )); then return 1; fi
  return 0
}

#==============================================================================
# ARGUMENT PARSING
#==============================================================================
while (( $# )); do
  case "$1" in
    --selftest) DO_SELFTEST=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    --*)        und "-" "unknown option: $1" ;;
    *)
      if [[ -z "$PROJECT" ]]; then PROJECT="$1"
      else und "-" "unexpected argument: $1"; fi
      shift ;;
  esac
done

if (( DO_SELFTEST )); then
  selftest
  exit $?
fi

set +e
check
RC=$?
set -e
exit $RC
