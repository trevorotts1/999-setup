#!/usr/bin/env node
/**
 * Validate the MERGED Tauri config against the CLI's own generated schema.
 *
 * ## Why this replaced `tauri info`
 *
 * The Windows CI job used to "prove the merged config parses" by running
 * `npx tauri info`, and guarded that with a control which injected a
 * `$comment` key and required the CLI to reject it. The control failed --
 * correctly. `tauri info` does not validate the config at all. Measured on
 * this repo, 2026-08-27: with `$comment` injected into the base config,
 * `npx tauri info` exits 0 and prints its usual 30-line environment report,
 * saying nothing. So the job's main step proved nothing, and only the control
 * was honest enough to say so.
 *
 * The authoritative check is the schema the CLI ships in
 * `node_modules/@tauri-apps/cli/config.schema.json`. It is generated from the
 * same Rust `Config` struct the build deserializes, and its root carries
 * `"additionalProperties": false` -- which is exactly the `deny_unknown_fields`
 * behaviour that turns one stray key into NO BUNDLE.
 *
 * This validates offline, on every platform, against the pinned CLI version,
 * with no build and no network.
 *
 * Usage (run from apps/candice-companion, after `npm ci`):
 *   node scripts/validate-tauri-config.mjs                 # validate base + every overlay
 *   node scripts/validate-tauri-config.mjs --prove-can-fail # also prove it rejects the real defect
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..', '..');

// The suite convention here is zero package-manager step and zero network, so
// ajv comes from the same vendored copy the WS-41 contract suite uses.
const VENDOR = path.join(REPO, 'tests', 'contract', 'vendor');
process.env.NODE_PATH = [VENDOR, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
const { Module } = await import('node:module');
Module._initPaths();
const require = createRequire(import.meta.url);

const SCHEMA = path.join(APP, 'node_modules', '@tauri-apps', 'cli', 'config.schema.json');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

/**
 * RFC 7396 JSON Merge Patch -- the algorithm Tauri applies when folding a
 * platform overlay onto the base config. A null VALUE removes the key; this
 * repo depends on that to drop `speech-assets/` on Windows.
 */
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = mergePatch(out[key], value);
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function overlays() {
  return readdirSync(APP)
    .filter((f) => /^tauri\.[a-z0-9]+\.conf\.json$/.test(f))
    .sort();
}

if (!existsSync(SCHEMA)) {
  console.log(`FAIL  the Tauri config schema is missing at ${SCHEMA}`);
  console.log('      run `npm ci` in apps/candice-companion first — without the schema this');
  console.log('      check would pass by validating nothing, which is the failure it exists to stop.');
  process.exit(1);
}

const Ajv = require('ajv');
const schema = readJson(SCHEMA);
// `unicodeRegExp: false` is required, not cosmetic: the shipped schema contains
// `^[^/\\:*?"<>|]+$` (a Windows-filename pattern), and `\:` is not a legal escape
// under a `u`-flagged RegExp, so ajv's default unicode mode throws at COMPILE
// time before validating anything. Draft-07 does not mandate unicode mode.
// `logger: false` silences ~120 lines of "unknown format uint32/double/uri
// ignored" notices. Those formats are Rust type hints schemars emits; ajv has
// no validator for them and correctly ignores them. They are not findings, and
// burying the six real result lines under them is how a red run gets skimmed.
const ajv = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false, logger: false });
const validate = ajv.compile(schema);

const base = readJson(path.join(APP, 'tauri.conf.json'));

check('CONTROL: the schema really is the deny-unknown-fields one', () => {
  // If the shipped schema ever stopped forbidding extra keys, every assertion
  // below would pass on a config with any garbage in it. Pin the property that
  // makes this check meaningful.
  if (schema.additionalProperties !== false) {
    throw new Error(
      `the CLI schema root no longer sets additionalProperties:false (got ${JSON.stringify(schema.additionalProperties)}) — this check can no longer catch an unknown key`,
    );
  }
});

check('the base config validates against the CLI schema', () => {
  if (!validate(base)) {
    throw new Error(ajv.errorsText(validate.errors, { separator: '\n        ' }));
  }
});

const found = overlays();
check('CONTROL: at least one platform overlay was found to merge', () => {
  if (found.length === 0) {
    throw new Error('no tauri.<platform>.conf.json found — the merge below would validate the base twice');
  }
});

for (const overlay of found) {
  const platform = overlay.split('.')[1];
  check(`the merged ${platform} config validates against the CLI schema`, () => {
    const merged = mergePatch(base, readJson(path.join(APP, overlay)));
    if (!validate(merged)) {
      throw new Error(ajv.errorsText(validate.errors, { separator: '\n        ' }));
    }
  });
}

if (process.argv.includes('--prove-can-fail')) {
  check('PROOF: the validator rejects the exact defect that shipped', () => {
    // A `$comment` array at the top level of the Windows overlay is the real
    // defect this lane exists for. It must be rejected, in the merged shape,
    // by the same call that just accepted the real config.
    const defective = mergePatch(base, { $comment: ['probe'] });
    if (validate(defective)) {
      throw new Error(
        'the validator ACCEPTED an unknown top-level key, so it cannot catch the defect it exists for',
      );
    }
    const text = ajv.errorsText(validate.errors);
    if (!/additional|unknown|\$comment/i.test(text)) {
      throw new Error(`rejected, but not for the expected reason: ${text}`);
    }
  });

  check('PROOF: a nested unknown key is rejected too', () => {
    // Unknown keys deeper in the tree fail the same Rust deserialize. If only
    // the root were guarded, an overlay typo inside `bundle` would still kill
    // the build with nothing catching it.
    const defective = mergePatch(base, { bundle: { notARealBundleKey: true } });
    if (validate(defective)) {
      throw new Error('a nested unknown key was accepted; the schema is not being applied deeply');
    }
  });
}

if (failures > 0) {
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nTAURI CONFIG VALIDATION: ALL GREEN');
