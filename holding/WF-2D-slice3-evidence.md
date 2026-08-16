# WF-2D Slice 3 Evidence — Issue 12 FIX step 3: one question at a time, no batched questions, no walls

Ledger line cited by the unit: `WAVE 2 REDISPATCH 2026-08-16T15:22Z` (line 55 of `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md`).
Unit: commit `bf1d063` on branch `fix-12-wording`, clone `/Users/blackceomacmini/work-999-setup-fix/WF-2D`.
Role of this slice: VERIFY the landed unit (checkpoint pattern per the redispatch — the killed run's commit is the base; this slice independently re-verifies it) + fix only if a defect is found.

## Scope

Issue 12 FIX step 3 only (spec lines 272): "One question at a time, always (audience.md): no batched questions, no walls." The unit bf1d063 touches exactly two files, three edits: (1) `references/audience.md` §1 BINDING one-question rule block (lines 23-33), (2) SKILL.md RULE 5 table S17 row (line 249), (3) SKILL.md step 20 defect class (d) (lines 1228-1232). Nothing else. The live repo (`~/work-999-setup`) was never touched — edits exist only in this clone's branch.

## Files read in full (judgment never from grep)

- `.claude/skills/spec-protocol/SKILL.md` — read in full across passes (1688+ lines; three ranges this slice: 1-280, 1180-1260, 1470-1530, plus 220-250, 1208-1253).
- `.claude/skills/spec-protocol/references/audience.md` — 297 lines, read in full.
- `.claude/skills/spec-protocol/references/interview.md` — read by sibling slices (slice 1 + step-2 commit f415a49 evidence); step 3 does not live there.
- Spec `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` — Issue 12 (lines 263-277) read; QC bar line 276.
- Ledger `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` — read in full; redispatch line 55.

## Verification matrix (each claim → where proven)

| Claim | Proof |
|---|---|
| Unit bf1d063 = 2 files, +19/−1, cites the ledger line | `git show --stat bf1d063` (2 files changed, 19 insertions, 1 deletion); commit message body: "Cites ledger line: WAVE 2 REDISPATCH 2026-08-16T15:22Z (WF-2D slice 3)" |
| S17 row present, last in RULE 5 table, adjacent to S16 | SKILL.md line 249 (S16 line 248); grep `S17` = exactly 1 occurrence in SKILL.md |
| S-row count 19 | `grep -cE '^\| \*\*S[0-9]+ — '` = 19 (lines 217-229 S1-S13, 244-249 S12-S17) |
| Step-20 defect class (d) present | SKILL.md lines 1228-1232: "(d) a user-facing message with TWO questions in it — the wall-of-questions defect (references/audience.md §1…); the audit reads the session transcript's user-facing messages and flags any that carry more than one question or a batched '1. … 2. … 3. …' list" |
| audience.md BINDING rule present | audience.md lines 23-33; two-option choice once = ONE question; wall shapes named (question+follow-up, question+confirmation, two yes/no, numbered batch ending in pick-everything); ask-first-wait-then-next procedure; both enforcers named (step 20 self-audit, swarm standard S17) |
| S17 + step-20 names cross-reference each other consistently | S17 cell cites "references/audience.md §1, the binding one-question rule" (line 249); audience.md cites "The self-audit (step 20) and the swarm watch (standard S17)" (line 31) — both names exist |
| No contradiction in the skill tree | Pre-existing prose "One at a time. Never a wall of questions." (SKILL.md line 1491) and funnel-architecture.md lines 45/457 + openclaw-ingest.md line 109 all align with the rule; none teach batching |
| Step-5 checker enforces the rule mechanically | tests/interview/r5-shape-check.mjs: one-question-per-line check (line 214-221, rule "one-at-a-time"), wall fixture "default-mode walls of two fail" (line 296), cites "Issue 12 FIX step 3" (lines 118, 221) — the QC bar is machine-checkable |
| Step 2 machinery coexists, no conflict | audience.md BINDING never-re-ask block (lines 116-127) intact; interview.md R5.1 referenced by both; boss-cron RE-ASK sweep present (tools/boss-cron lines 17-21, 317-333) — step 3's rule adds the one-question axis, step 2's adds the never-re-ask axis; orthogonal |
| No later commit clobbered the hunks | `git log bf1d063..HEAD -- <two files>` = only f415a49 (step-2 commit), whose diff does not touch the S17 row, the (d) block, or the audience.md §1 rule (verified: f415a49's audience.md edit is the §3 never-re-ask block at lines 116-127, below the §1 insertion) |
| Working tree clean, operator one command from committed state | `git diff HEAD --stat` empty; `git diff HEAD --check` clean; untracked = holding/ only; `git checkout -- SKILL.md` restore-path proven by the pre-slice3 backup |
| Backups exist | holding/backups/SKILL.md.pre-slice3.bak, holding/backups/audience.md.pre-slice3.bak (plus sibling slices' .pre-slice2.bak files) |
| Tree still parses | `bash -n` on every `*.sh` in the clone (incl. tools/boss-cron) — all clean |
| S12/S13 numbering duplication (SKILL.md lines 228-229 vs 244-245) | PRE-EXISTING in main (verified: `git show main:.claude/skills/spec-protocol/SKILL.md` has the same S12+S13 twice) — NOT introduced by bf1d063, out of this slice's scope, recorded for the record |

## Findings

- VERDICT on the landed unit: PASS — no defect found. The three edits implement Issue 12 FIX step 3 exactly, the QC bar (spec line 276: every question one-at-a-time) is enforced mechanically by the step-5 checker, and no change was needed from this slice. Zero further commits made (no fix required).
- Observation (out of bar scope, recorded only): pre-existing S12/S13 duplicate numbering in the RULE 5 table predates this wave. Not a step-3 defect; belongs to no WF-2D slice. Left untouched per slice boundaries.

## What was deliberately NOT touched

- interview.md, funnel-architecture.md, all other references, tools/boss-cron, tests — untouched by this slice.
- Live repo `~/work-999-setup` — never touched.
- No new commit was needed: the unit already satisfies the bar; this slice verifies and reports.
