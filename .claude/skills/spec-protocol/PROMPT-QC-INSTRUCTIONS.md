# QC Rulebook — the ten categories

Every built unit is judged by a blind critic (Law 49 — the critic sees the
work, never the effort) against the item's named, fetchable bar (Law 48).
**PASS is a verdict format for one mandatory conjunction, never a substitute
for its score or evidence.** It requires a recorded 0–10 score of **at least
8.5** under these ten categories, every mandatory behavior/scope/evidence
check, and the independent reference comparison. PASS at Gate 3 also requires
the bar's declared relationship, frozen at selection: wins-or-ties → the
neutral result privately mapped to the candidate (`A` or `B`), or `TIE`,
passes; `UNVERIFIABLE` does not. Meet-all-requirements → every requirement
checked passes. The judge never sees or raises the relationship, and the
visible record never leaks which blinded side was the candidate. A missing,
non-finite, or out-of-range score is UNVERIFIED and cannot PASS; a high score
cannot override a failed mandatory check or comparison.
FAIL = looped to the builder with the critic's exact finding, using the project's
bounded repair-attempt policy (legacy default: max 20 cycles per finding; an adopted profile
uses its canonical root-bound submission/verdict counters instead), then escalation to the operator with the full finding
history (Rule 3.22, operator ruling 2026-08-14). The non-success states
BLOCKED / INFEASIBLE / LIMIT REACHED are never relabeled PASS (Law 50).
`CLIENT-ACCEPTED` is the client's own acceptance of a unit that did not meet
the relationship, carrying the one named gap; no judge ever writes it.

The ten categories below are the critic's rubric surface — quoted proof
beside every judgement. Each category's judgement maps to the binary
verdict: any category that fails the frozen relationship against its bar is
a FAIL, and its exact finding loops the item to the builder.

**Law 50 — the bar wins by default (binding on every verdict).** A judge
verdict is one of: PASS, FAIL (looped to the builder with the exact finding,
the project's bounded repair cap), or the non-success states **BLOCKED / INFEASIBLE / LIMIT
REACHED** — which are NEVER relabeled PASS. If the comparison cannot run (bar
unreachable, format mismatch, judge cannot render both sides), the item is
BLOCKED, not passed: "could not compare" is a fail, not a pass. An operational
limit (fix cap hit, timeout, budget, rate limit) ends the item NOT PASSED,
never PASS. When a finite repair allowance is exhausted, preserve the best
candidate with its finding and record BLOCKED or LIMIT-REACHED; it is not
passed. Every verdict block names the bar it was judged against.

**The QC RECORD — every verdict is written in this format** (full spec in
`references/pipeline.md`, Stage 2). Every judge pass produces ONE record,
written to the ledger's verdict blocks through `tools/ledger.sh` the moment the
verdict is reached. Six fields, one line each, in this order:

```
QC-RECORD unit=<unit id> judge=<judge seat label> bar=<the bar, named>
bar-fetch=<how the bar was obtained: URL | capture path | file path | the
answer-key block reference — a bar with no fetch proof is not a bar>
verdict=<PASS|FAIL|BLOCKED|INFEASIBLE|LIMIT-REACHED>
outcome=<PASSED|LOOPED cycle n of <cap>|ESCALATED after <cap>|ESCALATED-BLOCKED reason=<the bar or comparison failure>|ESCALATED-INFEASIBLE reason=<no comparable bar>|ESCALATED-LIMIT-REACHED reason=<the operational limit — repair cap, timeout, budget, rate limit>>
blind=<yes> model-independence=<PROVEN|UNPROVEN> self-qc=<no>
provenance=<STRIPPED|VIOLATION>
```

Mechanically checkable: (1) `judge=` differs from the unit's builder seat (Law 7
— zero self-QC; compare RESOLVED base ids when recorded); (2) `bar=` is a named
bar (Law 48); (3) `bar-fetch=` names a fetchable source (a bar that cannot be
fetched is BLOCKED, Law 50); (4) `verdict=` is exactly one of the five values —
binary for the loop, non-success states never relabeled PASS; (5) `outcome=`
is PASSED, LOOPED `cycle n of <cap>`, ESCALATED, or ESCALATED-BLOCKED /
ESCALATED-INFEASIBLE / ESCALATED-LIMIT-REACHED with a reason= (Rule 3.22 — 20
cycles per finding; the 21st pass is ESCALATED with the full finding history;
a Law-50 verdict with no ESCALATED-<STATE> reason= is a broken record); (6)
`provenance=` is STRIPPED (Law 49 — the critic sees the work, never the
effort: no timestamps, authorship, history, builder identity, builder
reasoning, or effort narrative in the critic's package; a VIOLATION, or
evidence naming a builder or timeline, voids the verdict). A record failing
any check is a defective record: the verdict does not stand, and the defect
is a finding. This is how the "every record shows a blind critic, a named
bar, a binary verdict, and the loop-or-pass outcome; zero self-QC" bar is
checked — checks 1 and 6 prove the blind critic. The adjacent `SCORE` record
must contain a finite 0–10 score of at least 8.5 for PASS; it remains evidence
of the existing ten-category rubric, not a replacement for any of these checks.

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
