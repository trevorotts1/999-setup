# Remove a Windows Scheduled Task installed by Install-KaizenTask.ps1.
# Idempotent: exits 0 when there is nothing to remove.
#
# usage: Remove-KaizenTask.ps1 <LoopId> [-DryRun]

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$LoopId,

  [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$DryRunActive = ($DryRun -eq $true) -or ($env:KAIZEN_TASK_DRY_RUN -eq "1")

if ($LoopId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
  Write-Error "Remove-KaizenTask: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}, got: $LoopId"
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

$taskName = Get-SanitizedTaskName ("Kaizen-" + $LoopId)
$localStatePath = Join-Path $loopDir "LOCAL_STATE.json"
$local = $null
if (Test-Path -PathType Leaf $localStatePath) {
  $local = Read-LocalState $localStatePath
  if (-not $local.__missing -and -not $local.__invalid -and $local.scheduler.task_name) {
    $taskName = [string]$local.scheduler.task_name
  }
}

$display = 'schtasks.exe /Delete /TN "' + $taskName + '" /F'

if ($DryRunActive) {
  Write-Output "dry-run: would run: $display"
  Write-Output "dry-run: LOCAL_STATE.json not modified"
  exit 0
}

& schtasks.exe /Delete /TN $taskName /F 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Output "Remove-KaizenTask: nothing to remove for $LoopId (task $taskName not found)"
  exit 0
}

Write-Output "removed: task $taskName"
Write-Output "loop: $LoopId"

if ($null -ne $local -and -not $local.__missing -and -not $local.__invalid) {
  if ($null -ne $local.scheduler) {
    Add-Member -InputObject $local.scheduler -MemberType NoteProperty -Name task_name -Value $null -Force
    Add-Member -InputObject $local.scheduler -MemberType NoteProperty -Name label -Value $null -Force
  }
  Write-LocalStateAtomic $localStatePath $local
}
exit 0
