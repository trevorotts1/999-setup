# 999-setup

> **Do not run this on the operator Mac Mini.** The operator machine already runs its
> own `claude-nine` with a separate, dedicated config root. This installer would replace
> `~/.claude/skills/nine-router-setup` and `~/.local/bin/claude-nine` with this repo's
> class-facing versions, breaking that setup. This repository is for a student's own
> Mac or Windows machine.

Cross-platform environment bootstrap utilities.

This repository provisions a local **9Router** gateway on native **Windows** and **macOS
(Apple Silicon)**, wires it to your own provider credentials, installs a `claude-nine`
command that runs Claude Code through the router, and leaves your normal `claude`
untouched.

Everything here is designed to be driven by Claude Code itself: install Claude Code,
create one credential file, give Claude Code one instruction, and the setup is done.

---

## Step 1 — Install Claude Code (manual, official installer)

### Windows (Command Prompt — CMD)

```cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Then:

```cmd
claude
```

### macOS (Terminal)

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Then:

```bash
claude
```

If `claude` is not found right after a successful macOS install, check
`~/.local/bin/claude` first and open a new Terminal window — do not reinstall blindly.

Supported macOS baseline: **current macOS on Apple Silicon (`arm64`) only**.

---

## Step 2 — Create one credential file

Create a file named exactly **`API docs.md`** in your real **Documents** folder
(`%USERPROFILE%\Documents` on Windows, or `~/Documents` on macOS), containing your own
keys. Replace the placeholder text with real values:

```text
OLLAMA_API_KEY=replace_with_real_key
DEEPSEEK_API_KEY=replace_with_real_key
AGNES_API_KEY=replace_with_real_key
OPENROUTER_API_KEY=replace_with_real_key
OLLAMA_PLAN=pro
AGNES_PLAN=starter
```

Valid `OLLAMA_PLAN`: `free`, `pro`, `max`. Valid `AGNES_PLAN`: `starter`, `plus`, `pro`.
`OPENROUTER_API_KEY` is optional — leave the placeholder (or omit the line) and setup
skips OpenRouter; add a real key and setup wires it.

`DEEPSEEK_API_KEY` and `AGNES_API_KEY` are optional too (delete the line or leave the
placeholder to skip). You need `OLLAMA_API_KEY` or `OPENROUTER_API_KEY`, plus a DeepSeek source:
a DeepSeek key, or `OPENROUTER_API_KEY` with `--deepseek-route openrouter` (or
`NINE_DEEPSEEK_ROUTE=openrouter`), which routes every DeepSeek lane to
`openrouter/deepseek/deepseek-v4.1-flash`. No Agnes key means Agnes is left out of every
combo. Re-running setup never overwrites combos that already exist; add `--update-combos`
to `setup-macos.sh` to rewrite them. Test: `bash .claude/skills/nine-router-setup/tests/test-nin001.sh`.

Headless installs (SSH, fleet rollouts): if the login Keychain is locked, `protect-local-state.sh set-token`
logs one line and stores the token in `~/.9router/gateway-key` (mode 600) instead of aborting; the launcher
already reads that file first. The 9Router guards find the install via `npm root -g`, the running process, or
`/opt/homebrew`, `/usr/local`, `~/.npm-global`. Test: `bash .claude/skills/nine-router-setup/tests/test-headless-nhl001.sh`.

Your keys never leave this machine. They are read once, loaded into the local router,
and never printed.

---

## Step 3 — Give Claude Code one instruction

Start Claude Code and paste:

> Set up this computer from this repository: https://github.com/trevorotts1/999-setup
>
> First determine whether this computer is native Windows or macOS. Follow only the matching platform path in AGENT_INSTALL.md. Download the repository into my real Documents folder, install the personal Claude Code skill named nine-router-setup so it is available to both my normal `claude` command and `claude-nine`, then execute the matching setup orchestrator. Install or repair Node.js only if required, install 9Router, wire all required providers/routing/combos, install the platform-native `claude-nine` command on my PATH, and validate the full setup. Do not print or expose API keys. Do not stop until the validation suite passes or you give me one precise blocker that requires my action.

Claude Code reads `AGENT_INSTALL.md`, detects the OS, and provisions everything.

---

## After setup

| Command | Meaning |
|---|---|
| `claude` | Normal Claude Code — unchanged, Anthropic-direct |
| `claude-nine` | The same Claude Code, routed through local 9Router |

`claude-nine` starts the router on demand, loads routing only into that process, and
reuses the exact same personal skills as `claude`. Run `/nine-router-setup` at any time
to repair or re-validate the environment.

The **first** time you run `claude-nine` on macOS, you may see a Keychain prompt asking
whether to allow access to the stored router token — click **"Always Allow"** so future
runs do not prompt again.

### What setup does for you

Beyond the router and `claude-nine`, setup prepares the computer for `spec-protocol`:

- **Installs git, python3 and the GitHub CLI (`gh`)** if they are missing, and signs you
  into GitHub **once** in the browser (`gh auth login --web`). Skip the sign-in and builds
  still work — they just stay on this computer until you sign in.
- **Installs and registers the four enforcement hooks** that keep a build honest
  (`conversation-gate`, `dispatch-gate`, `gate0-claim-gate`, `workflow-syntax-gate`) by
  running spec-protocol's `tools/install-hooks.sh` (`install-hooks.ps1` on Windows). It
  merges them into your settings and never removes a hook you already had.
- **Turns ultracode on** as the starting effort for `claude-nine`, so your first
  `/spec-protocol` session is ready to go. You can still change it any time (below).
- **Keeps spec-protocol current.** Every time it launches, spec-protocol checks whether a
  newer version of any bundled skill is on GitHub and, if so, offers the update once. Say
  yes and it updates; say no and it will not ask again.

### Effort and ultracode

`claude-nine` does **not** pin an effort level, so the in-session picker is yours:

| What you want | What to type |
|---|---|
| Highest effort for the whole session | `/effort ultracode` |
| Highest effort for one message only | start the message with `ultracode` — e.g. `ultracode /spec-protocol` |
| A saved default for new sessions | `/effort xhigh` |

`low`, `medium`, `high`, and `xhigh` are saved as your default for new sessions; `max`
and `ultracode` apply to the current session only.

If a selection snaps back to the previous setting, an inherited
`CLAUDE_CODE_EFFORT_LEVEL` in your environment is overriding the picker — Claude Code
says so in its reply. Setup clears this for you, but you can run the fixer on its own at
any time on an already-installed machine:

```bash
# macOS
bash ~/.claude/skills/nine-router-setup/scripts/macos/fix-ultracode-override.sh
```

```powershell
# Windows
& "$env:USERPROFILE\.claude\skills\nine-router-setup\scripts\windows\Fix-UltracodeOverride.ps1"
```

It finds every place the variable is set — your shell startup files or PowerShell profiles,
the launchd user domain or the Windows User environment, and the `env` map in
`settings.json` — backs up anything it touches, comments the offending line out rather than
deleting it, and prints exactly what it found and what it changed. Add `--dry-run`
(`-DryRun` on Windows) to look without changing anything. It never restarts or interrupts
anything: **the change applies to new terminals and new sessions.** In the terminal you are
in right now, `unset CLAUDE_CODE_EFFORT_LEVEL` clears it immediately.

To pin effort on purpose for a single launch, run `CLAUDE_NINE_FORCE_EFFORT=xhigh claude-nine`.

---

## KIE (Kie.ai) — your own key, one paid door

KIE is the media API behind image, video and audio generation here. Nothing about
it is shared or pre-wired: during install you supply **your own** KIE key.

- **Your key, your account.** The installer asks for the client's own KIE key as
  the variable **`KIE_API_KEY`** (from app.kie.ai → Settings → API Keys) — never
  an operator key, never a hardcoded one. It is written into the `env` block of
  `settings.json` for **each config root** this machine uses —
  `~/.claude/settings.json` and, when `claude-nine` is installed,
  `~/.claude-nine/settings.json` — and `settings.json` stays at permission `600`.
  The value is never printed, logged or echoed into a test output: presence is
  reported only as **`SET` or `NOT SET`**.
- **Entry point: the front-door `kie` skill.** Image, video and audio work starts
  there. It routes each job to `66-kie-image` (image), `67-kie-video` (video) and
  `68-kie-audio` (audio and music), with `46-kie-callback-relay` for callbacks,
  and points at `07-kie-setup/references/kie-common-rules.md` for the full rules.
- **Skill 74 is the single paid door.** Every paid KIE call goes through
  `74-kie-live-adapter`; nothing calls `api.kie.ai` directly. It ships in
  **shadow** mode — it observes and refuses paid dispatch — and the **credits
  check** (`credits` / `preflight`, a read call that runs no job) is what moves it
  to **active** for a config root by writing `active` into
  `kie-live-adapter-mode.conf`. No key, or a failed credits call, leaves the mode
  at its shadow default.
- **Both config roots.** The KIE helpers install into `~/.claude/skills` and
  `~/.claude-nine/skills` (`python3 installer-registration/helper-deps.py install`,
  then `python3 installer-registration/helper-deps.py preflight`), and
  `sync-nine-skills.sh` — installed at `~/.local/bin/sync-nine-skills.sh` and run
  by the `claude-nine` launcher — keeps `claude-nine`'s skills root current.
- **Rate limit: 20 requests per 10 seconds** per KIE account (new generation
  requests). An HTTP 429 means the job did not run: wait and resubmit it, never
  drop it.
- **No KIE MCP.** There is no KIE MCP — no MCP server, no `.mcp.json` entry, no
  MCP registration of any kind. The helpers are ordinary skills that call the KIE
  HTTPS API with your own key.
- KIE's vendor skills (`kie-models`, `kie-chat-agents`) are never installed here —
  they belong to KIE's own chat product, not to this install.
- `claude` and `claude-nine` are never pointed at KIE for chat
  (`api.kie.ai/anthropic`); KIE is media only, chat stays where it was.
- Failed jobs show on `kie.ai/logs`, where each job's status and error are listed.

Test: `bash scripts/test-kie-readme.sh`. Full install steps — the key step, the
credits check, the helper install — are in
[`AGENT_INSTALL.md`](AGENT_INSTALL.md) (section 5.1 covers the helper install).

---

## Repository layout

```text
launchers/                     platform-native claude-nine launchers
                               (macOS also ships claude-codex — Codex-pinned)
