# Candice Companion — Watchdog Proof (V8 deterministic singleton)

Date: 2026-08-21. Agent: reconciliation agent (Candice Companion build).

## Verdict lines

- WATCHDOG_SCHEDULE_COUNT=1
- WATCHDOG_INTERVAL=600
- WATCHDOG_OVERLAP=0

## Mechanism

One deterministic watchdog, the fixed census governor `tools/boss-cron`
(worktree copy `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap/tools/boss-cron`),
driven by exactly one macOS LaunchAgent:

- Plist: `/Users/blackceomacmini/Library/LaunchAgents/com.blackceo.candice-watchdog.plist`
- Label: `com.blackceo.candice-watchdog`
- ProgramArguments: `/usr/bin/python3 <worktree>/tools/boss-cron`
- StartInterval: 600 (seconds)
- RunAtLoad: false
- StandardOutPath/StandardErrorPath: `/Users/blackceomacmini/Library/Logs/candice-watchdog.log`
- EnvironmentVariables: BOSS_REPO_ROOT, BOSS_STATE_DIR, BOSS_LEDGER, BOSS_CONFIG,
  BOSS_RUN_STALENESS_SECONDS=1800, BOSS_WF_ROOT=(default), BOSS_ALERT_DRY_RUN=1
  (dry-run alert: a live tick records the alert intent without sending — test mode
  never fires the live alert path).

boss-cron is deterministic Python (16 checks: caps, census, width, wavelock, claims,
beat, stop, scope, kill, count, drift, orphan, stages, entry-mode, statusline,
research). It spawns ZERO LLM agents per tick. Its env-override contract:
BOSS_REPO_ROOT, BOSS_STATE_DIR, BOSS_LEDGER, BOSS_WF_ROOT, BOSS_CONFIG,
BOSS_RUN_STALENESS_SECONDS. (BOSS_CENSUS_SCRIPT is NOT a boss-cron env var — grep
over the worktree copy, the root repo copy, and the live work-999 copy returns zero
hits in all three; the census is computed internally from BOSS_WF_ROOT journal
roots.)

## Overlap proof (WATCHDOG_OVERLAP=0)

Two layers:

1. launchd guarantee (single agent): StartInterval schedules ONE instance at a time;
   if a run exceeds 600s, launchd does not start a second instance — the next start
   is skipped until the interval after the previous one exits. Proven by design; the
   service was still `runs = 0` at proof time, so no launchd-run overlap could have
   occurred.

2. flock singleton guard added to the worktree boss-cron (backup:
   `tools/boss-cron.bak-pre-watchdog-flock-20260821`): POSIX flock via python fcntl on
   `CONTROL/.boss-cron.lock`, acquired non-blocking immediately after STATE_DIR is
   derived. A second invocation holding no lock exits 0 immediately with:
   `boss-cron: another cycle holds the singleton lock (...) skipping this tick (WATCHDOG_OVERLAP=0)`.
   The lock is released by the OS on process exit (even SIGKILL), so a crashed cycle
   cannot wedge the watchdog — only a LIVE overlapping cycle is blocked.

   Live overlap test (2026-08-21):
   ```
   $ (flock holder held CONTROL/.boss-cron.lock in background, pid 62294) + invoke boss-cron
   boss-cron: another cycle holds the singleton lock (/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap/CONTROL/.boss-cron.lock); skipping this tick (WATCHDOG_OVERLAP=0)
   overlap-invocation-rc=0
   ```
   The skipped invocation exited 0 and wrote nothing to the ledger.

## Load proof

