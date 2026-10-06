#!/usr/bin/env bash
# Hook Skill uninstaller for macOS/Linux. Removes only what install.sh added:
# our hook entries in settings.json (claude and claude-nine), our launchd jobs, and the files in the install manifest.
#   uninstall.sh [--purge] [--dry-run]
# --purge also deletes the hook folders' runtime data (logs, state databases) and the default hook-skill.json.
set -euo pipefail
PURGE=0 DRY=0
for arg in "$@"; do
  case "$arg" in --purge) PURGE=1 ;; --dry-run) DRY=1 ;; -h|--help) sed -n 2,6p "$0"; exit 0 ;; *) echo "unknown option: $arg" >&2; exit 64 ;; esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"; COMMON="$(cd "$HERE/../common" && pwd)"; HOOKS="$HOME/.claude/hooks"
PY="$(command -v python3 || command -v python || true)"; [ -n "$PY" ] || { echo "python3 not found" >&2; exit 1; }
DRYARG=(); [ $DRY = 1 ] && DRYARG=(--dry-run)

for s in "$HOME/.claude/settings.json" "$HOME/.claude-nine/settings.json"; do
  [ -f "$s" ] && "$PY" "$COMMON/settings_merge.py" unregister --settings "$s" --hooks-dir "$HOOKS" ${DRYARG[@]+"${DRYARG[@]}"}
done
for label in com.hookskill.workflow-watchdog com.hookskill.hygiene-sweep com.hookskill.disk-cleanup; do
  f="$HOME/Library/LaunchAgents/$label.plist"
  [ -f "$f" ] || continue
  if [ $DRY = 1 ]; then echo "would remove $f"; continue; fi
  [ "${HOOK_SKILL_NO_LAUNCHD:-0}" = "1" ] || launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$f"; echo "removed $f"
done
"$PY" "$COMMON/apply_capacity.py" --restore --manifest "$HOOKS/hook-skill-install.json" ${DRYARG[@]+"${DRYARG[@]}"}
PURGEARG=(); [ $PURGE = 1 ] && PURGEARG=(--purge)
"$PY" "$COMMON/hookskill_files.py" uninstall --dest "$HOOKS" ${PURGEARG[@]+"${PURGEARG[@]}"} ${DRYARG[@]+"${DRYARG[@]}"}
[ $DRY = 1 ] && echo "dry-run: nothing was removed." || echo "Hook Skill removed. Restart Claude Code to unload the hooks."
