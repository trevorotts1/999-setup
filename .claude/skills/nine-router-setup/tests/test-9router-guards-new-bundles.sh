#!/usr/bin/env bash
# Offline test (no npm, no network): the 9Router guards that exited 3/4 on 0.5.111 / 0.5.112 ("DeepSeek effort anchor not found",
# "Ollama anchor [[DONE] on flush] not found", "1 GLM-5.3 part(s) located NO target", "MISSING opencode-toolargs: failover guard / ollama
# overload / ollama nonstream claude / ollama stream error") now apply, or report "not needed (fixed upstream)", on VERBATIM excerpts of the
# published bundles in tests/fixtures/9router-bundles/{0.5.104,0.5.111,0.5.112}/ (see the README there). 0.5.104 is kept as the regression
# anchor: the guards must still apply on the shape they were written against.
# What the fixtures cannot show - the guards actually changing router behaviour - is covered by the guards' own offline regression suites
# (patches/*/regression*.cjs), which run against a whole bundle: `install-9router-guards.sh` runs them on every real apply.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
G="$HERE/../assets/guards"; TA="$G/patches/opencode-toolargs"; INST="$HERE/../scripts/macos/install-9router-guards.sh"; FX="$HERE/fixtures/9router-bundles"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export PYTHONDONTWRITEBYTECODE=1   # the appliers must not leave __pycache__ beside themselves in the repo
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "FAIL no node"; exit 2; }
PY=/usr/bin/python3; [ -x "$PY" ] || PY="$(command -v python3)"

# mkroot <name> <fixture file>...  -> prints a 9Router package dir whose chunks dir holds the fixtures as 7001.js, 7002.js, ...
mkroot() { local n="$1"; shift; local R="$T/$n/9router" C="$T/$n/9router/app/.next-cli-build/server/chunks" i=1 f
  mkdir -p "$C"; echo '{"name":"9router","version":"9.9.9"}' >"$R/package.json"
  for f in "$@"; do cp "$f" "$C/$((7000+i)).js"; i=$((i+1)); done; echo "$R"; }
chunk() { echo "$1/app/.next-cli-build/server/chunks/$2.js"; }
cks() { (cd "$1" && find . -type f | sort | xargs cksum); }   # files incl. any backup a guard writes
has() { grep -qF -- "$2" "$1"; }                                # has FILE 'literal text'
cnt() { grep -oF -- "$2" "$1" | wc -l | tr -d ' '; }

# ---- 1. deepseek-effort: patched on 0.5.104, "not needed (fixed upstream)" on 0.5.111/0.5.112, fail closed otherwise ---------------------
NEWMAP='"low"===a||"minimal"===a?"low":"max"===a||"ultra"===a?"max":"high"'
R="$(mkroot de104 "$FX/0.5.104/effort.js")"; E="$(chunk "$R" 7001)"
out="$(bash "$G/9router-deepseek-effort-guard.sh" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q '^9router-deepseek-effort: patched' && has "$E" "$NEWMAP" && ok "deepseek-effort 0.5.104: stock mapping patched (low/minimal -> low, max/ultra -> max)" || { bad "deepseek-effort 0.5.104 rc=$rc: $out"; }
"$NODE" --check "$E" 2>/dev/null && ok "deepseek-effort 0.5.104: patched file parses" || bad "deepseek-effort 0.5.104 syntax"
b1="$(cks "$T/de104")"; out="$(bash "$G/9router-deepseek-effort-guard.sh" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && echo "$out" | grep -q 'already applied' && [ "$b1" = "$(cks "$T/de104")" ] && ok "deepseek-effort 0.5.104: second run is a no-op" || bad "deepseek-effort 0.5.104 not idempotent rc=$rc"
bash "$INST" --check --root "$R" deepseek-effort >"$T/de104.chk" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q '^\[guards\] OK   deepseek-effort: DeepSeek effort tiers (1 hit, need 1)$' "$T/de104.chk" && ok "installer --check proves the patched 0.5.104 mapping" || { bad "installer --check patched 0.5.104 rc=$rc"; tail -3 "$T/de104.chk"; }
R="$(mkroot de104u "$FX/0.5.104/effort.js")"; bash "$INST" --check --root "$R" deepseek-effort >"$T/de104u.chk" 2>&1; rc=$?
[ $rc -eq 1 ] && grep -q 'MISSING deepseek-effort' "$T/de104u.chk" && ok "installer --check: an unpatched 0.5.104 mapping is MISSING (exit 1)" || bad "installer --check unpatched 0.5.104 rc=$rc"

