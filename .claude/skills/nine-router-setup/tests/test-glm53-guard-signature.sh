#!/usr/bin/env bash
# CAN002 regression check (offline, no npm, no network): the GLM 5.3 guard must find parts A-F by CONTENT
# SIGNATURE in a bundle whose chunk files are renumbered and whose minified locals are renamed, apply them
# idempotently, FAIL CLOSED when a part resolves 0 files, and the installer must auto-detect the 9Router
# package from a prefix, node_modules or ~/.9router --root (any other non-package --root must exit 2). On the pre-fix guard (fixed anchor strings) step 1 fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/../assets/guards/9router-glm53-thinking-guard.sh"
INST="$HERE/../scripts/macos/install-9router-guards.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }

# ---- fixture: shapes copied from 9Router 0.5.104, chunk ids and minified locals deliberately different ----
R="$T/pkg/9router"; C="$R/app/.next-cli-build/server/chunks"; mkdir -p "$C"; echo '{"name":"9router","version":"9.9.9"}' >"$R/package.json"
cat >"$C/7001.js" <<'JS'
exports.A={"glm-5.3-flash":{vision:!0,videoInput:!0,pdf:!0,reasoning:!0,thinkingFormat:"zai",thinkingCanDisable:!1,contextWindow:1e6,maxOutput:131072},"x":{thinkingFormat:"openai"}};
exports.B=[{provider:"codebuddy-cn",pattern:"glm-5.3",levels:["low","high","max"]},{provider:"codebuddy-cn",pattern:"glm-5.3-flash",levels:["low","high","max"]},{provider:"codebuddy-cn",pattern:"glm-5.2",levels:["high","xhigh"]}];
JS
cat >"$C/7002.js" <<'JS'
class Q{transformRequest(m,n,o,p){let z=this.applyJsonSchemaFallback(this.applyNousAttribution(m,n,o,p));return z&&"object"==typeof z&&(this.config.quirks?.dropClientMetadata&&delete z.client_metadata,(0,s.q)(this.provider,m,z)),(0,r.W)({provider:this.provider,model:m,body:z})}}
JS
cat >"$C/7003.js" <<'JS'
function lvl(a){return"level"===a.mode?a.level:"budget"===a.mode?1:null}function wipe(a){delete a.thinking}
function apply(w,m,body,prov=null,ovr){if(!body||"object"!=typeof body)return body;let{cleanModel:cm,override:ov}=j(m),it=ov||ovr,cp={},fm=1,lv=[],dp=1;return wipe(body),!function(a,b,c,d,e,f){switch(a){case"commandcode":{let a=lvl(k);a&&(b.params.reasoning_effort=a)}}}(fm,body,it,cp,lv,dp),body}
JS
cat >"$C/7004.js" <<'JS'
function fin(X,s,q,Z,d,h){let Y=1?function(a,b,c,d){return a}(X,s,q,Z):X,R=q===d.h.CLAUDE&&Y?.type==="message",S=q===d.h.OPENAI_RESPONSES&&Y?.object==="response";if(Y?.usage&&(Y.usage=(0,h.WL)((0,h.O9)(Y.usage),q)),!R&&!S&&Y?.choices)for(let a of Y.choices)a?.message?.reasoning_content&&a.message.content&&delete a.message.reasoning_content;return Y}
function cv(b){let a=b.choices[0],c=b.message||{},g=[],k=c.reasoning_content||c.provider_specific_fields?.reasoning_content||"";return k}
JS
snap() { (cd "$R" && find . -name '*.js' | sort | xargs cksum); }

