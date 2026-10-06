#!/bin/bash
# 9router-cachecontrol-guard.sh — keeps the cache_control passthrough fix applied.
#
# THE BUG (found and measured 2026-08-31): Claude Code marks its cacheable prompt
# prefix with `cache_control:{type:"ephemeral"}` blocks. 9Router's CLAUDE->OPENAI
# translator strips every one of them before the request reaches the provider.
# Proven with 9Router's own translator logs:
#     1_req_client.json  cache_control x3   (what Claude Code sent)
#     2_req_source.json  cache_control x3
#     3_req_openai.json  cache_control x0   <-- stripped here
#     4_req_target.json  cache_control x0   (what the provider received)
#
# 9Router already has the switch. The stripper reads a PER-PROVIDER quirk:
#     }(v,{preserveCacheControl:!!n.xq[q]?.quirks?.preserveCacheControl})
# and `quirks:{preserveCacheControl:!0}` is set ONLY on Alibaba's own direct
# endpoints (dashscope / bailian / token-plan). Every node of type
# `openai-compatible` — which is how OpenRouter, DeepSeek, Ollama Cloud and
# everything else is reached — has no such quirk, so the flag is false and the
# markers are discarded.
#
# WHO THIS COSTS: providers that require an explicit breakpoint and therefore
# cache NOTHING without it — Alibaba Qwen, Google Gemini, Anthropic (all via
# OpenRouter). Cache miss is ~31x the price of a cache hit on DeepSeek-class
# pricing, so this is a straight multiple on the bill for those providers.
# Providers that cache automatically (DeepSeek, Z.AI/GLM, Grok, Moonshot) are
# unaffected either way — they ignore the field.
#
# THE FIX: force the flag on. Verified safe by direct probe 2026-08-31 —
# api.deepseek.com returned HTTP 200 and ollama.com/v1 returned HTTP 200 with a
# cache_control block present in message content, i.e. both ignore the extra
# field harmlessly. OpenRouter documents it as the supported way to set a
# breakpoint.
#
# The site is located BY CONTENT with a shape-tolerant regex, never by chunk
# number — the 0.5.40->0.5.45 update renumbered chunks and silently broke an
# earlier guard that hardcoded one.
#
# Exit codes: 0 = patch present (already, or re-applied). 1 = could not apply.
set -uo pipefail

QUIET="${1:-}"
say() { [ "$QUIET" = "--quiet" ] || echo "$@" >&2; }

NPM_BIN=""
for p in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
  if [ -x "$p" ]; then NPM_BIN="$p"; break; fi
done
if [ -z "$NPM_BIN" ]; then NPM_BIN="$(command -v npm 2>/dev/null || true)"; fi
NPM_ROOT=""
if [ -n "$NPM_BIN" ]; then NPM_ROOT="$("$NPM_BIN" root -g 2>/dev/null || true)"; fi

SEARCH_DIRS="$HOME/.npm-global/lib/node_modules/9router /opt/homebrew/lib/node_modules/9router /usr/local/lib/node_modules/9router /usr/lib/node_modules/9router $HOME/.local/share/999/npm/lib/node_modules/9router"
[ -n "$NPM_ROOT" ] && SEARCH_DIRS="$SEARCH_DIRS $NPM_ROOT/9router"

CHUNK_DIR=""
for d in $SEARCH_DIRS; do
  if [ -d "$d/app/.next-cli-build/server/chunks" ]; then
    CHUNK_DIR="$d/app/.next-cli-build/server/chunks"; break
  fi
done

if [ -z "$CHUNK_DIR" ]; then
  say "9router-cachecontrol-guard: no 9router install found in: $SEARCH_DIRS"
  exit 1
fi

PY_OUT="$(CHUNK_DIR="$CHUNK_DIR" python3 - <<'PY'
import glob, os, pathlib, re, shutil, sys, time

chunk_dir = os.environ["CHUNK_DIR"]
# Shape-tolerant: minified identifiers (n, xq, q) may be renamed by any rebuild.
CALLSITE = re.compile(r'preserveCacheControl:!!\w+\.\w+\[\w+\]\?\.quirks\?\.preserveCacheControl')
PATCHED  = 'preserveCacheControl:!0/*cc-guard*/'

already = 0
patched = 0
for f in sorted(glob.glob(os.path.join(chunk_dir, "*.js"))):
    p = pathlib.Path(f)
    try:
        s = p.read_text(errors="replace")
    except Exception:
        continue
    if PATCHED in s:
        already += 1
        continue
    if not CALLSITE.search(s):
        continue
    bak = f + ".bak-cachecontrol-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(f, bak)
    new = CALLSITE.sub(PATCHED, s, count=1)
    if new == s:
        print("FAIL substitution produced no change in " + p.name)
        sys.exit(1)
    p.write_text(new)
    # verify on disk
    if PATCHED not in p.read_text(errors="replace"):
        shutil.copy2(bak, f)
        print("FAIL verify failed, restored " + p.name)
        sys.exit(1)
    patched += 1
    print("PATCHED " + p.name + " (backup: " + os.path.basename(bak) + ")")

if patched:
    sys.exit(0)
if already:
    print("ALREADY %d chunk(s) already carry the fix" % already)
    sys.exit(0)
print("FAIL call site not found — 9router internals may have changed")
sys.exit(1)
PY
)"
RC=$?
say "$PY_OUT"
exit $RC
