# Enable-AgentTeams.ps1 - turn on Claude Code Agent Teams for FUTURE Claude Code
# sessions on native Windows. CONFIGURATION ONLY.
#
# The macOS twin is scripts/macos/enable-agent-teams.sh. Same procedure, same
# safety envelope, Windows-shaped:
#   P1  read-only Claude Code version check (floor 2.1.178). Never runs the
#       Claude Code self-update command, never reinstalls Claude Code - the
#       operator decides when to update, never this script.
#   P2  read-only inspection of running Claude work. Observation only.
#   P3  timestamped backup of %USERPROFILE%\.claude\settings.json; an existing
#       backup is NEVER overwritten.
#   P4  MERGE "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" into the existing
#       "env" object - add or update ONLY that key.
#   P5  teammateMode: NOT WRITTEN ON WINDOWS. Recorded as
#       DEFERRED-UNDETERMINED. "tmux" is a Unix assumption; there is no tmux on
#       native Windows and no display mode has been probed there. The skill's
#       runtime probe (spec-protocol references/agent-team.md) remains the ONLY
#       authority on whether teams function on this platform. A Mac-only step is
#       never silently shipped into a cross-platform repository.
#   P6, P7, P8, P10  the tmux phases: NOT APPLICABLE on native Windows. No
#       package manager is installed here, ever - not Homebrew, not a Windows
#       analogue.
#   P9  validate the settings JSON, the configured key, and EVERY pre-existing
#       leaf value; on ANY failure RESTORE THE BACKUP - never leave a broken
#       settings.json.
#   P11 no Agent Team, teammate, pane, or Claude session is created.
#   P12 the current session is never restarted, reloaded, or signalled.
#   P13 final report, in the procedure's format, with the Windows lines named
#       for what they are.
#   P14 print the next command - told, never run.
#
# KNOWN WINDOWS GAP - surfaced, never hidden: SendMessage (teammate-to-teammate
# messaging, together with ListAgents, floor 2.1.224) is macOS/Linux only. Even
# with the experimental flag set, peer messaging between teammates is not
# available on native Windows. The report says so in plain words.
#
# THE SAFETY ENVELOPE (binding on every line of this script):
#   NEVER stop, restart, signal, interrupt, or "clean up" any running Claude Code
#   session, workflow, subagent, terminal, background task, build, or test - even
#   if it looks stale. Never spawn a team as a side effect of configuring. Never
#   restart the current session. Configuration is for NEW sessions. Any step that
#   would disturb running work is DEFERRED and reported with the reason.
#   Protect currently running work over completing this configuration.
#
#   This script therefore contains NO process-termination command of any kind, no
#   signal delivery, no Claude Code self-update or reinstall, and no launch of a
#   teammate-mode session. The only commands that mutate anything are: writing
#   the settings file and copying backups.
#
# Idempotent and re-run safe: a second run adds nothing and reports the same
# READY state.
#
# Exit codes:
#   0  configuration complete (read the READY line for what is usable)
#   1  version-blocked - nothing was modified
#   2  tooling failure - the settings backup was restored where applicable
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SettingsPath = (Join-Path $env:USERPROFILE '.claude\settings.json'),
    [string]$ClaudeBin = '',
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

$TeamsMinVersion = '2.1.178'      # Agent Teams floor (the procedure's requirement)
$MailboxMinVersion = '2.1.224'    # ListAgents / SendMessage floor (macOS/Linux only)
$FlagKey = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
$FlagValue = '1'
$NineProfile = Join-Path $env:USERPROFILE '.claude-nine\settings.json'

# Report fields (procedure Phase 13). NOT CHECKED, never a bare negative: a phase
# that never ran must not report a finding it did not make.
$RVersion = 'UNKNOWN'
$RVersionReq = 'FAIL'
$RMailbox = 'UNKNOWN'
$RTeams = 'FAILED'
$RFlag = 'NOT CONFIRMED'
$RJson = 'NOT VALIDATED'
$RBackup = 'N/A'
$RExisting = 'PRESERVED (nothing was modified)'
$RActive = 'UNKNOWN'
$RReady = 'NO'
$RNine = 'NOT PRESENT - NOT CREATED (this installer does not own a claude-nine profile file)'
$Deferred = @()

