# setup-windows.ps1 - Windows 10/11 orchestrator for the 999-setup repository.
# Idempotent: rerunning repairs/updates existing state instead of duplicating it.
#
# Flow:
#   1. Verify native Windows.
#   2. Verify Claude Code exists.
#   3. Resolve Documents + locate/parse/validate API docs.md.
#   4. Dependency preflight: prove DPAPI loads, install/repair Node (absolute
#      path, real-execution re-verify — never trust a cached PATH entry) and
#      9Router (real --version proof), verify npm can reach its registry, and
#      print an honest dependency summary before any provisioning starts.
#   5. Start 9Router, wait for health, first-run security.
#   6. Configure providers/routing/combos via shared Node helpers.
#   7. Install the claude-nine launcher + DPAPI-protected state.
#   8. Run smoke tests (including the launcher itself, end to end).
#   9. Print the completion report (no secrets).
#
# Never prints API keys, the router token, or the dashboard password.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [int]$Port = 20128
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# $ScriptDir IS the scripts directory; do not take its parent again.
$Scripts = $ScriptDir
$Common = Join-Path $Scripts 'common'
$Win = Join-Path $Scripts 'windows'
# Repo root = four levels above scripts when running from the repo
# (scripts -> nine-router-setup -> skills -> .claude -> repo). When the skill is
# installed standalone under ~/.claude/skills there is no repo above it, so treat
# this as optional (never hard-fail on it).
$RepoRoot = $null
try {
    $RepoRoot = (Resolve-Path (Join-Path $Scripts '..\..\..\..') -ErrorAction SilentlyContinue).Path
} catch { }
$Base = "http://127.0.0.1:$Port"
$StateDir = "$env:LOCALAPPDATA\BlackCEO\999"
$StateFile = Join-Path $StateDir 'router-session.json'

function Write-Log([string]$m) { Write-Host "[setup-windows] $m" }
function Write-Blocker([string]$m) { Write-Error "BLOCKER: $m"; exit 1 }

function Mask([string]$v) {
    if ($v.Length -le 6) { return '<short>' }
    return $v.Substring(0,3) + '...' + $v.Substring($v.Length-3)
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

function Wait-Health {
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/health" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Read-ApiDocs([string]$file) {
    $map = @{}
    Get-Content -Path $file -Encoding UTF8 | ForEach-Object {
        $line = $_ -replace '^\s+','' -replace '\s+$',''
        if ([string]::IsNullOrWhiteSpace($line)) { return }
        if ($line.StartsWith('#')) { return }
        if ($line -match '^([A-Za-z0-9_]+)\s*=\s*(.*)$') {
            $k = $matches[1]; $v = $matches[2].Trim()
            if ($k -in @('OLLAMA_API_KEY','DEEPSEEK_API_KEY','AGNES_API_KEY','OPENROUTER_API_KEY','OLLAMA_PLAN','AGNES_PLAN')) {
                $map[$k] = $v
            }
        }
    }
    return $map
}

function Validate-Plan([string]$plan, [string]$allowed, [string]$name) {
    if ($allowed -split ' ' -notcontains $plan) {
        Write-Blocker "$name must be one of: $allowed (got '$plan')"
    }
}

function Resolve-Claude {
    $c = Get-Command claude -ErrorAction SilentlyContinue
    if ($c) {
        # Verify the resolved binary actually runs. A broken claude on PATH must
        # block setup (spec step 3), not be carried into claude-nine.
        & $c.Source --version 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Blocker "Claude Code is on PATH but '$($c.Source) --version' failed. Reinstall Claude Code, then rerun."
        }
        return $c.Source
    }
    Write-Blocker 'Claude Code not found. Install it first (see README), then rerun.'
}

function Get-Concurrency([string]$plan) {
    switch ($plan) { 'free' { 1 } 'max' { 8 } default { 2 } }
}

# Bundled personal skills — the same list the macOS installer links. Source of
# truth: CONTROL/bundled-skills.txt when running from a repo checkout;
# standalone installs fall back to the hard-coded baseline. Junction links
# (New-Item -ItemType Junction) work without admin rights or Developer Mode,
# unlike real symlinks on Windows.
function Get-BundledSkills {
    $list = @()
    if ($RepoRoot -and (Test-Path (Join-Path $RepoRoot 'CONTROL\bundled-skills.txt'))) {
        Get-Content (Join-Path $RepoRoot 'CONTROL\bundled-skills.txt') | ForEach-Object {
            $line = $_ -replace '\s*#.*$', ''
            $line = $line.Trim()
            if ($line) { $list += $line }
        }
    } else {
        $list = @('nine-router-setup', 'spec-protocol', 'kaizen', 'eli5', 'bro')
    }
    return $list
}

