#!/bin/bash
# Fix 2 tests — deterministic memory initializer (init-kaizen-memory.mjs).
# All fixture work happens under mktemp dirs with KAIZEN_DOWNLOADS set.
# The real ~/Downloads, ~/.claude and launchd are never touched.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$HERE/.." && pwd)"
INIT="$SKILL_DIR/scripts/common/init-kaizen-memory.mjs"
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

FIX_DL="$(mktemp -d "$FIX_BASE/kaizen-fix02-dl.XXXXXX")"
cleanup() { rm -rf "$FIX_DL" "$FIX_BASE/kaizen-fix02-dl2."* 2>/dev/null || true; }
trap cleanup EXIT

init_json() { # init_json <name> <extra-json-fields> — always against the fixture
  local nm="$1" fields="$2"
  KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$INIT" --json "{\"name\":\"$nm\"$fields}"
}

# --- 2.1 fresh init creates all 14 items -------------------------------------
out="$(init_json "My Website" '')"
rc=$?
check_eq "2.1 init exit 0" "0" "$rc"
LOOP_DIR="$(printf '%s' "$out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_dir))')"
LOOP_ID="$(printf '%s' "$out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_id))')"
ROOT="$(printf '%s' "$out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).root))')"

for f in KAIZEN_CONTRACT.md KAIZEN_MEMORY.md STATE.json LOCAL_STATE.json \
         RESUME.md BACKLOG.md DECISIONS.md; do
  check "2.1 file exists: $f" test -f "$LOOP_DIR/$f"
done
check "2.1 dir exists: cycles" test -d "$LOOP_DIR/cycles"
check "2.1 dir exists: evidence" test -d "$LOOP_DIR/evidence"
check "2.1 file exists: evidence/manifest.json" test -f "$LOOP_DIR/evidence/manifest.json"
check "2.1 file exists: root INDEX.md" test -f "$ROOT/INDEX.md"
check "2.1 file exists: root REGISTRY.json" test -f "$ROOT/REGISTRY.json"
check "2.1 file exists: root .gitignore" test -f "$ROOT/.gitignore"

# --- 2.2 zero placeholders in every generated file -----------------------------
for f in KAIZEN_CONTRACT.md KAIZEN_MEMORY.md STATE.json LOCAL_STATE.json \
         RESUME.md BACKLOG.md DECISIONS.md evidence/manifest.json \
         "$ROOT/INDEX.md" "$ROOT/REGISTRY.json" "$ROOT/.gitignore"; do
  if grep -E '<[A-Za-z_][A-Za-z0-9_.-]*>' "$LOOP_DIR/$f" >/dev/null 2>&1; then
    bad "2.2 placeholders remain in $f"
  else
    ok "2.2 no placeholders in $f"
  fi
done

# --- 2.3 loop-id uuid stable across re-init update of same folder ---------------
out2="$(init_json "My Website" ",\"loop_id\":\"$LOOP_ID\"")"
rc2=$?
check_eq "2.3 re-init exit 0" "0" "$rc2"
LOOP_DIR2="$(printf '%s' "$out2" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_dir))')"
check_eq "2.3 same loop dir on re-init" "$LOOP_DIR" "$LOOP_DIR2"
st_id="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).loop_id)' "$LOOP_DIR/STATE.json")"
check_eq "2.3 loop_id stable in STATE.json" "$LOOP_ID" "$st_id"
check "2.3 .bak kept of prior STATE.json" test -f "$LOOP_DIR/STATE.json.bak"

# --- 2.4 same slug, different loop id -> distinct folder, never overwrite ------
out3="$(init_json "My Website" ",\"loop_id\":\"11111111-1111-4111-8111-111111111111\"" 2>/dev/null)"
rc3=$?
check_eq "2.4 different loop same name -> exit 0" "0" "$rc3"
LOOP3="$(printf '%s' "$out3" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_dir))' 2>/dev/null)"
check_eq "2.4 distinct folder, original untouched" "$ROOT/my-website-2" "$LOOP3"
st_orig="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).loop_id)' "$LOOP_DIR/STATE.json")"
check_eq "2.4 original loop STATE.json still own loop_id" "$LOOP_ID" "$st_orig"

# --- 2.5 friendly name collision gets distinct folder ---------------------------
out4="$(init_json "My Website 2" ",\"loop_id\":\"22222222-2222-4222-8222-222222222222\"" 2>/dev/null)"
LOOP4="$(printf '%s' "$out4" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_dir))' 2>/dev/null)"
check_eq "2.5 distinct folder for new name" "$ROOT/my-website-2-2" "$LOOP4"
out5="$(init_json "My Website" ",\"loop_id\":\"33333333-3333-4333-8333-333333333333\"" 2>/dev/null)"
LOOP5="$(printf '%s' "$out5" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).loop_dir))' 2>/dev/null)"
check_eq "2.5 second same-name loop gets -3" "$ROOT/my-website-3" "$LOOP5"

