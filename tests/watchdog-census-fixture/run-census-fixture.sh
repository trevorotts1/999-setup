#!/bin/bash
# run-census-fixture.sh — watchdog census regression fixture.
#
# Proves the boss-cron live-agent census counts ONLY actually-live/current
# workflow runs and agents: dead historical run dirs must not inflate the
# live count (the 2026-08-21 false positive: 900+ phantom "live" agents from
# long-finished aborted run dirs -> cap-violation storm).
#
# Fixture (all synthetic, secret-free), three run classes:
#   STALE  — started-without-result agents, journal mtime ancient, no
#            terminal record (the aborted-run shape the old census
#            miscounted; session died before the harness wrote its record).
#   ENDED  — FRESH journals + a terminal run record at the harness's real
#            location <session>/workflows/<runId>.json, status
#            completed|killed (runs that finished normally).
#   LIVE   — fresh journals, started-without-result agents, no terminal
#            record (in-progress runs).
#
# The live-agent census must count LIVE agents only. STALE agents are dead
# by the staleness window (journal recency backstop); ENDED agents are dead
# by their terminal run record.
#
# Assertions:
#   1. Fixed census reports live == M_LIVE * LIVE_AGENTS_PER_RUN — STALE and
#      ENDED run dirs contribute zero.
#   2. Fixed census reports zero unverifiable agents (every fixture agent
#      carries its meta file).
#   3. The OLD census (base tools/boss-cron) counts STALE + ENDED agents and
#      trips the 500-agent cap — proving the fixture discriminates and that
#      the old implementation FAILS this test by construction.
#
# Runner contract: builds the fixture, runs the fixed census in fixture mode
# (BOSS_WF_ROOT points at the fixture; BOSS_RUN_STALENESS_SECONDS pins the
# staleness window; BOSS_STATE_DIR/BOSS_LEDGER/BOSS_CONFIG point at a scratch
# dir so the run touches NOTHING in the repo), compares output, exits 0 on
# pass, non-zero with the failure named on fail.
#
# The census under test can be pointed elsewhere via BOSS_CENSUS_SCRIPT (the
# fix unit runs the same runner against its own checkout). Default: this
# worktree's tools/boss-cron.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="$(cd "$HERE/../.." && pwd)"                       # worktree root
FIXED_BOSS="${BOSS_CENSUS_SCRIPT:-$WT/tools/boss-cron}"
# Base (pre-fix) boss-cron: extracted below into the scratch dir ($WORK) — the
# census under test and this fixture landed in the same commit, so the old
# implementation only exists in git history (parent of the commit that added the
# fixture). The in-tree tools/boss-cron is the FIXED census; running it here
# would make the regression gate (assertion 3) fail by construction. Extracted
# to scratch so the repo tree is never written.
PY=/usr/bin/python3

# ---- fixture parameters (synthetic; tunable, never the assertion logic)
N_STALE=20
STALE_AGENTS_PER_RUN=30            # 20 x 30 = 600 phantom agents > cap 500
K_ENDED=5
ENDED_AGENTS_PER_RUN=2             # fresh journals + terminal records
M_LIVE=3
LIVE_AGENTS_PER_RUN=2
STALENESS=1800                     # window seconds; matches the fixed default

# ---- scratch (rebuilt every run; never touches the repo)
WORK="$(mktemp -d /tmp/watchdog-census-fixture.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
SESSION="$WORK/session-store/-Users-blackceomacmini"
ROOT="$SESSION/subagents/workflows"
RECORDS="$SESSION/workflows"       # harness run records live one level up
mkdir -p "$ROOT" "$RECORDS" "$WORK/state" "$WORK/ledger"

OLD_BOSS="$WORK/old-boss-cron.base"
# Extract the pre-fix census from git (the commit that introduced the fixture's
# parent fix carried both; its parent still counts every journal agent). Fail
# closed: a missing base instrument must abort, not silently weaken the gate.
if [ -z "${OLD_BOSS_SOURCE:-}" ]; then
    BASE_COMMIT="$(git -C "$WT" log --diff-filter=A --format=%H -1 -- tests/watchdog-census-fixture/run-census-fixture.sh)"
    if [ -n "$BASE_COMMIT" ] && git -C "$WT" cat-file -e "$BASE_COMMIT^:tools/boss-cron" 2>/dev/null; then
        git -C "$WT" show "$BASE_COMMIT^:tools/boss-cron" > "$OLD_BOSS" || OLD_BOSS=""
    fi
