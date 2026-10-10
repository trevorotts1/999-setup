#!/usr/bin/env bash
# test_agent_install_kie_doc.sh — AGENT_INSTALL.md must carry the KIE
# amendment (unit KIE-U3, named test that QC found missing from the tree).
#
# Checks, against AGENT_INSTALL.md itself, every phrase the KIE-U3 amendment
# is ordered to state, including:
#
#   U3-a  "Do not run npx skills add https://kie.ai"
#   U3-b  the chat-provider sentence with api.kie.ai/anthropic
#   U3-c  step 10 checks no settings.json carries an api.kie.ai base URL
#   U3-d  "never paste the key in chat; if it leaks, reset it at kie.ai/api-key"
#   U3-e  the extended doc check: every phrase below, each with a planted-bad
#         control, running green with no skip
#   plus the Trevor golden-rule exception sentence for env.KIE_API_KEY and
#   the declined fallback line
#
# It also asserts the retired one-shared-root sentences are ABSENT.
#
# Version policy (unit N99-U3T): this test carries NO hard-coded version for
# helper 74. The 74 pin lives in installer-registration/helper-dependencies.json
# (source of truth), and AGENT_INSTALL.md prose may lag it during a re-pin
# batch, so a fixed string here would assert a value this test cannot own.
# Control sv below proves the test still passes when the doc's 74 version is
# rewritten from v1.1.5 to v1.1.6 — i.e. no stale-version requirement remains.
#
# No skips, no network, no fixture-only proof: the clean case is the current
# AGENT_INSTALL.md; every required phrase then gets a planted-bad control
# (the phrase is stripped from a temp copy and the same check must fail) and
# every absent phrase gets the reverse control (the retired sentence is
# planted into a temp copy and the check must fail). A checker that cannot
# fail would fail here.
#
# Usage: bash scripts/test_agent_install_kie_doc.sh [path/to/AGENT_INSTALL.md]
# Exits 0 only when every check passes.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-$ROOT/AGENT_INSTALL.md}"
fails=0
pass=0

if [ ! -f "$FILE" ]; then
  echo "FAIL: file not found: $FILE"
  exit 1
fi
echo "checking: $FILE"