.claude/skills/nine-router-setup/
    SKILL.md                   the personal Claude Code skill (repair/re-run)
    references/                architecture, security, API, troubleshooting docs
    scripts/
        setup-windows.ps1      Windows orchestrator
        setup-macos.sh         macOS orchestrator
        windows/               Windows-specific helpers
        macos/                 macOS-specific helpers
        common/                shared Node.js management-API helpers
.claude/skills/spec-protocol/
    SKILL.md                   the spec-protocol skill (build a finished app/site)
    references/                pipeline, interview, research, QC docs
    tools/                     ledger, anchor, capacity, env-sweep, and update tools
    PROMPT-QC-INSTRUCTIONS.md  the ten QC categories
.claude/skills/kaizen/
    SKILL.md                   the kaizen skill (Plan-Do-Check-Act improvement loop)
    references/                onboarding, contract, memory, PDCA, scheduling docs
    templates/                 contract, memory, state, cycle, resume templates
    scripts/                   deterministic state/validation/scheduler helpers
.claude/skills/eli5/
    SKILL.md                   the eli5 skill (plain-language explanations)
    THIRD_PARTY_LICENSE.md     upstream MIT notice
.claude/skills/bro/
    SKILL.md                   the bro skill (direct developer talk)
    THIRD_PARTY_LICENSE.md     upstream MIT notice
