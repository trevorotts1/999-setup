#!/usr/bin/env bash
# Smoke test: install into a throwaway HOME, verify registration, re-install (idempotent), uninstall (exact restore).
# Never touches the real HOME, real settings, or launchd (HOOK_SKILL_NO_LAUNCHD=1 writes plists but does not load them).
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
FAKE="$(mktemp -d "${TMPDIR:-/tmp}/hookskill-smoke.XXXXXX")"
# a locked fake settings file would stop rm -rf, so unlock before cleanup
trap '"$PY" "$SKILL/scripts/common/settings_lock.py" unlock "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json" >/dev/null 2>&1; rm -rf "$FAKE"' EXIT
export HOME="$FAKE" USERPROFILE="$FAKE" HOOK_SKILL_NO_LAUNCHD=1 HOOK_SKILL_TMP_ROOTS="$FAKE/no-tmp"
PY="$(command -v python3)"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; }
# $1 = python snippet using d (dict) -- exit non-zero on failure
json_check() { "$PY" - "$1" "$2" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1])); exec(sys.argv[2])
PYEOF
}

mkdir -p "$FAKE/.claude" "$FAKE/.claude-nine"
cat > "$FAKE/.claude/settings.json" <<'JSON'
{"model": "keep-me", "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "foreign-hook --x"}]}]}}
JSON
cp "$FAKE/.claude/settings.json" "$FAKE/original.json"

# 0. dry-run writes nothing
"$SKILL/scripts/macos/install.sh" --dry-run >/dev/null
[ ! -e "$FAKE/.claude/hooks" ] || fail "dry-run created hooks folder"
cmp -s "$FAKE/.claude/settings.json" "$FAKE/original.json" || fail "dry-run changed settings"
ok "dry-run changes nothing"

# 1. install with both opt-ins
"$SKILL/scripts/macos/install.sh" --with-ask-before-backup --with-question-gate >"$FAKE/install.out" 2>&1 || { cat "$FAKE/install.out"; fail "install exited non-zero"; }
for f in workflow-guard/guard.py workflow-guard/staffing.py workflow-guard/capacity_probe.py workflow-guard/validate.mjs workflow-guard/vendor/acorn.mjs hygiene/post_merge_hygiene.py \
         ask-before-backup/ask_before_backup.py question-gate/gate_actions.py question-gate/classify_prompt.py disk-cleanup/disk_cleanup.py; do
  [ -f "$FAKE/.claude/hooks/$f" ] || fail "missing installed file $f"
done
[ -f "$FAKE/.claude/hooks/hook-skill.json" ] || fail "missing per-user config"
[ ! -e "$FAKE/.claude/hooks/workflow-guard/test_guard.py" ] || fail "tests were installed"
ok "files installed"
for s in "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json"; do
  json_check "$s" '
h = d["hooks"]; cmds = [x["command"] for g in sum(h.values(), []) for x in g["hooks"]]
for need in ("workflow-guard/guard.py", "post_merge_hygiene.py", "ask_before_backup.py", "gate_actions.py", "classify_prompt.py"):
    assert any(need in c and sys.argv[1].rsplit("/", 2)[0] in c for c in cmds), need
assert set(h) >= {"SessionStart","Stop","PreToolUse","UserPromptSubmit","PostToolUse","PostToolUseFailure"}
' || fail "registration check failed in $s"
done
for s in "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json"; do
  json_check "$s" 'c = int(d["env"]["CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS"]); assert 1 <= c <= 10, c' || fail "measured cap env missing in $s"
done
json_check "$FAKE/.claude/hooks/workflow-guard/state/limits.json" 'import json as j; e = j.load(open(sys.argv[1].rsplit("/", 5)[0] + "/.claude/settings.json"))["env"]["CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS"]; assert d["concurrent_agents_per_workflow"] == int(e) and d["concurrent_agents_total"] == min(500, int(e) * 50), d' || fail "limits.json does not carry the measured cap"
ok "measured per-workflow cap written to limits.json and to both settings files"
json_check "$FAKE/.claude/settings.json" 'assert d["model"] == "keep-me"; assert d["hooks"]["PreToolUse"][0]["hooks"][0]["command"] == "foreign-hook --x"' || fail "existing settings/hook not preserved"
ok "registered in .claude and .claude-nine, existing entries preserved, JSON valid"

if [ "$(uname -s)" = "Darwin" ]; then
  for l in workflow-watchdog hygiene-sweep disk-cleanup; do
    plutil -lint "$FAKE/Library/LaunchAgents/com.hookskill.$l.plist" >/dev/null || fail "bad plist $l"
  done
  ok "launchd plists written and valid (not loaded)"
fi

# 2. installed hooks actually run
OUT="$("$PY" "$FAKE/.claude/hooks/workflow-guard/guard.py" hook <<<'{"hook_event_name":"SessionStart","session_id":"smoke"}')"
"$PY" -c 'import json,sys; json.loads(sys.argv[1])["hookSpecificOutput"]' "$OUT" || fail "installed guard SessionStart output invalid"
case "$OUT" in *"HOOK WIRING INCOMPLETE"*) fail "wiring self-check warns right after a clean install: $OUT" ;; esac
[ -f "$FAKE/.claude/hooks/workflow-guard/wiring-manifest.json" ] || fail "wiring manifest not installed"
"$PY" "$FAKE/.claude/hooks/hygiene/post_merge_hygiene.py" sweep --dry-run --root "$FAKE/lanes" >/dev/null || fail "installed hygiene sweep --dry-run failed"
"$PY" "$FAKE/.claude/hooks/disk-cleanup/disk_cleanup.py" --dry-run >/dev/null 2>&1 || fail "installed disk cleanup --dry-run failed"
ok "installed hooks run"

