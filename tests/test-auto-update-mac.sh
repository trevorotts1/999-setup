#!/usr/bin/env bash
# test-auto-update-mac.sh - behavior tests for scripts/auto-update-mac.sh.
# Everything runs in mktemp dirs against a FIXTURE origin repo and a FAKE HOME.
# The real setup-macos.sh is never run: the fixture checkout carries a stub that records its
# arguments, so the tests prove WHICH command the updater runs (only --skills-only), not what
# that command does (tests/test-skills-only.sh and the nine-router-setup skills-only tests do).
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO/scripts/auto-update-mac.sh"
command -v git >/dev/null || { echo "SKIP: git required"; exit 0; }

ROOT="$(mktemp -d)"
trap 'kill $(cat "$ROOT"/holder.pid 2>/dev/null) 2>/dev/null; rm -rf "$ROOT"' EXIT
PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1"; [ -z "${2:-}" ] || sed 's/^/      /' <<<"$2"; }
check() { if [ "$2" = 0 ]; then pass "$1"; else fail "$1" "${3:-}"; fi; }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
# The lock is onboarding's shared helper (contract snapshot in tests/fixtures); tests never touch /tmp/openclaw-update.lock.
HELPER="$REPO/tests/fixtures/box-update-lock.sh"
export AUTO_UPDATE_LOCK_HELPER="$HELPER" AUTO_UPDATE_LOCK_POLL=1
export BUL_AGENT_PULL_LOCKS="" BUL_MAINTENANCE_LOCKS=""
unset BFX_LOCK_RUN_ID BFX_LOCK_OWNER_PID OPENCLAW_UPDATE_LEASE 2>/dev/null || true

STUB_REL=".claude/skills/nine-router-setup/scripts/setup-macos.sh"
ORIGIN="$ROOT/origin.git"; WORK="$ROOT/work"
git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$WORK" 2>/dev/null
mkdir -p "$WORK/$(dirname "$STUB_REL")"
cat > "$WORK/$STUB_REL" <<'EOF'
#!/usr/bin/env bash
# fixture stub: records its argv, one line per run, in $STUB_LOG; fails when $STUB_FAIL is set.
printf '%s\n' "$*" >> "${STUB_LOG:-/dev/null}"
[ -z "${STUB_FAIL:-}" ] || { echo "stub failing on purpose"; exit "${STUB_FAIL}"; }
exit 0
EOF
printf '1.0.0\n' > "$WORK/VERSION"
git -C "$WORK" add -A && git -C "$WORK" commit -q -m "v1.0.0" && git -C "$WORK" push -q origin HEAD:main 2>/dev/null

publish() { # publish <version> : push a new version to the fixture origin main
  printf '%s\n' "$1" > "$WORK/VERSION"; echo "$1" >> "$WORK/changes.txt"
  git -C "$WORK" add -A && git -C "$WORK" commit -q -m "v$1" && git -C "$WORK" push -q origin HEAD:main 2>/dev/null
}
newbox() { # newbox <name> : fresh checkout of the CURRENT origin main, with its own lock + log
  local d="$ROOT/box-$1"; mkdir -p "$d/home"
  git clone -q "$ORIGIN" "$d/999-setup" 2>/dev/null
  echo "$d"
}
run() { # run <box> [args...] : sets OUT, RC, LAST. Fake HOME, own lock dir, stub log.
  local box="$1"; shift
  OUT="$(HOME="$box/home" OPENCLAW_UPDATE_LEASE="$box/lock" STUB_LOG="$box/stub.log" \
        bash "$SCRIPT" --checkout "$box/999-setup" "$@" 2>&1)"; RC=$?
  LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
}
has() { local rest="$1" sub; shift; for sub in "$@"; do case "$rest" in *"$sub"*) rest="${rest#*"$sub"}" ;; *) return 1 ;; esac; done; return 0; }
stubruns() { [ -f "$1/stub.log" ] && wc -l < "$1/stub.log" | tr -d ' ' || echo 0; }
headof() { git -C "$1/999-setup" rev-parse HEAD; }
snap() { (cd "$1" && find . -print0 | LC_ALL=C sort -z | xargs -0 stat -f '%N|%HT|%Lp|%z|%m' 2>/dev/null); }

