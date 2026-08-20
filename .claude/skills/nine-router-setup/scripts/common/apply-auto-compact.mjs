#!/usr/bin/env node
// apply-auto-compact.mjs — ensure Claude Code auto-compaction is enabled on a box.
//
// Writes (or verifies) exactly two TOP-LEVEL keys in the target Claude Code
// settings.json:
//   "autoCompactEnabled": true
//   "autoCompactWindow": N        (default 500000; clamped to 100000..1000000)
//
// Contract (see nine-router-setup SKILL.md Step 9.8):
//   - Target missing  -> create parent dirs, write the two keys, print
//     "set: <path>", exit 0.
//   - Target parses   -> if both keys already equal the target values, print
//     "already set: <path>", write NOTHING (no backup), exit 0. Otherwise copy
//     the original to <path>.bak-pre-autocompact-<yyyyMMdd-HHMMSS> (never
//     clobber an existing backup - append -2, -3, ...), merge the two keys,
//     preserve every other key untouched, write 2-space indent, print
//     "set: <path> (backup: <bak>)", exit 0.
//   - Target invalid  -> print "refusing: <path> is not valid JSON (nothing
//     changed)", exit 1. NEVER overwrite or delete an unparseable file.
//   - --dry-run       -> print "would set: <path>" / "already set: <path>" /
//     "would refuse: <path>", write nothing, exit 0 (1 in the refuse case).
//   - Usage errors    -> print usage to stderr, exit 2.
//
// Plain Node >= 20. Zero dependencies. No network. No secrets. Never prints
// file contents or any key's VALUE other than the two key names. Never touches
// any file other than the target and its backup.

import fs from 'node:fs';
import path from 'node:path';

const KEYS = Object.freeze({
  autoCompactEnabled: true,
  autoCompactWindow: 500000,
});
const MIN_WINDOW = 100000;
const MAX_WINDOW = 1000000;

function usage() {
  console.error('usage: node apply-auto-compact.mjs [--window 500000] [--settings <absolute path>] [--dry-run]');
}

function parseArgs(argv) {
  const opts = { window: KEYS.autoCompactWindow, settings: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--window') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v)) return null;
      opts.window = Number(v);
    } else if (a === '--settings') {
      const v = argv[++i];
      if (v === undefined) return null;
      opts.settings = v;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '-h' || a === '--help') {
      return { help: true };
    } else {
      return null;
    }
  }
  if (!opts.settings) {
    opts.settings = path.join(process.env.HOME || '', '.claude', 'settings.json');
  }
  if (!path.isAbsolute(opts.settings)) return null;
  if (!Number.isInteger(opts.window) || opts.window < 1) return null;
  // Valid windows clamp to the documented range; anything else stays a usage
  // error so the caller is told immediately rather than silently clamped.
  if (opts.window < MIN_WINDOW || opts.window > MAX_WINDOW) return null;
  return opts;
}

function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function nextBackupPath(target) {
  const base = `${target}.bak-pre-autocompact-${timestamp()}`;
  let candidate = base;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

function targetEquals(obj, window) {
  return (
    obj.autoCompactEnabled === KEYS.autoCompactEnabled &&
    obj.autoCompactWindow === window
  );
}

function merge(obj, window) {
  // Preserve every other key untouched; set only the two auto-compact keys.
  return { ...obj, autoCompactEnabled: KEYS.autoCompactEnabled, autoCompactWindow: window };
}

function writeJson(target, obj) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    usage();
    process.exit(2);
  }
  if (opts.help) {
    usage();
    process.exit(0);
  }

  const target = opts.settings;
  let raw = null;
  let exists = false;
  try {
    raw = fs.readFileSync(target, 'utf8');
    exists = true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`error: cannot read ${target}: ${err.message}`);
      process.exit(1);
    }
  }

  if (!exists) {
    if (opts.dryRun) {
      console.log(`would set: ${target}`);
      process.exit(0);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeJson(target, { autoCompactEnabled: KEYS.autoCompactEnabled, autoCompactWindow: opts.window });
    console.log(`set: ${target}`);
    process.exit(0);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Invalid JSON: never overwrite or delete an unparseable file.
    if (opts.dryRun) {
      console.log(`would refuse: ${target} is not valid JSON (nothing changed)`);
      process.exit(1);
    }
    console.log(`refusing: ${target} is not valid JSON (nothing changed)`);
    process.exit(1);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (opts.dryRun) {
      console.log(`would refuse: ${target} is not a JSON object (nothing changed)`);
      process.exit(1);
    }
    console.log(`refusing: ${target} is not a JSON object (nothing changed)`);
    process.exit(1);
  }

  if (targetEquals(parsed, opts.window)) {
    // Already correct: write NOTHING, no backup, no mtime change.
    console.log(`already set: ${target}`);
    process.exit(0);
  }

  if (opts.dryRun) {
    console.log(`would set: ${target}`);
    process.exit(0);
  }

  const backup = nextBackupPath(target);
  fs.copyFileSync(target, backup);
  const merged = merge(parsed, opts.window);
  writeJson(target, merged);
  console.log(`set: ${target} (backup: ${backup})`);
  process.exit(0);
}

main();
