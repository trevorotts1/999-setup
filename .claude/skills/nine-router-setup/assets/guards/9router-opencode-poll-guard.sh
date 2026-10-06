#!/bin/bash
# 9router-opencode-poll-guard.sh — keeps the OpenCode (oc/*) non-streaming
# empty-response fix applied. RE-RUN AFTER EVERY `npm i -g 9router` — an update
# overwrites the bundle and silently reverts all nine edits below.
#
# THE BUG (measured on 0.5.81, 2026-09-18) ------------------------------------
# Route oc/muse-spark-1.3-contributor-free under NON-streaming
# POST /v1/chat/completions returns HTTP 200 with finish_reason:"in_progress",
# empty content and zero usage on any generation longer than ~40s. Reproduced
# 9/12 calls + 4/5 retries; (low) (10-14s) always completed, (medium) ~50%,
# (high)/(xhigh)/(max)/no-suffix never completed in 7 attempts. This route is
# the FIRST member of Trevor's opus-chain, so the chain could silently hand
# back an empty answer. The SAME route with stream:true completed normally at
# 59.45s (finish_reason "stop", 5760 completion tokens) — so the fault is in
# the non-streaming path inside 9Router, not an upstream wall-clock cap.
#
# There is NO polling loop to lengthen. The real mechanism is two-layered:
#
#  LAYER 1 — the request the router sends differs between the two paths.
#  The OpenCode provider's transformRequest FORCES `body.stream=true` on every
#  request regardless of what the client asked for. But its buildHeaders sets
#  `Accept: b?"text/event-stream":"*/*"`, where `b` is the CLIENT's stream flag
#  (base class calls buildHeaders(credentials, stream, url, model, body)). So a
#  non-streaming client produces an upstream request whose body says
#  `stream:true` while its Accept header says `*/*` — it asks for SSE but
#  advertises that it will take anything. That upstream SSE body then arrives
#  truncated at a clean EOF. A streaming client sends
#  `Accept: text/event-stream` and the same generation completes.
#  EDIT 1 makes the header describe what the request actually receives. It is a
#  no-op for streaming requests (they already sent text/event-stream) and
#  touches no other provider (every provider class has its own buildHeaders).
#
#  LAYER 2 — the non-stream aggregator turns that truncation into a fake 200.
#  The shared OPENAI_RESPONSES non-streaming aggregator reads the upstream SSE
#  into an accumulator seeded with `status:"in_progress"`, and ONLY
#  response.completed / response.done / response.failed ever change it. Its read
#  loop is `for(;;){let{done,value}=await read();if(done)break;...}` — a clean
#  EOF with no terminal event exits normally, so status stays "in_progress".
#  It then collects output ONLY from response.output_item.done events, so every
#  response.output_text.delta already received is discarded, and usage stays
#  zero because usage is copied only from response.completed. The caller finally
#  computes finish_reason as `E?"tool_calls":completed?"stop":g.status||"stop"`
#  — leaking the internal status string straight into finish_reason — and wraps
#  it in a 200. Hence: 200 + finish_reason:"in_progress" + "" + zero usage.
#  Note the authors already knew upstream SSE can end early: the STREAMING path
#  synthesizes a `response.failed` "stream closed before response.completed"
#  event for exactly this case. The non-stream path never got that treatment.
#  EDITS 2-9 preserve recovered text only for explicit terminal responses.
#  Unexpected EOF and upstream failure use the existing HTTP 502 error path.
#  Only upstream incomplete_details.reason=max_output_tokens maps to length.
#
# SCOPE NOTE — EDIT 1 is OpenCode-only. EDITS 2-9 live in the shared
# OPENAI_RESPONSES non-streaming aggregator, which also serves codex,
# github-codex, opencode-go and openai-compatible-* in responses mode. Every one
# of them is a no-op on any response that reaches a terminal event, i.e. on the
# entire healthy path; they change behaviour only in the case that today is
# already guaranteed-broken (empty body, zero usage, illegal finish_reason).
#
# Content-anchored, not chunk-number-anchored: 9Router renumbers webpack chunks
# on every release. Each edit is located by searching every .js file under
# app/.next-cli-build for its exact anchor text, wherever it lands. All nine
# anchors were verified unique across the entire 0.5.81 build.
#
# Usage: 9router-opencode-poll-guard.sh [--check] [--quiet] [9router_root]
#   --check   read-only: report WOULD PATCH / already / AMBIGUOUS, write nothing.
#   --quiet   suppress per-file chatter; final result still goes to exit code.
#   9router_root  defaults to ~/.npm-global/lib/node_modules/9router. Pass a
#                 different root (e.g. a dry-run copy) to test in isolation —
#                 same convention as 9router-glm53-thinking-guard.sh.
set -uo pipefail

