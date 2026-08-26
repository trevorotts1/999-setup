# Candice Companion — AI-Facing Implementation Specification

**Revision:** V6 FINAL LOCKED — Mac-first product path, native Windows CMD/PowerShell path, Claude/claude-nine compatibility, and workflow-only execution law hardened. Conductor direct implementation is forbidden.  
**Review basis:** `999-setup` main `6bb00ec70af69510fab5a9c2ef332751e260d036` (2026-08-21 planning snapshot). Re-fetch `main` before execution.  
**Status:** FINAL/LOCKED for V1 execution. 16 Candice art assets are sufficient. Remaining late-bound release inputs are the operator-approved Kokoro voice/voicepack, production signing credentials, and an interactive Windows desktop validation environment. All substantive implementation must execute through visible Workflow runs and their agents.  
**Repository:** `https://github.com/trevorotts1/999-setup`  
**Target:** Existing `main`, always refreshed immediately before implementation and again before final integration.  
**Primary executor:** `claude-nine` / Nine-router-backed Claude Code for this build. Plain `claude` is a required compatibility target, but the operator expects most production builds to run through `claude-nine`.  
**Model seats:** builder=`opus` -> operator's Nine-router route (currently DeepSeek V4 Flash); QC/fixer=`sonnet` -> operator's Nine-router route (currently DeepSeek V4 Pro). Both use max thinking when the installed stack proves that setting is supported.  
**Primary platforms:** macOS Apple Silicon is the first-class/reference user path and is expected to represent most customers. Native Windows 10/11 x64 is supported in the same implementation through Windows Terminal, CMD, and PowerShell.  
**Do not use WSL as the supported Windows product path for Candice v1.**  
**Product name/spelling:** `Candice` everywhere. Normalize any existing `Candace` references that refer to this persona.

---

## 0. EXECUTOR DIRECTIVE — READ THIS FIRST

You are not being asked to write a proposal. You are being asked to modify the live `999-setup` repository, validate the changes, push them, and merge them.

Follow this order. **Every substantive step below is performed by agents inside visible Workflow runs. The conductor orchestrates; it does not implement.**

1. The conductor reads this Master Spec and the current repository doctrine, then launches a **BOOTSTRAP/AUDIT workflow**. Its agents fetch/refresh `main`, inspect the live repo, record the current SHA/versions, and establish the working branch/worktree.
2. A **BASELINE workflow** runs the existing relevant tests and records the clean/dirty baseline. The conductor does not run implementation tests itself.
3. A **PLANNING/ARCHITECTURE workflow** builds/reconciles the native task graph, workstream slices, ownership map, acceptance criteria, and the visible Workflow Launch Board. A separate QC agent verifies the plan before implementation fan-out.
4. A **CAPACITY workflow** runs the current capacity resolver/profiler, route canaries, and max-thinking proof, then returns the safe live width. The structural ceiling is **50 visible workflow runs x 10 agents = 500 sub-agents**, but never exceed measured usable capacity or real runnable work.
5. The conductor launches the required validated workflow runs through the real Workflow mechanism. **No silent workflows. No invisible fan-out. No raw Agent-tool substitute.** Every run must have a real handle/tree and a visible board entry.
6. **BUILD workflows** implement Candice with maximum safe concurrency and collision-free ownership. The conductor never edits product code, tests, docs, assets, installers, skill files, or runtime files itself.
7. **QC/FIX workflows** inspect each completed unit as soon as it lands. QC agents repair defects they find after recording the blind verdict; repaired work always receives a fresh independent QC recheck.
8. Dedicated Mac and Windows workflow lanes build the shared cross-platform code plus platform adapters. Mac is the first-class/reference path; Windows remains a required V1 path.
9. Asset workflows integrate the 16 supplied Candice source assets. Do not wait for a seventeenth image.
10. **REGRESSION workflows** run all existing tests plus the Candice cross-platform suite and repair regressions through workflow agents.
11. **INTEGRATION workflows** fan accepted worker outputs into one integration branch. Release-sensitive shared files remain single-writer owned inside the integration workflow.
12. **FINAL-QC workflows** perform whole-repo, Mac, Windows, update, privacy, performance, and same-session verification.
13. A dedicated **RELEASE workflow** performs the one coordinated version bump/stamp, changelog, README/install docs, component manifest/checksums, release notes, Git tag, commit, push, PR update, and final merge to `main`. The conductor does not do release-file edits or Git integration itself.
14. A **POST-MERGE workflow** verifies merged `main`, CI, ancestry, installers, and smoke tests.
15. The conductor reports the proven final result or one precise blocker that genuinely requires the operator.

Do not ask the operator to perform routine implementation steps. Escalate only a blocker that genuinely requires an external credential or decision, such as production Apple/Windows signing credentials.

If any approved Candice artwork is unexpectedly unavailable to the build agent at implementation time:
- Implement the entire architecture, bridge, app shell, speech stack, installers, updater, tests, and asset manifest now.
- Use a clearly marked development placeholder only for local testing.
- Do **not** declare the production release complete until the final Candice artwork is integrated and the asset acceptance tests pass.
- Do not redesign the architecture when the artwork arrives; only bind the final assets into the prepared asset contract unless the files prove technically incompatible.

---



## 0.0A WORKFLOW-ONLY EXECUTION LAW — CONDUCTOR MAY NOT DO THE WORK

This rule is **binding and fail-closed for the Candice implementation**.

> **The conductor is a dispatcher, state reconciler, and reporter. It is not an implementation agent.**

### Forbidden direct conductor work

The conductor must NOT directly:
- edit application/source code;
- edit Spec Protocol, Kaizen, ELI5, Bro, plugin, hook, MCP, installer, updater, CI, or test files;
- create production assets or derived animation assets;
- perform implementation research that should produce a project deliverable;
- run implementation/unit/integration/regression tests as the worker responsible for their evidence;
- fix defects;
- write release notes, changelogs, READMEs, version files, checksums, or tags;
- create implementation commits;
- resolve code merge conflicts;
- merge the implementation to `main`;
- replace a failed Workflow run with direct inline coding;
- use raw Agent calls as a hidden substitute for the required Workflow trees.

### The only conductor actions permitted

The conductor may only perform the minimum orchestration/control-plane actions necessary to keep the run moving:
1. read the controlling spec/state needed to know what to dispatch;
2. invoke deterministic capability/status tools that do not modify implementation output;
3. launch validated Workflow runs;
4. inspect structured Workflow results/handles;
5. reconcile the native task graph and durable state through the repository's sanctioned control mechanism;
6. display the visible Workflow board/status to the operator;
7. stop, resume, or re-dispatch failed/blocked Workflow runs;
8. surface a real external blocker.

**All repository-changing work and all evidence-producing implementation work belongs to agents inside Workflow runs.**

### `DIRECT` tasks are forbidden for this project

The generic Spec Protocol can permit a task to declare `WORKFLOW REQUIREMENT: DIRECT`. **Candice overrides that generic option.**

For this implementation:

```text
WORKFLOW REQUIREMENT: WORKFLOW
```

is mandatory for every substantive task.

If a task is too small to justify ten agents, it may use a smaller Workflow run. It still does not become a direct conductor task.

### Workflow failure behavior

If the Workflow tool is unavailable, broken, or refuses a required run:
- record the failure;
- show the operator the blocker;
- attempt only workflow-system repair through the sanctioned workflow/bootstrap mechanism if available;
- **do not downgrade into direct conductor implementation.**

A run completed by the conductor outside workflows is a **policy failure even if the code works**.

### Workflow-script authoring is control-plane setup, not product implementation

The conductor may create or update the **minimum orchestration-only Workflow scripts** required to launch the agent factories, because setting up the workflows is part of its dispatcher role. That exception is narrow:
- workflow scripts may orchestrate agents but may not contain Candice product implementation itself;
- every `agent()` call is seat-pinned;
- scripts must pass the repository's pre-dispatch workflow validation;
- prefer a small reusable parameterized script set over one script per task;
- once a workflow script exists, the actual planning/build/test/fix/integration/release work is done by its agents, not inline by the conductor.

Where a validated generic workflow-authoring/templating workflow already exists, prefer using it. Do not create a circular dependency that prevents the first Workflow from launching.

---

## 0.0B CONCURRENCY LAW — RUNNABLE WORK MUST MOVE IN PARALLEL

This project is not allowed to drift into one-agent-at-a-time or one-workflow-at-a-time execution when independent work exists.

Binding rules:
- `pipeline()` is the default workflow primitive.
- Every independent runnable unit is dispatched as soon as capacity and ownership permit.
- Builder work on later units overlaps with QC/fix/recheck work on earlier units.
- The conductor launches multiple sibling workflow runs in the **same turn** when the capacity ledger says those runs are safe.
- No global "wait for all builders" barrier exists unless a documented cross-item dependency genuinely requires it.
- No workflow may serialize independent units merely because sequential code is easier to write.
- An idle safe slot while a qualified runnable unit waits is an **UNDER-WIDTH defect** and must be corrected.
- Padding remains forbidden: concurrency comes from real independent work, never invented tasks.

Normal full paired run on the operator's machine:

```text
5 Opus/max builders + 5 Sonnet/max QC/fixers = 10 agents
```

At full safe width:

```text
up to 50 visible workflow runs x 10 agents = up to 500 concurrently live agents
```

The actual live number is always the minimum of runnable real work, machine/harness capacity, operator policy, and provider usable capacity.

---

## 0.1 PROJECT-SPECIFIC PRECEDENCE — RESOLVE CONFLICTS BEFORE DISPATCH

The live repository contains generic Spec Protocol doctrine that applies to many projects. This file contains the operator's **newer, project-specific instructions for the Candice implementation**.

Precedence for this build:

```text
1. Current explicit operator instructions captured in THIS Candice Master Spec
2. Current repository doctrine/mechanics
3. Older examples/history
```

Use repository doctrine for mechanics that this spec does not override. Do not silently "average" conflicting rules.

### Explicit Candice-specific overrides

1. **FINAL MERGE POLICY.** Generic Spec Protocol currently describes periodic time-triggered batch merges. For THIS Candice implementation, the operator has explicitly requested **one final coordinated fan-in, one release stamp/tag set, and one merge to `main` after the implementation is complete and QC passes.** Periodic intermediate merges to `main` are disabled for this project. Worker commits/branches/checkpoints are still required.
2. **QC/FIXER POLICY.** The normal blind-judge requirement still applies to the initial verdict. For THIS project, a Sonnet/max QC agent may fix a defect **after it records the blind verdict and takes the write baton**. The moment it edits the artifact, it loses final-certifier status. A fresh Sonnet/max QC agent must recheck the repaired result.
3. **CONTROL DOCUMENTS.** Do not create duplicate root-level TODO/checklist/ledger/session files. The operator wants those functions, and the repository already has canonical carriers in the 17-document apparatus. Use those canonical files exactly as Section 0J defines.
4. **WORKFLOW COUNT.** `50` means **up to 50 workflow RUNS in flight**, not a requirement to author 50 unique JavaScript workflow definitions. Reuse parameterized workflow scripts and launch multiple visible runs/slices.
5. **NO SILENT DOWNGRADE.** If workflow execution fails, surface the failure. For this Candice build, a fallback may repair workflow capability but may not replace required Workflow execution with direct conductor implementation.
6. **WORKFLOW-ONLY WORK.** Every substantive task, including planning deliverables, coding, testing, fixes, integration, release metadata, Git commits/merges, and post-merge verification, is performed by agents inside Workflow runs. `DIRECT` implementation is disabled for this project.
7. **MAC-FIRST, WINDOWS-NATIVE.** macOS Apple Silicon + normal terminal use is the primary/reference customer experience. Windows remains native and required through Windows Terminal, CMD, and PowerShell; WSL/Git Bash are not the product path.
8. **LAUNCHER COMPATIBILITY.** Candice must work when the session is launched with either plain `claude` or `claude-nine`. If Nine-router routing is desired, the supported path is `claude-nine`; do not mutate plain `claude` into a routed launcher.

When a repository rule appears to conflict with one of these five project-specific overrides, these eight govern THIS build.

---

## 0.2 CONTEXT-EFFICIENCY / COMPACTION READING DISCIPLINE

This Master Spec is intentionally complete and therefore long. Re-reading all of it on every turn wastes context and can itself cause compaction.

### First bootstrap
Read the entire Master Spec once, then create/reconcile the canonical control apparatus.

### Normal execution turns
Read only:
1. the project-specific precedence above;
2. the current relevant Master Spec section for the work being dispatched;
3. `SPEC/PROJECT-MANIFEST.md`;
4. `CONTROL/EXECUTION-PLAN.md`;
5. current `CONTROL/LEDGER.md` state/restart section;
6. current `CONTROL/TODO.md` and `CONTROL/CHECKLIST.md`;
7. `CONTROL/project_state.json` and the native task graph snapshot.

### After compaction / restart
Do **not** improvise from memory and do **not** automatically reread 2,000+ lines.

Use this recovery order:

```text
1. Read Section 0 + 0.1 + 0.2 of this Master Spec.
2. Read CONTROL/LEDGER.md current state + restart steps.
3. Read CONTROL/EXECUTION-PLAN.md workflow board / current wave.
4. Read CONTROL/TODO.md and CONTROL/CHECKLIST.md.
5. Read CONTROL/project_state.json and CONTROL/task-graph-snapshot.json.
6. Read the specific Master Spec section(s) governing the next runnable units.
7. Run reconciliation.
8. Only then dispatch.
```

This is the context-efficiency rule: durable state tells the conductor **where it is**; the Master Spec is loaded selectively to tell it **what the rule is**.

---

## 0.3 PRIMARY USER PATHS — MAC FIRST, WINDOWS NATIVE, BOTH LAUNCHERS

### macOS is the reference/default customer path

Most expected users are on modern Apple Silicon Macs, often Mac minis, using a normal terminal. Therefore the Mac path receives first-class UX and release priority.

