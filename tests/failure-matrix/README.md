# Failure / fallback / chaos test suite — WS-43 (`tests/failure-matrix/**`)

Candice failure/fallback/chaos test suite (Master Spec spec 27 Failure tests;
Checklist E.1 WS-43), L4 deps WS-04 (ask_user MCP path), WS-16 (whisper.cpp
runtime), WS-17 (mic capture + PTT), WS-19 (Kokoro TTS + system-TTS fallback),
WS-22 (macOS permissions + degraded floating mode), WS-35 (crash recovery +
startup temp sweep).

## What it proves (E.1 WS-43)

> failure/chaos suite green for app missing, app crash, speech model missing,
> corrupt checksum, mic denied, no audio device, temp unwritable, plugin
> missing, MCP unavailable, wrong session target, Claude busy — Claude is
> never blocked, reset, or destroyed.

Each failure mode is driven against the REAL seam the app runs: the WS-04 MCP
server and its answer-slot registry, the WS-05 fallback coordinator / double
-count guard / terminal adapter, the WS-16 whisper runtime (asset checksum +
transcribe), the WS-19 TTS fallback ladder, the WS-22 permission policy, the
WS-17 PTT controller, and the WS-20/WS-35 recovery + temp sweep.

| Test file | Failure class driven |
|---|---|
| `app-missing.test.js` | app/companion missing — ask_user fails soft with stable code, skill falls back to Claude |
| `app-crash.test.js` | crash mid-question, crash before delivery, crash between delivery and answer |
| `speech-model-missing.test.js` | STT model missing / binary missing; TTS engine unavailable → captions-only |
| `corrupt-checksum.test.js` | model checksum mismatch; updater payload checksum mismatch |
| `mic-denied.test.js` | WS-22 mic statuses; WS-17 permission-denied press; degraded floating policy |
| `no-device.test.js` | no input device; device lost mid-hold; WS-17 no-device fallback |
| `temp-unwritable.test.js` | unwritable temp root; unreadable root; failed delete; stale-orphan sweep |
| `plugin-missing.test.js` | plugin/MCP modules absent; MCP server silent; fallback lives without MCP |
| `mcp-unavailable.test.js` | MCP tool fails soft on invalid/unknown question; wrong-session refusal; busy fallback queue; delivery failure |
| `wrong-session.test.js` | wrong-session answer refused; unproven-session refusal; injection queue respects busy |
| `claude-busy.test.js` | Claude busy queues text, never injects; broken busy probe fails closed; recovery busy path |
| `suite.js` | runs all files; exit 0 only when every file prints ALL TESTS PASSED |

## Run

Zero dependencies, zero network, plain `node` (any Node >= 22.6; the suite is
CommonJS so Node 18+ works; Node 26 strips TS types natively for the ESM
files that import `src-tauri` TypeScript modules):

```bash
node tests/failure-matrix/suite
```

## Design rules

- Every test imports ONLY from owned dependency lanes (read-only consumption,
  cross-lane rule): `plugins/candice-integration/**`, `src-tauri/stt/**`,
  `src-tauri/audio/capture/**`, `src-tauri/audio/cleanup/**`,
  `src-tauri/tts/**`, `src-tauri/permissions/**`, `src-tauri/recovery/**`.
  None of those files are modified by this lane.
- Zero npm installs, zero network. The `crypto` hash checks run on real temp
  files. Rust crates are exercised via `cargo test --offline` with their own
  pinned real tests, never re-implemented here.
- Cross-platform: `node` only, no OS-specific commands. Temp dirs come from
  `node:os tmpdir()`.

## Files created (all inside the owned glob `tests/failure-matrix/**`)

See the per-file headers above and `suite.js` for the run order.
