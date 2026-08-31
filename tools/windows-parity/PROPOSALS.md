# PROPOSALS.md — deterministic-tool parity fixes

`tools/windows-parity/**` and its tests (`tools/windows-parity/tests/`,
run via `tests/windows/`) are owned by this toolset. The Bash originals under
`.claude/skills/spec-protocol/tools/*.sh` belong to the spec-protocol skill,
so parity fixes for them are staged here as **proposals**: exact, staged,
schema-preserving — never applied by this toolset.

All proposals preserve the identical input/output schemas and exit-code
semantics proven by `tests/parity-tests.mjs` (byte-identical cards vs the Bash
reference on pinned answers).

## P1 — `capacity-resolver.sh` `measure_cores()`: native Windows instrument

- **File:** `.claude/skills/spec-protocol/tools/capacity-resolver.sh`
- **Now:** `sysctl -n hw.ncpu`, else `nproc`, else UNDETERMINED — no Windows-native
  instrument, so Windows hosts cannot produce a measured-core ledger card.
- **Proposal:** before the sysctl branch, when the host is Windows-native
  (`uname -s` is `MINGW*`/`MSYS*`/`CYGWIN*`, or `$OS == 'Windows_NT'`), run:

  ```sh
  if command -v powershell.exe >/dev/null 2>&1; then
    n="$(powershell.exe -NoProfile -NonInteractive -Command '[Environment]::ProcessorCount' 2>/dev/null | tr -d '\r' || true)"
    [[ -n "${n}" ]] && instrument="powershell-Environment.ProcessorCount"
  fi
  ```

- **Schema:** unchanged — prints `<n> <instrument>`; the ledger's
  `[MEASURED powershell-Environment.ProcessorCount …]` mark keeps its meaning.
- **Proof:** `tools/windows-parity/src/platform.mjs` `probeCores()` implements the
  same call and returns the identical shape; card diff vs Bash reference is
  byte-identical (guard PASS, 5/5 scenarios).

## P2. `env-sweep.sh` — Windows store set

- **File:** `.claude/skills/spec-protocol/tools/env-sweep.sh`
- **Body:** store list is `$HOME`-based POSIX paths; on Windows,
  `$HOME` is unset in CMD and misleading in PowerShell.
- **Proposal:** when `$OS == 'Windows_NT'`, use
  `LOCALAPPDATA`/`USERPROFILE`-derived stores:
  `%LOCALAPPDATA%\BlackCEO\999\.env`, `%LOCALAPPDATA%\BlackCEO\spec-protocol\.env`,
  `%USERPROFILE%\.openclaw\…` equivalents — same KEY-status-only output.
- **Proof:** `tools/windows-parity/env-sweep.mjs` `envStores()` lists these
  Windows stores; selftest leak-proof (sentinel appears zero times) PASS.

## P3. `ledger.sh` — mkdir-lock portability is already POSIX; add Windows note

- **File:** `.claude/skills/spec-protocol/tools/ledger.sh`
- **Proposal:** no logic change required (mkdir lock is atomic on NTFS; the
  flock branch never engages on Windows since flock(1) is absent). Add a
  header note that Windows writers must use the parity implementation or a
  native lock of identical semantics.
- **Proof:** `tools/windows-parity/ledger.mjs` mirrors the mkdir lock with
  jitter + stale-reclaim; selftest 10/10 PASS.

## P4. `check-update.sh` — HTTP transport when curl is absent

- **File:** `.claude/skills/spec-protocol/tools/check-update.sh`
- **Body:** requires `curl`; on Windows 10/11 curl.exe ships with the OS, but
  the script's `command -v curl` + POSIX `$HOME` assumptions are the drift
  risk.
- **Proposal:** when `command -v curl` fails, delegate to
  `tools/windows-parity/check-update.mjs check` (node:https) — identical exit
  aggregate (0/1/2, never a clean on undetermined).
- **Proof:** node selftest covers current/stale/undetermined/exit semantics.

## P5. `self-update.sh` — native apply path

- **File:** `.claude/skills/spec-protocol/tools/self-update.sh`
- **Proposal:** Windows: `self-update.mjs apply <repo> <dir>` (backup aside →
  fetch → verify read-back → rollback path). Identical `check|apply|rollback`
  contracts; selftest PASS (check/apply/verify/backup/rollback 6/6).

## P6. `anchor.sh` — Windows paths

- **File:** `.claude/skills/spec-protocol/tools/anchor.sh`
- **Proposal:** all `<project-home>` resolution already relative; the parity
  `anchor.mjs` needs no changes — keep the script as-is and, on Windows, call
  the node implementation.

## P7. watchdog/heartbeat

- **File:** `tools/anti-stall-watchdog.sh` (fork-specific). This toolset
  provides the generic `watchdog.mjs tick` with heartbeat upsert
  + stall ALERT + ESCALATION (exit 3) for Windows schedules. Not a
  `.claude/skills` edit; noted here for the fan-in integration owner.

## Acceptance note (native launch parity)

Every item above keeps the release gate: **no mandatory Spec Protocol
runtime path depends exclusively on Bash** once the .sh delegation edits are
applied. The parity toolset ships and proves equivalences now; the .sh
delegation edits remain staged as proposals in this file.
