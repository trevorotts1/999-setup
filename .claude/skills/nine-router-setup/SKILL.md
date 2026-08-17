---
name: nine-router-setup
description: "Set up a local 9Router on native Windows or macOS, wire DeepSeek Direct, Ollama Cloud, and Agnes AI — plus OpenRouter as an optional fourth when OPENROUTER_API_KEY is present — from the user's own API docs.md, install the claude-nine launcher (routed Claude Code) while leaving plain claude untouched, and validate the full setup. Idempotent repair and re-run safe. Use when the user asks to set up, repair, or re-validate the 999-setup / 9Router / claude-nine environment. Never prints API keys."
trigger:
  - /nine-router-setup
  - "set up this computer from this repository"
  - "999-setup"
  - "set up 9router"
  - "install claude-nine"
  - "claude-nine"
  - "repair the router setup"
  - "re-validate 9router"
---

# nine-router-setup — provision 9Router + claude-nine on Windows/macOS

This skill provisions a **local 9Router** on native Windows or macOS, wires three primary
providers (DeepSeek Direct, Ollama Cloud, Agnes AI) from the user's own `API docs.md`,
and, when the optional `OPENROUTER_API_KEY` exists, OpenRouter as a fourth,
installs a **`claude-nine`** launcher, and validates everything — while leaving plain
`claude` completely untouched and Anthropic-direct.

**The setup scripts do the work.** This skill is the orchestrator's contract: it reads
state, calls the matching bundled orchestrator, verifies, and reports. It prefers
deterministic bundled scripts over improvising commands.

**Where things live:** `<skill-dir>` is this skill's directory. The orchestrators are at
`<skill-dir>/scripts/setup-windows.ps1` and `<skill-dir>/scripts/setup-macos.sh`. The
shared Node.js management-API helpers are under `<skill-dir>/scripts/common/`.

## Non-negotiable laws

1. **Never print an API key, local router token, or dashboard password.** Report names,
   sources, and HTTP status codes only. Mask diagnostics to at most the first 3 and last 3
   characters.
2. **Never touch the user's normal Claude Code.** No edits to `settings.json`, `.claude.json`,
   or global environment. Plain `claude` stays non-routed. `claude-nine` is the only routed
   entry point, and routing lives only in its child-process environment.
3. **Never use a separate Claude config root for `claude-nine`.** The skill installs once to
   the existing config root, so both `claude` and `claude-nine` see the same personal skills.
   This is deliberate, unlike skills that keep a separate profile: `claude-nine` reuses the
   same config root so both profiles see the same personal skills. The routing is scoped to
   the child process environment only — nothing persists globally.
4. **Never infer the OS from the shell.** Detect from the OS (Windows_NT / Darwin / else stop).
5. **Never substitute a model the user did not ask for.** If a required model is absent from
   the live provider catalog, stop that provider with a precise error.
6. **Use the management API, never direct database edits.**
7. **Verify live, by content.** Process alive ≠ router serving; exit 0 ≠ patched.
8. **Respect macOS privacy controls.** Documents access denied → stop with the precise grant
   instruction; never bypass TCC.
9. **Do not make Homebrew, Xcode CLT, or PowerShell 7 prerequisites.**
10. **Setup is not complete until the platform and shared smoke tests pass.**

## Step 0 — Preflight

- Verify the native OS (Windows_NT / Darwin). Non-supported OS → stop with the
  unsupported-platform message.
- macOS: verify `uname -m` = `arm64`; anything else stops before any download.
- Verify Claude Code exists (`claude --version` succeeds). If missing, tell the user to run
  the official installer from the repo README — do not silently reinstall over a working
  install.
- Capture an isolation baseline: checksums of `~/.claude/settings.json` and `~/.claude.json`
  (if present), or record their absence. Used at the end to prove plain `claude` is untouched.

## Step 1 — Resolve the real Documents folder

- Windows: `[Environment]::GetFolderPath('MyDocuments')` (OneDrive-safe).
- macOS: `osascript -e 'POSIX path of (path to documents folder)'`, trimmed; fall back to
  `$HOME/Documents`. TCC denial → stop with the precise grant instruction.

## Step 2 — Locate, parse, validate `API docs.md`

Read `<Documents>/API docs.md`. Accept `KEY=value` lines; trim whitespace; ignore blank
lines and Markdown headings/comments. Require and validate:

