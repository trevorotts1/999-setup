# macOS platform reference

Target: current macOS on **Apple Silicon (`arm64`)** only. Legacy Mac architecture is not
supported. Toolchain: built-in POSIX tools (`zsh`/`bash`, `curl`, `tar`, `shasum`, `chmod`,
`nohup`, `security`). **Homebrew and Xcode Command Line Tools are not prerequisites.**

## Architecture gate

```bash
uname -m
```

Required: `arm64`. Anything else stops with one precise unsupported-Mac blocker before any
download or system change.

## Key paths

| Item | Path |
|---|---|
| Personal skill | `$HOME/.claude/skills/nine-router-setup/SKILL.md` (or under `$CLAUDE_CONFIG_DIR` if set) |
| Credential file | `<resolved Documents>/API docs.md` |
| Repo-managed Node runtime | `$HOME/.local/share/999/node/<VERSION>/`, `current` → VERSION |
| Repo-managed npm prefix | `$HOME/.local/share/999/npm` |
| 9Router binary | `$HOME/.local/share/999/npm/bin/9router` |
| Launcher | `$HOME/.local/bin/claude-nine` (mode 700) |
| Protected state dir | `$HOME/Library/Application Support/BlackCEO/999/` (state file mode 600) |
| Keychain item | service `BlackCEO-999`, account `9router-api-token` |
| Router log | `$HOME/Library/Logs/BlackCEO-999/9router.log` |

Paths may contain spaces (e.g. `~/Library/Application Support/BlackCEO/999`). Quote all
paths.

## Documents resolution

Preferred:

```bash
osascript -e 'POSIX path of (path to documents folder)'
```

Trim the trailing slash. Fallback: `$HOME/Documents`. If macOS privacy (TCC) blocks access,
stop with the precise grant instruction; never bypass privacy controls.

## Node.js

- If existing `node` ≥ 20 and `npm` ≥ 10, use it. Do not replace a healthy environment.
- Otherwise install a user-local latest-LTS Node from the official Node.js distribution:
  1. Determine the newest LTS dynamically from `https://nodejs.org/dist/index.tab` — the
     first release row whose `lts` column is not `-`.
  2. Artifact: `darwin-arm64` (from `uname -m` = `arm64`).
  3. Download the official tarball and matching `SHASUMS256.txt` from
     `https://nodejs.org/dist/<VERSION>/`.
  4. Verify with `shasum -a 256` before extraction. A mismatch deletes the download and
     stops — never extract an unverified download.
- Repo-managed location: `$HOME/.local/share/999/node/<VERSION>/`, symlink `current`.
- Prepend `$HOME/.local/share/999/node/current/bin` to the setup process PATH.
- Add only a small clearly marked, idempotent PATH block to the appropriate login profile
  (`~/.zprofile` for zsh, `~/.bash_profile` for bash) when a new terminal must discover
  repo-managed binaries. Never insert routing env vars into the profile.

## 9Router

User-local npm prefix (no sudo):

```bash
npm install -g --prefix "$HOME/.local/share/999/npm" 9router@latest
```

Expected executable: `$HOME/.local/share/999/npm/bin/9router`. The launcher resolves the
exact binary path rather than assuming shell PATH ordering.

Start 9Router non-interactively with stdout/stderr to the user-local log. `--host 127.0.0.1`
is mandatory: 9Router's default bind is `0.0.0.0`, which would expose the dashboard and the
`/v1` gateway (holding provider keys) to the LAN:

```bash
$HOME/.local/share/999/npm/bin/9router --no-browser --host 127.0.0.1 > "$HOME/Library/Logs/BlackCEO-999/9router.log" 2>&1 &
```

Do **not** install a permanent LaunchDaemon/LaunchAgent by default. `claude-nine` starts
9Router on demand when health is not already available.

## Repository acquisition

- If `xcode-select -p` succeeds and functional Git exists, clone.
- Otherwise download the public `main` tarball with `curl` + `tar`:
  ```bash
  curl -fsSL https://github.com/trevorotts1/999-setup/archive/refs/heads/main.tar.gz -o "$HOME/999-setup.tar.gz"
  tar -xzf "$HOME/999-setup.tar.gz" -C "<resolved Documents>"
  ```
  Never force Homebrew/Xcode merely for repository acquisition.

## Credential file protection

If the file is owned by the current user but group/other permissions are broader than
necessary, tighten to `chmod 600`. Respect TCC; ask the user to grant Documents access
rather than bypassing privacy controls.

## Launcher

`$HOME/.local/bin/claude-nine` (POSIX shell, mode 700):

1. Resolves the same installed `claude` binary used by plain `claude`.
2. Preserves the existing config root; never invents/overrides `CLAUDE_CONFIG_DIR`.
3. Checks 9Router health at `http://localhost:20128`; starts the exact installed binary with
   a bounded background launch (`nohup`) if not healthy, logging under
   `$HOME/Library/Logs/BlackCEO-999/`.
4. Never launches a second 9Router instance if port 20128 is already served by a healthy
   9Router.
5. Retrieves the local router token from Keychain (`security find-generic-password -s
   BlackCEO-999 -a 9router-api-token -w`), exports routing vars only into the child, and
   execs the same `claude` binary.

Provider API keys (DeepSeek/Ollama/Agnes/OpenRouter) are **not** stored in the launcher Keychain item —
they belong inside 9Router's provider storage.

## Idempotency notes

- Updates the Keychain item and the mode-600 state file in place without creating duplicate
  Keychain entries.
- Managed profile blocks are idempotent and preserve unrelated profile content
  byte-for-byte outside the managed block.
- Rerunning repairs rather than duplicates.
