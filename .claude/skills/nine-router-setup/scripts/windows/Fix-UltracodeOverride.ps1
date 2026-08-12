# Fix-UltracodeOverride.ps1 - find and clear every source that sets
# CLAUDE_CODE_EFFORT_LEVEL on this Windows machine, so the in-session /effort
# picker (including `ultracode`) stops snapping back. CONFIGURATION ONLY.
#
# THE BUG. Claude Code treats CLAUDE_CODE_EFFORT_LEVEL in the environment as an
# OVERRIDE of the in-session picker. With it set to anything other than xhigh,
# selecting ultracode returns
#   "CLAUDE_CODE_EFFORT_LEVEL=<value> overrides effort this session - clear it
#    and ultracode takes over"
# and the selection is not applied. The shipped binary's save path also accepts
# only low|medium|high|xhigh, so "max" is not persistable at all.
#
# The launchers were fixed in v1.2.0 (they export it only under
# CLAUDE_NINE_FORCE_EFFORT). That fix cannot reach a box where the variable is
# set somewhere ELSE - a User or Machine environment variable, a PowerShell
# profile, a settings.json env map, or a parent process. This script is that
# reach.
#
# The macOS twin is scripts/macos/fix-ultracode-override.sh. Same phases, same
# safety envelope, Windows-shaped:
#   P0  prove the scanner on a planted known-good control BEFORE accepting any
#       "clean". A detector that cannot find a positive has not proved a
#       negative. On a failed control this run DEGRADES TO DETECT-ONLY and
#       edits nothing.
#   P1  DETECT every source and name each one: the current process
#       environment, the User environment scope, the Machine environment scope,
#       the four PowerShell profile files, and the settings.json env maps.
#   P2  read-only inspection of running Claude work. Observation only.
#   P3  timestamped backup of every file about to be edited; an existing backup
#       is NEVER overwritten, and the path is printed.
#   P4  PowerShell profiles: COMMENT OUT the offending line behind a dated
#       marker. Never delete it. A rerun never double-comments.
#   P5  User environment scope: cleared with
#       [Environment]::SetEnvironmentVariable(...,$null,'User'), then re-read
#       from the registry to prove it.
#   P6  settings.json env maps: MERGE-remove ONLY this key, validate the result
#       including every pre-existing leaf value, and RESTORE THE BACKUP on any
#       failure - a broken settings.json is never left behind.
#   P7  VERIFY by re-reading the registry and the files on disk, never from
#       this process's stale environment.
#   P8  report every source: state before, action taken, state after.
#
#   No launchd equivalent exists on Windows; the launchd phase is NOT
#   APPLICABLE here and is reported as such rather than silently dropped.
#
# SOURCES THIS SCRIPT WILL NOT EDIT AUTOMATICALLY (reported with the exact
# manual command instead of guessed at):
#   - the CURRENT process environment. A child process cannot alter its
#     parent's environment; clearing it in this shell is the operator's to run.
#   - the MACHINE environment scope. It is written by administrators and it
#     affects every account on the box. Never elevated to, never auto-changed.
#   - the AllUsers PowerShell profiles, for the same reason.
#   - any line mentioning the variable in a form this script does not
#     positively recognise. Never guess at a client's profile.
#
# THE SAFETY ENVELOPE (binding on every line of this script):
#   NEVER stop, restart, signal, interrupt, or "clean up" any running Claude
#   Code session, workflow, subagent, terminal, background task, build, or test
#   - even if it looks stale. Never restart the current session. This change is
#   for NEW shells and NEW sessions. Anything running right now keeps the
#   effort level it started with and keeps running exactly as it is.
#
#   This script therefore contains NO process-termination command of any kind,
#   no signal delivery, no service restart, and no profile reload. The only
#   commands that mutate anything are: writing a PowerShell profile, writing a
#   settings file, copying backups, and clearing the User environment scope.
#
# Never prints a secret. Settings files are read for THIS ONE KEY's name and
# value only - never dumped, and no other value is ever printed. Profile files
# are reported by line NUMBER and classification, never by line content.
#
# Idempotent and re-run safe: a second run finds nothing live, writes nothing,
# creates no backup, and says so.
#
# TESTING STATUS: UNDETERMINED - NOT EXECUTED. No PowerShell exists on the
# machine this was authored on (`pwsh` and `powershell` both returned 127
# against a working control in the same shell). It is written to this
# repository's existing PowerShell conventions and reviewed line by line, but
# it has NOT been run. Its macOS twin is fully self-tested; this one is not.
#
# Usage:
#   Fix-UltracodeOverride.ps1 [-DryRun] [-SettingsPath PATH]
#   Fix-UltracodeOverride.ps1 -SelfTest
#
# Exit codes:
#   0  complete - no source remains that would override a NEW session
#   1  manual action required - a source this script will not touch
#      automatically is still active; the exact command is in the report
#   2  tooling failure - backups were restored where applicable
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SettingsPath = '',
    [switch]$DryRun,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

$Var = 'CLAUDE_CODE_EFFORT_LEVEL'
$MarkerDate = if ($env:FIX_ULTRACODE_DATE) { $env:FIX_ULTRACODE_DATE } else { Get-Date -Format 'yyyy-MM-dd' }
$MarkerTag = "999-setup: disabled $Var"

# Report fields. NOT CHECKED, never a bare negative: a phase that never ran must
# not report a finding it did not make.
$RScanner = 'NOT PROVEN'
$RProcessEnv = 'NOT CHECKED'
$RUserScope = 'NOT CHECKED'
$RMachineScope = 'NOT CHECKED'
$RProfiles = @()
$RSettings = @()
$RBackups = @()
$RActive = 'UNKNOWN'
$Manual = @()

