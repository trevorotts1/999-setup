@echo off
REM claude-nine.cmd - thin CMD shim on PATH that invokes the off-PATH
REM claude-nine.ps1 (installed to %LOCALAPPDATA%\BlackCEO\999\lib\claude-nine.ps1).
REM
REM The .ps1 must NOT live on PATH: Windows PowerShell resolves a bare .ps1
REM ahead of the .cmd and then refuses it under the default execution policy.
REM
REM ENCODING: pure ASCII, no BOM, CRLF line endings. cmd.exe decodes a
REM batch file in the OEM code page and its label parser expects CRLF.
REM
REM The execution-policy bypass is scoped to THIS child process only; no
REM machine-wide or user-wide policy is changed. On failure the shim prints a
REM readable message and a non-zero exit code, and pauses only when it was
REM started by a double-click (opt out with BLACKCEO_LAUNCHER_NO_PAUSE=1).
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%..\lib\claude-nine.ps1"
if not exist "%PS1%" goto :missing_script

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto :failed
exit /b 0

:missing_script
echo claude-nine: claude-nine.ps1 not found at "%PS1%". 1>&2
set "RC=1"
goto :failed

:failed
echo claude-nine: launch failed with exit code %RC%. 1>&2
if defined BLACKCEO_LAUNCHER_NO_PAUSE exit /b %RC%
echo "%CMDCMDLINE%" | find /i "%~nx0" >nul
if errorlevel 1 exit /b %RC%
pause
exit /b %RC%
