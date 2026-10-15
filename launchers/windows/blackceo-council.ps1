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
$ErrorActionPreference = 'Stop'

$profileRoot = $null
$profileFile = Join-Path $PSScriptRoot 'blackceo-council.profile'
if (Test-Path $profileFile) {
    $profileRoot = (Get-Content $profileFile -TotalCount 1).Trim()
}
if (-not $profileRoot) {
    $profileRoot = Join-Path $env:LOCALAPPDATA 'BlackCEO\WiseElders'
}
$entry = Join-Path $profileRoot 'runtime\current\run-council.mjs'
if (-not (Test-Path $entry)) {
    [Console]::Error.WriteLine("blackceo-council: the council runtime is not installed (no $entry).")
    [Console]::Error.WriteLine("  Install it from the 999-setup checkout: scripts\council-runtime-install.ps1")
    exit 4
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    [Console]::Error.WriteLine("blackceo-council: Node.js is not runnable on PATH; the council runtime cannot start.")
    exit 4
}
& $node.Source $entry @args
exit $LASTEXITCODE
