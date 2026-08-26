# WS-49 BUILD CHECKPOINT — installer/updater regression and rollback validation

- Builder: WS-WS-49 (opus/max), W3 build, worktree lane WR-021
- Date: 2026-08-21
- Worktree: `/Users/blackceomacmini/Downloads/999-setup/worktrees/wr001-bootstrap`
- Branch: `candice/wr001-bootstrap` @ aa23ed9 (base 6bb00ec)
- Ownership: `tests/installer-regression/**`
  (PROJECT-MANIFEST 9.2 WR-021; task-graph snapshot WS-49 owned_paths)
- Dependencies satisfied at build time: WS-31 (bootstrap engines), WS-33
  (updater engines: atomic-install/download/verify/gate/components),
  WS-23/WS-29 (packaging surfaces asserted statically). WS-32 (upgrade
  orchestrator) NOT built at build time — detection + mechanics regressed,
  orchestrator deferred (recorded below).
- Not committed, not pushed (per fan-out rule).

## Acceptance criterion (CONTROL/CHECKLIST.md E.1 WS-49)

> WS-49 PASS: installer/updater regression suite green — update detection,
> checksum verification, atomic install, backup, rollback, uninstall cleanup.

## Leg evidence

| Leg | Suite | Proven against |
|---|---|---|
| update detection | `update-detection.test.mjs` | `checksums/gate.mjs` (newer accepted, equal accepted, downgrade exit 1, `--allow-downgrade` override); `components.mjs` `isNewer`/`isDowngrade`/`compareVersions` (incl. `v1.0.1` prefix + single-component); WS-31 `health.mjs` reports stale skill as stale (never false-healthy) and missing components in `missing`; repo-tree pins match tree `VERSION` files (1.17.0/1.17.0/1.1.0/1.1.0/1.1.0) |
| checksum verification | `checksum-verify.test.mjs` | `verify.mjs` exit 0 on hash+size match; bit-flipped payload exit 1; registry-lookup path rejects wrong bytes; unknown component refused (fail closed); `download.mjs` refuses unverifiable payload before anything lands on disk; registry integrity — all 7 published payloads 64-hex sha256 + sizeBytes + operator-controlled https source |
| atomic install | `atomic-install.test.mjs` | `rollback/atomic-install.mjs` — fresh install + journal; replace install backs old tree up (outside config root) then atomic swap; missing staged dir fails WITHOUT touching existing target (no half-state) |
| backup | `atomic-install.test.mjs`, `full-journey.test.mjs` | backup lands in `dirname(target)/.candice-backups/<name>.<ts>.backup`; single backup per replace; old content byte-restored |
| rollback | `atomic-install.test.mjs`, `full-journey.test.mjs` | `atomic-install.mjs rollback` restores newest backup; no-backup case exits 1, target intact; journal kept for recovery contract; consumed backup entry gone |
| uninstall cleanup | `uninstall-cleanup.test.mjs` | full install-root removal (skills/plugin/app/assets/state/staging/backups/stale temp); partial install cleaned; Windows surface: WS-29 `installerHooks.nsh` defines `NSIS_HOOK_PREUNINSTALL`/`NSIS_HOOK_POSTUNINSTALL` + `RmDir /r "$LOCALAPPDATA\${BUNDLEID}"`; `nsis-policy-audit.mjs` requires both macros |
| end-to-end journey | `full-journey.test.mjs` | bootstrap -> health -> update (atomic replace) -> rollback (pinned version restored) -> uninstall, one hermetic root |

## Test run (Node v26.7.0, this machine)

```
node --test "tests/installer-regression/*.test.mjs"
ℹ tests 20  ℹ pass 20  ℹ fail 0

node --test "scripts/candice-bootstrap/**/__tests__/*.test.mjs" "scripts/candice-updater/**/__tests__/*.test.mjs"
ℹ tests 48  ℹ pass 48  ℹ fail 0   (WS-31/WS-33 dep lanes — no cross-lane regression)
```

## Scope notes / findings (honest)

1. **WS-32 not built at build time.** `scripts/candice-upgrade/**` is absent
   (WR-017 WS-32 is a later wave, L4). This lane regresses the detection +
   mechanics its orchestration calls — version gate, checksum gate, atomic
   engine, rollback — not the orchestrator itself. CROSS-LANE-FINDING to the
   conductor: WS-32 integration must re-run this suite once its lane lands
   (suite is a pure consumer; no changes expected).
2. **No shared uninstall ENGINE in the updater scripts.** The bootstrap
   glob has none; the atomic engine has no `uninstall` op. The harness
   implements the documented contract (full install-root removal; Windows
   NSIS default uninstall section) in `helpers.mjs` `uninstall()` so cleanup
   semantics are proven today. If WS-32 builds a real uninstall engine, it
   should live under `scripts/candice-updater/**` (WS-33-adjacent ownership)
   and this suite should be pointed at it. Finding recorded, not acted on
   (outside this lane's owned glob).
3. macOS app-leg skip in offline journey is by design (`install.mjs` skips
   unverifiable legs, never invents) — regression asserts the skip is
   RECORDED, not silent.
4. Suite is hermetic: `mkdtemp` only; no live-home writes; no network.
