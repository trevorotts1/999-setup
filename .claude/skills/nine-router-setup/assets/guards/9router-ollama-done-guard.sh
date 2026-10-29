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
import os, glob, re, shutil, subprocess, sys
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
# 0.5.95 and later: the stream converter's locals are renamed on every build (0.5.95: cleanup P->Q; 0.5.109: provider p->s,
# state C->G, done flag N->R, encoder k->n ...), so the two edits below are located by shape and the inserted text is built from
# the names read out of the converter's own header. The text inserted is byte-for-byte what the literal edits wrote on 0.5.104.
ID = r'[A-Za-z_$][\w$]*'
HEAD_RX = re.compile(r'let (?P<enc>'+ID+r')=new TextEncoder,(?P<tr>'+ID+r')="translate",'+ID+r'="passthrough";function '+ID+r'\(a=\{\}\)\{'
                     r'let\{mode:(?P<mode>'+ID+r')=(?P=tr),targetFormat:(?P<tf>'+ID+r'),sourceFormat:(?P<sf>'+ID+r'),provider:(?P<prov>'+ID+r')=null,'
                     r'reqLogger:(?P<log>'+ID+r')=null,[^}]*?body:(?P<body>'+ID+r')=null,[^}]*?\}=a,')
FLUSH_RX = re.compile(r'(?P<fa>'+ID+r')\.enqueue\((?P<enc>'+ID+r')\.encode\(b\)\),(?P<fM>'+ID+r')=!0,(?P<fN>'+ID+r')=!0\}')
FMT_RX = re.compile(r'\?\.done&&(?P<tf>'+ID+r')!==(?P<fmt>'+ID+r')\.h\.OLLAMA;')
CAP_RX = re.compile(r'let (?P<c>'+ID+r')=\(0,(?P<h>'+ID+r')\.v8\)\((?P<it>'+ID+r'),(?P<sf>'+ID+r')\);(?P<log>'+ID+r')\?\.appendConvertedChunk\?\.\((?P=c)\),'
                    r'(?P<f>'+ID+r')\.enqueue\((?P<enc>'+ID+r')\.encode\((?P=c)\)\),(?P<emit>'+ID+r')\+\+\}(?P<tf>'+ID+r')===(?P<fmt>'+ID+r')\.h\.OPENAI&&'
                     r'(?P=sf)===(?P=fmt)\.h\.OPENAI_RESPONSES&&(?P<st>'+ID+r')\?\.completionPending')
FIX_RX = re.compile(r'if\(!'+ID+r'&&\("ollama"==='+ID+r'\|\|"ollama-local"==='+ID+r'\|\|'+ID+r'==='+ID+r'\.h\.OLLAMA\)&&'+ID+r'\.finishReason\)'
                    r'\{let b="data: \[DONE\]\\n\\n";')
DONE_MARK = 'let __done="data: [DONE]'
def _names(t):
    """Converter identifiers: header names + state (from its translate-state initialiser) + flush-site names, or None if the shape is unknown."""
    hs = list(HEAD_RX.finditer(t))
    if len(hs) != 1: return None
    d = hs[0].groupdict()
    st = re.search(r'(?P<st>'+ID+r')='+re.escape(d['mode'])+r'==='+re.escape(d['tr'])+r'\?\{\.\.\.\(0,'+ID+r'\.Ws\)\('+re.escape(d['sf'])+r'\),provider:'+re.escape(d['prov'])+r',', t[hs[0].end():])
    fl = list(FLUSH_RX.finditer(t, hs[0].end()))
    fm = list(FMT_RX.finditer(t, hs[0].end()))
    if not st or len(fl) != 1 or len(fm) != 1 or fm[0]['tf'] != d['tf'] or fl[0]['enc'] != d['enc']: return None
    d.update(st=st['st'], fa=fl[0]['fa'], fM=fl[0]['fM'], fN=fl[0]['fN'], fmt=fm[0]['fmt'], fl_end=fl[0].end())
    return d
