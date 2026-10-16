@echo off
REM blackceo-council.cmd - thin CMD shim on PATH that invokes the off-PATH
REM blackceo-council.ps1 (installed to %LOCALAPPDATA%\BlackCEO\WiseElders\lib).
REM The .ps1 must NOT live on PATH: Windows PowerShell resolves a bare .ps1
REM ahead of the .cmd and then refuses it under the default execution policy.
REM Same pattern as the claude-nine launcher (CWE-040).
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%..\lib\blackceo-council.ps1"
if not exist "%PS1%" (
  echo blackceo-council: blackceo-council.ps1 not found next to this shim. 1>&2
  exit /b 4
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
