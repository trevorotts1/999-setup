# Council of Wise Elders: runtime installer for 999-distributed installs
# on Windows (CWE-040; directive Section 25.2 steps 5 and 6, Section
# 16.1). Mirrors scripts/council-runtime-install.sh.
#
#   1. Runs the canonical installer's exact Node prerequisite probe
#      (openclaw-onboarding 77-council-of-wise-elders
#      scripts/node-runtime-preflight.mjs) against the resolved node
#      executable: the 22.13+/24+ version gate plus the node:sqlite
#      in-memory read/write and persistent reopen probe. A failed
#      probe refuses the install before anything is written.
#   1b. Resolves the installed council skill folder to the CANONICAL
#      portable source: a discovered folder must be a registered 999
#      distribution of openclaw-onboarding/77-council-of-wise-elders
#      (installer-registration/council-vendoring.json). A copied folder
#      is not separately editable product; a drifted copy is refused
#      with the re-vendor instruction. An explicitly passed -SkillDir
#      is an operator override of this gate (the doctor still gates
#      it structurally; the swap battery's historical releases are
#      themselves registered releases).
#   2. Finds the installed council skill folder (through a Claude config
#      root junction) and reads its distribution identity
#      (manifest.json aggregate hash).
#   2. Stages the runtime payload into a versioned per-user prefix
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
#      failed gate leaves `current` exactly as it was.
#   5. Installs the blackceo-council executable pair (cmd shim on PATH
#      in %LOCALAPPDATA%\BlackCEO\WiseElders\bin, ps1 off PATH in
#      %LOCALAPPDATA%\BlackCEO\WiseElders\lib) and adds the bin dir to
#      the user PATH when absent. A foreign file at the shim path is
#      never overwritten; the install refuses and says why.
#
# Usage:
#   scripts\council-runtime-install.ps1 [-SkillDir DIR] [-DataDir DIR]
#                                       [-Offline] [-Check]
# Exit codes: 0 ok; 4 preflight (node/npm/skill/manifest/probe/canonical
# identity missing or a foreign executable); 5 dependency install failed;
# 6 build failed; 7 doctor gate failed.
param(
    [string]$SkillDir = '',
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
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

# --- canonical Node prerequisite probe (WER-004) --------------------------
# The canonical installer's exact gate (openclaw-onboarding
# 77-council-of-wise-elders scripts/node-runtime-preflight.mjs),
# through the byte-identical copy distributed with the 999 installer
# (scripts\council\node-runtime-preflight.mjs; the vendored skill
# folder's own copy is preferred when present), against the RESOLVED
# executable: 22.13+/24+ version gate plus node:sqlite in-memory
# read/write and persistent reopen. A failed probe refuses the
# install before anything is written. Native PowerShell: no WSL, no
# Bash shebang, no symlink assumption.
$nodeResolved = [System.IO.Path]::GetFullPath($node.Source)
# The installer's own copy is used at probe time (before the skill
# folder is resolved); once the skill folder is resolved, the doctor
# gates below still run against the skill folder itself.
$canonicalProbe = Join-Path $ScriptDir 'council\node-runtime-preflight.mjs'
if (-not (Test-Path $canonicalProbe)) {
    Die 'COUNCIL_PROBE_MISSING' "the canonical Node prerequisite probe is missing: scripts\council\node-runtime-preflight.mjs does not carry it. Re-vendor the council bundle with scripts/vendor-council-bundle.mjs" 4
}
$probeScript = @'
const { isSupportedCouncilRuntimeNode, verifyCouncilSqlite } = await import(process.argv[1]);
const { spawnSync } = await import("node:child_process");
const versionRun = spawnSync(process.execPath, ["--version"], { encoding: "utf8" });
if (versionRun.status !== 0) { console.error("COUNCIL_NODE_VERSION_UNREADABLE"); process.exit(1); }
const version = `${versionRun.stdout || ""}`.trim();
if (!isSupportedCouncilRuntimeNode(version)) { console.error(`COUNCIL_NODE_UNSUPPORTED ${version}`); process.exit(1); }
await verifyCouncilSqlite();
console.log(`COUNCIL-NODE-PROBE: PASS ${version}`);
'@
$probeOut = & $nodeResolved --input-type=module -e $probeScript $canonicalProbe 2>&1
if ($LASTEXITCODE -ne 0 -or -not ("$probeOut" -match 'COUNCIL-NODE-PROBE: PASS')) {
    Die 'COUNCIL_NODE_PREREQ_FAILED' "the canonical Node prerequisite probe failed for $nodeResolved`: $probeOut. Council requires Node 22.13+ or 24+ with a working node:sqlite; nothing was written and the previous release is unchanged" 4
}
Say "canonical Node prerequisite probe: PASS ($((& $nodeResolved --version)))"

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
if (-not $SkillDir -or -not (Test-Path (Join-Path $SkillDir 'manifest.json'))) {
    Die 'COUNCIL_SKILL_NOT_FOUND' 'no installed council-of-wise-elders skill folder with manifest.json was found' 4
}
$SkillDir = (Resolve-Path $SkillDir).Path
$manifest = Get-Content (Join-Path $SkillDir 'manifest.json') -Raw | ConvertFrom-Json
$aggregate = $manifest.aggregate_sha256
if (-not $aggregate) { Die 'COUNCIL_SKILL_MANIFEST_INVALID' "could not read aggregate_sha256 from $SkillDir\manifest.json" 4 }
Say "skill folder: $SkillDir"
Say "distribution aggregate: $aggregate"

# --- canonical-source resolution (WER-004) --------------------------------
# The council is NOT separately editable product: a resolved skill
# folder must be a REGISTERED 999 distribution of the canonical
# openclaw-onboarding/77-council-of-wise-elders source (the live
# release recorded in installer-registration/council-vendoring.json or
# a release proven from this repository's own git history).
$vendoringRecordPath = Join-Path $RepoRoot 'installer-registration\council-vendoring.json'
if (-not (Test-Path $vendoringRecordPath)) {
    Die 'COUNCIL_REGISTRATION_MISSING' "the vendoring registration is missing: $vendoringRecordPath. Re-vendor the council bundle with scripts/vendor-council-bundle.mjs" 4
}
$vendoringRecord = Get-Content $vendoringRecordPath -Raw | ConvertFrom-Json
$identityProblems = @()
# A registered 999 distribution is either the LIVE vendored release
# (every field matches the registration record) or a HISTORICAL release
# this repository itself produced (every field of its manifest matches
# a manifest.json in this repository's git history of the vendored
# folder). The swap battery installs exactly such historical releases.
$isLiveRelease = ($manifest.source_commit -eq $vendoringRecord.canonical_source.source_commit) -and `
    ($manifest.canonical_aggregate_sha256 -eq $vendoringRecord.canonical_source.canonical_aggregate_sha256) -and `
    ($aggregate -eq $vendoringRecord.distribution.distribution_aggregate_sha256)
if (-not $isLiveRelease) {
    $known = $false
    try {
        $log = & git -C $RepoRoot log --format=%H -- '.claude/skills/council-of-wise-elders/manifest.json' 2>$null
        foreach ($sha in ($log -split "`n")) {
            if (-not $sha) { continue }
            try {
                $historicalRaw = & git -C $RepoRoot show "$sha`:\.claude/skills/council-of-wise-elders/manifest.json" 2>$null
                if ($historicalRaw) {
                    $historical = $historicalRaw -join "`n" | ConvertFrom-Json
                    if ($historical.aggregate_sha256 -eq $aggregate -and `
                        $historical.source_commit -eq $manifest.source_commit -and `
                        $historical.canonical_aggregate_sha256 -eq $manifest.canonical_aggregate_sha256) {
                        $known = $true; break
                    }
                }
            } catch {}
        }
    } catch {}
    if (-not $known) {
        if ($manifest.source_commit -ne $vendoringRecord.canonical_source.source_commit) {
            $identityProblems += "source_commit $($manifest.source_commit) is not the registered canonical $($vendoringRecord.canonical_source.source_commit)"
        }
        if ($manifest.canonical_aggregate_sha256 -ne $vendoringRecord.canonical_source.canonical_aggregate_sha256) {
            $identityProblems += "canonical_aggregate_sha256 $($manifest.canonical_aggregate_sha256) is not the registered canonical $($vendoringRecord.canonical_source.canonical_aggregate_sha256)"
        }
        $identityProblems += "distribution aggregate $aggregate is not the live release or any registered release in this repository's vendoring history"
    }
}
if ($identityProblems.Count -gt 0) {
    [Console]::Error.WriteLine("COUNCIL_NOT_CANONICAL_SOURCE: $($identityProblems -join '; '). The council skill is the canonical openclaw-onboarding/77-council-of-wise-elders distribution vendored into this repository, never separately editable product. Re-vendor with scripts/vendor-council-bundle.mjs")
    Die 'COUNCIL_NOT_CANONICAL_SOURCE' 'the resolved skill folder is not a registered canonical council distribution; nothing was written and the previous release is unchanged' 4
}
# Byte-identity: the tree must recompute to its own claimed aggregate
# (the canonical hash method). A copied folder edited in place is
# refused here, with the previous release untouched.
$recomputeProblems = @()
try {
    $pairs = New-Object System.Collections.Generic.List[object]
    $walk = {
        param($dir)
        foreach ($name in (Get-ChildItem -LiteralPath $dir -Force | Sort-Object Name)) {
            if ($name.PSIsContainer) { & $walk $name.FullName }
            else {
                $rel = [System.IO.Path]::GetRelativePath($SkillDir, $name.FullName).Replace('\','/')
                if ($rel -eq 'manifest.json' -or $rel.EndsWith('.skill')) { continue }
                $bytes = [System.IO.File]::ReadAllBytes($name.FullName)
                $sha = [System.Security.Cryptography.SHA256]::Create()
                try { $hash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
                finally { $sha.Dispose() }
                $pairs.Add([pscustomobject]@{ path = $rel; hash = $hash })
            }
        }
    }
    & $walk $SkillDir
    # Canonical order: PATH-major order (the canonical method sorts the
    # (path, hash) pairs by path, then joins "hash  path" lines) — with an
    # ORDINAL path compare, not a culture sort.
    $sorted = $pairs | Sort-Object { $_.path } -Culture ([System.Globalization.CultureInfo]::InvariantCulture)
    $sorted = [object[]]$sorted
    [Array]::Sort($sorted, [System.Comparison[object]]{ param($a, $b) [System.String]::CompareOrdinal($a.path, $b.path) })
    $entries = ($sorted | ForEach-Object { "$($_.hash)  $($_.path)" }) -join "`n"
    $bytes2 = [System.Text.Encoding]::UTF8.GetBytes($entries + "`n")
    $sha2 = [System.Security.Cryptography.SHA256]::Create()
    try { $recomputed = ([System.BitConverter]::ToString($sha2.ComputeHash($bytes2))).Replace('-','').ToLowerInvariant() }
    finally { $sha2.Dispose() }
    if ($recomputed -ne $manifest.aggregate_sha256 -or $sorted.Count -ne $manifest.file_count) {
        $recomputeProblems += "the skill folder does not recompute to its own manifest (computed $recomputed over $($sorted.Count) files, manifest claims $($manifest.aggregate_sha256) over $($manifest.file_count)); it has been edited since the registered release and is not valid product. Re-vendor with scripts/vendor-council-bundle.mjs"
    }
} catch {
    $recomputeProblems += "byte-identity verification failed: $($_.Exception.Message)"
}
if ($recomputeProblems.Count -gt 0) {
    [Console]::Error.WriteLine("COUNCIL_NOT_CANONICAL_SOURCE: $($recomputeProblems -join '; ')")
    Die 'COUNCIL_NOT_CANONICAL_SOURCE' 'the resolved skill folder does not match its registered release; nothing was written and the previous release is unchanged' 4
}
Say 'canonical-source identity: registered 999 distribution of openclaw-onboarding/77-council-of-wise-elders'

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
    # A failed staged build must leave NO skeleton behind on a clean
    # profile: remember whether the runtime dir already existed, and
    # remove it again if this install created it and the stage failed.
    $runtimeDirExisted = Test-Path $runtimeDir
    function Remove-Stage {
        if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
        if (-not $runtimeDirExisted) {
            if (Test-Path $runtimeDir) {
                $remaining = Get-ChildItem -LiteralPath $runtimeDir -Force
                if (-not $remaining) { Remove-Item $runtimeDir -Force }
            }
            if (Test-Path $DataDir) {
                $remainingData = Get-ChildItem -LiteralPath $DataDir -Force
                if (-not $remainingData) { Remove-Item $DataDir -Force }
            }
        }
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item (Join-Path $SkillDir 'runtime') (Join-Path $stage 'runtime') -Recurse
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
        Remove-Stage
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
        Remove-Stage
        Die 'COUNCIL_BUILD_FAILED' 'the runtime build failed (log tail above). Staging was removed; current is unchanged' 6
    }
    # The canonical bundle step (copy-runtime-assets.mjs, CWE-039 F-1)
    # copies the persistence schema SQL into dist at build time; the
    # persistence layer loads it relative to its module, so its absence
    # would only surface when the store first opens. Assert it landed.
    if (-not (Test-Path (Join-Path $stage 'runtime\dist\migrations\0001-council-schema.sql'))) {
        Remove-Stage
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
        Remove-Stage
        Die 'COUNCIL_BUILD_FAILED' 'emitting the generated host wrapper from the CWE-010 template failed. Staging was removed; current is unchanged' 6
    }
    if (-not (Select-String -Path $wrapperFile -Pattern 'createClaudeNineBridge' -Quiet)) {
        Remove-Stage
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
        Remove-Stage
        Die 'COUNCIL_BUILD_FAILED' 'bundling the council entry failed. Staging was removed; current is unchanged' 6
    }
    @{ aggregate = $aggregate; skill_dir = $SkillDir; node = (& $node.Source --version) } |
        ConvertTo-Json | Set-Content (Join-Path $stage 'install-record.json') -Encoding utf8NoBOM

    Say 'gating the staged prefix (package doctor + CLI doctor)...'
    if (-not (Test-PrefixGates $stage)) {
        Remove-Stage
        Die 'COUNCIL_DOCTOR_FAILED' 'the staged runtime did not pass the doctor gates. Staging was removed; current is unchanged' 7
    }
    Set-Content (Join-Path $stage '.install-complete') 'ok' -Encoding ascii
    # Prior-release safety: if this aggregate is already current, move
    # the old prefix aside BEFORE the replacement moves in, and restore
    # it if the move-in fails, so the previous release stays usable.
    $currentTarget = $null
    if (Test-Path $current) {
        $item = Get-Item $current -Force
        if ($item.Target) { $currentTarget = Split-Path $item.Target -Leaf }
    }
    if ($currentTarget -eq $aggregate -and (Test-Path $prefix)) {
        $oldPrefix = Join-Path $runtimeDir ".old-prefix.$PID"
        if (Test-Path $oldPrefix) { Remove-Item $oldPrefix -Recurse -Force }
        Move-Item $prefix $oldPrefix
        try {
            Move-Item $stage $prefix
            Remove-Item $oldPrefix -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
            Move-Item $oldPrefix $prefix
            Die 'COUNCIL_SWAP_FAILED' 'could not move the gated prefix into place; the previous release was restored and current is unchanged' 7
        }
    } else {
        if (Test-Path $prefix) { Remove-Item $prefix -Recurse -Force }
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        Move-Item $stage $prefix
    }
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
