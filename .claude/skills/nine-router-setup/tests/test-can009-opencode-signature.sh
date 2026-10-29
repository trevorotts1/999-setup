#!/usr/bin/env bash
# CAN009 regression check (offline, no npm, no network): the opencode-poll guard and the opencode-toolargs
# failover / ollama-overload parts must locate their targets by CONTENT SIGNATURE in a bundle whose chunk files are
# renumbered and whose minified locals are renamed (shapes copied from 9Router 0.5.104), apply idempotently, and
# FAIL CLOSED when an anchor is missing. On the pre-fix guards (fixed anchor strings) step 1 fails with
# "5 of 11 ... anchors were not found" and steps 2-3 exit 2, exactly what a fresh 0.5.104 install hit.
# The live-bundle proof is tests/test-9router-guards.sh 0.5.104.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
G="$HERE/../assets/guards"; TA="$G/patches/opencode-toolargs"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

mkfix() { local R="$1" C="$1/app/.next-cli-build/server/chunks"; mkdir -p "$C"; echo '{"name":"9router","version":"9.9.9"}' >"$R/package.json"
# opencode header builder (0.5.104 renamed the raw-header local e -> f); chunk id differs from any real build.
cat >"$C/7311.js" <<'JS'
exports.hb=function(f,b,c){let j={"Content-Type":"application/json",Authorization:"Bearer public","x-opencode-project":f["x-opencode-project"]||"global",Accept:b?"text/event-stream":"*/*"};return c.endsWith("/messages")&&(j["anthropic-version"]=1),j};
JS
# Responses aggregator + non-stream builder, locals renamed again (g->q, h->w, E/H->Z, b->y).
cat >"$C/7312.js" <<'JS'
function d(a,y){let c=JSON.parse(a),f=c.type;"response.output_item.done"===f?y.items.set(c.output_index??0,c.item):"response.completed"===f||"response.done"===f?(y.status="completed",c.response?.usage&&(y.usage.input_tokens=c.response.usage.input_tokens||0,y.usage.output_tokens=c.response.usage.output_tokens||0,y.usage.total_tokens=c.response.usage.total_tokens||0)):"response.failed"===f&&(y.status="failed")}
let e={input_tokens:0,output_tokens:0,total_tokens:0};
async function f(a){let b=a.getReader(),c=new TextDecoder,f="",q={responseId:"",created:Math.floor(Date.now()/1e3),status:"in_progress",usage:{...e},items:new Map};try{for(;;){let{done:a,value:e}=await b.read();if(a)break;d(c.decode(e),q)}}finally{b.releaseLock()}let w=[],i=q.items.size>0?Math.max(...q.items.keys()):-1;for(let a=0;a<=i;a++)w.push(q.items.get(a)||{type:"message",content:[],role:"assistant"});return{id:q.responseId,object:"response",created_at:q.created,status:q.status||"completed",output:w,usage:q.usage}}
function ns(w,p,Z,j){let r={success:!0,finish_reason:w.status||"unknown"},c;if(j===1)c={response:{candidates:[{content:{role:"model",parts:[{text:p||""}]},finishReason:"STOP",index:0}]}};else{let a={role:"assistant",content:p||(Z?null:"")};let y="completed"===w.status||"done"===w.status,d=Z?"tool_calls":y?"stop":w.status||"stop";c=d}return c}
JS
# combo loop (0.5.104: reply local b->f, success return wrapped in a block); the non-stream translator tail lives in
# its own chunk, as in the real bundle (8910 vs 8895).
cat >"$C/7313.js" <<'JS'
exports.modules={18910:(a,b,c)=>{c.d(b,{Pr:()=>q});async function q({body:a,models:b,handleSingleModel:c,log:g,comboName:i,comboStrategy:j,comboStickyLimit:k=1,autoSwitch:m=!0}){let o=b,p=null,r=null,s=null;for(let n=0;n<o.length;n++){let e=o[n];g.info("COMBO",`Trying model ${n+1}/${o.length}: ${e}`);try{let x=await c(a,e);if(x.ok){if(n!==o.length-1&&(x.headers?.get?.("content-type")||"").includes("application/json"))try{let a=await x.clone().json();if(!a)continue}catch{}return g.info("COMBO",`Model ${e} succeeded`),x}p="failed"}catch(a){p=a.message}}return new Response("all failed")}}};
JS
# The router's own model resolver, which the failover and ollama guards call (module 38775 export mA, verbatim from 0.5.104).
# The guards refuse to patch a bundle without it: their provider check would otherwise swallow the error and never fire.
cat >"$C/7315.js" <<'JS'
exports.modules={38775:(a,b,c)=>{c.d(b,{d_:()=>j,mA:()=>i});var d=c(89718),e=c(40669),f=c(61892);let g={xmtp:"xiaomi-tokenplan","xiaomi-tokenplan":"xiaomi-tokenplan"},h=new Set(Object.keys(g));for(let a of f.default)for(let b of(h.add(a.id),a.alias&&h.add(a.alias),a.aliases||[]))h.add(b);async function i(a){let b,c=(b=(0,e.Xh)(a),b?.providerAlias&&g[b.providerAlias]?{...b,provider:g[b.providerAlias]}:b);if(!c.isAlias){if(!h.has(c.providerAlias)){let a=(await (0,d.Fh)({type:"openai-compatible"})).find(a=>a.prefix===c.providerAlias);if(a)return{provider:a.id,model:c.model}}return{provider:c.provider,model:c.model}}return await (0,d.Dj)(c.model)?{provider:null,model:c.model}:(0,e.js)(a,d.OM)}async function j(a){if(a.includes("/"))return null;let b=await (0,d.Dj)(a);return b&&b.models&&b.models.length>0?b.models:null}}};
JS
cat >"$C/7314.js" <<'JS'
function fin(M,u,t,G,D,T,w){let O=(0,w.nZ)(u,t)?function(a,b,c,e=null){if(b===c)return a;return b===D.h.OLLAMA?(0,T._)(a):a}(M,u,t,G):M;return O}
JS
}
R="$T/pkg/9router"; C="$R/app/.next-cli-build/server/chunks"; mkfix "$R"
snap() { (cd "$R" && find . -name '*.js' | sort | xargs cksum); }
NODE="$(command -v node)"; PY=/usr/bin/python3; [ -x "$PY" ] || PY="$(command -v python3)"

