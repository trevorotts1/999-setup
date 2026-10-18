# Council of Wise Elders: runtime installer for 999-distributed installs
# on Windows (CWE-040; directive Section 25.2 steps 5 and 6, Section
# 16.1). Mirrors scripts/council-runtime-install.sh.
#
#   1. Finds the installed council skill folder (through a Claude config
#      root junction) and reads its distribution identity
#      (manifest.json aggregate hash). Resolves the portable source that
#      actually feeds the install: -SourceDir, then
#      COUNCIL_CANONICAL_SOURCE, then the installed skill folder. The
#      resolved tree must recompute to its own manifest and carry
#      canonical provenance; a hand-edited copy is refused instead of
#      being treated as a separately editable product.
#   2. Runs the canonical Node/SQLite prerequisite probe through the exact
#      resolved Node executable. A failed probe stops before staging and
#      the previous release is untouched.
#   3. Stages the runtime payload into a versioned per-user prefix
#      outside every config/discovery root:
#      %LOCALAPPDATA%\BlackCEO\WiseElders\runtime\<aggregate>
#      Node modules exist only inside that prefix, never in the shared
#      synchronized skill folder. The generated Claude-Nine host wrapper
#      is emitted into the staged dist from the CWE-010 template in the
#      vendored runtime (renderClaudeNineWrapper()).
#   3. Gates the staged prefix: the package doctor must pass on the
#      installed skill folder, and the staged CLI doctor (through the
#      generated wrapper and the bundle resolver) must exit 0.
#   4. Points the prefix's `current` junction at the gated build. A
#      failed gate leaves `current` exactly as it was, and a failed prefix
#      replacement restores the previous prefix before dying.
#   5. Installs the blackceo-council executable pair (cmd shim on PATH
#      in %LOCALAPPDATA%\BlackCEO\WiseElders\bin, ps1 off PATH in
#      %LOCALAPPDATA%\BlackCEO\WiseElders\lib) and adds the bin dir to
#      the user PATH when absent. A foreign file at the shim path is
#      never overwritten; the install refuses and says why.
#
# Usage:
#   scripts\council-runtime-install.ps1 [-SkillDir DIR] [-SourceDir DIR]
#                                       [-DataDir DIR] [-Offline] [-Check]
# Exit codes: 0 ok; 4 preflight (including source integrity and the Node
# prerequisite probe); 5 dependency install failed; 6 build failed;
# 7 doctor gate failed.
#
# ENCODING: pure ASCII, no UTF-8 BOM, LF or CRLF both accepted by Windows
# PowerShell 5.1. A BOM-less .ps1 is decoded as ANSI on 5.1, so a non-ASCII
# byte would be corrupted; launchers/windows/tests/ enforces this.
#
# No POSIX shell, no WSL and no symlink assumption: node.exe and npm.cmd are
# located by a fixed native search order, and every path handed to a program
# is quoted. Generated files are written as UTF-8 without a BOM through .NET
# (Windows PowerShell 5.1 predates the BOM-less UTF-8 encoding name).
# The only write outside the per-user data profile is the CURRENT-USER Path
# environment variable; no machine-wide registry value is written.
param(
    [string]$SkillDir = '',
    [string]$SourceDir = '',
    [string]$DataDir = '',
    [switch]$Offline,
    [switch]$Check
)
$ErrorActionPreference = 'Stop'

function Say($msg) { Write-Host "council-runtime-install: $msg" }
function Die($code, $msg, $exit) {
    [Console]::Error.WriteLine("council-runtime-install: ERROR $code`: $msg")
    exit $exit
}

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$RepoRoot = Split-Path -Parent $ScriptDir

