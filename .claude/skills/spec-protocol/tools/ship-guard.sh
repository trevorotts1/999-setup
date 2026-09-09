#!/usr/bin/env bash
# ship-guard.sh — the enforcing script for the two guards STAGE-SHIP-CHECKS and
# STAGE-PUBLISH gained after a canary run shipped a form pointed at the machine
# owner's inbox and moved its own evidence tree inside the deploy root.
#
# It answers two questions no other instrument in references/ship-checks.md can:
#
#   1. OWNERSHIP — does every declared form destination belong to the CLIENT?
#      Instrument 6 proves a submission ARRIVES. Arrival at the wrong person's
#      mailbox is still an arrival, so instrument 6 passes it. Ownership is
#      declared on the FORM-DESTINATION ledger line and checked HERE, at the
#      stage gate, before the form is built — never at publish, by which time
#      the form is wired to a real inbox.
#      (references/ship-checks.md section 3)
#
#   2. PUBLIC SURFACE — does the LIVE origin serve any internal path?
#      Instrument 3's field 6 proves a deliberately ABSENT path returns 404,
#      which is the opposite question. Nothing asked what the PRESENT internal
#      paths return. A submit-proof .har (a form key plus one real name, email
#      and message), a blind-pack answer key, or an internal spec served at a
#      public address is the failure this sweep exists to catch.
#      (references/ship-checks.md 2.5, instrument 11)
#
#   3. FABRICATION-GUARD — does any built page attribute something to a real
#      third party who never agreed to it? The content-truth rule lets a page
#      carry a DRAFTED fact, which is right for the client's OWN words and
#      wrong for a stranger's: a drafted testimonial is an invented person.
#      references/build.md section 6 OWNS the class list and its one-sentence
#      reason; this tool carries only that list's machine keys and never
#      restates it. A guarded fact rendered by a built page whose
#      00-INPUT/CONTENT.md entry is not SOURCED fails here, named with its
#      page, and one line goes to CONTROL/LEDGER.md through tools/ledger.sh.
#      A missing CONTENT.md is the CHECK'S OWN failure and blocks the same
#      way — an absent file proves nothing about the page.
#      (references/build.md section 6, references/interview.md section 3)
#
# USAGE
#   ship-guard.sh <project> <origin> [deploy-root]
#       <project>     the project home — the directory holding CONTROL/LEDGER.md
#       <origin>      the LIVE origin to sweep, e.g. https://example.com
#                     (a trailing slash is fine; the path part is ignored)
#       [deploy-root] optional: the directory whose contents the origin serves.
#                     Defaults to <project>. Give it when the built site lives
#                     in a subdirectory (repos/<name>/, dist/, out/ ...), so the
#                     "any *.har / any ANSWER-KEY*" classes are enumerated from
#                     the real deploy root and fetched by their real URL paths.
#   ship-guard.sh --selftest    prove the instrument against fixtures, then exit
#   ship-guard.sh --paths       print the standing path list and exit 0
#   ship-guard.sh --help
#
# WHAT IT NEVER PRINTS
#   The destination DETAIL — the mailbox, the GHL location id, the Supabase
#   project, any key found beside them — is never echoed, never written to the
#   report, and never copied anywhere. The tool prints the form name, the
#   destination TYPE and the owner. That is enough to name the defect and not
#   enough to republish the thing that made it a defect.
#
# OUTPUT
#   Human lines on stdout, and one JSON report at
#   <project>/ship-checks/public-surface.json carrying the origin, the control
#   request that proved the origin answers at all, one row per fetched path
#   (path, url, status, verdict), one row per form destination
#   (form, type, owner, verdict) and one fabrication_guard block (the content
#   inventory it read, the four counts, and one row per guarded fact). The
#   FABRICATION-GUARD counts also go to <project>/CONTROL/LEDGER.md as
#   `FABRICATION-GUARD: facts=<n> sourced=<n> omitted=<n> unsourced=<n>`,
#   written through tools/ledger.sh. `unsourced` must be 0.
#
# EXIT CODES
#   0 — CLEAN. Every declared destination is owned by the client, and every
#       internal path answered 404 or 403.
#   2 — UNDETERMINED. The sweep could not be performed: the origin could not be
#       reached (proved by a FAILED CONNECTION ATTEMPT, named in the output with
#       curl's own exit status and message — never inferred from a file), the
#       ledger could not be read, or the report could not be written. An
#       undetermined sweep is NEVER reported as clean.
#   3 — EXPOSED. At least one internal path answered something other than 404 or
#       403. Every such path is named with the status it returned.
#   4 — FOREIGN DESTINATION. At least one FORM-DESTINATION is not owned by the
#       client (owner=operator, an unrecognised owner, a missing owner field, or
#       a line too malformed to parse — none of which is proof of client
#       ownership).
#   5 — FABRICATED. At least one FABRICATION-GUARD fact is rendered by a built
#       page while its 00-INPUT/CONTENT.md entry is not SOURCED, or carries
#       there the one state that class may never carry, `DRAFT — write one`.
#       Every one is named with its fact key, its page and the state found.
#   1 — usage error.
#
#   PRECEDENCE, stated so it is never a surprise: a live 200 is public harm
#   happening now, so 3 outranks 5 and 4 when they are all true (each is
#   printed either way). Ownership and fabrication are LOCAL facts that an
#   unreachable origin cannot erase, so 5 and 4 both outrank 2 — an unreachable
#   origin never downgrades a defect the tool already proved. Between the two
#   local defects 5 outranks 4: a substitute inbox misroutes the client's own
#   mail, an invented testimonial puts words in a stranger's mouth.
#
# SELFTEST — seven fixtures against a server this script starts and stops
#   itself: clean origin -> 0 | origin serving .har files -> 3 |
#   owner=operator -> 4 | unreachable origin -> 2 | a page rendering a
#   testimonial whose CONTENT.md entry reads SOURCED -> 0 | THE DISCRIMINATING
#   CASE, the same page whose entry reads `DRAFT — write one` -> 5, naming both
#   the fact and the page | the same page with NO CONTENT.md at all -> non-zero,
#   never 0 by default. Two PAIRED CONTROLS: clean vs .har, and SOURCED vs
#   DRAFT. If either pair returns the same code the TEST is broken, not the
#   target, and the selftest says so and fails. It also greps the SOURCED
#   fixture's own CONTROL/LEDGER.md for the FABRICATION-GUARD line shape, so
#   the ledger contract is proved rather than assumed. Set
#   SHIP_GUARD_SELFTEST_DIR=<dir> to keep the fixture tree, and its ledger, for
#   inspection instead of deleting it.
set -u

