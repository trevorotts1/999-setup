#!/usr/bin/env bash
# state-check.sh — THE PROJECT-STATE BUDGET SCHEMA GATE (RC-3, wave 6).
#
# Usage:
#   state-check.sh <project>        # reads <project>/CONTROL/project_state.json
#   state-check.sh <state-file>     # or the state file itself
#   state-check.sh --selftest
#   state-check.sh --help
#
# WHAT IT IS FOR. SKILL.md section 6 computes four budget numbers and said only
# that they "are written to CONTROL/project_state.json" — it named no JSON key.
# Three writers and one reader then disagreed about where they live: a conductor
# invented agents.budget.{initial,warn,first_pause,ceiling}, renamed it to
# agents.project_budget.*, and tools/anchor.sh — which reads FLAT keys — first
# reported budget-negative-spend(claimed=-895) and then budget-undetermined for
# the rest of the run. BUDGET-PAUSE could never fire. This script is the reader
# that refuses any spelling but the canonical one, before the first dispatch.
#
# THE CANONICAL SCHEMA (references/documents.md "The budget block, in full";
# SKILL.md section 6). Five keys, INTEGERS, DIRECTLY under "agents":
#
#     agents.initial               = WF01 + units × 3 + 4
#     agents.warn_at               = max(150, 3 × initial)
#     agents.first_pause           = max(200, 4 × initial)
#     agents.pause_blocks_granted  = 0 at the first write, +1 per "keep going"
#     agents.ceiling               = 2000
#
# TWO AXES, NEVER MIXED. agents.budget_initial and agents.session_budget_remaining
# are the SEPARATE lifetime-agent axis (the operator's 1,000 per project). They
# are never given a project number: anchor.sh computes claimed spend as
# budget_initial − session_budget_remaining on that axis alone, so a project
# number written into either field makes the claimed spend negative and fires a
# FALSE budget-negative-spend alarm. This script therefore checks the PROJECT
# axis only, and never reads the lifetime pair as a substitute for it.
#
# EXIT CODES
#   0  PASS — all five project-axis keys are present directly under "agents"
#             with integer values. The line names every value it read.
#   2  TOOLING FAILURE / BROKEN INSTRUMENT — bad usage, the file is absent or
#             unreadable, the JSON does not parse, or the parser failed its own
#             known-positive control. NEVER a verdict about the state file: an
#             exit 2 is UNDETERMINED, said out loud, with the path named.
#             CONTROL/OPERATOR-OVERRIDE.json is refused here too, BY NAME and
#             before anything is parsed: the operator override is out of this
#             gate's scope, and it is never reported as a near-miss, a writer
#             defect or a missing budget block (WI-35; see "OUT OF SCOPE" by
#             resolve_state below).
#   3  MISSING — the file parses, no near-miss spelling is present, and one or
#             more of the five keys is absent (or present but not an integer).
#             Every missing key is named. This is "not written yet".
#   4  WRITER DEFECT — a NEAR-MISS spelling is present: an agents.project_budget
#             or agents.budget OBJECT, an agents.warn where agents.warn_at
#             belongs, or a first_pause nested anywhere other than directly
#             under agents. The key found is named. This is never reported as
#             absence: the numbers were computed and then written to the wrong
#             path, which is a defect in the WRITER, not a state file that was
#             never given to us.
#
# Exit 4 outranks exit 3 on purpose. A file carrying agents.project_budget.warn
# is missing agents.warn_at too, and calling that "missing" would send the
# conductor to write the number again — into the same wrong place.
#
# --selftest runs the five fixtures RC-3 names (canonical → 0; project_budget
# nesting → 4 naming project_budget; warn instead of warn_at → 4; no budget keys
# at all → 3; canonical with pause_blocks_granted=2 → 0, proving a legitimately
# advanced run is not rejected), behind a known-positive control on the JSON
# parser itself. A parser that fails its control reports BROKEN INSTRUMENT and
# no verdict below it is believed. --selftest exits 0 when every case passes and
# 1 when any fails.

set -uo pipefail

