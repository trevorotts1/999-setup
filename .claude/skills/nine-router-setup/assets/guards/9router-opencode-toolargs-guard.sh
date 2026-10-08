#!/bin/bash
# 9router-opencode-toolargs-guard.sh — keeps the four 2026-09-23 9router fixes applied:
#   1. toolargs-recovery-v1: Responses->OpenAI translator reads tool arguments from every place a
#      provider can send them (free Muse Spark on opencode sent Bash calls with input {}).
#   2. failover-guard-v2: on opencode / opencode-zen chain members, a reply whose tool call is missing
#      required arguments is discarded and the request goes to the next model in the chain.
#   3. ollama-overload-guard-v1 (+ ollama-nonstream-claude-v1): on ollama chain members, a 200 reply that
#      is an error, not a message, or a stream that stops without finishing goes to the next model; and
#      non-streaming Ollama replies reach Claude clients as a Message, not an OpenAI chat.completion.
#   4. ollama-stream-error-v1: an Ollama stream that is cut off or carries a mid-stream {"error"} line ends in
#      a proper error event in the client's format instead of silently stopping.
# An `npm i -g 9router` or self-update replaces the bundle and reverts all four. This re-applies them
# (content-located, so renumbered chunk files are fine), runs all offline regression suites, rolls
# back if any fails, and restarts the router only when it actually re-applied something.
# Record + tests: ~/.9router/patches/opencode-toolargs/README.md
#
# Usage: 9router-opencode-toolargs-guard.sh [--check] [--quiet] [9router_root]
# Exit: 0 = all fixes present (already, or re-applied and tested). 1 = could not apply / tests failed.
set -uo pipefail
CHECK=""; QUIET=0; ROOT=""
for a in "$@"; do case "$a" in --check) CHECK="--check" ;; --quiet) QUIET=1 ;; *) ROOT="$a" ;; esac; done
# Resolve the 9Router install: npm root -g, then the running process, then known prefixes
# (Homebrew /opt/homebrew, /usr/local, ~/.npm-global). NINE_KNOWN_PREFIXES overrides the list (tests).
_resolve_9router_root() {
  local d npmbin
  for npmbin in /opt/homebrew/bin/npm /usr/local/bin/npm "$(command -v npm 2>/dev/null)"; do
    [ -x "$npmbin" ] || continue
    d="$("$npmbin" root -g 2>/dev/null)/9router"; [ -f "$d/package.json" ] && { echo "$d"; return; }
  done
  d="$(ps -axo command= 2>/dev/null | grep -o '/[^ ]*/node_modules/9router/' | head -1)"; d="${d%/}"
  [ -n "$d" ] && [ -f "$d/package.json" ] && { echo "$d"; return; }
  for d in ${NINE_KNOWN_PREFIXES:-/opt/homebrew/lib/node_modules /usr/local/lib/node_modules "$HOME/.npm-global/lib/node_modules"}; do
    [ -f "$d/9router/package.json" ] && { echo "$d/9router"; return; }
  done
  echo "$HOME/.npm-global/lib/node_modules/9router"
}
ROOT="${ROOT:-$(_resolve_9router_root)}"
P="$HOME/.9router/patches/opencode-toolargs"
say(){ [ "$QUIET" = 1 ] || echo "$@"; }

PY=""; for c in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do [ -x "$c" ] && { PY="$c"; break; }; done
NODE=""; for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -n "$PY" ] && [ -n "$NODE" ] || { echo "9router-toolargs-guard: python3/node not found — NOT guarded." >&2; exit 1; }

out1="$("$PY" "$P/apply.py" $CHECK "$ROOT" 2>&1)"; rc1=$?
out2="$("$PY" "$P/failover-guard-apply.py" $CHECK "$ROOT" 2>&1)"; rc2=$?
out3=""; rc3=1; [ $rc2 -eq 0 ] && { out3="$("$PY" "$P/ollama-overload-guard-apply.py" $CHECK "$ROOT" 2>&1)"; rc3=$?; }   # needs v2 in place
out4="$("$PY" "$P/ollama-stream-error-apply.py" $CHECK "$ROOT" 2>&1)"; rc4=$?
T="$HOME/.9router/patches/tool-id-sanitize"
out5="$("$PY" "$T/apply.py" $CHECK "$ROOT" 2>&1)"; rc5=$?
say "$out1"; say "$out2"; say "$out3"; say "$out4"; say "$out5"
if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ] || [ $rc3 -ne 0 ] || [ $rc4 -ne 0 ] || [ $rc5 -ne 0 ]; then
  echo "9router-toolargs-guard: could not apply (translator rc=$rc1, failover guard rc=$rc2, ollama guard rc=$rc3, ollama stream error rc=$rc4, tool id sanitize rc=$rc5) — see $P/README.md" >&2
  exit 1
fi
[ -n "$CHECK" ] && exit 0
printf '%s\n%s\n%s\n%s\n%s\n' "$out1" "$out2" "$out3" "$out4" "$out5" | grep -q '^patched ' || exit 0   # already present: nothing to do

# Something was re-applied: prove it before trusting it.
if ! "$NODE" "$P/regression.cjs" "$ROOT" >/dev/null 2>&1 || ! "$NODE" "$P/failover-guard-regression.cjs" "$ROOT" >/dev/null 2>&1 \
   || ! "$NODE" "$P/ollama-overload-guard-regression.cjs" "$ROOT" >/dev/null 2>&1 \
   || ! "$NODE" "$P/ollama-stream-error-regression.cjs" "$ROOT" >/dev/null 2>&1 \
   || ! "$NODE" "$T/regression.cjs" "$ROOT" >/dev/null 2>&1; then
  # newest backup first, so a file patched twice (8910.js, 8895.js) ends at its oldest backup
  printf '%s\n%s\n%s\n%s\n%s\n' "$out1" "$out2" "$out3" "$out4" "$out5" | awk '/^patched /{f=$2} /^backup /{r[++n]=f" "$2} END{for(;n>0;n--)print r[n]}' | while read -r f b; do
    [ -f "$b" ] && cp -p "$b" "$f"
  done
  echo "9router-toolargs-guard: re-applied fixes FAILED their regression tests — rolled back to the unpatched files." >&2
  exit 1
fi
if [ "$ROOT" = "$(_resolve_9router_root)" ] && /usr/bin/nc -z 127.0.0.1 20128 >/dev/null 2>&1; then   # restart only the live install
  launchctl kickstart -k "gui/$(id -u)/com.blackceo.9router-localhost" >/dev/null 2>&1 \
    && say "9router-toolargs-guard: fixes re-applied and tested; router restarted to load them."
fi
exit 0
