# WER-004: PowerShell counterpart path test for the Council runtime install.
#
# This exercises the same source resolution and canonical prerequisite probe
# the PowerShell installer uses, through pwsh. It deliberately runs on any OS
# that has pwsh; it is NOT native Windows host execution, which remains
# deferred to WER-027.
#
# Covered here:
#   - a portable source path containing spaces and non-ASCII characters
#     resolves through Resolve-Path / Join-Path and the Node call operator;
#   - the source identity verifies through the shared probe;
#   - the canonical Node/SQLite prerequisite passes through the resolved
#     executable;
#   - the PowerShell installer keeps no WSL, Bash, shebang or symlink
#     creation dependency.
#
# Run: pwsh -NoProfile -File scripts/test-council-install.ps1
param(
    [string]$RepoRoot = '',
    [string]$WorkRoot = ''
)
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$PASS = 0
$FAIL = 0
function Pass($m) { $script:PASS += 1; Write-Host "  ok: $m" }
function Fail($m) { $script:FAIL += 1; Write-Host "  FAIL: $m" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "FAIL: node is not runnable; cannot exercise the PowerShell path"
    exit 1
}
$preflight = Join-Path $RepoRoot 'scripts/council-runtime-preflight.mjs'
$vendored = Join-Path $RepoRoot '.claude/skills/council-of-wise-elders'
$installer = Join-Path $RepoRoot 'scripts/council-runtime-install.ps1'
if (-not (Test-Path -LiteralPath $preflight)) { Write-Host "FAIL: probe missing: $preflight"; exit 1 }
if (-not (Test-Path -LiteralPath $vendored)) { Write-Host "FAIL: vendored tree missing: $vendored"; exit 1 }
if (-not (Test-Path -LiteralPath $installer)) { Write-Host "FAIL: installer missing: $installer"; exit 1 }

$base = if ($WorkRoot) { $WorkRoot } else { Join-Path ([IO.Path]::GetTempPath()) ("999-council-ps-" + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Path $base -Force | Out-Null
try {
    # Spaces, an accent and CJK characters in one Windows-valid path.
    $fixture = Join-Path $base 'council source É 日本 with spaces'
    Copy-Item -LiteralPath $vendored -Destination $fixture -Recurse
    if (Test-Path -LiteralPath (Join-Path $fixture 'manifest.json')) {
        Pass "portable source with spaces and non-ASCII resolves: $fixture"
    } else {
        Fail "portable source with spaces and non-ASCII did not resolve"
    }

    & $node.Source $preflight --verify-source $fixture
    if ($LASTEXITCODE -eq 0) {
        Pass 'source identity verifies through the PowerShell Node call operator'
    } else {
        Fail "source identity failed with exit $LASTEXITCODE"
    }

    & $node.Source $preflight --probe --source $fixture
    if ($LASTEXITCODE -eq 0) {
        Pass 'canonical Node/SQLite prerequisite passes through the resolved executable'
    } else {
        Fail "canonical prerequisite probe failed with exit $LASTEXITCODE"
    }

    $text = Get-Content -LiteralPath $installer -Raw
    if ($text -match '(?im)\b(wsl|bash)\b') {
        Fail 'PowerShell installer references WSL or Bash'
    } else {
        Pass 'PowerShell installer has no WSL or Bash dependency'
    }
    if ($text -match '(?im)New-Item\s+-ItemType\s+(SymbolicLink|HardLink)') {
        Fail 'PowerShell installer creates a symbolic or hard link'
    } else {
        Pass 'PowerShell installer assumes no symlink for the active release'
    }
} finally {
    Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "NOTE: native Windows host execution deferred to WER-027; this is PowerShell path coverage only."
Write-Host "RESULT: $PASS passed, $FAIL failed"
if ($FAIL -gt 0) { exit 1 }
exit 0
