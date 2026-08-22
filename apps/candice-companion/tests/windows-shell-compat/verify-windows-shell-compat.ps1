# tests/windows-shell-compat/verify-windows-shell-compat.ps1 — WS-27 native
# Windows shell-compatibility matrix verifier (spec 0.3/17).
#
# For every required native shell channel this proves:
#   - command discovery (`Get-Command` in PowerShell, `where` in CMD)
#   - launcher resolution (`claude` and `claude-nine.cmd`)
#   - the Spec Protocol capacity tool runs NATIVELY (no Git Bash, no WSL) and
#     its card carries no sysctl/nproc/POSIX-only path
#   - Windows capacity probes use native APIs
#   - the parity golden guard passes in this checkout
#
# Windows-only by design (exit 2 elsewhere). Writes only its own fixture
# output. Safe to run repeatedly.
#Requires -Version 5.1
[CmdletBinding()]
param()

$failures = 0; $passes = 0
function Check([bool]$ok, [string]$name) {
    if ($ok) { $script:passes++; Write-Host "PASS  $name" }
    else { $script:failures++; Write-Host "FAIL  $name" }
}

Write-Host '=== verify-windows-shell-compat.ps1 (WS-27) ==='

# 1. Native Windows only — never infer the OS from the current shell.
if ($env:OS -ne 'Windows_NT') {
    Write-Host 'FAIL  native Windows required — this verifier is Windows-only'
    exit 2
}
Check $true 'native Windows detected (env:OS=Windows_NT)'

# 2. Live shell set: Windows PowerShell 5.1 (always), PS 7 where installed, CMD.
$hasPS7 = $false
if (Get-Command pwsh.exe -ErrorAction SilentlyContinue) { $hasPS7 = $true }
Check $true "Windows PowerShell present (this host: $($PSVersionTable.PSVersion.ToString()))"
if ($hasPS7) {
    $v7 = & pwsh.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>$null
    Check ($LASTEXITCODE -eq 0 -and $v7) "PowerShell 7 present ($v7)"
} else {
    Write-Host 'SKIP  PowerShell 7 (pwsh not installed — required only where installed)'
}

# 3. PATH from machine+user (native Windows resolution)
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

# 4. Command discovery per shell
Check ($null -ne (Get-Command claude -ErrorAction SilentlyContinue)) 'PS: Get-Command claude resolves'
Check ($null -ne (Get-Command claude-nine -ErrorAction SilentlyContinue)) 'PS: Get-Command claude-nine resolves'
$c1 = cmd /c "where claude" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($c1)) 'CMD: where claude resolves'
$c2 = cmd /c "where claude-nine" 2>$null
Check (-not [string]::IsNullOrWhiteSpace($c2)) 'CMD: where claude-nine resolves'
if ($hasPS7) {
    $v7c = & pwsh.exe -NoProfile -Command 'Get-Command claude-nine -ErrorAction SilentlyContinue' 2>$null
    Check ($LASTEXITCODE -eq 0 -and $null -ne $v7c) 'PS7: Get-Command claude-nine resolves'
}

# 5. Parity toolset runs natively from CMD without Git Bash/WSL.
$parityRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tools\windows-parity'
if (-not (Test-Path $parityRoot)) {
    $parityRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '..\..\..\tools\windows-parity'
}
if (Test-Path (Join-Path $parityRoot 'claude-nine-parity.cmd')) {
    $answers = Join-Path $PSScriptRoot 'fixtures\answers-capacity.txt'
    $card = cmd /c "`"$(Join-Path $parityRoot 'claude-nine-parity.cmd')`" capacity-resolver `"$answers`" 2>&1"
    $rc = $LASTEXITCODE
    Check ($rc -eq 0) "CMD: parity capacity-resolver runs natively (exit $rc)"
    $joined = ($card -join "`n")
    Check ($joined -match 'CAPACITY LEDGER') 'CMD: parity card produced'
    Check ($joined -notmatch 'sysctl|nproc|/tmp|Git Bash|WSL') 'CMD: card has no sysctl/nproc/POSIX-only path'
    $probe = Join-Path $parityRoot 'src\windows\probe-native.ps1'
    if (Test-Path $probe) {
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe 2>$null
        Check ($LASTEXITCODE -eq 0 -and ($out | Where-Object { $_ -match '^CORES=\d+$' })) 'Native probes: CORES=[Environment]::ProcessorCount'
        Check (($out -join "`n") -match '^RAM=\d+$') 'Native probes: RAM=Win32_ComputerSystem'
        Check (($out -join "`n") -match '^LOCALAPP=') 'Native probes: Known Folder LocalApplicationData'
    } else {
        Check $false 'probe-native.ps1 present'
    }
} else {
    Check $false 'parity .cmd shim present in this checkout'
}

# 6. Golden parity guard (bash-vs-node equivalence) — runs the node guard
#    which compares against the Bash reference where present.
$guard = Join-Path $parityRoot 'tests\parity-tests.mjs'
if (Test-Path $guard) {
    $g = & node $guard 2>&1
    Check ($LASTEXITCODE -eq 0 -and ($g -join "`n") -match 'PARITY GUARD: PASS') 'golden parity guard green'
} else {
    Check $false 'parity guard present'
}

# 7. Record the matrix result into the fixture output (this lane's own file).
$result = [ordered]@{
    host = $env:COMPUTERNAME
    stamp = (Get-Date).ToUniversalTime().ToString('o')
    powershell51 = $true
    powershell7 = $hasPS7
    cmd = $true
    launcher_claude = ($null -ne $c1)
    launcher_claude_nine = ($null -ne $c2)
    failures = $failures
    passes = $passes
}
$resultPath = Join-Path $PSScriptRoot 'fixtures\matrix-golden.json'
$result | ConvertTo-Json | Set-Content -Path $resultPath -Encoding UTF8

Write-Host ''
Write-Host "$passes passed, $failures failed"
exit $(if ($failures -eq 0) { 0 } else { 1 })