for v in 0.5.111 0.5.112; do
  R="$(mkroot "de$v" "$FX/$v/effort.js")"; E="$(chunk "$R" 7001)"; b1="$(cks "$T/de$v")"
  out="$(bash "$G/9router-deepseek-effort-guard.sh" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'not needed (fixed upstream): 7001.js' && [ "$b1" = "$(cks "$T/de$v")" ] && ok "deepseek-effort $v: reported 'not needed (fixed upstream)', nothing written, no backup" || bad "deepseek-effort $v rc=$rc: $out"
  has "$E" '("low"===a||"minimal"===a)&&e?.includes("low")?"low":"high"' && ok "deepseek-effort $v: the upstream mapping really is in the bundle excerpt (low|minimal -> low when the model lists low)" || bad "deepseek-effort $v fixture lost the upstream mapping"
  bash "$INST" --check --root "$R" deepseek-effort >"$T/de$v.chk" 2>&1; rc=$?
  [ $rc -eq 0 ] && grep -q '^\[guards\] OK   deepseek-effort: DeepSeek effort tiers (1 hit, need 1) - not needed (fixed upstream)$' "$T/de$v.chk" && ok "installer --check $v: OK row says 'not needed (fixed upstream)'" || { bad "installer --check $v rc=$rc"; tail -3 "$T/de$v.chk"; }
done
# a bundle with neither the stock nor the upstream mapping must still fail closed
R="$(mkroot de-none "$FX/0.5.112/effort.js")"; E="$(chunk "$R" 7001)"; sed -i.orig 's/"minimal"===a)&&e/"minimaX"===a)\&\&e/' "$E"; rm -f "$E.orig"; b1="$(cks "$T/de-none")"
out="$(bash "$G/9router-deepseek-effort-guard.sh" "$R" 2>&1)"; rc=$?
[ $rc -eq 3 ] && echo "$out" | grep -q 'FAIL: DeepSeek effort anchor not found' && [ "$b1" = "$(cks "$T/de-none")" ] && ok "deepseek-effort: unknown mapping exits 3, writes nothing" || bad "deepseek-effort fail-closed rc=$rc"