Mandatory Mac launch matrix:

| Host | Shell | Plain path | Nine-router path | V1 requirement |
|---|---|---|---|---|
| Terminal.app | zsh/default login shell | `claude` | `claude-nine` | REQUIRED / primary |
| Terminal.app | bash if user selected it | `claude` | `claude-nine` | REQUIRED where present |
| iTerm2 | normal shell | `claude` | `claude-nine` | supported/tested where available |

The 999 setup currently installs macOS `claude-nine` at `$HOME/.local/bin/claude-nine`; the implementation must preserve fresh-login-shell resolution and the user's plain `claude` configuration.

Mac-specific behavior must include:
- bind Candice visually to the exact relevant Terminal/iTerm window;
- keep Claude session identity separate from window identity when tabs exist;
- track move/resize/minimize/monitor changes;
- request Accessibility/microphone permissions in plain language only when needed;
- fall back to independent movable Candice if Accessibility permission is denied;
- never require Homebrew for customer installation;
- optimize/measure idle resource use on Apple Silicon because this is the dominant fleet.

A Mac regression in the primary Terminal.app + `claude-nine` path is a release blocker.

### `claude-nine` is the dominant routed path

Most operator/client builds are expected to use:

```text
claude-nine -> Nine-router -> configured provider/model routes
```

For the Candice build itself, the operator's intended seats are:
- `opus` builder seat -> Nine-router route currently mapped to DeepSeek V4 Flash;
- `sonnet` QC/fixer seat -> Nine-router route currently mapped to DeepSeek V4 Pro;
- both at max thinking when live canaries prove support.

Candice integrates at the Claude Code session/skill layer. It must not depend on a particular provider behind Nine-router.

### Plain `claude` remains supported and untouched

The same installed BlackCEO skills and Candice integration must work under normal `claude` as well.

Do not route or rewrite the user's plain `claude` configuration merely to make Candice work. Plain `claude` and `claude-nine` share the same personal skills/config root under the existing 999 setup design, while `claude-nine` supplies the routed launcher behavior.

### Windows is native, not a Unix emulation path

Windows users may work in:
- Windows Terminal + CMD;
- Windows Terminal + Windows PowerShell 5.1;
- Windows Terminal + PowerShell 7 (`pwsh`) when installed;
- standalone CMD / Command Prompt;
- standalone PowerShell.

They must be able to use both `claude` and `claude-nine.cmd`/`claude-nine` where installed.

The Windows installer/orchestrator is PowerShell-based (`scripts/setup-windows.ps1`), but a user starting from CMD must not be forced to learn or manually switch shells. The setup automation may invoke PowerShell for the installer while returning the user to their original CMD workflow.

Canonical native setup invocation examples for automated use:

PowerShell:
```powershell
& .\scripts\setup-windows.ps1
```

CMD:
```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

Use process-scoped invocation only; do not weaken the user's machine-wide PowerShell execution policy as a product requirement.

### P0 Windows runtime-tool parity — current Spec Protocol Bash tools are not enough

A final repository review found an important native-Windows portability issue that MUST be fixed as part of this Candice release: the current Spec Protocol deterministic toolset is heavily Bash-based (`anchor.sh`, `capacity-profile.sh`, `capacity-resolver.sh`, `check-update.sh`, `env-sweep.sh`, `ledger.sh`, `self-update.sh`, and related tests). The current `capacity-resolver.sh` core probe uses `sysctl`/`nproc`, which is not a native CMD/PowerShell implementation.

**Windows support is not complete merely because `claude-nine.cmd` launches.** The Spec Protocol machinery Candice depends on must also work without requiring Git Bash or WSL.

Preferred implementation:
- move reusable deterministic logic into cross-platform Node `.mjs` tools where practical (Node is already installed/managed by the 999 setup);
- keep thin `.sh` wrappers for macOS/backward compatibility where useful;
- provide native `.ps1` wrappers or direct Node invocation for Windows;
- preserve identical input/output schemas and exit-code semantics across platforms.

At minimum, Windows-native parity must exist for:
1. capacity probing/resolution;
2. task/anchor reconciliation;
3. environment sweep without secret leakage;
4. ledger/state updates;
5. update checking/self-update/bootstrap;
6. any watchdog/heartbeat enforcement that is part of normal runtime;
7. all release-blocking deterministic checks used by Spec Protocol.

Native Windows probes must use Windows-supported APIs/tools. For example:
- logical processors: `[Environment]::ProcessorCount` or a verified CIM query;
- RAM: `Get-CimInstance Win32_ComputerSystem` / `TotalPhysicalMemory`;
- disk: `Get-CimInstance Win32_LogicalDisk` or equivalent;
- user paths: Windows Known Folders / .NET folder APIs, not hardcoded `C:\Users\...`;
- temp: `[System.IO.Path]::GetTempPath()`;
- command discovery: `Get-Command` in PowerShell and `where` in CMD.

CMD users may transparently invoke PowerShell/Node-backed deterministic helpers through automation. They must not be told to switch to Git Bash.

Add cross-platform golden-fixture tests proving that the macOS and Windows implementations produce semantically equivalent capacity/state/update results for the same fixture inputs.

**Release gate:** native Windows is NOT production-ready until no mandatory Spec Protocol/Candice runtime path depends exclusively on Bash.

---

## 0A. MAXIMUM-PARALLEL EXECUTION DOCTRINE — BINDING

The operator wants this implementation executed at the maximum **safe** concurrency that the real work, harness, and routed providers support.

The structural ceiling for this project is:

```text
MAX_WORKFLOW_RUNS          = 50
MAX_AGENTS_PER_WORKFLOW    = 10
MAX_BUILDERS_PER_WORKFLOW  = 5
MAX_QC_PER_WORKFLOW        = 5
MAX_BUILDERS_GLOBAL        = 250
MAX_QC_GLOBAL              = 250
MAX_SUBAGENTS_GLOBAL       = 500
```

A fully saturated run is therefore:

```text
50 visible workflow runs
x 10 agents per workflow run
= 500 sub-agents live at the structural ceiling

Per full workflow run:
5 builder seats  -> model seat: opus   -> Nine-router route: DeepSeek V4 Flash
5 QC/fixer seats -> model seat: sonnet -> Nine-router route: DeepSeek V4 Pro
```

Both builder and QC seats use the maximum reasoning/thinking level supported by the active Claude Code/Nine-router stack.

**Required model pinning:**
- Every builder agent call explicitly pins `opus`.
- Every QC agent call explicitly pins `sonnet`.
- Every builder and QC call explicitly requests `max` thinking/reasoning using the exact syntax supported by the installed versions.
- Never use a bare/unpinned agent call.
- Do not hardcode the DeepSeek provider/model ID in the workflow if Nine-router owns the Opus/Sonnet route. `opus` and `sonnet` are routing seats; Nine-router decides the provider behind those seats.
- Before dispatch, prove the route once with a small canary so the run does not accidentally put builders and judges on the wrong models.

### The safe-live-width formula

**500 is a hard structural ceiling, not a command to create fake work.**

Calculate the live width from real conditions:

```text
builder_width =
  min(
    250,
    usable_opus_route_concurrency_after_reserve,
    runnable_unique_builder_stage_tasks
  )

qc_width =
  min(
    250,
    usable_sonnet_route_concurrency_after_reserve,
    runnable_unique_qc_or_recheck_stage_tasks
  )

safe_live_agents =
  min(
    500,
    builder_width + qc_width,
    measured_harness_usable_concurrency,
    measured_global_provider_usable_concurrency
  )

visible_workflow_run_count =
  min(
    50,
    ceil(safe_live_agents / 10)
  )
```

Use the repository's current capacity profiler/resolver and Capacity Ledger as the source of measured provider/harness numbers. If the installed doctrine has a newer formula, use the newer formula while preserving this document's hard caps and ownership rules.


### Workflow definition vs. workflow run — do not author fifty scripts

The repository's Workflow mechanics distinguish a reusable JavaScript workflow definition from a launched workflow run.

For this project:

- Author the **smallest useful set of reusable, parameterized workflow scripts**.
- Launch those scripts multiple times with different deterministic `args` / unit slices.
- Up to **50 runs** may be in flight when capacity and real work allow.
- A workflow script cannot launch sibling workflow runs; the **conductor launches the required runs in the same turn**.
- Every run must be visible as its own live tree/handle with a meaningful label/slice.
- Do not create fifty nearly identical `.js` files merely to obtain fifty trees.

Before authoring any workflow script, read the current:
- `.claude/skills/spec-protocol/references/workflows.md`
- `.claude/skills/spec-protocol/references/capacity.md`

Use the repository's canonical paired-tree mechanics unless this spec explicitly overrides them.

### Required workflow-script shape

Default to the repository's `pipeline()` primitive so each unit flows without a cross-item barrier:

```text
UNIT -> Opus/max builder -> Sonnet/max blind QC
```

If QC passes, the unit is eligible for acceptance.

If QC fails and fixes:
```text
blind QC verdict -> QC takes baton -> repair -> release baton -> fresh Sonnet/max recheck
```

Workflow scripts must follow current repository parser/determinism rules. At minimum:
- plain JavaScript, not TypeScript;
- no bare/unpinned `agent()` calls;
- no unjustified top-level sequential agent chains;
- `pipeline()` is the default;
- `parallel()` only when current doctrine's barrier-justification rule is satisfied;
- no nondeterministic clock/random calls forbidden by current workflow doctrine;
- run the repository's pre-dispatch workflow validation before launch.

Do not copy a stale example from this spec when `references/workflows.md` has newer executable mechanics.


### Maximum means maximum runnable work, not padding

Use all safe capacity when real independent work exists.

Do not hold runnable work back because a smaller number feels easier.

Also do not invent agents solely to reach 500. Every agent must have:

1. a unique responsibility;
2. evidence/input to inspect or work to perform;
3. an explicit deliverable;
4. a binary acceptance criterion.

If those four properties cannot be named, that agent is padding and must not be spawned.

### Why 500 can be safe

The number 500 is safe **only because the implementation below prevents agents from sharing uncontrolled write ownership**.

Five hundred agents editing one shared checkout is unsafe.

Five hundred agents operating on isolated units/worktrees, with one writer at a time per unit and a single controlled integration/release stage, is the intended architecture.

---

## 0B. OPTIMUM WORKFLOW SHAPE — FIVE BUILDERS + FIVE QC/FIXERS

Each normal implementation workflow has ten seats:

```text
WORKFLOW WF-NN
├── B1  builder  opus/max
├── B2  builder  opus/max
├── B3  builder  opus/max
├── B4  builder  opus/max
├── B5  builder  opus/max
├── Q1  QC/fixer sonnet/max
├── Q2  QC/fixer sonnet/max
├── Q3  QC/fixer sonnet/max
├── Q4  QC/fixer sonnet/max
└── Q5  QC/fixer sonnet/max
```

The five builder seats and five QC seats form a rolling pipeline.

### Pairing

Default pairing:

```text
B1 -> Q1
B2 -> Q2
B3 -> Q3
B4 -> Q4
B5 -> Q5
```

Each builder owns a clearly named work unit.

The paired QC agent independently reviews that builder's completed checkpoint.

### QC is also a fixer

A QC agent does not merely write a complaint.

If it finds a local defect inside its assigned unit:

1. preserve the original blind verdict/finding;
2. take exclusive write ownership of the handed-off unit;
3. fix the defect;
4. run the unit tests/checks again;
5. produce repair evidence;
6. place the repaired unit into a **fresh recheck queue**.

A QC agent that has modified the unit may **not** be the final independent certifier of its own repair.

A different Sonnet/max QC agent must perform the fresh recheck. Use work stealing from the QC pool so an available QC seat can recheck another lane's repair without creating an unnecessary extra workflow.

This preserves both of the operator's goals:
- QC fixes defects immediately instead of waiting for a separate repair department.
- Final acceptance is still independent.

### Rolling saturation

At the very beginning of a brand-new project there may be no built artifacts for QC agents to inspect. Do not spawn idle QCs merely to make the number look large.

The pipeline warms up like this:

```text
INITIAL MOMENT:
builders work on first ready units
QC width may be smaller because no handoffs exist yet

ROLLING STEADY STATE:
builders work on the next ready units
while
QC/fixers inspect/fix previously completed units

=> up to 5 builders + 5 QC/fixers active per workflow
=> up to 250 builders + 250 QC/fixers globally
=> up to 500 live agents when enough independent stage work exists
```

If the project does not contain enough independent work to keep all 500 agents productive, use the maximum useful number and record why the remainder is not dispatchable.

---

## 0C. COLLISION-FREE OWNERSHIP — NON-NEGOTIABLE

Parallelism is valuable only if two agents do not unknowingly write the same thing.

### Isolation without creating hundreds of heavyweight worktrees

Worker agents must not all edit one uncontrolled checkout.

**Default isolation unit: one Git worktree/branch per workflow run or write-collision domain**, not one full dependency checkout per agent.

Inside that worktree:
- builder units receive disjoint file/component ownership;
- agents may not run conflicting Git index/commit operations concurrently;
- shared mutable files remain integration-owned;
- the workflow-run commit owner creates checkpoint commits after safe fan-in.

Escalate to a **per-unit worktree** only when:
- two units must touch overlapping paths;
- a tool rewrites shared files/lockfiles;
- independent commit history is required before the run-level fan-in;
- the work cannot otherwise be mechanically isolated.

Recommended identity:

```text
workflow-run: WR-007
slice:        candice-ui-a
branch:       candice/wr007-ui-a
worktree:     <run-root>/worktrees/wr007-ui-a

units:
  U1 -> exact owned paths
  U2 -> exact owned paths
  U3 -> exact owned paths
  U4 -> exact owned paths
  U5 -> exact owned paths
```

Reuse immutable package/download caches (Cargo registry/git cache, npm/pnpm cache, model download cache) where safe. Do not create 250 duplicate dependency stores or 250 independent model copies. Never share mutable build output directories between concurrent writers.

### Writer baton

Every work unit has exactly one write owner at a time.

Lifecycle:

```text
BUILDER OWNS UNIT
   |
   | checkpoint commit + HANDOFF record
   v
