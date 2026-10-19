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

# Remove PowerShell comments from source text, keeping quoted strings.
# Line comments start at `#` outside a string; block comments are <# ... #>.
# Here-strings are kept whole (they are data the script may execute).
function ConvertTo-CodeOnly([string]$src) {
    $out = New-Object System.Text.StringBuilder
    $i = 0
    $n = $src.Length
    while ($i -lt $n) {
        $c = $src[$i]
        # Here-string opener: @' or @" followed by newline, ended by '@ or "@
        if (($c -eq '@') -and $i + 2 -lt $n -and ($src[$i + 1] -eq "'" -or $src[$i + 1] -eq '"') -and $src[$i + 2] -eq "`n") {
            $q = $src[$i + 1]
            $close = $q + '@'
            $end = $src.IndexOf("`n" + $close, $i + 2)
            if ($end -lt 0) { [void]$out.Append($src.Substring($i)); break }
            $end = $end + 1 + $close.Length
            [void]$out.Append($src.Substring($i, $end - $i))
            $i = $end
            continue
        }
        if ($c -eq "'" -or $c -eq '"') {
            $q = $c
            [void]$out.Append($c); $i++
            while ($i -lt $n) {
                [void]$out.Append($src[$i])
                if ($src[$i] -eq '`' -and $q -eq '"' -and $i + 1 -lt $n) {
                    $i++; [void]$out.Append($src[$i])
                } elseif ($src[$i] -eq $q) {
                    if ($i + 1 -lt $n -and $src[$i + 1] -eq $q) { $i++; [void]$out.Append($src[$i]) }
                    else { break }
                }
                $i++
            }
            $i++
            continue
        }
        if ($c -eq '<' -and $i + 2 -lt $n -and $src[$i + 1] -eq '#') {
            $end = $src.IndexOf('#>', $i + 2)
            if ($end -lt 0) { break }
            $i = $end + 2
            continue
        }
        if ($c -eq '#') {
            while ($i -lt $n -and $src[$i] -ne "`n") { $i++ }
            continue
        }
        [void]$out.Append($c)
        $i++
    }
    return $out.ToString()
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
