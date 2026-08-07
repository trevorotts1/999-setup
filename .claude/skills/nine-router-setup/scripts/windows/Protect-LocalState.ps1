# Protect-LocalState.ps1 — protect the local 9Router API token with DPAPI
# (current-user only) and write the route-state JSON. Idempotent.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Action = 'show',       # set-token | get-token | show | ensure
    [string]$Token = '',
    [string]$StateDir = "$env:LOCALAPPDATA\BlackCEO\999"
)

$ErrorActionPreference = 'Stop'
$StateFile = Join-Path $StateDir 'router-session.json'
$TokenFile = Join-Path $StateDir 'router-token.bin'

function Protect-Token([string]$value) {
    # DPAPI current-user encryption.
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    $enc = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [System.IO.File]::WriteAllBytes($TokenFile, $enc)
    [System.Security.Cryptography.ProtectedData]::ZeroMemory($enc, $bytes.Length)
    $value = $null
}

function Unprotect-Token {
    if (-not (Test-Path $TokenFile)) { return '' }
    $enc = [System.IO.File]::ReadAllBytes($TokenFile)
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [System.Text.Encoding]::UTF8.GetString($dec)
}

try {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

    switch ($Action) {
        'set-token' {
            if (-not $Token) { throw 'set-token requires -Token.' }
            Protect-Token $Token
            Write-Host "Token stored (DPAPI, current-user only): $TokenFile"
        }
        'get-token' {
            $t = Unprotect-Token
            if (-not $t) { throw 'No protected token found.' }
            Write-Output $t
        }
        'show' {
            Write-Host "State dir: $StateDir"
            Write-Host "Token file exists: $(Test-Path $TokenFile)"
            Write-Host "State file: $StateFile"
        }
        'ensure' {
            if (-not (Test-Path $TokenFile)) { throw 'No protected token present; run set-token first.' }
            Write-Host 'Protected state present.'
        }
        default { throw "Unknown action '$Action'." }
    }
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
