# WS-40 — user name / preferences / local profile — tests

Owned lane: `apps/candice-companion/tests/prefs/**` (PROJECT-MANIFEST 9.2, WS-40
glob `apps/candice-companion/src/prefs/**` plus this test directory).

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-40, E.2 first-run name, WS-34):

1. Preferred name asked at most once per local user (`needsNameAsk`).
2. Name never inferred from the OS username — source-level test proves no
   `os.userInfo` / `getpwuid` / `$USER` / `USERNAME` read exists in the lane.
3. Name stored in the local profile, persists across loads.
4. Name changeable later (`changePreferredName`).
5. Name used naturally — `welcomeBackPhrase` renders "Welcome back, <name>".
6. Local profile is never project/conversation memory — the persisted document
   contains only the known preference fields, never questions/answers/content.
7. Versioned JSON schema + migration chain (WS-34 authority): real v1 fixtures
   migrate to the v3 contract with zero data loss (renames
   `lastAnswerMethod` -> `lastUsedAnswerMethod`, `textScale` -> `textSize`
   enum, `companionPosition` -> `companionScreenPosition` {x,y,anchor},
   `nameAskedAt` -> `nameAsked` {askedAt}); future versions preserved at their
   own version in memory and never rewritten by an older lane (save refused,
   disk untouched).
8. Voice-output ON/OFF persists independently of answer method (spec 5.2);
   all four voice/type combinations round-trip.
9. Spec-9 fields persist: volume, speech rate, text size, reduced motion
   (nullable — null follows the OS), companion position, last answer method
   (convenience, never a lock), optional last-used skill.
10. Store failure degrades to defaults (`ok=false`), never throws, never blocks
    (spec 20); corrupt files are backed up, not deleted.

## Run

```bash
cd apps/candice-companion
node --test tests/prefs/prefs.test.ts
```

The lane is dependency-light by design (Node built-ins only, no test runner
dependency declared here) so the same suite runs in any CI container without
installing the app's full toolchain. On Node <22.6 run with
`--experimental-strip-types`.

The WS-34 migration suite (authority lane) runs from the repository root:

```bash
node --test tests/migrations/migrations.test.ts
```
