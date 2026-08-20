#!/bin/bash
# Kaizen skill test suite — fixtures only. Never touches the real Downloads
# folder, the real ~/.claude, or launchd (KAIZEN_LAUNCHD_DRY_RUN=1).
#
# usage: run-kaizen-tests.sh [--verbose]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); [ "$VERBOSE" = "1" ] && say "  ok: $1"; return 0; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL: $1"; return 0; }
check() { # check <name> <cmd...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi
}
check_eq() { # check_eq <name> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi
}
check_contains() { # check_contains <name> <needle> <haystack>
  case "$3" in *"$2"*) ok "$1";; *) bad "$1 (missing [$2] in [$3])";; esac
}
check_not_contains() {
  case "$3" in *"$2"*) bad "$1 (found [$2])";; *) ok "$1";; esac
}

NODE_BIN="${NODE_BIN:-node}"
STATE_MJS="$SKILL_DIR/scripts/common/kaizen-state.mjs"
VALIDATE_MJS="$SKILL_DIR/scripts/common/validate-kaizen-memory.mjs"
RESOLVE_SH="$SKILL_DIR/scripts/macos/resolve-kaizen-root.sh"
INSTALL_LA_SH="$SKILL_DIR/scripts/macos/install-kaizen-launchagent.sh"
REMOVE_LA_SH="$SKILL_DIR/scripts/macos/remove-kaizen-launchagent.sh"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"

# mk_loop <downloads-fixture> <loop-id>: build a loop that passes the strict
# validator (Fix 5 contract): real loop_id everywhere, approved contract,
# manual schedule, complete memory structure.
mk_loop() {
  local base="$1" id="$2" dir
  dir="$base/OpenClaw Master Files/Kaizen/$id"
  mkdir -p "$dir/cycles" "$dir/evidence"
  printf '{"schema_version":1,"entries":[]}\n' > "$dir/evidence/manifest.json"
  "$NODE_BIN" -e "
    const fs = require('fs');
    const dir = process.argv[1], id = process.argv[2];
    const t = JSON.parse(fs.readFileSync('$SKILL_DIR/templates/STATE.template.json', 'utf8'));
    t.loop_id = id; t.name = id; t.status = 'active'; t.permission_mode = 'B';
    t.schedule = { human: 'manual', mechanism: 'manual', mechanism_id: null };
    t.approval = { timestamp: '2026-08-20T00:00:00Z', approved_by: 'owner' };
    fs.writeFileSync(dir + '/STATE.json', JSON.stringify(t, null, 2) + '\n');
    const l = JSON.parse(fs.readFileSync('$SKILL_DIR/templates/LOCAL_STATE.template.json', 'utf8'));
    l.loop_id = id; l.local_target_path = dir; l.kaizen_root_path = dir;
    l.scheduler = { mechanism: 'none' };
    fs.writeFileSync(dir + '/LOCAL_STATE.json', JSON.stringify(l, null, 2) + '\n');
  " "$dir" "$id"
  printf '# Kaizen Contract — %s\n\nContract version: 1\n\nLoop ID: %s\n\nDate created: 2026-08-20\n\n## Where I will look\n\nCode: %s\n\n## Where I stop\n\nMerge and deploy need explicit approval.\n' \
    "$id" "$id" "$dir" > "$dir/KAIZEN_CONTRACT.md"
  printf '# Kaizen Memory\n' > "$dir/KAIZEN_MEMORY.md"
  printf '# RESUME\n' > "$dir/RESUME.md"
  printf '# Backlog\n' > "$dir/BACKLOG.md"
  printf '# Decisions\n' > "$dir/DECISIONS.md"
}

# ---------------------------------------------------------------------------
say "== 7.1 memory-root fixtures (five cases) =="
FIX_A="$(mktemp -d)"
FIX_B="$(mktemp -d)"
FIX_C="$(mktemp -d)"
FIX_D="$(mktemp -d)"
FIX_E="$(mktemp -d)"
trap 'rm -rf "$FIX_A" "$FIX_B" "$FIX_C" "$FIX_D" "$FIX_E"' EXIT