CHECK=0; QUIET=0; ROOT=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --quiet) QUIET=1 ;;
    *) ROOT="$a" ;;
  esac
done
ROOT="${ROOT:-$HOME/.npm-global/lib/node_modules/9router}"
BUILD="$ROOT/app/.next-cli-build"
[ -d "$BUILD" ] || { echo "FAIL: 9router build dir not found at $BUILD"; exit 2; }

# Resolve node by absolute path — a non-login/launchd shell has a minimal PATH
# and `/usr/bin/env node` false-fails, which would roll back a good patch.
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node binary resolvable"; exit 2; }

# Resolve python3 by absolute path for the same reason.
PY=""
for c in /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { PY="$c"; break; }
done
[ -n "$PY" ] || { echo "FAIL: no python3 binary resolvable"; exit 2; }

STAMP="$(date +%Y%m%d-%H%M%S)"

"$PY" - "$BUILD" "$NODE" "$CHECK" "$QUIET" "$STAMP" <<'PY'
import os, shutil, subprocess, sys

build_dir, node_bin, check, quiet, stamp = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4] == "1", sys.argv[5]

def say(*a):
    if not quiet:
        print(*a)

def rel(p):
    return os.path.relpath(p, build_dir)

# ---- the nine edits, anchored by exact content ---------------------------
# EDIT6/EDIT7 appear twice on purpose: 9Router 0.5.85 renamed the minified locals
# in the non-stream builder (g->h, E->G, n->o). Same name = same edit; whichever
# variant's anchor exists is applied, the other is skipped. (added 2026-09-22)
EDITS = [('EDIT1 opencode Accept: always SSE (body always forces stream:true)',
  '"x-opencode-project":e["x-opencode-project"]||"global",Accept:b?"text/event-stream":"*/*"',
  '"x-opencode-project":e["x-opencode-project"]||"global",Accept:"text/event-stream"'),
 ('EDIT2 aggregator: carry a delta-text buffer',
  'g={responseId:"",created:Math.floor(Date.now()/1e3),status:"in_progress",usage:{...e},items:new Map}',
  'g={responseId:"",created:Math.floor(Date.now()/1e3),status:"in_progress",usage:{...e},items:new Map,deltaText:""}'),
 ('EDIT3 frame handler: keep response.output_text.delta text',
  '"response.output_item.done"===f?b.items.set(c.output_index??0,c.item)',
  '"response.output_text.delta"===f?b.deltaText=(b.deltaText||"")+("string"==typeof '
  'c.delta?c.delta:""):"response.output_item.done"===f?b.items.set(c.output_index??0,c.item)'),
 ('EDIT4 aggregator: recover buffered text when no item carried any',
  'let h=[],i=g.items.size>0?Math.max(...g.items.keys()):-1;for(let a=0;a<=i;a++)h.push(g.items.get(a)||{type:"message",content:[],role:"assistant"});',
  'let h=[],i=g.items.size>0?Math.max(...g.items.keys()):-1;for(let '
  'a=0;a<=i;a++)h.push(g.items.get(a)||{type:"message",content:[],role:"assistant"});if(g.deltaText&&!h.some(a=>a?.type==="message"&&Array.isArray(a.content)&&a.content.some(a=>"string"==typeof '
  'a?.text&&a.text.length>0)))h.push({type:"message",role:"assistant",content:[{type:"output_text",text:g.deltaText,annotations:[]}]});'),
 ('EDIT5 aggregator: reject non-terminal EOF before success callbacks',
  'status:g.status||"completed",output:h,usage:g.usage}',
  'status:g.status,output:h,usage:g.usage,...g.incomplete_details?{incomplete_details:g.incomplete_details}:{}}'),
 ('EDIT6 non-stream: length only for explicit upstream token limit',
  'let b="completed"===g.status||"done"===g.status,d=E?"tool_calls":b?"stop":g.status||"stop"',
  'let '
  'b="completed"===g.status||"done"===g.status,d="incomplete"===g.status&&"max_output_tokens"===g.incomplete_details?.reason?"length":E?"tool_calls":b?"stop":g.status||"stop"'),
 ('EDIT7 non-stream: explicit token-limit outcome on Gemini wire',
  'parts:[{text:n||""}]},finishReason:"STOP",index:0}',
  'parts:[{text:n||""}]},finishReason:"incomplete"===g.status?"MAX_TOKENS":"STOP",index:0}'),
 ('EDIT6 non-stream: length only for explicit upstream token limit',
  'let b="completed"===h.status||"done"===h.status,d=G?"tool_calls":b?"stop":h.status||"stop"',
  'let '
  'b="completed"===h.status||"done"===h.status,d="incomplete"===h.status&&"max_output_tokens"===h.incomplete_details?.reason?"length":G?"tool_calls":b?"stop":h.status||"stop"'),
 ('EDIT7 non-stream: explicit token-limit outcome on Gemini wire',
  'parts:[{text:o||""}]},finishReason:"STOP",index:0}',
  'parts:[{text:o||""}]},finishReason:"incomplete"===h.status?"MAX_TOKENS":"STOP",index:0}'),
 ('EDIT8 aggregator: recognize upstream terminal outcomes',
  '"response.completed"===f||"response.done"===f?(b.status="completed",c.response?.usage&&(b.usage.input_tokens=c.response.usage.input_tokens||0,b.usage.output_tokens=c.response.usage.output_tokens||0,b.usage.total_tokens=c.response.usage.total_tokens||0)):"response.failed"===f&&(b.status="failed")',
  '"response.completed"===f||"response.done"===f||"response.incomplete"===f?(b.status=c.response?.status||("response.incomplete"===f?"incomplete":"completed"),b.incomplete_details=c.response?.incomplete_details,c.response?.usage&&(b.usage.input_tokens=c.response.usage.input_tokens||0,b.usage.output_tokens=c.response.usage.output_tokens||0,b.usage.total_tokens=c.response.usage.total_tokens||0)):"response.failed"===f||"error"===f?b.status="failed":void '
  '0'),
 ('EDIT9 aggregator: fail closed on EOF and protocol errors',
  'finally{b.releaseLock()}let h=[],i=g.items.size',
  'finally{b.releaseLock()}if("completed"!==g.status&&!("incomplete"===g.status&&"max_output_tokens"===g.incomplete_details?.reason))throw Error("Upstream '
  'Responses stream failed or ended without a valid terminal event");let h=[],i=g.items.size')]
