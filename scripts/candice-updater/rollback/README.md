# Candice updater — atomic install + rollback (WS-33)

Owned glob: `scripts/candice-updater/rollback/**` (PROJECT-MANIFEST 9.2 WR-017;
task-graph snapshot WS-33 owned_paths).

Implements the spec 21 install contract legs for this glob:

- install atomically (stage → back up old → rename — the target path never
  holds a half-written tree),
- back up replaced skill/plugin trees **outside Claude config roots**,
- rollback on failure,
- never expose secrets (no payload content is ever echoed),
- never change model/provider routing (touches only the paths it is given).

## Files

| File | Purpose |
|---|---|
| `atomic-install.mjs` | `install` / `rollback` operations. Backup dir defaults to `.candice-backups` beside the target (never inside a Claude config root). Journal at `install-journal.jsonl` names the backup for manual restore if rollback itself fails. |
| `download.mjs` | Download gate: refuses any component with no checksum record, refuses non-operator-controlled sources, verifies SHA-256 + size after fetch, stages to the path given (never the final target). Uses Node `fetch` — shell-agnostic (macOS bash, Windows PowerShell/CMD). |
| `__tests__/` | `node --test` suite (see checksums README for the run command). |

## Usage

```bash
# stage a verified non-application payload
node download.mjs --id stt-assets --version whisper-1.9.2 --platform darwin --out ./staged/ggml-tiny.en-q5_1.bin

# atomic install (backs up existing tree first)
node atomic-install.mjs install --from ./staged/app --to ~/.candice/app

# rollback to the newest backup
node atomic-install.mjs rollback --to ~/.candice/app
```

## Downgrade rejection

`../checksums/gate.mjs` is the downgrade primitive; the upgrade journey calls
it before install:

```bash
node scripts/candice-updater/checksums/gate.mjs --candidate 1.16.2 --installed 1.16.3
# -> DOWNGRADE REJECTED, exit 1
```

## Ownership boundary

This lane owns `scripts/candice-updater/checksums/**` + `scripts/candice-updater/rollback/**`
only. The download source URLs and manifest live in `checksums/`; the
`CONTROL/bundled-components.json` write is 9.4-class (this lane proposes the
fragment via `build-manifest.mjs --out`, never applies).
