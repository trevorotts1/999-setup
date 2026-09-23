#!/bin/bash
# Shared helpers for the claude-nine / claude-codex launchers. Sourced, not
# executed. nine-router-setup installs it next to the launcher ($HOME/.local/bin).
#
# Why this exists: an ~/.npmrc with ignore-scripts=true (common npm hardening)
# blocks @anthropic-ai/claude-code's postinstall. Without that postinstall,
# bin/claude.exe stays a ~500-byte placeholder that only prints
# "Error: claude native binary not installed." These helpers detect that state and
# repair it on launch, so a reinstall can never leave the CLI broken.

# Healing needs node; *running* the CLI does not. Resolve node up front but treat
# it as optional so a missing node degrades to "run the binary directly".
CC_NODE="${CC_NODE:-}"
if [ -z "$CC_NODE" ] || [ ! -x "$CC_NODE" ]; then
  CC_NODE="$(command -v node 2>/dev/null || true)"
fi

# Locate the installed claude-code package. Checks the known global prefix first
# because `npm root -g` costs ~300ms and these wrappers must feel instant.
cc_pkg_dir() {
  local d root
  for d in "$HOME/.npm-global/lib/node_modules/@anthropic-ai/claude-code"; do
    if [ -f "$d/install.cjs" ]; then
      printf '%s\n' "$d"
      return 0
    fi
  done
  root="$(npm root -g 2>/dev/null || true)"
  if [ -n "$root" ] && [ -f "$root/@anthropic-ai/claude-code/install.cjs" ]; then
    printf '%s\n' "$root/@anthropic-ai/claude-code"
    return 0
  fi
  return 1
}

# The real binary is a ~256 MB Mach-O; the un-installed placeholder is a ~500-byte
# shell script. 4096 is the same cutoff install.cjs uses to tell them apart.
cc_is_native() {
  [ -f "$1" ] && [ "$(/usr/bin/stat -f%z "$1" 2>/dev/null || echo 0)" -gt 4096 ]
}

# Echo the path of a runnable claude binary, repairing the install if needed.
cc_resolve_binary() {
  local pkg dest plat
  pkg="$(cc_pkg_dir)" || {
    # No npm package: Claude Code may come from the native installer
    # ($HOME/.local/bin/claude). Use the same `claude` plain claude runs.
    for plat in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude"; do
      if [ -n "$plat" ] && [ -x "$plat" ]; then
        printf '%s\n' "$plat"
        return 0
      fi
    done
    echo "claude: Claude Code is not installed." >&2
    echo "  Install it with: npm install -g @anthropic-ai/claude-code" >&2
    return 1
  }

  dest="$pkg/bin/claude.exe"
  if cc_is_native "$dest"; then
    printf '%s\n' "$dest"
    return 0
  fi

  # Placeholder detected. Repair via the package's own postinstall so that every
  # caller of the npm bin path gets fixed too, not just this wrapper.
  if [ -n "$CC_NODE" ] && [ -x "$CC_NODE" ]; then
    echo "🔧 claude: native binary not linked (npm postinstall was skipped) — repairing..." >&2
    "$CC_NODE" "$pkg/install.cjs" >&2 || true
    if cc_is_native "$dest"; then
      echo "✅ claude: repaired." >&2
      printf '%s\n' "$dest"
      return 0
    fi
  fi

  # Repair unavailable or failed: run the platform binary straight out of the
  # optional dependency, which npm downloads regardless of ignore-scripts.
  for plat in "$pkg"/node_modules/@anthropic-ai/claude-code-*/claude; do
    if cc_is_native "$plat"; then
      printf '%s\n' "$plat"
      return 0
    fi
  done

  echo "claude: no native binary found under $pkg." >&2
  echo "  Reinstall with: npm install -g @anthropic-ai/claude-code" >&2
  return 1
}

# Strip proxy/router config that an installer wrote into ~/.claude/settings.json.
# That file applies to EVERY claude run, so router config there silently hijacks
# the real CLI. Delegates to the .cjs so the JSON edit is done properly.
cc_scrub_router_settings() {
  local helper="${1:-}"
  [ -n "$CC_NODE" ] && [ -x "$CC_NODE" ] || return 0
  [ -f "$helper" ] || return 0
  "$CC_NODE" "$helper" || true
}