TIMEOUT="${SHIP_GUARD_TIMEOUT:-15}"
MAX_DERIVED="${SHIP_GUARD_MAX_DERIVED:-50}"
MAX_PAGES="${SHIP_GUARD_MAX_PAGES:-200}"

# This script's own directory, so tools/ledger.sh is found however we were run.
SELF_DIR="$(cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd)"
[ -n "${SELF_DIR}" ] || SELF_DIR="."

# A grep that is certainly a grep, for the counting the selftest does of its
# own ledger. An empty result is never read as "no match" — see below.
SGREP="/usr/bin/grep"
[ -x "${SGREP}" ] || SGREP="$(command -v grep 2>/dev/null || true)"

# FABRICATION-GUARD counts, initialised HERE because undetermined() consults
# FAB_UNSOURCED to keep the 5-outranks-2 precedence even when a later stage of
# the sweep cannot run.
FAB_FACTS=0
FAB_SOURCED=0
FAB_OMITTED=0
FAB_UNSOURCED=0
FAB_ROWS=""

# The standing path list — the classes references/ship-checks.md 2.5 names.
# Directories are fetched as directories; the two glob classes are fetched both
# as these standing probes AND as every real matching file under the deploy root.
STANDING_PATHS='captures/
ship-checks/
SPEC/
QUALITY-CONTROL/
captures/submit-proof.har
ANSWER-KEY.md
QUALITY-CONTROL/ANSWER-KEY.md'

say()  { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }

usage() {
  sed -n '2,109p' "$0" | sed 's/^# \{0,1\}//'
}

undetermined() { # undetermined <reason-line> [extra lines...]
  # PRECEDENCE: a fabricated third-party attribution is a LOCAL fact, already
  # proved from 00-INPUT/CONTENT.md and the built pages. A later stage of the
  # sweep that cannot run does not erase it, so 5 outranks 2 here.
  if [ "${FAB_UNSOURCED:-0}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=FABRICATED | unsourced=${FAB_UNSOURCED} | sweep-stopped=$1"
    say "  The rest of the sweep could not run, which does not un-prove the fabricated"
    say "  facts named above. FABRICATED is not a pass either."
    exit 5
  fi
  say "SHIP-GUARD | verdict=UNDETERMINED | reason=$1"
  shift || true
  while [ "$#" -gt 0 ]; do say "  $1"; shift; done
  say "  UNDETERMINED is not a pass. Nothing about this origin has been proved clean."
  exit 2
}

json_escape() { # json_escape <string>
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# ---------------------------------------------------------------- ownership --

# parse_destinations <ledger-file>
# Prints one row per FORM-DESTINATION line: <form>|<type>|<owner>|<verdict>
# The destination detail is deliberately reduced to a TYPE and dropped.
parse_destinations() {
  local ledger="$1" line rest form after destword type owner verdict
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      *FORM-DESTINATION:*) ;;
      *) continue ;;
    esac
    rest="${line#*FORM-DESTINATION:}"
    rest="$(printf '%s' "${rest}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

    owner="$(printf '%s' "${rest}" | sed -n 's/.*owner=\([A-Za-z_][A-Za-z_-]*\).*/\1/p' | head -1)"
    [ -z "${owner}" ] && owner="(absent)"

    case "${rest}" in
      *=*)
        form="$(printf '%s' "${rest%%=*}" | sed -e 's/[[:space:]]*$//')"
        after="${rest#*=}"
        destword="$(printf '%s' "${after}" | awk '{print $1}')"
        ;;
      *)
        form="$(printf '%s' "${rest}" | awk '{print $1}')"
        destword=""
        ;;
    esac
    [ -z "${form}" ] && form="(unnamed)"

    case "${destword}" in
      BLOCKED*)            type="BLOCKED" ;;
      GHL*|ghl*)           type="GHL" ;;
      email*|Email*|EMAIL*) type="email" ;;
      Supabase*|supabase*) type="Supabase" ;;
      "")                  type="unparsed" ;;
      *)                   type="other" ;;
    esac

    if [ "${type}" = "unparsed" ]; then
      # A line too malformed to carry a destination is not proof of anything.
      verdict="FOREIGN"
    elif [ "${owner}" = "client" ]; then
      verdict="OK"
    else
      verdict="FOREIGN"
    fi
    printf '%s|%s|%s|%s\n' "${form}" "${type}" "${owner}" "${verdict}"
  done < "${ledger}"
}

# ------------------------------------------------------- fabrication-guard --
#
# references/build.md section 6 OWNS the FABRICATION-GUARD class list and the
# one sentence that says why those facts are a class at all. That prose lives
# THERE, once, and is deliberately not repeated here: what follows is only its
# machine form, one key per named fact, and build.md is the authority if the two
# ever drift. Each row is `key ~ entry-regex ~ page-regex`, tilde-separated
# because the regexes are full of pipes:
#
#   entry-regex — matched (case-insensitively) against a 00-INPUT/CONTENT.md
#                 heading, to find that fact's entry and read its state.
#   page-regex  — matched (case-insensitively) against a built page, to decide
#                 whether the page RENDERS that fact.
#
# A state is one of SOURCED, OMIT, DRAFT, NO-STATE (an entry with no marker) or
# ABSENT (no entry at all). Only SOURCED licenses a page to render the fact.
FAB_CLASSES='testimonial~testimonial|customer quote|client quote|(^|[^[:alpha:]])reviews?([^[:alpha:]]|$)~testimonial|<blockquote|customers say|clients say|reviews?-(section|list|card)
testimonial-credit~testimonial|credited|attribution|quoted by|reviewer|customer name~<cite[ >/]|testimonial-(author|name|credit)|quote-(author|attribution)|review-author
star-rating~star.?rating|(^|[^[:alpha:]])stars?([^[:alpha:]]|$)|(^|[^[:alpha:]])ratings?([^[:alpha:]]|$)~star.?rating|class="[^"]*star|&#9733;|&#x2605;|&starf;|[0-9](\.[0-9])? ?(out of|/) ?5
review-count~review.?count|number of reviews|how many reviews~[0-9][0-9,]*\+? ?(reviews|ratings)|review.?count
named-customer~named customer|customer list|customers we|clients we|who we work with|case study~trusted by|our (customers|clients) include|customer-logos|case-study-client
award~award~award
certification~certifi|accredit|licen[cs]ed by~certified|certification|accredited
press-quote~press|as seen in|as featured in|media mention~as (seen|featured) in|in the press|press-(quote|mention)
client-logo~client.?logos?|partner.?logos?|logo.?(wall|cloud|strip)~client.?logos?|partner.?logos?|logo.?(wall|cloud|strip)|as-seen-in
staff-identity~staff|team member|(^|[^[:alpha:]])team([^[:alpha:]]|$)|employee|headshot~meet (the|our) (team|owner|staff)|our-team|team-member|staff-(photo|name)|headshot'

