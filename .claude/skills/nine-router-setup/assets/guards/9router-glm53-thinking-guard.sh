#!/bin/bash
# 9router-glm53-thinking-guard.sh  (v3, 2026-09-18)
# Keeps the GLM 5.3 / GLM 5.3 Flash reasoning-effort repairs applied to the
# prebuilt 9Router Next bundle. RE-RUN AFTER EVERY `npm i -g 9router` — an
# update replaces the bundle and silently reverts every edit below.
#
# There is no server source in the npm package (only src/cli/*), so this is a
# content-anchored local override, never a chunk-number-anchored one: 9Router
# renumbers webpack chunks on every release, so each edit is located by its
# exact anchor text wherever it lands under app/.next-cli-build.
#
# WHAT / WHY -------------------------------------------------------------------
# Measured on 0.5.81 with an in-process harness that instantiates the real
# bundle modules, and confirmed at the HTTP boundary with a sandbox router whose
# global.fetch was intercepted (see PORT-0.5.81.md for the trace tables):
#
#  A  MODEL_CAPABILITIES["glm-5.3-flash"] (the vision/video/pdf "zai"-format
#     entry) lacks thinkingEffortSupported.  It is the entry that WINS for the
#     bare and vendor-prefixed ids (`glm-5.3-flash`, `z-ai/glm-5.3-flash`)
#     because getCapabilitiesForModel() matches MODEL_CAPABILITIES on the
#     basename before falling through to PATTERN_CAPABILITIES.  Without the flag
#     the "zai" thinking serializer emits `thinking:{type:"enabled"}` and NO
#     effort at all.  Load-bearing for the custom openai-compatible OpenRouter
#     connection.  Every other capability on the entry is preserved verbatim.
#
#  B  The low/high/max level rule was scoped `{provider:"codebuddy-cn",
#     pattern:"glm-5.3*"}`.  Every other provider fell through to the
#     by-format default, which for thinkingFormat "zai" is ["none","thinking"]
#     — no low/high/max at all.  getThinkingLevels() feeds the "openai"
#     serializer, which downgrades an unsupported "max" to "xhigh":
#       reasoning_effort = ("max"!==lvl&&"ultra"!==lvl)||levels?.includes(lvl)
#                          ? lvl : ... : "xhigh"
#     Since the built-in `openrouter` provider declares thinkingFormat:"openai"
#     in the provider registry (which outranks the model caps), THIS is what
#     turned `(max)` into `reasoning_effort:"xhigh"` on the OpenRouter route.
#     v1 of this guard widened the rule to a provider-agnostic `*glm-5.3*`.
#     v2 restores the original CodeBuddy rule untouched and adds rules scoped to
#     the connections that actually exist on this box, so no unrelated provider
#     path changes:
#       codebuddy-cn (restored, byte-identical to stock)
#       openrouter                                   (built-in, "openrouter")
#       ollama / ollama-local                        (built-in)
#       openai-compatible-chat-5ca0b14b-...          (custom node "Or-Paid-all-models")
#
#  C  The OpenRouter request never gets OpenRouter's documented reasoning
#     envelope.  v1 of this guard patched `transformRequest` on the ABSTRACT
#     base transport class — which is overridden by the openai-compatible base
#     class that every provider resolved through the transport factory actually
#     uses, so v1's edit was dead code and never executed (proved: the custom
#     OpenRouter node still shipped `thinking:{type:"enabled"}` with the edit
#     applied).  v2 patches the class that runs, and only for GLM 5.3 on an
#     OpenRouter endpoint, converting the already-resolved effort into
#     `reasoning:{effort:<level>}` and dropping the Z.ai-native fields
#     OpenRouter does not accept.  Every other model and provider through that
#     same shared class is untouched.
#     Source for the envelope: https://openrouter.ai/docs/use-cases/reasoning-tokens
#     (unified `reasoning` object; documented effort values include "max").
#
#  D  (v3 widened this from GLM 5.3 only to every reasoning model on an Ollama target.)
#     The Ollama route received NO thinking control whatsoever.  The built-in
#     `ollama` provider has format "ollama" and posts to
#     https://ollama.com/api/chat, and the openai->ollama request translator
#     builds a fresh body carrying only model/messages/stream/options/tools,
#     so anything the thinking serializer wrote was already gone — and what it
#     wrote (`thinking:{type:"enabled"}` + `reasoning_effort`) are Z.ai fields
#     that Ollama's native endpoint does not read anyway.  There is no `think`
#     field emitted anywhere in the stock 0.5.81 bundle (searched every .js
#     under app/.next-cli-build for `think:`, `"think"` and `think=`: zero
#     hits, while the controls `enable_thinking` and `reasoning_effort` return
#     37 and 151).  v2 adds native serialization as a post-pass on the existing
#     thinking-intent architecture: it reuses the level the serializer already
#     resolved and writes Ollama's top-level `think`.
#     Accepted values proved against a live Ollama /api/chat (0.34.1) — the
#     server's own rejection message for an invalid value states the set:
#       invalid think value: "bogus" (must be "high", "medium", "low", "max", true, or false)
#     so `max` is native and is never substituted with `think:true`.
#
#  E  Non-stream responses lost the reasoning trace.  A shared finalizer deletes
#     `message.reasoning_content` whenever a message carries both reasoning and
#     content, for every client format except the Claude and Responses wires.
#     On the Ollama route that field is the ONLY place the thinking trace
#     exists (the ollama->openai converter maps `message.thinking` into it), so
#     the trace vanished on non-stream while streaming kept it — exactly the
#     stream/non-stream asymmetry that was reported.  v2 exempts the Ollama
#     upstream format only; every other provider keeps the existing behaviour.
#
#  F  The non-stream openai->claude response converter reads reasoning from
#     `reasoning_content` / `provider_specific_fields.reasoning_content` only,
#     while its own streaming counterpart reads `reasoning_content||reasoning`.
#     OpenRouter returns `message.reasoning`, so on the Claude wire
#     (which is what claude-nine speaks) GLM 5.3's reasoning was dropped on
#     non-stream replies.  v2 adds the same fallbacks the stream path already
#     has, plus `reasoning_details`.
#
#  X  Removes v1's dead edit C from the abstract base transport, restoring that
#     method to stock.
#
# NOT DONE HERE: defaulting provider connections to mode "max" in the settings
# DB (a DB change, out of scope for a bundle guard), and widening D/E to the
# other reasoning models on the Ollama provider (e.g. deepseek-v4.1-flash:cloud
# is broken the same way) — deliberately left alone, since only the two GLM 5.3
# Flash routes were in scope.  See PORT-0.5.81.md.
#
# Usage: 9router-glm53-thinking-guard.sh [--check] [--quiet] [9router_root]
#   --check        read-only: report WOULD PATCH / already / AMBIGUOUS, write nothing.
#   --quiet        suppress per-file chatter; the result still lands in the exit code.
#   9router_root   defaults to ~/.npm-global/lib/node_modules/9router. Pass another
#                  root (a dry-run copy, a sandbox package) to test in isolation.
# Exit: 0 ok/already applied · 2 bad root or no interpreter · 3 NO anchor found
#       anywhere (bundle layout changed — never a silent success) · 4 node --check
#       rejected a write and it was rolled back · 5 an anchor was ambiguous.
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

