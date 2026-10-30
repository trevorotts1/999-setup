#!/usr/bin/env bash
# Offline test (no npm, no network, throwaway HOME): the ping-keepalive guard honours the 9Router root the installer passes.
# Before: the guard read its first argument as the MODE only and searched five fixed prefixes, so a 9Router under
# ~/.local/lib/node_modules/9router (npm prefix ~/.local) printed "no 9router chunks dir found - NOT guarded." on every run and
# `install-9router-guards.sh --upgrade` always rolled back (Big Fleet Roll 2026-10-29, rescue-star-bobatoon).
# The fake chunk carries only what the guard locates by content: the chat handler's export getter and its `async function X(a,b=null)`.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
G="$HERE/../assets/guards/9router-ping-keepalive-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
command -v node >/dev/null 2>&1 || { echo "FAIL no node"; exit 2; }

# mkpkg <package dir>: a minimal 9Router package whose one chunk holds the chat handler
mkpkg() { local C="$1/app/.next-cli-build/server/chunks"; mkdir -p "$C"; echo '{"name":"9router","version":"9.9.9"}' >"$1/package.json"
  cat >"$C/8635.js" <<'JS'
"use strict";exports.id=8635,exports.ids=[8635],exports.modules={1:(a,b,c)=>{c.d(b,{P:()=>handleChat})}};
async function handleChat(a,b=null){let c;try{c=await a.json()}catch{return new Response("Invalid JSON body")}if(!c.model)return new Response("Missing model");return new Response("ok")}
JS
  echo "$C/8635.js"; }
mk=/*ping-keepalive-v3*/

# 1. the case that failed: root under ~/.local/lib/node_modules, none of the five fixed prefixes exists on this HOME
R="$HOME/.local/lib/node_modules/9router"; F="$(mkpkg "$R")"
out="$(bash "$G" --check "$R" 2>&1)"; rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'MISSING in 8635.js (patchable)' && ! grep -qF "$mk" "$F" && ok "--check ROOT finds the package under ~/.local and writes nothing" || bad "--check ROOT rc=$rc: $out"
out="$(bash "$G" "$R" 2>&1)"; rc=$?   # exactly how the installer calls it: root as the only argument
[ $rc -eq 0 ] && echo "$out" | grep -q 'patched 8635.js' && grep -qF "$mk" "$F" && ok "ROOT as the only argument (installer call) patches the package under ~/.local" || bad "apply ROOT rc=$rc: $out"
node --check "$F" 2>/dev/null && ok "patched chunk parses" || bad "patched chunk syntax"
out="$(bash "$G" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q 'already patched' && ok "second run is a no-op" || bad "second run rc=$rc: $out"

# 2. fixed prefixes stay a fallback when no root is given (including the new ~/.local/lib/node_modules one)
R2="$HOME/.local/lib/node_modules/9router"; rm -rf "$R2"; F2="$(mkpkg "$R2")"
out="$(bash "$G" 2>&1)"; rc=$?
[ $rc -eq 0 ] && grep -qF "$mk" "$F2" && ok "no root: fallback list reaches ~/.local/lib/node_modules/9router" || bad "fallback rc=$rc: $out"

# 3. a root that is passed wins over the fallback: the fixed-prefix install must stay untouched
rm -rf "$HOME/.local"; LIVE="$HOME/.npm-global/lib/node_modules/9router"; FL="$(mkpkg "$LIVE")"; SC="$T/scratch/9router"; FS="$(mkpkg "$SC")"
out="$(bash "$G" "$SC" 2>&1)"; rc=$?
[ $rc -eq 0 ] && grep -qF "$mk" "$FS" && ! grep -qF "$mk" "$FL" && ok "passed root is patched, the fixed-prefix install is not" || bad "root wins rc=$rc: $out"

# 4. a passed root with no chunks dir fails closed and does not fall back to the fixed prefixes
out="$(bash "$G" "$T/nowhere/9router" 2>&1)"; rc=$?
[ $rc -eq 1 ] && echo "$out" | grep -q 'NOT guarded' && ! grep -qF "$mk" "$FL" && ok "bad root: exit 1, NOT guarded, fixed-prefix install untouched" || bad "bad root rc=$rc: $out"

# 5. installer path: --check proves the marker through --root (what run_guard feeds), then apply patches the ~/.local package
rm -rf "$HOME/.npm-global" "$T/scratch"; R="$HOME/.local/lib/node_modules/9router"; F="$(mkpkg "$R")"
mkdir -p "$HOME/.9router"
out="$(bash "$HERE/../scripts/macos/install-9router-guards.sh" --no-restart --root "$R" ping-keepalive 2>&1)"; rc=$?
echo "$out" | grep -q '^\[guards\] ping-keepalive: rc=0$' && grep -qF "$mk" "$F" && ok "install-9router-guards.sh --root ~/.local/... runs ping-keepalive rc=0 and the marker is on disk" || bad "installer rc=$rc: $(echo "$out" | tail -4)"
echo "$out" | grep -q '^\[guards\] OK   ping-keepalive: anthropic keepalive (1 hit, need 1)$' && ok "installer proof row: OK ping-keepalive" || bad "installer proof row: $(echo "$out" | tail -3)"

[ $fail -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
