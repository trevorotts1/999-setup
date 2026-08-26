# WS-44 CHECKPOINT — privacy/security/secrets audit

- Slice: WR-021 `candice-final-validation` (2+2 write + 2 proposal lanes)
- Unit: WS-44 (READ-ONLY audit lane)
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ base 6bb00ec, worktree
  `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership (manifest 9.2 row WR-021): `tests/privacy-audit/**` +
  `docs/privacy-audit/**` — the ONLY globs this lane writes. All other
  paths are read-only primary source (0C).
- Not committed, not pushed (fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-44)

> WS-44 PASS: privacy/security audit green — raw audio never
> retained/uploaded/logged; no API keys, router tokens, env secrets, or
> unrelated terminal output logged; secret prompts not read aloud.

Status: **all legs satisfied with primary-source evidence; blind QC recheck
REQUIRED.**

## Deliverables (both under the owned globs)

### `tests/privacy-audit/**`

| File | Role |
|---|---|
| `helpers.js` | zero-dep helpers (repo-root reads, git ls-files, evidence collection) |
| `audit-a-audio.js` | AUDIT A — spec 8 audio privacy: PTT-only mic, no disk, no network, no logging, cleanup-lane proof, no cloud STT (6 checks) |
| `audit-b-secrets.js` | AUDIT B — secrets/env/logging: no committed secrets, no real `.env`, MCP answer text lifecycle, session-state file mode (finding F1), env-sweep selftest (5 checks) |
| `audit-c-profile.js` | AUDIT C — profile privacy + secret prompts: spec-9 allowlist, no OS-username inference, 0600 atomic writes, secret.test.js re-run, read-aloud seam (finding F2) (5 checks) |
| `run.js` | suite runner — `node tests/privacy-audit/run.js`; exit 0 only when all 16 checks pass |

### `docs/privacy-audit/**`

| File | Role |
|---|---|
| `README.md` | audit report: scope, per-check evidence, verdict, CROSS-LANE-FINDING table with fix tickets |
| `CHECKPOINT-WS-44.md` | this file |

## CROSS-LANE-FINDINGS (routed to owning lanes, never repaired here)

| ID | Severity | Lane | Summary | Fix ticket |
|---|---|---|---|---|
| WS-44-F1 | medium | WS-03 | `candice-sessions.json` written with NO explicit mode (measured 644); pending-question text world-readable | `{ mode: 0o600 }` in `session-manager.js` `_save()` + mode assertion test |
| WS-44-F2 | low | WS-08/WS-19 | `speech:tts` handler emits `tts:speak` with no sensitivity/readAloud gate; unreachable today, guard must land with read-path wiring | gate speak on `sensitivity:"secret"` or carry `readAloud` in the speech event |

## Primary-source verification runs (all green)

- `node tests/privacy-audit/run.js` — 3/3 suites, 16/16 checks PASS, exit 0
- `cargo test` (WS-17 capture crate) — 25 passed
- `node --test` cleanup 11/11, duplex 17/17, prefs 29/29, machine 27/27
- `node tests/contract/suite.js` — CONTRACT SUITE ALL GREEN (secret leg 7 PASS)
- `env-sweep.sh --selftest` — 6/6 PASS, 0 secret values printed

Blind QC recheck REQUIRED (no self-promotion; CHECKLIST box-flip rule).