```
$ launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.blackceo.candice-watchdog.plist   (rc=0)
$ launchctl print gui/501/com.blackceo.candice-watchdog
gui/501/com.blackceo.candice-watchdog = {
	active count = 0
	path = /Users/blackceomacmini/Library/LaunchAgents/com.blackceo.candice-watchdog.plist
	type = LaunchAgent
	state = not running
	program = /usr/bin/python3
	arguments = { /usr/bin/python3 .../tools/boss-cron }
	environment = { BOSS_ALERT_DRY_RUN=1, BOSS_STATE_DIR=..., BOSS_RUN_STALENESS_SECONDS=1800,
	                BOSS_WF_ROOT=, BOSS_REPO_ROOT=..., BOSS_CONFIG=..., BOSS_LEDGER=... }
	run interval = 600 seconds
	runs = 0
	last exit code = (never exited)
}
```

`run interval = 600 seconds` = the required 600s interval. `runs = 0`: the interval
tick has not fired yet at proof time (RunAtLoad=false, first scheduled run lands at
the 600s mark). One LaunchAgent, one schedule — WATCHDOG_SCHEDULE_COUNT=1.

## Manual-run evidence

Manual run with the identical plist env (BOSS_ALERT_DRY_RUN=1), 2026-08-21:

```
$ boss-cron (env as plist)
boss-cron cycle 2026-08-21T14:00:55Z: 6 violation(s), 0 kill(s), ledger appended
rc=2   (governance-exit contract: violations -> exit 2)
```

Ledger line appended by that run (FIX-LEDGER.md, worktree copy):
```
- `BOSSCYCLE-VIOLATION 2026-08-21T14:00:55Z: 6 finding(s) recorded above; checks=caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,stages,entry-mode,statusline,research`
```
The run executed all 16 checks, found the 6 standing ledger findings (heartbeat
stale in the worktree ledger + entry-mode/research violations for the
blackceo-com-website project), appended its cycle line, and exited 2 per the
governance-exit contract. It spawned zero LLM agents. Heartbeat alert dry-run only.

## Prior-epoch crontab distinction

The pre-existing crontab entries below belong to the 999-master-fix epoch and are
LEFT UNTOUCHED (they are NOT candice watchdogs; they drive the LIVE
`/Users/blackceomacmini/work-999-setup` copy, not this worktree):

```
*/5 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-cron >> .../boss-cron.log 2>&1
*/2 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-heartbeat-alert >> .../boss-heartbeat-alert.log 2>&1
*/3 * * * * /Users/blackceomacmini/work-999-setup/tools/anti-stall-watchdog.sh > /dev/null 2>&1
```

No other candice/compliance cron remains (the old 5-minute audit cron was deleted
prior to this reconciliation). No other candice LaunchAgent exists. The only
candice watchdog on any schedule is this LaunchAgent: count = 1.

## Scope of changes (corrected 2026-08-21 — QC-FIX ROUND 1)

- Worktree copy `tools/boss-cron`: +fcntl/+tempfile imports, flock singleton guard
  (~25 lines). Backup: `tools/boss-cron.bak-pre-watchdog-flock-20260821` (worktree
  `tools/`, pre-flock content, zero flock/fcntl hits).
- New: `~/Library/LaunchAgents/com.blackceo.candice-watchdog.plist`, loaded.
- New: this proof file.
- **CORRECTION (2026-08-21):** the original "NOT touched ... root repo copy" claim
  below was FALSE. The root repo copy `/Users/blackceomacmini/Downloads/999-setup/tools/boss-cron`
  WAS synced from the worktree copy after the flock guard landed (two-truth
  consolidation, 2026-08-21) and now carries the identical flock guard:
  `grep -c "flock\|fcntl"` = 4 in both copies, `cmp` root vs worktree =
  byte-identical (68,494 bytes, root mtime 2026-08-21 10:05 after worktree 09:59).
  A named root backup has been created: `tools/boss-cron.bak-pre-watchdog-flock-20260821`
  (root side, 2026-08-21, pre-flock content, zero flock/fcntl hits).
- NOT touched (verified on disk 2026-08-21): live copy
  `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (zero flock/fcntl, zero
  BOSS_CENSUS_SCRIPT), all prior-epoch crontab entries, no secrets printed.
