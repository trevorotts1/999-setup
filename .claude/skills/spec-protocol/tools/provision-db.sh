#!/usr/bin/env bash
# provision-db.sh — give a WEB_APP / MOBILE_AND_WEB project its Postgres database
# before the first builder runs.
#
#   provision-db.sh <project>     provision (idempotent)
#   provision-db.sh --selftest    prove it against a stub vercel
#
# "Vercel Postgres" is now sold through the Vercel Marketplace; the Postgres product
# is Neon (slug `neon`, confirmed with `vercel integration discover postgres`,
# Vercel CLI 54.21.0). The command, as `vercel integration add --help` shows it:
#
#   vercel integration add neon --name <slug>-db --non-interactive
#
# run in the repo root (the repo-anchor.json receipt names it) — after
# `vercel link --yes --project <slug>` when the root has no .vercel/project.json yet —
# which creates the
# database, connects it to the linked Vercel project and writes its connection
# variables (DATABASE_URL and friends) into that project's environment for
# production, preview and development. No value is ever read or printed here:
# only variable NAMES are checked, with `vercel env ls production`.
#
# Idempotent: when DATABASE_URL or POSTGRES_URL is already set on the project,
# nothing is created.
#
# Every failure after the project folder is found writes `DATABASE-BLOCKED: <reason>`
# (ledger, or <state dir>/provision-db.log when profiled) and names the NEXT step.
#
# Exit: 0 provisioned or already present | 3 the add ran but no variable appeared |
#       2 undetermined (no receipt, CLI failed, not linked, not logged in) | 1 usage
#
# UNVERIFIED on a live account from this repo: the first Marketplace install on a
# team may require accepting Neon's terms once in a browser
# (`vercel integration accept-terms neon`); that surfaces here as rc 2 with the
# CLI's own last lines.
#
# The CLI and the operator's credential come from tools/deploy-auth.sh (PATH, the 999
# npm prefix, or npx; VERCEL_TOKEN handed only to the vercel child).
#
# Test seam (the selftest uses it): PROVISION_VERCEL_CMD.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
# shellcheck source=deploy-auth.sh
. "$DIR/deploy-auth.sh"

say() { printf 'PROVISION-DB | %s\n' "$*"; }
undetermined() { say "UNDETERMINED | $*"; exit 2; }
HOME_DIR=""

state_dir() { # CONTROL/ (legacy) or dirname(documents.state) (profiled)
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
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$(state_dir "$1")/provision-db.log"
  else
    "$DIR/ledger.sh" "$1" CONTROL/LEDGER.md "$2" >/dev/null
  fi
}

blocked() { # blocked <rc> <reason> <next step> — DATABASE-BLOCKED line, then exit
  record "$HOME_DIR" "DATABASE-BLOCKED: $2" 2>/dev/null || say "could not record the DATABASE-BLOCKED line"
  say "DATABASE-BLOCKED | $2"
  say "NEXT | $3"
  exit "$1"
}

db_vars() { # db_vars <root> -> prints the DB variable names present; rc 2 when env ls fails
  local out
  out="$(cd "$1" && vercel_run env ls production)" || { printf '%s\n' "$out" | tail -5 >&2; return 2; }
  { printf '%s\n' "$out" | grep -Eo '\b(DATABASE_URL|POSTGRES_URL)\b' || true; } | sort -u | tr '\n' ' '
}

