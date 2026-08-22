# CHECKPOINT — WS-08 (Candice app state machine)

Blind fresh QC: sonnet/max (QC-only; builder unknown to this pass).
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files (all under owned glob `apps/candice-companion/src/state/**`, manifest 9.2 WR-012)

- `src/state/machine.ts` — pure reducer: `CandiceState`, `CandiceEvent`,
  `CandiceSideEffect`, `createCandiceStateMachine()`, `INITIAL_STATE`,
  `CANDICE_ERRORS`, `isBusy`. Every state change driven by a real event;
  unlisted events ignored (spec 20). No clock, no random, no IO inside the
  reducer.
- `src/state/status.ts` — canonical status families: `CANDICE_STATUSES`
  (nine states: idle, listening, transcribing, confirming, thinking,
  speaking, compact, recovering, text-fallback) + `SKILL_PROGRESS_STATUSES`
  (building, quality-checking, fixing, waiting-for-user, complete — spec 16).
  Mirrors `packages/candice-protocol/schemas/status-event.schema.json`
  (WS-01 wire contract; schema wins on the wire on divergence).
- `src/state/event-sources.ts` — status event source registry
  (`mcp` / `terminal-fallback` / `local`) with `isStatusEventSource` guard.
- `src/state/index.ts` — single-file barrel; app imports `@candice/state`
  only, never deep imports.
- `src/state/machine.test.ts` — 27 tests, system Node test runner
  (`node --experimental-strip-types --test`), zero dependencies.
- `src/state/CHECKPOINT-WS08.md` — this file (created by blind QC; absent
  before this pass — no prior checkpoint to preserve).

## Evidence of verification (all run by this QC on this worktree)

1. Tests: `node --experimental-strip-types --test
   apps/candice-companion/src/state/machine.test.ts` → **27/27 PASS**,
   0 fail, 0 skip (Node v26.7.0).
2. Typecheck: `apps/candice-companion/node_modules/.bin/tsc --noEmit` →
   **exit 0**, zero diagnostics (strict mode).
3. Purity scan: `grep -nE "Date|Math\.|random|setTimeout|setInterval|fetch|Deno|Bun|process\.|fs\.|localStorage|sessionStorage|document\.|window\.|performance\.|console\." src/state/*.ts`
   → only hit is the doc comment in `machine.ts` ("no random, no IO inside
   the reducer"). No impure imports (fs/path/http/os) anywhere in the lane.
   Time-based transitions are caller-delivered events; the reducer never
   reads the clock.
4. Nine-state coverage: `machine.test.ts` "nine canonical states are all
   reachable" reaches all nine — idle, listening, transcribing, confirming,
   thinking, speaking, compact, recovering, text-fallback — each via a real
   event sequence. Suite additionally proves: no invented progress,
   recovering preserves the exact pending question (spec 20),
   duplicate/unknown events idempotent or ignored, error events never enter
   text-fallback/compact during interview, reducer replay determinism
   (same event list → identical states), `isBusy` gate (spec 13.3).

## Notes

- `git status`: the whole `src/state/` lane is untracked in this worktree —
  expected pre-merge state; checkpoint placed inside the owned glob per
  lane convention (WS-06/WS-07/WS-16 pattern).
- `CandiceStatus` type spans 14 values (9 canonical + 5 skill progress);
  the nine-state acceptance criterion refers to `CANDICE_STATUSES` only,
  which is what the coverage test exercises.