if [[ "${1:-}" != --* && -d "${1:-}" && -f "${1:-}/.spec-protocol.json" ]]; then
  printf 'STATE-CHECK PROFILE-OWNED | %s supplies canonical state through .spec-protocol.json; refusing legacy CONTROL mutation/check.\n' "$1" >&2
  exit 2
fi

# --- Instruments. Absolute where the doctrine requires it, proven in --selftest.
GREP="/usr/bin/grep"
if [[ ! -x "${GREP}" ]]; then
  if [[ -x /bin/grep ]]; then GREP="/bin/grep"; else GREP="$(command -v grep 2>/dev/null || true)"; fi
fi
AWK="/usr/bin/awk"
if [[ ! -x "${AWK}" ]]; then AWK="$(command -v awk 2>/dev/null || true)"; fi

SELF_SRC="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(cd "$(dirname "${SELF_SRC}")" && pwd)"
SELF="${SCRIPT_DIR}/$(basename "${SELF_SRC}")"

# The five canonical PROJECT-axis keys, in the order the ledger declares them.
CANON=(initial warn_at first_pause pause_blocks_granted ceiling)

die_tool() {
  printf 'state-check.sh: TOOLING FAILURE (exit 2): %s\n' "$*" >&2
  printf 'state-check.sh: this is NOT a pass and NOT a defect verdict. Nothing was determined.\n' >&2
  exit 2
}
die_instrument() {
  printf 'state-check.sh: BROKEN INSTRUMENT (exit 2): %s\n' "$*" >&2
  printf 'state-check.sh: the parser failed its own known-positive control, so no verdict below it can be believed.\n' >&2
  exit 2
}
usage() { sed -n '2,10p' "${SELF}"; }

#------------------------------------------------------------------------------
# THE PARSER. A recursive-descent JSON reader in awk that emits one line per
# node as `path<TAB>type<TAB>value`, so NESTING IS VISIBLE. A regex over the
# text cannot answer this question: anchor.sh's own jnum matches a quoted key at
# ANY depth, which is exactly why agents.project_budget.first_pause read as
# "present" to the reader that decides the pause. Paths are the point.
#
# It is deliberately dependency-free (no jq, no node, no python): this runs on a
# client's machine at step 16.6, before anything is dispatched.
#------------------------------------------------------------------------------
read -r -d '' JSON_FLATTEN <<'AWKEOF'
function jerr(msg) {
  printf("PARSE-ERROR\t%s\tat byte %d\n", msg, pos)
  bad = 1
  exit 1
}
function skipws(   ch) {
  while (pos <= len) {
    ch = substr(s, pos, 1)
    if (ch == " " || ch == "\t" || ch == "\n" || ch == "\r") pos++
    else return
  }
}
function pstring(   out, ch) {
  pos++                                   # the opening quote
  out = ""
  while (pos <= len) {
    ch = substr(s, pos, 1)
    if (ch == "\\") { out = out substr(s, pos, 2); pos += 2; continue }
    if (ch == "\"") { pos++; return out }
    out = out ch
    pos++
  }
  jerr("unterminated string")
}
function pvalue(path,   ch, key, idx, chunk, numlen) {
  skipws()
  if (pos > len) jerr("unexpected end of input")
  ch = substr(s, pos, 1)
  if (ch == "{") {
    print path "\tobject\t"
    pos++
    skipws()
    if (substr(s, pos, 1) == "}") { pos++; return }
    while (1) {
      skipws()
      if (substr(s, pos, 1) != "\"") jerr("expected a quoted key")
      key = pstring()
      skipws()
      if (substr(s, pos, 1) != ":") jerr("expected ':' after key " key)
      pos++
      pvalue(path == "" ? key : path "." key)
      skipws()
      ch = substr(s, pos, 1)
      if (ch == ",") { pos++; continue }
      if (ch == "}") { pos++; return }
      jerr("expected ',' or '}' in object")
    }
  }
  if (ch == "[") {
    print path "\tarray\t"
    pos++
    skipws()
    if (substr(s, pos, 1) == "]") { pos++; return }
    idx = 0
    while (1) {
      pvalue(path "[" idx "]")
      idx++
      skipws()
      ch = substr(s, pos, 1)
      if (ch == ",") { pos++; continue }
      if (ch == "]") { pos++; return }
      jerr("expected ',' or ']' in array")
    }
  }
  if (ch == "\"") { print path "\tstring\t" pstring(); return }
  if (substr(s, pos, 4) == "true")  { pos += 4; print path "\tbool\ttrue";  return }
  if (substr(s, pos, 5) == "false") { pos += 5; print path "\tbool\tfalse"; return }
  if (substr(s, pos, 4) == "null")  { pos += 4; print path "\tnull\t";      return }
  chunk = substr(s, pos, 48)
  if (match(chunk, /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/)) {
    numlen = RLENGTH
    print path "\tnumber\t" substr(s, pos, numlen)
    pos += numlen
    return
  }
  jerr("unexpected character '" ch "'")
}
BEGIN { pos = 1; bad = 0 }
{ s = s $0 "\n" }
END {
  if (bad) exit 1
  len = length(s)
  pvalue("")
  skipws()
  if (pos <= len) jerr("trailing content after the top-level value")
  print "PARSE-OK\t\t"
}
AWKEOF

