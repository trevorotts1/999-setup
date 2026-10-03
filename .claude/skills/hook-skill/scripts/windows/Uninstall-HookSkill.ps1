<#
.SYNOPSIS
  Removes only what Install-HookSkill.ps1 added: our hook entries in settings.json (claude and claude-nine),
  the HookSkill-* scheduled tasks, and the files in the install manifest.
.PARAMETER Purge
  Also delete runtime data (logs, state databases) and the default hook-skill.json.
#>
[CmdletBinding()]
param([switch]$Purge, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Common = (Resolve-Path (Join-Path $PSScriptRoot '..\common')).Path
$Hooks  = Join-Path $HOME '.claude\hooks'
$Py = $null
foreach ($cand in @($env:PYTHON, 'python', 'py')) {
  if (-not $cand) { continue }
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if (-not $cmd) { continue }
  $prefix = @(); if ($cand -eq 'py') { $prefix = @('-3') }
  $exe = & $cmd.Source @prefix -c "import sys; print(sys.executable)" 2>$null
  if ($LASTEXITCODE -eq 0 -and $exe) { $Py = $exe.Trim(); break }
}
if (-not $Py) { Write-Error 'python not found'; exit 1 }
$dry = @(); if ($DryRun) { $dry = @('--dry-run') }
foreach ($s in @((Join-Path $HOME '.claude\settings.json'), (Join-Path $HOME '.claude-nine\settings.json'))) {
  if (Test-Path $s) { & $Py (Join-Path $Common 'settings_merge.py') unregister --settings $s --hooks-dir $Hooks @dry }
}
foreach ($t in 'HookSkill-Watchdog', 'HookSkill-Hygiene', 'HookSkill-DiskCleanup') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    if ($DryRun) { Write-Host "would remove scheduled task $t" } else { Unregister-ScheduledTask -TaskName $t -Confirm:$false; Write-Host "removed scheduled task $t" }
  }
}
$purgeArg = @(); if ($Purge) { $purgeArg = @('--purge') }
& $Py (Join-Path $Common 'hookskill_files.py') uninstall --dest $Hooks @purgeArg @dry
if ($DryRun) { Write-Host 'dry-run: nothing was removed.' } else { Write-Host 'Hook Skill removed. Restart Claude Code to unload the hooks.' }
