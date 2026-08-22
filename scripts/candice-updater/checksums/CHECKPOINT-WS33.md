# WS-33 BUILD CHECKPOINT — bundled-component manifest/checksums/rollback

- Builder: WS-WS-33 (opus/max), W2 build, worktree lane WR-017
- Date: 2026-08-21
- Branch: `candice/wr001-bootstrap` @ aa23ed9 (base 6bb00ec)
- Worktree: `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Ownership: `scripts/candice-updater/checksums/**` + `scripts/candice-updater/rollback/**`
  (PROJECT-MANIFEST 9.2 WR-017; task-graph snapshot WS-33 owned_paths)
- Dependencies satisfied at build time: WS-02 (plugin manifest — version pinned
  1.0.0 from `plugins/candice-integration/.claude-plugin/plugin.json`), WS-06
  (app shell — dmg artifact + version 0.1.0 from `tauri.conf.json`). WS-16/WS-19
  pin records consumed for the speech-asset hashes; WS-23/WS-29 ownership
  respected (NO edits to packaging lanes).
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-33)

> WS-33 PASS: `CONTROL/bundled-components.json` (or equivalent) carries versions
> + SHA-256 checksums; downloads come only from operator-controlled locations;
> install is atomic; rollback works; downgrade rejected.

Leg evidence (this lane's write-glob legs; the manifest itself is a 9.4-owner
write — this lane proposes the fragment):

| Leg | Evidence |
|---|---|
| Versions + SHA-256 | `checksums/components.mjs` `PUBLISHED_PAYLOADS` — 7 payloads, every sha256 64-hex; 5 skill + plugin + app version pins in `REPO_TREE_COMPONENTS` matching tree VERSION files; `RUNTIME_PINS` (whisper.cpp 1.9.2, kokoro-onnx 0.6.1, onnxruntime 1.29.0, espeakng-loader 0.2.4, python 3.12) |
| Operator-controlled only | Every `sourceUrl` is `github.com/trevorotts1/999-setup/releases/...` or a pinned upstream release/HF repo-of-record; `download.mjs` refuses any other host before fetching; `no ad-hoc third-party URL` test green |
| Atomic install | `rollback/atomic-install.mjs` — stage → back up old → rename; marker check; journal |
| Rollback works | `atomic-install.mjs rollback` restores newest `.candice-backups/<name>.<ts>.backup`; 5 engine tests green |
| Downgrade rejected | `checksums/gate.mjs` — `candidate < installed` exits 1 unless `--allow-downgrade`; `isDowngrade`/`isNewer` unit-tested |

### Checksums verification record (2026-08-21, builder-run, primary source)

Direct downloads today, `shasum -a 256` compared to registry:

```
ggml-tiny.en-q5_1.bin        c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b  MATCH (32,166,155 B)
whisper-bin-x64.zip          49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a  MATCH (8,194,445 B)
whisper-bin-Win32.zip        de170719aebcb4794d695d449e179002db1fe03b862f21f5c34b2909a7cf8f22  MATCH (5,189,502 B)
kokoro-v1.0.fp16.onnx        f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96  MATCH (163,527,961 B)
voices-v1.0.bin              bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  MATCH (28,214,398 B)
Candice Companion_0.1.0_aarch64.dmg  938cb110de7685e937be86ab47702ae655ade2b4350bc6c8cb56fdc3c735f7bb  MATCH (2,686,857 B, this worktree's build artifact)
kokoro-v1.0.int8.onnx        ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c  (WS-19 verified record; same upstream release tag)
```

`verify.mjs --file` run against the four live-downloaded payloads (tiny.en,
x64 zip, kokoro fp16, dmg): all exit 0.

## Tests (run on this machine, Node v26.7.0)

```
node --test "scripts/candice-updater/**/__tests__/*.test.mjs"
ℹ tests 25  ℹ pass 25  ℹ fail 0
```

Coverage: registry integrity (64-hex, source-host allowlist, no ad-hoc URLs),
version math (compareVersions/isNewer/isDowngrade incl. `v1.0.1` prefix),
verifier fail-closed paths (corrupt/unknown/size), download-gate refusals
(unknown component, repo-tree component, usage error), atomic install (fresh,
replace-with-backup, marker-verify), rollback (restore, no-backup-fails-loudly).

## Deliverable files (all under the owned globs)

```
scripts/candice-updater/checksums/components.mjs        # registry + version math
scripts/candice-updater/checksums/verify.mjs            # SHA-256/size verifier
scripts/candice-updater/checksums/gate.mjs              # downgrade rejection gate
scripts/candice-updater/checksums/build-manifest.mjs    # bundled-components.json fragment emitter (proposal)
scripts/candice-updater/checksums/README.md
scripts/candice-updater/checksums/CHECKPOINT-WS33.md    # this file
scripts/candice-updater/checksums/__tests__/components.test.mjs
scripts/candice-updater/checksums/__tests__/verify.test.mjs
scripts/candice-updater/rollback/atomic-install.mjs     # atomic install + rollback engine
scripts/candice-updater/rollback/download.mjs           # operator-controlled download gate
scripts/candice-updater/rollback/README.md
scripts/candice-updater/rollback/__tests__/atomic-install.test.mjs
scripts/candice-updater/rollback/__tests__/download.test.mjs
```

## 9.4 / ownership discipline

- `CONTROL/bundled-components.json` NOT written — 9.4 shared class 3. The emit
  path is `node build-manifest.mjs --out <path>`; the 9.4 owner applies.
- Version files (`VERSION`, `package.json`, `tauri.conf.json`, plugin.json)
  NOT touched — 9.4 class 2; read-only inputs here.
- `.github/workflows/**`, repo-level `scripts/**`, `AGENT_INSTALL.md` untouched.
- No commit made. Backup dirs for pre-existing states created nothing here.

## Cross-lane findings

```
CROSS-LANE-FINDING
source lane: B-WS-33 (WR-017)
affected: 9.4 release owner (integration)
severity: medium
evidence: trevorotts1/999-setup has ZERO releases today (GitHub API,
  2026-08-21). `REPO_TREE_COMPONENTS` (5 skills + candice-integration plugin)
  therefore carry version pins + repo paths, NOT release-tarball hashes; the
  manifest's `channel.note` records this. At publish time the 9.4 owner must
  add tarball sha256/size to `components.mjs` PUBLISHED_PAYLOADS or the
  bundled-components.json `components.*[].sha256` fields.
recommended: before the first WS-31/WS-49 regression runs, publish a
  release with the 5 skill tarballs + candice-integration tarball and fill
  the payload records (the gate/verify machinery is in place and tested).
```

```
CROSS-LANE-FINDING
source lane: B-WS-33 (WR-017)
affected: WS-49 installer-regression (tests/installer-regression/**)
severity: low
evidence: `atomic-install.mjs` journal + backup naming documented in README
  (`<component>.<iso-timestamp>.backup`, `install-journal.jsonl`).
recommended: WS-49's injected-failure rollback fixture can drive this engine
  directly; named fixtures exist in rollback/__tests__.
```

```
CROSS-LANE-FINDING
source lane: B-WS-33 (WR-017)
affected: WS-32 existing-user upgrade
severity: informational
evidence: `gate.mjs --candidate --installed` is the downgrade primitive;
  `download.mjs` refuses repo-tree components (they are installed from the
  repo checkout, spec 21 first hop). WS-32's flow: check-update.sh → self-update
  → gate.mjs → download.mjs + atomic-install.mjs.
recommended: WS-32 wires these; no API change expected — the contracts are
  documented in both READMEs.
```

## FRESH RECHECK REQUIRED

Builder evidence only. Independent blind QC (sonnet/max) must re-verify before
the E.1 WS-33 box flips per the Box-flip rule.
