#!/usr/bin/env bash
# test-kie-amendments.sh — the two KIE-U1 amendment proofs that must RUN
# (U1-a and U1-b). One process, stdlib only, no network, no secrets.
#
# U1-a  the pinned 74-kie-live-adapter tree carries vendor-approval.json that
#       is byte-identical to openclaw-onboarding origin/main (proven with cmp),
#       and that file is covered by the 74 pin.
#
# U1-b  no helper-dependencies.json entry and no vendored folder may be named
#       kie-models or kie-chat-agents — the KIE vendor skills are never
#       installed (rule 14). Proven with negative controls: an injected entry
#       and an injected folder each make the guard fail.
#
# Exits 0 only when every step passes. 2 = an input is missing (a tooling
# failure, never a pass and never a skip).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
PY="${PYTHON:-python3}"
GUARD="$HERE/check-helper-pins.py"
DEP="$HERE/helper-deps.py"
MANIFEST="$HERE/helper-dependencies.json"
HELPERS="$HERE/helpers"
VA_REL="74-kie-live-adapter/vendor-approval.json"

PASS=0
FAIL=0
step() { printf '== %s\n' "$1"; }
ok()   { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

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
  printf 'kie amendments test: cannot reach an openclaw-onboarding checkout with origin/main.\n' >&2
  printf '  Checked: $OPENCLAW_ONBOARDING, %s, %s\n' \
    "$REPO_ROOT/../openclaw-onboarding" "$HOME/openclaw-onboarding" >&2
  printf '  Not checked: any remote fetch (this test never uses the network).\n' >&2
  exit 2
fi
printf 'onboarding: %s @ origin/main (%s)\n' "$ONB" \
  "$(git -C "$ONB" rev-parse origin/main)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/TrevelynsMini2-KIE-U1-amend.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

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

# =====================================================================
step "1. U1-a: pinned 74 tree carries vendor-approval.json (openclaw origin/main)"

if ! git -C "$ONB" show "origin/main:$VA_REL" > "$TMP/upstream-va.json" 2>/dev/null; then
  bad "openclaw-onboarding origin/main has no $VA_REL"
else
  ok "openclaw-onboarding origin/main carries $VA_REL"
  if [ -f "$HELPERS/$VA_REL" ]; then
    ok "vendored 74 tree carries $VA_REL"
  else
    bad "vendored 74 tree is missing $HELPERS/$VA_REL"
  fi
  if [ -f "$HELPERS/$VA_REL" ] && cmp -s "$TMP/upstream-va.json" "$HELPERS/$VA_REL"; then
    ok "cmp: vendored vendor-approval.json is byte-identical to origin/main"
  else
    bad "cmp: vendored vendor-approval.json differs from origin/main ($VA_REL)"
    if [ -f "$HELPERS/$VA_REL" ]; then
      cmp "$TMP/upstream-va.json" "$HELPERS/$VA_REL" 2>&1 | sed 's/^/    | /'
    fi
  fi

  # negative control: cmp must refuse a mutated copy, so the cmp above means
  # something (not a cmp that always returns 0)
  cp "$TMP/upstream-va.json" "$TMP/mutated-va.json"
  printf ' \n' >> "$TMP/mutated-va.json"
  if cmp -s "$TMP/upstream-va.json" "$TMP/mutated-va.json"; then
    bad "negative control: cmp accepted a mutated vendor-approval.json"
  else
    ok "negative control: cmp rejects a mutated vendor-approval.json (rc!=0)"
  fi

  # the file is part of the 74 pin: drop it from a copy of the helpers tree
  # and the guard must call it vendored drift
  cp -R "$HELPERS" "$TMP/no-va-helpers"
  rm -f "$TMP/no-va-helpers/$VA_REL"
  run_guard 1 "guard fails when vendor-approval.json is dropped from the 74 pin" \
    --onboarding "$ONB" --ref origin/main \
    --manifest "$MANIFEST" --helpers "$TMP/no-va-helpers"
  expect_line "VENDORED DRIFT" "the dropped file is reported as vendored drift"
  expect_line "74-kie-live-adapter" "the 74 helper is named"
fi

# =====================================================================
step "2. U1-b: no kie-models / kie-chat-agents entry or folder exists today"

run_guard 0 "guard passes on the repository as it stands (no vendor skills)" \
  --onboarding "$ONB" --ref origin/main \
  --manifest "$MANIFEST" --helpers "$HELPERS"

if [ -d "$HELPERS/kie-models" ] || [ -d "$HELPERS/kie-chat-agents" ]; then
  bad "a vendored vendor-skill folder exists under installer-registration/helpers/"
else
  ok "no kie-models or kie-chat-agents folder under installer-registration/helpers/"
fi

# =====================================================================
step "3. U1-b negative control: an injected manifest entry fails the guard"

"$PY" - "$MANIFEST" "$TMP/banned-manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
m["helpers"].append({
    "id": "kie-models", "name": "kie-models", "skillName": "kie-models",
    "role": "vendor skill (must never be installed)",
    "kind": "skill", "required": True, "version": "v0.0.0",
    "sourceRepo": "https://github.com/trevorotts1/openclaw-onboarding",
    "sourcePath": "openclaw-onboarding/kie-models",
    "installPath": "skills/kie-models",
    "fileCount": 0, "sizeBytes": 0,
    "treeSha256": "0" * 64,
    "skillMdSha256": "0" * 64,
})
json.dump(m, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
PY
if [ -f "$TMP/banned-manifest.json" ]; then
  run_guard 1 "guard fails when a kie-models entry is injected into the manifest" \
    --onboarding "$ONB" --ref origin/main \
    --manifest "$TMP/banned-manifest.json" --helpers "$HELPERS"
  expect_line "VENDOR SKILL BANNED" "the banned entry is reported by name"
  expect_line "kie-models" "kie-models appears in the failure output"
else
  bad "could not build the injected-manifest fixture"
fi

# =====================================================================
step "4. U1-b negative control: an injected vendored folder fails the guard"

cp -R "$HELPERS" "$TMP/banned-helpers"
mkdir -p "$TMP/banned-helpers/kie-chat-agents/references"
printf '# vendor skill — must never ship\n' > "$TMP/banned-helpers/kie-chat-agents/SKILL.md"
run_guard 1 "guard fails when a kie-chat-agents folder is added to helpers/" \
  --onboarding "$ONB" --ref origin/main \
  --manifest "$MANIFEST" --helpers "$TMP/banned-helpers"
expect_line "VENDOR SKILL BANNED" "the banned folder is reported"
expect_line "kie-chat-agents" "kie-chat-agents appears in the failure output"

# =====================================================================
step "5. U1-b: a real install run never lands a vendor skill"

ROOT="$TMP/config-root"
if "$PY" "$DEP" install --root "$ROOT" --backup-dir "$TMP/backups" >/dev/null 2>&1; then
  ok "helper install into a temporary root exited 0"
  if [ -d "$ROOT/skills/kie-models" ] || [ -d "$ROOT/skills/kie-chat-agents" ]; then
    bad "install landed a KIE vendor skill under $ROOT/skills"
  else
    ok "installed skills root holds no kie-models or kie-chat-agents"
  fi
  if [ -f "$ROOT/skills/07-kie-setup/SKILL.md" ]; then
    ok "the real helpers (07-kie-setup) did land"
  else
    bad "07-kie-setup did not land in the temporary root"
  fi
else
  bad "helper install into a temporary root failed"
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$TMP/backups" 2>&1 | sed 's/^/    | /'
fi

# =====================================================================
step "6. the repository itself is still clean after every fixture above"

run_guard 0 "guard passes again on the real pins and the real helper folders" \
  --onboarding "$ONB" --ref origin/main \
  --manifest "$MANIFEST" --helpers "$HELPERS"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL PASS"
exit 0
