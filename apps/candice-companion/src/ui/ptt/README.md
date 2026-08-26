# WS-09 PTT control (ui/ptt)

The floating push-to-talk control. See `CONTRACT.md` for the proven
contract and `CHECKPOINT-WS09.md` in the sibling
`src/ui/answer-controls/` for the builder checkpoint.

## Surface

- `config.ts` — exact spec-6 labels, glow/wave classes, reduced-motion
  class consumed from WS-14.
- `status.ts` — pure `CandiceStatus` -> presentation mapping.
- `view.ts` — DOM control: hold semantics, unmistakable listening glow,
  no-op degrade (spec 20).
- `index.ts` — public exports.
- `__tests__/ptt.test.ts` — 19 acceptance tests.

## Run

```bash
node --test apps/candice-companion/src/ui/ptt/__tests__/ptt.test.ts
```
