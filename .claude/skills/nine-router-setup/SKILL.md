---
name: nine-router-setup
description: "Set up a local 9Router on native Windows or macOS, wire DeepSeek Direct, Ollama Cloud, and Agnes AI from the user's own API docs.md, install the claude-nine launcher (routed Claude Code) while leaving plain claude untouched, and validate the full setup. Idempotent repair and re-run safe. Use when the user asks to set up, repair, or re-validate the 999-setup / 9Router / claude-nine environment. Never prints API keys."
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

- Install `9router@latest` (npm global on Windows; user-local npm prefix on macOS).
- Start, poll health at `http://localhost:20128` until healthy.
- Bind to loopback only; disable tunnel/Tailscale dashboard exposure.
- No dashboard password rotation is performed only when the dashboard starts clean. Full
  rotation, matching the live skill's Stage 3 step 7:
  1. Login with the default `123456` and read the login response — it carries a
     `mustChangePassword` flag.
  2. If `mustChangePassword: true`, generate a strong random password, then call
     `PATCH /api/settings` with `currentPassword` + `newPassword` (via
     `scripts/common/configure-nine-router.mjs`, which never prints it).
  3. Re-login with the new password for all subsequent API calls.
  4. Prove the password changed: SHA256 fingerprint before/after — the two must DIFFER.
  5. Never print or store the new password — keep it in memory during setup only.
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
  agnes-2.5-pro-alpha
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
  + `.ps1`; macOS: `$HOME/.local/bin/claude-nine`, mode 700).
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
  `CLAUDE_CODE_EFFORT_LEVEL=max`,
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`, and
  `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` derived from `OLLAMA_PLAN`
  (free→1, pro→2, max→8).
  The launcher must fail closed (refuse to exec `claude` unrouted) when any of the four
  alias pins is missing from the routed-session state.
- Protect session state: Windows DPAPI/current-user; macOS Keychain for the token + mode-600
  state file.
- Plain `claude` is never modified: no routing vars in global settings or shell startup files.

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

Claude routes:
Fable/Subagents -> DeepSeek V4 Flash (max)
Opus -> DeepSeek V4 Pro (max)
Sonnet -> Ollama GLM 5.2 (max)
Haiku -> Ollama Kimi K2.6 (<verified effort>)

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
