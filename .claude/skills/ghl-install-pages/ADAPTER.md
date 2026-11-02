# GHL pack adapter contract (claude-nine)

The pack's adapter files change at exactly four seams (Amendment 5,
Row 6A). A fifth seam is a plan amendment, never a local invention:
the pre-copy audit flagged one candidate (host scheduling and host
services, including Skill 6's cron registration surface and the VPS
mount proof pair) and it is recorded in the pack manifest, unresolved,
for the plan owner.

## Seam 1: launch

Browser work in this harness launches through the browser-engine
contract's claude-nine mapping: the Claude Code harness's
agent-browser, driven per Skill 71's browser-engine contract
(`references/browser-engine-contract.md` in blackceo-signature-page,
whose 999 edition maps the engine table to this harness). The
OpenClaw Chrome extension is not available here and is never assumed.

## Seam 2: session seed

Authenticated GHL sessions are seeded from the install's own secrets
environment, using the variable names the audit confirmed for the
caf CLI: the Private Integration Token (preferred variable
GOHIGHLEVEL_API_KEY, with its documented aliases), the location id
(GOHIGHLEVEL_LOCATION_ID and aliases), and, only for workflow writes
through Skill 44's Firebase surface, GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN
and aliases. Presence booleans may be recorded; values never are.

## Seam 3: teardown

Every browser session the pack opens is registered and reaped under
Skill 71's Item 33 browser hygiene discipline (the session registry
and reaper in blackceo-signature-page's scripts/browser_sessions.py),
and the stage's browser-hygiene receipt is written before close.

## Seam 4: paths and secrets

