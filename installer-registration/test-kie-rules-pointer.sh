#!/usr/bin/env bash
# test-kie-rules-pointer.sh — the signature page's reference to the KIE common
# rules must RESOLVE from an installed skills root (KIE-U1 item b).
#
# blackceo-signature-page points at 07-kie-setup/references/kie-common-rules.md.
# Before 07 was a pinned helper the pointer was dangling on every client box:
# 999 shipped no 07, so the path simply was not there after the documented
# install. This test reads the reference straight out of the shipped page, so
# a page edit and a helper rename cannot drift apart unnoticed.
#
#   1. read the reference out of .claude/skills/blackceo-signature-page/SKILL.md
#   2. a fresh helper install into a temporary config root — the negative
#      control: before the install the pointer does NOT resolve
#   3. after install the pointer resolves, the file exists, and it carries
#      common rules 1 through 13
#
# Exits 0 only when every step passes. 2 = missing input (never a skip).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
PY="${PYTHON:-python3}"
DEP="$HERE/helper-deps.py"
PAGE="$REPO_ROOT/.claude/skills/blackceo-signature-page/SKILL.md"

PASS=0
FAIL=0
ok()  { printf 'ok: %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

[ -f "$PAGE" ] || { echo "signature page missing: $PAGE" >&2; exit 2; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/TrevelynsMini2-KIE-U1-pointer.XXXXXX")" || exit 2
ROOT="$TMP/config-root"
trap 'rm -rf "$TMP"' EXIT

echo "== 1. read the reference the signature page actually ships =="
# every occurrence of "<skill>/references/kie-common-rules.md" in the page
REFS="$(grep -oE '[A-Za-z0-9._-]+/references/kie-common-rules\.md' "$PAGE" | sort -u)"
if [ -z "$REFS" ]; then
  bad "no kie-common-rules.md reference found in $PAGE"
  printf '%s\n' "$REFS" | sed 's/^/    | /'
  printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"; exit 1
fi
ok "signature page carries a kie-common-rules.md reference"
REF="$(printf '%s\n' "$REFS" | head -1)"
printf 'reference: %s\n' "$REF"
if [ "$(printf '%s\n' "$REFS" | wc -l | tr -d ' ')" = "1" ]; then
  ok "the page uses exactly one reference path"
else
  bad "the page uses several reference paths: $(printf '%s\n' "$REFS" | tr '\n' ' ')"
fi
if [ "$REF" = "07-kie-setup/references/kie-common-rules.md" ]; then
  ok "reference points at the 07-kie-setup helper"
else
  bad "reference is '$REF', expected 07-kie-setup/references/kie-common-rules.md"
fi

echo "== 2. negative control: the pointer does not resolve before install =="
if [ -e "$ROOT/skills/$REF" ]; then
  bad "temporary root unexpectedly already has $ROOT/skills/$REF"
else
  ok "fresh config root has no 07-kie-setup yet (pointer dangling, as before)"
fi

echo "== 3. install, then the reference resolves from the skills root =="
if ! "$PY" "$DEP" install --root "$ROOT" --backup-dir "$TMP/backups" >/dev/null 2>&1; then
  bad "helper install into a temporary root failed"
  "$PY" "$DEP" install --root "$ROOT" --backup-dir "$TMP/backups" 2>&1 | sed 's/^/    | /'
  printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"; exit 1
fi
ok "helper install into a temporary root exited 0"

TARGET="$ROOT/skills/$REF"
if [ -f "$TARGET" ]; then
  ok "pointer resolves: $TARGET exists"
else
  bad "pointer does NOT resolve after install: missing $TARGET"
fi
if [ -f "$TARGET" ] && grep -q '^## 1\. ' "$TARGET" && grep -q '^## 13\. ' "$TARGET"; then
  ok "resolved file carries common rules 1 through 13"
else
  bad "resolved file lacks the rule 1 / rule 13 headings: $TARGET"
fi
if [ -f "$ROOT/skills/07-kie-setup/SKILL.md" ]; then
  ok "07-kie-setup is installed as a skill in the same root"
else
  bad "07-kie-setup/SKILL.md missing under $ROOT/skills"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "ALL PASS"
exit 0
