#!/usr/bin/env node
/**
 * Stage the Tauri config files into src-tauri/ before a build.
 *
 * `tauri.conf.json` is authored at the app root and copied into
 * `src-tauri/` (which is gitignored) so the CLI finds it beside Cargo.toml.
 * The PLATFORM files must travel the same way, or a fresh clone builds
 * without them and silently loses the per-platform overrides.
 *
 * This used to be an inline `node -e` one-liner in package.json. It was
 * rewritten the moment it grew a template literal: npm runs the script
 * through a shell, the shell read the backticks as COMMAND SUBSTITUTION
 * and deleted them, and node then received
 *
 *   const s=;if(f.existsSync(s))f.copyFileSync(s,)
 *
 * which is a syntax error that killed the build after the frontend had
 * already been rebuilt. A file has no quoting hazard.
 */
import { copyFileSync, existsSync } from 'node:fs';

const staged = ['tauri.conf.json'];
for (const platform of ['windows', 'macos', 'linux']) {
  staged.push(`tauri.${platform}.conf.json`);
}

let copied = 0;
for (const name of staged) {
  if (!existsSync(name)) continue;
  copyFileSync(name, `src-tauri/${name}`);
  console.log(`staged ${name}`);
  copied += 1;
}

if (copied === 0) {
  console.error('no tauri config found to stage — refusing to build blind');
  process.exit(1);
}
