#!/usr/bin/env bash
# install-claude-nine.sh — install the claude-nine launcher at $HOME/.local/bin
# (mode 700) and ensure $HOME/.local/bin is on PATH for new login shells via a
# clearly marked, idempotent profile block. Preserves unrelated profile content.
set -euo pipefail

# Default launcher source: the repo copy next to this script (this script lives
# at <repo>/.claude/skills/nine-router-setup/scripts/macos/, and the launcher
# lives at <repo>/launchers/macos/claude-nine). CLAUDE_NINE_SOURCE overrides it.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER_SRC="${CLAUDE_NINE_SOURCE:-$SCRIPT_DIR/../../../../../launchers/macos/claude-nine}"
LAUNCHER="$HOME/.local/bin/claude-nine"

log() { printf '[install-claude-nine] %s\n' "$*" >&2; }

install_launcher() {
  mkdir -p "$HOME/.local/bin"
  if [ ! -f "$LAUNCHER_SRC" ]; then
    echo "launcher source not found at $LAUNCHER_SRC (set CLAUDE_NINE_SOURCE to override)." >&2
    exit 1
  fi
  install -m 700 "$LAUNCHER_SRC" "$LAUNCHER"
  log "installed $LAUNCHER (mode 700)"
}

manage_profile() {
  # Which profile: ~/.zprofile for zsh users, ~/.bash_profile for bash users.
  # Default to ~/.zprofile (current macOS default shell is zsh). Only switch to
  # ~/.bash_profile when .zprofile does not exist and .bash_profile does.
  local profile="$HOME/.zprofile"
  if [ ! -f "$HOME/.zprofile" ] && [ -f "$HOME/.bash_profile" ]; then
    profile="$HOME/.bash_profile"
  fi

  local marker="# >>> 999-setup: claude-nine path >>>"
  local marker_end="# <<< 999-setup: claude-nine path <<<"
  # The PATH block itself — the markers are NOT part of this string. Both the
  # append and the replace paths wrap it with exactly one marker pair, so
  # reruns are byte-idempotent and never double the markers.
  local block
  block="$(cat <<'EOF'
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
EOF
)"
  # If the orchestrator installed a repo-managed Node runtime (no system Node
  # satisfied the minimum), that runtime lives off any default PATH. Fold its
  # bin dir into this SAME managed block so a FUTURE terminal — not just this
  # setup run — can still resolve `node`, which the claude-nine launcher calls
  # directly. The value is baked in literally (not as a variable reference):
  # it must resolve in a fresh shell that never ran this setup.
  if [ -n "${CLAUDE_NINE_EXTRA_PATH_DIR:-}" ]; then
    local extra="$CLAUDE_NINE_EXTRA_PATH_DIR"
    block="$block
case \":\$PATH:\" in
  *\":$extra:\"*) ;;
  *) export PATH=\"$extra:\$PATH\" ;;
esac"
  fi

  if [ -f "$profile" ] && grep -qF "$marker" "$profile" 2>/dev/null; then
    # Managed block already present — replace it in place to keep it idempotent
    # while preserving everything outside the block. Replace from the FIRST
    # opening marker to the LAST closing marker so any orphaned markers left by
    # an older buggy write are collapsed into exactly one block.
    # Gate on xcode-select -p, not just `command -v python3`: on a fresh Mac
    # with no Xcode Command Line Tools, /usr/bin/python3 is the CLT stub —
    # its NAME resolves (command -v passes) but actually invoking it below
    # pops the "Install command line developer tools?" GUI dialog mid-setup.
    # xcode-select -p is a fast, side-effect-free presence check.
    if command -v python3 >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1; then
      MANAGED="$(printf '%s\n%s\n%s' "$marker" "$block" "$marker_end")" \
      python3 - "$profile" "$marker" "$marker_end" <<'PY'
import os, sys
p, m1, m2 = sys.argv[1], sys.argv[2], sys.argv[3]
managed = os.environ["MANAGED"]
text = open(p, encoding="utf-8").read()
start = text.find(m1)
end = text.rfind(m2)
if start != -1 and end != -1 and end > start:
    new_text = text[:start] + managed + text[end + len(m2):]
else:
    # Marker found by grep but no clean closing pair — append a fresh block.
    if text and not text.endswith("\n"):
        text += "\n"
    new_text = text + "\n" + managed + "\n"
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
    # Append a fresh managed block (exactly one marker pair).
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
