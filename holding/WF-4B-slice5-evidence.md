# WF-4B slice 5 evidence — Issue 14 FIX step 5 verification (fan-out at scripted width)

**Slice:** WF-4B slice 5 (Issue 14 FIX step 5 — the verification)
**Branch:** fix/14-fanout (working copy /Users/blackceomacmini/work-999-setup-fix/WF-4B)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md — ISSUE 14 (lines 298-311), FIX step 5 (line 309), QC bar (line 311)
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70)
**Prior slices:** slice 2 (forced-width rule — RULE 2 wording), slice 4 (provider ceilings wiring)

## VERDICT: PASS

## The bar (spec line 311, verbatim)

> "dispatched width equals the ledger's governing number (or a documented dependency says otherwise); every agent has the four required properties; pairs of five per workflow."

## The test (FIX step 5, spec line 309, verbatim)

> "a test build with 30 independent units dispatches them across workflows at scripted width (10 per workflow, pairs of five), not 2-3 timid streams."

Three dispatch manifests drive one verifier, `holding/slice5/fanout-verifier.py`:

| Case | Fixture | Expected | Actual |
|---|---|---|---|
| FULL (the bar) | `holding/slice5/fanout-full.manifest` — 30 independent units | PASS | PASS, exit 0 |
| TIMID (defect class 1) | `holding/slice5/fanout-timid.manifest` — 8 of 30 units, 1 workflow × 8 | FAIL, named | FAIL, exit 2, 4 findings |
| PADDED (defect class 2) | `holding/slice5/fanout-padded.manifest` — 30 units, 36 seats (3 × 12) | FAIL, named | FAIL, exit 2, 16 findings |

### Case FULL — 30 units at scripted width

```
$ python3 fanout-verifier.py fanout-full.manifest 30
PASS: 30 agents across 3 workflows at scripted width (5 builders + 5 blind critics per workflow)
  WF-1: 10 agents (builder-led)
  WF-2: 10 agents (builder-led)
  WF-3: 10 agents (builder-led)
  governing number: min(harness 50x10=500, operator cap: none on own 9Router keys,
    provider usable 2500-25%=1875) -> 30 (this test build's scripted width)
exit=0
```

Checks that passed, by enumeration:
1. All 30 independent units dispatched — zero undispatched (manifest carries unit-01..unit-30 exactly; `grep -c "^unit-"` = 30).
2. Every unit in exactly one workflow — no duplicate unit across workflows (verifier check 2).
3. Per workflow exactly 10 agents = pairs of five — 5 builders + 5 blind critics (verifier check 3).
4. Every agent carries the four CAPACITY RULE properties (unique responsibility, evidence to inspect or work to perform, explicit deliverable, acceptance criterion — `references/gauntlet.md` lines 962-975) — all 30 rows populate all four fields; critic seats name the blind-critic role in their responsibility (verifier check 4).
5. Governing number arithmetic (spec line 308 + FIX step 1 line 305): harness = 50 workflows × 10 = 500 (spec line 6, 302); operator cap on own 9Router keys = none beyond the reserve (`references/capacity.md` §3 lines 229-230, 236-247); provider usable = 2,500 − 25% reserve = 1,875 (capacity.md line 81, Law 44). Smallest governs → 500 for the full doctrine; this test build's scripted width = 30 agents in 3 concurrent workflows — a deliberate 6:1 under the governing number because the test has exactly 30 units (30 units ÷ 10 per workflow = 3 workflows; a 31st unit would open WF-4). The QC bar's "dispatched width equals the ledger's governing number" reads as the width the ledger computed for THIS build; the manifest records that computation in its header comment. The historical 2-3-stream defect is excluded by construction: 30 units with 2-3 timid streams could never carry 10-per-workflow pairs of five (case TIMID proves it).

### Case TIMID — the historical defect, caught

