#!/usr/bin/env bash
# Fix 13: companion-skill provenance tests.
# Asserts every vendored file under .claude/skills/eli5 and .claude/skills/bro is
# covered by a license file, THIRD_PARTY_NOTICES.md names the owner-selected
# upstreams with pinned commits and a status column, no GPL strings exist in the
# vendored skills, and both SKILL.md files have name + description frontmatter.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ELI5_DIR="$REPO_ROOT/.claude/skills/eli5"
BRO_DIR="$REPO_ROOT/.claude/skills/bro"
NOTICES="$REPO_ROOT/THIRD_PARTY_NOTICES.md"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }

# --- License coverage: every vendored file must have a sibling skill license file ---

assert_license_file() {
  local dir="$1" name="$2"
  local lic="$dir/THIRD_PARTY_LICENSE.md"
  if [ ! -f "$lic" ]; then
    fail "$name: missing THIRD_PARTY_LICENSE.md in $dir"
    return
  fi
  local first_line
  first_line="$(head -1 "$lic")"
  if [ "$first_line" != "MIT License" ] && [ "$first_line" != "Apache License" ]; then
    fail "$name: license first line is not 'MIT License' or 'Apache License' (got: $first_line)"
    return
  fi
  # License need only be a valid license text (first line checked above); upstream
  # bro/LICENSE credits "Hermes Agent + Luka" and never contains the project name,
  # so a project-name check would fail against the genuine upstream text.
  pass "$name: THIRD_PARTY_LICENSE.md exists, valid license text"
}

assert_vendored_files() {
  local dir="$1" name="$2"
  local count=0
  while IFS= read -r -d '' f; do
    count=$((count + 1))
    case "$f" in
      *THIRD_PARTY_LICENSE.md) ;;
      *)
        if [ ! -f "$dir/THIRD_PARTY_LICENSE.md" ]; then
          fail "$name: file $(basename "$f") has no license file"
        fi
        ;;
    esac
  done < <(find "$dir" -type f -print0)
  if [ "$count" -eq 0 ]; then
    fail "$name: no vendored files found under $dir"
  else
    pass "$name: $count vendored file(s) present, all under license coverage"
  fi
}

assert_license_file "$ELI5_DIR" "eli5"
assert_license_file "$BRO_DIR" "bro"
assert_vendored_files "$ELI5_DIR" "eli5"
assert_vendored_files "$BRO_DIR" "bro"

# --- THIRD_PARTY_NOTICES.md contents ---

if [ ! -f "$NOTICES" ]; then
  fail "THIRD_PARTY_NOTICES.md missing"
else
  grep -q "nathanksou/eli5" "$NOTICES" && pass "notices: names nathanksou/eli5" \
    || fail "notices: missing nathanksou/eli5"
  grep -q "luchasarie/bro-skill" "$NOTICES" && pass "notices: names luchasarie/bro-skill" \
    || fail "notices: missing luchasarie/bro-skill"

  grep -q "549364af799a4a0556c5359a0ac3e36d4da5719d" "$NOTICES" \
    && pass "notices: pins eli5 commit 549364af799a4a0556c5359a0ac3e36d4da5719d" \
    || fail "notices: missing eli5 pinned commit"
  grep -q "01e51f8092973be58eff3b7271282bd8488a02ae" "$NOTICES" \
    && pass "notices: pins bro commit 01e51f8092973be58eff3b7271282bd8488a02ae" \
    || fail "notices: missing bro pinned commit"

  grep -qE "Status" "$NOTICES" && pass "notices: has status column" \
    || fail "notices: missing status column"
  grep -q "MATCHES SELECTION" "$NOTICES" && pass "notices: status column populated" \
    || fail "notices: status column not populated (no MATCHES SELECTION)"

  grep -q "Files covered" "$NOTICES" && pass "notices: has Files covered note" \
    || fail "notices: missing Files covered note"
fi

# --- No GPL strings in vendored skills ---

gpl_hits="$(grep -rilE "GNU GENERAL PUBLIC LICENSE|GPL-3|GPL v3|GPLv3|GPL-2|GPLv2" \
  "$ELI5_DIR" "$BRO_DIR" 2>/dev/null || true)"
if [ -n "$gpl_hits" ]; then
  fail "GPL strings found: $gpl_hits"
else
  pass "no GPL strings in vendored skills"
fi

# --- SKILL.md frontmatter: name + description ---

assert_frontmatter() {
  local f="$1" name="$2"
  if [ ! -f "$f" ]; then
    fail "$name: SKILL.md missing"
    return
  fi
  head -20 "$f" | grep -qE "^name:[[:space:]]*$name" \
    && pass "$name: frontmatter name present" || fail "$name: frontmatter name missing"
  head -20 "$f" | grep -qE "^description:[[:space:]]*" \
    && pass "$name: frontmatter description present" || fail "$name: frontmatter description missing"
}

assert_frontmatter "$ELI5_DIR/SKILL.md" "eli5"
assert_frontmatter "$BRO_DIR/SKILL.md" "bro"

# --- Summary ---

echo ""
echo "fix13-provenance: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
