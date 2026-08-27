#!/usr/bin/env node
/**
 * Make whisper-cli self-contained, so voice input can actually ship.
 *
 * WHY THIS EXISTS
 *
 * The speech inventory has recorded `stt-binary-macos` as `sha256Status:
 * absent` since the beginning, which means HOLD TO TALK has never worked on
 * any build — the app correctly hides the control rather than offering a
 * dead one. The pinned artifact is a Homebrew bottle, and CONTROL/TODO.md
 * records the reason nobody just copied it in: the bottle's binary links
 * against Homebrew dylibs that a client machine does not have.
 *
 *     $ otool -L /opt/homebrew/bin/whisper-cli
 *         @rpath/libwhisper.1.dylib
 *         /opt/homebrew/opt/ggml/lib/libggml.0.dylib
 *         /opt/homebrew/opt/ggml/lib/libggml-base.0.dylib
 *
 * Copying that binary alone produces an app that dies with a dyld error on
 * the first push-to-talk, on a machine we cannot test. So this script does
 * what the "installer lane" note always meant: it walks the dependency
 * closure, copies every non-system library next to the binary, and rewrites
 * every install name to `@loader_path`, so the engine resolves its own
 * libraries from its own directory and never looks at /opt/homebrew.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not invent a supply-chain pin. The upstream bottle digest stays
 * recorded as the provenance of what was relocated; the shipped files carry
 * their own measured hashes, marked as measured rather than as if they had
 * been fetched from upstream in that form. A relocated binary is not the
 * bottle, and saying otherwise in the inventory would be a lie in the one
 * file whose whole job is to be true.
 *
 * Run: node scripts/relocate-whisper-macos.mjs [--source <path-to-whisper-cli>]
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const APP_ROOT = path.resolve(import.meta.dirname, '..')
const DEST = path.join(APP_ROOT, 'src-tauri', 'speech-assets', 'stt')

const argv = process.argv.slice(2)
const sourceFlag = argv.indexOf('--source')
const SOURCE = sourceFlag >= 0 ? argv[sourceFlag + 1] : '/opt/homebrew/bin/whisper-cli'

const SYSTEM_PREFIXES = ['/usr/lib/', '/System/']
const isSystem = (p) => SYSTEM_PREFIXES.some((prefix) => p.startsWith(prefix))

function otoolDeps(file) {
  const out = execFileSync('otool', ['-L', file], { encoding: 'utf8' })
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter((d) => d && !d.endsWith(':') && !isSystem(d))
}

/** `@rpath/x` has to be resolved against the places Homebrew actually puts things. */
function resolveDep(dep) {
  if (!dep.startsWith('@rpath/')) return fs.existsSync(dep) ? fs.realpathSync(dep) : null
  const name = dep.slice('@rpath/'.length)
  for (const base of ['/opt/homebrew/lib', '/opt/homebrew/opt/ggml/lib', '/opt/homebrew/opt/whisper-cpp/lib']) {
    const candidate = path.join(base, name)
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate)
  }
  return null
}

if (!fs.existsSync(SOURCE)) {
  console.error(`relocate-whisper: no engine at ${SOURCE}`)
  console.error('  install it first (brew install whisper-cpp) or pass --source')
  process.exit(1)
}

// ---- 1. dependency closure ------------------------------------------------
const closure = new Map()
const queue = [fs.realpathSync(SOURCE)]
const unresolved = []
while (queue.length > 0) {
  const file = queue.pop()
  if (closure.has(file)) continue
  const deps = otoolDeps(file)
  closure.set(file, deps)
  for (const dep of deps) {
    const real = resolveDep(dep)
    if (real === null) {
      unresolved.push(`${path.basename(file)} -> ${dep}`)
      continue
    }
    if (!closure.has(real)) queue.push(real)
  }
}
if (unresolved.length > 0) {
  // Refusing here is the point: a half-relocated engine fails at the user's
  // first push-to-talk, on a machine nobody here can debug.
  console.error('relocate-whisper: unresolved dependencies, refusing to stage a broken engine:')
  for (const u of unresolved) console.error(`  ${u}`)
  process.exit(1)
}

// ---- 2. stage ------------------------------------------------------------
fs.mkdirSync(DEST, { recursive: true })
const binaryName = 'whisper-cli'
const staged = new Map() // realpath -> staged basename
for (const file of closure.keys()) {
  const name = file === fs.realpathSync(SOURCE) ? binaryName : path.basename(file)
  staged.set(file, name)
}
for (const [file, name] of staged) {
  const target = path.join(DEST, name)
  fs.copyFileSync(file, target)
  fs.chmodSync(target, 0o755)
}