# 1. signature-located apply on the renumbered/renamed bundle
out="$(bash "$GUARD" "$R" 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "guard exits 0 on renumbered+renamed bundle" || { bad "guard rc=$rc"; echo "$out" | tail -8; }
for p in A B C D E F; do echo "$out" | grep -q "patching \[$p " && ok "part $p located and patched" || bad "part $p not patched"; done
grep -q 'thinkingEffortSupported:!0,contextWindow' "$C/7001.js" && grep -q '"zai",thinkingCanDisable:!1,thinkingEffortSupported' "$C/7001.js" && ok "A keeps upstream thinkingCanDisable, adds the flag" || bad "A body"
grep -q 'pattern:"glm-5.2"' "$C/7001.js" && grep -q '{provider:"ollama-local",pattern:"\*glm-5.3\*"' "$C/7001.js" && ok "B scoped rules inserted after the codebuddy glm-5.3 rules" || bad "B body"
grep -q ')(Y.usage' "$C/7004.js"; grep -q '!R&&!S&&s!==d.h.OLLAMA&&Y?.choices' "$C/7004.js" && ok "E used the captured upstream-format local (s), not a guessed name" || bad "E body"
grep -q 'wipe(c);if("none"===f.mode)' "$C/7003.js" && grep -q '(w,cm,body,cp,lv,it),body}' "$C/7003.js" && ok "D bound to the captured applier locals and strip helper" || bad "D body"
grep -q 'k=c.reasoning_content||c.provider_specific_fields?.reasoning_content||c.reasoning||' "$C/7004.js" && ok "F kept the captured local (k)" || bad "F body"
for f in "$C"/*.js; do node --check "$f" 2>/dev/null || bad "node --check $f"; done

# 2. idempotent: a second run changes nothing
s1="$(snap)"; bash "$GUARD" --quiet "$R" >/dev/null 2>&1; rc=$?; [ $rc -eq 0 ] && [ "$s1" = "$(snap)" ] && ok "second run is a byte-identical no-op" || bad "not idempotent (rc=$rc)"

# 3. fail closed: a part that resolves 0 files must fail and write nothing
R2="$T/pkg2/9router"; mkdir -p "$(dirname "$R2")"; cp -R "$R" "$R2"; rm -f "$R2"/app/.next-cli-build/server/chunks/*.pre-*
sed -i.orig 's/reasoning_content&&a.message.content&&delete a.message.reasoning_content;/reasoning_content&&0;/' "$R2/app/.next-cli-build/server/chunks/7004.js"; rm -f "$R2"/app/.next-cli-build/server/chunks/*.orig
printf 'exports.A=1;\n' >"$R2/app/.next-cli-build/server/chunks/7001.js"   # parts A and B vanish too
b="$(cd "$R2" && find . -name '*.js' | sort | xargs cksum)"; bash "$GUARD" "$R2" >"$T/f.out" 2>&1; rc=$?
[ $rc -eq 3 ] && grep -q "located NO target" "$T/f.out" && ok "unresolved parts exit 3 (never reported as success)" || { bad "fail-closed rc=$rc"; tail -5 "$T/f.out"; }
[ "$b" = "$(cd "$R2" && find . -name '*.js' | sort | xargs cksum)" ] && ok "nothing written when a part is unresolved" || bad "wrote despite unresolved part"

# 4. installer auto-detect: package, prefix, node_modules dir, and a non-package dir (~/.9router) all resolve
H="$T/home"; mkdir -p "$H/.9router" "$H/.npm-global/lib/node_modules"; cp -R "$R" "$H/.npm-global/lib/node_modules/9router"
for r in "$H/.npm-global/lib/node_modules/9router" "$H/.npm-global" "$H/.npm-global/lib/node_modules" "$H/.9router"; do
  o="$(HOME="$H" bash "$INST" --check --root "$r" glm53-thinking 2>&1)"
  case "$o" in *"9Router 9.9.9 at $H/.npm-global/lib/node_modules/9router"*) ok "installer --root $(basename "$r") -> package found" ;; *) bad "installer --root $r: $(echo "$o" | head -2)" ;; esac
done
HOME="$H" bash "$INST" --check --root "$T/does-not-exist" glm53-thinking >/dev/null 2>&1; [ $? -eq 2 ] && ok "installer: a --root that does not exist is an error" || bad "missing --root accepted"
# an existing folder that is NOT a 9Router package (and not ~/.9router) must exit 2, never fall through to another install
mkdir -p "$T/notapkg"; o="$(HOME="$H" bash "$INST" --check --root "$T/notapkg" glm53-thinking 2>&1)"; rc=$?
[ $rc -eq 2 ] && ! echo "$o" | grep -q "9Router 9.9.9 at" && ok "installer: --root <existing non-package dir> exits 2, no auto-detect" || bad "non-package --root rc=$rc: $(echo "$o" | head -2)"
exit $fail