function Link-BundledSkills([string]$Root) {
    if (-not $Root) { return }
    $skillsDir = Join-Path $Root 'skills'
    if (-not (Test-Path $skillsDir)) {
        try { New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null }
        catch { return }
    }
    foreach ($s in (Get-BundledSkills)) {
        $src = $null
        if ($RepoRoot) {
            $repoCandidate = Join-Path $RepoRoot ".claude\skills\$s"
            if (Test-Path (Join-Path $repoCandidate 'SKILL.md')) { $src = (Resolve-Path $repoCandidate).Path }
        }
        if (-not $src) {
            $homeCandidate = Join-Path $env:USERPROFILE ".claude\skills\$s"
            if (Test-Path (Join-Path $homeCandidate 'SKILL.md')) { $src = (Resolve-Path $homeCandidate).Path }
        }
        if (-not $src) { continue }
        $dst = Join-Path $skillsDir $s
        if (Test-Path $dst) {
            # Idempotent: if it already resolves to the same source, skip; a
            # junction pointing elsewhere is re-pointed, a real directory is
            # left alone (it is the shared-root case: link target is the source).
            try {
                $dstResolved = (Resolve-Path $dst).Path
                if ($dstResolved -eq $src) { continue }
                $dstItem = Get-Item $dst -ErrorAction SilentlyContinue
                if ($dstItem.LinkType -eq 'Junction') {
                    Remove-Item $dst -Force -ErrorAction SilentlyContinue
                } else {
                    continue
                }
            } catch { }
        }
        try {
            New-Item -ItemType Junction -Path $dst -Target $src -ErrorAction Stop | Out-Null
            Write-Log "skill linked: $s -> $dst"
        } catch {
            Write-Log "skill link failed for $s: $($_.Exception.Message)"
        }
    }
}

# Dependency-preflight summary lines. Populated only by real-execution
# probes below; never hand-set to a status the probe did not produce.
$DepSummary = @()

