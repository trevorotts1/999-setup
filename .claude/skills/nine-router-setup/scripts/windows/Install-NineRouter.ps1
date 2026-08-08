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
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm not available; run Install-Node.ps1 first.'
    }
    node --version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'node is on PATH but does not execute (--version failed).' }

    # Prove npm can actually reach the registry before attempting the install
    # — a registry-unreachable failure buried inside `npm install -g` output
    # is a confusing way to learn there is no network.
    npm ping --registry https://registry.npmjs.org/ | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'npm cannot reach the npm registry (https://registry.npmjs.org/); check network connectivity, then re-run.'
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
    # Real-execution proof, never a file/PATH-resolution check alone: a
    # binary Get-Command can locate but that does not run is not "installed"
    # in any sense that matters downstream.
    $nineVer = & $bin.Source --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "9router resolved to $($bin.Source) but '--version' failed (exit $LASTEXITCODE): $nineVer"
    }
    Write-Host "9router: $($bin.Source) (version $nineVer)"
    Write-Output $bin.Source
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
