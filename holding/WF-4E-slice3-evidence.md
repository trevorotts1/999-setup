# WF-4E slice 3 evidence — heartbeat alert wiring (Issue 18 FIX)

Commit: e37ad05 on fix/18-boss-cron — "boss-heartbeat-alert: watchdog fires operator Telegram alert when boss-cron goes silent (Issue 18 FIX, WAVE 4 DISPATCH 2026-08-16T20:12Z)"
Scope: this slice touches ONLY the heartbeat-alert mechanism. It does not touch boss-cron checks 1-8, the stop/restart machinery, or the wave table.

## The bar (spec QC, line 402)

"every seeded violation class was caught within one cycle, stopped, marked, and restarted from the named checkpoint; a clean cycle logs BOSSCYCLE-CLEAN; **a killed cron fires the heartbeat alert**."
The killed-cron clause is THIS slice. Spec PART 4 (line 557): "A heartbeat alert fires if the cron itself fails (no BOSSCYCLE-* line within two intervals → alert through the operator's Telegram bot chat id (wired channel))."

## The defect found (why the interim boss was blind)

Live interim boss /Users/blackceomacmini/work-999-setup/tools/boss-cron (read in full, 333 lines) has NO alert path: its heartbeat check (check_heartbeat, lines 203-217) only reports staleness as a violation to the ledger — it cannot fire if it is dead, because the ledger write is the thing that stops. Nothing else watches the ledger for BOSSCYCLE-* freshness. Evidence of the pre-fix state: backup at /Users/blackceomacmini/work-999-setup-fix/WF-4E/holding/boss-cron.live-20260816T1640Z.bak (pre-slice snapshot, live file at time of backup). Live boss log /Users/blackceomacmini/work-999-setup/CONTROL/boss-cron.log shows only clean cycles with no alert lines (verified 2026-08-16 20:40Z). A killed cron → silence → nothing fired. QC bar clause unmet.

## The fix (this slice)

New script /Users/blackceomacmini/work-999-setup/tools/boss-heartbeat-alert (installed live; source unit committed as tools/boss-heartbeat-alert, 156 lines) — an INDEPENDENT watchdog on its own cadence (*/2 crontab line) that reads the ledger's newest BOSSCYCLE-* line and fires when two boss intervals (10 min, PART 4) pass without one.