# fab_token <line> — prints SOURCED, OMIT or DRAFT if the line carries one of
# those markers, and nothing otherwise. The markers are uppercase in the
# CONTENT.md schema (references/documents.md), so the match is case-sensitive:
# a sentence about "a draft" is not a state.
fab_token() {
  case "$1" in
    *SOURCED*) printf 'SOURCED'; return 0 ;;
  esac
  if printf '%s' "$1" | grep -Eq '(^|[^A-Za-z])OMIT([^A-Za-z]|$)'; then printf 'OMIT'; return 0; fi
  if printf '%s' "$1" | grep -Eq '(^|[^A-Za-z])DRAFT([^A-Za-z]|$)'; then printf 'DRAFT'; return 0; fi
  return 0
}

# fab_entries <content-file> — one pass over 00-INPUT/CONTENT.md, printing one
# `<heading><TAB><state>` row per heading. The state is the first marker found
# on the heading line itself or anywhere in its block.
fab_entries() {
  local file="$1" line trimmed heading="" state="" tok
  while IFS= read -r line || [ -n "${line}" ]; do
    trimmed="$(printf '%s' "${line}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "${trimmed}" ] && continue
    case "${trimmed}" in
      '#'*)
        if [ -n "${heading}" ]; then printf '%s\t%s\n' "${heading}" "${state:-NO-STATE}"; fi
        heading="$(printf '%s' "${trimmed}" | sed -e 's/^#*[[:space:]]*//')"
        state="$(fab_token "${trimmed}")"
        ;;
      *)
        [ -n "${heading}" ] || continue
        [ -n "${state}" ] && continue
        state="$(fab_token "${trimmed}")"
        ;;
    esac
  done < "${file}"
  if [ -n "${heading}" ]; then printf '%s\t%s\n' "${heading}" "${state:-NO-STATE}"; fi
  return 0
}

# fab_state_of <entries> <entry-regex> — the state of the first entry whose
# heading matches, or ABSENT. ABSENT is never a pass: it is exactly the case
# where a page renders a fact nobody ever supplied.
fab_state_of() {
  local entries="$1" ere="$2" h st
  while IFS="$(printf '\t')" read -r h st; do
    [ -z "${h}" ] && continue
    if printf '%s' "${h}" | grep -Eiq -- "${ere}"; then printf '%s' "${st}"; return 0; fi
  done <<EOF
${entries}
EOF
  printf 'ABSENT'
  return 0
}

# fab_pages <deploy-root> — every built page under the deploy root. captures/
# and QUALITY-CONTROL/ are pruned: references/documents.md calls those the
# evidence and ticket trees, and neither is a page the client's readers see
# (a page served FROM them is instrument 11's defect, not this one's).
fab_pages() {
  local root="$1"
  [ -d "${root}" ] || return 0
  find "${root}" \( -name .git -o -name node_modules -o -name captures -o -name QUALITY-CONTROL \) -prune -o \
       -type f \( -name '*.html' -o -name '*.htm' \) -print 2>/dev/null \
    | head -n "${MAX_PAGES}"
  return 0
}

# fab_rendered <pagelist> <page-regex> — the first page that renders the fact,
# or nothing.
fab_rendered() {
  local pages="$1" ere="$2" pg
  while IFS= read -r pg; do
    [ -z "${pg}" ] && continue
    if LC_ALL=C grep -Eiq -- "${ere}" "${pg}" 2>/dev/null; then printf '%s' "${pg}"; return 0; fi
  done <<EOF
${pages}
EOF
  return 0
}

# run_fabrication_guard <project> <deploy-root>
# Sets FAB_FACTS / FAB_SOURCED / FAB_OMITTED / FAB_UNSOURCED / FAB_ROWS, prints
# one human line per guarded fact in scope, and writes the ledger line. It is a
# LOCAL check: it needs no origin, so it runs before the network sweep and its
# verdict survives an origin that cannot be reached.
run_fabrication_guard() {
  local project="$1" root="$2"
  local content="${project}/00-INPUT/CONTENT.md"
  say "-- FABRICATION-GUARD (references/build.md section 6 owns the class list) --"
  if [ ! -r "${content}" ]; then
    say "  the content inventory could not be read: ${content}"
    say "  This is the CHECK'S OWN failure and it blocks exactly as an unsourced fact does."
    undetermined "content-inventory-unreadable" \
      "expected the client's own facts at: ${content}" \
      "An absent file proves nothing about the page — the same argument references/build.md" \
      "section 6 already makes for CONTENT-TRUTH. A page is not cleared by a missing inventory."
  fi

  local entries pages n_pages key ere pre state page verdict
  entries="$(fab_entries "${content}")"
  pages="$(fab_pages "${root}")"
  n_pages="$(printf '%s\n' "${pages}" | sed '/^$/d' | wc -l | tr -d ' ')"
  say "  content-inventory | ${content}"
  say "  built pages read  | ${n_pages} under ${root}"

  while IFS='~' read -r key ere pre; do
    [ -z "${key}" ] && continue
    state="$(fab_state_of "${entries}" "${ere}")"
    page="$(fab_rendered "${pages}" "${pre}")"
    verdict=""
    if [ -n "${page}" ] && [ "${state}" != "SOURCED" ]; then
      FAB_UNSOURCED=$((FAB_UNSOURCED + 1))
      verdict="UNSOURCED"
      say "  FABRICATED | fact=${key} | page=${page} | CONTENT.md=${state} — only SOURCED lets a page carry this"
    elif [ "${state}" = "DRAFT" ]; then
      # Illegal on its own: this class may carry SOURCED or OMIT and nothing else.
      FAB_UNSOURCED=$((FAB_UNSOURCED + 1))
      verdict="UNSOURCED"
      page="(not rendered)"
      say "  FABRICATED | fact=${key} | page=(not rendered) | CONTENT.md=DRAFT — this class may never be drafted"
    elif [ "${state}" = "SOURCED" ]; then
      FAB_SOURCED=$((FAB_SOURCED + 1))
      verdict="SOURCED"
      say "  sourced    | fact=${key} | page=${page:-(not rendered)}"
    elif [ "${state}" = "OMIT" ]; then
      FAB_OMITTED=$((FAB_OMITTED + 1))
      verdict="OMITTED"
      page="(left off on purpose)"
      say "  omitted    | fact=${key} | left off the page on purpose — a PASS, not a gap"
    else
      continue
    fi
    FAB_ROWS="${FAB_ROWS}    {\"fact\": \"$(json_escape "${key}")\", \"page\": \"$(json_escape "${page}")\", \"state\": \"${state}\", \"verdict\": \"${verdict}\"},
"
  done <<EOF
${FAB_CLASSES}
EOF

  FAB_FACTS=$((FAB_SOURCED + FAB_OMITTED + FAB_UNSOURCED))
  if [ "${FAB_FACTS}" -eq 0 ]; then
    say "  (no FABRICATION-GUARD fact is claimed in the inventory or rendered by a page)"
  fi

  # The ledger line. An instrument that cannot write its record is not a pass,
  # exactly as the JSON report below is not optional.
  local fabline="FABRICATION-GUARD: facts=${FAB_FACTS} sourced=${FAB_SOURCED} omitted=${FAB_OMITTED} unsourced=${FAB_UNSOURCED}"
  if [ -r "${SELF_DIR}/ledger.sh" ]; then
    if bash "${SELF_DIR}/ledger.sh" "${project}" "CONTROL/LEDGER.md" "${fabline}" >/dev/null 2>&1; then
      say "  ledger     | ${fabline}"
    else
      say "  ledger     | the write FAILED, so this line was never recorded: ${fabline}"
      undetermined "fabrication-ledger-unwritable" \
        "tools/ledger.sh could not append to ${project}/CONTROL/LEDGER.md" \
        "An unrecorded count is not a proved count."
    fi
  else
    say "  ledger     | tools/ledger.sh not found beside this script (${SELF_DIR})"
    undetermined "ledger-tool-missing" \
      "expected the write primitive at: ${SELF_DIR}/ledger.sh" \
      "The FABRICATION-GUARD line has one writer and this tool cannot substitute for it."
  fi
  if [ "${FAB_UNSOURCED}" -gt 0 ]; then
    say "  unsourced must be 0. Get the real ones and mark them SOURCED, or take that part"
    say "  off the page and mark it OMIT. There is no third move (references/build.md section 6)."
  fi
  return 0
}

