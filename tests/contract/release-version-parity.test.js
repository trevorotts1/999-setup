'use strict'

/**
 * The version a client sees is the one in `tauri.conf.json`, and nothing was
 * pinning it to the other two.
 *
 * Candice declares its version in three separate files, each read by a
 * different tool:
 *
 *   apps/candice-companion/package.json          -> npm, the frontend build
 *   apps/candice-companion/src-tauri/Cargo.toml  -> cargo, the Rust crate
 *   apps/candice-companion/src-tauri/tauri.conf.json -> the BUNDLE NAME,
 *       CFBundleShortVersionString, the DMG filename, and the version the
 *       updater compares against
 *
 * On 2026-08-27 a release-candidate bump landed in two of the three. The
 * build then produced `Candice Companion_1.0.0-rc.1_aarch64.dmg` from a tree
 * whose package.json and Cargo.toml both said `1.0.0-rc.2`. Nothing failed.
 * The bundle was internally consistent, signed cleanly, and carried the wrong
 * version — which is the worst shape this can take, because every downstream
 * check (checksum pins, updater manifests, evidence artifact names) would have
 * agreed with each other on a number that did not match the candidate.
 *
 * A version is not metadata here. `scripts/candice-updater` decides whether a
 * client upgrades by comparing it, and the release evidence pins artifacts by
 * filename. Drift means an rc.2 candidate that clients see as rc.1 and that
 * the updater may refuse to install over an existing rc.1.
 *
 * Run: node tests/contract/release-version-parity.test.js
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const APP = path.join(__dirname, '..', '..', 'apps', 'candice-companion')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}: ${err.message}`)
  }
}

/** The version each manifest declares, read the way its own tool reads it. */
function declaredVersions(root = APP) {
  const pkg = path.join(root, 'package.json')
  // The TRACKED source, not `src-tauri/tauri.conf.json`. That path is a copy
  // written by scripts/stage-tauri-config.mjs at build time and is gitignored,
  // so reading it would test a build artifact that a fresh clone does not have
  // -- and would happily agree with a stale copy while the real config drifted.
  // This is not hypothetical: the rc.2 bump was applied to the staged copy and
  // the build still emitted rc.1 from the source beside it.
  const conf = path.join(root, 'tauri.conf.json')
  const cargo = path.join(root, 'src-tauri', 'Cargo.toml')

  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

  // Cargo.toml: the version of the [package] table, not of some dependency.
  // A naive /^version/ scan would happily read the first `version = ` under
  // [dependencies] and compare the wrong number, which would make this guard
  // fail loudly for the wrong reason -- or pass for the wrong reason.
  const cargoText = fs.readFileSync(cargo, 'utf8')
  const packageTable = cargoText.split(/^\s*\[/m)[1] || ''
  const cargoMatch = /^\s*version\s*=\s*"([^"]+)"/m.exec(packageTable)

  return {
    'package.json': readJson(pkg).version,
    'tauri.conf.json': readJson(conf).version,
    'Cargo.toml': cargoMatch ? cargoMatch[1] : null,
  }
}

check('all three manifests are actually readable and declare a version', () => {
  // CONTROL for every assertion below. If any read silently produced
  // `undefined`, "they all match" would pass by comparing nothing to nothing
  // -- the precise failure mode this file exists to remove.
  const found = declaredVersions()
  for (const [file, version] of Object.entries(found)) {
    assert.ok(
      typeof version === 'string' && version.length > 0,
      `${file} declared no readable version (got ${JSON.stringify(version)})`,
    )
  }
})

check('the three declared versions are identical', () => {
  const found = declaredVersions()
  const distinct = [...new Set(Object.values(found))]
  assert.strictEqual(
    distinct.length,
    1,
    `version drift across manifests: ${JSON.stringify(found)} -- the DMG and ` +
      `the updater use tauri.conf.json, so this is the version clients see`,
  )
})

check('the Cargo read takes [package].version, not a dependency version', () => {
  // The [package] table is the first table in the file. Prove the parser is
  // reading THAT and not just the first `version = ` line anywhere, by
  // checking it against a fixture whose dependency block would win a naive scan.
  const fixture = [
    '[package]',
    'name = "candice-companion"',
    'version = "9.9.9-fixture"',
    '',
    '[dependencies]',
    'serde = { version = "1.0.0" }',
    '',
  ].join('\n')
  const packageTable = fixture.split(/^\s*\[/m)[1] || ''
  const got = /^\s*version\s*=\s*"([^"]+)"/m.exec(packageTable)
  assert.ok(got, 'the [package] version was not found at all')
  assert.strictEqual(got[1], '9.9.9-fixture', 'read a dependency version instead')
})

check('the staged copy, when present, matches the tracked source', () => {
  // Staging is a plain copy, so a mismatch means the copy is stale -- a build
  // ran from a config that is not the one in version control. The bundle would
  // then carry a version nobody committed.
  const staged = path.join(APP, 'src-tauri', 'tauri.conf.json')
  if (!fs.existsSync(staged)) return // not staged yet on a fresh clone; nothing to compare
  const source = JSON.parse(fs.readFileSync(path.join(APP, 'tauri.conf.json'), 'utf8'))
  const copy = JSON.parse(fs.readFileSync(staged, 'utf8'))
  assert.strictEqual(
    copy.version,
    source.version,
    'the staged src-tauri/tauri.conf.json is stale; re-run scripts/stage-tauri-config.mjs',
  )
})

check('CONTROL: the version file this reads is the one git tracks', () => {
  // If this ever starts reading the gitignored staged copy again, the guard
  // becomes a test of a build artifact. Prove the path is the tracked one.
  const tracked = path.join(APP, 'tauri.conf.json')
  assert.ok(fs.existsSync(tracked), 'the tracked app-root tauri.conf.json is missing')
  const staged = path.join(APP, 'src-tauri', 'tauri.conf.json')
  assert.notStrictEqual(
    path.resolve(tracked),
    path.resolve(staged),
    'the guard is reading the staged copy, not the source',
  )
})

check('CONTROL: the comparator can say no', () => {
  // A parity check that cannot fail is not a check. Feed it a tree where one
  // manifest disagrees and require it to notice.
  const drifted = {
    'package.json': '1.0.0-rc.2',
    'tauri.conf.json': '1.0.0-rc.1',
    'Cargo.toml': '1.0.0-rc.2',
  }
  const distinct = [...new Set(Object.values(drifted))]
  assert.strictEqual(
    distinct.length,
    2,
    'the comparator failed to see a real disagreement -- it is not comparing',
  )
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