BUILDER RELEASES UNIT
   |
   v
QC READS/VERDICTS
   |
   | if pass -> ACCEPTED
   |
   | if fail
   v
QC TAKES WRITE BATON
   |
   | fix + tests + repair commit
   v
QC RELEASES UNIT
   |
   v
FRESH QC RECHECK
   |
   v
ACCEPTED or REPAIR AGAIN
```

Builder and QC may never simultaneously edit the same unit/worktree.

"Simultaneous QC and fixing" means the QC pool is reviewing/fixing completed units at the same time that builders are building other units. It does **not** mean two writers race on the same files.

### Shared-file protection

The following classes are **single-writer/integration-owned** unless explicitly partitioned:

- root/version release files;
- final `CHANGELOG.md`;
- final README release/version sections;
- Git tags;
- global component manifest/checksum file;
- shared lockfiles when a package-manager operation rewrites the whole file;
- global CI/release files that cannot be safely partitioned;
- the final consolidated Spec Protocol `SKILL.md` if multiple draft changes overlap.

Workers may produce proposed patches/fragments for these files, but a single integration owner applies the final consolidated change.

### Cross-lane defect rule

A worker or QC agent that discovers a problem outside its owned unit must not silently edit the other unit.

It records:

```text
CROSS-LANE-FINDING
source workflow/lane:
affected unit:
evidence:
severity:
recommended action:
```

The conductor assigns it to the owning lane or creates a dependency repair task.

### Branch/worktree cleanup

After integration:
- delete/retire accepted worker branches/worktrees according to repo policy;
- preserve commits/evidence needed for audit;
- never delete the sole copy of unmerged work.

---

## 0D. WORKFLOW VISIBILITY — NO SILENT WORKFLOWS

The operator must be able to see which workflows were created.

Before dispatch, print a concise **WORKFLOW LAUNCH BOARD** in the Claude terminal. Persist the human-readable board as a named section of `CONTROL/EXECUTION-PLAN.md`, and persist machine-readable run state/handles in the versioned `CONTROL/project_state.json`. Do not create a duplicate workflow-board document.

Minimum columns:

| Run ID | Workflow script | Slice / purpose | Builders | QC/Fixers | Builder model | QC model | Dependencies | Worktree / owned units | Status |
|---|---|---|---:|---:|---|---|---|---|---|

Every launched workflow run must have:
- a stable workflow-run ID such as `WR-001`;
- a human-readable name;
- a parent task/domain;
- exact builder count;
- exact QC count;
- explicit model pins;
- explicit max-thinking setting;
- owned unit IDs;
- branch/worktree IDs;
- dependency state;
- visible runtime status.

### Visibility gate

A workflow does not count as launched merely because the conductor intended to create it.

After creation:

1. capture the real workflow run ID/handle returned by the Workflow system;
2. write it to the EXECUTION-PLAN board and `project_state.json`;
3. verify that the launched run produced the tool-supported live workflow tree/handle; use `/workflows` or any saved-workflow listing only when the installed version actually supports it;
4. print the launched count to the user;
5. if the UI supports `/workflows`, ensure the workflow is named so it is recognizable there.

If a launched run cannot be observed through the actual Workflow result/tree/handle:
- mark it `VISIBILITY-FAIL`;
- do not claim it as active capacity;
- repair/recreate it using the supported Workflow mechanism.

Do not silently replace visible workflow runs with a swarm of raw hidden subagents.

For this Candice implementation, **raw Agent-tool execution is not an implementation fallback.** If the Workflow tool is genuinely unavailable or broken, declare the blocker, repair workflow capability if possible, and pause production work until visible Workflow execution is restored.

### Launch-board example

```text
CANDICE PARALLEL LAUNCH
Safe live width: 300 agents
Visible workflow runs: 30
Builder seats: 150 Opus/max
QC seats: 150 Sonnet/max
Route check: PASS
Workflow visibility check: 30/30 visible
Blocked workflow runs: 0
Wave: 1
```

For a fully saturated safe run:

```text
Safe live width: 500 agents
Visible workflow runs: 50
Builder seats: up to 250 Opus/max
QC seats: up to 250 Sonnet/max
Visibility check: 50/50
```

---

## 0E. CANDICE WORKSTREAM MAP — INPUT TO WORKFLOW-RUN SLICING

Use the following fifty **workstreams** as the maximum decomposition envelope. These are domains of work, not fifty required JavaScript workflow files and not necessarily fifty simultaneous runs.

Do not launch a padded ten-agent workflow when its domain cannot be split into real owned units. Aggressively decompose real work, but never invent meaningless slices.

| Workstream | Domain |
|---|---|
| WS-01 | Candice event/question/answer schemas |
| WS-02 | Claude plugin manifest and hook registration |
| WS-03 | session lifecycle + binding bridge |
| WS-04 | structured `ask_user` MCP path |
| WS-05 | same-session free-conversation/terminal fallback adapter |
| WS-06 | Tauri application shell |
| WS-07 | transparent/frameless window behavior |
| WS-08 | Candice application state machine |
| WS-09 | floating answer controls + PTT UI |
| WS-10 | compact progress-companion mode |
| WS-11 | asset manifest + final-art loader |
| WS-12 | mouth/viseme animation |
| WS-13 | blink/idle/head/gesture animation |
| WS-14 | accessibility/reduced-motion/captions |
| WS-15 | visual/transparent-background test harness |
| WS-16 | whisper.cpp runtime integration |
| WS-17 | local microphone capture + push-to-talk |
| WS-18 | transcription confirmation/edit/retry |
| WS-19 | Kokoro runtime + canonical Candice voice |
| WS-20 | speech interruption, duplex safety, audio cleanup |
| WS-21 | macOS terminal-window discovery/binding |
| WS-22 | macOS permissions + degraded floating mode |
| WS-23 | macOS packaging/signing/notarization path |
| WS-24 | macOS resource/performance instrumentation |
| WS-25 | macOS Terminal/iTerm compatibility |
| WS-26 | Windows Win32 window discovery/binding |
| WS-27 | Windows Terminal/PowerShell/CMD compatibility + native deterministic-tool parity |
| WS-28 | Windows microphone/audio/device path |
| WS-29 | Windows packaging/signing/SmartScreen path |
| WS-30 | Windows resource/performance instrumentation |
| WS-31 | fresh-install Candice bootstrap |
| WS-32 | existing-user upgrade bootstrap |
| WS-33 | bundled-component manifest/checksums/rollback |
| WS-34 | version/preferences/schema migrations |
| WS-35 | crash/restart/recovery/update rollback |
| WS-36 | Spec Protocol Candice integration |
| WS-37 | Kaizen Candice integration |
| WS-38 | ELI5 Candice integration |
| WS-39 | Bro Candice integration |
| WS-40 | user name/preferences/local profile |
| WS-41 | contract/schema test suite |
| WS-42 | same-session Claude + Claude-Nine test suite |
| WS-43 | failure/fallback/chaos test suite |
| WS-44 | privacy/security/secrets audit |
| WS-45 | performance/load/resource test suite |
| WS-46 | cross-platform CI/release matrix |
| WS-47 | upgrade/backward-compatibility fixtures |
| WS-48 | operator-specific boss-cron portability repair |
| WS-49 | installer/updater regression and rollback validation |
| WS-50 | end-to-end nontechnical-user acceptance harness |

### How to slice workstreams into workflow runs

At runtime, take runnable units from one or more workstreams and slice them into visible paired workflow runs of up to five build units (builder+QC pairs), respecting ownership and dependencies.

Example:

```text
WS-17 — LOCAL MICROPHONE + PTT
B1: Core audio capture abstraction
B2: PTT state/control path
B3: device enumeration + no-device fallback
B4: temp/in-memory buffer + cleanup
B5: audio capture fixtures/tests

