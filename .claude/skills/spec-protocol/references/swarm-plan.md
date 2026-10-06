# The swarm plan — `blackceo.swarm-plan/v2`

The one file that states how many agents each workflow runs and how many workflows run at
once. The plan generator writes it, `tools/swarm-plan.mjs` validates it, and the hooks
(`workflow-guard/staffing.py`, `dispatch-gate.py`, both launchers) enforce it at launch time and at
the end of every turn. A document that states a different number is a defect: this file wins.

## Numbers

- Ceilings: **50** workflows concurrently, **10** agents per workflow, **500** agents total.
  The native setting `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` is `10`.
- A workflow runs `agent_count = min(10, len(units))` agents and `concurrency = agent_count`.
  Nothing computes fewer: not the machine (cores and RAM are recorded, never lower it), not a
  provider figure, not a `dep=` note. 10 is a ceiling, not a quota: no padding units.

## Schema

```json
{
  "schema": "blackceo.swarm-plan/v2",
  "policy": { "max_active_workflows": 6, "max_agents_per_workflow": 10,
              "max_working_agents": 60, "max_repair_cycles": 2 },
  "workflows": [{
    "workflow_id": "W1", "dependencies": [],
    "units": [{ "unit_id": "W1-U1", "work": "build the login screen",
                "owned_output": "src/screens/login.tsx",
                "acceptance": "renders at 390px and 1440px; login.test.tsx passes",
                "source": "SPEC section 4.2",
                "verdict_file": "evidence/W1/W1-U1.verdict.json" }],
    "agent_count": 1, "concurrency": 1, "verdict_file": "evidence/W1/verdict.json"
  }]
}
```

- `policy.max_active_workflows` 1..50 is how many workflows run concurrently;
  `max_agents_per_workflow` is 10; `max_working_agents` is at most 500.
- Units come from the real work breakdown (the specification's atomic work items). They are
  mutually independent, each has a concrete `owned_output` path that is unique across the whole plan,
  an `acceptance` line, a `source` in the specification, and a `verdict_file`
  `evidence/<WID>/<unit_id>.verdict.json`. `unit_id` is `<WID>-U<n>`.
- One checker per unit, in the slot its builder frees (the unit is a `pipeline` chain: build, then
  check). At most 2 repair/recheck cycles per unit.
- Padding units (fake slices, "part k of n", duplicated work) and under-splitting (one unit that lists
  several items, or an output that is a directory or a glob) are both rejected by `swarm-plan.mjs`.
- No checker-count or executions arithmetic exists: `checkers`, `total_executions`, `repair_reserve`
  keys are refused, and nothing caps a workflow at `10 - 4`.

## Done and ready

**Done = the `verdict_file` says `"verdict": "PASS"`.** Status fields, ledger lines and prose never decide
readiness. **Ready = not done, not running, and every dependency done.**

## Discovery

Upward from the working directory: `.spec-protocol.json` key `"swarmPlan"` (a path), then
`SWARM-PLAN.json`, then `claude-nine-swarm/SWARM-PLAN.json`. `tools/swarm-plan.mjs generate` writes
`SWARM-PLAN.json` and sets the `swarmPlan` key when `.spec-protocol.json` exists. With no plan the hooks
enforce the ceilings only.

## The exact launch shape (under a found plan)

- `Workflow` with `args.workflowId` = a READY workflow and `args.units` = exactly that workflow's
  planned unit ids. The script fans out over `args.units` in one stage:
  `pipeline(args.units, build, check)`. Anything else is BLOCKED.
- Building through plain `Agent` calls under a plan is BLOCKED (readers are the only exception).
- Every ready workflow launches in the same turn, up to `max_active_workflows`.
- The end-of-turn hook blocks stopping while planned workflows are owed (ready, unlaunched, within
  `max_active_workflows`). It releases only for an owner pause, a question-only turn, or proven
  repeated launch failures; 3 failed launches hand the problem back to the owner.

## Tools

```
node tools/swarm-plan.mjs generate <project> <breakdown.json>   # breakdown: workflows[{workflow_id,dependencies,units[{work,owned_output,acceptance,source}]}]
node tools/swarm-plan.mjs check <plan.json>
node tools/swarm-plan.mjs ready <plan.json> [--root <dir>] [--running W1,W2]
node tools/swarm-plan.mjs launch-check <plan.json> <workflowId> <unit,unit,...>
node tools/swarm-plan.mjs --selftest
```
