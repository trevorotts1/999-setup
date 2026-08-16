# WF-4E slice 1 evidence — full 8-check boss-cron (Issue 18 FIX, WAVE 4 DISPATCH 2026-08-16T20:12Z)

Slice: FIX — boss cron design in PART 4. Upgrade interim boss to the full 8-check
boss. Target: /Users/blackceomacmini/work-999-setup/tools/boss-cron (cron-installed path
per PART 4 packaging; WAVE 0 BOOTSTRAP same path).

## Audit: interim boss vs PART 4 8-check list (before this slice)

Interim boss (9 checks: caps,census,width,wavelock,claims,beat,stop,scope,kill) mapped
against PART 4's eight checks:

| PART 4 check | Interim boss | Verdict |
|---|---|---|
| 1 SCOPE (20-list + sanctioned allowlist) | check_scope + SANCTIONED_CLASSES | GAP: allowlist missing FUNNEL-*, 3JS-*, STAGE-*, MOBBIN-CHECK, DESIGN-BRIEF, ENTRY-MODE, BUILD-TARGET, INPUT-CAPTURED, STATUSLINE-*, AK-*, PAYMENT-CONTRACT, INTERVIEW-MODE (spec line 538) |
| 2 WAVE (locked table + NEW-WAVE-N) | check_wave_lock | GAP: no NEW-WAVE-N escape — a wave 7+ dispatch without the dependency line never fires |
| 3 COUNT (promised vs asked) | — absent | GAP: check missing entirely |
| 4 WIDTH (scripted width + no padding) | check_width | GAP: padding clause missing; ALSO latent bug: wave 4+ double-digit composition produced "WF-44A" |
| 5 CLAIM (final-report vs ledger lines) | check_claims | present (paths exist) |
| 6 DRIFT (contentless ticks + reconcile) | — absent | GAP: check missing entirely |
| 7 ORPHAN (media 1:1:1:1) | — absent (draft existed in WF-3E clone) | GAP: not in live script |
| 8 STATUSLINE (both stores after Wave 6) | — absent | GAP: check missing entirely |
| governed-too (heartbeat alert) | — absent | GAP: no Telegram alert (slice 3 wired boss-heartbeat-alert separately) |

## Gaps closed by this slice (all in /Users/blackceomacmini/work-999-setup/tools/boss-cron)

1. Scope allowlist: SANCTIONED_CLASSES gains MOBBIN-CHECK, DESIGN-BRIEF, ENTRY-MODE,
   BUILD-TARGET, INPUT-CAPTURED, PAYMENT-CONTRACT, INTERVIEW-MODE + media classes;
   SCOPE_PREFIX_RE covers FUNNEL-*, 3JS-*, STAGE-*, STATUSLINE-*, AK-*. ledger_class()
   now strips the trailing colon (both 'CLASS' and 'CLASS:' shapes match). The old
   generic trailing-colon tolerance (any colon class < 60 chars) is REMOVED — it let
   arbitrary bogus classes with colons pass; STAGE-* is now explicitly matched.
2. Wave lock: NEW-WAVE-N dependency lines exempt a wave beyond the locked count
   (LOCKED_WAVE_COUNT=6); wave N+1-before-N-CLOSED still fires. Dispatch lines are
   now recognized by shape (WAVE n DISPATCH/REDISPATCH | bare DISPATCH | WF-xY REPAIR
   DISPATCH) — a citation line ('... Cites WAVE 3 REDISPATCH.') no longer hijacks
   the tables.
3. Count check (check_questions): 'Question N of … C' with N > C fires
   count violation (PART 4 check 3 / Issue 11).
4. Width: padding detection — a dispatch naming more builders/critics than the
   locked per-workflow width fires width violation. Fixed WF-44A double-digit bug:
   workflow names now matched as word-boundary tokens (\bWF-4A\b).
5. Drift (check_drift): > 10 consecutive contentless heartbeat ticks fires
   (Issue 13 FIX 2; anchor.sh TICK classifier semantics); per-wave boundary
   reconcile — each wave N>=2 must carry a RECONCILE/RE-ANCHOR line between
   WAVE N-1 CLOSED and its own dispatch (PART 4 check 6). Enforcement-epoch
   guard: waves dispatched before the boss's first live cycle are exempt
   (no retroactive judgement; enforcement starts at install).