Alert transport — the operator's established alert doctrine, sourced from the live fleet implementation:
- ALWAYS through the OpenClaw gateway (`openclaw message send`), NEVER a raw api.telegram.org call. Rationale cited in the script header: the rescue-rangers bridge removed its raw-curl path in 2026-06-22 after the malformed bot URL 404 incident (fleet-heartbeat/scripts/heartbeat.sh lines 640-660 record the removal).
- Default target: Rescue Rangers group via RESCUE_RANGERS_HELP_CHAT_ID (secrets store, verified set; len 14). Account rescue-rangers (the operator box's alert identity; heartbeat.sh line 589 pattern: --account "${HEARTBEAT_TG_ACCOUNT:-rescue-rangers}").
- TEST MODE: BOSS_ALERT_TEST_MODE=1 pins the target to the operator DM (OWNER_CHAT_ID fallback 5252140759) — operator doctrine "test only on the operator account"; mirrors heartbeat.sh's smoke-test isolation (lines 548-556).
- Secret store sourced with set +u and stderr to /dev/null (rescue-receiver-run.sh pattern, lines 10-26): a malformed .env line can never abort the shell or leak a secret into the log.
- Spam guard: cooldown state file (CONTROL/boss-heartbeat-alert.state); alert fires at most once per ALERT_COOLDOWN_MIN (default 60) while the ledger stays stale; healthy ledger never alerts; no BOSSCYCLE line at all = first-run baseline, not an alarm.
- Resilient send: 3 attempts, growing backoff, 45s per-attempt cap (fleet-heartbeat send_attempt pattern).

## Verification (all run on the operator account only; nothing sent to the live group)

Test ledger: frozen copy at /tmp/watchdog-test/FIX-LEDGER.md with the newest BOSSCYCLE line rewritten to 12-13 minutes old; scratch state dir /tmp/watchdog-test. Script under test: the committed file (copied to /tmp).

1. Healthy path (live ledger, real paths): exit 0; log "ok: last BOSSCYCLE 3m ago (< 10m)" (20:53:22Z). No alert, no state write.
2. First-run baseline: ledger without any BOSSCYCLE line → "armed: no BOSSCYCLE-* line yet (fresh install baseline); not an alarm", exit 0.
3. Stale path (frozen ledger): "DRY-RUN: would send to 5252140759: [BOSS HEARTBEAT ALERT] boss-cron went silent — no BOSSCYCLE-* line for 12 min (max 10)..." — fires exactly when the ledger goes stale past the 10-min wall, and names the enforcer path and ledger in the payload. State file written.
4. Cooldown: immediate re-run → "stale 12m but in cooldown (last alert 0m ago); silent", exit 0 — no re-fire per interval.
5. Cooldown expiry (ALERT_COOLDOWN_MIN=0): alert fires again with the new timestamp — repeat-alert capability proven.
6. REAL SEND, test mode only (operator DM 5252140759, gateway path): "✅ Sent via telegram. Message ID: 532" at 20:52:57Z; script log "ALERT SENT to 5252140759 (age 12m)". The full production send path proven end-to-end through the OpenClaw gateway — the exact path the live cron entry uses. No message ever targeted the Rescue Rangers group during testing.
7. Production-mode target resolution: with the secrets store sourced, RESCUE_RANGERS_HELP_CHAT_ID non-empty (len 14) → non-test mode routes to the rescue group. Verified by name/length only; values never printed.
8. Syntax: bash -n clean after every edit. Executable bit 755 on live install.

## Live install state

- Script installed: /Users/blackceomacmini/work-999-setup/tools/boss-heartbeat-alert (755, bash -n clean, first live healthy run logged 20:53:22Z).
- Cron entry installed (line 58): */2 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-heartbeat-alert >> /Users/blackceomacmini/work-999-setup/CONTROL/boss-heartbeat-alert.log 2>&1
- Backup of prior crontab: /tmp/crontab-before.txt (58 lines, pre-watchdog).
- The watchdog writes nothing to the ledger (it is the boss's alarm, not a ledger writer); its own log is CONTROL/boss-heartbeat-alert.log.
- Existing boss-cron crontab line (57) untouched. Stop/restart machinery untouched. Hook-protection clause intact — no settings.json hook touched.

## File/line citations

- Spec PART 4 line 557 (heartbeat alert clause), line 565 (packaging: script + cron entry), line 402 (QC bar "a killed cron fires the heartbeat alert"), line 398 (boss "is itself governed").
- Live boss-cron: /Users/blackceomacmini/work-999-setup/tools/boss-cron lines 203-217 (check_heartbeat — report-only, no alert path).
- Doctrine sources: fleet-heartbeat/scripts/heartbeat.sh lines 524-556 (RESCUE_RANGERS_HELP_CHAT_ID target + smoke-test isolation), 587-601 (send_attempt: gateway send, account rescue-rangers, timeout), 640-660 (raw-curl removal); rescue-receiver-run.sh lines 10-26 (set +u secret sourcing); rescue-rangers-escalation-channel.md memory (RESCUE_RANGERS_HELP_CHAT_ID env var, group chat).
- Operator secrets: /Users/blackceomacmini/.openclaw/secrets/.env line 364 RESCUE_RANGERS_HELP_CHAT_ID (set; value never printed), line 399 RESCUE_RANGERS_CHAT_ID (set; value never printed), line 365 OWNER_CHAT_ID (set; value never printed).

## Verification of the QC bar clause

"a killed cron fires the heartbeat alert" — proven by the stale-path tests (3-5 above) plus the real test-mode send (6). A killed boss-cron leaves the ledger's newest BOSSCYCLE line older than 10 minutes; the independent watchdog fires within its 2-minute cadence. The live group was never touched by any test.

VERDICT: DONE