function Write-Log([string]$m) { Write-Host "[Enable-AgentTeams] $m" }

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

function Get-ParsedVersion([string]$text) {
    if (-not $text) { return $null }
    $m = [regex]::Match($text, '(\d+)\.(\d+)\.(\d+)')
    if (-not $m.Success) { return $null }
    return $m.Value
}

function Test-VersionAtLeast([string]$have, [string]$min) {
    $h = $have -split '\.'
    $n = $min -split '\.'
    for ($i = 0; $i -lt 3; $i++) {
        $hv = 0; $nv = 0
        if ($i -lt $h.Count) { [void][int]::TryParse($h[$i], [ref]$hv) }
        if ($i -lt $n.Count) { [void][int]::TryParse($n[$i], [ref]$nv) }
        if ($hv -gt $nv) { return $true }
        if ($hv -lt $nv) { return $false }
    }
    return $true
}

# NEVER overwrites an existing backup: a name collision takes the next free -N
# suffix. AGENT_TEAMS_BACKUP_STAMP is a test-only seam so -SelfTest can force a
# deterministic collision; production runs use the wall clock.
function New-TimestampedBackup([string]$path) {
    $stamp = if ($env:AGENT_TEAMS_BACKUP_STAMP) { $env:AGENT_TEAMS_BACKUP_STAMP } else { Get-Date -Format 'yyyyMMdd-HHmmss' }
    $b = "$path.backup.$stamp"
    $n = 1
    while (Test-Path -LiteralPath $b) {
        $b = "$path.backup.$stamp-$n"
        $n++
    }
    Copy-Item -LiteralPath $path -Destination $b
    return $b
}

# Reads a settings file into a PSCustomObject. An unreadable or unparseable file
# is a named failure - NEVER treated as "empty" and NEVER overwritten.
function Read-SettingsObject([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return [PSCustomObject]@{} }
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if ($null -eq $raw) { $raw = '' }
    $raw = $raw -replace '^\uFEFF', ''
    if ([string]::IsNullOrWhiteSpace($raw)) { return [PSCustomObject]@{} }
    $obj = $raw | ConvertFrom-Json
    if ($null -eq $obj -or -not ($obj -is [System.Management.Automation.PSCustomObject])) {
        throw 'NOT_A_JSON_OBJECT'
    }
    return $obj
}

# Atomic, UTF-8 WITHOUT a byte-order mark. A BOM in settings.json breaks strict
# JSON readers, so Set-Content (which writes one on Windows PowerShell 5.1) is
# deliberately not used here.
function Write-JsonAtomic($obj, [string]$path) {
    $json = $obj | ConvertTo-Json -Depth 100
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $tmp = "$path.999tmp.$PID"
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tmp, ($json + "`r`n"), $enc)
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

# Flattens a parsed JSON document to path/value leaves so P9 can prove that every
# pre-existing setting - model aliases, routing, env vars, permissions, hooks,
# MCP servers, provider configuration - survived the merge untouched.
function Get-JsonLeaves($node, [string]$prefix, $acc) {
    if ($null -eq $node) {
        [void]$acc.Add(@{ Path = $prefix; Value = 'null' })
        return
    }
    if ($node -is [string] -or $node -is [bool] -or $node -is [int] -or $node -is [long] -or
        $node -is [double] -or $node -is [decimal] -or $node -is [System.Int64]) {
        [void]$acc.Add(@{ Path = $prefix; Value = ($node.GetType().Name + ':' + $node.ToString()) })
        return
    }
    if ($node -is [System.Management.Automation.PSCustomObject]) {
        $props = @($node.PSObject.Properties)
        if ($props.Count -eq 0) { [void]$acc.Add(@{ Path = $prefix; Value = '{}' }); return }
        foreach ($p in $props) {
            $child = if ($prefix) { "$prefix.$($p.Name)" } else { $p.Name }
            Get-JsonLeaves -node $p.Value -prefix $child -acc $acc
        }
        return
    }
    if ($node -is [System.Collections.IDictionary]) {
        $keys = @($node.Keys)
        if ($keys.Count -eq 0) { [void]$acc.Add(@{ Path = $prefix; Value = '{}' }); return }
        foreach ($k in $keys) {
            $child = if ($prefix) { "$prefix.$k" } else { [string]$k }
            Get-JsonLeaves -node $node[$k] -prefix $child -acc $acc
        }
        return
    }
    if ($node -is [System.Collections.IEnumerable]) {
        $items = @($node)
        [void]$acc.Add(@{ Path = "$prefix#len"; Value = ([string]$items.Count) })
        for ($i = 0; $i -lt $items.Count; $i++) {
            Get-JsonLeaves -node $items[$i] -prefix "$prefix[$i]" -acc $acc
        }
        return
    }
    [void]$acc.Add(@{ Path = $prefix; Value = $node.ToString() })
}

