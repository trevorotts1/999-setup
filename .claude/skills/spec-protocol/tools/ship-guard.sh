#!/usr/bin/env bash
# ship-guard.sh — the enforcing script for the two guards STAGE-SHIP-CHECKS and
# STAGE-PUBLISH gained after a canary run shipped a form pointed at the machine
# owner's inbox and moved its own evidence tree inside the deploy root.
#
# It answers two questions no other instrument in references/ship-checks.md can:
#
#   1. OWNERSHIP — does every declared form destination belong to the CLIENT,
#      and can it receive mail at all?
#      Instrument 6 proves a submission ARRIVES. Arrival at the wrong person's
#      mailbox is still an arrival, so instrument 6 passes it. Ownership is
#      declared on the FORM-DESTINATION ledger line and checked HERE, at the
#      stage gate, before the form is built — never at publish, by which time
#      the form is wired to a real inbox.
#      Two things are read off that line. The `owner=` field, which is never
#      omitted and never carries a third value: absent or unrecognised reads as
#      `operator` and is FOREIGN. And the destination's DOMAIN: an address under
#      the reserved names of RFC 2606 and RFC 6761 — `.example`, `.invalid`,
#      `.test`, `.localhost` — exists precisely so it can never resolve, so a
#      CONFIRMED destination there is UNDELIVERABLE. It is recorded
#      `=BLOCKED owner=client reason=…` instead, never confirmed and never
#      repointed at a substitute inbox: that swap is the exact 2026-09-07 canary
#      harm, where the only address the client gave sat at a `.example` name, was
#      correctly BLOCKED, and the form was then wired to the machine owner's real
#      inbox anyway.
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
#   The one addition is the undeliverable DOMAIN, which the exit-5 line has to
#   name for the defect to be actionable — the half after the `@` only. The
#   mailbox name before it is dropped with everything else, and a reserved-suffix
#   domain routes nowhere by definition.
#
# OUTPUT
#   Human lines on stdout, and one JSON report at
#   <project>/ship-checks/public-surface.json carrying the origin, the control
#   request that proved the origin answers at all, one row per fetched path
#   (path, url, status, verdict) and one row per form destination
#   (form, type, owner, domain, verdict) — `domain` is empty unless the row is
#   the exit-5 defect, and carries only the half after the `@`.
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
#   5 — UNDELIVERABLE DESTINATION. At least one FORM-DESTINATION is owned by the
#       client and CONFIRMED, but its address sits under a reserved suffix
#       (.example, .invalid, .test, .localhost) that can never receive mail. The
#       domain is named. A line already recorded =BLOCKED is NOT this defect —
#       BLOCKED with the reason is the correct record for exactly this case, and
#       naming the reserved domain inside that reason is what the run is asked
#       to do (references/ship-checks.md section 3).
#   1 — usage error.
#
#   PRECEDENCE, stated so it is never a surprise: a live 200 is public harm
#   happening now, so 3 outranks 4 when both are true (both are printed either
#   way). A foreign destination is a wrong recipient and an undeliverable one is
#   no recipient, so 4 outranks 5 (again, both are printed). Ownership and
#   deliverability are LOCAL facts that an unreachable origin cannot erase, so
#   4 and 5 both outrank 2 — an unreachable origin never downgrades a
#   destination defect the tool already proved.
#
# SELFTEST — ten fixtures against a server this script starts and stops itself:
#   clean origin -> 0 | origin serving .har files -> 3 | owner=operator -> 4 |
#   unreachable origin -> 2. The clean and .har fixtures are a PAIRED CONTROL:
#   if they return the same code the TEST is broken, not the target, and the
#   selftest says so and fails.
#   Then the deliverability set, six more legs on one clean origin: a real
#   domain with owner=client -> 0; the same line at each of the four reserved
#   suffixes -> 5, each naming its own domain; and the SAME .example domain
#   recorded =BLOCKED with the reason -> 0. The first and last are that set's
#   paired control — a check that answered alike either way would be refusing
#   the domain rather than the confirmation.
set -u

