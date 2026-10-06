# The swarm plan — `blackceo.swarm-plan/v2`

The one file that states how many agents each workflow runs and how many workflows run at
once. The plan generator writes it, `tools/swarm-plan.mjs` validates it, and the hooks
(`workflow-guard/staffing.py`, `dispatch-gate.py`, both launchers) enforce it at launch time and at
the end of every turn. A document that states a different number is a defect: this file wins.

## Numbers

- Ceilings: **50** workflows concurrently, **10** agents per workflow, **500** agents total.
  They are maximums, never targets.
- **The per-workflow cap is MEASURED on the box, never typed.** `hooks/capacity_probe.py` (the one
  file that holds the formula) reads RAM and logical cores (macOS `sysctl hw.memsize` / `hw.logicalcpu`,
  Linux `/proc/meminfo` / `nproc`, Windows `GlobalMemoryStatusEx` / `wmic`) and, inside a container
  (Docker, Hostinger Docker, any cgroup), the container's own limits (cgroup v2 `memory.max` +
  `cpu.max`, cgroup v1 `memory.limit_in_bytes` + `cpu.cfs_quota_us` / `cpu.cfs_period_us`); the
  container limit beats the host total. Then
  `per_workflow_cap = clamp(1, 10, min(floor(effective_ram_gb / GB_PER_AGENT), effective_cores))`
  with `GB_PER_AGENT = 1.5` (one headless agent session plus its tools; the knob is that one constant),
  and `max_working_agents = min(500, per_workflow_cap * 50)`. The operator's 12-core / 24 GB Mac mini
  measures 10; an 8 GB / 8-core VPS measures 5; a 9 GB / 6-core box measures 6.
- The plan records it: `policy.max_agents_per_workflow` (the cap, an integer 1..10),
  `policy.max_working_agents`, and `policy.capacity_probe {ram_gb, cores, source, per_workflow_cap,
  max_working_agents, measured_at}`. Both checkers refuse a plan whose
  `policy.max_agents_per_workflow` differs from `policy.capacity_probe.per_workflow_cap`.
- A workflow runs `agent_count = min(policy.max_agents_per_workflow, len(units))` agents and
  `concurrency = agent_count`. Nothing computes fewer: not a provider figure, not a `dep=` note.
  The cap is a ceiling, not a quota: no padding units.
- `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` is set to the measured cap in `settings.json` of
  `claude` and `claude-nine` by the installers (Hook Skill, `tools/install-hooks.sh`, `enable-agent-teams`).

## Schema

```json
{
  "schema": "blackceo.swarm-plan/v2",
  "status": "planned-not-running",
  "policy": { "max_active_workflows": 6, "max_agents_per_workflow": 10,
              "max_working_agents": 500, "max_repair_cycles": 2,
              "capacity_probe": { "ram_gb": 24, "cores": 12, "source": "macos-sysctl",
                                  "per_workflow_cap": 10, "max_working_agents": 500,
                                  "measured_at": "2026-10-06T17:02:57Z" } },
  "workflows": [{
    "workflow_id": "W1", "dependencies": [],
    "units": [{ "unit_id": "W1-U1", "work": "build the login screen",
                "owned_output": "src/screens/login.tsx",
                "acceptance": "renders at 390px and 1440px; login.test.tsx passes",
                "source": "SPEC section 4.2",
                "verdict_file": "evidence/W1/W1-U1.verdict.json" }],
    "agent_count": 1, "concurrency": 1
  }]
}
```

- `policy.max_active_workflows` 1..50 is how many workflows run concurrently;
  `max_agents_per_workflow` is the measured cap (1..10); `max_working_agents` is at most 500.