# Resolve node and python3 by absolute path: a launchd/non-login shell has a
# minimal PATH, and a false-failing `node --check` would roll back a good patch.
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node binary resolvable"; exit 2; }
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
    if not quiet: print(*a)
def rel(p): return os.path.relpath(p, build_dir)

# The executor passes the model id *with* its `(level)` suffix intact
# (chat-core calls transport.execute({model: ap, ...}) where ap still carries it;
# only the request BODY's model is stripped, via ah.model=stripSuffix(...)).  The
# applier, by contrast, gates on its own already-stripped cleanModel.  One regex
# that tolerates an optional trailing suffix is therefore correct at both sites.
# This was caught by the mock-upstream interception test, not by the unit tests.
GLM = r'/(?:^|\/)glm-5\.3(?:-flash)?(?::[^()\/]*)?(?:\([^()]+\))?$/i'

# ---- EDIT A ---------------------------------------------------------------
A_OLD = '"glm-5.3-flash":{vision:!0,videoInput:!0,pdf:!0,reasoning:!0,thinkingFormat:"zai",contextWindow:1e6,maxOutput:131072}'
A_NEW = '"glm-5.3-flash":{vision:!0,videoInput:!0,pdf:!0,reasoning:!0,thinkingFormat:"zai",thinkingEffortSupported:!0,contextWindow:1e6,maxOutput:131072}'

