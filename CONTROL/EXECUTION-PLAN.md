# CONTROL/EXECUTION-PLAN.md — Implementation

**Document:** 16 of the 17-document apparatus (waves, lanes, parallelism plan, release strategy, visible workflow board)
**Base SHA (planning snapshot):** `6bb00ec70af69510fab5a9c2ef332751e260d036` (2026-08-21). Re-fetch `main` before final integration (spec 0G trunk freshness gate).
**Repository:** `https://github.com/trevorotts1/999-setup`

---

## 2. WAVES FORECAST (spec 0F — planning aid, never a barrier)

A new wave exists only when a real dependency prevents the next work from starting now, justified in the form:

```text
WAVE-n-BLOCKED-BY:
- task/unit:
- requires output from:
- exact artifact/evidence required:
```

The dependency graph governs actual release, not the label "wave." If a W2-type unit becomes runnable while W1 work remains, dispatch it immediately. Rolling execution: each builder handoff releases its QC task immediately; no global all-builders/all-wave barriers.

| Logical wave | Primary purpose | Approx. useful live width when enough work is ready |
|---|---|---|
| W1 | Independent foundations/components | 300–500 |
| W2 | Cross-component integration + rolling QC/fix | 250–400 |
| W3 | End-to-end user journeys + system repair | 150–300 |
| W4 | Cross-platform/update/failure/privacy hardening | 75–200 |
| W5 | Final fan-in/release verification | 10–50 |

Ranges are planning guidance, not targets and not stage barriers. Under-width is a defect only when runnable work waits; padding (invented agents) is forbidden — every agent needs a unique responsibility, evidence/input, an explicit deliverable, and a binary acceptance criterion.

**Epoch note:** a wave = dependency level; an epoch = conductor/session budget boundary (0F "execution epochs"). Concurrency is not a lifetime budget. Before an epoch rollover the conductor stops new launches, lets in-flight runs checkpoint, reconciles all control docs, and writes literal restart steps into `CONTROL/LEDGER.md`.

**Why the live number may be below 500** (record the specific reason, never "to be safe"): fewer real runnable tasks; dependency blocks; measured provider/harness concurrency lower; collision-serialization of a shared resource; or final integration/release where one controlled writer is required.

---

## 3. PARALLELISM PLAN (spec 0A/0B/0C)

### 3.1 Structural ceiling and seats

```text
MAX_WORKFLOW_RUNS         = 50
MAX_AGENTS_PER_WORKFLOW   = 10   (5 builders + 5 QC/fixers)
MAX_BUILDERS_GLOBAL       = 250
MAX_QC_GLOBAL             = 250
MAX_SUBAGENTS_GLOBAL      = 500
```

- Builder seat: `opus` / max thinking — via the routing gateway. Do not hardcode the provider ID in workflows; `opus`/`sonnet` are routing seats.
- QC/fixer seat: `sonnet` / max thinking — via the routing gateway.
- Every `agent()` call is seat-pinned; no bare/unpinned calls; no `DIRECT` tasks (0.0A); `pipeline()` is the default primitive.

### 3.2 Safe live width (calculated at dispatch time by the capacity workflow, per 0A/0H)

```text
builder_width = min(250, usable_opus_route_concurrency_after_reserve, runnable_unique_builder_stage_tasks)
qc_width      = min(250, usable_sonnet_route_concurrency_after_reserve, runnable_unique_qc_or_recheck_stage_tasks)
safe_live_agents = min(500, builder_width + qc_width, measured_harness_usable_concurrency, measured_global_provider_usable_concurrency)
visible_workflow_run_count = min(50, ceil(safe_live_agents / 10))
```

Before implementation dispatch the 0H gates require: current profiler result, opus route canary, sonnet route canary, max-thinking proof on both seats, task graph, board section, unique ownership, worktree plan, shared-file list, safe width, no padding.

### 3.3 Pairing and rolling saturation

Default pairing: B1→Q1, B2→Q2, B3→Q3, B4→Q4, B5→Q5. QC starts per-unit on handoff, not at an all-builders barrier. Initial moment may have fewer QC seats than builders (no handoffs yet); steady state saturates to 5+5 per run.

QC is also a fixer (0.1 override 2): blind verdict first → take write baton → repair → tests → release baton → fresh independent Sonnet/max recheck (work stealing from the QC pool). A QC that edited the unit may never be its final certifier.

### 3.4 Collision-free ownership (0C)

