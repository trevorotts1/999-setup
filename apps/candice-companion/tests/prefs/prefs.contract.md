# WS-40 contract — preferences module API

Stable surface other lanes may consume. Changes to these signatures are
breaking changes; propose them via CROSS-LANE-FINDING to the WR-018/WS-40
owner before shipping a replacement.

## Module: `src/prefs/index.ts`

### Types

- `CandiceProfile` — one document per local OS user; all fields optional
  except `schemaVersion: 1`. Fields: `preferredName`, `voiceOutputEnabled`,
  `volume` (0..1), `speechRate` (0.5..2), `lastAnswerMethod`
  (`'voice' | 'typed' | 'terminal'`), `textScale` (0.8..1.6),
  `reducedMotion`, `companionPosition` (`{left, top}`), `lastUsedSkill`,
  `nameAskedAt` (ISO 8601 UTC).

### Functions

| Signature | Purpose |
|---|---|
| `loadProfile(env?): LoadResult` | Read + migrate + normalize; never throws. A stored document with a NEWER `schemaVersion` than this lane knows is returned untouched at its own version. |
| `saveProfile(profile, env?): boolean` | Atomic write under per-process lock; false on failure, never throws. Also returns false (refuses) when `profile.schemaVersion > LATEST_SCHEMA_VERSION` — an older lane never rewrites a newer lane's document (spec 20). |
| `mergeProfile(current, patch): CandiceProfile` | Pure merge + normalize; no disk IO. |
| `migrateProfile(doc): { profile, migrated }` | Version-gated migration, bounded loop; future versions pass through at their own version. |
| `normalizeProfile(doc): CandiceProfile` | Shape repair with defaults; never throws. |
| `prefsDirPath(env?): string` | `CANDICE_PREFS_DIR` override, else spec-9 paths per platform. |
| `defaultProfile(): CandiceProfile` | Fresh-user document (defaults only). |
| `needsNameAsk(profile): boolean` | True only when no usable name AND ask never recorded. |
| `markNameAsked(profile, nowIso): CandiceProfile` | Records the one-time ask. |
| `setPreferredName(profile, raw): CandiceProfile` | Store confirmed name; `''` clears without re-arming. |
| `changePreferredName(profile, raw): CandiceProfile` | Alias for setPreferredName (change-later intent). |
| `welcomeBackPhrase(profile): string \| null` | `"Welcome back, <name>"` or null. |
| `normalizeName(raw): string` | Trim, collapse whitespace, cap 60 chars. |
| `isUsableName(name): boolean` | Non-empty after trim. |

### Environment

- `CANDICE_PREFS_DIR` — test/sandbox override of the profile directory.

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