# 3. re-install is idempotent
cp "$FAKE/.claude/settings.json" "$FAKE/after1.json"
"$SKILL/scripts/macos/install.sh" --with-ask-before-backup --with-question-gate >/dev/null 2>&1 || fail "re-install failed"
cmp -s "$FAKE/.claude/settings.json" "$FAKE/after1.json" || fail "re-install changed settings"
ok "re-install is idempotent"

# 3b. no hard lock by default; --lock-settings is opt-in; installers write through a lock and re-lock; --unlock-settings undoes it
LK() { "$PY" "$SKILL/scripts/common/settings_lock.py" "$@"; }  # a function: the checkout path may contain spaces
LK status "$FAKE/.claude/settings.json" | grep -q ': unlocked' || fail "settings were locked without --lock-settings"
"$SKILL/scripts/macos/install.sh" --with-ask-before-backup --with-question-gate --lock-settings >"$FAKE/lock.out" 2>&1 || { cat "$FAKE/lock.out"; fail "install --lock-settings failed"; }
for s in "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json"; do
  LK status "$s" | grep -q ': locked' || fail "--lock-settings did not lock $s"
done
cp "$FAKE/.claude/settings.json" "$FAKE/locked-before.json"
"$SKILL/scripts/macos/install.sh" --with-ask-before-backup --with-question-gate >"$FAKE/relock.out" 2>&1 || { cat "$FAKE/relock.out"; fail "install over a locked file failed"; }
grep -q 'settings-lock: .* was locked' "$FAKE/relock.out" || fail "install did not report unlocking the locked file"
for s in "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json"; do
  LK status "$s" | grep -q ': locked' || fail "installer left $s unlocked"
done
cmp -s "$FAKE/.claude/settings.json" "$FAKE/locked-before.json" || fail "idempotent install over a lock changed settings"
"$SKILL/scripts/macos/install.sh" --unlock-settings >/dev/null 2>&1 || fail "--unlock-settings failed"
for s in "$FAKE/.claude/settings.json" "$FAKE/.claude-nine/settings.json"; do
  LK status "$s" | grep -q ': unlocked' || fail "--unlock-settings left $s locked"
done
ok "lock is opt-in, installer writes through a lock and re-locks, --unlock-settings undoes it"

# 4. uninstall restores the original
"$SKILL/scripts/macos/uninstall.sh" >/dev/null 2>&1 || fail "uninstall failed"
json_check "$FAKE/.claude/settings.json" 'import json as j; assert d == j.load(open(sys.argv[1].rsplit("/",2)[0] + "/original.json")), d' || fail "settings not restored exactly"
json_check "$FAKE/.claude-nine/settings.json" 'assert d == {}, d' || fail "claude-nine settings not clean"
ls "$FAKE"/Library/LaunchAgents/com.hookskill.* >/dev/null 2>&1 && fail "plists remain"
[ ! -e "$FAKE/.claude/hooks/hook-skill-install.json" ] || fail "manifest remains"
for f in workflow-guard/guard.py hygiene/post_merge_hygiene.py disk-cleanup/disk_cleanup.py question-gate/gate_actions.py; do
  [ ! -e "$FAKE/.claude/hooks/$f" ] || fail "file remains after uninstall: $f"
