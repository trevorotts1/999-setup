# CONTROL / LEDGER — Live State, Verdicts, Restart Truth

<!-- CANDICE_RELEASE_REPAIR_STATUS: lifecycle=REPAIR_IN_PROGRESS open=24 complete=0 -->

> **FIX-001 release-truth override (2026-08-22):** The historical workflow
> ledger below does not authorize a release. Current Candice repair state is
> 24 open fixes and zero completed fixes. The enforced release authority is
> `CONTROL/release-gate.json` evaluated by `scripts/candice-release/status.mjs`.

Project: Candice Companion AI (spec-protocol build, 999-setup repo)
Canonical Master Spec: `/Users/blackceomacmini/Downloads/CANDICE_COMPANION_AI_IMPLEMENTATION_SPEC_V6_FINAL_LOCKED.md` (canonicalized as `SPEC/MASTER-SPEC-2026-08-21.md` — see SESSION-LOG)
Last updated: 2026-08-21 (TRUTH CONTRADICTION RESOLUTION — section 1 refreshed per enumeration; 1-run/15-agent contradiction resolved, option A)

---

## 1. CURRENT STATE VIEW (regenerated; the first operational truth)

| Field | Value |
|---|---|
| Logical wave | pre-build (wave 0 — apparatus/planning; implementation waves W1-W5 per EXECUTION-PLAN.md) |
| Execution epoch | 0 |
| Safe live width | **50 committed** (CAPACITY-LEDGER 2026-08-21: WR-004 `wf_b9f59642-d5c` COMPLETED — clientCap 10, runs 5, role_aware_runs 10, budget 700) |
| Intended workflow runs | 23 (all 23 real run handles enumerated in the live workflow store; board rows in EXECUTION-PLAN.md section 1) |
| Visible workflow runs | 23 (every real run handle has a board row — VISIBILITY-FAIL list empty per truth-update reconciliation 2026-08-21) |
| Active workflow runs | 3 (WR-007 planning `wf_66e51e17-7cc` just-completed transition, planning rolling recheck `wf_bef69fc1-fd8` 5 opus builders, truth lane `wf_d6dd0a72-000` 1 opus — children of the WR-007 tree, not a 10-agent workflow) |
| Completed workflow runs | 20 (WR-001 `wf_bb855713-af9`, WR-002 `wf_9529b3f1-4bb`, WR-003 `wf_40977ba0-353` STOPPED-RESTARTED as WR-007, WR-004 `wf_b9f59642-d5c`, WR-005 `wf_9cdd60f8-358`, WR-006 `wf_63e7cd35-51c`, WR-007 `wf_66e51e17-7cc`, WR-008 `wf_046b1be8-ea3`, audits `wf_7cb74348-fec` / `wf_d99de8ad-90b` / `wf_7920d06d-4c9` / `wf_1b5a3a00-e4b` / `wf_8222a8fa-215`, audit-repair `wf_61fe0666-d88`, watchdog `wf_edc5ea4c-947` STOPPED conductor-killed, spec discovery `wf_587604e9-de8` NOT_FOUND, repair + two-truth `wf_802e202c-116`, watchdog-v8 + truth-gate `wf_ecc575ed-cf9`, truth-gate QC-FIX + recheck `wf_13ee1ba1-624`, truth-gate audit `wf_da0ccfb6-3c0`, state reconcile `wf_9f089d63-c0e` — all 20 completed entries in project_state.json) |
| Max agents per workflow | **10** (invariant — 5 builders + 5 QC; WR-007 `wf_66e51e17-7cc` peak = 10 concurrent, all resulted; no run ever exceeded 10; resolution record below) |
| Integration SHA | `6bb00ec70af69510fab5a9c2ef332751e260d036` (HEAD of main, verified 2026-08-21) |
| Pending builder handoffs | none |
| Pending rechecks | prebuild truth-gate fresh recheck pending (QC-FIX ROUND 1 fixes applied; fresh independent sonnet/max recheck dispatched by the conductor) |
| Severe blockers | none |

### Exact next conductor actions (in order)

1. Let the planning-rolling-recheck (`wf_bef69fc1-fd8`, 5 opus builders re-validating the WR-007 planning deliverables) land and QC its handoffs; WR-007 `wf_66e51e17-7cc` itself is COMPLETED (all 10 seats resulted; 5 blind QC FAILs since re-checked per EXECUTION-PLAN.md sections 7-9).
2. Proceed to implementation dispatch — build fan-out starts at WR-033+ per the dependency-dag re-verification (launch IDs = snapshot slice IDs WR-008/WR-009/WR-012 for W1; next free WR-033+). 0H gates MET: canaries + max-thinking PASS (WR-004), task graph PRESENT, ledger current, board rows with real handles.
3. Keep board rows current per EXECUTION-PLAN.md section 1 rules (0D visibility gate).
4. Continue waves per EXECUTION-PLAN.md step 3/4.

---

## 1b. TRUTH CONTRADICTION RESOLUTION — 2026-08-21 (1-run/15-agent)

