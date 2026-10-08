#!/bin/bash
# 9router-ollama-done-guard.sh — keeps the 9Router Ollama streaming terminator fix
# applied. Native Ollama completion arrives as done:true, but the OpenAI stream
# translator's flush never emitted the client-side SSE `data: [DONE]` sentinel for
# provider ollama / ollama-local / OLLAMA source format, so clients waited on a
# stream that had already finished. The inserted text is exactly what ran live on
# 0.5.81 (built up 2026-09-18 from ollama-stream.py + follow-ups; the claude-nine
# launcher's read-only check regex matches it). An `npm i -g 9router` reverts it.
#
# Usage: 9router-ollama-done-guard.sh [--check] [--quiet] [9router_root]
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
# Anchor = the generic-OpenAI passthrough flush right before the stream closes.
# The fix is inserted between the existing [DONE] block and `P();return}`.
OLD = 'a.enqueue(k.encode(b))}P();return}if(z.trim())'
FIX = 'if(!N&&("ollama"===p||"ollama-local"===p||c===e.h.OLLAMA)&&C.finishReason){let b="data: [DONE]\\n\\n";q?.appendConvertedChunk?.(b),a.enqueue(k.encode(b))}'
NEW = 'a.enqueue(k.encode(b))}' + FIX + 'P();return}if(z.trim())'
# Edit 2 (same stream converter, earlier in transform): capture the OpenAI-shaped
# chunk's finish_reason into the stream state and, for ollama/* models, send the
# client [DONE] right there (Ollama's final frame is the one carrying it).
OLD2 = ('if(C.finishReason&&b&&!(0,g.Gh)(a.usage)&&D>0){let b=(0,g.OF)(v,D,o);a.usage=(0,g.WL)(b,o),C.usage=b}'
        'else if(C.finishReason&&b&&C.usage){let b=(0,g.O9)(C.usage);a.usage=(0,g.WL)(b,o)}'
        'let c=(0,h.v8)(a,o);q?.appendConvertedChunk?.(c),f.enqueue(k.encode(c)),I++}}},flush(a){')
NEW2 = OLD2.replace('I++}}},flush(a){',
        'I++;if(a.choices?.[0]?.finish_reason){C.finishReason=a.choices[0].finish_reason;'
        'if(!N&&/^ollama\\//i.test(v?.model||"")){N=!0;let __done="data: [DONE]\\n\\n";'
        'q?.appendConvertedChunk?.(__done),f.enqueue(k.encode(__done))}}}}},flush(a){')
# 0.5.95 variants (2026-10-02): cleanup fn renamed P->Q; the ollama stream takes the
# translate branch, whose flush ends `M=!0,N=!0}Q()}catch(a){console.log("Error in flush:"`.
# Anchor is just `M=!0,N=!0}` (unique) so the stream-error patch may insert its own call before Q() in either order.
OLD_B = 'M=!0,N=!0}'
NEW_B = 'M=!0,N=!0}' + FIX
OLD2_B = 'let c=(0,h.v8)(a,o);q?.appendConvertedChunk?.(c),f.enqueue(k.encode(c)),I++}c===e.h.OPENAI&&o===e.h.OPENAI_RESPONSES&&C?.completionPending'
NEW2_B = OLD2_B.replace('I++}c===e.h.OPENAI',
        'I++;if(a.choices?.[0]?.finish_reason){C.finishReason=a.choices[0].finish_reason;'
        'if(!N&&/^ollama\\//i.test(v?.model||"")){N=!0;let __done="data: [DONE]\\n\\n";'
        'q?.appendConvertedChunk?.(__done),f.enqueue(k.encode(__done))}}}c===e.h.OPENAI')
EDITS = [("[DONE] on flush", OLD, NEW), ("finish_reason capture", OLD2, NEW2),
         ("[DONE] on flush", OLD_B, NEW_B), ("finish_reason capture", OLD2_B, NEW2_B)]
already, found = [], []
for f in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    for name, o, n in EDITS:
        if n in t or (o == OLD_B and FIX in t): already.append((name, f)); continue
        c = t.count(o)
        if c == 1: found.append((name, f, o, n))
        elif c > 1: print(f"AMBIGUOUS [{name}]: {os.path.basename(f)} anchor count={c}"); sys.exit(3)
for name, _, _ in EDITS:
    if not [x for x in already if x[0] == name] and not [x for x in found if x[0] == name]:
        print(f"FAIL: Ollama anchor [{name}] not found in any chunk under {chunks} — bundle changed. NOT guarded."); sys.exit(3)
for name, f in already: say(f"9router-ollama-done: already applied [{name}]: {os.path.basename(f)}")
for name, f, o, n in found:
    if check: say(f"WOULD PATCH [{name}]: {os.path.basename(f)}"); continue
    bk = f"{f}.pre-ollama-done-{stamp}"
    if not os.path.exists(bk): shutil.copy2(f, bk)
    t = open(f, encoding="utf-8", errors="surrogateescape").read().replace(o, n, 1)
    open(f, "w", encoding="utf-8", errors="surrogateescape").write(t)
    if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
        shutil.copy2(bk, f); print(f"FAIL: node --check rejected {os.path.basename(f)} — restored from {bk}"); sys.exit(4)
    say(f"9router-ollama-done: patched [{name}] {os.path.basename(f)} (backup: {bk})")
if check: say("CHECK MODE — nothing was written.")
PY
