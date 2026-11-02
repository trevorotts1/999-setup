#!/bin/bash
# DTY-09: the D1 downsell wrapper refuses any Skill 81 byte that differs from
# its PIN_* constants. Assert every PIN_* equals the sha256 of the vendored
# Skill 81 file it guards, so a sync that moves 81 without the wrapper (or the
# reverse) fails here instead of failing closed at run time.
#
# Run: bash tests/test-downsell-wrapper-pins.sh
set -uo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WRAPPER="$REPO_ROOT/.claude/skills/signature-funnel/scripts/downsell_wrapper.py"
SKILL81="$REPO_ROOT/.claude/skills/signature-downsell"

[ -f "$WRAPPER" ] || { echo "FAIL: wrapper missing: $WRAPPER"; exit 1; }
[ -d "$SKILL81" ] || { echo "FAIL: vendored skill 81 missing: $SKILL81"; exit 1; }

python3 -I - "$WRAPPER" "$SKILL81" <<'PY'
import hashlib, pathlib, re, sys

wrapper, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
src = wrapper.read_text()
guarded = {  # PIN_* constant -> vendored 81 file it guards (see _load_skill81)
    "PIN_VALIDATE_DOWNSELL": "validators/validate_downsell.py",
    "PIN_REQUEST_SCHEMA": "schemas/downsell-request.schema.json",
    "PIN_EXTENSION_SCHEMA": "schemas/downsell-result-extension.schema.json",
}
bad = 0
for name, rel in guarded.items():
    m = re.search(rf'^{name}\s*=\s*\\?\s*"([0-9a-f]{{64}})"', src, re.M)
    f = root / rel
    if not m:
        print(f"  FAIL: {name} not found in wrapper"); bad += 1; continue
    if not f.is_file():
        print(f"  FAIL: {rel} missing"); bad += 1; continue
    got = hashlib.sha256(f.read_bytes()).hexdigest()
    if got == m.group(1):
        print(f"  ok: {name} matches {rel}")
    else:
        print(f"  FAIL: {name} pins {m.group(1)[:12]}... but {rel} is {got[:12]}...")
        bad += 1
sys.exit(1 if bad else 0)
PY
rc=$?
[ "$rc" -eq 0 ] && echo "RESULT: all wrapper pins match" || echo "RESULT: pin mismatch"
exit "$rc"
