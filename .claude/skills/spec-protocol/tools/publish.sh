#!/usr/bin/env bash
# publish.sh — STAGE-PUBLISH for a served target (references/publish.md), and the
# draft deploy of STAGE-DRAFT (references/build.md).
#
#   publish.sh <project>           deploy --prod, guard, prove 200, record PUBLISHED
#   publish.sh --draft <project>   preview deploy (no --prod), prove 200, record DRAFT-LIVE
#   publish.sh --selftest          prove it against a stub vercel, stub guard, stub curl
#
# Steps, in order, each one a gate for the next:
#   1. the repo root is read from the repo-anchor.json receipt (tools/repo-anchor.sh)
#      — CONTROL/ on a legacy project, beside documents.state on a profiled one.
#   2. (--prod only) publish.md §8: the last `SHIP-CHECKS: pass=<n>/<n>` line has
#      equal numbers; ship-checks/public-surface.json has rows, all 404 or 403.
#   3. the Vercel CLI and credential (tools/deploy-auth.sh): CLI from PATH, the 999
#      npm prefix, or `npx --yes vercel@latest`; VERCEL_TOKEN from the environment
#      or parsed from operator.env, handed ONLY to the vercel child's environment,
#      never printed, never on a command line, never asked of the client.
#   4. `vercel deploy --prod --yes` (or `vercel deploy --yes` for --draft) in the root;
#      --draft then turns Vercel's default preview protection off (API PATCH, same token).
#   5. (--prod only) tools/ship-guard.sh <project> <url> <repo-root> at the LIVE address.
#   6. curl the address until it answers 200 (PUBLISH_TRIES tries, PUBLISH_WAIT s apart).
#   7. --prod: SHIP-GUARD: rc=0 … then PUBLISHED: <url> …; --draft: DRAFT-LIVE: <url>.
#      Through tools/ledger.sh (legacy), or appended to <state dir>/published.log
#      (profiled: ledger.sh refuses those).
#
# TARGETS THAT ARE NOT VERCEL'S. The targets are the profile's `targets` (profiled) or
# the last `BUILD-TARGET:` (legacy). Vercel is called ONLY for a web target. A desktop
# target (`desktop`, `desktop-*`, `DESKTOP_SOFTWARE`) locates its installer under the
# repo root (or $PUBLISH_ARTIFACT) and records `PUBLISHED: <path> target=<t>
# status=artifact`; a self-hosted target (`linux-vps-*`, `*-docker`, `self-hosted-*`)
# records `HOSTING-SELF: target=<t> package=<path|none> next=<install step>`. Neither
# is a failure and neither touches Vercel or the public-surface guard (the equal
# SHIP-CHECKS line is still required on --prod). --draft makes no preview for them.
# A project that also has a web target goes on to the Vercel path for it.
#
# Every failure after the project folder is found writes `HOSTING-BLOCKED: <reason>`
# the same way and names the next step — a run is never left with no line.
#
# Exit: 0 live (PUBLISHED / DRAFT-LIVE written) | 3 not live (preconditions unmet,
#       guard refused, or no 200) | 2 blocked/undetermined (no receipt, no CLI,
#       deploy failed, guard could not decide) | 1 usage
#
# Test seams (the selftest uses them): PUBLISH_VERCEL_CMD, PUBLISH_GUARD_CMD.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DIR="$(dirname "$SELF")"
# shellcheck source=deploy-auth.sh
. "$DIR/deploy-auth.sh"
GUARD="${PUBLISH_GUARD_CMD:-$DIR/ship-guard.sh}"
TRIES="${PUBLISH_TRIES:-10}"
WAIT="${PUBLISH_WAIT:-6}"
HOME_DIR=""

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

blocked() { # blocked <rc> <reason> <next step> — HOSTING-BLOCKED line, then exit
  record "$HOME_DIR" "HOSTING-BLOCKED: $2" 2>/dev/null || say "could not record the HOSTING-BLOCKED line"
  say "HOSTING-BLOCKED | $2"
  say "NEXT | $3"
  exit "$1"
}

