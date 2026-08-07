# Install-ClaudeNine.ps1 - install the claude-nine launcher on Windows.
# Idempotent: never adds a duplicate PATH entry.
#
# Layout (the .ps1 lives OFF PATH so PowerShell never picks it over the .cmd -
# a .ps1 on PATH is refused by the execution policy on default Windows, and the
# .cmd shim already handles policy bypass correctly):
#   %LOCALAPPDATA%\BlackCEO\999\bin\claude-nine.cmd    (on PATH)
#   %LOCALAPPDATA%\BlackCEO\999\lib\claude-nine.ps1    (off PATH)
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SourceDir = ''
)

$ErrorActionPreference = 'Stop'
$BaseDir = "$env:LOCALAPPDATA\BlackCEO\999"
$BinDir = Join-Path $BaseDir 'bin'
$LibDir = Join-Path $BaseDir 'lib'

function Ensure-PathEntry([string]$dir) {
    $userPath = [System.Environment]::GetEnvironmentVariable('Path','User')
    if (-not $userPath) { $userPath = '' }
    $parts = $userPath -split ';' | Where-Object { $_ -ne '' }
    if ($parts -contains $dir) {
        return
    }
    $newPath = ($parts + $dir) -join ';'
    [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $newPath
    Write-Host "Added $dir to user PATH."
}

function Resolve-LauncherSource {
    # Candidate launcher locations, in order:
    #  1. explicit -SourceDir
    #  2. repo tree five levels above this script (windows -> scripts -> nine-router-setup -> skills -> .claude -> repo)
    #  3. cloned repo under the real (OneDrive-aware) Documents folder
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $candidates = @(
        $SourceDir,
        "$PSScriptRoot\..\..\..\..\..\launchers\windows",
        (Join-Path $docs 'REPO\launchers\windows'),
        (Join-Path $docs '999-setup\launchers\windows'),
        (Join-Path $docs '999-setup-main\launchers\windows')
    ) | Where-Object { $_ -ne '' }

    $searched = @()
    foreach ($c in $candidates) {
        $c = [System.IO.Path]::GetFullPath($c)
        $cmd = Join-Path $c 'claude-nine.cmd'
        $ps1 = Join-Path $c 'claude-nine.ps1'
        if ((Test-Path $cmd) -and (Test-Path $ps1)) {
            Write-Host "Launcher source: $c"
            return @{ Dir = $c; Cmd = $cmd; Ps1 = $ps1 }
        }
        $searched += $c
    }
    throw "Launcher files not found. Searched: $($searched -join '; ')"
}

try {
    New-Item -ItemType Directory -Force -Path $BinDir, $LibDir | Out-Null

    $src = Resolve-LauncherSource

    # .cmd on PATH; .ps1 off PATH in lib.
    Copy-Item -Force $src.Cmd (Join-Path $BinDir 'claude-nine.cmd')
    Copy-Item -Force $src.Ps1 (Join-Path $LibDir 'claude-nine.ps1')

    # Delete a stale bin\claude-nine.ps1 from older installs - it must never sit
    # on PATH where it wins resolution over the .cmd and trips the execution policy.
    $staleBinPs1 = Join-Path $BinDir 'claude-nine.ps1'
    if (Test-Path $staleBinPs1) {
        Remove-Item -Force $staleBinPs1
        Write-Host "Removed stale $staleBinPs1 (must live off PATH)."
    }

    # Make the .cmd shim point at the lib copy. The shipped shim already resolves
    # %~dp0..\lib\claude-nine.ps1; verify it matches.
    $shim = Get-Content (Join-Path $BinDir 'claude-nine.cmd') -Raw
    if ($shim -notmatch '\.\.\\lib\\claude-nine\.ps1') {
        # Rewrite the shim to point at the sibling lib dir.
        $shimBody = @"
@echo off
REM claude-nine.cmd - thin CMD shim. Invokes the off-PATH claude-nine.ps1.
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%..\lib\claude-nine.ps1"
if not exist "%PS1%" (
  echo claude-nine: claude-nine.ps1 not found next to this shim. 1>&2
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
"@
        Set-Content -Path (Join-Path $BinDir 'claude-nine.cmd') -Value $shimBody -Encoding Ascii
        Write-Host 'Rewrote claude-nine.cmd to point at ..\lib\claude-nine.ps1.'
    }

    Ensure-PathEntry $BinDir

    # Verify resolvable from both CMD and PowerShell.
    $cmdPath = Join-Path $BinDir 'claude-nine.cmd'
    if (-not (Test-Path $cmdPath)) { throw 'claude-nine.cmd missing after install.' }
    Write-Host 'claude-nine installed.'
    Write-Output $cmdPath
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
