#!/usr/bin/env bash
# Smoke test: install into a throwaway HOME, verify registration, re-install (idempotent), uninstall (exact restore).
# Never touches the real HOME, real settings, or launchd (HOOK_SKILL_NO_LAUNCHD=1 writes plists but does not load them).
set -euo pipefail
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
FAKE="$(mktemp -d "${TMPDIR:-/tmp}/hookskill-smoke.XXXXXX")"
trap 'rm -rf "$FAKE"' EXIT
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
for f in workflow-guard/guard.py workflow-guard/validate.mjs workflow-guard/vendor/acorn.mjs hygiene/post_merge_hygiene.py \
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
"$PY" "$FAKE/.claude/hooks/hygiene/post_merge_hygiene.py" sweep --dry-run --root "$FAKE/lanes" >/dev/null || fail "installed hygiene sweep --dry-run failed"
"$PY" "$FAKE/.claude/hooks/disk-cleanup/disk_cleanup.py" --dry-run >/dev/null 2>&1 || fail "installed disk cleanup --dry-run failed"
ok "installed hooks run"

# 3. re-install is idempotent
cp "$FAKE/.claude/settings.json" "$FAKE/after1.json"
"$SKILL/scripts/macos/install.sh" --with-ask-before-backup --with-question-gate >/dev/null 2>&1 || fail "re-install failed"
cmp -s "$FAKE/.claude/settings.json" "$FAKE/after1.json" || fail "re-install changed settings"
ok "re-install is idempotent"

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
echo "SMOKE PASS"