Q1-Q5:
blind-review the corresponding builder output,
fix local defects,
then send repaired units to a fresh QC recheck.
```

If WS-17 only has three genuinely independent builder units at the current dependency point, launch three builders and the corresponding QC capacity when handoffs exist. Do not fabricate B4/B5 work merely to fill seats.

### Dynamic remapping and grouping

The table above is an implementation decomposition, not a license for conflicting ownership.

After reading the actual current repository, the conductor may regroup domains to reflect newer code organization, but it must preserve:
- maximum safe parallelism;
- 5-builder/5-QC workflow shape;
- model pins;
- visibility;
- isolated ownership;
- one coordinated final release.

---


### Efficient run creation

Do not pre-launch all 50 merely because 50 workstreams exist.

Compute the zero-dependency runnable unit set, chunk it into slices of at most five paired units per full 10-agent run on the operator's current machine, and launch as many runs in one conductor turn as the Capacity Ledger allows.

Multiple small workstreams may share one run when their file ownership is disjoint and their lifecycle logic is identical. One large workstream may require multiple runs/slices.

## 0F. WAVES, DEPENDENCIES, AND FULL SATURATION

Use a new wave only when a real dependency prevents the next work from starting now.

A wave is justified by a statement of the form:

```text
WAVE-2-BLOCKED-BY:
- task/unit:
- requires output from:
- exact artifact/evidence required:
```

Never create waves simply because serial execution feels simpler.

### Wave 1

Dispatch every dependency-free unit at the maximum safe live width.


### Expected Candice wave forecast — planning aid, never a barrier

The likely shape is:

| Logical wave | Primary purpose | Approx. useful live width when enough work is ready |
|---|---|---:|
| W1 | Independent foundations/components | 300–500 |
| W2 | Cross-component integration + rolling QC/fix | 250–400 |
| W3 | End-to-end user journeys + system repair | 150–300 |
| W4 | Cross-platform/update/failure/privacy hardening | 75–200 |
| W5 | Final fan-in/release verification | 10–50 |

These are planning ranges, not targets and not stage barriers. If a W2-type integration unit becomes runnable while W1 work remains, dispatch it immediately. The native dependency graph governs actual release, not the label "wave."


### Rolling execution

As soon as an individual builder unit hands off:
- release its QC task immediately;
- do not wait for every builder in the workflow;
- do not wait for the rest of the wave.

As soon as a dependency becomes satisfied:
- dispatch the newly runnable unit if safe capacity exists.

This is a rolling graph, not a barrier between giant phases.

### Work stealing

When an agent seat becomes free:
- assign the highest-priority runnable unit that matches that role;
- do not leave a safe slot idle while real work waits.

QC seats may take:
- fresh builder reviews;
- rechecks of repaired units;
- cross-lane defect verification;
- integration evidence review,

provided ownership rules are respected.


### Execution epochs — concurrency is not lifetime budget

`500 concurrent` answers how many agents may run **at once** on the operator's current 9Router/DeepSeek path. It does not erase the repository's separate total-execution/session budget.

Before dispatch, the Capacity Ledger must declare:
- safe concurrent width;
- expected total agent executions for the current plan;
- current session/epoch execution budget;
- reserve for repair/recheck/release QC.

If the planned run can exceed the current session's allowed/declared lifetime budget, split execution into **epochs**.

An epoch is NOT a wave:
- **wave** = dependency level / work becoming runnable;
- **epoch** = conductor/session budget boundary.

Before an epoch rollover:
1. stop launching new runs;
2. allow in-flight workflow runs to finish or checkpoint safely;
3. reconcile task graph, TODO, checklist, ledger, execution plan, and project state;
4. write exact restart steps into `CONTROL/LEDGER.md`;
5. record current base/integration SHAs and pending QC;
6. start/resume a fresh `claude-nine` conductor session;
7. re-run the required capability/route/capacity canaries;
8. continue the same dependency graph without re-planning completed work.

Never exceed a current repository/operator lifetime budget merely because concurrent width remains available.


### When 500 should not be used

The live number may be below 500 only because at least one of these is true:

1. fewer than 500 real stage tasks are runnable;
2. a dependency blocks more work;
3. measured provider usable concurrency is lower;
4. measured harness usable concurrency is lower;
5. a safety/collision rule requires serialization of a shared resource;
6. the project is in final integration/release, where one controlled writer is required.

Record the specific reason. Do not use vague language such as “to be safe.”

---


## 0G. FINAL FAN-IN — ONE INTEGRATION, ONE STAMP, ONE MERGE

**Candice-specific override:** do not use the generic Spec Protocol 15-minute intermediate-to-main merge cadence for this project. Keep accepted work on isolated worker/integration branches until the coordinated release fan-in.


Worker workflows do not merge themselves to `main`.

Worker workflows may create commits on their isolated branches/worktrees.

When all required implementation/QC units are accepted:

1. stop/close the worker wave;
2. build one deterministic accepted-commit inventory;
3. create/update one integration branch from the current intended base;
4. merge/cherry-pick accepted units in dependency order;
5. resolve integration conflicts deliberately;
6. run the full repository and cross-platform test suites;
7. run a fresh final system-level QC pass;
8. make one coordinated release update;
9. push once as the integrated release candidate;
10. merge once to `main` after gates pass;
11. verify trunk ancestry and post-merge smoke tests.

### Release files have one final writer

The final release step owns:

- all changed skill `VERSION` files;
- Candice app/plugin version;
- final `CHANGELOG.md`;
- final README/install documentation;
- component manifest/checksums;
- release notes;
- release artifact metadata;
- Git tag.

Workers may prepare evidence/drafts, but they do not independently stamp these files.


### Trunk freshness gate

Because `main` can change while hundreds of agents are working:

1. immediately before final release stamping, fetch `origin/main`;
2. compare it to the base SHA recorded at run start;
3. if `main` moved, integrate the new trunk into the integration branch;
4. resolve conflicts deliberately;
5. rerun all tests affected by the trunk delta plus the full release smoke suite;
6. compute versions/checksums/tag from the **post-reconciliation integrated state**.

Never force-push over unrelated new `main` work.

### Self-enforced CI gate

At the reviewed planning snapshot, `main` is not protected by required status checks. Therefore the conductor must not rely on GitHub to stop a bad merge.

Before merge:
- inspect the actual CI/workflow results for the integration/release commit;
- require every relevant required test/check to be green;
- treat missing/failed CI as a release blocker unless the exact test is proven locally and the operator explicitly authorizes an exception;
- after merge, verify CI/smoke state on the merged `main`.


### Atomic stamp requirements

The release captain/integration workflow must calculate all bumps from the **actual final integrated diff**, not from worker guesses.

The final release is stamped once with:
- semantic version bump(s);
- changelog entries;
- README/install/update documentation;
- component checksums;
- signed/notarized artifact metadata where applicable;
- one Git tag matching the released state.

No piecemeal tags.

No one-workflow-at-a-time merges to `main`.

No repeated version bumps caused by parallel workers.

---

## 0H. ORCHESTRATION ACCEPTANCE GATES

Before any implementation dispatch:

- [ ] Capacity Ledger/profiler result is current.
- [ ] Opus route canary confirms the expected builder route.
- [ ] Sonnet route canary confirms the expected QC route.
- [ ] Max-thinking configuration is proven on both seats.
- [ ] Native task graph exists.
- [ ] Workflow Launch Board section exists in `CONTROL/EXECUTION-PLAN.md`.
- [ ] Every planned workflow has unique ownership.
- [ ] Worktree/branch isolation plan exists.
- [ ] Shared-file single-writer list exists.
- [ ] Safe live width is calculated.
- [ ] No agent is padding.

After workflow creation:

- [ ] Every real workflow has a returned workflow ID.
- [ ] Every real workflow run appears on the visible board and has a real tool handle/tree.
- [ ] Workflow-run handle/tree visibility verification passes.
- [ ] Builder/QC model pins are explicit.
- [ ] Every live agent has a unit, deliverable, evidence/input, and acceptance criterion.

During execution:

- [ ] No two writers own the same unit simultaneously.
- [ ] QC begins per-unit on handoff, not at an all-builders barrier.
- [ ] QC repairs local defects.
- [ ] Repaired QC output receives a fresh independent recheck.
- [ ] Free seats take runnable work.
- [ ] New waves exist only for documented dependencies.

Before final merge:

- [ ] Every accepted unit has passing evidence.
- [ ] Accepted-commit inventory is complete.
- [ ] One integration branch contains the combined implementation.
- [ ] Full-suite tests pass.
- [ ] Final system-level QC passes.
- [ ] Versions/stamps are computed once from integrated state.
- [ ] One final tag/release stamp is prepared.
- [ ] One merge to `main` is performed.
- [ ] Post-merge smoke checks pass.

---



## 0I. ULTRA CODE IS REQUIRED FOR THIS BUILD

This Candice implementation is classified as a complex, high-concurrency, multi-workflow build.

**ULTRA CODE is mandatory for the production implementation run.**

Before creating production workflows, the conductor must verify that the installed Spec Protocol/Claude Code environment reports Ultra Code as enabled and usable.

If Ultra Code is not enabled:

```text
STOP BEFORE MULTI-WORKFLOW DISPATCH.
Tell the operator that Ultra Code must be enabled for the Candice production build.
Do not silently downgrade this project into an ordinary single-agent or raw-subagent run.
```

Ultra Code is part of the execution contract because this project depends on:
- dynamic workflows;
- native task graph;
- large fan-out/fan-in;
- persistent state;
- independent QC;
- dependency-aware rolling waves;
- deterministic final integration.

The conductor may perform read-only repository inspection before Ultra Code is proven, but may not begin the production implementation fan-out.

### Anti-downgrade gate

At every compaction/recovery checkpoint, re-read the current restart/state section in `CONTROL/LEDGER.md`, the workflow board in `CONTROL/EXECUTION-PLAN.md`, and `CONTROL/project_state.json`, then confirm:

```text
ULTRA_CODE_REQUIRED=true
WORKFLOW_MODE_REQUIRED=true
RAW_HIDDEN_SWARM_FORBIDDEN=true
```

If the session has drifted into direct implementation without workflows:
1. **STOP direct implementation immediately**;
2. preserve any already-produced valid output without continuing it inline;
3. record a WORKFLOW-POLICY-VIOLATION in the canonical state/ledger;
4. route the unverified direct output through a fresh Workflow QC lane before it can be accepted;
5. reconcile remaining work into the native task graph;
6. restore visible Workflow runs;
7. resume only through the workflow architecture.

---

## 0J. PERSISTENT ANTI-DRIFT CONTROL PLANE — USE THE EXISTING 17-DOCUMENT APPARATUS

The operator is correct that this build needs durable TODO, checklist, live ledger, and session history. The current Spec Protocol repository **already has canonical documents for all four**.

Do not create duplicate root-level `TODO.md`, `CHECKLIST.md`, `LIVE-LEDGER.md`, or `SESSION.md`. Duplicate state stores are a drift multiplier and would conflict with the repository's closed 17-document apparatus.

Use:

```text
SPEC/MASTER-SPEC-YYYY-MM-DD.md     # THIS Candice implementation spec, canonicalized once
SPEC/PROJECT-MANIFEST.md           # architecture, task graph, workflow definitions, ownership, model roles
CONTROL/EXECUTION-PLAN.md          # waves, live workflow-run board, parallelism plan, release strategy
CONTROL/TODO.md                    # ordered work queue / what remains
CONTROL/CHECKLIST.md               # binary proven-done boxes
CONTROL/LEDGER.md                  # current state + QC verdict blocks + merge record + literal restart steps
CONTROL/SESSION-LOG.md             # append-only narrative / corrections / history
CONTROL/dispatch-log.md            # before-send dispatch record
CONTROL/HEARTBEAT.md               # agent progress heartbeat
CONTROL/CHANGELOG.md               # release/batch history
CONTROL/project_state.json         # machine-readable run truth
CONTROL/task-graph-snapshot.json   # native task graph export / reconciliation input
CAPACITY-LEDGER.md                 # computed width, role seats, execution budget, provenance
```

This user's anti-drift request is satisfied by strengthening these existing carriers, not by adding competing files.

### This file becomes the Master Spec

During execution bootstrap:
- if no Candice project apparatus exists, copy this specification once into the canonical `SPEC/MASTER-SPEC-YYYY-MM-DD.md` path;
- preserve the supplied source file unchanged;
- after canonicalization, every agent cites the canonical Master Spec path;
- do not create another "summary spec" that can drift.

### `CONTROL/TODO.md`

This is the live work inventory.

A work item progresses through states such as:

```text
PENDING
BLOCKED
IN_PROGRESS
BUILT_AWAITING_QC
QC_REPAIR
RECHECK
COMPLETE
```

A builder return is **BUILT_AWAITING_QC**, never COMPLETE.

Do not remove a task from TODO merely because code exists. Follow the current repository's completion/delivery rules.

### `CONTROL/CHECKLIST.md` — QC-controlled promotion

The checklist is the binary proven-done surface.

A box flips only when:
- required deliverable exists;
- required tests pass;
- primary-source evidence exists;
- independent QC passes;
- acceptance criteria pass;
- required project state is updated.

If QC fixes a failure, the box stays unchecked until a **fresh independent recheck** passes.

The conductor flips final completion boxes from evidence; builders do not self-promote.

### `CONTROL/LEDGER.md` — live state, verdicts, restart truth

Follow current repository ledger doctrine rather than making the whole file append-only.

It contains:
1. regenerated/current state view;
2. durable QC verdict/fix/recheck blocks;
3. merge/release records;
4. literal restart steps.

The ledger is the first operational truth a resuming conductor reads.

For Candice, ensure it additionally exposes:
- current logical wave;
- current execution epoch;
- safe live width;
- intended/visible/active/completed workflow-run counts;
- pending builder handoffs;
- pending rechecks;
- current integration SHA;
- severe blockers;
- exact next conductor actions.

### `CONTROL/SESSION-LOG.md`

This is the append-only narrative/history. Corrections are appended, not rewritten.

Use this for:
- what happened;
- why a decision changed;
- operator corrections;
- degraded-mode events;
- compaction/restart events;
- epoch rollovers.

Do not use it as the machine state source.

### `CONTROL/EXECUTION-PLAN.md` — visible Workflow Launch Board lives here

Create a named section:

```text
## CANDICE WORKFLOW-RUN BOARD
```

Each launched run records:
- run ID / real tool handle;
- reusable script name;
- slice/work units;
- parent task/workstream;
- builder/QC counts;
- seat pins;
- max-thinking proof;
- worktree/branch;
- dependencies;
- status;
- launch timestamp;
- returned/dropped counts.

This is the human-visible persistent board. The actual Workflow live tree/handle is the runtime proof.

### `CONTROL/project_state.json`

Extend the existing versioned schema rather than creating separate ownership/QC/workflow-manifest JSON files.

Candice-specific machine state should include namespaced fields for:
- run/epoch/wave;
- workflow runs intended/created/visible/active/blocked/completed;
- safe width;
- agents live by role;
- unit ownership/write baton;
- builder handoffs awaiting QC;
- QC failures/repairs/rechecks;
- accepted units;
- integration state;
- last reconciliation;
- release readiness.

Keep one machine-readable truth rather than four overlapping JSON stores.

### Reconciliation heartbeat

Run reconciliation:
- before first dispatch;
- after each workflow-run launch batch;
- after meaningful fan-in;
- before/after compaction or epoch rollover;
- before changing dependency wave;
- before final integration;
- before release stamp;
- after merge.

Reconcile at minimum:

```text
MASTER SPEC <-> PROJECT MANIFEST
PROJECT MANIFEST <-> TODO
TODO <-> native task graph
task graph <-> EXECUTION-PLAN workflow board
workflow board <-> actual Workflow handles/trees
project_state ownership <-> actual branches/worktrees
builder handoffs <-> ledger QC verdict/recheck state
QC evidence <-> CHECKLIST
CHECKLIST <-> project_state
project_state <-> actual tests/Git state
LEDGER restart state <-> all current truth
```

Required repairs:
- checklist says complete but QC proof missing -> reopen;
- TODO item missing from task graph -> restore it;
- board claims a run exists but no actual handle/tree proves it -> visibility drift;
- two writers claim the same unit -> freeze conflicting writes and reconcile ownership;
- completed item has a failing required test -> reopen;
- ledger/restart steps are stale -> regenerate before further dispatch.

**Compaction is never permission to re-plan from conversational memory.**

---

## 1. VERIFIED BASELINE — RECHECK BEFORE EDITING

At the V4 review snapshot on 2026-08-21:

- `main`: `6bb00ec70af69510fab5a9c2ef332751e260d036`
- Spec Protocol version: `1.16.3`
- Nine-router setup skill version: `1.16.3`
- Kaizen version: `1.0.1`
- ELI5 version: `1.0.0`
- Bro version: `1.0.0`
- The repository already supports native macOS and native Windows setup.
- The existing setup deliberately makes the bundled skills visible to both plain `claude` and `claude-nine`.
- Windows installs a `claude-nine.cmd` launcher; macOS installs `~/.local/bin/claude-nine`.
- Plain `claude` must remain untouched and non-routed by the 999 setup.
- `spec-protocol/tools/check-update.sh` currently checks all five bundled skill `VERSION` files against the published repo.
- `spec-protocol/tools/self-update.sh` currently updates the Spec Protocol tree itself, with backup/rollback protection.
- The current updater does **not** yet provide a complete external desktop-app update path for Candice.
- The current generic runtime still has operator-specific `tools/boss-cron` paths/rules that must not ship as a customer-portable dependency.

Treat all of this as a baseline, not an excuse to skip reading current `main`.

---

## 2. PRODUCT DEFINITION

Candice is a local visual and voice companion for BlackCEO's Claude Code skills.

The governing mental model is:

> **Candice is the face, voice, ears, and lightweight user interface. The active Claude Code session and the invoked skill remain the brain, rules, memory, and source of truth.**

Candice must never create a second independent AI conversation to conduct the interview.

Candice must never maintain a competing project memory.

Candice must never modify the question order or rules of Spec Protocol or Kaizen.

Candice must work with:

- plain `claude`
- `claude-nine`
- Nine-router-backed model routing
- the existing same-session skill execution model

Candice must not require a direct integration with Nine-router. Nine-router routes the model. Candice connects to the local Claude Code session and local skill workflow.

The design must remain model-provider agnostic. A DeepSeek-backed `claude-nine` session and an Anthropic-backed plain `claude` session must see the same Candice contract.

---

## 3. SKILLS THAT ACTIVATE CANDICE

Candice automatically activates when the user invokes:

- `/spec-protocol`
- `/kaizen`
- `/eli5`
- `/bro`

She should not automatically appear for every ordinary Claude Code session.

The Candice integration must be generic enough to add more BlackCEO skills later without redesigning the app.

### Activation latency

Candice should appear as soon as a supported slash command is invoked, ideally within a few seconds.

Do **not** wait for the complete Spec Protocol preflight to finish before showing her.

The intended first visible state is:

> “Hi, I’m Candice. Give me just a moment while I make sure everything is set up properly for us to work together.”

Show the same message as a caption even if voice output is disabled.

Then run the skill's normal environment/preflight checks.

Candice is a progress surface for the check; she is not the component that decides whether the setup passes.

---

## 4. FIRST-RUN EXPERIENCE

On the first successful Candice run for a local OS user:

1. Candice appears.
2. She reports that she is checking the setup.
3. The skill completes the required checks.
4. If the local user profile does not yet contain a preferred name, Candice asks:
   - “Hi, I’m Candice. What’s your name?”
5. The user may answer by voice or type.
6. Store the name in Candice's local preferences.
7. Candice uses that name naturally on future sessions, e.g. “Welcome back, Trevor.”
8. Do not infer the name from the computer username.
9. Provide a simple way to change the stored name later.

Candice should explain once that the user can speak or type at any time. Do not force a permanent input-mode decision.

---

## 5. INPUT AND OUTPUT MODEL

There are two separate user controls and they must never be conflated.

### 5.1 How the user answers

For every question, both remain available:

- **HOLD TO TALK**
- **TYPE ANSWER**

The user can change between voice and typing question by question.

Also provide:

- **Answer in Claude instead**

If selected, the same question falls back to the terminal/Claude input surface without losing state or counting the question twice.

Candice may remember the last-used method as a convenience, but it is not a lock.

### 5.2 Whether Candice speaks aloud

This is a separate persistent toggle:

- **Voice responses ON**
- **Voice responses OFF**

A user may:
- type while Candice speaks,
- speak while Candice is muted,
- use both voice directions,
- or use a completely silent text experience.

Always show captions regardless of voice-output state.

---

## 6. PUSH-TO-TALK UX

Push-to-talk must be obvious to a nontechnical user.

Idle button:

> **🎙 HOLD TO TALK**

While pressed:

> **🔴 LISTENING — LET GO WHEN FINISHED**

Visual state while listening:
- obvious glow/pulse change,
- optional lightweight waveform,
- no ambiguous tiny icon-only state.

When released:
1. Stop recording.
2. Transcribe locally.
3. Display:
   - “Here is what I heard…”
4. Show the transcript.
5. Offer:
   - **USE ANSWER**
   - **EDIT**
   - **TRY AGAIN**

Do not submit a voice transcription to the skill until the user confirms it.

If the user presses HOLD TO TALK while Candice is speaking:
- stop Candice's speech immediately,
- begin listening,
- do not allow Candice's own TTS output to feed the STT input.

---

## 7. SPEECH STACK — LOCAL AND NO PER-USE CLOUD COST

### STT

Default local engine:

- `whisper.cpp`

Requirements:
- local/offline transcription,
- Apple Silicon acceleration where available,
- native Windows support,
- no cloud speech endpoint,
- pinned tested version,
- bundled or deterministically downloaded model with checksum verification.

Benchmark candidate Whisper model sizes on the supported machines and choose the smallest model that meets the transcript quality bar. Do not choose a larger model simply because it exists.

### TTS

Default local engine:

- Kokoro 82M-compatible local ONNX runtime

Requirements:
- one canonical Candice voice across all supported computers,
- no cloud TTS service,
- same voice identity on macOS and Windows,
- pinned model/runtime/voicepack,
- redistribution rights verified before packaging.

Fallback:
- system speech synthesis may be used if Kokoro is unavailable, but it must be clearly treated as fallback, not the canonical Candice voice.


### Canonical Candice voice selection — late-bound product approval

Engineering must not block while the final voice is being chosen.

Implement Kokoro so the canonical voice/voicepack is versioned and replaceable without changing the bridge or UI contract.

Before production release:
1. identify a small set of locally runnable, redistributable female voice candidates compatible with the pinned Kokoro runtime;
2. verify licensing/redistribution;
3. render the same short Candice sample for comparison;
4. obtain operator approval for **one** canonical Candice voice;
5. pin that voicepack/version/checksum for both macOS and Windows.

Do not infer or label a voice's race from timbre. The product requirement is one consistent signature Candice voice approved by the operator.


### Voice licensing gate

Before production release:
- record the exact model/runtime/voicepack versions,
- record their licenses,
- include required notices,
- confirm the selected voicepack can legally be redistributed,
- if a custom voice is trained, confirm rights to every training recording.

Do not use an unverified voice clone.

---

## 8. AUDIO PRIVACY AND STORAGE

Hard requirements:

- Push-to-talk only in v1.
- Microphone access only while the user is intentionally holding the talk control.
- Raw audio is never retained as project memory.
- Raw audio is never uploaded to a cloud speech API.
- Do not log raw audio.
- Do not log API keys, router tokens, environment secrets, or unrelated terminal output.
- Secret-bearing prompts must not be read aloud.

Preferred audio path:

`microphone -> in-memory/ring buffer -> whisper.cpp -> transcript -> discard audio`

If a temporary audio file is technically necessary:

1. Create it only inside a Candice-owned per-session temp directory.
2. Use restrictive local permissions.
3. Transcribe it.
4. Delete it immediately after transcription succeeds or fails.
5. Run cleanup again when the session ends.
6. Run startup cleanup for stale temp audio left by crashes.
7. Never allow abandoned audio to accumulate over time.

The cleanup path must have automated tests.

---

## 9. PERSONAL PREFERENCES

Candice may permanently remember a small local preference profile:

- user's preferred name
- voice-output ON/OFF
- volume
- speech rate
- last-used answer method
- text size
- reduced-motion preference
- companion screen position
- optional last-used supported skill

Candice must **not** use this local profile as project/conversation memory.

The active Claude skill/project files remain the durable source of truth for project decisions and answers.

Recommended locations:

### macOS
`~/Library/Application Support/BlackCEO/999/Candice/`

### Windows
`%LOCALAPPDATA%\BlackCEO\999\Candice\`

Use a simple versioned JSON schema and provide migration tests.

---

## 10. VISUAL BODY — LIGHTWEIGHT BY DESIGN

Candice v1 is not a heavy 3D game character.

Use a lightweight 2D/2.5D rig built from the final provided artwork.

Target animation capabilities:

- mouth/viseme states synchronized to TTS,
- blinking,
- tiny head movement,
- subtle idle/breathing motion,
- a small set of arm/hand gestures,
- speaking glow,
- listening glow/pulse,
- processing/thinking state,
- compact progress-companion state.

Avoid:

- Unity/Unreal,
- continuous full-resolution transparent video,
- dense particle simulations,
- heavy 3D meshes,
- unnecessary always-running GPU work.

Prefer:
- sprite/layer swaps,
- transforms,
- opacity/glow changes,
- small state machines,
- lazy-loaded assets.

Respect OS reduced-motion settings.

---

## 11. FINAL ART ASSET CONTRACT — LATE BINDING

**Current status: approved art received in two batches: 16 total art assets (9 first-batch + 7 second-batch). The asset contract is stable and implementation must proceed. A possible 17th asset is optional unless the operator explicitly supplies one.**

Prepare the app to accept the final Candice asset pack without architectural changes.

Create an asset manifest such as:

`apps/candice-companion/assets/candice/asset-manifest.json`

The manifest should be able to map:

- main idle/full-body state
- compact companion state
- eye open / half / closed
- mouth/viseme states
- welcome gesture
- presenting gesture
- listening gesture
- thinking gesture
- affirmative/celebration gesture
- optional glow/aura layers

Do not bake a fake terminal window into the character asset.

Do not bake captions, buttons, or question text into the character image.

The real terminal and the Candice UI remain separate.

When final images are delivered:
1. inspect their actual format and dimensions;
2. normalize naming and dimensions without visually redesigning the approved character;
3. update the asset manifest;
4. create only the minimum derived animation assets required;
5. test transparency/edge quality on light and dark desktop backgrounds;
6. test low-memory animation behavior;
7. replace the development placeholder;
8. remove placeholder assets from the production bundle.

---


## 11A. CANDICE ASSET INTAKE — FIRST APPROVED BATCH RECEIVED

The operator supplied the first nine Candice PNG assets in the first batch. The second batch has now also arrived; see Section 11B. V1 art intake is considered sufficient.

### Operator's original Mac source location

The original files are currently shown in the operator's Finder Downloads folder.

Do not hardcode the operator's username. Resolve the logged-in user's Downloads directory normally.

Expected original filenames shown by Finder:

```text
ChatGPT Image Aug 21, 2026, 08_41_23 AM (9).png
ChatGPT Image Aug 21, 2026, 08_41_23 AM (8).png
ChatGPT Image Aug 21, 2026, 08_41_22 AM (7).png
ChatGPT Image Aug 21, 2026, 08_41_22 AM (6).png
ChatGPT Image Aug 21, 2026, 08_41_22 AM (5).png
ChatGPT Image Aug 21, 2026, 08_41_22 AM (4).png
ChatGPT Image Aug 21, 2026, 08_41_21 AM (3).png
ChatGPT Image Aug 21, 2026, 08_41_20 AM (2).png
ChatGPT Image Aug 21, 2026, 08_41_20 AM (1).png
```

Typical macOS resolution:

```text
"$HOME/Downloads/<filename>"
```

Before copying:
1. resolve Downloads from the current local user;
2. match the exact filenames;
3. if duplicates such as `(...)(1).png` exist, compare image dimensions/content and ask only if multiple materially different candidates cannot be disambiguated;
4. copy source art into the repo-controlled Candice asset staging directory;
5. never mutate or delete the operator's Downloads originals.

### Verified technical characteristics of the supplied first batch

The supplied PNG files are RGBA and therefore contain an alpha channel suitable for transparent compositing.

Observed dimensions in the received first batch:

```text
7 bust/face variants: 1254 x 1254 RGBA
2 full-body variants:  941 x 1672 RGBA
```

The first batch visibly includes:
- neutral/closed-mouth bust;
- smiling/teeth-visible bust;
- several speaking/open-mouth bust states at different openings;
- multiple near-neutral bust states useful for idle/blink/transition work;
- full-body wave/welcome pose;
- full-body standing/hand-on-hip idle pose.

Do not assume all near-neutral face images are exact pixel-aligned animation frames. Measure registration first. If they differ in head/shoulder placement, use landmark alignment/cropping or derive mouth overlays rather than rapidly swapping whole 1254px portraits.

### First-batch provisional semantic mapping

Use visual/technical inspection to assign final canonical names, but the received set is intended to support a structure similar to:

```text
face/idle-neutral.png
face/smile-open.png
face/smile-soft.png
face/speech-wide.png
face/speech-medium-a.png
face/speech-medium-b.png
face/idle-neutral-alt.png