# ---- 1. refuses on non-macOS, before anything is touched ----
B="$(newbox nonmac)"; publish 1.1.0; H0="$(headof "$B")"
S0="$(snap "$B/home")"
OUT="$(AUTO_UPDATE_UNAME=Linux HOME="$B/home" OPENCLAW_UPDATE_LEASE="$B/lock" STUB_LOG="$B/stub.log" bash "$SCRIPT" --checkout "$B/999-setup" 2>&1)"; RC=$?
LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
check "non-macOS refuses with rc 64" "$([ "$RC" = 64 ] && echo 0 || echo 1)" "$OUT"
check "non-macOS names result=REFUSED and the OS" "$(has "$LAST" 'result=REFUSED' 'Linux' && echo 0 || echo 1)" "$LAST"
check "non-macOS touches nothing (HEAD, stub, lock, HOME)" \
  "$([ "$(headof "$B")" = "$H0" ] && [ "$(stubruns "$B")" = 0 ] && [ ! -e "$B/lock" ] && [ "$(snap "$B/home")" = "$S0" ] && echo 0 || echo 1)"

# ---- 2. CURRENT: installed == latest ----
B="$(newbox current)"; H0="$(headof "$B")"
run "$B"
check "current: rc 0 and result=CURRENT" "$([ "$RC" = 0 ] && has "$LAST" 'result=CURRENT' 'before=v1.1.0' 'after=v1.1.0' 'latest=v1.1.0' && echo 0 || echo 1)" "$OUT"
check "current: skills-only not run, HEAD unchanged" "$([ "$(stubruns "$B")" = 0 ] && [ "$(headof "$B")" = "$H0" ] && echo 0 || echo 1)"

# ---- 3. installed AHEAD of latest is not behind ----
B="$(newbox ahead)"; printf '9.9.9\n' > "$B/999-setup/VERSION"
run "$B"
check "ahead: result=CURRENT, nothing run" "$([ "$RC" = 0 ] && [ "$(stubruns "$B")" = 0 ] && has "$LAST" 'result=CURRENT' 'before=v9.9.9' && echo 0 || echo 1)" "$OUT"

# ---- 4. behind: updates through --skills-only and nothing else; before/after printed ----
B="$(newbox behind)"; publish 1.2.0
S0="$(snap "$B/home")"
run "$B"
check "behind: rc 0, result=UPDATED with before and after versions" "$([ "$RC" = 0 ] && has "$LAST" 'result=UPDATED' 'before=v1.1.0' 'after=v1.2.0' 'latest=v1.2.0' && echo 0 || echo 1)" "$OUT"
check "behind: setup-macos.sh run exactly once with exactly --skills-only" "$([ "$(stubruns "$B")" = 1 ] && [ "$(cat "$B/stub.log")" = "--skills-only" ] && echo 0 || echo 1)" "$(cat "$B/stub.log" 2>/dev/null)"
check "behind: checkout is at origin main and VERSION reads 1.2.0" "$([ "$(headof "$B")" = "$(git -C "$ORIGIN" rev-parse main)" ] && [ "$(cat "$B/999-setup/VERSION")" = 1.2.0 ] && echo 0 || echo 1)"
check "behind: nothing in the fake HOME changed (no router, token, model, launcher write)" "$([ "$(snap "$B/home")" = "$S0" ] && echo 0 || echo 1)"
check "behind: lock released afterwards" "$([ ! -e "$B/lock" ] && echo 0 || echo 1)"

# ---- 5. idempotent: a second run is a no-op ----
run "$B"
check "second run: CURRENT, skills-only not run again" "$([ "$RC" = 0 ] && [ "$(stubruns "$B")" = 1 ] && has "$LAST" 'result=CURRENT' && echo 0 || echo 1)" "$OUT"

# ---- 6. --check is read-only ----
B="$(newbox check)"; publish 1.3.0; H0="$(headof "$B")"
run "$B" --check
check "--check behind: result=BEHIND, rc 0, checkout and lock untouched, nothing run" \
  "$([ "$RC" = 0 ] && [ "$(headof "$B")" = "$H0" ] && [ "$(stubruns "$B")" = 0 ] && [ ! -e "$B/lock" ] && has "$LAST" 'result=BEHIND' 'before=v1.2.0' 'latest=v1.3.0' && echo 0 || echo 1)" "$OUT"

# ---- 7. version compare is numeric, not text ----
publish 1.9.0; B="$(newbox numeric)"; publish 1.10.0
run "$B" --check
check "1.9.0 is behind 1.10.0 (numeric compare, not text)" "$(has "$LAST" 'result=BEHIND' 'before=v1.9.0' 'latest=v1.10.0' && echo 0 || echo 1)" "$OUT"

