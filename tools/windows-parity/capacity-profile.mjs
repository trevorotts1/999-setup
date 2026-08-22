#!/usr/bin/env node
// tools/windows-parity/capacity-profile.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/capacity-profile.sh
//
// Same three subcommands, same allowlist/deny-list enforcement, same JSON
// profile shape, same exit codes:
//   read [<profile-path>]         prints the profile (or a clear none-yet line)
//   write [<profile-path>] <answers-file>    validates + atomically writes
//   fingerprint <measured-config-file>       prints a stable 8-hex comparator
//   --selftest                               instrument proof, no writes
// Exit: 0 ok; 1 write failure/lock timeout; 2 refused (forbidden key, invalid
// input); 3 UNDETERMINED (unreadable/missing profile — never a fabricated
// empty one).
//
// The deny-list is IDENTICAL to the Bash tool: no secrets (by key name shape
// or value shape), nothing measured, no client material, no free-text notes.
// Windows paths via Known Folders ([Environment]::GetFolderPath) — never
// hardcoded C:\Users\*.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { userPath, homeDir } from './src/platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWLIST = [
  'OLLAMA_PLAN', 'AGNES_PLAN', 'DEEPSEEK_PATH', 'RESERVE_PCT', 'USAGE_WINDOW',
  'EFFORT_SETTING', 'FALLBACKS', 'LAST_A4_WIDTH', 'OVERNIGHT_CAPACITY_POLICY',
  'MEDIA_PROVIDER_PREF',
];
// Refusals by name (row 2 of the deny-list: measured things stay measured)
const REFUSED_BY_NAME = new Set([
  'HARNESS', 'LAUNCHER', 'BUILDER_PROVIDER', 'DEEPSEEK_TIER', 'OLLAMA_CONCURRENCY',
  'CORES', 'CORES_SOURCE', 'SYSTEM_CONCURRENT_MAX', 'THROTTLE', 'MODE', 'COMMANDERS',
  'CONFIG_FP', 'PROJECT', 'KEY_LIVENESS', 'BALANCES', 'RATE_COUNTS', 'BURN_FIGURES',
  'ROLE_BUILDER', 'ROLE_RESEARCHER', 'ROLE_VISUAL', 'ROLE_TECHNICAL',
  'ROLE_SECURITY', 'ROLE_RELEASE', 'CONTEXT_WINDOWS', 'ROUTER_STATE',
]);
const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
const SECRET_VALUE_RE = /^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|eyJ|xox.|AIza|-----BEGIN)/i;

export function defaultProfilePath() {
  if (process.env.SPEC_PROTOCOL_PROFILE) return process.env.SPEC_PROTOCOL_PROFILE;
  return path.join(userPath('LocalApplicationData'), 'BlackCEO', 'spec-protocol', 'capacity-profile.json');
}

export function validateForWrite(answers) {
  const entries = {};
  for (const [k, rawV] of Object.entries(answers)) {
    const v = String(rawV);
    if (k === '') continue;
    if (REFUSED_BY_NAME.has(k)) return { ok: false, reason: `refused by name: ${k}` };
    if (SECRET_NAME_RE.test(k)) return { ok: false, reason: `refused (secret-shaped key name): ${k}` };
    if (SECRET_VALUE_RE.test(v)) return { ok: false, reason: `refused (secret-shaped value): ${k}` };
    if (v.length > 64) return { ok: false, reason: `refused (value over 64 chars): ${k}` };
    if (!ALLOWLIST.includes(k)) return { ok: false, reason: `not on the allowlist: ${k}` };
    entries[k] = v;
  }
  return { ok: true, entries };
}

function acquireLock(lockDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      writeFileSync(path.join(lockDir, 'owner'), `pid=${process.pid} acquired=${new Date().toISOString()}\n`, 'utf8');
      return true;
    } catch {
      try {
        const st = statSync(lockDir);
        if (Date.now() - st.mtimeMs > 60000) rmSync(lockDir, { recursive: true, force: true });
      } catch { /* vanished between stat and rm — retry */ }
      const jitter = 50 + Math.floor(Math.random() * 160);
      const t0 = Date.now();
      while (Date.now() - t0 < jitter) { /* jittered backoff */ }
    }
  }
  return false;
}

