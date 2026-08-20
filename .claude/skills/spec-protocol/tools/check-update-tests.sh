#!/usr/bin/env bash
# check-update-tests.sh — offline regression suite for tools/check-update.sh
#
# WHY THIS EXISTS. check-update.sh's exit codes are load-bearing: a box told
# "current" out of a failed instrument is the exact defect the script exists to
# stop. This suite pins the contract — 0 current, 1 update, 2 undetermined —
# and every failure branch that feeds it.
#
# ALL OFFLINE. The local side is a temp fixture tree; the "published" side is
# python3 -m http.server on 127.0.0.1:<random port>, reached only through the
# script's SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 loopback gate. No internet. If
# python3 is missing the suite prints SKIPPED and exits 0 (CI has python3; this
# is a local-dev courtesy).
#
# USAGE: bash check-update-tests.sh [path/to/check-update.sh]
#   (defaults to the sibling check-update.sh)
#
# bash-3.2 safe: no associative arrays, no ${var,,}, no local -a in functions,
# set -uo pipefail.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:-$SCRIPT_DIR/check-update.sh}"

PASS_COUNT=0
FAIL_COUNT=0
SUITE_RAN=0
TMP=""
LOCAL=""
REMOTE=""
PORT=""
URL_BASE=""
SRV_PID=""
SRV_LOG=""
OUT_FILE=""
ALLOW=""
VERSION_URL=""
RC=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf 'PASS %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'FAIL %s\n' "$1"; }

cleanup() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  [ "$SUITE_RAN" -eq 1 ] && printf 'RESULT: %d passed, %d failed\n' "$PASS_COUNT" "$FAIL_COUNT"
}
trap cleanup EXIT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'SKIPPED: python3 required\n'
  exit 0
fi

TMP="$(mktemp -d /tmp/check-update-tests.XXXXXX)"
LOCAL="$TMP/local"
REMOTE="$TMP/remote"
SRV_LOG="$TMP/srv.log"
OUT_FILE="$TMP/out.txt"

# ------------------------------------------------------------- fixtures
make_local_fixture() {
  rm -rf "$LOCAL"
  for s in nine-router-setup spec-protocol kaizen eli5 bro; do
    mkdir -p "$LOCAL/$s"
    printf '1.0.0\n' > "$LOCAL/$s/VERSION"
  done
}

make_remote_fixture() {
  rm -rf "$REMOTE"
  for s in nine-router-setup spec-protocol kaizen eli5 bro garbage; do
    mkdir -p "$REMOTE/$s"
  done
  for s in nine-router-setup spec-protocol kaizen eli5 bro; do
    printf '1.0.0\n' > "$REMOTE/$s/VERSION"
  done
  printf 'not-a-version\n' > "$REMOTE/garbage/VERSION"
}

# ------------------------------------------------------------- runner
run_target() {
  HOME="$TMP" \
  SPEC_PROTOCOL_LOCAL_SKILLS_ROOT="$LOCAL" \
  SPEC_PROTOCOL_SKILLS_URL_BASE="$URL_BASE" \
  SPEC_PROTOCOL_VERSION_URL="$VERSION_URL" \
  SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP="$ALLOW" \
  "$TARGET" >"$OUT_FILE" 2>&1
  RC=$?
}

start_server() {
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
  URL_BASE="http://127.0.0.1:$PORT"
  # --directory, never cd: make_remote_fixture does rm -rf "$REMOTE" between
  # cases, which would delete this shell's own cwd and break every child
  # (getcwd errors in the target, curl rc=1).
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REMOTE" >"$SRV_LOG" 2>&1 &
  SRV_PID=$!
  local i=0
  while [ "$i" -lt 50 ]; do
    curl -s -o /dev/null "$URL_BASE/nine-router-setup/VERSION" && return 0
    sleep 0.1
    i=$(( i + 1 ))
  done
  printf 'FAIL server never became ready; log:\n'
  sed 's/^/    /' "$SRV_LOG"
  exit 1
}