```text
OLLAMA_API_KEY      (required, non-empty, not placeholder)
DEEPSEEK_API_KEY    (required, non-empty, not placeholder)
AGNES_API_KEY       (required, non-empty, not placeholder)
OPENROUTER_API_KEY  (OPTIONAL: real key wires OpenRouter; absent or placeholder skips it — never a blocker)
OLLAMA_PLAN         (required: free | pro | max)
AGNES_PLAN          (required: starter | plus | pro)
```

Keep values in memory only. Never echo them. If the file is missing, tell the user the
exact OS-resolved path and the template (from `templates/API docs.md` in this repo).

## Step 3 — Select exactly one orchestrator

- Windows → `scripts/setup-windows.ps1`
- macOS → `scripts/setup-macos.sh`

Run the matching orchestrator. It performs the remaining steps; the skill verifies each
outcome rather than duplicating the work.

## Step 4 — Node.js (only when needed)

The orchestrator installs/repairs Node only if missing or below minimum (Node 20+, npm 10+).
A healthy existing Node 20+/npm 10+ is left alone. Never dismantle an nvm/fnm/asdf/volta/
Homebrew-managed environment that satisfies the requirements.

## Step 5 — 9Router install and first-run security

- Install `9router@latest` only when 9Router is absent or broken (proven by a real `--version` run); an existing working install is kept as-is — no reinstall, no upgrade. (npm global on Windows; user-local npm prefix on macOS.)
- Start, poll health at `http://localhost:20128` until healthy.
- Bind to loopback only; disable tunnel/Tailscale dashboard exposure.
- No dashboard password rotation is performed, ever. The user owns the dashboard
  password and manages it themselves:
  1. Login with the default `123456` only to configure.
  2. The `mustChangePassword` flag is ADVISORY only — the completion message tells
     the user the password stays the default and they change it themselves in the
     dashboard.
  3. Never print or store any password.
- Create/reuse a local 9Router API key named `BlackCEO Claude Code` via `POST /api/keys`.
- Keep `requireLogin=true` and `requireApiKey=true`.

## Step 6 — Provider credentials and live model resolution

Using the authenticated management API and the shared helpers under `scripts/common/`:

- **DeepSeek Direct** (native provider, slug `deepseek`): import `DEEPSEEK_API_KEY`; require
  `deepseek-v4-flash` and `deepseek-v4-pro` from `https://api.deepseek.com/models`.
- **Ollama Cloud** (native provider, slug `ollama`): import `OLLAMA_API_KEY`; query
  `https://ollama.com/api/tags` and require `glm-5.2`, `kimi-k2.6`, `minimax-m3`,
  `gemma4:31b` (plus `deepseek-v4-flash:0731` only when the override is enabled). Use the
  exact returned IDs.
- **Agnes AI** (custom OpenAI-compatible node): create the node
  `{name: "Agnes AI", prefix: "agnes", type: "openai-compatible", apiType: "chat",
  baseUrl: "https://apihub.agnes-ai.com/v1"}` and a paired connection carrying
  `AGNES_API_KEY`; validate `agnes-2.5-flash` with a tiny probe.
- Register **ALL THREE** Agnes models in the router's `kv` table so the dashboard's
  "Available Models" list is complete — never just the flash lane:

  ```text
  agnes-2.5-flash        (required — the default)
  agnes-2.5-pro
  ```

  `scripts/common/configure-nine-router.mjs` handles this registration idempotently —
  the skill verifies the roster landed rather than re-writing it by hand.

**DS Light and DS Max — DeepSeek custom provider nodes**

Create two additional custom OpenAI-compatible nodes using the same `DEEPSEEK_API_KEY`:

- **DS Light**: prefix `ds-light`, baseUrl `https://api.deepseek.com/anthropic`, thinking
  OFF, default `deepseek-v4-flash`
- **DS Max**: prefix `ds-max`, baseUrl `https://api.deepseek.com/anthropic`, thinking
  MAX, default `deepseek-v4-pro`

These give the routing matrix explicit thinking control per tier instead of relying on
the 9Router `(max)` suffix mechanism.

- **OpenRouter** (built-in provider, slug `openrouter`, verified 0.5.50): import
  `OPENROUTER_API_KEY` only when present; validate via
  `https://openrouter.ai/api/v1/auth/key`; live-discover
  `https://openrouter.ai/api/v1/models`; all models route by passthrough as
  `openrouter/<vendor>/<model>`; verify with one live-discovered `:free` model;
  402/429 = account condition, never a config failure; never added to default
  combos/lanes.