# ------------------------------------------------------------------- sweep --

# http_status <url> — prints the HTTP status, returns curl's exit status.
# stderr from curl lands in ${CURL_ERR}.
http_status() {
  local url="$1" out rc
  out="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${TIMEOUT}" "${url}" 2>"${CURL_ERR}")"
  rc=$?
  printf '%s' "${out}"
  return "${rc}"
}

# derived_paths <deploy-root> — every real *.har and ANSWER-KEY* file under the
# deploy root, as a path relative to it. This is what makes "any *.har" real:
# a fixed probe list can only guess at names.
derived_paths() {
  local root="$1"
  [ -d "${root}" ] || return 0
  find "${root}" \( -name .git -o -name node_modules \) -prune -o \
       -type f \( -name '*.har' -o -name 'ANSWER-KEY*' \) -print 2>/dev/null \
    | sed -e "s#^${root%/}/##" \
    | grep -v '^/' \
    | head -n "${MAX_DERIVED}"
}

# ---------------------------------------------------------------- main run --

run_guard() {
  local project="$1" origin="$2" deploy_root="$3"

  [ -d "${project}" ] || undetermined "project-directory-unreadable" \
    "not a directory: ${project}"

  origin="$(printf '%s' "${origin}" | sed -e 's#/*$##')"
  case "${origin}" in
    http://*|https://*) ;;
    *) say "SHIP-GUARD | usage error: <origin> must start http:// or https:// (got: ${origin})"; exit 1 ;;
  esac

  local ledger="${project}/CONTROL/LEDGER.md"
  [ -r "${ledger}" ] || undetermined "ledger-unreadable" \
    "expected the FORM-DESTINATION lines at: ${ledger}" \
    "Ownership cannot be proved from an absent ledger, and an absent proof is not a pass."

  local workdir
  workdir="$(mktemp -d 2>/dev/null)" || undetermined "mktemp-failed" "cannot create a working directory"
  CURL_ERR="${workdir}/curl.err"
  : > "${CURL_ERR}"
  # shellcheck disable=SC2064
  trap "rm -rf '${workdir}'" EXIT

  # ---- 1. ownership, from the ledger (a local fact; always determinable) ----
  local dest_rows foreign=0 dest_json="" form type owner verdict
  dest_rows="$(parse_destinations "${ledger}")"
  say "SHIP-GUARD | project=${project}"
  say "SHIP-GUARD | origin=${origin}"
  say "SHIP-GUARD | deploy-root=${deploy_root}"
  say "SHIP-GUARD | ledger=${ledger}"
  say ""
  say "-- FORM-DESTINATION ownership (references/ship-checks.md section 3) --"
  if [ -z "${dest_rows}" ]; then
    say "  (no FORM-DESTINATION lines in the ledger — nothing to own)"
  else
    while IFS='|' read -r form type owner verdict; do
      [ -z "${form}" ] && continue
      if [ "${verdict}" = "OK" ]; then
        say "  ok      | form=${form} type=${type} owner=${owner}"
      else
        say "  FOREIGN | form=${form} type=${type} owner=${owner} — not the client's; refused at the stage gate"
        foreign=$((foreign + 1))
      fi
      dest_json="${dest_json}    {\"form\": \"$(json_escape "${form}")\", \"type\": \"$(json_escape "${type}")\", \"owner\": \"$(json_escape "${owner}")\", \"verdict\": \"${verdict}\"},
"
    done <<EOF
