#!/usr/bin/env node
// fix-9router-catalog.mjs - keep 9Router's model-capability catalog correct
// across 9Router updates. No dependencies; macOS and Windows.
//
// 9Router ships its catalog compiled into app/.next-cli-build/server/chunks/*.js
// (duplicated across several chunks whose names change per version). Some
// entries carry wrong limits - e.g. "deepseek-flash" says contextWindow:128e3
// while DeepSeek V4 Flash/Pro are 1M context (references/model-routing.md).
// Every `npm i -g 9router` restores the wrong values, so this re-applies them.
//
// Only CATALOG entries are touched: `"<key>":{...contextWindow:<n>...}`. Other
// objects under the same key (price tables like `"deepseek-flash":{input:.14}`)
// have no contextWindow and never match.
//
// Usage: node fix-9router-catalog.mjs [--check] [--quiet] [--pkg <9router dir>]
//        node fix-9router-catalog.mjs --selftest
// Exit codes:
//   --check : 0 already correct | 3 needs fixing | 2 undetermined (reason named)
//   apply   : 0 nothing to do   | 10 patched - restart 9Router | 2 undetermined
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Extend here: catalog key -> the minified values it must carry.
export const FIX = {
  'deepseek-flash': { contextWindow: '1e6', maxOutput: '384e3' },
};

export const CHUNKS = path.join('app', '.next-cli-build', 'server', 'chunks');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every existing 9Router package dir, in priority order, de-duplicated.
export function findPkgs() {
  const home = os.homedir();
  const c = [];
  if (process.env.NINE_ROUTER_NPM_PREFIX) c.push(path.join(process.env.NINE_ROUTER_NPM_PREFIX, 'lib', 'node_modules', '9router'));
  c.push(path.join(home, '.local', 'share', '999', 'npm', 'lib', 'node_modules', '9router')); // install-nine-router.sh prefix
  c.push(path.join(home, '.npm-global', 'lib', 'node_modules', '9router'));
  if (process.env.APPDATA) c.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '9router')); // Windows npm -g default
  const seen = new Set();
  const keep = (d) => {
    if (!fs.existsSync(path.join(d, CHUNKS))) return false;
    const r = fs.realpathSync(d);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  };
  const found = c.filter(keep);
  if (found.length) return found;
  // `npm root -g` costs ~300ms per launch, so it is only the fallback.
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    if (root && keep(path.join(root, '9router'))) found.push(path.join(root, '9router'));
  } catch { /* npm absent or failing: reported as "no install found" */ }
  return found;
}

// Rewrite every FIX'd catalog entry in one source string.
// Returns { out, found, stale } - found/stale count matching entries.
export function fixSource(src) {
  let found = 0, stale = 0;
  let out = src;
  for (const [key, want] of Object.entries(FIX)) {
    const re = new RegExp(`"${esc(key)}":\\{[^{}]*\\bcontextWindow:[^,}]+[^{}]*\\}`, 'g');
    out = out.replace(re, (entry) => {
      found++;
      let e = entry;
      for (const [prop, val] of Object.entries(want)) {
        e = e.replace(new RegExp(`\\b${prop}:([^,}]+)`), (m, cur) => (Number(cur) === Number(val) ? m : `${prop}:${val}`));
      }
      if (e !== entry) stale++;
      return e;
    });
  }
  return { out, found, stale };
}

// Process one package dir. Returns { found, stale, patched: [files] }.
function processPkg(pkg, apply) {
  const dir = path.join(pkg, CHUNKS);
  let found = 0, stale = 0;
  const patched = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf8');
    const r = fixSource(src);
    found += r.found;
    stale += r.stale;
    if (!apply || r.out === src) continue;
    if (!fs.existsSync(file + '.orig')) fs.copyFileSync(file, file + '.orig'); // one-time pristine copy
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, r.out);
    fs.renameSync(tmp, file);
    patched.push(file);
  }
  return { found, stale, patched };
}

