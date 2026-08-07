# Install-Node.ps1 — install/repair Node.js via WinGet only when below minimum.
# Idempotent. Refreshes the current process PATH after install.
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
        exit 0
    }

    Write-Host 'Node/npm below minimum or missing; installing latest LTS via WinGet...'
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "WinGet Node install failed (exit $LASTEXITCODE)."
    }
    Refresh-Path

    if (-not (Get-NodeOk)) {
        throw 'Node did not become available on PATH after install.'
    }
    Write-Host "Installed Node $(node --version) / npm $(npm --version)."
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
