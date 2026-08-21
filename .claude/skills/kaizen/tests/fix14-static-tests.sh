#!/bin/bash
# Static + cross-platform checks for the Kaizen skill and its companions.
# No fixtures needed beyond temporary dirs. Never touches real Downloads,
# ~/.claude, or launchd. Runs on macOS and Linux; PowerShell files get
# structural checks only when pwsh is absent (documented below).
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
PASS=0; FAIL=0
NODE_BIN="${NODE_BIN:-node}"

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); return 0; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL: $1"; return 0; }
check() { # check <name> <cmd...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi
}

# --- 14.1 every shell script parses (bash -n) --------------------------------
say "== 14.1 shell syntax =="
SH_COUNT=0
while IFS= read -r f; do
  SH_COUNT=$((SH_COUNT+1))
  check "bash -n $f" bash -n "$f"
done < <(find "$SKILL_DIR" "$REPO_ROOT/.claude/skills/nine-router-setup" \
  -name '*.sh' -type f 2>/dev/null | sort)
[ "$SH_COUNT" -gt 0 ] && ok "14.1Z found shell scripts ($SH_COUNT)" || bad "14.1Z no shell scripts found"

# --- 14.2 every Node module parses (node --check) ----------------------------
say "== 14.2 node syntax =="
MJS_COUNT=0
while IFS= read -r f; do
  MJS_COUNT=$((MJS_COUNT+1))
  check "node --check $f" "$NODE_BIN" --check "$f"
done < <(find "$SKILL_DIR" -name '*.mjs' -type f 2>/dev/null | sort)
[ "$MJS_COUNT" -gt 0 ] && ok "14.2Z found node modules ($MJS_COUNT)" || bad "14.2Z no node modules found"

# --- 14.3 every JSON template parses ------------------------------------------
say "== 14.3 JSON templates =="
JSON_COUNT=0
while IFS= read -r f; do
  JSON_COUNT=$((JSON_COUNT+1))
  check "JSON.parse $f" "$NODE_BIN" -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f"
done < <(find "$SKILL_DIR/templates" -name '*.json' -type f 2>/dev/null | sort)
[ "$JSON_COUNT" -gt 0 ] && ok "14.3Z found JSON templates ($JSON_COUNT)" || bad "14.3Z no JSON templates found"

# --- 14.4 SKILL.md frontmatter for all five bundled skills --------------------
say "== 14.4 skill frontmatter =="
while IFS= read -r skill; do
  md="$REPO_ROOT/.claude/skills/$skill/SKILL.md"
  check "14.4A $skill SKILL.md present" test -f "$md"
  hdr="$(head -30 "$md" 2>/dev/null)"
  case "$hdr" in
    *"name: $skill"*) ok "14.4B $skill name field";;
    *) bad "14.4B $skill name field missing";;
  esac
  case "$hdr" in
    *"description:"*) ok "14.4C $skill description field";;
    *) bad "14.4C $skill description field missing";;
  esac
done < <(grep -E '^[[:alnum:]_-]+$' "$REPO_ROOT/CONTROL/bundled-skills.txt")

