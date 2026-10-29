#!/bin/bash
# 9router-glm53-thinking-guard.sh  (v5, 2026-10-29)
# Keeps the GLM 5.3 / GLM 5.3 Flash reasoning-effort repairs applied to the
# prebuilt 9Router Next bundle. RE-RUN AFTER EVERY `npm i -g 9router` — an
# update replaces the bundle and silently reverts every edit below.
#
# There is no server source in the npm package (only src/cli/*), so this is a
# content-anchored local override, never a chunk-number-anchored one: 9Router
# renumbers webpack chunks on every release, so each edit is located by a regex
# SIGNATURE wherever it lands under app/.next-cli-build (v4, CAN002: v1-v3 used
# fixed anchor strings that broke on every minifier rename -- on 0.5.104 they
# resolved 0 files for A-D and F and the run still printed "files patched: 0").
# v5 (0.5.112): part D's call-site anchor takes the serializer's optional 7th argument (six arguments up to 0.5.111, seven in 0.5.112).
# The minified locals the edit needs are captured from the code around the anchor.
# FAIL CLOSED: a part that resolves in 0 files, or reads back short, exits 3.
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
#   9router_root   is auto-resolved (npm root -g, running process, Homebrew/usr-local/~/.npm-global). Pass another
#                  root (a dry-run copy, a sandbox package) to test in isolation.
# Exit: 0 ok/already applied · 2 bad root or no interpreter · 3 a part (A-F) found NO
#       target, or read back short (bundle layout changed — never a silent success) · 4 node --check
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
import os, re, shutil, subprocess, sys

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

# ---- Parts A-F: located by CONTENT SIGNATURE (regex), never by chunk filename ----------
# Each part is a function  text -> (state, new_text)  with state one of
#   "applied"    the repaired form is already present (any earlier guard version's form counts)
#   "patched"    the stock form was found exactly once and rewritten
#   "ambiguous"  the stock form was found more than once -> file left untouched
#   "absent"     this file has neither form
# Minified local names (a, b, O, t, ...) change on every 9Router release, so every name the
# edit needs is CAPTURED from the code around the anchor rather than assumed.
R = re.compile
def _one(rx, t):
    ms = list(rx.finditer(t))
    return ms[0] if len(ms) == 1 else ("ambiguous" if ms else None)

# ---- A: the zai-format vision/video/pdf glm-5.3-flash caps entry gains thinkingEffortSupported ----
A_RX = R(r'"glm-5\.3-flash":\{(?=[^{}]*thinkingFormat:"zai")(?P<body>[^{}]*)\}')
def part_A(t):
    m = _one(A_RX, t)
    if m is None: return "absent", t
    if m == "ambiguous": return m, t
    body = m.group("body")
    if "thinkingEffortSupported:!0" in body: return "applied", t
    if "contextWindow:" not in body: return "ambiguous", t
    nb = body.replace("contextWindow:", "thinkingEffortSupported:!0,contextWindow:", 1)
    return "patched", t[:m.start("body")] + nb + t[m.end("body"):]

# ---- B: low/high/max level rules scoped to the connections that exist on this box ----------
_L = '",levels:["low","high","max"]}'
B_RULES = (',{provider:"openrouter",pattern:"*glm-5.3*' + _L
           + ',{provider:"ollama",pattern:"*glm-5.3*' + _L
           + ',{provider:"ollama-local",pattern:"*glm-5.3*' + _L
           + ',{provider:"openai-compatible-chat-5ca0b14b-5cca-49f1-a53e-11858325475d",pattern:"*glm-5.3*' + _L)
# Stock CodeBuddy rules: 0.5.81-0.5.91 had one `glm-5.3*`; 0.5.104 has `glm-5.3` + `glm-5.3-flash`.
B_STOCK_RX = R(r'\{provider:"codebuddy-cn",pattern:"glm-5\.3(?:-flash|\*)?",levels:\["low","high","max"\]\}')
def part_B(t):
    if B_RULES in t: return "applied", t
    ms = list(B_STOCK_RX.finditer(t))
    if not ms: return "absent", t
    groups = 1   # contiguous (comma-joined) stock rules form one array; two arrays = unknown shape
    for p, n in zip(ms, ms[1:]):
        if not (p.end() < len(t) and t[p.end()] == "," and n.start() == p.end() + 1): groups += 1
    if groups != 1: return "ambiguous", t
    e = ms[-1].end()
    return "patched", t[:e] + B_RULES + t[e:]