## Step 7 — Combos: fallback and fusion

The routing matrix this skill wires:

| Alias | Provider | Model | Thinking |
|-------|----------|-------|----------|
| Fable | DeepSeek Direct | ds/deepseek-v4-flash | Max |
| Opus | DS Max | ds-max/deepseek-v4-pro | Max |
| Sonnet | DeepSeek Direct | ds/deepseek-v4-flash | Max |
| Haiku | DS Light | ds-light/deepseek-v4-flash | Off |
| Subagents | DeepSeek Direct | ds/deepseek-v4-flash | Max |
| Haiku Fallback | Agnes AI | agnes/agnes-2.5-flash | Provider-supported |
| Vision | Ollama Cloud | ollama/kimi-k2.6 | Provider-supported |
| OpenRouter (optional) | OpenRouter | openrouter/<vendor>/<model> | Passthrough (openai format) |

- Create/update `blackceo-fable-fallback` and `blackceo-opus-fallback` (DeepSeek first,
  Agnes second) — fallback strategy via settings `comboStrategies`.
- Create/update `blackceo-fusion` — panels `ds/deepseek-v4-flash`, `ollama/glm-5.2`,
  `ollama/kimi-k2.6`; judge `ds/deepseek-v4-pro`; strategy `fusion` via settings
  `comboStrategies["blackceo-fusion"] = {fallbackStrategy: "fusion", judgeModel: ...}`.
- Inspect the installed version's `comboStrategies` schema before writing (see
  `references/nine-router-api.md`).

## Step 8 — Capacity auto-switch (verified modalities only)

- Vision → `ollama/kimi-k2.6` (verified Text+Image); a tiny image smoke test must pass.
- PDF → disabled (not verified end-to-end).
- Audio → disabled (Gemma 4 31B has no audio input).
- Video → disabled.

## Step 9 — `claude-nine` launcher + routed-session guardrails

- Install the platform-native launcher (Windows: `%LOCALAPPDATA%\BlackCEO\999\bin\claude-nine.cmd`
  + `%LOCALAPPDATA%\BlackCEO\999\lib\claude-nine.ps1`; macOS: `$HOME/.local/bin/claude-nine`, mode 700).
- The launcher: resolves the same `claude` binary, preserves the existing config root, starts
  9Router on demand with bounded retries, loads protected session state, exports routing vars
  only into the child process, and never echoes secrets.
