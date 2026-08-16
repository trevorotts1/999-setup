# WF-4C slice 3 evidence — Issue 15 FIX step 3 (one source render) + step 4 (command-shaped cron/loop prompts)

Issue: 15 (wave count drift). Slice: FIX steps 3-4. Branch: fix/15-wave-lock.
Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70; commit dc688c7 is the branch base).

## 1. Spec read — Issue 15 FIX steps 3 and 4

Source: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` (read in full, lines 1-629).

- Line 324 (FIX step 3): "One source render: spec, to-do, checklist, and ledger all render from the same wave table — never four drifting copies (the Capacity Ledger / execution plan owns it; everything else cites it)."
- Line 325 (FIX step 4): "Cron and loop prompts are COMMAND-SHAPED (`run /<saved-workflow>`), never free-form (SKILL.md lines 1546-1550)."
- Line 319 (WHY): "Waves re-derive from decayed memory on free-form cron ticks instead of being read from a locked table (SKILL.md lines 1546-1550 name the mechanism: free-form ticks re-plan from decayed memory)."
- Line 322 (step 1, sliced elsewhere): "the wave table (PART 2 of this document for the fix execution; the execution plan's wave table for client builds) is written once with an immutable count."
- Line 326 (step 5, sliced elsewhere): boss-cron check for waves not in the locked table without NEW-WAVE-N.
- QC bar (line 329): "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."
- PART 2.1 line 514: "Launch mechanism for a 10-agent workflow: a command-shaped invocation (`run /<saved-workflow-name>`) per Issue 15 item 4, never free-form."
- SKILL.md lines 1546-1550 are the spec's cited locus for the free-form-tick mechanism; in the working copy that text is the anti-drift paragraph at SKILL.md lines 1613-1620 (line-number shift from intervening edits; content match verified below, section 5).

## 2. Pre-existing state verified (full-file reads, all seven surfaces)

Files read in full before editing (no grep-for-judgment; full Read tool passes):
1. `SKILL.md` (1687 lines) — FIX step 1 landed in commit 8f04e35 (slice 1, step 16 block at lines 1114-1126 already teaches: immutable count, NEW-WAVE-N, "Spec, to-do, checklist, and ledger all render from the SAME table — the execution plan owns it, everything else cites it, never four drifting copies"). Anti-drift paragraph lines 1613-1620 already carries step 4's command-shape for cron/loop ticks. Watch-loop line 115 lacked the command-shape teaching — edited.
2. `references/anti-drift.md` (645 lines) — §9 "The cron-tick contract" (lines 567-594) already carries command-shape (`run /<saved-workflow-name>` + trailer, three rules). No edit needed.
3. `references/workflows.md` (668 lines) — §7 "The cron-tick contract" (lines 290-314) already carries command-shape + "One contract, stated in two places: this section and references/anti-drift.md §9." No edit needed.
4. `references/documents.md` (651 lines) — documents 2, 3, 6, 16 carried NO wave-table single-source wiring. Edited (owner + three renderers).
5. `references/capacity.md` (1558 lines) — the Capacity Ledger template's WAVE SIZE line carried no render-from-table rule. Edited.
6. `references/gauntlet.md` (1243 lines) — §14.4 "The cron tick contract" (lines 1197-1205) carried the contentless-heartbeat ban but NO explicit command-shape and NO locked-table-read rule. Edited.
7. `references/loops.md` (548 lines) — loop register + loop-file shape carried no command-shape and no wave-table render rule. Edited.

Consistency check: loops.md cites gauntlet.md §14.4 for the outer operating loop's tick (loops.md line 269-270 "the tick contract in references/gauntlet.md §14.4, which governs") — the §14.4 edit is therefore load-bearing for loops.md's existing citation, not a new dependency.

## 3. Changes made (FIX step 3 — one source render; FIX step 4 — command-shaped prompts)

Backups (all five files) at `holding/WF-4C-slice3-backup/` (SKILL.md, capacity.md, documents.md, gauntlet.md, loops.md), copied before any edit.

### documents.md (the four documents' contract — documents.md owns their shapes)
- Document 16 (owner): Shape now states the wave table is THE single source of the wave plan, written ONCE with an immutable count at step 16, never re-derived from memory (wave-lock rule, operator doctrine 2026-08-16).
- Document 16 "What makes it wrong": added "a wave count in any other document that disagrees with this file's table (the one-source-render rule: spec, to-do, checklist, and ledger all render from the wave table HERE — a second copy anywhere is drift)".
- Document 2 (checklist, renderer): Shape now says a wave-tracking box renders from the execution plan's wave table (document 16), cites it, never re-states its own copy; "What makes it wrong" adds "a wave-shaped box that disagrees with the execution plan's wave table".
- Document 3 (to-do, renderer): Shape now says wave-labeled items take their labels from the execution plan's wave table, renders from it, never keeps its own copy; "What makes it wrong" adds "a wave label that disagrees with the execution plan's wave table".
- Document 6 (ledger, renderer): Shape now carries "The ledger RENDERS the wave plan; it never owns a copy of it" — locked table lives in the execution plan, the ledger's WAVE lines cite it; new waves exist ONLY via a `NEW-WAVE-N` ledger line naming the dependency; any other new wave is a violation. "What makes it wrong" adds "a wave in the ledger that is not in the execution plan's locked table and carries no `NEW-WAVE-N` dependency line".

### capacity.md (the spec's named co-owner of the table)
- Capacity Ledger template WAVE SIZE line: added "The wave count <w> RENDERS FROM the execution plan's locked wave table (document 16) — the single source, immutable count (Issue 15 items 1 and 3). This ledger computes width FROM the table; it never re-states the wave plan as its own copy — a second copy drifts."

### gauntlet.md §14.4 (the tick contract the outer loop cites)
- Added "The scheduled prompt is COMMAND-SHAPED, never free-form (Issue 15 item 4, operator doctrine 2026-08-16)" — `run /<saved-workflow-name>` + at most the anti-drift trailer; never re-plans, never free-form-thinks, never relies on the `ultracode` keyword (≥ 2.1.210); cross-cites anti-drift.md §9 and workflows.md §7.
- Added "The wave plan is read from the locked table, never re-derived (Issue 15 items 1 and 3)" — the revolution reads the execution plan's wave table (document 16), never reconstructs the wave plan from memory, never renders a copy into ledger/checklist/to-do; all four render from the one table.

### loops.md (the loop scheduler's contract)
- Loop register section: added the every-row rule — trigger fires the loop's own SAVED WORKFLOW by command (`run /<saved-workflow-name>`), never free-form; wave-shaped loops read the wave table from the execution plan (document 16), never carry their own copy.
- Loop-file shape THE TICK: new precondition 0.5 — "THE SCHEDULER FIRES THIS TICK AS A COMMAND, never a free-form prompt: `run /<saved-workflow-name>` plus at most the anti-drift trailer… (Issue 15 item 4; references/anti-drift.md §9 and references/workflows.md §7 state the same contract). A wave-shaped loop reads the wave table from the execution plan (document 16) — the single source — and never re-derives or re-copies the wave plan."
- Loop-file shape "THIS LOOP NEVER": added two bans — "fires as a free-form prompt — its scheduled prompt is always `run /<saved-workflow-name>` (+ at most the anti-drift trailer) (Issue 15 item 4)" and "carries its own copy of the wave plan — a wave-shaped loop reads the execution plan's wave table, the single source (Issue 15 item 3)".
- Loop-file shape "What makes it right": added item 5 — the tick fires a saved workflow by command, never a free-form prompt; wave-shaped loops read the wave table from the execution plan, never carry a copy.

### SKILL.md (the flow's own enforcement surface)
- Watch-loop bullet (RULE 3, line 115): appended "Its cron prompt is COMMAND-SHAPED — `run /<saved-workflow>` — never free-form (Issue 15 item 4; a free-form tick re-plans from decayed memory, which is how runs drift)."

No other files touched. Scope: FIX steps 3-4 only (step 1 = commit 8f04e35, step 2 = NEW-WAVE-N growth path, step 5 = boss-cron check — both out of this slice; boss-cron lives in tools/ owned by WF-4E).

## 4. Verification

(a) Diff review: `git diff .claude/skills/spec-protocol/` shows the hunks named in section 3 and nothing else (SKILL.md +1/-1, capacity.md +4/-0, documents.md +30/-7, gauntlet.md +22/-0, loops.md +26/-0). Confirmed by full diff read (no stray edits).

(b) Render-surfaces enumerated (the four documents the QC bar names, plus the two named co-owners):
- Spec surface: SKILL.md step 16 block (slice 1, lines 1114-1126) — "Spec, to-do, checklist, and ledger all render from the SAME table — the execution plan owns it, everything else cites it, never four drifting copies"; now backed by documents.md doc 16's owner text + capacity.md's render-from rule.
- To-do surface: documents.md document 3 — renders from the execution plan's wave table, never its own copy.
- Checklist surface: documents.md document 2 — renders from the execution plan's wave table, never its own copy.
- Ledger surface: documents.md document 6 — renders, never owns; NEW-WAVE-N-only growth; boss-checkable wrongness added to "What makes it wrong".
- Owner: execution plan (document 16), documents.md doc 16 — written once, immutable count (matches spec line 322 and PART 2.1 line 517 "immutable count 6").
- Capacity Ledger co-owner: capacity.md WAVE SIZE line renders FROM the table.

(c) Command-shape contract now stated in five places, all consistent (verified by reading each):
- SKILL.md anti-drift paragraph lines 1613-1620 (pre-existing, matches spec's cited locus)
- SKILL.md RULE 3 watch-loop (edited)
- references/anti-drift.md §9 lines 567-594 (pre-existing)
- references/workflows.md §7 lines 290-314 (pre-existing, self-declares the two-place contract with anti-drift.md §9)
- references/gauntlet.md §14.4 (edited — the contract the outer loop's tick cites)
- references/loops.md register + loop-file shape (edited)
No surface teaches free-form ticks; no surface contradicts the `run /<saved-workflow-name>` shape.

(d) The `ultracode`-from-cron caveat consistent: present in anti-drift.md §9 rule 3 (line 590), workflows.md §7 (line 306), gauntlet.md §10 adapter (line 718-720), gauntlet.md §14.4 (new), SKILL.md anti-drift paragraph (line 1616). Not contradicted anywhere.

(e) Markdown fence integrity (loop-file shape block edited): the shape code fence now contains 10 THIS-LOOP-NEVER items; fence open/close counts verified by the diff (one ``` open, one ``` close, balanced).

## 5. Cross-slice boundary notes (read, not edited)

- FIX step 1 (lock at wave 1): commit 8f04e35 (slice 1) — SKILL.md step 16 block. Not edited by this slice.
- FIX step 2 (NEW-WAVE-N growth): taught in slice 1's block and now in documents.md doc 6 — not re-implemented here, only cited.
- FIX step 5 (boss-cron wave check): tools/boss-cron, owned by WF-4E. Not edited. Verified live (read-only): LOCKED_WAVES at lines 49-57 (waves 1-6), check_width line 182 ("dispatch for wave {wave} not in the locked table"), check_wave_lock for WAVE N+1 ordering.
- holding/WF-4C-slice1-evidence.md carries an uncommitted critic re-verification from slice 1's blind critic — not mine, not touched, not included in my commit.

## 6. QC bar mapping (Issue 15 QC, spec line 329)

Bar: "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."

- "All four documents render the same table": documents.md docs 2, 3, 6 now each state they render from document 16's wave table and never keep a copy; doc 16 states it is the single source written once; capacity.md renders FROM the table; gauntlet.md §14.4 and loops.md tell the tick/loop to read the table, never re-derive. No document carries a second copy of the wave plan — the one-source-render rule is now wired at every surface that mentions waves.
- "Wave count identical to the locked table": enforced by the ledger render rule (doc 6 wrongness: wave not in the locked table without NEW-WAVE-N = wrong) + boss-cron check (WF-4E, live, 0 violations on recent cycles per its log).
- Step 4 bar half (not the QC bar's named text but the issue's own FIX): every cron/loop prompt surface teaches `run /<saved-workflow>` command-shape.

Commit: one commit, message cites `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70).
