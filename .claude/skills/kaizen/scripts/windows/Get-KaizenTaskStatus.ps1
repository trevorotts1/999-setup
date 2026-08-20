# Print the Task Scheduler status for a Kaizen loop as JSON.
#
# usage: Get-KaizenTaskStatus.ps1 <LoopId>
# output: {"installed":bool,"task_name":string,"state":string|null,
#          "last_run_result":string|null,"from_local_state":bool}

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$LoopId,

  [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$DryRunActive = ($DryRun -eq $true) -or ($env:KAIZEN_TASK_DRY_RUN -eq "1")

if ($LoopId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
  Write-Error "Get-KaizenTaskStatus: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}, got: $LoopId"
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

function Read-LocalState {
  param([string]$Path)
  if (-not (Test-Path -PathType Leaf $Path)) { return ([PSCustomObject]@{ __missing = $true }) }
  try {
    return (Get-Content -Raw $Path | ConvertFrom-Json)
  } catch {
    return ([PSCustomObject]@{ __invalid = $true })
  }
}

$root = Resolve-KaizenRoot
$loopDir = Resolve-LoopDir $root $LoopId

$taskName = Get-SanitizedTaskName ("Kaizen-" + $LoopId)
$fromLocalState = $false
$localStatePath = Join-Path $loopDir "LOCAL_STATE.json"
if (Test-Path -PathType Leaf $localStatePath) {
  $local = Read-LocalState $localStatePath
  if (-not $local.__missing -and -not $local.__invalid -and $local.scheduler.task_name) {
    $taskName = [string]$local.scheduler.task_name
    $fromLocalState = $true
  }
}

if ($DryRunActive) {
  # Dry-run keeps the JSON contract parseable: no schtasks queries, truthful
  # installed=false, flagged dry_run so callers can tell the difference.
  $out = [PSCustomObject]@{
    installed = $false
    task_name = $taskName
    state = $null
    last_run_result = $null
    from_local_state = $fromLocalState
    dry_run = $true
  }
  Write-Output ($out | ConvertTo-Json -Compress)
  exit 0
}

$installed = $false
$state = $null
$lastRunResult = $null

& schtasks.exe /Query /TN $taskName /FO CSV 2>$null
if ($LASTEXITCODE -eq 0) {
  $installed = $true
  $csvLines = @(& schtasks.exe /Query /TN $taskName /FO CSV 2>$null)
  foreach ($line in $csvLines) {
    $trimmed = ([string]$line).Trim()
    if ($trimmed.Length -eq 0) { continue }
    $header = $trimmed.Substring(0, [Math]::Min($trimmed.Length, 12)).ToLowerInvariant()
    if ($header.StartsWith('"taskname"')) { continue }
    if ($header.StartsWith('"hostname"')) { continue }
    $parts = $trimmed.Split(',')
    if ($parts.Length -ge 4) {
      $state = $parts[3].Trim().Trim('"')
    }
    break
  }
}

$verboseLines = @(& schtasks.exe /Query /TN $taskName /FO LIST /V 2>$null)
foreach ($line in $verboseLines) {
  if ($line -match '^Last Run Result:\s*(.+)$') {
    $lastRunResult = $Matches[1].Trim()
  }
}

$out = [PSCustomObject]@{
  installed = $installed
  task_name = $taskName
  state = $state
  last_run_result = $lastRunResult
  from_local_state = $fromLocalState
}
Write-Output ($out | ConvertTo-Json -Compress)
exit 0
