# WS-09 floating answer controls (ui/answer-controls)

The in-interview question surface: both answer methods (PTT + typed),
Answer-in-Claude instead, the persistent voice toggle, and the spec-6
transcript confirmation. See `CONTRACT.md` for the proven contract and
`CHECKPOINT-WS09.md` for the builder checkpoint.

## Surface

- `config.ts` — canonical declarations + exact spec-5.1/5.2/6 labels.
- `model.ts` — pure presentation model from the real WS-08 machine state.
- `view.ts` — DOM surface (methods row, footer, confirm row).
- `controller.ts` — machine-event wiring; one controller per session.
- `index.ts` — public exports.
- `__tests__/answer-controls.test.ts` — 15 acceptance tests.

## Run

```bash
node --test apps/candice-companion/src/ui/answer-controls/__tests__/answer-controls.test.ts
```

## Dependency contract

Imports the REAL WS-08 machine (`src/state/machine.ts`) — never a fake —
and consumes the WS-01 status list via `src/state/status.ts`. PTT control
lives in the sibling `../ptt` (same WS-09 lane).
