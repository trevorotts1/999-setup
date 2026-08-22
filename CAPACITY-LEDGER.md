# CAPACITY LEDGER — candice-companion — 2026-08-21

Safe live width for next dispatch wave (spec 0A formula, repo capacity doctrine).

## Provenance

| Input | Value | Mark |
|---|---|---|
| Date | 2026-08-21 | — |
| Repo base SHA | `6bb00ec70af69510fab5a9c2ef332751e260d036` (HEAD of main, matches LEDGER section 1) | [MEASURED `git rev-parse HEAD` 2026-08-21] |
| Cores | `hw.ncpu` = 12, `hw.physicalcpu` = 12 | [MEASURED `/usr/sbin/sysctl -n hw.ncpu` 2026-08-21] |
| RAM | 25,769,803,776 bytes (~24 GiB) | [MEASURED `/usr/sbin/sysctl -n hw.memsize` 2026-08-21] |
| systemConcurrentMax | 10 | [DECLARED operator doctrine — never from an env read; capacity.md section 3 AXIS 1] |
| clientCap | min(10, 12−2) = **10** | [MEASURED formula + declared constant] |
| Resolver instrument | `tools/capacity-resolver.sh --selftest` → PASS (exit 0, all scenario + discrimination checks, live cores=12 → clientCap 10) | [MEASURED 2026-08-21] |
| Key presence (names only) | DEEPSEEK_* absent; OPENROUTER absent; ANTHROPIC_BASE_URL PRESENT; CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS PRESENT; CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION PRESENT (treated INERT per capacity.md AXIS 2) | [MEASURED `printenv` by name 2026-08-21 — values never read] |
| Route canaries | COMPLETED — 0H gate, owned by WR-004 (candice-capacity), handle `wf_b9f59642-d5c`; opus route canary PASS, sonnet route canary PASS, max-thinking proof PASS both seats | [MEASURED EXECUTION-PLAN board 2026-08-21 — WR-004 COMPLETED, handle `wf_b9f59642-d5c` recorded] |

## The three axes (capacity.md section 3 — never conflated)

- **AXIS 1 WIDTH** — harness = 50 workflows × clientCap 10 = **500** (operator machine doctrine, 2026-08-16).
- **AXIS 2 BUDGET** — operator session budget **1,000 agent executions** (policy; decrementing, tracked in `CONTROL/project_state.json`). Workflow tool per-run cap 1,000 executions is a separate meter (recorded, not in force per-run here).
- **AXIS 3 POLICY** — 9Router on operator's own provider keys: no operator cap beyond the reserve.

## Per-provider ceiling | reserve | usable

| Provider path | Ceiling | Reserve | Usable | Note |
|---|---|---|---|---|
| DeepSeek v4 Flash (builder route via Nine-router) | 2,500 concurrent | 25% = 625 | **1,875** | [RESEARCHED api-docs.deepseek.com/quick_start/rate_limit 2026-08-16 — doctrine table] |
| DeepSeek v4 Pro (QC route via Nine-router) | 500 concurrent | 25% = 125 | **375** | same source |

## Safe live width (spec 0A formula, 2026-08-21)

```text
builder_width =
  min(
    250,
    usable_opus_route_concurrency_after_reserve = 1,875,
    runnable_unique_builder_stage_tasks = 50            <- WS-01..WS-50 all PENDING (TODO.md)
  )
  = 50

qc_width =
  min(
    250,
    usable_sonnet_route_concurrency_after_reserve = 375,
    runnable_unique_qc_or_recheck_stage_tasks = 0        <- zero BUILT_AWAITING_QC handoffs yet
  )
  = 0            <- initial moment only; 0B rolling saturation warms QC as handoffs land

safe_live_agents =
  min(
    500,
    builder_width + qc_width = 50,
    measured_harness_usable_concurrency = 500,
    measured_global_provider_usable_concurrency = min(1,875, 375) = 375
  )
  = 50

visible_workflow_run_count =
  min(
    50,
    ceil(50 / 10)
  )
  = 5
```

### Role-aware runs (governing formula)

```text
required_runs = max(ceil(builder_target / 5), ceil(qc_target / 5))
```

Disambiguation of the two run numbers (2026-08-21):

- `runs = 5` above is the role-blind spec-0A number (pre-V8 capacity view: width 50 / clientCap 10).
- `role_aware_runs = 10` is authoritative for dispatch: `required_runs = max(ceil(50/5), ceil(0/5)) = max(10, 0) = 10` — builder seats need 10 runs of 5 builders to place 50 builders; QC warms per 0B rolling saturation (0 handoffs at the initial moment). As handoffs accumulate, the QC term grows and the max re-derives from measured reality.
- `CONTROL/project_state.json` candice `safe_width.role_aware_runs = 10` carries the same value (machine truth, 2026-08-21).

### Per-role seats for the next dispatch wave

| Role | Width | Model seat | Thinking | Route |
|---|---|---|---|---|
| Builder | 50 (5 per run × 10 runs max, scaled to 50 runnable units) | opus | max | Nine-router (currently DeepSeek V4 Flash) |
| QC/fixer | 0 now; grows to ≤50 as handoffs accumulate (rolling saturation, spec 0B) | sonnet | max | Nine-router (currently DeepSeek V4 Pro) |
| Recheck | work-stealing from QC pool — never adds a seat (spec 0B) | sonnet | max | same |

Every agent call seat-pinned (`opus`/`sonnet` + max), never bare `agent()` — references/workflows.md section 0.0. Provider/model id never hardcoded; Nine-router owns the route behind the seat.