All paths resolve inside this repo and the Claude Code harness's own
directories (`.claude/skills/...`, the install's secrets env). No
`.openclaw` path, no OpenClaw skills tree path, and no cross-repo
reference is permitted in an adapted file.

## The caf CLI prerequisite (declared, Amendment 4)

Skill 44's Tier 0 rail is the caf CLI. The step-zero audit proved
the 999 installer does NOT provision caf (zero hits across the
install corpus). It is therefore declared here as an external
prerequisite: until the install provides it, workflow and funnel API
work falls back to the Tier 4 agent-browser backstop, and receipts
record the backstop as the rail used. The tier doctrine itself
(Tier 0 caf CLI, Tier 1 official MCP, Tier 2 community MCP, Tier 3
direct REST, Tier 4 browser, Tier 5 last resort) is Skill 36's,
vendored as data in this contract per Item 28's sub-dispositions;
Skill 29's role maps by reference onto this pack's rails.

## Seam status and the live-write gate (S06-18)

This tree was synced from onboarding's Skill 6 after the S06 fixes
(`06-ghl-install-pages`), file by file under the pack manifest's classes:
neutral files are byte copies; adapter files keep their harness adaptation
and take upstream changes by three-way merge. `tools/` differs from
onboarding in exactly the adapter files listed below, nothing else.
`scripts/check-launch-family-parity.py --family ghl-install-pages` (onboarding
repo) is the check; its remaining difference is `skill-version.txt`, a version
marker the integrator stamps.

The four seams are checked by `skill_runner.adapter_seams_status()`:

| Seam | What the check proves |
|---|---|
| launch | the Skill 71 browser-engine contract is present; `tools/openclaw_browser_adapter.sh` is in its gated-off 999 form; the probe reports the OpenClaw lane structurally absent |
| session-seed | the shared resolver's store list follows `$SECRETS_ENV` (`skill_runner.bind_session_seed`, applied by `install()`) |
| teardown | every `browser_manager.browser_session` is registered, closed and receipted in Skill 71's Item 33 registry (`skill_runner.wrap_browser_session`, applied by `install()`) |
| paths-secrets | no adapter runtime file names an OpenClaw path, except the declared fifth-seam and detection-only files in `skill_runner.SEAM4_DECLARED`; durable state (`ghl_builder.ledger_root()`, `ghl_run_state.default_state_root()`) resolves through `browser_manager.durable_root()`, the skill's own `state/` dir, never `/tmp` |

**A live GHL write is refused with `ADAPTER-SEAMS-NOT-PORTED` until all four
seams pass and a seams receipt for the current adapter files exists.** The
refusal sits at the live executors. Every browser `_live_build` (form,
pipeline, community, course, including their CLI `main()` entries) is refused at
`ghl_form_builder._canonical_session`, the first call each makes, before any
browser launch. `ghl_survey_builder.build_survey` is refused after its dry-run
return. `ghl_media.upload_media` and `ghl_media.create_media_folder` are refused
on the real transport (no injected opener). The write methods of
`ghl_bulk_workflow_enroll.GhlHttpClient` (enroll and delete) are refused; its
reads are not. Page, funnel, website and ecosystem writes are agent-executed
plan steps or injected ops with no Python executor here, so they are not gated
in Python (plans are never refused). Dry
runs, plans and verification are never refused. Record the receipt with
`python3 skill_runner.py seams --record`; it is written only when all four
pass, into `<durable root>/skill6-seams/`, and any edit to an adapter file
changes its digest and closes the gate again. `python3 skill_runner.py seams`
prints each verdict without writing anything.

Path adapters that are not seams: `ghl_public_client` finds Skill 44's engine
through `GHL_PUBLIC_ENGINE_ROOT`, defaulted by `install()` to the sibling
`convert-and-flow-operator/tools/engine`.

### Documented adapter files in `tools/`

| File | Manifest seams |
|---|---|
| `tools/README.md` | launch,session-seed,teardown,paths-secrets |
| `tools/SELECTORS-LIVE-community.md` | launch,session-seed,teardown,paths-secrets |
| `tools/SELECTORS-LIVE-form.md` | launch,session-seed,paths-secrets |
| `tools/SELECTORS-LIVE-page.md` | launch,session-seed,teardown,paths-secrets |
| `tools/SELECTORS-LIVE-pipeline.md` | launch,session-seed |
| `tools/_kie_prompt_enforcer_embedded.py` | paths-secrets |
| `tools/browser_manager.py` | launch,session-seed,teardown,paths-secrets |
| `tools/browser_manager.sh` | launch,session-seed,teardown,paths-secrets |
| `tools/capability_probe.py` | launch,paths-secrets |
| `tools/cc_board.py` | launch,session-seed,teardown,paths-secrets |
| `tools/gates.json` | launch,session-seed,teardown,paths-secrets |
| `tools/ghl_auth_fallback.py` | session-seed,paths-secrets |
| `tools/ghl_bulk_workflow_enroll.py` | paths-secrets |
| `tools/ghl_ecosystem.py` | launch,paths-secrets |
| `tools/ghl_env_matrix_ground_truth.py` | launch,paths-secrets |
| `tools/ghl_form_builder.py` | launch,session-seed,teardown,paths-secrets |
| `tools/ghl_github_reconcile.py` | session-seed |
| `tools/ghl_image_stage.py` | teardown,paths-secrets |
| `tools/ghl_media.py` | launch,session-seed,teardown,paths-secrets |
| `tools/ghl_selector_drift_probe.py` | launch,session-seed |
| `tools/ghl_survey_builder.py` | launch,session-seed,teardown,paths-secrets |
| `tools/ghl_verify.py` | launch,teardown |
| `tools/iframe-survival-targets.json` | paths-secrets |
| `tools/openclaw_browser_adapter.sh` | launch,teardown,paths-secrets |
| `tools/seed-ghl-auth.py` | launch,session-seed,teardown,paths-secrets |
| `tools/skill6_convergence.py` | session-seed,paths-secrets |
| `tools/v2_dispatcher.py` | launch,session-seed,paths-secrets |

Tests and docs follow their tools: adapter-class files under `tests/` and the
root documents keep the 999 form (agent-browser PRIMARY, the OpenClaw lanes
absent, host scheduling not registered). The cron installers and
`scripts/check-openclaw-extension-version.sh` are carried unadapted: host
scheduling is the declared fifth seam, never on a write path here.
