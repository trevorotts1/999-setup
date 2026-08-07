# claude-nine.ps1 — Windows launcher: start/verify 9Router, load protected
# routed-session state, export routing env vars only into the child process, and
# launch the same Claude Code installation through 9Router.
#
# Never echoes API keys, the router token, or the dashboard password.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$ForwardedArgs
)

$ErrorActionPreference = 'Stop'
$Port = 20128
$Base = "http://127.0.0.1:$Port"
$StateDir = "$env:LOCALAPPDATA\BlackCEO\999"
$StateFile = Join-Path $StateDir 'router-session.json'
$TokenFile = Join-Path $StateDir 'router-token.bin'

function Test-Health {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/health" -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

# Quote a single command-line argument safely for ProcessStartInfo.Arguments
# (which takes one flat string, not a list, on .NET Framework).
function Escape-Argument([string]$a) {
    if ($null -eq $a) { return '""' }
    if ($a -notmatch '[ "\t]') { return $a }
    return '"' + ($a -replace '"', '\"') + '"'
}

function Start-Router {
    # Resolve the installed 9router binary.
    $r = Get-Command 9router -ErrorAction SilentlyContinue
    if (-not $r) { throw '9router executable not found on PATH.' }
    Start-Process -FilePath $r.Source -ArgumentList @('--no-browser') -WindowStyle Hidden
    for ($i = 0; $i -lt 40; $i++) {
        if (Test-Health) { return }
        Start-Sleep -Milliseconds 500
    }
    throw '9Router did not become healthy.'
}

try {
    # 1. Resolve the same claude binary plain `claude` uses.
    $claude = Get-Command claude -ErrorAction SilentlyContinue
    if (-not $claude) { throw 'claude not found on PATH.' }

    # 2. Protected state + token.
    if (-not (Test-Path $StateFile)) {
        throw "Routed session state missing: $StateFile. Re-run /nine-router-setup."
    }
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    if (-not (Test-Path $TokenFile)) {
        throw "Protected router token missing: $TokenFile. Re-run /nine-router-setup."
    }
    $token = [System.Security.Cryptography.ProtectedData]::Unprotect(
        [System.IO.File]::ReadAllBytes($TokenFile),
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $tokenStr = [System.Text.Encoding]::UTF8.GetString($token)
    if (-not $tokenStr) { throw 'Protected token is empty. Re-run /nine-router-setup.' }

    # 3. Ensure 9Router is up.
    if (-not (Test-Health)) {
        Write-Host "9Router not healthy on :$Port — starting it..." -ForegroundColor Yellow
        Start-Router
    }

    # 4. Build child env: routing vars only.
    $childEnv = @{}
    $childEnv['ANTHROPIC_BASE_URL'] = "http://127.0.0.1:$Port/v1"
    $childEnv['ANTHROPIC_AUTH_TOKEN'] = $tokenStr
    if ($state.routes.fable)    { $childEnv['ANTHROPIC_DEFAULT_FABLE_MODEL']   = $state.routes.fable }
    if ($state.routes.opus)     { $childEnv['ANTHROPIC_DEFAULT_OPUS_MODEL']    = $state.routes.opus }
    if ($state.routes.sonnet)   { $childEnv['ANTHROPIC_DEFAULT_SONNET_MODEL']  = $state.routes.sonnet }
    if ($state.routes.haiku)    { $childEnv['ANTHROPIC_DEFAULT_HAIKU_MODEL']   = $state.routes.haiku }
    if ($state.routes.subagent) { $childEnv['CLAUDE_CODE_SUBAGENT_MODEL']      = $state.routes.subagent }
    if ($state.effortLevel)     { $childEnv['CLAUDE_CODE_EFFORT_LEVEL']        = $state.effortLevel }
    if ($state.maxOutputTokens) { $childEnv['CLAUDE_CODE_MAX_OUTPUT_TOKENS']   = [string]$state.maxOutputTokens }
    if ($state.concurrency)     { $childEnv['CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY'] = [string]$state.concurrency }

    # Never launch unrouted — a corrupt state file would silently behave like
    # plain claude. Assert the routing boundary is armed before starting.
    foreach ($k in @('ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL')) {
        if (-not $childEnv.ContainsKey($k) -or -not $childEnv[$k]) {
            throw "routed session state is corrupt (missing $k); re-run /nine-router-setup."
        }
    }

    # 5. Launch the same claude with the child env, forwarding all args.
    #    NOTE: Windows PowerShell 5.1 runs on .NET Framework 4.x, where
    #    ProcessStartInfo.ArgumentList and .Environment do NOT exist (they were
    #    added in .NET Core). Use EnvironmentVariables and a quoted Arguments
    #    string so the launcher works under PowerShell 5.1.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $claude.Source
    $psi.UseShellExecute = $false
    foreach ($kv in $childEnv.GetEnumerator()) {
        $psi.EnvironmentVariables[$kv.Key] = $kv.Value
    }
    $escaped = @()
    foreach ($arg in $ForwardedArgs) {
        $escaped += Escape-Argument $arg
    }
    $psi.Arguments = ($escaped -join ' ')
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    exit $proc.ExitCode
} catch {
    Write-Error "claude-nine: $($_.Exception.Message)"
    Write-Host "Repair with: /nine-router-setup (or run the matching setup script)."
    exit 1
}
