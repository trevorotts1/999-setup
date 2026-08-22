# tools/windows-parity — WS-27 native Windows parity toolset

Cross-platform Node implementations of the Spec Protocol deterministic tools
with **identical input/output schemas and exit-code semantics**, plus native
Windows probes and the CMD entry point. Zero dependencies; Node >= 18 (the 999
setup already installs/manages Node).

## Why this exists (spec 0.3 P0)

The Spec Protocol deterministic toolset is heavily Bash-based and the capacity
resolver's core probe uses `sysctl`/`nproc`. Windows support is NOT complete
merely because `claude-nine.cmd` launches. The mandatory runtime tools must
work without Git Bash or WSL, with native Windows probes, and golden fixtures
must prove macOS/Windows semantic equivalence. This lane ships that proof and
the native implementation; parity edits to the Bash originals are proposals to
the WR-019 lane (`PROPOSALS.md`) per the ownership map.

## Tools

| Tool | Parity of | Contract |
|---|---|---|
| `capacity-resolver.mjs` | `tools/capacity-resolver.sh` | answers file → Capacity Ledger card; exit 0/2/3; cores measured (`[Environment]::ProcessorCount` on Windows, sysctl/nproc on POSIX) |
| `capacity-profile.mjs` | `tools/capacity-profile.sh` | read/write/fingerprint; allowlist + deny-list (secrets/measured/client) enforced identically; UNDETERMINED never fabricated |
| `env-sweep.mjs` | `tools/env-sweep.sh` | key-status-only report (values never printed); Windows Known-Folder stores; sentinel leak-proof selftest |
| `ledger.mjs` | `tools/ledger.sh` | locked atomic append + upsert + tail verification; mkdir lock with jitter + stale reclaim (atomic on NTFS) |
| `anchor.mjs` | `tools/anchor.sh` | three-way reconciler + TERMINAL-DRIFT stop; exit 0/2/3/4; embedded fixture trap kept live |
| `check-update.mjs` | `tools/check-update.sh` | five-skill version check; exit 0/1/2, never a clean on undetermined; node:https transport |
| `self-update.mjs` | `tools/self-update.sh` | check/apply/rollback with backup + verify; rollback path proven |
| `watchdog.mjs` | watchdog/heartbeat enforcement | heartbeat upsert + stall ALERT + ESCALATION (exit 3) |

Supporting modules: `src/engine.mjs` (shared math/marks/versions),
`src/platform.mjs` (probes: cores/RAM/disk/known-folders/command discovery),
`src/windows/probe-native.ps1` (native Windows probe script — ProcessorCount /
Win32_ComputerSystem / Win32_LogicalDisk / Known Folders / GetTempPath).

`claude-nine-parity.cmd` is the native CMD entry point: `claude-nine-parity.cmd
<tool> <args…>` with pass-through exit codes — no Git Bash, no WSL, no POSIX
quoting.

## Tests

```
npm test    # node tests/parity-tests.mjs
```

The guard runs every tool's selftest, then the **cross-implementation golden
check**: each of the five pinned scenario answers runs through BOTH the Bash
reference and the node implementation, and the cards must be byte-identical
(modulo the measured-core timestamp). That is the "golden fixtures match macOS
semantics" proof — currently green 13/13 on macOS; the same guard runs on
Windows where the native probes take the PowerShell path.

## Shell matrix

`shell-matrix/verify-shell-matrix.ps1` proves the native matrix (PS 5.1,
PS 7 where installed, CMD; `Get-Command`/`where`; parity shim invocation).
The app-level suite `apps/candice-companion/tests/windows-shell-compat/` runs
the same matrix from the Candice test tree and records
`fixtures/matrix-golden.json`. The interactive desktop gate (tabs/panes
isolation, anchoring, mic, PTT, transparency, install/update/uninstall) is the
WS-46 gate — see `apps/candice-companion/tests/windows-shell-compat/INTERACTIVE-WINDOWS-SMOKE.md`.

## Boundary

- Writes only inside this directory.
- Never edits `.claude/skills/spec-protocol/tools/*.sh` — proposals only
  (`PROPOSALS.md`), per PROJECT-MANIFEST 9.2/9.4.
- Never reads or prints secret values (key names/status only).
- Windows-native paths via Known Folders; never hardcoded `C:\Users\*`.
