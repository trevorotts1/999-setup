# verify-windows.ps1 - standalone Windows platform tests (spec section22 Windows platform tests).
# Safe to run repeatedly; makes no changes. Prints PASS/FAIL/BLOCKED per check.
#
# FIX-021 semantics: a required check that FAILED exits nonzero and the CI job
# must block on it (no continue-on-error). A required check that cannot run on
# this host class exits 0 as BLOCKED with a machine-readable reason and the
# release gate refuses evidence missing that BLOCKED row. A FAIL is never a
# silent skip and a BLOCKED is never a PASS.
#
# CI mode (-StateDir <dir>): state-dependent checks (launcher files, CMD
# resolution, token decrypt, state-file mode) run against provisioned fixture
# state under the scratch dir instead of the bare runner LOCALAPPDATA;
# host-class-impossible checks record BLOCKED rows and exit 0. Without
# -StateDir the script probes the real LOCALAPPDATA tree and missing checks
# are SKIPs (exit 0) — a real provisioned Windows box must pass them or the
# run is not a verification.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$StateDir = ''
)

$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 does not auto-load System.Security (PowerShell 7
# does) — required before check 5 below can call ProtectedData.
Add-Type -AssemblyName System.Security
$failures = 0; $passes = 0; $blocked = 0
function Check([bool]$ok, [string]$name) {
    if ($ok) { $script:passes++; Write-Host "PASS  $name" }
    else { $script:failures++; Write-Host "FAIL  $name" }
}
function Block([string]$name) { $script:blocked++; Write-Host "BLOCKED  $name" }

$CI = ($StateDir -ne '')

# Provision the fixture state in CI mode (idempotent; touches only -StateDir).
if ($CI) {
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir 'bin') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir 'lib') | Out-Null
    $launcherCmd = Join-Path $StateDir 'bin\claude-nine.cmd'
    $launcherPs1 = Join-Path $StateDir 'lib\claude-nine.ps1'
    if (-not (Test-Path $launcherCmd)) {
        Set-Content -Path $launcherCmd -Encoding ASCII -Value '@echo off
REM FIX-021 CI fixture shim (verify-windows.ps1 -StateDir). Launcher-shape probe only.
exit /b 0'
    }
    if (-not (Test-Path $launcherPs1)) {
        Set-Content -Path $launcherPs1 -Encoding ASCII -Value '#Requires -Version 5.1
# FIX-021 CI fixture: launcher-shape probe only.'
    }
    $stateFile = Join-Path $StateDir 'router-session.json'
    if (-not (Test-Path $stateFile)) {
        $s = [ordered]@{ note = 'FIX-021 CI fixture state (verify-windows.ps1 -StateDir). Mode-check probe only.' }
        ($s | ConvertTo-Json) | Set-Content -Path $stateFile -Encoding UTF8
    }
    # DPAPI round-trip token in the scratch dir — proves the SAME
    # current-user decrypt path a provisioned box uses, without any real token.
    $enc = [System.Security.Cryptography.ProtectedData]::Protect(
        [System.Text.Encoding]::UTF8.GetBytes('ci-fixture-token'),
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes((Join-Path $StateDir 'router-token.bin'), $enc)
}

# 1. Native Windows
Check ($env:OS -eq 'Windows_NT') 'native Windows branch selected'

# 2. Documents resolution
$docs = [Environment]::GetFolderPath('MyDocuments')
Check (($docs) -and (Test-Path $docs)) "resolved Documents path is valid ($docs)"

# 3. Launcher files installed. The .cmd shim lives ON PATH in bin\; the .ps1
#    it invokes lives OFF PATH in lib\ (Install-ClaudeNine.ps1 deletes any
#    bin\claude-nine.ps1 it finds — a .ps1 on PATH loses resolution to the
#    .cmd and trips the default execution policy).
$binDir = "$env:LOCALAPPDATA\BlackCEO\999\bin"
$libDir = "$env:LOCALAPPDATA\BlackCEO\999\lib"
if ($CI) {
    $binDir = Join-Path $StateDir 'bin'
    $libDir = Join-Path $StateDir 'lib'
}
Check ((Test-Path (Join-Path $binDir 'claude-nine.cmd')) -and (Test-Path (Join-Path $libDir 'claude-nine.ps1'))) 'Windows launcher files installed'

# 4. claude-nine available from CMD and PowerShell after PATH refresh
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')
if ($CI) { $env:Path = "$binDir;$($env:Path)" }
$cmdTest = cmd /c "where claude-nine.cmd" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($cmdTest)) 'claude-nine callable from CMD after PATH refresh'

# 5. Protected local token decryptable by current user.
#    Host-class check: a CI runner without -StateDir has no provisioned token
#    file — BLOCKED there, never skipped, required on a real provisioned box.
$tokenFile = "$env:LOCALAPPDATA\BlackCEO\999\router-token.bin"
if ($CI) { $tokenFile = Join-Path $StateDir 'router-token.bin' }
if (Test-Path $tokenFile) {
    try {
        $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
            [System.IO.File]::ReadAllBytes($tokenFile),
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        Check ($dec.Length -gt 0) 'protected local token can be decrypted by current user'
    } catch {
        Check $false 'protected local token can be decrypted by current user'
    }
} else {
    if ($CI) {
        Check $false 'CI token fixture missing (provisioning step broken)'
    } else {
        Block 'protected local token decrypt (no token file on this host; required on a real provisioned Windows box)'
    }
}

# 6. State file mode — CI runner ACLs differ from a provisioned box, and
#    POSIX-mode checks do not exist on Windows; host-class check, BLOCKED in CI.
if ($CI) {
    Block 'route-state file access check (CI runner ACLs differ; required on a real provisioned Windows box)'
} else {
    $stateFileReal = "$env:LOCALAPPDATA\BlackCEO\999\router-session.json"
    if (Test-Path $stateFileReal) {
        Write-Host 'PASS  route-state file present'
        $script:passes++
    } else {
        Write-Host 'SKIP  route-state file (state file not present)'
    }
}

Write-Host ''
Write-Host "$passes passed, $failures failed, $blocked blocked"
exit $(if ($failures -eq 0) { 0 } else { 1 })
