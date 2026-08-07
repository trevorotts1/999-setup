@echo off
REM claude-nine.cmd — thin CMD shim that invokes claude-nine.ps1 and forwards
REM all arguments. Installed to %LOCALAPPDATA%\BlackCEO\999\bin\claude-nine.cmd.
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%claude-nine.ps1"
if not exist "%PS1%" (
  echo claude-nine: claude-nine.ps1 not found next to this shim. 1>&2
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
