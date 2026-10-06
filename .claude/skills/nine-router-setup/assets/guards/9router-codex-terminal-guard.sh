#!/bin/bash
# 9router-codex-terminal-guard.sh — keeps the 9Router codex→Claude stream
# terminal-event fix applied.
#
# THE BUG (found and measured 2026-08-11, 9router 0.5.50):
# Every `cx/*` (Codex / ChatGPT subscription) model returns HTTP 200 with a
# stream that Claude Code cannot parse:
#
#     API returned an empty or malformed response (HTTP 200)
#
# Codex is the ONLY provider that needs TWO format hops to reach Anthropic
# wire format:  openai-responses → openai → claude.  Every other provider is
# a single hop.  9Router's chaining converter (`al()`) runs both hops with
# ONE SHARED state object:
#
#     let i=e.get(`${a}:${b}`); if(i){...}                 // direct, 1 hop
#     b=e.get(`${a}:${OPENAI}`);   ...b(c,d)               // hop 1, state d
#     a=e.get(`${OPENAI}:${b}`);   ...a(c,d)               // hop 2, SAME d
#
# Hop 1 (openai-responses→openai) translates `response.completed` into the
# terminal chunk and sets `state.finishReason` on the way past.  Hop 2
# (openai→claude) is the code that actually emits the Anthropic terminal
# events, and it is gated on `!state.finishReason` — so it sees the flag
# already set by hop 1 and skips the entire block.
#
# That guard is OURS: 9router-dupfix-guard.sh adds `&&!b.finishReason` to stop
# doubled tool-argument JSON.  It is correct and must stay.  The two fixes
# collide only because the vendor shares one state object across hops.
#
# EVERYTHING downstream of finish_reason is lost — measured on the live box:
#   - `input_json_delta`   → tool-call ARGUMENTS never arrive (tools 100% dead)
#   - `content_block_stop`
#   - `message_delta`      → stop_reason never arrives
#   - `message_stop`       → the event Claude Code waits for; it never comes
#
# Measured before fix: cx/gpt-5.6-sol → 0 message_stop over 158 text deltas;
# tool call → 2 events total, arguments never sent.  Control on the same
# instrument, same transport: v4-flash and ds/deepseek-v4-flash → full
# terminals (content_block_stop ×2, message_delta ×1, message_stop ×1).
#
# THE FIX: give the Claude-target terminal block its OWN idempotency flag
# (`__cxTerm`) instead of borrowing `finishReason`, which an upstream hop can
# already have set.  `finishReason` is still assigned exactly as before, so
# nothing else that reads it changes.
#
#   if(d.finish_reason&&!b.finishReason){ … b.finishReason=d.finish_reason;
#   →
#   if(d.finish_reason&&!b.__cxTerm){    … b.__cxTerm=!0,b.finishReason=d.finish_reason;
#
# Duplicate finish_reason chunks still no-op (that is the dupfix protection,
# preserved — `__cxTerm` is set in the same block).  Single-hop providers are
# unaffected: `__cxTerm` starts undefined exactly as `finishReason` did.
#
# LOCATE BY CONTENT, NEVER BY CHUNK NUMBER — a 9router update renumbers the
# chunks, which is how the old dupfix guard silently stopped applying.
#
# Exit codes: 0 = patch present (already, or re-applied). 1 = could not apply.
set -uo pipefail

QUIET="${1:-}"
say() { [ "$QUIET" = "--quiet" ] || echo "$@" >&2; }

# Resolve npm by ABSOLUTE PATH first: a non-login SSH shell has
# PATH=/usr/bin:/bin:/usr/sbin:/sbin, where a bare `npm` is NOT found.
NPM_BIN=""
for p in /opt/homebrew/bin/npm /usr/local/bin/npm /usr/bin/npm; do
  if [ -x "$p" ]; then NPM_BIN="$p"; break; fi
done
if [ -z "$NPM_BIN" ]; then
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
fi
NPM_ROOT=""
if [ -n "$NPM_BIN" ]; then
  NPM_ROOT="$("$NPM_BIN" root -g 2>/dev/null || true)"
fi

SEARCH_DIRS="$HOME/.npm-global/lib/node_modules/9router /opt/homebrew/lib/node_modules/9router /usr/local/lib/node_modules/9router /usr/lib/node_modules/9router $HOME/.local/share/999/npm/lib/node_modules/9router"
[ -n "$NPM_ROOT" ] && SEARCH_DIRS="$SEARCH_DIRS $NPM_ROOT/9router"