function Resolve-NodeExe {
    # Fixed order: this script's directory, PATH entries, then the
    # well-known per-machine and per-user Node install roots.
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add((Join-Path $ScriptDir 'node.exe'))
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

function Resolve-NpmCmd($nodeExe) {
    # npm.cmd ships beside node.exe; check that directory first, then PATH
    # and the same well-known roots.
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($nodeExe) { $candidates.Add((Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd')) }
    foreach ($dir in ($env:PATH -split ';')) {
        $trimmed = $dir.Trim().Trim('"')
        if ($trimmed) { $candidates.Add((Join-Path $trimmed 'npm.cmd')) }
    }
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432)) {
        if ($root) { $candidates.Add((Join-Path $root 'nodejs\npm.cmd')) }
    }
    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd'))
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

# --- data profile (mirrors runtime/src/cli/paths.ts Section 16.1) -------
if (-not $DataDir) {
    if ($env:BLACKCEO_COUNCIL_DATA_DIR) { $DataDir = $env:BLACKCEO_COUNCIL_DATA_DIR }
    else { $DataDir = Join-Path $env:LOCALAPPDATA 'BlackCEO\WiseElders' }
}

# --- preflight: prove node and npm by execution, never by lookup --------
# This runs before any file is written or removed (launchers/windows/tests/
# asserts that ordering on the bytes).
$nodeExe = Resolve-NodeExe
if (-not $nodeExe) { Die 'COUNCIL_NODE_MISSING' 'Node.js is not runnable (searched this script directory, PATH, and the standard Node install roots); the council runtime cannot install or run' 4 }
try { $nodeVersion = (& "$nodeExe" --version 2>&1 | Out-String).Trim() } catch { Die 'COUNCIL_NODE_MISSING' 'Node.js is not runnable (searched this script directory, PATH, and the standard Node install roots); the council runtime cannot install or run' 4 }
if ($LASTEXITCODE -ne 0) { Die 'COUNCIL_NODE_MISSING' 'Node.js is not runnable (searched this script directory, PATH, and the standard Node install roots); the council runtime cannot install or run' 4 }
$npmExe = Resolve-NpmCmd "$nodeExe"
if (-not $npmExe) { Die 'COUNCIL_NPM_MISSING' 'npm is not runnable; the council runtime dependencies cannot be installed' 4 }
try { & "$npmExe" --version | Out-Null } catch { Die 'COUNCIL_NPM_MISSING' 'npm is not runnable; the council runtime dependencies cannot be installed' 4 }
if ($LASTEXITCODE -ne 0) { Die 'COUNCIL_NPM_MISSING' 'npm is not runnable; the council runtime dependencies cannot be installed' 4 }

# UTF-8 without a BOM, written through .NET. Windows PowerShell 5.1 has no
# BOM-less UTF-8 encoding name, and its `>` redirection emits UTF-16LE, which
# Node cannot parse as JavaScript.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8File($path, $text) {
    [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
}

# --- locate the installed skill folder -----------------------------------
if (-not $SkillDir) {
    $primary = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
    foreach ($cand in @(
        (Join-Path $primary 'skills\council-of-wise-elders'),
        (Join-Path $env:USERPROFILE '.claude\skills\council-of-wise-elders'),
        (Join-Path $RepoRoot '.claude\skills\council-of-wise-elders'))) {
        if (Test-Path (Join-Path $cand 'manifest.json')) { $SkillDir = $cand; break }
    }
}
if (-not $SkillDir -or -not (Test-Path -LiteralPath (Join-Path $SkillDir 'manifest.json'))) {
    Die 'COUNCIL_SKILL_NOT_FOUND' 'no installed council-of-wise-elders skill folder with manifest.json was found' 4
}
$SkillDir = (Resolve-Path -LiteralPath $SkillDir).Path
Say "skill folder: $SkillDir"

# --- resolve the canonical portable source --------------------------------
# The runtime payload is never taken from an unverified copy. The resolved
# tree must recompute to its own manifest and carry canonical provenance;
# a hand-edited copy stops here. Native Windows paths (spaces, Unicode,
# drive letters) are passed through the call operator without a shell.
if ($SourceDir) { $resolvedSource = $SourceDir }
elseif ($env:COUNCIL_CANONICAL_SOURCE) { $resolvedSource = $env:COUNCIL_CANONICAL_SOURCE }
else { $resolvedSource = $SkillDir }
if (-not $resolvedSource -or -not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
    Die 'COUNCIL_SOURCE_NOT_FOUND' "portable source directory not found: $resolvedSource" 4
}
$SourceDir = (Resolve-Path -LiteralPath $resolvedSource).Path
if (-not (Test-Path -LiteralPath (Join-Path $SourceDir 'manifest.json'))) {
    Die 'COUNCIL_SOURCE_NOT_FOUND' "portable source has no manifest.json: $SourceDir" 4
}
$preflight = Join-Path $ScriptDir 'council-runtime-preflight.mjs'
if (-not (Test-Path -LiteralPath $preflight)) {
    Die 'COUNCIL_PREFLIGHT_MISSING' "prerequisite probe missing beside this script: $preflight" 4
}
& "$nodeExe" "$preflight" --verify-source "$SourceDir"
if ($LASTEXITCODE -ne 0) {
    Die 'COUNCIL_SOURCE_INTEGRITY_FAILED' "the portable source at $SourceDir does not recompute to its own manifest, or carries no canonical provenance. A copied or hand-edited folder is not an install source; the previous release was not touched" 4
}
& "$nodeExe" "$preflight" --probe --source "$SourceDir"
if ($LASTEXITCODE -ne 0) {
    Die 'COUNCIL_NODE_PREREQ_FAILED' "the resolved Node executable $nodeExe failed the canonical Council prerequisite probe (Node ^22.13.0 || >=24 with node:sqlite). Nothing was staged; the previous release is unchanged" 4
}
$sourceDoctor = Join-Path $SourceDir 'scripts\doctor.mjs'
& "$nodeExe" "$sourceDoctor" --root "$SourceDir" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Die 'COUNCIL_SOURCE_DOCTOR_FAILED' "the portable source at $SourceDir does not pass its own package doctor; the previous release was not touched" 4
}

$manifest = Get-Content -LiteralPath (Join-Path $SourceDir 'manifest.json') -Raw | ConvertFrom-Json
$aggregate = $manifest.aggregate_sha256
if (-not $aggregate) { Die 'COUNCIL_SKILL_MANIFEST_INVALID' "could not read aggregate_sha256 from $SourceDir\manifest.json" 4 }
Say "portable source: $SourceDir"
Say "distribution aggregate: $aggregate"

$runtimeDir = Join-Path $DataDir 'runtime'
$prefix = Join-Path $runtimeDir $aggregate
$current = Join-Path $runtimeDir 'current'

function Test-PrefixGates($root) {
    $skillDoctor = Join-Path $SkillDir 'scripts\doctor.mjs'
    & "$nodeExe" "$skillDoctor" --root "$SkillDir" | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    $gateEntry = Join-Path $root 'run-council.mjs'
    if (-not (Test-Path -LiteralPath $gateEntry)) { return $false }
    & "$nodeExe" "$gateEntry" doctor --data-dir "$DataDir" | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    return $true
}

if ($Check) {
    $target = $null
    if (Test-Path $current) {
        $item = Get-Item $current -Force
        if ($item.Target) { $target = Split-Path $item.Target -Leaf }
    }
    if ($target -eq $aggregate) {
        Say "current: $aggregate (matches the installed skill)"
    } elseif ($target) {
        Say "current: $target (does not match the installed skill aggregate)"
    } else {
        Say 'current: not installed'
        exit 1
    }
    if (Test-PrefixGates $prefix) { Say 'doctor gates: PASS'; exit 0 }
    Say 'doctor gates: FAIL'; exit 1
}

# --- reuse a complete gated prefix ----------------------------------------
$reused = $false
if ((Test-Path (Join-Path $prefix '.install-complete')) -and (Test-PrefixGates $prefix)) {
    Say "prefix already installed and gated: $prefix"
    $reused = $true
}
if (-not $reused) {
    $stage = Join-Path $runtimeDir ".staging-$aggregate-$PID"
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $sourceRuntime = Join-Path $SourceDir 'runtime'
    Copy-Item -LiteralPath "$sourceRuntime" -Destination (Join-Path $stage 'runtime') -Recurse
    # Build outputs are regenerated below; never carried into the prefix.
    Remove-Item -LiteralPath (Join-Path $stage 'runtime\node_modules') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $stage 'runtime\dist') -Recurse -Force -ErrorAction SilentlyContinue
    $runCouncilSrc = Join-Path $ScriptDir 'council\run-council.mjs'
    $resolverSrc = Join-Path $ScriptDir 'council\bundle-native-resolver.mjs'
    Copy-Item -LiteralPath "$runCouncilSrc" -Destination (Join-Path $stage 'run-council.mjs')
    Copy-Item -LiteralPath "$resolverSrc" -Destination (Join-Path $stage 'bundle-native-resolver.mjs')

    $npmFlags = @('ci', '--no-audit', '--no-fund')
    if ($Offline) { $npmFlags += '--offline' }
    Say 'installing runtime dependencies (npm ci)...'
    $npmLog = Join-Path $stage 'npm-ci.log'
    Push-Location (Join-Path $stage 'runtime')
    & "$npmExe" @npmFlags *> "$npmLog"
    $ciRc = $LASTEXITCODE
    Pop-Location
    if ($ciRc -ne 0) {
        Get-Content -LiteralPath "$npmLog" -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        if ($Offline) {
            Die 'COUNCIL_NPM_OFFLINE_CACHE_MISS' 'npm ci --offline failed: a pinned dependency is not in the local npm cache, and this install was asked to stay offline. Re-run without -Offline on a connected machine. Staging was removed; current is unchanged' 5
        }
        Die 'COUNCIL_NPM_CI_FAILED' 'npm ci failed for the pinned runtime dependencies (log tail above). Staging was removed; current is unchanged' 5
    }
    Say 'building the runtime (tsc + esbuild bundle)...'
    $buildLog = Join-Path $stage 'build.log'
    Push-Location (Join-Path $stage 'runtime')
    & "$npmExe" run build *> "$buildLog"
    $buildRc = $LASTEXITCODE
    Pop-Location
    if ($buildRc -ne 0) {
        Get-Content -LiteralPath "$buildLog" -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_BUILD_FAILED' 'the runtime build failed (log tail above). Staging was removed; current is unchanged' 6
    }
    # The canonical bundle step (copy-runtime-assets.mjs, CWE-039 F-1)
    # copies the persistence schema SQL into dist at build time; the
    # persistence layer loads it relative to its module, so its absence
    # would only surface when the store first opens. Assert it landed.
    $schemaFile = Join-Path $stage 'runtime\dist\migrations\0001-council-schema.sql'
    if (-not (Test-Path -LiteralPath $schemaFile)) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_BUILD_FAILED' 'the built runtime is missing dist\migrations\0001-council-schema.sql (the canonical copy-runtime-assets step did not run). Staging was removed; current is unchanged' 6
    }
    # Emit the generated Claude-Nine host wrapper from the CWE-010 template.
    # The render runs through the staged runtime's own tsx: the canonical
    # contracts package uses extensionless import specifiers, which plain
    # Node ESM cannot resolve from source or tsc output.
    $emitFile = Join-Path $stage 'emit-wrapper.mts'
    $emitSource = @('import { renderClaudeNineWrapper } from "./runtime/src/bridges/claude-nine.ts";',
      'process.stdout.write(renderClaudeNineWrapper());') -join "`n"
    Write-Utf8File "$emitFile" ("$emitSource`n")
    $tsxCmd = Join-Path $stage 'runtime\node_modules\.bin\tsx.cmd'
    $wrapperFile = Join-Path $stage 'runtime\dist\claude-nine-host-wrapper.mjs'
    $wrapperText = & "$tsxCmd" "$emitFile"
    $emitRc = $LASTEXITCODE
    Remove-Item -LiteralPath $emitFile -Force -ErrorAction SilentlyContinue
    if ($emitRc -ne 0) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_BUILD_FAILED' 'emitting the generated host wrapper from the CWE-010 template failed. Staging was removed; current is unchanged' 6
    }
    Write-Utf8File "$wrapperFile" ((($wrapperText -join "`n")) + "`n")
    if (-not (Select-String -LiteralPath "$wrapperFile" -Pattern 'createClaudeNineBridge' -Quiet)) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_BUILD_FAILED' 'the generated host wrapper does not compose createClaudeNineBridge. Staging was removed; current is unchanged' 6
    }
    # Bundle the runnable entry with the runtime's own esbuild (the same
    # mechanism as the package's own blackceo-council bin): the entry
    # composes the emitted wrapper with the bundle native resolver.
    $entryFile = Join-Path $stage 'runtime\bundle-entry.mjs'
    $entrySource = @('import { readFileSync } from "node:fs";',
      'import { createClaudeNineHost, main } from "./dist/claude-nine-host-wrapper.mjs";',
      'import { runCli } from "./dist/cli/dispatcher.js";',
      'import { bundleNativeResolver } from "../bundle-native-resolver.mjs";',
      'let skillRoot = null;',
      'try { skillRoot = JSON.parse(readFileSync(new URL("../../install-record.json", import.meta.url), "utf8")).skill_dir ?? null; } catch {}',
      'if (skillRoot) {',
      '  process.exitCode = await runCli(process.argv.slice(2), undefined, {',
      '    createHost: (opts) => createClaudeNineHost(bundleNativeResolver, { ...opts, skillRoot }),',
      '  });',
      '} else {',
      '  process.exitCode = await main(process.argv.slice(2), bundleNativeResolver, undefined);',
      '}') -join "`n"
    Write-Utf8File "$entryFile" ("$entrySource`n")
    $esbuildCmd = Join-Path $stage 'runtime\node_modules\.bin\esbuild.cmd'
    $entryOut = Join-Path $stage 'runtime\dist\council-entry.mjs'
    $entryLog = Join-Path $stage 'entry.log'
    & "$esbuildCmd" "$entryFile" --bundle --platform=node --format=esm --target=node20 "--outfile=$entryOut" *> "$entryLog"
    $entryRc = $LASTEXITCODE
    Remove-Item -LiteralPath $entryFile -Force -ErrorAction SilentlyContinue
    if ($entryRc -ne 0) {
        Get-Content -LiteralPath "$entryLog" -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_BUILD_FAILED' 'bundling the council entry failed. Staging was removed; current is unchanged' 6
    }
    $installRecord = @{ aggregate = $aggregate; skill_dir = $SkillDir; source_dir = $SourceDir; node = $nodeVersion } | ConvertTo-Json
    Write-Utf8File (Join-Path $stage 'install-record.json') "$installRecord`n"

    Say 'gating the staged prefix (package doctor + CLI doctor)...'
    if (-not (Test-PrefixGates $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Die 'COUNCIL_DOCTOR_FAILED' 'the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged' 7
    }
    Write-Utf8File (Join-Path $stage '.install-complete') "ok`n"
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    # Replace the prefix without ever leaving the previous release absent:
    # move the old tree aside, move the gated tree in, restore the old tree
    # if the move fails. The old tree is deleted only after success.
    $previousPrefix = Join-Path $runtimeDir ".previous-$aggregate-$PID"
    if (Test-Path -LiteralPath $previousPrefix) { Remove-Item -LiteralPath $previousPrefix -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $prefix) {
        Move-Item -LiteralPath $prefix -Destination $previousPrefix
    }
    try {
        Move-Item -LiteralPath $stage -Destination $prefix
    } catch {
        if ((Test-Path -LiteralPath $previousPrefix) -and -not (Test-Path -LiteralPath $prefix)) {
            Move-Item -LiteralPath $previousPrefix -Destination $prefix
        }
        Die 'COUNCIL_SWAP_FAILED' 'could not move the gated prefix into place; the previous release was restored' 7
    }
    if (Test-Path -LiteralPath $previousPrefix) { Remove-Item -LiteralPath $previousPrefix -Recurse -Force -ErrorAction SilentlyContinue }
    Say "prefix installed: $prefix"
}