# ---- 8. lock: a live foreign owner defers, nothing is changed ----
B="$(newbox busy)"; publish 1.11.0; H0="$(headof "$B")"
bash -c '. "$1"; box_update_lock_acquire "$2" holder-run other-role /x 2>/dev/null; echo ready; exec sleep 60' _ "$HELPER" "$B/lock" > "$ROOT/holder.out" &
echo $! > "$ROOT/holder.pid"
for _ in $(seq 50); do grep -q ready "$ROOT/holder.out" 2>/dev/null && break; sleep 0.1; done
T0=$SECONDS; run "$B" --lock-wait 3; ELAPSED=$((SECONDS - T0))
check "busy lease: waited out the whole wait (not an immediate defer)" "$([ "$ELAPSED" -ge 3 ] && echo 0 || echo 1)" "elapsed ${ELAPSED}s, wanted >= 3"
check "busy lease: rc 75 result=DEFERRED, no update" "$([ "$RC" = 75 ] && [ "$(headof "$B")" = "$H0" ] && [ "$(stubruns "$B")" = 0 ] && has "$LAST" 'result=DEFERRED' && echo 0 || echo 1)" "$OUT"
check "busy lease: the other owner's record is left in place" "$([ -f "$B/lock" ] && grep -q '^run_id=holder-run' "$B/lock" && echo 0 || echo 1)"
kill "$(cat "$ROOT/holder.pid")" 2>/dev/null; wait 2>/dev/null
run "$B" --lock-wait 2
check "dead owner's lease is reclaimed and the update proceeds" "$([ "$RC" = 0 ] && has "$LAST" 'result=UPDATED' && echo 0 || echo 1)" "$OUT"
check "own lease is released after the update" "$([ ! -e "$B/lock" ] && echo 0 || echo 1)"

# ---- 8b. the owner releases mid-wait: the run waits, then takes the lease and updates ----
B="$(newbox midwait)"; publish 1.11.5
bash -c '. "$1"; box_update_lock_acquire "$2" holder-run other-role /x 2>/dev/null; echo ready; exec sleep 3' _ "$HELPER" "$B/lock" > "$ROOT/holder2.out" &
for _ in $(seq 50); do grep -q ready "$ROOT/holder2.out" 2>/dev/null && break; sleep 0.1; done
T0=$SECONDS; run "$B" --lock-wait 30; ELAPSED=$((SECONDS - T0))
wait 2>/dev/null
check "mid-wait release: UPDATED after waiting for the owner" "$([ "$RC" = 0 ] && has "$LAST" 'result=UPDATED' && [ "$ELAPSED" -ge 2 ] && echo 0 || echo 1)" "elapsed ${ELAPSED}s rc $RC: $LAST"
check "default wait is 30 minutes polled every 30 seconds" "$(grep -q 'LOCK_WAIT="\${AUTO_UPDATE_LOCK_WAIT:-1800}"' "$SCRIPT" && grep -q 'LOCK_POLL="\${AUTO_UPDATE_LOCK_POLL:-30}"' "$SCRIPT" && echo 0 || echo 1)"

# ---- 9. launched by the auto-update run that owns the lease: ride it, never release it ----
B="$(newbox inherit)"; publish 1.12.0
OUT="$(OPENCLAW_UPDATE_LEASE="$B/lock" HOME="$B/home" bash -c '. "$1"; box_update_lock_acquire "$2" auto-update-test auto-update /x 2>/dev/null || exit 9
  bash "$3" --checkout "$4" ; echo "LEASE_AFTER=$(grep -c "^run_id=auto-update-test" "$2")"' _ "$HELPER" "$B/lock" "$SCRIPT" "$B/999-setup" 2>&1)"; RC=$?
LAST="$(printf '%s\n' "$OUT" | grep '^AUTO-UPDATE-999' | tail -n 1)"
check "child of the lease owner updates without re-acquiring" "$(has "$LAST" 'result=UPDATED' && echo 0 || echo 1)" "$OUT"
check "child rode the owner's lease (inherited, did not re-acquire)" "$(printf '%s\n' "$OUT" | grep -q 'inherited .* from live ancestor' && echo 0 || echo 1)" "$OUT"
check "child never releases the parent's lease" "$(printf '%s\n' "$OUT" | grep -q '^LEASE_AFTER=1' && echo 0 || echo 1)" "$OUT"

