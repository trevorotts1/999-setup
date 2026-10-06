#!/bin/bash
# 9router-deepseek-openai-route-guard.sh — forces DeepSeek Direct (provider "deepseek", alias ds/)
# onto DeepSeek's OpenAI-format endpoint (api.deepseek.com/chat/completions) instead of its
# Anthropic-compatible endpoint (api.deepseek.com/anthropic/v1/messages).
#
# Why (2026-09-26): 9Router picks the provider transport whose format matches the incoming request.
# Claude Code sends Claude format, so ds/* went straight to DeepSeek's Anthropic endpoint. Since
# ~2026-09-25 that endpoint rejects any history with parallel tool calls (several tool_use blocks in
# one assistant message), even a spec-valid one: HTTP 400 "`tool_use` ids were found without
# `tool_result` blocks immediately after". Claude Code shows it as "API Error: 400 due to tool use
# concurrency issues" and the session is dead from then on. The same requests pass on DeepSeek via
# OpenRouter/Ollama (OpenAI format). With this edit the route picker never returns the Claude
# transport for deepseek, so 9Router translates Claude -> OpenAI itself and uses /chat/completions.
# An `npm i -g 9router` reverts it; the claude-nine launcher and 9router-update.sh re-apply it.
#
# Usage: 9router-deepseek-openai-route-guard.sh [--check] [--quiet] [9router_root]
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
"$PY" - "$CHUNKS" "$NODE" "$CHECK" "$QUIET" "$(date +%Y%m%d-%H%M%S)" <<'PY'
import os, re, glob, shutil, subprocess, sys
chunks, node, check, quiet, stamp = sys.argv[1], sys.argv[2], sys.argv[3]=="1", sys.argv[4]=="1", sys.argv[5]
say = (lambda *a: None) if quiet else print
MARK = '/*deepseek-openai-route-v1*/'
# The transport picker: function m(a,b){let c=d.xq[a],e=c?.transports;return Array.isArray(e)&&e.length&&e.find(a=>a.format===b)||null}
# Local names vary between builds, so match by shape.
PAT = re.compile(r'function (\w+)\((\w),(\w)\)\{let (\w)=([\w$]+)\.xq\[\2\],(\w)=\4\?\.transports;return (Array\.isArray\(\6\)&&\6\.length&&\6\.find\((\w)=>\8\.format===\3\)\|\|null)\}')
already, found = [], []
for f in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    if MARK in t: already.append(f); continue
    hits = PAT.findall(t)
    if len(hits) == 1: found.append(f)
    elif len(hits) > 1: print(f"AMBIGUOUS: {os.path.basename(f)} picker count={len(hits)}"); sys.exit(3)
if not already and not found:
    print(f"FAIL: DeepSeek route-picker anchor not found in any chunk under {chunks} — bundle changed. NOT guarded."); sys.exit(3)
for f in already: say(f"9router-deepseek-openai-route: already applied: {os.path.basename(f)}")
for f in found:
    if check: say(f"WOULD PATCH: {os.path.basename(f)}"); continue
    bk = f"{f}.pre-deepseek-openai-route-{stamp}"
    if not os.path.exists(bk): shutil.copy2(f, bk)
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    def rep(m):
        fn, a, b, c, mod, e, ret, _ = m.groups()
        return (f'function {fn}({a},{b}){{let {c}={mod}.xq[{a}],{e}={c}?.transports;'
                f'return {MARK}("deepseek"==={a}&&"claude"==={b})?null:{ret}}}')
    t2 = PAT.sub(rep, t, count=1)
    open(f, "w", encoding="utf-8", errors="surrogateescape").write(t2)
    if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
        shutil.copy2(bk, f); print(f"FAIL: node --check rejected {os.path.basename(f)} — restored from {bk}"); sys.exit(4)
    say(f"9router-deepseek-openai-route: patched {os.path.basename(f)} (backup: {bk})")
if check: say("CHECK MODE — nothing was written.")
PY