# ---- C: OpenRouter reasoning envelope, on the transport class that actually runs -------------
# 0.5.91/0.5.95 declare transformRequest(model,body) only; 0.5.104 declares (model,body,stream,credentials).
C_RX = R(r'transformRequest\((?P<a>[\w$]+),(?P<b>[\w$]+)(?:,(?P<c>[\w$]+),(?P<d>[\w$]+))?\)\{let (?P<e>[\w$]+)=this\.applyJsonSchemaFallback\([^;]*?\);'
         r'return (?P=e)&&"object"==typeof (?P=e)&&\(this\.config\.quirks\?\.dropClientMetadata&&delete (?P=e)\.client_metadata,'
         r'\(0,[\w$]+\.[\w$]+\)\(this\.provider,(?P=a),(?P=e)\)\),(?P<fin>\(0,[\w$]+\.[\w$]+\)\(\{provider:this\.provider,model:(?P=a),body:(?P=e)\}\))\}')
C_DONE = '__ef=__o.reasoning_effort||("object"==typeof __o.reasoning'   # in every earlier guard version's final form too
C_POST = ('((__o,__m,__d)=>{if(__o&&"object"==typeof __o&&' + GLM + '.test(__m||"")){'
          'let __or="openrouter"===this.provider||this.provider?.startsWith?.("openai-compatible-")&&'
          r'/^https:\/\/openrouter\.ai(?:\/|$)/i' '.test(__d?.providerSpecificData?.baseUrl||""),'
          '__ef=__o.reasoning_effort||("object"==typeof __o.reasoning?__o.reasoning?.effort:null);'
          'if(__or&&["none","minimal","low","medium","high","xhigh","max"].includes(__ef)){'
          '__o={...__o,reasoning:{...("object"==typeof __o.reasoning&&__o.reasoning?__o.reasoning:{}),effort:"none"===__ef||"minimal"===__ef?"low":__ef}};'
          'delete __o.reasoning_effort;delete __o.thinking;delete __o.enable_thinking}}return __o})')
def part_C(t):
    if C_DONE in t: return "applied", t
    m = _one(C_RX, t)
    if m is None: return "absent", t
    if m == "ambiguous": return m, t
    f, g = m.group("fin"), m.group(0)
    d = m.group("d") or "__d"
    sig = "transformRequest(%s,%s,%s,%s)" % (m.group("a"), m.group("b"), m.group("c") or "__c", d)
    new = sig + g[g.index("){") + 1:-len(f) - 1] + C_POST + "(" + f + "," + m.group("a") + "," + d + ")}"
    return "patched", t[:m.start()] + new + t[m.end():]

