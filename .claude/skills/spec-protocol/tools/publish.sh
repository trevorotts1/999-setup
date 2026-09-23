#!/usr/bin/env bash
# publish.sh — STAGE-PUBLISH for a served target (references/publish.md).
#
#   publish.sh <project>     deploy, guard, prove 200, record PUBLISHED
#   publish.sh --selftest    prove it against a stub vercel, stub guard, stub curl
#
# Steps, in order, each one a gate for the next:
#   1. the repo root is read from the repo-anchor.json receipt (tools/repo-anchor.sh)
#      — CONTROL/ on a legacy project, beside documents.state on a profiled one.
#   2. `vercel deploy --prod --yes` in that root. The credential is the one already
#      on this machine (`vercel login`, or VERCEL_TOKEN in the environment); it is
#      never printed, never passed on the command line, never asked of the client.
#   3. tools/ship-guard.sh <project> <url> <repo-root> at the LIVE address.
#   4. curl the address until it answers 200 (PUBLISH_TRIES tries, PUBLISH_WAIT s apart).
#   5. SHIP-GUARD: rc=0 … then PUBLISHED: <url> … through tools/ledger.sh (legacy),
#      or appended to <state dir>/published.log (profiled: ledger.sh refuses those).
#
# Exit: 0 live (PUBLISHED written) | 3 not live (guard refused, or no 200) |
#       2 undetermined (no receipt, deploy failed, guard could not decide) | 1 usage
#
# Test seams (the selftest uses them): PUBLISH_VERCEL_CMD, PUBLISH_GUARD_CMD.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
VERCEL="${PUBLISH_VERCEL_CMD:-vercel}"
GUARD="${PUBLISH_GUARD_CMD:-$DIR/ship-guard.sh}"
TRIES="${PUBLISH_TRIES:-10}"
WAIT="${PUBLISH_WAIT:-6}"

say() { printf 'PUBLISH | %s\n' "$*"; }
undetermined() { say "UNDETERMINED | $*"; exit 2; }

state_dir() { # state_dir <home> -> CONTROL/ (legacy) or dirname(documents.state) (profiled)
  local home="$1" st
  if [[ -f "$home/.spec-protocol.json" ]]; then
    st="$(python3 -c 'import json,sys
v=json.load(open(sys.argv[1]))["documents"]["state"]
assert isinstance(v,str) and v.strip() and not v.startswith("/") and ".." not in v.split("/")
print(v)' "$home/.spec-protocol.json" 2>/dev/null)" || return 1
    printf '%s/%s\n' "$home" "$(dirname "$st")"
  else
    printf '%s/CONTROL\n' "$home"
  fi
}

record() { # record <home> <line>
  if [[ -f "$1/.spec-protocol.json" ]]; then
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$(state_dir "$1")/published.log"
  else
    "$DIR/ledger.sh" "$1" CONTROL/LEDGER.md "$2" >/dev/null
  fi
}