LEGACY_EDITS = [('EDIT5 aggregator: non-terminal EOF is incomplete, not in_progress',
  'status:g.status||"completed",output:h,usage:g.usage}',
  'status:"in_progress"===g.status?"incomplete":g.status||"completed",output:h,usage:g.usage}'),
 ('EDIT6 non-stream: truncated-with-content reports finish_reason length',
  'let b="completed"===g.status||"done"===g.status,d=E?"tool_calls":b?"stop":g.status||"stop"',
  'let b="completed"===g.status||"done"===g.status,d=E?"tool_calls":b?"stop":n?"length":g.status||"stop"'),
 ('EDIT7 non-stream: truncated-and-empty fails loud instead of a fake 200',
  'E=A.length>0;if(b===i.h.ANTIGRAVITY||b===i.h.GEMINI||b===i.h.GEMINI_CLI)',
  'E=A.length>0;if("incomplete"===g.status&&!E&&!(n&&n.length>0))throw Error("opencode-poll-guard: upstream SSE ended before response.completed with no '
  'content recovered");if(b===i.h.ANTIGRAVITY||b===i.h.GEMINI||b===i.h.GEMINI_CLI)')]

# ---- discover every .js file under the build dir, once --------------------
all_files = []
for dirpath, dirnames, filenames in os.walk(build_dir):
    for fn in filenames:
        if fn.endswith(".js"):
            all_files.append(os.path.join(dirpath, fn))
all_files.sort()

texts = {}
for p in all_files:
    try:
        texts[p] = open(p, encoding="utf-8", errors="surrogateescape").read()
    except OSError:
        continue

