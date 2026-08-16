# WF-3E slice 1 evidence — blind critic re-verification (Issue 10 FIX step 1, the 1:1:1 rule)

**Critic:** blind critic, WF-3E slice 1 (111-rule)
**Branch:** fix/10-orphan-accounting (working copy /Users/blackceomacmini/work-999-setup-fix/WF-3E)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 10 (lines 230-242)
**Bar (spec line 242, verbatim):** "generated = manifest = uploaded = referenced, zero orphans, proven by enumeration."

## VERDICT: PASS

## What the slice claims (uncommitted diff, verified independently)

`git diff HEAD --stat` on the working copy shows exactly two modified files:

1. `.claude/skills/spec-protocol/SKILL.md` (+2 -1)
2. `.claude/skills/spec-protocol/references/media-pipeline.md` (+67)

### Change 1 — SKILL.md: new watch-check row S17 (line 249)

S17 carries the full 1:1:1 contract: generated = manifest = uploaded; references may be N, each counted. All four orphan classes named with dispositions matching spec FIX step 1 exactly:

| Spec FIX step 1 | S17 text | Match |
|---|---|---|
| generation with no manifest row = violation | UNTRACKED-GENERATION — violation | yes |
| manifest row with no generation = marked gap | UNGENERATED-MANIFEST-ROW — marked gap, never silent drop | yes |
| upload with no reference = violation | UNREFERENCED-UPLOAD — violation | yes |
| reference not counted = violation | UNCOUNTED-REFERENCE — violation | yes |
| shared asset: one row, N references, all counted | "one manifest row, one generation, one upload, N references — all N counted, zero uncounted" | yes |

S17 names the four ledger classes the sweep reads (`MANIFEST-ROW`, `IMAGE-GENERATED`, `GHL-URL`, `IMAGE-REF`) and cites `references/media-pipeline.md §10.1` — that section exists (line 1660). S17 sits in the S-table between S16 and the table close; no numbering collision (no S18 exists yet).

### Change 2 — media-pipeline.md §10.1 (line 1660): the rule + fixed ledger formats

§10.1 defines the four orphan classes in a table with dispositions, states the four counts are reconciled at every media batch boundary and by the boss cron's per-cycle sweep (PART 4 check 7), and fixes the ledger line formats:

```
MANIFEST-ROW <id>: page=<page> slot=<slot> url=<tempUrl> expires=<ISO8601>
MANIFEST-ROW <id>: page=<page> slot=<slot> status=gap
IMAGE-GENERATED <id>: task=<taskId> url=<tempUrl>
GHL-URL <id>: url=<ghlUrl>
IMAGE-REF <id>: page=<page> slot=<slot>
```

These formats are byte-identical to the formats the sweep parses (boss-cron docstring, lines 285-300) — pipeline writes and sweep reads cannot disagree on format. `status=gap` rows are excluded from the equality comparison by design, matching spec "a manifest row with no generation is a marked gap".

### Change 3 (same diff) — 13.1/13.2/13.3 additions: the one-unit ordering contract

FIX step 2 material (generate → poll → parse → download → upload → read-back → ledger, never split; PERSIST-PENDING is warehouse-outage only). Adjacent slice work in the same working copy; does not conflict with the 1:1:1 rule. S15's row was extended to carry the one-unit contract and cites `references/media-pipeline.md 13.1` — that section exists (line 2017).

## Enumeration proof — the sweep and its tests

The enforcement instrument is `tools/boss-cron` `check_orphans()` (committed 269ccba, slice 3; PART 4 check 7 per spec line 544). Independent re-run of the test suite:

```
$ python3 holding/test-orphan-sweep.py
PASS T1 clean no-media
PASS T2 perfect 1:1:1 N-refs
PASS T3 orphan generation
PASS T4 generated-not-uploaded
PASS T5 uploaded-never-referenced
PASS T6 expired-temp-url
PASS T7 expired-but-uploaded-clean
PASS T8 marked-gap-clean
PASS T9 manifest-no-generation
PASS T10 in-flight-future-expiry
10 passed, 0 failed
```

Each orphan class is enumerated by a deliberate case and caught:

- T3: IMAGE-GENERATED with no MANIFEST-ROW → caught (UNTRACKED-GENERATION)
- T9: MANIFEST-ROW with no IMAGE-GENERATED, unmarked → caught (UNGENERATED-MANIFEST-ROW)
- T8: MANIFEST-ROW status=gap → clean (the sanctioned marked gap)
- T4: generated, not uploaded → caught
- T5: uploaded, never referenced → caught (UNREFERENCED-UPLOAD)
- T2: shared asset, N=2 references, all counted → clean (shared-asset rule)
- T6: expired temp URL, no GHL upload → caught (EXPIRY class)
- T7: expired temp URL but uploaded → clean (expiry exempt once persisted)
- T10: future expiry, in-flight → no expiry violation

The sweep's set arithmetic (read from source, lines 285-395) proves the equality in both directions for all four sets: generated−manifest, manifest−generated, generated−uploaded, uploaded−generated, uploaded−referenced, referenced−uploaded, plus the expiry class. References are a set for orphan purposes (N refs to one id collapse), which is correct — the spec's "references may be N" means the multiset count lives in the pipeline's per-reference IMAGE-REF lines, and orphan detection needs distinct ids.

## Live instrument check

```
$ python3 tools/boss-cron --check
boss-cron --check: 0 violation(s)
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,orphan
```

The orphan check runs in the live cycle and the four media classes are admitted by the scope check (SANCTIONED_CLASSES, boss-cron line 71, includes MANIFEST-ROW, IMAGE-GENERATED, GHL-URL, IMAGE-REF). The real ledger (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md) currently carries zero media lines — no media build has run yet in this wave — so the live check is trivially clean; the enumeration proof is the unit suite above.

## Sources named

- Spec Issue 10: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md lines 230-242 (QC bar line 242), PART 4 check 7 (line 544)
- Working copy diff: git diff HEAD in /Users/blackceomacmini/work-999-setup-fix/WF-3E (SKILL.md +2 -1, media-pipeline.md +67)
- SKILL.md S17 row: line 249; S15 row: line 248
- media-pipeline.md §10.1: line 1660; 13.1: line 2017; 13.2: line 2053; 13.3: line 2083
- boss-cron check_orphans: lines 285-395; SANCTIONED_CLASSES: line 71; main() wiring: lines 426-428, 444
- Test suite: holding/test-orphan-sweep.py, 10 tests, all pass on re-run
- Backups compared: SKILL.md.bak-slice1-orphan and media-pipeline.md.bak-slice1-orphan differ from current only by the slice-1 additions (diff -q confirms the files differ; the diff content shows only the S17/§10.1/13.x additions)

## Not checked (named)

- A real media test build with live four counts (that is WF-3D slice 5's verification, task #8, not slice 1's)
- Duplicate-line detection (two MANIFEST-ROW lines for one id collapse in the set — the spec's "exactly one" is a pipeline-write contract, not a sweep check; not bar-relevant)
- A reference present in HTML but missing its IMAGE-REF ledger line is invisible to any ledger-based sweep — inherent to the spec's own design (the pipeline's write obligation is enforced by S17's UNCOUNTED-REFERENCE class, not by the sweep)
