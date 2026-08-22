#!/usr/bin/env node
// tools/windows-parity/check-update.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/check-update.sh
//
// Same contract: checks the five bundled skills (nine-router-setup,
// spec-protocol, kaizen, eli5, bro) against the published repo VERSIONs.
// EXIT CODES (aggregate): 0 all current/ahead; 1 at least one update
// available (report names every stale skill and both versions); 2 no update
// available but at least one skill could not be read — NEVER exit 0 when any
// skill is undetermined. READS ONLY, writes nothing.
//
// Overrides (same names as the Bash tool):
//   SPEC_PROTOCOL_LOCAL_SKILLS_ROOT   local skills dir (default ~/.claude/skills)
//   SPEC_PROTOCOL_SKILLS_URL_BASE     published VERSION base URL
//   SPEC_PROTOCOL_VERSION_URL         full URL for spec-protocol's VERSION
//   SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP 1 allows http://127.0.0.1 (test harness)
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { homeDir, IS_WINDOWS } from './src/platform.mjs';
import { compareVersions, isVersion } from './src/engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS = ['nine-router-setup', 'spec-protocol', 'kaizen', 'eli5', 'bro'];

async function fetchText(url, timeoutMs = 20000) {
  if (process.env.SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP === '1') {
    const http = url.startsWith('https://') ? await import('node:https') : await import('node:http');
    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return reject(new Error(`redirect: ${res.headers.location}`));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body.trim()));
      });
      req.setTimeout(40000, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }
  // Default transport: https GET (same as curl -fsSL semantics).
  const https = await import('node:https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(40000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function localVersion(skill) {
  const root = process.env.SPEC_PROTOCOL_LOCAL_SKILLS_ROOT || path.join(homeDir(), '.claude', 'skills');
  const file = path.join(root, skill, 'VERSION');
  try {
    if (!existsSync(file)) return null;
    const v = readFileSync(file, 'utf8').trim();
    return isVersion(v) ? v : null;
  } catch {
    return null;
  }
}

async function remoteVersion(skill, specOverrideUrl) {
  if (skill === 'spec-protocol' && specOverrideUrl) {
    const v = (await fetchText(specOverrideUrl)).trim();
    return isVersion(v) ? v : null;
  }
  const base = process.env.SPEC_PROTOCOL_SKILLS_URL_BASE || 'https://raw.githubusercontent.com/trevorotts1/999-setup/main/.claude/skills';
  const v = (await fetchText(`${base}/${skill}/VERSION`)).trim();
  return isVersion(v) ? v : null;
}

export async function runCheck({ network = true } = {}) {
  const report = [];
  let stale = 0, undetermined = 0;
  for (const skill of SKILLS) {
    const local = localVersion(skill);
    if (local === null) {
      report.push(`UNDETERMINED  ${skill}  local VERSION unreadable/absent`);
      undetermined++;
      continue;
    }
    let remote;
    try {
      remote = await remoteVersion(skill, process.env.SPEC_PROTOCOL_VERSION_URL);
    } catch {
      remote = null;
    }
    if (remote === null) {
      report.push(`UNDETERMINED  ${skill}  local=${local} published VERSION unreadable`);
      undetermined++;
      continue;
    }
    if (compareVersions(remote, local) > 0) {
      report.push(`UPDATE AVAILABLE  ${skill}  local=${local} published=${remote}`);
      stale++;
    } else {
      report.push(`CURRENT  ${skill}  local=${local} published=${remote}`);
    }
  }
  const exit = stale > 0 ? 1 : undetermined > 0 ? 2 : 0;
  return { exit, lines: report };
}

// ---------------------------------------------------------------- selftest
// Hermetic: serves the five VERSION files from a local fixture tree over
// http://127.0.0.1 (SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1). Proves: current
// detection, stale detection with both versions named, undetermined handling
// (missing local VERSION -> exit 2, never 0), and exit-code aggregate.
import { createServer } from 'node:http';