function Write-EnablementReport {
    @"

CLAUDE CODE VERSION:
$script:RVersion

AGENT TEAMS VERSION REQUIREMENT:
$script:RVersionReq (floor $script:TeamsMinVersion)

LISTAGENTS / SENDMESSAGE VERSION REQUIREMENT:
$script:RMailbox (floor $script:MailboxMinVersion)

LATEST AVAILABLE VERSION:
NOT CHECKED (no automatic update is ever performed by this step)

AGENT TEAMS:
$script:RTeams

EXPERIMENTAL FLAG:
$script:FlagKey=$script:FlagValue
$script:RFlag

TEAMMATE MODE:
DEFERRED-UNDETERMINED (no tmux on native Windows; display mode unprobed)

TEAMMATE MESSAGING (SendMessage / ListAgents):
UNAVAILABLE ON WINDOWS - SendMessage is macOS/Linux only. This is a real
platform gap, not a configuration error: teammates cannot message each other
here. The skill's runtime probe is the authority on what actually works.

TMUX:
NOT APPLICABLE ON NATIVE WINDOWS

TMUX PATH:
N/A

CLAUDE SETTINGS JSON:
$script:RJson

CLAUDE SETTINGS FILE:
$script:SettingsPath

CLAUDE SETTINGS BACKUP:
$script:RBackup

TMUX CONFIG:
NOT APPLICABLE ON NATIVE WINDOWS

TMUX CONFIG BACKUP:
N/A

EXISTING CLAUDE SETTINGS:
$script:RExisting

CLAUDE-NINE PROFILE:
$script:RNine

ACTIVE CLAUDE WORK DETECTED:
$script:RActive

ACTIVE CLAUDE WORK INTERRUPTED:
NO

ACTIVE WORKFLOWS INTERRUPTED:
NO

ACTIVE SUBAGENTS INTERRUPTED:
NO

ACTIVE TERMINALS CLOSED:
NO

CURRENT CLAUDE SESSION RESTARTED:
NO

AGENT TEAM SPAWNED:
NO

READY FOR A NEW AGENT-TEAM SESSION:
$script:RReady
"@ | Write-Output
}

# --------------------------------------------------------------------------
# -SelfTest - exercises the behaviours the safety envelope depends on, in a
# sandbox directory. Touches nothing outside it, installs nothing, and never
# spawns or signals anything.
# --------------------------------------------------------------------------

