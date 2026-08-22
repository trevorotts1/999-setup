# Candice existing-user upgrade (WS-32)

Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017;
task-graph snapshot WS-32 owned_paths).

Implements the **existing-user repair mechanism** (Master Spec
section 21, E.1 WS-32): a machine that already has an older Spec Protocol
moves forward safely —

1. the old Spec Protocol detects that the published version is newer,
2. its existing `tools/self-update.sh` replaces the Spec Protocol skill tree,
3. **on the next supported skill invocation, `candice-upgrade repair`
   checks the Candice components** (plugin, app, speech assets,
   Kaizen/ELI5/Bro integrations). It fails before any repair/state write
   while the app has no release-authorized candidate; a local app is reported
   untrusted rather than current or repairable,
4. stale supported skills refresh through the deterministic bundle path,
5. the user never copies files around,
6. after a future fully authorized repair, normal invocations run the **fast
   health/version check only** (`--health`, spec 21 step 7).

The fresh-install leg is WS-31 (`scripts/candice-bootstrap/**`); checksums,
atomic install and rollback are WS-33 (`scripts/candice-updater/**`). This
lane composes those engines through their CLI/import contracts — it never
re-implements checksumming, atomicity, or payload records.

## Commands

```
node scripts/candice-upgrade/upgrade.mjs check    # update detection (spec 21 step 1)
node scripts/candice-upgrade/upgrade.mjs repair   # currently fails closed: no authorized app candidate
node scripts/candice-upgrade/upgrade.mjs --health # fast health/version check (step 7)
```

Options: `--offline` (record-only asset metadata, no downloads — registry
hashes were live-verified by WS-33), `--root <dir>` (install root override,
tests), `--simulate` (plan only, write nothing).

Exit codes: `0` OK; `1` repair/health failure, or update available for
`check`; `2` usage or UNDETERMINED for `check`.

`check` exit codes: `0` current, `1` update available, `2` undetermined —
**never "current" out of a failed instrument**: a network failure, a
non-2xx page, or an unparseable published version reports UNDETERMINED, not
current (same contract as `tools/check-update.sh`).

## Files

| File | Purpose |
|---|---|
| `upgrade.mjs` | CLI entry: `check` / `repair` / `--health`. |
| `detect.mjs` | Update detection: installed spec-protocol VERSION(s) vs the published VERSION on the operator-controlled raw channel. Reads only, never writes. |
| `repair.mjs` | Repair engine: enumerate -> block untrusted/unavailable app before writes -> otherwise plan/apply through WS-31/WS-33 -> persist state + journal. |
| `__tests__/detect.test.mjs` | 14 tests: version math, root discovery, live-channel stubs (update/current/ahead/unknown/undetermined). |
| `__tests__/upgrade.test.mjs` | 8 tests: blocked/untrusted app enumeration, planning, direct repair refusal, and no partial state. |
| `__tests__/cli.test.mjs` | 5 tests: exit codes, release-blocked repair/simulation, no writes, and health. |

Run all tests:

```
node --test "scripts/candice-upgrade/__tests__/*.test.mjs"
```

## The WS-31/WS-33 seams

- Detection (`detect.mjs`) reads the same VERSION files and uses the same
  numeric field-by-field compare as `tools/check-update.sh` /
  `tools/self-update.sh` (bash-3.2 `newer_than` semantics), so the upgrade
  verdict matches what the existing self-update machinery would conclude.
- `repair.mjs` imports the WS-31 install engine directly
  (`installSkills` / `installPlugin` / `installApp` / `installAssets`) —
  skills/plugin/integrations install from the repo checkout (spec 21 first
  hop), speech assets go through the WS-33 download gate with SHA-256
  verification, and `installApp` refuses until a candidate has independent
  release authority.
- Skills/plugin installs run the WS-33 atomic engine (`atomic-install.mjs`):
  stage -> back up old -> atomic rename -> marker verify -> journal. A
  replaced tree's backup lives at `<target>/../.candice-backups/`, outside
  Claude config roots, and `atomic-install.mjs rollback --to <target>`
  restores it (proven live on this lane: stale kaizen upgraded, rollback
  restored the exact old tree, exit 0).
- The installed-tree state doc (`<root>/state/bootstrap-state.json`,
  schema `candice.bootstrap.state/v1`, written by the WS-31 state module)
  records every fully authorized repaired component version + asset sha256 + launch metadata.
  This lane also appends `<root>/state/upgrade-journal.jsonl` per repair.
- The quarantined app is a **hard repair block**, not a skipped leg. This
  avoids a falsely successful partial repair or a caller-supplied bundle.

## Guarantees

- Never downgrades an installed component (WS-33 gate semantics; a component
  newer than the pin is reported `ahead` and untouched).
- Never touches `~/.claude` settings.json / `.claude.json`, never changes
  model/provider routing, never converts plain `claude` into a routed
  launcher (spec 22 rules). Skills stay visible to both `claude` and
  `claude-nine` through the shared config root — the 9.4 integration owner's
  linking decision, proposed not applied.
- All paths derive from `HOME` / `LOCALAPPDATA` at runtime (spec 24: no
  operator-specific absolute path).
- Detection contacts ONLY the operator-controlled published VERSION
  (`raw.githubusercontent.com/trevorotts1/999-setup/main/...`); downloads
  only operator-controlled payloads with SHA-256 verification.