// ---- 2b. stage the RUNTIME backend plugins --------------------------------
//
// The dependency closure above is the LINK-TIME closure, and it is complete.
// It is also not enough, which is the whole lesson of this section.
//
// In ggml 0.19 the compute backends are not linked -- they are dlopen'd at
// run time from a directory baked in at build time, which for a Homebrew
// bottle is /opt/homebrew/Cellar/ggml/<version>/libexec. `otool -L` cannot
// see a dlopen, so an engine that passes every link-time check still had NO
// backend at all on a machine without Homebrew. Measured, with the bundle's
// own engine and /opt/homebrew denied via sandbox-exec:
//
//   ggml_backend_dev_init -> ggml_abort, SIGABRT, exit 134, no transcript
//
// and with an irrelevant path denied instead, the same command exits 0 and
// transcribes -- so it was the missing backends, not the sandbox. Staging
// these five files and rewriting them the same way makes that same command
// exit 0 with /opt/homebrew still denied, loading BLAS, CPU and Metal from
// inside the bundle.
//
// Every client Mac is a machine without Homebrew. This is the difference
// between voice input working and the engine crashing on first use.
const backendDir = (() => {
  const base = resolveDep('@rpath/libggml-base.0.dylib')
  if (base === null) return null
  const candidate = path.resolve(path.dirname(base), '..', 'libexec')
  return fs.existsSync(candidate) ? candidate : null
})()

if (backendDir === null) {
  console.error('relocate-whisper: could not locate the ggml backend plugin directory')
  console.error('  without it the engine ships with no compute backend and aborts on first use')
  process.exit(1)
}

const backendFiles = fs.readdirSync(backendDir).filter((f) => f.endsWith('.so')).sort()
if (backendFiles.length === 0) {
  // Refusing beats staging an engine that cannot compute. An empty read here
  // would otherwise sail through every later check: nothing to copy, nothing
  // to rewrite, nothing to leak.
  console.error(`relocate-whisper: no backend plugins in ${backendDir}`)
  process.exit(1)
}

for (const name of backendFiles) {
  const target = path.join(DEST, name)
  fs.copyFileSync(path.join(backendDir, name), target)
  fs.chmodSync(target, 0o755)
  staged.set(path.join(backendDir, name), name)
  closure.set(path.join(backendDir, name), otoolDeps(target))
}

// ---- 3. rewrite every install name to @loader_path ------------------------
const byBasename = new Map()
for (const [file, name] of staged) byBasename.set(path.basename(file), name)

for (const [file, name] of staged) {
  const target = path.join(DEST, name)
  if (name !== binaryName) {
    execFileSync('install_name_tool', ['-id', `@loader_path/${name}`, target])
  }
  for (const dep of closure.get(file)) {
    const real = resolveDep(dep)
    const stagedName = staged.get(real) ?? byBasename.get(path.basename(dep))
    if (stagedName === undefined) continue
    execFileSync('install_name_tool', ['-change', dep, `@loader_path/${stagedName}`, target])
  }
  // An LC_RPATH pointing back into /opt/homebrew would let a developer machine
  // succeed where a client machine fails — the worst kind of green.
  const loads = execFileSync('otool', ['-l', target], { encoding: 'utf8' })
  for (const m of loads.matchAll(/cmd LC_RPATH[\s\S]*?path ([^\s]+) \(offset/g)) {
    try {
      execFileSync('install_name_tool', ['-delete_rpath', m[1], target])
    } catch { /* already gone */ }
  }
}

// ---- 4. verify: nothing may point outside the bundle ----------------------
let leaks = 0
for (const name of staged.values()) {
  const target = path.join(DEST, name)
  for (const dep of otoolDeps(target)) {
    if (dep.startsWith('@loader_path/')) continue
    console.error(`relocate-whisper: ${name} still references ${dep}`)
    leaks += 1
  }
}
if (leaks > 0) {
  console.error('relocate-whisper: refusing to report success with external references')
  process.exit(1)
}

// ---- 5. report -----------------------------------------------------------
const manifest = []
for (const name of [...staged.values()].sort()) {
  const target = path.join(DEST, name)
  const bytes = fs.readFileSync(target)
  manifest.push({
    filename: name,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
console.log(JSON.stringify({ dest: DEST, files: manifest }, null, 2))
console.log(`\nrelocate-whisper: staged ${manifest.length} files, zero external references`)