publish() {
  local home="${1%/}" sd root out rc url code checks target i
  [[ -d "$home" ]] || undetermined "no project folder at $home"
  sd="$(state_dir "$home")" || undetermined "$home/.spec-protocol.json has no readable in-root documents.state"
  root="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repoRoot"])' "$sd/repo-anchor.json" 2>/dev/null)" \
    || undetermined "no repo-anchor receipt at $sd/repo-anchor.json — run tools/repo-anchor.sh $home first"
  [[ -d "$root" ]] || undetermined "the receipt's repoRoot $root is not a folder"

  # 2. deploy. Output is kept for the URL only; on failure the last lines are shown
  #    (the Vercel CLI does not echo the credential).
  out="$(cd "$root" && "$VERCEL" deploy --prod --yes 2>&1)"; rc=$?
  if (( rc != 0 )); then
    say "vercel deploy --prod --yes exited $rc in $root. Last lines:"
    printf '%s\n' "$out" | tail -5
    exit 2
  fi
  # Prefer the production alias (public); fall back to the last https URL printed.
  url="$(printf '%s\n' "$out" | grep -E 'Aliased:' | grep -Eo 'https://[^ ]+' | tail -1)"
  [[ -n "$url" ]] || url="$(printf '%s\n' "$out" | grep -Eo 'https://[^ ]+' | tail -1)"
  url="${url%]}"
  [[ -n "$url" ]] || undetermined "vercel deploy exited 0 but printed no https:// address"
  say "deployed: $url"

  # 3. the guard at the live origin.
  "$GUARD" "$home" "$url" "$root"; rc=$?
  case "$rc" in
    0) ;;
    3|4|5) say "NOT LIVE | ship-guard.sh exited $rc — fix what it named, redeploy, rerun. No PUBLISHED line."; exit 3 ;;
    *) undetermined "ship-guard.sh exited $rc — the guard could not decide; no PUBLISHED line" ;;
  esac

  # 4. prove 200.
  code=000
  for (( i = 1; i <= TRIES; i++ )); do
    code="$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null)" || code=000
    [[ "$code" == 200 ]] && break
    (( i < TRIES )) && sleep "$WAIT"
  done
  if [[ "$code" != 200 ]]; then
    say "NOT LIVE | $url answered $code after $TRIES tries. No PUBLISHED line."
    exit 3
  fi

  # 5. record: guard line first, then the address.
  checks="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(len(d.get("paths",[]))+len(d.get("destinations",[])))' \
    "$home/ship-checks/public-surface.json" 2>/dev/null)" || checks=unknown
  target="$(grep -Eo 'BUILD-TARGET: [A-Z_]+' "$home/CONTROL/LEDGER.md" 2>/dev/null | tail -1 | sed 's/.*: //')"
  record "$home" "SHIP-GUARD: rc=0 checks=${checks} at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" || undetermined "could not record the SHIP-GUARD line"
  record "$home" "PUBLISHED: $url target=${target:-served} domain=none status=200" || undetermined "could not record the PUBLISHED line"
  say "LIVE | PUBLISHED: $url status=200"
  exit 0
}

selftest() {
  local t rc fails=0
  t="$(mktemp -d "${TMPDIR:-/tmp}/publish-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  mkdir -p "$t/p/CONTROL" "$t/p/repos/site" "$t/bin"
  : > "$t/p/CONTROL/LEDGER.md"
  printf '{"repoRoot":"%s","remote":"x"}\n' "$t/p/repos/site" > "$t/p/CONTROL/repo-anchor.json"
  printf '#!/bin/sh\necho "Production: https://site-abc.vercel.app [2s]"\necho "Aliased: https://site.vercel.app [2s]"\n' > "$t/bin/vercel"
  printf '#!/bin/sh\nexit 0\n' > "$t/bin/guard"
  # stub curl: answers whatever code sits in $t/code
  printf '#!/bin/sh\ncat "%s/code"\n' "$t" > "$t/bin/curl"
  chmod +x "$t/bin/"*

  # case 1: live -> rc 0, PUBLISHED line carries the ALIAS address
  echo 200 > "$t/code"
  PATH="$t/bin:$PATH" PUBLISH_VERCEL_CMD="$t/bin/vercel" PUBLISH_GUARD_CMD="$t/bin/guard" PUBLISH_WAIT=0 \
    bash "$SELF" "$t/p" >/dev/null 2>&1; rc=$?
  if (( rc == 0 )) && grep -q 'PUBLISHED: https://site.vercel.app ' "$t/p/CONTROL/LEDGER.md"; then
    echo "SELFTEST ok   live deploy -> rc 0 and PUBLISHED line"
  else echo "SELFTEST FAIL live deploy: rc=$rc"; fails=1; fi

  # case 2: never 200 -> rc 3, no new PUBLISHED line
  : > "$t/p/CONTROL/LEDGER.md"; echo 404 > "$t/code"
  PATH="$t/bin:$PATH" PUBLISH_VERCEL_CMD="$t/bin/vercel" PUBLISH_GUARD_CMD="$t/bin/guard" PUBLISH_WAIT=0 PUBLISH_TRIES=2 \
    bash "$SELF" "$t/p" >/dev/null 2>&1; rc=$?
  if (( rc == 3 )) && ! grep -q 'PUBLISHED:' "$t/p/CONTROL/LEDGER.md"; then
    echo "SELFTEST ok   404 -> rc 3 and no PUBLISHED line"
  else echo "SELFTEST FAIL 404 case: rc=$rc"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  ""|-h|--help) sed -n '2,21p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) publish "$1" ;;
esac
