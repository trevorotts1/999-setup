# Install-Node.ps1 - install/repair Node.js via WinGet only when below minimum.
# Idempotent. Refreshes the current process PATH after install.
#
# Contract: on success, writes the ABSOLUTE path to a proven-working node
# binary via Write-Output (the only Write-Output line in this script). All
# progress/log lines use Write-Host so they never land in a caller's
# captured return value.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [int]$MinNode = 20,
    [int]$MinNpm = 10
)

$ErrorActionPreference = 'Stop'

function Get-NodeOk {
    try {
        $nv = node --version 2>$null
        if (-not $nv) { return $false }
        $major = [int]($nv.TrimStart('v') -split '\.')[0]
        if ($major -lt $MinNode) { return $false }
        $npmv = npm --version 2>$null
        if (-not $npmv) { return $false }
        $nmajor = [int]($npmv -split '\.')[0]
        if ($nmajor -lt $MinNpm) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

try {
    if (Get-NodeOk) {
        Write-Host "Existing Node $(node --version) / npm $(npm --version) satisfies minimums; leaving it alone."
        Write-Output (Get-Command node).Source
        exit 0
    }

    Write-Host 'Node/npm below minimum or missing; installing latest LTS via WinGet...'
    # Real-execution check for the installer itself, not just Get-Command: a
    # bare `winget install ...` call when winget is genuinely absent (e.g.
    # Windows 10 without the App Installer) surfaces as a raw PowerShell
    # "term not recognized" exception instead of one clear named blocker
    # naming exactly what is missing and how to get it.
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Node.js 20+ is required but missing, and winget (Windows Package Manager) is not available to install it automatically. Install 'App Installer' from the Microsoft Store, or install Node.js 20+ manually from https://nodejs.org/, then re-run."
    }
    $wingetVer = & winget --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "winget is on PATH but does not execute (--version failed: $wingetVer). Repair winget (Microsoft Store > App Installer), or install Node.js 20+ manually from https://nodejs.org/, then re-run."
    }

    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "WinGet Node install failed (exit $LASTEXITCODE)."
    }
    Refresh-Path

    if (-not (Get-NodeOk)) {
        throw 'Node did not become available on PATH after install.'
    }
    Write-Host "Installed Node $(node --version) / npm $(npm --version)."
    Write-Output (Get-Command node).Source
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