# --- 2.5b refuse when registry maps loop_id to another loop's folder -----------
# Point registry entry for loop 3333... at my-website-2 (owned by 1111...) and
# re-init 3333...: must refuse, never overwrite.
"$NODE_BIN" -e '
const fs = require("fs");
const p = process.argv[1];
const r = JSON.parse(fs.readFileSync(p, "utf8"));
r.loops = r.loops.map((e) => (e.loop_id === "33333333-3333-4333-8333-333333333333" ? { ...e, memory_dir: "my-website-2" } : e));
fs.writeFileSync(p, JSON.stringify(r, null, 2) + "\n");
' "$ROOT/REGISTRY.json"
out5b="$(init_json "My Website" ",\"loop_id\":\"33333333-3333-4333-8333-333333333333\"" 2>/dev/null)"
rc5b=$?
check_ne "2.5b registry->foreign folder -> nonzero exit" "0" "$rc5b"
st_w2="$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).loop_id)' "$ROOT/my-website-2/STATE.json")"
check_eq "2.5b foreign folder untouched" "11111111-1111-4111-8111-111111111111" "$st_w2"

# --- 2.6 rollback on injected failure leaves no partial loop --------------------
# Deterministic injection: the Kaizen root is read-only while the loop folder
# pre-exists with a matching STATE.json (update path). Loop-level writes
# succeed, then the root-level INDEX.md write fails with EACCES mid-init.
# Rollback must leave the loop folder with ONLY its original STATE.json.
FIX_DL6="$(mktemp -d "$FIX_BASE/kaizen-fix02-dl6.XXXXXX")"
mkdir -p "$FIX_DL6/Kaizen/rollback-loop"
printf '{"schema_version":1,"loop_id":"44444444-4444-4444-8444-444444444444","name":"Rollback Loop"}\n' > "$FIX_DL6/Kaizen/rollback-loop/STATE.json"
chmod 555 "$FIX_DL6/Kaizen"
out6="$(KAIZEN_DOWNLOADS="$FIX_DL6" "$NODE_BIN" "$INIT" --json '{"name":"Rollback Loop","loop_id":"44444444-4444-4444-8444-444444444444"}' 2>/dev/null)"
rc6=$?
check_ne "2.6 injected failure -> nonzero exit" "0" "$rc6"
check_eq "2.6 rollback flag in error JSON" "true" "$(printf '%s' "$out6" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).rolled_back)}catch(e){console.log("false")}})')"
chmod 755 "$FIX_DL6/Kaizen"
if [ -d "$FIX_DL6/Kaizen/rollback-loop" ]; then
  n_left="$(find "$FIX_DL6/Kaizen/rollback-loop" -mindepth 1 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n_left" = "1" ] && [ -f "$FIX_DL6/Kaizen/rollback-loop/STATE.json" ]; then
    ok "2.6 no partial loop left after rollback (only original STATE.json)"
  else
    bad "2.6 partial loop left after rollback ($n_left entries)"
  fi
else
  ok "2.6 no partial loop left after rollback"
fi
rm -rf "$FIX_DL6"

# --- 2.7 .gitignore covers the listed patterns ---------------------------------
gi="$ROOT/.gitignore"
for pat in "LOCAL_STATE.json" "*.bak" "*.log" "cycles/*.log" ".DS_Store" \
           ".cycle-lock.json" "evidence/raw" "browser-profile/" "*.har" \
           "*.env" "*credentials*" "*token*"; do
  if grep -Fq "$pat" "$gi"; then
    ok "2.7 .gitignore covers: $pat"
  else
    bad "2.7 .gitignore missing: $pat"
  fi
done

# --- 2.8 REGISTRY.json + INDEX.md consistent -----------------------------------
reg_ok="$("$NODE_BIN" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(r.schema_version===1 && Array.isArray(r.loops) && r.loops.some(e=>e.loop_id===process.argv[2]) ? "yes":"no")' "$ROOT/REGISTRY.json" "$LOOP_ID")"
check_eq "2.8 registry has loop with schema_version 1" "yes" "$reg_ok"
idx_names="$(grep -c 'My Website' "$ROOT/INDEX.md")"
if [ "$idx_names" -ge 1 ]; then ok "2.8 INDEX.md names the loop"; else bad "2.8 INDEX.md missing loop name"; fi

# --- 2.9 invalid input -> exit 2 machine-readable -------------------------------
out9="$(init_json "  " '' 2>/dev/null)"
rc9=$?
check_eq "2.9 empty name -> exit 2" "2" "$rc9"
check_eq "2.9 machine-readable error" "false" "$(printf '%s' "$out9" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).ok)}catch(e){console.log("false")}})')"
out9b="$(init_json "ScopeLoop" ',"scope":9' 2>/dev/null)"
rc9b=$?
check_eq "2.9 scope out of range -> exit 2" "2" "$rc9b"
out9c="$(init_json "PermLoop" ',"permission_mode":"X"' 2>/dev/null)"
rc9c=$?
check_eq "2.9 bad permission mode -> exit 2" "2" "$rc9c"

# --- 2.10 no secrets placed in generated files -----------------------------------
sec_hits=0
for f in "$LOOP_DIR"/*.json "$LOOP_DIR"/*.md "$ROOT"/REGISTRY.json "$ROOT"/INDEX.md; do
  if grep -lE 'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}' "$f" >/dev/null 2>&1; then
    sec_hits=$((sec_hits + 1))
  fi
done
check_eq "2.10 no secret-shaped literals in generated files" "0" "$sec_hits"

echo ""
echo "fix02-init-tests: pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
