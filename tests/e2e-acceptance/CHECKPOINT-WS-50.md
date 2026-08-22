# CHECKPOINT — WS-50 end-to-end nontechnical-user acceptance harness

- **Run/unit:** WS-50 builder (opus/max), workstream WS-50
- **Slice row:** PROJECT-MANIFEST 9.2 WR-021 (`tests/e2e-acceptance/**` (WS-50))
- **Snapshot truth (CONTROL/task-graph-snapshot.json WS-50):** deps WS-31, WS-36, WS-37, WS-38, WS-39, WS-42; level 7
- **Worktree:** `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- **Date:** 2026-08-21
- **Consumed (read-only, 0C cross-lane rule):** WS-01 schemas, WS-02 plugin/hooks, WS-03 session, WS-04 MCP ask-user, WS-05 fallback, WS-09 answer-controls/PTT, WS-14 captions/a11y, WS-16 STT runtime + bundled-model manifest, WS-17 capture, WS-20 duplex/cleanup, WS-31 bootstrap, WS-36 SKILL.md + references, WS-37/38/39 integrations, WS-40 prefs. WS-46 (CI/release matrix) is the declared exclusion — its interactive Windows smoke is referenced only as an honest skip marker, never implemented here. No file outside the owned glob was created or modified.

## Files created (all under owned glob)

| Path | Role |
|---|---|
| `tests/e2e-acceptance/suite.js` | Single entry point; runs all six legs; exit 0 only when every leg prints ALL TESTS PASSED |
| `tests/e2e-acceptance/harness.js` | Shared helpers: path resolution, readers, tree walker, fixed clock, fake Claude input, fake companion front channel (caption vs speech proof) |
| `tests/e2e-acceptance/happy1-first-run-name-ask.test.js` | Leg 1 — spec 4: ask at most once, typed + voice paths, local persistence, never inferred from OS username, "Welcome back, <name>", changeable later |
| `tests/e2e-acceptance/happy2-answer-surfaces.test.js` | Leg 2 — spec 5.1/6: HOLD TO TALK + TYPE ANSWER + Answer-in-Claude on every question, same-text redelivery, exactly-once terminal accounting, /bro + /eli5 to the same session, never-a-lock |
| `tests/e2e-acceptance/happy3-captions-voice-toggle.test.js` | Leg 3 — spec 5.2: independent persistent voice toggle, all four voice/type combinations round-trip, captions always visible and never gated on the toggle, setup-check caption |
| `tests/e2e-acceptance/happy4-local-audio-privacy.test.js` | Leg 4 — spec 7/8: whisper.cpp pinned + checksummed model, no cloud endpoint, mic gated on hold, 0o700 temp + delete-both-limbs + startup sweep, live EchoGate, no audio logging |
| `tests/e2e-acceptance/happy5-no-second-ai-same-session.test.js` | Leg 5 — spec 2/9/13.2: invariant stated in all surfaces, live ask_user one-question-one-answer same-session exactly-once, secrets never read aloud, fixed Kaizen order, profile never carries conversation content |
| `tests/e2e-acceptance/happy6-fresh-user-runs-skill.test.js` | Leg 6 — spec 2/3/13.1/22: wake hooks on the four commands + session start, async/bounded, fails soft, setup-check-first surface, hermetic fresh bootstrap installs all components, honest Windows skip marker |
| `tests/e2e-acceptance/README.md` | Lane README: run instructions, walkthrough table, fail-closed and skip discipline, dependency map, criteria mapping |

## Acceptance evidence (E.1 WS-50)

> WS-50 PASS: end-to-end nontechnical-user acceptance harness green — a
> fresh user runs a supported skill, Candice appears and reports setup
> checking, answers by voice and by type, and the answer reaches the same
> Claude session.

1. **Harness green** — suite exit 0, 6/6 legs ALL TESTS PASSED (see
   verification below).
2. **Fresh user runs a supported skill** — leg 6 drives the WS-02 wake hooks
   (all four commands + session start, async, bounded) and a real hermetic
   WS-31 bootstrap install (`installAll` + `healthCheck`) on a temp root:
   all five skills, the plugin, state/checksum metadata installed, app leg
   recorded as skipped (no fabricated bundle).
3. **Candice appears and reports setup checking** — leg 6 asserts the
   spec-3 greeting in the skill surface and the setup-check caption rule;
   the wake script fails soft (never blocks the skill).
4. **Answers by voice and by type** — leg 2 proves both controls verbatim
   (`🎙 HOLD TO TALK` / `TYPE ANSWER`) and every governed question event
   carrying `['voice','typed','terminal']`; voice-path profile persistence
   proven in leg 1; real-mic steps recorded as honest skips.
5. **The answer reaches the same Claude session** — leg 5 drives the real
   WS-04 `AskUserServer` + WS-03 `SessionManager` end-to-end: one question
   in, exactly one answer back, bound to the same session id; a second
   CONCURRENT ask is refused by the one-question-at-a-time slot guard, and
   a duplicate answer record is refused at the lifecycle seam
   (`questionCount === 1`, `pendingQuestion === null`, second
   `recordAnswer` refused); leg 2 proves the terminal path through the real
   WS-05 fallback with the same session id.

## Verification (primary source, run on this worktree)

```
node tests/e2e-acceptance/suite.js
=> 6/6 LEG(S) PASSED, E2E-ACCEPTANCE SUITE ALL GREEN, exit 0
   (leg outputs captured in the run log; each leg prints ok/FAIL lines
    plus explicit SKIP lines with reasons)
