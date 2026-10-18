# blackceo-council.ps1 (CWE-040) - Council of Wise Elders CLI launcher.
#
# Installed by scripts/council-runtime-install.ps1 to
# %LOCALAPPDATA%\BlackCEO\WiseElders\lib\blackceo-council.ps1 and invoked
# through the blackceo-council.cmd shim in
# %LOCALAPPDATA%\BlackCEO\WiseElders\bin. It runs the runtime prefix entry
# (run-council.mjs) through the data profile's `current` junction, so the
# executable never points into a synchronized skill folder (directive
# Section 25.2 step 6).
#
# The runtime prefix lives under the data profile root recorded at
# install time in blackceo-council.profile beside this script. That
# root is NOT the CLI's data directory: BLACKCEO_COUNCIL_DATA_DIR and
# --data-dir override where council STATE lives (Section 16.1), never
# where the installed runtime lives.
#
# ENCODING: pure ASCII, no UTF-8 BOM, LF or CRLF both accepted by
# Windows PowerShell 5.1. A BOM-less .ps1 is decoded as ANSI on 5.1, so a
# non-ASCII byte would be corrupted; do not add one without adding a
# deliberate UTF-8 BOM and updating launchers/windows/tests/.
#
# No POSIX shell, no WSL and no symlink assumption: node.exe is located by
# a fixed native search order, and every path passed to a program is quoted.
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

function Resolve-NodeExe {
    # Fixed order: this script's directory, PATH entries, then the
    # well-known per-machine and per-user Node install roots. Get-Command is
    # deliberately not the primary path: it returns the first PATH match and
    # cannot see a standard install that is missing from PATH.
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add((Join-Path $PSScriptRoot 'node.exe'))
    foreach ($dir in ($env:PATH -split ';')) {
        $trimmed = $dir.Trim().Trim('"')
        if ($trimmed) {
            $candidates.Add((Join-Path $trimmed 'node.exe'))
            $candidates.Add((Join-Path $trimmed 'node.cmd'))
        }
    }
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) {
        if ($root) { $candidates.Add((Join-Path $root 'nodejs\node.exe')) }
    }
    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Volta\bin\node.exe'))
    }
    foreach ($root in @($env:NVM_HOME, $env:NVM_SYMLINK)) {
        if ($root) { $candidates.Add((Join-Path $root 'node.exe')) }
    }
    if ($env:USERPROFILE) {
        $candidates.Add((Join-Path $env:USERPROFILE 'scoop\apps\nodejs\current\node.exe'))
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

$profileRoot = $null
$profileFile = Join-Path $PSScriptRoot 'blackceo-council.profile'
if (Test-Path -LiteralPath $profileFile) {
    $firstLine = Get-Content -LiteralPath $profileFile -TotalCount 1 -Encoding UTF8
    if ($firstLine) { $profileRoot = $firstLine.Trim() }
}
if (-not $profileRoot) {
    $profileRoot = Join-Path $env:LOCALAPPDATA 'BlackCEO\WiseElders'
}
$entry = Join-Path $profileRoot 'runtime\current\run-council.mjs'
if (-not (Test-Path -LiteralPath $entry)) {
    [Console]::Error.WriteLine("blackceo-council: the council runtime is not installed (no $entry).")
    [Console]::Error.WriteLine("  Install it from the 999-setup checkout: scripts\council-runtime-install.ps1")
    exit 4
}
$nodeExe = Resolve-NodeExe
if (-not $nodeExe) {
    [Console]::Error.WriteLine("blackceo-council: Node.js is not runnable (searched this script's directory, PATH, and the standard Node install roots); the council runtime cannot start.")
    exit 4
}
& "$nodeExe" "$entry" @args
exit $LASTEXITCODE