# --- current junction swap --------------------------------------------------
# F-046-2 hardening (CWE-048): never delete `current` before its
# replacement exists. The old junction is renamed aside first (a
# rename moves the link itself, never its target), the new junction is
# created at `current`, and only then is the renamed-aside link
# removed. If creating the new junction fails, the old link is moved
# back and the swap dies with COUNCIL_SWAP_FAILED, so a failed swap
# leaves the previous current in place instead of none.
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$previous = Join-Path $runtimeDir ".current.previous.$PID"
if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue }
$hadCurrent = Test-Path -LiteralPath $current
if ($hadCurrent) { Move-Item -LiteralPath $current -Destination $previous }
try {
    New-Item -ItemType Junction -Path $current -Target $prefix | Out-Null
} catch {
    if ($hadCurrent -and (Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $current)) {
        Move-Item -LiteralPath $previous -Destination $current
    }
    Die 'COUNCIL_SWAP_FAILED' 'could not swap the current junction' 7
}
if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue }
Say "current -> $aggregate"

# --- the blackceo-council executable pair -----------------------------------
$binDir = Join-Path $DataDir 'bin'
$libDir = Join-Path $DataDir 'lib'
$cmdDest = Join-Path $binDir 'blackceo-council.cmd'
$ps1Dest = Join-Path $libDir 'blackceo-council.ps1'
$cmdSrc = Join-Path $RepoRoot 'launchers\windows\blackceo-council.cmd'
$ps1Src = Join-Path $RepoRoot 'launchers\windows\blackceo-council.ps1'
if ((Test-Path -LiteralPath $cmdDest) -and -not (Select-String -LiteralPath $cmdDest -Pattern 'CWE-040' -Quiet)) {
    Die 'COUNCIL_EXECUTABLE_FOREIGN' "$cmdDest exists and is not the council executable; refusing to overwrite it. Move it aside and re-run" 4
}
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
New-Item -ItemType Directory -Path $libDir -Force | Out-Null
Copy-Item -LiteralPath "$cmdSrc" -Destination "$cmdDest" -Force
Copy-Item -LiteralPath "$ps1Src" -Destination "$ps1Dest" -Force
# The profile holds a path that may contain non-ASCII (a user name), so it is
# written as UTF-8 without a BOM; the launcher reads it with -Encoding UTF8.
Write-Utf8File (Join-Path $libDir 'blackceo-council.profile') "$DataDir`n"
Say "executable: $cmdDest"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $binDir) {
    $newUserPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
    [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    Say "user PATH: added $binDir (new shells pick it up)"
} else {
    Say "user PATH: $binDir already present"
}

Say "OK: council runtime $aggregate is current; data profile $DataDir"
exit 0
