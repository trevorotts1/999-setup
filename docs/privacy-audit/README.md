# PRIVACY / SECURITY / SECRETS AUDIT — WS-44 (Candice Companion)

- Lane: WR-021 `candice-final-validation`, unit WS-44
- Slice: WR-021 (2+2 write + 2 proposal lanes); WS-44 is the READ-ONLY audit lane
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ base 6bb00ec, worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership (manifest 9.2 row WR-021): `tests/privacy-audit/**` +
  `docs/privacy-audit/**` — the ONLY globs this lane writes. Everything else
  is read-only primary source. Defects outside the owned globs are
  recorded as CROSS-LANE-FINDING + fix tickets below, never repaired here (0C).
- Not committed, not pushed (fan-out rule).

## Acceptance criterion (CHECKLIST E.1 WS-44)

> WS-44 PASS: privacy/security audit green — raw audio never
> retained/uploaded/logged; no API keys, router tokens, env secrets, or
> unrelated terminal output logged; secret prompts not read aloud.

## Scope — audited lanes (deps WS-04, WS-17, WS-20, WS-40)

| Dep | Lane / path | Audit role |
|---|---|---|
| WS-04 | `plugins/candice-integration/mcp/**` | question delivery, answer text lifecycle, secret form |
| WS-17 | `apps/candice-companion/src-tauri/audio/capture/**` + `capture-windows/**` | PTT-only mic, in-memory ring, no disk/net/log |
| WS-20 | `apps/candice-companion/src-tauri/audio/duplex/**` + `cleanup/**` | echo gate, temp-audio lifecycle |
| WS-40 | `apps/candice-companion/src/prefs/**` | profile allowlist, no OS-username inference, 0600 |
| WS-08 (read-only) | `apps/candice-companion/src/state/machine.ts` | read-aloud seam (finding F2) |
| WS-03 (read-only) | `plugins/candice-integration/session/**` | session state file (finding F1) |
| WS-16 (read-only) | `apps/candice-companion/src-tauri/stt/**` | local transcription only (no cloud STT) |

## What was proven (primary source, re-runnable)

```bash
node tests/privacy-audit/run.js
```

### AUDIT A — audio privacy (spec 8) — 6/6 PASS

- **A1** mic live only while HOLD TO TALK is pressed: `source.open()` occurs
  exactly once, inside `PttController::press`; release/cancel/dispose close.
- **A2** raw audio never written to disk: 0 `std::fs`/`File`/`write`/`.wav`
  sites in the capture crates (11 source files). Preferred path is the
  in-memory ring buffer; the whisper transport temp file, when used, goes
  through the cleanup lane only.
- **A3** raw audio never uploaded: 0 network-client symbols in
  capture/duplex/cleanup (18 files). No cloud STT endpoint is required
  (whisper.cpp local seam, WS-16).
- **A4** raw audio never logged: 0 `println!`/`console` sites in the audio
  rails; events carry codes, never PCM.
- **A5** temp-audio cleanup lane carries automated tests proving 0o700,
  delete-after-transcribe success AND failure limbs, session-end close,
  startup sweep, marker gating (11 node:test cases re-run green).
- **A6** transcription is the local whisper.cpp seam (WS-16, referenced
  read-only); no cloud speech endpoint exists in the audio rails.

### AUDIT B — secrets & environment — 4/5 PASS, 1 FINDING

- **B1** no live secrets in tracked files: 408 tracked files scanned, 0
  matches (test-control sentinels excluded and documented as benign).
- **B2** no `.env` / `API docs.md` with real values tracked; `templates/API
  docs.md` carries placeholders only; `.gitignore` covers `.env`/`.env.*`.
- **B3** MCP ask-user path never logs answer/question text; the answer slot
  registry deletes each answer after exactly one read (`take()`); a second
  read returns not-found.
- **B4** FINDING F1 — session state file mode (below).
- **B5** env-sweep tool `--selftest` proves 0 secret values printed, 0
  bearer credentials on any command line, 0 credentials interpolated into a
  URL — 6/6 control legs PASS.

### AUDIT C — profile privacy + secret prompts — 4/5 PASS, 1 FINDING

- **C1** profile stores ONLY the 11 allowlisted spec-9 fields — no secrets,
  tokens, audio, or conversation content.
- **C2** preferred name never inferred from the OS username: 0
  userInfo/username/hostname reads in the prefs lane.
- **C3** `profile.json` written 0600 with atomic write-then-rename.
- **C4** secret-bearing questions never read aloud: `tests/contract/secret.test.js`
  re-run green (7 PASS — the safe `readAloud:false` form validates, the
  registry shapes every secret key safely, the WS-04 gate accepts the safe
  form, answered secret questions are never re-askable).
- **C5** FINDING [F2] — read-aloud guard in the app read path (below).

## CROSS-LANE-FINDINGS + FIX TICKETS

Per 0C cross-lane rule: findings recorded here, routed to the owning lane;
this lane never edits them.

| ID | Severity | Affected lane (owned glob) | Evidence | Recommended action | Status |
|---|---|---|---|---|---|
| WS-44-F1 | medium | WS-03 `plugins/candice-integration/session/**` | `session-manager.js` `_save()` writes `candice-sessions.json` with `writeFileSync` and NO explicit mode — default mode measured 644 on this macOS host (umask 022). The file persists pending-question text; 644 exposes question text to other local OS users. | WS-03 passes `{ mode: 0o600 }` to `writeFileSync` (and the `.tmp` file), matching the WS-40 prefs pattern. Add a mode assertion test. | OPEN |
| WS-44-F2 | low | WS-08 `apps/candice-companion/src/state/**` (+ WS-19 read path) | `machine.ts` `speech:tts` handler emits `tts:speak` with NO sensitivity/readAloud gate; the event contract carries no readAloud field. Currently unreachable (no producer emits `speech:tts` for a secret question — WS-04 validate + WS-41 secret suite enforce `readAloud:false` at the producer/data layer). | The read path wiring must gate: never emit `tts:speak` when the pending question is `sensitivity:"secret"` (or carry `readAloud` in the speech event). WS-41 secret leg keeps proving the producer side; WS-08/WS-19 owns the final guard. | OPEN |

## Verdict

Status: **all legs satisfied with primary-source evidence; blind QC recheck
REQUIRED.** The two findings above are deferred-fix records (route via the
conductor to WS-03 and WS-08/WS-19), not E.1-blocking gate failures — the
audit proves the producer/data layers green and names the two seams the
read-path wiring must close before final release.
