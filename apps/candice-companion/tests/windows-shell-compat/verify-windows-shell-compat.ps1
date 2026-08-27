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
#
# FIX-021 semantics: a required check that FAILED exits nonzero and the CI
# job blocks on it (no continue-on-error). A required check that cannot run
# on this host class exits 0 as BLOCKED with a machine-readable reason; the
# release gate refuses evidence missing that BLOCKED row.
#
# CI mode (-StateDir <dir>): launcher discovery checks run against
# provisioned fixture shims under the scratch dir (a bare runner has no
# launchers on PATH); `claude` binary discovery and PS 7 presence are
# host-class checks and record BLOCKED rows. Without -StateDir, missing
# launchers are SKIPs (exit 0) — a real provisioned Windows box must pass
# them or the run is not a verification.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$StateDir = ''
)

$failures = 0; $passes = 0; $blocked = 0
function Check([bool]$ok, [string]$name) {
    if ($ok) { $script:passes++; Write-Host "PASS  $name" }
    else { $script:failures++; Write-Host "FAIL  $name" }
}
function Block([string]$name) { $script:blocked++; Write-Host "BLOCKED  $name" }

$CI = ($StateDir -ne '')

# Provision fixture launcher shims in CI mode (touches only -StateDir).
if ($CI) {
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir 'bin') | Out-Null
    $shimCmd = Join-Path $StateDir 'bin\claude-nine.cmd'
    if (-not (Test-Path $shimCmd)) {
        Set-Content -Path $shimCmd -Encoding ASCII -Value '@echo off
REM FIX-021 CI fixture shim (verify-windows-shell-compat.ps1 -StateDir). Discovery probe only.
exit /b 0'
    }
    $shimPs1 = Join-Path $StateDir 'bin\claude-nine.ps1'
    if (-not (Test-Path $shimPs1)) {
        Set-Content -Path $shimPs1 -Encoding ASCII -Value '#Requires -Version 5.1
# FIX-021 CI fixture: discovery probe only.'
    }
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
} elseif ($CI) {
    Block 'PowerShell 7 (not installed on this CI host; required only where installed)'
} else {
    Write-Host 'SKIP  PowerShell 7 (pwsh not installed — required only where installed)'
}

# 3. PATH from machine+user (native Windows resolution)
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')
if ($CI) { $env:Path = "$(Join-Path $StateDir 'bin');$($env:Path)" }

# 4. Command discovery per shell.
#    claude (the real Claude Code binary) is a host-class check on a bare
#    runner: BLOCKED in CI, required on a provisioned box.
if ($CI) {
    Block 'PS: Get-Command claude resolves (real claude binary not installed on CI; required on a provisioned box)'
    Block 'CMD: where claude resolves (real claude binary not installed on CI; required on a provisioned box)'
} else {
    Check ($null -ne (Get-Command claude -ErrorAction SilentlyContinue)) 'PS: Get-Command claude resolves'
    $c1 = cmd /c "where claude" 2>$null
    Check (-not [string]::IsNullOrWhiteSpace($c1)) 'CMD: where claude resolves'
}
Check ($null -ne (Get-Command claude-nine -ErrorAction SilentlyContinue)) 'PS: Get-Command claude-nine resolves'
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
        # These two joined the probe's lines and then anchored with ^...$.
        # PowerShell's -match is .NET regex WITHOUT RegexOptions.Multiline, so
        # against a joined block ^ means "start of the whole string" -- and the
        # probe prints CORES first, so RAM and LOCALAPP could never match no
        # matter what the machine reported. The tell was the split: CORES
        # passed and these two failed, on every Windows runner, forever. A
        # pass/fail split landing exactly on "which form did the check use" is
        # a fault in the check, not in the machine.
        #
        # Match per line, exactly as the CORES check above already does.
        Check ($null -ne ($out | Where-Object { $_ -match '^RAM=\d+$' })) 'Native probes: RAM=Win32_ComputerSystem'
        Check ($null -ne ($out | Where-Object { $_ -match '^LOCALAPP=.+$' })) 'Native probes: Known Folder LocalApplicationData'
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
    blocked = $blocked
}
$resultPath = Join-Path $PSScriptRoot 'fixtures\matrix-golden.json'
$result | ConvertTo-Json | Set-Content -Path $resultPath -Encoding UTF8

Write-Host ''
Write-Host "$passes passed, $failures failed, $blocked blocked"
exit $(if ($failures -eq 0) { 0 } else { 1 })
