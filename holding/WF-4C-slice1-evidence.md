# WF-4C slice 1 evidence — Issue 15 FIX step 1: lock the wave plan in the ledger at wave 1

Issue: 15 (wave count drift). Slice: FIX step 1. Branch: fix/15-wave-lock.
Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70, commit dc688c7).

## 1. Spec read — Issue 15 FIX step 1

- `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` line 322: "1. Lock the wave plan in the ledger at wave 1: the wave table (PART 2 of this document for the fix execution; the execution plan's wave table for client builds) is written once with an immutable count."
- Line 317 (PROBLEM): "planned at 5 waves, found at 15 hours later."
- Line 319 (WHY): "The wave plan is not locked. Waves re-derive from decayed memory on free-form cron ticks instead of being read from a locked table."
- Line 323: "Growth only via dependency lines: a new wave exists ONLY when a documented dependency requires it, opened by a `NEW-WAVE-N` ledger line naming the dependency."
- Line 324: "One source render: spec, to-do, checklist, and ledger all render from the same wave table."
- Line 326: "Boss-cron check: waves found in the ledger that are not in the locked table and carry no `NEW-WAVE-N` dependency line = `VIOLATION-STOP`."
- PART 2 line 498: "THE WAVE PLAN IS LOCKED. Six waves. Additional waves ONLY if one wave depends on another being done first, opened via a documented `NEW-WAVE-N` ledger line naming the dependency."
- PART 2.1 line 517: "The wave table is written to the ledger at wave 1 with immutable count 6."

## 2. Verify A — the locked wave table exists in FIX-LEDGER.md

Source of truth: `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` (the canonical path named in PART 2.1 line 512; the working copy at `/Users/blackceomacmini/work-999-setup-fix/WF-4C/FIX-LEDGER.md` is the clone of it at the branch base).

- Line 10: `## LOCKED WAVE TABLE (PART 2 — immutable count 6)`
- Lines 12-19: table rows WAVE 1 through WAVE 6 (six waves), each naming Issues, Workflows, Dependencies:
  - WAVE 1 (line 14): Issues 1, 2 — WF-1A/1B — "None — verify-only, landed in 8fac6ce"
  - WAVE 2 (line 15): Issues 3, 4, 5, 11, 12 — WF-2A..2E — "Wave 1"
  - WAVE 3 (line 16): Issues 6, 7, 8, 9, 10 — WF-3A..3E — "Wave 2"
  - WAVE 4 (line 17): Issues 13, 14, 15, 17, 18 — WF-4A..4E — "Waves 1-3"
  - WAVE 5 (line 18): Issues 16, 19, batch merge — WF-5A/5B/5C — "Waves 1-4"
  - WAVE 6 (line 19): Issue 20 — WF-6A — "Wave 5"
- Line 21: "Additional waves only via a documented `NEW-WAVE-N` ledger line naming the dependency (PART 2)."
- Count: 6 rows = immutable count 6, matching spec PART 2 line 498 and PART 2.1 line 517.

Creation and immutability, proven by git:
- Commit `15a92d9` "add FIX-LEDGER.md: locked 6-wave table + baseline" created the ledger with the LOCKED WAVE TABLE (verified: `git show 15a92d9:FIX-LEDGER.md` shows lines 10-21 exactly as above).
- Commit `dc688c7` (the current HEAD of main and of fix/15-wave-lock) modified FIX-LEDGER.md (+74/-3) but the LOCKED WAVE TABLE is byte-identical in `git show dc688c7:FIX-LEDGER.md` — verified lines 10-21 unchanged. The table has never been rewritten since creation; waves 2-4 executions have only appended dispatch/result lines under their wave headings, never edited the table.
- Working-tree ledger is clean (no uncommitted diff), so the table on disk matches HEAD.

Live ledger cross-check (the file the boss cron actually reads):
- `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 17: WAVE 4 row; line 70: `WAVE 4 DISPATCH 2026-08-16T20:12Z` — the line this unit cites. Both files agree row-for-row.

## 3. Verify B — the skill teaches the wave table

Skill tree: `/Users/blackceomacmini/work-999-setup-fix/WF-4C/.claude/skills/spec-protocol/` (SKILL.md 1687 lines + 24 references).

Gap found (full-file searches, zero hits): no occurrence of `NEW-WAVE`, `wave table`, `locked wave`, `immutable` in SKILL.md or any references file — the skill taught wave DERIVATION (pipeline.md line 138-150, Laws 18-19; SKILL.md step 16 lines 1109-1113) but nothing about LOCKING the plan with an immutable count. That is the drift mechanism Issue 15 names: waves re-derived per tick from decayed memory.

Fix applied — SKILL.md step 16 (the execution-plan write), one insertion of 13 lines at line 1112, after the budget sentence and before step 16.2:

```
**LOCK THE WAVE TABLE (binding, operator doctrine 2026-08-16 — the wave-lock
rule):** the execution plan's wave table is written ONCE with an immutable
count and never re-derived from memory. The table names every wave, the
issues or units it carries, its workflows, and its dependencies; nothing
after it may add, remove, or renumber a wave. A new wave exists ONLY when a
documented dependency requires it, opened by a `NEW-WAVE-N` ledger line
naming which wave's output it consumes; any other new wave is a violation.
Spec, to-do, checklist, and ledger all render from the SAME table — the
execution plan owns it, everything else cites it, never four drifting copies
(the wave-count-drift defect this kills: a plan written at 5 waves found at
15 hours later). The wave table is written into the ledger at wave 1; the
boss-cron wave check stops any wave in the ledger that is not in the locked
table without its `NEW-WAVE-N` line.
```

The teaching covers FIX step 1 (written once, immutable count), step 2 (NEW-WAVE-N only via dependency line), step 3 (one source render — spec/to-do/checklist/ledger from the same table), and step 5 (boss-cron wave check) — the client-build half of the FIX, exactly as spec line 322's parenthetical directs ("the execution plan's wave table for client builds").

Placement rationale: step 16 is the canonical execution-plan write (SKILL.md line 1109); the wave table IS the execution plan's wave section, and step 12.7's Parallelism Plan and the 12.7-16 gate chain (no plan, no dispatch) are where the lock is enforced.

Scope discipline: only SKILL.md step 16 edited. No other file touched. Backup: `holding/SKILL.md.bak-pre-wave-lock-slice1` (sha256 5f465247a3ff023492cdfe57e092ff87167222cc4464b7f433f6624a47dc01d4, byte-identical to HEAD before the edit).

## 4. Verification after the edit

- `git diff --stat`: 1 file changed (SKILL.md), +13/-0 — pure addition, zero removals.
- Backup sha256 equals pre-edit working copy sha256 (both 5f465247…).
- Wave-lock terms now present in the skill: `NEW-WAVE` (3 occurrences in the new block), `wave table` (2), `immutable` (1), all inside step 16.
- FIX-LEDGER.md untouched by this unit (git diff shows no ledger change).

## 5. QC bar mapping (Issue 15 QC, spec line 329)

Bar: "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."
- Locked table exists and is immutable: verified, 6 rows, never rewritten since 15a92d9 (section 2).
- NEW-WAVE-N as the only growth path: taught in the skill's step 16 block (section 3).
- One source render: taught (spec/to-do/checklist/ledger from the same table) — the table's OWNER is the execution plan, matching spec line 324.
- Boss-cron wave check: taught (the block names the boss-cron wave check and VIOLATION-STOP semantics per spec line 326).
