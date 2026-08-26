'use strict'

/**
 * A Tauri config may not carry a comment key, and this is not a style rule.
 *
 * `Config` is declared `#[serde(rename_all = "camelCase", deny_unknown_fields)]`
 * (tauri-utils-2.9.3/src/config.rs:3586). The CLI merges the platform overlay
 * into the base config as raw JSON and THEN deserializes the merged value, so
 * one unknown key in either file fails the whole parse — before cargo runs.
 * The outcome is not a degraded bundle. It is NO BUNDLE.
 *
 * This happened. `tauri.windows.conf.json` shipped with a top-level `$comment`
 * array explaining why it removes `speech-assets/`. Measured on the real CLI:
 *
 *   Error `"tauri.conf.json"` error: Additional properties are not allowed
 *         ('$comment' was unexpected)
 *
 * So the file written to stop 378 MB of dead payload from shipping would
 * instead have produced no Windows installer at all — and nothing would have
 * caught it, because no CI job stages a platform overlay before checking.
 *
 * `$schema` is the one key that looks like an exception and is not: `Config`
 * gives it an explicit field (`#[serde(rename = "$schema")]`, config.rs:3589).
 * Anything else invented in that shape is rejected.
 *
 * Rationale for these files lives in apps/candice-companion/TAURI-PLATFORM-CONFIG.md.
 *
 * Run: node tests/contract/tauri-platform-config.test.js
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

/** Every key Tauri accepts that begins with `$`. There is exactly one. */
const ALLOWED_DOLLAR_KEYS = new Set(['$schema'])

function configFiles() {
  return fs
    .readdirSync(APP)
    .filter((f) => /^tauri(\.[a-z0-9]+)?\.conf\.json$/.test(f))
    .sort()
}

check('CONTROL: the config files are actually found and read', () => {
  const files = configFiles()
  assert.ok(files.length >= 2, `expected a base config and at least one overlay, saw ${files.length}`)
  assert.ok(files.includes('tauri.conf.json'), 'the base config must be among them')
  // If the read were broken, every assertion below would pass on an empty
  // set — which is the exact false-green this file exists to prevent.
  for (const file of files) {
    const text = fs.readFileSync(path.join(APP, file), 'utf8')
    assert.ok(text.length > 0, `${file} read as empty`)
  }
})

check('no config carries a comment key, which would fail the whole parse', () => {
  for (const file of configFiles()) {
    const parsed = JSON.parse(fs.readFileSync(path.join(APP, file), 'utf8'))
    for (const key of Object.keys(parsed)) {
      if (!key.startsWith('$')) continue
      assert.ok(
        ALLOWED_DOLLAR_KEYS.has(key),
        `${file} has top-level "${key}". Tauri's Config is deny_unknown_fields, ` +
          `so this fails config parse and NO bundle is produced. Put the ` +
          `explanation in TAURI-PLATFORM-CONFIG.md instead.`,
      )
    }
  }
})

check('every config is valid JSON with an object at the root', () => {
  for (const file of configFiles()) {
    const parsed = JSON.parse(fs.readFileSync(path.join(APP, file), 'utf8'))
    assert.ok(
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      `${file} must parse to an object`,
    )
  }
})

check('the Windows overlay still removes speech-assets, and by RFC 7396 null', () => {
  const file = path.join(APP, 'tauri.windows.conf.json')
  assert.ok(fs.existsSync(file), 'the Windows overlay must exist')
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const resources = parsed?.bundle?.resources
  assert.ok(resources !== undefined, 'the overlay must still patch bundle.resources')
  assert.ok(
    Object.prototype.hasOwnProperty.call(resources, 'speech-assets/'),
    'the speech-assets key must be present to be removed',
  )
  assert.strictEqual(
    resources['speech-assets/'],
    null,
    'removal is a null VALUE (RFC 7396); anything else ADDS a resource instead',
  )
  // The base must use the map form. With the array form the patch would
  // replace the whole list rather than drop one entry.
  const base = JSON.parse(fs.readFileSync(path.join(APP, 'tauri.conf.json'), 'utf8'))
  const baseResources = base?.bundle?.resources
  assert.ok(
    baseResources !== null && typeof baseResources === 'object' && !Array.isArray(baseResources),
    'bundle.resources must be a map in the base config for a null patch to drop one key',
  )
})

check('CONTROL: the comment-key rule really rejects a comment key', () => {
  // Prove the rule discriminates, rather than passing because nothing is
  // ever checked. Same logic, run against a synthetic bad config.
  const bad = { $comment: ['why this file exists'], bundle: {} }
  const offenders = Object.keys(bad).filter((k) => k.startsWith('$') && !ALLOWED_DOLLAR_KEYS.has(k))
  assert.deepStrictEqual(offenders, ['$comment'], 'the rule must catch $comment')
  const good = { $schema: '../node_modules/@tauri-apps/cli/config.schema.json', bundle: {} }
  const allowed = Object.keys(good).filter((k) => k.startsWith('$') && !ALLOWED_DOLLAR_KEYS.has(k))
  assert.deepStrictEqual(allowed, [], '$schema must still be permitted')
})

check('both staging paths mirror the overlays, not just the base config', () => {
  // build.rs covers `cargo tauri build`; the npm script covers `npm run
  // tauri:build`. When build.rs mirrored only tauri.conf.json, a direct
  // cargo build succeeded with NO overlay and silently re-shipped the 378MB.
  const buildRs = fs.readFileSync(path.join(APP, 'src-tauri', 'build.rs'), 'utf8')
  assert.match(buildRs, /tauri\.\{platform\}\.conf\.json/, 'build.rs must mirror platform overlays')
  assert.match(buildRs, /"windows"/, 'build.rs must cover windows')
  const stage = fs.readFileSync(path.join(APP, 'scripts', 'stage-tauri-config.mjs'), 'utf8')
  assert.ok(stage.includes('windows'), 'the staging script must cover windows')
})

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL TESTS PASSED')
