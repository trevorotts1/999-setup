# install-hooks.ps1 - Windows entry for install-hooks.sh (fix #1).
# Runs the SAME merge (tools/install-hooks.sh) through Git Bash with the
# Windows Python interpreter, so both platforms register the hooks one way.
# Registered commands read `python "<root>/hooks/<hook>.py"`.
#
# Usage: install-hooks.ps1 [-Root <config-root>]   (default: $env:CLAUDE_CONFIG_DIR, else %USERPROFILE%\.claude)
# Exit codes are install-hooks.sh's: 0 ok, 1 a hook selftest failed, 2 UNDETERMINED.
# ASCII-only (Windows PowerShell 5.1 reads non-ASCII bytes as ANSI).
#Requires -Version 5.1
param(
    [string]$Root = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' })
)
$ErrorActionPreference = 'Stop'

$bash = $env:CLAUDE_CODE_GIT_BASH_PATH
if (-not $bash -or -not (Test-Path $bash)) { $bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe' }
if (-not (Test-Path $bash)) {
    Write-Host 'INSTALL-HOOKS UNDETERMINED | Git Bash (bash.exe) not found - install Git.Git, then re-run.'
    exit 2
}

# Real execution, not a name lookup: the Microsoft Store "python" alias
# resolves by name but does not run.
$python = $null
foreach ($name in @('python', 'py')) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $c) { continue }
    & $c.Source --version *> $null
    if ($LASTEXITCODE -eq 0) { $python = $c.Source; break }
}
if (-not $python) {
    Write-Host 'INSTALL-HOOKS UNDETERMINED | python not found - install Python.Python.3.12, then re-run.'
    exit 2
}

$script = (Join-Path $PSScriptRoot 'install-hooks.sh') -replace '\\', '/'
$env:INSTALL_HOOKS_PYTHON = $python -replace '\\', '/'
& $bash $script --root ($Root -replace '\\', '/')
$rc = $LASTEXITCODE
Remove-Item Env:INSTALL_HOOKS_PYTHON -ErrorAction SilentlyContinue
exit $rc