# 1. opencode-poll: all nine edits located and applied on the renumbered + renamed bundle
out="$(bash "$G/9router-opencode-poll-guard.sh" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "poll guard exits 0 on renumbered+renamed bundle" || { bad "poll guard rc=$rc"; echo "$out" | tail -8; }
for n in 1 2 3 4 5 6 7 8 9; do echo "$out" | grep -q "patching \[EDIT$n " && ok "poll EDIT$n located and patched" || bad "poll EDIT$n not patched"; done
grep -q '"x-opencode-project":f\["x-opencode-project"\]||"global",Accept:"text/event-stream"}' "$C/7311.js" && ok "EDIT1 kept the captured header local (f)" || bad "EDIT1 body"
grep -q 'd="incomplete"===w.status&&"max_output_tokens"===w.incomplete_details?.reason?"length":Z?"tool_calls"' "$C/7312.js" && ok "EDIT6 used the captured status/tool-call locals (w, Z)" || bad "EDIT6 body"
grep -q 'finishReason:"incomplete"===w.status?"MAX_TOKENS":"STOP"' "$C/7312.js" && ok "EDIT7 took the status local (w) from its context anchor" || bad "EDIT7 body"
grep -q 'if("completed"!==q.status&&' "$C/7312.js" && ok "EDIT9 bound to the aggregator local (q)" || bad "EDIT9 body"
for f in "$C"/7311.js "$C"/7312.js; do "$NODE" --check "$f" 2>/dev/null || bad "node --check $f"; done

# 2. failover guard (toolargs part 2) on the 0.5.104 loop shape
out="$("$PY" "$TA/failover-guard-apply.py" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "failover guard exits 0 on the 0.5.104 loop shape" || { bad "failover rc=$rc: $(echo "$out" | head -2)"; }
grep -q 'let e=o\[n\],__fgi=n,__fgb=a,__fgc=c,__fgl=g;' "$C/7313.js" && grep -q 'succeeded`),__fgi<o.length-1&&__fgTools(__fgb)&&await __fgOn(e)?await __fgRun(__fgb,o,__fgi,x,__fgc,__fgl):x}' "$C/7313.js" && ok "failover hook uses the captured loop/reply locals (n, x) and the loop-head copies of body/handler/log" || bad "failover body"

# 3. ollama overload guard (toolargs part 3: loop hook + non-stream Claude translator)
out="$("$PY" "$TA/ollama-overload-guard-apply.py" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "ollama overload guard exits 0 (loop hook + non-stream translator)" || { bad "ollama rc=$rc: $(echo "$out" | head -2)"; }
grep -q ':__fgi<o.length-1&&await __ogOn(e)?await __ogRun(__fgb,o,__fgi,x,__fgc,__fgl):x}' "$C/7313.js" && ok "ollama loop hook follows the failover hook with the captured reply local (x)" || bad "ollama loop body"
grep -q '/\*ollama-nonstream-claude-v1\*/return b===D.h.OLLAMA?(c===D.h.OPENAI?(0,T._)(a):__ogNs((0,T._)(a),D.h.OPENAI,c,e)):a}(M,u,t,G):M' "$C/7314.js" && grep -q 'function __ogNs(a,b,c,e=null)' "$C/7314.js" && ok "ollama non-stream part kept the captured module aliases (D, T)" || bad "ollama non-stream body"
for f in "$C"/7313.js "$C"/7314.js; do "$NODE" --check "$f" 2>/dev/null || bad "node --check $f"; done; ok "node --check on the patched combo chunks"

