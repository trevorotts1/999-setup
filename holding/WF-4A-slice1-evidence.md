# WF-4A slice 1 evidence — Issue 13 FIX step 1: live ledger as single source of truth (anti-drift contract, mechanically checkable)

Slice: WF-4A slice 1 (builder, Opus). Branch: fix/13-anti-drift. Clone: /Users/blackceomacmini/work-999-setup-fix/WF-4A.
Cites: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70).
Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, Issue 13 (lines 280-294), FIX step 1 (line 287).

## What FIX step 1 requires

Spec line 287: "Live ledger as the single source of truth: every action references
a ledger line — written BEFORE the unit (the claim) and AFTER it (the result),
never only at the end (the anti-drift contract, SKILL.md lines 1535-1541)."

Gap found on entry (full reads): the contract was STATED in the skill
(SKILL.md "Atomic ledger writes" section, references/anti-drift.md section 8)
but NOT mechanically checkable — tools/anchor.sh had no pairing check. The
reconciler counted CLAIM/RESULT lines as state-carrying (STATE_RE, old line 225)
but nothing verified that a RESULT unit had a prior CLAIM for the same unit id.
A run could write RESULT lines with no claim and every reconcile would report
clean. The fix: wire the contract into the skill AND make anchor.sh check it.

## Files changed (5, all in the skill directory)

1. `.claude/skills/spec-protocol/tools/anchor.sh` — CLASS 7 (ledger provenance):
   - header comment names the check; `ANCHOR_CLAIM_UNPAIRED_TOL` knob (default 3, 0 = strict), validated
   - `ledger.cmd` awk helper: unit tokens of lines carrying a marker regex
   - reconcile-mode block (non-IDLE units only): CLAIM units vs RESULT units by exact unit id via `comm -13`; past tolerance -> `DRIFT-ALARM | unpaired-claim` + `ACTION|write-missing-claims`, exit 3; absent ledger -> `ledger-undetermined`, never clean
   - RECONCILE line gains `ledger=<verdict>` field: `ledger-ok(claimed=/resulted=/unpaired=/tol=)`, `unpaired-claim(n of m / tol=)`, `ledger-undetermined(reason)`, or `skipped(unit=IDLE)`
   - selftest case 14, four controls (baseline empty-ledger ok; tolerated unpaired; strict at TOL=0 alarms; paired clears)
   - regexes use `[|]` form — BSD awk rejects `\|`

2. `.claude/skills/spec-protocol/SKILL.md` — "Atomic ledger writes": contract now states the exact CLAIM/RESULT line shapes and that `tools/anchor.sh --mode reconcile` CLASS 7 pairs every RESULT unit against a prior CLAIM for the same unit id, alarming `unpaired-claim` past `ANCHOR_CLAIM_UNPAIRED_TOL`; absent ledger UNDETERMINED; IDLE claims nothing. RULE 5 row S10 now names the class-7 pairing as part of the reconcile gate.

3. `.claude/skills/spec-protocol/references/anti-drift.md` — section 4 becomes "the seven detection classes" with the full class-7 definition (comparisons, tolerance rationale, fail-closed absent-ledger rule, ledger= field for the boss cron); section 3(e) names the ledger field; section 8 states the pairing is mechanically checked and order-independent (a repaired claim restores provenance without rewriting history); section 7's selftest list names the case-14 controls.

4. `.claude/skills/spec-protocol/references/documents.md` — document 6 "What makes it wrong" gains: a RESULT unit whose CLAIM line was never written BEFORE the unit (with the tool citation).

5. `.claude/skills/spec-protocol/references/execution-architecture.md` — "six detection classes" -> "seven detection classes" including CLASS 7's pairing.

NOT touched: capacity.md / pipeline.md (sibling WF-4A slice work, left as found), tools/boss-cron, other references.

## Verification (all run, all passing)

- `bash -n tools/anchor.sh` — syntax OK.
- `bash tools/anchor.sh --selftest` — 17 PASS, 0 FAIL (14 cases; case 14 carries 4 controls). SELFTEST COMPLETE line: `17 of 14 cases passed | 0 failed`.
- End-to-end realistic ledger (/tmp/t15): CLAIM U-01 + RESULT U-01 (paired) + RESULT U-03 (unpaired). Reconcile at default tol=3: rc=0, `ledger=ledger-ok(claimed=1/resulted=2/unpaired=1/tol=3)`. Reconcile at ANCHOR_CLAIM_UNPAIRED_TOL=0: rc=3, `DRIFT-ALARM | unpaired-claim` written to CONTROL/LEDGER.md (1 line), `ledger=unpaired-claim(1 of 2 RESULT units / tol=0)`, `ACTION|write-missing-claims` emitted.
- Pre-existing case regression: cases 1-13 all PASS (real-corpus check: contentless=740 vs strict control=740, stateful spared=140).

## Claims

- CLAIM (before): this unit claims the anti-drift contract is wired into the skill and mechanically checkable.
- RESULT (after): selftest 17/17, e2e strict-mode alarm proven, evidence file written.
