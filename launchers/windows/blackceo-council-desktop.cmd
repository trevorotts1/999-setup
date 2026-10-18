@echo off
REM blackceo-council-desktop.cmd (WER-021 companion, 999 side): native
REM Windows shim for the standalone Council desktop launcher.
REM
REM It resolves Node.js with a fixed native search order: this shim's own
REM directory, then the PATH entries (through `where`, which honours
REM PATHEXT so node.exe or a node.cmd/node.bat shim both resolve), then the
REM well-known per-machine and per-user Node install roots. No POSIX shell,
REM no Linux compatibility layer and no link or junction assumption. Paths
REM are quoted, so spaces and non-ASCII characters are preserved.
REM
REM ENCODING: pure ASCII, no BOM, CRLF line endings. cmd.exe decodes a batch
REM file in the OEM code page and its label parser expects CRLF.
setlocal EnableExtensions

set "NODE_EXE="
if defined BLACKCEO_NODE_EXE set "NODE_EXE=%BLACKCEO_NODE_EXE%"
if not defined NODE_EXE if exist "%~dp0node.exe" set "NODE_EXE=%~dp0node.exe"
if not defined NODE_EXE for /f "usebackq delims=" %%I in (`where node.exe 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE for /f "usebackq delims=" %%I in (`where node 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramW6432%\nodejs\node.exe" set "NODE_EXE=%ProgramW6432%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Volta\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Volta\bin\node.exe"
if not defined NODE_EXE if exist "%NVM_SYMLINK%\node.exe" set "NODE_EXE=%NVM_SYMLINK%\node.exe"

if not defined NODE_EXE (
    echo blackceo-council-desktop: ERROR COUNCIL_NODE_MISSING: Node.js is not runnable; the council runtime cannot start. 1>&2
    exit /b 4
)

"%NODE_EXE%" "%~dp0blackceo-council-desktop.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo blackceo-council-desktop: launch failed with exit code %RC%. 1>&2
exit /b %RC%