else
    cp "$OLD_BOSS_SOURCE" "$OLD_BOSS" || OLD_BOSS=""
fi
if [ ! -s "$OLD_BOSS" ]; then
    echo "FAIL: cannot produce the base (pre-fix) boss-cron for the regression gate"
    echo "      (git history unavailable and OLD_BOSS_SOURCE unset or unusable)"
    exit 1
fi

echo "== watchdog census fixture =="
echo "   stale run dirs:  $N_STALE x $STALE_AGENTS_PER_RUN agents (no records, journals ancient)"
echo "   ended run dirs:  $K_ENDED x $ENDED_AGENTS_PER_RUN agents (terminal records, journals fresh)"
echo "   live run dirs:   $M_LIVE x $LIVE_AGENTS_PER_RUN live agents (journals fresh)"
echo "   expected live:   $((M_LIVE * LIVE_AGENTS_PER_RUN))"

# ---- 1. STALE runs: started-without-result agents, journal mtime ancient,
#        no terminal record — the aborted-run shape the old census inflated.
i=0
while [ "$i" -lt "$N_STALE" ]; do
    d="$ROOT/wf_stale-$(printf '%04d' "$i")"
    mkdir -p "$d"
    j="$d/journal.jsonl"
    n=0
    while [ "$n" -lt "$STALE_AGENTS_PER_RUN" ]; do
        aid="dead$i-$n"
        echo "{\"type\":\"started\",\"key\":\"k$i-$n\",\"agentId\":\"$aid\"}" >> "$j"
        echo '{"model":"opus"}' > "$d/agent-$aid.meta.json"
        n=$((n + 1))
    done
    touch -t 202001010000 "$j"    # journal never moved -> stale beyond window
    i=$((i + 1))
done

# ---- 2. ENDED runs: FRESH journals with started-without-result agents, plus
#        the terminal run record the harness writes at
#        <session>/workflows/<runId>.json (status completed | killed).
i=0
while [ "$i" -lt "$K_ENDED" ]; do
    d="$ROOT/wf_ended-$(printf '%04d' "$i")"
    mkdir -p "$d"
    j="$d/journal.jsonl"
    n=0
    while [ "$n" -lt "$ENDED_AGENTS_PER_RUN" ]; do
        aid="ended$i-$n"
        echo "{\"type\":\"started\",\"key\":\"e$i-$n\",\"agentId\":\"$aid\"}" >> "$j"
        echo '{"model":"opus"}' > "$d/agent-$aid.meta.json"
        n=$((n + 1))
    done
    if [ $((i % 2)) -eq 0 ]; then st="completed"; else st="killed"; fi
    echo "{\"runId\":\"wf_ended-$(printf '%04d' "$i")\",\"status\":\"$st\",\"agentCount\":$ENDED_AGENTS_PER_RUN}" \
        > "$RECORDS/wf_ended-$(printf '%04d' "$i").json"
    i=$((i + 1))
done

# ---- 3. LIVE runs: fresh journals; per run, LIVE_AGENTS_PER_RUN started
#        with no result (counted), plus one started+result pair (not counted).
i=0
while [ "$i" -lt "$M_LIVE" ]; do
    d="$ROOT/wf_live-$(printf '%04d' "$i")"
    mkdir -p "$d"
    j="$d/journal.jsonl"
    n=0
    while [ "$n" -lt "$LIVE_AGENTS_PER_RUN" ]; do
        aid="live$i-$n"
        echo "{\"type\":\"started\",\"key\":\"l$i-$n\",\"agentId\":\"$aid\"}" >> "$j"
        echo '{"model":"sonnet"}' > "$d/agent-$aid.meta.json"
        n=$((n + 1))
    done
    echo "{\"type\":\"started\",\"key\":\"done$i\",\"agentId\":\"fin$i\"}" >> "$j"
    echo "{\"type\":\"result\",\"key\":\"done$i\",\"agentId\":\"fin$i\",\"result\":\"ok\"}" >> "$j"
    echo '{"model":"sonnet"}' > "$d/agent-fin$i.meta.json"
    i=$((i + 1))
done