# ---- 2. ollama-done and ollama-stream-error on the stream converter ------------------------------------------------------------------
# 0.5.104: encoder k, state C, provider p, log q, done flag N, formats e.   0.5.111 = 0.5.112: encoder n, state G, provider s, log t, done flag R, formats e.
for v in 0.5.104 0.5.112; do
  R="$(mkroot "cv$v" "$FX/$v/converter.js")"; E="$(chunk "$R" 7001)"; n="cv$v"
  if [ "$v" = 0.5.104 ]; then
    F1='M=!0,N=!0}if(!N&&("ollama"===p||"ollama-local"===p||c===e.h.OLLAMA)&&C.finishReason){let b="data: [DONE]\n\n";q?.appendConvertedChunk?.(b),a.enqueue(k.encode(b))}Q()}catch'
    F2='I++;if(a.choices?.[0]?.finish_reason){C.finishReason=a.choices[0].finish_reason;if(!N&&/^ollama\//i.test(v?.model||"")){N=!0;let __done="data: [DONE]\n\n";q?.appendConvertedChunk?.(__done),f.enqueue(k.encode(__done))}}}c===e.h.OPENAI'
    S1='let p=__oeSeen(C,(0,h.tV)(n,c),c);if(!p)continue;'; S2='let b=__oeSeen(C,(0,h.tV)(z.trim(),c),c),f=b?.done&&c!==e.h.OLLAMA;'; S3='__oeEnd(a,o,C,c,q,p,t);Q()}catch'
  else
    F1='Q=!0,R=!0}if(!R&&("ollama"===s||"ollama-local"===s||c===e.h.OLLAMA)&&G.finishReason){let b="data: [DONE]\n\n";t?.appendConvertedChunk?.(b),a.enqueue(n.encode(b))}V()}catch'
    F2='M++;if(a.choices?.[0]?.finish_reason){G.finishReason=a.choices[0].finish_reason;if(!R&&/^ollama\//i.test(y?.model||"")){R=!0;let __done="data: [DONE]\n\n";t?.appendConvertedChunk?.(__done),f.enqueue(n.encode(__done))}}}c===e.h.OPENAI'
    S1='let q=__oeSeen(G,(0,j.tV)(h,c),c);if(!q)continue;'; S2='let b=__oeSeen(G,(0,j.tV)(C.trim(),c),c),f=b?.done&&c!==e.h.OLLAMA;'; S3='__oeEnd(a,r,G,c,t,s,w);V()}catch'
  fi
  b0="$(cks "$T/$n")"; out="$(bash "$G/9router-ollama-done-guard.sh" --check "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'WOULD PATCH \[\[DONE\] on flush\]' && echo "$out" | grep -q 'WOULD PATCH \[finish_reason capture\]' && [ "$b0" = "$(cks "$T/$n")" ] && ok "ollama-done $v: --check reports both edits and writes nothing" || bad "ollama-done $v --check rc=$rc: $out"
  out="$(bash "$G/9router-ollama-done-guard.sh" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'patched \[\[DONE\] on flush\]' && echo "$out" | grep -q 'patched \[finish_reason capture\]' && ok "ollama-done $v: both edits located and applied" || { bad "ollama-done $v rc=$rc: $out"; }
  has "$E" "$F1" && ok "ollama-done $v: [DONE]-on-flush text uses this build's locals" || bad "ollama-done $v flush text"
  has "$E" "$F2" && ok "ollama-done $v: finish_reason capture text uses this build's locals" || bad "ollama-done $v capture text"
  "$NODE" --check "$E" 2>/dev/null && ok "ollama-done $v: patched file parses" || bad "ollama-done $v syntax"
  bash "$INST" --check --root "$R" ollama-done >"$T/$n.chk" 2>&1; rc=$?
  [ $rc -eq 0 ] && grep -q '^\[guards\] OK   ollama-done: Ollama \[DONE\] capture (1 hit, need 1)$' "$T/$n.chk" && ok "installer --check proves the Ollama [DONE] capture on $v" || bad "installer --check ollama-done $v rc=$rc"
  b1="$(cks "$T/$n")"; out="$(bash "$G/9router-ollama-done-guard.sh" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && [ "$(echo "$out" | grep -c 'already applied')" = 2 ] && [ "$b1" = "$(cks "$T/$n")" ] && ok "ollama-done $v: second run is a no-op" || bad "ollama-done $v not idempotent rc=$rc"

  out="$("$PY" "$TA/ollama-stream-error-apply.py" --check "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'all 4 anchors unique' && ok "stream-error $v: all 4 anchors unique (--check)" || bad "stream-error $v --check rc=$rc: $out"
  out="$("$PY" "$TA/ollama-stream-error-apply.py" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q '^patched ' && ok "stream-error $v: applied" || { bad "stream-error $v rc=$rc: $out"; }
  has "$E" '/*ollama-stream-error-v1*/' && has "$E" "$S1" && has "$E" "$S2" && has "$E" "$S3" && ok "stream-error $v: line parse, flush leftover and flush end use this build's locals" || bad "stream-error $v text"
  "$NODE" --check "$E" 2>/dev/null && ok "stream-error $v: patched file parses" || bad "stream-error $v syntax"
  bash "$INST" --check --root "$R" ollama-done >"$T/$n.chk2" 2>&1; rc=$?
  [ $rc -eq 0 ] && ok "ollama-done proof still holds after stream-error ($v)" || bad "ollama-done proof after stream-error $v"
  b1="$(cks "$T/$n")"; out="$("$PY" "$TA/ollama-stream-error-apply.py" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'already patched' && [ "$b1" = "$(cks "$T/$n")" ] && ok "stream-error $v: second run is a no-op" || bad "stream-error $v not idempotent rc=$rc"

  # fail closed: a converter whose header or flush no longer has the known shape is refused with nothing written
  R2="$(mkroot "${n}x" "$FX/$v/converter.js")"; E2="$(chunk "$R2" 7001)"; sed -i.orig 's/new TextEncoder,/new TextEncodex,/' "$E2"; rm -f "$E2.orig"; b2="$(cks "$T/${n}x")"
  out="$(bash "$G/9router-ollama-done-guard.sh" "$R2" 2>&1)"; rc=$?
  [ $rc -eq 3 ] && echo "$out" | grep -q 'FAIL: Ollama anchor' && [ "$b2" = "$(cks "$T/${n}x")" ] && ok "ollama-done $v: unrecognised converter header exits 3, writes nothing" || bad "ollama-done $v fail-closed rc=$rc"
  out="$("$PY" "$TA/ollama-stream-error-apply.py" "$R2" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && [ "$b2" = "$(cks "$T/${n}x")" ] && ok "stream-error $v: unrecognised converter header exits 2, writes nothing" || bad "stream-error $v fail-closed rc=$rc"
  R3="$(mkroot "${n}y" "$FX/$v/converter.js")"; E3="$(chunk "$R3" 7001)"; sed -i.orig 's/console.log("Error in flush:"/console.log("Flush error:"/' "$E3"; rm -f "$E3.orig"; b3="$(cks "$T/${n}y")"
  out="$("$PY" "$TA/ollama-stream-error-apply.py" "$R3" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && echo "$out" | grep -q 'ANCHOR 4' && [ "$b3" = "$(cks "$T/${n}y")" ] && ok "stream-error $v: missing flush-end anchor exits 2 naming it, writes nothing" || bad "stream-error $v anchor-4 rc=$rc: $out"