body/welcome-wave.png
body/idle-standing.png
```

Do not preserve ChatGPT-generated download filenames inside production code. Normalize to stable product filenames.

### Animation strategy for this actual art

The art confirms that V1 should use **state-based 2D animation**, not a 3D runtime.

For speaking:
- crop/normalize a canonical bust frame;
- derive or use supplied mouth states;
- align face landmarks;
- switch/warp only the minimum face/mouth region where possible;
- synchronize to TTS timing/viseme classes;
- use cross-fades of a few frames, not full-video playback.

For the compact companion:
- the bust images are well suited to a small circular/organic holographic companion;
- retain transparent edges;
- do not place a rectangular UI background behind the character;
- the answer/voice controls remain a separate UI layer.

For the full-body companion:
- use the standing image as the primary full-body idle;
- use the wave image for greeting/first activation;
- other arriving full-body assets may become listen/think/present/success states.

### Memory discipline for these assets

The source files may remain high resolution in the repository asset source/staging directory, but the production runtime must generate/use size-appropriate optimized derivatives.

Do not permanently hold every 1254/1672px source texture in GPU memory.

Create an asset build step that:
- preserves originals;
- generates required runtime sizes;
- uses lossless or visually safe compression;
- lazy-loads gesture states;
- keeps only the active/next animation states resident;
- measures actual runtime memory before choosing final derivative sizes.

### Second-batch status

The second batch has now arrived with seven additional RGBA PNG art files. The earlier estimate expected eight additional art files, but the received set includes a multi-pose sheet plus several additional full-body gesture states, so the build is **not blocked** on a seventeenth image.

If another approved art file is later supplied:
1. add it to the same inventory;
2. map it to an uncovered semantic state only if it adds useful behavior;
3. update `asset-manifest.json`;
4. do not redesign the animation architecture.

---



## 11B. CANDICE ASSET INTAKE — SECOND BATCH RECEIVED / V1 ART SET SUFFICIENT

Seven additional Candice PNG art files have now been supplied.

### Source filenames

```text
ChatGPT Image Aug 21, 2026, 08_56_52 AM (7).png
ChatGPT Image Aug 21, 2026, 08_56_52 AM (6).png
ChatGPT Image Aug 21, 2026, 08_56_52 AM (5).png
ChatGPT Image Aug 21, 2026, 08_56_51 AM (4).png
ChatGPT Image Aug 21, 2026, 08_56_51 AM (3).png
ChatGPT Image Aug 21, 2026, 08_56_51 AM (2).png
ChatGPT Image Aug 21, 2026, 08_56_50 AM (1).png
```

All seven received files are:

```text
1024 x 1536
RGBA PNG
```

The inspected alpha channel spans transparent through translucent values (`0..254` in the received copies), which is suitable for the intended holographic compositing. Preserve the source alpha; do not flatten onto black.

In the ChatGPT working environment, duplicate-mounted copies may appear with an added `(1)` suffix. The operator's Finder screenshot shows the original Downloads filenames without that extra duplicate suffix. The build agent running on the Mac must resolve the real file present in `$HOME/Downloads` and use content/dimensions/checksums to disambiguate rather than assuming the ChatGPT mount name.

The Finder screenshot is **reference/evidence only**. It is not a Candice production art asset and must not be copied into the runtime asset bundle.

### Visual coverage added by this batch

The second batch visibly adds:
- multiple full-body presenting/open-palm poses;
- a two-hands-open explanatory/shrug pose;
- an additional relaxed/presenting stance;
- a close-up facial/wink expression useful for compact-companion personality;
- a multi-pose character sheet containing several useful behavioral states, including:
  - eyes-closed/rest state;
  - friendly wave;
  - presenting/explaining;
  - hand-to-ear/listening;
  - thinking/chin pose;
  - thumbs-up/approval;
  - centered/focus/processing pose.

Treat the character sheet as a **source sheet**, not a runtime sprite atlas automatically. Extract and normalize only the useful individual states that pass quality/alignment checks.

### Asset-role mapping to build

The final manifest should now be able to cover at least:

```text
body/idle-standing
body/welcome-wave
body/present-left
body/present-right
body/present-two-hands
body/listening
body/thinking
body/approval
body/focus-processing
body/rest-eyes-closed

