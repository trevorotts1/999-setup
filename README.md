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
CONTROL/bundled-skills.txt     the authoritative bundled-skills manifest
templates/                     API docs.md template
tests/                         smoke-test scaffolding
```

The setup is **idempotent**: running it again repairs and updates existing state rather
than duplicating providers, combos, PATH entries, or keys.

## Bundled skills

This repository installs **five** personal Claude Code skills, all visible to `claude`
and `claude-nine`:

- **`nine-router-setup`** — provisions and repairs the 9Router / `claude-nine`
  environment (the subject of this README).
- **`spec-protocol`** — turns any idea into a fully-built, QC'd, staged, merged-to-GitHub
  app or website. Invoke it later with `/spec-protocol`.
- **`kaizen`** — a Plan-Do-Check-Act continuous-improvement loop for anything already
  built (app, website, funnel, process, automation, document). Invoke it with `/kaizen`.
- **`eli5`** — explains complex topics in plain language. Invoke it with `/eli5`.
- **`bro`** — direct, blunt developer talk. Invoke it with `/bro`.

The authoritative list lives in [`CONTROL/bundled-skills.txt`](CONTROL/bundled-skills.txt);
the installers link every skill it names. Third-party upstreams (`eli5`, `bro`) carry
their own MIT notices in their skill folders and in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

### Kaizen tests

The Kaizen skill ships a fixture-only test suite (it never touches real Downloads,
`~/.claude`, or launchd). Run everything with:

```bash
bash .claude/skills/kaizen/tests/run-all-kaizen-tests.sh
```

That one command runs all sixteen suites: the core suite (sections 7.1–7.13),
the six-scenario walkthroughs, and the per-fix suites `fix01`–`fix14` (memory-root
resolution, deterministic init, registry, atomic locking, strict validation, secret
scanning, scheduling decision engine, launchd, Windows Task Scheduler structure,
installer idempotency, PDCA behavior, contract/activation behavior, companion-skill
provenance, and static/cross-platform checks). Individual suites live in
`.claude/skills/kaizen/tests/`. The suite **fails if any suite file is missing** —
a skipped suite is a gap, not a pass.

CI runs the same suites on macOS and Ubuntu, plus the PowerShell self-test on a
Windows runner (`.github/workflows/kaizen-tests.yml`).

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
