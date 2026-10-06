#!/usr/bin/env bash
# Hook Skill installer for macOS (and Linux, without scheduled jobs).
#   install.sh [--with-ask-before-backup] [--with-question-gate]
#              [--no-workflow-guard] [--no-hygiene] [--no-disk-cleanup]
#              [--no-schedule] [--dry-run]
#              [--lock-settings]    opt-in: hard-lock the claude/claude-nine settings files after install
#              [--unlock-settings]  undo that lock and exit (installs nothing)
# Defaults ON: workflow-guard, hygiene (with test cleanup), disk-cleanup.
# Opt-in (they prompt you): ask-before-backup, question-gate.
# Never removes existing hook entries; appends ours. Validates JSON after every settings write.
set -euo pipefail

WG=1 HY=1 DC=1 AB=0 QG=0 SCHED=1 DRY=0 LOCK=0 UNLOCK=0
for arg in "$@"; do
  case "$arg" in
    --with-ask-before-backup) AB=1 ;;
    --with-question-gate) QG=1 ;;
    --no-workflow-guard) WG=0 ;;
    --no-hygiene) HY=0 ;;
    --no-disk-cleanup) DC=0 ;;
    --no-schedule) SCHED=0 ;;
    --dry-run) DRY=1 ;;
    --lock-settings) LOCK=1 ;;
    --unlock-settings) UNLOCK=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 64 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="$(cd "$HERE/../.." && pwd)"
COMMON="$SKILL/scripts/common"
HOOKS="$HOME/.claude/hooks"
VERSION="$(tr -d '[:space:]' < "$SKILL/VERSION")"

# ---- Python (required: every hook is a Python script) ----
PY=""
for cand in "${PYTHON:-}" python3 python; do
  [ -n "$cand" ] || continue
  if p="$(command -v "$cand" 2>/dev/null)" && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
    PY="$("$p" -c 'import sys; print(sys.executable)')"; break
  fi
done
[ -n "$PY" ] || { echo "Hook Skill needs Python 3.8+ on PATH (python3). Install it and re-run." >&2; exit 1; }
SETTINGS=("$HOME/.claude/settings.json")
[ -d "$HOME/.claude-nine" ] && SETTINGS+=("$HOME/.claude-nine/settings.json")
if [ $UNLOCK = 1 ]; then  # standalone action: remove the opt-in hard lock, install nothing
  for s in "${SETTINGS[@]}"; do if [ -f "$s" ]; then "$PY" "$COMMON/settings_lock.py" unlock "$s"; fi; done
  exit 0
fi
HAVE_NODE=0; command -v node >/dev/null 2>&1 && HAVE_NODE=1

COMPONENTS=""
add() { COMPONENTS="${COMPONENTS:+$COMPONENTS,}$1"; }
[ $WG = 1 ] && add workflow-guard
[ $HY = 1 ] && add hygiene
[ $AB = 1 ] && add ask-before-backup
[ $QG = 1 ] && add question-gate
FILES="$COMPONENTS"; [ $DC = 1 ] && FILES="${FILES:+$FILES,}disk-cleanup"
[ -n "$FILES" ] || { echo "nothing selected to install" >&2; exit 64; }

DRYARG=(); [ $DRY = 1 ] && DRYARG=(--dry-run)
echo "Hook Skill $VERSION: installing [$FILES] into $HOOKS (python: $PY)"
[ $WG = 1 ] && [ $HAVE_NODE = 0 ] && echo "note: Node.js not found; workflow-guard will not validate Workflow launches until Node.js 18+ is installed (it never blocks them)."

# ---- 1. files ----
"$PY" "$COMMON/hookskill_files.py" install --src "$SKILL/hooks" --dest "$HOOKS" --components "$FILES" --version "$VERSION" ${DRYARG[@]+"${DRYARG[@]}"}