export function writeProfile(profilePath, answers, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const v = validateForWrite(answers);
  if (!v.ok) return { exit: 2, error: `PROFILE WRITE REFUSED — ${v.reason}` };
  const doc = { version: 1, updated_utc: nowIso, entries: v.entries };
  const dir = path.dirname(profilePath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { exit: 2, error: `cannot create profile directory ${dir}: ${e.message}` };
  }
  const tmp = `${profilePath}.tmp.${process.pid}`;
  const bak = `${profilePath}.bak`;
  const lock = `${profilePath}.lock`;
  try {
    if (!acquireLock(lock, 20000)) {
      return { exit: 1, error: `could not acquire profile lock ${lock} within 20s — refusing to write ${profilePath} unlocked` };
    }
    try {
      if (existsSync(profilePath)) {
        try { copyFileSync(profilePath, bak); } catch { /* backup is best-effort */ }
      }
      writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      renameSync(tmp, profilePath);
    } finally {
      try { rmSync(lock, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const verify = readFileSync(profilePath, 'utf8').trim();
    if (verify !== JSON.stringify(doc, null, 2)) {
      return { exit: 1, error: 'profile write verification failed — file content mismatch' };
    }
    return { exit: 0, doc };
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { exit: 1, error: `profile write failed: ${e.message}` };
  }
}

export function readProfile(profile) {
  let raw;
  try {
    raw = readFileSync(profile, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { exit: 3, error: 'UNDETERMINED — no profile yet (first run is the normal case; the interviewer asks, nothing is assumed)' };
    }
    return { exit: 3, error: `UNDETERMINED — profile unreadable: ${e.message}` };
  }
  if (!raw.trim()) return { exit: 3, error: 'UNDETERMINED — profile exists but is empty; never treated as a valid empty profile' };
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object' || !doc.entries || typeof doc.entries !== 'object') {
      return { exit: 3, error: 'UNDETERMINED — profile exists but is not a valid profile document' };
    }
    return { exit: 0, doc };
  } catch {
    return { exit: 3, error: 'UNDETERMINED — profile exists but is not valid JSON' };
  }
}

export function fingerprint(configText) {
  return crypto.createHash('sha256').update(configText).digest('hex').slice(0, 8);
}

export function parseAnswersFile(file) {
  const text = readFileSync(file, 'utf8');
  const answers = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    answers[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return answers;
}

// ---------------------------------------------------------------- selftest
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-profile-selftest-${process.pid}`);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(tmp, { recursive: true });
  const profile = path.join(tmp, 'profile.json');

  process.stdout.write('SELFTEST — capacity-profile.mjs (windows-parity)\n\n');

  const w = writeProfile(profile, { OLLAMA_PLAN: '100', RESERVE_PCT: '25' });
  assert(w.exit === 0, 'allowlisted write succeeds');
  const r = readProfile(profile);
  assert(r.exit === 0 && r.doc.entries.OLLAMA_PLAN === '100', 'profile reads back');
  assert(r.doc.entries.RESERVE_PCT === '25', 'reserve is a policy field, allowed');

  const refuse = writeProfile(path.join(tmp, 'x.json'), { API_KEY: 'sk-test123' });
  assert(refuse.exit === 2 && refuse.error.includes('API_KEY'), 'secret-shaped NAME refused');

  const refuseVal = writeProfile(path.join(tmp, 'y.json'), { OLLAMA_PLAN: 'sk-abcdef1234567890' });
  assert(refuseVal.exit === 2, 'secret-shaped VALUE refused');

  const refuseMeasured = writeProfile(path.join(tmp, 'z.json'), { CORES: '12' });
  assert(refuseMeasured.exit === 2 && refuseMeasured.error.includes('CORES'), 'measured content (CORES) refused — never stored');

  const refuseClient = writeProfile(path.join(tmp, 'q.json'), { CLIENT_NAME: 'acme' });
  assert(refuseClient.exit === 2, 'non-allowlisted key refused (client material)');

  const miss = readProfile(path.join(tmp, 'missing.json'));
  assert(miss.exit === 3 && miss.error.includes('UNDETERMINED'), 'missing profile -> UNDETERMINED, never an empty answer');

  const fp = fingerprint('launcher=claude-nine\nbuilder=opus\n');
  assert(/^[0-9a-f]{8}$/.test(fp), `fingerprint is 8-hex (${fp})`);
  assert(fp === fingerprint('launcher=claude-nine\nbuilder=opus\n'), 'fingerprint deterministic for same input');
  assert(fp !== fingerprint('launcher=claude-nine\nbuilder=sonnet\n'), 'fingerprint changes when the world changes');

  // upsert semantics: second write overwrites, keeps one entry set
  const w2 = writeProfile(profile, { OLLAMA_PLAN: '20' });
  assert(w2.exit === 0, 'second write succeeds');
  const r2 = readProfile(profile);
  assert(r2.doc.entries.OLLAMA_PLAN === '20', 'upsert overwrote the old value');
  assert(r2.doc.entries.RESERVE_PCT === undefined, 'absent fields do not linger');

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — all allowlist/deny-list/fingerprint checks passed\n');
    process.exitCode = 0;
  }
}

function main() {
  const [sub, a1, a2] = process.argv.slice(2);
  if (sub === '--selftest') return selftest();
  if (sub === 'read') {
    const profile = a1 || defaultProfilePath();
    const r = readProfile(profile);
    if (r.exit !== 0) {
      process.stderr.write(`${r.error}\n`);
      process.exit(r.exit);
    }
    process.stdout.write(`PROFILE READ (${profile})\n`);
    for (const [k, v] of Object.entries(r.doc.entries)) process.stdout.write(`${k}=${v}\n`);
    process.stdout.write(`updated_utc=${r.doc.updated_utc || 'unknown'}\n`);
    process.exit(0);
  }
  if (sub === 'write') {
    const profile = a2 ? a1 : defaultProfilePath();
    const file = a2 || a1;
    let answers;
    try {
      answers = parseAnswersFile(file);
    } catch {
      process.stderr.write(`ERROR: answers file not found: ${file}\n`);
      process.exit(2);
    }
    const w = writeProfile(profile, answers);
    if (w.exit !== 0) {
      process.stderr.write(`${w.error}\n`);
      process.exit(w.exit);
    }
    process.stdout.write(`PROFILE WRITTEN (${profile})\n`);
    process.exit(0);
  }
  if (sub === 'fingerprint') {
    if (!a1) { process.stderr.write('ERROR: fingerprint needs <config-file>\n'); process.exit(2); }
    let text;
    try {
      text = readFileSync(a1, 'utf8');
    } catch {
      process.stderr.write(`ERROR: config file not found: ${a1}\n`);
      process.exit(2);
    }
    process.stdout.write(`${fingerprint(text)}\n`);
    process.exit(0);
  }
  process.stderr.write('usage: capacity-profile.mjs read [<profile>] | write [<profile>] <answers-file> | fingerprint <config-file> | --selftest\n');
  process.exit(2);
}

main();
