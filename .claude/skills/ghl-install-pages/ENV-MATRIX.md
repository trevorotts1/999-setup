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
  live inside the skill, so a future contributor does not have to re-derive
  it.
