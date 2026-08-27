#!/usr/bin/env node
/**
 * Re-measure the speech inventory's own-tree rows AFTER code signing.
 *
 * ## The problem this fixes
 *
 * `codesign` rewrites a Mach-O file in place — the signature lives inside the
 * binary. So every executable and dylib we sign has a different SHA-256 after
 * packaging than it had when `generate-speech-inventory.mjs` measured it in
 * `src-tauri/speech-assets/`.
 *
 * The shipped manifest therefore described bytes that no longer existed. The
 * FIX-019 packaged suite caught it exactly, naming five rows:
 *
 *   stt-binary-macos, stt-lib-macos-libwhisper-1-9-2,
 *   stt-lib-macos-libggml-0-19-0, stt-lib-macos-libggml-base-0-19-0,
 *   stt-lib-macos-libomp
 *
 * — which is precisely the set the packaging log reports as "replacing
 * existing signature". Nothing else in the bundle moved, and the one row that
 * is a genuine upstream pin (`stt-model`, a ggml data file, not Mach-O) still
 * matched. That is the whole causal chain, and it is why the fix is narrow.
 *
 * ## The rule
 *
 * `sha256Status` already distinguishes the two kinds of hash, and they must be
 * treated as opposites:
 *
 *   "measured-from-tree" — we measured our OWN build output. Signing is part
 *       of producing that output, so the honest value is the post-signing one.
 *       Re-measure.
 *
 *   "pinned" (or anything else) — an authoritative hash for an artifact we did
 *       not build, carried to prove the supply chain. Rewriting one would
 *       silently launder a substituted file into a passing check. NEVER touch.
 *       If such a row stops matching, that is a finding, and this script fails.
 *
 * Run AFTER the nested executables are signed and BEFORE the outer .app is
 * signed, so the app signature covers the corrected manifest.
 *
 * Usage: node scripts/restamp-speech-inventory.mjs --bundle "<path>/Candice Companion.app"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const args = process.argv.slice(2);
const bundleIndex = args.indexOf('--bundle');
if (bundleIndex === -1 || !args[bundleIndex + 1]) {
  console.error('restamp-speech-inventory: --bundle <path to .app> is required');
  process.exit(2);
}
const BUNDLE = args[bundleIndex + 1];
const ASSETS = join(BUNDLE, 'Contents', 'Resources', 'speech-assets');
const MANIFEST = join(ASSETS, 'SPEECH-INVENTORY.json');

function fail(message) {
  console.error(`restamp-speech-inventory: ${message}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) {
  // Not every posture ships speech assets. Say so plainly rather than
  // exiting 0 in silence, which would look identical to "restamped fine".
  console.log(`restamp-speech-inventory: no manifest at ${MANIFEST} — nothing to restamp`);
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  fail(`manifest unreadable: ${err.message}`);
}

const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
if (entries.length === 0) fail('manifest declares no entries — refusing to write an empty restamp');

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const restamped = [];
const untouched = [];
const pinnedMismatches = [];
let considered = 0;

for (const entry of entries) {
  if (entry.bundled !== true || !entry.installPath) continue;
  const file = join(ASSETS, entry.installPath);
  if (!existsSync(file)) continue; // absence is the other legs' business, not this one
  considered += 1;
  const measured = sha256(file);
  if (measured === entry.sha256) continue;

  if (entry.sha256Status === 'measured-from-tree') {
    restamped.push({ id: entry.id, from: entry.sha256, to: measured });
    entry.sha256 = measured;
    // sizeBytes moves with the signature too, and a stale size is the same
    // class of lie as a stale hash.
    entry.sizeBytes = readFileSync(file).length;
  } else {
    pinnedMismatches.push({ id: entry.id, status: entry.sha256Status, pinned: entry.sha256, measured });
  }
}

// CONTROL: if nothing was even examined, every result below is vacuous. This
// script reporting "0 restamped" must mean "checked and none needed it", never
// "found nothing to check".
if (considered === 0) {
  fail(`walked ${entries.length} entries and found no bundled file on disk — the manifest and the bundle do not agree, so a clean result here would be meaningless`);
}

if (pinnedMismatches.length > 0) {
  console.error('restamp-speech-inventory: REFUSING to restamp — these rows are pinned, not measured:');
  for (const m of pinnedMismatches) {
    console.error(`  ${m.id} (${m.status}): pinned ${m.pinned.slice(0, 16)}, measured ${m.measured.slice(0, 16)}`);
  }
  console.error('  A pinned hash proves an artifact we did not build. Rewriting one would launder');
  console.error('  a substituted file into a passing check. Investigate the payload, not this script.');
  process.exit(1);
}

if (restamped.length === 0) {
  console.log(`restamp-speech-inventory: checked ${considered} bundled rows, none needed restamping`);
  process.exit(0);
}

manifest.restampedAfterSigning = {
  at: new Date().toISOString(),
  by: 'scripts/restamp-speech-inventory.mjs',
  reason: 'codesign rewrites Mach-O files in place; own-tree measurements are taken after signing',
  rows: restamped.map((r) => r.id),
};

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`restamp-speech-inventory: checked ${considered} bundled rows, restamped ${restamped.length} after signing`);
for (const r of restamped) {
  console.log(`  ${r.id}: ${r.from.slice(0, 16)} -> ${r.to.slice(0, 16)}`);
}