${dest_rows}
EOF
  fi
  say ""

  # ---- 1b. FABRICATION-GUARD — a LOCAL check, so it runs BEFORE the network.
  # Its verdict is derived from 00-INPUT/CONTENT.md and the built pages, both on
  # this disk, so an origin that cannot be reached can never erase it. See
  # undetermined() for the precedence that keeps that true.
  run_fabrication_guard "${project}" "${deploy_root}"
  say ""

  # ---- 2. the control: prove the origin answers AT ALL, by connecting ----
  local ctrl_url="${origin}/" ctrl_status ctrl_rc ctrl_msg
  local ctrl_cmd="curl -sS -o /dev/null -w '%{http_code}' --max-time ${TIMEOUT} \"${ctrl_url}\""
  ctrl_status="$(http_status "${ctrl_url}")"
  ctrl_rc=$?
  ctrl_msg="$(tr '\n' ' ' < "${CURL_ERR}" | sed -e 's/[[:space:]]*$//')"
  if [ "${ctrl_rc}" -ne 0 ]; then
    say "-- public surface --"
    say "  the origin could not be reached. The sweep did not run."
    say "  the connection attempt that failed: ${ctrl_cmd}"
    say "  curl exit status: ${ctrl_rc}"
    say "  curl said: ${ctrl_msg:-(no message)}"
    say ""
    # PRECEDENCE, as the header states it: 5 outranks 4 outranks 2. Both local
    # defects survive an unreachable origin, and the fabricated one is named first.
    if [ "${FAB_UNSOURCED}" -gt 0 ]; then
      say "SHIP-GUARD | verdict=FABRICATED | unsourced=${FAB_UNSOURCED} | foreign=${foreign} | public-surface=UNDETERMINED"
      say "  An unreachable origin does not erase a fabricated third-party attribution already"
      say "  proved from 00-INPUT/CONTENT.md and the built pages."
      exit 5
    fi
    if [ "${foreign}" -gt 0 ]; then
      say "SHIP-GUARD | verdict=FOREIGN-DESTINATION | foreign=${foreign} | public-surface=UNDETERMINED"
      say "  An unreachable origin does not erase a destination defect already proved from the ledger."
      exit 4
    fi
    undetermined "origin-unreachable" \
      "the connection attempt that failed: ${ctrl_cmd}" \
      "curl exit status: ${ctrl_rc}" \
      "curl said: ${ctrl_msg:-(no message)}" \
      "This is a failed CONNECTION ATTEMPT, not a guess from a file or a config."
  fi
  say "-- public surface (instrument 11, references/ship-checks.md 2.5) --"
  say "  control | ${origin}/ answered ${ctrl_status} — the origin is reachable, so a 404 below is a real absence"

  # ---- 3. the sweep ----
  local paths sweep_json="" exposed=0 path url status rc
  paths="$(printf '%s\n%s\n' "${STANDING_PATHS}" "$(derived_paths "${deploy_root}")" \
           | sed -e 's/^[[:space:]]*//' -e '/^$/d' | awk '!seen[$0]++')"

  while IFS= read -r path; do
    [ -z "${path}" ] && continue
    url="${origin}/${path}"
    status="$(http_status "${url}")"
    rc=$?
    if [ "${rc}" -ne 0 ]; then
      ctrl_msg="$(tr '\n' ' ' < "${CURL_ERR}" | sed -e 's/[[:space:]]*$//')"
      say ""
      undetermined "path-request-failed" \
        "the origin answered the control but this request did not complete: ${path}" \
        "the connection attempt that failed: curl -sS -o /dev/null -w '%{http_code}' --max-time ${TIMEOUT} \"${url}\"" \
        "curl exit status: ${rc}" \
        "curl said: ${ctrl_msg:-(no message)}"
    fi
    case "${status}" in
      404|403)
        say "  ok      | ${status} | ${path}"
        verdict="OK"
        ;;
      *)
        say "  EXPOSED | ${status} | ${path} — the live origin served this; it must be 404 or 403"
        verdict="EXPOSED"
        exposed=$((exposed + 1))
        ;;
    esac
    sweep_json="${sweep_json}    {\"path\": \"$(json_escape "${path}")\", \"url\": \"$(json_escape "${url}")\", \"status\": \"${status}\", \"verdict\": \"${verdict}\"},
"
  done <<EOF
