# CHECKPOINT — WS-40 (user name / preferences / local profile)

Builder: B-WR-010-WS-40 (opus/max) — first Candice production fan-out.
Worktree: `worktrees/wr001-bootstrap` @ `aa23ed9` (branch `candice/wr001-bootstrap`).
Date: 2026-08-21.

## Files created (all under owned glob `apps/candice-companion/src/prefs/**` + its test dir)

Source:
- `apps/candice-companion/src/prefs/schema.ts` — typed profile contract, field
  names, defaults, MIGRATIONS registry (version 1, empty), LATEST_SCHEMA_VERSION
  (version 1), spec-9 recommended path constants.
- `apps/candice-companion/src/prefs/profile.ts` — migration runner
  (`migrateProfile`, bounded), shape normalization (`normalizeProfile`),
  platform path resolution (`prefsDirPath`, `CANDICE_PREFS_DIR` override,
  macOS `~/Library/Application Support/BlackCEO/999/Candice/`, Windows
  `%LOCALAPPDATA%\BlackCEO\999\Candice\` via LOCALAPPDATA/USERPROFILE — no
  hardcoded `C:\Users\...`), `defaultProfile`.
- `apps/candice-companion/src/prefs/store.ts` — `loadProfile` / `saveProfile`
  (atomic write-temp-then-rename, per-process lock with bounded wait and
  stale-lock break, 0o600 mode, corruption backup to
  `profile.json.corrupt-<pid>`, non-directory path detection), `mergeProfile`.
- `apps/candice-companion/src/prefs/name.ts` — first-run name flow:
  `needsNameAsk` (at most once per local user), `markNameAsked`,
  `setPreferredName` / `changePreferredName` (changeable later), `normalizeName`
  (trim + collapse whitespace + 60-char cap), `isUsableName`,
  `welcomeBackPhrase` ("Welcome back, <name>"). No OS-username read exists in
  the lane.
- `apps/candice-companion/src/prefs/index.ts` — public surface.

Tests + docs:
- `apps/candice-companion/tests/prefs/prefs.test.ts` — 28 tests: persistence,
  atomicity, 0o600, corruption recovery, spec-20 degradation (never throws),
  name-once / persist / change-later / greeting / never-inferred-from-OS-username
  (source-level scan), WS-34 migration criteria + v1 fixtures, future-version
  preservation (loaded untouched at its own version; older-lane save refused,
  disk byte-identical), spec-5.2 voice toggle independence (all 4
  combinations), spec-9 content isolation (stored document keys are exactly the
  known preference fields), spec-9 platform paths.
- `apps/candice-companion/tests/prefs/fixtures/profiles.ts` — v1 fixtures
  (full / partial / dirty) preserved for the WS-34 v2 migration test.
- `apps/candice-companion/tests/prefs/prefs.contract.md` — stable API contract
  for other lanes.
- `apps/candice-companion/tests/prefs/README.md` — how to run.

## Verification (primary-source evidence)

```text
$ node --test tests/prefs/prefs.test.ts
exit=0  tests 28  pass 28  fail 0

$ npx tsc --noEmit --allowImportingTsExtensions --module nodenext \
    --moduleResolution nodenext --target es2022 --strict \
    src/prefs/*.ts tests/prefs/prefs.test.ts tests/prefs/fixtures/profiles.ts
exit=0 (clean)
```

Runner is plain Node 26 (type-stripping native, node:test); no external test
dependency, so the suite runs in any CI container without the app toolchain.
On Node <22.6 run with `--experimental-strip-types`.

## QC-FIX ROUND 1 (fresh QC gate 2026-08-21) — FRESH RECHECK REQUIRED

QC found one real defect and fixed it; per the box-flip rule (0J) a fresh
independent recheck must run before the WS-40 E.1 box may flip.

**Defect (data loss, severity medium):** `migrateProfile` returned any stored
document whose `schemaVersion` was above the latest known (1) as
`normalizeProfile(doc)` output — which hard-coded `schemaVersion: 1` and
dropped every unknown field. A v2 document written by a future lane (e.g.
WR-018/WS-34) loaded by this lane was silently downgraded to v1 in memory, and
a subsequent `saveProfile` persisted the downgraded copy, destroying v2-only
fields. Reproduced empirically before the fix
(`migrateProfile({schemaVersion:99,...})` → `schemaVersion:1`, `newV2Field`
gone; round-trip overwrite confirmed).

**Fix applied (6 files, QC round 1):**
- `src/prefs/schema.ts` — added `LATEST_SCHEMA_VERSION = 1` export; documented
  newer-version preservation semantics on `CandiceProfile.schemaVersion`.
- `src/prefs/profile.ts` — `migrateProfile` now returns future-version
  documents untouched at their own version (migrated=false); `normalizeProfile`
  only stamps versions within `1..LATEST_SCHEMA_VERSION`; missing/non-integer
  versions normalize to 1.
- `src/prefs/store.ts` — `saveProfile` returns false (refuses) when
  `profile.schemaVersion > LATEST_SCHEMA_VERSION`; the on-disk document stays
  byte-identical.
- `src/prefs/index.ts` — re-exports `LATEST_SCHEMA_VERSION`.
- `tests/prefs/prefs.test.ts` — future-version test extended (own version +
  unknown fields survive); new test proves save refusal leaves disk
  byte-identical. 28 tests now.
- `tests/prefs/prefs.contract.md`, `tests/prefs/README.md`, this checkpoint —
  updated to the new semantics.

**Backups:** `/tmp/qc-schema.bak`, `/tmp/qc-profile.bak`, `/tmp/qc-store.bak`,
`/tmp/qc-test.bak`, `/tmp/qc-readme.bak`, `/tmp/qc-checkpoint.bak`,
`/tmp/qc-contract.bak` (all 7 pre-fix originals).

**Post-fix verification (this QC run):** `node --test tests/prefs/prefs.test.ts`
= 28/28 pass; `npx tsx --test` = 28/28 pass; `npx tsc --noEmit` (app tsconfig)
= exit 0; strict standalone `tsc` per the checkpoint command = exit 0; direct
node probe: v99 doc loads at schemaVersion 99 with unknown fields intact,
saveProfile returns false, disk byte-identical; v1 save round-trip unaffected.

**Also found (WARN, not fixed here — conductor decision):** two authority docs
(`spec/PROJECT-MANIFEST.md` 9.2 row WR-018 and
`CONTROL/task-graph-snapshot.json` WS-40 `owned_paths`) name the WS-40 glob as
`apps/candice-companion/src/profile/**`, but the conductor dispatched this unit
as `apps/candice-companion/src/prefs/**` and this lane's own README/checkpoint
mis-cite manifest 9.2 as saying `src/prefs/**`. The lane built the dispatched
glob. The snapshot/manifest glob name vs the built directory name need a
conductor ruling; no WS-40 file overlaps another lane's dispatched glob either
way (verified against CONTROL/ dispatch records and the worktree tree).

## Acceptance mapping

- CHECKLIST E.1 WS-40 (name asked at most once, never inferred from OS
  username, stored in local profile, changeable later, used naturally) — proven
  by tests above.
- E.2 first-run name ask once + spec 9 fields — proven.
- WS-34 migration gate (versioned schema + migration tests) — registry +
  fixtures + tests included (schema field changes remain proposals to WR-010).
- Spec 20 (Candice failure never blocks; degrade to defaults) — proven.

## CROSS-LANE-FINDING (proposal, NOT applied)

```text
CROSS-LANE-FINDING
source workflow/lane: WR-010 WS-40 (prefs)
affected unit: WR-010 WS-01 (packages/candice-protocol/schemas/preferences.schema.json)
evidence: WS-40 runtime reads/writes exactly the fields listed in
  src/prefs/schema.ts PREFS_FIELD_NAMES (schemaVersion, preferredName,
  voiceOutputEnabled, volume, speechRate, lastAnswerMethod, textScale,
  reducedMotion, companionPosition, lastUsedSkill, nameAskedAt). The schema
  lane has not yet produced preferences.schema.json (no packages/ tree exists
  at this checkpoint), so no formal validation import is possible yet.
severity: low (alignment, not a defect)
recommended action: WR-010 WS-01 should define preferences.schema.json with
  these exact property names + a single integer schemaVersion, so the WR-018
  prefs lane can import it and validate before writing. If WR-010's schema
  names differ, file the delta back here as a CROSS-LANE-FINDING and patch
  normalizeProfile only (never edit the schema file).
```

## Notes for the conductor

- No commit made (per builder instructions). Branch `candice/wr001-bootstrap`
  remains at `aa23ed9`; all files are working-tree additions under
  `apps/candice-companion/`.
- No root release files, CONTROL/ carriers, CHANGELOG.md, README.md, VERSION,
  tags, or .github/ touched.
- `apps/candice-companion` contains only `src/state/machine.ts` (pre-existing,
  WS-08) + this lane; no package.json exists yet — the suite is dependency-free
  by design so it runs standalone. The app root package.json is a 9.3
  within-run shared file; this lane did not create it.

## WS-34 v3 UNIFICATION (FIX-014 appui lane, 2026-08-22)

The prefs lane now CONSUMES the WS-34 versioned-schema authority
(`src/preferences/migrations/`) instead of owning a v1 schema:

- `src/prefs/schema.ts` — `CandiceProfile` = WS-34 `ProfileV3`;
  `LATEST_SCHEMA_VERSION` = `CURRENT_SCHEMA_VERSION` (3); v3 field names
  (`lastUsedAnswerMethod`, `textSize`, `companionScreenPosition` {x,y,anchor},
  `nameAsked` {askedAt}); `PROFILE_DEFAULTS.reducedMotion = null` (follow the
  OS — I-10 fix); own MIGRATIONS registry removed.
- `src/prefs/profile.ts` — `migrateProfile` delegates to WS-34
  `runMigrations` (integer versions as-is, protocol string "N.0" -> N+1,
  garbage -> 1, future preserved untouched); `normalizeProfile` delegates to
  `normalizeVersionedDoc` at CURRENT; `mergeProfile` MOVED here from
  `store.ts` (browser-safe: no `node:fs` in the webview bundle);
  `defaultProfile` returns v3 defaults.
- `src/prefs/store.ts` — unchanged persistence semantics (atomic
  write-then-rename, 0o600, stale-lock tolerance, corruption backup,
  future-version save refusal); `mergeProfile` removed (now in `profile.ts`).
- `src/prefs/name.ts` — `nameAsked: { askedAt }` object shape; cleared name
  stores null; imports `mergeProfile` from `profile.ts` (never `store.ts`).
- `src/prefs/index.ts` — exports `mergeProfile` from `profile.ts`; own
  MIGRATIONS export removed.

Tests: `tests/prefs/prefs.test.ts` rewritten to v3 expectations (32 tests,
was 29): v1 fixtures migrate through the real WS-34 chain with zero data loss
(rename + enum mapping + nameAsked structure pinned), on-disk v1 document
loads at v3, dirty-v3 normalization, future-version (v99) preservation and
save-refusal regressions kept. Fixtures stay legacy v1 (shared with the WS-34
migration suite).

Verification (2026-08-22, worktree 999-setup-audit-wt-appui @ 09a7b90):

```text
$ node --test tests/prefs/prefs.test.ts
exit=0  tests 32  pass 32  fail 0

$ node --test tests/migrations/migrations.test.ts   (repo root)
exit=0  tests 41  pass 41  fail 0

$ npx tsc --noEmit   (apps/candice-companion)
exit=0
```
