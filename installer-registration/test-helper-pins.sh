#!/usr/bin/env bash
# test-helper-pins.sh — runnable proof that the helper pin guard discriminates
# (KIE-U1 item a). One process, stdlib only, no network, no secrets.
#
#   1. the CURRENT pins equal trevorotts1/openclaw-onboarding origin/main
#      (version and tree hash for skill helpers, file sha256 for files helpers)
#      and every vendored helper folder matches its own pin  -> guard exits 0
#   2. a fixture where openclaw-onboarding has MOVED FORWARD on one skill
#      -> the guard exits 1 and names that helper (stale pin)
#   3. a fixture where openclaw-onboarding has MOVED FORWARD on one pinned
#      shared-utils file -> the guard exits 1 and names that file
#   4. a copy of the vendored helpers whose folder no longer matches the pin
#      -> the guard exits 1 and reports VENDORED DRIFT
#   5. the real tree, re-checked after all of the above, is still clean, so
#      the three failures above came from the fixtures and not from a broken
#      guard
#
# Exits 0 only when every step passes. 2 = an input is missing (a tooling
# failure, never a pass and never a skip).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
PY="${PYTHON:-python3}"
GUARD="$HERE/check-helper-pins.py"
MANIFEST="$HERE/helper-dependencies.json"
HELPERS="$HERE/helpers"

PASS=0
FAIL=0
step() { printf '== %s\n' "$1"; }
ok()   { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/TrevelynsMini2-KIE-U1-pins.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

# ---- locate the openclaw-onboarding checkout (named sources, no bare "absent") ----
ONB="${OPENCLAW_ONBOARDING:-}"
if [ -z "$ONB" ]; then
  for c in "$REPO_ROOT/../openclaw-onboarding" "$HOME/openclaw-onboarding"; do
    if [ -d "$c/.git" ] || git -C "$c" rev-parse --git-dir >/dev/null 2>&1; then
      ONB="$c"; break
    fi
  done
fi
if [ -z "$ONB" ] || ! git -C "$ONB" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  printf 'helper pins test: cannot reach an openclaw-onboarding checkout with origin/main.\n' >&2
  printf '  Checked: $OPENCLAW_ONBOARDING, %s, %s\n' \
    "$REPO_ROOT/../openclaw-onboarding" "$HOME/openclaw-onboarding" >&2
  printf '  Not checked: any remote fetch (this test never uses the network).\n' >&2
  printf '  Repair: git clone https://github.com/trevorotts1/openclaw-onboarding \\\n' >&2
  printf '          "$HOME/openclaw-onboarding" && git -C "$HOME/openclaw-onboarding" fetch origin main\n' >&2
  exit 2
fi
printf 'onboarding: %s @ %s (%s)\n' "$ONB" origin/main \
  "$(git -C "$ONB" rev-parse origin/main)"

run_guard() { # run_guard <expected_rc> <desc> <args...>
  local want="$1" desc="$2"; shift 2
  local out rc
  out="$("$PY" "$GUARD" "$@" 2>&1)"; rc=$?
  LAST_OUT="$out"
  if [ "$rc" -eq "$want" ]; then
    ok "$desc (rc=$rc)"
  else
    bad "$desc — expected rc=$want got rc=$rc"
    printf '%s\n' "$out" | sed 's/^/    | /'
  fi
}

expect_line() {
  if printf '%s\n' "$LAST_OUT" | grep -qF "$1"; then
    ok "$2"
  else
    bad "$2 — output lacks: $1"
    printf '%s\n' "$LAST_OUT" | sed 's/^/    | /'
  fi
}

# ---- a fixture checkout holding exactly the paths the pins cover ----
build_fixture() { # build_fixture <dest>
  local dest="$1"
  rm -rf "$dest"; mkdir -p "$dest"
  local paths
  paths="$("$PY" - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
seen = []
for h in m["helpers"]:
    src = h.get("sourcePath", "")
    if src.startswith("openclaw-onboarding/"):
        src = src[len("openclaw-onboarding/"):]
    if h.get("kind", "skill") == "files":
        for f in h.get("files") or []:
            p = f["sourcePath"]
            if p not in seen:
                seen.append(p)
    elif src and src not in seen:
        seen.append(src)
print("\n".join(seen))
PY
)"
  # shellcheck disable=SC2086
  if ! git -C "$ONB" archive origin/main $paths | tar -x -C "$dest"; then
    return 1
  fi
  [ -f "$dest/67-kie-video/skill-version.txt" ] \
    && [ -f "$dest/shared-utils/kie_prompt_gates.json" ]
}

step "1. current pins equal openclaw-onboarding origin/main"
run_guard 0 "guard passes on the repository as it stands" \
  --onboarding "$ONB" --ref origin/main --manifest "$MANIFEST" --helpers "$HELPERS"

step "2. a pin older than openclaw-onboarding fails the guard (skill helper)"
if build_fixture "$TMP/base"; then
  cp -R "$TMP/base" "$TMP/stale-skill"
  printf 'v99.0.0\n' > "$TMP/stale-skill/67-kie-video/skill-version.txt"
  run_guard 1 "guard fails when 67-kie-video has moved forward upstream" \
    --onboarding "$TMP/stale-skill" --ref HEAD \
    --manifest "$MANIFEST" --helpers "$HELPERS"
  expect_line "67-kie-video: STALE PIN" "stale skill helper is named"
  expect_line "v2.1.3" "the pinned version is reported next to the new one"
else
  bad "could not build an onboarding fixture from $ONB origin/main"
fi

step "3. a pin older than openclaw-onboarding fails the guard (shared file)"
if [ -d "$TMP/base" ]; then
  cp -R "$TMP/base" "$TMP/stale-file"
  printf '\n# upstream edit\n' >> "$TMP/stale-file/shared-utils/kie_prompt_gates.json"
  run_guard 1 "guard fails when kie_prompt_gates.json has moved forward upstream" \
    --onboarding "$TMP/stale-file" --ref HEAD \
    --manifest "$MANIFEST" --helpers "$HELPERS"
  expect_line "kie_prompt_gates.json" "the stale shared file is named"
  expect_line "STALE PIN" "reported as a stale pin"
else
  bad "fixture base missing; cannot prove the files-helper case"
fi

step "4. a vendored folder that drifted from its pin fails the guard"
cp -R "$HELPERS" "$TMP/drifted-helpers"
printf '\n# local edit\n' >> "$TMP/drifted-helpers/66-kie-image/SKILL.md"
run_guard 1 "guard fails when a vendored helper folder differs from its pin" \
  --onboarding "$ONB" --ref origin/main \
  --manifest "$MANIFEST" --helpers "$TMP/drifted-helpers"
expect_line "VENDORED DRIFT" "reported as vendored drift"
expect_line "66-kie-image" "the drifting helper is named"

step "5. the repository itself is still clean after the three failures"
run_guard 0 "guard passes again on the real pins and the real helper folders" \
  --onboarding "$ONB" --ref origin/main --manifest "$MANIFEST" --helpers "$HELPERS"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL PASS"
exit 0
