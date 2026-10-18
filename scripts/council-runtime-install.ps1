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

# --- data profile (mirrors runtime/src/cli/paths.ts Section 16.1) -------
if (-not $DataDir) {
    if ($env:BLACKCEO_COUNCIL_DATA_DIR) { $DataDir = $env:BLACKCEO_COUNCIL_DATA_DIR }
    else { $DataDir = Join-Path $env:LOCALAPPDATA 'BlackCEO\WiseElders' }
}

# --- preflight: prove node and npm by execution, never by lookup --------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'COUNCIL_NODE_MISSING' 'Node.js is not runnable on PATH; the council runtime cannot install or run' 4 }
& $node.Source --version | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'COUNCIL_NODE_MISSING' 'Node.js is not runnable on PATH; the council runtime cannot install or run' 4 }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { Die 'COUNCIL_NPM_MISSING' 'npm is not runnable on PATH; the council runtime dependencies cannot be installed' 4 }
& $npm.Source --version | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'COUNCIL_NPM_MISSING' 'npm is not runnable on PATH; the council runtime dependencies cannot be installed' 4 }

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
& $node.Source $preflight --verify-source $SourceDir
if ($LASTEXITCODE -ne 0) {
    Die 'COUNCIL_SOURCE_INTEGRITY_FAILED' "the portable source at $SourceDir does not recompute to its own manifest, or carries no canonical provenance. A copied or hand-edited folder is not an install source; the previous release was not touched" 4
}
& $node.Source $preflight --probe --source $SourceDir
if ($LASTEXITCODE -ne 0) {
    Die 'COUNCIL_NODE_PREREQ_FAILED' "the resolved Node executable $($node.Source) failed the canonical Council prerequisite probe (Node ^22.13.0 || >=24 with node:sqlite). Nothing was staged; the previous release is unchanged" 4
}
& $node.Source (Join-Path $SourceDir 'scripts\doctor.mjs') --root $SourceDir | Out-Null
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
    & $node.Source (Join-Path $SkillDir 'scripts\doctor.mjs') --root $SkillDir | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    if (-not (Test-Path (Join-Path $root 'run-council.mjs'))) { return $false }
    & $node.Source (Join-Path $root 'run-council.mjs') doctor --data-dir $DataDir | Out-Null
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
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceDir 'runtime') -Destination (Join-Path $stage 'runtime') -Recurse
    # Build outputs are regenerated below; never carried into the prefix.
    Remove-Item (Join-Path $stage 'runtime\node_modules') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $stage 'runtime\dist') -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $ScriptDir 'council\run-council.mjs') (Join-Path $stage 'run-council.mjs')
    Copy-Item (Join-Path $ScriptDir 'council\bundle-native-resolver.mjs') (Join-Path $stage 'bundle-native-resolver.mjs')

    $npmFlags = @('ci', '--no-audit', '--no-fund')
    if ($Offline) { $npmFlags += '--offline' }
    Say 'installing runtime dependencies (npm ci)...'
    Push-Location (Join-Path $stage 'runtime')
    & $npm.Source @npmFlags *> (Join-Path $stage 'npm-ci.log')
    $ciRc = $LASTEXITCODE
    Pop-Location
    if ($ciRc -ne 0) {
        Get-Content (Join-Path $stage 'npm-ci.log') -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item $stage -Recurse -Force
        if ($Offline) {
            Die 'COUNCIL_NPM_OFFLINE_CACHE_MISS' 'npm ci --offline failed: a pinned dependency is not in the local npm cache, and this install was asked to stay offline. Re-run without -Offline on a connected machine. Staging was removed; current is unchanged' 5
        }
        Die 'COUNCIL_NPM_CI_FAILED' 'npm ci failed for the pinned runtime dependencies (log tail above). Staging was removed; current is unchanged' 5
    }
    Say 'building the runtime (tsc + esbuild bundle)...'
    Push-Location (Join-Path $stage 'runtime')
    & $npm.Source run build *> (Join-Path $stage 'build.log')
    $buildRc = $LASTEXITCODE
    Pop-Location
    if ($buildRc -ne 0) {
        Get-Content (Join-Path $stage 'build.log') -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_BUILD_FAILED' 'the runtime build failed (log tail above). Staging was removed; current is unchanged' 6
    }
    # The canonical bundle step (copy-runtime-assets.mjs, CWE-039 F-1)
    # copies the persistence schema SQL into dist at build time; the
    # persistence layer loads it relative to its module, so its absence
    # would only surface when the store first opens. Assert it landed.
    if (-not (Test-Path (Join-Path $stage 'runtime\dist\migrations\0001-council-schema.sql'))) {
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_BUILD_FAILED' 'the built runtime is missing dist\migrations\0001-council-schema.sql (the canonical copy-runtime-assets step did not run). Staging was removed; current is unchanged' 6
    }
    # Emit the generated Claude-Nine host wrapper from the CWE-010 template.
    # The render runs through the staged runtime's own tsx: the canonical
    # contracts package uses extensionless import specifiers, which plain
    # Node ESM cannot resolve from source or tsc output.
    $emitFile = Join-Path $stage 'emit-wrapper.mts'
    @('import { renderClaudeNineWrapper } from "./runtime/src/bridges/claude-nine.ts";',
      'process.stdout.write(renderClaudeNineWrapper());') |
        Set-Content $emitFile -Encoding utf8NoBOM
    $wrapperFile = Join-Path $stage 'runtime\dist\claude-nine-host-wrapper.mjs'
    & (Join-Path $stage 'runtime\node_modules\.bin\tsx.cmd') $emitFile > $wrapperFile
    $emitRc = $LASTEXITCODE
    Remove-Item $emitFile -Force -ErrorAction SilentlyContinue
    if ($emitRc -ne 0) {
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_BUILD_FAILED' 'emitting the generated host wrapper from the CWE-010 template failed. Staging was removed; current is unchanged' 6
    }
    if (-not (Select-String -Path $wrapperFile -Pattern 'createClaudeNineBridge' -Quiet)) {
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_BUILD_FAILED' 'the generated host wrapper does not compose createClaudeNineBridge. Staging was removed; current is unchanged' 6
    }
    # Bundle the runnable entry with the runtime's own esbuild (the same
    # mechanism as the package's own blackceo-council bin): the entry
    # composes the emitted wrapper with the bundle native resolver.
    $entryFile = Join-Path $stage 'runtime\bundle-entry.mjs'
    @('import { readFileSync } from "node:fs";',
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
      '}') |
        Set-Content $entryFile -Encoding utf8NoBOM
    & (Join-Path $stage 'runtime\node_modules\.bin\esbuild.cmd') $entryFile `
        --bundle --platform=node --format=esm --target=node20 `
        --outfile=(Join-Path $stage 'runtime\dist\council-entry.mjs') *> (Join-Path $stage 'entry.log')
    $entryRc = $LASTEXITCODE
    Remove-Item $entryFile -Force -ErrorAction SilentlyContinue
    if ($entryRc -ne 0) {
        Get-Content (Join-Path $stage 'entry.log') -Tail 5 | ForEach-Object { [Console]::Error.WriteLine($_) }
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_BUILD_FAILED' 'bundling the council entry failed. Staging was removed; current is unchanged' 6
    }
    @{ aggregate = $aggregate; skill_dir = $SkillDir; source_dir = $SourceDir; node = (& $node.Source --version) } |
        ConvertTo-Json | Set-Content (Join-Path $stage 'install-record.json') -Encoding utf8NoBOM

    Say 'gating the staged prefix (package doctor + CLI doctor)...'
    if (-not (Test-PrefixGates $stage)) {
        Remove-Item $stage -Recurse -Force
        Die 'COUNCIL_DOCTOR_FAILED' 'the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged' 7
    }
    Set-Content (Join-Path $stage '.install-complete') 'ok' -Encoding ascii
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    # Replace the prefix without ever leaving the previous release absent:
    # move the old tree aside, move the gated tree in, restore the old tree
    # if the move fails. The old tree is deleted only after success.
    $previousPrefix = Join-Path $runtimeDir ".previous-$aggregate-$PID"
    if (Test-Path -LiteralPath $previousPrefix) { Remove-Item -LiteralPath $previousPrefix -Recurse -Force }
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
    if (Test-Path -LiteralPath $previousPrefix) { Remove-Item -LiteralPath $previousPrefix -Recurse -Force }
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
if (Test-Path $previous) { Remove-Item $previous -Force }
$hadCurrent = Test-Path $current
if ($hadCurrent) { Move-Item $current $previous }
try {
    New-Item -ItemType Junction -Path $current -Target $prefix | Out-Null
} catch {
    if ($hadCurrent -and (Test-Path $previous) -and -not (Test-Path $current)) {
        Move-Item $previous $current
    }
    Die 'COUNCIL_SWAP_FAILED' 'could not swap the current junction' 7
}
if (Test-Path $previous) { Remove-Item $previous -Force }
Say "current -> $aggregate"