done
ok "uninstall removed only what was added (settings restored exactly)"

# 5. roll-path contract: --only full-read-guard registers ONLY this hook in the given root and touches nothing else
R="$FAKE/.claude-nine"; rm -rf "$FAKE/.claude" "$R/hooks"
mkdir -p "$R/skills/demo"
echo '{"canary": true, "env": {"KEEP": "1"}, "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "foreign-hook --x"}]}]}}' > "$R/settings.json"
cp "$R/settings.json" "$FAKE/roll-before.json"
printf -- '---\nname: demo\n---\nDemo skill\n' > "$R/skills/demo/SKILL.md"
"$SKILL/scripts/macos/install.sh" --only full-read-guard --root "$R" >"$FAKE/roll.out" 2>&1 || { cat "$FAKE/roll.out"; fail "--only full-read-guard failed"; }
json_check "$R/settings.json" '
b = json.load(open(sys.argv[1].rsplit("/", 1)[0] + "/../roll-before.json"))
assert d["canary"] is True and d["env"] == {"KEEP": "1"}, d
assert d["hooks"]["PreToolUse"][0] == b["hooks"]["PreToolUse"][0]
mine = [(e, x["command"]) for e, gs in d["hooks"].items() for g in gs for x in g["hooks"] if "full-read-guard/frg_hook.py" in x["command"]]
assert sorted(e for e, _ in mine) == ["PostToolUse", "PreCompact", "PreToolUse", "SessionStart"], mine
others = [(e, x["command"]) for e, gs in d["hooks"].items() for g in gs for x in g["hooks"] if "full-read-guard" not in x["command"]]
assert others == [("PreToolUse", "foreign-hook --x")], others
' || fail "roll-path install changed more than the four full-read-guard entries"
[ -f "$R/hooks/full-read-guard/frg_hook.py" ] && [ -x "$R/hooks/full-read-guard/read-skill" ] || fail "roll-path install: files missing"
[ "$(ls "$R/hooks" | sort | tr '\n' ' ')" = "full-read-guard hook-skill-install.json " ] || fail "roll-path install wrote extra files: $(ls "$R/hooks")"
[ ! -e "$FAKE/.claude" ] && [ -z "$(ls "$FAKE/Library/LaunchAgents" 2>/dev/null)" ] || fail "roll-path install touched ~/.claude or launchd"
cp "$R/settings.json" "$FAKE/roll-after1.json"
"$SKILL/scripts/macos/install.sh" --only full-read-guard --root "$R" >/dev/null 2>&1 || fail "roll-path re-run failed"
cmp -s "$R/settings.json" "$FAKE/roll-after1.json" || fail "roll-path re-run is not idempotent"
mkdir -p "$FAKE/empty-root"
"$SKILL/scripts/macos/install.sh" --only full-read-guard --root "$FAKE/empty-root" >/dev/null 2>&1 || fail "roll-path with no settings.json should exit 0"
[ ! -e "$FAKE/empty-root/settings.json" ] && [ ! -e "$FAKE/empty-root/hooks" ] || fail "roll-path created files where no settings.json existed"
OUT="$(printf '%s' '{"hook_event_name":"PreToolUse","session_id":"r1","cwd":"'"$FAKE"'","tool_name":"Bash","tool_input":{"command":"head -3 '"$R"'/skills/demo/SKILL.md"}}' | "$PY" "$R/hooks/full-read-guard/frg_hook.py")"
case "$OUT" in *'"deny"'*read-skill*) ;; *) fail "installed hook did not block a partial read: $OUT" ;; esac
"$SKILL/scripts/macos/install.sh" --only nope >/dev/null 2>&1 && fail "--only accepted an unknown component"
ok "roll path: --only full-read-guard registers exactly four entries, idempotent, nothing else touched, hook blocks"
"$SKILL/scripts/macos/uninstall.sh" >/dev/null 2>&1 || fail "uninstall after roll-path failed"
json_check "$R/settings.json" 'b = json.load(open(sys.argv[1].rsplit("/", 1)[0] + "/../roll-before.json")); assert d == b, d' || fail "uninstall did not restore roll-path settings"
ok "uninstall removes the roll-path registration"
echo "SMOKE PASS"
