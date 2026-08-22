# CHECKPOINT — WS-47 upgrade/backward-compatibility fixtures

Lane: WR-020 / WS-47 (builder B-WR-020-WS-47, opus/max).
Owned glob: `tests/upgrade-fixtures/**` (PROJECT-MANIFEST 9.2 WR-020 row
line ~285; CONTROL/task-graph-snapshot.json WS-47 owned_paths; deps WS-32,
WS-34).
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`.
Date: 2026-08-21. No commit, no push (builder contract).

Dependencies consumed (all present and tested at build time):
- WS-32 `scripts/candice-upgrade/**` — `detect.mjs`, `upgrade.mjs`,
  `repair.mjs` (update detection + existing-user repair CLI)
- WS-34 `apps/candice-companion/src/preferences/migrations/**` +
  `tests/migrations/**` — versioned preferences chain (v1 -> v2 -> v3),
  store with future-doc preservation
- WS-31 `scripts/candice-bootstrap/**` — install engine, state, health
- WS-33 `scripts/candice-updater/**` — atomic-install + rollback engine,
  checksums registry (composition only, never re-implemented)
- spec 21 first hop: `.claude/skills/spec-protocol/tools/self-update.sh`
  (the existing updater, exercised for real)

## Files created (owned glob only — `tests/upgrade-fixtures/**`)

| File | Purpose |
|---|---|
| `upgrade-journey.test.mjs` | 9 tests — the six spec-27 legs: update detected, self-update safe, Candice installed, skills refresh, plain Claude untouched, rollback after injected failure |
| `backward-compat.test.mjs` | 10 tests — pre-versioned/dirty/protocol/future doc fixtures over the real WS-34 chain |
| `fixtures/documents.mjs` | backward-compat documents (pre-versioned, dirty, protocol, future-v9, v2, expected-v3) |
| `fixtures/versions.json` | published/old/newer version fixture values |
| `README.md` | lane doc, spec-21 proof matrix, engines under regression |
| `CHECKPOINT-WS47.md` | this file |

## Acceptance evidence (E.1 WS-47)

E.1 WS-47 PASS criterion: "upgrade fixtures prove old Spec Protocol -> new
bootstrap installs Candice, skills refresh, plain Claude config untouched,
rollback works after injected failure." Proof per spec-27 leg:

1. **Update is detected** — old fixture tree (spec-protocol 1.15.0) vs
   published 1.16.3 on a local 127.0.0.1 channel: `detect()` returns
   `status: "update"` with the installed version named. A failed instrument
   (closed port) returns `undetermined`, never "current" (negative-result
   contract). A machine already at published is `current` (spec 21 step 7
   fast path).
2. **Spec Protocol updates safely** — the REAL `tools/self-update.sh` runs
   against an old 1.15.0 tree with a local release tarball (curl stubbed to
   serve the tarball; the backup/extract/version-gate/replace/restore logic
   runs unmodified): exit 0, tree at 1.16.3, backup of the old tree at
   `spec-protocol.bak-v1.15.0-*` outside the config root, nothing else in
   the fixture home touched. A 2.0.0 tree refuses the downgrade (exit 2,
   "OLDER", tree intact).
3. **New bootstrap installs Candice** — `upgrade.mjs repair --offline` on an
   empty root: 13 components, plugin + skills + speech-asset records +
   `bootstrap-state.json` + `upgrade-journal.jsonl`; health reports all but
   the prebuilt app (zero GitHub releases today — fail closed, never faked).
4. **Skills refresh** — stale kaizen 0.9.0 upgraded to pin; ahead eli5 9.9.9
   never downgraded; state promotes only what was actually repaired.
5. **Plain Claude config untouched** — fixture `settings.json` +
   `.claude.json` byte-identical before/after repair; no file created under
   `~/.claude`; no `~/.claude-nine` (also asserted inside the self-update
   leg).
6. **Rollback after injected failure** — WS-33 atomic engine install of the
   new tree over old (backup created), injected failure (SKILL.md removed
   mid-life), `rollback --to` restores the exact old tree byte-for-byte.

Backward-compat (deps WS-34; spec 9 versioned profile): pre-versioned doc
(no schemaVersion) -> v1 -> v3 with defaults, lossless; dirty v1 repairs at
v1 then migrates; protocol `"1.0"` string doc resolves to v2 semantics,
fields survive; future v9 doc preserved untouched, disk byte-identical;
REAL WS-40 v1 full/partial fixtures migrate to the exact v3 output; v2->v3
rename `nameAskedAt` -> `nameAsked` byte-exact; corrupt profile reported
never overwritten; chain pure (writes nothing).

## Verified live (this worktree)

```text
$ node --test tests/upgrade-fixtures/*.test.mjs
tests 19 / pass 19 / fail 0   (9 journey + 10 backward-compat)

Dependency regression (no touch, re-run only):
  scripts/candice-upgrade/__tests__ 34/34 pass (WS-32)
  tests/migrations/migrations.test.ts 41/41 pass (WS-34)
  scripts/candice-bootstrap/__tests__ 23/23 pass (WS-31)
  tests/installer-regression/*.test.mjs 20/20 pass (WS-49)
  apps/candice-companion/tests/prefs/prefs.test.ts 29/29 pass (WS-40)

node --check clean on all three new modules.
```

## Hermeticity

Every fixture lives under mkdtemp; a fixture HOME stands in for the live
home directory. Nothing touches the real `~/.claude`, `~/.claude-nine`, or
any real config root. The published VERSION is served by a local
127.0.0.1 HTTP server; the self-update transport is a curl stub that hands
the script a local tarball. No external network. The only "live-channel"
read in the whole lane is none — the WS-32 lane's own live-channel CLI
smoke is its evidence; this lane's detection tests use the local channel
(control: a closed port yields undetermined, which proves the instrument
discriminates).

## Non-fabrication notes

- Every engine exercised is the real shipped surface; nothing is
  re-implemented here.
- The old skill trees are the real repo trees at an older VERSION (the
  exact fixture spec 27 prescribes: "old Spec Protocol installed").
- The prebuilt app leg is asserted absent (`state.components` has no
  `candice-companion`) because the operator has published zero releases —
  recorded, not faked (same WS-33 doctrine).
- The curl stub only replaces the transport; the script's real
  backup/gate/replace/restore logic runs unmodified against the stub's
  tarball.

## Cross-lane notes / proposals

- **CROSS-LANE-FINDING (to WS-27/WS-46):** the self-update leg is
  bash-only by design (the shipped `tools/self-update.sh`); the upgrade
  DETECTION and REPAIR are Node-only (WS-32) — the Windows-native parity
  requirement (spec 0.3) is satisfied by the Node surfaces, while the
  first-hop self-update remains the existing script's domain.
- The upgrade lane (WS-32) remains the owner of the repair CLI; this lane
  only drives it. All findings about upgrade behavior live in
  `scripts/candice-upgrade/CHECKPOINT-WS32.md`.

## FRESH RECHECK REQUIRED

Builder evidence only. Independent blind QC (sonnet/max) must re-verify
before the E.1 WS-47 box flips per the Box-flip rule.