.claude/skills/hook-skill/
    SKILL.md                   the Hook Skill (Claude Code hooks + disk auto-cleanup)
    hooks/                     workflow-guard, hygiene, disk-cleanup, ask-before-backup, question-gate
    scripts/                   macOS (bash) and Windows (PowerShell) installers and uninstallers
    tests/                     unit tests and a fake-HOME install/uninstall smoke test
.claude/skills/kiss/
    SKILL.md                   the kiss skill (one-message double answer: friendly, then short)
    VERSION                    the kiss skill version marker
CONTROL/bundled-skills.txt     the authoritative bundled-skills manifest
templates/                     API docs.md template
tests/                         smoke-test scaffolding
```

Each bundled skill also carries a `VERSION` file at its root — the per-skill
version markers that spec-protocol's `check-update.sh` reads at every launch.

The setup is **idempotent**: running it again repairs and updates existing state rather
than duplicating providers, combos, PATH entries, or keys.

## Bundled skills

This repository installs **six** personal Claude Code skills, all visible to `claude`
and `claude-nine`:

- **`nine-router-setup`** — provisions and repairs the 9Router / `claude-nine`
  environment (the subject of this README).
- **`spec-protocol`** — turns any idea into a fully-built, QC'd, staged, merged-to-GitHub
  app or website. Invoke it later with `/spec-protocol`. Its first-run launcher greets
  the operator as **Candace**, a warm, humorous fairy godmother — "You make a wish, I
  make it come true" — voice-only, leaving every protocol gate and law untouched.
- **`kaizen`** — a Plan-Do-Check-Act continuous-improvement loop for anything already
  built (app, website, funnel, process, automation, document). Invoke it with `/kaizen`.
- **`eli5`** — explains complex topics in plain language. Invoke it with `/eli5`.
- **`bro`** — direct, blunt developer talk. Invoke it with `/bro`.
- **`hook-skill`** — Hook Skill: Claude Code hooks for `claude` and `claude-nine` (workflow
  concurrency guard, post-merge cleanup of finished worktrees and clones, daily disk
  auto-cleanup, plus opt-in ask-before-backup and question-gate). Install with
  `bash .claude/skills/hook-skill/scripts/macos/install.sh` (Windows:
  `scripts\windows\Install-HookSkill.ps1`); test with `bash .claude/skills/hook-skill/tests/run-all.sh`.
- **`kiss`** — asks Claude to answer the current message twice: first a friendly, casual
  version (the /bro style — simpler, not necessarily shorter), then a plain, brief short
  version. Put `/kiss` at the start of a message; it is one-shot and leaves no mode on.

The authoritative list lives in [`CONTROL/bundled-skills.txt`](CONTROL/bundled-skills.txt);
the installers link every skill it names. Third-party upstreams (`eli5`, `bro`) carry
their own MIT notices in their skill folders and in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Every bundled skill now carries a `VERSION` file at its root (`spec-protocol` 1.37.0,
`nine-router-setup` 1.29.0, `kaizen` 1.1.0, `eli5` 1.1.0, `bro` 1.1.0,
`blackceo-signature-page` 1.2.5, `hook-skill` 1.2.0, `kiss` 1.0.0). At every
spec-protocol launch, `tools/check-update.sh` checks all bundled skills (exit 0 = current,
1 = update available, 2 = undetermined) and `tools/self-update.sh` can update
spec-protocol itself; the other skills refresh by re-running the
nine-router-setup installer (`/nine-router-setup`). A skill whose `VERSION` cannot be
read from `main` reports UNDETERMINED — by design, never a false "current".

### Kaizen tests

The Kaizen skill ships a fixture-only test suite (it never touches real Downloads,
`~/.claude`, or launchd). Run everything with:

```bash
bash .claude/skills/kaizen/tests/run-all-kaizen-tests.sh
```

That one command runs all eighteen suites: the core suite (sections 7.1–7.13),
the six-scenario walkthroughs, and the per-fix suites `fix01`–`fix16`:

| Suite | What it covers |
|---|---|
| `fix01`–`fix08` | memory-root resolution, deterministic init, registry, atomic locking, strict validation, secret scanning, scheduling decision engine, launchd |
| `fix09`–`fix12` | Windows Task Scheduler structure, installer idempotency, PDCA behavior, contract/activation behavior |
| `fix13`–`fix14` | companion-skill provenance, static/cross-platform checks |
| `fix15` | spec-protocol `check-update.sh` multi-skill check (offline fixtures) |
| `fix16` | the auto-compact helper |

Individual suites live in `.claude/skills/kaizen/tests/`. The suite **fails if any
suite file is missing** — a skipped suite is a gap, not a pass.

CI runs the same suites on macOS and Ubuntu, plus the PowerShell self-test on a
Windows runner (`.github/workflows/kaizen-tests.yml`).

### Kaizen helper scripts

All scripts live under `.claude/skills/kaizen/scripts/`, split by platform.

**Common (Node.js — both platforms)**

| Script | Purpose |
|---|---|
| `init-kaizen-memory.mjs` | Initialize (or update) one Kaizen Loop's memory folder — deterministic, atomic writes, never overwrites user files or writes secrets |
| `kaizen-fingerprint.mjs` | Deterministic, read-only fingerprint of a target directory (`compute` / `compare`) |
| `kaizen-schedule.mjs` | The schedule decision engine: turn natural-language interval input into a schedule |
| `kaizen-state.mjs` | Loop state helper — atomic writes with `.bak`, Downloads-only root resolution |
| `validate-kaizen-memory.mjs` | Validate a memory folder (structure, JSON shapes, loop-id agreement, placeholders, optional secret scan) — exit 0/1/2 |

**macOS**

| Script | Purpose |
|---|---|
| `install-kaizen-launchagent.sh` | Install a LaunchAgent that runs one Kaizen cycle on an interval (fallback path D) |
| `remove-kaizen-launchagent.sh` | Idempotently remove an installed Kaizen LaunchAgent and clear its scheduler state |
| `resolve-kaizen-root.sh` | Print the Kaizen memory root using the OpenClaw Master Files decision rule |
| `run-kaizen-cycle.sh` | Run one Kaizen cycle headlessly via the chosen launcher — truthful exit codes, never prints secrets |
| `kaizen-launchagent-ctl.sh` | Control a Kaizen LaunchAgent: `status` / `disable` / `enable` / `reinstall` |
| `plist-escape.sh` | XML-escape helpers for plist values (sourced, not executed; ships a self-test) |

**Windows (PowerShell)**

| Script | Purpose |
|---|---|
| `Get-KaizenTaskStatus.ps1` | Print the Task Scheduler status for a Kaizen loop as JSON |
| `Install-KaizenTask.ps1` | Install a Windows Scheduled Task that runs one Kaizen cycle on an interval (fallback path D) |
| `Invoke-KaizenCycle.ps1` | Run one Kaizen cycle headlessly via the chosen launcher — exit code mirrors the launcher, never prints log contents |
| `Remove-KaizenTask.ps1` | Idempotently remove a Scheduled Task installed by `Install-KaizenTask.ps1` |
| `Resolve-KaizenRoot.ps1` | Print the Kaizen memory root using the OpenClaw Master Files decision rule |
| `kaizen-task-self-test.ps1` | Fixture-only self-test of the Windows Task Scheduler suite (run on a Windows runner) |

The Windows status, install, cycle, and remove scripts accept `-DryRun` (or
`KAIZEN_TASK_DRY_RUN=1`) to report what they would do without creating real tasks,
running real cycles, or touching `schtasks.exe`.

### Auto-compaction at 500k tokens

The canonical helper for turning on auto-compaction is
`.claude/skills/nine-router-setup/scripts/common/apply-auto-compact.mjs`. It sets
`autoCompactEnabled: true` and `autoCompactWindow: 500000` at the top level of the
target box's `~/.claude/settings.json`.

macOS:

```bash
node ~/.claude/skills/nine-router-setup/scripts/common/apply-auto-compact.mjs \
  --settings ~/.claude/settings.json
