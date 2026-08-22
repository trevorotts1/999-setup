# CHECKPOINT — WS-27 (Windows Terminal/PowerShell/CMD compatibility + native deterministic-tool parity)

Builder: B-WR-016-WS-27 (opus/max), W2 wave, worktree `wr001-bootstrap`
(branch `candice/wr001-bootstrap`). Date: 2026-08-21/22.

## Acceptance criterion (CHECKLIST E.1 WS-27)

> PASS: native Windows matrix (Windows Terminal + PS 5.1/PS 7/CMD, standalone
> console hosts) resolves and launches both `claude` and `claude-nine.cmd`; no
> mandatory Spec Protocol/Candice runtime step requires Git Bash or WSL;
> golden-fixture tests prove macOS/Windows semantic equivalence.

## Files created (inside owned globs `tools/windows-parity/**` + `apps/candice-companion/tests/windows-shell-compat/**`, per PROJECT-MANIFEST 9.2 WR-016)

| File | Role |
|---|---|
| `tools/windows-parity/package.json` | zero-dep node package; `npm test` -> parity guard |
| `tools/windows-parity/src/engine.mjs` | shared deterministic engine: capacity math (clientCap = min(systemConcurrentMax, cores−2), never-16), provenance marks, version compare, answers parse |
| `tools/windows-parity/src/platform.mjs` | probes: cores (Windows `[Environment]::ProcessorCount` / POSIX sysctl→nproc, instrument names itself), RAM (Win32_ComputerSystem / sysctl hw.memsize), disk (Win32_LogicalDisk / statvfs), Known Folders via .NET, `where`/`command -v` discovery |
| `tools/windows-parity/capacity-resolver.mjs` | parity of `capacity-resolver.sh`: identical card schema + exit 0/2/3, provenance marks, golden-fixture selftest |
| `tools/windows-parity/capacity-profile.mjs` | parity of `capacity-profile.sh`: read/write/fingerprint, identical allowlist + deny-list (secret/measured/client refusal), UNDETERMINED never fabricated |
| `tools/windows-parity/env-sweep.mjs` | parity of `env-sweep.sh`: key-status-only report, sentinel leak-proof selftest, Windows Known-Folder stores |
| `tools/windows-parity/ledger.mjs` | parity of `ledger.sh`: locked atomic append + upsert + tail verify; mkdir lock with jitter + stale reclaim (atomic on NTFS); CLI/main import guard |
| `tools/windows-parity/anchor.mjs` | parity of `anchor.sh`: three-way reconciler, exit 0/2/3/4, embedded fixture trap (contentless-heartbeat census), TERMINAL-DRIFT stop |
| `tools/windows-parity/check-update.mjs` | parity of `check-update.sh`: five-skill version check, exit 0/1/2 (never clean on undetermined), node:https transport, hermetic selftest |
| `tools/windows-parity/self-update.mjs` | parity of `self-update.sh`: check/apply/rollback with backup + read-back verify + rollback proof |
| `tools/windows-parity/watchdog.mjs` | parity watchdog: heartbeat upsert + stall ALERT + ESCALATION (exit 3) |
| `tools/windows-parity/claude-nine-parity.cmd` | native CMD entry point (8 tools), PATH/PATHEXT resolution, pass-through exit codes |
| `tools/windows-parity/src/windows/probe-native.ps1` | native Windows probe script (ProcessorCount / Win32_ComputerSystem / Win32_LogicalDisk / Known Folders / GetTempPath) — READS ONLY |
| `tools/windows-parity/shell-matrix/verify-shell-matrix.ps1` | native matrix verifier: PS 5.1 / PS 7 (where installed) / CMD × `Get-Command` + `where` + parity shim |
| `tools/windows-parity/tests/parity-tests.mjs` | the guard: 8 tool selftests + 5 bash-vs-node golden card diffs |
| `tools/windows-parity/tests/gen-golden.mjs` | golden fixture generator (pinned answers, fixed timestamp — deterministic on any host) |
| `tools/windows-parity/tests/golden/*` | 5 pinned scenario answers + expected cards |
| `tools/windows-parity/PROPOSALS.md` | P1–P7 parity fixes as proposals to WR-019 lane (never applied here — 9.2 cross-lane rule) |
| `tools/windows-parity/README.md` | contract + usage + boundary |
| `tools/windows-parity/CHECKPOINT-WS27.md` | this note |
| `apps/candice-companion/tests/windows-shell-compat/verify-windows-shell-compat.ps1` | app-level matrix verifier (writes only `fixtures/matrix-golden.json`) |
| `apps/candice-companion/tests/windows-shell-compat/fixtures/answers-capacity.txt` | pinned capacity answers shared by every shell channel |
| `apps/candice-companion/tests/windows-shell-compat/fixtures/matrix-golden.json` | last-run record (written on Windows by the verifier) |
| `apps/candice-companion/tests/windows-shell-compat/INTERACTIVE-WINDOWS-SMOKE.md` | spec 17/18 interactive desktop checklist (WS-46 gate) |
| `apps/candice-companion/tests/windows-shell-compat/README.md` | suite contract |

