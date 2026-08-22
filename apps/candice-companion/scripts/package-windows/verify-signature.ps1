<#
.SYNOPSIS
  WS-29 native Windows Authenticode probe. Wraps Get-AuthenticodeSignature
  (PowerShell 5.1-compatible, no modules, no network) and pipes a deterministic
  JSON report to the cross-platform policy engine
  (scripts/package-windows/verify-signature.mjs).

.DESCRIPTION
  Native probe half of the WS-29 signature verification pipeline:
    Get-AuthenticodeSignature -> report.json -> verify-signature.mjs verdict

  - Requires PowerShell 5.1 or newer (no pwsh-only features).
  - Never modifies the artifact; never touches the certificate store.
  - Machine-readable JSON on stdout; diagnostics on stderr.
  - If Node.js is unavailable, prints an HONEST failure report: unsigned /
    unverifiable is never reported as trusted (Master Spec 23 honesty).

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-windows\verify-signature.ps1 -Path .\dist\Candice-Setup-x64.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [Parameter(Mandatory = $false)]
    [string]$NodeBinary = 'node',

    [Parameter(Mandatory = $false)]
    [string]$LimitationMarker = ''
)

$ErrorActionPreference = 'Stop'

function Get-CanonicalPath {
    param([string]$P)
    $resolved = (Resolve-Path -LiteralPath $P -ErrorAction Stop).Path
    return [System.IO.Path]::GetFullPath($resolved)
}

$target = Get-CanonicalPath -P $Path

if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    Write-Error "verify-signature.ps1: path is not a file: $target"
    exit 2
}

$sig = Get-AuthenticodeSignature -LiteralPath $target

$report = [ordered]@{
    file          = $target
    status        = $sig.Status.ToString()
    statusMessage = $sig.StatusMessage
    signer        = $null
}

if ($null -ne $sig.SignerCertificate) {
    $report.signer = $sig.SignerCertificate.Subject
}

$reportJson = $report | ConvertTo-Json -Compress

# Locate the policy engine relative to this script (works from CMD, PS, CI).
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = Join-Path $scriptDir 'verify-signature.mjs'

$markerArgs = @()
if ($LimitationMarker -ne '') {
    $canonicalMarker = Get-CanonicalPath -P $LimitationMarker
    $markerArgs = @('--limitation-marker', $canonicalMarker)
}

if (Get-Command $NodeBinary -ErrorAction SilentlyContinue) {
    & $NodeBinary $engine check --input-json $reportJson @markerArgs
    exit $LASTEXITCODE
}

# Node unavailable: fall back to a bare honesty report. Never claim trust.
$honest = [ordered]@{
    exitCode = 1
    pass = $false
    trusted = $false
    signed = ($report.status -eq 'Valid')
    limitationRecorded = $false
    reason = 'UNSIGNED_OR_UNVERIFIABLE_NO_ENGINE — Node.js unavailable to run the policy engine; artifact was NOT verified as trusted. Do not present it as signed.'
    file = $target
    signer = $report.signer
    statusMessage = $report.statusMessage
}
$honest | ConvertTo-Json
exit 1
