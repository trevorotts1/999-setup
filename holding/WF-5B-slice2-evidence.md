# WF-5B slice 2 evidence — Issue 19 FIX step 2 (agent budget) — WAVE 5 DISPATCH

Date: 2026-08-16. Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-5B, branch fix/19-gauntlet, base dc688c7. Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md Issue 19 FIX step 2 (line 421), QC bar (line 430), FIX step 7 wire-in points (line 427).

## 1. The bar (spec line 421, verbatim)

"**Agent budget:** expected initial run 52; normal complete project 75-125; warning 150 (orchestrator analyzes whether measurable progress continues); hard cap 200 — at 200 STOP, preserve the best stable build, produce a blocker report explaining why the bar was not reached."

## 2. Full-file reads performed (every claim below cites a file line; no greps for judgment)

- SKILL.md (1688 lines, read in 3 passes) — full read.
- references/capacity.md (1559 lines) — full read.
- references/gauntlet.md (1243 lines) — full read.
- references/loops.md (547 lines) — full read.
- references/documents.md (650 lines) — full read.
- references/execution-architecture.md (685 lines) — full read.
- references/anti-drift.md (644 lines) — full read.
- references/workflows.md (667 lines) — full read.
- tools/anchor.sh class 6 budget_audit (lines 598-691) + exit-code contract (lines 201-208) + selftest budget cases (lines 1256-1306).
- tools/capacity-resolver.sh GAUNTLET_* constants (lines 82-87) + AGENT BUDGET DECLARATION card emission (lines 458-467).
- references/agent-team.md §8.3 (lines 1301-1317).
- references/worked-example.md budget lines (59-60, 260, 498-510, 548-550, 611-622).
- references/pipeline.md concurrency-caps table (lines 95-105) + budget scan.
- references/resume.md, interview.md, media-pipeline.md budget scans.
- PROMPT-QC-INSTRUCTIONS.md (21 lines) — pointer only, no budget content.

## 3. Preexisting carriers verified in place (the budget was PARTLY woven before this slice; this slice completes the weave)

| Carrier | File:line | What it holds |
|---|---|---|
| Gauntlet stations table | references/capacity.md §10, lines 777-785 | 52 expected (8+16+16+8+4); 75-125; at 150 orchestrator analyzes whether measurable progress still occurs; at 200 HARD STOP — preserve best stable build, blocker report, run_status=STOPPED_CAP, never relabeled PASS |
| Budget table | references/gauntlet.md §13.2, lines 937-960 | 52 / 75-125 / 150 (MUST analyze + record) / 200 STOP — preserve best stable build, blocker report, LIMIT REACHED non-success, run_status=STOPPED_CAP; three named exits PASS/STOPPED_CAP/stop-and-diagnose; counts workflow agent executions, never conflated with the 1,000 session budget |
| project_state.json schema | references/documents.md lines 524-529 | agents.executions_total, budget_initial, session_budget_remaining, warn_at: 150, hard_stop_at: 200; run_status STOPPED_CAP (line 517) |
| Class 6 enforcement | tools/anchor.sh lines 621-639 | exec_t >= CAP (default 200, lowered by hard_stop_at) -> BUDGET-CAP ledger line + ACTION|stop-dispatching + ACTION|set-run-status|STOPPED_CAP, exit 3 (lines 626-631); exec_t >= WARN (default 150) -> ACTION|review-budget advisory emitted once (lines 633-638); BUDGET-CAP excluded from state-delta fingerprint (line 239) |
| Exit obligations | references/anti-drift.md lines 201-208 | exit 3 on class-6 hard cap: preserve best stable build, write blocker report (line 207) |
| Exit obligations | references/execution-architecture.md lines 495 | STOPPED_CAP row: spawn nothing; preserve best stable build; blocker report explaining why the bar was not reached; never relabeled PASS |
| Best-build gate | references/execution-architecture.md lines 449-452 | GATE — BEST BUILD: at a hard agent cap the run must PRESERVE the best stable build and report it |
| Declared-budget card | tools/capacity-resolver.sh lines 458-467 | AGENT BUDGET DECLARATION all eight quantities: 52 expected initial run; 75-125 soft budget; at 150 analyze whether measurable progress still occurs; 200 hard stop -> blocker report, run_status=STOPPED_CAP |
| Constants | tools/capacity-resolver.sh lines 82-87 | GAUNTLET_EXPECTED=52, GAUNTLET_SOFT_LOW=75, GAUNTLET_SOFT_HIGH=125, GAUNTLET_REVIEW=150, GAUNTLET_HARD_STOP=200, REPAIR_WAVE_CAP=12 |
| Commander exclusion | references/agent-team.md lines 1303-1305 | commanders NOT agent executions against the 52/150/200 gauntlet budget — counts workflow executions |
| Worked example | references/worked-example.md lines 498-510, 548-550 | budget close-out: 36 executions inside soft band 30-50, nowhere near 150/200; warn_at 150, hard_stop_at 200 in state JSON |
| Stop-condition mapping | references/gauntlet.md §9 lines 660-683 | LIMIT REACHED -> blocked-timeout/blocked-limit; never PASS |
| Station 19 | references/gauntlet.md §14 line 1118 | >=200 executions -> STOPPED_CAP |
| Selftest cases | tools/anchor.sh lines 1265-1306 | case 9 budget-agree, case 11 budget-hard-cap (BUDGET-CAP executions=200 cap=200, exit 3 NOT 4), case 12 budget-fields-absent, case 13 budget-negative-spend |