# --- 14.5 no secret-shaped literals anywhere in skill source ------------------
# Patterns assembled at runtime: GitHub push protection blocks secret-shaped
# literals in source, so this scanner builds every pattern from parts.
say "== 14.5 secret-literal sweep (patterns assembled at runtime) =="
SECRET_REPORT="$(mktemp)"
find "$SKILL_DIR" "$REPO_ROOT/.claude/skills/eli5" "$REPO_ROOT/.claude/skills/bro" \
  -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.ps1' -o -name '*.md' -o -name '*.json' \) \
  ! -path '*/tests/fixtures/*' 2>/dev/null | sort > "$SECRET_REPORT.list"
"$NODE_BIN" - "$SECRET_REPORT.list" > "$SECRET_REPORT.hits" <<'EOF'
const fs = require("fs");
const files = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const P = (parts) => parts.join("");
const patterns = [
  { family: "openai", re: new RegExp(P(["sk-", "proj", "-"]) + "[A-Za-z0-9_-]{20,}") },
  { family: "anthropic", re: new RegExp("sk-ant-[A-Za-z0-9_-]{20,}") },
  { family: "github", re: new RegExp("gh[pousr]_" + "[A-Za-z0-9]{20,}") },
  { family: "stripe", re: new RegExp("(sk|rk)_(live|test)_" + "[A-Za-z0-9]{10,}") },
  { family: "aws", re: new RegExp("AKIA" + "[0-9A-Z]{16}") },
  { family: "google", re: new RegExp("AIza" + "[0-9A-Za-z_-]{30,}") },
  { family: "slack", re: new RegExp("xox[baprs]-" + "[A-Za-z0-9-]{10,}") },
  { family: "jwt", re: new RegExp("eyJ" + "[A-Za-z0-9_-]{8,}" + "\\." + "[A-Za-z0-9_-]{8,}" + "\\." + "[A-Za-z0-9_-]{8,}") },
  { family: "private-key", re: /BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY/ },
];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) console.log(`${f}: ${p.family}: ${m[0].slice(0, 8)}...`);
  }
}
EOF
HITS="$(wc -l < "$SECRET_REPORT.hits" | tr -d ' ')"
if [ "$HITS" = "0" ]; then
  ok "14.5A no secret-shaped literals in source"
else
  bad "14.5A found $HITS secret-shaped literal(s)"
  while IFS= read -r line; do say "        $line"; done < "$SECRET_REPORT.hits"
fi
rm -f "$SECRET_REPORT" "$SECRET_REPORT.list" "$SECRET_REPORT.hits"

# --- 14.6 Bash 3.2 compatibility: no array literals in the resolver -----------
say "== 14.6 Bash 3.2 compat =="
check "14.6A no empty-array literals in resolver (Bash 3.2 set -u)" \
  sh -c "! grep -nE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=\\(\\)' '$SKILL_DIR/scripts/macos/resolve-kaizen-root.sh'"
check "14.6B resolver runs under /bin/bash with fixture override" \
  sh -c "d=\$(mktemp -d); KAIZEN_DOWNLOADS=\"\$d\" /bin/bash '$SKILL_DIR/scripts/macos/resolve-kaizen-root.sh' >/dev/null; rc=\$?; rm -rf \"\$d\"; exit \$rc"
check "14.6C no array assignment in run-kaizen-cycle.sh" \
  sh -c "! grep -nE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=\\([^)]' '$SKILL_DIR/scripts/macos/run-kaizen-cycle.sh'"

# --- 14.7 tests must not hardcode real machine paths --------------------------
say "== 14.7 fixture hygiene =="
check "14.7A no /Users/ paths in tests" \
  sh -c "! grep -rnE '/Users/[a-z]' '$SKILL_DIR/tests'"
check "14.7B tests use mktemp fixtures" \
  sh -c "grep -rl 'mktemp' '$SKILL_DIR/tests' >/dev/null"
check "14.7C tests honor KAIZEN_DOWNLOADS" \
  sh -c "grep -rl 'KAIZEN_DOWNLOADS' '$SKILL_DIR/tests' >/dev/null"

# --- 14.8 PowerShell structural checks (pwsh may be absent here) --------------
say "== 14.8 PowerShell structure (pwsh execution is CI/Windows-runner only) =="
PS_COUNT=0
while IFS= read -r f; do
  PS_COUNT=$((PS_COUNT+1))
  base="$(basename "$f")"
  check "14.8A $base has param block or plain args" \
    sh -c "grep -qE 'param\\(|\\\$args\\[0\\]' '$f'"
  # Read-only resolvers have no side effects and need no dry-run seam.
  if [ "$base" = "Resolve-KaizenRoot.ps1" ]; then
    ok "14.8B $base read-only (no dry-run seam required)"
  else
    check "14.8B $base has dry-run seam" \
      sh -c "grep -qE 'DRY_RUN' '$f'"
  fi
done < <(find "$SKILL_DIR/scripts/windows" -name '*.ps1' -type f 2>/dev/null | sort)
[ "$PS_COUNT" -gt 0 ] && ok "14.8Z found PS1 files ($PS_COUNT)" || bad "14.8Z no PS1 files found"
if command -v pwsh >/dev/null 2>&1; then
  say "  pwsh present: running syntax parse"
  while IFS= read -r f; do
    check "pwsh parse $f" pwsh -NoProfile -Command "\$null = [System.Management.Automation.Language.Parser]::ParseFile('$f', [ref]\$null, [ref]\$null); if (\$?) { exit 0 } else { exit 1 }"
  done < <(find "$SKILL_DIR/scripts/windows" -name '*.ps1' -type f 2>/dev/null | sort)
else
  say "  pwsh absent on this host — PS1 syntax parse deferred to Windows CI runner"
fi

# --- 14.9 documentation hygiene ------------------------------------------------
say "== 14.9 doc hygiene =="
# Argument notation like <loop-id> is legitimate in reference docs; the
# placeholder gate for generated memory files lives in fix05 tests.
REF_COUNT=0
while IFS= read -r f; do
  REF_COUNT=$((REF_COUNT+1))
  check "14.9A $f non-empty" sh -c "[ -s '$f' ]"
  check "14.9B $f has title heading" sh -c "grep -qE '^#' '$f'"
done < <(find "$SKILL_DIR/references" -name '*.md' -type f 2>/dev/null | sort)
[ "$REF_COUNT" -gt 0 ] && ok "14.9Z found reference docs ($REF_COUNT)" || bad "14.9Z no reference docs found"
check "14.9C CHANGELOG present" test -f "$REPO_ROOT/CHANGELOG.md"
check "14.9D THIRD_PARTY_NOTICES present" test -f "$REPO_ROOT/THIRD_PARTY_NOTICES.md"
# Interview order is a contract: Target first (know what the work IS before
# scheduling it), Interval last (cadence depends on target/location). These
# checks pin the numbered sections, not just the words, so a reorder fails.
check "14.9E onboarding recipe order (Target first ... Interval last)" \
  sh -c "got=\$(awk '/^### [0-9]+\\. / {printf \"%s%s \", \$2, \$3}' '$SKILL_DIR/references/onboarding.md'); [ \"\$got\" = '1.Target 2.Location 3.Better 4.Scope 5.Permission 6.Proof 7.Interval ' ]"
check "14.9F SKILL.md recipe order (Target first ... Interval last)" \
  sh -c "got=\$(awk '/^   [0-9]+\\. \\*\\*/ {gsub(/\\*\\*/,\"\",\$2); printf \"%s%s \", \$1, \$2}' '$SKILL_DIR/SKILL.md'); [ \"\$got\" = '1.Target 2.Location 3.Better 4.Scope 5.Permission 6.Proof 7.Interval ' ]"

say ""
say "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
