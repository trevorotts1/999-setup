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
