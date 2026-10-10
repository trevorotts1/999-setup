#!/bin/bash
# Keep `claude-nine` seeing every skill the regular `claude` CLI has.
#
# claude-nine runs with CLAUDE_CONFIG_DIR=~/.claude-nine, so it loads skills from
# ~/.claude-nine/skills — a different dir from ~/.claude/skills. Without this,
# any skill added to the regular CLI is invisible to claude-nine. The claude-nine
# launcher already calls ~/.local/bin/sync-nine-skills.sh on every launch; this
# file is that script, and the installer places it there:
#
#   scripts/sync-nine-skills.sh --install
#
# which copies this file to $HOME/.local/bin/sync-nine-skills.sh with mode 755
# and then runs the sync. KIE gap fix item (d-sync).
#
# Rules:
#   - Symlink in anything present in the source skills root but missing in the
#     destination skills root.
#   - NEVER overwrite a real directory in the destination. Those are claude-nine's
#     own tuned copies (orchestrate, swarm, box-update, look, and its diverged
#     purpose/spec-protocol/skill-warroom/skill-warfix). They win.
#   - Prune symlinks whose target was deleted, so no broken skills are loaded.
#
# Safe to run repeatedly. Never exits non-zero in a way that blocks a launch.
set -uo pipefail

SELF="${BASH_SOURCE[0]}"
while [ -L "$SELF" ]; do
  _target="$(readlink "$SELF")"
  case "$_target" in
    /*) SELF="$_target" ;;
    *) SELF="$(dirname "$SELF")/$_target" ;;
  esac
done
SELF_DIR="$(cd "$(dirname "$SELF")" && pwd -P)"
SELF_FILE="$SELF_DIR/$(basename "$SELF")"
unset _target

# Source is always the regular CLI's skills root; destination follows
# CLAUDE_CONFIG_DIR when it is set (that is where claude-nine loads from),
# else ~/.claude-nine.
SRC="$HOME/.claude/skills"
DST="${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}/skills"
QUIET=0
INSTALL=0

say() { [ "$QUIET" -eq 1 ] || echo "$@"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    --install) INSTALL=1; shift ;;
    -h|--help)
      say "usage: sync-nine-skills.sh [--quiet] [--install]"
      say "  --quiet    no output (the launcher passes this)"
      say "  --install  also place this script at \$HOME/.local/bin/sync-nine-skills.sh (mode 755)"
      exit 0
      ;;
    *) say "sync-nine-skills: ignoring unknown argument: $1"; shift ;;
  esac
done

if [ "$INSTALL" -eq 1 ]; then
  bin="$HOME/.local/bin"
  dest="$bin/sync-nine-skills.sh"
  tmp="$bin/.sync-nine-skills.sh.tmp.$$"
  mkdir -p "$bin" 2>/dev/null || true
  if cp "$SELF_FILE" "$tmp" 2>/dev/null && chmod 755 "$tmp" && mv -f "$tmp" "$dest"; then
    say "sync-nine-skills: installed $dest (mode 755)"
  else
    rm -f "$tmp" 2>/dev/null || true
    say "sync-nine-skills: could not install $dest"
    exit 1
  fi
fi

[ -d "$SRC" ] || { say "sync-nine-skills: no $SRC — nothing to do."; exit 0; }
mkdir -p "$DST" || exit 0
# CLAUDE_CONFIG_DIR pointing back at the regular CLI would mirror a root onto itself.
if [ -d "$DST" ] && [ "$(cd "$SRC" && pwd -P)" = "$(cd "$DST" && pwd -P)" ]; then
  say "sync-nine-skills: source and destination are the same directory — nothing to do."
  exit 0
fi

added=0
for path in "$SRC"/*/; do
  [ -d "$path" ] || continue
  name="$(basename "$path")"
  target="$DST/$name"

  # A real dir already there = claude-nine's own copy. Leave it alone.
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    continue
  fi
  # Correct symlink already there.
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$SRC/$name" ]; then
    continue
  fi
  # Missing, or a stale/wrong symlink -> (re)link.
  [ -L "$target" ] && rm -f "$target"
  if ln -s "$SRC/$name" "$target" 2>/dev/null; then
    say "  + linked skill: $name"
    added=$((added + 1))
  fi
done

# Drop symlinks pointing at skills that no longer exist.
pruned=0
for target in "$DST"/*; do
  [ -L "$target" ] || continue
  if [ ! -e "$target" ]; then
    rm -f "$target" && { say "  - pruned dead link: $(basename "$target")"; pruned=$((pruned + 1)); }
  fi
done

if [ "$added" -gt 0 ] || [ "$pruned" -gt 0 ]; then
  say "sync-nine-skills: +$added linked, -$pruned pruned ($(ls "$DST" | wc -l | tr -d ' ') total)."
else
  say "sync-nine-skills: already in sync ($(ls "$DST" | wc -l | tr -d ' ') skills)."
fi
exit 0
