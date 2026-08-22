# WS-09 CHECKPOINT — floating answer controls + PTT UI

Builder: WS-WS-09 (opus/max), slice WR-014 (L2: needs WS-01, WS-08, WS-17),
worktree `wr001-bootstrap` (no commit per lane instruction; units staged in
the worktree only).

## Ownership (PROJECT-MANIFEST 9.2, WR-012/WS-09 glob)

- `apps/candice-companion/src/ui/answer-controls/**` (all files created by
  this lane)
- `apps/candice-companion/src/ui/ptt/**` (all files created by this lane)

No shared/root file touched. No commits made.

## Acceptance criterion (CHECKLIST E.1 WS-09)

> PASS: every question offers both HOLD TO TALK and TYPE ANSWER; listening
> state is unmistakable (glow/pulse + "LISTENING — LET GO WHEN FINISHED");
> release shows transcript with USE ANSWER / EDIT / TRY AGAIN.

## Files created (inside the owned globs)

### `src/ui/answer-controls/`

| File | Role |
|---|---|
| `config.ts` | canonical declarations: exact spec-5.1/5.2/6 labels (`ANSWER_CONTROLS_LABELS`), `AnswerMethod`, contract version, reduced-motion class consumption |
| `model.ts` | pure presentation model from the REAL WS-08 machine state + preferences; no clock/IO/DOM; unknown statuses degrade |
| `view.ts` | DOM surface: PTT slot + TYPE ANSWER + Answer-in-Claude + voice toggle + transcript confirmation row; style text variable-only, no baked background |
| `controller.ts` | wires machine events -> model render; PTT intent -> machine `ptt:start`/`ptt:stop`; USE ANSWER -> `answer:confirmed` exactly once; delegate -> `answer:delegate-to-claude`; EDIT/TRY AGAIN -> transports |
| `index.ts` | public surface |
| `CONTRACT.md` | lane contract |
| `CHECKPOINT-WS09.md` | this file |
| `__tests__/answer-controls.test.ts` | 15 tests |

### `src/ui/ptt/`

| File | Role |
|---|---|
| `config.ts` | exact spec-6 labels (`PTT_LABELS`), glow/wave classes, pulse duration, reduced-motion class consumption |
| `status.ts` | pure `CandiceStatus` -> PTT presentation; `isPttLiveStatus`/`isPttBusy` |
| `view.ts` | PTT control DOM: hold semantics (pointerdown/up/cancel/leave/blur, keyboard hold, single-flight, repeat filtered), unmistakable listening class + glow + waveform; no-op view on null mount |
| `index.ts` | public surface |
| `CONTRACT.md` | lane contract |
| `__tests__/ptt.test.ts` | 19 tests |

## Verification (independent, on this worktree)

- `node --test apps/candice-companion/src/ui/ptt/__tests__/ptt.test.ts` —
  19 passed, 0 failed.
- `node --test apps/candice-companion/src/ui/answer-controls/__tests__/answer-controls.test.ts`
  — 15 passed, 0 failed.
- Regression: `node --test` on all four suites (machine, window, ptt,
  answer-controls) — 78 passed, 0 failed.
- `tsc --noEmit` (app tsconfig): OWNED files clean. Remaining errors are
  pre-existing in `src/preferences/migrations/**` (WR-018/WS-34 lane glob,
  untouched here) — see CROSS-LANE-FINDING below.
- Node v26.7.0 (>= 22.6 required), zero deps.

## CROSS-LANE-FINDING (recorded, not edited)

- **Location:** `apps/candice-companion/src/preferences/migrations/` (WS-34
  / WR-018 owned glob).
- **Finding:** `contract.ts` line 68 — `FieldRule.types` typed
  `Readonly<Record<string, FieldRule>>` mismatch: `string[]` not assignable
  to the literal union; `migrate.ts` lines 24/29/58 — `FieldRule` import
  missing, `./registry` module missing, implicit `any` parameter. 5 tsc
  errors total.
- **Evidence:** `./node_modules/.bin/tsc --noEmit` in
  `apps/candice-companion` lists exactly those 5 errors; the WS-09 files
  contribute zero errors.
- **Severity:** medium (typecheck of the app target fails, but the errors
  predate this lane and the files were staged by the WS-34 lane; the app
  build currently fails on them).
- **Recommended action:** WR-018 lane fixes the `FieldRule` type and the
  missing `./registry` module under its own glob.

## FRESH RECHECK REQUIRED

Separate QC lane must blind-review the unit per the QC lifecycle (box-flip
rule 0J: E.1 WS-09 box stays unchecked until an independent QC verdict
passes).

## QC ROUND 1 — 2026-08-21 (blind QC, sonnet/max) — FAIL -> FIXED

Verdict: FAIL. Three integration defects found inside the owned globs
(the lane's 15+19 tests were green but proved only pieces, never the
integrated surface):

1. **Integrated listening state never activated.** The controller created
   the PTT view and attached it, but `render()` never fed it a status.
   The real surface could never show the spec-6 unmistakable listening
   state (glow/pulse + `🔴 LISTENING — LET GO WHEN FINISHED`) even though
   the machine reached `listening`. Fixed: `render()` now calls
   `pttView.show(state.status)` from the same reducer read the rest of
   the surface uses.
2. **Confirm row stayed actionable after USE ANSWER.** Visibility was
   keyed on transcript-only; the machine retains the transcript as the
   record after `answer:confirmed` (status `thinking`), so USE ANSWER
   could re-fire the confirm = double-count (spec 5.1/6). Fixed: model
   gains `showConfirmRow` + `canConfirm` (status-gated); view renders
   and guards on them; `use.disabled` render-gated.
3. **Voice toggle was a silent no-op.** The button was created once with
   `Voice: ON` and never re-rendered; the change was reported to no
   transport. Fixed: `setModel` re-renders text/`data-voice-on`/aria
   from the model; new `onVoiceToggleChange` transport reports the
   change (WS-40 owns persistence).

Regression tests added (answer-controls 15 -> 17, ptt 19 -> 20; full
four-suite run 78 -> 81, all green). `tsc --noEmit`: zero errors in
owned files (the 6 pre-existing `src/preferences/migrations/**` errors
are WS-34's, unchanged). Pre-fix reconstruction backups:
`.qc-backup-ws09-20260821/` (worktree root). No commits made.

Per box-flip rule 0J the fixer was the failing QC — FRESH independent
recheck by a different sonnet/max seat required before the E.1 WS-09
box flips.
