# Install-ClaudeNine.ps1 — install the claude-nine launcher on Windows PATH.
# Idempotent: never adds a duplicate PATH entry.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SourceDir = "$PSScriptRoot\..\..\..\launchers\windows"
)

$ErrorActionPreference = 'Stop'
$BinDir = "$env:LOCALAPPDATA\BlackCEO\999\bin"

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

try {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    $cmdSrc = Join-Path $SourceDir 'claude-nine.cmd'
    $ps1Src = Join-Path $SourceDir 'claude-nine.ps1'
    if (-not (Test-Path $cmdSrc) -or -not (Test-Path $ps1Src)) {
        # Fall back to the repo tree relative to this script.
        $SourceDir = Resolve-Path "$PSScriptRoot\..\..\..\launchers\windows"
        $cmdSrc = Join-Path $SourceDir 'claude-nine.cmd'
        $ps1Src = Join-Path $SourceDir 'claude-nine.ps1'
        if (-not (Test-Path $cmdSrc) -or -not (Test-Path $ps1Src)) {
            throw "Launcher files not found under $SourceDir"
        }
    }

    Copy-Item -Force $cmdSrc (Join-Path $BinDir 'claude-nine.cmd')
    Copy-Item -Force $ps1Src (Join-Path $BinDir 'claude-nine.ps1')
    Write-Host "Installed launcher to $BinDir"

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