done

# ---- 3. failover guard + ollama-overload guard on the combo module (and the non-stream translator for part B) --------------------------
for v in 0.5.104 0.5.112; do
  n="cb$v"; R="$(mkroot "$n" "$FX/$v/combo.js" "$FX/$v/resolver.js" "$FX/$v/nonstream.js")"; E="$(chunk "$R" 7001)"; NS="$(chunk "$R" 7003)"
  if [ "$v" = 0.5.104 ]; then
    HEAD='for(let b=0;b<o.length;b++){let e=o[b],__fgi=b,__fgb=a,__fgc=c,__fgl=g;'; LST='o'; FN='q'; NRET=1
    FG1='succeeded`),__fgi<o.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,o,__fgi,f,__fgc,__fgl):f'
    OG1='succeeded`),__fgi<o.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,o,__fgi,f,__fgc,__fgl):__fgi<o.length-1&&await __ogOn(e)?await __ogRun(__fgb,o,__fgi,f,__fgc,__fgl):f'
  else
    HEAD='for(let b=0;b<r.length;b++){let e=r[b],__fgi=b,__fgb=a,__fgc=c,__fgl=h;'; LST='r'; FN='G'; NRET=2
    FG1='succeeded`),__fgi<r.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,r,__fgi,f,__fgc,__fgl):f'
    FG2='succeeded${a.timedOut?" (peek deadline; committed)":""}`),__fgi<r.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,r,__fgi,a.response,__fgc,__fgl):a.response'
    OG1='succeeded`),__fgi<r.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,r,__fgi,f,__fgc,__fgl):__fgi<r.length-1&&await __ogOn(e)?await __ogRun(__fgb,r,__fgi,f,__fgc,__fgl):f'
    OG2='(peek deadline; committed)":""}`),__fgi<r.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,r,__fgi,a.response,__fgc,__fgl):__fgi<r.length-1&&await __ogOn(e)?await __ogRun(__fgb,r,__fgi,a.response,__fgc,__fgl):a.response'
  fi
  out="$("$PY" "$TA/failover-guard-apply.py" --check "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q 'all anchors unique' && ok "failover $v: combo signature, loop head, success return(s) and resolver module all located (--check)" || bad "failover $v --check rc=$rc: $out"
  out="$("$PY" "$TA/ollama-overload-guard-apply.py" "$R" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && echo "$out" | grep -q 'lacks /\*failover-guard-v2\*/' && ok "ollama-overload $v: refuses until the failover guard is in (exit 2)" || bad "ollama-overload $v order rc=$rc: $out"
  out="$("$PY" "$TA/failover-guard-apply.py" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && echo "$out" | grep -q '^patched ' && ok "failover $v: applied" || { bad "failover $v rc=$rc: $out"; }
  has "$E" "$HEAD" && ok "failover $v: loop head keeps the index and copies of the body, handler and log (immune to the shadowing in 0.5.109+)" || bad "failover $v loop head"
  has "$E" "$FG1" && ok "failover $v: plain success return validated" || bad "failover $v success return"
  [ "$v" = 0.5.104 ] || { has "$E" "$FG2" && ok "failover $v: the committed-after-peek success return is validated too" || bad "failover $v peek return"; }
  [ "$(cnt "$E" 'await __fgRun(')" = "$NRET" ] && [ "$(cnt "$E" '/*failover-guard-v2*/')" = 1 ] && ok "failover $v: $NRET validated return(s), helpers injected once" || bad "failover $v counts: $(cnt "$E" 'await __fgRun(') $(cnt "$E" '/*failover-guard-v2*/')"
  has "$E" 'async function __fgOn(m){try{return __fgIds.has((await c(38775).mA(m))?.provider)}catch{return!1}}' && ok "failover $v: provider check calls the router's own resolver through the module's webpack require" || bad "failover $v resolver call"
  out="$("$PY" "$TA/ollama-overload-guard-apply.py" "$R" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && [ "$(echo "$out" | grep -c '^patched ')" = 2 ] && ok "ollama-overload $v: combo loop (A) and non-stream translator (B) applied" || { bad "ollama-overload $v rc=$rc: $out"; }
  has "$E" "$OG1" && ok "ollama-overload $v: hook chained after the failover hook" || bad "ollama-overload $v hook"
  [ "$v" = 0.5.104 ] || { has "$E" "$OG2" && ok "ollama-overload $v: the committed-after-peek return is chained too" || bad "ollama-overload $v peek hook"; }
  [ "$(cnt "$E" 'await __ogRun(')" = "$NRET" ] && has "$E" "x=await $FN({body:a,models:o.slice(i+1)" && ok "ollama-overload $v: re-enters the combo function by its own name ($FN)" || bad "ollama-overload $v recursion name"
  has "$NS" '/*ollama-nonstream-claude-v1*/' && ok "ollama-overload $v: non-stream Claude translation marker present" || bad "ollama-overload $v part B"
  for f in "$E" "$NS"; do "$NODE" --check "$f" 2>/dev/null || bad "node --check $f"; done; ok "failover/ollama-overload $v: patched chunks parse"
  bash "$INST" --check --root "$R" opencode-toolargs >"$T/$n.chk" 2>&1
  for m in 'failover guard' 'ollama overload' 'ollama nonstream claude'; do grep -q "^\[guards\] OK   opencode-toolargs: $m (1 hit, need 1)$" "$T/$n.chk" && ok "installer --check proves '$m' on $v" || bad "installer --check '$m' $v"; done
  b1="$(cks "$T/$n")"; "$PY" "$TA/failover-guard-apply.py" "$R" >/dev/null 2>&1; r1=$?; "$PY" "$TA/ollama-overload-guard-apply.py" "$R" >/dev/null 2>&1; r2=$?
  [ $r1 -eq 0 ] && [ $r2 -eq 0 ] && [ "$b1" = "$(cks "$T/$n")" ] && ok "failover/ollama-overload $v: second run is a no-op" || bad "failover/ollama-overload $v not idempotent ($r1/$r2)"

  # fail closed
  R2="$(mkroot "${n}x" "$FX/$v/combo.js" "$FX/$v/nonstream.js")"; b2="$(cks "$T/${n}x")"   # no resolver module
  out="$("$PY" "$TA/failover-guard-apply.py" "$R2" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && echo "$out" | grep -q 'model resolver module 38775' && [ "$b2" = "$(cks "$T/${n}x")" ] && ok "failover $v: without the resolver module it refuses (a guard that can never fire is not applied)" || bad "failover $v resolver check rc=$rc: $out"
  R3="$(mkroot "${n}y" "$FX/$v/combo.js" "$FX/$v/resolver.js" "$FX/$v/nonstream.js")"; E3="$(chunk "$R3" 7001)"
  sed -i.orig "s/let e=$LST\[b\];/let e=$LST.at(b);/" "$E3"; rm -f "$E3.orig"; b3="$(cks "$T/${n}y")"
  out="$("$PY" "$TA/failover-guard-apply.py" "$R3" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && echo "$out" | grep -q 'ANCHOR 2a' && [ "$b3" = "$(cks "$T/${n}y")" ] && ok "failover $v: unmatched loop head exits 2 naming it, writes nothing" || bad "failover $v loop-head rc=$rc: $out"
  R4="$(mkroot "${n}z" "$FX/$v/combo.js" "$FX/$v/resolver.js" "$FX/$v/nonstream.js")"; E4="$(chunk "$R4" 7001)"
  sed -i.orig 's/handleSingleModel:c,log:/handleSingleModel:c,logger:/' "$E4"; rm -f "$E4.orig"; b4="$(cks "$T/${n}z")"
  out="$("$PY" "$TA/failover-guard-apply.py" "$R4" 2>&1)"; rc=$?
  [ $rc -eq 2 ] && [ "$b4" = "$(cks "$T/${n}z")" ] && ok "failover $v: unrecognised combo signature exits 2, writes nothing" || bad "failover $v signature rc=$rc: $out"