# ------------------------------------------------------------- cases
case_01_all_current() {
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 0 ] && ! grep -q "UPDATE AVAILABLE" "$OUT_FILE" && ! grep -q "UNDETERMINED" "$OUT_FILE"; then
    pass "01 all five skills current -> exit 0"
  else
    fail "01 all five skills current -> exit 0 (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_02_update_available() {
  make_remote_fixture
  printf '1.0.1\n' > "$REMOTE/kaizen/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 1 ] && grep -q "UPDATE AVAILABLE kaizen" "$OUT_FILE" && grep -q "1.0.0 -> 1.0.1" "$OUT_FILE"; then
    pass "02 remote kaizen 1.0.1 vs local 1.0.0 -> exit 1, both versions named"
  else
    fail "02 remote kaizen 1.0.1 vs local 1.0.0 -> exit 1, both versions named (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_03_update_beats_undetermined() {
  make_remote_fixture
  printf '1.0.1\n' > "$REMOTE/kaizen/VERSION"
  rm "$LOCAL/bro/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 1 ] && grep -q "UPDATE AVAILABLE kaizen" "$OUT_FILE"; then
    pass "03 update + undetermined -> exit 1, update still reported"
  else
    fail "03 update + undetermined -> exit 1, update still reported (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_04_undetermined_only() {
  make_local_fixture
  make_remote_fixture
  rm "$LOCAL/bro/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 2 ] && grep -q "UNDETERMINED bro" "$OUT_FILE"; then
    pass "04 no updates, local bro VERSION missing -> exit 2, UNDETERMINED bro"
  else
    fail "04 no updates, local bro VERSION missing -> exit 2, UNDETERMINED bro (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_05_remote_unreachable() {
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  kill "$SRV_PID" 2>/dev/null
  SRV_PID=""
  run_target
  n=$(grep -c "UNDETERMINED" "$OUT_FILE")
  if [ "$RC" -eq 2 ] && [ "$n" -eq 5 ]; then
    pass "05 remote unreachable -> exit 2, all five UNDETERMINED"
  else
    fail "05 remote unreachable -> exit 2, all five UNDETERMINED (rc=$RC undetermined=$n)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_06_invalid_local_version() {
  printf '1.0.0-beta\n' > "$LOCAL/kaizen/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 2 ] && grep -q "UNDETERMINED kaizen" "$OUT_FILE"; then
    pass "06 invalid local version 1.0.0-beta -> exit 2"
  else
    fail "06 invalid local version 1.0.0-beta -> exit 2 (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
  printf '1.0.0\n' > "$LOCAL/kaizen/VERSION"
}

case_07_invalid_remote_version() {
  ALLOW=1
  VERSION_URL="$URL_BASE/garbage/VERSION"
  run_target
  if [ "$RC" -eq 2 ] && grep -q "UNDETERMINED spec-protocol" "$OUT_FILE" && grep -q "not a version string" "$OUT_FILE"; then
    pass "07 invalid remote version (HTTP 200 garbage body) -> exit 2"
  else
    fail "07 invalid remote version (HTTP 200 garbage body) -> exit 2 (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_08_local_ahead() {
  make_local_fixture
  make_remote_fixture
  printf '2.0.0\n' > "$LOCAL/kaizen/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 0 ] && grep -q "ahead" "$OUT_FILE"; then
    pass "08 local 2.0.0 ahead of remote 1.0.0 -> exit 0"
  else
    fail "08 local 2.0.0 ahead of remote 1.0.0 -> exit 0 (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_09_loopback_guard() {
  ALLOW=""
  VERSION_URL=""
  run_target
  if [ "$RC" -eq 2 ] && grep -q "ALLOW_LOCALHOST_HTTP" "$OUT_FILE"; then
    pass "09 http loopback without SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 -> exit 2, guard fires"
  else
    fail "09 http loopback without SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 -> exit 2, guard fires (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
}

case_10_empty_local_version() {
  : > "$LOCAL/kaizen/VERSION"
  ALLOW=1
  VERSION_URL="$URL_BASE/spec-protocol/VERSION"
  run_target
  if [ "$RC" -eq 2 ] && grep -q "UNDETERMINED kaizen" "$OUT_FILE"; then
    pass "10 empty local VERSION file -> exit 2"
  else
    fail "10 empty local VERSION file -> exit 2 (rc=$RC)"
    sed 's/^/    /' "$OUT_FILE"
  fi
  printf '1.0.0\n' > "$LOCAL/kaizen/VERSION"
}

# ------------------------------------------------------------------ main
bash -n "$TARGET" >"$OUT_FILE" 2>&1
RC=$?
if [ "$RC" -eq 0 ]; then
  pass "00 syntax: bash -n check-update.sh"
else
  fail "00 syntax: bash -n check-update.sh (rc=$RC)"
  sed 's/^/    /' "$OUT_FILE"
fi

make_local_fixture
make_remote_fixture
start_server

case_01_all_current
case_02_update_available
case_03_update_beats_undetermined
case_04_undetermined_only
case_06_invalid_local_version
case_07_invalid_remote_version
case_08_local_ahead
case_09_loopback_guard
case_10_empty_local_version
case_05_remote_unreachable   # last: kills the fixture server

SUITE_RAN=1
if [ "$FAIL_COUNT" -eq 0 ]; then
  exit 0
fi
exit 1