per_edit_already = {name: [] for name, _, _ in EDITS}
per_edit_found = {name: [] for name, _, _ in EDITS}
per_edit_ambiguous = {name: [] for name, _, _ in EDITS}

to_write = {}
for path, s in texts.items():
    out = s
    for _, old, previous in LEGACY_EDITS:
        if previous in out:
            out = out.replace(previous, old)
    changed = out != s
    for name, old, new in EDITS:
        if new in out:
            per_edit_already[name].append(path)
            continue
        cnt = out.count(old)
        if cnt == 0:
            continue
        if cnt != 1:
            per_edit_ambiguous[name].append((path, cnt))
            continue
        per_edit_found[name].append(path)
        if not check:
            out = out.replace(old, new, 1)
            changed = True
    if changed and out != s:
        to_write[path] = out

# An anchor that is nowhere to be found is a FAILURE, never a silent success.
missing = [name for name, _, _ in EDITS
           if not per_edit_already[name] and not per_edit_found[name] and not per_edit_ambiguous[name]]
if missing:
    print(f"FAIL: {len(missing)} of {len(EDITS)} OpenCode non-stream anchors were not found anywhere under {build_dir}:")
    for name in missing:
        print(f"      MISSING: {name}")
    print("      The bundle layout changed. Re-derive the anchors; do NOT assume success.")
    sys.exit(3)

for name, _, _ in EDITS:
    for p in per_edit_found[name]:
        say(f"  {'WOULD PATCH' if check else 'patching'} [{name}]: {rel(p)}")
    for p in per_edit_already[name]:
        say(f"  already applied [{name}]: {rel(p)}")
    for p, c in per_edit_ambiguous[name]:
        say(f"  AMBIGUOUS [{name}]: {rel(p)} anchor count={c} (expected 1) — NOT touched")

if check:
    print()
    print("CHECK MODE — nothing was written.")
    if any(per_edit_ambiguous[n] for n, _, _ in EDITS):
        print("AMBIGUOUS anchors present — see above.")
        sys.exit(5)
    sys.exit(0)

failed = 0
patched_files = []
for path, new_text in to_write.items():
    backup = f"{path}.pre-opencode-poll-{stamp}"
    shutil.copy2(path, backup)
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(new_text)
    r = subprocess.run([node_bin, "--check", path], capture_output=True)
    if r.returncode != 0:
        shutil.copy2(backup, path)
        say(f"FAIL: node --check rejected {rel(path)} after patch — restored from {backup}")
        say(f"      stderr: {r.stderr.decode(errors='replace')[:500]}")
        failed += 1
        continue
    patched_files.append(path)
    say(f"patched: {rel(path)}  (backup: {backup})")

if failed:
    print(f"\nFAILED: {failed} file(s) rejected by node --check and rolled back. See above.")
    sys.exit(4)

if any(per_edit_ambiguous[n] for n, _, _ in EDITS):
    print("\nWARNING: at least one file had an ambiguous (non-unique) anchor and was left untouched.")
    print("         This means the bundle shape changed since these anchors were derived — inspect by hand.")
    sys.exit(5)

say()
say(f"files patched: {len(patched_files)}   already-applied instances left alone: "
    f"{sum(len(v) for v in per_edit_already.values())}")
say()
say("Verify (post-patch occurrence counts of the NEW form, re-read from disk):")
shortfall = 0
# Grouped by NAME: an edit may carry several anchor variants (one per bundle
# layout); exactly one of them must read back, so the variants' counts are summed.
_forms = {}
for name, old, new in EDITS:
    _forms.setdefault(name, []).append(new)
for name, forms in _forms.items():
    total = 0
    for p in all_files:
        try:
            s2 = open(p, encoding="utf-8", errors="surrogateescape").read()
        except OSError:
            continue
        total += sum(s2.count(f) for f in forms)
    say(f"  {name}: {total}")
    if total != 1:
        shortfall += 1
if shortfall:
    print(f"\nFAILED: {shortfall} edit(s) do not read back exactly once from disk.")
    sys.exit(6)
say()
say("Restart 9Router to load: launchctl kickstart -k gui/$(id -u)/com.blackceo.9router-localhost")
sys.exit(0)
PY
exit $?