face/idle-neutral
face/smile
face/wink
face/speech-small
face/speech-medium
face/speech-wide
```

Do not assume download order equals semantic role. The asset-processing agent must visually inspect, normalize, crop, and assign stable production names.

### Production rule

The 16 supplied source-art files are sufficient for V1. Treat the visual-input gate as PASS.

Do not pause the engineering build to request additional character images unless a concrete required state cannot be derived from or represented by the 16 supplied assets.

Keep all original source PNGs untouched. Generate optimized runtime derivatives and record source->derived mapping plus checksums in the asset manifest.

---

## 12. DESKTOP APP ARCHITECTURE

Build one shared cross-platform Candice codebase.

Recommended shell:
- **Tauri 2**

Reason:
- lightweight compared with a full Electron/game-engine build,
- supports macOS and Windows,
- supports transparent/frameless windows,
- supports always-on-top behavior,
- permits native platform adapters.

Do not require Rust/Node/build tools on customer machines. Build release artifacts in CI and distribute prebuilt signed binaries.

Suggested layout:

```text
apps/
  candice-companion/
    src/
    src-tauri/
    assets/
      candice/
    tests/
    package.json
    tauri.conf.json

plugins/
  candice-integration/
    .claude-plugin/
      plugin.json
    hooks/
      hooks.json
    .mcp.json
    bin/
    README.md

packages/
  candice-protocol/
    schemas/
      question-event.schema.json
      answer-event.schema.json
      status-event.schema.json
      preferences.schema.json