FLAT=""
# flatten <file> — sets FLAT, or exits 2. LC_ALL=C so substr() walks BYTES: a
# multibyte locale makes the scan quadratic and can split an escape pair.
flatten() {
  local f="$1" out rc
  [[ -n "${AWK}" && -x "${AWK}" ]] || die_tool "no awk found (tried /usr/bin/awk then \$PATH)"
  [[ -e "$f" ]] || die_tool "no such file: ${f}"
  [[ -r "$f" ]] || die_tool "unreadable: ${f}"
  out="$(LC_ALL=C "${AWK}" "${JSON_FLATTEN}" "$f" 2>&1)"; rc=$?
  if (( rc != 0 )) || printf '%s\n' "$out" | "${GREP}" -q '^PARSE-ERROR'; then
    printf 'state-check.sh: INVALID JSON (exit 2): %s\n' "$f" >&2
    printf '%s\n' "$out" | "${GREP}" '^PARSE-ERROR' >&2 || true
    printf 'state-check.sh: the file could not be parsed, so NOTHING is claimed about its budget block.\n' >&2
    exit 2
  fi
  if ! printf '%s\n' "$out" | "${GREP}" -q '^PARSE-OK'; then
    die_instrument "the parser returned no PARSE-OK sentinel for ${f}"
  fi
  FLAT="$(printf '%s\n' "$out" | "${GREP}" -v '^PARSE-OK')"
  return 0
}

# f_field <path> <2|3> — the type or the value at an exact path, or nothing.
f_field() {
  printf '%s\n' "${FLAT}" | LC_ALL=C "${AWK}" -F '\t' -v p="$1" -v f="$2" '$1 == p { print $f; exit }'
}

