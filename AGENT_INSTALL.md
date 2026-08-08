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
- **macOS:** do not require Homebrew or Xcode Command Line Tools. If `xcode-select -p`
  succeeds and functional Git exists, clone. Otherwise download the public `main` archive
  with built-in `curl` and `tar`:
  ```bash
  curl -fsSL https://github.com/trevorotts1/999-setup/archive/refs/heads/main.tar.gz -o "$HOME/999-setup.tar.gz"
  tar -xzf "$HOME/999-setup.tar.gz" -C "<resolved Documents>"
  ```
  and continue from the extracted `999-setup-main` directory as the repository root.

If the repository was already acquired by the user, skip this step.

## 5. Install the personal skills

Install BOTH bundled personal Claude Code skills into the user's **existing** Claude
config root so they are visible to both `claude` and `claude-nine`. Do not create a
second config root for `claude-nine`; do not set a separate `CLAUDE_CONFIG_DIR`.

```text
Source:  <repo>/.claude/skills/nine-router-setup
Target:  <Claude config root>/skills/nine-router-setup

Source:  <repo>/.claude/skills/spec-protocol
Target:  <Claude config root>/skills/spec-protocol
```

`<Claude config root>` is `~/.claude` by default, or `$CLAUDE_CONFIG_DIR` if the user has
set it.

- If a previous `nine-router-setup` or `spec-protocol` skill already exists at the
  target, **back it up** first (move it aside with a timestamp suffix) before copying
  the new one.
- Copy each whole skill directory, including `references/`, `scripts/`, `tools/`, and
  `PROMPT-QC-INSTRUCTIONS.md`.

## 6. Read SKILL.md files fully

Read `<Claude config root>/skills/nine-router-setup/SKILL.md` in full before running
anything. It defines the skill's behavior, ordering, and safety rules for this run and for
future `/nine-router-setup` repair runs.

The bundled `spec-protocol` skill is also installed for the user's future use (build a
fully-built, QC'd, staged, merged-to-GitHub app or website). It is not required for the
999-setup bootstrap itself, but it ships with this repository so the client gets both.

## 7. Run exactly one orchestrator

Because Claude Code may need a new session to discover a brand-new personal skills
directory, **do not depend on immediate skill rediscovery.** Run the bundled orchestrator
directly in this session:

- **Windows** → `scripts/setup-windows.ps1`
- **macOS** → `scripts/setup-macos.sh`

Run the orchestrator for the detected OS only. Pass no secrets on the command line.

The orchestrator performs, in order: OS + architecture verification; Claude Code
existence check; Documents resolution; `API docs.md` locate/parse/validate; Node.js
install/repair only when needed; 9Router install (an existing working install — proven by a real `--version` run — is kept as-is, no reinstall, no upgrade); first-run security (dashboard login,
API key creation, localhost-only bind; **no dashboard password rotation** — the user
owns the dashboard password); provider credential import; live model
resolution; provider connections; fallback + fusion combos; capacity auto-switch
(vision only); `claude-nine` launcher install; routed-session concurrency guardrails;
and the smoke-test suite.

## 8. Install and validate the platform-native `claude-nine` command

The orchestrator installs the `claude-nine` launcher. Verify afterwards:

- Windows: `claude-nine.cmd` is on the user PATH and callable from both CMD and PowerShell.
- macOS: `$HOME/.local/bin/claude-nine` exists, is executable (mode 700), and a fresh login
  shell can resolve `claude-nine`.

## 9. Verify shared skill visibility

Verify the `nine-router-setup` personal skill is visible from **both**:

- normal `claude`
- `claude-nine`

They must resolve the **same** skill (same config root, no duplicate install).

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