# ---- 4. run the FIXED census in fixture mode (--check in argv => the module
#        never copies the example config; scratch state/ledger keep the cycle
#        off the repo entirely). Report live/unknown via the module API.
FIXED_OUT=$(BOSS_WF_ROOT="$ROOT" \
    BOSS_RUN_STALENESS_SECONDS="$STALENESS" \
    BOSS_STATE_DIR="$WORK/state" \
    BOSS_LEDGER="$WORK/ledger/FIX-LEDGER.md" \
    BOSS_CONFIG="$WORK/state/boss-config.json" \
    "$PY" - "$FIXED_BOSS" <<'PYEOF'
import sys
from importlib.machinery import SourceFileLoader
path = sys.argv[1]
sys.argv = ["boss-cron", "--check"]          # --check: load never writes
m = SourceFileLoader("fixture_boss", path).load_module()
live, unknown = m.check_caps()
print("LIVE=" + str(sum(live.values())))
print("BY_MODEL=" + ",".join(f"{k}:{v}" for k, v in sorted(live.items())))
print("UNKNOWN=" + str(len(unknown)))
PYEOF
)
FIXED_RC=$?
FIXED_LIVE=$(echo "$FIXED_OUT" | sed -n 's/^LIVE=//p')
FIXED_UNKNOWN=$(echo "$FIXED_OUT" | sed -n 's/^UNKNOWN=//p')

echo ""
echo "== fixed census ($FIXED_BOSS) =="
echo "$FIXED_OUT" | sed 's/^/   /'
if [ -z "$FIXED_LIVE" ]; then
    echo "FAIL: fixed census produced no live count (rc=$FIXED_RC)"
    exit 1
fi

# ---- 5. assertion: live == M_LIVE only; STALE and ENDED dirs contribute zero.
EXPECTED=$((M_LIVE * LIVE_AGENTS_PER_RUN))
if [ "$FIXED_LIVE" -ne "$EXPECTED" ]; then
    echo "FAIL: fixed census reports $FIXED_LIVE live agents, expected $EXPECTED (stale/ended run dirs must not count)"
    echo "      dead agents counted: $((FIXED_LIVE - EXPECTED)) from STALE (old journals) and/or ENDED (terminal records) run dirs"
    exit 1
fi
if [ "$FIXED_UNKNOWN" -ne 0 ]; then
    echo "FAIL: fixed census reports $FIXED_UNKNOWN unverifiable agents, expected 0 (every fixture agent carries meta)"
    exit 1
fi
echo "PASS: live == $EXPECTED (stale + ended run dirs ignored)"

# ---- 6. prove the fixture discriminates: the OLD census must count the
#        STALE + ENDED agents and trip the 500 cap. If it does NOT, the
#        fixture does not exercise the bug and the test is worthless.
OLD_OUT=$(BOSS_WF_ROOT="$ROOT" \
    BOSS_RUN_STALENESS_SECONDS="$STALENESS" \
    BOSS_STATE_DIR="$WORK/state" \
    BOSS_LEDGER="$WORK/ledger/FIX-LEDGER.md" \
    BOSS_CONFIG="$WORK/state/boss-config.json" \
    "$PY" - "$OLD_BOSS" <<'PYEOF'
import sys
from importlib.machinery import SourceFileLoader
path = sys.argv[1]
sys.argv = ["boss-cron", "--check"]
m = SourceFileLoader("old_boss", path).load_module()
live, unknown = m.check_caps()
print("LIVE=" + str(sum(live.values())))
print("CAP=" + str(m.CAPS.get("total")))
PYEOF
)
OLD_RC=$?
OLD_LIVE=$(echo "$OLD_OUT" | sed -n 's/^LIVE=//p')
OLD_CAP=$(echo "$OLD_OUT" | sed -n 's/^CAP=//p')
echo ""
echo "== old census (must fail this fixture — regression gate) =="
echo "$OLD_OUT" | sed 's/^/   /'
if [ -z "$OLD_LIVE" ]; then
    echo "FAIL: old census produced no live count (rc=$OLD_RC) — instrument broken, cannot gate"
    exit 1
fi
if [ "$OLD_LIVE" -le "$OLD_CAP" ]; then
    echo "FAIL: old census counted $OLD_LIVE live agents (<= cap $OLD_CAP) — fixture does not reproduce the false positive; test cannot prove the fix"
    exit 1
fi
echo "GATE: old census counted $OLD_LIVE live agents (> cap $OLD_CAP) — the false positive is reproduced; the old implementation FAILS this fixture"

echo ""
echo "== RESULT: PASS (live == $EXPECTED; stale + ended run dirs ignored; old impl demonstrably wrong) =="
exit 0