try {
    # 0. DPAPI (System.Security) — proved here, early, rather than letting a
    #    load failure surface deep inside Protect-LocalState.ps1 or
    #    claude-nine.ps1 later as an unrelated-looking error.
    try {
        Add-Type -AssemblyName System.Security -ErrorAction Stop
        $DepSummary += 'System.Security (DPAPI) OK   assembly loaded'
    } catch {
        Write-Blocker "The .NET System.Security assembly could not be loaded (required to protect the local router token): $($_.Exception.Message)"
    }

    # 1. OS
    if ($env:OS -ne 'Windows_NT') {
        Write-Blocker "This orchestrator is Windows-only (OS=$($env:OS))."
    }

    # 2. Claude Code
    $claudeBin = Resolve-Claude
    Write-Log "Claude Code: $claudeBin"
    $DepSummary += "claude          OK   $claudeBin"

    # 3. Documents + API docs.md
    $apiDocs = & (Join-Path $Win 'Get-ApiDocs.ps1')
    if ($LASTEXITCODE -ne 0) { exit 1 }
    Write-Log "Credential file: $apiDocs"
    $creds = Read-ApiDocs $apiDocs
    foreach ($k in @('OLLAMA_API_KEY','DEEPSEEK_API_KEY','AGNES_API_KEY')) {
        if (-not $creds[$k]) { Write-Blocker "Missing $k in $apiDocs" }
        if ($creds[$k] -in @('','replace_with_real_key','changeme','your-key-here')) {
            Write-Blocker "$k is set to placeholder text in $apiDocs"
        }
    }
    Validate-Plan $creds['OLLAMA_PLAN'] 'free pro max' 'OLLAMA_PLAN'
    Validate-Plan $creds['AGNES_PLAN'] 'starter plus pro' 'AGNES_PLAN'

    # OPENROUTER_API_KEY is OPTIONAL: absent/placeholder = skip the lane, never a blocker.
    $openrouterKey = $creds['OPENROUTER_API_KEY']
    if (-not $openrouterKey -or $openrouterKey -in @('replace_with_real_key','changeme','your-key-here')) { $openrouterKey = '' }
    if ($openrouterKey) { Write-Log 'OpenRouter: optional key found - lane will be wired' }
    else { Write-Log 'OpenRouter: no OPENROUTER_API_KEY in API docs.md - lane will be skipped' }

    # 4. Dependency preflight. git/repository-acquisition is intentionally NOT
    #    probed here: this script only runs from an already-acquired
    #    checkout (Claude Code performs acquisition per AGENT_INSTALL.md,
    #    outside this script's scope) — matches setup-macos.sh's equivalent
    #    scoping note, keeping the two platforms behaviourally equivalent.

    # Node 20+ / npm 10+: Install-Node.ps1 installs/repairs ONLY when needed
    # (winget presence/execution is checked THERE, right when it is actually
    # needed) and writes the ABSOLUTE path to a proven-working node binary
    # via Write-Output. Re-verify it for real, in THIS process, right now —
    # never trust a cached PATH entry.
    $NodeBin = & (Join-Path $Win 'Install-Node.ps1')
    if ($LASTEXITCODE -ne 0) { Write-Blocker 'Node.js install/verify failed.' }
    Refresh-Path
    if (-not $NodeBin) { $NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source }
    if (-not $NodeBin -or -not (Test-Path $NodeBin)) { Write-Blocker 'Could not resolve an absolute path to node after install/verify.' }
    $nodeVerOut = & $NodeBin --version 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Blocker "node at $NodeBin does not execute (--version failed): $nodeVerOut" }
    $nodeVerStr = ($nodeVerOut | Select-Object -Last 1).ToString()
    $nodeMajorParsed = 0
    if (-not [int]::TryParse((($nodeVerStr.TrimStart('v')) -split '\.')[0], [ref]$nodeMajorParsed)) {
        Write-Blocker "node at $NodeBin reported an unparseable version: $nodeVerStr"
    }
    if ($nodeMajorParsed -lt 20) {
        Write-Blocker "node at $NodeBin reports $nodeVerStr (< 20) even right after install/verify."
    }
    $NodeDir = Split-Path $NodeBin
    $NpmBin = Join-Path $NodeDir 'npm.cmd'
    if (-not (Test-Path $NpmBin)) { $NpmBin = (Get-Command npm -ErrorAction SilentlyContinue).Source }
    if (-not $NpmBin -or -not (Test-Path $NpmBin)) { Write-Blocker "npm not found next to node at $NodeDir." }
    $npmVerOut = & $NpmBin --version 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Blocker "npm at $NpmBin does not execute (--version failed): $npmVerOut" }
    $npmVerStr = ($npmVerOut | Select-Object -Last 1).ToString()
    $DepSummary += "node            OK   $nodeVerStr ($NodeBin)"
    $DepSummary += "npm             OK   v$npmVerStr ($NpmBin)"

    Write-Log 'Verifying npm registry reachability...'
    $npmPingOut = & $NpmBin ping --registry https://registry.npmjs.org/ 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Blocker "npm cannot reach the registry (required to install 9router): $npmPingOut" }
    $DepSummary += 'npm registry    OK   ping succeeded'

    # 5. 9Router. Idempotent: if the router is already healthy, do NOT reinstall
    #    (npm EBUSY on the locked node_modules otherwise) - just resolve the binary.
    #    Install-NineRouter.ps1 PROVES the binary executes (--version, not a
    #    Get-Command resolution alone) before returning its absolute path.
    if (Wait-Health) {
        Write-Log '9Router already running and healthy; skipping reinstall.'
        $nineBin = (Get-Command 9router -ErrorAction SilentlyContinue).Source
        $nineMode = 'existing install kept - router already running (no reinstall, no upgrade)'
    } else {
        $nineBin = & (Join-Path $Win 'Install-NineRouter.ps1')
        if ($LASTEXITCODE -ne 0) { Write-Blocker '9Router install failed.' }
        Refresh-Path
        $StateDir999 = Join-Path $env:LOCALAPPDATA 'BlackCEO\999'
        $ModeFile = Join-Path $StateDir999 'last-install-mode.txt'
        $nineModeRaw = Get-Content -Path $ModeFile -ErrorAction SilentlyContinue | Select-Object -First 1
        switch ($nineModeRaw) {
            'kept'                { $nineMode = 'existing install kept (no reinstall, no upgrade)' }
            'reinstalled-broken'  { $nineMode = 'was present but broken - reinstalled' }
            'fresh-install'       { $nineMode = 'freshly installed' }
            default               { $nineMode = 'unknown' }
        }
    }
    if (-not $nineBin) { $nineBin = (Get-Command 9router -ErrorAction SilentlyContinue).Source }
    if (-not $nineBin) { Write-Blocker '9router executable could not be resolved.' }
    $nineVerOut = & $nineBin --version 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Blocker "9router at $nineBin does not execute (--version failed): $nineVerOut" }
    $nineVerStr = ($nineVerOut | Select-Object -Last 1).ToString()
    $DepSummary += "9router         OK   v$nineVerStr ($nineBin)"

    Write-Log 'Dependency preflight complete:'
    foreach ($line in $DepSummary) { Write-Log "  $line" }

    # 6. Start + health + first-run security
    if (-not (Wait-Health)) {
        # The npm '9router' name resolves to a .ps1 shim, which Start-Process
        # opens with the Edit verb (nothing runs). Target the .cmd shim instead.
        $nineCmd = [System.IO.Path]::ChangeExtension($nineBin, 'cmd')
        if (-not (Test-Path $nineCmd)) { $nineCmd = $nineBin }
        # --host 127.0.0.1 is a security requirement: default binds 0.0.0.0 and
        # exposes the dashboard + /v1 (holding provider keys) to the LAN.
        Start-Process -FilePath $nineCmd -ArgumentList @('--no-browser','--host','127.0.0.1') -WindowStyle Hidden
        if (-not (Wait-Health)) { Write-Blocker "9Router did not become healthy on $Base" }
    }

    # No dashboard password rotation: the user owns the 9Router dashboard password
    # and manages it themselves. Honor NINEROUTER_DASHBOARD_PW if the user has
    # already changed it from the default (parity with setup-macos.sh:294;
    # without this, a student who changed the password hits an unrecoverable
    # login blocker whose own error message tells them to set this variable).
    $dashPw = if ($env:NINEROUTER_DASHBOARD_PW) { $env:NINEROUTER_DASHBOARD_PW } else { '123456' }

    # 7. Live model resolution
    # Provider keys must be exported BEFORE resolve-models.mjs runs: it reads
    # process.env.*_API_KEY to hit each provider's live catalog. Exporting
    # them only at step 8 (as before) meant resolution ran with ZERO keys,
    # silently returning {} and falling through to configure-nine-router.mjs's
    # hardcoded fallback catalogs - the live-catalog validation gate was a
    # no-op. Move the exports here, ahead of the resolve call.
    $env:DEEPSEEK_API_KEY = $creds['DEEPSEEK_API_KEY']
    $env:OLLAMA_API_KEY = $creds['OLLAMA_API_KEY']
    $env:AGNES_API_KEY = $creds['AGNES_API_KEY']
    $env:OPENROUTER_API_KEY = $openrouterKey
    $env:OLLAMA_PLAN = $creds['OLLAMA_PLAN']
    $env:AGNES_PLAN = $creds['AGNES_PLAN']
    Write-Log 'Resolving live provider catalogs...'
    # Keep stderr OUT of the captured JSON (same rationale/pattern as the
    # token capture below at :279-289): 2>&1 would space-join stderr lines
    # into $resolvedJson (corrupting RESOLVED_MODELS), and under PS 5.1
    # EAP=Stop a stray stderr line (e.g. an npm/node notice) can raise a
    # terminating NativeCommandError before $LASTEXITCODE is even checked.
    $resolveStderrFile = [System.IO.Path]::GetTempFileName()
    $resolvedJson = & $NodeBin (Join-Path $Common 'resolve-models.mjs') --all 2>$resolveStderrFile
    $resolveExit = $LASTEXITCODE
    if ($resolveExit -ne 0) {
        $resolveErrText = ''
        if (Test-Path $resolveStderrFile) { $resolveErrText = (Get-Content $resolveStderrFile -Raw -ErrorAction SilentlyContinue).Trim() }
        Remove-Item $resolveStderrFile -ErrorAction SilentlyContinue
        Write-Blocker "live model resolution failed: $resolveErrText"
    }
    Remove-Item $resolveStderrFile -ErrorAction SilentlyContinue
    Write-Log 'Live catalogs resolved.'

    # 8. Configure 9Router
    $env:NINEROUTER_BASE = $Base
    $env:NINEROUTER_DASHBOARD_PW = $dashPw
    # DEEPSEEK_FLASH_VARIANT passes through as set by the user (default empty).
    $env:RESOLVED_MODELS = $resolvedJson

    $cfgOut = & $NodeBin (Join-Path $Common 'configure-nine-router.mjs') 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Blocker "9Router configuration failed: $cfgOut" }

    # Parse the JSON report: the helper emits a sentinel line followed by ONE
    # compact JSON line. Take the line after the sentinel (never filter by '^{' -
    # that keeps only the outer brace and breaks ConvertFrom-Json).
    $cfgArr = @($cfgOut)
    $sentinelIdx = -1
    for ($i = 0; $i -lt $cfgArr.Count; $i++) {
        if ($cfgArr[$i] -match '^===999-CONFIG-REPORT===') { $sentinelIdx = $i; break }
    }
    if ($sentinelIdx -lt 0 -or ($sentinelIdx + 1) -ge $cfgArr.Count) {
        Write-Blocker "configure-nine-router.mjs did not emit a config report (check 9Router health)."
    }
    $report = $cfgArr[$sentinelIdx + 1] | ConvertFrom-Json

    # No dashboard password rotation: the configure helper never changes the
    # password, so $dashPw stays whatever was passed in (default 123456).
    # The report's mustChangePassword flag is advisory messaging only.

    # Obtain the local router token (create/reuse) and DPAPI-protect it.
    $env:NINEROUTER_DASHBOARD_PW = $dashPw
    $commonFwd = $Common -replace '\\','/'
    $tokenScript = @'
