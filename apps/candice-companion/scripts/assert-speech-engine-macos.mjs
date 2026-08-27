#!/usr/bin/env node
/**
 * Refuse to ship a macOS Candice that cannot hear.
 *
 * ## Why this exists
 *
 * Voice input on macOS is not downloaded by the installer the way it is on
 * Windows. The engine ships INSIDE the .app: `bundle.resources` copies
 * `speech-assets/` verbatim, and the app resolves `stt-binary-macos` out of
 * SPEECH-INVENTORY.json at runtime.
 *
 * But those bytes are gitignored. They are staged into the source tree by
 * `scripts/relocate-whisper-macos.mjs`, which takes the Homebrew whisper-cpp
 * bottle and makes it self-contained. On any machine where that has not run
 * -- a fresh clone, CI, a second Mac -- the tree simply has no engine, and
 * NOTHING NOTICED:
 *
 *   - generate-speech-inventory.mjs records `bundled: false`,
 *     `sha256Status: "absent"`, prints a count, and exits 0;
 *   - the packaging script has no speech check at all;
 *   - so the DMG builds, signs, notarizes and installs perfectly, and the
 *     first symptom is a user pressing HOLD TO TALK and being told "STT
 *     engine is not installed".
 *
 * A build that ships a mute assistant must fail at the build, not at the
 * user. This is the same lesson as the stale-tree guard in
 * package-macos/build-macos-bundle.sh, which exists because a "fix" was once
 * packaged, signed and reported as shipped while containing none of the
 * fixes.
 *
 * ## What it deliberately does NOT do
 *
 * It does not reject "absent" rows in general. `stt-binary-windows-x64` and
 * `stt-binary-windows-win32` are CORRECTLY absent from a macOS tree -- the
 * Windows installer downloads them as a pinned component. A guard that
 * failed on any absent row would be wrong about the Windows lane and would
 * be disabled within a week.
 *
 * Run: node scripts/assert-speech-engine-macos.mjs [--bundle <path-to.app>]
 */

import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dirname, '..');
const FAIL = (msg) => {
  console.error(`SPEECH-ENGINE FAIL: ${msg}`);
  console.error('  fix: node scripts/relocate-whisper-macos.mjs');
  console.error('       then: node scripts/generate-speech-inventory.mjs');
  process.exit(1);
};

// Prefer the BUILT bundle when one is given or present: that is what
// actually ships. Fall back to the source tree so this is also usable
// before packaging, and SAY which one was measured -- a guard that is vague
// about what it inspected is a guard nobody can act on.
function resolveAssetRoot() {
  const flag = process.argv.indexOf('--bundle');
  const explicit = flag !== -1 ? process.argv[flag + 1] : null;
  const candidates = explicit
    ? [join(explicit, 'Contents', 'Resources', 'speech-assets')]
    : [
      join(APP_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos',
        'Candice Companion.app', 'Contents', 'Resources', 'speech-assets'),
      join(APP_ROOT, 'src-tauri', 'speech-assets'),
    ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'SPEECH-INVENTORY.json'))) {
      return { dir, kind: dir.includes('.app/') ? 'built bundle' : 'source tree' };
    }
  }
  FAIL(`no SPEECH-INVENTORY.json found; looked in:\n    ${candidates.join('\n    ')}`);
}

const { dir: ASSETS, kind } = resolveAssetRoot();
console.log(`speech engine check: measuring the ${kind}\n  ${ASSETS}`);

let inventory;
try {
  inventory = JSON.parse(readFileSync(join(ASSETS, 'SPEECH-INVENTORY.json'), 'utf8'));
} catch (err) {
  FAIL(`SPEECH-INVENTORY.json unreadable: ${err.message}`);
}
const entries = Array.isArray(inventory.entries) ? inventory.entries : [];
if (entries.length === 0) FAIL('SPEECH-INVENTORY.json declares no entries');

// CONTROL: this guard is only meaningful if it is reading a real inventory
// that contains the rows it claims to check. An inventory that silently
// renamed its ids would make every lookup below vacuously "absent" and the
// failure message would blame the wrong thing.
const byId = new Map(entries.map((e) => [e.id, e]));
if (!byId.has('stt-model')) {
  FAIL('inventory has no stt-model row at all — the inventory schema changed, this guard needs updating');
}

// The macOS voice-input closure: the engine, the model it reads, and every
// library the engine was relocated against.
const required = ['stt-model', 'stt-binary-macos',
  ...entries.map((e) => e.id).filter((id) => id.startsWith('stt-lib-macos-'))];
if (required.length < 3) {
  FAIL('no stt-lib-macos-* rows found; the dependency closure was never staged');
}

const missing = required.filter((id) => {
  const e = byId.get(id);
  return !e || e.bundled !== true || e.sha256Status === 'absent';
});
if (missing.length > 0) {
  FAIL(`macOS voice input would ship broken — these are not in the tree:\n    ${missing.join('\n    ')}\n`
    + '  The app would build, sign and install cleanly, and every HOLD TO TALK\n'
    + '  would answer "STT engine is not installed".');
}

// Bytes, not just bookkeeping. The inventory is a record; it can be stale.
for (const id of required) {
  const e = byId.get(id);
  const abs = join(ASSETS, ...String(e.installPath || '').split('/'));
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    FAIL(`${id} is recorded as bundled but is not on disk at ${e.installPath}`);
  }
}

