---
name: hook-skill
description: Install, test, repair or remove the Hook Skill package of Claude Code hooks (display name "Hook Skill") for claude and claude-nine - a workflow concurrency guard with finished-run scratch cleanup, post-merge hygiene that deletes merged worktrees and clones only after GitHub confirms, daily disk auto-cleanup (Time Machine snapshots, package caches, top-folder report), a full-read guard that makes an agent read a skill and its direct dependencies whole before using them, plus opt-in ask-before-backup and question-gate hooks. Use when the user asks to set up hooks, stop disk space filling up with agent worktrees or caches, limit how many agents a workflow runs at once, make Claude ask before backups, or make Claude ask before acting after a question.
---

# Hook Skill

Display name: **Hook Skill**. Folder: `hook-skill`. Version: see `VERSION`.

A set of Claude Code hooks, an auto-cleanup sweep, an installer, and tests. Works with regular
Claude Code and with `claude-nine` (it registers in both when `~/.claude-nine/` exists).

## What you get

| Component | Default | What it does |
|---|---|---|
| `workflow-guard` | ON | Validates `Workflow` launches (explicit model, label, phase; bounded fan-out), enforces concurrency limits counted running-at-once, releases slots when runs finish, removes a finished run's own registered scratch folders (never one with uncommitted or unpushed git work), a stop-order latch, a repeated-failure cap, and a watchdog `tick` that flags stalled runs. Limits live in `~/.claude/hooks/workflow-guard/state/limits.json`: the installer MEASURES the box (`capacity_probe.py`: RAM, logical cores, container limits; `per_workflow_cap = clamp(1, 10, min(floor(ram_gb / 1.5), cores))`) and writes `concurrent_agents_per_workflow` = that cap and `concurrent_agents_total` = `min(500, cap * 50)`; the other limits default to 50 workflows per program (ceilings: 10 / 50 / 500). It also writes the cap into `env.CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` of both settings files (merged, idempotent; uninstall restores the previous value). Under a swarm plan (`SWARM-PLAN.json`, schema `blackceo.swarm-plan/v2`) `staffing.py` is the one rule file: launches carry `args.workflowId` and exactly the planned units, a Stop hook blocks ending a turn while planned workflows are owed, and `agent_count = min(policy.max_agents_per_workflow, units)`. |
| `hygiene` | ON | After a merge, release or tag push that GitHub confirms, and every 15 minutes, deletes agent worktrees, throwaway clones and test-data folders only when every safety check passes: merged (HEAD is in `origin/main` or a merged PR has that exact head), clean tree, no stash, no unpushed commits on any local branch, not open by a process, not recently modified. See `hooks/hygiene/TESTING.md` for test-data folders. |
| `disk-cleanup` | ON | Daily sweep: thins Time Machine local snapshots (macOS, `tmutil thinlocalsnapshots / 999999999999 4`, no sudo), clears npm and pip caches, runs `brew cleanup` if Homebrew exists, and REPORTS (never deletes) the 10 largest folders in your home directory. |
| `full-read-guard` | ON | Makes an agent read the skill it uses in full, plus its direct dependencies (one level, not transitive). Required up front: the skill's `SKILL.md` and root `INSTRUCTIONS.md` and any named SOP; for each direct dependency its `SKILL.md` and named SOPs. Every other markdown file (INSTALL.md, QC.md, `*-full.md`, prompts, protocols, templates, steps, playbooks, references, examples) is READ-ON-OPEN: not required before work starts, but when opened it must be read whole. PreToolUse blocks `Grep`, a `Read` with offset or limit, and shell `grep`/`rg`/`head`/`tail`/`sed -n`/`awk`/`cut`/`less` (and `cat file \| head`) on instruction files, and blocks running a skill's scripts or editing its folder before its up-front files and its direct dependencies' up-front files were read in full this session; the block message names the fix: `read-skill <name>`. `read-skill` prints the skill and its direct dependencies in full, in a fixed order, split into parts with a receipt line per part (the guard counts the read only when every part was delivered). Three file classes: instruction (required up front), read-on-open (whole when opened; partial reads and grep blocked), and lookup files (code, data, tests, templates, catalogs, named in `hooks/full-read-guard/manifest.d/999.json`, or anything that is not a markdown document) may be searched or read in part. The agent never decides what is lookup; nothing is exempt by size. Receipts reset on compaction and when a file changes. The same call blocked 3 times is allowed and logged (`state/frg.log`), so a session is never frozen; any internal error fails open. Mode: `FRG_MODE=off|audit|enforce` or `~/.claude/hooks/full-read-guard.json` `{"mode": "audit"}`. |
| `ask-before-backup` | opt-in | Asks before any command or file write that creates a backup (`.bak`, `backup`, `git stash`, `tmutil localsnapshot`, dumps). Skips in bypass-permissions mode. |
| `question-gate` | opt-in | After you ask a question, any action tool asks first; reads always pass. An order ("do it", "fix it") clears the gate. Skips in bypass-permissions mode. |