# 4. idempotent: second runs change nothing
s1="$(snap)"
bash "$G/9router-opencode-poll-guard.sh" --quiet "$R" >/dev/null 2>&1; r1=$?
"$PY" "$TA/failover-guard-apply.py" "$R" >/dev/null 2>&1; r2=$?
"$PY" "$TA/ollama-overload-guard-apply.py" "$R" >/dev/null 2>&1; r3=$?
[ $r1 -eq 0 ] && [ $r2 -eq 0 ] && [ $r3 -eq 0 ] && [ "$s1" = "$(snap)" ] && ok "second run of all three is a byte-identical no-op" || bad "not idempotent (rc=$r1/$r2/$r3)"

# 5. fail closed: a missing anchor exits non-zero and writes nothing
cks() { (cd "$1" && find . -name '*.js' | sort | xargs cksum); }
R4="$T/pkg4/9router"; C4="$R4/app/.next-cli-build/server/chunks"; mkfix "$R4"
# (a) poll: one aggregator anchor gone -> exit 3
sed -i.orig 's/items:new Map}/items:new Mop}/' "$C4/7312.js"; rm -f "$C4"/*.orig; b2="$(cks "$R4")"
bash "$G/9router-opencode-poll-guard.sh" "$R4" >"$T/f1.out" 2>&1; rc=$?
[ $rc -eq 3 ] && grep -q "MISSING: EDIT2" "$T/f1.out" && ok "poll: a missing anchor exits 3 (never reported as success)" || { bad "poll fail-closed rc=$rc"; tail -4 "$T/f1.out"; }
[ "$b2" = "$(cks "$R4")" ] && ok "poll: nothing written when an anchor is missing" || bad "poll wrote despite a missing anchor"
# (b) combo loop head gone -> failover exits 2, ollama refuses; nothing written
R5="$T/pkg5/9router"; C5="$R5/app/.next-cli-build/server/chunks"; mkfix "$R5"
sed -i.orig 's/let e=o\[n\];/let e=o.at(n);/' "$C5/7313.js"; rm -f "$C5"/*.orig; b3="$(cks "$R5")"
"$PY" "$TA/failover-guard-apply.py" "$R5" >"$T/f2.out" 2>&1; rc=$?
[ $rc -eq 2 ] && grep -q "ANCHOR 2a" "$T/f2.out" && ok "failover: unmatched loop head exits 2" || { bad "failover fail-closed rc=$rc"; tail -2 "$T/f2.out"; }
"$PY" "$TA/ollama-overload-guard-apply.py" "$R5" >"$T/f3.out" 2>&1; rc=$?
[ $rc -eq 2 ] && ok "ollama overload: refuses without the failover guard (exit 2)" || bad "ollama fail-closed rc=$rc"
[ "$b3" = "$(cks "$R5")" ] && ok "failover/ollama: nothing written when an anchor is missing" || bad "wrote despite a missing anchor"

# 6. installer --check proves EDIT6/EDIT7, not just EDIT2: a bundle with EDIT2 present and EDIT7 reverted must read MISSING (exit 1)
INST="$HERE/../scripts/macos/install-9router-guards.sh"
bash "$INST" --check --root "$R" opencode-poll >"$T/c1.out" 2>&1; rc=$?
[ $rc -eq 0 ] && [ "$(grep -c '^\[guards\] OK   opencode-poll' "$T/c1.out")" = 3 ] && ok "installer --check: patched bundle shows 3 OK opencode-poll rows" || { bad "installer --check patched rc=$rc"; tail -5 "$T/c1.out"; }
sed -i.orig 's/finishReason:"incomplete"===w.status?"MAX_TOKENS":"STOP"/finishReason:"STOP"/' "$C/7312.js"; rm -f "$C"/*.orig
bash "$INST" --check --root "$R" opencode-poll >"$T/c2.out" 2>&1; rc=$?
[ $rc -eq 1 ] && grep -q 'MISSING opencode-poll: oc non-stream MAX_TOKENS' "$T/c2.out" && ok "installer --check: EDIT7 missing (EDIT2 present) is MISSING, exit 1" || { bad "installer --check EDIT7 rc=$rc"; tail -5 "$T/c2.out"; }
exit $fail