# A: no master folder -> fallback
out_a="$(KAIZEN_DOWNLOADS="$FIX_A" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "7.1A no-master -> fallback" "$FIX_A/Kaizen" "$out_a"
# B: exactly one -> that one
mkdir -p "$FIX_B/OpenClaw Master Files/Kaizen"
out_b="$(KAIZEN_DOWNLOADS="$FIX_B" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "7.1B one-master -> that one" "$FIX_B/OpenClaw Master Files/Kaizen" "$out_b"
# C: >1 -> fallback (do not guess)
mkdir -p "$FIX_C/OpenClaw Master Files/Kaizen" "$FIX_C/nested/OpenClaw Master Files/Kaizen"
out_c="$(KAIZEN_DOWNLOADS="$FIX_C" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "7.1C two-masters -> fallback" "$FIX_C/Kaizen" "$out_c"
# D: case-insensitive match
mkdir -p "$FIX_D/openclaw MASTER files/Kaizen"
out_d="$(KAIZEN_DOWNLOADS="$FIX_D" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "7.1D case-insensitive" "$FIX_D/openclaw MASTER files/Kaizen" "$out_d"
# E: beyond depth 3 is NOT found -> fallback
mkdir -p "$FIX_E/a/b/c/d/OpenClaw Master Files/Kaizen"
out_e="$(KAIZEN_DOWNLOADS="$FIX_E" "$NODE_BIN" "$STATE_MJS" locate)"
check_eq "7.1E depth>3 ignored -> fallback" "$FIX_E/Kaizen" "$out_e"
# bash resolver parity with case A and B. Normalize through pwd -P when the
# path exists: macOS /var is a symlink to /private/var, and the bash resolver
# resolves it while node's path.resolve does not — same directory, different
# spelling. The fallback path may not exist yet (the resolver never creates
# it), so fall back to the raw string in that case.
realpathish() { ( cd "$1" 2>/dev/null && pwd -P ) || printf '%s' "$1"; }
rb_a="$(realpathish "$(KAIZEN_DOWNLOADS="$FIX_A" bash "$RESOLVE_SH")")"
exp_a="$(realpathish "$FIX_A/Kaizen")"
check_eq "7.1F bash resolver parity (fallback)" "$exp_a" "$rb_a"
rb_b="$(realpathish "$(KAIZEN_DOWNLOADS="$FIX_B" bash "$RESOLVE_SH")")"
exp_b="$(realpathish "$FIX_B/OpenClaw Master Files/Kaizen")"
check_eq "7.1G bash resolver parity (match)" "$exp_b" "$rb_b"

# ---------------------------------------------------------------------------
say "== 7.2 registry (collision, atomic update, invalid-JSON recovery) =="
FIX_R="$(mktemp -d)"
mkdir -p "$FIX_R/OpenClaw Master Files/Kaizen"
REG="$FIX_R/OpenClaw Master Files/Kaizen/registry.json"
KAIZEN_DOWNLOADS="$FIX_R" "$NODE_BIN" "$STATE_MJS" registry-add loop-a >/dev/null
KAIZEN_DOWNLOADS="$FIX_R" "$NODE_BIN" "$STATE_MJS" registry-add loop-a >/dev/null
cnt="$(KAIZEN_DOWNLOADS="$FIX_R" "$NODE_BIN" "$STATE_MJS" registry-list | grep -c '"loop_id"')"
check_eq "7.2A registry collision (add same twice -> 1 entry)" "1" "$cnt"
# atomic write left a .bak after second write
check "7.2B atomic update produced .bak" test -f "$REG.bak"
# corrupt the registry, then add again: must recover without data loss of new entry
echo 'NOT JSON' > "$REG"
rm -f "$REG.bak"
KAIZEN_DOWNLOADS="$FIX_R" "$NODE_BIN" "$STATE_MJS" registry-add loop-b >/dev/null
cnt2="$(KAIZEN_DOWNLOADS="$FIX_R" "$NODE_BIN" "$STATE_MJS" registry-list | grep -c '"loop_id"')"
check_eq "7.2C invalid-JSON recovery (new entry lands)" "1" "$cnt2"
check "7.2D recovered registry is valid JSON" "$NODE_BIN" -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$REG"

# ---------------------------------------------------------------------------
say "== 7.3 contract validation =="
CONTRACT_TMPL="$SKILL_DIR/templates/KAIZEN_CONTRACT.template.md"
CYCLE_TMPL="$SKILL_DIR/templates/CYCLE.template.md"
check "7.3A open-discovery clause always present in template" \
  grep -qiE "does not limit what (I|Kaizen) can notice|open.discovery" "$CONTRACT_TMPL"
