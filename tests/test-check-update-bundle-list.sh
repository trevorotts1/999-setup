#!/usr/bin/env bash
# CON-11: check-update.sh must read its skill list from CONTROL/bundled-skills.txt
# and accept skill-version.txt when VERSION is absent. Offline: python3 http.server
# on loopback serves the "published" tree. Fails on a hard-coded five-skill list.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$REPO/.claude/skills/spec-protocol/tools/check-update.sh"
command -v python3 >/dev/null || { echo "SKIPPED: python3 required"; exit 0; }

TMP="$(mktemp -d)"; LOCAL="$TMP/local"; REMOTE="$TMP/remote"; SRV=""
trap '[ -n "$SRV" ] && kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT
FAILS=0
check() { if [ "$2" = ok ]; then echo "PASS $1"; else echo "FAIL $1"; sed 's/^/    /' "$TMP/out"; FAILS=$((FAILS+1)); fi; }

# Published tree: the repo's real list + a version file per listed skill.
mkdir -p "$REMOTE/CONTROL" "$REMOTE/.claude/skills" "$LOCAL"
cp "$REPO/CONTROL/bundled-skills.txt" "$REMOTE/CONTROL/"
while IFS= read -r s; do
  case "$s" in ''|'#'*) continue ;; esac
  mkdir -p "$REMOTE/.claude/skills/$s" "$LOCAL/$s"
  f=VERSION; [ -f "$REPO/.claude/skills/$s/VERSION" ] || f=skill-version.txt
  printf '1.0.0\n' > "$REMOTE/.claude/skills/$s/$f"; printf '1.0.0\n' > "$LOCAL/$s/$f"
done < "$REMOTE/CONTROL/bundled-skills.txt"

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REMOTE" >/dev/null 2>&1 & SRV=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/CONTROL/bundled-skills.txt" && break; sleep 0.1; done

run() { HOME="$TMP" SPEC_PROTOCOL_LOCAL_SKILLS_ROOT="$LOCAL" SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 \
  SPEC_PROTOCOL_SKILLS_URL_BASE="http://127.0.0.1:$PORT/.claude/skills" bash "$TARGET" >"$TMP/out" 2>&1; RC=$?; }

run
[ "$RC" -eq 0 ] && grep -q "current — black-friday-launcher 1.0.0" "$TMP/out" && ! grep -q UNDETERMINED "$TMP/out" \
  && check "list from CONTROL/bundled-skills.txt; skill-version.txt accepted -> exit 0" ok \
  || check "list from CONTROL/bundled-skills.txt; skill-version.txt accepted -> exit 0 (rc=$RC)" bad

printf '1.1.0\n' > "$REMOTE/.claude/skills/black-friday-launcher/skill-version.txt"
run
[ "$RC" -eq 1 ] && grep -q "UPDATE AVAILABLE black-friday-launcher  1.0.0 -> 1.1.0" "$TMP/out" \
  && check "bumped black-friday-launcher skill-version.txt -> update, exit 1" ok \
  || check "bumped black-friday-launcher skill-version.txt -> update, exit 1 (rc=$RC)" bad

exit $((FAILS > 0))
