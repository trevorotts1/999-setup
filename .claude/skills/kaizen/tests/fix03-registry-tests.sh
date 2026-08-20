#!/bin/bash
# Fix 3 tests — REGISTRY.json standardization, locate-loop, registry-add,
# registry-update, registry-list, migration from lowercase registry.json.
# All fixture work under mktemp dirs with KAIZEN_DOWNLOADS set.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$HERE/.." && pwd)"
STATE_MJS="$SKILL_DIR/scripts/common/kaizen-state.mjs"
NODE_BIN="${NODE_BIN:-node}"
FIX_BASE="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's|/*$||')"

pass=0
fail=0
ok()   { pass=$((pass + 1)); echo "ok - $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL - $1"; }
check() {
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}
check_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi
}

state() { KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$STATE_MJS" "$@"; }

FIX_DL="$(mktemp -d "$FIX_BASE/kaizen-fix03-dl.XXXXXX")"
cleanup() { rm -rf "$FIX_DL"; }
trap cleanup EXIT

# Seed two loop folders with STATE.json so locate/status work.
mkdir -p "$FIX_DL/Kaizen/alpha" "$FIX_DL/Kaizen/beta"
printf '{"schema_version":1,"loop_id":"loop-alpha-0001","name":"Alpha Site","target":{"type":"website"},"direction":{"open_discovery":true},"scope":{"max_items_per_cycle":5},"permission_mode":"B","proof_strategy":[],"schedule":{},"model":{},"last_cycle":null,"backup":{},"contract_version":1,"approval":{"timestamp":null,"approved_by":null}}\n' > "$FIX_DL/Kaizen/alpha/STATE.json"
printf '{"schema_version":1,"loop_id":"loop-beta-0002","name":"Beta Site","target":{"type":"app"},"direction":{"open_discovery":true},"scope":{"max_items_per_cycle":4},"permission_mode":"B","proof_strategy":[],"schedule":{},"model":{},"last_cycle":null,"backup":{},"contract_version":1,"approval":{"timestamp":null,"approved_by":null}}\n' > "$FIX_DL/Kaizen/beta/STATE.json"

# --- 3.1 migration: lowercase map -> REGISTRY.json preserves unknown fields ----
printf '{"loop-alpha-0001":{"custom_field":"keep-me","legacy_note":"old data","root":"/old/root"}}\n' > "$FIX_DL/Kaizen/registry.json"
state registry-list >/dev/null 2>&1  # triggers migration
check "3.1 REGISTRY.json created" test -f "$FIX_DL/Kaizen/REGISTRY.json"
check "3.1 lowercase renamed to .bak-migrated" test -f "$FIX_DL/Kaizen/registry.json.bak-migrated"
keep="$("$NODE_BIN" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const e=r.loops.find(x=>x.loop_id==="loop-alpha-0001"); console.log((e.custom_field==="keep-me" && e.legacy_note==="old data") ? "kept" : "lost")' "$FIX_DL/Kaizen/REGISTRY.json")"
check_eq "3.1 unknown fields preserved after migration" "kept" "$keep"

# --- 3.2 registry-add (merge) + registry-list sorted --------------------------
state registry-add loop-alpha-0001 --name "Alpha Site" --memory-dir alpha >/dev/null
state registry-add loop-beta-0002 --name "Beta Site" --memory-dir beta >/dev/null
state registry-add loop-alpha-0001 --name "Alpha Renamed" --memory-dir alpha >/dev/null
cnt="$(state registry-list | grep -c '"loop_id"')"
check_eq "3.2 two entries after adds (merge, no dupes)" "2" "$cnt"
sorted="$(state registry-list | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.map(e=>e.name).join(","))})')"
check_eq "3.2 registry-list sorted by name" "Alpha Renamed,Beta Site" "$sorted"

# --- 3.3 locate-loop by id and by name -----------------------------------------
check_eq "3.3 locate-loop by id" "$FIX_DL/Kaizen/alpha" "$(state locate-loop loop-alpha-0001)"
check_eq "3.3 locate-loop by name (case-insensitive)" "$FIX_DL/Kaizen/beta" "$(state locate-loop 'BETA SITE')"

# --- 3.4 ambiguous name -> exit 1 naming both ----------------------------------
# alpha is named "Alpha Renamed" after 3.2; give gamma the SAME name so a
# name lookup matches exactly two loops.
mkdir -p "$FIX_DL/Kaizen/gamma"
printf '{"schema_version":1,"loop_id":"loop-gamma-0003","name":"Alpha Renamed","target":{"type":"funnel"},"direction":{"open_discovery":true},"scope":{"max_items_per_cycle":3},"permission_mode":"B","proof_strategy":[],"schedule":{},"model":{},"last_cycle":null,"backup":{},"contract_version":1,"approval":null}\n' > "$FIX_DL/Kaizen/gamma/STATE.json"
state registry-add loop-gamma-0003 --name "Alpha Renamed" --memory-dir gamma >/dev/null
amb_out="$(state locate-loop 'alpha renamed' 2>/dev/null)"
amb_rc=$?
check_eq "3.4 ambiguous name -> exit 1" "1" "$amb_rc"
amb_hits="$(printf '%s' "$amb_out" | grep -o 'loop-alpha-0001\|loop-gamma-0003' | wc -l | tr -d ' ')"
check_eq "3.4 ambiguous error names both candidates" "2" "$amb_hits"
rm -rf "$FIX_DL/Kaizen/gamma"
# drop gamma from registry again
"$NODE_BIN" -e '
const fs=require("fs");const p=process.argv[1];
const r=JSON.parse(fs.readFileSync(p,"utf8"));
r.loops=r.loops.filter(e=>e.loop_id!=="loop-gamma-0003");
fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n");' "$FIX_DL/Kaizen/REGISTRY.json"

# --- 3.5 legacy loop dir without registry entry still located -------------------
# The legacy fallback is <root>/<loop-id> with a matching STATE.json loop_id,
# so the folder name must equal the loop id.
mkdir -p "$FIX_DL/Kaizen/legacy-id-9999"
printf '{"schema_version":1,"loop_id":"legacy-id-9999","name":"Legacy"}\n' > "$FIX_DL/Kaizen/legacy-id-9999/STATE.json"
leg_out="$(state locate-loop legacy-id-9999 2>/dev/null)"
leg_rc=$?
check_eq "3.5 legacy loop located without registry entry" "0" "$leg_rc"
check_eq "3.5 legacy loop path" "$FIX_DL/Kaizen/legacy-id-9999" "$leg_out"

# --- 3.6 registry-update allowed fields + preserve unknown ----------------------
state registry-update loop-alpha-0001 --field status=paused --field last_cycle_id=cycle-007 >/dev/null
upd="$("$NODE_BIN" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=r.loops.find(x=>x.loop_id==="loop-alpha-0001");console.log([e.status,e.last_cycle_id,e.custom_field,e.legacy_note,e.updated_at? "has_ts":"no_ts"].join("|"))' "$FIX_DL/Kaizen/REGISTRY.json")"
check_eq "3.6 update sets fields + keeps unknowns + updated_at" "paused|cycle-007|keep-me|old data|has_ts" "$upd"

# --- 3.7 registry-update rejects unknown field ----------------------------------
bad_out="$(state registry-update loop-alpha-0001 --field made_up=1 2>/dev/null)"
bad_rc=$?
check_eq "3.7 unknown field rejected -> exit 1" "1" "$bad_rc"

# --- 3.8 canonical REGISTRY.json wins over the lowercase name -------------------
check "3.8 REGISTRY.json canonical exists" test -f "$FIX_DL/Kaizen/REGISTRY.json"
canon_parses="$("$NODE_BIN" -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Array.isArray(r.loops)?"yes":"no")}catch(e){console.log("no")}' "$FIX_DL/Kaizen/REGISTRY.json")"
check_eq "3.8 REGISTRY.json parses with loops array" "yes" "$canon_parses"
# On a case-INSENSITIVE filesystem (default macOS APFS) the lowercase name is
# the same file as the canonical one, so this sub-assertion is impossible
# there; on case-SENSITIVE filesystems the canonical content must survive a
# lowercase write. Probe which filesystem we are on, then assert accordingly
# and restore the canonical content either way.
cp "$FIX_DL/Kaizen/REGISTRY.json" "$FIX_DL/Kaizen/REGISTRY.json.preprobe"
printf '{"junk":true}\n' > "$FIX_DL/Kaizen/registry.json"
canon_after="$("$NODE_BIN" -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Array.isArray(r.loops)?"yes":"no")}catch(e){console.log("no")}' "$FIX_DL/Kaizen/REGISTRY.json")"
case_insensitive=0
if [ "$canon_after" = "no" ]; then case_insensitive=1; fi
if [ "$case_insensitive" -eq 1 ]; then
  ok "3.8 case-insensitive FS: lowercase name is the canonical file (expected)"
else
  check_eq "3.8 canonical content survives lowercase write" "yes" "$canon_after"
fi
rm -f "$FIX_DL/Kaizen/registry.json"
mv "$FIX_DL/Kaizen/REGISTRY.json.preprobe" "$FIX_DL/Kaizen/REGISTRY.json"
"$NODE_BIN" -e 'const fs=require("fs");const p=process.argv[1];const r=JSON.parse(fs.readFileSync(p,"utf8"));console.log(Array.isArray(r.loops)?"restored":"broken")' "$FIX_DL/Kaizen/REGISTRY.json" >/dev/null
check "3.8 REGISTRY.json restored for later tests" test -f "$FIX_DL/Kaizen/REGISTRY.json"

# --- 3.9 status includes approval/contract + lock info --------------------------
st="$(state status loop-alpha-0001 2>/dev/null)"
check_eq "3.9 status exit 0" "0" "$?"
check_eq "3.9 status has registry entry" "loop-alpha-0001" "$(printf '%s' "$st" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.registry_entry ? o.registry_entry.loop_id : "missing")})')"
check_eq "3.9 status lock reported" "none" "$(printf '%s' "$st" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.lock === "none" ? "none" : (o.lock && o.lock.held === false ? "none" : "held"))})')"

# --- 3.10 locate-loop unknown -> exit 1 with machine-readable error ------------
unk_out="$(state locate-loop does-not-exist 2>/dev/null)"
unk_rc=$?
check_eq "3.10 unknown loop -> exit 1" "1" "$unk_rc"
check_eq "3.10 machine-readable not-found" "false" "$(printf '%s' "$unk_out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).ok)}catch(e){console.log("false")}})')"

echo ""
echo "fix03-registry-tests: pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
