# Install a Windows Scheduled Task that runs one Kaizen cycle on an interval.
# Fallback path (Path D) for Windows: used only when /loop, Desktop tasks,
# and cloud Routines are all unavailable.
#
# usage: Install-KaizenTask.ps1 <LoopId> <Interval> [-TaskName <string>] [-Launcher <string>] [-DryRun]
#   interval: daily | weekly | monthly | quarterly | 90days | <minutes>
#
# The task runs Invoke-KaizenCycle.ps1, which invokes the headless launcher.
# Reinstalling with a different interval converges (schtasks /Create /F).

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$LoopId,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$Interval,

  [Parameter(Position = 2)]
  [string]$TaskName,

  [Parameter(Position = 3)]
  [string]$Launcher,

  [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$DryRunActive = ($DryRun -eq $true) -or ($env:KAIZEN_TASK_DRY_RUN -eq "1")

if ($LoopId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
  Write-Error "Install-KaizenTask: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}, got: $LoopId"
  exit 2
}

function Get-SanitizedTaskName {
  param([string]$Raw)
  $s = $Raw -replace '[^A-Za-z0-9_-]', '-'
  if ($s.Length -gt 32) { $s = $s.Substring(0, 32) }
  return $s
}

function Resolve-KaizenRoot {
  $resolver = Join-Path $PSScriptRoot "Resolve-KaizenRoot.ps1"
  $out = (& $resolver) 2>$null
  return ([string]$out).Trim()
}

function Read-RegistryJson {
  param([string]$Root)
  foreach ($name in @("REGISTRY.json", "registry.json")) {
    $rp = Join-Path $Root $name
    if (-not (Test-Path -PathType Leaf $rp)) { continue }
    try {
      return (Get-Content -Raw $rp | ConvertFrom-Json)
    } catch {
      continue
    }
  }
  return $null
}

function Resolve-LoopDir {
  param([string]$Root, [string]$Id)
  $reg = Read-RegistryJson $Root
  $hits = @()
  if ($null -ne $reg) {
    $entries = @()
    if ($reg -is [System.Array]) {
      $entries = @($reg)
    } elseif ($null -ne $reg.loops) {
      $entries = @($reg.loops)
    } else {
      $entries = @($reg.PSObject.Properties | ForEach-Object { $_.Value })
    }
    foreach ($e in $entries) {
      if ($null -eq $e) { continue }
      if ($null -ne $e.loop_id -and ([string]$e.loop_id) -eq $Id) { $hits += $e; continue }
      if ($null -ne $e.name -and ([string]$e.name) -eq $Id) { $hits += $e }
    }
    if ($hits.Count -eq 1) {
      $entryRoot = [string]$hits[0].root
      if ($entryRoot -and (Test-Path -PathType Container $entryRoot)) { return $entryRoot }
      $fallback = Join-Path $Root $Id
      if (Test-Path -PathType Container $fallback) { return $fallback }
      if ($entryRoot) { return $entryRoot }
    }
  }
  return (Join-Path $Root $Id)
}

function Get-ScheduleInfo {
  param([string]$Raw)
  switch -Regex ($Raw) {
    '^daily$'     { return @{ Cadence = "daily"; Args = @("/SC", "DAILY") } }
    '^weekly$'    { return @{ Cadence = "weekly"; Args = @("/SC", "WEEKLY", "/D", "MON") } }
    '^monthly$'   { return @{ Cadence = "monthly"; Args = @("/SC", "MONTHLY", "/D", "1") } }
    '^quarterly$' { return @{ Cadence = "quarterly"; Args = @("/SC", "MONTHLY", "/M", "JAN,APR,JUL,OCT", "/D", "1") } }
    '^90days$'    { return @{ Cadence = "90days"; Args = @("/SC", "DAILY", "/MO", "90") } }
    '^[0-9]+$'    { return @{ Cadence = "minutes:$Raw"; Args = @("/SC", "MINUTE", "/MO", $Raw) } }
    default       { return $null }
  }
}

function Read-LocalState {
  param([string]$Path)
  if (-not (Test-Path -PathType Leaf $Path)) { return ([PSCustomObject]@{ __missing = $true }) }
  try {
    return (Get-Content -Raw $Path | ConvertFrom-Json)
  } catch {
    return ([PSCustomObject]@{ __invalid = $true })
  }
}

function Write-LocalStateAtomic {
  param([string]$Path, $Value)
  $tmp = "$Path.tmp-$PID"
  $json = $Value | ConvertTo-Json -Depth 8
  Set-Content -Path $tmp -Value $json -Encoding UTF8
  try {
    Get-Content -Raw $tmp | ConvertFrom-Json | Out-Null
  } catch {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    throw "Write-LocalStateAtomic: refusing to write invalid JSON"
  }
  if (Test-Path -PathType Leaf $Path) {
    Copy-Item -LiteralPath $Path -Destination "$Path.bak" -Force
  }
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

$root = Resolve-KaizenRoot
$loopDir = Resolve-LoopDir $root $LoopId
if (-not (Test-Path -PathType Container $loopDir)) {
  Write-Error "Install-KaizenTask: no Memory folder for loop: $loopDir (checked REGISTRY.json and fallback path)"
  exit 1
}

$sched = Get-ScheduleInfo $Interval
if ($null -eq $sched) {
  Write-Error "Install-KaizenTask: unknown interval: $Interval (expected daily|weekly|monthly|quarterly|90days|<minutes>)"
  exit 2
}

if (-not $TaskName) { $TaskName = "Kaizen-$LoopId" }
$taskName = Get-SanitizedTaskName $TaskName

if (-not $Launcher) { $Launcher = "claude-nine" }

$cycleScript = Join-Path $PSScriptRoot "Invoke-KaizenCycle.ps1"
if (-not (Test-Path -PathType Leaf $cycleScript)) {
  Write-Error "Install-KaizenTask: cycle runner not found: $cycleScript"
  exit 2
}

$pwsh = Join-Path $PSHOME "pwsh.exe"
if (-not (Test-Path -PathType Leaf $pwsh)) {
  $found = Get-Command "pwsh" -ErrorAction SilentlyContinue
  if ($null -ne $found) {
    $pwsh = $found.Source
  } else {
    $ps5 = Join-Path $PSHOME "powershell.exe"
    if (Test-Path -PathType Leaf $ps5) { $pwsh = $ps5 }
  }
}

$action = """$pwsh"" -NoProfile -ExecutionPolicy Bypass -File ""$cycleScript"" ""$LoopId"" ""$Launcher"""
$createArgs = @("/Create", "/TN", $taskName, "/TR", $action) + $sched.Args + @("/F")
$display = 'schtasks.exe /Create /TN "' + $taskName + '" /TR "' + $action + '" ' + ($sched.Args -join ' ') + ' /F'

if ($DryRunActive) {
  Write-Output "dry-run: would run: $display"
  Write-Output "dry-run: LOCAL_STATE.json not modified"
  exit 0
}

& schtasks.exe @createArgs
if ($LASTEXITCODE -ne 0) {
  Write-Error "Install-KaizenTask: schtasks /Create failed with exit code $LASTEXITCODE"
  exit 1
}

$localStatePath = Join-Path $loopDir "LOCAL_STATE.json"
$local = Read-LocalState $localStatePath
if ($local.__invalid) {
  Write-Error "Install-KaizenTask: LOCAL_STATE.json is invalid JSON; not modifying: $localStatePath"
  exit 1
}
if ($local.__missing) { $local = [PSCustomObject]@{ loop_id = $LoopId } }
$scheduler = [PSCustomObject]@{
  mechanism = "taskschd"
  task_name = $taskName
  launcher = $Launcher
  cadence = $sched.Cadence
  requested_cadence = $Interval
  installed_at = (Get-Date).ToUniversalTime().ToString("o")
}
Add-Member -InputObject $local -MemberType NoteProperty -Name scheduler -Value $scheduler -Force
Write-LocalStateAtomic $localStatePath $local

Write-Output "installed: task $taskName"
Write-Output "loop: $LoopId"
Write-Output "interval: $Interval"
Write-Output "launcher: $Launcher"
exit 0
