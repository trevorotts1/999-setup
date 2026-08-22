# WS-43 Checkpoint — failure/fallback/chaos test suite

**Builder:** WS-WS-43 (opus/max), W3 slice
**Run:** WR-020 candice-tests slice, workstream WS-43 (L4 — deps WS-04, WS-16, WS-17, WS-19, WS-22, WS-35)
**Worktree:** `candice/wr001-bootstrap` (worktrees/wr001-bootstrap)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Files created (all inside the owned glob `tests/failure-matrix/**`)

| File | Purpose |
|---|---|
| `tests/failure-matrix/suite.js` | Single entry point: runs all 11 files + the plugin-missing silent-MCP mode, exit 0 only when every file prints ALL TESTS PASSED |
| `tests/failure-matrix/harness.js` | PASS/FAIL printer + exit accounting; async-aware |
| `tests/failure-matrix/app-missing.test.js` | app missing: ask_user fail-soft with the stable ask-in-Claude instruction; no slot left open; WS-05 fallback hands the SAME question to the terminal, counted once; throwing deliverer captured, never propagated |
| `tests/failure-matrix/app-crash.test.js` | crash mid-question: REAL `runStartupRecovery` restores the EXACT pending question, counted mirror untouched, `recovering` raised; crash before ask: no phantom recovery; crash between ask and answer: slot released, re-askable; REAL startup sweep removes stale crash-orphan temp audio, keeps fresh sessions; throwing lifecycle is a named failure |
| `tests/failure-matrix/speech-model-missing.test.js` | missing STT model/binary: named `model-missing`/`runtime-not-found`, transcription refused before any run; TTS system fallback NOT claimed until a platform adapter wires it — degrades to captions-only (`engine-unavailable`) |
| `tests/failure-matrix/corrupt-checksum.test.js` | corrupt model file: `checksum-mismatch`, `transcribe` refuses before any run; WS-33 updater `verify.mjs`: corrupt payload exit 1, unverifiable payload refused fail-closed, exact match exit 0 |
| `tests/failure-matrix/mic-denied.test.js` | real WS-17 capture crate tests (mic denied -> Denied, no recording, typing stays; denied release -> Idle) and WS-22 permissions crate tests (denied -> Floating; mic status map) via `cargo test --offline` |
| `tests/failure-matrix/no-device.test.js` | real WS-17 crate tests: no-device press -> NoDevice, no stream, typing stays; device lost mid-hold no crash; full 25-test crate suite green offline |
| `tests/failure-matrix/temp-unwritable.test.js` | REAL `sweepStaleTempAudio`: unreadable root -> named failure, zero blind deletions; failed delete -> reported, never silent; missing root -> fresh-machine zero noise |
| `tests/failure-matrix/plugin-missing.test.js` | plugin absent: ask_user soft-fail; fallback coordinator still answers via terminal path exactly once; MCP wire initialize/tools/list intact. Second mode (`CANDICE_FM_SILENT_MCP=1`): MCP accepts but never answers -> wait-window soft timeout, slot released, never hangs |
| `tests/failure-matrix/mcp-unavailable.test.js` | not-ready -> soft fail same instruction; fallback same question no double-count; malformed question refused by name; undelivered question leaves no slot; JSON-RPC parse/method errors structured |
| `tests/failure-matrix/wrong-session.test.js` | wrong-session answer never lands (no-open-slot), owning slot untouched; window alone is never routing evidence; unproven session refuses; route refusal delivers nothing; WS-03 session manager refuses unknown-session answer records |
| `tests/failure-matrix/claude-busy.test.js` | busy -> queue with "not yet" state, nothing injected; flush in order exactly once; broken busy probe fails CLOSED (queue, never blind inject); queue bound refuses overflow |
| `tests/failure-matrix/README.md` | suite doc: criterion mapping, run commands, design rules |

## Acceptance criterion mapping (CONTROL/CHECKLIST.md E.1 WS-43)

> failure/chaos suite green for app missing, app crash, speech model missing,
> corrupt checksum, mic denied, no audio device, temp unwritable, plugin
> missing, MCP unavailable, wrong session target, Claude busy — Claude is
> never blocked, reset, or destroyed.

| E.1 leg | File(s) |
|---|---|
| app missing | app-missing |
| app crash | app-crash |
| speech model missing | speech-model-missing |
| corrupt checksum | corrupt-checksum |
| mic denied | mic-denied |
| no audio device | no-device |
| temp unwritable | temp-unwritable |
| plugin missing | plugin-missing |
| MCP unavailable | mcp-unavailable, plugin-missing (silent mode) |
| wrong session target | wrong-session |
| Claude busy | claude-busy |

## Design decisions

- **Every leg drives the REAL seam the app runs**: the WS-04 MCP server and
  answer-slot registry, WS-05 fallback coordinator/guard/adapter, WS-16
  whisper runtime, WS-19 TTS fallback, WS-22 permission policy, WS-17 PTT
  controller, WS-20 sweep engine, WS-35 recovery orchestration, WS-33
  updater verifier. Zero re-implementations, zero fabricated contracts.
- **Rust lanes proven by their own pinned real tests** — `cargo test
  --offline` on the two default-feature crates (capture 25/25, permissions
  20/20, no TCC, no hardware, no network) with the exact named tests for the
  mic-denied and no-device legs.
- **Zero-dependency run** — plain `node` only (Node 26; TS and ESM stripped/
  resolved natively; Node 22.6+ works), real tmpfs for hash checks, no
  network, no npm.
- **Cross-platform** — no OS-specific commands; temp dirs from
  `node:os tmpdir()`.
- Read-only consumption of dependency lanes (0C cross-lane rule): nothing
  outside `tests/failure-matrix/**` was written, no CONTROL, no spec, no
  manifest, no commit.

## Verification evidence (run live, this lane)

```
$ node tests/failure-matrix/suite.js
==== app-missing.test.js: PASS ====        (5 checks)
==== app-crash.test.js: PASS ====           (6 checks)
==== speech-model-missing.test.js: PASS ==== (6 checks)
==== corrupt-checksum.test.js: PASS ====    (5 checks)
==== mic-denied.test.js: PASS ====          (5 checks)
==== no-device.test.js: PASS ====           (4 checks)
==== temp-unwritable.test.js: PASS ====     (3 checks)
==== plugin-missing.test.js: PASS ====      (3 checks)
==== mcp-unavailable.test.js: PASS ====     (5 checks)
==== wrong-session.test.js: PASS ====       (5 checks)
==== claude-busy.test.js: PASS ====         (4 checks)
==== plugin-missing (silent-MCP mode): PASS ==== (1 check)
FAILURE MATRIX ALL GREEN
```

12 file-runs, 52 checks + 12 file banners + 12 ALL TESTS PASSED = 76 PASS lines, 0 FAIL, exit 0. Repo regression: the WS-41
contract suite, WS-04 mcp.test.js, WS-05 fallback.test.js, WS-03
session-lifecycle.test.js and WS-19/WS-20/WS-35 lane suites were required
and executed during this build — none modified, none regressed.