ask-before-backup and question-gate prompt you, so they are opt-in.

## Install

macOS / Linux:

```bash
bash .claude/skills/hook-skill/scripts/macos/install.sh                       # defaults
bash .claude/skills/hook-skill/scripts/macos/install.sh --with-ask-before-backup --with-question-gate
bash .claude/skills/hook-skill/scripts/macos/install.sh --dry-run             # show the plan, write nothing
```

Windows (PowerShell):

```powershell
.\.claude\skills\hook-skill\scripts\windows\Install-HookSkill.ps1 -WithAskBeforeBackup -WithQuestionGate
.\.claude\skills\hook-skill\scripts\windows\Install-HookSkill.ps1 -DryRun
```

Roll-path (narrow) install, used by the fleet roll: `bash .claude/skills/hook-skill/scripts/macos/install.sh --only full-read-guard --root ~/.claude-nine` (PowerShell: `-Only full-read-guard -Root <dir>`). It copies only `<root>/hooks/full-read-guard/**` (plus the install manifest) and merges only the four full-read-guard hook entries (PreToolUse, PostToolUse, SessionStart, PreCompact) into the root's EXISTING `settings.json`; no other hook, env value, scheduled job, `hook-skill.json` or lock, and it never creates a settings file. Opt out of the component in a normal install with `--no-full-read-guard` (`-NoFullReadGuard`). Regenerate the lookup manifest after a skill folder changes: `python3 .claude/skills/hook-skill/scripts/common/build_frg_manifest.py`.

Other flags: `--lock-settings` / `--unlock-settings` (PowerShell: `-LockSettings` / `-UnlockSettings`; see Settings protection below), `--no-workflow-guard`, `--no-hygiene`, `--no-disk-cleanup`, `--no-schedule` (PowerShell: `-NoWorkflowGuard`, `-NoHygiene`, `-NoDiskCleanup`, `-NoSchedule`).

The installer:

1. copies each hook to `~/.claude/hooks/<name>/` (no test files; workflow-guard includes `staffing.py` and `capacity_probe.py`; `dispatch-gate.py` for plan launches ships with the spec-protocol skill);
2. appends its entries to `~/.claude/settings.json` and, if the folder exists, `~/.claude-nine/settings.json` - existing hook entries are never edited or removed, every write is re-read as JSON before it replaces the file, and an invalid settings file is left untouched;
3. creates `~/.claude/hooks/hook-skill.json` (per-user settings, never overwritten), measures the box and writes the capacity values above;
4. schedules the sweeps: launchd jobs `com.hookskill.workflow-watchdog` (30 s), `com.hookskill.hygiene-sweep` (15 min), `com.hookskill.disk-cleanup` (daily 03:30) on macOS; Task Scheduler tasks `HookSkill-Watchdog`, `HookSkill-Hygiene`, `HookSkill-DiskCleanup` on Windows; cron lines are printed on Linux.

Requirements: Python 3.8+ (every hook is a Python script). Node.js 18+ is optional: without it workflow-guard cannot statically validate `Workflow` launches and says so instead of blocking them.

Restart Claude Code (and claude-nine) after installing so the hooks load. The installer makes no backup files; the uninstaller restores your settings exactly.