$FoundAny = $false
$FixedAny = $false
$ManualRequired = $false
$ToolingFailed = $false
$ScannerOk = $true

function Write-Log([string]$m) { Write-Host "[Fix-UltracodeOverride] $m" }

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

# NEVER overwrites an existing backup: a name collision takes the next free -N
# suffix. FIX_ULTRACODE_BACKUP_STAMP is a test-only seam so -SelfTest can force
# a deterministic collision; production runs use the wall clock.
# Returns $null (having written nothing) when the source is missing or the copy
# fails - a caller must never edit a file believing it has a backup it does not.
function New-TimestampedBackup([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $stamp = if ($env:FIX_ULTRACODE_BACKUP_STAMP) { $env:FIX_ULTRACODE_BACKUP_STAMP } else { Get-Date -Format 'yyyyMMdd-HHmmss' }
    $b = "$path.backup.$stamp"
    $n = 1
    while (Test-Path -LiteralPath $b) {
        $b = "$path.backup.$stamp-$n"
        $n++
    }
    try {
        Copy-Item -LiteralPath $path -Destination $b -ErrorAction Stop
    } catch {
        return $null
    }
    if (-not (Test-Path -LiteralPath $b)) { return $null }
    return $b
}

# A restore that can itself fail is reported, never assumed.
function Restore-Backup([string]$backup, [string]$target) {
    try {
        Copy-Item -LiteralPath $backup -Destination $target -Force -ErrorAction Stop
        Write-Log "RESTORED the backup: $backup -> $target"
        return $true
    } catch {
        Write-Log "WARNING: could not restore $backup -> $target. The backup file is still there; copy it back yourself."
        return $false
    }
}

# Atomic, UTF-8 WITHOUT a byte-order mark. A BOM in settings.json breaks strict
# JSON readers, so Set-Content (which writes one on Windows PowerShell 5.1) is
# deliberately not used here.
function Write-TextAtomic([string]$text, [string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $tmp = "$path.999tmp.$PID"
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tmp, $text, $enc)
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

# --------------------------------------------------------------------------
# The profile scanner/rewriter. Classifies every LIVE (non-comment) line that
# mentions the variable. Line CONTENT is never returned or printed - line
# number and classification only.
#
# Classes:
#   Assign     VAR=... / $env:VAR = ... / Set-Item Env:VAR ...
#              / [Environment]::SetEnvironmentVariable('VAR',...)
#   Remove     Remove-Item Env:VAR  /  SetEnvironmentVariable('VAR', $null,...)
#              - a FIX, not a fault. Never commented out.
#   Other      mentions it in a form this script does not recognise. Reported,
#              never edited.
# --------------------------------------------------------------------------
function Get-VarLineClass([string]$line, [string]$v) {
    $e = [regex]::Escape($v)
    # A removal must be tested FIRST: `SetEnvironmentVariable('VAR', $null, ...)`
    # also matches the assignment shape, and commenting it out would re-break
    # the machine.
    if ($line -match "Remove-Item\s+(?:-LiteralPath\s+|-Path\s+)?['`"]?Env:\\?$e\b" -or
        $line -match "SetEnvironmentVariable\s*\(\s*['`"]$e['`"]\s*,\s*\`$null") {
        return 'Remove'
    }
    # Deliberately NOT matched as an assignment: a plain PowerShell variable
    # (`$CLAUDE_CODE_EFFORT_LEVEL = ...`) and a `set VAR=` line. Neither sets a
    # process environment variable that Claude Code would read, and commenting
    # one out would be editing the wrong line. They fall through to 'Other',
    # which is reported and never touched.
    if ($line -match "^\s*\`$env:$e\s*=" -or
        $line -match "Set-Item\s+(?:-Path\s+)?['`"]?Env:\\?$e\b" -or
        $line -match "New-Item\s+.*['`"]?Env:\\?$e\b" -or
        $line -match "SetEnvironmentVariable\s*\(\s*['`"]$e['`"]" -or
        $line -match "^\s*setx\s+['`"]?$e['`"]?\s") {
        return 'Assign'
    }
    if ($line -match "\b$e\b") { return 'Other' }
    return $null
}

# Returns a hashtable: Status = Absent|Unreadable|Scanned,
#                      Assign = @(line numbers), Removes = n, Other = @(line numbers),
#                      Disabled = n
function Read-ProfileScan([string]$path, [string]$v) {
    $res = @{ Status = 'Scanned'; Assign = @(); Removes = 0; Other = @(); Disabled = 0; Lines = @() }
    if (-not (Test-Path -LiteralPath $path)) { $res.Status = 'Absent'; return $res }
    try {
        $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8 -ErrorAction Stop
    } catch {
        # An unreadable file is NEVER reported as clean.
        $res.Status = 'Unreadable'
        return $res
    }
    if ($null -eq $raw) { $raw = '' }
    $lines = $raw -split "`r?`n"
    $res.Lines = $lines
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $l = $lines[$i]
        if ($l -match '^\s*#') {
            $stripped = $l -replace '^\s*#+\s?', ''
            if ((Get-VarLineClass $stripped $v) -eq 'Assign') { $res.Disabled++ }
            continue   # a comment sets nothing, and is never re-commented
        }
        switch (Get-VarLineClass $l $v) {
            'Assign' { $res.Assign += ($i + 1) }
            'Remove' { $res.Removes++ }
            'Other'  { $res.Other += ($i + 1) }
        }
    }
    return $res
}