```

Windows (PowerShell):

```powershell
node "$env:USERPROFILE\.claude\skills\nine-router-setup\scripts\common\apply-auto-compact.mjs" `
  --settings "$env:USERPROFILE\.claude\settings.json"
```

Contract: it backs the settings file up before overwriting it, preserves every other
key, refuses (non-fatally) if the file is not valid JSON, and never prints the
settings contents. The change applies to **new sessions**. Both installers
(`setup-macos.sh`, `setup-windows.ps1`) run it during setup, and the spec-protocol
(step 2.6) and kaizen onboarding first-run steps apply it too.

## License

MIT — see `LICENSE`.

---

## Release notes

The full release history — every version, including everything after v1.1.0 —
lives in [`CHANGELOG.md`](CHANGELOG.md), which is the single owner of release
notes for this repository. The v1.1.0 note below is kept as originally written.

**v1.1.0 (2026-08-10)** — The fleet-fusion standard. DS Max is now DeepSeek v4 **Flash**
+ thinking MAX (was Pro) and routes to Opus; DS Light (Flash, thinking OFF) routes to
Haiku; Sonnet routes to the client's own Agnes 2.5 Flash custom provider; the fusion
combo `FusioN-smartest-agent` (panels: DS Max Flash-max, GLM 5.2 Ollama Cloud,
NVIDIA-free via OpenRouter; judge: DeepSeek v4 Pro max) is the default Fable. Fixed the
skill-install root (skills now install into `~/.claude-nine/skills/`, the root
`claude-nine` actually reads). Clients' own keys are always used — never the operator's;
missing keys are requested, never silently skipped. Spec-protocol synced to the latest
live version.