# ---- EDIT B ---------------------------------------------------------------
B_STOCK = '{provider:"codebuddy-cn",pattern:"glm-5.3*",levels:["low","high","max"]}'
B_V1    = '{pattern:"*glm-5.3*",levels:["low","high","max"]}'
_L = '",levels:["low","high","max"]}'
B_NEW = (B_STOCK
         + ',{provider:"openrouter",pattern:"*glm-5.3*' + _L
         + ',{provider:"ollama",pattern:"*glm-5.3*' + _L
         + ',{provider:"ollama-local",pattern:"*glm-5.3*' + _L
         + ',{provider:"openai-compatible-chat-5ca0b14b-5cca-49f1-a53e-11858325475d",pattern:"*glm-5.3*' + _L)

# ---- EDIT C ---------------------------------------------------------------
C_OLD = ('transformRequest(a,b){let c=this.applyJsonSchemaFallback(b);return c&&"object"==typeof c&&'
         '(this.config.quirks?.dropClientMetadata&&delete c.client_metadata,(0,l.c)(this.provider,a,c)),'
         '(0,k.Z)({provider:this.provider,model:a,body:c})}')
C_NEW = ('transformRequest(a,b,c,d){let __b=this.applyJsonSchemaFallback(b);'
         '__b&&"object"==typeof __b&&(this.config.quirks?.dropClientMetadata&&delete __b.client_metadata,'
         '(0,l.c)(this.provider,a,__b));let __o=(0,k.Z)({provider:this.provider,model:a,body:__b});'
         'if(__o&&"object"==typeof __o&&' + GLM + '.test(a||"")){'
         'let __or="openrouter"===this.provider||this.provider?.startsWith?.("openai-compatible-")&&'
         r'/^https:\/\/openrouter\.ai(?:\/|$)/i' '.test(d?.providerSpecificData?.baseUrl||""),'
         '__ef=__o.reasoning_effort||("object"==typeof __o.reasoning?__o.reasoning?.effort:null);'
         'if(__or&&["none","minimal","low","medium","high","xhigh","max"].includes(__ef)){'
         '__o={...__o,reasoning:{...("object"==typeof __o.reasoning&&__o.reasoning?__o.reasoning:{}),effort:__ef}};'
         'delete __o.reasoning_effort;delete __o.thinking;delete __o.enable_thinking}}return __o}')