# ---- D: native top-level `think` for every reasoning model routed to an Ollama target ---------
# The Ollama route got NO thinking control: the openai->ollama translator builds a fresh body, and
# the per-format serializers write Z.ai fields Ollama never reads. This post-pass runs after the
# serializer inside the thinking applier, reads the level from the thinking INTENT (so (low) maps
# 1:1 instead of collapsing to "high" like the deepseek serializer), strips every non-native
# thinking field with the applier's own strip helper, and writes `think`. Ollama's own rejection
# message gives the native set: high/medium/low/max/true/false. GPT-OSS takes low/medium/high only,
# so max -> high for it. The router's per-model `levels` list is deliberately not consulted.
# GLM 5.3 cannot run without thinking (Z.ai rejects thinking.type "disabled", upstream PR #4656;
# OpenRouter marks its reasoning mandatory; Ollama Cloud ignores think:false for it). So where the
# caps say thinkingCanDisable:false, `(none)` maps to the lowest valid level "low" on both routes
# (C: reasoning.effort none/minimal -> low; D: think:"low") instead of "minimal"/nothing. Models that
# can disable keep think:false. Behaviour carried over from the 2026-10-10 operator port of 0.5.99.
# 0.5.112 gave the serializer a 7th parameter (the clean model id, used by the claude adaptive-thinking branch only), so the
# call has six arguments up to 0.5.111 and seven from 0.5.112; the optional tail accepts both.
D_TAIL_RX = R(r'\.params\.reasoning_effort=a\)\}\}\}\((?P<ser>[\w$]+),(?P<body>[\w$]+),(?P<intent>[\w$]+),(?P<caps>[\w$]+),(?P<lv>[\w$]+),(?P<disp>[\w$]+)(?:,[\w$]+)?\),(?P<ret>[\w$]+)\}')
D_HEAD_RX = R(r'function (?P<fn>[\w$]+)\((?P<wire>[\w$]+),(?P<model>[\w$]+),(?P<body>[\w$]+),(?P<prov>[\w$]+)=null,(?P<ovr>[\w$]+)\)\{if\(!(?P=body)\|\|"object"!=typeof (?P=body)\)return (?P=body);'
              r'let\{cleanModel:(?P<clean>[\w$]+),override:(?P<ov2>[\w$]+)\}=')
D_LEVEL_RX = R(r'function ([\w$]+)\(a\)\{return"level"===a\.mode\?a\.level:"budget"===a\.mode\?')
D_DONE_RX = R(r'if\("ollama"!==[\w$]+\|\|![\w$]+\.reasoning\|\|![\w$]+\)return;let __lv=')
D_POST = ('function(a,b,c,d,e,f){if("ollama"!==a||!d.reasoning||!f)return;let __lv=@O@(f),__ser=c.reasoning_effort,'
          '__nat=["low","medium","high","max"];@U@(c);if("none"===f.mode){!1!==d.thinkingCanDisable?c.think=!1:' + GLM + '.test(b||"")&&(c.think="low");return}'
          'let __pick=__nat.includes(__lv)?__lv:__nat.includes(__ser)?__ser:null;'
          'if(__pick){c.think="max"===__pick&&/gpt-oss/i.test(b||"")?"high":__pick;return}c.think=!0}')
def part_D(t):
    if D_DONE_RX.search(t): return "applied", t
    m = _one(D_TAIL_RX, t)
    if m is None: return "absent", t
    if m == "ambiguous": return m, t
    hs = [h for h in D_HEAD_RX.finditer(t, 0, m.start())]
    if not hs: return "ambiguous", t
    h = hs[-1]
    if h.group("body") != m.group("body") or m.group("ret") != m.group("body"): return "ambiguous", t
    sm = R(r'return (?P<u>[\w$]+)\(' + h.group("body") + r'\),!function\(').search(t, h.end(), m.start())
    lm = D_LEVEL_RX.findall(t)
    if not sm or len(lm) != 1: return "ambiguous", t
    U, O = sm.group("u"), lm[0]
    # the helpers are module-scope names: they must not be shadowed by the applier's own locals
    if {U, O} & {h.group(k) for k in ("wire", "model", "body", "prov", "ovr", "clean", "ov2")} \
       or {U, O} & {m.group(k) for k in ("ser", "intent", "caps", "lv", "disp")} or {U, O} & set("abcdef"):
        return "ambiguous", t
    post = D_POST.replace("@O@", O).replace("@U@", U)
    call = "(" + ",".join([h.group("wire"), h.group("clean"), m.group("body"), m.group("caps"), m.group("lv"), m.group("intent")]) + ")"
    s0 = m.end() - len("),%s}" % m.group("ret"))   # right after the serializer call's `)`
    new = t[:s0 + 1] + "," + post + call + t[s0 + 1:]
    return "patched", new

