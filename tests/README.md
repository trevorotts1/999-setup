# Tests

The smoke-test suite is driven by the platform orchestrators and the shared helpers.
This directory holds platform-specific test scaffolding and mocks for development
verification (spec §29).

## Shared routing tests

`../.claude/skills/nine-router-setup/scripts/common/test-nine-router.mjs` runs the
provider/routing/thinking/vision/fusion/fallback checks through a live local 9Router.
It is invoked by both orchestrators during setup.

Usage:

```bash
NINEROUTER_BASE=http://127.0.0.1:20128 \
NINEROUTER_TOKEN=<local 9Router API key> \
OLLAMA_PLAN=pro \
node ../.claude/skills/nine-router-setup/scripts/common/test-nine-router.mjs
```

Optional skips: `SKIP_DEEPSEEK=1`, `SKIP_OLLAMA=1`, `SKIP_AGNES=1`, `SKIP_FUSION=1`.

## Live model resolution

`../.claude/skills/nine-router-setup/scripts/common/resolve-models.mjs` queries the live
provider catalogs:

```bash
DEEPSEEK_API_KEY=... node ../.claude/skills/nine-router-setup/scripts/common/resolve-models.mjs --deepseek
OLLAMA_API_KEY=...   node ../.claude/skills/nine-router-setup/scripts/common/resolve-models.mjs --ollama
AGNES_API_KEY=...    node ../.claude/skills/nine-router-setup/scripts/common/resolve-models.mjs --agnes
```

## Platform verification checklist

### Windows (`tests/windows/`)

- native Windows branch selected (OS = Windows_NT)
- resolved Documents path is valid (OneDrive-safe)
- Windows launcher files installed under `%LOCALAPPDATA%\BlackCEO\999\bin`
- `claude-nine` callable from CMD and PowerShell after PATH refresh
- protected local token can be decrypted by the current user (DPAPI)

### macOS (`tests/macos/`)

- `uname -s` = Darwin
- architecture is arm64
- resolved Documents path is valid
- repo-managed Node SHA256 was verified when installed
- 9Router user-local npm bin is executable
- `$HOME/.local/bin/claude-nine` exists and is executable
- a fresh login shell can resolve `claude-nine`
- route-state file permissions are 600
- the 9Router token can be retrieved from the expected Keychain item
- no router-specific `ANTHROPIC_*` variables were written to shell startup files

## Destructive / paid behavior

Use mocks/unit tests for destructive or paid API behavior. Live smoke tests must be tiny
(small `max_tokens`, minimal prompts).
