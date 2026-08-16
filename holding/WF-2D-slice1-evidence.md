# WF-2D Slice 1 — FIX step 1 evidence (Issue 12, WAVE 2 REDISPATCH)

Ledger line cited: `WAVE 2 REDISPATCH 2026-08-16T15:22Z` in
`/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` (line 55).
Spec: Issue 12 FIX step 1 — `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` lines 269-271.
Working copy: `/Users/blackceomacmini/work-999-setup-fix/WF-2D`, branch `fix-12-wording`, clone re-pointed to local main@15a92d9.
File touched: `.claude/skills/spec-protocol/references/interview.md` — ONE file, ONE unit.

## What FIX step 1 requires (spec lines 270-271)

Every default-mode question in R5 is re-grounded: (a) seventh-grade plainness,
(b) say what the question decides, (c) give an example answer, (d) always name
the escape ("if you are not sure, I will choose and tell you"). The words
"usage window", "merge", "repo", "branch" never appear in a default-mode question.

## Units on this branch (commits)

| Commit | What |
|---|---|
| `1b239f0` | Slice 1 (landed in the prior run): re-grounded ~44 live default-mode questions across R1, R2, Step 1b, Step 1d (all branches), Media block, Block A, fast paths, A2 remainder, Block D — every edit adds one "This decides …" sentence, one "An example answer: …", and the escape phrase. 189 insertions, 79 deletions in interview.md only. |
| `5a423d3` | **Slice 1 repair (this run):** D1 (the example question, R6 default-mode item 5, interview.md line 1609 of the landed state) carried decides + example answer but NO named escape — its fallback was a bare promise ("later I will show you two or three excellent ones and you will pick") with no "if you are not sure" clause. R5 (interview.md lines 282-284) requires the escape on every default-mode question. Fix adds: "If you are not sure, or nothing comes to mind, that is fine — later I will show you two or three excellent ones and you will pick from them, and I will tell you which I recommend." Block D doctrine preserved: the person still picks from the shown candidates; the selection step is never skipped. One-line change (+1 -1). |

Both commits cite the WAVE 2 REDISPATCH ledger line. The slice-2 commit
(`f415a49`) sits between them and touches only the R5.1 never-re-ask machinery
(no D1 question-text overlap — verified: its only D1 touch is the `Q:D1` key
listing in the stable-keys enumeration).

## Verification (independent of my edits — full-file audit, never grep-for-judgment)

1. **R5 shape audit of every live default-mode question.** Built the complete
   live-question inventory from the file's own structure — R1 mode question,
   Step 1b archetype, Step 1d confirmed-target/desktop/APP/MOBILE/MOBILE-AND-WEB/
   WEBSITE/SIMPLE/COMPLEX/FUNNEL questions, the funnel recommendation, the Media
   block (opening, q1/q2/q3, one-key say-out-loud, both-missing key ask,
   expert-path miss), Block A1-A3, the A2 plan-tier questions, the 1b recall,
   OpenRouter, fast-path 1 defaults offer, fast-path 2 collapse, C4/C5 rows,
   D1-D4, the Agent-Team consent, and the R2 rewritten forms (C5 done-condition,
   D2 winning bar, A4/A5 advanced explainers). **44 anchors, all PASS** on the
   committed HEAD: every one carries decides + example answer + the named escape
   ("not sure" / "do not know" / "I will choose" phrasing). Spot-verified the
   exact escape text on every anchor; no bare question remains.
2. **Banned words in default-mode questions.** Whole-word scan of "usage window",
   "merge", "repo", "branch" (plural/verb forms included, prefix matches
   excluded) over the committed file: the only hits are (a) the DELETED-question
   rows A6/B1/B2/C2 and the deletion-ruling text — Issue 12 FIX step 4
   territory, not live default-mode questions — and (b) non-question prose
   (architecture notes, "What it sets" columns, the R5 law sentence itself).
   Zero banned words in any live default-mode question text, including D1.
3. **Test suite green.** `node tests/interview/r5-shape-check.mjs --selfcheck`:
   19/19 passed. Fixtures: `default-clean-full.txt` PASS (9 questions, clean);
   `default-seeded-defects.txt` FAILs on exactly its 8 seeded defects (deleted
   questions, N regression, repeat, re-ask answered, wall, over-ceiling) — the
   suite discriminates as designed. Note: the shape check enforces
   one-at-a-time/deleted/banned/repeat rules; the decides+example+escape shape
   is enforced by this slice's audit above.
4. **Scope.** Only `interview.md` changed across both slice-1 commits. No
   question deleted, no number renumbered, no block reordered, no measurement
   rule altered. `git status` clean except untracked `holding/` and
   `tools/__pycache__/` (pre-existing). `git diff --check` clean.
5. **R5.1 cross-slice coherence.** The slice-2 never-re-ask machinery and the
   D1 repair coexist without overlap (verified per-commit).

## Claim check (per FIX step 1)

- Re-grounded every question in R5: DONE — 44/44 anchors pass the shape audit.
- Seventh-grade plainness: all live questions use the audience.md register
  (verified against `audience.md` sections 1-2).
- Says what the question decides: every anchor carries a "This decides …"
  sentence (or an equivalent "your answer decides …" form).
- Gives an example answer: every anchor carries "An example answer: …".
- Names the escape: every anchor carries "If you are not sure, I will … and
  tell you" (or the equivalent first-person choice-and-tell).
- "usage window", "merge", "repo", "branch" never in a default-mode question:
  verified zero hits in live question text.
