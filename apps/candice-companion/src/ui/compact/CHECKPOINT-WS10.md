# CHECKPOINT — WS-10 (compact progress-companion mode)

Builder: B-WR-012-WS-10 (opus/max).
Worktree: `worktrees/wr001-bootstrap` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files created (all under owned glob `apps/candice-companion/src/ui/compact/**`, manifest 9.2 WR-012)

Source:
- `src/ui/compact/config.ts` — canonical declarations: `COMPACT_CONTRACT_VERSION = 1`,
  root class `candice-compact`, expanded class `candice-compact-expanded`,
  `COMPACT_REDUCED_MOTION_CLASS` (consumes WS-14's class, never defines it),
  `COMPACT_VISUAL_MODES = ['bubble','surface']`, `COMPACT_EXPAND_MS = 180`
  (one-shot only, spec 19), stage-slot id `candice-compact-stage-slot`
  (WR-013 binds final art; this lane never names/loads artwork),
  `COMPACT_STATUS_ATTR`.
- `src/ui/compact/status.ts` — `compactStatusView()`: pure map of a REAL WS-08
  status to `{family, label, busy, offline}`. Spec 16 vocabulary: Building,
  Quality checking, Fixing, Waiting for you, Complete, Recovering. No percentage
  anywhere — progress counts could only come from real `detail` fields.
- `src/ui/compact/queue.ts` — `CompactSubmitQueue` (single-flight FIFO;
  enqueue/peek/drain/pending/clear; never submits by itself) + 
  `submissionMustWait()` (spec 13.3 busy gate) + canonical `BUSY_HINT_TEXT`
  ("Claude is working. I will send that as soon as it is ready.").
- `src/ui/compact/view.ts` — DOM surface: stage slot, status line, interaction
  surface (hold-to-talk, typed input, send, mute toggle, Return to Claude,
  pending list), offline hint; `COMPACT_STYLE_TEXT` (CSS-variable references
  only; transparent reset is the only background declaration; one-shot
  transition guarded by reduced motion; no keyframes/animation);
  `createCompactView(mount, handlers, doc?)` (document injected — mirror of the
  WS-07 window injection; no-op view on null mount/doc, spec 20);
  `mountCompactStyle()` idempotent; all user text via `textContent` (no
  innerHTML of untrusted input).
- `src/ui/compact/controller.ts` — `createCompactController({machine, mount,
  transport, doc?})`: wires the real WS-08 machine; `handle(event)` feeds the
  machine then renders the RESULT; `onSubmit` queues user input and drains
  FIFO at safe input points (`flushIfSafe`); busy hint shown only when a
  status is busy AND entries wait; never submits on render alone (no hidden
  prompts, spec 13.3); never owns session identity, never injects into a
  terminal itself (transport is the WS-03/WS-05 adapter's surface).
- `src/ui/compact/index.ts` — single-file barrel (all consumers import here).

Tests + docs:
- `src/ui/compact/__tests__/compact.test.ts` — 16 tests, system Node test
  runner (`node --test`), zero dependencies.
- `src/ui/compact/CONTRACT.md` — stable surface for consuming lanes.
- `src/ui/compact/CHECKPOINT-WS10.md` — this file.

## Evidence of verification (all run on this worktree)

1. Tests: `node --test apps/candice-companion/src/ui/compact/__tests__/compact.test.ts`
   → **16/16 PASS**, 0 fail (Node v26.7.0). Regression: the same command
   together with the existing WS-08/WS-07/WS-13/WS-12 suites → **97/97 PASS**.
2. Typecheck: `apps/candice-companion/node_modules/.bin/tsc --noEmit` →
   zero diagnostics under `src/ui/compact/**`. (Pre-existing errors reported by
   the full-app check live only in concurrently-built lanes
   `src/preferences/migrations/**` (WS-34) and `src/ui/ptt/**` (WS-09) — not
   this lane's globs; tsc counts 0 compact errors.)
3. Build: `vite build` → `✓ built in 76ms`, dist emitted under
   `src-tauri/dist/` per the shared config.
4. Purity scan: `grep -nE "Date|Math\.|random|setTimeout|setInterval|fetch|Deno|Bun|process\.|fs\.|localStorage|sessionStorage|performance\.|console\." src/ui/compact/*.ts`
   → zero hits in source modules (clock-free; the queue uses caller-supplied
   counters for ordering, never wall time).
5. Ownership scan: every new path is under `apps/candice-companion/src/ui/compact/**`
   (manifest 9.2 WR-012 WS-10 glob). No shared-file edits (9.3/9.4 untouched),
   no CONTROL/SPEC edits, no absolute developer paths, no source-PNG writes.
6. Style contract test: no hex/rgba/url/background (except the explicit
   `background: transparent` resets), no `@keyframes`, no `animation`.

## Notes

- The lane renders WS-08 machine RESULTS only; the machine remains the source
  of truth (spec 16: no invented progress). The controller never calls the
  transport from render — held entries stay visible until a real safe-point
  transition or a fresh submit drains them (spec 13.3).
- The compact view is decoration-only: session identity, PTT audio capture,
  and terminal-input injection belong to WS-03/WS-05/WS-17 lanes; this lane
  exposes the surfaces those lanes consume (busy hint, pending list, submit
  transport).
- Reduced-motion class consumed from WS-14 (`candice-reduced-motion`), never
  defined here (spec 9).

## QC-010 section (blind sonnet/max verdict, wf_c3b3ed8b-978 seat, 2026-08-21)

Builder-claimed evidence re-run independently: suite 16/16 PASS (pre-fix),
full sibling regression 183/183 PASS, vite build 74ms OK, purity scan zero
hits, ownership inside `apps/candice-companion/src/ui/compact/**` only,
typecheck 0 errors under this lane's globs.

**Defects found and fixed (backup: `.qc-backup-ws10-20260821/` inside this
directory):**

1. F1 — `BUSY_HINT_TEXT` did not match spec 13.3 verbatim. The spec string
   uses typographic apostrophes (U+2019: "I'll" as `I’ll`); the lane
   shipped ASCII apostrophes. Fixed in `queue.ts` to the exact spec bytes;
   test tightened to the U+2019 string.
2. F2 — Null transport dropped user input at safe points. When the
   WS-03/WS-05 adapter is absent (spec 20 degraded path), `flushIfSafe()`
   drained the queue and discarded every entry the user had typed — silent
   loss, contrary to spec 13.3 "show the user what will be submitted".
   Fixed: `flushIfSafe()` returns early when `transport === null`, so held
   entries stay visible until a real adapter exists. Test added: entries
   survive a safe-point transition with no transport.
3. F3 — Spoken compact questions were never queued. E.1 WS-10 requires
   "accepts voice and typed questions" after the interview, but the only
   queue producers were typed submits; a transcript arriving post-interview
   went nowhere (and `answer:confirmed` is interview-phase-only in WS-08,
   so a compact confirm path never fires). Fixed: `handle()` queues the
   machine's `speech:transcript` result when phase is `post-interview`
   (`inputMode: 'voice'`), visible in the pending list, drained FIFO at the
   safe input point. Test added: ptt -> transcript -> queued -> submitted
   at safe point.

**Post-fix re-run:** compact suite **18/18 PASS**; full sibling regression
**185/185 PASS**; typecheck 0 errors under `src/ui/compact/**` (the 7
errors the project-wide check reports live in the concurrently-built
`src/preferences/migrations/**` lane (WS-34), not this lane's globs).

**Cross-lane finding (recorded, not fixed here — WS-08 owns it):** the
state machine's `answer:confirmed` transition returns null outside the
`interview` phase, so post-interview voice confirmation cannot occur. This
lane routes around it (F3), but WS-09/WS-08 should decide whether compact
confirmation is in-scope before integration.

**Status: PASS with FRESH RECHECK REQUIRED** — this QC seat fixed local
defects; per the QC lifecycle a different independent sonnet/max QC agent
must recheck before any E.1 WS-10 box flip.