provision() {
  local home="${1%/}" sd root vars out rc slug
  HOME_DIR="$home"
  [[ -d "$home" ]] || undetermined "no project folder at $home"
  sd="$(state_dir "$home")" || undetermined "$home/.spec-protocol.json has no readable in-root documents.state"
  root="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repoRoot"])' "$sd/repo-anchor.json" 2>/dev/null)" \
    || blocked 2 "no repo-anchor receipt at $sd/repo-anchor.json" "run tools/repo-anchor.sh $home, then rerun tools/provision-db.sh"
  [[ -d "$root" ]] || blocked 2 "the receipt's repoRoot $root is not a folder" "rerun tools/repo-anchor.sh $home, then rerun tools/provision-db.sh"

  slug="$(basename "$root" | tr -cs 'a-zA-Z0-9-' '-' | sed 's/^-*//; s/-*$//' | tr 'A-Z' 'a-z')"
  vercel_resolve "${PROVISION_VERCEL_CMD:-}" \
    || blocked 2 "no Vercel CLI (not on PATH, not in the 999 npm prefix, and no npx)" \
         "re-run nine-router-setup (it installs the Vercel CLI), then rerun tools/provision-db.sh"
  if [[ ! -f "$root/.vercel/project.json" ]]; then
    out="$(cd "$root" && vercel_run link --yes --project "${slug:-project}")"; rc=$?
    if (( rc != 0 )); then
      printf '%s\n' "$out" | tail -5
      blocked 2 "vercel link --yes --project ${slug:-project} exited $rc in $root" \
        "give this machine the operator's Vercel credential (VERCEL_TOKEN in operator.env, or \`vercel login\`), then rerun tools/provision-db.sh"
    fi
    say "LINKED | $root -> Vercel project ${slug:-project}"
  fi

  vars="$(db_vars "$root")" || blocked 2 "vercel env ls production failed in $root (not linked, or not logged in)" \
    "give this machine the operator's Vercel credential (VERCEL_TOKEN in operator.env, or \`vercel login\`), then rerun tools/provision-db.sh"
  if [[ -n "${vars// /}" ]]; then
    say "ALREADY | $vars set on the Vercel project; nothing created"
    exit 0
  fi

  out="$(cd "$root" && vercel_run integration add neon --name "${slug:-project}-db" --non-interactive)"; rc=$?
  if (( rc != 0 )); then
    printf '%s\n' "$out" | tail -5
    blocked 2 "vercel integration add neon exited $rc in $root" \
      "if the lines above ask for Neon's terms, run \`vercel integration accept-terms neon\` once in a browser session; then rerun tools/provision-db.sh"
  fi

  vars="$(db_vars "$root")" || blocked 2 "vercel env ls production failed after the add" "rerun tools/provision-db.sh (it is idempotent)"
  if [[ -z "${vars// /}" ]]; then
    blocked 3 "the add exited 0 but no DATABASE_URL/POSTGRES_URL is on the project" \
      "open the Vercel project's Storage tab, connect the Neon database to it, then rerun tools/provision-db.sh"
  fi
  record "$home" "DATABASE: provider=neon via=vercel-marketplace vars=${vars% }" || undetermined "could not record the DATABASE line"
  say "PROVISIONED | $vars"
  exit 0
}

selftest() {
  local t rc fails=0
  t="$(mktemp -d "${TMPDIR:-/tmp}/provdb-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  mkdir -p "$t/p/CONTROL" "$t/p/repos/site"
  : > "$t/p/CONTROL/LEDGER.md"
  printf '{"repoRoot":"%s","remote":"x"}\n' "$t/p/repos/site" > "$t/p/CONTROL/repo-anchor.json"
  # stub vercel: `env ls` lists DATABASE_URL once `add` has run (marker file); counts adds.
  cat > "$t/vercel" <<EOF
#!/bin/sh
case "\$1" in
  env) [ -f "$t/added" ] && echo "DATABASE_URL  Encrypted  Production"; exit 0 ;;
  integration) echo x >> "$t/adds"; touch "$t/added"; exit 0 ;;
  link) echo x >> "$t/links"; mkdir -p .vercel && echo '{}' > .vercel/project.json; exit 0 ;;
esac
exit 1
EOF
  chmod +x "$t/vercel"

  # run twice: first links + provisions, second is a no-op -> one link, one add, two rc 0, one DATABASE line
  PROVISION_VERCEL_CMD="$t/vercel" bash "$SELF" "$t/p" >/dev/null 2>&1; rc=$?
  PROVISION_VERCEL_CMD="$t/vercel" bash "$SELF" "$t/p" >/dev/null 2>&1; rc=$((rc + $?))
  if (( rc == 0 )) && [[ "$(wc -l < "$t/adds" | tr -d ' ')" == 1 ]] && [[ "$(wc -l < "$t/links" | tr -d ' ')" == 1 ]] \
     && [[ "$(grep -c 'DATABASE: provider=neon' "$t/p/CONTROL/LEDGER.md")" == 1 ]]; then
    echo "SELFTEST ok   links once, provisions once, second run is a no-op, one DATABASE line"
  else echo "SELFTEST FAIL idempotent provision: rc=$rc"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  ""|-h|--help) sed -n '2,36p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) provision "$1" ;;
esac
