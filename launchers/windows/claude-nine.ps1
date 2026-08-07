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

    # 5. Launch the same claude with the child env, forwarding all args.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $claude.Source
    foreach ($kv in $childEnv.GetEnumerator()) {
        $psi.Environment[$kv.Key] = $kv.Value
    }
    foreach ($arg in $ForwardedArgs) {
        $psi.ArgumentList.Add($arg)
    }
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    exit $proc.ExitCode
} catch {
    Write-Error "claude-nine: $($_.Exception.Message)"
    Write-Host "Repair with: /nine-router-setup (or run the matching setup script)."
    exit 1
}