TIMEOUT="${SHIP_GUARD_TIMEOUT:-15}"
MAX_DERIVED="${SHIP_GUARD_MAX_DERIVED:-50}"

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
  # 2..98 is the whole header down to the end of the PRECEDENCE note, so every
  # exit code this tool can return is printed with --help.
  sed -n '2,98p' "$0" | sed 's/^# \{0,1\}//'
}

undetermined() { # undetermined <reason-line> [extra lines...]
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
# Prints one row per FORM-DESTINATION line:
#   <form>|<type>|<owner>|<verdict>|<undeliverable-domain-or-empty>
# The destination detail is deliberately reduced to a TYPE and dropped; the
# fifth field is set ONLY on the exit-5 defect and carries no mailbox name.
parse_destinations() {
  local ledger="$1" line rest form after destword type owner verdict dom tok cand
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
        after=""
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

    # The DOMAIN read, on the destination half of the line only — never on the
    # form name, which is before the first '=' and is free text. A BLOCKED line
    # is skipped on purpose: BLOCKED with the reason IS the correct record for
    # an address that cannot receive mail, and that reason will usually name the
    # reserved domain out loud. Only a CONFIRMED destination can be
    # undeliverable. The local part of an address is dropped with '${tok##*@}'
    # before anything is compared or printed.
    dom=""
    if [ "${type}" != "BLOCKED" ] && [ "${type}" != "unparsed" ]; then
      for tok in $(printf '%s' "${after}" | tr -c 'A-Za-z0-9.@_%+-' ' '); do
        cand="${tok##*@}"
        cand="$(printf '%s' "${cand}" | tr 'A-Z' 'a-z')"
        while [ "${cand}" != "${cand%.}" ]; do cand="${cand%.}"; done
        case "${cand}" in
          # RFC 2606 (.example/.invalid/.test) and RFC 6761 (.localhost). The
          # bare label 'localhost' is the zero-label case of the same class.
          *.example|*.invalid|*.test|*.localhost|localhost)
            dom="${cand}"; break ;;
        esac
      done
    fi

    if [ "${type}" = "unparsed" ]; then
      # A line too malformed to carry a destination is not proof of anything.
      verdict="FOREIGN"
    elif [ "${owner}" = "client" ]; then
      if [ -n "${dom}" ]; then
        # Owned by the client and confirmed, at an address that can never
        # receive mail. Not FOREIGN — nobody else's inbox is involved — and not
        # OK either, because it reports a working destination for messages that
        # will be lost.
        verdict="UNDELIVERABLE"
      else
        verdict="OK"
      fi
    else
      verdict="FOREIGN"
    fi
    printf '%s|%s|%s|%s|%s\n' "${form}" "${type}" "${owner}" "${verdict}" "${dom}"
  done < "${ledger}"
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
  local dest_rows foreign=0 undeliverable=0 dest_json="" form type owner verdict dom
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
    while IFS='|' read -r form type owner verdict dom; do
      [ -z "${form}" ] && continue
      if [ "${verdict}" = "OK" ]; then
        say "  ok      | form=${form} type=${type} owner=${owner}"
      elif [ "${verdict}" = "UNDELIVERABLE" ]; then
        say "  UNDELIVERABLE | form=${form} type=${type} owner=${owner} domain=${dom} — ${dom} is a reserved name (RFC 2606 / RFC 6761) and can never receive mail, so this destination is not confirmed. Record it as '<form>=BLOCKED owner=client reason=<the reason>' (references/ship-checks.md section 3) — never a substitute inbox."
        undeliverable=$((undeliverable + 1))
      else
        say "  FOREIGN | form=${form} type=${type} owner=${owner} — not the client's; refused at the stage gate"
        foreign=$((foreign + 1))
      fi
      dest_json="${dest_json}    {\"form\": \"$(json_escape "${form}")\", \"type\": \"$(json_escape "${type}")\", \"owner\": \"$(json_escape "${owner}")\", \"domain\": \"$(json_escape "${dom}")\", \"verdict\": \"${verdict}\"},
"
    done <<EOF
${dest_rows}
EOF
  fi
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
    if [ "${foreign}" -gt 0 ]; then
      say "SHIP-GUARD | verdict=FOREIGN-DESTINATION | foreign=${foreign} | undeliverable=${undeliverable} | public-surface=UNDETERMINED"
      say "  An unreachable origin does not erase a destination defect already proved from the ledger."
      exit 4
    fi
    if [ "${undeliverable}" -gt 0 ]; then
      say "SHIP-GUARD | verdict=UNDELIVERABLE-DESTINATION | undeliverable=${undeliverable} | public-surface=UNDETERMINED"
      say "  An unreachable origin does not erase a destination defect already proved from the ledger."
      exit 5
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
    printf '  "exposed": %d,\n' "${exposed}"
    printf '  "foreign_destinations": %d,\n' "${foreign}"
    printf '  "undeliverable_destinations": %d,\n' "${undeliverable}"
    if [ "${exposed}" -gt 0 ]; then printf '  "verdict": "EXPOSED"\n'
    elif [ "${foreign}" -gt 0 ]; then printf '  "verdict": "FOREIGN-DESTINATION"\n'
    elif [ "${undeliverable}" -gt 0 ]; then printf '  "verdict": "UNDELIVERABLE-DESTINATION"\n'
    else printf '  "verdict": "CLEAN"\n'; fi
    printf '}\n'
  } > "${outfile}" 2>/dev/null || undetermined "report-unwritable" \
    "cannot write ${outfile} — an instrument that cannot write its report is not a pass"

  say ""
  say "SHIP-GUARD | report=${outfile}"
  if [ "${exposed}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=EXPOSED | exposed=${exposed} | foreign=${foreign} | undeliverable=${undeliverable}"
    say "  Fix by taking those files OUT of the deploy root. A redirect, a robots.txt"
    say "  line or a rename does not stop the bytes being served."
    exit 3
  fi
  if [ "${foreign}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=FOREIGN-DESTINATION | exposed=0 | foreign=${foreign} | undeliverable=${undeliverable}"
    say "  A destination that is not the client's is refused at the stage gate. Correct it,"
    say "  or build the form and leave it BLOCKED with the reason — never a substitute inbox."
    exit 4
  fi
  if [ "${undeliverable}" -gt 0 ]; then
    say "SHIP-GUARD | verdict=UNDELIVERABLE-DESTINATION | exposed=0 | foreign=0 | undeliverable=${undeliverable}"
    say "  A confirmed destination at a reserved name can never receive mail. Correct it to a"
    say "  deliverable address the client owns, or record it BLOCKED with the reason — never a"
    say "  substitute inbox (references/ship-checks.md section 3)."
    exit 5
  fi
  say "SHIP-GUARD | verdict=CLEAN | exposed=0 | foreign=0 | undeliverable=0 | paths=$(printf '%s\n' "${paths}" | sed '/^$/d' | wc -l | tr -d ' ')"
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
selftest_cleanup() {
  if [ -n "${SELFTEST_PID}" ]; then kill "${SELFTEST_PID}" 2>/dev/null; wait "${SELFTEST_PID}" 2>/dev/null; fi
  [ -n "${SELFTEST_TMP}" ] && rm -rf "${SELFTEST_TMP}"
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

  SELFTEST_TMP="$(mktemp -d)" || { warn "SELFTEST | UNDETERMINED | cannot mktemp"; exit 2; }
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

  # Four project fixtures. Each has its own CONTROL/LEDGER.md.
  mk_project() { # mk_project <dir> <owner>
    mkdir -p "$1/CONTROL"
    {
      printf '2026-09-08T00:00:00Z | STAGE-BUILD | pass\n'
      printf '2026-09-08T00:00:01Z | FORM-DESTINATION: contact=email owner=%s\n' "$2"
    } > "$1/CONTROL/LEDGER.md"
  }
  # mk_dest <dir> <the text after 'FORM-DESTINATION: '> — the deliverability
  # fixtures need the whole destination clause, not just the owner.
  mk_dest() {
    mkdir -p "$1/CONTROL"
    {
      printf '2026-09-08T00:00:00Z | STAGE-BUILD | pass\n'
      printf '2026-09-08T00:00:01Z | FORM-DESTINATION: %s\n' "$2"
    } > "$1/CONTROL/LEDGER.md"
  }
  local p_clean="${SELFTEST_TMP}/p-clean"
  local p_har="${SELFTEST_TMP}/p-har"
  local p_owner="${SELFTEST_TMP}/p-owner"
  local p_dead="${SELFTEST_TMP}/p-dead"
  mk_project "${p_clean}" client
  mk_project "${p_har}"   client
  mk_project "${p_owner}" operator
  mk_project "${p_dead}"  client

  local out1 rc1 out2 rc2 out3 rc3 out4 rc4

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

  # ---- fixtures 5-10: FORM-DESTINATION deliverability, on the CLEAN origin ----
  # Every leg below runs against the same clean origin and the same owner=client
  # line. The ONLY thing that changes is the destination address, so a pass/fail
  # split is attributable to the address and to nothing else.
  local p_real="${SELFTEST_TMP}/p-real" out5 rc5
  mk_dest "${p_real}" 'contact=email hello@clients-own-domain.com owner=client'
  out5="$("$0" "${p_real}" "${live}" "${doc}" 2>&1)"; rc5=$?
  if [ "${rc5}" -eq 0 ] && printf '%s' "${out5}" | grep -q 'owner=client'; then
    say "SELFTEST ok   | real-domain-client     | rc=0 CLEAN for contact=email hello@clients-own-domain.com owner=client"
  else
    say "SELFTEST FAIL | real-domain-client     | rc=${rc5} (want 0)"
    say "${out5}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  # All four reserved suffixes, each its own fixture, each reported by name.
  local sfx dom pr outr rcr
  for sfx in example invalid test localhost; do
    dom="clientsite.${sfx}"
    pr="${SELFTEST_TMP}/p-rsv-${sfx}"
    mk_dest "${pr}" "contact=email hello@${dom} owner=client"
    outr="$("$0" "${pr}" "${live}" "${doc}" 2>&1)"; rcr=$?
    if [ "${rcr}" -eq 5 ] \
       && printf '%s' "${outr}" | grep -q "${dom}" \
       && printf '%s' "${outr}" | grep -q 'UNDELIVERABLE' \
       && ! printf '%s' "${outr}" | grep -q 'verdict=CLEAN'; then
      say "SELFTEST ok   | reserved-.${sfx}$(printf '%*s' $((13 - ${#sfx})) '')| rc=5 UNDELIVERABLE, naming ${dom}, for a CONFIRMED owner=client destination"
    else
      say "SELFTEST FAIL | reserved-.${sfx}$(printf '%*s' $((13 - ${#sfx})) '')| rc=${rcr} (want 5), or it did not name ${dom}, or it claimed clean"
      say "${outr}" | sed 's/^/    /'
      fails=$((fails + 1))
    fi
  done

  # THE PAIRED CONTROL for the set: the SAME .example domain, recorded BLOCKED
  # with the reason, must PASS. A check that refused this too would be refusing
  # the domain rather than the false confirmation, and BLOCKED-with-the-reason is
  # the record references/ship-checks.md section 3 asks for.
  local p_blocked="${SELFTEST_TMP}/p-blocked" out6 rc6
  mk_dest "${p_blocked}" 'contact=BLOCKED owner=client reason=the only address given is hello@clientsite.example, a reserved name that can never receive mail'
  out6="$("$0" "${p_blocked}" "${live}" "${doc}" 2>&1)"; rc6=$?
  if [ "${rc6}" -eq 0 ] && printf '%s' "${out6}" | grep -q 'verdict=CLEAN'; then
    say "SELFTEST ok   | blocked-reserved-ok    | rc=0 CLEAN for '=BLOCKED owner=client reason=…clientsite.example…' — the SAME domain as the rc=5 leg above, honestly recorded"
  else
    say "SELFTEST FAIL | blocked-reserved-ok    | rc=${rc6} (want 0) — a BLOCKED record naming a reserved domain in its reason is the CORRECT record, not a defect"
    say "${out6}" | sed 's/^/    /'
    fails=$((fails + 1))
  fi

  selftest_cleanup
  SELFTEST_PID=""
  SELFTEST_TMP=""
  trap - EXIT INT TERM

  if [ "${fails}" -eq 0 ]; then
    say "SELFTEST PASS | 11 checks | 10 fixtures: clean=0 har=3 owner=4 unreachable=2, plus the paired control; real-domain=0, .example/.invalid/.test/.localhost=5 each, BLOCKED-at-.example=0"
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