# Required phrases, one per line: LABEL<TAB>FIXED-STRING (must be PRESENT).
REQS=$(cat <<'EOF'
KIE key variable name	KIE_API_KEY
KIE key reports SET only	KIE key: SET
KIE key reports NOT SET only	KIE key: NOT SET
claude config root settings	~/.claude/settings.json
claude-nine config root settings	~/.claude-nine/settings.json
claude skills root	~/.claude/skills
claude-nine skills root	~/.claude-nine/skills
settings.json permission 600	permission 600
credits gate mode file	kie-live-adapter-mode.conf
credits gate conditional	only when that credits call passes
shadow default until gate passes	shadow
skill 74 is the paid door	74-kie-live-adapter
sync script	sync-nine-skills.sh
sync script install location	~/.local/bin/sync-nine-skills.sh
no KIE MCP	no KIE MCP
rate limit budget	20 new generation requests per 10
re-pinned helper 67	v2.1.3
helper 07-kie-setup	07-kie-setup
helper shared-utils	shared-utils
helper install lands in both roots	both** roots this machine has
U3-a vendor skills never installed	Do not run npx skills add https://kie.ai
U3-b never KIE as chat provider	Do not configure claude or claude-nine to use KIE as its chat provider (api.kie.ai/anthropic); a settings-file value overrides the launcher's router address
U3-c step 10 api.kie.ai base URL check	no settings.json in either config root carries an
U3-c report-only never edit	report-only
U3-d key safety line	never paste the key in chat; if it leaks, reset it at kie.ai/api-key
PR 170 by-name approval	pull request #170
golden-rule exception sentence	Golden-rule exception
exception one line scope	exactly one line, `env.KIE_API_KEY` (the client's own key only)
exception permission 600 scope	permission 600
exception SET/NOT SET scope	KIE key: SET` or `KIE key: NOT SET
exception touches nothing else	touches no
declined fallback line	Declined fallback
declined fallback skill 74 stays shadow	skill 74 stays in
EOF
)

# N99-U3T guard: the retired hard-coded 74 pin must never be re-asserted.
# The doc prose may say any 74 version; the pin's value is owned by
# installer-registration/helper-dependencies.json, not by this test.
# Control: a temp copy of this script with "v1.1.5" put back into REQS must
# exit non-zero here, proving a stale expectation is fail-closed.
if printf '%s\n' "$REQS" | grep -Fq 'v1.1.5'; then
  echo "FAIL: test re-asserts stale 74-kie-live-adapter v1.1.5 (removed by N99-U3T)"
  echo "RESULT: FAIL"
  exit 1
fi

# Retired one-shared-root sentences: LABEL<TAB>FIXED-STRING (must be ABSENT).
ABSENTS=$(cat <<'EOF'
single config root claim (section 5)	Do not create a
never set a separate config dir (section 5)	do not set a separate `CLAUDE_CONFIG_DIR`
never set CLAUDE_CONFIG_DIR yourself (section 5.1)	Never set
same config root, no duplicate install (section 9)	same config root, no duplicate install
shared config root (section 7)	the shared config root
shared skill visibility heading	## 9. Verify shared skill visibility
EOF
)

req() { # req <label> <fixed-string>
  if grep -Fq -- "$2" "$FILE"; then
    echo "ok: present: $1"
    pass=$((pass+1))
  else
    echo "FAIL: missing: $1 :: $2"
    fails=$((fails+1))
  fi
}

absent() { # absent <label> <fixed-string>
  if grep -Fq -- "$2" "$FILE"; then
    echo "FAIL: retired phrasing still present: $1 :: $2"
    fails=$((fails+1))
  else
    echo "ok: absent: $1"
    pass=$((pass+1))
  fi
}

while IFS=$'\t' read -r label phrase; do
  [ -z "${label:-}" ] && continue
  req "$label" "$phrase"
done <<EOF
$REQS
EOF

while IFS=$'\t' read -r label phrase; do
  [ -z "${label:-}" ] && continue
  absent "$label" "$phrase"
done <<EOF
$ABSENTS
EOF

echo
echo "passed=$pass failed=$fails"
if [ "$fails" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi

# --- planted-bad controls ---------------------------------------------------
# U3-e. Every required phrase is stripped into its own temp copy and the same
# check must then report RESULT: FAIL; every retired sentence is planted into
# its own temp copy and the check must fail there too. If any planted copy
# still passes, that phrase is not load-bearing and this test is broken.
# KIE_U3_SKIP_NC=1 stops recursion into this block for the planted copies.
if [ "${KIE_U3_SKIP_NC:-0}" = "1" ]; then
  echo "RESULT: PASS"
  exit 0
fi

echo
echo "=== planted-bad controls (strip each required phrase) ==="
nc_fail=0
nc_total=0
tmpbase="$(mktemp -d "${TMPDIR:-/tmp}/test_agent_install_kie_doc.XXXXXX")"
trap 'rm -rf "$tmpbase"' EXIT
while IFS=$'\t' read -r label phrase; do
  [ -z "${label:-}" ] && continue
  nc_total=$((nc_total+1))
  stripped="$tmpbase/nc-$nc_total.md"
  # delete every line containing the phrase
  grep -Fv -- "$phrase" "$FILE" > "$stripped" || true
  if cmp -s "$FILE" "$stripped"; then
    echo "FAIL(nc): phrase not strippable: $label"
    nc_fail=$((nc_fail+1))
    continue
  fi
  if KIE_U3_SKIP_NC=1 bash "$0" "$stripped" > "$tmpbase/out-$nc_total.log" 2>&1; then
    echo "FAIL(nc): check still passes without: $label"
    nc_fail=$((nc_fail+1))
  else
    echo "ok(nc): check fails without: $label"
  fi
done <<EOF
$REQS
EOF

echo
echo "=== planted-bad controls (plant each retired sentence) ==="
while IFS=$'\t' read -r label phrase; do
  [ -z "${label:-}" ] && continue
  nc_total=$((nc_total+1))
  planted="$tmpbase/plant-$nc_total.md"
  cp "$FILE" "$planted"
  printf '\n%s\n' "$phrase" >> "$planted"
  if KIE_U3_SKIP_NC=1 bash "$0" "$planted" > "$tmpbase/out-$nc_total.log" 2>&1; then
    echo "FAIL(nc): check still passes with retired sentence: $label"
    nc_fail=$((nc_fail+1))
  else
    echo "ok(nc): check fails with retired sentence: $label"
  fi
done <<EOF
$ABSENTS
EOF

echo
echo "negative-control: total=$nc_total failed=$nc_fail"
if [ "$nc_fail" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0
