#!/bin/bash
# Fix 1 tests — memory-root resolution must agree across all three resolvers:
#   scripts/macos/resolve-kaizen-root.sh  (Bash 3.2 safe)
#   scripts/common/kaizen-state.mjs locate
#   scripts/windows/Resolve-KaizenRoot.ps1 (run under pwsh when available)
#
# All fixture work happens under a mktemp directory. The real ~/Downloads,
# the real ~/.claude and launchd are never touched.

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$HERE/.." && pwd)"
SH_RESOLVER="$SKILL_DIR/scripts/macos/resolve-kaizen-root.sh"
NODE_STATE="$SKILL_DIR/scripts/common/kaizen-state.mjs"
PS_RESOLVER="$SKILL_DIR/scripts/windows/Resolve-KaizenRoot.ps1"
BASH_BIN="/bin/bash"
NODE_BIN="${NODE_BIN:-node}"

pass=0
fail=0

ok()   { pass=$((pass + 1)); echo "ok - $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL - $1"; }
check() { # check <name> <condition...>
  local name="$1"; shift
  if "$@"; then ok "$name"; else bad "$name"; fi
}
check_eq() { # check_eq <name> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi
}
check_ne() {
  if [ "$2" != "$3" ]; then ok "$1"; else bad "$1 (unexpectedly equal: [$2])"; fi
}

# The fixture tree lives inside a fake "Downloads" dir. TMPDIR's trailing
# slash is stripped so bash and node produce byte-identical single-slash
# paths (node's resolve() collapses "//").
FIX_BASE="$(printf '%s' "${TMPDIR:-/tmp}" | sed 's|/*$||')"
FIX_DL="$(mktemp -d "$FIX_BASE/kaizen-fix01-dl.XXXXXX")"
FIX_DL_ESCAPED="$(printf '%s' "$FIX_DL" | sed 's/[.[\*^$()+?{|]/\\&/g')"

cleanup() {
  rm -rf "$FIX_DL" "$FIX_DL/../kaizen-fix01-dl2."* 2>/dev/null || true
}
trap cleanup EXIT

# --- 1.1 no master folder -> fallback ---------------------------------------
check_eq "1.1 bash: no master folder -> fallback" \
  "$FIX_DL/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.1 node: no master folder -> fallback" \
  "$FIX_DL/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"

# --- 1.2 exactly one master folder WITHOUT Kaizen subfolder -> match/Kaizen
mkdir -p "$FIX_DL/OpenClaw Master Files"
check_eq "1.2 bash: one master w/o Kaizen -> match/Kaizen" \
  "$FIX_DL/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.2 node: one master w/o Kaizen -> match/Kaizen" \
  "$FIX_DL/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"

# --- 1.3 exactly one WITH existing Kaizen subfolder -> same answer ----------
mkdir -p "$FIX_DL/OpenClaw Master Files/Kaizen"
check_eq "1.3 bash: one master with Kaizen -> match/Kaizen" \
  "$FIX_DL/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.3 node: one master with Kaizen -> match/Kaizen" \
  "$FIX_DL/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"

# --- 1.4 two matches -> fallback --------------------------------------------
# A second folder with the exact same name, nested one level down.
mkdir -p "$FIX_DL/sub/OpenClaw Master Files"
check_eq "1.4 bash: two masters -> fallback" \
  "$FIX_DL/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.4 node: two masters -> fallback" \
  "$FIX_DL/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"
rm -rf "$FIX_DL/sub"

# --- 1.5 case variation -------------------------------------------------------
FIX_DL2="$(mktemp -d "$FIX_BASE/kaizen-fix01-dl2.XXXXXX")"
mkdir -p "$FIX_DL2/openclaw MASTER files"
check_eq "1.5 bash: case variation matches" \
  "$FIX_DL2/openclaw MASTER files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL2" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.5 node: case variation matches" \
  "$FIX_DL2/openclaw MASTER files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL2" "$NODE_BIN" "$NODE_STATE" locate)"
rm -rf "$FIX_DL2"

# --- 1.6 match at max depth 3 --------------------------------------------------
FIX_DL3="$(mktemp -d "$FIX_BASE/kaizen-fix01-dl3.XXXXXX")"
mkdir -p "$FIX_DL3/a/b/OpenClaw Master Files"
check_eq "1.6 bash: match at depth 3 found" \
  "$FIX_DL3/a/b/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL3" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.6 node: match at depth 3 found" \
  "$FIX_DL3/a/b/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL3" "$NODE_BIN" "$NODE_STATE" locate)"

