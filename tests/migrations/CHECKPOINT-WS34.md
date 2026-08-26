# CHECKPOINT — WS-34 (version/preferences/schema migrations)

Builder: B-WR-018-WS-34 (opus/max) — W2 slice, workstream WS-34.
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files created (all inside the owned globs `apps/candice-companion/src/preferences/migrations/**` + `tests/migrations/**`)

Source (`apps/candice-companion/src/preferences/migrations/`):
| File | Purpose |
|---|---|
| `contract.ts` | Per-version field contracts + defaults + version constants + bump notes |
| `registry.ts` | Migration steps: `MIGRATIONS[1]` (v1→v2), `MIGRATIONS[2]` (v2→v3), named step functions |
| `migrate.ts` | `runMigrations` (bounded chain, per-step target validation, future-doc preservation), `parseDocVersion` |
| `normalize.ts` | `normalizeVersionedDoc` — per-version dirty-value repair |
| `store.ts` | `loadAndMigrateDoc` — load + migrate + atomic persist; future docs never rewritten, corrupt files never overwritten |
| `types.ts` | `VersionDoc`, `ProfileV3` document types |
| `index.ts` | Public surface |
| `README.md` | Lane doc: version story + how to bump |
| `schemas/preferences-v2.proposal.json` | v2 schema bump proposal (WR-010 applies) |
| `schemas/preferences-v3.proposal.json` | v3 schema bump proposal (WR-010 applies) |

Tests (`tests/migrations/`):
| File | Purpose |
|---|---|
| `migrations.test.ts` | 41 tests: chain shape/bounds, per-step pinned mappings, end-to-end real fixtures, protocol-doc handling, future-doc preservation, FAIL surfacing, store round-trips, isolation/non-goals |
| `fixtures/documents.ts` | v2/v3 fixtures + byte-exact expected outputs |
| `CHECKPOINT-WS34.md` | This file |

## Version chain

`parseDocVersion` resolves the on-disk version: integer runtime versions
(1..3) and protocol `"N.0"` const strings (WR-010 `preferences.schema.json`
writes `"1.0"`; `"N.0"` → integer N+1 because the protocol field names
already match the v2 contract). Missing/garbage → 1.

- v1 (WS-40 runtime) → v2: `lastAnswerMethod`→`lastUsedAnswerMethod`,
  `companionPosition{left,top}`→`companionScreenPosition{x,y,anchor=floating}`,
  `textScale`→`textSize` enum (multiplier: <1 small, =1 medium, >1 large).
- v2 → v3: `nameAskedAt` (string|null) → `nameAsked: {askedAt}` (object|null).

## Verification (primary source evidence)

```text
$ node --test tests/migrations/migrations.test.ts
ℹ tests 41
ℹ pass 41
ℹ fail 0

$ npx tsc --noEmit --allowImportingTsExtensions --module esnext \
    --moduleResolution bundler --target es2022 --strict \
    src/preferences/migrations/*.ts ../../tests/migrations/*.ts \
    ../../tests/migrations/fixtures/documents.ts
exit=0 (clean)

$ node --test tests/prefs/prefs.test.ts   # WS-40 sibling lane regression
ℹ tests 29
ℹ pass 29
ℹ fail 0
```

## Data-loss guarantees (each pinned by a test)

1. Real v1 fixtures (shared with the WS-40 lane) migrate to v3 with every
   value preserved; renamed fields land under their new names; mapped fields
   never remain under old names.
2. Dirty v1 docs (out-of-range values) are repaired at v1 (WS-40 runtime
   guarantee) and THEN migrated — the chain never fails a real store file.
3. Future documents (integer or protocol string) are preserved at their own
   version and never persisted: disk stays byte-identical (spec 20).
4. Only a MIGRATED document is written forward; current-version docs are
   returned and not rewritten.
5. A step whose output violates its target version contract is a FAIL with
   violations — never silently repaired.
6. The canonical protocol schema is untouched by this lane; proposals exist
   (`schemas/preferences-v*.proposal.json`), application is WR-010's
   (manifest 9.4 class 2).
7. The chain is pure: no `node:fs`/`node:path`/`Date` in migrate/registry/
   contract/normalize/types (store.ts is the only I/O boundary).

## Cross-lane findings recorded

- **CROSS-LANE-FINDING (to WR-010):** protocol `preferences.schema.json`
  declares `schemaVersion` as `const: "1.0"` (string) while the runtime store
  writes an integer `schemaVersion`. The chain handles both (`parseDocVersion`),
  but the two forms should be reconciled at contract level: recommended
  `const` form `"1.0"` → integer-1 equivalence note, or a single integer
  authority. Proposals attached: `schemas/preferences-v2.proposal.json`,
  `schemas/preferences-v3.proposal.json`.
- **CROSS-LANE-FINDING (to WS-40 lane / integration owner):** v2 requires the
  WR-010 schema `required` set to include the nullable fields with `"null"`
  values (current protocol schema requires `preferredName` etc. as non-null;
  the v2 chain emits nulls for "never chosen"). This is documented in the
  v2/v3 proposals.
