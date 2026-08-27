# WS-40 contract — preferences module API

Stable surface other lanes may consume. Changes to these signatures are
breaking changes; propose them via CROSS-LANE-FINDING to the WR-018/WS-40
owner before shipping a replacement.

## Module: `src/prefs/index.ts`

### Types

- `CandiceProfile` — one document per local OS user; the WS-34 v3 contract
  (`ProfileV3`). Fields: `schemaVersion` (integer, current = 3),
  `preferredName` (string | null), `voiceOutputEnabled` (boolean),
  `volume` (0..1), `speechRate` (0.5..2), `lastUsedAnswerMethod`
  (`'voice' | 'typed' | 'terminal' | null`), `textSize`
  (`'small' | 'medium' | 'large' | null`), `reducedMotion` (boolean | null —
  null means follow the OS), `companionScreenPosition`
  (`{x, y, anchor: 'left' | 'right' | 'floating'} | null`), `lastUsedSkill`
  (`'spec-protocol' | 'kaizen' | 'eli5' | 'bro' | null`), `nameAsked`
  (`{askedAt?: string} | null`).

### Functions

| Signature | Purpose |
|---|---|
| `loadProfile(env?): LoadResult` | Read + migrate + normalize; never throws. A stored document with a NEWER `schemaVersion` than this lane knows is returned untouched at its own version. |
| `saveProfile(profile, env?): boolean` | Atomic write under per-process lock; false on failure, never throws. Also returns false (refuses) when `profile.schemaVersion > LATEST_SCHEMA_VERSION` — an older lane never rewrites a newer lane's document (spec 20). |
| `mergeProfile(current, patch): CandiceProfile` | Pure merge + normalize; no disk IO. Lives in `profile.ts` (browser-safe — no `node:fs`). |
| `migrateProfile(doc): { profile, migrated, startVersion, endVersion, violations }` | Delegates to the WS-34 migration chain (`runMigrations`); bounded loop; future versions pass through at their own version. |
| `normalizeProfile(doc): CandiceProfile` | Shape repair at the current version with defaults; never throws. |
| `prefsDirPath(env?): string` | `CANDICE_PREFS_DIR` override, else spec-9 paths per platform. |
| `defaultProfile(): CandiceProfile` | Fresh-user document (v3 defaults; nullable fields null). |
| `needsNameAsk(profile): boolean` | True only when no usable name AND ask never recorded. |
| `markNameAsked(profile, nowIso): CandiceProfile` | Records the one-time ask (`nameAsked: {askedAt}`). |
| `setPreferredName(profile, raw): CandiceProfile` | Store confirmed name; `''` clears (null) without re-arming. |
| `changePreferredName(profile, raw): CandiceProfile` | Alias for setPreferredName (change-later intent). |
| `welcomeBackPhrase(profile): string \| null` | `"Welcome back, <name>"` or null. |
| `normalizeName(raw): string` | Trim, collapse whitespace, cap 60 chars. |
| `isUsableName(name): boolean` | Non-empty after trim. |

### Environment

- `CANDICE_PREFS_DIR` — test/sandbox override of the profile directory.

## Schema authority

The versioned schema, per-version field contracts, and the migration chain are
owned by the WS-34 lane (`src/preferences/migrations/`). This lane consumes
`runMigrations`, `normalizeVersionedDoc`, `parseDocVersion`,
`CURRENT_SCHEMA_VERSION`, and `ProfileV3` — it never owns migrations. The
persisted document carries the integer `schemaVersion` (current = 3); the
protocol string `"1.0"` is an incoming wire shape only (mapped to integer 2 by
`parseDocVersion`).

## File layout

```
~/Library/Application Support/BlackCEO/999/Candice/profile.json   (macOS)
%LOCALAPPDATA%\BlackCEO\999\Candice\profile.json                  (Windows)
```

Lock file `profile.json.lock` is transient and never blocks (bounded wait,
stale-lock break). Corruption backups are `profile.json.corrupt-<pid>`.

## Non-goals (spec 9)

- Never project/conversation memory.
- Never reads answers, questions, session content, or the OS username.
- Never stores secrets, tokens, or audio.