```

Exact paths may be adjusted to match current repo conventions, but keep the responsibilities separated.

---

## 13. CLAUDE CODE INTEGRATION

Do not build Candice as a second AI session.

Use a dedicated local Claude Code plugin/integration layer.

Claude Code plugins can bundle:
- hooks,
- MCP servers,
- local executables.

The Candice integration must work with the existing standalone slash-command names. Do not rename `/spec-protocol`, `/kaizen`, `/eli5`, or `/bro` into namespaced replacements.

### 13.1 Immediate wake-up hook

Use a lightweight plugin hook that detects invocation of a supported slash command and starts/raises Candice immediately.

Supported commands:
- `/spec-protocol`
- `/kaizen`
- `/eli5`
- `/bro`

The hook must:
- be fast,
- launch/raise the app,
- bind it to the current Claude session identifier where available,
- bind it to the foreground command-window/terminal host,
- display the setup-check message,
- never block skill execution if Candice fails.

### 13.2 Structured interview bridge

For Spec Protocol and structured Kaizen interviews, use a local MCP tool contract rather than screen-scraping terminal text.

Example conceptual tools:

- `candice.status`
- `candice.begin_session`
- `candice.ask_user`
- `candice.show_message`
- `candice.set_progress`
- `candice.compact`
- `candice.end_session`

`candice.ask_user` should:
1. receive the structured question event from the same active Claude Code session,
2. display/speak it locally,
3. accept voice or typed input,
4. allow transcript correction,
5. return the final approved text to the **same MCP tool call in the same Claude session**.

If the companion is unavailable, the tool must fail soft and instruct the skill to ask the same question in Claude normally.

Do not save a duplicate answer store inside Candice.

### 13.3 Same-session free conversation after the interview

After the structured interview, Candice becomes a compact companion.

The user may click her and:
- hold to talk,
- type a normal question,
- type/say a slash command such as `/bro` or `/eli5`,
- mute/unmute,
- return focus to Claude.

Do **not** depend on Claude Code Channels as the core transport for this feature. Channels are currently a research-preview feature and may have authentication/provider limitations that are inappropriate for a Nine-router/third-party routed session.

For user-originated out-of-band prompts:
- prefer a documented same-session local control interface if one exists and is verified at implementation time;
- otherwise use a tightly scoped terminal-input adapter bound only to the exact terminal window/session that launched Candice.

If terminal input injection is used:
- inject only text the user explicitly typed/spoke,
- queue while Claude is busy,
- submit only when the session is at a safe input point,
- use session lifecycle hooks to determine idle/ready state,
- never inject into a different terminal/window,
- never send hidden prompts,
- preserve/restore clipboard contents if clipboard paste is used,
- show the user what will be submitted.

If Claude is busy, Candice should say/show:
> “Claude is working. I’ll send that as soon as it’s ready.”

The user can always choose **Answer in Claude instead** and type directly.

---

## 14. QUESTION CONTRACT

Do not make the companion infer protocol questions from arbitrary terminal prose.

Define a versioned structured contract.

Minimum question event:

```json
{
  "schemaVersion": "1.0",
  "sessionId": "opaque-session-id",
  "skill": "spec-protocol",
  "event": "question",
  "questionKey": "BUILD_TARGET",
  "text": "Tell me about your idea in your own words: what is it, and who is it for?",
  "answerKind": "free_text",
  "allowedInputModes": ["voice", "typed", "terminal"],
  "readAloud": true,
  "sensitivity": "normal",
  "counted": false,
  "progress": null,
  "helpText": "A sentence or two is plenty.",
  "canGoBack": true
}
```

Minimum response:

```json
{
  "schemaVersion": "1.0",
  "sessionId": "opaque-session-id",
  "questionKey": "BUILD_TARGET",
  "answerText": "I want a booking tool for local barbers.",
  "inputMode": "voice",
  "userConfirmedTranscript": true
}
```

Raw audio is never part of the response contract.

The structured question registry becomes the mechanical source for:
- stable question keys,
- display/spoken wording,
- counted vs. uncounted questions,
- conditions,
- read-aloud safety,
- validation,
- never-re-ask behavior,
- resume behavior.

Do not replace the human/model-facing protocol references with JSON. Use the schema as the enforceable companion contract and keep the protocol doctrine readable.

---

## 15. SPEC PROTOCOL BEHAVIOR

Spec Protocol remains the authority.

Candice may speak naturally and answer ordinary clarification questions, but she may not skip or rewrite the interview.

Example:

1. Spec Protocol asks: “Who is the application for?”
2. User asks Candice: “Why do you need to know that?”
3. Claude answers the clarification through Candice.
4. Candice returns to the pending governed question.
5. The question is not marked answered until the required answer is supplied.

The companion must preserve:
- one governed question at a time,
- question ceilings/counts,
- never-re-ask,
- write-through durability,
- resume behavior,
- “I don’t know” path,
- simple/advanced logic,
- all current safety and quality rules.

Do not add a second interview memory.

---

## 16. PROGRESS COMPANION

When the interview is complete, Candice does not disappear.

Transition to a compact mode that stays associated with the same terminal/session.

Possible states:
- BUILDING
- QUALITY CHECKING
- FIXING
- WAITING FOR USER
- COMPLETE
- RECOVERING
- TEXT FALLBACK

Clicking compact Candice expands the small interaction surface.

The companion can explain current progress by asking the same Claude session. Do not invent progress percentages. Use only real project state/status events.

When the active Claude session ends:
- close/dormant the companion for that session,
- clean temp audio,
- release window tracking resources.

---

## 17. WINDOW BINDING

Candice is a separate transparent desktop window that visually belongs to the exact terminal/command window that invoked the skill.

### macOS — PRIMARY / FIRST-CLASS USER PATH

Most expected Candice users are Mac users. Treat Apple Silicon macOS + Terminal.app as the reference desktop experience.

Target:
- **Terminal.app — mandatory primary target**
- iTerm2 — supported where installed and practical
- other terminal hosts only after the primary path is stable

Use native macOS window/accessibility APIs as required.

Behavior:
- anchor beside the bound terminal,
- follow move/resize,
- follow monitor changes,
- hide/dim appropriately when the terminal is minimized or no longer relevant,
- allow user repositioning,
- remember preferred offset.

If Accessibility permission is denied:
- do not stop Claude,
- run Candice as a movable independent floating companion,
- explain the optional permission in plain language.

### Windows

Windows support is required in V1, not deferred.

Windows users may launch Claude Code from:
- **Windows Terminal + PowerShell**
- **Windows Terminal + CMD**
- **standalone PowerShell**
- **standalone CMD / Command Prompt**

These are all valid supported command-line environments.

The Candice integration must support both:
- plain `claude`
- the Windows Nine-router launcher, normally `claude-nine.cmd`

Candice must bind to the **top-level host window**, not assume that the shell process itself owns the visible window.

Examples:
- PowerShell running inside Windows Terminal -> bind to the Windows Terminal window.
- CMD running inside Windows Terminal -> bind to the Windows Terminal window.
- standalone PowerShell host -> bind to that PowerShell console/window host.
- standalone CMD -> bind to the Command Prompt/console host.

Do not require WSL, Git Bash, or a Unix terminal for the supported Windows path.

The existing 999 setup uses `scripts/setup-windows.ps1` as the authoritative Windows orchestrator and installs `claude-nine.cmd` on PATH. The final Candice installer/update path must integrate with that native Windows setup rather than inventing a Bash-only bootstrap. A user may remain in CMD while automation invokes PowerShell for installation/repair internally.


### Exact Windows shell/launcher contract

The supported native Windows launch matrix is:

| Host | Shell | Plain Claude command | Nine-router command |
|---|---|---|---|
| Windows Terminal | Windows PowerShell 5.1 | `claude` | `claude-nine` / `claude-nine.cmd` |
| Windows Terminal | PowerShell 7 (`pwsh`) | `claude` | `claude-nine` / `claude-nine.cmd` |
| Windows Terminal | CMD (`cmd.exe`) | `claude` | `claude-nine` / `claude-nine.cmd` |
| classic/standalone console host | Windows PowerShell 5.1 | `claude` | `claude-nine` / `claude-nine.cmd` |
| classic/standalone console host | PowerShell 7 (`pwsh`) | `claude` | `claude-nine` / `claude-nine.cmd` |
| classic/standalone console host | CMD (`cmd.exe`) | `claude` | `claude-nine` / `claude-nine.cmd` |

The installer/test harness must prove command discovery natively:

PowerShell:
```powershell
Get-Command claude
Get-Command claude-nine
```

CMD:
```bat
where claude
where claude-nine
```

Do not assume POSIX shell quoting, `$HOME`, `which`, `chmod`, `/tmp`, symlinks, or Bash-only update scripts on the native Windows path.

Use Windows-native locations and APIs:
- `%LOCALAPPDATA%` / `[Environment]::GetFolderPath('LocalApplicationData')`
- `%TEMP%` / `[System.IO.Path]::GetTempPath()`
- Windows PATH/PATHEXT resolution
- PowerShell or the shared cross-platform updater for installation/update operations

### Windows Terminal tabs/panes — window position is NOT session identity

A top-level Windows Terminal window can contain multiple tabs and panes. Therefore:

- the Claude **session ID / bridge binding** is the authority for which conversation Candice belongs to;
- the top-level host window is used only for visual anchoring;
- never assume "foreground Windows Terminal window" means "correct Claude session";
- terminal text injection must not be enabled solely because the top-level host window matches;
- if the exact active tab/pane/session target cannot be proven, disable injection and use the same-session MCP/bridge path or **Answer in Claude instead**;
- switching tabs/panes must never send a Candice answer to another Claude session.

Apply the same principle to macOS terminal tabs: host-window placement and Claude-session identity are separate concerns.

Use native Win32 window APIs to bind to the foreground top-level host window for placement, while the Claude session/bridge remains the authority for message routing.

Support native Windows first. Do not make WSL the required Candice path.

If exact host tracking cannot be established:
- fall back to a movable floating companion,
- never stop the Claude session.

---

## 18. CROSS-PLATFORM BUILD STRATEGY

Do **not** build macOS now and redesign for Windows later.

Build the shared core and both platform adapters in the same implementation.

Shared code should own:
- UI,
- character state machine,
- captions,
- input controls,
- preference schema,
- STT/TTS orchestration,
- protocol schemas,
- MCP contract,
- temp cleanup,
- error/fallback behavior.

Platform modules own only:
- window tracking/anchoring,
- OS permission handling,
- installation paths,
- startup process details,
- signing/package format,
- platform-specific audio/device plumbing where required.

Required v1 targets:
- macOS Apple Silicon
- Windows 10/11 x64 native

Windows ARM64 may be added in the same CI matrix if the complete dependency chain is proven; do not delay the required x64 release solely for ARM64.

Mac is the reference UX during development because most users are expected to be on modern Mac minis, but Windows acceptance tests must be implemented before the cross-platform release is marked complete.

### Interactive Windows release-validation requirement

GitHub Actions/CI can build and test a large portion of the native Windows code, but it is not sufficient proof for all desktop behavior.

Before declaring Windows V1 production-ready, test on at least one **interactive Windows 10/11 desktop environment** representative of the supported x64 target. It may be a physical PC or an interactive VM/cloud desktop, but it must permit real desktop-window interaction.

The interactive Windows smoke must prove:
- Windows Terminal anchoring;
- PowerShell 5.1;
- PowerShell 7 where installed;
- CMD;
- `claude`;
- `claude-nine.cmd`;
- multiple tabs/panes without cross-session injection;
- microphone permission/device behavior;
- push-to-talk;
- transparent always-on-top window behavior;
- minimize/restore and monitor movement;
- install/update/uninstall cleanup.

If no interactive Windows environment is available, the shared Windows implementation may still be built and CI-tested, but **Windows production-ready status remains blocked**. Do not pretend CI alone proved desktop integration.

---

## 19. RESOURCE / MEMORY DISCIPLINE

Candice must be lightweight.

Requirements:
- no game engine,
- no transparent video loop as the main character runtime,
- lazy-load speech engines,
- unload or suspend expensive workers after idle time,
- compact state uses minimal animation,
- do not keep STT recording active when not pressing talk,
- avoid keeping duplicate model instances.

Add measurements to the test report:
- idle RSS,
- idle CPU,
- speaking CPU/RSS,
- listening/transcription CPU/RSS,
- time to first visible Candice,
- time from PTT release to transcript,
- time to first spoken audio.

Do not hardcode an unrealistic memory target before measuring the chosen runtime. Establish the baseline on:
- an Apple Silicon Mac representative of the operator's client fleet,
- a modern Windows x64 machine.

Then add regression thresholds to CI/performance smoke tests.

---

## 20. FAILURE MUST NEVER STOP CLAUDE

Candice is optional presentation infrastructure.

Failure matrix:

### App fails to launch
Continue in Claude text mode.

### Character asset fails
Continue with text companion or Claude terminal.

### Kokoro fails
Use system TTS if available; otherwise captions only.

### whisper.cpp fails
Typing remains available.

### Microphone denied
Typing remains available.

### Window tracking permission denied
Use movable floating mode.

### MCP bridge unavailable
Ask the question normally in Claude.

### Candice crashes mid-question
Recover the exact pending question in Claude; do not increment/re-ask incorrectly.

### Session mismatch
Refuse to inject text; require re-bind or direct terminal input.

No Candice error is allowed to destroy, reset, or block the user's project.

---

## 21. EXISTING-USER UPDATE PATH

This section is mandatory.

Updating GitHub `main` does **not by itself** install a new desktop companion on machines that already have an older Spec Protocol.

The existing updater already provides a useful first hop:
- check remote skill versions,
- self-update the Spec Protocol tree.

Extend the release so an existing user can move forward safely:

### Existing user flow

1. Old Spec Protocol sees that the published Spec Protocol version is newer.
2. Existing `self-update.sh` replaces the Spec Protocol skill tree.
3. On the next supported skill invocation, the new Spec Protocol/Candice bootstrap checks:
   - Candice plugin present/version,
   - Candice desktop app present/version,
   - speech assets present/version,
   - Kaizen/ELI5/Bro integration versions.
4. Missing/stale Candice components are installed/repaired.
5. Stale supported BlackCEO skills are refreshed through a deterministic bundle update path.
6. The user does not manually copy files around.
7. After successful bootstrap, normal future invocations perform a fast health/version check only.

### New unified component updater

Add a cross-platform update mechanism that knows about:

- `nine-router-setup`
- `spec-protocol`
- `kaizen`
- `eli5`
- `bro`
- `candice-integration`
- `candice-companion`
- local speech model/voice asset versions

Do not make Candice a fake sixth skill in `CONTROL/bundled-skills.txt` if that manifest is semantically skill-only.

Prefer a separate versioned component manifest, e.g.:

`CONTROL/bundled-components.json`

### Default distribution channel

Use **GitHub Releases in `trevorotts1/999-setup`** as the default operator-controlled release channel for Candice app installers, component manifests/checksums, and other appropriately sized release artifacts unless the live implementation check proves a size/licensing/availability constraint.

For large speech-model/voice assets:
- verify current GitHub Release asset limits before publishing;
- if they fit and redistribution is permitted, release assets are acceptable;
- otherwise use a separate operator-controlled immutable download location and record it in the component manifest.

Never download executable/model payloads from ad-hoc third-party URLs discovered at runtime.

The updater must:
- download only from operator-controlled release locations,
- verify SHA-256 checksums,
- reject downgrades unless explicitly supported,
- install atomically,
- back up replaced skill/plugin trees outside Claude config roots,
- rollback on failure,
- never expose secrets,
- never change the user's model/provider routing,
- never change plain `claude` into a routed launcher.

### Windows update parity

Do not depend on a Bash-only Candice update path for native Windows.

Provide a native PowerShell path or a truly cross-platform updater.

Existing Git-for-Windows Bash may remain supported, but it is not the sole Windows mechanism.

---

## 22. NEW-INSTALL PATH

Update `AGENT_INSTALL.md` and the actual platform orchestrators so a fresh 999 setup installs:

1. current bundled skills,
2. Candice integration plugin,
3. Candice Companion desktop app,
4. pinned local STT/TTS assets,
5. launch/bridge command,
6. version/checksum metadata.

Do not compile Candice from source on a customer's computer.

Install signed/notarized prebuilt release artifacts.

Keep:
- plain `claude` untouched,
- `claude-nine` routed only through its existing launcher,
- shared skills visible in both environments.

---

## 23. CODE SIGNING / DISTRIBUTION

Speech inference can remain local/free, but production desktop distribution has OS trust requirements.

### macOS
For a friction-minimized customer release:
- sign with Developer ID,
- notarize,
- verify Gatekeeper acceptance.

If Apple signing credentials are unavailable, report that as an external release-distribution blocker. Do not disable Gatekeeper or instruct customers to weaken security as the normal install path.

### Windows
Prefer Authenticode-signed installer/executable to reduce SmartScreen friction.

If signing credentials are unavailable:
- internal testing may continue,
- record the limitation explicitly,
- do not misrepresent the installer as trusted/signed.

---

## 24. PORTABILITY REPAIR THAT MUST SHIP WITH THIS WORK

The current generic runtime must not depend on operator-specific absolute paths or historical campaign enforcement.

Remove or isolate from general customer runtime any dependency on paths such as:

`/Users/blackceomacmini/...`

The historical fixed six-wave repair campaign must not govern unrelated customer Spec Protocol projects.

Do not delete historical evidence simply to hide it. Keep history where appropriate, but remove it from generic runtime enforcement.

Add tests proving:
- arbitrary macOS usernames work,
- arbitrary Windows user paths work,
- two unrelated projects cannot read/stop each other,
- no installed generic runtime file contains Trevor's developer home path,
- no generic project is governed by the historical fix campaign.

This is a release requirement, not optional cleanup.

---

## 25. SKILL FILE DISCIPLINE

The existing Spec Protocol `SKILL.md` is already very large.

Do not dump the entire Candice implementation into it.

Keep the `SKILL.md` change concise:
- activation,
- companion availability check,
- structured question bridge rules,
- fallback behavior,
- a direct reference to the detailed Candice integration reference.

Place detail in dedicated files such as:

- `references/candice-companion.md`
- `references/candice-question-contract.md`
- scripts/tools for deterministic behavior

Likewise add only the minimum integration instructions to:
- Kaizen
- ELI5
- Bro

Do not create contradictory duplicate instructions.

---

## 26. VERSION PLAN

Re-read current versions before changing them.

If the planning baseline is still current and these skills are materially changed:

- Spec Protocol: `1.16.3` -> `1.17.0`
- Nine-router setup: `1.16.3` -> `1.17.0` if installer/update behavior changes
- Kaizen: `1.0.1` -> `1.1.0`
- ELI5: `1.0.0` -> `1.1.0`
- Bro: `1.0.0` -> `1.1.0`
- Candice Integration plugin: initial `1.0.0`
- Candice Companion app: initial `1.0.0`

If `main` has moved, derive the correct semver bump from the current versions instead of forcing these numbers.

Update:
- VERSION files,
- plugin/app manifests,
- CHANGELOG,
- README/install docs,
- component manifest/checksums,
- any release/tag metadata required by the repo.

---

## 27. TEST PLAN

Add dedicated Candice CI.

### Contract tests
- question schema validates,
- answer schema validates,
- stable question keys,
- voice/typed/terminal answer paths all return exactly one answer,
- `Answer in Claude instead` does not double-count,
- secret question cannot be read aloud.

### Same-session tests
Run each supported path under:
- plain `claude`
- `claude-nine`

Prove:
- the same session owns the question and answer,
- no second independent AI conversation is created,
- routed model/provider identity does not change Candice behavior.

### macOS tests
- app launch,
- transparent window,
- terminal binding,
- move/resize tracking,
- minimized terminal behavior,
- Accessibility denied fallback,
- mic allowed/denied,
- PTT,
- temp cleanup,
- speech fallback,
- crash recovery.

### Windows deterministic-tool parity tests

Before the interactive desktop matrix, prove:
- the capacity resolver/profiler runs natively from PowerShell/CMD automation without Git Bash/WSL;
- Windows core/RAM/disk/path probes are measured and recorded with provenance;
- anchor/reconciliation, ledger/state, env sweep, update check, and self-update have a native/cross-platform path;
- golden fixtures match macOS semantics;
- no mandatory runtime command hardcodes `sysctl`, `nproc`, POSIX-only paths, or Bash as the only implementation.

### Windows tests
Run under all required native Windows host/shell combinations:

| Host | Shell | Required |
|---|---|---|
| Windows Terminal | Windows PowerShell 5.1 | YES |
| Windows Terminal | PowerShell 7 (`pwsh`) | YES when PowerShell 7 is installed |
| Windows Terminal | CMD | YES |
| standalone console host | Windows PowerShell 5.1 | YES |
| standalone console host | PowerShell 7 (`pwsh`) | YES when PowerShell 7 is installed |
| standalone console host | CMD | YES |

For each combination, test both `claude` and `claude-nine.cmd` where the launcher is installed.

Also test:
- two Windows Terminal tabs containing two different Claude sessions;
- two panes containing different sessions where panes are available;
- Candice visually anchored to the host but logically bound only to its Claude session;
- tab/pane switching never causes an answer/command to reach the wrong session;
- injection fallback disables itself when exact target proof is unavailable.

Test:
- native app launch,
- transparent window,
- host binding,
- move/resize,
- microphone privacy,
- PTT,
- temp cleanup,
- same-session submit,
- fallback when window binding fails.

### Existing-user update tests
Fixture:
- old Spec Protocol installed,
- Candice absent,
- older Kaizen/ELI5/Bro.

Prove:
1. update is detected,
2. Spec Protocol updates safely,
3. new bootstrap installs Candice,
4. supported skills refresh,
5. plain Claude settings/provider config remain untouched,
6. rollback works after an injected failure.

### Failure tests
- app missing,
- app crash,
- speech model missing,
- model download corrupt checksum,
- microphone denied,
- no audio device,
- temp directory unwritable,
- plugin missing,
- MCP server unavailable,
- wrong terminal/session target,
- Claude busy while companion prompt is submitted.

### Workflow-only conductor compliance tests

Add fail-closed tests/fixtures proving:
- no substantive task in the Candice project declares `WORKFLOW REQUIREMENT: DIRECT`;
- the conductor never writes implementation/source/test/release files directly;
- no production work is accepted from raw Agent-tool dispatches;
- every implementation commit maps to a visible Workflow run/agent ownership record;
- baseline testing, coding, QC/fix, integration, release stamping, merge, and post-merge smoke each have Workflow evidence;
- if Workflow capability is disabled, the run stops instead of silently implementing inline;
- under synthetic compaction, execution resumes by launching/reconciling Workflow runs rather than taking over work directly;
- when multiple independent units are runnable, at least two are concurrent unless the Capacity Ledger limits width to one;
- an idle safe slot with a runnable eligible unit is detected as under-width.

### Parallel orchestration and collision tests

Prove all of the following:

- 10-agent workflow shape is enforced at the per-workflow ceiling.
- 50-workflow / 500-agent structural cap cannot be exceeded.
- partial workflows are allowed when fewer real units exist.
- the safe-width calculation respects measured provider/harness capacity.
- every builder is explicitly Opus/max.
- every QC/fixer is explicitly Sonnet/max.
- no bare agent inherits the wrong session model.
- all launched workflows receive IDs and appear on the Workflow Launch Board.
- a workflow that fails visibility validation is not counted as live capacity.
- two writers cannot acquire the same unit/worktree at once.
- builder-to-QC writer-baton handoff is enforced.
- QC can fix a defect but cannot self-certify its repaired output.
- a fresh QC agent rechecks repaired output.
- shared release/version/tag files reject worker ownership.
- work stealing fills free seats when eligible work exists.
- a new wave cannot launch without a documented dependency.
- final fan-in produces one integration state, one coordinated version/release stamp, one tag, and one merge to `main`.

Run a synthetic high-concurrency fixture with many isolated dummy units before trusting the 500-agent ceiling on production code.

### Canonical-control-plane anti-drift tests

Prove:
- no duplicate root `TODO.md`, `CHECKLIST.md`, `LIVE-LEDGER.md`, or `SESSION.md` is created;
- the Candice Master Spec is canonicalized once into the existing SPEC apparatus;
- workflow board state is carried by `CONTROL/EXECUTION-PLAN.md` plus `project_state.json`;
- resume after synthetic compaction can reconstruct the exact next runnable units without conversational history;
- execution-epoch rollover preserves pending QC/recheck and does not repeat completed work;
- workflow runs are launched from reusable validated scripts/slices rather than fifty copy-pasted script files;
- current `main` movement is detected before final stamping;
- merge is refused when relevant CI is failed/unknown without an explicit operator exception.

### Regression tests
Run every existing Spec Protocol, Nine-router setup, Kaizen, ELI5, and Bro test relevant to changed files.

---

## 28. ACCEPTANCE CHECKLIST

Do not merge until every required item is true or an explicitly authorized exception exists.

- [ ] Candice spelling is consistent.
- [ ] Candice appears quickly on `/spec-protocol`, `/kaizen`, `/eli5`, `/bro`.
- [ ] Candice reports setup checking before long preflight work.
- [ ] First-run name capture works and persists locally.
- [ ] User can talk or type on every question.
- [ ] Voice-output ON/OFF is independent of answer method.
- [ ] Push-to-talk state is unmistakable.
- [ ] Transcript requires confirmation before submission.
- [ ] Raw audio is discarded.
- [ ] Crash/startup cleanup removes stale temporary audio.
- [ ] No cloud STT/TTS endpoint is required.
- [ ] Canonical Candice voice is the same on Mac and Windows.
- [ ] Final character is transparent and has no baked-in terminal/UI.
- [ ] Lightweight mouth/eye/gesture animation works.
- [ ] Spec Protocol remains the interview authority.
- [ ] Clarification questions return to the governed pending question.
- [ ] Answers go to the same Claude Code session.
- [ ] Plain `claude` path works.
- [ ] `claude-nine` path works.
- [ ] Nine-router does not require a Candice-specific routing integration.
- [ ] Compact progress companion remains after interview.
- [ ] Compact companion can accept voice and typed user questions.
- [ ] `/bro` and `/eli5` can be submitted from compact Candice.
- [ ] User can always return to direct Claude input.
- [ ] Candice failure never blocks Claude.
- [ ] macOS Apple Silicon release passes.
- [ ] The V1 art-input gate passes with the 16 supplied source assets; no seventeenth image is required by default.
- [ ] The Downloads screenshot is excluded from the production asset bundle.
- [ ] Windows PowerShell 5.1, PowerShell 7 where installed, and CMD are handled as native shells.
- [ ] `claude` and `claude-nine.cmd` resolve and launch correctly from native Windows shells.
- [ ] Windows Terminal multi-tab/pane switching cannot cross-route Candice input between Claude sessions.
- [ ] Host-window anchoring is never treated as session identity.
- [ ] At least one interactive Windows 10/11 desktop smoke run passes before Windows is labeled production-ready.
- [ ] GitHub Releases is used as the default controlled release channel unless a recorded live constraint requires another operator-controlled location.
- [ ] Native Windows x64 release passes.
- [ ] Windows Terminal + PowerShell is tested with Candice.
- [ ] Windows Terminal + CMD is tested with Candice.
- [ ] Standalone PowerShell is tested with Candice.
- [ ] Standalone CMD / Command Prompt is tested with Candice.
- [ ] Windows `claude-nine.cmd` path is tested in addition to plain `claude`.
- [ ] Existing-user update installs missing Candice components.
- [ ] Fresh 999 setup installs Candice automatically.
- [ ] Updater verifies checksums and rolls back on failure.
- [ ] No generic runtime dependency contains developer-specific absolute paths.
- [ ] Historical six-wave boss campaign no longer governs generic customer projects.
- [ ] Current repository head/versions are re-read before implementation; the planning snapshot is never assumed current.
- [ ] Reusable workflow definitions are sliced into visible runs; the build does not author 50 copy-pasted workflow scripts.
- [ ] Worktree count is minimized safely (default run/collision-domain isolation; per-unit worktrees only when required).
- [ ] Total agent-execution budget is declared and execution epochs roll over before the active session budget is exceeded.
- [ ] Candice-specific one-final-merge policy overrides generic periodic-to-main batch merging for this build.
- [ ] Final integration is refreshed against the latest `origin/main` before stamping/tagging.
- [ ] Relevant CI is explicitly green before merge even if branch protection does not enforce it.
- [ ] The conductor performs orchestration only and does not directly implement any substantive task.
- [ ] Every substantive Candice task is `WORKFLOW REQUIREMENT: WORKFLOW`; no `DIRECT` implementation tasks remain.
- [ ] No raw Agent-tool implementation fallback is used.
- [ ] All code, tests, fixes, docs, installer/updater changes, integration, versioning, tagging, merging, and post-merge verification have visible Workflow-agent provenance.
- [ ] Independent runnable work is dispatched concurrently; no serial drift occurs while safe capacity is idle.
- [ ] Primary Mac Terminal.app + `claude-nine` path passes end-to-end and is treated as a release blocker if broken.
- [ ] Primary Mac Terminal.app + plain `claude` path passes end-to-end without modifying plain Claude routing.
- [ ] Windows CMD can launch `claude` and `claude-nine.cmd`; installer automation can invoke the PowerShell orchestrator without requiring the user to abandon CMD.
- [ ] No mandatory Windows Spec Protocol/Candice runtime step requires Git Bash or WSL.
- [ ] Native/cross-platform Windows parity exists for capacity, reconciliation, environment sweep, ledger/state, update/self-update, and watchdog/heartbeat tooling.
- [ ] Windows capacity measurement uses native Windows APIs/tools rather than `sysctl`/`nproc`.
- [ ] Windows PowerShell 5.1 path passes.
- [ ] Windows PowerShell 7 path passes where installed.
- [ ] Safe live width is computed from real capacity and runnable units.
- [ ] Up to 50 workflows / 500 agents can be used without shared-write collisions.
- [ ] Each normal full workflow uses 5 Opus/max builders and 5 Sonnet/max QC/fixers.
- [ ] Every workflow is visible and recorded; no silent workflow counts as launched.
- [ ] Every writer uses an isolated branch/worktree or equivalent ownership boundary.
- [ ] Builder/QC writer-baton handoff prevents simultaneous editing of one unit.
- [ ] QC agents repair defects they find.
- [ ] A QC agent never self-certifies a result it modified; a fresh QC recheck passes.
- [ ] Waves occur only for real documented dependencies.
- [ ] Free safe capacity is not left idle while runnable work exists.
- [ ] Workers never independently bump/tag/merge release state.
- [ ] Final fan-in performs one coordinated bump/stamp/tag and one merge to `main`.
- [ ] Existing tests remain green.
- [ ] New Candice CI is green.
- [ ] Versions/changelog/docs are updated.
- [ ] Ultra Code is proven enabled before production workflow dispatch.
- [ ] Workflow-mode anti-downgrade gate is active across compaction/recovery.
- [ ] `CONTROL/TODO.md` reflects the full work inventory and native task graph.
- [ ] `CONTROL/CHECKLIST.md` promotion is controlled by passing independent QC evidence, not builder claims.
- [ ] `CONTROL/LEDGER.md` follows current state/verdict/restart doctrine and `CONTROL/SESSION-LOG.md` remains append-only history.
- [ ] Ledger restart steps + execution plan + project state are sufficient to resume after compaction without conversational memory.
- [ ] Namespaced ownership/QC/workflow state in `CONTROL/project_state.json` reconciles with real branches/worktrees/workflow handles.
- [ ] Reconciliation heartbeat detects and repairs drift between durable state layers.
- [ ] First nine Candice source assets are copied from the resolved Downloads location without mutating originals.
- [ ] First-batch asset inventory records 7 x 1254x1254 RGBA bust images and 2 x 941x1672 RGBA full-body images.
- [ ] Second-batch asset inventory records 7 x 1024x1536 RGBA PNG files.
- [ ] The multi-pose source sheet is split only into useful normalized states; it is not blindly used as a runtime atlas.
- [ ] The 16 supplied art assets are sufficient for V1; absence of a possible 17th image does not block implementation.
- [ ] Production runtime uses normalized stable asset filenames rather than download-generated filenames.
- [ ] Face-state registration is measured before whole-frame speech animation is used.
- [ ] Final artwork has replaced every development placeholder.
- [ ] Production release artifacts are signed/notarized where credentials are available/required.
- [ ] Completed implementation is merged to `main`.
- [ ] Post-merge smoke tests pass on merged `main`.

---

## 29. GIT / RELEASE COMPLETION RULE

This task is not complete when the code exists locally.

Completion means:

1. implementation finished,
2. tests green,
3. final assets integrated,
4. versions/docs updated,
5. release artifacts built,
6. commits pushed,
7. PR merged or equivalent repository-approved merge completed,
8. `main` contains the implementation,
9. merged `main` passes smoke validation,
10. integration was refreshed against the latest `origin/main` before stamping,
11. relevant CI/checks are green (or an explicit operator exception is recorded).

Do not stop at “ready to merge.”

If the operator's repository permissions permit the merge and all required checks are green, merge it.

---


## 29B. REQUIRED EXECUTION-PACKAGE BOOTSTRAP — CANONICAL FILES ONLY

Before the first production implementation agent is dispatched, instantiate or reuse the **existing Spec Protocol 17-document project apparatus**.

Do not create a parallel Candice state system.

For this project, at minimum prove/populate:

```text
SPEC/MASTER-SPEC-YYYY-MM-DD.md       # this specification
SPEC/PROJECT-MANIFEST.md
CONTROL/EXECUTION-PLAN.md
CONTROL/TODO.md
CONTROL/CHECKLIST.md
CONTROL/LEDGER.md
CONTROL/SESSION-LOG.md
CONTROL/dispatch-log.md
CONTROL/HEARTBEAT.md
CONTROL/project_state.json
CONTROL/task-graph-snapshot.json
CAPACITY-LEDGER.md
```

Other required documents from the current closed 17-document manifest remain governed by `references/documents.md`.

### Bootstrap gates

Before `RUN_STATUS` may become `EXECUTING`:

```text
ULTRA_CODE_REQUIRED=true
WORKFLOW_MODE_REQUIRED=true
RAW_HIDDEN_SWARM_FORBIDDEN=true
CONDUCTOR_DIRECT_IMPLEMENTATION_FORBIDDEN=true
ALL_SUBSTANTIVE_TASKS_REQUIRE_WORKFLOW=true
RUN_STATUS=PLANNING
RELEASE_READY=false
```

and all of these must pass:
- latest `origin/main` fetched and baseline SHA recorded;
- current skill versions recorded;
- baseline tests recorded;
- Ultra Code gate PASS;
- Workflow capability probe PASS (or explicit recorded degraded mode);
- native task graph probe PASS;
- Capacity Ledger/resolver PASS;
- Opus and Sonnet seat-routing canaries PASS;
- max-thinking support/proof recorded;
- total execution budget/epoch plan declared;
- Master Spec / Project Manifest / Execution Plan / TODO / Checklist / Ledger / project state reconciled;
- workflow-run slices and ownership are collision-free;
- workflow runs are visible by real Workflow handles/trees.

Then Wave 1 may dispatch.



## 29C. V6 FINAL REVIEW RESULT

V3 review score: **8.8/10**.

The V3 product design was strong, but six execution risks prevented a 10:
1. it duplicated control documents already present in Spec Protocol's closed 17-document apparatus;
2. it blurred **workflow definitions** with **workflow runs**, encouraging up to fifty copy-pasted scripts;
3. it defaulted toward per-agent worktrees, which could create unnecessary disk/build-cache pressure;
4. it omitted the separate total agent-execution/session-budget rollover problem;
5. its one-final-merge rule was not explicitly marked as a project-specific override of current generic periodic batch-merge doctrine;
6. its repo baseline was stale (`1.16.1` vs current reviewed `1.16.3`), and it lacked a self-enforced CI/trunk-freshness gate for an unprotected `main`.

V4 closes those gaps.

V5 was already strong on Candice architecture, Mac/Windows support, assets, privacy, updates, and concurrency. The final review found one remaining execution ambiguity: several steps still read as if the conductor itself could run tests, fix regressions, integrate, stamp, or merge. The operator has now explicitly prohibited that behavior. V6 converts the entire build into a **workflow-only execution contract**, makes `DIRECT` substantive tasks illegal for this project, and makes workflow loss a stop condition rather than permission to code inline.

V6 also makes the expected customer priority explicit: **macOS Apple Silicon + Terminal.app is the first-class/reference path**, while native Windows remains supported through CMD, Windows PowerShell, PowerShell 7, and Windows Terminal. It preserves both plain `claude` and routed `claude-nine`, with Nine-router remaining the dominant expected production path.

The final repository cross-check also found that several current Spec Protocol deterministic tools are Bash-only, including the capacity resolver whose core probe uses `sysctl`/`nproc`. V6 therefore makes native/cross-platform parity for those mandatory runtime tools a P0 Windows release gate; `claude-nine.cmd` launching successfully is not considered sufficient Windows support by itself.

**V6 FINAL LOCKED specification score against all operator requirements known at review time: 10/10.**

V5 additionally closes the final currently visible gaps:
- records the second seven-image batch and declares the 16-asset V1 art gate sufficient;
- explicitly excludes the Finder screenshot from runtime assets;
- defines the Windows native command matrix for CMD, Windows PowerShell 5.1, and PowerShell 7;
- separates Windows Terminal host-window anchoring from Claude session identity so tabs/panes cannot cross-route input;
- requires interactive Windows desktop validation before claiming Windows production readiness;
- establishes GitHub Releases as the default operator-controlled distribution channel with a live size/licensing check for larger speech assets.

This score applies to specification completeness/consistency, not a promise that implementation will encounter zero unknown platform defects. New discoveries must be recorded through the canonical decision/ledger process rather than silently weakening the gates.

---

## 30. AUTHORITATIVE REFERENCES TO CHECK DURING IMPLEMENTATION

Re-verify current documentation before using an API that may have changed.

### Repository
- `https://github.com/trevorotts1/999-setup`
- `.claude/skills/spec-protocol/SKILL.md`
- `.claude/skills/spec-protocol/tools/check-update.sh`
- `.claude/skills/spec-protocol/tools/self-update.sh`
- `.claude/skills/spec-protocol/references/workflows.md`
- `.claude/skills/spec-protocol/references/capacity.md`
- `.claude/skills/spec-protocol/references/documents.md`
- `.claude/skills/spec-protocol/references/execution-architecture.md`
- `.claude/skills/spec-protocol/references/anti-drift.md`
- `.claude/skills/spec-protocol/references/pipeline.md`
- `AGENT_INSTALL.md`
- current macOS/Windows setup orchestrators
- `tools/boss-cron`

### Claude Code
- Hooks reference: `https://code.claude.com/docs/en/hooks`
- MCP: `https://code.claude.com/docs/en/mcp`
- Plugins: `https://code.claude.com/docs/en/plugins`
- Windows/setup: `https://code.claude.com/docs/en/setup`

### Desktop shell
- Tauri 2 docs: `https://v2.tauri.app/`

### Local STT
- canonical `whisper.cpp` repository: `https://github.com/ggml-org/whisper.cpp`

### Local TTS
- pin and document the exact Kokoro 82M-compatible runtime/model/voicepack chosen for production.

---

# FINAL IMPLEMENTATION PRINCIPLE

Do not build an AI inside a hologram.

Build a dependable local companion around the AI session the user already has.

**Claude/Claude-Nine = brain.**  
**Spec Protocol / Kaizen / ELI5 / Bro = governed behavior.**  
**Candice = face, voice, ears, controls, and progress companion.**  
**whisper.cpp = local ears.**  
**Kokoro = local signature voice.**  
**The final approved artwork = the lightweight animated body.**

The user should experience one simple thing:

> They run a BlackCEO skill, Candice appears, she tells them what is happening, they talk or type naturally, and the exact same Claude session does the work.
