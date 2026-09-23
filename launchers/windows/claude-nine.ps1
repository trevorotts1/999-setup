# claude-nine.ps1 - Windows launcher: start/verify 9Router, load protected
# routed-session state, export routing env vars only into the child process, and
# launch the same Claude Code installation through 9Router.
#
# NOTES FOR WINDOWS POWERSHELL 5.1:
# - No [CmdletBinding()]/param(): PowerShell's common-parameter prefix matching
#   would hijack real args like -p (-> -PipelineVariable). Read $args verbatim.
# - System.Security is not auto-loaded in 5.1; Add-Type is required for DPAPI.
# - This file is ASCII-only. A non-ASCII byte (e.g. an em dash) decoded as ANSI
#   under 5.1 produces a stray double-quote that collapses the whole script.
#
# Never echoes API keys, the router token, or the dashboard password.
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

# Forwarded arguments, verbatim (automatic $args under powershell -File).
$ForwardedArgs = $args
$EffortFlag = $null

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

function Resolve-NineRouter {
    # A bare `9router` may not be on PATH in a fresh session after a reboot, so
    # resolve it explicitly: NINEROUTER_BINARY, the path setup recorded in the
    # state file, the default npm global prefix, then PATH.
    $cands = @($env:NINEROUTER_BINARY)
    if ($state -and $state.nineRouterBinary) { $cands += [string]$state.nineRouterBinary }
    if ($env:APPDATA) { $cands += (Join-Path $env:APPDATA 'npm\9router.cmd') }
    $g = Get-Command 9router -ErrorAction SilentlyContinue
    if ($g) { $cands += $g.Source }
    foreach ($c in $cands) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

function Start-Router {
    # Get-Command resolves the npm .ps1 shim; pass it through Start-Process and
    # it opens with the Edit verb (nothing runs). Target the .cmd shim instead.
    # --host 127.0.0.1 keeps the router loopback-only.
    $src = Resolve-NineRouter
    if (-not $src) { throw '9router not found (looked at NINEROUTER_BINARY, the setup state file, %APPDATA%\npm, PATH).' }
    $exe = [System.IO.Path]::ChangeExtension($src, 'cmd')
    if (-not (Test-Path $exe)) { $exe = $src }
    Start-Process -FilePath $exe -ArgumentList @('-p', "$Port", '--no-browser','--host','127.0.0.1') -WindowStyle Hidden
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

    # 2.5 Keep 9Router's catalog limits correct (DeepSeek V4 Flash is 1M context,
    #     not the 128K the package ships). An npm update restores the wrong value,
    #     so re-apply it every launch. Exit 10 = patched: restart the running
    #     router so it loads the fix. Any other exit never blocks the launch.
    #     EAP Continue: under 5.1, stderr from a native command with EAP Stop
    #     would throw.
    $catFix = Join-Path $PSScriptRoot 'fix-9router-catalog.mjs'
    if ((Test-Path $catFix) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & node $catFix --quiet 2>&1 | Out-Null
        $catRc = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($catRc -eq 10 -and (Test-Health)) {
            Write-Host '9Router catalog corrected - restarting 9Router to load it...' -ForegroundColor Yellow
            $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
            for ($i = 0; $i -lt 20 -and (Test-Health); $i++) { Start-Sleep -Milliseconds 500 }
            Start-Router
        }
    }

    # 3. Ensure 9Router is up (router is not a service; this is the daily path).
    if (-not (Test-Health)) {
        Write-Host "9Router not healthy on :$Port - starting it..." -ForegroundColor Yellow
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
    # CLAUDE_CODE_EFFORT_LEVEL is deliberately NOT exported from the state file.
    # /effort selections persist via the profile's settings.json effortLevel; a
    # forced env export overrides the picker (the 2026-08-11 ultracode-revert
    # bug). Router thinking hints live in the route suffixes ((max)), not here.
    # Opt back in per launch with CLAUDE_NINE_FORCE_EFFORT=<level>.
    if ($env:CLAUDE_NINE_FORCE_EFFORT) { $childEnv['CLAUDE_CODE_EFFORT_LEVEL']  = $env:CLAUDE_NINE_FORCE_EFFORT }
    # lastEffortSelection (Issue 1 persistence): the user's last /effort
    # selection is re-applied at exec time. ultracode becomes the --effort
    # ultracode CLI flag (the ONLY mechanism that survives a session boundary
    # for ultracode); a persistable level becomes a per-launch env export.
    # CLAUDE_NINE_FORCE_EFFORT wins over lastEffortSelection (checked above).
    $lastEffort = $null
    if ($state.lastEffortSelection) { $lastEffort = [string]$state.lastEffortSelection }
    if (-not $env:CLAUDE_NINE_FORCE_EFFORT -and $lastEffort -eq 'ultracode') {
        $EffortFlag = '--effort ultracode'
        # The binary exports only the effort LEVEL to child processes, and
        # ultracode's level is plain xhigh -- so no subprocess can tell
        # ultracode from xhigh by environment alone. Export an explicit marker
        # next to the flag so in-session checks (spec-protocol GATE 0
        # witness 1) can see what was actually requested.
        $childEnv['CLAUDE_NINE_ULTRACODE'] = '1'
    } elseif (-not $env:CLAUDE_NINE_FORCE_EFFORT -and $lastEffort -in @('low','medium','high','xhigh','max')) {
        $childEnv['CLAUDE_CODE_EFFORT_LEVEL'] = $lastEffort
    }
    if ($state.maxOutputTokens) { $childEnv['CLAUDE_CODE_MAX_OUTPUT_TOKENS']   = [string]$state.maxOutputTokens }
    if ($state.concurrency)     { $childEnv['CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY'] = [string]$state.concurrency }
    # Same context values as the macOS launcher: a 1M context ceiling, and
    # compaction at 200K - below the smallest window a fallback lane can reach
    # (ollama/kimi-k2.6, 256K; 200K + 32K output fits). The env var outranks
    # any settings.json autoCompactWindow. A caller-provided value wins.
    $childEnv['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = if ($env:CLAUDE_CODE_MAX_CONTEXT_TOKENS) { $env:CLAUDE_CODE_MAX_CONTEXT_TOKENS } else { '1000000' }
    $childEnv['CLAUDE_CODE_AUTO_COMPACT_WINDOW'] = if ($env:CLAUDE_CODE_AUTO_COMPACT_WINDOW) { $env:CLAUDE_CODE_AUTO_COMPACT_WINDOW } else { '200000' }

    # Never launch unrouted - a corrupt state file would silently behave like
    # plain claude. Assert the routing boundary is armed before starting.
    foreach ($k in @('ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL')) {
        if (-not $childEnv.ContainsKey($k) -or -not $childEnv[$k]) {
            throw "routed session state is corrupt (missing $k); re-run /nine-router-setup."
        }
    }

    # 5. Launch the same claude with the child env, forwarding all args.
    #    Windows PowerShell 5.1 runs on .NET Framework 4.x, where
    #    ProcessStartInfo.ArgumentList and .Environment do NOT exist. Use
    #    EnvironmentVariables and a quoted Arguments string instead.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $claude.Source
    $psi.UseShellExecute = $false
    foreach ($kv in $childEnv.GetEnumerator()) {
        $psi.EnvironmentVariables[$kv.Key] = $kv.Value
    }
    $escaped = @()
    # Ultracode flag (when lastEffortSelection says so) rides first; a
    # user-passed --effort still wins (claude's CLI takes the last flag).
    if ($EffortFlag) { $escaped += $EffortFlag }
    foreach ($arg in $ForwardedArgs) {
        $escaped += Escape-Argument $arg
    }
    $psi.Arguments = ($escaped -join ' ')
    # Keep the PC awake while the session runs (display may sleep):
    # ES_CONTINUOUS | ES_SYSTEM_REQUIRED on this thread, which stays alive in
    # WaitForExit below; Windows drops it when this process exits.
    # UNVERIFIED on real hardware; never blocks the launch.
    try {
        Add-Type -Namespace NineWake -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);' -ErrorAction Stop
        [void][NineWake.Power]::SetThreadExecutionState([uint32]2147483649)
    } catch { Write-Host 'claude-nine: could not keep the PC awake; it may sleep during long runs.' -ForegroundColor Yellow }
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    exit $proc.ExitCode
} catch {
    Write-Error "claude-nine: $($_.Exception.Message)"
    Write-Host "Repair with: /nine-router-setup (or run the matching setup script)."
    exit 1
}
