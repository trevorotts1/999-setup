<#
.SYNOPSIS
  Hook Skill installer for Windows (PowerShell 5.1+ or 7).
.DESCRIPTION
  Copies the hooks to ~\.claude\hooks\<name>\, registers them in ~\.claude\settings.json and (when the folder
  exists) ~\.claude-nine\settings.json by appending to existing hook entries, validates the JSON, and creates
  Task Scheduler jobs. Defaults ON: workflow-guard, hygiene, disk-cleanup. Opt-in: ask-before-backup, question-gate.
.EXAMPLE
  .\Install-HookSkill.ps1 -WithQuestionGate -WithAskBeforeBackup
#>
[CmdletBinding()]
param(
  [switch]$WithAskBeforeBackup, [switch]$WithQuestionGate,
  [switch]$NoWorkflowGuard, [switch]$NoHygiene, [switch]$NoDiskCleanup,
  [switch]$NoSchedule, [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Skill   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Common  = Join-Path $Skill 'scripts\common'
$Hooks   = Join-Path $HOME '.claude\hooks'
$Version = (Get-Content (Join-Path $Skill 'VERSION') -Raw).Trim()

# Python is required: every hook is a Python script.
$Py = $null
foreach ($cand in @($env:PYTHON, 'python', 'py')) {
  if (-not $cand) { continue }
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if (-not $cmd) { continue }
  $prefix = @(); if ($cand -eq 'py') { $prefix = @('-3') }
  $exe = & $cmd.Source @prefix -c "import sys; print(sys.executable if sys.version_info >= (3, 8) else '')" 2>$null
  if ($LASTEXITCODE -eq 0 -and $exe) { $Py = $exe.Trim(); break }
}
if (-not $Py) { Write-Error 'Hook Skill needs Python 3.8+ (python or py on PATH). Install it and re-run.'; exit 1 }
$HaveNode = [bool](Get-Command node -ErrorAction SilentlyContinue)

$WG = -not $NoWorkflowGuard; $HY = -not $NoHygiene; $DC = -not $NoDiskCleanup
$comps = @()
if ($WG) { $comps += 'workflow-guard' }
if ($HY) { $comps += 'hygiene' }
if ($WithAskBeforeBackup) { $comps += 'ask-before-backup' }
if ($WithQuestionGate) { $comps += 'question-gate' }
$files = @($comps); if ($DC) { $files += 'disk-cleanup' }
if ($files.Count -eq 0) { Write-Error 'nothing selected to install'; exit 64 }
$dry = @(); if ($DryRun) { $dry = @('--dry-run') }

Write-Host "Hook Skill $Version: installing [$($files -join ',')] into $Hooks (python: $Py)"
if ($WG -and -not $HaveNode) { Write-Host 'note: Node.js not found; workflow-guard will not validate Workflow launches until Node.js 18+ is installed (it never blocks them).' }

& $Py (Join-Path $Common 'hookskill_files.py') install --src (Join-Path $Skill 'hooks') --dest $Hooks --components ($files -join ',') --version $Version @dry
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$settings = @((Join-Path $HOME '.claude\settings.json'))
if (Test-Path (Join-Path $HOME '.claude-nine')) { $settings += (Join-Path $HOME '.claude-nine\settings.json') }
if ($comps.Count -gt 0) {
  foreach ($s in ($settings | Select-Object -Unique)) {
    & $Py (Join-Path $Common 'settings_merge.py') register --settings $s --python $Py --hooks-dir $Hooks --components ($comps -join ',') @dry
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
}

function New-HookSkillTask($Name, $Trigger, $Script, $ScriptArgs) {
  if ($DryRun) { Write-Host "would register scheduled task $Name"; return }
  $pyw = Join-Path (Split-Path $Py) 'pythonw.exe'; if (-not (Test-Path $pyw)) { $pyw = $Py }   # pythonw = no console window
  $argLine = ('"{0}" {1}' -f $Script, $ScriptArgs).Trim()
  $action = New-ScheduledTaskAction -Execute $pyw -Argument $argLine
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger -Settings $set -Description 'Hook Skill sweep' -Force | Out-Null
  Write-Host "registered scheduled task $Name"
}
if (-not $NoSchedule) {
  if ($WG) { New-HookSkillTask 'HookSkill-Watchdog' (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)) (Join-Path $Hooks 'workflow-guard\guard.py') 'tick' }
  if ($HY) { New-HookSkillTask 'HookSkill-Hygiene' (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)) (Join-Path $Hooks 'hygiene\post_merge_hygiene.py') 'sweep' }
  if ($DC) { New-HookSkillTask 'HookSkill-DiskCleanup' (New-ScheduledTaskTrigger -Daily -At 3:30AM) (Join-Path $Hooks 'disk-cleanup\disk_cleanup.py') '' }
}
if ($DryRun) { Write-Host 'dry-run: nothing was written.' } else { Write-Host "Done. Restart Claude Code (and claude-nine). Per-user settings: $Hooks\hook-skill.json" }