# ---- EDIT D ---------------------------------------------------------------
D_OLD = 'a&&(b.params.reasoning_effort=a)}}}(y,c,w,x,z,A),c}'
# v2 emitted `think` only for GLM 5.3. v3 widens it to EVERY reasoning model routed to an
# Ollama target (both the `ollama` and `ollama-local` connections declare format "ollama"),
# because the same defect applies to all of them: the openai->ollama translator discards
# every thinking field, and the per-format serializers then write fields Ollama never reads.
#
# The level comes from the thinking INTENT (module-scope `o`), not from whatever the
# per-format serializer happened to write, so the mapping stays 1:1. That matters: the
# `deepseek` serializer collapses every level below max to "high", so reading its output
# would turn `(low)` into think:"high". The serializer's value is kept only as a fallback
# for intents with no native Ollama level (a bucketed budget, or "auto").
#
# Gates, in order: the target wire format must be ollama; the resolved capabilities must
# say the model reasons at all; and an intent must exist. The applier already returns early
# when caps.reasoning is false and when no intent was given, so a non-reasoning model cannot
# reach this code -- `!d.reasoning` is a second, explicit belt.
#
# Module-scope `t` is reused to strip EVERY non-native thinking field the serializers can
# write -- thinking, reasoning, reasoning_effort, thinkingConfig, enable_thinking,
# thinking_budget, output_config, generationConfig.thinkingConfig and params.* -- rather
# than a hand-listed subset. `reasoning_effort` is read before t() removes it.
#
# Ollama's own rejection message enumerates the native set as high/medium/low/max/true/false
# for thinking models. The one documented exception is GPT-OSS, which takes low/medium/high
# only, so `max` is aliased to `high` for it -- defined once, here, and tested.
# The router's per-model `levels` list is deliberately NOT consulted: it describes the
# model's own effort scale, whereas what matters here is what Ollama's API accepts.
D_V2 = 'a&&(b.params.reasoning_effort=a)}}}(y,c,w,x,z,A),function(a,b,c,d,e,f){if("ollama"!==a||!/(?:^|\\/)glm-5\\.3(?:-flash)?(?::[^()\\/]*)?(?:\\([^()]+\\))?$/i.test(b||""))return;let g=c.reasoning_effort;delete c.thinking,delete c.enable_thinking,delete c.reasoning_effort,delete c.thinking_budget;if("none"===f?.mode){!1!==d.thinkingCanDisable&&(c.think=!1);return}if("string"==typeof g){let b=["low","medium","high","max"].includes(g)?g:null;if(b&&(!Array.isArray(e)||e.includes(b)||"medium"===b)){c.think=b;return}c.think=!0}}(a,q,c,x,z,w),c}'
D_NEW = 'a&&(b.params.reasoning_effort=a)}}}(y,c,w,x,z,A),function(a,b,c,d,e,f){if("ollama"!==a||!d.reasoning||!f)return;let __lv=o(f),__ser=c.reasoning_effort,__nat=["low","medium","high","max"];t(c);if("none"===f.mode){!1!==d.thinkingCanDisable&&(c.think=!1);return}let __pick=__nat.includes(__lv)?__lv:__nat.includes(__ser)?__ser:null;if(__pick){c.think="max"===__pick&&/gpt-oss/i.test(b||"")?"high":__pick;return}c.think=!0}(a,q,c,x,z,w),c}'

# ---- EDIT E ---------------------------------------------------------------
# Longer anchor: the bare strip statement occurs twice in this chunk (the other
# copy is the native-passthrough finalizer, which has no upstream-format var in
# scope and is deliberately left alone).
E_OLD = ('if(M?.usage&&(M.usage=(0,h.WL)((0,h.O9)(M.usage),r)),!N&&!O&&M?.choices)for(let a of M.choices)'
         'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')
E_NEW = ('if(M?.usage&&(M.usage=(0,h.WL)((0,h.O9)(M.usage),r)),!N&&!O&&s!==d.h.OLLAMA&&M?.choices)for(let a of M.choices)'
         'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')
# 0.5.85 renamed the minified locals in this function (M->N, N->O, O->P, r->s,
# targetFormat s->t). Same edit, second anchor. (added 2026-09-22)
E_OLD85 = ('if(N?.usage&&(N.usage=(0,h.WL)((0,h.O9)(N.usage),s)),!O&&!P&&N?.choices)for(let a of N.choices)'
           'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')
