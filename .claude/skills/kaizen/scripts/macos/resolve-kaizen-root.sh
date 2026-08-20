#!/bin/bash
# Print the Kaizen memory root using the OpenClaw Master Files decision rule.
#
# Rule: search $HOME/Downloads only, depth <= 3, case-insensitive.
#   Exactly one "OpenClaw Master Files" folder that contains "Kaizen" -> print it.
#   Zero or more than one -> print "$HOME/Downloads/Kaizen".
#
# Deterministic, read-only. Does not create folders.

set -euo pipefail

DOWNLOADS="${KAIZEN_DOWNLOADS:-$HOME/Downloads}"
if [ ! -d "$DOWNLOADS" ]; then
  printf '%s\n' "$DOWNLOADS/Kaizen"
  exit 0
fi

candidates=()
while IFS= read -r dir; do
  name="$(basename "$dir")"
  lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  if [ "$lower" = "openclaw master files" ] && [ -d "$dir/Kaizen" ]; then
    candidates+=("$(cd "$dir/Kaizen" && pwd -P)")
  fi
done < <(find "$DOWNLOADS" -maxdepth 3 -type d 2>/dev/null)

# Deduplicate, preserving order.
unique=()
for c in "${candidates[@]}"; do
  found=0
  for u in "${unique[@]}"; do
    if [ "$u" = "$c" ]; then found=1; break; fi
  done
  if [ "$found" -eq 0 ]; then unique+=("$c"); fi
done

if [ "${#unique[@]}" -eq 1 ]; then
  printf '%s\n' "${unique[0]}"
else
  printf '%s\n' "$DOWNLOADS/Kaizen"
fi
