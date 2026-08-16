# WF-4A slice 3 evidence — Issue 13 FIX step 3: reconcile call sites

**Slice:** anchor-reconcile. FIX step 3 of Issue 13 (999-master-fix-spec-20260815.md line 289):
"tools/anchor.sh --mode reconcile runs at every wave boundary, every cron/loop tick start,
after every compaction, and before every dispatch — the three-way reconciler (manifest <-> native
task graph <-> project_state.json <-> artifacts on disk)."

**Method:** full-file reads (no grep for judgment) of the tool, SKILL.md, and every reference file
that owns a ritual point; each claim below cites file + line.

## 1. The tool exists and is complete (verified by full read + execution)

- tools/anchor.sh (1366 lines at base 53b8ad2, read in full): three-way reconciler with
  layer 1 manifest (SPEC/PROJECT-MANIFEST.md), layer 2 native task graph
  (CONTROL/task-graph-snapshot.json), layer 3 project state (CONTROL/project_state.json),
  plus artifacts on disk (repos/, captures/, CONTROL/) — anchor.sh lines 3-14, 758-765.
- RITUAL POINTS header names all four required points + the 30-minute rule: anchor.sh lines 20-23
  ("every phase boundary; every loop or cron tick start; the FIRST action of a post-compaction
  turn; before every dispatch; at least every 30 minutes").
- EXIT-CODE CONTRACT 0/2/3/4 with TERMINAL-DRIFT flag stop: anchor.sh lines 25-32, 437-442,
  949-973. Self-proving detector (fixtures + controls, BROKEN INSTRUMENT on failure): lines
  289-340, 444-468.
- **Execution proof:** `bash tools/anchor.sh --selftest` from the tools dir —
  "SELFTEST COMPLETE | 17 of 14 cases passed | 0 failed" (14 cases; case 14 carries 4
  sub-asserts; the printed total is the tool's authoritative count per anti-drift.md line 477).
  Real-corpus check passed: contentless=740 vs strict control=740, stateful spared=140,
  brittle literal=0 — the exact Issue 13 numbers. bash -n syntax clean.

## 2. Call sites verified present (one per ritual point)

### a. Every wave boundary
- SKILL.md "Atomic ledger writes" anti-drift contract (line 1602-1612): "At every wave boundary,
  at every cron/loop tick start, after every compaction, and before every dispatch, the
  conductor runs `tools/anchor.sh --mode reconcile`" — line 1609-1612. THE contract line.
- references/anti-drift.md section 2 "WHEN it runs" — lines 149-154: "at every phase boundary;
  at the start of every loop or cron tick; as the FIRST action of a post-compaction turn;
  before every dispatch; and at least every 30 minutes". The canonical WHEN list.
- references/execution-architecture.md section 10 — lines 398-412: "RECONCILE TASKS NOW...
  executed at every major phase boundary, at every loop or cron tick, after every compaction,
  and before every dispatch", with the GATE — RECONCILE (lines 418-422) and the
  TERMINAL-DRIFT flag stop.
- **WIRED (this commit):** references/pipeline.md "Waves and the two brakes" gains
  "Reconcile at every wave boundary" — lines 146-151: run `tools/anchor.sh --mode reconcile`
  when a wave closes and the next wave is drawn, execute its RECONCILE-ACTIONS, re-run until
  clean, BEFORE any unit of the next wave dispatches; skipping it is a violation.
  (Previously the wave mechanics at pipeline.md lines 136-150 described wave drawing but had
  no reconcile step — the wave-boundary call site was the missing one.)
- references/capacity.md 6.1 re-check table — line 521 row "Projected window spend vs budget |
  Every reconcile tick (5 min) and every wave boundary": **WIRED (this commit)** — the
  wave-boundary pass now explicitly runs inside the same ritual as
  `tools/anchor.sh --mode reconcile` (line 521). The other wave-boundary rows (lines 522, 526)
  already carry the same cadence.

### b. Every cron/loop tick start
- references/loops.md — line 382 (swarm watch tick, S10): "run tools/anchor.sh --mode reconcile
  (S10 — the three-way reconcile, including the terminal-drift counter)". Line 384: the cron
  prompt is command-shaped ("run /<swarm-watch-workflow>" or the anchor call). Line 417: attended
  one-shots omit the loop but never the reconcile.
- references/loops.md — line 481 (THE TICK step 1 of the loop shape): "RECONCILE: run
  tools/anchor.sh <home> <unit-or-IDLE> --mode reconcile; execute any RECONCILE-ACTIONS it
  emits; on a DRIFT-ALARM stop..." and step 0 line 479-480 TERMINAL-DRIFT gate.
- references/loops.md — lines 268-275: a cron tick with no ready task still executes station 16
  (RECONCILE NATIVE TASKS) and writes "RECONCILE | clean | counts=…, never a contentless
  heartbeat".
- references/gauntlet.md 14.4 The cron tick contract — lines 1197-1205: "A tick that appends a
  contentless heartbeat instead of reconciling is a banned write"; "One tick = one revolution"
  with station 16 reconcile (station 16 = gauntlet.md line 1115).
- references/workflows.md section 7 The cron-tick contract — lines 290-311: command-shaped
  `run /<saved-workflow-name>` plus "the anti-drift trailer" (line 299-304: "Then run
  tools/anchor.sh --mode reconcile <home> <unit>; do not re-plan"); precondition #0
  TERMINAL-DRIFT.flag (lines 308-309); gauntlet.md 14.4 cross-reference (line 313).

### c. After every compaction
- SKILL.md — line 1609-1612 (same contract line as (a): "after every compaction").
- references/anti-drift.md — line 150: "as the FIRST action of a post-compaction turn".
- references/execution-architecture.md — line 404: "after every compaction".
- references/resume.md — lines 43-55 (restart steps step 0(c)): "run tools/anchor.sh <home>
  IDLE --mode reconcile — the resume is not oriented until a fresh RECONCILE line exists",
  project_state.json read first. Resume = the post-compaction/crash turn's entry procedure.

### d. Before every dispatch
- SKILL.md — line 1609-1612 (the same contract sentence, "before every dispatch").
- references/anti-drift.md — line 150: "before every dispatch".
- references/execution-architecture.md — lines 404-405 and the GATE — RECONCILE (418-422):
  "A conductor that dispatches on top of an unreconciled alarm is in violation" + flag stop.
- references/loops.md — line 417: "the reconcile: tools/anchor.sh --mode reconcile still runs
  at every phase boundary and before every dispatch".
- references/gauntlet.md — line 1115, station 16 of the 19-station loop (the loop every
  revolution runs before any new dispatch; also the gauntlet table at 1098-1118).
- references/workflows.md — line 302 (cron dispatch trailer).
- **WIRED (this commit):** SKILL.md RULE 4 DISPATCH RULES step 0 (lines 190-194): "Reconcile
  first: run `tools/anchor.sh --mode reconcile` (with `--tasks` + `--state`), execute any
  RECONCILE-ACTIONS it emits, and re-run until clean (S10). Precondition #0:
  CONTROL/TERMINAL-DRIFT.flag is absent — while it exists, nothing dispatches."
  (RULE 4's numbered dispatch procedure previously began at "Read the dependency graph" with no
  reconcile step.)
- **WIRED (this commit):** SKILL.md RULE 3 pairing block (lines 144-151): "Before every
  dispatch: run `tools/anchor.sh <home> <unit-or-IDLE> --mode reconcile` first (with --tasks
  --state), execute any RECONCILE-ACTIONS it emits and re-run until clean, then the topological
  sort..." plus violation note: "A dispatch on top of an unreconciled alarm, or while
  CONTROL/TERMINAL-DRIFT.flag exists, is a violation (S10)".
- SKILL.md S10 enforcement row — lines 226-227 (watch-loop standard: last reconcile no older
  than the interval; on alarm stop dispatching and reconcile before anything else).
- references/pipeline.md Dispatch section — lines 227-256 (dispatch-log-before-fire, ledger
  citation) — reconcile already bound at the wave level by this commit's pipeline.md edit.

## 3. What was missing and what was wired (this commit 4d41cf0)

| Ritual point | Was present | Wired |
|---|---|---|
| tool exists + self-proving | yes (anchor.sh, selftest 14/14 green) | — |
| wave boundary | contract yes (SKILL.md 1609; anti-drift.md 149) but the wave-mechanics page (pipeline.md Waves) had no reconcile step | pipeline.md lines 146-151; capacity.md line 521 |
| cron/loop tick start | yes (loops.md 382/481, workflows.md 302, gauntlet.md 1197) | — |
| after compaction | yes (anti-drift.md 150, exec-arch.md 404, resume.md 51) | — |
| before every dispatch | contract yes; RULE 4 procedure lacked the step | SKILL.md RULE 4 step 0 (190-194) + RULE 3 block (144-151) |

Commit 4d41cf0 on fix/13-anti-drift — "spec-protocol: reconcile at every wave boundary +
dispatch precondition (Issue 13 FIX step 3, WAVE 4 DISPATCH 2026-08-16T20:12Z)" — 2 files,
7 insertions, 1 deletion. Cites WAVE 4 DISPATCH 2026-08-16T20:12Z (FIX-LEDGER.md line 70).

## 4. Verification performed

1. `bash tools/anchor.sh --selftest` in place: SELFTEST COMPLETE 14 cases, 0 failed
   (17 report() calls — case 14 has 4 sub-asserts; printed total authoritative per
   anti-drift.md line 477). Real-corpus: 740/740 contentless, 140 stateful spared, brittle 0.
2. bash -n on anchor.sh: clean.
3. git show 4d41cf0 --stat: exactly 2 files (pipeline.md +6, capacity.md ±1).
4. Branch tip after rebase: 49f9edf (slice 5 commit, untouched) over 4d41cf0 over 6dd8829
   (slice 1), 9e0fdb8 (slice 2), 53b8ad2 (slice 4) — all authors CI <ci@example.test>,
   all citing WAVE 4 DISPATCH 2026-08-16T20:12Z. Working tree: only untracked files
   (holding/pre-slice4-backup/, tools/__pycache__/ — owned by sibling slices).
5. Concurrent-slice note: anchor.sh CLASS 7 (slice 1, FIX step 1) and boss-cron drift check
   (slice 2, FIX step 2) landed as commits 6dd8829 and 9e0fdb8 during this slice; a stale
   working-tree copy of slice 1's in-progress class-7 edits (later superseded by 6dd8829's
   committed version, which includes the empty-ledger fixture fix) was stashed, the stash
   replayed and resolved (kept the committed upstream version), then dropped. No foreign
   content was committed by this slice.
