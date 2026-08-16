# WF-2B slice 3 evidence — truthful numbering (Issue 4 FIX step 3, feeds Issue 11)

Branch: `fix/4-mode` in clone /Users/blackceomacmini/work-999-setup-fix/WF-2B (clone of
main@15a92d9, never the live repo).
Slice commit: `c5153e4` — "Issue 4 FIX step 3: truthful numbering — total computed ONCE at
start, every counted question 'Question N of no more than C', every C change announced before
the next question (mode answer = first announced change, R6 wall nine; fast-path-1 = R1 mode
question, never re-asked). One unit citing FIX-LEDGER.md WAVE 2 REDISPATCH 2026-08-16T15:22Z"
Base: `0b3485f` (slice 2) on `15a92d9` (main).
Ledger line cited: /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md — "WAVE 2 REDISPATCH
2026-08-16T15:22Z" (the redispatch line names WF-2B, branch fix/4-mode, one unit = one commit
citing this line).

VERIFICATION MODE: this slice's commit landed in the killed first wave; the redispatch line
carries the checkpoint doctrine — the rerun's slice takes the landed commit as its base and
verifies it. This evidence file is the rerun's verification pass, appended to the original
slice-3 evidence (preserved at WF-2B-slice3-evidence.md.pre-rerun-verify).

## Slice bar (master fix spec Issue 4 FIX step 3, lines 75/78)

> Truthful numbering (feeds Issue 11): total computed ONCE at the start (C), every question
> spoken as "Question N of no more than C", any change to C announced BEFORE the next
> question (lowerings with the good-news line; the only sanctioned rise is artwork's, spoken
> at measured size before the question).

## Files touched by this slice

ONE file: `.claude/skills/spec-protocol/references/interview.md` — `git show c5153e4 --stat`:
1 file changed, 91 insertions, 45 deletions. No other file.

## Verification performed (rerun pass, independent reads)

Reads (full-file, no grep-for-judgment):
- interview.md read in full: lines 1-160, 160-420, 420-660, 660-999, 999-1340, 1340-1586
  (current HEAD state = ef017f3, which builds on c5153e4).
- SKILL.md step 6 + flow ordering read in full (lines 930-1010) for the mode-question
  placement contract.
- Diff `0b3485f..c5153e4` (slice 3's own delta) parsed hunk by hunk: every hunk is numbering
  truth or its removal. Zero digit changes (ceiling table rows 32/31/32/31/32/33, artwork
  rises 35/34/35/34/35/36, T column all untouched). Zero collapse-machinery changes (fast
  path 2 untouched — slice 5 territory).
- Diff `15a92d9..HEAD` (full branch) read via `git diff 15a92d9..HEAD --numstat`: two files
  changed across slices 1-4 — interview.md 153 insertions / 47 deletions, SKILL.md 26
  insertions / 1 deletion (branch total 179 insertions / 48 deletions). The number 200
  sometimes quoted for interview.md is its changed-lines total (153 + 47), not its added
  count. The numbering-truth contract survives all later slices' reconciliation.

## Bar compliance, claim by claim (file:line = current HEAD state, ef017f3)

1. **Total computed ONCE at the start (C).** interview.md 30-32: "The total is computed
   ONCE, at the start, and never moves silently: C is fixed before question 1 by the
   pre-statement reads and the target's ceiling-table wall." Counter rule 2, lines 400-404:
   "The ONE total is computed ONCE, before question 1, and never recomputed silently."
   Arithmetic section: C = archetype (1) + Step 1d branch + [Claude-Nine only: mode question
   (1 — STATIC, never priced out) + A2 (1) + measured plan questions + A3-A8 (6)] + B1/B2/B4
   (3) + C0-C6 (7) + 2 collapse confirmations + D1-D4 (4), lines 78-93. C spoken up front in
   the two-number form with T, or single-number when C-T <= 2, lines 20-26, 411-414.
2. **Every counted question "Question N of no more than C".** Counter shape verbatim, lines
   395-398: "**Question <N> of no more than <C> —** <the question, exactly as written
   elsewhere in this file>". Rule 1 of the counter, line 395: "Every counted question is
   SPOKEN WITH ITS NUMBER." Mode question spoken with its number, lines 191-194 ("Question
   <N> of no more than <C> —" with N = 1; 2 when the archetype genuinely had to be asked
   first). Step 1d confirmation speaks the shape verbatim, line 700. R5 carries it, lines
   353-356. N never resets, never repeats, never decreases, line 448.
