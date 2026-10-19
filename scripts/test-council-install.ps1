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
    [string]$WorkRoot = '',
    [string]$InstallerPath = ''
)
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$PASS = 0
$FAIL = 0
function Pass($m) { $script:PASS += 1; Write-Host "  ok: $m" }
function Fail($m) { $script:FAIL += 1; Write-Host "  FAIL: $m" }

# Remove PowerShell comments from source text using PowerShell's own tokenizer,
# so a `#` inside a bare word (a#), a string or a here-string is never mistaken
# for a comment. Only tokens of kind Comment are blanked; everything else is
# kept at its original offsets. If the source does not parse cleanly, return it
# untouched so the scan fails closed (prose included) instead of dropping code.
function ConvertTo-CodeOnly([string]$src) {
    $tokens = $null; $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errs)
    if ($errs.Count -gt 0) { return $src }
    $sb = New-Object System.Text.StringBuilder($src)
    foreach ($t in $tokens) {
        if ($t.Kind -ne 'Comment') { continue }
        for ($k = $t.Extent.StartOffset; $k -lt $t.Extent.EndOffset; $k++) {
            if ($sb[$k] -ne "`r" -and $sb[$k] -ne "`n") { $sb[$k] = ' ' }
        }
    }
    return $sb.ToString()
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "FAIL: node is not runnable; cannot exercise the PowerShell path"
    exit 1
}
$preflight = Join-Path $RepoRoot 'scripts/council-runtime-preflight.mjs'
$vendored = Join-Path $RepoRoot '.claude/skills/council-of-wise-elders'
# -InstallerPath selects another copy of the installer; the self-test uses it
# to prove the WSL/Bash assertion still fails on a real code dependency.
$installer = if ($InstallerPath) { $InstallerPath } else { Join-Path $RepoRoot 'scripts/council-runtime-install.ps1' }
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

    # Scan executable lines only. Comments are prose, not dependencies: the
    # installer's header says "no WSL" and that must not trip the assertion.
    # Quoted strings are preserved, so a real `bash` call still fails.
    $text = Get-Content -LiteralPath $installer -Raw
    $code = ConvertTo-CodeOnly $text
    # Prove the assertion discriminates before trusting it: a real dependency
    # in code must fail, and the same words in a comment must pass.
    $sampler = @'
# no WSL and no Bash: a comment that says the opposite
<# block: do not invoke bash -c from here #>
$note = "comment marker # is not a comment"
& bash -c "echo x"
'@
    $samplerCode = ConvertTo-CodeOnly $sampler
    if ($samplerCode -notmatch '(?im)\bbash\b') {
        Fail 'WSL/Bash scan self-test: a real code dependency was not detected'
    } elseif ($samplerCode -match 'do not invoke|no WSL and no Bash') {
        Fail 'WSL/Bash scan self-test: a comment was not stripped'
    } else {
        Pass 'WSL/Bash scan self-test: code dependency fails, comments pass'
    }
    # A `#` inside a bare word is not a comment: the `& bash` after it is code.
    if ((ConvertTo-CodeOnly 'Write-Output a#; & bash -c "echo x"') -notmatch '(?im)\bbash\b') {
        Fail 'WSL/Bash scan self-test: code after a bare-word # was dropped'
    } else {
        Pass 'WSL/Bash scan self-test: bare-word # does not start a comment'
    }
    # Self-check: the stripper must keep code and drop comments. If it fails
    # to strip, the assertion below would silently pass a broken installer.
    if ($code -notmatch '(?m)^\s*param\(' -or $code -match 'No POSIX shell') {
        Fail 'comment stripper is not reducing the installer to executable lines'
    }
    if ($code -match '(?im)\b(wsl|bash)\b') {
        Fail 'PowerShell installer references WSL or Bash'
    } else {
        Pass 'PowerShell installer has no WSL or Bash dependency'
    }
    if ($code -match '(?im)New-Item\s+-ItemType\s+(SymbolicLink|HardLink)') {
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
