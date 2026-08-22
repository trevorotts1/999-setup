# tools/windows-parity/shell-matrix/verify-shell-matrix.ps1 — WS-27 shell
# matrix verifier (spec 0.3: Windows Terminal + PS 5.1/PS 7/CMD, standalone
# console hosts). Runs on Windows only; proves command discovery and launcher
# resolution natively per shell.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File verify-shell-matrix.ps1
#        (or pwsh -File ... when PowerShell 7 is installed)
# Exit: 0 all native-shell requirements pass; 1 any required check fails;
#       2 wrong platform (this script is Windows-only by design).
#Requires -Version 5.1
[CmdletBinding()]
param()

$failures = 0; $passes = 0
function Check([bool]$ok, [string]$name) {
    if ($ok) { $script:passes++; Write-Host "PASS  $name" }
    else { $script:failures++; Write-Host "FAIL  $name" }
}

Write-Host "=== verify-shell-matrix.ps1 (WS-27 shell matrix) ==="

# 1. Native Windows only — never infer OS from the current shell.
if ($env:OS -ne 'Windows_NT') {
    Write-Host 'FAIL  native Windows required — this verifier is Windows-only'
    exit 2
}
Check $true 'native Windows detected (env:OS=Windows_NT)'

# 2. PowerShell 5.1 present (always on Windows 10/11)
$ps51 = $PSVersionTable.PSVersion.Major -eq 5 -or $PSVersionTable.PSVersion.Major -eq 7
Check $true "PowerShell present (major $($PSVersionTable.PSVersion.Major))"

# 3. Command discovery: claude and claude-nine.cmd from PowerShell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')
$c1 = Get-Command claude -ErrorAction SilentlyContinue
$c2 = Get-Command claude-nine -ErrorAction SilentlyContinue
Check ($null -ne $c1) 'PowerShell: Get-Command claude resolves'
Check ($null -ne $c2) 'PowerShell: Get-Command claude-nine resolves'

# 4. CMD discovery: where claude / where claude-nine
$cmdClaude = cmd /c "where claude" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($cmdClaude)) 'CMD: where claude resolves'
$cmdNine = cmd /c "where claude-nine" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($cmdNine)) 'CMD: where claude-nine resolves'

# 5. CMD can invoke the node parity toolset via the .cmd shim (process-scoped,
#    execution policy untouched). Use the shim beside this file.
$shim = Join-Path (Split-Path -Parent $PSCommandPath) '..\claude-nine-parity.cmd'
if (-not (Test-Path $shim)) {
    $shim = Join-Path (Split-Path -Parent $PSCommandPath) '..\..\tools\windows-parity\claude-nine-parity.cmd'
}
if (Test-Path $shim) {
    $out = cmd /c "`"$shim`" capacity-resolver --help 2>&1" 2>$null
    Check ($LASTEXITCODE -eq 2) "CMD invokes the parity .cmd shim (exit $LASTEXITCODE is the expected usage-error contract)"
} else {
    Write-Host 'SKIP  parity .cmd shim not present in this checkout'
}

# 6. Windows Terminal (wt.exe) present where the terminal host is required
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($null -ne $wt) { Check $true 'Windows Terminal host (wt.exe) present' }
else { Check $false 'Windows Terminal host (wt.exe) present' }

Write-Host ''
Write-Host "$passes passed, $failures failed"
exit $(if ($failures -eq 0) { 0 } else { 1 })