import { pathToFileURL } from 'node:url';
const { NineRouterClient } = await import(pathToFileURL(process.env.COMMON_DIR + '/nine-router-api.mjs').href);
const c = new NineRouterClient(process.env.NINEROUTER_BASE);
let ok = (await c.login(process.env.NINEROUTER_DASHBOARD_PW).catch(() => null))?.success;
// Idempotent-rerun fallback: a password that did not rotate (or was already
// rotated on an earlier run) must not fail the token fetch on login.
if (!ok && process.env.NINEROUTER_DASHBOARD_PW !== '123456') {
  ok = (await c.login('123456').catch(() => null))?.success;
}
if (!ok) throw new Error('dashboard login failed');
const keys = await c.listKeys();
const k = keys.find(x => x.name === 'BlackCEO Claude Code');
if (k && k.key) { console.log(k.key); process.exitCode = 0; }
else {
  const created = await c.createKey('BlackCEO Claude Code');
  console.log(created.key); process.exitCode = 0;
}
'@
    $env:COMMON_DIR = $commonFwd
    # Keep stderr OUT of the captured token - an error string stored as the token
    # would later surface as a confusing 401 from the router instead of a clean
    # setup failure. Redirect node's stderr to a temp file and check its exit code.
    $stderrFile = [System.IO.Path]::GetTempFileName()
    $tokenRaw = & $NodeBin --input-type=module -e $tokenScript 2>$stderrFile
    $nodeExit = $LASTEXITCODE
    Remove-Item Env:COMMON_DIR -ErrorAction SilentlyContinue
    if ($nodeExit -ne 0) {
        $errText = ''
        if (Test-Path $stderrFile) { $errText = (Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue).Trim() }
        Remove-Item $stderrFile -ErrorAction SilentlyContinue
        Write-Blocker "Could not obtain the local 9Router API key: $errText"
    }
    Remove-Item $stderrFile -ErrorAction SilentlyContinue
    $token = ($tokenRaw | Select-Object -Last 1).Trim()
    # Validate the token shape before storing: non-empty, no whitespace.
    if (-not $token) {
        Write-Blocker "Could not obtain the local 9Router API key (empty result)."
    }
    if ($token -match '\s') {
        Write-Blocker "Local 9Router API key had an unexpected shape; refusing to store it."
    }
    & (Join-Path $Win 'Protect-LocalState.ps1') -Action set-token -Token $token
    Remove-Item Env:DEEPSEEK_API_KEY,Env:OLLAMA_API_KEY,Env:AGNES_API_KEY,Env:OPENROUTER_API_KEY -ErrorAction SilentlyContinue

    # 9. Write routing state (non-secret).
    $routes = $report.resolvedRoutes
    $concurrency = Get-Concurrency $creds['OLLAMA_PLAN']
    $stateInput = @{
        statePath = $StateFile
        routes = @{
            fable    = $routes.fable
            opus     = $routes.opus
            sonnet   = $routes.sonnet
            haiku    = $routes.haiku
            subagent = $routes.subagent
            vision   = $routes.vision
        }
        concurrency = $concurrency
        maxOutputTokens = 32000
        effortLevel = 'xhigh'
        lastEffortSelection = $null
        claudeBinary = $claudeBin
        nineRouterBinary = $nineBin
        port = $Port
        tokenRef = "DPAPI:$StateDir\router-token.bin"
    } | ConvertTo-Json -Depth 4
    $stateInput | & $NodeBin (Join-Path $Common 'write-routing-state.mjs')
    if ($LASTEXITCODE -ne 0) {
        Write-Blocker 'Routing state could not be written (write-routing-state failed).'
    }

    # 10. Install launcher (Install-ClaudeNine.ps1 resolves the repo launcher path itself).
    & (Join-Path $Win 'Install-ClaudeNine.ps1')
    if ($LASTEXITCODE -ne 0) { Write-Blocker 'claude-nine launcher install failed.' }
    Refresh-Path

    # 10.5 Enable Agent Teams (merge-only, backed up; never disturbs running work).
    #      Turns the experimental Agent Teams flag on in
    #      %USERPROFILE%\.claude\settings.json for FUTURE Claude Code sessions
    #      only. The enabler backs the file up first, MERGES exactly one key,
    #      validates the result, and restores the backup on any failure.
    #      teammateMode is NOT written on Windows: it stays
    #      DEFERRED-UNDETERMINED because tmux is a Unix assumption and no
    #      Windows display mode has been probed - the skill's runtime probe is
    #      the authority, never this installer.
    #      NEVER fatal to setup: a blocked or failed enablement is reported
    #      honestly in the completion report and the rest of the install still
    #      completes (a routed Claude Code does not depend on Agent Teams).
    $agentTeamsReport = ''
    $agentTeamsStatus = 'SKIPPED - Enable-AgentTeams.ps1 not found'
    $enableTeams = Join-Path $Win 'Enable-AgentTeams.ps1'
    if (Test-Path $enableTeams) {
        try {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $agentTeamsReport = (& $enableTeams -ClaudeBin $claudeBin | Out-String)
            $agentTeamsRc = $LASTEXITCODE
            $ErrorActionPreference = $prevEap
            switch ($agentTeamsRc) {
                0 {
                    $agentTeamsStatus = 'UNKNOWN (the enabler produced no status line)'
                    $lines = @($agentTeamsReport -split "`r?`n")
                    for ($i = 0; $i -lt $lines.Count - 1; $i++) {
                        if ($lines[$i].Trim() -eq 'AGENT TEAMS:') { $agentTeamsStatus = $lines[$i + 1].Trim(); break }
                    }
                }
                1 { $agentTeamsStatus = 'BLOCKED - Claude Code is below the Agent Teams version floor. Nothing was modified; Claude Code was NOT updated (never automatic).' }
                default { $agentTeamsStatus = 'NOT ENABLED - the enabler reported a tooling failure; the settings backup was restored where one existed.' }
            }
        } catch {
            $ErrorActionPreference = 'Stop'
            $agentTeamsStatus = "NOT ENABLED - the enabler could not be run: $($_.Exception.Message)"
        }
        Write-Log "Agent Teams enablement: $agentTeamsStatus"
    }

    # 10.6 Clear the ultracode/effort override (detect + remediate, backed up;
    #      never disturbs running work). CLAUDE_CODE_EFFORT_LEVEL in the
    #      environment OVERRIDES the in-session /effort picker, so
    #      `/effort ultracode` snaps back to whatever the variable says. The
    #      launcher fix (v1.2.0) stopped THIS repo exporting it; it cannot reach
    #      a box where the variable comes from the User or Machine environment
    #      scope, a PowerShell profile, a settings.json env map, or a parent
    #      process. This step is that reach, so a fleet roll fixes every box
    #      regardless of source.
    #      The fixer proves its own scanner on a planted control before
    #      accepting any "clean", backs every file up before editing it (never
    #      overwriting an existing backup), COMMENTS OUT offending profile lines
    #      behind a dated marker rather than deleting them, MERGE-removes only
    #      that one key from settings env maps with validation and
    #      restore-on-failure, and refuses to touch the Machine scope or an
    #      AllUsers profile - reporting the exact elevated command instead. It
    #      takes effect in NEW shells and NEW sessions: nothing running is
    #      signalled, restarted, or interrupted.
    #      NEVER fatal to setup: rc 1 (a source needing one manual command) and
    #      rc 2 (a tooling failure, backups restored) are both reported honestly
    #      in the completion report and the install still completes.
    $ultracodeReport = ''
    $ultracodeStatus = 'SKIPPED - Fix-UltracodeOverride.ps1 not found'
    $fixUltracode = Join-Path $Win 'Fix-UltracodeOverride.ps1'
    if (Test-Path $fixUltracode) {
        try {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $ultracodeReport = (& $fixUltracode | Out-String)
            $ultracodeRc = $LASTEXITCODE
            $ErrorActionPreference = $prevEap
            $ultracodeStatus = "UNKNOWN (the fixer produced no status line, rc=$ultracodeRc)"
            $lines = @($ultracodeReport -split "`r?`n")
            for ($i = 0; $i -lt $lines.Count - 1; $i++) {
                if ($lines[$i].Trim() -eq 'ULTRACODE OVERRIDE:') { $ultracodeStatus = $lines[$i + 1].Trim(); break }
            }
            if ($ultracodeRc -notin @(0, 1, 2)) {
                $ultracodeStatus = "UNKNOWN (the fixer exited $ultracodeRc, which it does not define)"
            }
        } catch {
            $ErrorActionPreference = 'Stop'
            $ultracodeStatus = "NOT RUN - the fixer could not be started: $($_.Exception.Message)"
        }
        Write-Log "Ultracode override: $ultracodeStatus"
    }

    # 11. Smoke tests. This MUST execute the launcher itself (not just check the
    #     file exists and call the router directly) — that is what catches a
    #     launcher that does not parse under PowerShell 5.1.
    Write-Log 'Running smoke tests...'
    $env:NINEROUTER_BASE = $Base
    $env:NINEROUTER_TOKEN = & (Join-Path $Win 'Protect-LocalState.ps1') -Action get-token
    $env:OLLAMA_PLAN = $creds['OLLAMA_PLAN']
    $env:OPENROUTER_PROBE_ROUTE = if ($report.openrouterProbe) { $report.openrouterProbe } else { '' }
    & $NodeBin (Join-Path $Common 'test-nine-router.mjs')
    if ($LASTEXITCODE -ne 0) { Write-Blocker 'Smoke tests failed' }
    Remove-Item Env:NINEROUTER_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:OPENROUTER_PROBE_ROUTE -ErrorAction SilentlyContinue

    # Launcher end-to-end: a real routed request through claude-nine. Use the
    # absolute installed path, not a bare PATH lookup — a fresh shell's PATH
    # may not have refreshed yet even though Install-ClaudeNine.ps1 just
    # updated the User PATH (the equivalent of the macOS F7 fix).
    Write-Log 'Executing claude-nine end-to-end...'
    $claudeNineCmd = "$env:LOCALAPPDATA\BlackCEO\999\bin\claude-nine.cmd"
    if (-not (Test-Path $claudeNineCmd)) { Write-Blocker "claude-nine launcher not found at $claudeNineCmd after install." }
    $nineProbe = & $claudeNineCmd -p "Reply with exactly: routing works" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Blocker "claude-nine end-to-end probe failed: $nineProbe"
    }
    if (($nineProbe | Out-String) -notmatch 'routing works') {
        Write-Blocker "claude-nine returned an unexpected response: $nineProbe"
    }
    Write-Log 'claude-nine end-to-end: OK'

    # 11b. Bundled personal skills: link every manifest skill into the real
    #      Claude config root (idempotent; re-runs pick up skills added after
    #      the first install), then verify each one by an actual SKILL.md check.
    $skillRoot = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
    Link-BundledSkills $skillRoot
    $skillMissing = @()
    foreach ($s in (Get-BundledSkills)) {
        if (-not (Test-Path (Join-Path $skillRoot "skills\$s\SKILL.md"))) { $skillMissing += $s }
    }
    $skillVisible = if ($skillMissing.Count -eq 0) { 'OK' } else { "MISSING: $($skillMissing -join ', ')" }

    # 12. Completion report. Provider lines derive from the live post-config probes
    #     (report.verified) - never hardcoded "OK". The dashboard link is surfaced
    #     so the client can favorite it.
    $reserved = if ($creds['OLLAMA_PLAN'] -eq 'pro') { 1 } else { 0 }
    $vFable = if ($report.verified.fable) { $report.verified.fable } else { 'unknown' }
    $vAgnes = if ($report.verified.agnes) { $report.verified.agnes } else { 'unknown' }
    $vOpus = if ($report.verified.opus) { $report.verified.opus } else { 'unknown' }
    $vSonnet = if ($report.verified.sonnet) { $report.verified.sonnet } else { 'unknown' }
    $vHaiku = if ($report.verified.haiku) { $report.verified.haiku } else { 'unknown' }
    $vOpenRouter = if ($report.verified.openrouter) { $report.verified.openrouter } else { 'unknown' }

    # Route strings come from the config report; fall back to the new defaults
    # only if the report lacks them (it never should after a successful configure run).
    $r = $report.resolvedRoutes
    $rFable   = if ($r.fable)   { $r.fable }   else { 'ds/deepseek-v4-flash(max)' }
    $rOpus    = if ($r.opus)    { $r.opus }    else { 'ds-max/deepseek-v4-pro(max)' }
    $rSonnet  = if ($r.sonnet)  { $r.sonnet }  else { 'ds/deepseek-v4-flash(max)' }
    $rHaiku   = if ($r.haiku)   { $r.haiku }   else { 'ds-light/deepseek-v4-flash' }
    $rVision  = if ($r.vision)  { $r.vision }  else { 'ollama/kimi-k2.6' }
    $dashUrl  = if ($report.dashboardUrl) { $report.dashboardUrl } else { "http://127.0.0.1:$Port" }

    # Thinking verification from the config report: one line per verified lane
    # ("verified max" / "verified off"), with downgrades surfaced as warnings.
    $thinkingLines = @()
    $labelMap = @{ opus = 'DS Max thinking'; sonnet = 'DS Flash thinking'; fable = 'DS Flash (subagent) thinking'; haiku = 'DS Light thinking' }
    foreach ($key in $labelMap.Keys) {
        if (-not $report.thinkingVerified) { break }
        $status = $report.thinkingVerified.$key
        if (-not $status) { continue }
        if ($status -eq 'ok-thinking')      { $thinkingLines += "$($labelMap[$key]): verified max" }
        elseif ($status -eq 'ok-no-thinking') { $thinkingLines += "$($labelMap[$key]): verified off" }
        else                                { $thinkingLines += "WARNING: $($labelMap[$key]) could not be verified ($status)" }
    }

    $passwordNote = ''
    if ($report.mustChangePassword -eq $true) {
        $passwordNote = "Dashboard: the password is the default ``123456``; change it yourself in the dashboard when you are ready.`n"
    }
    @"

