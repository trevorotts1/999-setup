#!/usr/bin/env bash
# NFX001 B4: the skill-link functions of setup-macos.sh must load when a temp copy of the
# script is sourced under `bash -c` (where $0 is "bash") from an unrelated cwd.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D="$REPO/.claude/skills/nine-router-setup/scripts"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
sed '$d' "$D/setup-macos.sh" > "$T/copy.sh"
fail=0
out="$(cd / && NINE_SETUP_SCRIPT_DIR="$D" bash -c '. "$1"; declare -F link_one_skill >/dev/null && echo "SKILL_DIR=$SKILL_DIR REPO_ROOT=$REPO_ROOT"' _ "$T/copy.sh" 2>&1)"
case "$out" in *"SKILL_DIR=$D/.. "*|*"SKILL_DIR=$REPO/.claude/skills/nine-router-setup REPO_ROOT=$REPO") echo "PASS B4 temp copy sourced from / resolves the real dirs";; *) echo "FAIL B4: $out"; fail=1;; esac
out="$(cd / && bash -c '. "$1"; echo "REPO_ROOT=$REPO_ROOT"' _ "$D/setup-macos.sh" 2>&1 | grep -v '^$' | head -1)"
case "$out" in *"No such file"*) echo "FAIL B4 direct source from /: $out"; fail=1;; *) echo "PASS B4 sourcing the real file by path from / has no path error";; esac
exit $fail
