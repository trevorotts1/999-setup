# Interactive Windows desktop smoke — WS-27/WS-46 gate (spec 17/18/27)

This checklist is the **interactive Windows 10/11 desktop validation** that CI
cannot perform. WS-27 proves everything offline (shell matrix, launcher
resolution, native probes, golden parity). Windows is not labeled
production-ready until at least one interactive desktop run completes this
list on a physical PC or interactive VM representative of the x64 target.

Run in order, on the same machine, under a real desktop session:

## 1. Windows Terminal + Windows PowerShell 5.1
- [ ] `claude` launches; a supported skill (`/spec-protocol`) starts.
- [ ] `claude-nine.cmd` launches routed; same skill works.
- [ ] `capacity-resolver` runs natively (no Git Bash/WSL) and prints a card.

## 2. Windows Terminal + PowerShell 7 (where installed)
- [ ] `pwsh` — `claude` and `claude-nine.cmd` both launch.
- [ ] parity tools run from `pwsh`.

## 3. Windows Terminal + CMD
- [ ] `where claude` / `where claude-nine` resolve.
- [ ] `claude` and `claude-nine.cmd` launch from CMD.
- [ ] installer automation path: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-windows.ps1` invoked from CMD works without leaving CMD.

## 4. Standalone console hosts
- [ ] classic PowerShell console: `claude` + `claude-nine.cmd` launch.
- [ ] classic Command Prompt console: `claude` + `claude-nine.cmd` launch.

## 5. Multi-session isolation (spec 17 — the hard rule)
- [ ] Two Windows Terminal tabs each run a DIFFERENT Claude session.
- [ ] Two panes (where available) run different sessions.
- [ ] Candice anchors to the top-level host window visually, but answers land
      only in the owning session — switching tabs/panes NEVER cross-routes.
- [ ] Terminal text injection is disabled when the exact active
      tab/pane/session target cannot be proven (falls back to the same-session
      MCP/bridge path or Answer in Claude instead).

## 6. Desktop behavior
- [ ] Transparent always-on-top window renders (alpha preserved).
- [ ] Minimize/restore and monitor movement re-anchor Candice.
- [ ] Microphone permission prompt + deny path falls back to typing.
- [ ] Push-to-talk works; listening state unmistakable.
- [ ] Install / update / uninstall cleanup passes (no stale components).

## Result record

Append the result to `fixtures/matrix-golden.json` (per-host record) or the
lane's CHECKPOINT, naming the machine/VM, Windows build, PowerShell versions,
and which checklist rows passed. CI alone never substitutes for this gate
(spec 18).
