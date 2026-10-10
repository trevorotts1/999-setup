# AGENT_INSTALL — instructions for Claude Code

This file is written for **Claude Code**, not as a human tutorial. Read it fully before
doing anything. The user asked you to "set up this computer from this repository". Follow
this procedure exactly. Do not skip steps. Do not stop early.

**Golden rules that override everything else in this file:**

- ⛔ **Never print an API key, a local router token, or a password** — not to the user, not
  to a log, not into a file you will show anyone.
- ⛔ **Never commit credentials** to this repository or any other.
- ⛔ **Never touch the user's normal Claude Code configuration** (`settings.json`,
  `.claude.json`, environment). Plain `claude` must stay Anthropic-direct and non-routed.
  **One exception, owner-authorized:** the orchestrator runs spec-protocol's
  `tools/install-hooks.sh` (Windows: `tools/install-hooks.ps1`), which (with no argument, for `claude` and, when it exists, `claude-nine`) backs `settings.json`
  up to `settings.json.bak-spec-protocol-<timestamp>` first and then MERGES exactly four hook
  registrations into it (Stop → `conversation-gate.py`, `gate0-claim-gate.py`; PreToolUse
  `Workflow` → `workflow-syntax-gate.py`; PreToolUse `Workflow|Agent|Task|SendMessage` →
  `dispatch-gate.py`, timeout 120), keeping every existing key and entry. Nothing else in the file changes.
  **Second exception, owner-authorized (step 5.2):** the KIE key step writes exactly one
  entry — `env.KIE_API_KEY` — into the `env` block of `settings.json` for each config root
  on this machine, keeps that file at permission 600, and changes nothing else in it.
- ⛔ **Never print the KIE key either.** Step 5.2 reports `KIE key: SET` or
  `KIE key: NOT SET` and nothing more.
- ⛔ **Never infer the operating system from the current shell.** Detect it from the OS.
- ⛔ **Prefer the bundled deterministic scripts** over improvising shell commands.
- ⛔ **Do not stop until the validation suite passes, or you can name exactly one blocker**
  that requires the user's action. Report blockers precisely; self-repair everything else.

---

## 1. Determine the repository root

The repository root is the folder containing this `AGENT_INSTALL.md`. Record its absolute
path. If the user pointed Claude Code at a URL and the repo was cloned/downloaded already,
locate the extracted `999-setup` folder.

## 2. Detect the native operating system

Detect the OS from the operating system itself, never from the shell:

- **Windows** → environment variable `OS` is `Windows_NT`, or `systeminfo`/`wmic os get
  caption` reports Windows.
- **macOS** → `uname -s` returns exactly `Darwin`.
- **Anything else** (Linux, WSL, etc.) → **STOP**. Print:
  `999 setup supports native Windows and macOS only. This computer is not supported.`

Windows and macOS each have one orchestrator. There is no shared fallback path.

## 3. Resolve the real Documents folder

- **Windows:** `[Environment]::GetFolderPath('MyDocuments')` via PowerShell. Do not assume
  `C:\Users\<name>\Documents` — Documents may be redirected into OneDrive.
- **macOS:** `osascript -e 'POSIX path of (path to documents folder)'`, trim the trailing
  slash. If `osascript` is unavailable, fall back to `$HOME/Documents`. If macOS privacy
  (TCC) blocks reading Documents, **stop** with exactly this instruction:
  *"Grant this Terminal/Claude Code process access to Documents in macOS Settings → Privacy
  & Security → Files and Folders, then rerun."* Do not bypass macOS privacy controls.

## 4. Acquire the repository (if not already present)

- **Windows:** if `git` is missing, install Git for Windows with WinGet:
  ```powershell
  winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
  ```
  Refresh the current process PATH, then clone into the resolved Documents folder.
- **macOS:** do not require Homebrew or Xcode Command Line Tools to FETCH the repo (the
  orchestrator itself installs the Command Line Tools later, because spec-protocol runs on
  their `git` and `python3`). If `xcode-select -p`
  succeeds and functional Git exists, clone. Otherwise download the public `main` archive
  with built-in `curl` and `tar`:
  ```bash
  curl -fsSL https://github.com/trevorotts1/999-setup/archive/refs/heads/main.tar.gz -o "$HOME/999-setup.tar.gz"
  tar -xzf "$HOME/999-setup.tar.gz" -C "<resolved Documents>"
  ```
  and continue from the extracted `999-setup-main` directory as the repository root.

If the repository is already present, REFRESH it before proceeding: a git clone →
`git pull --ff-only`; an extracted archive → re-download and re-extract the current
`main` over it. A stale checkout will silently miss newer provider support.

## 5. Install the personal skills

Install the bundled personal Claude Code skills into the config roots this machine
actually uses, so both commands see them. There are **two** roots on macOS:

- `~/.claude` — normal `claude` (Anthropic-direct, never routed).
- `~/.claude-nine` — `claude-nine`, whose launcher sets `CLAUDE_CONFIG_DIR=$HOME/.claude-nine`
  and therefore reads `~/.claude-nine/skills`.

Install every skill into `~/.claude/skills`, then bring `~/.claude-nine/skills` up to date
with `sync-nine-skills.sh` (step 5.3); the KIE helper install of step 5.1 writes both roots
in one run. Both roots are deliberate: `claude-nine` exports `CLAUDE_CONFIG_DIR` itself, so
do not undo it and do not invent a third root. Windows is the one-root case: its launcher
sets no `CLAUDE_CONFIG_DIR`, so both commands read the single default root
`%USERPROFILE%\.claude`.

The authoritative list is `CONTROL/bundled-skills.txt` — one skill per line; `#`
comments and blank lines are ignored. Install **every** skill it names, not a
hand-picked subset. The manifest currently bundles:

- `nine-router-setup` — required for the 999 bootstrap and repair runs
- `spec-protocol` — build a fully-built, QC'd, staged, merged-to-GitHub app or website
- `kaizen` — Plan-Do-Check-Act improvement loop for things already built
- `eli5` — plain-language explanation of complex topics
- `bro` — direct, blunt developer talk
- `blackceo-signature-page` — BlackCEO Signature landing pages, end to end
- `hook-skill` — Claude Code hooks package (workflow guard, hygiene, disk cleanup)
  (opt-in `--lock-settings` / `-LockSettings` hard-locks the claude and claude-nine settings files; default is no lock; every settings writer in this repo unlocks, writes, validates and re-locks a locked file; a SessionStart wiring self-check warns when hook registrations go missing)
- `kiss` — one-message double answer: friendly version, then a plain short version

```text
Source:  <repo>/.claude/skills/<skill-name>
Target:  <Claude config root>/skills/<skill-name>
```

`<Claude config root>` means **every** config root this machine uses: `~/.claude` (normal
`claude`) and `~/.claude-nine` (`claude-nine`, set by its own launcher) on macOS, or the
single default root (`$CLAUDE_CONFIG_DIR` if the user set one, otherwise `~/.claude`) on
Windows. Where a step names one root, repeat it for each root the machine has.

- If a previous copy of any bundled skill already exists at the target, **back it up**
  first (move it aside with a timestamp suffix) before copying the new one. **Move it
  OUTSIDE the config root** — not into another folder under `skills/`, and not into
  `<Claude config root>/backups/` either. Observed directly on a real machine: a full
  skill tree (`SKILL.md` and all) left anywhere beneath a config root is picked up by
  the harness and registers as a **second, phantom skill** named after the backup
  directory. That pollutes every future session with a duplicate entry and invites an
  agent to load the stale copy by mistake. `spec-protocol`'s own
  `tools/self-update.sh` defaults its backups to `$HOME/.spec-protocol-backups` for
  exactly this reason. Use a home-level directory outside every config root:

  ```text
  macOS:    $HOME/.claude-skill-backups/<skill-name>.<timestamp>
  Windows:  %USERPROFILE%\.claude-skill-backups\<skill-name>.<timestamp>
  ```

  Keep the timestamp suffix — it is what makes a repeat run non-destructive.
- Copy each whole skill directory, including `references/`, `scripts/`, `tools/`, and
  `PROMPT-QC-INSTRUCTIONS.md`.

### 5.1 Install the KIE helper skills (required — do not skip)

The bundled `drama-song-ad-factory` skill invokes onboarding helper skills: the KIE
image/video/audio model selectors, the KIE paid transport, the callback relay, plus
`07-kie-setup` (the common KIE rules, `references/kie-common-rules.md`) and `shared-utils`
(the key resolver and the prompt enforcer). Naming them does **not** install them. They
ship in this repository under `installer-registration/helpers/`, pinned by version and
sha256 tree hash in `installer-registration/helper-dependencies.json`. The current pins are
the re-pinned OpenClaw versions: `74-kie-live-adapter` **v1.1.5**, `67-kie-video`
**v2.1.3**, together with `46-kie-callback-relay`, `66-kie-image`, `68-kie-audio`,
`07-kie-setup` and `shared-utils`. After step 5's skill copies,
run from the repository root:

- macOS:   `python3 installer-registration/helper-deps.py install`
- Windows: `py installer-registration\helper-deps.py install`

