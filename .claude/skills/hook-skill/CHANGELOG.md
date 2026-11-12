# CHANGELOG

## 1.3.0 - 2026-11-12

Full-read guard (Trevor's order 2026-11-12): agents were skipping steps by searching or partly reading skills and SOPs.

1. New component `full-read-guard`, default ON. `frg_hook.py` (PreToolUse on Read, Grep, Bash, Skill, Edit, Write, MultiEdit, NotebookEdit; PostToolUse on Read and Bash for receipts; SessionStart and PreCompact reset receipts) blocks Grep, a Read with offset or limit, and shell partial reads (grep, egrep, fgrep, rg, ag, head, tail, sed -n, awk, cut, less, a pipe from cat into any of them, a python or node one-liner naming the file) of instruction files, and blocks running a skill's scripts or editing its folder until its instruction files and its direct dependencies were read in full in this session.
2. `read-skill <name>` (`read_skill.py` plus `read-skill` and `read-skill.cmd` wrappers) prints the skill and its direct dependencies (one level) in full, in a fixed order, with sha256 headers, split into parts with a receipt line per part.
3. Three classes of file: instruction (required up front: SKILL.md, root INSTRUCTIONS.md, named SOPs; for a direct dependency SKILL.md and named SOPs), read-on-open (all other markdown: INSTALL.md, QC.md, step folders; not required before work, whole when opened) and lookup (searchable). The up-front set of every shipped skill is under 150 KB (largest: conversational-ai-system 147 KB, ghl-install-pages 136 KB, black-friday-launcher 124 KB, drama-song-ad-factory 117 KB, convert-and-flow-operator 86 KB). The central manifest `hooks/full-read-guard/manifest.d/999.json` is generated from the real skill folders by `scripts/common/build_frg_manifest.py` (`--check` in the tests). No size rule exists.
4. Loop breaker: the same call blocked 3 times is allowed and logged to `state/frg.log`. Internal errors fail open. Modes off, audit, enforce.
5. Installers: `--no-full-read-guard`; `--only full-read-guard [--root DIR]` (PowerShell `-Only`, `-Root`, `-NoFullReadGuard`) is the narrow roll-path install that registers only this hook's four entries in an existing settings.json. `hookskill_files.py` keeps earlier components in the install manifest and has `--no-config`. `settings_merge.py` registers the component once per settings file. `uninstall.sh` also removes the roll-path install under `~/.claude-nine/hooks`. The wiring self-check lists the new entries (only when the hook is installed).
6. Tests: `tests/test_full_read_guard.py` (run by `tests/run-all.sh`), fixtures under `tests/fixtures/frg/`, and a roll-path section in `tests/smoke-install.sh` (which also no longer breaks when the checkout path contains spaces).

## 1.2.0 - 2026-10-07

Live operator guard sync. The shipped `workflow-guard` core in this repo is now byte-identical to the live operator guard at `~/.claude/hooks/workflow-guard/`:

1. `guard.py`, `staffing.py`, `make-workflow.py` and `validate.mjs` refreshed to the live operator versions.
2. `bash_targets.py` added — live target enumeration used by the guard's bash tooling.
3. Test suite synced with the live guard: added `test_bash_targets.py`, `test_cancel.py`, `test_census_staffing.py`, `test_pin_run_root_plan.py`, `test_retire_addplan.py`, `test_tamper.py`, `test_tamper_git.py`, and refreshed `test_enforcement_v22.py`, `test_final_staffing.py`, `test_generator.py`, `test_guard.py`, `test_smart_guard.py`, `test_stop_omission.py`.
4. `package.json` / `package-lock.json` shipped with the guard (byte-identical to the live operator guard): the live `validate.mjs` imports bare `acorn`, and the live `test_generator.py` symlinks `node_modules/`, so a checkout runs the suite after `npm ci` (or after copying the live `node_modules/`, which stays gitignored). The repo's `vendor/acorn.mjs` is left in place — `tests/smoke-install.sh` still asserts it ships.
5. `VERSION` bumped to 1.2.0.

## 1.1.0 - 2026-10-06

Staffing enforcement and a measured per-workflow cap, for claude and claude-nine.

1. `workflow-guard` now ships `staffing.py` (the swarm-plan rules: plan discovery, `agent_count = min(policy.max_agents_per_workflow, units)`, owned-output overlap, padding and leftover-key rejection, launch contract, owed-workflow Stop check), `capacity_probe.py`, the generator's `--plan` mode, `test_stop_omission.py` and `WORKFLOW-RELIABILITY.md`. Merged from the live hooks without dropping the repo-only behaviour (portable Node lookup and fail-open, `cleanup --dry-run`, generic stop wording).
2. The installers (`install.sh`, `Install-HookSkill.ps1`) measure the box (RAM, logical cores, container limits) and write `concurrent_agents_per_workflow` / `concurrent_agents_total` into `limits.json` and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` into `~/.claude/settings.json` and `~/.claude-nine/settings.json` (merged, idempotent). The uninstallers restore the previous env value.
3. Hook timeouts match the live registrations (120 s).
4. The live final-pass guard ported: two-phase admission, journaled verdict writes, `agent_id`-only subagent detection, subagent write fences; registrations now include `Write` on PostToolUse and `SendMessage` on PreToolUse, written for both claude and claude-nine. New tests `test_final_pass.py`, `test_final_staffing.py`.
5. Tests: `test_capacity.py`, `test_stop_omission.py`, the staffing and probe selftests, and smoke-install assertions for the cap.

## 1.0.0 - 2026-10-02

First release of Hook Skill: packaged, generalized Claude Code hooks for claude and claude-nine.

1. `workflow-guard` (ON by default): Workflow launch validation with a vendored parser (acorn 8.15.0, MIT, no `npm install` needed), running-at-once concurrency limits in `state/limits.json`, slot release, finished-run scratch cleanup (`guard.py cleanup --dry-run`), stop latch, repeated-failure cap, watchdog `tick`. Fails open (with a notice) when Node.js is missing.
2. `hygiene` (ON): post-merge worktree and clone cleanup only after GitHub proof, 15-minute sweep, test-data folder cleanup (`test-start` / `test-end`). Per-user protected paths, tracked repos and scan roots in `hook-skill.json`.
3. `disk-cleanup` (ON): daily Time Machine snapshot thinning (macOS), npm / pip / Homebrew cache cleanup, top-10 home folder report, `--dry-run`, log.
4. `ask-before-backup` and `question-gate` (opt-in via `--with-ask-before-backup` / `--with-question-gate`).
5. Installers for macOS (bash) and Windows (PowerShell), uninstallers, launchd and Task Scheduler jobs, append-only settings registration in `~/.claude` and `~/.claude-nine` with JSON validation.
6. Tests: portable hook unit tests, hygiene / disk-cleanup / gate / settings-merge tests, and a fake-HOME install-and-uninstall smoke test.

Generalization from the original single-machine hooks: no hard-coded home paths (everything resolves from the user's home), no personal names in user-facing text, no router model names (the workflow generator defaults are plain `opus` builder and `sonnet` reviewer and are command-line options), per-user config file instead of baked-in repo and folder lists, hygiene scans only Claude scratch folders (not the whole system temp folder) for test-named folders, and the in-use check fails safe when `lsof` is unavailable.