export function run(argv) {
  const check = argv.includes('--check');
  const quiet = argv.includes('--quiet');
  const say = (m) => { if (!quiet) console.log(m); };
  const undetermined = (m) => { console.error(`fix-9router-catalog: UNDETERMINED - ${m}`); return 2; };
  const pi = argv.indexOf('--pkg');
  let pkgs;
  if (pi !== -1) {
    const d = argv[pi + 1];
    if (!d || !fs.existsSync(path.join(d, CHUNKS))) return undetermined(`--pkg ${d || '(missing)'} has no ${CHUNKS}`);
    pkgs = [d];
  } else {
    pkgs = findPkgs();
    if (!pkgs.length) return undetermined('no 9Router install found (checked NINE_ROUTER_NPM_PREFIX, ~/.local/share/999/npm, ~/.npm-global, %APPDATA%\\npm, npm root -g)');
  }
  let rc = 0;
  for (const pkg of pkgs) {
    let r;
    try { r = processPkg(pkg, !check); } catch (e) { return undetermined(`${pkg}: ${e.message}`); }
    if (!r.found) return undetermined(`${pkg}: no catalog entry for ${Object.keys(FIX).join(', ')} in ${CHUNKS} (catalog shape changed?)`);
    if (check) {
      say(`${pkg}: ${r.stale ? `${r.stale} catalog entr${r.stale === 1 ? 'y needs' : 'ies need'} fixing` : 'catalog correct'}`);
      if (r.stale) rc = 3;
    } else if (r.patched.length) {
      say(`${pkg}: patched ${r.patched.length} chunk(s) - restart 9Router to load them`);
      rc = 10;
    } else {
      say(`${pkg}: catalog correct, nothing to do`);
    }
  }
  return rc;
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-9router-catalog-'));
  const dir = path.join(tmp, CHUNKS);
  fs.mkdirSync(dir, { recursive: true });
  const wrong = '"deepseek-flash":{vision:!0,reasoning:!0,thinkingFormat:"deepseek",contextWindow:128e3,maxOutput:64e3}';
  const right = '"deepseek-flash":{vision:!0,reasoning:!0,thinkingFormat:"deepseek",contextWindow:1e6,maxOutput:384e3}';
  const price = '"deepseek-flash":{input:.14,output:.28,cached:.0028}';
  const other = '"other-model":{reasoning:!0,contextWindow:128e3,maxOutput:64e3}';
  const f = path.join(dir, '99.js');
  fs.writeFileSync(f, `a={${wrong},${other}};b={${price}};`);
  let fails = 0;
  const t = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; };
  const q = ['--pkg', tmp, '--quiet'];
  t(run(['--check', ...q]) === 3, '--check on the wrong entry exits 3');
  t(fs.readFileSync(f, 'utf8').includes(wrong), '--check writes nothing');
  t(run(q) === 10, 'apply exits 10 (patched)');
  const after = fs.readFileSync(f, 'utf8');
  t(after === `a={${right},${other}};b={${price}};`, 'only the catalog entry changed (price + unrelated entries intact)');
  t(fs.readFileSync(f + '.orig', 'utf8').includes(wrong), '.orig keeps the pristine file');
  t(!fs.readdirSync(dir).some((n) => n.includes('.tmp-')), 'no temp file left behind');
  t(run(q) === 0 && fs.readFileSync(f, 'utf8') === after, 'second apply is a no-op (exit 0)');
  t(run(['--check', ...q]) === 0, '--check after fix exits 0');
  t(run(['--pkg', path.join(tmp, 'nope'), '--quiet']) === 2, 'missing 9Router exits 2, never throws');
  fs.writeFileSync(f, `b={${price}};`);
  t(run(['--check', ...q]) === 2, 'no catalog entry at all is undetermined (2), not "correct"');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `selftest FAILED (${fails})` : 'selftest OK');
  return fails ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    process.exitCode = argv.includes('--selftest') ? selftest() : run(argv);
  } catch (e) {
    console.error(`fix-9router-catalog: UNDETERMINED - ${e.message}`);
    process.exitCode = 2;
  }
}
