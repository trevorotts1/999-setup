# WF-4D slice 3 — FIX: fix-loop mechanics (Issue 17)

Commit: `73f5af7` on `fix/17-qc-protocol` (clone /Users/blackceomacmini/work-999-setup-fix/WF-4D)
Cites: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70, /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md)
Backup: branch `backup/wf-4d-slice3-pre` (same repo, before any slice-3 write)
Slice: the fix-loop mechanics — FAIL loops to the builder with the exact finding, max 20 cycles, then escalation with full finding history; loop bounded and recorded; wired into the skill.
Spec authority: Issue 17 FIX (spec lines 380-389) + PART 1 item 6 (spec line 469): "FAIL = looped. The item returns to the builder WITH THE CRITIC'S EXACT FINDING. Max 20 fix-loop cycles per finding (operator ruling 2026-08-14). After 20: escalation to the operator with the FULL finding history — never a quiet give-up, never a relabeled pass."

## Defects found (full-file reads; every claim cites file line)

1. **D1 — cap contradiction (3 vs 20).** The operator ruling is 20 cycles per finding, but four skill files still taught a 3-cycle cap:
   - pipeline.md line 444: "under the SAME per-finding 3-cycle cap (Rule 3.22)" (was)
   - pipeline.md line 452: "their OWN 3-cycle counter (Rule 3.22)" (was)
   - loops.md line 208: "blocked-repeated-fail at the 3-cycle cap (Rule 3.22)" (was)
   - loops.md line 232: "three cycles on the same finding" (was)
   - loops.md line 241: "Three cycles on the same finding with no convergence" (was)
   - loops.md line 291: "bounded at three per finding (Rule 3.22)" (was)
   - documents.md line 216-219: "3-cycle fix cap" / "cycle count: n of 3" (was)
   - gauntlet.md line 666: "the 3-cycle cap stopped this item" (was)
   - gauntlet.md line 1018: "finding, 3-cycle cap, Rule 3.22" (was)
   - gauntlet.md line 505: "three failed cycles on one finding" (was)
   Already correct (20): SKILL.md lines 1269-1270, 1532; gauntlet.md line 637.

2. **D2 — no escalation.** Every fix-cap statement ended "mark blocked-repeated-fail, move on" (pipeline.md was-line 471-472; gauntlet.md was-line 638-639; SKILL.md was-line 1532). Spec requires escalation to the operator with the FULL finding history — never a quiet give-up.

3. **D3 — exact-finding loop-back absent.** No skill text stated the item returns to the builder WITH THE CRITIC'S EXACT FINDING (verbatim), the QC protocol's loop-back payload (PART 1 item 6).

4. **D4 — loop not recorded.** documents.md recorded only a per-finding cycle count ("n of 3") — no per-cycle history (finding, fix, re-judge result) appended to the verdict block, which is the payload of escalation and the cold-resume instrument.

## Fixes applied (6 files, all in .claude/skills/spec-protocol/)

1. **references/pipeline.md** — Stage 3 "The fix loop" rewritten as "The fix loop (Rule 3.22 — bounded and recorded)": exact-finding loop-back sentence (line 527); three binding mechanics — Bound (max 20 cycles per finding, operator ruling), Recorded (every cycle appends finding/fix/re-judge to the verdict block in the live ledger, documents.md doc 6), Escalation (20th failed loop → blocked-repeated-fail + ESCALATE TO THE OPERATOR WITH THE FULL FINDING HISTORY, feeds Named Stops stop 8 and boss-cron checkpoint restart; Law 50 LIMIT REACHED preserved) (lines 533-546). Arbitration section: "3-cycle cap" → "20-cycle cap" (line 501), "3-cycle counter" → "20-cycle counter" (line 509).

2. **references/loops.md** — "Never a fixed round count" section retitled "…vs the 20-cycle cap"; body and comparison table now say twenty cycles, ESCALATES to the operator WITH ITS FULL FINDING HISTORY, never a quiet give-up (lines 226-247). Gate loop row: "3-cycle cap" → "20-cycle cap" (line 208). Gate loop table: "bounded at three per finding" → "bounded at twenty per finding" (line 291).

