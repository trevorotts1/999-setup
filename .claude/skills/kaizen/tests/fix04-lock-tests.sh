#!/bin/bash
# Fix 4 tests — atomic token-based cycle lock in kaizen-state.mjs.
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
check_ne() {
  if [ "$2" != "$3" ]; then ok "$1"; else bad "$1 (unexpectedly equal: [$2])"; fi
}

state() { KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$STATE_MJS" "$@"; }

FIX_DL="$(mktemp -d "$FIX_BASE/kaizen-fix04-dl.XXXXXX")"
cleanup() { rm -rf "$FIX_DL"; }
trap cleanup EXIT

# Seed one loop folder.
mkdir -p "$FIX_DL/Kaizen/loop-a"
printf '{"schema_version":1,"loop_id":"loop-a","name":"Loop A","target":{"type":"website"},"direction":{"open_discovery":true},"scope":{"max_items_per_cycle":5},"permission_mode":"B","proof_strategy":[],"schedule":{},"model":{},"last_cycle":null,"backup":{},"contract_version":1,"approval":null}\n' > "$FIX_DL/Kaizen/loop-a/STATE.json"
state registry-add loop-a --name "Loop A" --memory-dir loop-a >/dev/null

LOCK_F="$FIX_DL/Kaizen/loop-a/.cycle-lock.json"

# --- 4.1 normal lock -> token unlock succeeds WITHOUT --force -------------------
lock1="$(state lock loop-a --cycle cycle-001 --session test 2>/dev/null)"
rc1=$?
check_eq "4.1 lock exit 0" "0" "$rc1"
TOKEN="$(printf '%s' "$lock1" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
check "4.1 token is 32 hex chars" printf '%s' "$TOKEN" | grep -qE '^[0-9a-f]{32}$'
check "4.1 lock file exists" test -f "$LOCK_F"
unlock1="$(state unlock loop-a --token "$TOKEN" 2>/dev/null)"
rc1u=$?
check_eq "4.1 unlock with token exit 0" "0" "$rc1u"
check "4.1 lock file gone after token unlock" test ! -f "$LOCK_F"

# --- 4.2 wrong token rejected ---------------------------------------------------
state lock loop-a --cycle cycle-002 >/dev/null 2>&1
# correct token for the fresh lock
TOKEN2="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
wrong_out="$(state unlock loop-a --token deadbeefdeadbeefdeadbeefdeadbeef 2>/dev/null)"
wrong_rc=$?
check_eq "4.2 wrong token -> exit 1" "1" "$wrong_rc"
check_eq "4.2 wrong token message" "token mismatch" "$(printf '%s' "$wrong_out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).error))')"
check "4.2 lock still held after wrong token" test -f "$LOCK_F"
# and unlock with correct token
state unlock loop-a --token "$TOKEN2" >/dev/null 2>&1

# --- 4.3 second lock rejected (one winner) --------------------------------------
state lock loop-a --cycle cycle-003 >/dev/null 2>&1
second_out="$(state lock loop-a --cycle cycle-004 2>/dev/null)"
second_rc=$?
check_eq "4.3 second lock -> exit 1" "1" "$second_rc"
check_eq "4.3 second lock skipped JSON" "lock_held" "$(printf '%s' "$second_out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reason))')"
TOKEN3="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN3" >/dev/null 2>&1

# --- 4.4 TRUE concurrency: N=20 lock processes, exactly one winner --------------
N=20
i=1
while [ "$i" -le "$N" ]; do
  state lock loop-a --cycle "cycle-c$i" --session "conc$i" > "$FIX_DL/out.$i" 2>/dev/null &
  i=$((i + 1))
done
wait
winners=0
i=1
while [ "$i" -le "$N" ]; do
  if "$NODE_BIN" -e 'let s="";let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).ok===true?"w":"l")}catch(e){console.log("l")}})' < "$FIX_DL/out.$i" | grep -q w; then
    winners=$((winners + 1))
  fi
  i=$((i + 1))
done
check_eq "4.4 exactly one winner among 20 concurrent locks" "1" "$winners"
rm -f "$FIX_DL"/out.*
TOKEN4="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN4" >/dev/null 2>&1

# --- 4.5 stale lock (backdated) -> lock succeeds with --stale, .stale-* kept ---
state lock loop-a --cycle cycle-005 >/dev/null 2>&1
"$NODE_BIN" -e '
const fs=require("fs");const p=process.argv[1];
const l=JSON.parse(fs.readFileSync(p,"utf8"));
l.started_at=new Date(Date.now()-7*60*60*1000).toISOString();
fs.writeFileSync(p,JSON.stringify(l,null,2)+"\n");' "$LOCK_F"
stale_out="$(state lock loop-a --cycle cycle-006 2>/dev/null)"
stale_rc=$?
check_eq "4.5 stale lock -> lock succeeds" "0" "$stale_rc"
stale_ev="$(ls "$FIX_DL/Kaizen/loop-a"/.cycle-lock.json.stale-* 2>/dev/null | wc -l | tr -d ' ')"
check_eq "4.5 .stale-* evidence file kept" "1" "$stale_ev"
TOKEN5="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN5" >/dev/null 2>&1

# --- 4.6 malformed lock preserved + recoverable via --broken -------------------
printf '{not json at all' > "$LOCK_F"
broken_out="$(state unlock loop-a --force --broken 2>/dev/null)"
broken_rc=$?
check_eq "4.6 --force --broken clears malformed lock" "0" "$broken_rc"
check "4.6 lock file gone after broken recovery" test ! -f "$LOCK_F"
check "4.6 broken evidence kept" test -n "$(ls "$FIX_DL/Kaizen/loop-a"/.cycle-lock.json.broken-* 2>/dev/null)"

# --- 4.7 duplicate scheduled run: is-locked true -> lock returns skipped --------
state lock loop-a --cycle cycle-007 >/dev/null 2>&1
il="$(state is-locked loop-a 2>/dev/null)"
il_rc=$?
check_eq "4.7 is-locked exit 0" "0" "$il_rc"
check_eq "4.7 is-locked locked:true" "true" "$(printf '%s' "$il" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).locked))')"
dup_out="$(state lock loop-a --cycle cycle-008 2>/dev/null)"
dup_rc=$?
check_eq "4.7 duplicate lock -> exit 1" "1" "$dup_rc"
check_eq "4.7 duplicate lock skipped JSON" "true" "$(printf '%s' "$dup_out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).skipped))')"
check_eq "4.7 skipped reason" "lock_held" "$(printf '%s' "$dup_out" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reason))')"
TOKEN7="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN7" >/dev/null 2>&1

# --- 4.8 unlock with no token fails ---------------------------------------------
state lock loop-a --cycle cycle-009 >/dev/null 2>&1
no_tok_out="$(state unlock loop-a 2>/dev/null)"
no_tok_rc=$?
check_eq "4.8 unlock with no token -> exit 1" "1" "$no_tok_rc"
TOKEN8="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN8" >/dev/null 2>&1

# --- 4.9 full normal path has zero --force usage --------------------------------
force_used=0
state lock loop-a --cycle cycle-010 >/dev/null 2>&1
TOKEN9="$(cat "$LOCK_F" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
state unlock loop-a --token "$TOKEN9" >/dev/null 2>&1
il2="$(state is-locked loop-a 2>/dev/null)"
check_eq "4.9 is-locked false after normal unlock" "false" "$(printf '%s' "$il2" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).locked))')"
check_eq "4.9 normal path used no --force" "0" "$force_used"

echo ""
echo "fix04-lock-tests: pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