- Units come from the real work breakdown (the specification's atomic work items). They are
  mutually independent, each has a concrete `owned_output` (a repo-relative file, or a directory
  ending in `/`; never empty, absolute, containing `..`, a placeholder such as `slices/`, `<`, `>`,
  `*`, `TBD` or `TODO`) that overlaps no other unit's anywhere in the plan (equal, or a directory that
  is a path-prefix of another's, is an overlap: `a/b/` vs `a/b/c.py` overlap, `a/b` vs `a/bc.py` do
  not), an `acceptance` line, a `source` in the specification, and a `verdict_file`
  `evidence/<WID>/<unit_id>.verdict.json`. `unit_id` is `<WID>-U<n>`.
- One checker per unit, in the slot its builder frees (the unit is a `pipeline` chain: build, then
  check). At most 2 repair/recheck cycles per unit.
- Padding units (a work text of "slice N of M", or the same work text twice in a workflow with digits,
  whitespace and case ignored) are rejected. `swarm-plan.mjs` also WARNS (never refuses) when one unit
  lists three or more items: split them into units.
- No checker-count or executions arithmetic exists: staffing is derived from units. The leftover keys
  `builders`, `checkers`, `repair_extra_executions_max`, `max_total_executions`, `total_executions`,
  `repair_reserve` and `executions_total` are refused with
  `<wid>: leftover key <k> — staffing is derived from units`.

## One ruleset

`tools/swarm-plan.mjs`, `workflow-guard/staffing.py` (`validate_plan`) and a build packet's
`swarm_plan_check.py` are three implementations of ONE ruleset. `tests/test_plan_validators_agree.py`
runs them on the same fixtures (valid plans at caps 10 and 6, padded units, duplicate and overlapping
`owned_output`, wrong `agent_count`, a hand-edited cap, each leftover key, cycles) and fails on any
difference in accept/reject.

## Done and ready

**A unit is done when its `verdict_file` is JSON `{"verdict": "PASS", "unit_id": <this unit>, "attempt_id":
<an admitted launch of this workflow>, "builder_model", "reviewer_model"}` with the reviewer different from the
builder; a workflow is done when EVERY unit is done** (a workflow has no verdict file of its own: the key is
refused as a leftover). The plan's `status` is `planned-not-running` or `running` (`staffing.py start --cwd <dir>`
validates the plan and sets it when the build starts) and never decides readiness; ledger lines and prose
never do either. **Ready = not done, not running, and every dependency done.**

## Discovery

Upward from the working directory: `.spec-protocol.json` key `"swarmPlan"` (a path), then
`SWARM-PLAN.json`, then `claude-nine-swarm/SWARM-PLAN.json`. `tools/swarm-plan.mjs generate` writes
`SWARM-PLAN.json` and sets the `swarmPlan` key when `.spec-protocol.json` exists. With no plan the hooks
enforce the ceilings only.

## The exact launch shape (under a found plan)

- `Workflow` with `args.workflowId` = a READY workflow, `args.units` = exactly that workflow's
  planned unit ids, and a unique non-empty `args.attemptId` (unit verdicts cite it). The script fans out over `args.units` in one stage:
  `pipeline(args.units, build, check)`. Anything else is BLOCKED.
- Building through plain `Agent` calls under a plan is BLOCKED (readers are the only exception).
- Every ready workflow launches in the same turn, up to `max_active_workflows`.
- The end-of-turn hook blocks stopping while planned workflows are owed (ready, unlaunched, within
  `max_active_workflows`). It releases only for an owner pause, a question-only turn, or proven
  repeated launch failures; 3 failed launches hand the problem back to the owner.

## Tools

```
node tools/swarm-plan.mjs generate <project> <breakdown.json>   # measures the cap itself; breakdown: workflows[{workflow_id,dependencies,units[{work,owned_output,acceptance,source}]}]
node tools/swarm-plan.mjs capacity                              # prints what the probe measures on this box
node tools/swarm-plan.mjs check <plan.json>
node tools/swarm-plan.mjs ready <plan.json> [--root <dir>] [--running W1,W2]
node tools/swarm-plan.mjs launch-check <plan.json> <workflowId> <unit,unit,...>
node tools/swarm-plan.mjs --selftest
```
