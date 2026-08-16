# WF-5B SLICE 4 EVIDENCE — Issue 19 FIX step 6: Client-Machine Adaptation

Builder: WF-5B builder slice 4 (Issue 19 FIX step 6 — "probe the client machine
at Capacity-Ledger time"; spec 999-master-fix-spec-20260815.md line 426).
Branch: fix/19-gauntlet. Commit cites ledger line: `WAVE 5 DISPATCH
2026-08-16T21:22Z` (FIX-LEDGER.md line 74).

## 1. Spec authority read (full-file reads, no greps)

- 999-master-fix-spec-20260815.md read in full (628 lines):
  - Issue 19 FIX step 6 = line 426 (probe cores/RAM/free-disk/network at
    Capacity-Ledger time; clientCap = min(systemConcurrentMax, cores−2);
    declared max authoritative, env read REPORTING ONLY; UNDETERMINED refuses
    to plan, never defaults to 16; batch size = clientCap, batches =
    ceil(slices/clientCap), wave count unchanged; THE BAR NEVER SHRINKS WITH
    THE MACHINE — ONLY THE WIDTH DOES).
  - Step 7 wire-in points = line 427 (capacity.md owns the machine probe and
    the cap arithmetic; gauntlet.md owns the mechanical wiring).
  - QC bar = line 430 (client cap = min(systemConcurrentMax, cores−2),
    systemConcurrentMax = the operator's declared max 10 — authoritative for
    computing; env read reporting-only; never hardcoded; bar unchanged by the
    machine).
  - Step 1 = line 414 (counts are SLICES — sequential batches of at most
    clientCap, never all at once; WF02 16 slices -> 2 batches (10 + 6) on the
    operator's machine).

## 2. Files touched (exactly the three named by step 6 + step 7 wire-ins)

### 2.1 .claude/skills/spec-protocol/references/capacity.md (owns the probe + cap arithmetic)
- New "THE CLIENT-MACHINE PROBE (binding — Issue 19 FIX step 6…)" block at
  §3 AXIS 1 (line ~126): four-probe table (cores -> clientCap; RAM ->
  browser-agent count; free disk -> MEDIA-GAPS threshold — below it the media
  lane takes the without-media path; network -> provider reachability gating).
  clientCap = min(systemConcurrentMax, cores−2); declared max authoritative for
  computing; env read (CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) REPORTING ONLY,
  never for computing, with the sub-agents-doc quote ("workflow agents and
  agent team teammates, follow their own limits instead"); UNDETERMINED =
  refuse to plan, never 16; THE BAR never shrinks — only the width does.
- Operator-machine worked example: cores 12 [MEASURED] -> systemConcurrentMax
  10 (declared) -> clientCap = min(10, 12−2) = 10.
- §3 reconciliation rule ("The wave width is the SMALLEST of three numbers…")
  rewritten: harness term = workflows-in-flight × clientCap, with the step-6
  parenthetical; worked numbers 2 × 10 = 20 / 30 × 10 = 300 unchanged in value.
- §4 ledger template: new CLIENT-MACHINE PROBE block (Cores/RAM/Free
  disk/Network/systemConcurrentMax/clientCap lines, each with its provenance
  mark; systemConcurrentMax marked [DECLARED operator doctrine — never from an
  env read; UNDETERMINED = the run refuses to plan, it never defaults to 16]);
  AGENTS PER WORKFLOW line now <k = clientCap>; new BATCH SCALING line (batch
  size = clientCap; batches = ceil(slice count / clientCap); wave count
  unchanged; worked example 16 slices -> 2 batches (10 + 6), wave count stays
  5; THE BAR NEVER SHRINKS WITH THE MACHINE — ONLY THE WIDTH DOES).
- §4 compute procedure step 2 replaced: "Run the CLIENT-MACHINE PROBE (Issue
  19 FIX step 6 — at Capacity-Ledger time, i.e. HERE)" — full instrument set,
  declared-max read, clientCap computation, UNDETERMINED refusal, per-probe
  gating, REPORTING-ONLY env note.
- §5 scenarios (a)-(d): each now opens with the probe line (clientCap 10 on
  the 12-core machine; scenario (c) notes the provider ceiling binds first).
- §10 budget declaration row 2: agents per workflow = clientCap from measured
  cores and the DECLARED systemConcurrentMax (never an env read; never
  defaulted to 16).
- §13.1 freshness table row 2 (M-RUN): the full probe with instruments; declared
  max authoritative; env read reporting-only; UNDETERMINED = refuse to plan.
- No min(16, cores−2) remains in capacity.md (verified: grep count 0).

### 2.2 .claude/skills/spec-protocol/references/gauntlet.md (mechanical wiring)
- §13 intro: new "clientCap (Issue 19 FIX step 6…)" block — definition,
  declared-max authority, env-read reporting-only, UNDETERMINED refusal, THE
  BAR NEVER SHRINKS — only the width does. (Sibling paragraph "Counts are
  SLICES, never concurrency…" is slice 1's, committed at HEAD 4411ff2; no
  duplication of doctrine.)
- §13.4 scaling rule: WF02 bullet now min(clientCap, W_builder); new BATCH
  SCALING bullet (batch size = clientCap; batches = ceil(slice count /
  clientCap); wave count unchanged; worked example 16 -> 2 batches (10 + 6);
  WF03's 16 judges batch identically; WF01 8, WF04 8, WF05 4 each fit one
  batch (8 ≤ 10, 4 ≤ 10); WF06 repair seats capped at clientCap per wave with
  the remainder batched sequentially); per-workflow bullet now clientCap with
  the probe instruments; closing line carries "THE BAR never shrinks with the
  machine — only the width does."
- §13.4 opening: 30 workflows × clientCap = 30 × min(systemConcurrentMax,
  cores−2).
- No min(16, cores−2) remains in gauntlet.md (verified: grep count 0).

### 2.3 .claude/skills/spec-protocol/SKILL.md (step 6.5 = Capacity-Ledger time)
- Step 6.5 now opens the ledger computation with THE CLIENT-MACHINE PROBE
  ("runs HERE, at Capacity-Ledger time — never before, never later"): probe
  cores/RAM/free disk/network; clientCap = min(systemConcurrentMax, cores−2);
  declared max authoritative; env read REPORTING ONLY; UNDETERMINED = run
  refuses to plan, never defaults to 16; scaling consequence (batch size =
  clientCap; batches = ceil(slice count / clientCap); wave count unchanged);
  THE BAR never shrinks with the machine — only the width does.
- Step 6.5 AGENTS-PER-WORKFLOW now labeled (clientCap).
- App-builder seat row (AXIS 1 WIDTH) updated to clientCap with the
  CLIENT-MACHINE PROBE attribution (capacity.md §3).
- RULE 2 lines 112/148/194/220 and line 393 ("min(16, cores−2) as EXECUTION
  clamp") left untouched — that is the operator's 16-ceiling doctrine, not
  step 6's clientCap; step 6 governs WIDTH arithmetic at ledger time.

## 3. What was NOT touched (slice boundary)

- capacity-resolver.sh: uncommitted step-6 wiring by a sibling slice (working
  tree); not staged, not committed by this slice.
- SKILL.md step 12.7 / gauntlet.md §13.1 six-workflow declarations / §13.2
  budget / §13.3 capacity rule: other slices' units.
- RULE 2, S4, workflows.md, interview.md, media-pipeline.md, pipeline.md: no
  edits.

## 4. Verification

- grep counts across the three touched files:
  - "clientCap = min(systemConcurrentMax, cores−2)": capacity.md 6, SKILL.md 2,
    gauntlet.md 2.
  - "never defaults to 16" family: capacity.md 4, SKILL.md 1, gauntlet.md 1.
  - "REPORTING ONLY, never for computing" family: capacity.md 2, SKILL.md 1,
    gauntlet.md 1.
  - "THE BAR never shrinks with the machine" family: capacity.md 2, SKILL.md 1,
    gauntlet.md 2.
  - "ceil(slice count / clientCap)": capacity.md 1, gauntlet.md 2, SKILL.md 1.
  - "wave count unchanged": gauntlet.md 2, capacity.md 1, SKILL.md 1.
- Stale-formula sweep: zero "min(16, cores−2)" in capacity.md and gauntlet.md;
  remaining 5 in SKILL.md are the RULE 2 / S4 / defaults-path execution-clamp
  doctrine (operator's 16-ceiling), explicitly out of step 6's scope.
- git diff review: 3 files + evidence; all hunks attributable to step 6;
  concurrent-slice edits (gauntlet.md slice 1, capacity-resolver.sh, SKILL.md
  step 12.7) verified as committed at HEAD or left unstaged — no overlap in
  the staged set.

## 5. Bar compliance (Issue 19 QC bar, spec line 430)

- client cap = min(systemConcurrentMax, cores−2): wired in all three files.
- systemConcurrentMax = the operator's declared max (10 on the operator's
  machine) — authoritative for computing: wired everywhere; the ledger
  template marks it [DECLARED operator doctrine — never from an env read].
- env read permitted for REPORTING only, never for computing: wired with the
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS example and the sub-agents-doc quote.
- never hardcoded: every mention carries the formula AND the measured/declared
  values; "never write 10 as a constant" retained.
- the bar unchanged by the machine: THE BAR NEVER SHRINKS WITH THE MACHINE —
  ONLY THE WIDTH DOES, wired in all three files.
- UNDETERMINED systemConcurrentMax = refuse to plan, never 16: wired in all
  three files.