#------------------------------------------------------------------------------
# THE VERDICT.
#------------------------------------------------------------------------------
check_state() {  # check_state <state-file> -> prints one verdict line, returns 0/3/4
  local f="$1"
  flatten "$f"

  # The instrument's own control, on THIS file: a parse that yielded no paths at
  # all is a broken read, never "the keys are missing".
  local paths
  paths="$(printf '%s\n' "${FLAT}" | "${GREP}" -c '.' || true)"
  [[ "${paths}" =~ ^[0-9]+$ ]] || paths=0
  if (( paths == 0 )); then
    die_instrument "${f} parsed with zero nodes; a state file cannot be empty and still be valid JSON here"
  fi

  # --- (1) NEAR-MISS FIRST. A wrong path is a WRITER DEFECT, never absence.
  local near=""
  local t
  t="$(f_field 'agents.project_budget' 2)"
  [[ -n "$t" ]] && near="${near} agents.project_budget(${t})"
  t="$(f_field 'agents.budget' 2)"
  [[ -n "$t" ]] && near="${near} agents.budget(${t})"
  t="$(f_field 'agents.warn' 2)"
  if [[ -n "$t" ]]; then near="${near} agents.warn(${t}; the schema spells it warn_at)"; fi
  local stray
  stray="$(printf '%s\n' "${FLAT}" | LC_ALL=C "${AWK}" -F '\t' \
    '$1 ~ /(^|\.)first_pause$/ && $1 != "agents.first_pause" { printf "%s ", $1 }')"
  if [[ -n "${stray// /}" ]]; then near="${near} ${stray}(first_pause not directly under agents)"; fi

  if [[ -n "${near// /}" ]]; then
    printf 'STATE-CHECK | WRITER DEFECT | %s | found:%s\n' "$f" "${near}"
    printf 'STATE-CHECK | the budget numbers were computed and written to a path no reader reads.\n'
    printf 'STATE-CHECK | the canonical paths are agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted, agents.ceiling — all integers, all DIRECTLY under "agents" (SKILL.md section 6).\n'
    printf 'STATE-CHECK | agents.budget_initial and agents.session_budget_remaining are the SEPARATE lifetime-agent axis and are never given a project number.\n'
    return 4
  fi

  # --- (2) the five canonical keys, as integers.
  local missing="" ok_note="" k ty va
  for k in "${CANON[@]}"; do
    ty="$(f_field "agents.${k}" 2)"
    va="$(f_field "agents.${k}" 3)"
    if [[ -z "$ty" ]]; then
      missing="${missing} agents.${k}(absent)"
    elif [[ "$ty" != "number" ]]; then
      missing="${missing} agents.${k}(${ty}, not an integer)"
    elif [[ ! "$va" =~ ^-?[0-9]+$ ]]; then
      missing="${missing} agents.${k}(${va}, not an integer)"
    else
      ok_note="${ok_note} ${k}=${va}"
    fi
  done

  if [[ -n "${missing// /}" ]]; then
    printf 'STATE-CHECK | MISSING | %s | missing:%s\n' "$f" "${missing}"
    printf 'STATE-CHECK | no near-miss spelling was found, so this is a budget block that has not been written yet, not one written to the wrong path.\n'
    printf 'STATE-CHECK | write all five before the first dispatch: agents.initial, agents.warn_at, agents.first_pause, agents.pause_blocks_granted (0), agents.ceiling (2000).\n'
    return 3
  fi

  printf 'STATE-CHECK | PASS | %s |%s\n' "$f" "${ok_note}"
  return 0
}

resolve_state() {  # resolve_state <arg> -> prints the state file path
  local a="$1"
  if [[ -d "$a" ]]; then printf '%s\n' "${a%/}/CONTROL/project_state.json"; return 0; fi
  printf '%s\n' "$a"
}

profile_root_for() {  # profile_root_for <project-or-path> -> profile root, if any
  local d="$1" n=0
  [[ -d "$d" ]] || d="$(dirname "$d")"
  d="$(cd "$d" 2>/dev/null && pwd)" || return 1
  while (( n <= 40 )); do
    [[ -f "$d/.spec-protocol.json" ]] && { printf '%s\n' "$d"; return 0; }
    [[ "$(dirname "$d")" != "$d" ]] || return 1
    d="$(dirname "$d")"; n=$(( n + 1 ))
  done
  return 1
}

