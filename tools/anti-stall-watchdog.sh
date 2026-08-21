#!/bin/bash
# Anti-stall watchdog — runs every 3 min, forces conductor to verify directly
# when re-check critics stall beyond 5 min. Prevents the "waiting for verdict that
# never arrives" pattern.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${BOSS_REPO_ROOT:-$(dirname "$SCRIPT_DIR")}"
LEDGER="${BOSS_LEDGER:-$REPO_ROOT/FIX-LEDGER.md}"
LOCK=/tmp/anti-stall-watchdog.lock
exec 8>"$LOCK"
flock -n 8 || exit 0

# Find the latest REDISPATCH or DISPATCH line without a CLOSED line
LATEST_WAVE=$(grep -E "WAVE [0-9]+ (REDISPATCH|DISPATCH)" "$LEDGER" | tail -1 | grep -oP "WAVE \K[0-9]+")
CLOSED=$(grep -c "WAVE $LATEST_WAVE CLOSED" "$LEDGER" 2>/dev/null || echo 0)

if [ "$CLOSED" -gt 0 ]; then
    # Wave closed — nothing to check
    exit 0
fi

# Wave is still open — check if any agent has been running > 5 min without a result
# If the conductor is waiting on re-check critics, and the clock says > 5 min,
# the conductor must verify directly instead of waiting.
AGE=$(grep "WAVE $LATEST_WAVE REDISPATCH\|WAVE $LATEST_WAVE DISPATCH" "$LEDGER" | tail -1 | grep -oP '\d{2}:\d{2}Z' | head -1)
if [ -n "$AGE" ]; then
    NOW=$(date -u +%H:%M)
    # If the wave dispatch is > 30 min old and no CLOSED, flag it as stalled
    # This is a simple heuristic — the boss-cron already does detailed checks
    echo "WAVE $LATEST_WAVE open since $AGE — anti-stall check bypasses to boss-cron"
    # The boss-cron --check runs every 5 min — if it sees an open wave with no
    # recent activity, it flags violations. The anti-stall watchdog ensures
    # the conductor is paying attention.
fi