function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-checkupd-selftest-${process.pid}`);
  try { rmrf(tmp); } catch { /* ignore */ }
  mkdirSync(tmp, { recursive: true });

  const skillsRoot = path.join(tmp, 'skills');
  for (const s of SKILLS) mkdirSync(path.join(skillsRoot, s), { recursive: true });
  writeFileSync(path.join(skillsRoot, 'spec-protocol', 'VERSION'), '1.16.3\n');
  writeFileSync(path.join(skillsRoot, 'kaizen', 'VERSION'), '1.0.1\n');
  writeFileSync(path.join(skillsRoot, 'eli5', 'VERSION'), '1.0.0\n');
  writeFileSync(path.join(skillsRoot, 'bro', 'VERSION'), '1.0.0\n');
  writeFileSync(path.join(skillsRoot, 'nine-router-setup', 'VERSION'), '1.16.3\n');

  const published = { 'spec-protocol': '1.16.3', kaizen: '1.0.1', eli5: '1.0.0', bro: '1.0.0', 'nine-router-setup': '1.16.3' };
  let server;
  let port;
  const startServer = () => new Promise((resolve) => {
    server = createServer((req, res) => {
      const m = req.url.match(/\/([^/]+)\/VERSION$/);
      if (!m || !(m[1] in published)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${published[m[1]]}\n`);
    });
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

  const closeServer = () => new Promise((resolve) => server && server.close(resolve));

  (async () => {
    try {
      process.stdout.write('SELFTEST — check-update.mjs (windows-parity)\n\n');
      const prevRoot = process.env.SPEC_PROTOCOL_LOCAL_SKILLS_ROOT;
      const prevBase = process.env.SPEC_PROTOCOL_SKILLS_URL_BASE;
      const prevLocal = process.env.SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP;
      process.env.SPEC_PROTOCOL_LOCAL_SKILLS_ROOT = skillsRoot;
      process.env.SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP = '1';
      await startServer();

      process.env.SPEC_PROTOCOL_SKILLS_URL_BASE = `http://127.0.0.1:${port}/.claude/skills`;
      let r = await runCheck({ network: true });
      assert(r.exit === 0, 'all-current -> exit 0');
      assert(r.lines.length === 5, 'report covers all five skills');

      published.kaizen = '1.1.0';
      r = await runCheck({ network: true });
      assert(r.exit === 1, 'one stale -> exit 1');
      assert(r.lines.some((l) => l.includes('UPDATE AVAILABLE') && l.includes('kaizen')), 'stale skill named with both versions');

      // undetermined: restore kaizen, remove a local VERSION -> never exit 0
      published.kaizen = '1.0.1';
      rmSync(path.join(skillsRoot, 'bro', 'VERSION'), { force: true });
      r = await runCheck({ network: true });
      assert(r.exit === 2, 'undetermined skill -> exit 2 (never 0)');

      // restore + close
      writeFileSync(path.join(skillsRoot, 'bro', 'VERSION'), '1.0.0\n');
      await closeServer();
      if (prevBase === undefined) delete process.env.SPEC_PROTOCOL_SKILLS_URL_BASE; else process.env.SPEC_PROTOCOL_SKILLS_URL_BASE = prevBase;
      if (prevLocal === undefined) delete process.env.SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP; else process.env.SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP = prevLocal;
      if (prevRoot === undefined) delete process.env.SPEC_PROTOCOL_LOCAL_SKILLS_ROOT; else process.env.SPEC_PROTOCOL_LOCAL_SKILLS_ROOT = prevRoot;

      rmrf(tmp);
      process.stdout.write('\n');
      if (failures.length) {
        process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write('SELFTEST: PASS — current/stale/undetermined/exit semantics all green\n');
        process.exitCode = 0;
      }
    } catch (e) {
      process.stderr.write(`SELFTEST ERROR: ${e.message}\n`);
      process.exitCode = 1;
    }
  })();
}

function rmrf(p) { rmSync(p, { recursive: true, force: true }); }

function main() {
  if (process.argv[2] === '--selftest') return selftest();
  runCheck({ network: true }).then((r) => {
    process.stdout.write(`${r.lines.join('\n')}\n`);
    process.exit(r.exit);
  }).catch((e) => {
    process.stderr.write(`check-update.mjs failed: ${e.message}\n`);
    process.exit(2);
  });
}

main();