done

# ---- 4. GLM 5.3 part D (the applier post-pass): six-argument serializer call up to 0.5.111, seven from 0.5.112 ------------------------
for v in 0.5.104 0.5.111 0.5.112; do
  R="$(mkroot "gl$v" "$FX/$v/serializer.js")"; b0="$(cks "$T/gl$v")"
  out="$(bash "$G/9router-glm53-thinking-guard.sh" --check "$R" 2>&1)"; rc=$?
  # this excerpt carries only part D; A, B, C, E, F have no target here, so the guard fails closed (exit 3) - what matters is that D is NOT in that list
  echo "$out" | grep -q 'WOULD PATCH \[D applier: native Ollama top-level think for every reasoning model\]' && ! echo "$out" | grep -q -- '- D applier' && [ $rc -eq 3 ] && [ "$b0" = "$(cks "$T/gl$v")" ] \
    && ok "glm53 D applier $v: located (WOULD PATCH), not among the unresolved parts" || { bad "glm53 D applier $v rc=$rc"; echo "$out" | tail -8; }
done
R="$(mkroot glx "$FX/0.5.112/serializer.js")"; E="$(chunk "$R" 7001)"; sed -i.orig 's/,A,B,r),c}/,A,B,r,r),c}/' "$E"; rm -f "$E.orig"   # an eight-argument call is a shape nobody has seen
out="$(bash "$G/9router-glm53-thinking-guard.sh" --check "$R" 2>&1)"; echo "$out" | grep -q -- '- D applier' && ok "glm53 D applier: an unknown call shape is still reported unresolved" || bad "glm53 D applier did not fail closed on an unknown call shape"

