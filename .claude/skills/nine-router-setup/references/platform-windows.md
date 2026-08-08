# Windows platform reference

Target: native Windows 10/11. Windows PowerShell 5.1+ is the default runtime; PowerShell 7
(`pwsh`) is **not** a prerequisite.

## Key paths

| Item | Path |
|---|---|
| Personal skill | `%USERPROFILE%\.claude\skills\nine-router-setup\SKILL.md` (or under `$env:CLAUDE_CONFIG_DIR` if set) |
| Credential file | `<resolved Documents>\API docs.md` |
| Launcher bin dir | `%LOCALAPPDATA%\BlackCEO\999\bin` |
| Launcher shim | `%LOCALAPPDATA%\BlackCEO\999\bin\claude-nine.cmd` |
| Launcher script | `%LOCALAPPDATA%\BlackCEO\999\lib\claude-nine.ps1` (off PATH; the `.cmd` shim in `bin\` invokes it) |
| Protected session state | `%LOCALAPPDATA%\BlackCEO\999\router-session.json` (token DPAPI-encrypted) |
| Node.js | WinGet `OpenJS.NodeJS.LTS`, or a healthy existing Node 20+/npm 10+ |
| 9Router | npm global (`npm install -g 9router@latest`), binary found via `Get-Command 9router` |

## Documents resolution

Use the Windows API, never a hardcoded path:

```powershell
[Environment]::GetFolderPath('MyDocuments')
```

Documents may be redirected into OneDrive.

## Node.js

- If `node --version` ≥ 20 and `npm --version` ≥ 10, leave the user's environment alone.
- Otherwise install latest LTS via WinGet:
  ```powershell
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  ```
- Refresh the current process PATH after install (do not force a Claude Code restart):
  ```powershell
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  ```
- Never dismantle an existing nvm/fnm/volta/other managed Node environment that already
  satisfies the requirements.

## 9Router

```powershell
npm install -g 9router@latest
```

Refresh PATH after npm global install; resolve the executable with `Get-Command 9router`.
Start with `9router`.

## Git for Windows (repository acquisition)

If `git` is missing:

```powershell
winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements
```

Refresh PATH, then clone.

## Launcher

- `claude-nine.cmd` is a thin CMD shim that invokes `claude-nine.ps1` and forwards all
  arguments.
- The bin directory is added to the user PATH if not already present (idempotent).
- `claude-nine.ps1` uses PowerShell-native process launching; starts 9Router without an
  intrusive visible console window where practical.
- Protected state: DPAPI/current-user encryption for the local router token; non-secret
  route names may remain in the JSON state file.

## PATH refresh discipline

After WinGet or npm installs, refresh Machine + User PATH in the current process and retry
before concluding a tool is missing:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```

## Idempotency notes

- Rerunning repairs `claude-nine` without adding a duplicate PATH entry.
- Repairs DPAPI/user-state material in place.
- Reuses/updates existing providers, nodes, combos, and keys rather than duplicating them.
- Does not duplicate the user PATH entry for the `claude-nine` bin directory.
