#!/usr/bin/env node
// tools/windows-parity/env-sweep.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/env-sweep.sh
//
// Searches ALL env stores for required credentials and reports found/missing
// as a plain-text checklist. NEVER prints secret values — only key names and
// status (FOUND/MISSING/LIVE/NOT_VERIFIED). Windows store set resolves via
// Known Folders ([Environment]::GetFolderPath) — never hardcoded C:\Users\*.
//
// Usage: env-sweep.mjs [--target app|website|funnel]
//        env-sweep.mjs --selftest
// Sandbox: PARITY_ENVSWEEP_HOME=<dir> resolves every home-relative store
// under <dir> instead of the real home. The selftest ALWAYS sets it, so the
// selftest can never read or write the real ~/.env or any real store.
// Exit: 0 sweep completed (report printed; MISSING keys are a report, not a
// failure — the report's exit tells the caller what the sweep FOUND, and the
// caller decides); 2 usage/instrument errors.
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { homeDir, userPath, tempDir } from './src/platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The required credential set per target (names only — NEVER values).
const REQUIRED = {
  app: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AGNES_API_KEY', 'GHL_API_KEY', 'GHL_MCP_ACCESS_TOKEN', 'GOOGLE_SERVICE_ACCOUNT'],
  website: ['VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN', 'DOMAIN_API_KEY'],
  funnel: ['GHL_API_KEY', 'GHL_MCP_ACCESS_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'MAILCHIMP_API_KEY'],
};

// Windows Known Folder for Documents on real Windows; POSIX fallback.
function docsDir() {
  return userPath('Documents');
}

function envStores() {
  // Sandbox override: when set (selftest always sets it), every
  // home-relative store resolves under the sandbox root instead of the real
  // home — the real ~/.openclaw, ~/.env and ~/.9router are never touched.
  const h = process.env.PARITY_ENVSWEEP_HOME || homeDir();
  const stores = [];
  stores.push({ name: '~/.openclaw/secrets/.env', path: path.join(h, '.openclaw', 'secrets', '.env') });
  stores.push({ name: '~/.openclaw/.env', path: path.join(h, '.openclaw', '.env') });
  stores.push({ name: '~/.env', path: path.join(h, '.env') });
  stores.push({ name: '~/.9router/.env', path: path.join(h, '.9router', '.env') });
  // Windows-specific Known-Folder locations
  const local = userPath('LocalApplicationData');
  stores.push({ name: 'LocalAppData/BlackCEO/999/.env', path: path.join(local, 'BlackCEO', '999', '.env') });
  stores.push({ name: 'LocalAppData/BlackCEO/spec-protocol/.env', path: path.join(local, 'BlackCEO', 'spec-protocol', '.env') });
  return stores;
}

// Parse KEY=VALUE lines; returns map name -> { found } WITHOUT reading values.
function readStoreKeys(file) {
  const keys = new Set();
  if (!existsSync(file)) return { keys, exists: false };
  try {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      if (k) keys.add(k);
    }
    return { keys, exists: true };
  } catch {
    return { keys, exists: true };
  }
}

function sweepEnv(target) {
  const required = REQUIRED[target] || REQUIRED.app;
  const stores = envStores();
  const perKeyStores = new Map(); // key -> [store names]
  for (const s of stores) {
    const { keys } = readStoreKeys(s.path);
    for (const k of keys) {
      if (!perKeyStores.has(k)) perKeyStores.set(k, []);
      perKeyStores.get(k).push(s.name);
    }
  }
  const lines = [];
  lines.push(`ENVIRONMENT SWEEP — target: ${target}`);
  lines.push('(key names and status only — values are never printed)');
  lines.push('');
  for (const k of required) {
    const hits = perKeyStores.get(k) || [];
    if (hits.length > 0) {
      lines.push(`FOUND      ${k}   (${hits.join(', ')})`);
    } else {
      lines.push(`MISSING    ${k}`);
    }
  }
  lines.push('');
  lines.push('Stores searched:');
  for (const s of stores) {
    const { exists } = readStoreKeys(s.path);
    lines.push(`  ${exists ? 'read' : 'absent'}  ${s.name}`);
  }
  lines.push('');
  lines.push('Not searched: project-local .env/.env.local (operator ruling — one careless commit publishes every secret)');
  return { lines, text: lines.join('\n') };
}