# ---- 9b. the shared lock helper is missing: fail closed, nothing changed ----
B="$(newbox nohelper)"; publish 1.12.1; H0="$(headof "$B")"
OUT="$(HOME="$B/home" OPENCLAW_UPDATE_LEASE="$B/lock" AUTO_UPDATE_LOCK_HELPER="$ROOT/missing.sh" bash "$SCRIPT" --checkout "$B/999-setup" 2>&1)"; RC=$?
LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
check "no lock helper: rc 70 result=FAILED, nothing changed" "$([ "$RC" = 70 ] && [ "$(headof "$B")" = "$H0" ] && has "$LAST" 'result=FAILED' 'lock helper missing' && echo 0 || echo 1)" "$OUT"

# ---- 10. skills-only failure: non-zero with the reason, checkout put back, next run retries ----
B="$(newbox failrefresh)"; publish 1.13.0; H0="$(headof "$B")"
OUT="$(HOME="$B/home" OPENCLAW_UPDATE_LEASE="$B/lock" STUB_LOG="$B/stub.log" STUB_FAIL=7 bash "$SCRIPT" --checkout "$B/999-setup" 2>&1)"; RC=$?
LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
check "refresh failure: rc 69, result=FAILED, reason names the skills-only exit code" "$([ "$RC" = 69 ] && has "$LAST" 'result=FAILED' '--skills-only exited 7' && echo 0 || echo 1)" "$OUT"
check "refresh failure: checkout put back to the old commit and lock released" "$([ "$(headof "$B")" = "$H0" ] && [ "$(cat "$B/999-setup/VERSION")" = 1.12.1 ] && [ ! -e "$B/lock" ] && echo 0 || echo 1)"
run "$B"
check "after a failure the next run is still behind and retries to UPDATED" "$([ "$RC" = 0 ] && has "$LAST" 'result=UPDATED' 'before=v1.12.1' 'after=v1.13.0' && echo 0 || echo 1)" "$OUT"

# ---- 11. diverged checkout: fast-forward refused, nothing changed ----
B="$(newbox diverged)"; publish 1.14.0
git -C "$B/999-setup" reset -q --hard HEAD 2>/dev/null
echo local > "$B/999-setup/local.txt"; git -C "$B/999-setup" add -A; git -C "$B/999-setup" commit -q -m "local only"
H0="$(headof "$B")"; run "$B"
check "diverged checkout: rc 68 result=FAILED, HEAD unchanged, stub not run" "$([ "$RC" = 68 ] && [ "$(headof "$B")" = "$H0" ] && [ "$(stubruns "$B")" = 0 ] && has "$LAST" 'result=FAILED' && echo 0 || echo 1)" "$OUT"

# ---- 12. clear failures: no checkout, unreadable VERSION, fetch failure, bad usage ----
OUT="$(HOME="$ROOT/emptyhome" bash "$SCRIPT" --checkout "$ROOT/nowhere" 2>&1)"; RC=$?
check "no checkout: rc 65 with a reason" "$([ "$RC" = 65 ] && has "$OUT" 'result=FAILED' 'no 999-setup git checkout' && echo 0 || echo 1)" "$OUT"
B="$(newbox badver)"; : > "$B/999-setup/VERSION"
run "$B"
check "unreadable VERSION: rc 66 with a reason" "$([ "$RC" = 66 ] && has "$LAST" 'result=FAILED' 'VERSION' && echo 0 || echo 1)" "$OUT"
B="$(newbox nofetch)"; git -C "$B/999-setup" remote set-url origin "$ROOT/does-not-exist.git"
run "$B"
check "fetch failure: rc 67 with a reason" "$([ "$RC" = 67 ] && has "$LAST" 'result=FAILED' 'fetch' && echo 0 || echo 1)" "$OUT"
OUT="$(bash "$SCRIPT" --bogus 2>&1)"; RC=$?
check "bad argument: rc 2 with a reason" "$([ "$RC" = 2 ] && has "$OUT" 'unknown argument' && echo 0 || echo 1)" "$OUT"

# ---- 13. the real repo wires the real path: the script calls the real setup-macos.sh --skills-only ----
check "real setup-macos.sh exists where the updater looks for it" "$([ -f "$REPO/$STUB_REL" ] && echo 0 || echo 1)"
check "updater runs setup-macos.sh with --skills-only and no other flag" "$(grep -q '^bash "\$SETUP" --skills-only </dev/null' "$SCRIPT" && echo 0 || echo 1)"
check "updater passes no router, model, token or launcher flag to any command" "$(grep -v '^ *#' "$SCRIPT" | grep -qE -e '--(update-combos|deepseek-route|operator-remote-owner|repair-links|refresh-updater)' && echo 1 || echo 0)"

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ]