# Comments out every Assign line behind a dated marker. The original text is
# preserved verbatim under a single leading '#', so restoring it is deleting one
# character.
function Set-ProfileDisabled($scan, [string]$path, [string]$marker) {
    $out = New-Object System.Collections.ArrayList
    $targets = @{}
    foreach ($n in $scan.Assign) { $targets[$n] = $true }
    for ($i = 0; $i -lt $scan.Lines.Count; $i++) {
        if ($targets.ContainsKey($i + 1)) {
            [void]$out.Add($marker)
            [void]$out.Add('#' + $scan.Lines[$i])
        } else {
            [void]$out.Add($scan.Lines[$i])
        }
    }
    Write-TextAtomic (($out -join "`r`n")) $path
}

# --------------------------------------------------------------------------
# settings.json helpers. ONLY this key's name and value are ever read out. No
# other key name and no other value is printed, and the file is never dumped.
# --------------------------------------------------------------------------

function Read-SettingsObject([string]$path) {
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

# Returns Absent | Unparseable | Clean | Present:<value>
function Get-SettingsKeyState([string]$path, [string]$v) {
    if (-not (Test-Path -LiteralPath $path)) { return 'Absent' }
    try { $obj = Read-SettingsObject $path } catch { return 'Unparseable' }
    if (-not ($obj.PSObject.Properties.Name -contains 'env')) { return 'Clean' }
    $envObj = $obj.env
    if (-not ($envObj -is [System.Management.Automation.PSCustomObject])) { return 'Clean' }
    if (-not ($envObj.PSObject.Properties.Name -contains $v)) { return 'Clean' }
    return "Present:$($envObj.$v)"
}

# Flattens a parsed JSON document to path/value leaves so the validation can
# prove every pre-existing setting - model aliases, routing, env vars,
# permissions, hooks, MCP servers - survived the removal untouched.
function Get-JsonLeaves($node, [string]$prefix, $acc) {
    if ($null -eq $node) { [void]$acc.Add(@{ Path = $prefix; Value = 'null' }); return }
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

# MERGE-remove ONLY this key. Returns $true when the file was rewritten.
function Remove-SettingsKey([string]$path, [string]$v) {
    $obj = Read-SettingsObject $path
    if (-not ($obj.PSObject.Properties.Name -contains 'env')) { return $false }
    $envObj = $obj.env
    if (-not ($envObj -is [System.Management.Automation.PSCustomObject])) { return $false }
    if (-not ($envObj.PSObject.Properties.Name -contains $v)) { return $false }
    # An env map left empty stays as {} - the smallest possible change to a file
    # the operator owns.
    $envObj.PSObject.Properties.Remove($v)
    Write-TextAtomic (($obj | ConvertTo-Json -Depth 100) + "`r`n") $path
    return $true
}

# Valid JSON, the key is GONE from env, and every leaf value that existed in the
# backup is still present and unchanged except the single removed key.
# Returns '' on success or a named reason on failure.
function Test-SettingsRemoval([string]$path, [string]$backup, [string]$v) {
    try { $cur = Read-SettingsObject $path } catch { return "INVALID_JSON: $($_.Exception.Message)" }
    if ($cur.PSObject.Properties.Name -contains 'env') {
        $e = $cur.env
        if (($e -is [System.Management.Automation.PSCustomObject]) -and
            ($e.PSObject.Properties.Name -contains $v)) { return 'KEY_STILL_PRESENT' }
    }
    if ($backup) {
        try { $old = Read-SettingsObject $backup } catch { return "BACKUP_UNREADABLE: $($_.Exception.Message)" }
        $oldLeaves = New-Object System.Collections.ArrayList
        $newLeaves = New-Object System.Collections.ArrayList
        Get-JsonLeaves -node $old -prefix '' -acc $oldLeaves
        Get-JsonLeaves -node $cur -prefix '' -acc $newLeaves
        $newMap = New-Object 'System.Collections.Generic.Dictionary[System.String,System.String]'
        foreach ($leaf in $newLeaves) { $newMap[$leaf.Path] = [string]$leaf.Value }
        # The removed key is the ONLY permitted difference. An env map that held
        # nothing else legitimately collapses to "env" -> "{}".
        $allowed = @("env.$v", 'env')
        $lost = @()
        foreach ($leaf in $oldLeaves) {
            if ($allowed -contains $leaf.Path) { continue }
            if (-not $newMap.ContainsKey($leaf.Path) -or $newMap[$leaf.Path] -ne [string]$leaf.Value) {
                $lost += $leaf.Path
            }
        }
        if ($lost.Count -gt 0) {
            return ('PRE_EXISTING_SETTINGS_LOST: ' + (($lost | Select-Object -First 10) -join ', '))
        }
    }
    return ''
}

# --------------------------------------------------------------------------
# P0. PROVE THE SCANNER before trusting a single "clean". A planted known-good
# control through the SAME classifier, plus a planted negative so a classifier
# that says "Assign" to everything is caught too.
# --------------------------------------------------------------------------
function Test-ScannerControl([string]$v) {
    $positives = @(
        "`$env:$v = 'max'",
        "Set-Item Env:$v 'max'",
        "[Environment]::SetEnvironmentVariable('$v','max','User')"
    )
    foreach ($p in $positives) {
        if ((Get-VarLineClass $p $v) -ne 'Assign') {
            return "FAILED (a planted positive was not classified as an assignment - every CLEAN below is UNDETERMINED, not clean)"
        }
    }
    if ((Get-VarLineClass "`$env:SOMETHING_ELSE = 'max'" $v) -ne $null) {
        return 'FAILED (an unrelated line was classified as a finding - the scanner does not discriminate)'
    }
    if ((Get-VarLineClass "Remove-Item Env:$v" $v) -ne 'Remove') {
        return 'FAILED (a removal was not recognised as a removal - it would have been commented out, re-breaking the machine)'
    }
    return 'PASS (planted positives detected, planted negative reported clean, removal recognised as a fix)'
}

function Write-FixReport([string]$status) {
    $profileBlock = if ($RProfiles.Count) { ($RProfiles -join "`n") } else { '  (none checked)' }
    $settingsBlock = if ($RSettings.Count) { ($RSettings -join "`n") } else { '  (none checked)' }
    $backupBlock = if ($RBackups.Count) { ($RBackups -join "`n") } else { '  (none - nothing was edited)' }
    @"

ULTRACODE OVERRIDE:
$status

VARIABLE:
$Var (Claude Code treats it as an override of the in-session /effort picker;
only low|medium|high|xhigh are persistable, so "max" cannot be saved at all)

SCANNER CONTROL:
$RScanner

CURRENT PROCESS ENVIRONMENT:
$RProcessEnv

USER ENVIRONMENT SCOPE:
$RUserScope

MACHINE ENVIRONMENT SCOPE:
$RMachineScope

LAUNCHD USER DOMAIN:
NOT APPLICABLE ON WINDOWS (no launchd; the macOS twin handles that source)

POWERSHELL PROFILES (checked, and edited by commenting out - never deleting):
$profileBlock

SETTINGS FILES - env map, this one key only:
$settingsBlock

BACKUPS WRITTEN:
$backupBlock

NOT CHECKED (named, so this report is not read as coverage it does not have):
  per-project .claude\settings.json files anywhere on disk
  other users' profiles on this machine
  the environment of any process other than this one
  cmd.exe AutoRun registry entries and Group Policy logon scripts
  WSL shell startup files (a separate environment with its own sources)

ACTIVE CLAUDE WORK DETECTED:
$RActive

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

ANY PROCESS SIGNALLED, KILLED, OR RESTARTED:
NO

WHICH SESSIONS THIS AFFECTS:
NEW shells and NEW Claude Code sessions. A terminal that is already open keeps
the environment it was started with, and a Claude Code session that is running
right now keeps the effort level it is running at. Nothing was restarted to
make this take effect, and nothing needs to be: open a new terminal.
"@ | Write-Output
}

# --------------------------------------------------------------------------
# -SelfTest - proves detection AND remediation in both directions, in a sandbox
# directory. Touches nothing outside it, never writes the real User environment
# scope, installs nothing, and never signals anything.
#
# UNDETERMINED - NOT EXECUTED. No PowerShell was available where this was
# authored. Run it on a Windows box before trusting any of these claims.
# --------------------------------------------------------------------------
function Invoke-SelfTest {
    $box = Join-Path ([System.IO.Path]::GetTempPath()) ("fix-ultracode-selftest-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $box | Out-Null
    $self = $PSCommandPath
    $fails = 0

    function Invoke-Case([string]$settings, [string[]]$extraArgs, [hashtable]$envVars) {
        $saved = @{}
        foreach ($k in $envVars.Keys) {
            $saved[$k] = [System.Environment]::GetEnvironmentVariable($k, 'Process')
            [System.Environment]::SetEnvironmentVariable($k, $envVars[$k], 'Process')
        }
        try {
            & $self -SettingsPath $settings @extraArgs | Out-Null
            return $LASTEXITCODE
        } finally {
            foreach ($k in $envVars.Keys) {
                [System.Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process')
            }
        }
    }

    # 1. THE SCANNER CONTROL PASSES on the real classifier.
    if ((Test-ScannerControl $Var) -like 'PASS*') {
        Write-Output 'PASS  1. the scanner classifies planted positives, a planted negative, and a removal correctly'
    } else { Write-Output 'FAIL  1. scanner control'; $fails++ }

    # 2. PLANTED POSITIVE in a profile is commented out, original preserved.
    $p2 = Join-Path $box 'profile2.ps1'
    Set-Content -LiteralPath $p2 -Encoding Ascii -Value "# my profile`r`n`$env:$Var = 'max'`r`nSet-Alias ll Get-ChildItem"
    $scan = Read-ProfileScan $p2 $Var
    if ($scan.Assign.Count -eq 1) {
        Set-ProfileDisabled $scan $p2 "# $MarkerTag on $MarkerDate"
        $after = Read-ProfileScan $p2 $Var
        $text = Get-Content -LiteralPath $p2 -Raw
        if ($after.Assign.Count -eq 0 -and $text -match "(?m)^#\`$env:$Var = 'max'$" -and
            $text -match 'Set-Alias ll Get-ChildItem') {
            Write-Output 'PASS  2. a planted profile assignment is commented out, the original line preserved under a #'
        } else { Write-Output 'FAIL  2. profile remediation'; $fails++ }
    } else { Write-Output 'FAIL  2. profile detection'; $fails++ }

    # 3. MUTATION PROOF - a clean profile is left byte-identical and no backup is written.
    $p3 = Join-Path $box 'profile3.ps1'
    Set-Content -LiteralPath $p3 -Encoding Ascii -Value "# nothing to see`r`n`$env:EDITOR = 'vim'"
    $before3 = Get-Content -LiteralPath $p3 -Raw
    $scan3 = Read-ProfileScan $p3 $Var
    $after3 = Get-Content -LiteralPath $p3 -Raw
    if ($scan3.Assign.Count -eq 0 -and $before3 -eq $after3) {
        Write-Output 'PASS  3. MUTATION PROOF - a clean profile yields no finding and is not rewritten'
    } else { Write-Output 'FAIL  3. clean profile untouched'; $fails++ }

    # 4. IDEMPOTENT - rescanning a remediated profile finds nothing and adds no second marker.
    $scan4 = Read-ProfileScan $p2 $Var
    $text4 = Get-Content -LiteralPath $p2 -Raw
    if ($scan4.Assign.Count -eq 0 -and $scan4.Disabled -eq 1 -and
        ([regex]::Matches($text4, [regex]::Escape($MarkerTag))).Count -eq 1) {
        Write-Output 'PASS  4. rerun finds nothing live, counts the disabled line, and never double-comments'
    } else { Write-Output 'FAIL  4. idempotent rerun'; $fails++ }

    # 5. A `Remove-Item Env:VAR` line is a FIX and is never commented out.
    $p5 = Join-Path $box 'profile5.ps1'
    Set-Content -LiteralPath $p5 -Encoding Ascii -Value "Remove-Item Env:$Var -ErrorAction SilentlyContinue"
    $scan5 = Read-ProfileScan $p5 $Var
    if ($scan5.Assign.Count -eq 0 -and $scan5.Removes -eq 1) {
        Write-Output 'PASS  5. a removal line is recognised as a fix and left exactly as it is'
    } else { Write-Output 'FAIL  5. removal line misclassified'; $fails++ }

    # 6. settings.json - the key is removed and every other value survives.
    $c6 = Join-Path $box 'case6'; New-Item -ItemType Directory -Force -Path $c6 | Out-Null
    $s6 = Join-Path $c6 'settings.json'
    Set-Content -LiteralPath $s6 -Encoding Ascii -Value @'
{
  "model": "opus[1m]",
  "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max", "EXISTING_VAR": "keep-me" },
  "permissions": { "allow": ["Bash(ls:*)"], "deny": [] }
}
'@
    $rc = Invoke-Case $s6 @() @{}
    $o6 = Get-Content -LiteralPath $s6 -Raw | ConvertFrom-Json
    if (-not ($o6.env.PSObject.Properties.Name -contains $Var) -and
        $o6.env.EXISTING_VAR -eq 'keep-me' -and $o6.model -eq 'opus[1m]' -and
        $o6.permissions.allow[0] -eq 'Bash(ls:*)') {
        Write-Output 'PASS  6. the settings key is removed and every other setting survives'
    } else { Write-Output "FAIL  6. settings merge-remove (exit $rc)"; $fails++ }

    # 7. AN EXISTING BACKUP IS NEVER OVERWRITTEN.
    $c7 = Join-Path $box 'case7'; New-Item -ItemType Directory -Force -Path $c7 | Out-Null
    $s7 = Join-Path $c7 'settings.json'
    Set-Content -LiteralPath $s7 -Encoding Ascii -Value "{ `"env`": { `"$Var`": `"max`" } }"
    $stamp = '20260101-000000'
    $decoy = "$s7.backup.$stamp"
    Set-Content -LiteralPath $decoy -Encoding Ascii -Value 'DECOY-DO-NOT-TOUCH'
    $rc = Invoke-Case $s7 @() @{ FIX_ULTRACODE_BACKUP_STAMP = $stamp }
    if ((Get-Content -LiteralPath $decoy -Raw).Trim() -eq 'DECOY-DO-NOT-TOUCH' -and
        (Test-Path -LiteralPath "$decoy-1")) {
        Write-Output 'PASS  7. an existing backup is never overwritten (the next free name is used)'
    } else { Write-Output "FAIL  7. existing backup never overwritten (exit $rc)"; $fails++ }

    # 8. VALIDATION FAILURE -> THE BACKUP IS RESTORED, byte for byte.
    $c8 = Join-Path $box 'case8'; New-Item -ItemType Directory -Force -Path $c8 | Out-Null
    $s8 = Join-Path $c8 'settings.json'
    Set-Content -LiteralPath $s8 -Encoding Ascii -Value "{ `"env`": { `"$Var`": `"max`", `"SENTINEL`": `"eight`" } }"
    $original = Get-Content -LiteralPath $s8 -Raw
    $rc = Invoke-Case $s8 @() @{ FIX_ULTRACODE_FORCE_VALIDATION_FAILURE = '1' }
    $after8 = Get-Content -LiteralPath $s8 -Raw
    if ($rc -eq 2 -and $original -eq $after8) {
        Write-Output 'PASS  8. a failed validation restores the settings backup byte for byte (exit 2)'
    } else { Write-Output "FAIL  8. validation failure -> restore (exit $rc)"; $fails++ }

    # 9. -DryRun writes nothing and reports the finding.
    $c9 = Join-Path $box 'case9'; New-Item -ItemType Directory -Force -Path $c9 | Out-Null
    $s9 = Join-Path $c9 'settings.json'
    Set-Content -LiteralPath $s9 -Encoding Ascii -Value "{ `"env`": { `"$Var`": `"max`" } }"
    $before9 = Get-Content -LiteralPath $s9 -Raw
    $rc = Invoke-Case $s9 @('-DryRun') @{}
    $after9 = Get-Content -LiteralPath $s9 -Raw
    if ($rc -eq 1 -and $before9 -eq $after9) {
        Write-Output 'PASS  9. MUTATION PROOF - -DryRun on a planted positive reports it, exits 1, and writes nothing'
    } else { Write-Output "FAIL  9. dry-run writes nothing (exit $rc)"; $fails++ }

    if ($fails -eq 0) {
        Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
        Write-Output "`nAll 9 checks passed (including 2 mutation proofs that the checks can fail)."
        exit 0
    }
    Write-Output "`nselftest artifacts kept for inspection: $box"
    exit 1
}

if ($SelfTest) { Invoke-SelfTest }

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

try {
    # ---- P0. PROVE THE INSTRUMENT ----------------------------------------
    # A detector that cannot find a planted positive has not proved a negative.
    # When the control fails, this run DEGRADES TO DETECT-ONLY: it still reports
    # everything it can see, but it will not edit a single file on the strength
    # of an instrument it just failed to trust.
    $RScanner = Test-ScannerControl $Var
    Write-Log "scanner control: $RScanner"
    if ($RScanner -notlike 'PASS*') {
        $ScannerOk = $false
        $DryRun = $true
        $ToolingFailed = $true
        Write-Log 'scanner control FAILED - degrading to detect-only. Nothing will be backed up or edited.'
    }

    # ---- P2. INSPECT RUNNING WORK (READ-ONLY) ----------------------------
    # OBSERVATION ONLY: nothing found here is ever signalled or touched.
    $procs = @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue)
    if ($procs.Count -gt 0) {
        $RActive = "YES ($($procs.Count) processes named 'claude' observed; none touched, none signalled, none restarted)"
    } else {
        # A zero here is NOT proof of absence: Claude Code frequently runs as
        # node.exe on Windows, which this probe deliberately does not claim.
        $RActive = "UNKNOWN (no process named 'claude' was found; Claude Code often runs as node.exe on Windows, so this is not proof that nothing is running)"
    }
    Write-Log "Read-only inspection: $RActive"

    # ---- P1a. CURRENT PROCESS ENVIRONMENT --------------------------------
    # A child process cannot alter its parent's environment. This one is always
    # reported and never "fixed" - saying otherwise would be a lie.
    $curEnv = [System.Environment]::GetEnvironmentVariable($Var, 'Process')
    $curEnvSet = -not [string]::IsNullOrEmpty($curEnv)
    if ($curEnvSet) {
        $FoundAny = $true
        $RProcessEnv = "SET (=$curEnv) in THIS shell -> NOT CHANGED. A child process cannot alter its parent's environment. Run: Remove-Item Env:$Var"
    } else {
        $RProcessEnv = "NOT SET in this process's environment"
    }

    # ---- P1b / P5. USER ENVIRONMENT SCOPE --------------------------------
    $userVal = [System.Environment]::GetEnvironmentVariable($Var, 'User')
    # Control the instrument before accepting a negative: a scope read that
    # cannot return a known-present name proves nothing when it returns nothing.
    $userControl = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrEmpty($userVal)) {
        if ([string]::IsNullOrEmpty($userControl)) {
            $RUserScope = 'UNDETERMINED (the control read of the User-scope Path also came back empty, so this instrument is not proven and a clean answer here would mean nothing)'
        } else {
            $RUserScope = "CLEAN (read from the User environment scope; the control read of User-scope Path returned a value, so the empty answer is real)"
        }
    } else {
        $FoundAny = $true
        if ($DryRun) {
            $ManualRequired = $true
            $RUserScope = "FOUND (=$userVal) -> NOT CHANGED (-DryRun). Clear it with: [Environment]::SetEnvironmentVariable('$Var', `$null, 'User')"
            $Manual += "[Environment]::SetEnvironmentVariable('$Var', `$null, 'User')"
        } else {
            try {
                [System.Environment]::SetEnvironmentVariable($Var, $null, 'User')
                # P7. Re-read from the registry - never from this process's env.
                $userAfter = [System.Environment]::GetEnvironmentVariable($Var, 'User')
                if ([string]::IsNullOrEmpty($userAfter)) {
                    $FixedAny = $true
                    $RUserScope = "FOUND (=$userVal) -> CLEARED, re-read from the User scope and now empty"
                } else {
                    $ManualRequired = $true
                    $RUserScope = "FOUND (=$userVal) -> the clear did not take; the re-read still returns a value. Run it yourself: [Environment]::SetEnvironmentVariable('$Var', `$null, 'User')"
                    $Manual += "[Environment]::SetEnvironmentVariable('$Var', `$null, 'User')"
                }
            } catch {
                $ToolingFailed = $true
                $ManualRequired = $true
                $RUserScope = "FOUND (=$userVal) -> could not be cleared: $($_.Exception.Message)"
                $Manual += "[Environment]::SetEnvironmentVariable('$Var', `$null, 'User')"
            }
        }
    }

    # ---- P1c. MACHINE ENVIRONMENT SCOPE - DETECTED ONLY -------------------
    # Written by administrators, shared by every account on the box. Never
    # elevated to and never changed here.
    try {
        $machineVal = [System.Environment]::GetEnvironmentVariable($Var, 'Machine')
        $machineControl = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
        if ([string]::IsNullOrEmpty($machineVal)) {
            if ([string]::IsNullOrEmpty($machineControl)) {
                $RMachineScope = 'UNDETERMINED (the control read of the Machine-scope Path also came back empty, so this instrument is not proven)'
            } else {
                $RMachineScope = 'CLEAN (read from the Machine environment scope; the control read returned a value, so the empty answer is real)'
            }
        } else {
            $FoundAny = $true
            $ManualRequired = $true
            $RMachineScope = "FOUND (=$machineVal) -> NOT CHANGED. Machine scope is administrator-owned and shared by every account here. From an ELEVATED PowerShell run: [Environment]::SetEnvironmentVariable('$Var', `$null, 'Machine')"
            $Manual += "from an ELEVATED PowerShell: [Environment]::SetEnvironmentVariable('$Var', `$null, 'Machine')"
        }
    } catch {
        $RMachineScope = "UNDETERMINED (the Machine scope could not be read: $($_.Exception.Message)) - NOT clean"
    }

    # ---- P1d / P3 / P4. POWERSHELL PROFILES ------------------------------
    # CurrentUser* are edited; AllUsers* are administrator-owned and reported
    # only. $PROFILE carries all four paths whether or not the files exist.
    $profileTargets = @(
        @{ Name = 'CurrentUserAllHosts';  Path = $PROFILE.CurrentUserAllHosts;  Editable = $true },
        @{ Name = 'CurrentUserCurrentHost'; Path = $PROFILE.CurrentUserCurrentHost; Editable = $true },
        @{ Name = 'AllUsersAllHosts';     Path = $PROFILE.AllUsersAllHosts;     Editable = $false },
        @{ Name = 'AllUsersCurrentHost';  Path = $PROFILE.AllUsersCurrentHost;  Editable = $false }
    )
    foreach ($t in $profileTargets) {
        $label = ('  ' + $t.Name.PadRight(24))
        if (-not $t.Path) {
            $RProfiles += "$label UNDETERMINED (`$PROFILE did not supply this path)"
            continue
        }
        $scan = Read-ProfileScan $t.Path $Var
        if ($scan.Status -eq 'Absent') {
            $RProfiles += "$label ABSENT (checked; no such file) - $($t.Path)"
            continue
        }
        if ($scan.Status -eq 'Unreadable') {
            $ToolingFailed = $true
            $ManualRequired = $true
            $RProfiles += "$label UNREADABLE - NOT clean, NOT changed - $($t.Path)"
            $Manual += "inspect $($t.Path) by hand: it could not be read"
            continue
        }
        $extra = ''
        if ($scan.Removes -gt 0) { $extra += "; $($scan.Removes) removal line(s) left exactly as they are - those are a fix, not a fault" }
        if ($scan.Disabled -gt 0) { $extra += "; $($scan.Disabled) line(s) already disabled by an earlier run" }

        if ($scan.Other.Count -gt 0) {
            $FoundAny = $true
            $ManualRequired = $true
            $RProfiles += "$label MENTIONS $Var on line(s) $($scan.Other -join ',') in a form this script does not recognise -> NOT CHANGED (never guess at your profile). Inspect them yourself$extra - $($t.Path)"
            $Manual += "open $($t.Path) and review line(s) $($scan.Other -join ',') by hand"
        }

        if ($scan.Assign.Count -eq 0) {
            if ($scan.Other.Count -eq 0) {
                if ($ScannerOk) {
                    $RProfiles += "$label CLEAN (checked for assignment, Set-Item, and SetEnvironmentVariable forms)$extra - $($t.Path)"
                } else {
                    $RProfiles += "$label UNDETERMINED (no assignment matched, but the scanner control FAILED - this is not a clean result)$extra - $($t.Path)"
                }
            }
            continue
        }

        $FoundAny = $true
        $lines = ($scan.Assign -join ',')
        if (-not $t.Editable) {
            $ManualRequired = $true
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> NOT CHANGED. This profile is administrator-owned and shared by every account here. Edit it yourself from an elevated editor and comment the line out. - $($t.Path)"
            $Manual += "from an ELEVATED editor, comment out the $Var line(s) on $lines in $($t.Path)"
            continue
        }
        if ($DryRun) {
            $ManualRequired = $true
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> NOT CHANGED (-DryRun)$extra - $($t.Path)"
            continue
        }

        # P3. Back up BEFORE editing, and print the path. A backup that could not
        # be written means the file is NOT edited - never edit without a way back.
        $backup = New-TimestampedBackup $t.Path
        if (-not $backup) {
            $ToolingFailed = $true
            $ManualRequired = $true
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> NOT CHANGED: the backup could not be written, so nothing was edited - $($t.Path)"
            $Manual += "edit $($t.Path) by hand: comment out the $Var line(s) on $lines"
            continue
        }
        $RBackups += ('  ' + $t.Path + ' -> ' + $backup)
        Write-Log "backup: $backup"

        $marker = "# $MarkerTag on $MarkerDate - this variable overrides the in-session /effort picker, so ultracode reverts. Remove the leading # on the next line to restore it."
        try {
            Set-ProfileDisabled $scan $t.Path $marker
        } catch {
            $ToolingFailed = $true
            $ManualRequired = $true
            [void](Restore-Backup $backup $t.Path)
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> WRITE FAILED, backup restored ($($_.Exception.Message)) - $($t.Path)"
            $Manual += "edit $($t.Path) by hand: comment out the $Var line(s) on $lines"
            continue
        }

        # P7. Verify from DISK - not from this process's environment.
        $after = Read-ProfileScan $t.Path $Var
        if ($after.Status -eq 'Scanned' -and $after.Assign.Count -eq 0) {
            $FixedAny = $true
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> COMMENTED OUT behind a dated marker; re-read from disk and now clean$extra`n$(' ' * 27)backup: $backup"
        } else {
            $ToolingFailed = $true
            $ManualRequired = $true
            [void](Restore-Backup $backup $t.Path)
            $RProfiles += "$label FOUND $($scan.Assign.Count) line(s) ($lines) -> post-write re-read did NOT come back clean; backup restored - $($t.Path)"
            $Manual += "edit $($t.Path) by hand: comment out the $Var line(s) on $lines"
        }
    }

    # ---- P1e / P3 / P6. SETTINGS FILES -----------------------------------
    # claude-nine reuses the ordinary Claude config root (repo rule 10), so both
    # roots are checked; -SettingsPath replaces the primary list.
    if ($SettingsPath) {
        $settingsTargets = @($SettingsPath)
    } else {
        $settingsTargets = @(
            (Join-Path $env:USERPROFILE '.claude\settings.json'),
            (Join-Path $env:USERPROFILE '.claude\settings.local.json'),
            (Join-Path $env:USERPROFILE '.claude-nine\settings.json'),
            (Join-Path $env:USERPROFILE '.claude-nine\settings.local.json')
        )
    }
    foreach ($sp in $settingsTargets) {
        $label = ('  ' + $sp)
        $state = Get-SettingsKeyState $sp $Var
        if ($state -eq 'Absent') { $RSettings += "$label`n      ABSENT (checked; no such file)"; continue }
        if ($state -eq 'Unparseable') {
            $ManualRequired = $true
            $RSettings += "$label`n      UNPARSEABLE JSON -> NOT CHANGED. An unreadable settings file is never treated as empty and never overwritten."
            $Manual += "fix the JSON in $sp, then rerun this script"
            continue
        }
        if ($state -eq 'Clean') { $RSettings += "$label`n      CLEAN (no `"$Var`" in its env map)"; continue }

        # Present:<value> - this one key's value is the only one ever read out.
        $val = $state.Substring('Present:'.Length)
        $FoundAny = $true
        if ($DryRun) {
            $ManualRequired = $true
            $RSettings += "$label`n      KEY PRESENT (=$val) -> NOT CHANGED (-DryRun)"
            continue
        }

        $backup = New-TimestampedBackup $sp
        if (-not $backup) {
            $ToolingFailed = $true
            $ManualRequired = $true
            $RSettings += "$label`n      KEY PRESENT (=$val) -> NOT CHANGED: the backup could not be written, so nothing was edited"
            $Manual += "remove `"$Var`" from the env map in $sp by hand"
            continue
        }
        $RBackups += ('  ' + $sp + ' -> ' + $backup)
        Write-Log "backup: $backup"

        try {
            [void](Remove-SettingsKey $sp $Var)
        } catch {
            $ToolingFailed = $true
            $ManualRequired = $true
            [void](Restore-Backup $backup $sp)
            $RSettings += "$label`n      KEY PRESENT (=$val) -> REMOVAL FAILED ($($_.Exception.Message)); backup restored, nothing landed"
            $Manual += "remove `"$Var`" from the env map in $sp by hand"
            continue
        }

        $reason = Test-SettingsRemoval $sp $backup $Var
        # Test-only seam: -SelfTest uses it to prove the restore path really restores.
        if ($env:FIX_ULTRACODE_FORCE_VALIDATION_FAILURE) { $reason = 'FORCED_VALIDATION_FAILURE (selftest seam)' }
        if ($reason) {
            $ToolingFailed = $true
            $ManualRequired = $true
            Write-Log "settings validation FAILED: $reason"
            [void](Restore-Backup $backup $sp)
            $RSettings += "$label`n      KEY PRESENT (=$val) -> VALIDATION FAILED ($reason); backup restored byte for byte, nothing landed"
            $Manual += "remove `"$Var`" from the env map in $sp by hand"
            continue
        }

        # P7. Verify from disk.
        $afterState = Get-SettingsKeyState $sp $Var
        if ($afterState -eq 'Clean') {
            $FixedAny = $true
            $RSettings += "$label`n      KEY PRESENT (=$val) -> REMOVED from the env map, JSON re-read from disk and valid, every other setting proven unchanged`n      backup: $backup"
        } else {
            $ToolingFailed = $true
            $ManualRequired = $true
            [void](Restore-Backup $backup $sp)
            $RSettings += "$label`n      KEY PRESENT (=$val) -> post-write re-read still finds it; backup restored"
            $Manual += "remove `"$Var`" from the env map in $sp by hand"
        }
    }

    # ---- The inherited-from-a-parent case ---------------------------------
    # Set in this process but explained by nothing found and nothing fixed: it
    # came from a parent this script cannot reach.
    if ($curEnvSet -and -not $FixedAny -and -not $ManualRequired) {
        $ManualRequired = $true
        $RProcessEnv += "`n    No user-scope source explains it, so this process INHERITED it from its parent."
        $RProcessEnv += "`n    That parent's own environment is the source and no child process can reach it. Clear it where"
        $RProcessEnv += "`n    that parent is started, then start a NEW one when you choose - this script never restarts anything."
        $Manual += "clear $Var wherever the parent process of this shell is started, then start a new one yourself"
    }

    # ---- P8. REPORT --------------------------------------------------------
    if (-not $ScannerOk) {
        $status = "UNDETERMINED - the scanner failed its own planted control, so no 'clean' below is trustworthy and NOTHING was edited. Fix the tooling and rerun."
    } elseif ($ToolingFailed) {
        $status = 'PARTIAL - one or more sources could not be changed; every backup was restored. See the per-source lines below.'
    } elseif ($ManualRequired -and $FixedAny) {
        $status = 'PARTIALLY FIXED - some sources were cleared; others need one manual command (listed below). Applies to NEW shells and NEW sessions.'
    } elseif ($ManualRequired) {
        $status = 'MANUAL ACTION REQUIRED - a source this script will not touch automatically is still active. The exact command is below.'
    } elseif ($FixedAny) {
        $status = 'FIXED - every source found was cleared. Applies to NEW shells and NEW sessions; anything running right now is unchanged.'
    } elseif ($FoundAny) {
        $status = 'ALREADY CLEAR - nothing needed changing this run.'
    } else {
        $status = "CLEAN - no source of $Var was found. Nothing was backed up and nothing was changed."
    }

    Write-FixReport $status

    if ($Manual.Count -gt 0) {
        Write-Output ''
        Write-Output 'MANUAL STEPS (reported, never performed - running work comes first):'
        foreach ($m in $Manual) { Write-Output "- $m" }
    }

    if ($ToolingFailed) { exit 2 }
    if ($ManualRequired) { exit 1 }
    exit 0
} catch {
    Write-Log "Fix-UltracodeOverride failed: $($_.Exception.Message)"
    Write-Log 'Nothing that was running was touched.'
    exit 2
}