ship_ready() { # ship_ready <home> <state dir> [checks-only] — publish.md §8; prints the unmet one, rc 1
  local line n m
  line="$(grep -hEo 'SHIP-CHECKS: pass=[0-9]+/[0-9]+' "$1/CONTROL/LEDGER.md" "$2"/* 2>/dev/null | tail -1)"
  n="${line#*=}"; m="${n#*/}"; n="${n%/*}"
  if [[ -z "$line" || "$n" != "$m" || "$n" == 0 ]]; then
    printf 'no SHIP-CHECKS: pass=<n>/<n> line with equal numbers (last: %s)' "${line:-none}"; return 1
  fi
  [[ "${3:-}" != checks-only ]] || return 0
  python3 -c 'import json,sys
rows=json.load(open(sys.argv[1])).get("paths") or []
sys.exit(0 if rows and all(str(r.get("status")) in ("404","403") for r in rows) else 1)' \
    "$1/ship-checks/public-surface.json" 2>/dev/null \
    || { printf 'ship-checks/public-surface.json is missing, empty, or has a row that is not 404/403'; return 1; }
}

targets_of() { # targets_of <home> <state dir> -> one target per line (none: empty)
  if [[ -f "$1/.spec-protocol.json" ]]; then
    python3 -c 'import json,sys
for t in json.load(open(sys.argv[1])).get("targets") or []: print(t)' "$1/.spec-protocol.json" 2>/dev/null
  else
    grep -hEo 'BUILD-TARGET: [A-Z_]+' "$1/CONTROL/LEDGER.md" 2>/dev/null | tail -1 | sed 's/.*: //'
  fi
}

target_kind() { # target_kind <target> -> desktop | self | web
  case "$1" in
    desktop|desktop-*|DESKTOP_SOFTWARE) echo desktop ;;
    linux-vps|linux-vps-*|docker|*-docker|self-hosted|self-hosted-*) echo self ;;
    *) echo web ;;
  esac
}

newest_installer() { # newest_installer <root> -> the newest installer file under it, or nothing
  local f
  find "$1" -maxdepth 8 \( -name node_modules -o -name .git \) -prune -o -type f \( -name '*.dmg' \
    -o -name '*.pkg' -o -name '*.exe' -o -name '*.msi' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) \
    -print 2>/dev/null | while IFS= read -r f; do
      printf '%s\t%s\n' "$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)" "$f"
    done | sort -rn | head -1 | cut -f2-
}

publish_local() { # publish_local <home> <root> <target> — rc 0 recorded, 1 HOSTING-BLOCKED recorded
  local home="$1" root="$2" t="$3" art pkg="" next f
  if [[ "$(target_kind "$t")" == desktop ]]; then
    art="${PUBLISH_ARTIFACT:-$(newest_installer "$root")}"
    if [[ -z "$art" || ! -f "$art" ]]; then
      record "$home" "HOSTING-BLOCKED: no desktop installer for target=$t under $root" 2>/dev/null || say "could not record the HOSTING-BLOCKED line"
      say "HOSTING-BLOCKED | no desktop installer (.dmg/.pkg/.exe/.msi/.AppImage/.deb/.rpm) for target=$t under $root"
      say "NEXT | build the unsigned installer (references/publish.md, DESKTOP_SOFTWARE), then rerun tools/publish.sh"
      return 1
    fi
    record "$home" "PUBLISHED: $art target=$t status=artifact" || undetermined "could not record the PUBLISHED line"
    say "ARTIFACT | PUBLISHED: $art target=$t status=artifact"
    return 0
  fi
  for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml Dockerfile; do
    [[ -f "$root/$f" ]] && { pkg="$root/$f"; break; }
  done
  case "$pkg" in
    "") next="run the project's own install step on the host (its README)" ;;
    */Dockerfile) next="docker build and run $pkg on the host" ;;
    *) next="docker compose -f $pkg up -d on the host" ;;
  esac
  record "$home" "HOSTING-SELF: target=$t package=${pkg:-none} next=$next" || undetermined "could not record the HOSTING-SELF line"
  say "SELF-HOSTED | HOSTING-SELF: target=$t package=${pkg:-none} next=$next"
}