One install run lands **every** helper in **both** roots this machine has —
`~/.claude/skills` and `~/.claude-nine/skills` — and still honors `CLAUDE_CONFIG_DIR` for a
machine that runs a single root (a differing pre-existing copy is first moved to
`$HOME/.claude-skill-backups/`, never deleted), verifies every vendored tree against its
pin, and finishes by running the helper preflight. Treat a nonzero exit as a BLOCKER and
follow the printed repair line; the output names the helper that failed and the exact
command that fixes it. `claude-nine` exports `CLAUDE_CONFIG_DIR` itself; do not override it
in the client's shell profile and do not invent a third root.

Then, at step 11, add this check to the test run:

```text
python3 installer-registration/helper-deps.py preflight
```

It exits 0 only when every pinned helper — `74-kie-live-adapter` v1.1.5, `67-kie-video`
v2.1.3, `46-kie-callback-relay`, `66-kie-image`, `68-kie-audio`, `07-kie-setup` and
`shared-utils` — is present at its pinned hash in **each** config root this machine uses,
and exits 1 with an actionable per-helper error otherwise (directive 2.4: a clean install
must receive the helpers; a missing one fails preflight).

### 5.2 Collect the client's own KIE key (required before any paid KIE call)

Each client brings their own KIE account. Ask the client for their key, or read it from
the client's own API document if they point you at one. Never an operator key, never a
Trevor key, never a hardcoded key.

- **Variable name:** `KIE_API_KEY` — exactly the name skill 74's `kie_live_adapter.py` reads.
- **Where it goes:** the `env` block of `settings.json` in **every** config root this machine
  uses — `~/.claude/settings.json` and, when `claude-nine` is installed,
  `~/.claude-nine/settings.json` — through the settings-writer pattern (unlock, edit,
  validate, re-lock), with `settings.json` kept at **permission 600**.
- **What you print:** only `KIE key: SET` or `KIE key: NOT SET`. The value never reaches
  output, a log, a transcript, a test result, or any file other than that `env` block.
  Setup prints the same two words during the run; if it reports `NOT SET`, or the run
  predates this step, finish it here before anything paid happens.
- **Credits gate:** run the credits check once — a read call, no paid job — and print only
  the balance. Write the single word `active` to `<config root>/kie-live-adapter-mode.conf`
  for each config root **only when that credits call passes**. If the key is absent, or the
  credits call fails, the mode file is left at its shadow default. Skill 74 stays in
  **shadow** mode and makes no paid call until the gate passes.

**No KIE MCP.** There is no KIE MCP server: none exists, none is installed, and no
`.mcp.json` or mcp registration of any kind is added. Every paid KIE call goes through
**skill 74** (`74-kie-live-adapter`) and nothing else calls `api.kie.ai` directly. Each
client's own key carries that client's own budget of **20 new generation requests per 10
seconds**.

### 5.3 Keep `claude-nine`'s skills root current (`sync-nine-skills.sh`)

`~/.claude-nine/skills` mirrors `~/.claude/skills`; it is not a second hand-maintained
copy. The installer places `sync-nine-skills.sh` at `~/.local/bin/sync-nine-skills.sh` with
execute permission. It mirrors the installed skills from `~/.claude/skills` into
`~/.claude-nine/skills` — linking what is missing, pruning links to skills that were
removed — and the `claude-nine` launcher runs it at startup. Run it once after every skill
or helper install and again before the verification in step 9:

```text
~/.local/bin/sync-nine-skills.sh
```

## 6. Read SKILL.md files fully

Read `<Claude config root>/skills/nine-router-setup/SKILL.md` in full before running
anything. It defines the skill's behavior, ordering, and safety rules for this run and for
future `/nine-router-setup` repair runs.

The bundled `spec-protocol` skill is also installed for the user's future use (build a
fully-built, QC'd, staged, merged-to-GitHub app or website), alongside `kaizen`
(Plan-Do-Check-Act improvement loop), `eli5` (plain-language explanations), and `bro`
(direct developer talk). None of the four is required for the 999-setup bootstrap
itself, but they ship with this repository so the client gets the full bundle.

## 7. Run exactly one orchestrator

Because Claude Code may need a new session to discover a brand-new personal skills
directory, **do not depend on immediate skill rediscovery.** Run the bundled orchestrator
directly in this session:

- **Windows** → `scripts/setup-windows.ps1`
- **macOS** → `scripts/setup-macos.sh`

Run the orchestrator for the detected OS only. Pass no secrets on the command line.

**Run it in the background and monitor it.** On a fresh Mac the orchestrator waits for
Apple's Command Line Tools installer (up to 60 minutes), which outlasts any single tool
call's timeout. Start it with `run_in_background` and its output redirected to a log file,
then watch that log (a Monitor, or re-reading it) until the `999 SETUP: COMPLETE` report or
a `BLOCKER:` line appears. Relay progress to the client in plain words while you wait.
Never re-launch it while a run is still going.

