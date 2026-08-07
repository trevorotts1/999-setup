#!/usr/bin/env bash
# install-claude-nine.sh — install the claude-nine launcher at $HOME/.local/bin
# (mode 700) and ensure $HOME/.local/bin is on PATH for new login shells via a
# clearly marked, idempotent profile block. Preserves unrelated profile content.
set -euo pipefail

LAUNCHER_SRC="${CLAUDE_NINE_SOURCE:-$HOME/.claude/skills/nine-router-setup/launchers/macos/claude-nine}"
LAUNCHER="$HOME/.local/bin/claude-nine"

log() { printf '[install-claude-nine] %s\n' "$*" >&2; }

install_launcher() {
  mkdir -p "$HOME/.local/bin"
  if [ ! -f "$LAUNCHER_SRC" ]; then
    # The skill copies launchers into the skill dir during install; if that did
    # not happen, fall back to the repo copy next to this script.
    local repo_src
    repo_src="$(cd "$(dirname "$0")/../../.." 2>/dev/null && pwd)/launchers/macos/claude-nine"
    if [ -f "$repo_src" ]; then
      LAUNCHER_SRC="$repo_src"
    else
      echo "launcher source not found at $LAUNCHER_SRC or repo path." >&2
      exit 1
    fi
  fi
  install -m 700 "$LAUNCHER_SRC" "$LAUNCHER"
  log "installed $LAUNCHER (mode 700)"
}

manage_profile() {
  # Which profile: ~/.zprofile for zsh users, ~/.bash_profile for bash users.
  # Default to ~/.zprofile (current macOS default shell is zsh).
  local profile="$HOME/.zprofile"
  if [ -n "${BASH_VERSION:-}" ] && [ ! -f "$HOME/.zprofile" ]; then
    profile="$HOME/.bash_profile"
  fi
  # If .zprofile absent but .bash_profile exists and is the user's shell, honor it.
  if [ ! -f "$HOME/.zprofile" ] && [ -f "$HOME/.bash_profile" ] && [ -n "${BASH_VERSION:-}" ]; then
    profile="$HOME/.bash_profile"
  fi

  local marker="# >>> 999-setup: claude-nine path >>>"
  local marker_end="# <<< 999-setup: claude-nine path <<<"
  local block
  block="$(cat <<'EOF'
# >>> 999-setup: claude-nine path >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
# <<< 999-setup: claude-nine path <<<
EOF
)"

  if [ -f "$profile" ] && grep -qF "$marker" "$profile" 2>/dev/null; then
    # Managed block already present — replace it in place to keep it idempotent
    # while preserving everything outside the block.
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$profile" "$marker" "$marker_end" "$block" <<'PY'
import sys
p, m1, m2, block = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
text = open(p, encoding="utf-8").read()
start = text.find(m1)
end = text.find(m2)
if start != -1 and end != -1 and end >= start:
    end = end + len(m2)
    new_text = text[:start] + block + text[end:]
else:
    # Fallback: append a fresh managed block (should not happen when marker found).
    if text and not text.endswith("\n"):
        text += "\n"
    new_text = text + "\n" + block + "\n"
open(p, "w", encoding="utf-8").write(new_text)
PY
    else
      echo "python3 unavailable; cannot update the managed PATH block in $profile." >&2
      echo "Add this line manually to $profile:" >&2
      echo '  export PATH="$HOME/.local/bin:$PATH"' >&2
      return 1
    fi
    log "updated managed PATH block in $profile"
  else
    # Append a fresh managed block.
    {
      printf '\n%s\n' "$marker"
      printf '%s\n' "$block"
      printf '%s\n' "$marker_end"
    } >> "$profile"
    log "appended managed PATH block to $profile"
  fi
}

main() {
  install_launcher
  manage_profile
  # Make launcher discoverable in the CURRENT process too.
  export PATH="$HOME/.local/bin:$PATH"
  log "done — claude-nine is at $LAUNCHER"
  command -v claude-nine >/dev/null 2>&1 && log "resolves on PATH"
}

main "$@"