# ---- 5. the regression loader finds a renumbered module by its exports, and refuses an ambiguous or missing one -------------------------
mkdir -p "$T/ld/9router/app/.next-cli-build/server/chunks"
cat >"$T/ld/9router/app/.next-cli-build/server/chunks/1.js" <<'JS'
exports.id=1;exports.ids=[1];exports.modules={82380:(a,b,c)=>{c.d(b,{Ws:()=>x,Ai:()=>y,Y8:()=>z,GH:()=>w})},55456:(a,b,c)=>{c.d(b,{Y8:()=>q,Xh:()=>l})}};
JS
res="$(cd "$T/ld" && "$NODE" -e "
process.argv[2]='$T/ld/9router'; const {req}=require('$TA/regression.cjs');
const id=req.find('Ws:()=>','Ai:()=>','Y8:()=>','GH:()=>'); let amb='no error'; try{ req.find('Y8:()=>'); }catch(e){ amb=e.message; } let none='no error'; try{ req.find('Zz:()=>'); }catch(e){ none=e.message; }
console.log(id+'|'+amb+'|'+none);")"
[ "$res" = "82380|module with exports Y8:()=> matched 2 times (need 1)|module with exports Zz:()=> matched 0 times (need 1)" ] && ok "regression loader: find() resolves a renumbered module by its exports; ambiguous and missing both throw" || bad "regression loader find(): $res"

exit $fail
