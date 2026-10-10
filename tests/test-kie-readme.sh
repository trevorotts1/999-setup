#!/usr/bin/env bash
# test-kie-readme.sh — README.md must carry the KIE section (unit KIE-U5).
#
# Checks, against the README itself, that it documents: the client's own
# KIE_API_KEY stored in the settings.json env block of each config root at
# permission 600 and reported only as SET or NOT SET; skill 74 as the single
# paid door with the credits check that moves shadow -> active; the KIE helpers
# in both config roots plus sync-nine-skills.sh; the front-door kie skill as
# the entry point for image, video and audio; the 20 requests per 10 seconds
# rate limit; that no KIE MCP exists; and the pointer to AGENT_INSTALL.md.
#
# Also proves the repository adds no MCP of any kind (no .mcp.json, no
# mcpServers registration).
#
# No skips, no network, no fixture-only proof: every check runs on every run,
# and each required phrase gets a negative control — the phrase is deleted from
# a temp copy of the normalized text and the same check must then report it
# missing, so a checker that cannot fail would fail here.
#
# Usage: bash tests/test-kie-readme.sh [path/to/README.md]
# Exits 0 only when every check passes.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
README="${1:-$ROOT/README.md}"

[ -f "$README" ] || { echo "FAIL  README not found: $README"; exit 1; }

passes=0
failures=0
check() { # check <0|nonzero> <label>
  if [ "$1" = "0" ]; then passes=$((passes + 1)); echo "PASS  $2"
  else failures=$((failures + 1)); echo "FAIL  $2"; fi
}

# Normalized text: newlines and runs of spaces collapsed, markdown backticks
# stripped, so a line-wrapped or `code`-spanned phrase still matches.
NORMALIZED="$(tr '\n' ' ' < "$README" | sed 's/`//g' | tr -s ' \t' ' ')"

has_phrase() { # has_phrase <text> <phrase>  -> 0 when present (case-insensitive)
  printf '%s' "$1" | grep -qiF -- "$2"
}

# --- Required phrases (written exactly as they read after normalization) ----
PHRASES=(
  "KIE_API_KEY"
  "~/.claude/settings.json"
  "~/.claude-nine/settings.json"
  "permission 600"
  "SET or NOT SET"
  "front-door kie skill"
  "image, video and audio"
  "skill 74"
  "single paid door"
  "credits check"
  "shadow"
  "active"
  "~/.claude/skills"
  "~/.claude-nine/skills"
  "sync-nine-skills.sh"
  "20 requests per 10 seconds"
  "no KIE MCP"
  "no .mcp.json entry"
  "AGENT_INSTALL.md"
  "## KIE"
)

LABELS=(
  "README names the variable KIE_API_KEY"
  "README names the config root ~/.claude/settings.json"
  "README names the config root ~/.claude-nine/settings.json"
  "README states permission 600"
  "README states the key is shown only as SET or NOT SET"
  "README names the front-door kie skill"
  "README names image, video and audio as the entry point work"
  "README names skill 74"
  "README calls skill 74 the single paid door"
  "README documents the credits check"
  "README documents shadow mode"
  "README documents the active mode flip"
  "README names the config root ~/.claude/skills"
  "README names the config root ~/.claude-nine/skills"
  "README names sync-nine-skills.sh"
  "README states the 20 requests per 10 seconds rate limit"
  "README states there is no KIE MCP"
  "README states no .mcp.json entry exists"
  "README points to AGENT_INSTALL.md"
  "README carries a KIE section heading"
)

# --- Negative controls: deleting a phrase must make its own check fail -------
NC="$(mktemp -d "${TMPDIR:-/tmp}/TrevelynsMini2-KIE-U5-readme.XXXXXX")"
trap 'rm -rf "$NC"' EXIT

negative_control() { # negative_control <phrase>
  local phrase="$1" copy="$NC/without.txt"
  printf '%s' "$NORMALIZED" > "$copy"
  # Delete every occurrence (case-insensitive), then the check must not find it.
  python3 - "$copy" "$phrase" <<'PY'
import re, sys, pathlib
path, phrase = pathlib.Path(sys.argv[1]), sys.argv[2]
path.write_text(re.sub(re.escape(phrase), "", path.read_text(), flags=re.IGNORECASE))
PY
  if has_phrase "$(cat "$copy")" "$phrase"; then
    echo "  negative control: '$phrase' still found after deletion"
    return 1
  fi
  return 0
}

i=0
while [ "$i" -lt "${#PHRASES[@]}" ]; do
  phrase="${PHRASES[$i]}"
  label="${LABELS[$i]}"
  has_phrase "$NORMALIZED" "$phrase"; check $? "$label"
  negative_control "$phrase"; check $? "negative control — checker fails without: $phrase"
  i=$((i + 1))
done

# --- No MCP of any kind may be added ----------------------------------------
MCP_FILES="$(cd "$ROOT" && find . -name '.mcp.json' -o -name 'mcp.json' 2>/dev/null | sed 's|^\./||')"
[ -z "$MCP_FILES" ]; check $? "no .mcp.json (or mcp.json) file exists in the repository"
has_phrase "$NORMALIZED" "mcpServers"; test $? -ne 0
check $? "README registers no mcpServers block"

# --- Repo-side evidence the section points at is really there ---------------
[ -f "$ROOT/AGENT_INSTALL.md" ]; check $? "AGENT_INSTALL.md exists (the pointer resolves)"
[ -d "$ROOT/installer-registration/helpers/74-kie-live-adapter" ]; check $? "helper 74-kie-live-adapter exists in installer-registration/helpers"
[ -d "$ROOT/installer-registration/helpers/66-kie-image" ] &&
[ -d "$ROOT/installer-registration/helpers/67-kie-video" ] &&
[ -d "$ROOT/installer-registration/helpers/68-kie-audio" ]
check $? "helpers 66/67/68 (image, video, audio) exist in installer-registration/helpers"

echo
echo "$passes passed, $failures failed"
[ "$failures" -eq 0 ]
