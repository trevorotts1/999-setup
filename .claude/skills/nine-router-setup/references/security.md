# Security

## Security defaults (mandatory)

```text
local-only 9Router
requireLogin = true
requireApiKey = true
tunnelEnabled = false
tailscaleEnabled = false
tunnelDashboardAccess = false
```

- 9Router must bind to loopback only. Never expose the dashboard or gateway to the LAN or
  internet as part of this setup.
- Do not enable Cloudflare tunnel, Tailscale exposure, or remote dashboard access.

## First-run hardening

1. Start 9Router and poll `http://localhost:20128` until healthy.
2. Log in with the default/initial password (`123456`) to configure.
3. **No dashboard password rotation.** The user owns the 9Router dashboard password and
   manages it themselves; the setup never changes it. The default `123456` is used only
   for the authenticated login that drives configuration.
4. Create/reuse a local 9Router API key named `BlackCEO Claude Code`. Use it for
   `ANTHROPIC_AUTH_TOKEN` when Claude Code connects to the local router.
5. If an existing install already has a changed password and the default no longer works,
   stop with one precise instruction: the user must provide the current dashboard
   password (via `NINEROUTER_DASHBOARD_PW`) for the login to succeed. Do not reset it
   destructively.

## Secret handling

- Provider API keys (DeepSeek, Ollama, Agnes, and optionally OpenRouter) live inside
  9Router's protected provider storage after setup. They are **not** stored in the
  `claude-nine` launcher state or the macOS Keychain item used by the launcher.
- The **local 9Router API key** is the only router secret in launcher state:
  - Windows: DPAPI/current-user protection.
  - macOS: Keychain item (`service: BlackCEO-999`, `account: 9router-api-token`) via the
    `security` command; non-secret route state in a mode-600 file.
- Never print, log, or commit any key. Mask diagnostics to at most the first 3 and last 3
  characters.

## MacOS privacy (TCC)

- Respect macOS privacy controls. If Terminal/Claude Code cannot read Documents, stop with
  the precise grant instruction. Never bypass TCC.

## Node integrity

- On macOS, the official Node tarball must be verified against the official
  `SHASUMS256.txt` before extraction. Never execute or extract an unverified download.
  A checksum mismatch deletes the download and stops.

## Install strategy

- When an install is actually needed, install `9router@latest`, never an old pinned build; an existing working install is kept as-is (no forced upgrade).
- macOS: never `sudo npm install -g` as the default. Use a user-local npm prefix.
- Do not edit 9Router's persistence database directly; use the authenticated management API.
- Keep setup scripts inspectable plain text. Do not download and execute arbitrary
  third-party code beyond official vendor/package sources.

## Known upstream hazards (operator-box experience)

These are historical observations from operating 9Router 0.5.45 on the operator box. Verify
on the installed version before relying on them; they may change upstream.

- **The dashboard "Claude Code" integration rewrites the real `~/.claude/settings.json`**
  and has no `CLAUDE_CONFIG_DIR` support. This repository never clicks it and never uses
  `/api/cli-tools/claude-settings`. `claude-nine` owns the routed boundary.
- **Default CLI bind is `0.0.0.0`; default dashboard password is `123456`.** Both are
  hardened here.
- **`killAllAppProcesses` historically SIGKILLed every `next-server` on the machine**
  (unscoped clause). If the user runs other Next.js apps (e.g. a Command Center), inspect
  the installed `cli.js` and narrow the scope by process ancestry before relying on a
  supervised start. This repository's macOS launcher starts 9Router on demand rather than
  installing an autostart LaunchAgent, which limits the exposure.
- **An OPENAI→CLAUDE stream-translator tool-call duplication bug** was historically present
  (~50% of tool calls corrupted when a provider sent `finish_reason` twice). The fix was
  content-locating and silently reverted by updates. If tool-call errors appear after an
  update, re-check the installed build's translator. This repository does not ship a patch
  generator; it documents the symptom so a user can verify their own install.

## Routed-session isolation

The `claude-nine` launcher exports router variables only into the child process:

```text
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_DEFAULT_FABLE_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
CLAUDE_CODE_SUBAGENT_MODEL
CLAUDE_CODE_EFFORT_LEVEL
CLAUDE_CODE_MAX_OUTPUT_TOKENS
CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY
```

None of these are persisted to global Claude settings or shell startup files. The user must
be able to run `claude` and get ordinary Anthropic-direct behavior.