The orchestrator performs, in order: OS + architecture verification; Claude Code
existence check; Documents resolution; `API docs.md` locate/parse/validate; Node.js
install/repair only when needed; 9Router install (an existing working install — proven by a real `--version` run — is kept as-is, no reinstall, no upgrade); first-run security (dashboard login,
API key creation, localhost-only bind; **no dashboard password rotation** — the user
owns the dashboard password); provider credential import (including the optional
OpenRouter lane when `OPENROUTER_API_KEY` is present); live model
resolution; provider connections; fallback + fusion combos; capacity auto-switch
(vision only); `claude-nine` launcher install; routed-session concurrency guardrails;
and the smoke-test suite; then Git/Python/GitHub CLI (macOS: Command Line Tools + `gh`;
Windows: winget `Git.Git`, `Python.Python.3.12`, `GitHub.cli`, with the Git Bash path
recorded in `CLAUDE_CODE_GIT_BASH_PATH`), the Vercel CLI (installed into the same npm
prefix as 9Router; used to publish finished products), the spec-protocol hook registration
above, and ultracode on by default for `claude-nine`. Setup also sets `"permissions":
{"defaultMode": "bypassPermissions"}` in the `claude-nine` settings (only when no
`defaultMode` is set; backed up first; on Windows that file is the single root both
commands read) so a
build never stalls at a permission prompt while the client is away. A background run does not do the
GitHub sign-in; its report says `GitHub sign-in: PENDING` and you do it next.

**GitHub sign-in — its own visible step.** When the report says `PENDING` (or `NOT SIGNED
IN`), run, in the background with output to a log:

```text
gh auth login --web --hostname github.com --git-protocol https
```

Read the log for the line with the one-time code (`XXXX-XXXX`) and show the client that code
and the address `https://github.com/login/device` in plain words: "Open this page, sign in
to GitHub, and type this code." Wait until the command exits, then confirm with
`gh auth status`. If the client declines, builds keep work on this computer only.

**Operator keys (optional; supplied by the operator, never guessed, never printed).**
Each is written to `<config root>/spec-protocol/operator.env` (macOS: mode 600, in both
the `claude` and `claude-nine` roots) only when supplied; a re-run without one keeps the
earlier value:

- `SPEC_PROTOCOL_OPERATOR_REMOTE_OWNER` — the GitHub org that holds client backups when the
  client is not signed in. Flag `--operator-remote-owner <org>` (macOS) /
  `-OperatorRemoteOwner <org>` (Windows), or the environment variable.
- `SPEC_PROTOCOL_OPERATOR_GH_TOKEN` — a GitHub token that can create repos in that org.
  Environment variable only.
- `VERCEL_TOKEN` — the Vercel token used to publish finished products. Environment variable
  only.

Tokens go in the orchestrator's environment, never on its command line. Never read them
back or echo them.

## 8. Install and validate the platform-native `claude-nine` command

The orchestrator installs the `claude-nine` launcher. Verify afterwards:

- Windows: `claude-nine.cmd` is on the user PATH and callable from both CMD and PowerShell.
- macOS: `$HOME/.local/bin/claude-nine` exists, is executable (mode 700), and a fresh login
  shell can resolve `claude-nine`.

## 9. Verify skill visibility in both config roots

Verify **every skill in `CONTROL/bundled-skills.txt`** is visible from **both**:

- normal `claude` → `~/.claude/skills`
- `claude-nine` → `~/.claude-nine/skills` (its launcher sets `CLAUDE_CONFIG_DIR=$HOME/.claude-nine`)

The two roots must expose the same skill set, because one install feeds both: skills and
KIE helpers land in `~/.claude/skills`, the helper install also writes
`~/.claude-nine/skills`, and `sync-nine-skills.sh` (step 5.3) mirrors the rest. List both
directories, run `~/.local/bin/sync-nine-skills.sh`, and confirm the skill names match. On
Windows there is one root, so confirm it once.

## 10. Verify plain `claude` is not routed and `claude-nine` activates the router

- Plain `claude`: verify no `ANTHROPIC_BASE_URL=http://localhost:20128/v1` was persisted
  into global Claude settings or shell startup files by this setup.
- `claude-nine`: verify a minimal non-interactive request reaches 9Router successfully.

## 11. Run the tests

Run the platform-specific tests plus the shared routing tests that the orchestrator
produces. Follow the orchestrator's completion report format. Do not claim success until
the checks pass.

## 12. Stay with the setup until validation completes

If a step fails, repair it and retry before escalating. Only escalate when automation
cannot safely continue, and then give exactly one precise blocker with the user action
required.

## 13. Never expose secrets

No API key, no local router token, no dashboard password — never in output, logs, or
files. Mask diagnostics to at most the first 3 and last 3 characters of a value if
absolutely necessary.

## 14. Return the completion report

Return only the concise completion report (defined in `SKILL.md`), or exactly one blocker.
