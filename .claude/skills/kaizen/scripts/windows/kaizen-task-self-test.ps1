# Self-test for the Kaizen Windows Task Scheduler suite.
# Exercises all four scripts against $env:TEMP fixtures. No real tasks are
# created; schtasks.exe is not used (dry-run everywhere). Exits 0 only when
# every assertion passes. Run on a Windows runner:
#   pwsh -NoProfile -ExecutionPolicy Bypass -File kaizen-task-self-test.ps1

param()

$ErrorActionPreference = "Stop"
$Script:Pass = 0
$Script:Fail = 0

function Assert-True {
  param([bool]$Condition, [string]$Label)
  if ($Condition) {
    $Script:Pass++
    Write-Output "PASS: $Label"
  } else {
    $Script:Fail++
    Write-Output "FAIL: $Label"
  }
}

function Run-ExpectOk {
  # Scriptblock, not an arg array: array splatting cannot bind named
  # parameters (-Launcher, -DryRun) — they bind positionally and break
  # [string]$LoopId / [string]$Launcher with "A positional parameter cannot
  # be found that accepts argument".
  param([scriptblock]$Command)
  $oldPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & $Command 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $oldPref
  return [PSCustomObject]@{ Code = $code; Output = @($out) }
}

$suiteDir = $PSScriptRoot
$work = Join-Path $env:TEMP ("kaizen-tsk-test-" + $PID)
$binDir = Join-Path $work "bin"
$downloads = Join-Path $work "Downloads"
$master = Join-Path $downloads "OpenClaw Master Files"
$root = Join-Path $master "Kaizen"
$loopDir = Join-Path $root "loop-tst-01"
$loopId = "loop-tst-01"
$fakeLauncher = Join-Path $binDir "claude-nine.bat"
$argsFile = Join-Path $work "launcher-args.txt"

New-Item -ItemType Directory -Path $binDir, $loopDir -Force | Out-Null

@"
@echo off
echo %* > "$($argsFile -replace '/', '\')"
exit /b 0
"@ | Set-Content -Path $fakeLauncher -Encoding ASCII

$state = [PSCustomObject]@{
  schema_version = 1
  loop_id = $loopId
  name = "Test Loop"
  target = [PSCustomObject]@{ type = "website"; repo_remote = "https://github.com/example/repo" }
}
$state | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $loopDir "STATE.json") -Encoding UTF8

$localState = [PSCustomObject]@{
  schema_version = 1
  loop_id = $loopId
  local_target_path = (Join-Path $work "target")
  scheduler = [PSCustomObject]@{ mechanism = "none" }
}
New-Item -ItemType Directory -Path (Join-Path $work "target") -Force | Out-Null
$localState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $loopDir "LOCAL_STATE.json") -Encoding UTF8

$registry = [PSCustomObject]@{
  loops = @(
    [PSCustomObject]@{
      loop_id = $loopId
      name = "Test Loop"
      root = $loopDir
      updated_at = "2026-08-20T00:00:00Z"
    }
  )
}
$registry | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $root "REGISTRY.json") -Encoding UTF8

$env:KAIZEN_TASK_DRY_RUN = "1"
$env:KAIZEN_DOWNLOADS = $downloads

$oldPath = $env:PATH
$env:PATH = "$binDir;$oldPath"

