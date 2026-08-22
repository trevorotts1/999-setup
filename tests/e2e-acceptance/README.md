# End-to-end nontechnical-user acceptance harness — WS-50

Owned lane: `tests/e2e-acceptance/**` (PROJECT-MANIFEST 9.2 WR-021, WS-50).

Proves the E.1 WS-50 acceptance criterion (`CONTROL/CHECKLIST.md`):

> a fresh user runs a supported skill, Candice appears and reports setup
> checking, answers by voice and by type, and the answer reaches the same
> Claude session.

The harness is a **scripted walkthrough of the nontechnical flow** (Master
Spec sections 2-9): a human nontechnical user — or a later interactive smoke
run — follows the same steps the automated legs assert, so the script and the
real run can never drift apart.

## Run

```bash
node tests/e2e-acceptance/suite.js
```

Exit 0 only when every leg prints `ALL TESTS PASSED`. Plain `node`, zero
dependencies, zero network, no package-manager step — the repo convention
(sections 12/17/27), matching `tests/contract` and `tests/same-session`.

### Node version

The harness imports TypeScript sources from the app lane directly. That
requires Node with type-stripping enabled (repo floor: Node 22.18+ / 26,
used by the rest of the repo). On an older Node the suite fails with a clear
import error instead of passing silently.

## The walkthrough (six legs)

| Leg | Flow step (nontechnical wording) | Spec |
|---|---|---|
| `happy1-first-run-name-ask.test.js` | "Hi, I'm Candice. What's your name?" — asked once per local user, answered by voice or type, stored locally, never guessed from the computer username, used later as "Welcome back, <name>", changeable | 4 |
| `happy2-answer-surfaces.test.js` | Every question offers HOLD TO TALK and TYPE ANSWER; "Answer in Claude instead" falls back to the terminal without losing state or double-counting; last-used method is a convenience, never a lock | 5.1, 6 |
| `happy3-captions-voice-toggle.test.js` | Voice responses ON/OFF is a separate persistent toggle; all four voice/type combinations work; captions are ALWAYS shown, even muted, including the setup-check message | 5.2 |
| `happy4-local-audio-privacy.test.js` | Speech never leaves the machine: pinned whisper.cpp + checksummed bundled model, mic live only while held, temp audio 0o700 + deleted after success or failure + startup sweep, TTS can never feed STT (EchoGate), no cloud endpoint | 7, 8 |
| `happy5-no-second-ai-same-session.test.js` | No second AI conversation, no competing project memory, answers return to the SAME session and count exactly once, secrets never read aloud | 2, 9, 13.2 |
| `happy6-fresh-user-runs-skill.test.js` | Fresh user runs /spec-protocol or /kaizen or /eli5 or /bro; Candice wakes quickly and reports setup checking before preflight; bootstrap installs skills+plugin+app+assets with checksum metadata on a fresh machine | 2, 3, 13.1, 22 |

## Fail-closed assertions

Every automated check is binary and fail-closed: a missing dependency file, a
rephrased label, a dropped invariant, or an unexpected behavior flips the leg
to FAIL — a positive claim never rests on a grep of a single file. Where a
check is source-level (e.g. "captions never read the voice toggle", "audio
never logged"), the scan covers the whole owned lane and excludes only
doc-comment lines and the lane's own tests.

The `check()` wrappers are vacuous-pass guarded: an async check body that is
not awaited (a silent-failure trap) flips the leg to FAIL with an explicit
message, and async legs await every check before the verdict. The harness
itself was adversarially probed during the build — planted breaks and a
planted un-awaited async check were all caught (see CHECKPOINT-WS-50.md).

## Honest skip markers

A leg that needs a real microphone, a real Windows desktop, or a real
interactive Claude session prints an explicit `SKIP - <reason>` line and the
suite still exits 0. A skip is never silent and never claimed as tested. The
interactive-gated steps (WS-46 Windows desktop smoke, live mic/PTT, live
TTS playback, live human interview) are recorded as the release gate they
are — the E.1 WS-46 interactive Windows smoke must be executed by a human on
a real Windows 10/11 desktop before Windows is labeled production-ready.

## Dependency lane usage (0C cross-lane rule)

This lane only READS its dependencies through their owned globs — it never
edits them:

- WS-01 schemas: `packages/candice-protocol/schemas/**`
- WS-02 plugin + hooks: `plugins/candice-integration/{.claude-plugin,hooks,bin}/**`
- WS-03 session: `plugins/candice-integration/session/**`
- WS-04 MCP ask-user: `plugins/candice-integration/mcp/ask-user/**`
- WS-05 fallback: `plugins/candice-integration/fallback/**`
- WS-09 answer controls + PTT: `apps/candice-companion/src/ui/{answer-controls,ptt,transcript}/**`
- WS-14 captions: `apps/candice-companion/src/ui/captions/**` + `src/a11y/**`
- WS-16 STT runtime: `apps/candice-companion/src-tauri/stt/**`
- WS-17 capture: `apps/candice-companion/src-tauri/audio/capture/**`
- WS-20 duplex + cleanup: `apps/candice-companion/src-tauri/audio/{duplex,cleanup}/**`
- WS-31 bootstrap: `scripts/candice-bootstrap/**`
- WS-36 skill surfaces: `.claude/skills/spec-protocol/SKILL.md` + references
- WS-37/38/39 integrations: `plugins/candice-integration/integrations/**`
- WS-40 prefs: `apps/candice-companion/src/prefs/**`

## Files

| File | Role |
|---|---|
| `suite.js` | Single entry point; runs all six legs; exit 0 only when every leg prints ALL TESTS PASSED |
| `harness.js` | Shared helpers: repo path resolution, JSON/file readers, tree walker, deterministic clock, fake Claude input surface, fake companion front channel (caption + speech proof) |
| `happy1-...test.js` .. `happy6-...test.js` | The six scripted walkthrough legs |
| `CHECKPOINT-WS-50.md` | This lane's checkpoint: evidence, verification, cross-lane findings |

## Criteria mapping (CHECKLIST E.1 WS-50 + E.2)

- **fresh user runs a supported skill** — leg 6 (wake hooks on the four
  commands, setup-check surface, hermetic fresh bootstrap)
- **Candice appears and reports setup checking** — leg 6
- **answers by voice and by type** — legs 1-2 (voice and typed paths proven
  against the WS-04/WS-05 seams; real mic steps recorded as skips)
- **the answer reaches the same Claude session** — leg 5 (live ask_user
  end-to-end, one question, one answer, same session id, exactly once)
- E.2 first-run name ask / HOLD-TO-TALK + TYPE-ANSWER / Answer-in-Claude /
  voice toggle persists / captions always / whisper local only / audio never
  retained / temp-audio cleanup / no-second-AI / no-competing-memory — legs
  1-5 respectively
