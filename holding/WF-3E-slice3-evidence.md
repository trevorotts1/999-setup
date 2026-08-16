# WF-3E slice 3 evidence — boss cron per-cycle orphan sweep check

**Slice:** WF-3E slice 3 (Issue 10 FIX step 3)
**Branch:** fix/10-orphan-accounting
**Ledger line cited:** `WAVE 3 DISPATCH 2026-08-16T17:07Z` (FIX-LEDGER.md line 59)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 10 FIX step 3 (lines 239-240) + PART 4 check 7 (line 544)

## What the slice names

ISSUE 10 FIX step 3 (spec line 239):
> "The boss cron's per-cycle check includes the orphan sweep: count generations, manifest rows, uploads, references; any mismatch is a `VIOLATION-STOP` on the media lane (PART 4). The sweep also checks the EXPIRY class: a manifest row whose temp URL is older than its 24h deadline (KI.ai expiry) and carries no GHL URL is a token-waste orphan — the generation's spend is lost — `VIOLATION-STOP` on the media lane."

PART 4 check 7 (spec line 544):
> "Orphan check (media): generated ≠ manifest ≠ uploaded ≠ referenced counts = violation."

## Change

**File:** `tools/boss-cron` (new in this working copy; copied from the live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` at the WAVE 3 base, then extended)

### Added: `check_orphans(lines)` — PART 4 check 7 / ISSUE 10 FIX step 3

Per-item 1:1:1 media accounting read from the ledger. Four ledger classes (added to SANCTIONED_CLASSES so the scope check admits them):

| Class | Meaning | Written by |
|---|---|---|
| `MANIFEST-ROW <id>: page=<p> slot=<s> url=<tempUrl> expires=<ISO8601>` | planned image row | pipeline at manifest time (Issue 7 FIX step 3) |
| `MANIFEST-ROW <id>: page=<p> slot=<s> status=gap` | marked gap (MEDIA-GAPS path) | pipeline fail-closed path (Issue 7 FIX step 4) |
| `IMAGE-GENERATED <id>: task=<t> url=<tempUrl>` | generation succeeded | pipeline at poll-to-success (Issue 7 FIX step 2) |
| `GHL-URL <id>: url=<ghlUrl>` | upload to GHL media storage | pipeline at upload read-back (Issue 9 FIX step 5) |
| `IMAGE-REF <id>: page=<p> slot=<s>` | reference in a page | pipeline at build (Issue 9 FIX step 3) |

Checks (each mismatch = violation, appended as `orphan: ...` and surfaced as `VIOLATION-STOP` on the media lane by the existing main() machinery):

1. **generated == manifest:** `IMAGE-GENERATED` with no `MANIFEST-ROW` = generation without a plan (token waste). `MANIFEST-ROW` with no `IMAGE-GENERATED` and not `status=gap` = planned image never generated.
2. **generated == uploaded:** `IMAGE-GENERATED` with no `GHL-URL` = temp URL will expire in 24h. `GHL-URL` with no `IMAGE-GENERATED` = upload record without a source.
3. **uploaded ⊆ referenced:** `GHL-URL` with no `IMAGE-REF` = uploaded image never used (wasted).
4. **referenced ⊆ uploaded:** `IMAGE-REF` with no `GHL-URL` = page references an image that was never persisted (temp URL will die).
5. **EXPIRY class (ISSUE 10 FIX step 3):** `MANIFEST-ROW` whose `expires=` timestamp is in the past AND no `GHL-URL` for that id = token-waste orphan — the generation's spend is lost. Rows already uploaded are exempt (the temp URL no longer matters). Rows with a future expiry are in-flight, not violations. Unparseable expiry = violation (cannot verify freshness).

Marked gaps (`status=gap`) are excluded from the manifest count — the only sanctioned manifest row without a generation (Issue 7 FIX step 4: "marks the affected manifest rows FAILED ... and falls to the MEDIA-GAPS path").

### Added: `MEDIA` to SANCTIONED_CLASSES

The pipeline's own per-batch `MEDIA | provider=... | stored=... | perm-url=...` ledger lines (media-pipeline.md section 10, capacity.md line 1414) were previously flagged by the scope check. Now admitted.

### Wiring

- `main()` calls `check_orphans(lines)` and prefixes each finding with `orphan: `.
- `checks` string extended: `caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan`.
- Docstring updated with the WAVE 3 orphan-sweep contract.

## Verification

### Unit tests — 12/12 pass

`holding/test-orphan-sweep.py` (10 tests) + inline tests T11/T12:

| Test | Scenario | Result |
|---|---|---|
| T1 | clean ledger, no media lines | no violations |
| T2 | perfect 1:1:1, 2 rows, N refs (hero-1 referenced twice) | no violations |
| T3 | IMAGE-GENERATED with no MANIFEST-ROW | violation "no corresponding MANIFEST-ROW" |
| T4 | generated, not uploaded | violation "no GHL-URL upload" |
| T5 | uploaded, never referenced | violation "no IMAGE-REF in any page" |
| T6 | temp URL past expires=, no upload | violation "temp URL expired ... generation spend is lost" |
| T7 | temp URL past expires= BUT uploaded | NO expiry violation (uploaded = safe) |
| T8 | MANIFEST-ROW status=gap, no generation | no violations |
| T9 | MANIFEST-ROW, no generation, not gap | violation "not marked status=gap" |
| T10 | future expiry, in-flight | no expiry violation |
| T11 | IMAGE-REF with no GHL-URL | violation "never persisted" |
| T12 | unmarked gap message | violation "not marked status=gap" |

### Live dry cycle

```
$ python3 tools/boss-cron --check
boss-cron --check: 0 violation(s)
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan
EXIT: 0
```

Read-only cycle against the live ledger at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md — zero violations, orphan check in the run set.

### Scope check

New classes `MANIFEST-ROW`, `IMAGE-GENERATED`, `GHL-URL`, `IMAGE-REF`, `MEDIA-GAP`, `MEDIA-UPLOADED`, `MEDIA` all pass `check_scope` (verified by test). The pipeline's `MEDIA | ...` per-batch lines pass scope.

## Files touched (this slice only)

- `tools/boss-cron` — the orphan sweep (check 9) + MEDIA scope class
- `holding/test-orphan-sweep.py` — unit tests (evidence artifact)
- `holding/WF-3E-slice3-evidence.md` — this file

NOT touched: SKILL.md, media-pipeline.md, capacity.md, interview.md, funnel-architecture.md (pre-existing modifications from other WF-3E slices remain uncommitted in the working tree, untouched by this slice).

## Commit

One unit = one commit: `tools/boss-cron: orphan sweep per-cycle check (Issue 10 FIX step 3, WAVE 3 DISPATCH 2026-08-16T17:07Z)` — cites the WAVE 3 ledger line.
