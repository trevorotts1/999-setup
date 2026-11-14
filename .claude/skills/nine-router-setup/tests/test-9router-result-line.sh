#!/usr/bin/env bash
# Regression (BFX-011 / C14): `install-9router-guards.sh --upgrade` must print ONE machine line
#     9ROUTER-RESULT rc=<exit code> from=<version before> to=<version installed at exit>
# as the very last line of EVERY --upgrade run, whatever the exit code, so the Big Fleet Roll tool reads the
# verdict from the line instead of parsing `npm ls`. The reader regex (BFX-013) is
#     ^9ROUTER-RESULT rc=([0-9]+) from=(\S*) to=(\S*)$
# and the line must match it byte for byte (exactly one such line, last, LF-terminated, on stdout, nothing after).
# Exit codes keep their meaning: 0 verified, 2 tooling/usage, 3 rolled back and proven, 4 rollback incomplete
# (1 = a patched file does not parse; it is not part of the reader's map but still carries the line).
# Offline: fake npm / curl / claude-nine in a scratch HOME and a scratch PATH, a fake 9Router bundle, a STUB guard.
# The installer is run as a byte-identical COPY beside the stub guard (its assets dir derives from its own
# location), so no real guard can touch a live 9Router and no routed request is ever sent.
# Usage: test-9router-result-line.sh   (INSTALLER=path overrides the script under test,
#                                       BASH_UNDER_TEST=/path/to/bash pins the interpreter)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
I_REAL="${INSTALLER:-$HERE/../scripts/macos/install-9router-guards.sh}"
BASH_UNDER_TEST="${BASH_UNDER_TEST:-bash}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
NODE_OK=0; for n in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node || true)"; do [ -x "$n" ] && NODE_OK=1; done
[ "$NODE_OK" = 1 ] || { echo "SKIP: no node on this box"; exit 0; }
command -v python3 >/dev/null 2>&1 || { echo "SKIP: no python3 on this box"; exit 0; }

SK="$T/skill"; mkdir -p "$SK/scripts/macos" "$SK/assets/guards/patches/noop"
cp "$I_REAL" "$SK/scripts/macos/install-9router-guards.sh"
printf '#!/bin/sh\nexit 0\n' > "$SK/assets/guards/9router-nextserver-guard.sh"; chmod +x "$SK/assets/guards/9router-nextserver-guard.sh"
printf 'x\n' > "$SK/assets/guards/patches/noop/noop.txt"
I="$SK/scripts/macos/install-9router-guards.sh"

# Scratch PATH first: a fake claude-nine (the real one would send a paid routed request) and a fake curl (health).
mkdir -p "$T/bin"
printf '#!/bin/sh\necho "routing works"\n' > "$T/bin/claude-nine"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/curl"
chmod +x "$T/bin/claude-nine" "$T/bin/curl"
export PATH="$T/bin:$PATH"

