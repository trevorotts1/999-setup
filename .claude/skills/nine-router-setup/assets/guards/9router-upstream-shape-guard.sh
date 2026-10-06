#!/bin/bash
# 9router-upstream-shape-guard.sh — keeps two 0.5.81-era hand repairs in the
# response path of the installed 9Router bundle (the chunk carrying ChatCore
# non-stream + stream handling; located by CONTENT, never by chunk number):
#   1. non-stream: a 200 whose JSON body is not a completion (no choices, no
#      assistant message, or an error object) is answered 502 "Malformed upstream
#      completion" instead of being relayed as success.
#   2. (RETIRED 2026-09-22) the 0.5.81 OpenAI-target stream peek / status edits:
#      on 0.5.85 they broke every OpenAI-format upstream -> OpenAI-format client
#      call with 503 "Provider error" (DeepSeek, OpenRouter, Agnes); proven by A/B
#      on the live gateway. Kept in .bak-with-stream-edits-20260922 for reference.
# Both were applied by hand on 2026-09-18 right after the 0.5.81 install (they are
# in the earliest bundle backup, predating every other guard) and were captured
# here verbatim from the live bytes on 2026-09-22. Edit 1 carries two anchor
# variants because 0.5.85 renamed the minified locals (K->L, G->H, C->D, s->t).
# 0.5.91 renamed them again (L->M, H->I, D->E, t->u, j.gx->k.gx, l.x->m.x): third variant. (2026-09-26)
#
# Usage: 9router-upstream-shape-guard.sh [--check] [--quiet] [9router_root]
#   exit 0 applied/already · 2 tooling · 3 anchor not found (never a silent success) · 4 node --check failed
set -uo pipefail
CHECK=0; QUIET=0; ROOT=""
for a in "$@"; do case "$a" in --check) CHECK=1 ;; --quiet) QUIET=1 ;; *) ROOT="$a" ;; esac; done
ROOT="${ROOT:-$HOME/.npm-global/lib/node_modules/9router}"
CHUNKS="$ROOT/app/.next-cli-build/server/chunks"
[ -d "$CHUNKS" ] || { echo "FAIL: 9router chunks dir not found at $CHUNKS"; exit 2; }
NODE=""; for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }; done
[ -n "$NODE" ] || { echo "FAIL: no node binary resolvable"; exit 2; }
PY=""; for c in /opt/homebrew/bin/python3 /usr/bin/python3 "$(command -v python3 2>/dev/null || true)"; do [ -n "$c" ] && [ -x "$c" ] && { PY="$c"; break; }; done
[ -n "$PY" ] || { echo "FAIL: no python3 binary resolvable"; exit 2; }
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
"$PY" - "$CHUNKS" "$NODE" "$CHECK" "$QUIET" "$(date +%Y%m%d-%H%M%S)" "$SELF" <<'PY'
import os, glob, shutil, subprocess, sys, json
chunks, node, check, quiet, stamp, self = sys.argv[1], sys.argv[2], sys.argv[3]=="1", sys.argv[4]=="1", sys.argv[5], sys.argv[6]
say = (lambda *a: None) if quiet else print
# The edits live at the end of this script as one JSON line after the marker.
src = open(self, encoding="utf-8").read(); E = json.loads(src[src.rindex("#EDITS_JSON:")+len("#EDITS_JSON:"):].strip())
already, found = {}, {}
for f in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    for name, variants in E:
        if any(n in t for o, n in variants): already.setdefault(name, []).append(f); continue
        if any(t.count(o) > 1 for o, n in variants): print(f"AMBIGUOUS [{name}]: {os.path.basename(f)}"); sys.exit(3)
        hits = [(o, n) for o, n in variants if t.count(o) == 1]
        if hits: found.setdefault(name, []).append((f, hits[0]))
for name, _ in E:
    if name not in already and name not in found:
        print(f"FAIL: upstream-shape anchor [{name}] not found in any chunk under {chunks} — bundle changed. NOT guarded."); sys.exit(3)
for name, fs in already.items():
    for f in fs: say(f"9router-upstream-shape: already applied [{name}]: {os.path.basename(f)}")
for name, fs in found.items():
    for f, (o, n) in fs:
        if check: say(f"WOULD PATCH [{name}]: {os.path.basename(f)}"); continue
        bk = f"{f}.pre-upstream-shape-{stamp}"
        if not os.path.exists(bk): shutil.copy2(f, bk)
        t = open(f, encoding="utf-8", errors="surrogateescape").read().replace(o, n, 1)
        open(f, "w", encoding="utf-8", errors="surrogateescape").write(t)
        if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
            shutil.copy2(bk, f); print(f"FAIL: node --check rejected {os.path.basename(f)} — restored from {bk}"); sys.exit(4)
        say(f"9router-upstream-shape: patched [{name}] {os.path.basename(f)} (backup: {bk})")
if check: say("CHECK MODE — nothing was written.")
PY
exit $?
#EDITS_JSON:[["malformed completion -> 502", [["K=(0,l.x)(K,b),C.logProviderResponse(a.status,a.statusText,a.headers,K),", "K=(0,l.x)(K,b);if(!K||typeof K!==\"object\"||Array.isArray(K)||K.error||s===d.h.OPENAI&&(!Array.isArray(K.choices)||!K.choices.length||K.choices.some(a=>!a?.message||typeof a.message!==\"object\"||Array.isArray(a.message)||a.message.role!==\"assistant\")))return G({status:`FAILED ${j.gx.BAD_GATEWAY}`}),(0,i.A1)(j.gx.BAD_GATEWAY,`Malformed upstream completion from ${b}`);C.logProviderResponse(a.status,a.statusText,a.headers,K),"], ["L=(0,l.x)(L,b),D.logProviderResponse(a.status,a.statusText,a.headers,L),", "L=(0,l.x)(L,b);if(!L||typeof L!==\"object\"||Array.isArray(L)||L.error||t===d.h.OPENAI&&(!Array.isArray(L.choices)||!L.choices.length||L.choices.some(a=>!a?.message||typeof a.message!==\"object\"||Array.isArray(a.message)||a.message.role!==\"assistant\")))return H({status:`FAILED ${j.gx.BAD_GATEWAY}`}),(0,i.A1)(j.gx.BAD_GATEWAY,`Malformed upstream completion from ${b}`);D.logProviderResponse(a.status,a.statusText,a.headers,L),"], ["M=(0,m.x)(M,b),E.logProviderResponse(a.status,a.statusText,a.headers,M),", "M=(0,m.x)(M,b);if(!M||typeof M!==\"object\"||Array.isArray(M)||M.error||u===d.h.OPENAI&&(!Array.isArray(M.choices)||!M.choices.length||M.choices.some(a=>!a?.message||typeof a.message!==\"object\"||Array.isArray(a.message)||a.message.role!==\"assistant\")))return I({status:`FAILED ${k.gx.BAD_GATEWAY}`}),(0,i.A1)(k.gx.BAD_GATEWAY,`Malformed upstream completion from ${b}`);E.logProviderResponse(a.status,a.statusText,a.headers,M),"]]]]