function Invoke-SelfTest {
    $box = Join-Path ([System.IO.Path]::GetTempPath()) ("enable-agent-teams-selftest-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $box | Out-Null
    $stub = Join-Path $box 'claude-stub.cmd'
    Set-Content -LiteralPath $stub -Value "@echo off`r`necho 2.1.227 (Claude Code)" -Encoding Ascii
    $self = $PSCommandPath
    $fails = 0

    function Invoke-Case([string]$settings, [hashtable]$envVars) {
        $saved = @{}
        foreach ($k in $envVars.Keys) {
            $saved[$k] = [System.Environment]::GetEnvironmentVariable($k, 'Process')
            [System.Environment]::SetEnvironmentVariable($k, $envVars[$k], 'Process')
        }
        try {
            & $self -SettingsPath $settings -ClaudeBin $stub | Out-Null
            return $LASTEXITCODE
        } finally {
            foreach ($k in $envVars.Keys) {
                [System.Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process')
            }
        }
    }

    # 1. MERGE INTO AN EXISTING env OBJECT - nothing else may change.
    $c1 = Join-Path $box 'case1'; New-Item -ItemType Directory -Force -Path $c1 | Out-Null
    $s1 = Join-Path $c1 'settings.json'
    Set-Content -LiteralPath $s1 -Encoding Ascii -Value @'
{
  "model": "opus[1m]",
  "env": { "EXISTING_VAR": "keep-me", "CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION": "1000" },
  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] },
  "hooks": { "Stop": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "true" } ] } ] }
}
'@
    $rc = Invoke-Case $s1 @{}
    $o1 = Get-Content -LiteralPath $s1 -Raw | ConvertFrom-Json
    if ($rc -eq 0 -and $o1.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -eq '1' -and
        $o1.env.EXISTING_VAR -eq 'keep-me' -and $o1.model -eq 'opus[1m]' -and
        $o1.permissions.allow[0] -eq 'Bash(ls:*)' -and
        $o1.hooks.Stop[0].hooks[0].command -eq 'true') {
        Write-Output 'PASS  1. merge into an existing env object (model, permissions, hooks, env vars preserved)'
    } else { Write-Output "FAIL  1. merge into an existing env object (exit $rc)"; $fails++ }

    # 2. CREATE FROM AN ABSENT FILE.
    $c2 = Join-Path $box 'case2'; New-Item -ItemType Directory -Force -Path $c2 | Out-Null
    $s2 = Join-Path $c2 'settings.json'
    $rc = Invoke-Case $s2 @{}
    if ($rc -eq 0 -and (Test-Path -LiteralPath $s2)) {
        $o2 = Get-Content -LiteralPath $s2 -Raw | ConvertFrom-Json
        if ($o2.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -eq '1') {
            Write-Output 'PASS  2. create a valid settings.json when none exists'
        } else { Write-Output 'FAIL  2. create a valid settings.json when none exists'; $fails++ }
    } else { Write-Output "FAIL  2. create a valid settings.json when none exists (exit $rc)"; $fails++ }

    # 3. NEVER OVERWRITE AN EXISTING BACKUP (deterministic collision via the stamp seam).
    $c3 = Join-Path $box 'case3'; New-Item -ItemType Directory -Force -Path $c3 | Out-Null
    $s3 = Join-Path $c3 'settings.json'
    Set-Content -LiteralPath $s3 -Encoding Ascii -Value '{ "env": { "SENTINEL": "three" } }'
    $stamp = '20260101-000000'
    $decoy = "$s3.backup.$stamp"
    Set-Content -LiteralPath $decoy -Encoding Ascii -Value 'DECOY-DO-NOT-TOUCH'
    $rc = Invoke-Case $s3 @{ AGENT_TEAMS_BACKUP_STAMP = $stamp }
    $decoyKept = ((Get-Content -LiteralPath $decoy -Raw).Trim() -eq 'DECOY-DO-NOT-TOUCH')
    if ($rc -eq 0 -and $decoyKept -and (Test-Path -LiteralPath "$decoy-1")) {
        Write-Output 'PASS  3. an existing backup is never overwritten (the next free name is used)'
    } else { Write-Output "FAIL  3. an existing backup is never overwritten (exit $rc)"; $fails++ }

    # 4. teammateMode IS NOT WRITTEN ON WINDOWS, and a rerun changes nothing.
    $c4 = Join-Path $box 'case4'; New-Item -ItemType Directory -Force -Path $c4 | Out-Null
    $s4 = Join-Path $c4 'settings.json'
    Set-Content -LiteralPath $s4 -Encoding Ascii -Value '{ "env": { "SENTINEL": "four" } }'
    $rc = Invoke-Case $s4 @{}
    $first = Get-Content -LiteralPath $s4 -Raw
    $rc2 = Invoke-Case $s4 @{}
    $second = Get-Content -LiteralPath $s4 -Raw
    $o4 = $second | ConvertFrom-Json
    $hasMode = ($o4.PSObject.Properties.Name -contains 'teammateMode')
    if ($rc -eq 0 -and $rc2 -eq 0 -and -not $hasMode -and $first -eq $second -and
        $o4.env.SENTINEL -eq 'four' -and $o4.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -eq '1') {
        Write-Output 'PASS  4. teammateMode stays DEFERRED-UNDETERMINED (never written) and reruns are byte-identical'
    } else { Write-Output "FAIL  4. teammateMode deferred / idempotent rerun (exit $rc/$rc2)"; $fails++ }

    # 5. VALIDATION FAILURE -> THE BACKUP IS RESTORED, byte for byte.
    $c5 = Join-Path $box 'case5'; New-Item -ItemType Directory -Force -Path $c5 | Out-Null
    $s5 = Join-Path $c5 'settings.json'
    Set-Content -LiteralPath $s5 -Encoding Ascii -Value '{ "env": { "SENTINEL": "five" }, "model": "sonnet" }'
    $original = Get-Content -LiteralPath $s5 -Raw
    $rc = Invoke-Case $s5 @{ AGENT_TEAMS_FORCE_VALIDATION_FAILURE = '1' }
    $after = Get-Content -LiteralPath $s5 -Raw
    if ($rc -eq 2 -and $original -eq $after) {
        Write-Output 'PASS  5. a failed validation restores the backup and reports INVALID (exit 2)'
    } else { Write-Output "FAIL  5. validation failure -> restore (exit $rc)"; $fails++ }

    if ($fails -eq 0) {
        Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
        exit 0
    }
    Write-Output "`nselftest artifacts kept for inspection: $box"
    exit 1
}

