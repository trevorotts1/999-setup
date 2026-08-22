@echo off
REM tools/windows-parity/claude-nine-parity.cmd — WS-27 native CMD entry point
REM
REM Spec 0.3: CMD users must be able to run the deterministic Spec Protocol
REM tools without leaving CMD and without Git Bash/WSL. This shim invokes the
REM node parity toolset via Windows' PATH/PATHEXT resolution and %~dp0 — no
REM POSIX quoting, no $HOME, no chmod, no symlinks.
REM
REM Usage:  claude-nine-parity.cmd <tool> <args...>
REM   tool = capacity-resolver|capacity-profile|env-sweep|ledger|anchor|
REM          watchdog|check-update|self-update
REM Exit code passes through from the node tool (0/1/2/3/4 contract preserved).
setlocal

set "TOOL=%~1"
if "%TOOL%"=="" (
  echo usage: claude-nine-parity.cmd ^<tool^> [args...] 1>&2
  exit /b 2
)

REM Locate node via PATH resolution (native Windows command discovery).
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: node not found on PATH — 999 setup installs node before these tools run. 1>&2
  exit /b 2
)

REM The tool name maps 1:1 to a file beside this shim. Enumerate the known
REM tools explicitly so an unknown name fails loudly instead of invoking
REM anything arbitrary.
set "tool_file="
if /i "%TOOL%"=="capacity-resolver" set "tool_file=%~dp0capacity-resolver.mjs"
if /i "%TOOL%"=="capacity-profile"   set "tool_file=%~dp0capacity-profile.mjs"
if /i "%TOOL%"=="env-sweep"          set "tool_file=%~dp0env-sweep.mjs"
if /i "%TOOL%"=="ledger"             set "tool_file=%~dp0ledger.mjs"
if /i "%TOOL%"=="anchor-check"       set "tool_file=%~dp0anchor.mjs"
if /i "%TOOL%"=="watchdog"           set "tool_file=%~dp0watchdog.mjs"
if /i "%TOOL%"=="check-update"       set "tool_file=%~dp0check-update.mjs"
if /i "%TOOL%"=="self-update"        set "tool_file=%~dp0self-update.mjs"
if "%tool_file%"=="" (
  echo ERROR: unknown tool '%TOOL%' — expected one of: capacity-resolver capacity-profile env-sweep ledger anchor-check watchdog check-update self-update 1>&2
  exit /b 2
)

node "%tool_file%" %*
exit /b %ERRORLEVEL%