# Fake npm. FAKE_MODE=real   -> installs the asked version at <prefix>/lib/node_modules/9router
#           FAKE_MODE=noop   -> exits 0 and changes nothing
#           FAKE_MODE=other  -> installs 0.5.150 whatever was asked, except the rollback pin 0.5.100 (rollback works)
#           FAKE_MODE=failrb -> installs 0.5.150 whatever was asked, and FAILS the rollback pin (rollback impossible)
cat > "$T/npm" <<'NPM'
#!/usr/bin/env bash
[ "$1" = view ] && { echo 0.5.200; exit 0; }
[ "$1" = install ] || exit 0
while [ $# -gt 0 ]; do case "$1" in --prefix) P="$2"; shift ;; 9router@*) V="${1#9router@}" ;; esac; shift; done
[ "$V" = latest ] && V=0.5.200
[ "$FAKE_MODE" = noop ] && exit 0
if [ "$FAKE_MODE" = failrb ] && [ "$V" = 0.5.100 ]; then exit 1; fi
{ [ "$FAKE_MODE" = other ] || [ "$FAKE_MODE" = failrb ]; } && [ "$V" != 0.5.100 ] && V=0.5.150
D="$P/lib/node_modules/9router"
mkdir -p "$D"; printf '{"name": "9router", "version": "%s"}\n' "$V" > "$D/package.json"
NPM
chmod +x "$T/npm"; export NINEROUTER_NPM="$T/npm"

# Fake bundle at <prefix>/lib/node_modules/9router, version 0.5.100. $2 = "bad" makes a chunk that does not parse;
# $3 = "nomarker" leaves the nextserver patch marker out (rollback re-proof then fails).
mkroot() {
  local d="$1/lib/node_modules/9router"; local c="$d/app/.next-cli-build/server/chunks"
  mkdir -p "$c" "$d/app/.next-cli-build/server/app/api/usage/stream"
  printf '{"name": "9router", "version": "0.5.100"}\n' > "$d/package.json"
  if [ "${2:-}" = bad ]; then printf 'var a=;\n' > "$c/a.js"; else printf 'var a=1;\n' > "$c/a.js"; fi
  if [ "${3:-}" = nomarker ]; then printf 'var b=2;\n' > "$d/cli.js"
  else printf '/*__r9OwnNextServerPids __r9OwnNextServerPids*/var b=2;\n' > "$d/cli.js"; fi
  printf '%s\n' "$d"
}

fail() { echo "FAIL: $1"; [ -f "$T/out" ] && sed 's/^/    | /' "$T/out"; exit 1; }

# run <label> <expected rc> <expected from> <expected to> <installer args...>
# Merged stdout+stderr go to one file: the strictest reading of "last line".
check() {
  local label="$1" erc="$2" efrom="$3" eto="$4"; shift 4
  "$BASH_UNDER_TEST" "$I" "$@" >"$T/out" 2>&1; local rc=$?
  [ "$rc" = "$erc" ] || fail "$label: exit $rc, want $erc"
  python3 -I - "$T/out" "$erc" "$efrom" "$eto" <<'PY' || fail "$label: result line wrong"
import re, sys
raw = open(sys.argv[1], "rb").read()
erc, efrom, eto = sys.argv[2:5]
lines = raw.split(b"\n")
assert raw.endswith(b"\n"), "output does not end with a newline"
assert lines[-1] == b"", "unexpected trailing bytes"
last = lines[-2].decode("utf-8", "replace")
m = re.fullmatch(r"9ROUTER-RESULT rc=([0-9]+) from=(\S*) to=(\S*)", last)
assert m, "last line is not the result line: %r" % last
assert sum(1 for l in lines if l.startswith(b"9ROUTER-RESULT")) == 1, "result line is not unique"
assert m.groups() == (erc, efrom, eto), "got %r want %r" % (m.groups(), (erc, efrom, eto))
PY
}

# 1. exit 0: patches proven, health answers, routed request answers.
R="$(mkroot "$T/p1")"
FAKE_MODE=real check "success" 0 0.5.100 0.5.104 --no-restart --root "$R" --upgrade 0.5.104 nextserver
grep -q 'upgrade verified' "$T/out" || fail "success: upgrade not verified (wrong path taken)"

# 2. exit 2: npm "succeeds" but ROOT is untouched.
R="$(mkroot "$T/p2")"
FAKE_MODE=noop check "npm no-op" 2 0.5.100 0.5.100 --no-restart --root "$R" --upgrade 0.5.104 nextserver

# 2b. stdout-only reader: the line is on stdout, never on stderr, and is the last stdout line.
FAKE_MODE=noop "$BASH_UNDER_TEST" "$I" --no-restart --root "$R" --upgrade 0.5.104 nextserver >"$T/so" 2>"$T/se"
tail -n 1 "$T/so" | grep -qx '9ROUTER-RESULT rc=2 from=0.5.100 to=0.5.100' || fail "stdout-only: last stdout line is not the result line"
grep -q 'ROUTER-RESULT' "$T/se" && fail "stdout-only: result line leaked to stderr"

# 3. exit 2: a version range is refused before anything is installed.
R="$(mkroot "$T/p3")"
FAKE_MODE=real check "version range refused" 2 0.5.100 0.5.100 --no-restart --root "$R" --upgrade '^0.5' nextserver

# 4. exit 2: ROOT outside any node_modules (prefix cannot be derived) - from falls back to the live version.
mkdir -p "$T/odd"; cp -R "$T/p3/lib/node_modules/9router" "$T/odd/9router"
FAKE_MODE=real check "odd root refused" 2 0.5.100 0.5.100 --no-restart --root "$T/odd/9router" --upgrade 0.5.104 nextserver

# 5. exit 2 before any package exists (usage error): both sides empty, the line is still there.
FAKE_MODE=real check "usage error" 2 "" "" --bogus --upgrade
FAKE_MODE=real check "no package" 2 "" "" --no-restart --root "$T/does-not-exist" --upgrade

# 6. exit 3: landed on a version nobody asked for, rolled back, patches re-proven.
R="$(mkroot "$T/p6")"
FAKE_MODE=other check "rolled back" 3 0.5.100 0.5.100 --no-restart --root "$R" --upgrade 0.5.104 nextserver
grep -q 'rollback OK' "$T/out" || fail "rolled back: not the proven-rollback path"

# 7. exit 4, rollback reinstalled the old version but the patches are not proven: to is the version on disk.
R="$(mkroot "$T/p7" ok nomarker)"
FAKE_MODE=other check "rollback unproven" 4 0.5.100 0.5.100 --no-restart --root "$R" --upgrade 0.5.104 nextserver
grep -q 'ROLLBACK INCOMPLETE' "$T/out" || fail "rollback unproven: wrong path"

# 8. exit 4, rollback impossible: the box stays on the wrong version and the line says so (from != to).
R="$(mkroot "$T/p8")"
FAKE_MODE=failrb check "rollback failed" 4 0.5.100 0.5.150 --no-restart --root "$R" --upgrade 0.5.104 nextserver
grep -q 'ROLLBACK FAILED' "$T/out" || fail "rollback failed: wrong path"

# 9. exit 1: upgraded, but a patched file does not parse (no rollback on this path).
R="$(mkroot "$T/p9" bad)"
FAKE_MODE=real check "syntax fail" 1 0.5.100 0.5.104 --no-restart --root "$R" --upgrade 0.5.104 nextserver
grep -q 'SYNTAX FAIL' "$T/out" || fail "syntax fail: wrong path"

# 10. --help with --upgrade still ends on the line (exit 0); a version never read stays empty-safe.
FAKE_MODE=real check "help" 0 "" "" --help --upgrade

# 11. NO line without --upgrade (--check run and a plain usage error).
R="$(mkroot "$T/p11")"
"$BASH_UNDER_TEST" "$I" --check --no-restart --root "$R" nextserver >"$T/out" 2>&1
grep -q '9ROUTER-RESULT' "$T/out" && fail "--check without --upgrade printed a result line"
"$BASH_UNDER_TEST" "$I" --bogus >"$T/out" 2>&1
grep -q '9ROUTER-RESULT' "$T/out" && fail "usage error without --upgrade printed a result line"

echo "PASS: every --upgrade exit (0,1,2,3,4) ends with one byte-exact 9ROUTER-RESULT line; no line without --upgrade"