# ---- E: keep reasoning_content on non-stream replies whose UPSTREAM is Ollama ------------------
# The shared finalizer deletes message.reasoning_content when content is present; on the Ollama
# route that field is the only place the trace exists. Exempts the Ollama upstream format only.
E_RX = R(r'\}\((?P<M>[\w$]+),(?P<up>[\w$]+),(?P<to>[\w$]+),(?P<G>[\w$]+)\):(?P=M),(?P<P>[\w$]+)=(?P=to)===(?P<d>[\w$]+)\.h\.CLAUDE&&(?P<O>[\w$]+)\?\.type==="message",'
         r'(?P<Q>[\w$]+)=(?P=to)===(?P=d)\.h\.OPENAI_RESPONSES&&(?P=O)\?\.object==="response";'
         r'(?P<mid>.{0,1500}?)if\((?P=O)\?\.usage&&\((?P=O)\.usage=(?P<usage>\(0,[\w$]+\.[\w$]+\)\(\(0,[\w$]+\.[\w$]+\)\((?P=O)\.usage\),(?P=to)\))\),'
         r'!(?P=P)&&!(?P=Q)&&(?P<exempt>(?:[\w$]+!==[\w$]+\.h\.OLLAMA&&)?)(?P=O)\?\.choices\)for\(let a of (?P=O)\.choices\)'
         r'a\?\.message\?\.reasoning_content&&a\.message\.content&&delete a\.message\.reasoning_content;', re.S)
def part_E(t):
    ms = list(E_RX.finditer(t))
    if not ms: return "absent", t
    if len(ms) != 1: return "ambiguous", t
    m = ms[0]
    if m.group("exempt"): return "applied", t
    pos = m.start("exempt")
    return "patched", t[:pos] + "%s!==%s.h.OLLAMA&&" % (m.group("up"), m.group("d")) + t[pos:]

# ---- F: non-stream openai->claude reads reasoning / reasoning_details like its stream twin ------
F_RX = R(r'(?P<g>[\w$]+)=(?P<c>[\w$]+)\.reasoning_content\|\|(?P=c)\.provider_specific_fields\?\.reasoning_content\|\|"";')
F_DONE = R(r'[\w$]+\.provider_specific_fields\?\.reasoning_content\|\|[\w$]+\.reasoning\|\|\(Array\.isArray\(')
def part_F(t):
    if F_DONE.search(t): return "applied", t
    m = _one(F_RX, t)
    if m is None: return "absent", t
    if m == "ambiguous": return m, t
    c = m.group("c")
    new = ('%s=%s.reasoning_content||%s.provider_specific_fields?.reasoning_content||%s.reasoning||'
           '(Array.isArray(%s.reasoning_details)?%s.reasoning_details.map(a=>"string"==typeof a?a:a?.text||a?.content||"").join(""):"")||"";'
           % (m.group("g"), c, c, c, c, c))
    return "patched", t[:m.start()] + new + t[m.end():]

# ---- EDIT X: undo v1's dead base-transport edit (no-op unless that exact v1 text is present) ----
X_STOCK = 'transformRequest(a,b,c,d){return b}shouldRetry(a,b){return a===d.gx.RATE_LIMITED&&b+1<this.getFallbackCount()}'
X_V1_PREFIX = 'transformRequest(a,b,c,d){if(this.provider?.startsWith?.("openai-compatible-")'
X_END = 'shouldRetry(a,b){return a===d.gx.RATE_LIMITED&&b+1<this.getFallbackCount()}'

