#!/usr/bin/env bash
# Self-test for sync-nine-skills.sh (KIE gap fix item (d-sync)).
#
# Runs the real script in a throwaway HOME: --install must place it at
# ~/.local/bin/sync-nine-skills.sh with execute permission, and after the run
# claude-nine's skills root must actually contain the helpers that live in the
# regular CLI's skills root. Also proves the two safety rules the launcher
# depends on: claude-nine's own real skill directories are never overwritten,
# and symlinks to deleted skills are pruned.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
STEP="$REPO_ROOT/scripts/sync-nine-skills.sh"

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf 'PASS: %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; }

[ -f "$STEP" ] || { echo "FAIL: script missing: $STEP" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/kie-u2-sync-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
H="$work/home"

# The helpers a KIE install lands in the regular CLI's skills root.
mkdir -p "$H/.claude/skills/74-kie-live-adapter" \
         "$H/.claude/skills/shared-utils" \
         "$H/.claude-nine/skills/own-copy"
printf '# kie live adapter helper\n' >"$H/.claude/skills/74-kie-live-adapter/SKILL.md"
printf '# key resolver helper\n'    >"$H/.claude/skills/shared-utils/SKILL.md"
printf '# claude-nine tuned copy\n' >"$H/.claude-nine/skills/own-copy/SKILL.md"
# A dead link the sync must prune.
ln -s "$H/.claude/skills/deleted-skill" "$H/.claude-nine/skills/ghost"

mkdir -p "$work/bin"
clean_env() { env -u CLAUDE_CONFIG_DIR -u KIE_API_KEY "$@"; }

# --- 1. --install places the script, then the sync runs -------------------
if clean_env HOME="$H" bash "$STEP" --install >"$work/stdout.txt" 2>"$work/stderr.txt"; then
  ok "install+sync exits 0"
else
  bad "install+sync exited non-zero: $(tr '\n' ' ' <"$work/stderr.txt")"
fi
if [ -f "$H/.local/bin/sync-nine-skills.sh" ]; then
  ok "installed at \$HOME/.local/bin/sync-nine-skills.sh"
else
  bad "not installed at \$HOME/.local/bin/sync-nine-skills.sh"
fi
if [ -x "$H/.local/bin/sync-nine-skills.sh" ]; then
  ok "installed copy has execute permission"
else
  bad "installed copy is not executable"
fi
if cmp -s "$STEP" "$H/.local/bin/sync-nine-skills.sh"; then
  ok "installed copy is byte-identical to scripts/sync-nine-skills.sh"
else
  bad "installed copy differs from scripts/sync-nine-skills.sh"
fi

# --- 2. claude-nine's skills root then contains the helpers ---------------
for name in 74-kie-live-adapter shared-utils; do
  if [ -f "$H/.claude-nine/skills/$name/SKILL.md" ]; then
    ok "claude-nine skills root contains helper $name"
  else
    bad "claude-nine skills root is missing helper $name"
  fi
done
if [ -L "$H/.claude-nine/skills/74-kie-live-adapter" ] &&
   [ "$(readlink "$H/.claude-nine/skills/74-kie-live-adapter")" = "$H/.claude/skills/74-kie-live-adapter" ]; then
  ok "helper is symlinked from the regular CLI's skills root (no second copy to drift)"
else
  bad "helper is not a symlink to the regular CLI's skills root"
fi

# --- 3. safety rules -------------------------------------------------------
if [ ! -L "$H/.claude-nine/skills/own-copy" ] &&
   grep -q 'claude-nine tuned copy' "$H/.claude-nine/skills/own-copy/SKILL.md"; then
  ok "claude-nine's own real skill directory is left alone"
else
  bad "claude-nine's own real skill directory was overwritten"
fi
if [ ! -e "$H/.claude-nine/skills/ghost" ] && [ ! -L "$H/.claude-nine/skills/ghost" ]; then
  ok "symlink to a deleted skill is pruned"
else
  bad "dead symlink was not pruned"
fi

# --- 4. the INSTALLED copy is what the launcher would run ------------------
mkdir -p "$H/.claude/skills/07-kie-setup"
printf '# kie setup helper\n' >"$H/.claude/skills/07-kie-setup/SKILL.md"
if clean_env HOME="$H" bash "$H/.local/bin/sync-nine-skills.sh" --quiet \
     >"$work/installed-stdout.txt" 2>"$work/installed-stderr.txt"; then
  ok "installed copy runs --quiet with exit 0 (the launcher's invocation)"
else
  bad "installed copy failed under --quiet"
fi
if [ -f "$H/.claude-nine/skills/07-kie-setup/SKILL.md" ]; then
  ok "a helper added later is linked by the installed copy"
else
  bad "later-added helper did not reach claude-nine's skills root"
fi
if [ ! -s "$work/installed-stdout.txt" ]; then
  ok "--quiet emits no output"
else
  bad "--quiet emitted output: $(tr '\n' ' ' <"$work/installed-stdout.txt")"
fi
if clean_env HOME="$H" bash "$STEP" >/dev/null 2>&1; then
  ok "re-run from the repo is idempotent (exit 0)"
else
  bad "re-run from the repo failed"
fi

printf '\nSUITES (sync-nine-skills): %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