6. Orphan (check_orphans, ported from WF-3E draft): MANIFEST-ROW / IMAGE-GENERATED /
   GHL-URL / IMAGE-REF 1:1:1:1 + expired KI.ai temp URL without GHL upload
   (PART 4 check 7 / Issue 10). status=gap rows sanctioned.
7. Statusline (check_statusline): after WAVE 6, statusLine key must exist in BOTH
   ~/.claude/settings.json and ~/.claude-nine/settings.json (name-only, never
   values); STATUSLINE-REMOVED-<reason> ledger line exempts (PART 4 check 8).
8. Stages (check_stages, ported from WF-3C draft): STAGE-BUILD without prior stage
   lines fires; STAGE-LOGO transparency acceptance checked mechanically.
9. Entry-mode (check_entry_mode, ported from WF-2A draft): run-carrying project
   folders must carry ENTRY-MODE: interview|pointed. Epoch exemption: runs that
   STARTED before WAVE 2 DISPATCH 2026-08-16T14:02Z (the gate wave) are exempt —
   verified against live ~/Downloads/projects/blackceo-com-website (started
   2026-08-15T18:30Z, pre-gate: exempt, no false positive).
10. Heartbeat alert (send_heartbeat_alert): when no BOSSCYCLE-* line exists within
    two intervals, the next live cycle sends the operator Telegram alert
    (TELEGRAM_ALERTS_BOT_TOKEN -> OWNER_CHAT_ID; env-absent = skip, never crash)
    and writes a BOSSCYCLE-ALERT ledger line. Complement to slice 3's
    boss-heartbeat-alert watchdog (cron */2).

## Latent bugs found and fixed (proven by seeded tests)

- dispatch classification: check_dispatch_census/check_width/check_wave_lock keyed
  on ledger_class() = first token, but real wave dispatches carry class WAVE
  ('- `WAVE 3 DISPATCH ...'), bare class DISPATCH, or WF-1A REPAIR DISPATCH —
  the word "DISPATCH" never appears as class for the main wave lines, so all three
  dispatch-keyed checks were latent no-ops on the live ledger. is_dispatch_line()
  recognizes the real shapes; citation lines excluded (verified on live ledger:
  12 dispatch lines classified True, slice-citation lines False).
- WF-44A double-digit width composition (wave 4+).
- ledger_class colon shape mismatch vs allowlist.
- generic colon tolerance removed (scope loophole).
- timestamp parse: live ledger uses seconds-less '2026-08-16T09:05Z' — added
  fallback format.

## Verification

1. python3 -m py_compile: OK.
2. boss-cron --check on live ledger: 0 violations, exit 0. Checks run:
   caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,
   stages,entry-mode,statusline (15 check families, all 8 PART 4 checks covered).
3. Seeded-violation suite (23 assertions, all PASS) — each check fires on its
   seeded violation and stays quiet on clean input:
   count overflow + in-range; width padding + full-width; wave-7 escape + NEW-WAVE-7
   exemption; scope sanctioned allowlist + bogus class; dispatch classifier on real
   ledger shapes; census on wave dispatch + with-census; orphan unreferenced upload +
   clean 1:1:1:1; statusline both-present / missing / removed-line / pre-wave-6 inert;
   drift 11 contentless ticks + contentful ticks; stages early STAGE-BUILD + ordered;
   entry-mode pre-gate exempt + post-gate caught.
   Transcript: /tmp/wf4e-s1-test/ (in-progress artifacts, not committed).
4. Live cycle 2026-08-16T20:57:28Z: 0 violations, BOSSCYCLE-CLEAN appended
   (checks=caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,
   stages,entry-mode,statusline). Cron entry */5 points at this script; heartbeat
   watchdog */2 green (20:56:00Z ok: last BOSSCYCLE 1m ago).
5. Backup before write: /Users/blackceomacmini/work-999-setup/tools/boss-cron.bak-pre-wf4e-slice1
   (md5 8038937285eaf50f11a17712dacdfaad = pre-write live file).

## Concurrent-slice notes

- Slice 2 (checkpoint naming) and slice 3 (boss-heartbeat-alert + epoch file) landed
  in the live script during this slice; merged, not clobbered (dedupe + checkpoint
  restart naming preserved; slice 3's separate watchdog tool untouched).
- The enforcement-epoch file CONTROL/boss-cron-enforcement-epoch was written by a
  concurrent live cycle at 20:55Z; the drift check's pre-epoch exemption uses it.

Cites WAVE 4 DISPATCH 2026-08-16T20:12Z. Evidence file: holding/WF-4E-slice1-evidence.md.