prove_200() { # prove_200 <url> -> sets CODE
  local i
  CODE=000
  for (( i = 1; i <= TRIES; i++ )); do
    CODE="$(curl -sS -L -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null)" || CODE=000
    [[ "$CODE" == 200 ]] && return 0
    (( i < TRIES )) && sleep "$WAIT"
  done
  return 1
}

publish() { # publish <prod|draft> <project>
  local mode="$1" home="${2%/}" sd root out rc url checks target reason
  HOME_DIR="$home"
  [[ -d "$home" ]] || undetermined "no project folder at $home"
  sd="$(state_dir "$home")" || undetermined "$home/.spec-protocol.json has no readable in-root documents.state"
  root="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repoRoot"])' "$sd/repo-anchor.json" 2>/dev/null)" \
    || blocked 2 "no repo-anchor receipt at $sd/repo-anchor.json" "run tools/repo-anchor.sh $home, then rerun tools/publish.sh"
  [[ -d "$root" ]] || blocked 2 "the receipt's repoRoot $root is not a folder" "rerun tools/repo-anchor.sh $home"

  # Targets that are not Vercel's are recorded here and never reach Vercel.
  local t web=0 local_rc=0 nonweb=()
  while IFS= read -r t; do
    [[ -n "$t" ]] || continue
    if [[ "$(target_kind "$t")" == web ]]; then web=1; else nonweb+=("$t"); fi
  done < <(targets_of "$home" "$sd")
  (( ${#nonweb[@]} > 0 )) || web=1
  if (( ${#nonweb[@]} > 0 )); then
    if [[ "$mode" == draft ]]; then
      say "DRAFT | no Vercel preview for target(s) ${nonweb[*]} (not hosted on Vercel)"
    else
      reason="$(ship_ready "$home" "$sd" checks-only)" \
        || blocked 3 "preconditions unmet: $reason" "finish STAGE-SHIP-CHECKS (references/ship-checks.md) until it passes, then rerun tools/publish.sh"
      for t in "${nonweb[@]}"; do publish_local "$home" "$root" "$t" || local_rc=3; done
    fi
    (( web == 1 )) || exit "$local_rc"
  fi

  if [[ "$mode" == prod ]]; then
    reason="$(ship_ready "$home" "$sd")" \
      || blocked 3 "preconditions unmet: $reason" "finish STAGE-SHIP-CHECKS (references/ship-checks.md) until it passes, then rerun tools/publish.sh"
  fi

  vercel_resolve "${PUBLISH_VERCEL_CMD:-}" \
    || blocked 2 "no Vercel CLI (not on PATH, not in the 999 npm prefix, and no npx)" \
         "re-run nine-router-setup (it installs the Vercel CLI), then rerun tools/publish.sh"

  # deploy. Output is kept for the URL only; on failure the last lines are shown
  # with the credential masked (tools/deploy-auth.sh).
  if [[ "$mode" == prod ]]; then out="$(cd "$root" && vercel_run deploy --prod --yes)"; rc=$?
  else out="$(cd "$root" && vercel_run deploy --yes)"; rc=$?; fi
  if (( rc != 0 )); then
    printf '%s\n' "$out" | tail -5
    # Neither a token nor a `vercel login` session: say that, with ONE step.
    if [[ -z "$(_vercel_token)" ]] && { vercel_login_state; (( $? == 3 )); }; then
      blocked 2 "no hosting login on this computer: no Vercel token and no vercel login session (CLI: $VERCEL_WHERE)" \
        "$HOSTING_LOGIN_NEXT, then rerun tools/publish.sh"
    fi
    blocked 2 "vercel deploy exited $rc in $root (CLI: $VERCEL_WHERE)" \
      "give this machine the operator's Vercel credential — VERCEL_TOKEN=... in ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/spec-protocol/operator.env, or \`vercel login\` — then rerun tools/publish.sh"
  fi
  # Prefer the production alias (public); else the last deployment https URL printed
  # (the vercel.com dashboard/inspect links are not the site).
  url="$(printf '%s\n' "$out" | grep -E 'Aliased:' | grep -Eo 'https://[^ ]+' | tail -1)"
  [[ -n "$url" ]] || url="$(printf '%s\n' "$out" | grep -Eo 'https://[^ ]+' | grep -v '^https://vercel\.com/' | tail -1)"
  url="${url%]}"
  [[ -n "$url" ]] || blocked 2 "vercel deploy exited 0 but printed no https:// address" "rerun tools/publish.sh and read the CLI output"
  say "deployed: $url"

  if [[ "$mode" == draft ]]; then
    # Vercel protects previews by default (401). Turned off here, after the deploy so a
    # first deploy's fresh .vercel/project.json exists; protection is checked per request.
    if vercel_unprotect_previews "$root"; then say "preview protection off"
    else say "could not turn preview protection off: $UNPROTECT_WHY"; fi
    if ! prove_200 "$url"; then
      if [[ "$CODE" == 401 ]]; then
        blocked 3 "draft $url answered 401 (Vercel Deployment Protection is on for previews; ${UNPROTECT_WHY:-the PATCH succeeded})" \
          "in the Vercel project's Settings > Deployment Protection, turn Vercel Authentication off for previews, then rerun tools/publish.sh --draft"
      fi
      blocked 3 "draft $url answered $CODE after $TRIES tries" "fix the build so the preview answers, then rerun tools/publish.sh --draft"
    fi
    record "$home" "DRAFT-LIVE: $url" || undetermined "could not record the DRAFT-LIVE line"
    say "DRAFT | DRAFT-LIVE: $url status=200"
    exit 0
  fi

  # the guard at the live origin.
  "$GUARD" "$home" "$url" "$root"; rc=$?
  case "$rc" in
    0) ;;
    3|4|5) blocked 3 "ship-guard.sh exited $rc at $url" "fix what the guard named, then rerun tools/publish.sh" ;;
    *) blocked 2 "ship-guard.sh exited $rc at $url — the guard could not decide" "make $url reachable, then rerun tools/publish.sh" ;;
  esac

  prove_200 "$url" || blocked 3 "$url answered $CODE after $TRIES tries" "fix the deploy so the address answers 200, then rerun tools/publish.sh"

  # record: guard line first, then the address.
  checks="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(len(d.get("paths",[]))+len(d.get("destinations",[])))' \
    "$home/ship-checks/public-surface.json" 2>/dev/null)" || checks=unknown
  # BUILD-TARGET lives in CONTROL/LEDGER.md (legacy) or the bound state beside documents.state (profiled)
  target="$(grep -hEo 'BUILD-TARGET: [A-Z_]+' "$home/CONTROL/LEDGER.md" "$sd"/* 2>/dev/null | tail -1 | sed 's/.*: //')"
  record "$home" "SHIP-GUARD: rc=0 checks=${checks} at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" || undetermined "could not record the SHIP-GUARD line"
  record "$home" "PUBLISHED: $url target=${target:-served} domain=none status=200" || undetermined "could not record the PUBLISHED line"
  say "LIVE | PUBLISHED: $url status=200"
  exit 0
}

selftest() {
  local t rc fails=0 L
  t="$(mktemp -d "${TMPDIR:-/tmp}/publish-st.XXXXXX")" || exit 2
  trap 'rm -rf "$t"' EXIT
  mkdir -p "$t/p/CONTROL" "$t/p/repos/site" "$t/p/ship-checks" "$t/bin" "$t/cfg/spec-protocol"
  L="$t/p/CONTROL/LEDGER.md"
  printf '{"repoRoot":"%s","remote":"x"}\n' "$t/p/repos/site" > "$t/p/CONTROL/repo-anchor.json"
  printf '{"paths":[{"path":"CONTROL/","status":"404"}],"destinations":[]}\n' > "$t/p/ship-checks/public-surface.json"
  # stub vercel: records whether the credential reached it, prints a preview or prod address
  cat > "$t/bin/vercel" <<EOF
#!/bin/sh
[ -n "\$VERCEL_TOKEN" ] && echo "\$VERCEL_TOKEN" > "$t/tok-seen"
case " \$* " in *" --prod "*) echo "Production: https://site-abc.vercel.app [2s]"; echo "Aliased: https://site.vercel.app [2s]" ;;
  *) echo "Inspect: https://vercel.com/team/site/xyz [1s]"; echo "Preview: https://site-git-draft.vercel.app [2s]" ;; esac
EOF
  printf '#!/bin/sh\nexit 0\n' > "$t/bin/guard"
  # stub curl: the PATCH saves its stdin/argv and flips the site to 200; else answers $t/code
  cat > "$t/bin/curl" <<EOF
#!/bin/sh
case " \$* " in *" PATCH "*) cat > "$t/patch-in"; echo "\$*" > "$t/patch-args"; echo 200 > "$t/code"; echo 200; exit 0 ;; esac
cat "$t/code"
EOF
  chmod +x "$t/bin/"*
  printf 'VERCEL_TOKEN="st-secret-123"\n' > "$t/cfg/spec-protocol/operator.env"
  run() { env -u VERCEL_TOKEN PATH="$t/bin:$PATH" CLAUDE_CONFIG_DIR="$t/cfg" PUBLISH_VERCEL_CMD="$t/bin/vercel" \
            PUBLISH_GUARD_CMD="$t/bin/guard" PUBLISH_WAIT=0 PUBLISH_TRIES=2 bash "$SELF" "$@"; }

  # case 1: live -> rc 0, PUBLISHED carries the ALIAS; credential reached the child, never the output
  printf 'SHIP-CHECKS: pass=11/11\n' > "$L"; echo 200 > "$t/code"
  out="$(run "$t/p" 2>&1)"; rc=$?
  if (( rc == 0 )) && grep -q 'PUBLISHED: https://site.vercel.app ' "$L" \
     && [[ "$(cat "$t/tok-seen" 2>/dev/null)" == st-secret-123 ]] && [[ "$out" != *st-secret-123* ]]; then
    echo "SELFTEST ok   live deploy -> rc 0, PUBLISHED line, operator.env credential reached vercel only"
  else echo "SELFTEST FAIL live deploy: rc=$rc"; fails=1; fi

  # case 2: never 200 -> rc 3, no PUBLISHED line, a HOSTING-BLOCKED line
  printf 'SHIP-CHECKS: pass=11/11\n' > "$L"; echo 404 > "$t/code"
  run "$t/p" >/dev/null 2>&1; rc=$?
  if (( rc == 3 )) && ! grep -q 'PUBLISHED:' "$L" && grep -q 'HOSTING-BLOCKED:' "$L"; then
    echo "SELFTEST ok   404 -> rc 3, no PUBLISHED line, HOSTING-BLOCKED written"
  else echo "SELFTEST FAIL 404 case: rc=$rc"; fails=1; fi

  # case 3: unequal SHIP-CHECKS -> refused before any deploy
  printf 'SHIP-CHECKS: pass=10/11\n' > "$L"; echo 200 > "$t/code"; rm -f "$t/tok-seen"
  run "$t/p" >/dev/null 2>&1; rc=$?
  if (( rc == 3 )) && [[ ! -e "$t/tok-seen" ]] && grep -q 'HOSTING-BLOCKED: preconditions unmet' "$L"; then
    echo "SELFTEST ok   SHIP-CHECKS 10/11 -> rc 3, no deploy"
  else echo "SELFTEST FAIL precondition case: rc=$rc"; fails=1; fi

  # case 4: --draft on a protected preview (401) -> PATCH turns protection off (token on
  # stdin only, teamId from orgId), then 200 and DRAFT-LIVE with the preview address
  : > "$L"; echo 401 > "$t/code"; mkdir -p "$t/p/repos/site/.vercel"
  printf '{"projectId":"prj_st1","orgId":"team_st9"}\n' > "$t/p/repos/site/.vercel/project.json"
  run --draft "$t/p" >/dev/null 2>&1; rc=$?
  if (( rc == 0 )) && grep -q 'DRAFT-LIVE: https://site-git-draft.vercel.app' "$L" \
     && grep -q 'v9/projects/prj_st1?teamId=team_st9' "$t/patch-args" && grep -q 'ssoProtection' "$t/patch-args" \
     && grep -q st-secret-123 "$t/patch-in" && ! grep -q st-secret-123 "$t/patch-args"; then
    echo "SELFTEST ok   --draft 401 -> protection PATCHed off (token on stdin only) -> DRAFT-LIVE"
  else echo "SELFTEST FAIL draft case: rc=$rc"; fails=1; fi

  # case 5: deploy fails -> rc 2 and HOSTING-BLOCKED with the next step
  : > "$L"; printf '#!/bin/sh\necho "Error: not authorized"\nexit 1\n' > "$t/bin/vercel"
  out="$(run --draft "$t/p" 2>&1)"; rc=$?
  if (( rc == 2 )) && grep -q 'HOSTING-BLOCKED: vercel deploy exited 1' "$L" && [[ "$out" == *"NEXT |"* ]]; then
    echo "SELFTEST ok   failed deploy -> rc 2, HOSTING-BLOCKED and a named next step"
  else echo "SELFTEST FAIL failed-deploy case: rc=$rc"; fails=1; fi

  # case 5b: no token anywhere and no `vercel login` session -> the blocked line says
  # so and the next step is the one plain login step
  : > "$L"; printf '#!/bin/sh\necho "Error: No existing credentials found. Please run \\`vercel login\\` or pass --token"\nexit 1\n' > "$t/bin/vercel"
  out="$(env -u VERCEL_TOKEN PATH="$t/bin:$PATH" CLAUDE_CONFIG_DIR="$t/nocfg" PUBLISH_VERCEL_CMD="$t/bin/vercel" \
           PUBLISH_GUARD_CMD="$t/bin/guard" PUBLISH_WAIT=0 PUBLISH_TRIES=2 bash "$SELF" --draft "$t/p" 2>&1)"; rc=$?
  if (( rc == 2 )) && grep -q 'HOSTING-BLOCKED: no hosting login on this computer' "$L" \
     && [[ "$out" == *"NEXT | open Terminal on this computer, type vercel login"* ]]; then
    echo "SELFTEST ok   no token and no login -> rc 2, HOSTING-BLOCKED names the one login step"
  else echo "SELFTEST FAIL no-login case: rc=$rc"; fails=1; fi

  # case 6: a profiled project (a folder name with spaces) whose targets are desktop +
  # self-hosted: Vercel is never called; PUBLISHED status=artifact and HOSTING-SELF land
  # in the state dir's published.log; rc 0
  local pp="$t/My Project Folder"
  mkdir -p "$pp/state" "$pp/dist"
  python3 -c 'import json,sys;json.dump({"documents":{"state":"state/state.json"},"targets":["desktop-macos-arm64","linux-vps-web"]},open(sys.argv[1],"w"))' "$pp/.spec-protocol.json"
  printf '{"repoRoot":"%s","remote":null}\n' "$pp" > "$pp/state/repo-anchor.json"
  printf 'SHIP-CHECKS: pass=4/4\n' > "$pp/state/notes.md"
  : > "$pp/dist/My App.dmg"; : > "$pp/docker-compose.yml"
  printf '#!/bin/sh\ntouch "%s/vercel-called"\n' "$t" > "$t/bin/vercel"
  run "$pp" >/dev/null 2>&1; rc=$?
  if (( rc == 0 )) && [[ ! -e "$t/vercel-called" ]] \
     && grep -q "PUBLISHED: $pp/dist/My App.dmg target=desktop-macos-arm64 status=artifact" "$pp/state/published.log" \
     && grep -q "HOSTING-SELF: target=linux-vps-web package=$pp/docker-compose.yml next=docker compose" "$pp/state/published.log"; then
    echo "SELFTEST ok   desktop + self-hosted targets -> rc 0, no Vercel call, PUBLISHED status=artifact + HOSTING-SELF"
  else echo "SELFTEST FAIL non-Vercel targets case: rc=$rc"; fails=1; fi
  exit "$fails"
}

case "${1:-}" in
  --selftest) selftest ;;
  --draft) [[ -n "${2:-}" ]] || { echo "usage: publish.sh --draft <project>" >&2; exit 1; }; publish draft "$2" ;;
  ""|-h|--help) sed -n '2,33p' "$SELF" | sed 's/^# \{0,1\}//'; exit 1 ;;
  *) publish prod "$1" ;;
esac
