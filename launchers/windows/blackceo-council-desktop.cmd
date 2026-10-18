@echo off
REM blackceo-council-desktop.cmd (WER-021 companion, 999 side): native
REM Windows shim for the standalone Council desktop launcher.
REM
REM It resolves Node.js with the native `where` search (which honours
REM PATHEXT, so a node.exe executable or a node.cmd/node.bat shim both
REM resolve) and then runs blackceo-council-desktop.mjs beside this file.
REM No POSIX shell, no Linux compatibility layer and no link/junction assumption.
REM Paths are quoted, so spaces and non-ASCII characters are preserved.
setlocal EnableExtensions

set "NODE_EXE="
if defined BLACKCEO_NODE_EXE set "NODE_EXE=%BLACKCEO_NODE_EXE%"
if not defined NODE_EXE for /f "usebackq delims=" %%I in (`where node.exe 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE for /f "usebackq delims=" %%I in (`where node 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"

if not defined NODE_EXE (
    echo blackceo-council-desktop: ERROR COUNCIL_NODE_MISSING: Node.js is not runnable; the council runtime cannot start. 1>&2
    exit /b 4
)

"%NODE_EXE%" "%~dp0blackceo-council-desktop.mjs" %*
exit /b %ERRORLEVEL%
