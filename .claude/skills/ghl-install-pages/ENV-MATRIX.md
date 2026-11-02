# Skill 6 — ENVIRONMENT MATRIX (999 harness form)

This is the pinned, testable contract for running Skill 6 in the Claude Code
harness (claude-nine). It documents what the code in
`tools/browser_manager.sh` / `tools/browser_manager.py` actually does in this
harness and names the ONE canonical detection/portability primitive per
dimension so no new tool ever re-implements its own, drifting, environment
check.

HISTORY: on the OpenClaw side this matrix pinned a VPS-vs-Mac duality
(durable roots at `/data/.openclaw` vs `~/.openclaw`, launchd vs pm2/systemd
supervision, Docker env-file traps). That duality does not exist in this
harness. The rows below are the harness form; the historical matrix is
recorded in the skill CHANGELOG and in the source-side spec
(`SKILL-6-BROWSER-CONTROL-BULLETPROOF-SPEC-v1.md` §4), which is not part of
this pack copy.

| Dimension | This harness | Canonical primitive |
|---|---|---|
| Durable root detection | (1) `BM_DURABLE_ROOT_OVERRIDE` when set (test isolation, verbatim, including empty), else (2) `$GHL_DURABLE_ROOT`, else (3) the skill's own `state/` directory inside `.claude/skills/ghl-install-pages/` | shell: `_bm_durable_root()` (`tools/browser_manager.sh`); python: `browser_manager.durable_root()` — both implement the same three-step binding and are proven to agree by `tests/test_env_matrix.py` |
| Browser launch | agent-browser headless via the harness browser-engine contract (claude-nine mapping); headed is forbidden (D6, exit 75) | `bm_require_current_guard()` / `headless_guard()` |
| Display / Xvfb | Not used — agent-browser's headless Chromium needs no X server | n/a — headless-only design |
| Locking | `flock` when present, else atomic-`mkdir` lock + dead-PID stale reclaim | `_bm_lock_acquire()` — probes `command -v flock` at call time, falls back to `mkdir "$LOCKDIR/ab.lock.d"` with PID-liveness stale reclaim. Both paths exercised by `tests/test_env_matrix.py` |
| bash version / builtins | Scripts must run under the operator's stock shell, including bash 3.2 (`/bin/bash` on stock macOS: no `mapfile`/`readarray`, no `declare -A`, no `${var,,}`/`${var^^}`, no `wait -n`) | Every `.sh` file under this skill's `tools/` and `scripts/` stays bash-3.2-safe; `tests/test_env_matrix.py::TestBash32Safety` enforces it by static scan plus `bash -n` / `--selftest` under `/bin/bash` |
| BSD vs GNU grep | The operator's machine may carry either; scripts assume neither | Every `grep` invocation is `grep -E` / `grep -F` / `grep -q` / `grep -o` with a POSIX-portable pattern — zero `grep -P`. Richer parsing delegates to `python3 -c` (JSON-aware) rather than a GNU-only flag |
| Supervision | None. Browser sessions are launched per run by the harness and reaped under Item 33 browser hygiene (the signature-page skill's `scripts/browser_sessions.py` registry + reaper, receipt before close) | `browser_manager.supervisor()` returns `"none"` — informational only, never used for control flow |
| Env stores | The install's secrets env_file: the file `$SECRETS_ENV` designates when set, else already-exported process environment variables. Variable names are the ADAPTER contract's: `GOHIGHLEVEL_API_KEY` (+ aliases) for the PIT, `GOHIGHLEVEL_LOCATION_ID` (+ aliases) for the location, `GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN` (+ aliases, Skill 44 workflow writes only) | Skill 6 reads credentials from **already-resolved process env** (`os.environ`) — it does not walk an alias × store resolution chain itself; that happens upstream (Skill 44's `tools/engine/wire-ghl-env.sh` in this pack performs the file-first resolution) |
| Docker env-file / workdir | Not applicable in this harness: no container runtime is assumed, and no compose lifecycle exists here. The stale-env preflight (`browser_manager.py::stale_env_preflight()`, shell mirror in `browser_manager.sh`) is retained but structurally inert: `is_vps()` is always False here, so it stays silent | Advisory WARN only where it can ever fire; hermetic tests: `tests/test_b_u15_env_matrix_live_proof.py::TestStaleEnvPreflight*` |
| Session persistence | `~/.agent-browser/` profile + `state save` files persist across runs on the operator's machine | `AB_REAPER_PLAYWRIGHT_DIR` scopes the reaper's cleanup. (The OpenClaw-side VPS mount-survival proof pair is not part of this harness's contract; see the fifth-seam note below.) |
| Ownership | No chown step exists in this harness: the in-tree `state/` dir is created and owned by the install user (the source VPS layout needed a chown of the /data volume to the container user; there is no volume here) | `browser_manager` creates `PARK_DIR` mode 700 under the durable root |
| TMPDIR | Wiped on boot on the operator's machine | This is exactly why `PARK_DIR`/receipts/durable state live under `durable_root()`, never under `$TMPDIR`/`$LOCKDIR` — a PARK marker that silently vanished on reboot would un-park a qc-failed build with no operator action. `PARK_DIR` is `<durable root>/workspace/.park` (the `workspace/.park` subpath is a cross-tool contract read by resume tooling) |

## Capability classes (host capability → build method)

`tools/capability_probe.py` probes the host and emits JSON to
`working/skill6-capability.json` — that probe JSON is the RUNTIME source of
truth for which lane a build takes; this matrix remains the binding ENV
contract (the `durable_root()`, bash-3.2, and headless-only rows above are
unchanged by the lane model). Lane table: SKILL.md "Adaptive browser lanes".

| Capability class | Host has | Build method |
|---|---|---|
| standard | agent-browser only (no Playwright) | agent-browser only (Lane 1); cross-origin drag features GATED — they need the hybrid |
| full | agent-browser + Playwright | agent-browser PRIMARY + Playwright CDP hybrid for iframe drag/drop (Lane 1b) |
| managed (Lane 2) | n/a in this harness | The OpenClaw managed browser does not exist in claude-nine. The probe reports the lane structurally absent and never selects it; `tools/openclaw_browser_adapter.sh` refuses every verb with exit 75 and the harness reason |
| future | CUA plugin present | CUA — NOT in Skill 6 yet; future last resort only |

## Adaptation contract (binding for every future Skill-6 change)

1. **Detect environment ONLY via `durable_root()`** (`browser_manager.py`) or
   `_bm_durable_root()` (`browser_manager.sh`) — never a new hand-rolled
   host check. Both implement the override → `GHL_DURABLE_ROOT` → in-tree
   `state/` binding, and are proven to agree by `tests/test_env_matrix.py`.
2. **No `flock`/`timeout`/GNU-only assumptions** — reuse the existing
   portable primitives (`_bm_lock_acquire`'s flock-or-mkdir branch, the
   `command -v timeout` guard in `AB()`). Do not add a new lock or a new
   timeout wrapper elsewhere in the skill.
3. **All `.sh` files stay bash-3.2-safe.** Banned builtins/constructs in any
   `tools/*.sh` or `scripts/*.sh` file in this skill: `mapfile`, `readarray`,
   `declare -A` / `local -A`, `${var,,}`, `${var^^}`, `wait -n`. Use
   `while IFS= read -r line; do arr+=("$line"); done` for
   array-from-command-output, `tr '[:upper:]' '[:lower:]'` for case-folding,
   and a polling loop in place of `wait -n`.
   `tests/test_env_matrix.py::TestBash32Safety` enforces this.
4. **Run evidence lives under the run-evidence root; PARK/breaker state lives
   under `durable_root()`** — never under `$TMPDIR`. (F6 receipts already
   follow this via the caller-supplied `evidence_root`; `PARK_DIR` already
   follows this via `_bm_durable_root`.)
5. **The first-hour ground truth (spec §9.4) is run in this harness** before
   any fix in this family is declared ready: `tools/ghl_env_matrix_ground_truth.py`
   defines the receipt shape a fixture build (dispatch → build → verify →
   FAB-QC) emits (`GROUND_TRUTH_REQUIRED_FIELDS`) and
   `compare_ground_truth()` / `assert_ground_truth_parity()` prove two
   receipts BOTH show the harness resolution (matching harness-form
   `durable_root()`, `is_vps()` False, `supervisor()` "none", both builds
   actually PASS-ing FAB-QC ≥ 8.5, non-zero object receipts on each — never
   a vacuous "looks fine"). `run_fixture_ground_truth()` /
   `ghl_env_matrix_ground_truth.py run --evidence-root <dir>` is the
   EMITTER half: it drives `v2_dispatcher.dispatch_one()` through a
   deterministic, no-network fixture build and writes a `compare()`-ready
   receipt. Its `fab_qc_score`/`fab_qc_gate` are an HONEST FIXTURE
   PLACEHOLDER (own `fab_qc_note` field says so) — the fixture build never
   runs a real FAB-QC pass. Running the SAME `run` command with a real
   builder/verifier against a designated GHL test location is OPERATOR-RUN
   and OWED — this build never fabricates that live receipt.
6. **Durable state lives only under `durable_root()`-derived roots
   (S06-05).** Run state resolves via `ghl_run_state.default_state_root()`
   (`<durable_root()>/skill6-runs`, `GHL_RUN_STATE_ROOT` override first);
   the per-page ledger resolves via `ghl_builder.ledger_root()`
   (`<durable_root()>/skill6-ledgers`, `GHL_LEDGER_ROOT` override first).
   `/tmp` is a labelled ephemeral fallback only (bare checkout, no durable
   root), never a silent home for durable state: on a VPS `/tmp` is tmpfs
   and dies on recreate. Pre-S06-05 state under the old roots stays
   resumable via repair-in-place read fallbacks (SK6002), never a silent
   move. Provisioning shape is verified, per box, by
   `tools/ghl_vps_provision_check.py` against the provisioning contract
   below.

## Fifth-seam note (host services)

The OpenClaw-side VPS mount-survival proof pair
(`tools/ghl_vps_mount_proof.py`, `scripts/vps-mount-proof.sh`) and the
host-scheduling registrations this skill historically installed are host
services / host scheduling: the fifth-seam candidate, which is OUT of this
pack adaptation build pending the owner's plan-amendment decision. Those
files are carried in this copy unadapted and marked blocked-on-fifth-seam
in the build's adaptation status; nothing in the harness contract above
depends on them.

## What the envmatrix unit changed (offline-only — no live browser, no GHL write)

- **Fixed a real bash-3.2 incompatibility**: `tools/parallel_saves.sh`'s
  `ps_run_batch` used `mapfile -t` to build its page-spec array. Verified
  live that stock `/bin/bash` (3.2.57) does not have `mapfile` at all — a
  stock-`PATH` run would have crashed every batched parallel-save run.
  Replaced with a portable `while read -r` loop; re-verified end-to-end
  (stub `agent-browser`, real JSON spec file, both `/bin/bash` and Homebrew
  `bash`) — identical output, identical exit code, both shells.
- **Added `browser_manager.py::durable_root()` / `is_vps()` / `supervisor()`** —
  the Python-side mirror of `_bm_durable_root()`. In this harness form:
  `durable_root()` implements the three-step binding, `is_vps()` is always
  False, `supervisor()` returns "none".
- **This document** — the single place the matrix + the adaptation contract
  live inside the skill (previously only in the external spec file), so a
  future contributor does not have to re-derive it.

## B-U15 — ENV-MATRIX live proof: the ASSUMED VPS mount row + first-hour ground truth + stale-env preflight

Builds on the `envmatrix` unit above (which SHIPPED the matrix + Python
mirror + bash-3.2 fix). This unit is the live-proof layer for the matrix's
one remaining `[ASSUMED, spec-carried]` row plus two contract items that were
prose-only before now:

- **Item 1 (VPS mount row) — mechanism shipped, live round trip owed.**
  `tools/ghl_vps_mount_proof.py`: `classify_mount()` (parse the mount table,
  distinguish an ephemeral `overlay`/`aufs`/`tmpfs` container layer from a
  real bind/volume mount — injectable reader, hermetic), `write_marker()` /
  `verify_marker()` (the actual proof-by-survival: stamp a run-id-tagged
  marker into the path, read it back after whatever happened in between),
  `build_receipt()` / `write_receipt()` (the single
  `routing/vps-mount-receipt.json` artifact recording the mount type — never
  upgraded to a PASS on a `post=None` partial). `scripts/vps-mount-proof.sh`
  is the live orchestration wrapper (`--live --path ... --run-id ...
  --compose-file ...`: marker → `docker compose up -d --force-recreate` →
  marker verify → receipt) — mirrors `run-selector-drift-probe.sh`'s
  offline-default / `--live`-is-operator-run shape exactly, and REFUSES
  (exit 3) rather than fabricate a pass when no real `docker` binary or
  compose file is reachable. **Owed**: the actual live run on a real VPS
  (spec §9.4 step 10).
- **Item 2 (first-hour ground truth) — schema + comparator + OFFLINE/FIXTURE
  emitter shipped, live runs owed.** `tools/ghl_env_matrix_ground_truth.py`:
  the ground-truth receipt schema plus `compare_ground_truth()` /
  `assert_ground_truth_parity()` (see adaptation contract item 5 above for
  the full field list and checks) PLUS `run_fixture_ground_truth()` / the
  `run` CLI subcommand, which actually drives `v2_dispatcher.dispatch_one()`
  through a deterministic fixture build and writes a receipt in the exact
  shape the comparator consumes (proven wired end-to-end: `tests/test_b_u15_env_matrix_live_proof.py::TestGroundTruthEmitter::test_emitted_receipt_feeds_compare_and_passes`
  emits a fixture Mac receipt + a fixture VPS receipt and confirms
  `compare_ground_truth()` reports real parity). **Owed**: running this same
  `run` command, unmodified, end-to-end on one real Mac and one real VPS
  (real builder/verifier against a designated GHL test location swapped in
  for the fixtures) to produce the two LIVE receipts this compares.
- **Item 3 (stale-env preflight) — fully shipped, no live leg.**
  `browser_manager.py::stale_env_preflight()` / `browser_manager.sh
  ::bm_stale_env_preflight()` (wired into `bm_ensure()` — see the "Docker
  env-file / workdir" row above). Every input is injectable, so "fires on a
  seeded stale `.env`, silent otherwise" (this unit's BINARY acceptance (d))
  is fully hermetic — no live leg outstanding for this item.

All three mechanisms are covered by
`tests/test_b_u15_env_matrix_live_proof.py` (hermetic, no network, no Docker,
no live browser) plus the pre-existing `tests/test_env_matrix.py` (still
green, unmodified acceptance).

## VPS provisioning contract (S06-05)

The contract a VPS/container box is provisioned to, and the shape
`tools/ghl_vps_provision_check.py` verifies. Names, paths, modes, and
identities only: no credential value is ever written in this contract, in
a receipt, or in a repair string.

### The permission split (Q1, decided by S06-04's landed code)

* The shared resolver (`tools/ghl_secret_resolver.py`) owns the READ-TIME
  refusal: a `*_FILE` target that is missing, unreadable, empty, or
  carries any group/other permission bit (`mode & 0o077`) fails loud at
  resolution time, naming the variable, the path, and the mode only.
* The provisioning verifier (`tools/ghl_vps_provision_check.py`) owns the
  PROVISIONING verdicts the resolver does not make: existence, owner UID
  vs the service/process UID, the runs-as-root check, directory modes,
  mount classification, and the storage label. Every repair it names
  NARROWS access (`chmod 600` / `chmod 700` / `chown` to the service UID);
  no repair ever widens a mode to compensate for an ownership mismatch.

### Secret-file layout (outside the repo, per fleet type)

The three `*_FILE` variables are `GHL_REFRESH_TOKEN_FILE`,
`GHL_LOCATION_PIT_FILE`, and `GHL_LOCATION_ID_FILE` (the location-ID file
is held to the same mode refusal as the two secret files). The canonical
env stores are the resolver's `ENV_STORES`
(`~/.openclaw/secrets/.env`, `~/clawd/secrets/.env`,
`~/.openclaw/workspace/.env`); the first store is also the Tier-2
self-heal's live read/write target, so its persistence and permissions
matter like any secret file's. Secret files are mode 0600, their
directories mode 0700, owned by the identity the service runs as.

| Fleet type | Layout |
|---|---|
| fleet-mac | No container. Stores at `~/.openclaw/secrets/.env` (0600, dir 0700, owned by the operator user the service runs as). `*_FILE` optional; when used, targets live under `~/.openclaw/secrets/` with the same modes. Durable root: `~/.openclaw`. |
| fleet-hostinger | One client per VPS, OpenClaw inside Docker. Host project dir (`/docker/<project>/`) holds the compose file and host `.env`; secret files live in a host directory mounted READ-ONLY into the container (the Docker-secrets shape, e.g. under `/run/secrets`, or a dedicated mount on the persistent volume), named by the three `*_FILE` variables. The container service runs as the non-root `node` user, which owns the files (0600) and directories (0700). Durable root: `/data/.openclaw` (the volume), never the container layer. |
| fleet-contabo | Trevor's one server sliced into per-client Docker containers; each container is a complete, separate OpenClaw installation for ONE client. Each container gets its OWN host-side secrets directory and its OWN read-only mount, exactly as fleet-hostinger; nothing is shared between containers. Durable root: whatever `durable_root()` resolves inside that container (`/data/.openclaw` when the slice mounts it, else the container's `~/.openclaw`, the only path that survives a recreate there). |

Provisioning route (Q4): provisioning is performed by the OPERATOR, via
the existing trusted secret manager or a host-authenticated SSH/Tailscale
session (the packet's own words). S06-05 ships the contract and the
verifier, not a provisioning executor: no Skill-6 code writes secret
values to a box.

### Mount contract (the persistence path set)

Five paths must classify as persistent via
`ghl_vps_mount_proof.classify_mount()` (never overlay/aufs/tmpfs), and the
per-box proof artifact is the path-set receipt
(`routing/vps-mount-pathset-receipt.json`, written by
`ghl_vps_mount_proof.py pre-pathset` / `post-pathset`; the single-path
`routing/vps-mount-receipt.json` for `~/.agent-browser` is unchanged):

* agent-browser state: `$HOME/.agent-browser`
* evidence base: `cc_board.resolve_evidence_base()` (per fleet type:
  `/data/clawd/skill6-fix` on a /data-backed box, `$HOME/.openclaw/clawd/skill6-fix`
  on Contabo, `$HOME/clawd/skill6-fix` on a Mac)
* run-state root: `ghl_run_state.default_state_root()`
* Playwright data dir: `<durable_root()>/playwright-data/ghl-install-pages`
* secrets dir: the directory holding the stores and `*_FILE` targets

Per-path honesty is the single-path rule, per path: a path with no
post-recreate verification is PRE-ONLY. The live recreate round trip
stays operator-gated (OPERATOR-LIVE-CHECKLIST.md item 4); this contract
does not close it.

### Client namespacing and the isolation boundary (Q2, step 4 and step 8)

The isolation boundary is the per-client Docker container (Trevor's
fleet definitions): one client per container, and LOCKDIR/lease state is
per-box inside that container. S06-05-created state is ADDITIONALLY
namespaced by client (location) identity under the durable root, so it
stays separated even if two clients ever share a box view:
provisioning receipts at
`<durable_root()>/skill6-provisioning/<client>/provisioning-receipt.json`.
Per-location breaker count/marker files
(`agent-browser-<location>.count` / `.BLOCKED` under `PARK_DIR`) are
per-location: one location's opens never touch another location's counter
or marker. Recorded shared-by-design behaviour, NOT a defect: a breaker
TRIP also writes the box-level PARK marker (`workforce-build.parked`),
so one location's trip parks the whole box (every location's next
breaker check refuses) until an operator un-parks it; and the gateway
pool ceiling (`AB_MAX_SESSIONS`) is a box-wide singleton, so its
close-oldest can close another location's session on a genuinely shared
box. In the fleet model the shared-box cases do not arise because the
container is the client boundary.

`~/.agent-browser` engine descriptors and `$LOCKDIR` leases/locks are
session state, not durable state: leases expire by TTL and locks release
on teardown; neither is expected to survive a restart (the crash/restart
harness proves PARK state persists while leases/locks do not).

### Storage label (Q5)

Default for every fleet type: **permission-protected plaintext**. The
stores and secret files are plaintext files whose protection is
filesystem permissions (0600/0700, owner-only) plus the mount contract
above. The label changes per box only when an operator names an encrypted
disk/backup policy for that box (`GHL_VPS_STORAGE_LABEL` or the
verifier's `--storage-label`); the verifier emits the label on every
receipt so the box's posture is never implied.

### Assisted-login remote session (Q3)

OUT OF SCOPE for S06-05, recorded as an open owner decision: the prep
takes no position and no recommendation exists, so no assisted-login
remote session (screen-share style operator login help) is built,
specified, or implied by this contract. The auth story on a VPS box is
the token-seed ladder (Tier 1 token-only, gated Tier 2, fail-loud
Tier 3) and nothing else.

### Capability coordination (step 9 hand-off)

The `environmentCapabilities` record (container detection, cgroup limits,
persistent storage root) already ships in `tools/capability_probe.py`
(S06-02); S06-05 does not modify it. The provisioning verifier supplies
the mount-classified storage verification the probe does not: its
receipt is the provisioning-side companion to the probe's
`environment-capabilities.json`. Documented probe semantics (SKILL.md):
a credential provisioned solely via a `*_FILE` variable reads as
not-present in the probe BY DESIGN; the verifier's per-variable rows are
the check that covers that blind spot. S06-04's own Q5/Q6 dispositions
(KIE store order divergence; probe parity follow-up owned by S06-02)
are not re-opened here.