E_NEW85 = ('if(N?.usage&&(N.usage=(0,h.WL)((0,h.O9)(N.usage),s)),!O&&!P&&t!==d.h.OLLAMA&&N?.choices)for(let a of N.choices)'
           'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')
# 0.5.91 renamed them again (N->O, O->P, P->Q, s->t, targetFormat t->u). Same edit, third anchor. (added 2026-09-26)
E_OLD91 = ('if(O?.usage&&(O.usage=(0,h.WL)((0,h.O9)(O.usage),t)),!P&&!Q&&O?.choices)for(let a of O.choices)'
           'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')
E_NEW91 = ('if(O?.usage&&(O.usage=(0,h.WL)((0,h.O9)(O.usage),t)),!P&&!Q&&u!==d.h.OLLAMA&&O?.choices)for(let a of O.choices)'
           'a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;')

# ---- EDIT F ---------------------------------------------------------------
F_OLD = 'g=c.reasoning_content||c.provider_specific_fields?.reasoning_content||"";'
F_NEW = ('g=c.reasoning_content||c.provider_specific_fields?.reasoning_content||c.reasoning||'
         '(Array.isArray(c.reasoning_details)?c.reasoning_details.map(a=>"string"==typeof a?a:a?.text||a?.content||"").join(""):"")||"";')

# ---- EDIT X: undo v1's dead base-transport edit ---------------------------
X_STOCK = 'transformRequest(a,b,c,d){return b}shouldRetry(a,b){return a===d.gx.RATE_LIMITED&&b+1<this.getFallbackCount()}'
X_V1_PREFIX = 'transformRequest(a,b,c,d){if(this.provider?.startsWith?.("openai-compatible-")'

# Each edit: (name, expected_file_count, [(from,to), ...], final_form)
EDITS = [
    ("A caps: glm-5.3-flash zai entry gains thinkingEffortSupported", 4,
     [(A_OLD, A_NEW)], A_NEW),
    ("B levels: CodeBuddy rule restored + rules scoped to the real connections", 3,
     [(B_V1, B_NEW), (B_STOCK, B_NEW)], B_NEW),
    ("C transport: OpenRouter reasoning envelope on the class that actually runs", 1,
     [(C_OLD, C_NEW)], C_NEW),
    ("D applier: native Ollama top-level think for every reasoning model", 1,
     [(D_V2, D_NEW), (D_OLD, D_NEW)], D_NEW),
    ("E response: keep reasoning_content on non-stream Ollama replies", 1,
     [(E_OLD, E_NEW), (E_OLD85, E_NEW85), (E_OLD91, E_NEW91)], (E_NEW, E_NEW85, E_NEW91)),
    ("F response: non-stream openai->claude reads reasoning/reasoning_details too", 1,
     [(F_OLD, F_NEW)], F_NEW),
]

all_files = []
for dirpath, dirnames, filenames in os.walk(build_dir):
    for fn in filenames:
        if fn.endswith(".js"):
            all_files.append(os.path.join(dirpath, fn))
all_files.sort()

texts = {}
for p in all_files:
    try: texts[p] = open(p, encoding="utf-8", errors="surrogateescape").read()
    except OSError: continue

already = {n: [] for n, _, _, _ in EDITS}
found   = {n: [] for n, _, _, _ in EDITS}
ambig   = {n: [] for n, _, _, _ in EDITS}
x_revert = []