## Settings protection (self-check on, hard lock opt-in)

- **Wiring self-check (always on).** At SessionStart the workflow guard compares the active config dir's `settings.json` with `hooks/workflow-guard/wiring-manifest.json` (required registrations, timeouts of at least 120 s, the `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` env value). A gap produces a loud warning in the session (`HOOK WIRING INCOMPLETE: ... Re-run the Hook Skill installer.`) and an alert in `state/STATUS.md` and `state/alerts.json`. It never edits settings.
- **Hard lock (opt-in).** Default is no lock, so the box owner keeps `/model` and `/config`. `--lock-settings` locks the claude and claude-nine settings files after install: macOS `chflags uchg` (strong); Linux `chattr +i` as root, otherwise `chmod a-w` (weaker: the owner can undo it); Windows read-only attribute (`attrib +R`, weaker: the owner can clear it, some editors clear it). `--unlock-settings` removes it and exits. While locked, `/model`, `/config` saves and any other writer fail by design.
- **Lock-aware installers.** The installer, the uninstaller and the other scripts in this repository that write a settings file unlock a locked file, write, validate the JSON and always re-lock it, printing one line saying so.

## Per-user settings

`~/.claude/hooks/hook-skill.json`:

- `hygiene.protected_paths`: extra folders the hygiene sweep must never touch (home-relative or absolute). Always protected: `~/Downloads`, `~/Documents`, `~/Desktop`, `~/.ssh`, `~/.claude/hooks`, `~/.claude/projects`, `~/.claude-nine/projects`.
- `hygiene.tracked_repos`: repos whose linked worktrees are swept too (the repos themselves are protected).
- `hygiene.scan_roots`: extra folders to scan for throwaway clones and worktrees.
- `hygiene.extra_test_roots`: extra folders where test-named folders are swept after 6 idle hours.
- `disk_cleanup.*`: `thin_snapshots`, `clear_npm_cache`, `clear_pip_cache`, `homebrew_cleanup` (true/false) and `report_top_folders` (count).

## Dry run and logs

Every cleanup has a dry run and writes a log. Nothing with uncommitted or unpushed work is ever deleted.

| Cleanup | Dry run | Log |
|---|---|---|
| hygiene | `python3 ~/.claude/hooks/hygiene/post_merge_hygiene.py sweep --dry-run` | `~/.claude/hooks/hygiene/hygiene.log` |
| workflow-guard scratch | `python3 ~/.claude/hooks/workflow-guard/guard.py cleanup --dry-run` | `~/.claude/hooks/workflow-guard/state/cleanup.log` |
| disk-cleanup | `python3 ~/.claude/hooks/disk-cleanup/disk_cleanup.py --dry-run` | `~/.claude/hooks/disk-cleanup/disk-cleanup.log` |

(hygiene prints its dry run to the terminal and writes real deletions to its log.)

## Uninstall

```bash
bash .claude/skills/hook-skill/scripts/macos/uninstall.sh [--purge] [--dry-run]
```
```powershell
.\.claude\skills\hook-skill\scripts\windows\Uninstall-HookSkill.ps1 [-Purge] [-DryRun]
```

Removes only what the installer added: its hook entries (matched by exact script path), its scheduled jobs, and the files listed in `~/.claude/hooks/hook-skill-install.json`. Logs, databases and `hook-skill.json` stay unless `--purge`.

## Test

```bash
bash .claude/skills/hook-skill/tests/run-all.sh
```

Runs the workflow-guard unit tests (need Node.js), hygiene, disk-cleanup, gate and settings-merge tests, and a smoke test that installs into a temporary fake HOME, verifies registration in both settings files, re-installs, and uninstalls. Nothing touches the real home folder or launchd.

## Agent rules for this skill

- Run the installer exactly as written; do not hand-edit `settings.json`.
- Offer `--with-ask-before-backup` and `--with-question-gate` and explain that they prompt; do not enable them unasked.
- Never print secrets; never delete anything outside the sweeps' own safety checks.
- Adapter notes: `adapters/claude-code/README.md`, `adapters/claude-nine/README.md`.