# CONTROL/OPERATOR-OVERRIDE.json IS OUT OF SCOPE FOR THIS INSTRUMENT (WI-35).
#
# It is the operator's own file, not a state file: a flat object whose only
# honoured key is first_pause, read by tools/anchor.sh and tools/dispatch-check.sh
# BEFORE CONTROL/project_state.json and outranking it. Handed to the checker it
# would flatten to a bare `first_pause` path, which the stray-key probe above
# reads as "first_pause not directly under agents" — and this gate would report
# the operator's override as a WRITER DEFECT, exactly the misclassification the
# canary run made when it reverted the injected pause line as a defect
# (canary-notes.md:63-68).
#
# So it is refused BY NAME, before anything is parsed, and refused as exit 2:
# UNDETERMINED, never a verdict. It is never exit 4 and never exit 3, because
# this instrument has nothing to say about a file it does not own. A project
# directory is unaffected — resolve_state above reads CONTROL/project_state.json
# and never looks at its neighbours — so a project carrying an override still
# passes on its state file alone.
OVERRIDE_BASENAME="OPERATOR-OVERRIDE.json"
refuse_out_of_scope() {  # refuse_out_of_scope <path>
  printf 'state-check.sh: OUT OF SCOPE (exit 2): %s\n' "$1" >&2
  printf 'state-check.sh: CONTROL/OPERATOR-OVERRIDE.json is the OPERATOR OVERRIDE, not a project state file. It is read-only for every agent (references/pipeline.md, the scope fence), no audit finding may propose changing or removing it, and this gate makes NO claim about it — it is not a near-miss, not a writer defect, and not missing keys.\n' >&2
  printf 'state-check.sh: to check the budget block, point this script at the project folder or at CONTROL/project_state.json.\n' >&2
  exit 2
}

