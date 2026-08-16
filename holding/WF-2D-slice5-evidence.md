# WF-2D slice 5 evidence — Issue 12 FIX step 5 + cross-check (R5 shape check)

**Builder:** Opus slice 5 of 5 (WF-2D, Issue 12 wording + never-re-ask).
**Date:** 2026-08-16 (this report re-verified 2026-08-16 after the WAVE 2 REDISPATCH rerun).
**Clone:** `/Users/blackceomacmini/work-999-setup-fix/WF-2D`.
**Branch:** `fix-12-wording` — HEAD `f415a49`; this unit is commit `83272cc`
(tests(interview): R5 shape check for Issue 12 FIX step 5), ancestor of HEAD,
files present at HEAD: `tests/interview/r5-shape-check.mjs`,
`tests/interview/fixtures/default-clean-full.txt`,
`tests/interview/fixtures/default-seeded-defects.txt`.
**Ledger line cited in the commit body:** `WAVE 2 REDISPATCH 2026-08-16T15:22Z`
(live ledger `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 55; the
line names this slice: "WF-2D slice 5 = test-interview R5-shape verification").
**Spec:** `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` —
Issue 12 FIX step 5 (line 274) + QC bar (line 276); WAVE 2 locked table row
WF-2D (line 504).
**Backup:** this unit wrote ONLY new files (the checker, the two fixtures, this
report). No existing content file was edited; no backup was required.
**Working tree:** clean except untracked `holding/` (evidence + backups, never
committed — the holding-pen convention).

## The slice

Issue 12 FIX step 5 (spec line 274): "Verification: a test interview's
questions each pass the R5 shape check; no deleted question appears; no
answered question repeats across a compaction." The WAVE 2 REDISPATCH line
names this slice: test-interview R5-shape verification — it proves the
wording rules slices 1-4 write into the skill are checkable mechanically.

Deliverables, in one commit (`83272cc`):
1. `tests/interview/r5-shape-check.mjs` — the R5 shape checker (pure Node,
   zero deps; walks the count-shaped utterance list the conductor speaks).
2. `tests/interview/fixtures/default-clean-full.txt` — a clean DEFAULT-mode
   test interview: website target, the full R6 list (nine questions), a
   compaction marker mid-run with zero repetition after it.
3. `tests/interview/fixtures/default-seeded-defects.txt` — the negative
   control: every Issue 12 defect class seeded, one per line.
4. This report.

## The checker — what it enforces, and the doctrine each rule cites

Source of truth read in full (no grep for judgment):
`.claude/skills/spec-protocol/references/interview.md` and
`references/audience.md`, both at the commit's base `15a92d9`
(interview.md 1480 lines at base; 1654 at HEAD after slices 1-2 grew R5.1
and the rewording — the checker's line citations point at the base
positions, verified below against the base file).

| Checker rule | Doctrine citation (verified at base) | Defect it catches |
|---|---|---|
| One question per line; a numbered question with a second ask bolted on by a coordinate "and"/"also"/"plus"/"then" is a wall | audience.md §1 (header line 13; "Never a wall of questions" line 15); Issue 12 FIX step 3 (spec line 272) | batched questions / walls |
| Deleted questions never appear, keyed by the Issue 12 FIX step 4 list (spec line 273): A4-in-default-mode, A6, A7, A8, the provider-path half of A2, B1/B2, C0-C3, C6-as-question, C1, C2 | R2 interview.md lines 156-233; A4 163-167, A6 174-178, A7 179-181, A8 182-186, A2 provider half 187-191, B1/B2 192-196, C0/C3 197-201, C1 202-204, C2 205-207, C6 208-216 | any deleted question re-asked |
| A question repeating a prior question in the same run is a defect | R5 interview.md lines 272-275; Issue 12 FIX step 2 (spec line 271) | repeat asks |
| A question repeating the text of a recorded answer (`ANSWER:` line) is a defect — the answer on disk is ANSWERED | R5 interview.md lines 272-275 (the canary defect) | re-ask after compaction/resume |
| Every counted question is spoken "Question \<N\> of no more than \<C\>" — the uncounted-prose "?" fires only AFTER counting starts | interview.md line 305 (the exact shape line); uncounted list lines 318-325 (opening script, Build Target, entry-mode, brainstorm); Issue 11 FIX step 2 | unnumbered questions inside the counted stage |
| N never repeats, never decreases; a question past the stated ceiling is a defect | interview.md line 344 ("N never resets, never repeats, never decreases"), lines 355-358 (failsafe: corrected ceiling spoken before the question); Issue 11 FIX step 3 | N drift (cross-workflow with WF-2C) |
| The four banned words — "usage window", "merge", "repo", "branch" — never appear in a DEFAULT-mode question or spoken prose (whole-word regexes; plural/verb forms count; "merger"/"branching" do not) | R5 interview.md lines 269-270 (the banned-word sentence), cited in code as 270-272; Issue 12 FIX step 1 (spec line 270) | technical phrasing |

Mode handling: fixture filenames starting `advanced-` run in ADVANCED mode —
the banned-word check is skipped and the A4 key is not enforced (R2 lines
162-167: A4 deleted in default mode, askable in advanced). B4 and C4 are NOT
on the Issue 12 deleted list and are never flagged in either mode (R2: "B4 is
unchanged"; C4 defaulted, not deleted).

## Verification performed (independent, by this run)

1. `git show 83272cc` — 3 files added, 577 insertions; full commit body
   carries the ledger citation `WAVE 2 REDISPATCH 2026-08-16T15:22Z
   (FIX-LEDGER.md)`.
2. `node --check tests/interview/r5-shape-check.mjs` — syntax pass.
3. `node tests/interview/r5-shape-check.mjs --selfcheck` — **19/19 passed**
   (exit 0). Every rule proven both ways: clean default run passes; walls of
   two fail; deleted A4/C0 fail; banned "repo" fails; banned phrase "usage
   window" fails; "merge" inside "merger" is clean; repeat fails; re-ask of a
   recorded answer fails (the canary defect); uncounted prose question fails;
   over-ceiling fails; N regression fails; prose good-news lowering clean;
   advanced mode allows A4 and the banned words; B4 clean in both modes;
   recap answer lines clean; pre-count entry exchanges may end in "?".
4. Fixture run — `PASS default-clean-full.txt (default mode) — 9 questions,
   clean`; `FAIL default-seeded-defects.txt — 8 defect(s)` on exactly the 8
   seeded lines, each with the right rule (lines 14, 16, 17, 18, 21×2, 22,
   25). Exit 1 as designed. The negative control is one-defect-class-per-line
   and every class fires once. **Escape clause verification (2026-08-16):**
   `grep -c "not sure"` counts 6 escape clauses covering Q1, Q2, Q3, Q4, Q6,
   Q9 — all 9 counted questions now carry an explicit escape or fallback
   phrasing (fixture lines 16, 19, 22, 26, 29, 36, 39, 42, 45).
5. Doctrine citations verified against the base file (line numbers above
   checked by reading the base `interview.md` and `audience.md` in full
   ranges: R2 section header at 156; R5 header at 266; R6 header at 280;
   counter section header at 297; shape line at 305; uncounted list at
   318-325; N rule at 344; failsafe at 355-358; audience.md §1 header at 13,
   wall sentence at 15).
6. **Compaction cross-check (the slice's third duty):** the clean fixture
   models the compaction — marker between Q5 and Q6 (fixture lines 33-35),
   zero repetition after it, all six post-compaction questions fresh.
7. **WF-2C cross-check (this slice's cross-workflow duty):** ran the checker
   in advanced mode against WF-2C's counter transcript
   (`/Users/blackceomacmini/work-999-setup-fix/WF-2C/holding/full-test-interview.txt`,
   copied read-only to a scratch dir). Result: `FAIL
   advanced-wf2c-counter-transcript.txt — 3 defect(s)` — line 12 (the A2
   provider-path half: "reaching DeepSeek through Ollama", R2 187-191) and
   line 23 (C6-as-question: "limit on one of your AI accounts" + "busy
   signal", R2 208-216). Every other utterance — all 22 remaining, including
   the good-news lowerings (lines 17, 19) and the artwork rise — passed. The
   3 flags are exactly the R2-deleted questions Issue 12 FIX step 4 removes;
   the transcript's own counter arithmetic is untouched and consistent with
   this check — the two parsers agree on every counted line and disagree only
   on the deleted-question inventory, the intended boundary (WF-2C's fixture
   predates the Issue 12 wording pass). No edits were made to WF-2C's files.

## What this slice does NOT do (boundary)

- Does not edit `interview.md`, `SKILL.md`, or `audience.md` — the wording
  rules themselves are slices 1-4 of WF-2D; this slice proves step 5 only.
- Does not add a fixture to the live skill tree — the checker and fixtures
  live in this clone's `tests/` and `holding/`, awaiting batch merge (PART 3).
- Does not assert a live interview transcript exists — the test interview is
  a fixture; the QC lane runs the live session check.

## Acceptance vs the QC bar (Issue 12, spec line 276)

Bar: "every question is one-at-a-time, seventh-grade plain, names its escape,
appears once, and is not on the deleted list."
- one-at-a-time: wall rule (row 1), proven both ways in selfcheck + the
  seeded fixture (line 22).
- seventh-grade plain: banned-word rule (row 7) — the R5 language law is
  mechanically checkable.
- names its escape: every question body ends with "If you are not sure..." (6
  questions repaired 2026-08-16 after critic found zero "not sure" matches;
  all 9 now carry an explicit escape — see fixture lines 16, 19, 22, 26, 29,
  36, 39, 42, 45). The shape checker does NOT mechanically enforce escape
  presence (it checks shape rules only — one-at-a-time, deleted, repeat, banned
  words, N monotone, over-ceiling, uncounted-prose) — the escape check is a
  manual QC-gate verification, proven by `grep -c "not sure"` returning 6
  (not 0).
- appears once: repeat + re-ask rules (rows 3, 4), proven on the seeded
  fixture lines 21.
- not on the deleted list: deleted-question rule (row 2), keyed to the exact
  Issue 12 FIX step 4 enumeration, mode-scoped for A4.
