# Install-NineRouter.ps1 - install/update 9Router globally on Windows via npm.
# Idempotent. Resolves and outputs the actual executable path.
#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'node not available; run Install-Node.ps1 first.'
    }

    Write-Host 'Installing 9router@latest (npm global)...'
    # Out-Host keeps npm's stdout off the pipeline so only the binary path is
    # returned to the caller (a String[], not an array of npm log lines).
    npm install -g 9router@latest | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "npm install 9router failed (exit $LASTEXITCODE)."
    }
    Refresh-Path

    $bin = Get-Command 9router -ErrorAction SilentlyContinue
    if (-not $bin) {
        throw '9router executable not found on PATH after install.'
    }
    Write-Host "9router: $($bin.Source)"
    Write-Output $bin.Source
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