3. **Any change to C announced BEFORE the next question.** Lines 33-35 ("any change to C —
   lowerings and the artwork rise alike — is announced BEFORE the next question"), 197-200
   ("The ceiling NEVER moves silently: any C change, lowering or rise, is spoken before the
   next question"), 407-411 ("Every later change to C is an ANNOUNCED change, never silent —
   the three rules below are the only ways C moves… a question asked past a stated ceiling
   with no prior correction is a defect").
   - Lowerings with the good-news line: lines 449-458 — "Good news — it will be at most <C'>
     now, because <the reason>" REQUIRED at every fast-path yes (the defaults offer, each
     small-plan collapse confirmation) and at any single lowering of three or more; a drop of
     one or two may be absorbed by finishing early.
   - The ONLY sanctioned rise is artwork's, spoken at measured size before the next
     question: lines 436-444 — artwork priced at zero in C, "the ceiling rises the moment the
     plan calls for pictures, BY ITS MEASURED SIZE — three when both artwork keys are present
     at that moment, two otherwise — and the rise is spoken BEFORE the next question, in the
     correction voice"; measured-size rule also lines 42-43, 459-462 (rise + failsafe
     corrected-ceiling-before-asking; "A question asked past a stated ceiling with no
     correction spoken first is a defect").
4. **Mode answer = the first announced change to C; the drop to nine is sanctioned, never
   silent.** Lines 35-37 ("The R1 mode answer is a fast-path yes — the defaults offer — so
   the good-news line is REQUIRED the moment DEFAULT MODE is chosen: C drops to the R6 wall
   of nine, spoken before question 2"), 43-45 ("the mode answer's drop to nine is the one
   sanctioned LOWERING spoken against the stated total, never a silent second number"),
   195-197, 405-407, 355-356.
5. **One total covering both modes; Simple wall = R6 list (nine); Advanced wall = ceiling
   table row.** Lines 193-194 ("the one total, computed once before question 1, covering
   BOTH modes"), 115-126 ("The table rows are the ADVANCED MODE wall — in DEFAULT MODE the
   wall is the R6 list's length (nine, usually fewer), never the table"), 202-212, 216-225
   (DEFAULT MODE R6 items numbered 2 through 9 against the same lowered ceiling; ADVANCED
   MODE under the target's row), 360-371 (R6: "Nine items — the R6 list's length IS the
   mode's ceiling C… no default-mode run may state or cross a C above nine").
6. **Never re-ask / no double count.** Fast path 1 = the R1 mode question, priced once in C
   and T, never re-asked, A2's plan-tier answers never trigger a second defaults question:
   lines 1380-1400 ("the offer is never re-asked and never spoken again at any later
   point — the ceiling arithmetic prices it once, as the first counted question (question
   1), in both C and T"). R1: lines 169-184 ("The MODE question is question 1 of the count —
   before any block, before any lettered question, and before any other counted question",
   "NEVER re-asked once answered, and no read or fast path removes it (STATIC)"). STATIC
   class table row, line 474. T arithmetic builds the mode question at 1, lines 98-104.
   "What is counted" from the mode question through Block D, lines 420-425.
7. **Boss-cron enforcement contract present** (promised-vs-asked): lines 407-411 and 459-462
   state the defect condition (question past a stated ceiling with no correction spoken =
   defect) that Issue 11 FIX step 4's boss check parses. No counter language anywhere
   contradicts it.

## Ordering-context reconciliation (slice 4's F-1 fix, commit ef017f3)

The flow asks the counted archetype (Step 1b) and the Step 1d branch (line 956 SKILL.md)
BEFORE step 6's mode question; interview.md handles this with the "second only when the
archetype genuinely could not be derived from the brief and had to be asked" clause (lines
169-170, 192). This tension was found and resolved by slice 4 (commit ef017f3, F-1), which
is the branch tip. The numbering contract under both orderings:
- Archetype derived from the brief (normal path): mode = question 1, R6 items 2-9.
- Archetype genuinely asked first: mode = question 2, R6 items 3-9, ceiling arithmetic still
  prices the mode question at exactly 1 in C and T (lines 78-93, 98-104) — C is a wall, and
  the run lands further under it.

## Numbering arithmetic spot-checks (run-parseable, no silent drift)

- C advanced worst case, Sales funnel, no reads lower: 1 (archetype) + 5 (branch) + 1 (mode)
  + 1 (A2) + 3 (plan questions max) + 6 (A3-A8) + 3 (B1/B2/B4) + 7 (C0-C6) + 2 (collapse
  confirmations) + 4 (D1-D4) = 33 = table row 33. Matches interview.md 128-135.
- T worst case, funnel: 1 + 5 + 1 (mode) + 1 (A2) + 3 (plan) + 2 (A3, A6) + 2 (collapse
  confirmations) + 1 (C6) + 4 (D1-D4) = 20 = table T column 20. Matches.
- Simple mode: 9 items total (R6 lines 360-365), wall nine, never crossed (lines 366-371).
- Artwork rise: +3 (both keys) / +2 (one key) on top of the advanced wall, measured size
  (lines 119-121, 437-439); nothing else ever raises C (lines 459-462).

## Out of scope (touched by other slices, not this one)

- SKILL.md step 6 mode gate (slice 1, commit ac2245e), INTERVIEW-MODE ledger line,
  CONTROL/LEDGER.md mechanics (slices 1/2).
- Ceiling-table walls and mode mapping (slice 2, commit 0b3485f).
- Verification pass / reconciliation of R1-vs-archetype numbering (slice 4, commit ef017f3 —
  this evidence verifies slice 3 in the state that includes slice 4, since slice 4 is the
  branch tip and its F-1 finding closed a numbering hole).
- Collapse confirmations and sanctioned-removal consistency (WF-2B slice 5).

## Verdict

Slice 3's commit c5153e4 satisfies the bar: one total computed once (30-32, 400-404),
every counted question "Question N of no more than C" (395-398), every C change announced
before the next question (33-35, 197-200, 407-411, 449-462), lowerings with the good-news
line (449-458), artwork the only sanctioned rise at measured size (436-444), drop to nine
sanctioned and spoken (35-37, 43-45, 195-197). No counter language in the file contradicts
it; the later slices reconcile rather than regress it.
