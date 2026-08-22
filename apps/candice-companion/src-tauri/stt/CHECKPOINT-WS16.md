# WS-16 BUILD CHECKPOINT — whisper.cpp runtime integration

- Builder: B-WR-009-WS-16 (opus/max), first Candice production fan-out
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ aa23ed9 (base 6bb00ec), canonical worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership: `apps/candice-companion/src-tauri/stt/**` (worktree PROJECT-MANIFEST 9.2 WR-014 WS-16; snapshot WS-16 owned_paths)
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-16)

> WS-16 PASS: whisper.cpp pinned + bundled/deterministic model + checksum verify + local transcription test green.

Status: **all four legs satisfied with primary-source evidence; test green on this machine.**

## Files created (all under the owned glob)

1. `apps/candice-companion/src-tauri/stt/README.md` — pin record, runtime contract, failure contract (spec 20), benchmark record, model selection rationale.
2. `apps/candice-companion/src-tauri/stt/runtime/manifests/bundled-model.json` — production pin: whisper.cpp 1.9.2 + ggml-tiny.en-q5_1 (sha256 `c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b`); macOS bottle + Windows archives recorded.
3. `apps/candice-companion/src-tauri/stt/runtime/manifests/candidate-models.json` — 4-model benchmark (tiny/base/small/medium.en) on M4 Pro, reference fixture, per spec 7 smallest-meeting-bar rule.
4. `apps/candice-companion/src-tauri/stt/runtime/manifests/windows-runtime.json` — per-file SHA-256 of every file in canonical v1.9.2 `whisper-bin-x64.zip` and `whisper-bin-Win32.zip` (runtime+ggml dll set; native x64 v1 target, spec 18).
5. `apps/candice-companion/src-tauri/stt/runtime/whisper-runtime.mjs` — `transcribe()` / `checkRuntime()` / `verifySha256()` contract consumed by WS-17/WS-18; offline-only, checksum-gated, empty-transcript-is-failure, never writes memory.
6. `apps/candice-companion/src-tauri/stt/runtime/verify-assets.mjs` — executable integrity verifier (model sha256 + runtime --version probe), exit 0/1/2.
7. `apps/candice-companion/src-tauri/stt/tests/test-local-transcription.sh` — the acceptance test; asserts checksum, runtime version, transcript vs reference text.
8. `apps/candice-companion/src-tauri/stt/tests/fixtures/jfk.wav.sha256.json` — fixture pin + provenance (no binary in repo).

## Evidence (primary-source, machine-generated)

- `whisper-cli --version` -> `whisper.cpp version: 1.9.2` (Homebrew bottle, M4 Pro).
- Model downloads from canonical `https://huggingface.co/ggerganov/whisper.cpp` (repo of record per spec 30); archive downloads from canonical GitHub release `v1.9.2`.
- Verification: `shasum -a 256` of every model/archive matches the recorded values; all four models transcribed the JFK fixture correctly (0.36-1.62 s wall).
- Local transcription test: **PASS** — JFK transcript "And so, my fellow Americans. Ask not what your country can do for you. Ask what you can do for your country." (tiny.en-q5_1, no network involved in the run; fixture sha256 `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` verified byte-identical to canonical `samples/jfk.wav`).
- Windows native binaries exist at the pinned tag (`whisper-bin-x64.zip`, `whisper-bin-Win32.zip`, both checksummed); Windows interactive smoke remains a WR-016/WS-50 responsibility, not this lane.

## Cross-lane findings

```
CROSS-LANE-FINDING
source workflow/lane: B-WR-009-WS-16
affected unit: WS-33 (bundled components manifest) — WR-017 lane; also WS-31 fresh-install model bundling
evidence: Homebrew whisper-cpp 1.9.2 ships a "test" model at
  /opt/homebrew/Cellar/whisper-cpp/1.9.2/share/whisper-cpp/for-tests-ggml-tiny.bin
  (575,451 bytes) that produces ZERO segments on the canonical JFK fixture
  (verified multiple runs; whisper-cli exits 0, empty transcript). It is a
  loader/CI smoke model, not a transcription model.
severity: medium
recommended action: WS-33/WS-31 must bundle ggml-tiny.en-q5_1 (sha256
  c77c5766...) — never the for-tests model. Installer/updater must verify the
  sha256 before load (recorded in bundled-model.json, this lane).
```