- Routed-session env: `ANTHROPIC_BASE_URL=http://localhost:20128/v1`,
  `ANTHROPIC_AUTH_TOKEN=<local router key>`, the four alias pins
  (`ANTHROPIC_DEFAULT_FABLE_MODEL` = `ds/deepseek-v4-flash(max)`,
  `ANTHROPIC_DEFAULT_OPUS_MODEL` = `ds-max/deepseek-v4-pro`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL` = `ds/deepseek-v4-flash(max)`,
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` = `ds-light/deepseek-v4-flash`),
  `CLAUDE_CODE_SUBAGENT_MODEL` = `ds/deepseek-v4-flash(max)`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`, and
  `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` derived from `OLLAMA_PLAN`
  (free→1, pro→2, max→8).
  `CLAUDE_CODE_EFFORT_LEVEL` is NOT exported: the launcher sets it only when
  `CLAUDE_NINE_FORCE_EFFORT=<level>` is present for that launch. Unconditional
  export overrode every in-session `/effort` selection; the profile's
  `settings.json` `effortLevel` (seeded `xhigh` — the highest persistable level)
  is the recorded default instead.
  **Effort persistence (Issue 1):** the state file carries `lastEffortSelection`
  (the user's last `/effort` pick; seeded `null` on first write, carried forward
  on every setup re-run — a re-provision never wipes it). At launch the launcher
  re-applies it: `ultracode` becomes the `--effort ultracode` CLI flag on the
  exec line (the only mechanism that survives a session boundary for ultracode —
  no settings key or env var accepts it); `low|medium|high|xhigh|max` become a
  per-launch `CLAUDE_CODE_EFFORT_LEVEL` export. `CLAUDE_NINE_FORCE_EFFORT` wins
  over `lastEffortSelection`. The ONLY sanctioned writer is
  `scripts/common/record-effort-selection.mjs` (temp-file + rename, mode 600,
  refuses unknown values).
  The launcher must fail closed (refuse to exec `claude` unrouted) when any of the four
  alias pins is missing from the routed-session state.
- Protect session state: Windows DPAPI/current-user; macOS Keychain for the token + mode-600
  state file.
- Plain `claude` is never modified: no routing vars in global settings or shell startup files.

## Step 9.6 — Clear the ultracode/effort override (both platforms)

`CLAUDE_CODE_EFFORT_LEVEL` in the environment **overrides the in-session `/effort` picker**:
with it set, `/effort ultracode` returns *"CLAUDE_CODE_EFFORT_LEVEL=… overrides effort this
session"* and the selection is not applied. Only `low|medium|high|xhigh` are persistable, so
`max` cannot be saved at all. Step 9 stopped the launcher exporting it — that fix cannot reach
a box where the variable comes from somewhere else, so the orchestrators run a dedicated
remediation step: `scripts/macos/fix-ultracode-override.sh` and
`scripts/windows/Fix-UltracodeOverride.ps1`.

- **Detects, and names every source it checked** — the current process environment; the
  launchd user domain (macOS) or the User and Machine environment scopes (Windows); six shell
  startup files (macOS) or the four PowerShell profiles (Windows); the `env` map of
  `~/.claude/settings.json`, `settings.local.json` and the `~/.claude-nine` pair; and, macOS,
  candidate service env files. `~/.zlogin`, `~/.bash_login` and `/etc/*` are checked read-only.
- **Proves its own scanner on a planted control first.** A failed control degrades the run to
  detect-only and reports UNDETERMINED — never "clean". `launchctl getenv` and each
  environment-scope read get a known-non-empty control too.
- **Remediates safely** — every edited file is backed up first (never overwriting an existing
  backup, path printed); shell/profile lines are **commented out** behind a dated marker,
  never deleted; `launchctl unsetenv` and the User scope are cleared and re-read to prove it;
  `settings.json` gets a **merge-remove of only that key**, validated against every
  pre-existing leaf value, with the backup restored on any failure.
- **Refuses to guess.** The current process environment, the Machine scope, an AllUsers
  profile, a service env file, and any unrecognised line form are reported with the exact
  manual command instead of edited.
- **Idempotent, standalone, and never disruptive.** Rerunning is a byte-identical no-op. The
  script runs on an already-installed box without a reinstall. It takes effect in **NEW**
  shells and **NEW** sessions; nothing is killed, signalled, restarted, reloaded, or `exec`ed.
- Never fatal to setup: exit 1 (manual step needed) and exit 2 (tooling failure, backups
  restored) are both reported honestly in the completion report and the install completes.

Run it standalone on an already-installed box:

```bash
bash ~/.claude/skills/nine-router-setup/scripts/macos/fix-ultracode-override.sh
```

## Step 9.7 — Record the user's `/effort` selection (both platforms)

This step is MANUAL BY DESIGN: nothing in the repo runs the record helper
automatically — no SessionStart hook, no skill wrapper, no setup script
invokes it. The field stays `null` until one of the commands below is run by
hand (or re-run whenever the `/effort` selection changes); the launcher
tolerates a missing/stale value and falls through to its default effort.

`lastEffortSelection` is written ONLY by the record helper — nothing else may
edit the field, so a setup re-run carries the value forward instead of wiping
it. The launcher reads it at exec time (Step 9).

- Valid values: `low|medium|high|xhigh|max|ultracode`. Anything else is
  refused with a non-zero exit.
- `ultracode` lives ONLY in the state file — it is not accepted by any
  settings key or env var; the launcher translates it into the
  `--effort ultracode` CLI flag.
- State file path: macOS `$HOME/Library/Application Support/BlackCEO/999/router-session.json`;
  Windows `%LOCALAPPDATA%\BlackCEO\999\router-session.json`.

```bash
# macOS / Linux / Git-Bash
node ~/.claude/skills/nine-router-setup/scripts/common/record-effort-selection.mjs \
  "$HOME/Library/Application Support/BlackCEO/999/router-session.json" ultracode
```

```powershell
# Windows
node "$env:USERPROFILE\.claude\skills\nine-router-setup\scripts\common\record-effort-selection.mjs" `
  "$env:LOCALAPPDATA\BlackCEO\999\router-session.json" ultracode
```

The write is atomic (temp file + rename) and mode 600; it never prints secrets
(the state file contains none by construction).

## Step 10 — Verify skill visibility and isolation

- The `nine-router-setup` personal skill is visible from both `claude` and `claude-nine`.
- `claude-nine` uses the same Claude config root (no separate `CLAUDE_CONFIG_DIR`).
- Plain `claude` is byte-identical to the preflight baseline (no router env persisted).

## Step 11 — Smoke tests

The orchestrator runs the platform tests and shared routing tests:
`claude --version`, `node --version` ≥ 20, `npm --version` ≥ 10, 9Router found + healthy,
`claude-nine` on PATH, provider micro-requests through the router, thinking probes
(max where verified; downgrade per-route and record when rejected), vision routing via
capacity adapter, DeepSeek→Agnes fallback (non-destructive), `blackceo-fusion` one-shot,
plain-`claude` isolation, and a `claude-nine` end-to-end routed request. Thinking probes
per route: max verified on DS Max, off verified on DS Light, max verified on DS Flash,
provider-default on Agnes.

## Step 12 — Completion report

On success, produce the report exactly in this shape:

```text
999 SETUP: COMPLETE

Operating system: <Windows|macOS>
Claude Code: OK
Personal skill in normal claude: OK
Personal skill in claude-nine: OK
claude-nine launcher: OK
Normal claude routing: UNCHANGED
Node.js: OK
npm: OK
9Router: OK - http://localhost:20128
Dashboard: http://localhost:20128 — open this in your browser to manage providers and models.
DeepSeek Direct: OK
Ollama Cloud: OK
Agnes AI: OK
OpenRouter (optional): OK (via <free model>) | skipped - no OPENROUTER_API_KEY found in API docs.md | account: HTTP 402 ...

Claude routes:
Fable/Subagents -> DeepSeek V4 Flash (max)
Opus -> DeepSeek V4 Pro via DS Max (max)
Sonnet -> DeepSeek V4 Flash (max)
Haiku -> DeepSeek V4 Flash via DS Light (off)

Fallback:
DeepSeek -> Agnes 2.5 Flash: OK

Fusion:
DeepSeek Flash + GLM 5.2 + Kimi K2.6
Judge -> DeepSeek V4 Pro
Status: OK

Ollama plan: Pro
Ollama Claude/9Router concurrency budget: 2
Reserved for OpenClaw: 1

Vision auto-switch -> Kimi K2.6: OK
PDF auto-switch: DISABLED - not verified end-to-end
Audio auto-switch: DISABLED - Gemma 4 31B has no audio input

Launch routed Claude Code with: claude-nine

No API keys were printed.
```

Never include credentials. If a provider rejected max reasoning, record the downgrade in the
report. If a step is genuinely blocked, return exactly one precise blocker.

## Failure behavior

Self-repair ordinary failures and report one precise human action only when automation
cannot safely continue:

- 9Router not ready → bounded wait/retry.
- `claude-nine` missing from PATH → repair the launcher, refresh PATH.
- Duplicate provider/combo/key → reuse/update the existing record.
- Model ID changed → refresh the live catalog and resolve the current ID.
- Max reasoning rejected → downgrade only that route; report it.
- Port 20128 occupied → verify an existing healthy 9Router owns it before acting.
- `API docs.md` missing → name the exact OS-resolved path and the required template.
- Credential invalid → name only the failing provider; never print the key.
- macOS Documents denied → the exact Privacy & Security grant instruction.
- Node checksum mismatch → delete the download, stop; never extract it.
- Keychain denied → the exact Keychain permission blocker; never fall back to plaintext.
- Read-only/managed shell profile → install the launcher and state the one manual PATH line.
- OpenRouter key invalid / 402 / 429 → record honestly on the OpenRouter line only; never
  block the other providers; absence of the key is not a failure at all.

See `references/troubleshooting.md` for the full catalog.

## Reference documents

- `references/architecture.md` — component layout and data flow
- `references/credential-contract.md` — API docs.md format and protections
- `references/model-routing.md` — the full routing matrix and reasoning-effort rules
- `references/nine-router-api.md` — verified 9Router management-API schemas
- `references/platform-windows.md` — Windows-specific mechanics
- `references/platform-macos.md` — macOS-specific mechanics
- `references/security.md` — security defaults and threat model
- `references/troubleshooting.md` — failure catalog and self-repair playbook