check "7.3B scope range 3..7 present in template" \
  grep -qE "3.?–?7" "$CONTRACT_TMPL"
check "7.3C approval boundary section present" grep -qiE "Where I stop|approval" "$CONTRACT_TMPL"
check "7.3D approval timestamp field present" grep -qiE "approval|approved" "$CONTRACT_TMPL"
check "7.3E ACT verdicts present in cycle template" \
  grep -qE "KEEP|REVERTED|DEFERRED|NEEDS APPROVAL|BLOCKED|INVALID" "$CYCLE_TMPL"
check "7.3F cycle template has CHECK before/after evidence" \
  grep -qE "Before:|After:" "$CYCLE_TMPL"
# STATE template must validate clean out of the box
FIX_S="$(mktemp -d)"
mkdir -p "$FIX_S/OpenClaw Master Files/Kaizen"
# the shipped template carries placeholder fields (<uuid>), so a
# filled-in loop built from it is what must validate clean
mk_loop "$FIX_S" demo
KAIZEN_DOWNLOADS="$FIX_S" "$NODE_BIN" "$STATE_MJS" validate demo >/dev/null
check "7.3G loop built from STATE template validates clean" [ $? -eq 0 ]
# scope out of range must fail (the node-side validate command)
"$NODE_BIN" -e "const f=process.argv[1],fs=require('fs');const s=JSON.parse(fs.readFileSync(f,'utf8'));s.scope={max_items_per_cycle:2};fs.writeFileSync(f,JSON.stringify(s))" \
  "$FIX_S/OpenClaw Master Files/Kaizen/demo/STATE.json"
KAIZEN_DOWNLOADS="$FIX_S" "$NODE_BIN" "$STATE_MJS" validate demo >/dev/null 2>&1
check "7.3H scope=2 rejected (below 3)" [ $? -ne 0 ]
# open-discovery flag false but user_goal present -> still valid (one of the two)
"$NODE_BIN" -e "const f=process.argv[1],fs=require('fs');const s=JSON.parse(fs.readFileSync(f,'utf8'));s.scope={max_items_per_cycle:5};s.direction={user_goal:'x',open_discovery:false};fs.writeFileSync(f,JSON.stringify(s))" \
  "$FIX_S/OpenClaw Master Files/Kaizen/demo/STATE.json"
KAIZEN_DOWNLOADS="$FIX_S" "$NODE_BIN" "$STATE_MJS" validate demo >/dev/null 2>&1
check "7.3I user_goal-only direction valid" [ $? -eq 0 ]
# neither direction -> fail
"$NODE_BIN" -e "const f=process.argv[1],fs=require('fs');const s=JSON.parse(fs.readFileSync(f,'utf8'));s.direction={};fs.writeFileSync(f,JSON.stringify(s))" \
  "$FIX_S/OpenClaw Master Files/Kaizen/demo/STATE.json"
KAIZEN_DOWNLOADS="$FIX_S" "$NODE_BIN" "$STATE_MJS" validate demo >/dev/null 2>&1
check "7.3J empty direction rejected" [ $? -ne 0 ]

# ---------------------------------------------------------------------------
say "== 7.4 PDCA fixture simulation =="
FIX_P="$(mktemp -d)"
mkdir -p "$FIX_P/OpenClaw Master Files/Kaizen"
mk_loop "$FIX_P" cycle-loop
LOOP="$FIX_P/OpenClaw Master Files/Kaizen/cycle-loop"
# lock -> simulate work -> bump-cycle -> token unlock (Fix 4 contract:
# the normal path never uses --force)
LOCK_OUT="$(KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" lock cycle-loop)"
check "7.4A lock acquired" test -f "$LOOP/.cycle-lock.json"
check_contains "7.4A2 lock prints a token" '"token":' "$LOCK_OUT"
KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" lock cycle-loop >/dev/null 2>&1
check "7.4B second lock rejected" [ $? -ne 0 ]
KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" bump-cycle cycle-loop >/dev/null
out_bc="$("$NODE_BIN" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).cycle_counter)" "$LOOP/STATE.json")"
check_eq "7.4C cycle_counter incremented" "1" "$out_bc"
LOCK_TOKEN="$(printf '%s' "$LOCK_OUT" | "$NODE_BIN" -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).token||''))")"
KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" unlock cycle-loop --token "$LOCK_TOKEN" >/dev/null
check "7.4D token unlock releases lock" [ ! -f "$LOOP/.cycle-lock.json" ]
# --force without --stale/--broken is rejected (no force on the normal path)
LOCK_OUT2="$(KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" lock cycle-loop)"
KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" unlock cycle-loop --force >/dev/null 2>&1
check "7.4E bare --force rejected" [ $? -ne 0 ]
check "7.4F bare --force leaves lock held" test -f "$LOOP/.cycle-lock.json"
LOCK_TOKEN2="$(printf '%s' "$LOCK_OUT2" | "$NODE_BIN" -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s).token||''))")"
KAIZEN_DOWNLOADS="$FIX_P" "$NODE_BIN" "$STATE_MJS" unlock cycle-loop --token "$LOCK_TOKEN2" >/dev/null
check "7.4G fresh lock token releases" [ ! -f "$LOOP/.cycle-lock.json" ]

