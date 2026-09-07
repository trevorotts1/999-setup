# CONTROL / LEDGER — Live State, Verdicts, Restart Truth

---

## 1. CURRENT STATE VIEW

No active campaign. All prior state-view rows (wave/epoch/width/run handles/SHAs) recorded
the removed app build and were cleared 2026-08-30 (eradication sweep).

---

## 2. LITERAL RESTART STEPS (cold resuming conductor — run in this order)

1. **Read this file** (`CONTROL/LEDGER.md`) — current state + verdicts + merge record (above).
2. **Read the execution plan** — `CONTROL/EXECUTION-PLAN.md` (waves forecast, parallelism plan, release strategy, visibility/anti-drift).
3. **Read machine truth** — `CONTROL/project_state.json`: holds the run/epoch/wave state with real handles.
4. **Re-fetch main per spec 0G freshness** — run `git fetch origin main` (or `git pull --ff-only` on main) in the repo checkout.
5. **Verify SHAs** — confirm the working tree HEAD matches the integration SHA recorded in section 1. If it differs, the newer SHA wins: update section 1, and note the delta in SESSION-LOG.
6. **Resume dispatch** — consult `CONTROL/TODO.md` and `CONTROL/CHECKLIST.md` for pending work; never re-dispatch a completed unit; per-slice launches only.
7. If the ledger was interrupted mid-write, re-verify pending builder handoffs and pending rechecks against TODO/CHECKLIST before dispatching anything.

---

Removed 2026-08-30 (eradication sweep): former sections 1b (truth-contradiction resolution),
2 (QC verdict block), old 3 (merge/release records), 5-14 (2026-08-26/27 repair-session records)
and the section-1 run-history table — all documented the removed app build.