999 SETUP: COMPLETE

Operating system: Windows
Claude Code: OK
Personal skills (normal claude and claude-nine share one config root): $skillVisible
claude-nine launcher: OK
Normal claude routing: UNCHANGED
Node.js: OK
npm: OK
9Router: OK - $Base ($nineMode, v$nineVerStr)
DeepSeek Direct: $vFable
Ollama Cloud: OK
Agnes AI: $vAgnes
OpenRouter (optional): $vOpenRouter

Claude routes:
Fable/Subagents -> $rFable
Opus -> $rOpus
Sonnet -> $rSonnet
Haiku -> $rHaiku (thinking off)
Vision -> $rVision

Fallback:
Haiku -> $rHaiku, then agnes/agnes-2.5-flash: configured
$(if ($thinkingLines.Count) { $thinkingLines -join "`n" })
$passwordNote
Ollama plan: $($creds['OLLAMA_PLAN'])
Ollama Claude/9Router concurrency budget: $concurrency
Reserved for OpenClaw: $reserved

PDF auto-switch: DISABLED - not verified end-to-end
Audio auto-switch: DISABLED - Gemma 4 31B has no audio input

Agent Teams (experimental; applies to NEW Claude Code sessions only): $agentTeamsStatus
$agentTeamsReport

Ultracode/effort override (applies to NEW shells and NEW sessions only): $ultracodeStatus
$ultracodeReport

Dashboard: $dashUrl - open this in your browser to manage providers and models. The password is the default ``123456``; change it yourself in the dashboard when you are ready.

Launch routed Claude Code with: claude-nine

No API keys or passwords were printed.
"@ | Write-Host
    exit 0
} catch {
    Write-Error "setup-windows failed: $($_.Exception.Message)"
    exit 1
}