try {
  $install = Join-Path $suiteDir "Install-KaizenTask.ps1"
  $remove = Join-Path $suiteDir "Remove-KaizenTask.ps1"
  $status = Join-Path $suiteDir "Get-KaizenTaskStatus.ps1"
  $cycle = Join-Path $suiteDir "Invoke-KaizenCycle.ps1"

  Assert-True (Test-Path -PathType Leaf $install) "Install-KaizenTask.ps1 exists"
  Assert-True (Test-Path -PathType Leaf $remove) "Remove-KaizenTask.ps1 exists"
  Assert-True (Test-Path -PathType Leaf $status) "Get-KaizenTaskStatus.ps1 exists"
  Assert-True (Test-Path -PathType Leaf $cycle) "Invoke-KaizenCycle.ps1 exists"

  $r = Run-ExpectOk { & $install $loopId "daily" -Launcher "claude-nine" }
  Assert-True ($r.Code -eq 0) "install dry-run exits 0"
  $installText = ($r.Output | Out-String)
  Assert-True ($installText -match 'schtasks\.exe /Create') "install dry-run prints schtasks command"
  Assert-True ($installText -match '/SC DAILY') "install dry-run uses DAILY schedule"
  Assert-True ($installText -match 'dry-run: LOCAL_STATE\.json not modified') "install dry-run states LOCAL_STATE untouched"

  $localAfter = Get-Content -Raw (Join-Path $loopDir "LOCAL_STATE.json") | ConvertFrom-Json
  Assert-True ($null -eq $localAfter.scheduler.task_name) "install dry-run does not write scheduler.task_name"

  $r = Run-ExpectOk { & $install $loopId "weekly" -Launcher "claude-nine" }
  $installText = ($r.Output | Out-String)
  Assert-True ($installText -match '/SC WEEKLY') "install weekly maps to /SC WEEKLY"

  $r = Run-ExpectOk { & $install $loopId "quarterly" -Launcher "claude-nine" }
  $installText = ($r.Output | Out-String)
  Assert-True ($installText -match 'JAN,APR,JUL,OCT') "install quarterly maps to JAN,APR,JUL,OCT"

  $r = Run-ExpectOk { & $install $loopId "1440" -Launcher "claude-nine" }
  $installText = ($r.Output | Out-String)
  Assert-True ($installText -match '/SC MINUTE') "install minutes maps to /SC MINUTE"

  $r = Run-ExpectOk { & $remove $loopId }
  Assert-True ($r.Code -eq 0) "remove dry-run exits 0"
  $removeText = ($r.Output | Out-String)
  Assert-True ($removeText -match 'schtasks\.exe /Delete') "remove dry-run prints schtasks command"

  $r = Run-ExpectOk { & $status $loopId }
  $statusLine = ($r.Output | Out-String).Trim()
  $statusObj = $null
  try { $statusObj = $statusLine | ConvertFrom-Json } catch { $statusObj = $null }
  Assert-True ($null -ne $statusObj) "status prints parseable JSON"
  if ($null -ne $statusObj) {
    Assert-True ($null -ne $statusObj.PSObject.Properties['installed']) "status has installed field"
    Assert-True ($null -ne $statusObj.PSObject.Properties['task_name']) "status has task_name field"
    Assert-True ($null -ne $statusObj.PSObject.Properties['state']) "status has state field"
    Assert-True ($null -ne $statusObj.PSObject.Properties['last_run_result']) "status has last_run_result field"
    Assert-True ($null -ne $statusObj.PSObject.Properties['from_local_state']) "status has from_local_state field"
    Assert-True ($null -ne $statusObj.PSObject.Properties['dry_run']) "status dry_run flag present under dry-run"
    Assert-True ($statusObj.installed -eq $false) "status dry-run reports installed=false truthfully"
  }

  # The cycle runner's dry-run seam must be testable WITHOUT the env var:
  # clear it, then exercise -DryRun, the real flow, and the lock-skip path.
  Remove-Item Env:\KAIZEN_TASK_DRY_RUN -ErrorAction SilentlyContinue

  $r = Run-ExpectOk { & $cycle $loopId -Launcher "claude-nine" -DryRun }
  Assert-True ($r.Code -eq 0) "cycle dry-run exits 0"
  $cycleText = ($r.Output | Out-String)
  Assert-True ($cycleText -match 'dry-run') "cycle dry-run announces dry-run"
  Assert-True (-not (Test-Path -PathType Leaf $argsFile)) "cycle dry-run does not invoke launcher"

  $r = Run-ExpectOk { & $cycle $loopId -Launcher "claude-nine" }
  Assert-True ($r.Code -eq 0) "cycle run exits 0"
  $cycleText = ($r.Output | Out-String)
  Assert-True (Test-Path -PathType Leaf $argsFile) "fake launcher received arguments"
  if (Test-Path -PathType Leaf $argsFile) {
    # The prompt is delivered to the launcher, not echoed to the cycle's
    # stdout (launcher output is redirected to the cycle log), so the
    # prompt-shape assertions must read the launcher's captured args.
    $argsText = Get-Content -Raw $argsFile
    Assert-True ($argsText -match 'Use the kaizen skill') "cycle prompt is natural-language"
    Assert-True (-not ($argsText -match '/kaizen run')) "cycle prompt has no slash command"
    Assert-True ($argsText -match 'Loop ID loop-tst-01') "launcher got loop id"
  }

  # The lock is owned by kaizen-state.mjs (single writer, memory.md §Cycle
  # lock); the runner reads it. Plant a fresh lock, then a second run must
  # skip without invoking the launcher.
  $lockRecord = [PSCustomObject]@{
    started_at = (Get-Date).ToUniversalTime().ToString("o")
    pid = $PID
    cycle_id = $null
  }
  $lockRecord | ConvertTo-Json -Compress |
    Set-Content -Path (Join-Path $loopDir ".cycle-lock.json") -Encoding UTF8

  $r = Run-ExpectOk { & $cycle $loopId -Launcher "claude-nine" }
  Assert-True ($r.Code -eq 0) "second cycle run exits 0"
  $cycleText = ($r.Output | Out-String)
  Assert-True ($cycleText -match 'skipped') "second run reports skipped"
  Assert-True ($cycleText -match 'cycle lock held since') "second run reports lock reason"
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  $env:PATH = $oldPath
  Remove-Item Env:\KAIZEN_TASK_DRY_RUN -ErrorAction SilentlyContinue
  Remove-Item Env:\KAIZEN_DOWNLOADS -ErrorAction SilentlyContinue
}

Write-Output ""
Write-Output "kaizen-task-self-test: $($Script:Pass) passed, $($Script:Fail) failed"
if ($Script:Fail -gt 0) { exit 1 }
exit 0