CHUNKS=""
for d in $SEARCH_DIRS; do
  if [ -d "$d/app/.next-cli-build/server/chunks" ]; then
    CHUNKS="$d/app/.next-cli-build/server/chunks"
    break
  fi
done

if [ -z "$CHUNKS" ]; then
  say "9router-codexterm: no 9router chunks dir found. Searched: $SEARCH_DIRS — NOT guarded."
  say "   Every cx/* model returns 'empty or malformed response (HTTP 200)' if 9router lives elsewhere."
  exit 1
fi

PY="$(command -v python3 2>/dev/null || echo /usr/bin/python3)"
if [ ! -x "$PY" ]; then
  say "9router-codexterm: python3 not executable at '$PY' — cannot patch."
  exit 1
fi

[ "$QUIET" = "--quiet" ] && export CODEXTERM_QUIET=1

"$PY" - "$CHUNKS" <<'PYEOF'
import glob, os, re, sys, time

chunks = sys.argv[1]
quiet  = os.environ.get("CODEXTERM_QUIET") == "1"
def say(*a):
    if not quiet: print(*a, file=sys.stderr)

# A target site is a CLAUDE-target stream terminal block: its condition is
# `if(<x>.finish_reason&&!<y>.finishReason){`, and the block it opens emits
# both `message_stop` and `input_json_delta`. That pairing is what makes it
# the Anthropic terminal emitter and not some other finish_reason check.
COND = re.compile(r'if\((\w+)\.finish_reason&&!(\w+)\.finishReason\)\{')

patched_files = 0
already       = 0
failed        = []

for path in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    if ".pre-" in os.path.basename(path):
        continue
    try:
        src = open(path, encoding="utf8", errors="replace").read()
    except OSError as e:
        failed.append(f"{os.path.basename(path)}: unreadable ({e})")
        continue

    if "content_block_start" not in src or "message_stop" not in src:
        continue

    if "__cxTerm" in src:
        already += 1
        continue

    out, last, hits = [], 0, 0
    for m in COND.finditer(src):
        var_chunk, var_state = m.group(1), m.group(2)
        blk = src[m.end():m.end()+1400]
        if '"message_stop"' not in blk or "input_json_delta" not in blk:
            continue
        assign = f"{var_state}.finishReason={var_chunk}.finish_reason;"
        idx = blk.find(assign)
        if idx < 0:
            failed.append(f"{os.path.basename(path)}@{m.start()}: assignment not found in block")
            continue
        out.append(src[last:m.start()])
        out.append(f"if({var_chunk}.finish_reason&&!{var_state}.__cxTerm){{")
        body_end = m.end() + idx
        out.append(src[m.end():body_end])
        out.append(f"{var_state}.__cxTerm=!0,{assign}")
        last = body_end + len(assign)
        hits += 1

    if not hits:
        continue
    out.append(src[last:])
    new = "".join(out)

    # Never write a transform that did not actually land its marker.
    if new.count("__cxTerm") != hits * 2:
        failed.append(f"{os.path.basename(path)}: transform produced no marker")
        continue

    bak = f"{path}.pre-codexterm-{time.strftime('%Y%m%d-%H%M%S')}"
    try:
        if not os.path.exists(bak):
            with open(bak, "w", encoding="utf8") as f:
                f.write(src)
        with open(path, "w", encoding="utf8") as f:
            f.write(new)
    except OSError as e:
        failed.append(f"{os.path.basename(path)}: write failed ({e})")
        continue

    say(f"9router-codexterm: patched {hits} Claude-target terminal site(s) in {os.path.basename(path)}")
    say(f"   backup: {bak}")
    patched_files += 1

if failed:
    for f in failed:
        say(f"9router-codexterm: FAILED — {f}")
    sys.exit(1)

if patched_files:
    say("9router-codexterm: fix applied — restart 9router for it to take effect.")
    sys.exit(0)

if already:
    say("9router-codexterm: already patched.")
    sys.exit(0)

say("9router-codexterm: no Claude-target terminal site found — 9router internals changed. NOT guarded.")
say("   Expect every cx/* model to fail with 'empty or malformed response (HTTP 200)'.")
sys.exit(1)
PYEOF
exit $?
