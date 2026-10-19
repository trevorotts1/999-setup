#!/usr/bin/env bash
# Regression (CAN008): install-9router-guards.sh --upgrade must install into the npm prefix that OWNS
# --root, and must fail loudly if the package at ROOT does not end up at the target version.
# Offline: a fake npm (NINEROUTER_NPM) in a scratch HOME; no network, no real install, no launchd.
# Usage: test-9router-upgrade-prefix.sh   (INSTALLER=path overrides the script under test)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
I="${INSTALLER:-$HERE/../scripts/macos/install-9router-guards.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
NODE_OK=0; for n in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do [ -x "$n" ] && NODE_OK=1; done
[ "$NODE_OK" = 1 ] || { echo "SKIP: no node on this box"; exit 0; }

# Fake npm. FAKE_MODE=real  -> installs <prefix>/lib/node_modules/9router (FAKE_LAYOUT=win: <prefix>/node_modules/9router)
#           FAKE_MODE=noop  -> exits 0 and changes nothing (what the old wrong-prefix install looked like to ROOT)
cat > "$T/npm" <<'NPM'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
[ "$1" = view ] && { echo 0.5.200; exit 0; }
[ "$1" = install ] || exit 0
while [ $# -gt 0 ]; do case "$1" in --prefix) P="$2"; shift ;; 9router@*) V="${1#9router@}" ;; esac; shift; done
[ "$V" = latest ] && V=0.5.200
[ "$FAKE_MODE" = noop ] && exit 0
D="$P/lib/node_modules/9router"; [ "$FAKE_LAYOUT" = win ] && D="$P/node_modules/9router"
mkdir -p "$D"; printf '{"version": "%s"}\n' "$V" > "$D/package.json"
NPM
chmod +x "$T/npm"; export NINEROUTER_NPM="$T/npm" FAKE_LOG="$T/npm.log"

mkroot() { mkdir -p "$1"; printf '{"version": "0.5.100"}\n' > "$1/package.json"; }
run() { : > "$FAKE_LOG"; "$I" --no-restart --root "$1" --upgrade "$2" >"$T/out" 2>&1; echo $?; }
fail() { echo "FAIL: $1"; cat "$T/out"; echo "--- npm log"; cat "$FAKE_LOG"; exit 1; }

# 1. unix layout, custom 999 prefix: --prefix is <prefix>, not <prefix>/lib; ROOT itself ends at the target.
R="$T/p1/lib/node_modules/9router"; mkroot "$R"
rc="$(FAKE_MODE=real run "$R" 0.5.104)"
grep -q -- "--prefix $T/p1 " "$FAKE_LOG" || fail "unix layout: npm not given --prefix $T/p1"
grep -q '"0.5.104"' "$R/package.json" || fail "unix layout: package at ROOT not upgraded"
grep -q 'NOT upgraded' "$T/out" && fail "unix layout: false NOT-upgraded"
[ -e "$T/p1/lib/lib" ] && fail "unix layout: stray lib/lib created"

# 2. windows layout: <prefix>/node_modules/9router
R="$T/p2/node_modules/9router"; mkroot "$R"
rc="$(FAKE_MODE=real FAKE_LAYOUT=win run "$R" 0.5.104)"
grep -q -- "--prefix $T/p2 " "$FAKE_LOG" || fail "windows layout: npm not given --prefix $T/p2"
grep -q '"0.5.104"' "$R/package.json" || fail "windows layout: package at ROOT not upgraded"

# 3. dist-tag: target resolved through `npm view` (0.5.200) and verified at ROOT.
R="$T/p3/lib/node_modules/9router"; mkroot "$R"
rc="$(FAKE_MODE=real run "$R" latest)"
grep -q '"0.5.200"' "$R/package.json" || fail "latest: package at ROOT not at resolved version"

# 4. npm "succeeds" but ROOT is untouched (the CAN008 symptom): must exit 2 and say so.
R="$T/p4/lib/node_modules/9router"; mkroot "$R"
rc="$(FAKE_MODE=noop run "$R" 0.5.104)"
[ "$rc" = 2 ] && grep -q 'NOT upgraded' "$T/out" || fail "unchanged ROOT not reported (rc=$rc)"

# 5. ROOT outside any node_modules: refuse instead of guessing a prefix.
R="$T/odd/9router"; mkroot "$R"
rc="$(FAKE_MODE=real run "$R" 0.5.104)"
[ "$rc" = 2 ] && [ ! -s "$FAKE_LOG" ] || fail "odd ROOT not refused (rc=$rc)"

echo "PASS: --upgrade derives the owning npm prefix and verifies the package at ROOT"
