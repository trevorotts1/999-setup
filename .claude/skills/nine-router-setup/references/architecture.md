# Architecture

## End state

```text
Claude Code
    |
    v
9Router on localhost:20128
    |
    +--> DeepSeek Direct
    |
    +--> Ollama Cloud
    |
    +--> Agnes AI
```

- **`claude`** = normal Claude Code, Anthropic-direct, untouched by this repository.
- **`claude-nine`** = the same Claude Code installation, launched with 9Router routing
  exported into the child process only.

## Components

| Component | Role | Platform location |
|---|---|---|
| `claude` | Normal Claude Code CLI | Installed by the user via the official installer |
| `9router` | Local gateway / model router | npm global (Windows) or user-local npm prefix (macOS); listens on `http://localhost:20128` |
| `claude-nine` | Launcher that starts 9Router and launches Claude Code through it | `%LOCALAPPDATA%\BlackCEO\999\bin\claude-nine.cmd` (+`.ps1`) on Windows; `$HOME/.local/bin/claude-nine` on macOS |
| Provider credentials | DeepSeek, Ollama Cloud, Agnes keys | Read once from `<Documents>/API docs.md`, loaded into 9Router's protected provider storage |
| Routed-session state | Local router API key + resolved route names | Windows: DPAPI-protected state under `%LOCALAPPDATA%\BlackCEO\999\`; macOS: Keychain item (`service: BlackCEO-999`, `account: 9router-api-token`) + mode-600 state file |
| Personal skill | `nine-router-setup` | `<Claude config root>/skills/nine-router-setup/` (shared by `claude` and `claude-nine`) |

## Session-scoped routing

9Router routing must be **session-scoped** to `claude-nine`. The launcher exports these
variables only into the child Claude Code process:

```text
ANTHROPIC_BASE_URL=http://localhost:20128/v1
ANTHROPIC_AUTH_TOKEN=<local 9Router API key>
ANTHROPIC_DEFAULT_FABLE_MODEL=<DeepSeek Direct Flash Max route>
ANTHROPIC_DEFAULT_OPUS_MODEL=<DeepSeek Direct V4 Pro Max route>
ANTHROPIC_DEFAULT_SONNET_MODEL=<Ollama GLM 5.2 Max route>
ANTHROPIC_DEFAULT_HAIKU_MODEL=<Ollama Kimi K2.6 route>
CLAUDE_CODE_SUBAGENT_MODEL=<DeepSeek Direct Flash route>
CLAUDE_CODE_EFFORT_LEVEL=max
CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000
CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=<free=1 | pro=2 | max=8>
```

None of these are persisted to global Claude settings or shell startup files. Plain
`claude` therefore stays Anthropic-direct.

## Data flow during setup

1. **OS detection** picks exactly one orchestrator (`setup-windows.ps1` / `setup-macos.sh`).
2. **Documents resolution** locates `API docs.md`.
3. **Node check** — repair only when below Node 20+ / npm 10+.
4. **9Router install** → first-run security (loopback bind, dashboard login, API key).
   No dashboard password rotation — the user owns the dashboard password.
5. **Provider import** — keys into 9Router provider storage; never printed.
6. **Live model resolution** — provider catalogs are queried; exact IDs used.
7. **Combos** — fallback + fusion via the management API.
8. **Capacity auto-switch** — vision only (verified).
9. **Launcher install** + protected session state.
10. **Smoke tests** — platform + shared routing tests must pass.

## Repository layout

```text
README.md                         user + Claude Code entry point
AGENT_INSTALL.md                  Claude Code bootstrap procedure
CLAUDE.md                         repository rules for agents
templates/API docs.md             placeholder credential template
launchers/windows/                claude-nine.cmd + claude-nine.ps1
launchers/macos/claude-nine       POSIX shell launcher
.claude/skills/nine-router-setup/
  SKILL.md                        the personal skill
  references/                     this documentation set
  scripts/setup-windows.ps1       Windows orchestrator
  scripts/setup-macos.sh          macOS orchestrator
  scripts/windows/                Windows-specific helpers
  scripts/macos/                  macOS-specific helpers
  scripts/common/                 shared Node.js management-API helpers
tests/                            smoke-test scaffolding per platform
```

## Why not a separate config root?

The reference design on the operator box used a separate `~/.claude-nine` config root. This
repository deliberately does **not**: the requirement is that the exact same personal skills
are visible from both `claude` and `claude-nine`. Using the user's existing Claude config
root once, and routing only via the `claude-nine` child-process environment, satisfies that
with no duplicate skill library and no second profile.
