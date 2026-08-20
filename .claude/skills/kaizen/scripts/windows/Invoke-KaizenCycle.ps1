# Run one Kaizen cycle headlessly via the chosen launcher (Task Scheduler runner).
# Uses the same natural-language prompt wording as the macOS runner.
# Never prints log contents. Exit code mirrors the launcher.
#
# usage: Invoke-KaizenCycle.ps1 <LoopId> [-Launcher <string>]

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$LoopId,

  [Parameter(Position = 1)]
  [string]$Launcher,

  [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$DryRunActive = ($DryRun -eq $true) -or ($env:KAIZEN_TASK_DRY_RUN -eq "1")

if ($LoopId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
  Write-Error "Invoke-KaizenCycle: loop-id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}, got: $LoopId"
  exit 2
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
if (-not (Test-Path -PathType Container $loopDir)) {
  Write-Error "Invoke-KaizenCycle: no Memory folder for loop: $loopDir"
  exit 1
}

# Duplicate-run guard: a fresh (<6h) cycle lock means another run is active.
$lockPath = Join-Path $loopDir ".cycle-lock.json"
if (Test-Path -PathType Leaf $lockPath) {
  $locked = $false
  $lockNote = $null
  try {
    $lock = Get-Content -Raw $lockPath | ConvertFrom-Json
    if ($null -ne $lock.started_at) {
      $started = [DateTime]::MinValue
      if ([DateTime]::TryParse([string]$lock.started_at, [ref]$started)) {
        $ageHours = ((Get-Date) - $started).TotalHours
        if ($ageHours -ge 0 -and $ageHours -lt 6) {
          $locked = $true
          $lockNote = "cycle lock held since $($lock.started_at)"
        } else {
          $lockNote = "cycle lock stale ($([Math]::Round($ageHours, 1))h old); treating as unlocked"
        }
      } else {
        $lockNote = "cycle lock started_at unparseable; treating as stale"
      }
    } else {
      $lockNote = "cycle lock missing started_at; treating as stale"
    }
  } catch {
    $lockNote = "cycle lock malformed; treating as stale"
  }
  if ($locked) {
    $skipped = [PSCustomObject]@{
      skipped = $true
      reason = $lockNote
      loop_id = $LoopId
    }
    Write-Output ($skipped | ConvertTo-Json -Compress)
    exit 0
  }
  Write-Output "Invoke-KaizenCycle: $lockNote"
}

# The lock is owned by kaizen-state.mjs (single writer, see
# references/memory.md §Cycle lock); this runner only reads it. The dry-run
# seam exits before any launcher invocation or cycle record write.
if ($DryRunActive) {
  Write-Output "dry-run: would run: launcher=$Launcher loop=$LoopId (no launcher call, no cycle record written)"
  exit 0
}

if (-not $Launcher) {
  $cmd = Get-Command "claude-nine" -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    $Launcher = "claude-nine"
  } else {
    $cmd2 = Get-Command "claude" -ErrorAction SilentlyContinue
    if ($null -ne $cmd2) {
      $Launcher = "claude"
    }
  }
}
if (-not $Launcher) {
  Write-Error "Invoke-KaizenCycle: no launcher found (tried claude-nine and claude)"
  exit 1
}

$localStatePath = Join-Path $loopDir "LOCAL_STATE.json"
$workDir = $loopDir
$local = $null
if (Test-Path -PathType Leaf $localStatePath) {
  $local = Read-LocalState $localStatePath
  if (-not $local.__missing -and -not $local.__invalid -and $local.target_local_path) {
    $targetPath = [string]$local.target_local_path
    if (Test-Path -PathType Container $targetPath) { $workDir = $targetPath }
  }
}

$prompt = "Use the kaizen skill. Run one approved Kaizen cycle for Loop ID $LoopId. Read its Kaizen Contract and Kaizen Memory first. Follow the approved Contract exactly. Do not merge or deploy. Update Memory and record fresh proof."

$cyclesDir = Join-Path $loopDir "cycles"
if (-not (Test-Path -PathType Container $cyclesDir)) {
  New-Item -ItemType Directory -Path $cyclesDir -Force | Out-Null
}
$ts = Get-Date -Format "yyyy-MM-ddTHHmmss"
$logPath = Join-Path $cyclesDir "launchd-run-$ts.log"

$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$exitCode = $null
try {
  Push-Location $workDir
  try {
    & $Launcher -p $prompt > $logPath 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} catch {
  $exitCode = 1
  Add-Content -Path $logPath -Value ("Invoke-KaizenCycle: launcher invocation failed: " + $_.Exception.Message)
}

$endedAt = (Get-Date).ToUniversalTime().ToString("o")
$result = if ($exitCode -eq 0) { "ok" } else { "failure" }
$record = [PSCustomObject]@{
  started_at = $startedAt
  ended_at = $endedAt
  launcher = $Launcher
  exit_code = $exitCode
  result = $result
  log = $logPath
  loop_id = $LoopId
}
$recordJson = $record | ConvertTo-Json -Compress
Set-Content -Path (Join-Path $cyclesDir "launchd-run-$ts.json") -Value $recordJson -Encoding UTF8
Write-Output $recordJson

if ($exitCode -ne 0) {
  $failure = [PSCustomObject]@{
    at = $endedAt
    exit_code = $exitCode
    log = $logPath
  }
  $localForFailure = $null
  if (Test-Path -PathType Leaf $localStatePath) {
    $localForFailure = Read-LocalState $localStatePath
  }
  if ($null -eq $localForFailure -or $localForFailure.__missing) {
    $localForFailure = [PSCustomObject]@{ loop_id = $LoopId }
  }
  if (-not $localForFailure.__invalid) {
    Add-Member -InputObject $localForFailure -MemberType NoteProperty -Name scheduler_failure -Value $failure -Force
    Write-LocalStateAtomic $localStatePath $localForFailure
  }
}

exit $exitCode
