@echo off
REM claude-nine.cmd - thin CMD shim on PATH that invokes the off-PATH
REM claude-nine.ps1 (installed to %LOCALAPPDATA%\BlackCEO\999\lib\claude-nine.ps1).
REM The .ps1 must NOT live on PATH: Windows PowerShell resolves a bare .ps1
REM ahead of the .cmd and then refuses it under the default execution policy.
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%..\lib\claude-nine.ps1"
if not exist "%PS1%" (
  echo claude-nine: claude-nine.ps1 not found next to this shim. 1>&2
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