to_write = {}
for path, s in texts.items():
    out = s; changed = False
    for name, _cnt, pairs, final in EDITS:
        if any(f in out for f in (final if isinstance(final, tuple) else (final,))):
            already[name].append(path); continue
        hit = None
        for old, new in pairs:
            c = out.count(old)
            if c == 0: continue
            if c != 1:
                ambig[name].append((path, c, old[:48])); hit = "ambig"; break
            hit = (old, new); break
        if hit and hit != "ambig":
            found[name].append(path)
            if not check:
                out = out.replace(hit[0], hit[1], 1); changed = True
    # EDIT X: revert v1's dead base-transport edit back to stock
    i = out.find(X_V1_PREFIX)
    if i != -1:
        j = out.find('shouldRetry(a,b){return a===d.gx.RATE_LIMITED&&b+1<this.getFallbackCount()}', i)
        if j != -1:
            end = j + len('shouldRetry(a,b){return a===d.gx.RATE_LIMITED&&b+1<this.getFallbackCount()}')
            x_revert.append(path)
            if not check:
                out = out[:i] + X_STOCK + out[end:]; changed = True
    if changed: to_write[path] = out

any_hit = any(already[n] or found[n] for n, _, _, _ in EDITS)
if not any_hit:
    print(f"FAIL: none of the GLM-5.3 reasoning anchors were found anywhere under {build_dir}.")
    print("      The bundle layout changed. Re-derive the anchors; do NOT assume success.")
    sys.exit(3)

for name, cnt, _pairs, _final in EDITS:
    for p in found[name]:   say(f"  {'WOULD PATCH' if check else 'patching'} [{name}]: {rel(p)}")
    for p in already[name]: say(f"  already applied [{name}]: {rel(p)}")
    for p, c, frag in ambig[name]:
        say(f"  AMBIGUOUS [{name}]: {rel(p)} anchor count={c} for '{frag}...' (expected 1) — NOT touched")
    n = len(found[name]) + len(already[name])
    if n != cnt:
        say(f"  NOTE [{name}]: resolved {n} file(s), expected {cnt}")
for p in x_revert:
    say(f"  {'WOULD REVERT' if check else 'reverting'} [X v1 dead base-transport edit -> stock]: {rel(p)}")

if check:
    print(); print("CHECK MODE — nothing was written."); sys.exit(0)

failed = 0; patched = []
for path, new_text in to_write.items():
    backup = f"{path}.pre-glm53-thinking-{stamp}"
    shutil.copy2(path, backup)
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f: f.write(new_text)
    r = subprocess.run([node_bin, "--check", path], capture_output=True)
    if r.returncode != 0:
        shutil.copy2(backup, path)
        say(f"FAIL: node --check rejected {rel(path)} after patch — restored from {backup}")
        say(f"      stderr: {r.stderr.decode(errors='replace')[:500]}")
        failed += 1; continue
    patched.append(path)
    say(f"patched: {rel(path)}  (backup: {backup})")

if failed:
    print(f"\nFAILED: {failed} file(s) rejected by node --check and rolled back."); sys.exit(4)
if any(ambig[n] for n, _, _, _ in EDITS):
    print("\nWARNING: at least one anchor was ambiguous and that file was left untouched.")
    print("         The bundle shape changed since these anchors were derived — inspect by hand.")
    sys.exit(5)

say()
say(f"files patched: {len(patched)}   already-applied instances left alone: "
    f"{sum(len(v) for v in already.values())}")
say()
say("Post-patch occurrence counts of the final form (re-read from disk):")
for name, cnt, _pairs, final in EDITS:
    total = 0
    for p in all_files:
        try:
            _t = open(p, encoding="utf-8", errors="surrogateescape").read()
            total += sum(_t.count(f) for f in (final if isinstance(final, tuple) else (final,)))
        except OSError: continue
    say(f"  {name}: {total} (expected {cnt})")
    # A count that does not match is the one thing in this report worth breaking
    # silence for: --quiet must hide routine success, never a shortfall.
    if total != cnt:
        print(f"WARNING: GLM-5.3 [{name}] reads back {total} from disk, expected {cnt}.")
say()
say("Verify behaviour: ~/.local/bin/9router-glm53-regression-check.sh")
say("Restart 9Router:  launchctl kickstart -k gui/$(id -u)/com.blackceo.9router-localhost")
sys.exit(0)
PY
exit $?