def ed_flush(t):
    """[DONE] on flush, 0.5.95+: the OLLAMA [DONE] block goes right after the stock `fM=!0,fN=!0}` of the translate-mode flush."""
    if FIX_RX.search(t): return "already", t
    n = _names(t)
    if n is None: return "absent", t
    fix = ('if(!%(fN)s&&("ollama"===%(prov)s||"ollama-local"===%(prov)s||%(tf)s===%(fmt)s.h.OLLAMA)&&%(st)s.finishReason)'
           '{let b="data: [DONE]\\n\\n";%(log)s?.appendConvertedChunk?.(b),%(fa)s.enqueue(%(enc)s.encode(b))}') % n
    return "patched", t[:n['fl_end']] + fix + t[n['fl_end']:]
def ed_capture(t):
    """finish_reason capture, 0.5.95+: after the emit counter of the translate loop."""
    if DONE_MARK in t: return "already", t
    n = _names(t)
    if n is None: return "absent", t
    ms = list(CAP_RX.finditer(t))
    if len(ms) != 1: return ("ambiguous" if ms else "absent"), t
    m = ms[0]
    if any(m[k] != n[k] for k in ("log", "enc", "sf", "tf", "fmt", "st")): return "ambiguous", t
    ins = ('%(emit)s++;if(%(it)s.choices?.[0]?.finish_reason){%(st)s.finishReason=%(it)s.choices[0].finish_reason;'
           'if(!%(fN)s&&/^ollama\\//i.test(%(body)s?.model||"")){%(fN)s=!0;let __done="data: [DONE]\\n\\n";'
           '%(log)s?.appendConvertedChunk?.(__done),%(f)s.enqueue(%(enc)s.encode(__done))}}}') % dict(n, **m.groupdict())
    s0 = m.start('emit')
    return "patched", t[:s0] + ins + t[m.end('emit') + 3:]   # replaces `emit++}`; ins ends with the loop's own closing brace
def lit(old, new):
    def ed(t):
        if new in t: return "already", t
        c = t.count(old)
        return ("patched", t.replace(old, new, 1)) if c == 1 else ("ambiguous", t) if c > 1 else ("absent", t)
    return ed
EDITS = [("[DONE] on flush", lit(OLD, NEW)), ("finish_reason capture", lit(OLD2, NEW2)),
         ("[DONE] on flush", ed_flush), ("finish_reason capture", ed_capture)]
already, found = [], []
for f in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    t = open(f, encoding="utf-8", errors="surrogateescape").read()
    done_here = set()   # a name satisfied by an earlier form in this file is not touched again by a later form
    for name, ed in EDITS:
        if name in done_here: continue
        st, _ = ed(t)
        if st == "already": already.append((name, f)); done_here.add(name)
        elif st == "patched": found.append((name, f, ed)); done_here.add(name)
        elif st == "ambiguous": print(f"AMBIGUOUS [{name}]: {os.path.basename(f)} anchor is not unique"); sys.exit(3)
for name, _ in EDITS:
    if not [x for x in already if x[0] == name] and not [x for x in found if x[0] == name]:
        print(f"FAIL: Ollama anchor [{name}] not found in any chunk under {chunks} — bundle changed. NOT guarded."); sys.exit(3)
for name, f in already: say(f"9router-ollama-done: already applied [{name}]: {os.path.basename(f)}")
for name, f, ed in found:
    if check: say(f"WOULD PATCH [{name}]: {os.path.basename(f)}"); continue
    bk = f"{f}.pre-ollama-done-{stamp}"
    if not os.path.exists(bk): shutil.copy2(f, bk)
    st, nt = ed(open(f, encoding="utf-8", errors="surrogateescape").read())
    if st != "patched": print(f"FAIL: [{name}] anchor vanished in {os.path.basename(f)} while patching"); sys.exit(3)
    open(f, "w", encoding="utf-8", errors="surrogateescape").write(nt)
    if subprocess.run([node, "--check", f], capture_output=True).returncode != 0:
        shutil.copy2(bk, f); print(f"FAIL: node --check rejected {os.path.basename(f)} — restored from {bk}"); sys.exit(4)
    say(f"9router-ollama-done: patched [{name}] {os.path.basename(f)} (backup: {bk})")
if check: say("CHECK MODE — nothing was written.")
PY
