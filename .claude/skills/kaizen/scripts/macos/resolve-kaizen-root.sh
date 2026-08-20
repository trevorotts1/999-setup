#!/bin/bash
# Print the Kaizen memory root using the OpenClaw Master Files decision rule.
#
# Rule: search the real Downloads folder only, depth <= 3, case-insensitive.
#   Count every folder whose name is "OpenClaw Master Files" (Kaizen
#   subfolder NOT required to count).
#   Exactly one match  -> "<match>/Kaizen"
#   Zero or more than one -> "<Downloads>/Kaizen"
#
# Deterministic, read-only. Does not create folders.
#
# Bash 3.2 + `set -u` safe: no arrays are ever expanded when empty
# (newline-delimited strings are counted with awk instead).

set -u

if [ -n "${KAIZEN_DOWNLOADS:-}" ]; then
  DOWNLOADS="$KAIZEN_DOWNLOADS"
else
  # Resolve the real Downloads folder via Finder's preference (handles
  # moved folders, symlinks, iCloud Desktop & Documents). Fall back to
  # $HOME/Downloads only when osascript fails or returns nothing.
  if command -v osascript >/dev/null 2>&1 && [ -n "${HOME:-}" ]; then
    REAL="$(osascript -e 'POSIX path of (path to downloads folder)' 2>/dev/null || true)"
    if [ -n "$REAL" ]; then
      DOWNLOADS="$(printf '%s' "$REAL" | sed 's|/*$||')"
    else
      DOWNLOADS="$HOME/Downloads"
    fi
  else
    DOWNLOADS="${HOME:-}/Downloads"
  fi
fi

if [ ! -d "$DOWNLOADS" ]; then
  printf '%s\n' "$DOWNLOADS/Kaizen"
  exit 0
fi

# Count matches without arrays: find emits one path per line, awk counts.
# find maxdepth: 1 = inside Downloads, 2 = one level below, 3 = two levels
# below. Deeper folders are invisible to the decision rule.
count="$(find "$DOWNLOADS" -maxdepth 3 -type d 2>/dev/null \
  | awk '{n=split($0,a,"/"); if (tolower(a[n])=="openclaw master files") c++} END{print c+0}')"
single="$(find "$DOWNLOADS" -maxdepth 3 -type d 2>/dev/null \
  | awk '{n=split($0,a,"/"); if (tolower(a[n])=="openclaw master files") {print; exit}}')"

if [ "$count" -eq 1 ]; then
  printf '%s\n' "$single/Kaizen"
else
  printf '%s\n' "$DOWNLOADS/Kaizen"
fi