# (name, function). Every part must resolve in >=1 file (applied or patched) or the guard FAILS:
# there is no fixed expected file count, because the number of chunks that carry a copy changes
# between releases (on 0.5.104 A patches 4 files, three server chunks plus one static chunk, and B patches 3).
PARTS = [
    ("A caps: glm-5.3-flash zai entry gains thinkingEffortSupported", part_A),
    ("B levels: low/high/max rules scoped to the real connections", part_B),
    ("C transport: OpenRouter reasoning envelope on the class that actually runs", part_C),
    ("D applier: native Ollama top-level think for every reasoning model", part_D),
    ("E response: keep reasoning_content on non-stream Ollama replies", part_E),
    ("F response: non-stream openai->claude reads reasoning/reasoning_details too", part_F),
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

def scan(source):
    """Run every part over every file; return per-part {state: [paths]} and the rewritten texts."""
    res = {n: {"applied": [], "patched": [], "ambiguous": []} for n, _ in PARTS}
    out_texts = {}
    for path, s in source.items():
        out = s
        for name, fn in PARTS:
            st, out = fn(out)
            if st != "absent": res[name][st].append(path)
        out_texts[path] = out
    return res, out_texts

res, new_texts = scan(texts)
to_write = {p: t for p, t in new_texts.items() if t != texts[p]}
x_revert = []
for p, t in list(new_texts.items()):
    i = t.find(X_V1_PREFIX); j = t.find(X_END, i) if i != -1 else -1
    if j != -1:
        x_revert.append(p)
        if not check: to_write[p] = t[:i] + X_STOCK + t[j + len(X_END):]

for name, _fn in PARTS:
    r = res[name]
    for p in r["patched"]:   say(f"  {'WOULD PATCH' if check else 'patching'} [{name}]: {rel(p)}")
    for p in r["applied"]:   say(f"  already applied [{name}]: {rel(p)}")
    for p in r["ambiguous"]: say(f"  AMBIGUOUS [{name}]: {rel(p)} anchor shape unexpected - NOT touched")
for p in x_revert:
    say(f"  {'WOULD REVERT' if check else 'reverting'} [X v1 dead base-transport edit -> stock]: {rel(p)}")

# Fail closed: a part that resolves in no file means the bundle layout changed under that anchor.
unresolved = [n for n, _ in PARTS if not (res[n]["applied"] or res[n]["patched"])]
if unresolved:
    print(f"FAIL: {len(unresolved)} GLM-5.3 part(s) located NO target anywhere under {build_dir}:")
    for n in unresolved: print(f"      - {n}")
    print("      The bundle layout changed. Re-derive the signature; do NOT assume success.")
    sys.exit(3)

if check:
    print(); print("CHECK MODE - nothing was written."); sys.exit(0)

failed = 0; patched = []
for path, new_text in to_write.items():
    backup = f"{path}.pre-glm53-thinking-{stamp}"
    shutil.copy2(path, backup)
    with open(path, "w", encoding="utf-8", errors="surrogateescape") as f: f.write(new_text)
    r = subprocess.run([node_bin, "--check", path], capture_output=True)
    if r.returncode != 0:
        shutil.copy2(backup, path)
        say(f"FAIL: node --check rejected {rel(path)} after patch - restored from {backup}")
        say(f"      stderr: {r.stderr.decode(errors='replace')[:500]}")
        failed += 1; continue
    patched.append(path)
    say(f"patched: {rel(path)}  (backup: {backup})")

if failed:
    print(f"\nFAILED: {failed} file(s) rejected by node --check and rolled back."); sys.exit(4)
if any(res[n]["ambiguous"] for n, _ in PARTS):
    print("\nWARNING: at least one anchor was ambiguous and that file was left untouched.")
    print("         The bundle shape changed since these signatures were derived - inspect by hand.")
    sys.exit(5)

say()
say(f"files patched: {len(patched)}   already-applied instances left alone: "
    f"{sum(len(res[n]['applied']) for n, _ in PARTS)}")
say()
# Read-back from disk: every part must show >=1 applied copy and ZERO copies still in stock form.
say("Post-patch read-back (re-read from disk):")
disk = {}
for p in all_files:
    try: disk[p] = open(p, encoding="utf-8", errors="surrogateescape").read()
    except OSError: continue
rb, _ = scan(disk)
bad = 0
for name, _fn in PARTS:
    n_app, n_pend = len(rb[name]["applied"]), len(rb[name]["patched"])
    say(f"  {name}: applied in {n_app} file(s), still-stock {n_pend}")
    if n_app == 0 or n_pend:
        print(f"WARNING: GLM-5.3 [{name}] reads back applied={n_app} still-stock={n_pend} from disk.")
        bad = 1
if bad: sys.exit(3)
say()
say("Verify behaviour: ~/.local/bin/9router-glm53-regression-check.sh")
say("Restart 9Router:  launchctl kickstart -k gui/$(id -u)/com.blackceo.9router-localhost")
sys.exit(0)
PY
exit $?
