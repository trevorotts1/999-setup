# verify-windows.ps1 — standalone Windows platform tests (spec §22 Windows platform tests).
# Safe to run repeatedly; makes no changes. Prints PASS/FAIL per check.
#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$failures = 0; $passes = 0
function Check([bool]$ok, [string]$name) {
    if ($ok) { $script:passes++; Write-Host "PASS  $name" }
    else { $script:failures++; Write-Host "FAIL  $name" }
}

# 1. Native Windows
Check ($env:OS -eq 'Windows_NT') 'native Windows branch selected'

# 2. Documents resolution
$docs = [Environment]::GetFolderPath('MyDocuments')
Check (($docs) -and (Test-Path $docs)) "resolved Documents path is valid ($docs)"

# 3. Launcher files installed
$binDir = "$env:LOCALAPPDATA\BlackCEO\999\bin"
Check ((Test-Path (Join-Path $binDir 'claude-nine.cmd')) -and (Test-Path (Join-Path $binDir 'claude-nine.ps1'))) 'Windows launcher files installed'

# 4. claude-nine available from CMD and PowerShell after PATH refresh
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')
$cmdTest = cmd /c "where claude-nine.cmd" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($cmdTest)) 'claude-nine callable from CMD after PATH refresh'

# 5. Protected local token decryptable by current user
$tokenFile = "$env:LOCALAPPDATA\BlackCEO\999\router-token.bin"
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
    Write-Host 'SKIP  protected local token decrypt (token file not present)'
}

Write-Host ''
Write-Host "$passes passed, $failures failed"
exit $(if ($failures -eq 0) { 0 } else { 1 })
