#!/bin/bash
# 9router-deepseek-effort-guard.sh — keeps the DeepSeek reasoning-effort mapping
# applied in the installed 9Router bundle. Stock 9Router serializes effort for
# provider "deepseek" as a binary: xhigh|max -> "max", everything else -> "high",
# so (low)/(minimal) suffixes were silently promoted to high. The fix sends
# DeepSeek's documented tiers: minimal|low -> low, max|ultra -> max, else high.
# See ~/.9router/patches/deepseek-v4.1-thinking/README.md (2026-09-10) and the
# one-off applier ~/.9router/verification/glm-acceptance-20260918/deepseek-mapping.py
# whose replacement text this guard carries verbatim. An `npm i -g 9router`
# replaces the bundle and reverts it; this guard re-applies it, content-anchored.
#
# Usage: 9router-deepseek-effort-guard.sh [--check] [--quiet] [9router_root]
#   exit 0 applied/already · 2 tooling · 3 anchor not found (never a silent success) · 4 node --check failed
set -uo pipefail
CHECK=0; QUIET=0; ROOT=""
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --quiet) QUIET=1 ;; *) ROOT="$a" ;; esac; done
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
CHUNKS="$ROOT/app/.next-cli-build/server/chunks"
[ -d "$CHUNKS" ] || { echo "FAIL: 9router chunks dir not found at $CHUNKS"; exit 2; }
NODE=""; for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -n "$NODE" ] || { echo "FAIL: no node binary resolvable"; exit 2; }
PY=""; for c in /opt/homebrew/bin/python3 /usr/bin/python3 "$(command -v python3 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { PY="$c"; break; }; done
[ -n "$PY" ] || { echo "FAIL: no python3 binary resolvable"; exit 2; }
"$PY" - "$CHUNKS" "$NODE" "$CHECK" "$QUIET" "$(date +%Y%m%d-%H%M%S)" <<'PY'
import os, glob, shutil, subprocess, sys
chunks, node, check, quiet, stamp = sys.argv[1], sys.argv[2], sys.argv[3]=="1", sys.argv[4]=="1", sys.argv[5]
say = (lambda *a: None) if quiet else print
OLD = 'b.reasoning_effort="xhigh"===a||"max"===a?"max":"high"'
NEW = 'b.reasoning_effort="low"===a||"minimal"===a?"low":"max"===a||"ultra"===a?"max":"high"'
# 0.5.91 split the stock mapping in two and added a check of its own: max drops to high when the model's
# level list exists and lacks max. Same binary defect (low -> high, xhigh -> max); only the first half is
# replaced, upstream's level check is kept. (added 2026-09-26)
OLD91 = 'c="xhigh"===a||"max"===a?"max":"high";b.reasoning_effort="max"===c&&e&&!e.includes("max")?"high":c;'
NEW91 = 'c="low"===a||"minimal"===a?"low":"max"===a||"ultra"===a?"max":"high";b.reasoning_effort="max"===c&&e&&!e.includes("max")?"high":c;'
PAIRS = [(OLD, NEW), (OLD91, NEW91)]
already, found = [], []
for f in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    if any(n_ in t for _, n_ in PAIRS): already.append(f); continue
    for o_, n_ in PAIRS:
        n = t.count(o_)
        if n == 1: found.append((f, o_, n_)); break
        elif n > 1: print(f"AMBIGUOUS: {os.path.basename(f)} anchor count={n}"); sys.exit(3)
if not already and not found:
    print(f"FAIL: DeepSeek effort anchor not found in any chunk under {chunks} — bundle changed. NOT guarded."); sys.exit(3)
for f in already: say(f"9router-deepseek-effort: already applied: {os.path.basename(f)}")
for f, o_, n_ in found:
    if check: say(f"WOULD PATCH: {os.path.basename(f)}"); continue
    bk = f"{f}.pre-deepseek-effort-{stamp}"; shutil.copy2(f, bk)
    t = open(f, encoding="utf-8", errors="surrogateescape").read().replace(o_, n_, 1)
    open(f, "w", encoding="utf-8", errors="surrogateescape").write(t)
    if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
        shutil.copy2(bk, f); print(f"FAIL: node --check rejected {os.path.basename(f)} — restored from {bk}"); sys.exit(4)
    say(f"9router-deepseek-effort: patched {os.path.basename(f)} (backup: {bk})")
if check: say("CHECK MODE — nothing was written.")
PY
