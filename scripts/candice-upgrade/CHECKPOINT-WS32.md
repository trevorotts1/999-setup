# CHECKPOINT — WS-32 existing-user upgrade bootstrap

Lane: WR-017 / WS-32 (builder B-WR-017-WS-32, opus/max, W3-chained).
Owned glob: `scripts/candice-upgrade/**` (PROJECT-MANIFEST 9.2 WR-017
row line 278; CONTROL/task-graph-snapshot.json WS-32 owned_paths).
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`.
Date: 2026-08-21. No commit, no push (builder contract).

Dependencies consumed (all present at build time): WS-31 fresh-install
bootstrap (`scripts/candice-bootstrap/**` — install engine, state, paths,
health), WS-33 registry+engine (`scripts/candice-updater/**` — download
gate, atomic install + rollback, downgrade gate), WS-34 migrations
(`apps/candice-companion/src/preferences/migrations/**` — read-only input,
none consumed at runtime by this lane; the upgrade lane is version-agnostic
about the preferences schema).

## Files created (owned glob only — `scripts/candice-upgrade/**`)

- `upgrade.mjs` — CLI: `check` / `repair` / `--health` (exit 0/1/2)
- `detect.mjs` — update detection (spec 21 step 1): installed
  spec-protocol VERSION(s) vs published VERSION; NEVER "current" out of a
  failed instrument
- `repair.mjs` — repair engine: enumerate -> plan -> apply (WS-31/WS-33
  composition) -> state + journal persist
- `README.md` — lane summary, WS-31/WS-33 seams, run/test commands
- `__tests__/detect.test.mjs` — 14 tests
- `__tests__/upgrade.test.mjs` — 14 tests
- `__tests__/cli.test.mjs` — 6 tests

## Acceptance evidence (E.1 WS-32 legs)

E.1 WS-32 PASS criterion: "existing-user update detects newer Spec Protocol,
self-updates safely, installs missing/stale Candice components on next
invocation, refreshes stale skills; plain `claude` settings untouched."

1. **Update detected** — `detect.mjs` compares every installed config root's
   spec-protocol VERSION against the published VERSION on the
   operator-controlled channel (`raw.githubusercontent.com/trevorotts1/
   999-setup/main/.claude/skills/spec-protocol/VERSION`). Root discovery
   mirrors `tools/check-update.sh`: primary `~/.claude/skills`, second root
   `~/.claude-nine/skills` only when `.claude-nine/.claude.json` exists.
   Same numeric field-by-field compare as `newer_than`. Unreadable installed
   VERSION -> UNKNOWN -> update required (self-update.sh 0.0.0 precedent).
   Network/HTTP/non-version failures -> UNDETERMINED (exit 2), never
   "current" (checked in tests with a failing stub, non-2xx stub, HTML stub).
   Live CLI run on this box: exit 0 "OK current — installed spec-protocol is
   1.16.3".
2. **Self-updates safely** — the upgrade lane deliberately does NOT
   re-implement the spec-protocol tree replacement: the existing
   `tools/self-update.sh` owns that (it backs up the whole tree, restores on
   failure, never downgrades). This lane's `check` reports the verdict and
   the next supported invocation runs `repair`. The WS-33
   `atomic-install.mjs` engine (with its own backup/rollback) is used for
   the Candice tree installs inside the bootstrap root.
3. **Installs missing/stale Candice components on next invocation** —
   `repair.mjs` enumerates the installed tree (5 skills, plugin,
   kaizen/eli5/bro integrations, app, 3-4 speech assets), plans
   install/upgrade/ahead/current, and applies through the WS-31 install
   engine + WS-33 gates. Proven end-to-end: empty root -> `repair` installs
   all 13 components (offline record mode, `--root` fixture), `--health`
   after repair reports every component except the prebuilt app
   (fail closed: `trevorotts1/999-setup` has zero releases, WS-33 verified —
   the app leg is SKIPPED and reported, never invented).
4. **Stale skills refresh** — a stale skill VERSION (kaizen 0.9.0 vs pin
   1.0.1) is upgraded from the repo checkout through the WS-33 atomic
   engine; the replaced tree is backed up and `atomic-install.mjs rollback`
   restores the exact old tree (proven live, exit 0). A skill newer than the
   pin is never downgraded (proven: eli5 2.0.0 stays 2.0.0).
5. **Plain `claude` settings untouched** — this lane never writes
   `~/.claude/settings.json`, `.claude.json`, or any settings file; the
   state doc + backups live inside the bootstrap root
   (`<root>/state/`, `<target>/../.candice-backups/`). No provider/model
   routing is touched (spec 22 rules). Test: `repair` on the operator's
   default root was NOT run — every test uses `--root` fixtures; the only
   live-touching call was `check` (read-only).

## Verified live (this machine)

- `node --test "__tests__/*.test.mjs"` -> **34/34 PASS, 0 fail** (node
  v26.7.0): 14 detect + 14 upgrade + 6 cli.
- CLI smoke: `check` -> `OK current` exit 0 (live channel); `repair
  --offline --root <tmp>` -> `OK repaired 13 component(s)` exit 0;
  `--health` -> 9/10 OK, app MISS (fail closed), exit 1; `--simulate` ->
  plans, writes nothing, exit 0.
- WS-33 rollback seam proven live: stale kaizen repair created
  `kaizen.<ts>.backup` under `.candice-backups`; `atomic-install.mjs
  rollback --to <skills>/kaizen` restored the pre-repair tree byte-for-byte,
  exit 0.
- `node --check` clean on all `.mjs` modules.
- Detection checked against the live operator channel with a known-good
  control: this box's installed spec-protocol 1.16.3 == published 1.16.3
  -> `current`, exit 0 (not a false negative; the channel is reachable and
  the control proves the instrument).

## Cross-lane notes / proposals

- **Integration versions (spec 21 step 3d):** this lane checks
  `plugins/candice-integration/integrations/{kaizen,eli5,bro}/README.md`
  presence. The implementations are WS-37/WS-38/WS-39-owned; today only
  `bro/` exists in the repo checkout (WS-39 built). Missing integrations are
  repaired by re-installing the plugin tree from the checkout — the
  deterministic bundle path (spec 21 step 5). When WS-37/38 land, the pins
  in `repair.mjs` `INTEGRATION_PINS` should be confirmed against their
  version records.
- **Prebuilt app payload:** same as WS-33 CROSS-LANE-FINDING — the app leg
  is unverifiable until the operator publishes `Candice Companion_0.1.0_
  aarch64.dmg` (sha256 938cb110…) on GitHub Releases. Until then the repair
  SKIPS it and `--health` reports MISSING. Not fabricated.
- **AGENT_INSTALL.md proposal (9.4 item 1 class — proposal only):** the
  existing-user orchestrator step should run `node
  scripts/candice-upgrade/upgrade.mjs check` (act on exit 1 by offering the
  self-update), then `repair`, then `--health` (fail the setup if the
  health check exits non-zero) — after the WS-31 fresh-install block in
  `AGENT_INSTALL.md` section 8b (proposed text in
  `scripts/candice-bootstrap/CHECKPOINT-WS31.md`).
- **Bundled component manifest (9.4 owner):** this lane reads pins from
  WS-31 constants / WS-33 registry, never writes
  `CONTROL/bundled-components.json` (9.4 class 3).
- **Windows parity:** the upgrade is Node-only (no Bash requirement) —
  `detect.mjs` uses `fetch`; `repair.mjs` uses the same WS-31/WS-33 engines
  that are shell-agnostic. Win32 app placement stays NSIS-owned (WS-29),
  recorded not faked (test proves win32 enumerate + repair).

## Non-fabrication notes

- Every payload hash, pin, and version used here is read from the WS-31
  constants / WS-33 registry — live-verified by those lanes on 2026-08-21.
  This lane downloaded nothing; its "download" path is exercised by the
  WS-33 download-gate tests and WS-31 integration tests (fail-closed
  refusals).
- The published-version check is a real network read against the
  operator-controlled channel, proven live with the current-match control
  above.

## FRESH RECHECK REQUIRED

Builder evidence only. Independent blind QC (sonnet/max) must re-verify
before the E.1 WS-32 box flips per the Box-flip rule.