## Execution budget + reserves (spec 0F epochs)

```text
session/epoch execution budget (operator doctrine)   = 1,000
reserve for repair/recheck/release QC (30% slice)    =  300
                                                       ----
budget available to the current epoch                =  700
```

Reserve justification (spec 0F): QC repairs local defects, every repair gets a fresh independent recheck, release/final-QC wave needs its own seats. 30% of the 1,000 is the declared slice. Wave forecast (planning aid): W1 300–500 wide, W5 10–50 — total plan estimated inside 700 unless the task graph proves larger, then split into epochs with literal restart steps in LEDGER before rollover.

Budget status: `agents.executions_total = 0`, `session_budget_remaining = 52` in `project_state.json` are STALE `999-master-fix` residue from a prior project (LEDGER section 4, SESSION-LOG 2026-08-21). Ignored per spec 0J. Authoritative counts: LEDGER.md section 1 (safe width 50 committed; Active = WR-007 planning `wf_66e51e17-7cc` only; Completed = 12 — WR-001..WR-006, WR-008, audits `wf_7cb74348-fec`/`wf_d99de8ad-90b`/`wf_7920d06d-4c9`, audit-repair `wf_61fe0666-d88`, watchdog STOPPED). Regeneration of project_state.json is owned by a conductor/workflow, not this ledger.

## Gate status (spec 0H)

| Gate | Status |
|---|---|
| Capacity Ledger current | THIS FILE — fresh 2026-08-21 |
| Opus route canary | PASS (WR-004 `wf_b9f59642-d5c` COMPLETED 2026-08-21) |
| Sonnet route canary | PASS (WR-004 `wf_b9f59642-d5c` COMPLETED 2026-08-21) |
| Max-thinking proof both seats | PASS (WR-004 `wf_b9f59642-d5c` COMPLETED 2026-08-21) |
| Native task graph | PRESENT — `CONTROL/task-graph-snapshot.json` EXISTS, schema `candice/task-graph@1`, 42,828 B, mtime 2026-08-21 09:37:49, created_by WR-003 planning run [MEASURED `stat` 2026-08-21]. Runnable estimate above from TODO.md 50-WS queue remains the planning aid |
| Baseline gate | PASS — WR-001 candice-bootstrap-audit 5/5 OK, handle `wf_bb855713-af9` [EXECUTION-PLAN board row 2026-08-21]. Snapshot `baseline_context` notes verify-macos.sh FAILS on Keychain token retrievable (item 9router-api-token/BlackCEO-999 absent) — pre-existing baseline gap tracked separately, not a 0H blocker |
| Workflow Launch Board section | PRESENT — EXECUTION-PLAN.md section 1 |
| Unique ownership / worktree plan / shared-file list | PRESENT — EXECUTION-PLAN.md 3.3/3.4 |
| Safe live width calculated | THIS FILE |
| No padding | 50 runnable WS units, all four agent properties nameable — no invented work |
| Watchdog census | COMPLETED — fix owned by WR-008, handle `wf_046b1be8-ea3`; fixture + runner PASS 2026-08-21 (live=6, stale/ended run dirs ignored; old census reproduced 616 > cap 500 false positive) |

**Dispatch precondition:** implementation fan-out waits for the 0H gate set (route canaries + max-thinking proof + task graph) from WR-004/WR-003. Gate set MET 2026-08-21: canaries + max-thinking proof PASS (WR-004 `wf_b9f59642-d5c` COMPLETED), task-graph snapshot PRESENT (WR-003/WR-007 planning). Apparent width 50 assumes the canaries prove both seats live at the declared routes; a failed canary re-derives width from measured reality (tripwire shrinks, never grows).

## REVISIONS (append-only; card above never edited in place)

- 2026-08-21 reconcile refresh: route-canary row and 0H canary rows moved PENDING → IN_PROGRESS (WR-004 in flight); Native task graph row updated from "PENDING — ABSENT" to PRESENT with measured path/size/mtime; Baseline gate row added (WR-001 5/5 OK `wf_bb855713-af9`, plus snapshot's own 5/6 baseline_context note on verify-macos.sh Keychain gap); Watchdog census row added (IN_PROGRESS WR-008, handle unverified). Note: ledger lives at repo ROOT (`/Users/blackceomacmini/Downloads/999-setup/CAPACITY-LEDGER.md`), not in the wr001 worktree; this ledger is an untracked file on main. The task-supplied handles `wf_63e7cd35-51c` (WR-006 baseline), `wf_b9f59642-d5c` (WR-004), `wf_046b1be8-ea3` (WR-008) appear nowhere in repo CONTROL files — board handles recorded as of this refresh: WR-001 `wf_bb855713-af9`, WR-002 `wf_9529b3f1-4bb`, WR-003 `wf_9529b3f1-4bb`; WR-004 still `wf_<pending>`. project_state.json regeneration: `CONTROL/project_state.json` exists in worktree (mtime 2026-08-21 09:41, after this ledger's 09:35) — regeneration owned by WR-002 apparatus unit, not this ledger; mark per that unit's result.
- 2026-08-21 truth-gate reconciliation: route-canary row and 0H canary rows moved IN_PROGRESS → COMPLETED/PASS — WR-004 `wf_b9f59642-d5c` COMPLETED, opus + sonnet route canaries PASS both seats, max-thinking proven, safe width 50, runs 5, budget 700, role-aware runs 10; Watchdog census row moved IN_PROGRESS → COMPLETED — WR-008 `wf_046b1be8-ea3` fixture + runner PASS (live=6). Prior in-flight wording (handles unrecorded) superseded by the board's recorded handles.
