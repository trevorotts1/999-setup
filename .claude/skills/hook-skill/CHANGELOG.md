# CHANGELOG

## 1.1.0 - 2026-10-06

Staffing enforcement and a measured per-workflow cap, for claude and claude-nine.

1. `workflow-guard` now ships `staffing.py` (the swarm-plan rules: plan discovery, `agent_count = min(policy.max_agents_per_workflow, units)`, owned-output overlap, padding and leftover-key rejection, launch contract, owed-workflow Stop check), `capacity_probe.py`, the generator's `--plan` mode, `test_stop_omission.py` and `WORKFLOW-RELIABILITY.md`. Merged from the live hooks without dropping the repo-only behaviour (portable Node lookup and fail-open, `cleanup --dry-run`, generic stop wording).
2. The installers (`install.sh`, `Install-HookSkill.ps1`) measure the box (RAM, logical cores, container limits) and write `concurrent_agents_per_workflow` / `concurrent_agents_total` into `limits.json` and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` into `~/.claude/settings.json` and `~/.claude-nine/settings.json` (merged, idempotent). The uninstallers restore the previous env value.
3. Hook timeouts match the live registrations (120 s).
4. Tests: `test_capacity.py`, `test_stop_omission.py`, the staffing and probe selftests, and smoke-install assertions for the cap.

## 1.0.0 - 2026-10-02

First release of Hook Skill: packaged, generalized Claude Code hooks for claude and claude-nine.

1. `workflow-guard` (ON by default): Workflow launch validation with a vendored parser (acorn 8.15.0, MIT, no `npm install` needed), running-at-once concurrency limits in `state/limits.json`, slot release, finished-run scratch cleanup (`guard.py cleanup --dry-run`), stop latch, repeated-failure cap, watchdog `tick`. Fails open (with a notice) when Node.js is missing.
2. `hygiene` (ON): post-merge worktree and clone cleanup only after GitHub proof, 15-minute sweep, test-data folder cleanup (`test-start` / `test-end`). Per-user protected paths, tracked repos and scan roots in `hook-skill.json`.
3. `disk-cleanup` (ON): daily Time Machine snapshot thinning (macOS), npm / pip / Homebrew cache cleanup, top-10 home folder report, `--dry-run`, log.
4. `ask-before-backup` and `question-gate` (opt-in via `--with-ask-before-backup` / `--with-question-gate`).
5. Installers for macOS (bash) and Windows (PowerShell), uninstallers, launchd and Task Scheduler jobs, append-only settings registration in `~/.claude` and `~/.claude-nine` with JSON validation.
6. Tests: portable hook unit tests, hygiene / disk-cleanup / gate / settings-merge tests, and a fake-HOME install-and-uninstall smoke test.

Generalization from the original single-machine hooks: no hard-coded home paths (everything resolves from the user's home), no personal names in user-facing text, no router model names (the workflow generator defaults are plain `opus` builder and `sonnet` reviewer and are command-line options), per-user config file instead of baked-in repo and folder lists, hygiene scans only Claude scratch folders (not the whole system temp folder) for test-named folders, and the in-use check fails safe when `lsof` is unavailable.