3. **references/documents.md** — Document 6 verdict block: "cycle count: n of 3" → "cycle count: n of 20" PLUS the finding's full history (every prior cycle's exact finding, fix applied (commit/branch), and re-judge result appended as the loop runs); "The history IS the payload of the escalation: after the 20th failed loop, the item escalates to the operator with the full finding history, never a relabeled pass" (lines 215-226).

4. **references/gauntlet.md** — Section 9 fix-cap bullet: "move on" replaced by ESCALATES to the operator WITH ITS FULL FINDING HISTORY (lines 640-644). BLOCKED row: "the 3-cycle cap" → "the fix cap (Rule 3.22 — 20 cycles per finding)" (line 670). §13.6: "3-cycle cap" → "20-cycle cap" (line 1022). Worked example: "three failed cycles" → "twenty failed cycles … escalated with the full finding history" (lines 505-507).

5. **SKILL.md** — QC + fix pipeline block: every FAIL loops back to the builder WITH THE CRITIC'S EXACT FINDING — verbatim, never paraphrased, never stripped of its evidence; the loop is bounded (max 20 cycles per finding) and recorded (every cycle appends the finding, the fix, and the re-judge result to the finding's verdict block in the live ledger); after the 20th failed loop: escalate to the operator WITH THE FULL FINDING HISTORY — never a quiet give-up, never a relabeled pass (lines 1269-1277).

6. **PROMPT-QC-INSTRUCTIONS.md + pipeline.md QC RECORD** (concurrent slice work, verified consistent with this slice): `outcome=<PASSED|LOOPED cycle n of 20|ESCALATED after 20>` (PROMPT-QC-INSTRUCTIONS.md line 26; pipeline.md line 285); mechanical check 5 — "a 21st pass carries ESCALATED with the full finding history" (pipeline.md lines 306-310). Loop-bound wiring into the QC record, consistent with the Stage 3 mechanics.

## Verification (independent, after commit)

- `grep -rn "3-cycle\|three cycles\|three failed cycles" .claude/` → zero matches (rc=1). All 10 D1 sites fixed; no contradiction remains.
- `grep -rn "20 cycles per finding" .claude/skills/spec-protocol/` → pipeline.md:307, gauntlet.md:638, PROMPT-QC-INSTRUCTIONS.md:35, SKILL.md:1272, SKILL.md:1553 — consistent number everywhere.
- `grep -rn "EXACT FINDING\|exact finding"` → pipeline.md:527 (loop-back), SKILL.md:1270 (loop-back), documents.md:218 (history records the exact finding).
- `grep -rn "FULL FINDING HISTORY\|full finding history"` → pipeline.md:543, loops.md:234, gauntlet.md:641, documents.md:223, SKILL.md:1276, PROMPT-QC-INSTRUCTIONS.md:36, pipeline.md:308 — escalation wired in every loop owner.
- `git show --stat 73f5af7` → 6 files, 174 insertions, 37 deletions, all under .claude/skills/spec-protocol/ — no out-of-slice file touched.
- All 6 files read in full (SKILL.md 1687 lines, pipeline.md 858, gauntlet.md 1243, documents.md 650, loops.md 547, PROMPT-QC-INSTRUCTIONS.md 21); no grep-only judgement.

## Boundaries

- Touched ONLY fix-loop mechanics (the slice). The Law 50 / QC-record work (slice 4, commit 887683d) was already merged into the same files by a concurrent builder; this slice's edits compose with it (both cite the same WAVE 4 DISPATCH). No other issue content touched.
- Backup branch `backup/wf-4d-slice3-pre` restores pre-slice-3 state: `git -C /Users/blackceomacmini/work-999-setup-fix/WF-4D reset --hard backup/wf-4d-slice3-pre`.