# --- the blackceo-council executable pair -----------------------------------
$binDir = Join-Path $DataDir 'bin'
$libDir = Join-Path $DataDir 'lib'
$cmdDest = Join-Path $binDir 'blackceo-council.cmd'
$ps1Dest = Join-Path $libDir 'blackceo-council.ps1'
$cmdSrc = Join-Path $RepoRoot 'launchers\windows\blackceo-council.cmd'
$ps1Src = Join-Path $RepoRoot 'launchers\windows\blackceo-council.ps1'
if ((Test-Path $cmdDest) -and -not (Select-String -Path $cmdDest -Pattern 'CWE-040' -Quiet)) {
    Die 'COUNCIL_EXECUTABLE_FOREIGN' "$cmdDest exists and is not the council executable; refusing to overwrite it. Move it aside and re-run" 4
}
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
New-Item -ItemType Directory -Path $libDir -Force | Out-Null
Copy-Item $cmdSrc $cmdDest -Force
Copy-Item $ps1Src $ps1Dest -Force
Set-Content (Join-Path $libDir 'blackceo-council.profile') $DataDir -Encoding ascii
Say "executable: $cmdDest"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $binDir) {
    [Environment]::SetEnvironmentVariable('Path', (($userPath, $binDir) -join ';'), 'User')
    Say "user PATH: added $binDir (new shells pick it up)"
} else {
    Say "user PATH: $binDir already present"
}

Say "OK: council runtime $aggregate is current; data profile $DataDir"
exit 0