## 4. Gaps found and fixed by this slice (the weave's missing threads)

GAP A — SKILL.md step 16.6 named the agent-budget declaration but carried none of the gauntlet stations. FIX: step 16.6 now states the stations inline: expected initial run 52 (8+16+16+8+4); normal complete project 75-125; at 150 the orchestrator analyzes whether measurable progress is still occurring and records the analysis; at 200 STOP — spawn nothing further, preserve the best stable build, produce a blocker report, exit run_status=STOPPED_CAP (LIMIT REACHED, never relabeled PASS); counter = agents.executions_total audited by the reconciler class 6. SKILL.md line ~1141 (16.6 block).

GAP B — SKILL.md Defaults table had no agent-budget row (the table carries every standing quantity: fix-loop cap, batch size, gate). FIX: new row "Agent budget (gauntlet stations)" — 52 initial / 75-125 normal / 150 warning (orchestrator analyzes whether measurable progress continues) / 200 hard cap (STOP, preserve best stable build, blocker report, STOPPED_CAP), enforced every reconcile pass by the class-6 budget audit; counts workflow agent executions only, a different meter from the 1,000-per-session budget. SKILL.md Defaults table (~line 1532, after the Fix loop cap row).

GAP C — gauntlet.md §14 station 19 named the 200 stop but not the 150 analysis step. FIX: station 19 now reads: at >=150 executions the lead ANALYZES whether measurable progress is still occurring (compare the state-delta fingerprint, the workstream pass/fail counts, and the last checkpoint against the spend — references/anti-drift.md class 6) and RECORDS the analysis in the ledger before any further dispatch; >=200 executions -> STOPPED_CAP. gauntlet.md line ~1118 (station 19 row).

The 150-analysis obligation already existed in doctrine (capacity.md 781, gauntlet.md 943, resolver 466) and its trigger already exists mechanically (anchor.sh review-budget ACTION, once per run); GAP C makes the conductor's response to that ACTION an explicit loop step, and GAP A/GAP B make the whole budget surface visible in the skill's operational flow and defaults.

## 5. Instruments proven live (2026-08-16)

- tools/capacity-resolver.sh --selftest: 34 PASS, 0 FAIL ("SELFTEST: PASS — all scenario and instrument checks passed"). Includes the AGENT BUDGET DECLARATION card assertions (lines 556-611).
- tools/anchor.sh --selftest: "SELFTEST COMPLETE | 13 of 13 cases passed | 0 failed". Cases 9-13 cover the budget audit: budget-agree negative control, budget-hard-cap (BUDGET-CAP executions=200 cap=200, exit 3 not 4, ACTION|stop-dispatching + ACTION|set-run-status|STOPPED_CAP, no TERMINAL-DRIFT.flag), budget-fields-absent, budget-negative-spend (never laundered into budget-ok).

## 6. Edits made (this slice only)

1. /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/SKILL.md — step 16.6 agent-budget stations (GAP A).
2. /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/SKILL.md — Defaults table agent-budget row (GAP B).
3. /Users/blackceomacmini/work-999-setup-fix/WF-5B/.claude/skills/spec-protocol/references/gauntlet.md — station 19 150-analysis step (GAP C).
4. /Users/blackceomacmini/work-999-setup-fix/WF-5B/FIX-LEDGER.md — sync from master ledger (Waves 3-4 results + WAVE 5 DISPATCH; backup /tmp/WF5B-FIX-LEDGER.md.bak-*) + WF-5B slice 2 line citing WAVE 5 DISPATCH.

Scope boundary: touched ONLY the three budget surfaces + the ledger. No edits to capacity.md §10, gauntlet.md §13.2, anchor.sh, capacity-resolver.sh, documents.md — verified already correct and complete; no adjacent tidying.

Note on sibling slices in the same working copy: WF-5B slice 1 (six workflow counts, SKILL.md step 12.7 + gauntlet.md §13 slices-not-concurrency) and WF-5B slice 3 (CAPACITY RULE, completed per task list) have landed edits in the same files. This slice's hunks are distinct (16.6 block, Defaults table, station 19) and do not overlap those; the working tree carries all slice edits for the branch.