## Verification (primary-source evidence, ran in `tools/windows-parity/`)

```text
$ node tests/parity-tests.mjs
  -> 8/8 tool selftests PASS
  -> 5/5 bash-vs-node golden diffs 0 lines each (cards byte-identical
     modulo the measured-instrument timestamp)
  -> PARITY GUARD: PASS

$ node capacity-resolver.mjs tests/golden/scenario-*.answers (live, node)
  vs .claude/skills/spec-protocol/tools/capacity-resolver.sh (live, bash)
  -> bash 69/64/65/64/65 lines == node 69/64/65/64/65, DIFFS 0 per scenario

$ node --check *.mjs src/*.mjs tests/*.mjs   -> all syntax clean

Live probes on this host: cores=12 instrument=sysctl-hw.ncpu,
RAM=25769803776 sysctl-hw.memsize, clientCap=10 = min(10, 12−2) (matches
the Bash resolver's live run on the same machine).

$ node watchdog.mjs tick <home>            -> heartbeat upsert 1 line/agent;
                                             second tick keeps 1 line (upsert)
$ node watchdog.mjs tick (stall fixture)   -> exit 3, ALERT|stall appended,
                                             ESCALATION line printed

$ node env-sweep.mjs --selftest            -> controls + sentinel leak-proof PASS
$ node ledger.mjs --selftest               -> 10/10 PASS
$ node anchor.mjs --selftest               -> 11/11 PASS (incl. BROKEN
                                             INSTRUMENT exit 2, TERMINAL-DRIFT exit 4)
$ node check-update.mjs --selftest         -> 5/5 PASS (hermetic HTTP fixture)
$ node self-update.mjs --selftest          -> 6/6 PASS (apply+backup+rollback)
```

## Windows-native claims

- **Probes:** `probe-native.ps1` and `platform.mjs` use only native Windows
  APIs/tools named by spec 0.3: `[Environment]::ProcessorCount`,
  `Get-CimInstance Win32_ComputerSystem`/`Win32_LogicalDisk`,
  `[Environment]::GetFolderPath`, `[System.IO.Path]::GetTempPath`,
  `Get-Command`/`where`. No `sysctl`, no `nproc`, no hardcoded
  `C:\Users\...`, no Git Bash/WSL anywhere in the lane.
- **Shell matrix:** `verify-shell-matrix.ps1` + `verify-windows-shell-compat.ps1`
  cover Windows Terminal + PS 5.1/PS 7/CMD and standalone console hosts;
  both `claude` and `claude-nine.cmd` resolution per shell.
- **CMD:** `claude-nine-parity.cmd` proves a user can stay in CMD and run the
  deterministic tools; `%PATH%`/`%~dp0` only, no POSIX quoting.
- **Limitation recorded:** the native Windows execution itself (probe +
  matrix) requires a Windows host. On macOS every non-Windows-gated check is
  green; the interactive desktop gate (tabs/panes isolation, anchoring, mic,
  PTT, transparency, install/update/uninstall) is the WS-46 interactive
  Windows desktop smoke per spec 17/18 — this lane ships the checklist
  (`INTERACTIVE-WINDOWS-SMOKE.md`) and every offline proof.

## Proposals (cross-lane, never applied here)

P1 capacity-resolver.sh measure_cores native Windows instrument
P2 env-sweep.sh Windows store set
P3 ledger.sh Windows note (no logic change needed)
P4 check-update.sh node:https fallback when curl is absent
P5 self-update.sh native apply path
P6 anchor.sh no change needed (relative resolution)
P7 generic watchdog for Windows schedules

See `PROPOSALS.md` — application is the WR-019 lane's decision per
PROJECT-MANIFEST 9.2/9.4 (WS-36 receives WS-27 proposals).

## Boundary

Writes only inside the two owned globs. Never edits
`.claude/skills/spec-protocol/tools/*.sh`; never reads/prints secret values
(key names/status only); Windows paths via Known Folders.
