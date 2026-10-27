#!/usr/bin/env bash
# Regression (DECISION 18): install-9router-guards.sh must find Node in the 999-managed prefix when PATH is
# narrow (cron, launchd, a new terminal that never sourced setup), must prefer that prefix over PATH, must
# fall back to the known Homebrew/system locations, and must name every path it tried when Node is nowhere
# instead of aborting with a bare "no node binary resolvable".
# Offline: fake node binaries that log which one ran, a fake 9Router bundle, a scratch HOME. No network,
# no real install, no launchd, and no real Node is used for cases 1-3.
# The installer is run as a byte-identical copy beside a STUB guard: its assets dir is derived from its own
# location, and a real guard searches absolute system paths and could patch a live 9Router outside $HOME.
# Usage: test-9router-node-resolve.sh   (INSTALLER=path overrides the script under test,
#                                       BASH_UNDER_TEST=/path/to/bash pins the interpreter)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
I_REAL="${INSTALLER:-$HERE/../scripts/macos/install-9router-guards.sh}"
BASH_UNDER_TEST="${BASH_UNDER_TEST:-bash}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export NODE_LOG="$T/node.log"
NARROW=/usr/bin:/bin

SK="$T/skill"; mkdir -p "$SK/scripts/macos" "$SK/assets/guards/patches/noop"
cp "$I_REAL" "$SK/scripts/macos/install-9router-guards.sh"
printf '#!/bin/sh\nexit 0\n' > "$SK/assets/guards/9router-dupfix-guard.sh"
chmod +x "$SK/assets/guards/9router-dupfix-guard.sh"
printf 'x\n' > "$SK/assets/guards/patches/noop/noop.txt"
I="$SK/scripts/macos/install-9router-guards.sh"

fail() { echo "FAIL: $1"; [ -f "$T/out" ] && sed 's/^/    | /' "$T/out"; exit 1; }

# Fake node: records which binary the installer chose. Only ever invoked as `node --check <file>`.
fake_node() {  # $1 = dir to create, $2 = canary
  mkdir -p "$1"
  cat > "$1/node" <<EOF
#!/bin/sh
echo "$2" >> "\$NODE_LOG"
exit 0
EOF
  chmod +x "$1/node"
}

# Fake 9Router package: enough to pass detection and reach the apply path, which is where "$NODE" is used.
mkdir -p "$T/pkg/app/.next-cli-build/server/chunks" "$T/pkg/app/.next-cli-build/server/app/api/usage/stream"
printf '{"name": "9router", "version": "0.5.100"}\n' > "$T/pkg/package.json"
printf 'var a=1;\n' > "$T/pkg/app/.next-cli-build/server/chunks/a.js"
printf 'var b=2;\n' > "$T/pkg/cli.js"
printf 'var c=3;\n' > "$T/pkg/app/.next-cli-build/server/app/api/usage/stream/route.js"

run() {  # $1 = PATH handed to the installer; echoes its exit code
  : > "$NODE_LOG"
  PATH="$1" "$BASH_UNDER_TEST" "$I" --no-restart --root "$T/pkg" dupfix >"$T/out" 2>&1
  echo $?
}

# 1. Narrow PATH with no node on it + Node in the 999-managed prefix: resolves, and uses THAT node.
fake_node "$HOME/.local/share/999/node/current/bin" PREFIX
rc="$(run "$NARROW")"
grep -q 'no node binary resolvable' "$T/out" && fail "narrow PATH + 999 prefix: still reported no node (rc=$rc)"
[ -s "$NODE_LOG" ] || fail "narrow PATH + 999 prefix: installer never ran a node (rc=$rc)"
grep -qx PREFIX "$NODE_LOG" || fail "narrow PATH + 999 prefix: node was not the 999 prefix one"

# 2. A different node on PATH as well: the 999 prefix wins (decided order: prefix, then PATH).
fake_node "$T/pathbin" PATHNODE
rc="$(run "$T/pathbin:$NARROW")"
grep -qx PREFIX "$NODE_LOG" || fail "precedence: 999 prefix node not used when PATH also has one (rc=$rc)"
grep -qx PATHNODE "$NODE_LOG" && fail "precedence: PATH node used before the 999 prefix node"

# 3. No Node anywhere: exit 2 and name every path tried (999 prefix dirs, PATH, the known locations).
rm -rf "$HOME/.local/share/999"
rc="$(PATH="$NARROW" NINEROUTER_NODE_SYSTEM_DIRS="$T/sys1 $T/sys2" \
      "$BASH_UNDER_TEST" "$I" --no-restart --root "$T/pkg" dupfix >"$T/out" 2>&1; echo $?)"
[ "$rc" = 2 ] || fail "no node anywhere: exit $rc, want 2"
grep -q 'no node binary resolvable; tried:' "$T/out" || fail "no node anywhere: missing the failure banner"
for p in "$HOME/.local/share/999/node/current/bin/node" \
         "$HOME/.local/share/999/npm/bin/node" \
         "PATH (no node on it)" \
         "$T/sys1/node" "$T/sys2/node"; do
  grep -qF "$p" "$T/out" || fail "no node anywhere: tried-path not named: $p"
done

# 4. No 999 Node, narrow PATH, but a Homebrew/system node exists: the known-locations tail must find it.
if [ -x /opt/homebrew/bin/node ] || [ -x /usr/local/bin/node ]; then
  : > "$NODE_LOG"
  PATH="$NARROW" "$BASH_UNDER_TEST" "$I" --no-restart --root "$T/pkg" dupfix >"$T/out" 2>&1
  grep -q 'no node binary resolvable' "$T/out" && fail "known locations: Homebrew/system node not found"
else
  echo "SKIP: no Homebrew/system node on this box (known-locations case)"
fi

echo "PASS: node resolves from the 999 prefix first (narrow PATH), then PATH, then known locations; failure names every path tried"