**Contradiction:** a mid-flight report claimed 1 workflow run with 15 live agents — a breach of the 10-agent per-workflow cap.

**Resolution: OPTION A** (per the truth-enumeration agent, 2026-08-21, wf_d6dd0a72-000 — full record in SESSION-LOG.md "TRUTH CONTRADICTION RESOLUTION 2026-08-21"). The 1-run/15-agent figure was a **mid-flight snapshot artifact**, not a cap breach.

**Evidence:**
- Truth-gate enumeration (wf_da0ccfb6-3c0, agent ab3fb39eb3aac92ed) walked the live workflow store: the 15 un-resulted agents were spread across **5 run dirs** whose terminal records had not yet been written — `wf_7920d06d-4c9` 5, `wf_8222a8fa-215` 5, `wf_9f089d63-c0e` 4, `wf_b9f59642-d5c` 3, `wf_9cdd60f8-358` 3 = 20 started / 15 un-resulted at 09:53Z; all cwd-resolved to the executing audit-family tree (descendant spawns sharing a parent tree, NOT one run exceeding 10). All 5 runs since completed (started == resulted; terminal records completed).
- Final enumeration of all 23 run dirs (journal started/resulted counts, meta models, terminal records): 19 completed, 2 killed (wf_edc5ea4c-947, wf_40977ba0-353), 2 live (wf_bef69fc1-fd8, wf_d6dd0a72-000).
- **REAL_ACTIVE_RUNS=2, REAL_ACTIVE_AGENTS=6, MAX_AGENTS_IN_ANY_ONE_WORKFLOW=10** (WR-007 `wf_66e51e17-7cc`: 5 opus builders + 5 sonnet QC concurrently, all 10 resulted; the 11th file is an interrupted post-completion retry, never concurrent).
- No option-B cap breach ever existed.

**Consequence (recorded, not blocking):** `max_agents_per_workflow = 10` set in project_state.json candice namespace as the invariant value; board/LEDGER counts refreshed (Active 3 incl. the just-completed WR-007 transition + 2 child lanes; Completed 20; intended/visible 23).

---

## 2. QC VERDICT BLOCKS (durable)

- **2026-08-21 blind QC — prebuild truth gate: FAIL (six-part fix list).** Fixes applied in QC-FIX ROUND 1 (2026-08-21): board row added for `wf_d99de8ad-90b`, VISIBILITY-FAIL closed; this LEDGER section 1 + restart steps regenerated (width 50 committed, WR-007 sole active, 12 completed, dispatch WR-009+); plan-row IDs assigned (WR-005-plan→WR-031, WR-006-plan→WR-030, WR-007-plan→WR-032); WATCHDOG-PROOF.md corrected (root boss-cron carries the flock guard, backup named); role-aware formula added to CAPACITY-LEDGER. Fresh independent recheck required. Verdict text in SESSION-LOG.md (QC-FIX ROUND 1 section).

---

## 3. MERGE / RELEASE RECORDS

None yet. No merges or releases for the Candice build as of 2026-08-21.

---

## 4. LITERAL RESTART STEPS (cold resuming conductor — run in this order)

1. **Read this file** (`CONTROL/LEDGER.md`) — current state + verdicts + merge record (above).
2. **Read the workflow board** — `CONTROL/EXECUTION-PLAN.md`, named section "CANDICE WORKFLOW-RUN BOARD". This is the live board of intended/visible/active/completed workflow runs.
3. **Read machine truth** — `CONTROL/project_state.json`: the `candice` namespace (added 2026-08-21 reconciliation) holds the Candice run/epoch/wave state with real handles; the prior `999-master-fix` residue fields are preserved untouched per spec 0J. Backup of the pre-reconciliation file: `CONTROL/project_state.json.bak-candice-bootstrap`.
4. **Re-fetch main per spec 0G freshness** — run `git fetch origin main` (or `git pull --ff-only` on main) in `/Users/blackceomacmini/Downloads/999-setup`.
5. **Verify SHAs** — confirm the working tree HEAD matches the integration SHA in section 1 (`6bb00ec70af69510fab5a9c2ef332751e260d036`). If it differs, the newer SHA wins: update section 1 and the board, and note the delta in SESSION-LOG.
6. **Resume dispatch** — DO NOT re-run completed runs: WR-004 (capacity), WR-005 (setup-ci-fix), WR-006 (baseline), WR-007 (planning, COMPLETED per truth-update 2026-08-21), WR-008 (census-fix) and all audit runs are COMPLETED per section 1. Active runs: planning-rolling-recheck `wf_bef69fc1-fd8` (5 opus builders, child of WR-007) and truth lane `wf_d6dd0a72-000`. Next dispatch action: implementation build fan-out starting at WR-033+ (launch IDs = snapshot slice IDs WR-008/WR-009/WR-012 per EXECUTION-PLAN.md section 6.2; next-free WR-033+ per the dependency-dag re-verification). No completion-run is ever re-dispatched.
7. If the ledger was interrupted mid-write, re-verify pending builder handoffs and pending rechecks against TODO/CHECKLIST before dispatching anything.