# ---- 2. register in settings (claude, and claude-nine when its folder exists) ----
seen=""
for s in "${SETTINGS[@]}"; do
  real="$(cd "$(dirname "$s")" 2>/dev/null && pwd -P)/$(basename "$s")"
  case "|$seen|" in *"|$real|"*) continue ;; esac   # same file reached twice (symlinked config root)
  seen="$seen|$real"
  if [ -n "$COMPONENTS" ]; then
    "$PY" "$COMMON/settings_merge.py" register --settings "$s" --python "$PY" --hooks-dir "$HOOKS" --components "$COMPONENTS" ${DRYARG[@]+"${DRYARG[@]}"}
  fi
  # Measured per-workflow cap (RAM, cores, container limits) -> limits.json + the env value, merged, idempotent.
  if [ $WG = 1 ]; then
    "$PY" "$COMMON/apply_capacity.py" --probe "$SKILL/hooks/workflow-guard/capacity_probe.py" --limits "$HOOKS/workflow-guard/state/limits.json" --settings "$s" --manifest "$HOOKS/hook-skill-install.json" ${DRYARG[@]+"${DRYARG[@]}"}
  fi
done

# ---- 2b. opt-in hard lock (default: none, so the box owner keeps /model and /config) ----
if [ $LOCK = 1 ] && [ $DRY = 0 ]; then
  for s in "${SETTINGS[@]}"; do if [ -f "$s" ]; then "$PY" "$COMMON/settings_lock.py" lock "$s"; fi; done
fi

# ---- 3. scheduled sweeps (launchd) ----
plist() { # label, interval-xml, program args...
  local label="$1" sched="$2"; shift 2
  local args="" a
  for a in "$@"; do args="$args<string>$a</string>"; done
  cat <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array>$args</array>
$sched
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$HOOKS/hook-skill-launchd.out</string>
<key>StandardErrorPath</key><string>$HOOKS/hook-skill-launchd.err</string>
</dict></plist>
PL
}
load_plist() { # label, file
  [ "${HOOK_SKILL_NO_LAUNCHD:-0}" = "1" ] && return 0
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$2" || echo "warning: could not load $1 (load it later with: launchctl bootstrap gui/$(id -u) $2)" >&2
}
write_job() { # label, schedule-xml, args...
  local label="$1" sched="$2"; shift 2
  local f="$HOME/Library/LaunchAgents/$label.plist"
  if [ $DRY = 1 ]; then echo "would write $f"; return; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  plist "$label" "$sched" "$@" > "$f"
  plutil -lint "$f" >/dev/null
  echo "wrote $f"
  load_plist "$label" "$f"
}
if [ $SCHED = 1 ] && [ "$(uname -s)" = "Darwin" ]; then
  [ $WG = 1 ] && write_job com.hookskill.workflow-watchdog '<key>StartInterval</key><integer>30</integer><key>RunAtLoad</key><true/>' "$PY" "$HOOKS/workflow-guard/guard.py" tick
  [ $HY = 1 ] && write_job com.hookskill.hygiene-sweep '<key>StartInterval</key><integer>900</integer>' "$PY" "$HOOKS/hygiene/post_merge_hygiene.py" sweep
  [ $DC = 1 ] && write_job com.hookskill.disk-cleanup '<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>' "$PY" "$HOOKS/disk-cleanup/disk_cleanup.py"
elif [ $SCHED = 1 ]; then
  echo "Scheduled jobs are macOS/Windows only. On Linux add to crontab:"
  [ $WG = 1 ] && echo "  * * * * * $PY $HOOKS/workflow-guard/guard.py tick"
  [ $HY = 1 ] && echo "  */15 * * * * $PY $HOOKS/hygiene/post_merge_hygiene.py sweep"
  [ $DC = 1 ] && echo "  30 3 * * * $PY $HOOKS/disk-cleanup/disk_cleanup.py"
fi

[ $DRY = 1 ] && echo "dry-run: nothing was written." || echo "Done. Restart Claude Code (and claude-nine) so the hooks load. Per-user settings: $HOOKS/hook-skill.json"