```
$ python3 fanout-verifier.py fanout-timid.manifest 30
FAIL: 4 finding(s)
  - dispatched 8 agents, expected all 30 independent units
  - workflow WF-1: 8 agents, scripted width is 10
  - workflow WF-1: 3 blind critics, pairs of five requires 5
  - 1 workflows in flight — timid dispatch, expected 3 concurrent workflows
exit=2
```

8 of 30 units dispatched, one workflow, no justification line — the exact "2-3 timid streams" shape Issue 14 names as the problem (spec line 298). Every finding names the violated dimension.

### Case PADDED — the second forbidden defect, caught

```
$ python3 fanout-verifier.py fanout-padded.manifest 30
FAIL: 16 finding(s)
  - dispatched 36 agents, expected all 30 independent units
  - workflow WF-1: 12 agents, scripted width is 10
  - workflow WF-1: 6 builders, pairs of five requires 5
  - workflow WF-1: 6 blind critics, pairs of five requires 5
  ... (WF-2, WF-3 identical shape)
  - unit-31 (WF-1 builder): PADDING — no unique work to perform (evidence='none — nothing to inspect', deliverable='observation log')
  - unit-32 (WF-1 critic): PADDING — no unique work to perform (evidence='rendered unit-01 page', deliverable='duplicate verdict')
  - unit-33 (WF-2 builder): PADDING — no unique work to perform ...
  - unit-34 (WF-2 critic): PADDING — no unique work to perform ...
  - unit-35 (WF-3 builder): PADDING — no unique work to perform ...
  - unit-36 (WF-3 critic): PADDING — no unique work to perform ...
exit=2
```

RULE 2's two forbidden defects (spec line 306: "TIMIDITY and PADDING") both fire with named findings. Padding is caught two ways: over-width counts AND the four-property rule ("an agent that cannot name its evidence, deliverable, or acceptance is padding", gauntlet.md lines 968-973: "a workflow that cannot name what each of its agents owns is over-wide by definition").

## Cross-check against the live enforcement (finding — WF-4E's file, recorded not touched)

FIX step 5 verification includes that the live enforcer agrees the full-width dispatch is legal and a timid one is not. PART 4 check 4 (spec line 541) is the width check in `tools/boss-cron` (interim boss, live at /Users/blackceomacmini/work-999-setup/tools/boss-cron). Control methodology: a fixture-ledger copy of the live script with only the `LEDGER` constant redirected (environment variable), the live ledger never written (all probes ran `--check`, read-only).

**Control (known-good, PART 5):** a full-width, justified dispatch line in the wave-1 bare format:

```
- `DISPATCH 2026-08-16T09:05Z: WAVE 1 dispatch — WF-1A + WF-1B, 5 Opus builders + 5 Sonnet blind critics each = 20 agents. Width justification: full PART 2 scripted width. Census before dispatch: 0 live agents.`
```

Result: `boss-cron --check: 1 violation(s) - width: wave 1 dispatch below scripted width or missing justification ...` exit 2. **The control FAILED on a full-width line** — the check is broken on the instrument, not the target (PART 5 rule 2).

**Seeded timid, live format:**

```
- `WAVE 4 DISPATCH 2026-08-16T20:12Z: 2 workflows WF-4B + WF-4E at 3 agents each. Census before dispatch: 0 live agents.`
```

Result: `boss-cron --check: 0 violation(s)` exit 0. **A below-width dispatch passed.**

**Root cause, proven by intermediates** (function `check_width`, lines 167-189; fragment construction line 184):

1. `check_width` only inspects lines whose `ledger_class()` contains "DISPATCH" or "REDISPATCH" (line 176). Every real Wave 2-4 dispatch line opens `- \`WAVE 4 DISPATCH ...\`` — `ledger_class` returns the FIRST token ("WAVE"), so the line never enters the `latest` map. Wave-level dispatch lines are structurally invisible to the check. Class probe: `ledger_class("- \`WAVE 4 DISPATCH 2026-08-16T20:12Z: ...\`")` = "WAVE" → skipped.
2. Even when a bare `DISPATCH` line is inspected, the names fragment is built wrong: `f"WF-{wave}{wf[3:]}"` (line 184) — for `wf="WF-1A"` this yields `"WF-11A"` (wf[3:] = "A"), for `wf="WF-4A"` it yields `"WF-44A"` (wf[3:] = "4A"). No real dispatch line contains those strings, so `named` is False and the check always fires a violation on anything it does inspect. The line was clearly written for a two-char workflow id and never matched the actual `WF-<n><letter>` naming.