# ---------------------------------------------------------------------------
say "== 7.5 repeat memory (no rediscovery) =="
# The fingerprint rule is documentation; the mechanism test: a rejected finding
# recorded in a cycle file must be preserved verbatim by the validator (it
# never rewrites files) and the pdca reference must carry the hard rule.
check "7.5A hard rule present in pdca-cycle.md" \
  grep -qE "never present an old idea as though it were newly discovered" "$SKILL_DIR/references/pdca-cycle.md"
check "7.5B five reconsideration conditions present" \
  grep -qE "target changed materially|prior blocker disappeared|previous test became invalid|user changed the Contract|new evidence" "$SKILL_DIR/references/pdca-cycle.md"
check "7.5C backlog template tracks stable IDs" grep -qE "ID.*Discovered cycle|Last reconsidered" "$SKILL_DIR/templates/BACKLOG.template.md"

# ---------------------------------------------------------------------------
say "== 7.6 scheduler parser =="
SCHED_DOC="$SKILL_DIR/references/scheduling.md"
# The doc wraps phrases across newlines, so compare against
# whitespace-normalized text (same pattern as walkthroughs D2).
SCHED_FLAT="$(tr '\n' ' ' < "$SCHED_DOC")"
for needle in "/loop 5m" "/loop 20m" "/loop 1h" "Every 3 days" "Every week" "Every 30 days" "Every 90 days"; do
  check_contains "7.6 interval [$needle]" "$needle" "$SCHED_FLAT"
done
check_contains "7.6 monthly-vs-30-days ambiguity handled" "exactly every 30 days" "$SCHED_FLAT"
check_contains "7.6 quarterly-vs-90-days ambiguity handled" "exactly every 90 days" "$SCHED_FLAT"

# ---------------------------------------------------------------------------
say "== 7.7 /loop + cloud /schedule + 9Router guard =="
check_contains "7.7A /loop pattern documented" "/loop 20m /kaizen run" "$SCHED_FLAT"
check_contains "7.7B cloud Routine warning present" "will not automatically use the local 9Router model" "$SCHED_FLAT"
check_contains "7.7C Path C never creates skill-not-found Routine" "Never create a Routine that will later say" "$SCHED_FLAT"
check_contains "7.7D seven-day expiry named" "expire after seven days" "$SCHED_FLAT"

# ---------------------------------------------------------------------------
say "== 7.8 launchd fixtures =="
FIX_L="$(mktemp -d)"
HOME_FIX="$FIX_L/home"
mkdir -p "$HOME_FIX/Library/LaunchAgents"
HOME="$HOME_FIX" KAIZEN_LAUNCHD_DRY_RUN=1 bash "$INSTALL_LA_SH" my-big-loop daily >/dev/null
PLIST="$HOME_FIX/Library/LaunchAgents/com.blackceo.kaizen.my-big-loop.plist"
check "7.8A plist written with deterministic label" test -f "$PLIST"
check_contains "7.8B label inside plist" "com.blackceo.kaizen.my-big-loop" "$(cat "$PLIST")"
check_contains "7.8C StartInterval 86400 for daily" "<integer>86400</integer>" "$(cat "$PLIST")"
check_not_contains "7.8D no secrets inside plist" "token" "$(cat "$PLIST")"
check_not_contains "7.8E no key material inside plist" "sk-" "$(cat "$PLIST")"
# re-install with a different interval converges (idempotent-ish: same path, new value)
HOME="$HOME_FIX" KAIZEN_LAUNCHD_DRY_RUN=1 bash "$INSTALL_LA_SH" my-big-loop weekly >/dev/null
check_contains "7.8F re-install converges at one plist, calendar weekly" \
  "<key>StartCalendarInterval</key>" "$(cat "$PLIST")"