- Default isolation: one Git worktree/branch per workflow run or write-collision domain; inside it, builder units hold disjoint owned paths. Escalate to per-unit worktrees only when paths overlap, tools rewrite shared files, independent history is required, or isolation is otherwise impossible.
- Writer baton: exactly one write owner per unit at a time — builder checkpoint commit + handoff → QC reads/verdicts → pass=ACCEPTED / fail=QC repair → fresh recheck.
- Reuse package/model caches; never share mutable build output dirs between concurrent writers.
- **Shared-file single-writer list (integration-owned unless partitioned):** root/version release files; final `CHANGELOG.md`; final README release/version sections; Git tags; global component manifest/checksum file; shared lockfiles rewritten whole by a package manager; global CI/release files; final consolidated Spec Protocol `SKILL.md`.
- Cross-lane defect rule: findings outside an owned unit are recorded as `CROSS-LANE-FINDING` (source workflow/lane, affected unit, evidence, severity, recommended action) and assigned by the conductor — never silently edited.
- Cleanup: retire accepted worker branches/worktrees after integration; preserve audit evidence; never delete the sole copy of unmerged work.
- **Run-ID hygiene:** run IDs must never be conflated across namespaces (board run IDs vs owned-glob slice-row IDs vs snapshot launch-slice IDs); a launch ID must be collision-free against the other namespaces at dispatch.

---

## 4. RELEASE STRATEGY (spec 0G — one fan-in, one stamp, one merge)

**Override:** the generic 15-minute intermediate-to-`main` merge cadence is DISABLED. No periodic merges. No one-workflow-at-a-time merges. Accepted work stays on isolated worker/integration branches until the coordinated release fan-in. Workers never merge to `main`; they commit on their own branches/worktrees only.

### 4.1 One fan-in (integration)

1. Stop/close the worker wave.
2. Build one deterministic accepted-commit inventory.
3. Create/update ONE integration branch from the current intended base.
4. Merge/cherry-pick accepted units in dependency order.
5. Resolve integration conflicts deliberately.
6. Run full repository + cross-platform test suites.
7. Run a fresh final system-level QC pass.

### 4.2 One stamp (release — single final writer)

Release files have ONE final writer; workers prepare evidence/drafts only:

- all changed skill `VERSION` files; app/plugin version; final `CHANGELOG.md`; final README/install documentation; component manifest/checksums; release notes; release artifact metadata; one Git tag.

All bumps are computed from the **actual final integrated diff** — never worker guesses. No piecemeal tags, no repeated bumps from parallel workers. Atomic: version(s) + changelog + docs + checksums + artifact metadata + one tag matching the released state, in one coordinated update.

### 4.3 One merge + gates

1. **Trunk freshness gate:** immediately before stamping, fetch `origin/main`; compare to base SHA `6bb00ec70af69510fab5a9c2ef332751e260d036`; if moved, integrate the delta, resolve deliberately, rerun affected tests + full smoke; compute versions/checksums/tag from the post-reconciliation state. Never force-push over unrelated new `main` work.
2. **Self-enforced CI gate:** `main` is not protected by required checks at the planning snapshot — the conductor must inspect the actual CI results for the integration/release commit and require every relevant required check green; missing/failed CI is a release blocker unless proven locally and explicitly authorized.
3. Push once as the integrated release candidate; merge once to `main` after gates pass; verify trunk ancestry and post-merge smoke tests (POST-MERGE workflow, spec 0 step 14).

---

## 5. VISIBILITY AND ANTI-DRIFT (spec 0D/0J)

- No duplicate root-level TODO/CHECKLIST/LEDGER/SESSION files and no duplicate workflow-board document. Canonical carriers only: `CONTROL/EXECUTION-PLAN.md`, `CONTROL/TODO.md`, `CONTROL/CHECKLIST.md`, `CONTROL/LEDGER.md`, `CONTROL/SESSION-LOG.md`, `CONTROL/dispatch-log.md`, `CONTROL/HEARTBEAT.md`, `CHANGELOG.md` (repo root), `CONTROL/project_state.json`, `CONTROL/task-graph-snapshot.json`. (There is no `spec/` directory: `SPEC/PROJECT-MANIFEST.md` was removed in the 2026-08-30 Candice eradication; `CONTROL/CHANGELOG.md` never existed — the changelog lives at the repo root.)
- Machine-readable run truth lives in `CONTROL/project_state.json` (namespaced fields: run/epoch/wave; workflow runs intended/created/visible/active/blocked/completed; safe width; agents live by role; unit ownership/write baton; handoffs; QC failures/repairs/rechecks; accepted units; integration state; last reconciliation; release readiness) — one truth, not four overlapping JSON stores.
- Reconciliation heartbeat runs: before first dispatch; after each launch batch; after meaningful fan-in; before/after compaction or epoch rollover; before changing wave; before final integration; before release stamp; after merge.
- Anti-downgrade gate (0I) at every recovery checkpoint: `ULTRA_CODE_REQUIRED=true`, `WORKFLOW_MODE_REQUIRED=true`, `RAW_HIDDEN_SWARM_FORBIDDEN=true`. Raw Agent-tool execution is not an implementation fallback for this build.

---

WORKFLOW-RUN BOARD (section 1) and BUILD-WAVE DAG + QC verdict blocks (sections 6-12) removed 2026-08-30
(eradication sweep): every board row was a workflow run of the removed app build; every DAG node was one
of its 50 workstreams; sections 7-12 were QC verdicts on that DAG. Sections 2-5 (waves forecast,
parallelism plan, release strategy, visibility/anti-drift) retained as the standing method.
