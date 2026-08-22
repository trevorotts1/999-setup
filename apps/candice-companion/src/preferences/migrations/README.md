# Candice preferences migrations (WS-34)

Versioned JSON preferences schema + migration path for the local preference
profile (Master Spec section 9; CHECKLIST E.1 WS-34: "preferences use a
versioned JSON schema with migration tests; schema bumps migrate without data
loss").

## What this lane ships

- `contract.ts` — per-version field contracts (`FIELD_RULES`), defaults
  (`FIELD_DEFAULTS`), version constants (`MIN_SCHEMA_VERSION`,
  `CURRENT_SCHEMA_VERSION` = 3), bump notes (`VERSION_NOTES`).
- `registry.ts` — the migration steps: `MIGRATIONS[1]` (v1→v2) and
  `MIGRATIONS[2]` (v2→v3) plus the named step functions
  (`migrateV1toV2`, `migrateV2toV3`, `textScaleToTextSize`).
- `migrate.ts` — `runMigrations` (bounded chain, per-step target-version
  validation, future-version preservation) and `parseDocVersion` (integer
  runtime version vs protocol `"N.0"` string version).
- `normalize.ts` — `normalizeVersionedDoc`: repairs dirty values at the
  version they live at (wrong type → default/null, bad enum → null, out of
  range → default, unknown field → dropped, absent nullable → null).
- `store.ts` — `loadAndMigrateDoc`: load + migrate + persist atomically;
  future docs are never rewritten; corrupt files are never overwritten.
- `schemas/preferences-v2.proposal.json`,
  `schemas/preferences-v3.proposal.json` — schema bump proposals against the
  WR-010-owned `packages/candice-protocol/schemas/preferences.schema.json`.
  **This lane never edits the canonical protocol schema** (manifest 9.2
  WR-018: "schema version additions are proposals against WR-010-owned
  packages/candice-protocol/schemas/**").

## Version story

| Version | What changed |
|---|---|
| 1 | WS-40 runtime baseline. Integer `schemaVersion`; fields: `preferredName`, `voiceOutputEnabled`, `volume`, `speechRate`, `lastAnswerMethod`, `textScale`, `reducedMotion`, `companionPosition {left,top}`, `lastUsedSkill`, `nameAskedAt`. |
| 2 | Field alignment to the WR-010 protocol contract names: `lastUsedAnswerMethod`, `textSize` (enum, from `textScale` multiplier), `companionScreenPosition {x,y,anchor}` (from `{left,top}`; no anchor was stored, so `floating`). |
| 3 | `nameAskedAt` string becomes `nameAsked: { askedAt }` object (future-proof ask/rename state). |

## How a bump is made

1. Bump `CURRENT_SCHEMA_VERSION`, add the vN contract to `FIELD_RULES` +
   `FIELD_DEFAULTS` in `contract.ts`, add a `VERSION_NOTES` entry.
2. Add `MIGRATIONS[vN]` in `registry.ts` (pure, returns exactly vN+1,
   lossless on the fields it owns).
3. Add fixtures + tests (`tests/migrations/`): the vN fixture, the expected
   vN+1 output, and a pinned per-field assertion per rename.
4. File the protocol schema bump as a CROSS-LANE-FINDING to WR-010 (the
   shipped `schemas/preferences-v*.proposal.json` is the proposal; the
   integration/release owner applies it — manifest 9.4 class 2).

## Run

```bash
node --test tests/migrations/migrations.test.ts
```

Node ≥ 22.6 (26 strips types natively); zero external test dependencies.
