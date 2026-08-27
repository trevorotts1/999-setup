# FIX-019 packaged-automated tier

Owned path: `tests/e2e-acceptance/packaged/**` (FIX-019 implementation lane).
The app itself (UI, bridge handshake, surface) is owned by other lanes —
this tier only consumes the packaged product through its accessibility
tree and the real MCP pair, exactly like the FIX-011 recheck.

## What runs

| Leg | What it proves |
| --- | --- |
| `typed-build-target` | Real `candice.ask_user` tool call carrying the canonical BUILD_TARGET event; typed answer into the real packaged a11y tree; exactly one answer returns to the same session; no answer elements remain after return (FIX-011 cleanup preserved). |
| `wrong-session` | A foreign session's answer is refused (spec 17 hard fail); the owning slot stays waiting; the owning call never receives the foreign text. |
| `duplicate` | Second answer for the same (sessionId, questionKey) refused; session count stays one. |
| `fallback` | Packaged app killed mid-question: fail-soft with the stable "ask the same question in Claude normally" instruction; the real FallbackCoordinator defers the same governed question to the terminal surface; terminal answer records exactly once with `inputMode: 'terminal'`; a second terminal answer refused (double-count guard). |
| `restart` | Kill after displayed, before answer; FIX-013 durable store hands back the exact pending (sessionId, questionKey) exactly once; second recovery finds nothing; count never increments; resume returns active with no pending question. |
| `compact` | After the interview round trip, compact surface accepts a typed question and `/bro`; no governed question re-asked. Dependency-honest: compact is the FIX-014 appui lane's surface — if it is not in the packaged a11y tree, the leg records BLOCKED with the named dependency, never a fake PASS. |

## Prerequisites

1. macOS (System Events accessibility driving).
2. Terminal running the suite must have Accessibility permission.
3. Layer 4 build, exact FIX-011 recheck pattern:

```sh
npm --prefix apps/candice-companion run tauri:build
(cd apps/candice-companion && bash scripts/package-macos/build-macos-bundle.sh adhoc)
codesign --verify --deep --strict "apps/candice-companion/dist/Candice Companion.app"
```

The exercised binary is
`apps/candice-companion/dist/Candice Companion.app/Contents/MacOS/candice-companion`.
SHA-256 is written to `evidence/FIX-019/builder/packaged-binary.sha256`.

## Run

```sh
node tests/e2e-acceptance/packaged/suite.js
```

Runs every leg twice from clean state (clean = no app process, no answer
slots, fresh protected state dir, verified before each leg, not assumed).
Exit codes: 0 = all required packaged legs PASS twice; 1 = FAIL; 2 =
BLOCKED (environment gate closed, or a required leg BLOCKED).

Per-run traces land in
`evidence/FIX-019/builder/packaged-traces/run{1,2}/<leg>/event-trace.jsonl`
— frames are `{ runId, launcher, sessionId, questionKey, inputMode,
eventKind, ts }` with event kinds from the plan's twelve-value vocabulary,
keys and codes only. The suite enforces run-2 frames equal run-1 frames
modulo timestamps.

## Rules

- No test doubles: real `AskUserServer`, real `LocalCompanionBridge`, real
  packaged binary, real `SessionManager` + `FallbackCoordinator` on
  isolated temp state dirs. An injected `deliverQuestion` cannot close
  this tier.
- Never log question text, answer text, tokens, or secrets (FIX-017
  boundary). Leg self-checks re-scan their own traces.
- Do not edit the packaged app, the build scripts, or
  `signature-helper/target/`. Build artifacts are evidence only; the
  `.app` under `dist/` is never committed.