${paths}
EOF

  # ---- 4. the report ----
  local outdir="${project}/ship-checks" outfile="${project}/ship-checks/public-surface.json"
  mkdir -p "${outdir}" 2>/dev/null || undetermined "report-directory-unwritable" \
    "cannot create ${outdir} — an instrument that cannot write its report is not a pass"
  {
    printf '{\n'
    printf '  "instrument": 11,\n'
    printf '  "name": "public-surface guard",\n'
    printf '  "origin": "%s",\n' "$(json_escape "${origin}")"
    printf '  "deploy_root": "%s",\n' "$(json_escape "${deploy_root}")"
    printf '  "ledger": "%s",\n' "$(json_escape "${ledger}")"
    printf '  "control": {"url": "%s", "status": "%s", "command": "%s"},\n' \
      "$(json_escape "${ctrl_url}")" "${ctrl_status}" "$(json_escape "${ctrl_cmd}")"
    printf '  "paths": [\n%s  ],\n' "$(printf '%s' "${sweep_json}" | sed -e '$ s/,$//')"
    printf '  "destinations": [\n%s  ],\n' "$(printf '%s' "${dest_json}" | sed -e '$ s/,$//')"
    printf '  "fabrication_guard": {\n'
    printf '    "class_list_owner": "references/build.md section 6",\n'
    printf '    "content_inventory": "%s",\n' "$(json_escape "${project}/00-INPUT/CONTENT.md")"
    printf '    "facts": %d, "sourced": %d, "omitted": %d, "unsourced": %d,\n' \
      "${FAB_FACTS}" "${FAB_SOURCED}" "${FAB_OMITTED}" "${FAB_UNSOURCED}"
    printf '    "ledger_line": "FABRICATION-GUARD: facts=%d sourced=%d omitted=%d unsourced=%d",\n' \
      "${FAB_FACTS}" "${FAB_SOURCED}" "${FAB_OMITTED}" "${FAB_UNSOURCED}"
    printf '    "rows": [\n%s    ]\n' "$(printf '%s' "${FAB_ROWS}" | sed -e '$ s/,$//')"
    printf '  },\n'
    printf '  "exposed": %d,\n' "${exposed}"
    printf '  "foreign_destinations": %d,\n' "${foreign}"
    if [ "${exposed}" -gt 0 ]; then printf '  "verdict": "EXPOSED"\n'
    elif [ "${FAB_UNSOURCED}" -gt 0 ]; then printf '  "verdict": "FABRICATED"\n'
    elif [ "${foreign}" -gt 0 ]; then printf '  "verdict": "FOREIGN-DESTINATION"\n'
    else printf '  "verdict": "CLEAN"\n'; fi
    printf '}\n'
  } > "${outfile}" 2>/dev/null || undetermined "report-unwritable" \
    "cannot write ${outfile} — an instrument that cannot write its report is not a pass"

  say ""
  say "SHIP-GUARD | report=${outfile}"
  if [ "${exposed}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=EXPOSED | exposed=${exposed} | unsourced=${FAB_UNSOURCED} | foreign=${foreign}"
    say "  Fix by taking those files OUT of the deploy root. A redirect, a robots.txt"
    say "  line or a rename does not stop the bytes being served."
    exit 3
  fi
  if [ "${FAB_UNSOURCED}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=FABRICATED | exposed=0 | unsourced=${FAB_UNSOURCED} | foreign=${foreign}"
    say "  Every fact and page is named above. Get the real ones and mark them SOURCED, or"
    say "  take that part off the page and mark it OMIT (references/build.md section 6)."
    exit 5
  fi
  if [ "${foreign}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=FOREIGN-DESTINATION | exposed=0 | unsourced=0 | foreign=${foreign}"
    say "  A destination that is not the client's is refused at the stage gate. Correct it,"
    say "  or build the form and leave it BLOCKED with the reason — never a substitute inbox."
    exit 4
  fi
  say "SHIP-GUARD | verdict=CLEAN | exposed=0 | unsourced=0 | foreign=0 | fabrication-facts=${FAB_FACTS} | paths=$(printf '%s\n' "${paths}" | sed '/^$/d' | wc -l | tr -d ' ')"
  exit 0
}

# ------------------------------------------------------------------ selftest --

SERVER_PY='import http.server, socketserver, sys, os
os.chdir(sys.argv[1])
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass
class S(socketserver.TCPServer):
    allow_reuse_address = True
srv = S(("127.0.0.1", 0), H)
sys.stdout.write("%d\n" % srv.server_address[1])
sys.stdout.flush()
srv.serve_forever()'

FREEPORT_PY='import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
port = s.getsockname()[1]
s.close()
print(port)'

SELFTEST_PID=""
SELFTEST_TMP=""
SELFTEST_KEEP=0
selftest_cleanup() {
  if [ -n "${SELFTEST_PID}" ]; then kill "${SELFTEST_PID}" 2>/dev/null; wait "${SELFTEST_PID}" 2>/dev/null; fi
  if [ "${SELFTEST_KEEP}" -eq 0 ] && [ -n "${SELFTEST_TMP}" ]; then rm -rf "${SELFTEST_TMP}"; fi
  return 0
}

selftest() {
  local py fails=0
  py=""
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import http.server' >/dev/null 2>&1; then py="$c"; break; fi
  done
  if [ -z "${py}" ]; then
    say "SELFTEST | UNDETERMINED | no python with http.server on PATH — the fixture server cannot be started."
    say "  Searched by name: python3, python. This is a fact about this box, not about the guard."
    exit 2
  fi

  # SHIP_GUARD_SELFTEST_DIR keeps the fixture tree — and its CONTROL/LEDGER.md,
  # which is where the FABRICATION-GUARD line lands — for inspection afterwards.
  if [ -n "${SHIP_GUARD_SELFTEST_DIR:-}" ]; then
    mkdir -p "${SHIP_GUARD_SELFTEST_DIR}" 2>/dev/null \
      || { warn "SELFTEST | UNDETERMINED | cannot create SHIP_GUARD_SELFTEST_DIR=${SHIP_GUARD_SELFTEST_DIR}"; exit 2; }
    SELFTEST_TMP="$(cd -- "${SHIP_GUARD_SELFTEST_DIR}" >/dev/null 2>&1 && pwd)" \
      || { warn "SELFTEST | UNDETERMINED | cannot enter SHIP_GUARD_SELFTEST_DIR=${SHIP_GUARD_SELFTEST_DIR}"; exit 2; }
    SELFTEST_KEEP=1
    say "SELFTEST | fixture tree kept at ${SELFTEST_TMP} (SHIP_GUARD_SELFTEST_DIR)"
  else
    SELFTEST_TMP="$(mktemp -d)" || { warn "SELFTEST | UNDETERMINED | cannot mktemp"; exit 2; }
  fi
  trap selftest_cleanup EXIT INT TERM

  local doc="${SELFTEST_TMP}/docroot"
  mkdir -p "${doc}"
  printf '<!doctype html><title>fixture</title><h1>fixture site</h1>\n' > "${doc}/index.html"

  # The fixture server: started here, stopped here, on an ephemeral port.
  local portfile="${SELFTEST_TMP}/port"
  "${py}" -c "${SERVER_PY}" "${doc}" > "${portfile}" 2>/dev/null &
  SELFTEST_PID=$!
  local port="" i=0
  while [ "${i}" -lt 100 ]; do
    port="$(head -1 "${portfile}" 2>/dev/null | tr -d '[:space:]')"
    case "${port}" in ''|*[!0-9]*) port="" ;; *) break ;; esac
    i=$((i + 1))
    "${py}" -c 'import time; time.sleep(0.05)' 2>/dev/null
  done
  if [ -z "${port}" ]; then
    say "SELFTEST | UNDETERMINED | the fixture server never reported a port — the harness is broken, not the guard."
    exit 2
  fi
  local live="http://127.0.0.1:${port}"
  say "SELFTEST | fixture server up at ${live} (pid ${SELFTEST_PID}, docroot ${doc})"

  # A port nothing is listening on, for the unreachable fixture.
  local deadport
  deadport="$("${py}" -c "${FREEPORT_PY}" 2>/dev/null | tr -d '[:space:]')"
  case "${deadport}" in ''|*[!0-9]*) deadport=9 ;; esac
  local dead="http://127.0.0.1:${deadport}"

  # Project fixtures. Each has its own CONTROL/LEDGER.md; the third argument, if
  # given, is the state written above the Testimonials entry in
  # 00-INPUT/CONTENT.md (SOURCED | OMIT | 'DRAFT — write one'). OMITTING the
  # third argument leaves the project with NO CONTENT.md, which is fixture 7.
  mk_project() { # mk_project <dir> <owner> [testimonial-state]
    mkdir -p "$1/CONTROL"
    {
      printf '2026-09-08T00:00:00Z | STAGE-BUILD | pass\n'
      printf '2026-09-08T00:00:01Z | FORM-DESTINATION: contact=email owner=%s\n' "$2"
    } > "$1/CONTROL/LEDGER.md"
    if [ "$#" -ge 3 ]; then
      mkdir -p "$1/00-INPUT"
      {
        printf '# CONTENT — fixture\n'
        printf '## Business name\n'
        printf 'SOURCED\n'
        printf 'Fixture Bakery\n'
        printf '## Testimonials\n'
        printf '%s\n' "$3"
        printf 'The best sourdough I have ever eaten. - A. Customer\n'
      } > "$1/00-INPUT/CONTENT.md"
    fi
  }

  # The FABRICATION-GUARD deploy root: ONE page that renders a testimonial and
  # the person credited with it, and nothing else guarded. Kept OUT of the
  # served docroot so it cannot disturb the public-surface fixtures.
  local fabroot="${SELFTEST_TMP}/fabroot"
  mkdir -p "${fabroot}"
  {
    printf '<!doctype html><title>Fixture Bakery</title>\n'
    printf '<h1>Fixture Bakery</h1>\n'
    printf '<section class="testimonial">\n'
    printf '  <blockquote>The best sourdough I have ever eaten.</blockquote>\n'
    printf '  <cite>A. Customer</cite>\n'
    printf '</section>\n'
  } > "${fabroot}/index.html"

  local p_clean="${SELFTEST_TMP}/p-clean"
  local p_har="${SELFTEST_TMP}/p-har"
  local p_owner="${SELFTEST_TMP}/p-owner"
  local p_dead="${SELFTEST_TMP}/p-dead"
  local p_src="${SELFTEST_TMP}/p-fab-sourced"
  local p_draft="${SELFTEST_TMP}/p-fab-draft"
  local p_none="${SELFTEST_TMP}/p-fab-no-content"
  mk_project "${p_clean}" client   'OMIT'
  mk_project "${p_har}"   client   'OMIT'
  mk_project "${p_owner}" operator 'OMIT'
  mk_project "${p_dead}"  client   'OMIT'
  mk_project "${p_src}"   client   'SOURCED'
  mk_project "${p_draft}" client   'DRAFT — write one'
  mk_project "${p_none}"  client

  local out1 rc1 out2 rc2 out3 rc3 out4 rc4
  local out5 rc5 out6 rc6 out7 rc7

  # ---- fixture 1: clean origin -> 0 (the PAIRED CONTROL) ----
  out1="$("$0" "${p_clean}" "${live}" "${doc}" 2>&1)"; rc1=$?
  if [ "${rc1}" -eq 0 ]; then
    say "SELFTEST ok   | clean-origin           | rc=0 CLEAN"
  else
    say "SELFTEST FAIL | clean-origin           | rc=${rc1} (want 0)"
    say "${out1}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- fixture 2: origin serving .har files -> 3, naming them ----
  # One file under a directory the standing list already names, and one under a
  # directory it does not — so BOTH mechanisms are proven: the standing probe
  # list, and the "any *.har" enumeration from the deploy root.
  mkdir -p "${doc}/captures" "${doc}/evidence"
  printf '{"log":{"entries":[{"note":"fixture only - no real data"}]}}\n' > "${doc}/captures/submit-proof.har"
  printf '{"log":{"entries":[{"note":"fixture only - no real data"}]}}\n' > "${doc}/evidence/run-42.har"
  out2="$("$0" "${p_har}" "${live}" "${doc}" 2>&1)"; rc2=$?
  if [ "${rc2}" -eq 3 ] \
     && printf '%s' "${out2}" | grep -q 'captures/submit-proof.har' \
     && printf '%s' "${out2}" | grep -q 'evidence/run-42.har'; then
    say "SELFTEST ok   | har-serving-origin     | rc=3 EXPOSED, naming captures/submit-proof.har and evidence/run-42.har"
  else
    say "SELFTEST FAIL | har-serving-origin     | rc=${rc2} (want 3) or the exposed paths were not named"
    say "${out2}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi
  rm -rf "${doc}/captures" "${doc}/evidence"

  # ---- the paired control: a pass and a fail that land on the same code is a
  # ---- broken TEST, never a class-wide fault in the target.
  if [ "${rc1}" -eq "${rc2}" ]; then
    say "SELFTEST FAIL | paired-control         | clean and .har fixtures BOTH returned rc=${rc1}"
    say "    The instrument does not discriminate. That is a broken TEST, not a finding."
    fails=$((fails + 1))
  else
    say "SELFTEST ok   | paired-control         | clean rc=${rc1} vs har rc=${rc2} — the instrument discriminates"
  fi

  # ---- fixture 3: owner=operator against the CLEAN origin -> 4 ----
  out3="$("$0" "${p_owner}" "${live}" "${doc}" 2>&1)"; rc3=$?
  if [ "${rc3}" -eq 4 ] && printf '%s' "${out3}" | grep -q 'FOREIGN'; then
    say "SELFTEST ok   | owner-operator         | rc=4 FOREIGN-DESTINATION on an otherwise clean origin"
  else
    say "SELFTEST FAIL | owner-operator         | rc=${rc3} (want 4)"
    say "${out3}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- fixture 4: unreachable origin -> 2, naming the failed connection ----
  out4="$("$0" "${p_dead}" "${dead}" "${p_dead}" 2>&1)"; rc4=$?
  if [ "${rc4}" -eq 2 ] \
     && printf '%s' "${out4}" | grep -q 'connection attempt that failed' \
     && printf '%s' "${out4}" | grep -q 'curl exit status' \
     && printf '%s' "${out4}" | grep -q 'UNDETERMINED' \
     && ! printf '%s' "${out4}" | grep -q 'CLEAN'; then
    say "SELFTEST ok   | unreachable-origin     | rc=2 UNDETERMINED, naming the failed connection attempt to ${dead}"
  else
    say "SELFTEST FAIL | unreachable-origin     | rc=${rc4} (want 2), or it did not name the failed connection attempt, or it claimed clean"
    say "${out4}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- fixture 5: a page rendering a testimonial, CONTENT.md SOURCED -> 0 ----
  # The FABRICATION-GUARD half of the second PAIRED CONTROL. A guard that failed
  # every page carrying a <blockquote> would pass fixture 6 and fail right here.
  out5="$("$0" "${p_src}" "${live}" "${fabroot}" 2>&1)"; rc5=$?
  if [ "${rc5}" -eq 0 ] && printf '%s' "${out5}" | grep -q 'sourced    | fact=testimonial'; then
    say "SELFTEST ok   | fab-sourced            | rc=0 CLEAN — a SOURCED testimonial may be rendered"
  else
    say "SELFTEST FAIL | fab-sourced            | rc=${rc5} (want 0), or it did not report fact=testimonial as sourced"
    say "${out5}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- fixture 6: THE DISCRIMINATING CASE. The SAME page, the SAME deploy root,
  # ---- CONTENT.md reading `DRAFT — write one` -> 5, naming the fact AND the page.
  # An implementation that treats FABRICATION-GUARD items like every other
  # drafted fact passes fixture 5 and fails HERE, which is the whole point of it.
  out6="$("$0" "${p_draft}" "${live}" "${fabroot}" 2>&1)"; rc6=$?
  if [ "${rc6}" -eq 5 ] \
     && printf '%s' "${out6}" | grep -q 'fact=testimonial' \
     && printf '%s' "${out6}" | grep -q "${fabroot}/index.html" \
     && printf '%s' "${out6}" | grep -q 'FABRICATED' \
     && ! printf '%s' "${out6}" | grep -q 'verdict=CLEAN'; then
    say "SELFTEST ok   | fab-drafted            | rc=5 FABRICATED, naming fact=testimonial and ${fabroot}/index.html"
  else
    say "SELFTEST FAIL | fab-drafted            | rc=${rc6} (want 5), or it did not name both the fact and the page, or it claimed clean"
    say "${out6}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- the FABRICATION-GUARD paired control ----
  if [ "${rc5}" -eq "${rc6}" ]; then
    say "SELFTEST FAIL | fab-paired-control     | SOURCED and DRAFT fixtures BOTH returned rc=${rc5}"
    say "    The guard does not discriminate between a real quote and a drafted one."
    say "    That is a broken TEST, not a finding."
    fails=$((fails + 1))
  else
    say "SELFTEST ok   | fab-paired-control     | sourced rc=${rc5} vs drafted rc=${rc6} — the guard discriminates"
  fi

  # ---- fixture 7: the SAME page with NO 00-INPUT/CONTENT.md -> non-zero ----
  # An absent file proves nothing about the page (references/build.md section 6),
  # so it is the CHECK'S OWN failure and never a pass by default.
  out7="$("$0" "${p_none}" "${live}" "${fabroot}" 2>&1)"; rc7=$?
  if [ "${rc7}" -ne 0 ] \
     && printf '%s' "${out7}" | grep -q 'content-inventory-unreadable' \
     && printf '%s' "${out7}" | grep -q "${p_none}/00-INPUT/CONTENT.md" \
     && ! printf '%s' "${out7}" | grep -q 'verdict=CLEAN'; then
    say "SELFTEST ok   | fab-no-content         | rc=${rc7} non-zero, naming the missing inventory — never a pass by default"
  else
    say "SELFTEST FAIL | fab-no-content         | rc=${rc7} (want non-zero), or it did not name the missing 00-INPUT/CONTENT.md, or it claimed clean"
    say "${out7}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # ---- the ledger contract: the line SHAPE, proved from the fixture's own
  # ---- CONTROL/LEDGER.md rather than assumed from the code that writes it.
  # The grep is run on a KNOWN-POSITIVE first (FORM-DESTINATION, which
  # mk_project certainly wrote). If the control comes back empty the INSTRUMENT
  # is broken, not the target, and this says so instead of reporting a defect.
  local fabledger="${p_src}/CONTROL/LEDGER.md" ctl_n ctl_rc fab_n fab_rc
  if [ -z "${SGREP}" ]; then
    say "SELFTEST UNDETERMINED | fab-ledger-line | no grep resolved (/usr/bin/grep, PATH), so the"
    say "    ledger line shape could not be counted. That is a fact about this box, not the guard."
    fails=$((fails + 1))
  else
    ctl_n="$("${SGREP}" -c 'FORM-DESTINATION' "${fabledger}" 2>/dev/null)"; ctl_rc=$?
    fab_n="$("${SGREP}" -cE 'FABRICATION-GUARD: facts=[0-9]+ sourced=[0-9]+ omitted=[0-9]+ unsourced=[0-9]+' "${fabledger}" 2>/dev/null)"; fab_rc=$?
    if [ "${ctl_rc}" -ge 2 ] || [ "${fab_rc}" -ge 2 ] || [ "${ctl_n:-0}" -lt 1 ]; then
      say "SELFTEST FAIL | fab-ledger-line        | the KNOWN-GOOD CONTROL failed on ${fabledger}"
      say "    control(FORM-DESTINATION)=${ctl_n:-(none)} rc=${ctl_rc}; FABRICATION-GUARD=${fab_n:-(none)} rc=${fab_rc}"
      say "    A control that comes back empty means the CHECK is broken, not the ledger."
      fails=$((fails + 1))
    elif [ "${fab_n}" -eq 1 ]; then
      say "SELFTEST ok   | fab-ledger-line        | 1 FABRICATION-GUARD line of the right shape in ${fabledger}"
      say "                                       | $("${SGREP}" -oE 'FABRICATION-GUARD: facts=[0-9]+ sourced=[0-9]+ omitted=[0-9]+ unsourced=[0-9]+' "${fabledger}" | head -1)"
    else
      say "SELFTEST FAIL | fab-ledger-line        | wanted exactly 1 FABRICATION-GUARD line in ${fabledger}, counted ${fab_n}"
      say "    (the control matched ${ctl_n} FORM-DESTINATION line(s), so the grep and the path are sound)"
      fails=$((fails + 1))
    fi
  fi

  selftest_cleanup
  SELFTEST_PID=""
  if [ "${SELFTEST_KEEP}" -eq 0 ]; then SELFTEST_TMP=""; fi
  trap - EXIT INT TERM

  if [ "${fails}" -eq 0 ]; then
    say "SELFTEST PASS | 10 checks | 7 fixtures: clean=0 har=3 owner=4 unreachable=2"
    say "SELFTEST PASS | fabrication: sourced=0 drafted=5 no-content=${rc7}, plus BOTH paired controls and the ledger line shape"
    exit 0
  fi
  warn "SELFTEST FAILED | ${fails} check(s) failed — this guard may not be believed until it is fixed"
  exit 3
}

# ---------------------------------------------------------------- dispatch --

case "${1:-}" in
  --selftest) selftest ;;
  --paths)
    printf '%s\n' "${STANDING_PATHS}"
    say "# plus every *.har and ANSWER-KEY* file found under the deploy root, by its own path"
    exit 0
    ;;
  --help|-h) usage; exit 0 ;;
  "") usage; exit 1 ;;
  *)
    if [ "$#" -lt 2 ]; then
      say "SHIP-GUARD | usage error: need <project> <origin> [deploy-root]"
      usage
      exit 1
    fi
    run_guard "$1" "$2" "${3:-$1}"
    ;;
esac