```
CROSS-LANE-FINDING
source workflow/lane: B-WR-009-WS-16
affected unit: WS-17 (capture) — same WR-014 run; WS-19/WS-20 (duplex)
evidence: whisper.cpp 1.9.2 CLI emits transcripts ONLY to an out-file
  (`-otxt -of <prefix>`); stdout is empty on this build (verified). Segment
  text never reaches stdout/stderr.
severity: low
recommended action: WS-17/WS-20 must consume `<prefix>.txt` (or use the
  whisper.dll API on Windows); callers parsing stdout will silently get
  empty transcripts. The shared contract in whisper-runtime.mjs already
  reads the out-file — treat it as the single seam.
```

## Operator decision point (does NOT block this lane)

tiny.en-q5_1 (32 MB) pinned as production model — smallest meeting the quality bar. base.en-q5_1 (59 MB) is the fallback pin if the operator wants the comma-level punctuation difference on the JFK reference. Final `CONTROL/bundled-components.json` record is a 9.4-owner write (proposal only from this lane).

## Next steps (hand-off)

1. QC lane judges WS-16 (E.1 criterion above).
2. Conductor routes CROSS-LANE-FINDING WS-16-01 to WR-017/WS-33; WS-16-02 to WR-014 WS-17/WS-20.
3. WR-014 WS-17 consumes `whisper-runtime.mjs`; WS-18 consumes `{ text, segments }` with confirm-before-submit.
4. Installer bundling of the model (32 MB) lands in WR-017 with checksum verify against `bundled-model.json`.

## QC-FIX 2026-08-21 (blind QC Q-WR-009-WR-009, sonnet/max)

**Verdict: FAIL (ownership compliance) -> fixed -> FRESH RECHECK REQUIRED.**

Defect: unit was built at `apps/candice-companion/src/speech/stt/**`. The authoritative owned glob for WS-16 is `apps/candice-companion/src-tauri/stt/**`:
- worktree `spec/PROJECT-MANIFEST.md` 9.2 row WR-014 (reconciled 2026-08-21 12:02, authoritative per 9.2 header + 0E dynamic remapping),
- worktree `CONTROL/EXECUTION-PLAN.md` 6.2 row WR-009 (W1-B) + QC-FIX ROUND 1 row 447 (explicitly labels `src/speech/stt/**` "pre-rewrite"),
- worktree `CONTROL/task-graph-snapshot.json` node WS-16 `owned_paths` = `apps/candice-companion/src-tauri/stt/` (dispatch authority per 0F).
The root copy of PROJECT-MANIFEST.md (09:54, pre-reconciliation) still shows `src/speech/stt/**` — stale, not authority.

Fix applied: relocated tree `src/speech/stt/**` -> `src-tauri/stt/**` (move, byte-identical). Backup of pre-fix state: `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap/backup-ws16-src-speech-stt-20260821/`. Re-ran acceptance test from new location: PASS (model checksum, runtime 1.9.2, 22/22 words, exit 0). `verify-assets.mjs` PASS. Doc references updated; zero `src/speech/stt` references remain (controlled grep). No commit (builder discipline; repair commit is integration-owner's fan-in job per fan-out instructions).

CROSS-LANE-FINDING (recorded, not edited): root `SPEC/PROJECT-MANIFEST.md` 9.2 WR-014 still cites pre-rewrite globs (`src/speech/stt/**`, `src/audio/capture/**`, `src/speech/tts/**`); the worktree copy is reconciled. Conductor must propagate the reconciled 9.2 to root before next dispatch, or more builders will land in superseded paths.