// The relocation actually happened. A Homebrew install name here means the
// engine dies with a dyld error on the first push-to-talk, on a client
// machine that has no /opt/homebrew -- which is exactly the failure
// relocate-whisper-macos.mjs was written to prevent.
const machO = required
  .filter((id) => id !== 'stt-model')
  .map((id) => join(ASSETS, ...String(byId.get(id).installPath).split('/')));
for (const file of machO) {
  let linkage;
  try {
    linkage = execFileSync('otool', ['-L', file], { encoding: 'utf8' });
  } catch (err) {
    FAIL(`could not read install names of ${file}: ${err.message}`);
  }
  const foreign = linkage.split('\n').slice(1)
    .filter((line) => /\/opt\/homebrew|\/usr\/local\//.test(line))
    .map((line) => line.trim());
  if (foreign.length > 0) {
    FAIL(`${file} still links against libraries a client machine will not have:\n    ${foreign.join('\n    ')}`);
  }
}

// Does it actually LOAD? Install names can be correct while a library is
// missing from the directory entirely; dyld only complains at exec time.
// `-h` runs the full dynamic-link step and exits without touching audio.
const engine = join(ASSETS, ...String(byId.get('stt-binary-macos').installPath).split('/'));
try {
  execFileSync(engine, ['-h'], { stdio: 'ignore' });
} catch (err) {
  FAIL(`the staged engine does not execute (dyld closure incomplete): ${err.message}`);
}

// And does it actually TRANSCRIBE on a machine that is not this one?
//
// Everything above passed while voice input was broken for every client. `-h`
// prints usage without ever initialising a compute backend, and `otool -L`
// sees link-time dependencies only. In ggml 0.19 the backends are dlopen'd at
// run time from a path baked in at build time -- /opt/homebrew/Cellar/ggml/
// <version>/libexec for a Homebrew bottle. A developer Mac has that directory.
// A client Mac does not, and there `whisper_init_from_file_with_params` hits
// ggml_backend_dev_init with no device registered and calls ggml_abort:
// SIGABRT, exit 134, no transcript, on the user's first push-to-talk.
//
// So this runs the real engine over real audio with /opt/homebrew denied, and
// that is the only check here that could have caught it. sandbox-exec denies
// the path without touching anything on disk.
const sandboxProfile = join(tmpdir(), `candice-speech-nohb-${process.pid}.sb`);
const probeWav = join(tmpdir(), `candice-speech-probe-${process.pid}.wav`);
const SPOKEN = 'build me a website for my coaching business';
try {
  writeFileSync(sandboxProfile, '(version 1)\n(allow default)\n(deny file-read* (subpath "/opt/homebrew"))\n', 'utf8');
  execFileSync('say', ['-o', probeWav, '--data-format=LEI16@16000', SPOKEN], { stdio: 'ignore' });

  const model = join(ASSETS, ...String(byId.get('stt-model').installPath).split('/'));
  const run = (profile) => {
    try {
      const out = execFileSync(
        'sandbox-exec',
        ['-f', profile, engine, '-m', model, '-f', probeWav, '-nt'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000 },
      );
      return { ok: true, text: String(out).trim().toLowerCase() };
    } catch (err) {
      return { ok: false, text: '', status: err.status, signal: err.signal };
    }
  };

  const denied = run(sandboxProfile);

  if (!denied.ok || !denied.text.includes('coaching business')) {
    // CONTROL: prove it is the DENIAL that broke it, not sandbox-exec itself.
    // Without this, a sandbox that refused to run anything would look exactly
    // like a missing backend, and the build would be blocked for the wrong
    // reason -- or, worse, this check would be deleted as flaky.
    const controlProfile = join(tmpdir(), `candice-speech-control-${process.pid}.sb`);
    writeFileSync(controlProfile, '(version 1)\n(allow default)\n(deny file-read* (subpath "/opt/candice-not-a-real-path"))\n', 'utf8');
    const control = run(controlProfile);
    try { unlinkSync(controlProfile); } catch { /* best effort */ }

    if (!control.ok || !control.text.includes('coaching business')) {
      FAIL('the transcription control did not pass either — this check is broken, not the engine.\n'
        + `    control exit=${control.status ?? 'ok'} signal=${control.signal ?? 'none'} text="${control.text}"`);
    }
    FAIL('the staged engine cannot transcribe on a machine without Homebrew.\n'
      + `    exit=${denied.status ?? 'ok'} signal=${denied.signal ?? 'none'} transcript="${denied.text}"\n`
      + '    The same audio transcribes when an irrelevant path is denied instead, so the\n'
      + '    engine is missing its ggml backend plugins (libggml-*.so). They are dlopen\'d at\n'
      + '    run time and are invisible to otool, so nothing else here can see this.\n'
      + '    Fix: node scripts/relocate-whisper-macos.mjs stages them beside the engine.');
  }
} finally {
  for (const f of [sandboxProfile, probeWav]) {
    try { unlinkSync(f); } catch { /* best effort */ }
  }
}

const windowsRows = entries.filter((e) => e.id.startsWith('stt-binary-windows-'));
console.log(`SPEECH-ENGINE PASS: macOS voice input ships — engine, model and ${machO.length - 1} libraries present, `
  + 'no Homebrew linkage, engine executes.');
console.log(`  (${windowsRows.length} Windows engine rows absent, as designed — the Windows installer downloads those.)`);
