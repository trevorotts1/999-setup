#!/usr/bin/env bash
# NIN001: optional DeepSeek/Agnes keys + OpenRouter DeepSeek route.
#  1. setup-macos.sh key validation block (extracted, run with stubs) for each key set.
#  2. setup-macos.sh rejects a bad --deepseek-route before touching anything.
#  3. configure-nine-router.mjs against a fake 9Router (nin001-configure.test.mjs).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; S="$HERE/../scripts/setup-macos.sh"
fails=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fails=$((fails+1)); }

# Pull the real validation code out of setup-macos.sh (no copy to drift).
VP="$(sed -n '/^validate_plan() {/,/^}/p' "$S")"
BLK="$(sed -n '/# Every provider key is optional on its own/,/DeepSeek route: \$NINE_DEEPSEEK_ROUTE;/p' "$S")"
[ -n "$VP" ] && [ -n "$BLK" ] || { echo "FAIL  could not extract validation block"; exit 1; }
check() { # name expect(ok|fail) route -- env assignments...
  local name="$1" expect="$2" route="$3"; shift 4
  local out rc
  out="$(env -i PATH="$PATH" "$@" bash -c '
    set -euo pipefail
    log() { :; }; fail() { echo "BLOCKER: $*"; exit 1; }
    API_DOCS=x; NINE_DEEPSEEK_ROUTE="$1"
    eval "$2"; eval "$3"
    echo "ROUTE=$NINE_DEEPSEEK_ROUTE DS=[${DEEPSEEK_API_KEY:-}] AG=[${AGNES_API_KEY:-}]"
  ' _ "$route" "$VP" "$BLK" 2>&1)"; rc=$?
  if [ "$expect" = ok ] && [ $rc -eq 0 ]; then ok "$name -> $out"; elif [ "$expect" = fail ] && [ $rc -ne 0 ]; then ok "$name -> $out"; else bad "$name (rc=$rc) $out"; fi
}
check "OpenRouter only, no DeepSeek/Agnes/Ollama keys passes (auto openrouter route)" ok "" -- OPENROUTER_API_KEY=k
check "explicit openrouter route drops a present DeepSeek key" ok openrouter -- OPENROUTER_API_KEY=k DEEPSEEK_API_KEY=d
check "Ollama + DeepSeek, no Agnes passes (direct)" ok "" -- OLLAMA_API_KEY=o DEEPSEEK_API_KEY=d OLLAMA_PLAN=pro
check "placeholder DeepSeek/Agnes treated as absent" ok "" -- OPENROUTER_API_KEY=k DEEPSEEK_API_KEY=replace_with_real_key AGNES_API_KEY=replace_with_real_key
check "Ollama only (no DeepSeek source) is a precise blocker" fail "" -- OLLAMA_API_KEY=o OLLAMA_PLAN=pro
check "no Ollama and no OpenRouter is a blocker" fail direct -- DEEPSEEK_API_KEY=d
check "openrouter route without OPENROUTER_API_KEY is a blocker" fail openrouter -- OLLAMA_API_KEY=o OLLAMA_PLAN=pro
check "key present with bad plan still fails" fail "" -- OLLAMA_API_KEY=o DEEPSEEK_API_KEY=d OLLAMA_PLAN=huge

out="$(bash "$S" --deepseek-route bogus 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q 'must be direct or openrouter' && ok "bad --deepseek-route rejected" || bad "bad --deepseek-route: $out"
out="$(NINE_DEEPSEEK_ROUTE=nope bash "$S" 2>&1)"; rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q 'must be direct or openrouter' && ok "bad NINE_DEEPSEEK_ROUTE rejected" || bad "bad env route: $out"

if node "$HERE/nin001-configure.test.mjs"; then ok "configure-nine-router fake-router suite"; else bad "configure-nine-router fake-router suite"; fi
[ $fails -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILED"; exit 1; }
