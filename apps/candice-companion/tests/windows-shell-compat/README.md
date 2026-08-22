# tests/windows-shell-compat — WS-27 Windows shell compatibility + parity suite

Owned by WR-016 WS-27 (PROJECT-MANIFEST 9.2). Companion of the native parity
toolset at `tools/windows-parity/`.

## What this suite proves

| Check | Evidence |
|---|---|
| Native Windows matrix resolves and launches both `claude` and `claude-nine.cmd` | `verify-windows-shell-compat.ps1` — PowerShell 5.1, PowerShell 7 (where installed), CMD; `Get-Command` + `where` |
| No mandatory Spec Protocol/Candice runtime step requires Git Bash or WSL | each shell runs the parity capacity tool natively and the card contains no `sysctl`/`nproc`/POSIX-only paths |
| Golden fixtures prove macOS/Windows semantic equivalence | `tools/windows-parity/tests/parity-tests.mjs` cross-runs the Bash reference and the node parity implementation on identical pinned answers and requires byte-identical cards (modulo measured-instrument timestamp) |
| Windows probes use native APIs | `probe-native.ps1` — `[Environment]::ProcessorCount`, `Get-CimInstance Win32_ComputerSystem`, `Win32_LogicalDisk`, .NET Known Folders, `[System.IO.Path]::GetTempPath()` |
| Interactive desktop gate | this suite proves everything provable offline; the interactive Windows 10/11 desktop smoke (tab/panes anchoring, mic, PTT, transparency, minimize/restore/monitor move, install/update/uninstall cleanup) is the WS-46 interactive gate, spec 18/27 |

## Layout

- `verify-windows-shell-compat.ps1` — Windows matrix verifier (PS 5.1 / PS 7 / CMD × `claude` / `claude-nine.cmd`; per-shell parity-tool run; runs the parity golden guard).
- `fixtures/answers-capacity.txt` — pinned capacity answers shared by every shell channel (deterministic card).
- `fixtures/matrix-golden.json` — record of the last native matrix run (per-shell results + native probes), written only on Windows by the verifier.
- `INTERACTIVE-WINDOWS-SMOKE.md` — the spec 17/18 interactive desktop checklist for the WS-46 gate.

## Running

On Windows (the only place the native matrix can run):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File verify-windows-shell-compat.ps1
```

PS 7 (when installed): `pwsh -NoProfile -File ...\verify-windows-shell-compat.ps1`

The verifier is safe to run repeatedly; it writes only its own fixtures output.