#==============================================================================
# SELFTEST — the five fixtures RC-3 names, behind a known-positive control on
# the parser. Every case asserts both the exit code and what the line must say,
# and case 1 and case 5 are the negative controls that prove the gate can stay
# quiet on a correct file (a checker that fails everything is not a checker).
#==============================================================================
selftest() {
  local T PASSES=0 FAILS=0 RC OUT ok
  T="$(mktemp -d "${TMPDIR:-/tmp}/state-check-selftest.XXXXXX")" || {
    printf 'state-check.sh: BROKEN INSTRUMENT (exit 2): cannot create a temp dir\n' >&2; exit 2; }
  # shellcheck disable=SC2064
  trap "rm -rf '${T}'" EXIT

  report() {  # report <n> <name> <ok:0/1> <detail>
    if (( $3 == 1 )); then
      printf 'PASS | case %s | %s | %s\n' "$1" "$2" "$4"; PASSES=$(( PASSES + 1 ))
    else
      printf 'FAIL | case %s | %s | %s\n' "$1" "$2" "$4"; FAILS=$(( FAILS + 1 ))
    fi
  }
  runf() {  # runf <file-or-dir> -> sets RC and OUT
    OUT="$(bash "${SELF}" "$1" 2>&1)"; RC=$?
  }

  # --- case 0: THE PARSER'S KNOWN-POSITIVE CONTROL, before any verdict.
  #     A nested key and a flat key of the same name must come back as DIFFERENT
  #     paths — the single fact every case below depends on.
  printf '{"agents":{"first_pause":200,"project_budget":{"first_pause":9}},"x":[1,{"y":"z"}]}\n' > "${T}/ctl.json"
  flatten "${T}/ctl.json"
  local c_flat c_nest c_arr c_str
  c_flat="$(f_field 'agents.first_pause' 3)"
  c_nest="$(f_field 'agents.project_budget.first_pause' 3)"
  c_arr="$(f_field 'x[1].y' 3)"
  c_str="$(f_field 'agents.project_budget' 2)"
  if [[ "${c_flat}" != "200" || "${c_nest}" != "9" || "${c_arr}" != "z" || "${c_str}" != "object" ]]; then
    die_instrument "the parser's known-positive control failed: agents.first_pause=${c_flat} (want 200), agents.project_budget.first_pause=${c_nest} (want 9), x[1].y=${c_arr} (want z), agents.project_budget type=${c_str} (want object)"
  fi
  # The other half of the control: broken JSON must be REFUSED, not parsed.
  printf '{"agents":{"initial":41,}\n' > "${T}/bad.json"
  runf "${T}/bad.json"
  if (( RC != 2 )); then
    die_instrument "invalid JSON returned rc=${RC} (want 2); the parser accepts garbage, so no verdict can be believed"
  fi
  report 0 "parser-control" 1 "nested and flat first_pause resolve to DIFFERENT paths (200 vs 9); array and string paths resolve; invalid JSON exits 2"

  # --- case 1: the CANONICAL file. Must PASS (the negative control).
  mkdir -p "${T}/c1/CONTROL"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","agents":{"executions_total":12,"budget_initial":1000,"session_budget_remaining":988,"initial":41,"warn_at":150,"first_pause":200,"pause_blocks_granted":0,"ceiling":2000}}\n' > "${T}/c1/CONTROL/project_state.json"
  runf "${T}/c1"
  ok=0
  if (( RC == 0 )) && printf '%s' "${OUT}" | "${GREP}" -q 'STATE-CHECK | PASS' \
     && printf '%s' "${OUT}" | "${GREP}" -q 'first_pause=200'; then ok=1; fi
  report 1 "canonical-passes" "${ok}" "rc=${RC} (want 0); the line names every value it read"

  # --- case 2: agents.project_budget.first_pause, the flat keys ABSENT. This
  #     is the live canary shape. Must be WRITER DEFECT (4) and NAME the key —
  #     never "missing", which would send the conductor to rewrite it in place.
  mkdir -p "${T}/c2/CONTROL"
  printf '{"schema":"spec-protocol/project-state@1","agents":{"session_budget_remaining":936,"executions_total":72,"session_budget_total":1000,"project_budget":{"initial":41,"warn":150,"first_pause":200,"ceiling":2000}}}\n' > "${T}/c2/CONTROL/project_state.json"
  runf "${T}/c2"
  ok=0
  if (( RC == 4 )) && printf '%s' "${OUT}" | "${GREP}" -q 'WRITER DEFECT' \
     && printf '%s' "${OUT}" | "${GREP}" -q 'project_budget' \
     && ! printf '%s' "${OUT}" | "${GREP}" -q 'MISSING'; then ok=1; fi
  report 2 "project-budget-nesting" "${ok}" "rc=${RC} (want 4); names project_budget; NOT reported as MISSING"

  # --- case 3: `warn` where `warn_at` belongs. SKILL.md's arithmetic calls the
  #     quantity `warn`, so this is the misspelling the prose itself invites.
  mkdir -p "${T}/c3/CONTROL"
  printf '{"agents":{"executions_total":3,"initial":41,"warn":150,"first_pause":200,"pause_blocks_granted":0,"ceiling":2000}}\n' > "${T}/c3/CONTROL/project_state.json"
  runf "${T}/c3"
  ok=0
  if (( RC == 4 )) && printf '%s' "${OUT}" | "${GREP}" -q 'WRITER DEFECT' \
     && printf '%s' "${OUT}" | "${GREP}" -q 'agents.warn'; then ok=1; fi
  report 3 "warn-not-warn_at" "${ok}" "rc=${RC} (want 4); names agents.warn and the spelling the schema uses"

  # --- case 4: NO budget keys at all. Must be MISSING (3), naming all five —
  #     and must NOT be a writer defect: nothing was written to a wrong path.
  mkdir -p "${T}/c4/CONTROL"
  printf '{"schema":"spec-protocol/project-state@1","run_status":"RUNNING","agents":{"executions_total":0}}\n' > "${T}/c4/CONTROL/project_state.json"
  runf "${T}/c4"
  ok=0
  if (( RC == 3 )) && printf '%s' "${OUT}" | "${GREP}" -q 'MISSING' \
     && ! printf '%s' "${OUT}" | "${GREP}" -q 'WRITER DEFECT'; then ok=1; fi
  local named=1 k
  for k in "${CANON[@]}"; do
    printf '%s' "${OUT}" | "${GREP}" -q "agents.${k}(absent)" || named=0
  done
  (( named == 1 )) || ok=0
  report 4 "no-budget-keys" "${ok}" "rc=${RC} (want 3); all five keys named as absent=${named}; not a writer defect"

  # --- case 5: canonical with pause_blocks_granted=2 — a run that has been told
  #     "keep going" twice. Must PASS: the validator checks the SCHEMA, never
  #     how far the run has got.
  mkdir -p "${T}/c5/CONTROL"
  printf '{"agents":{"executions_total":420,"initial":41,"warn_at":150,"first_pause":200,"pause_blocks_granted":2,"ceiling":2000}}\n' > "${T}/c5/CONTROL/project_state.json"
  runf "${T}/c5"
  ok=0
  if (( RC == 0 )) && printf '%s' "${OUT}" | "${GREP}" -q 'pause_blocks_granted=2'; then ok=1; fi
  report 5 "advanced-run-passes" "${ok}" "rc=${RC} (want 0); a granted block is not a schema fault"

  # --- case 6: THE OPERATOR OVERRIDE IS OUT OF SCOPE (WI-35). Two legs on one
  #     project, and both matter:
  #       a  a canonical state file with CONTROL/OPERATOR-OVERRIDE.json sitting
  #          beside it still PASSES, and the verdict never mentions the override
  #          — the checker reads its own file and does not inventory the folder;
  #       b  handed the override file DIRECTLY, it refuses as OUT OF SCOPE with
  #          rc 2 and never rc 4. Leg (b) is the one that would fail loudest if
  #          it were missing: the override flattens to a bare `first_pause`, so
  #          the stray-key probe would call the operator's own file a WRITER
  #          DEFECT — the same misclassification the canary made when it
  #          reverted the injected pause line as a defect.
  mkdir -p "${T}/c6/CONTROL"
  printf '{"schema":"spec-protocol/project-state@1","agents":{"executions_total":20,"initial":41,"warn_at":150,"first_pause":200,"pause_blocks_granted":0,"ceiling":2000}}\n' > "${T}/c6/CONTROL/project_state.json"
  printf '{"first_pause": 20, "set_by": "operator", "reason": "canary proof D"}\n' > "${T}/c6/CONTROL/OPERATOR-OVERRIDE.json"
  runf "${T}/c6"
  local ov_a=0 ov_b=0 rc_a="${RC}" out_a="${OUT}"
  if (( RC == 0 )) && printf '%s' "${OUT}" | "${GREP}" -q 'PASS' \
     && ! printf '%s' "${OUT}" | "${GREP}" -q 'OPERATOR-OVERRIDE'; then ov_a=1; fi
  runf "${T}/c6/CONTROL/OPERATOR-OVERRIDE.json"
  if (( RC == 2 )) && printf '%s' "${OUT}" | "${GREP}" -q 'OUT OF SCOPE' \
     && ! printf '%s' "${OUT}" | "${GREP}" -q 'WRITER DEFECT'; then ov_b=1; fi
  ok=0; (( ov_a == 1 && ov_b == 1 )) && ok=1
  report 6 "operator-override-out-of-scope" "${ok}" "project carrying CONTROL/OPERATOR-OVERRIDE.json beside a canonical state file: rc=${rc_a} (want 0), PASS with no mention of the override=${ov_a}. The override file handed in directly: rc=${RC} (want 2, OUT OF SCOPE), and NEVER exit 4 WRITER DEFECT=${ov_b} — this gate makes no claim about a file it does not own."

  printf 'SELFTEST COMPLETE | %s of 7 cases passed | %s failed\n' "${PASSES}" "${FAILS}"
  if (( FAILS > 0 )); then return 1; fi
  return 0
}

#------------------------------------------------------------------------------
# MAIN
#------------------------------------------------------------------------------
if (( $# == 0 )); then
  usage >&2
  die_tool "no argument: name a project folder or a project_state.json"
fi
case "$1" in
  --help|-h) usage; exit 0 ;;
  --selftest) selftest; exit $? ;;
esac

if PROFILE_ROOT="$(profile_root_for "$1")"; then
  printf 'STATE-CHECK PROFILE-OWNED | %s has a profile-bound canonical state; invoke its declared validate command, not this legacy CONTROL checker.\n' "$PROFILE_ROOT" >&2
  exit 2
fi

STATE_FILE="$(resolve_state "$1")"
# The operator override is refused by name, before the parser runs: this gate
# owns CONTROL/project_state.json and claims nothing about any other file.
if [[ "$(basename "${STATE_FILE}")" == "${OVERRIDE_BASENAME}" ]]; then
  refuse_out_of_scope "${STATE_FILE}"
fi
check_state "${STATE_FILE}"
exit $?