# --- 1.7 folder at depth 4 ignored (no depth-3 match present) ------------------
FIX_DL7="$(mktemp -d "$FIX_BASE/kaizen-fix01-dl7.XXXXXX")"
mkdir -p "$FIX_DL7/a/b/c/OpenClaw Master Files"
check_eq "1.7 bash: depth-4-only master ignored -> fallback" \
  "$FIX_DL7/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL7" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.7 node: depth-4-only master ignored -> fallback" \
  "$FIX_DL7/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL7" "$NODE_BIN" "$NODE_STATE" locate)"
rm -rf "$FIX_DL7"

# --- 1.8 path containing spaces ------------------------------------------------
FIX_DL4="$(mktemp -d "$FIX_BASE/kaizen fix01 dl4.XXXXXX")"
mkdir -p "$FIX_DL4/OpenClaw Master Files"
check_eq "1.8 bash: spaces in path" \
  "$FIX_DL4/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL4" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.8 node: spaces in path" \
  "$FIX_DL4/OpenClaw Master Files/Kaizen" "$(KAIZEN_DOWNLOADS="$FIX_DL4" "$NODE_BIN" "$NODE_STATE" locate)"
rm -rf "$FIX_DL4"

# --- 1.9 rerun -> identical path ------------------------------------------------
r1="$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
r2="$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER")"
check_eq "1.9 rerun: identical path" "$r1" "$r2"
n1="$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"
n2="$(KAIZEN_DOWNLOADS="$FIX_DL" "$NODE_BIN" "$NODE_STATE" locate)"
check_eq "1.9 rerun node: identical path" "$n1" "$n2"

# --- 1.10 Bash 3.2 compatibility ------------------------------------------------
# /bin/bash on this Mac IS 3.2; run the resolver under it with set -u active.
BASH_VERSION_32="$("$BASH_BIN" --version 2>&1 | head -1)"
echo "info: resolver runs under: $BASH_VERSION_32"
case "$BASH_VERSION_32" in
  *"3.2"*) ok "1.10 /bin/bash is Bash 3.2" ;;
  *) ok "1.10 /bin/bash version noted (not 3.2): $BASH_VERSION_32" ;;
esac
out32="$(KAIZEN_DOWNLOADS="$FIX_DL" "$BASH_BIN" "$SH_RESOLVER" 2>&1)"
rc32=$?
check_eq "1.10 bash 3.2 run exit code" "0" "$rc32"
check_eq "1.10 bash 3.2 output non-empty" "$FIX_DL/OpenClaw Master Files/Kaizen" "$out32"
if printf '%s' "$out32" | grep -qi "unbound"; then
  bad "1.10 no unbound-variable errors under bash 3.2 set -u"
else
  ok "1.10 no unbound-variable errors under bash 3.2 set -u"
fi

# --- 1.11 Node vs Bash parity on the same fixtures --------------------------------
for d in "$FIX_DL"; do
  b="$(KAIZEN_DOWNLOADS="$d" "$BASH_BIN" "$SH_RESOLVER")"
  n="$(KAIZEN_DOWNLOADS="$d" "$NODE_BIN" "$NODE_STATE" locate)"
  check_eq "1.11 parity bash==node ($d)" "$b" "$n"
done

# --- 1.12 PowerShell parity (when pwsh available) ---------------------------------
if command -v pwsh >/dev/null 2>&1; then
  p="$(KAIZEN_DOWNLOADS="$FIX_DL" pwsh -NoProfile -NonInteractive -File "$PS_RESOLVER" 2>/dev/null | tr -d '\r')"
  check_eq "1.12 pwsh: one master -> match/Kaizen" "$FIX_DL/OpenClaw Master Files/Kaizen" "$p"
  FIX_DL5="$(mktemp -d "$FIX_BASE/kaizen-fix01-dl5.XXXXXX")"
  p5="$(KAIZEN_DOWNLOADS="$FIX_DL5" pwsh -NoProfile -NonInteractive -File "$PS_RESOLVER" 2>/dev/null | tr -d '\r')"
  # Join-Path uses the host platform separator: '\' on Windows, '/' on POSIX.
  PW_SEP="/"
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) PW_SEP='\';; esac
  check_eq "1.12 pwsh: no master -> fallback" "$FIX_DL5${PW_SEP}Kaizen" "$p5"
  rm -rf "$FIX_DL5"
else
  echo "info: pwsh not found; PowerShell resolver parity not run (not a failure)"
fi

echo ""
echo "fix01-resolver-tests: pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