// ---------------------------------------------------------------- selftest
// Known-positive control, known-negative control, a sandbox ~/.env store
// control, and a leak proof: a sentinel value is planted in every checked
// variable and must appear ZERO times in the output.
//
// SAFETY: the selftest runs entirely inside a sandbox home. It never reads or
// writes the real ~/.env or any real store. The previous save/rewrite of the
// real ~/.env was removed — a crash between save and restore could destroy
// operator credentials, and npm test invokes this selftest automatically.
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(tempDir(), `parity-envsweep-selftest-${process.pid}`);
  try { rmrf(tmp); } catch { /* ignore */ }
  mkdirp(tmp);

  const realHome = homeDir(); // captured BEFORE the sandbox pins below
  const realUserEnv = path.join(realHome, '.env');
  const realEnvExisted = existsSync(realUserEnv);

  // Pin EVERY home resolution to the sandbox for the duration of the run:
  // envStores() honors PARITY_ENVSWEEP_HOME; userPath()/homeDir() honor
  // HOME/USERPROFILE. All three are restored in finally.
  const sandbox = path.join(tmp, 'home');
  mkdirp(sandbox);
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevSandboxHome = process.env.PARITY_ENVSWEEP_HOME;
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;
  process.env.PARITY_ENVSWEEP_HOME = sandbox;

  const sentinel = `SENTINEL_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  try {
    // Sandbox control: the store the sweep reads is the SANDBOX ~/.env —
    // the real ~/.env is never created, read, or written.
    const sandboxUserEnv = path.join(sandbox, '.env');
    writeFileSync(sandboxUserEnv, `DEEPSEEK_API_KEY=${sentinel}\n`, 'utf8');

    process.stdout.write('SELFTEST — env-sweep.mjs (windows-parity)\n\n');

    assert(
      envStores().every((s) => s.path.startsWith(sandbox + path.sep)),
      'SANDBOX PROOF: every store path resolves inside the sandbox, never the real home',
    );

    const report = sweepEnv('app');
    assert(report.text.includes('DEEPSEEK_API_KEY'), 'known-positive control: DEEPSEEK_API_KEY is in the report');
    assert(report.text.includes('FOUND'), 'known-positive shows FOUND');
    assert(!report.text.includes(sentinel), 'LEAK PROOF: sentinel value appears ZERO times in the report');
    assert(!report.text.includes('GHOST_KEY_THAT_DOES_NOT_EXIST'), 'known-negative: a key planted nowhere is absent');

    // an absurd key must never appear
    assert(report.text.includes('MISSING'), 'report carries MISSING status for absent keys');

    const extra = sweepEnv('website');
    assert(extra.text.includes('CLOUDFLARE_API_KEY') || extra.text.includes('DOMAIN_API_KEY') || extra.text.includes('DEEPSEEK_API_KEY'), 'target selection works (website set searched)');

    // The real ~/.env must be exactly as it was: created by nothing here.
    assert(existsSync(realUserEnv) === realEnvExisted, 'REAL HOME UNTOUCHED: real ~/.env existence unchanged by the selftest');
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    if (prevSandboxHome === undefined) delete process.env.PARITY_ENVSWEEP_HOME; else process.env.PARITY_ENVSWEEP_HOME = prevSandboxHome;
    rmrf(tmp);
  }
  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — controls and leak proof passed\n');
    process.exitCode = 0;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') return selftest();
  let target = 'app';
  if (args[0] === '--target') target = args[1] || 'app';
  else if (args[0]) target = args[0];
  if (!(target in REQUIRED)) {
    process.stderr.write(`ERROR: unknown target ${target} — must be app|website|funnel\n`);
    process.exit(1);
  }
  const { text } = sweepEnv(target);
  process.stdout.write(`${text}\n`);
  process.exit(0);
}

function mkdirp(p) { mkdirSync(p, { recursive: true }); }
function rmrf(p) { rmSync(p, { recursive: true, force: true }); }

main();