```

Dependency regression (the seams this suite drives, each re-run to prove
the live imports are the real shipped modules):

```
node plugins/candice-integration/integrations/kaizen/invariants.test.js   # WS-37 dep
node plugins/candice-integration/mcp/ask-user/mcp.test.js                 # WS-04 dep
node plugins/candice-integration/fallback/fallback.test.js                # WS-05 dep
node plugins/candice-integration/session/session-lifecycle.test.js        # WS-03 dep
```

## Honest skip markers (recorded, never claimed)

- Real microphone capture (WS-17/WS-28 hardware path) — legs 1/2/4.
- Real whisper.cpp transcription of a spoken sentence — leg 4.
- Real TTS playback from a speaker (WS-19 hardware path) — legs 3/4.
- Real human interactive Claude session — legs 1/5.
- Interactive Windows 10/11 desktop smoke (WS-46 full matrix) — leg 6:
  the E.1 WS-46 interactive smoke must be executed by a human on a real
  Windows desktop before Windows is labeled production-ready; CI alone is
  not Windows production proof (spec 18). The suite exits 0 with the skip
  recorded — it never claims those steps passed.

## Fail-closed self-verification (proven, not claimed)

The harness is a test harness — so the harness itself was adversarially
probed before this checkpoint was written:

1. **Planted break → caught.** The spec-3 greeting assertion was deliberately
   mutated in a scratch copy; the leg failed with exit 1 and the exact FAIL
   line. Removed after proof.
2. **Vacuous-pass defect found and fixed.** Leg 5 originally used a sync
   `check()` wrapper around an async body: an unhandled rejection (wrong
   registry API in the live ask_user walkthrough) was silently swallowed and
   the leg printed `ok` — a vacuous pass. Fixed with an await-aware `check`
   (`pending.push(check(...))` + `await Promise.all`), the REAL `registry.put`
   API with a schema-valid answer event, real envelope assertions (success =
   `result.result.answer`, never `isError`), and the real exactly-once seam
   (slot guard refuses a second concurrent ask; lifecycle `recordAnswer`
   refuses the duplicate record; `questionCount === 1`).
3. **Vacuous-pass guard.** Every leg's `check()` now rejects an un-awaited
   async fn (sync legs 1-4 guard; async legs 5-6 await every check before the
   verdict). Planted probe confirmed the guard trips: exit 1, FAIL with the
   guard message. Removed afterward.
4. **Planted-endpoint negative probe** confirmed the cloud-endpoint scan
   really fails when a forbidden URL is injected (exit 1, FAIL line named the
   file). Removed afterward.

## Cross-lane findings

None surfaced. Every dependency lane satisfied its consumed contract on
this worktree's live code; no CROSS-LANE-FINDING needed.

## Ownership boundary

Only `tests/e2e-acceptance/**` was created/modified. All dependency reads
were read-only. No `CONTROL/` file, no skill file, no plugin file, no app
source file, no spec file was touched.

Files are uncommitted per dispatch instruction.
