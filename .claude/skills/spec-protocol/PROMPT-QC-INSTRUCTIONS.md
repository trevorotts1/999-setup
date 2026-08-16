# QC Rulebook — the ten categories

Every built unit is scored on ten categories, each 1 to 10, with quoted proof
beside every score. The gate is **8.5 — arithmetic, not judgement**. Below 8.5
the fix loop runs; at or above 8.5 the unit passes into the landing queue.

**Law 50 — the bar wins by default (binding on every verdict).** A judge
verdict is one of: PASS, FAIL (looped to the builder with the exact finding,
max 20 cycles), or the non-success states **BLOCKED / INFEASIBLE / LIMIT
REACHED** — which are NEVER relabeled PASS. If the comparison cannot run (bar
unreachable, format mismatch, judge cannot render both sides), the item is
BLOCKED, not passed: "could not compare" is a fail, not a pass. An operational
limit (fix cap hit, timeout, budget, rate limit) ends the item NOT PASSED,
never PASS. Every verdict block names the bar it was judged against.

**The QC RECORD — every verdict is written in this format** (full spec in
`references/pipeline.md`, Stage 2). Every judge pass produces ONE record,
written to the ledger's verdict blocks through `tools/ledger.sh` the moment the
verdict is reached. Four fields, one line each, in this order:

```
QC-RECORD unit=<unit id> judge=<judge seat label> bar=<the bar, named>
bar-fetch=<how the bar was obtained: URL | capture path | file path | the
answer-key block reference — a bar with no fetch proof is not a bar>
verdict=<PASS|FAIL|BLOCKED|INFEASIBLE|LIMIT-REACHED>
outcome=<PASSED|LOOPED cycle n of 20|ESCALATED after 20>
blind=<yes> model-independence=<PROVEN|UNPROVEN> self-qc=<no>
```

Mechanically checkable: (1) `judge=` differs from the unit's builder seat (Law 7
— zero self-QC; compare RESOLVED base ids when recorded); (2) `bar=` is a named
bar (Law 48); (3) `bar-fetch=` names a fetchable source (a bar that cannot be
fetched is BLOCKED, Law 50); (4) `verdict=` is exactly one of the five values —
binary for the loop, non-success states never relabeled PASS; (5) `outcome=`
is PASSED or LOOPED `cycle n of 20` (Rule 3.22 — 20 cycles per finding; the
21st pass is ESCALATED with the full finding history). A record failing any
check is a defective record: the verdict does not stand, and the defect is a
finding. This is how the "every record shows a blind critic, a named bar, a
binary verdict, and the loop-or-pass outcome; zero self-QC" bar is checked.

The categories:

1. Does it actually work?
2. Is it correct in the hard cases?
3. Are there real, running tests?
4. Is it complete, with nothing left as a placeholder?
5. Are there any secret leaks?
6. Is it safe and sound?
7. Is it clean and readable?
8. Does it fit the existing project?
9. Is it honest and fully verified?
10. Is it actually done, front to back?

This file is the canonical source of the ten categories referenced from
`references/pipeline.md` and `references/documents.md`.