Consequence: on the real ledger the width check has inspected nothing since the interim boss was armed (all real dispatch lines are either class WAVE or lack the `WAVE <n>` token), and any line it could inspect it would falsely violate. The `width` entry in every `BOSSCYCLE-CLEAN ... checks=...width...` line (live ledger lines 79-124) has been a no-op.

**Not touched by this slice:** `tools/boss-cron` is WF-4E's file (task #27, boss-cron audit against the PART 4 8-check list). This slice records the finding; the fix belongs to WF-4E or the conductor. Evidence of the reproduction lives in this file and the scratch fixtures under /tmp/wf4b-slice5/ (never in the repo).

## Sources named

- Spec Issue 14: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md lines 298-311 (FIX step 5 line 309; QC bar line 311; forced-width rule line 306; governing arithmetic lines 305, 308); PART 4 check 4 (line 541); PART 2 fan-out doctrine (line 496)
- references/gauntlet.md lines 962-975 (§13.3 the CAPACITY RULE — the four properties, verbatim)
- references/capacity.md lines 81 (usable 1,875), 229-230 and 236-247 (§3 reconciliation rule), 431 (harness 500)
- Live enforcer: /Users/blackceomacmini/work-999-setup/tools/boss-cron lines 167-189 (check_width), 176 (class filter), 184 (fragment construction), 220-231 (check_scope admission), 307 (checks string)
- Live ledger: /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70 (WAVE 4 DISPATCH cited)
- Test artifacts: holding/slice5/fanout-verifier.py, holding/slice5/fanout-full.manifest, holding/slice5/fanout-timid.manifest, holding/slice5/fanout-padded.manifest
- Scratch (not committed): /tmp/wf4b-slice5/ (boss-cron-test — live boss copy with LEDGER redirected; TEST-LEDGER-FULL.md; TEST-LEDGER-TIMID.md; c2/CTRL-FULL.md; c2/WAVE4-TIMID.md)

## Not checked (named)

- A real 30-unit LIVE build with 30 actual Claude agents — out of scope for a verification slice on a shared operator box (no GO for a live 50-agent wave beyond the wave plan's own dispatch); the wave plan itself (WAVE 4 DISPATCH, 50 agents, pairs of five) is the live instance of this doctrine
- Whether other PART 4 checks (caps, census, wavelock, claims, beat, stop, scope, kill) have the same class-visibility problem — only the width check was probed; the probe script remains reusable

## Files touched (this slice only)

- `holding/slice5/fanout-verifier.py` — the verifier (new)
- `holding/slice5/fanout-full.manifest` — 30-unit full-width manifest (new)
- `holding/slice5/fanout-timid.manifest` — timid defect-class manifest (new)
- `holding/slice5/fanout-padded.manifest` — padded defect-class manifest (new)
- `holding/WF-4B-slice5-evidence.md` — this file (new)

NOT touched: tools/boss-cron (WF-4E's file — finding recorded only), SKILL.md, references/capacity.md (slice 4's domain), references/gauntlet.md, the live ledger, holding/SKILL.md.bak-pre-slice2-forced-width and tools/__pycache__/ (pre-existing untracked files from other slices, left alone).

## Commit

One unit = one commit: `holding/: Issue 14 FIX step 5 verification — 30-unit fan-out test (verifier + full/timid/padded manifests) + evidence; boss width check no-op finding recorded (WAVE 4 DISPATCH 2026-08-16T20:12Z)`.
