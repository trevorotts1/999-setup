# WS-47 — upgrade / backward-compatibility fixtures

Owned glob: `tests/upgrade-fixtures/**` (PROJECT-MANIFEST 9.2 WR-020;
task-graph snapshot WS-47 owned_paths; deps WS-32, WS-34).

Master Spec section 21 ("Existing user flow" + "Existing-user update
tests") and section 9 (versioned preferences). This lane proves the
**old-machine forward path** with hermetic fixtures:

| Spec 21 fixture | Proved here |
|---|---|
| old Spec Protocol installed | old skill tree fixture (VERSION `1.15.0`), real `tools/self-update.sh` run against it |
| Candice absent | bootstrap root empty before repair |
| older Kaizen/ELI5/Bro | stale/missing VERSION files in the old tree |
| update is detected | `upgrade.mjs check` / `detect()` verdict + exit codes |
| Spec Protocol updates safely | real `self-update.sh` replaces the old tree, backup created, newer gate enforced |
| new bootstrap installs Candice | `upgrade.mjs repair` through the WS-31/WS-33 engines |
| supported skills refresh | stale `kaizen` VERSION upgraded to pin |
| plain Claude settings untouched | `~/.claude/settings.json` / `.claude.json` absent from every write surface; test asserts no write in a fixture home |
| rollback works after an injected failure | WS-33 atomic engine: install → injected failure → rollback restores old tree byte-for-byte |

Backward-compatibility fixtures (deps WS-34, `tests/migrations/**`):

| Fixture | Proof |
|---|---|
| pre-versioned profile (no `schemaVersion`) | treated as v1, migrated with defaults, no crash |
| v1 dirty document (out-of-range) | repaired at v1 then migrated — no data loss of valid fields |
| protocol-shaped doc (`"1.0"` string) | never misread as runtime v1; fields survive |
| future document (v9) | preserved untouched, disk byte-identical (spec 20) |
| v2→v3 rename (`nameAskedAt` → `nameAsked`) | lossless, byte-exact mapping |
| v1 full/partial fixtures | byte-exact expected v3 output |

Never touches the live home directory, `~/.claude`, or any real config
root; no network; no commits/pushes (builder contract).

## Run

```bash
node --test tests/upgrade-fixtures/*.test.mjs
```

## The three engines under regression (composition only, never re-implemented)

| Engine | Owner |
|---|---|
| `scripts/candice-upgrade/{detect,upgrade,repair}.mjs` — update detection + repair CLI | WS-32 |
| `scripts/candice-bootstrap/{install,health,state,paths}.mjs` — install engine | WS-31 |
| `scripts/candice-updater/rollback/atomic-install.mjs` — atomic install + rollback | WS-33 |
| `scripts/candice-updater/checksums/components.mjs` + `verify.mjs` — payload records | WS-33 |
| `apps/candice-companion/src/preferences/migrations/**` — version chain | WS-34 |
| `.claude/skills/spec-protocol/tools/self-update.sh` — existing updater | spec 21 first hop |

These lanes were themselves tested by their owning lanes (WS-32 34/34,
WS-34 41/41, WS-49 suite); this lane is the end-to-end fixture view over
their real surfaces.