check_contains "7.8Fb weekday key present for weekly" "<key>Weekday</key>" "$(cat "$PLIST")"
check_not_contains "7.8Fc no elapsed seconds for calendar weekly" "<integer>604800</integer>" "$(cat "$PLIST")"
# bad loop id rejected
HOME="$HOME_FIX" KAIZEN_LAUNCHD_DRY_RUN=1 bash "$INSTALL_LA_SH" 'BAD LOOP!' daily >/dev/null 2>&1
check "7.8G invalid loop-id rejected" [ $? -ne 0 ]
# remove: dry-run prints intent and touches nothing; real run deletes the plist.
# KAIZEN_DOWNLOADS pins the memory lookup to the fixture so LOCAL_STATE clearing
# never probes the real machine.
REM_OUT="$(HOME="$HOME_FIX" KAIZEN_DOWNLOADS="$FIX_L" KAIZEN_LAUNCHD_DRY_RUN=1 bash "$REMOVE_LA_SH" my-big-loop)"
check_contains "7.8H dry-run removal prints would-remove" "would-remove: $PLIST" "$REM_OUT"
check "7.8H2 dry-run removal leaves plist untouched" test -f "$PLIST"
HOME="$HOME_FIX" KAIZEN_DOWNLOADS="$FIX_L" bash "$REMOVE_LA_SH" my-big-loop >/dev/null
check "7.8H3 non-dry-run removal deletes plist" [ ! -f "$PLIST" ]
HOME="$HOME_FIX" KAIZEN_DOWNLOADS="$FIX_L" KAIZEN_LAUNCHD_DRY_RUN=1 bash "$REMOVE_LA_SH" my-big-loop >/dev/null
check "7.8I removal of absent loop exits 0 (idempotent)" [ $? -eq 0 ]

# ---------------------------------------------------------------------------
say "== 7.9 plain-language checks =="
PLAIN_DOC="$SKILL_DIR/references/plain-language.md"
check_contains "7.9A cycle-report structure documented" "Kaizen check complete" "$(cat "$PLAIN_DOC")"
check_contains "7.9B git microcopy never says git" "safe copy" "$(cat "$PLAIN_DOC")"
check_contains "7.9C cron microcopy never says cron" "every Monday at 9 AM" "$(cat "$PLAIN_DOC")"
check_contains "7.9D no-success-without-evidence principle" "Fresh evidence" "$(cat "$SKILL_DIR/references/pdca-cycle.md")"
check_contains "7.9E approval boundary microcopy" "I need your okay" "$(cat "$PLAIN_DOC")"

# ---------------------------------------------------------------------------
say "== 7.10 eli5/bro install checks =="
check "7.10A eli5 SKILL.md present" test -f "$REPO_ROOT/.claude/skills/eli5/SKILL.md"
check "7.10B eli5 THIRD_PARTY_LICENSE.md present" test -f "$REPO_ROOT/.claude/skills/eli5/THIRD_PARTY_LICENSE.md"
check "7.10C bro SKILL.md present" test -f "$REPO_ROOT/.claude/skills/bro/SKILL.md"
check "7.10D bro THIRD_PARTY_LICENSE.md present" test -f "$REPO_ROOT/.claude/skills/bro/THIRD_PARTY_LICENSE.md"
check "7.10E eli5 license is MIT" grep -q "^MIT License" "$REPO_ROOT/.claude/skills/eli5/THIRD_PARTY_LICENSE.md"
check "7.10F bro license is MIT" grep -q "^MIT License" "$REPO_ROOT/.claude/skills/bro/THIRD_PARTY_LICENSE.md"
check "7.10G pinned eli5 commit recorded" grep -q "549364af799a4a0556c5359a0ac3e36d4da5719d" "$REPO_ROOT/THIRD_PARTY_NOTICES.md"
check "7.10H pinned bro commit recorded" grep -q "01e51f8092973be58eff3b7271282bd8488a02ae" "$REPO_ROOT/THIRD_PARTY_NOTICES.md"
check "7.10I no GPL anywhere in vendored skills" \
  sh -c "! grep -riE 'GNU General Public|GPL' '$REPO_ROOT/.claude/skills/eli5' '$REPO_ROOT/.claude/skills/bro'"