if ($SelfTest) { Invoke-SelfTest }

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

$backup = ''
try {
    # ---- P1. READ-ONLY VERSION CHECK -------------------------------------
    $bin = ''
    if ($ClaudeBin -and (Test-Path -LiteralPath $ClaudeBin)) {
        $bin = $ClaudeBin
    } else {
        $c = Get-Command claude -ErrorAction SilentlyContinue
        if ($c) { $bin = $c.Source }
    }
    if (-not $bin) {
        $RVersion = 'NOT FOUND (Get-Command claude resolved nothing, and no -ClaudeBin was given)'
        Write-Log 'Claude Code was not found. Nothing was inspected, backed up, or modified.'
        Write-Log 'AGENT TEAMS REQUIRE A NEWER CLAUDE CODE VERSION.'
        Write-EnablementReport
        exit 1
    }
    $verRaw = ''
    try {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $verRaw = (& $bin --version 2>&1 | Select-Object -First 1 | Out-String).Trim()
        $ErrorActionPreference = $prev
    } catch {
        $ErrorActionPreference = 'Stop'
        $verRaw = ''
    }
    $version = Get-ParsedVersion $verRaw
    if (-not $version) {
        $RVersion = "UNPARSEABLE ($verRaw)"
        Write-Log "Could not parse a version from: $verRaw"
        Write-Log 'Refusing to modify settings on an unproven version.'
        Write-EnablementReport
        exit 1
    }
    $RVersion = $version
    if (Test-VersionAtLeast $version $TeamsMinVersion) {
        $RVersionReq = 'PASS'
    } else {
        $RVersionReq = 'FAIL'
        Write-Log 'AGENT TEAMS REQUIRE A NEWER CLAUDE CODE VERSION.'
        Write-Log "installed: $version   required: $TeamsMinVersion or newer"
        Write-Log 'No settings were modified. Claude Code was NOT updated and NOT reinstalled - you decide when to update.'
        Write-EnablementReport
        exit 1
    }
    if (Test-VersionAtLeast $version $MailboxMinVersion) {
        $RMailbox = 'PASS (but see TEAMMATE MESSAGING below - SendMessage is macOS/Linux only)'
    } else {
        $RMailbox = "BELOW $MailboxMinVersion"
    }

    # ---- P2. INSPECT CURRENTLY RUNNING WORK (READ-ONLY) ------------------
    # OBSERVATION ONLY: nothing found here is ever signalled or touched.
    $procs = @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
        $RActive = "YES ($($procs.Count) processes named 'claude' observed; none touched)"
    } else {
        # A zero here is NOT proof of absence: Claude Code frequently runs as
        # node.exe on Windows, which this probe deliberately does not claim.
        $RActive = "UNKNOWN (no process named 'claude' was found; Claude Code often runs as node.exe on Windows, so this is not proof that nothing is running)"
    }
    Write-Log "Read-only inspection: $RActive"
    # Regardless of what was found: ASSUME ACTIVE WORK MUST BE PRESERVED.

    # ---- P3. BACK UP CLAUDE CODE SETTINGS --------------------------------
    $settingsDir = Split-Path -Parent $SettingsPath
    if ($settingsDir -and -not (Test-Path -LiteralPath $settingsDir)) {
        New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
    }
    $existed = Test-Path -LiteralPath $SettingsPath
    if ($existed) {
        $backup = New-TimestampedBackup $SettingsPath
        $RBackup = $backup
        Write-Log "settings backup: $backup"
    } else {
        $RBackup = 'N/A (no settings.json existed; a new one was created)'
        Write-Log "no settings.json at $SettingsPath - a new one will be created"
    }

    # ---- P4. MERGE THE EXPERIMENTAL FLAG ---------------------------------
    # P5 has no counterpart here: teammateMode is NOT written on Windows.
    $settings = $null
    try {
        $settings = Read-SettingsObject $SettingsPath
    } catch {
        Write-Log "settings.json could not be parsed: $($_.Exception.Message)"
        Write-Log 'Nothing was written. An unreadable settings file is never treated as empty and never overwritten.'
        $RJson = 'INVALID'
        $RExisting = 'PRESERVED (nothing was modified)'
        Write-EnablementReport
        exit 2
    }
    $hasEnv = ($settings.PSObject.Properties.Name -contains 'env')
    if (-not $hasEnv -or $null -eq $settings.env) {
        $settings | Add-Member -NotePropertyName 'env' -NotePropertyValue ([PSCustomObject]@{}) -Force
    }
    if (-not ($settings.env -is [System.Management.Automation.PSCustomObject])) {
        Write-Log 'The "env" key exists but is not a JSON object; nothing was written.'
        if ($backup) { Copy-Item -LiteralPath $backup -Destination $SettingsPath -Force; Write-Log "RESTORED the backup: $backup" }
        $RJson = 'INVALID'
        Write-EnablementReport
        exit 2
    }
    # MERGE: add or update ONLY this key. Nothing else is touched.
    $settings.env | Add-Member -NotePropertyName $FlagKey -NotePropertyValue $FlagValue -Force
    Write-JsonAtomic $settings $SettingsPath
    Write-Log "merged $FlagKey=`"$FlagValue`" into env"

    # ---- P5. TEAMMATE MODE: DEFERRED-UNDETERMINED ------------------------
    # tmux is a Unix assumption. No teammateMode value is written on native
    # Windows, and none is guessed. The skill's runtime probe decides.
    $Deferred += 'TEAMMATE MODE: DEFERRED-UNDETERMINED. "tmux" is a Unix assumption and no display mode has been probed on native Windows, so no teammateMode value was written. The spec-protocol runtime probe (references/agent-team.md) is the authority on whether Agent Teams function here at all.'
    $Deferred += 'TEAMMATE MESSAGING: SendMessage (and teammate-to-teammate coordination with it) is macOS/Linux only. On Windows this is a real platform gap, reported rather than worked around.'

    # ---- P9. VALIDATE SETTINGS.JSON --------------------------------------
    $valid = $true
    $reason = ''
    try {
        $cur = Read-SettingsObject $SettingsPath
        if ($cur.env.$FlagKey -ne $FlagValue) { $valid = $false; $reason = 'FLAG_NOT_CONFIRMED' }
        if ($valid -and $backup) {
            $old = Read-SettingsObject $backup
            $oldLeaves = New-Object System.Collections.ArrayList
            $newLeaves = New-Object System.Collections.ArrayList
            Get-JsonLeaves -node $old -prefix '' -acc $oldLeaves
            Get-JsonLeaves -node $cur -prefix '' -acc $newLeaves
            $newMap = New-Object 'System.Collections.Generic.Dictionary[System.String,System.String]'
            foreach ($leaf in $newLeaves) { $newMap[$leaf.Path] = [string]$leaf.Value }
            $allowed = @("env.$FlagKey")
            $lost = @()
            foreach ($leaf in $oldLeaves) {
                if ($allowed -contains $leaf.Path) { continue }
                if (-not $newMap.ContainsKey($leaf.Path) -or $newMap[$leaf.Path] -ne [string]$leaf.Value) {
                    $lost += $leaf.Path
                }
            }
            if ($lost.Count -gt 0) {
                $valid = $false
                $reason = "PRE_EXISTING_SETTINGS_LOST: " + (($lost | Select-Object -First 10) -join ', ')
            }
        }
    } catch {
        $valid = $false
        $reason = "INVALID_JSON: $($_.Exception.Message)"
    }
    # Test-only seam: -SelfTest uses it to prove the restore path really restores.
    if ($env:AGENT_TEAMS_FORCE_VALIDATION_FAILURE) {
        $valid = $false
        $reason = 'FORCED_VALIDATION_FAILURE (selftest seam)'
    }

    if (-not $valid) {
        Write-Log "settings validation FAILED: $reason"
        $RJson = 'INVALID'
        $RTeams = 'FAILED'
        $RFlag = 'NOT CONFIRMED'
        if ($reason -like 'PRE_EXISTING_SETTINGS_LOST*') { $RExisting = "PROBLEM FOUND ($reason)" }
        if ($backup -and (Test-Path -LiteralPath $backup)) {
            Copy-Item -LiteralPath $backup -Destination $SettingsPath -Force
            Write-Log "RESTORED the backup: $backup -> $SettingsPath"
            $RExisting = 'PRESERVED (restored from backup - no change landed)'
        } else {
            Write-Log 'no backup existed (the file was created by this run); the new file was left in place for inspection'
        }
        Write-EnablementReport
        Write-Output ''
        Write-Output 'Agent Teams were NOT enabled. Your settings file was restored from the backup above.'
        Write-Output 'Nothing that was running was touched.'
        exit 2
    }

    $RJson = 'VALID'
    $RFlag = 'CONFIRMED'
    $RTeams = 'ENABLED'
    $RExisting = 'PRESERVED'
    $RReady = 'YES (the experimental flag is set for NEW sessions; teammate display mode and peer messaging are the platform gaps named above)'

    # ---- The claude-nine profile -----------------------------------------
    # The skill's own consent flow owns this file: 9Router Agent Teams
    # compatibility is UNDETERMINED until its runtime probe passes, so a
    # hand-tuned claude-nine profile is never mutated by this installer.
    if (Test-Path -LiteralPath $NineProfile) {
        $RNine = "EXISTING - NOT MODIFIED ($NineProfile; the skill's consent flow owns it, 9Router Agent Teams compatibility UNDETERMINED)"
    }

    # ---- P11 / P12 --------------------------------------------------------
    # Nothing above spawned a teammate, created a team, started another Claude
    # Code instance, or restarted this session.

    Write-EnablementReport

    # ---- P14. THE NEXT COMMAND - TOLD, NEVER RUN -------------------------
    Write-Output ''
    Write-Output 'WHEN YOU ARE READY, open a SEPARATE NEW terminal window and run:'
    Write-Output ''
    Write-Output '    claude'
    Write-Output ''
    Write-Output 'This command was NOT run for you. The setting applies to NEW Claude Code'
    Write-Output 'sessions only; anything running right now keeps running exactly as it is.'
    Write-Output 'No --teammate-mode flag is suggested on Windows: the display mode is'
    Write-Output 'DEFERRED-UNDETERMINED and is decided by the skill probe, never guessed here.'
    if ($Deferred.Count -gt 0) {
        Write-Output ''
        Write-Output 'DEFERRED (reported, not performed - running work comes first):'
        foreach ($d in $Deferred) { Write-Output "- $d" }
    }
    exit 0
} catch {
    Write-Log "Enable-AgentTeams failed: $($_.Exception.Message)"
    if ($backup -and (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $backup -Destination $SettingsPath -Force
        Write-Log "RESTORED the backup: $backup -> $SettingsPath"
    }
    Write-Log 'Nothing that was running was touched.'
    exit 2
}
