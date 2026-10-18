#!/usr/bin/env bash
# get-api-docs.sh — resolve the real Documents folder on macOS and locate API docs.md.
# Outputs the absolute path to API docs.md on stdout, or exits non-zero with a
# precise blocker message. Never prints the file contents.
set -euo pipefail

resolve_documents() {
  local dir
  if command -v osascript >/dev/null 2>&1; then
    dir="$(osascript -e 'POSIX path of (path to documents folder)' 2>/dev/null)" || true
    if [ -n "${dir:-}" ] && [ -d "$dir" ]; then
      # Trim trailing slash
      printf '%s' "${dir%/}"
      return 0
    fi
  fi
  # Fallback
  if [ -d "$HOME/Documents" ]; then
    printf '%s' "$HOME/Documents"
    return 0
  fi
  echo "Cannot resolve the Documents folder on this Mac." >&2
  return 1
}

main() {
  local docs cred mode
  # agent-pull-fix: R12 — NINE_API_DOCS overrides the Documents default when set.
  if [ -n "${NINE_API_DOCS:-}" ]; then
    cred="$NINE_API_DOCS"
    # agent-pull-fix: R12 — explicit path must be a regular file.
    if [ ! -f "$cred" ]; then
      echo "MISSING: NINE_API_DOCS=$cred is not a file" >&2
      exit 3
    fi
    # agent-pull-fix: R12 — explicit path must be readable by this process.
    if [ ! -r "$cred" ] || ! head -c 1 "$cred" >/dev/null 2>&1; then
      echo "DENIED: NINE_API_DOCS=$cred is not readable" >&2
      exit 3
    fi
    # agent-pull-fix: R12 — explicit path must already be mode 600; never loosen it silently.
    mode="$(stat -f '%Lp' "$cred" 2>/dev/null || stat -c '%a' "$cred" 2>/dev/null || true)"
    if [ "$mode" != "600" ]; then
      echo "INSECURE: NINE_API_DOCS=$cred has mode ${mode:-unknown}, require 600" >&2
      echo "Fix with: chmod 600 '$cred'" >&2
      exit 3
    fi
    printf '%s' "$cred"
    return 0
  fi
  docs="$(resolve_documents)" || exit 1
  cred="$docs/API docs.md"
  if [ ! -f "$cred" ]; then
    echo "MISSING: $cred" >&2
    echo "Create a file named exactly 'API docs.md' in your Documents folder with this template:" >&2
    echo "  OLLAMA_API_KEY=replace_with_real_key" >&2
    echo "  DEEPSEEK_API_KEY=replace_with_real_key" >&2
    echo "  AGNES_API_KEY=replace_with_real_key" >&2
    echo "  OPENROUTER_API_KEY=replace_with_real_key   (optional)" >&2
    echo "  OLLAMA_PLAN=pro" >&2
    echo "  AGNES_PLAN=starter" >&2
    exit 1
  fi
  # TCC check: try reading a byte; if denied, emit the precise blocker.
  if ! head -c 1 "$cred" >/dev/null 2>&1; then
    echo "DENIED: macOS is blocking read access to $cred" >&2
    echo "Grant this Terminal / Claude Code process access to Documents in" >&2
    echo "System Settings > Privacy & Security > Files and Folders, then rerun." >&2
    exit 1
  fi
  # Tighten permissions if broader than necessary (best-effort).
  if [ "$(uname -s)" = "Darwin" ]; then
    chmod 600 "$cred" 2>/dev/null || true
  fi
  printf '%s' "$cred"
}

main "$@"