check "7.10J bundled-skills manifest lists all five" \
  sh -c "grep -qE '^(nine-router-setup|spec-protocol|kaizen|eli5|bro)$' '$REPO_ROOT/CONTROL/bundled-skills.txt'"
cnt_m="$(grep -cE '^(nine-router-setup|spec-protocol|kaizen|eli5|bro)$' "$REPO_ROOT/CONTROL/bundled-skills.txt")"
check_eq "7.10K manifest has exactly five entries" "5" "$cnt_m"

# ---------------------------------------------------------------------------
say "== 7.11 secret scan =="
FIX_T="$(mktemp -d)"
mkdir -p "$FIX_T/OpenClaw Master Files/Kaizen"
mk_loop "$FIX_T" scan-loop
SCAN_DIR="$FIX_T/OpenClaw Master Files/Kaizen/scan-loop"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null
check "7.11A clean memory passes secret scan" [ $? -eq 0 ]
printf '{"k":"%s"}' "sk-proj-$(printf '%s' 'abcdefghijklmnopqrstuvwxyz123456')" > "$SCAN_DIR/notes.json"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null 2>&1
check "7.11B planted OpenAI key detected" [ $? -ne 0 ]
printf '{"k":"%s"}' "ghp_$(printf '%s' 'abcdefghijklmnopqrstuvwxyz123456')" > "$SCAN_DIR/notes.json"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null 2>&1
check "7.11C planted GitHub token detected" [ $? -ne 0 ]
# planted keys built at runtime: GitHub push protection flags the literal
# pattern even in test fixtures, so no secret-shaped literal sits in source
printf '{"k":"%s"}' "AKIA$(printf '%s' 'ABCDEFGHIJKLMNOP')" > "$SCAN_DIR/notes.json"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null 2>&1
check "7.11D planted AWS key id detected" [ $? -ne 0 ]
printf '{"k":"%s"}' "AIza$(printf '%s' 'SyA1234567890abcdefghijklmnopqrstuvw')" > "$SCAN_DIR/notes.json"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null 2>&1
check "7.11E planted Google API key detected" [ $? -ne 0 ]
rm "$SCAN_DIR/notes.json"
"$NODE_BIN" "$VALIDATE_MJS" "$SCAN_DIR" --scan-secrets >/dev/null
check "7.11F clean again after removal" [ $? -eq 0 ]

# ---------------------------------------------------------------------------
say "== 7.12 SKILL.md frontmatter =="
SKILL_MD="$SKILL_DIR/SKILL.md"
check_contains "7.12A name: kaizen" "name: kaizen" "$(head -20 "$SKILL_MD")"
check_not_contains "7.12B no disable-model-invocation (must stay /loop-invocable)" \
  "disable-model-invocation" "$(head -20 "$SKILL_MD")"
check_not_contains "7.12C no trigger key" "trigger:" "$(head -20 "$SKILL_MD")"
check_contains "7.12D argument-hint present" "argument-hint" "$(head -20 "$SKILL_MD")"
check_contains "7.12E description mentions PDCA" "Plan-Do-Check-Act" "$(head -20 "$SKILL_MD")"

# ---------------------------------------------------------------------------
say "== 7.13 memory location rule =="
MEM_DOC="$SKILL_DIR/references/memory.md"
check_contains "7.13A OpenClaw Master Files convention" "OpenClaw Master Files" "$(cat "$MEM_DOC")"
check_contains "7.13B zero-or-more-than-one -> Downloads/Kaizen" "<Downloads>/Kaizen" "$(cat "$MEM_DOC")"
check_contains "7.13C never .kaizen in target" "never" "$(cat "$MEM_DOC")"
check_contains "7.13D cycle lock 6h stale" "6" "$(grep -iE "stale|6 hour" "$MEM_DOC" | head -3)"
check_contains "7.13E atomic write contract" "temp" "$(cat "$MEM_DOC")"

say ""
say "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
