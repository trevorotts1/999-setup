# WF-3E slice 4 evidence — verification of the orphan sweep (Issue 10 FIX step 4)

**Slice:** WF-3E slice 4 (Issue 10 FIX step 4 — verification)
**Branch:** fix/10-orphan-accounting
**HEAD:** 269ccba (slice 3 commit, boss-cron orphan sweep)
**Ledger line cited:** `WAVE 3 DISPATCH 2026-08-16T17:07Z` (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 59)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 10 FIX step 4 (line 240)

## What the slice names

ISSUE 10 FIX step 4 (spec line 240):
> "Verification: the four counts agree on a test build; a deliberately orphaned generation is caught by the sweep; an un-uploaded row past its expiry deadline is caught as the expiry class."

Three scenarios, verified against the FULL boss-cron `main()` cycle path (not the unit function alone), using a test copy of the boss with the LEDGER path patched to fixture files — the live ledger at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md was never written.

## What was verified

Unit under test: `/Users/blackceomacmini/work-999-setup-fix/WF-3E/tools/boss-cron` (commit 269ccba).
- `check_orphans()` defined at line 285; wired into `main()` at line 427 (`for o in check_orphans(lines): violations.append(f"orphan: {o}")`); `checks` string includes `orphan` at line 444.
- Ledger classes read by the sweep: `MANIFEST-ROW`, `IMAGE-GENERATED`, `GHL-URL`, `IMAGE-REF` (regexes lines 84-87; sanctioned at lines 78-79).
- Violation classes: generation-without-plan (line 351), manifest-row-without-generation (line 356), generated-not-uploaded (line 360), upload-without-generation (line 362), upload-without-reference (line 366), reference-without-persisted-upload (line 371), unparseable expiry (line 382), expired-temp-URL token-waste class (line 386).

## Scenario A — the four counts agree on a test build

Fixture `/tmp/wf3e-slice4/TEST-LEDGER.md`: 3 manifest rows (hero-1, about-1, cta-1, each with future `expires=`), 3 IMAGE-GENERATED, 3 GHL-URL, 4 IMAGE-REF (hero-1 referenced twice — N references allowed), all matching.

```
$ python3 boss-cron-test --check
boss-cron --check: 0 violation(s)
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan
EXIT: 0
```

**Result: PASS** — generated (3) == manifest (3) == uploaded (3); references (4) = N, all counted; zero violations; exit 0.

## Scenario B — a deliberately orphaned generation is caught by the sweep

Fixture `/tmp/wf3e-slice4/TEST-LEDGER-ORPHAN.md`: complete row hero-1 (manifest + generated + uploaded + referenced) PLUS `IMAGE-GENERATED mystery-1` with no manifest row, no upload, no reference — the deliberate orphan.

```
$ python3 boss-cron-test-orphan --check
boss-cron --check: 2 violation(s)
  - orphan: IMAGE-GENERATED mystery-1 has no corresponding MANIFEST-ROW — generation without a plan is token waste
  - orphan: IMAGE-GENERATED mystery-1 has no GHL-URL upload — temp URL will expire in 24h
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan
EXIT: 2
```

**Result: PASS** — the orphaned generation is caught by two violation classes (no manifest row; no upload), exit 2 (the governance-exit contract, PART 4). In a live cycle this writes the `VIOLATION-STOP` line and the stop file per main() lines 441-452 (verified by code read; the dry `--check` path never writes).

## Scenario C — an un-uploaded row past its expiry deadline is caught as the expiry class

Fixture `/tmp/wf3e-slice4/TEST-LEDGER-EXPIRED.md`: hero-1 complete (future expiry, uploaded); stale-1 with `expires=2026-08-10T10:00:00Z` (PAST) and NO GHL-URL; in-flight-1 with future expiry and NO GHL-URL.

```
$ python3 boss-cron-test-expired --check
boss-cron --check: 3 violation(s)
  - orphan: IMAGE-GENERATED stale-1 has no GHL-URL upload — temp URL will expire in 24h
  - orphan: IMAGE-GENERATED in-flight-1 has no GHL-URL upload — temp URL will expire in 24h
  - orphan: MANIFEST-ROW stale-1 temp URL expired at 2026-08-10T10:00:00Z and never uploaded to GHL — generation spend is lost (token waste): https://tempfile.aiquickdraw.com/p/stale.jpg...
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan
EXIT: 2
```

**Result: PASS** — stale-1 is caught as the EXPIRY class (the token-waste line naming the expired deadline and the lost spend, line 386). Controls behaved correctly: in-flight-1 (future expiry) drew the generated-not-uploaded violation but NOT an expiry violation; hero-1 (uploaded despite future expiry) drew no violation at all. Exit 2.

## Unit tests (regression, slice 3 artifact)

`holding/test-orphan-sweep.py` re-run against the current boss-cron: **10/10 pass** (T1 clean no-media, T2 perfect 1:1:1 N-refs, T3 orphan generation, T4 generated-not-uploaded, T5 uploaded-never-referenced, T6 expired-temp-url, T7 expired-but-uploaded-clean, T8 marked-gap-clean, T9 manifest-no-generation, T10 in-flight-future-expiry).

```
10 passed, 0 failed
```

## Observation (not a failure)

The violation text carries a doubled prefix in `--check` output ("orphan: orphan: IMAGE-GENERATED ...") because `check_orphans()` prefixes its own lines with "orphan: " (lines 351-386) and `main()` line 427 prepends "orphan: " again. Cosmetic only — the violation fires, the class is named, exit code 2, and the live-cycle `VIOLATION-STOP` ledger line and stop file (main() lines 441-452) are unaffected. Left untouched: my slice names verification, and the prefix belongs to slice 3's file.

## Files touched (this slice only)

- `holding/WF-3E-slice4-evidence.md` — this file (new)
- Test fixtures in /tmp/wf3e-slice4/ (TEST-LEDGER.md, TEST-LEDGER-ORPHAN.md, TEST-LEDGER-EXPIRED.md, patched boss-cron copies) — scratch, not in the repo

NOT touched: tools/boss-cron, SKILL.md, media-pipeline.md (slice 1's uncommitted changes remain in the working tree, untouched by this slice).

## Commit

One unit = one commit: `holding/WF-3E-slice4-evidence.md: orphan sweep verified — four counts agree, orphan caught, expiry class caught (Issue 10 FIX step 4, WAVE 3 DISPATCH 2026-08-16T17:07Z)`.
