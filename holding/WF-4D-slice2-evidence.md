# WF-4D slice 2 — FIX: the QC record format in the skill, mechanically checkable (Issue 17)

**Slice:** WF-4D slice 2 (Issue 17 QC protocol — the QC record format + mechanical checkability)
**Branch:** fix/17-qc-protocol (working copy /Users/blackceomacmini/work-999-setup-fix/WF-4D)
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md — Issue 17 (lines 380-389), PART 1 QC protocol (lines 460-472), Issue 17 QC bar (line 388)

## The bar (spec line 388, verbatim)

> "every record shows a blind critic, a named bar, a binary verdict, and the loop-or-pass outcome; zero self-QC."

Issue 17 FIX (spec lines 386-389): define the QC protocol in the skill, wire records so they are mechanically checkable. Every file below was read in FULL before editing (Read tool, never grep for judgment); every claim cites file + line.

## Defect found

**D1 — no QC record format exists in the skill.** The skill's QC machinery names verdicts, verdict blocks, and scores everywhere, but NO file defines a record FORMAT carrying the four Issue-17-bar elements (blind critic, named bar, binary verdict, loop-or-pass outcome) in one mechanically checkable shape. A judge produces "a verdict" with no mandated record to write; the Issue 17 QC bar ("every record shows …") is uncheckable because records have no defined shape. Evidence of the absence (named sources): `references/pipeline.md` Stage 2 (lines 260-442) — the 8.5 gate, fail-closed rules, and three-gate stack carry no record format; `references/documents.md` document 6 (lines 202-243) — verdict blocks carry scores, quoted proof, cycle count, and merge records but no record format; `PROMPT-QC-INSTRUCTIONS.md` (31 lines) — the ten categories and the gate, no record format; `references/workflows.md` §9 unit-qc example (lines 559-607) — the judge returns `verdict` + `largest_gap` + `evidence` only, no record fields; SKILL.md pipeline summary (lines 1263-1280) — no record format. Not checked: files outside `.claude/skills/spec-protocol/` (out of this slice's scope); the live boss-cron at `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (owned by WF-4E slice, spec Issue 18 — the sanctioned-class allowlist there already carries `CRITIC-PASS`/`CRITIC-FAIL` line classes, verified by read).

## Fix applied — the QC RECORD, wired into five skill files

The QC RECORD: six fields, one line each, in fixed order. Written to the ledger's verdict blocks (document 6) through `tools/ledger.sh` the moment the verdict is reached (Law 2). A judge that returns a verdict without writing the record has not produced a verdict.

```
QC-RECORD unit=<unit id> judge=<judge seat label> bar=<the bar, named>
bar-fetch=<how the bar was obtained: URL | capture path | file path | the
answer-key block reference — a bar with no fetch proof is not a bar>
verdict=<PASS|FAIL|BLOCKED|INFEASIBLE|LIMIT-REACHED>
outcome=<PASSED|LOOPED cycle n of 20|ESCALATED-BLOCKED reason=<the bar or comparison failure>|ESCALATED-INFEASIBLE reason=<no comparable bar>|ESCALATED-LIMIT-REACHED reason=<the operational limit — fix cap, timeout, budget, rate limit>>
blind=<yes> model-independence=<PROVEN|UNPROVEN> self-qc=<no>
provenance=<STRIPPED|VIOLATION>
```

Six mechanical checks (any cold agent or the boss cron can run them without judging):
1. `judge=` differs from the unit's builder seat — zero self-QC (Law 7; resolved base ids when recorded).
2. `bar=` is a named bar (Law 48).
3. `bar-fetch=` names a fetchable source — a bar that cannot be fetched is BLOCKED (Law 50).
4. `verdict=` is exactly one of PASS | FAIL | BLOCKED | INFEASIBLE | LIMIT-REACHED — binary for the loop; non-success states never relabeled PASS (Law 50).
5. `outcome=` is PASSED | LOOPED `cycle n of 20` | ESCALATED after 20 (Rule 3.22 — 20-cycle cap, operator ruling 2026-08-14; ESCALATED carries the full finding history). A FAIL with no LOOPED line is a broken record.
6. `provenance=` is STRIPPED — the critic's package carried no timestamps, authorship, history, builder identity, builder reasoning, or effort narrative (Law 49); VIOLATION voids the verdict.

Map to the Issue 17 bar: checks 1+6 prove the blind critic, checks 2-3 prove the named bar, check 4 proves the binary verdict, check 5 proves the loop-or-pass outcome, check 1+6 prove zero self-QC.

### Files changed (all under .claude/skills/spec-protocol/, one unit, one commit)

1. `references/pipeline.md` — Stage 2 gains "The QC record — the one format every item's verdict is written in" (the six-field template, the six mechanical checks, the check-to-bar mapping, the defective-record rule) after the Stage 2 header; fail-closed rule 9 added ("Any QC record that fails the six mechanical checks … the broken record is returned to the builder as a finding") and the pre-existing Law 50 fail-closed rule renumbered from 9 to 10 (the slice-1/slice-2 merge had left two rule 9s; verified at HEAD line 430 before the fix). Lines 289-348 (record section), 425-436 (fail-closed rules 9-10).
2. `PROMPT-QC-INSTRUCTIONS.md` — "The QC RECORD — every verdict is written in this format" block added after the Law 50 paragraph: template, the six checks, defective-record consequence. Lines 16-44.
3. `references/documents.md` — document 6 (live ledger): every verdict block opens with the QC RECORD; "What makes it wrong" gains the defective-record class. Lines 227-236, 242-248.
4. `references/workflows.md` — §9 unit-qc example: judge brief requires the record fields (judge, bar, bar_fetch, verdict, outcome, self_qc, provenance); schema enforces them (provenance required); the run returns `records_broken` (units whose verdicts lack a mechanically checkable record); `self_qc === 'no'` and `provenance === 'STRIPPED'` are the zero-self-QC and blind proofs. Lines 559-618.
5. `SKILL.md` — pipeline summary step 2: "Every judge pass writes ONE QC RECORD" (six fields, ledger verdict blocks via tools/ledger.sh, six checks in pipeline.md Stage 2); Law 7 table row: every verdict is written as a QC RECORD, judge seat differs from builder seat with provenance=STRIPPED (zero self-QC); step 20 self-audit gains the QC-RECORD audit (enumerate records with the census commands, report each count, a record failing a check is a defect). Lines 1285-1295, 1420, 1217-1226.

Sibling-slice compatibility (verified): slice 3 (commit 73f5af7) owns the loop mechanics (20-cycle cap, exact-finding loop-back, escalation, per-cycle history) and slices 4 (887683d) and 1 own Law 50 and the PASS standard; this slice's record format references those by name and line and adds no conflicting rule. One merge defect found and fixed in this slice: slice 1's Law 50 fail-closed rule and this slice's QC-record rule both landed as "9." in the fail-closed list (two rule 9s at HEAD, verified by read at line 430) — this slice renumbered Law 50 to 10 and corrected the QC-record rule's check count to six with the provenance element. gauntlet.md cap-language corrections made here (lines 505, 666, 1018 — "three failed cycles"/"3-cycle" → the 20-cycle cap) are consistency fixes to text the record format's `outcome=` field cites; no other file outside the five above was touched. backups: five .bak-wf4d-s2 files created in holding/ (mtimes 17:03:40, before the fix commit 1c70d2a). Note (re-check critic): the earlier "backups: none created" claim was false — corrected here.

## Verification (mechanical, with the instrument proven)

1. The five files carry the format consistently — `QC-RECORD` anchor present in all five; `provenance=STRIPPED`/`provenance === 'STRIPPED'` present in all five; the six-check wording in pipeline.md, PROMPT-QC-INSTRUCTIONS.md, SKILL.md, documents.md (verified by grep counts, instrument proven on a known-positive first).
2. A Node simulation ran the six checks against a sample record (positive) and two negative controls: ALL SIX PASS: true; self-QC caught: true (judge seat = builder seat); non-binary verdict caught: true. Exit 0. (Command and output quoted in the session.)
3. `git diff` vs main reviewed in full: 5 files, all additions/consistency corrections, no removals of pre-existing doctrine (sibling slices' committed content intact; uncommitted working-tree changes from other slices left untouched).

## Ledger claim

`WF-4D slice 2: QC record format defined and wired — six-field QC RECORD (unit judge bar bar-fetch verdict outcome blind model-independence self-qc provenance), six mechanical checks, written to ledger verdict blocks via tools/ledger.sh; wired into pipeline.md (Stage 2 + fail-closed rule 9), PROMPT-QC-INSTRUCTIONS.md, documents.md (document 6), workflows.md (unit-qc schema + records_broken), SKILL.md (pipeline summary, Law 7 row, step 20 QC-RECORD audit); mechanical checkability proven by simulation with negative controls; commit <sha> on fix/17-qc-protocol — WAVE 4 DISPATCH 2026-08-16T20:12Z`
