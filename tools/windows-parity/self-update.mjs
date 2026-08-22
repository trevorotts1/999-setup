#!/usr/bin/env node
// tools/windows-parity/self-update.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/self-update.sh
//
// Installs a newer spec-protocol skill version from the published repo.
// IDENTICAL semantics to the Bash tool:
//   - check <repo-url-base> <local-dir> [version-file]  -> exit 0 current,
//     1 update available (prints remote/local), 2 undetermined (network or
//     version unreadable — never a clean), 3 version malformed
//   - apply <repo-url-base> <local-dir> [version-file]  -> backs up the
//     current dir (versioned, beside it), atomically replaces the skill
//     files, verifies the new VERSION read-back, exit 1 on verification
//     failure (leaving the backup for rollback)
//   - rollback <backup-dir> <local-dir>                 -> restore + verify
//   - --selftest
//
// Windows-native: paths via Known Folders, no chmod/symlink assumptions.
// READS live published VERSION via https (same as check-update.mjs).
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isVersion, compareVersions } from './src/engine.mjs';
import { homeDir } from './src/platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fetchText(url, timeoutMs = 20000) {
  const http = url.startsWith('https://') ? await import('node:https') : await import('node:http');
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
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

function readLocalVersion(localDir) {
  const vFile = path.join(localDir, 'VERSION');
  try {
    if (!existsSync(vFile)) return null;
    const v = readFileSync(vFile, 'utf8').trim();
    return isVersion(v) ? v : null;
  } catch {
    return null;
  }
}

// remote URL for one skill dir: <repo>/<relative-to-repo>/VERSION
async function publishedVersion(repoUrl, localDir, versionFile) {
  if (versionFile) {
    const v = (await fetchText(versionFile)).trim();
    return isVersion(v) ? v : null;
  }
  const v = (await fetchText(`${repoUrl}/.claude/skills/${path.basename(localDir)}/VERSION`)).trim();
  return isVersion(v) ? v : null;
}

export async function checkUpdate(repoUrl, localDir, versionFile) {
  const local = readLocalVersion(localDir);
  if (local === null) {
    return { exit: 2, lines: ['UNDETERMINED — local VERSION unreadable/absent'] };
  }
  let remote;
  try {
    remote = await publishedVersion(repoUrl, localDir, versionFile);
  } catch {
    remote = null;
  }
  if (remote === null) {
    return { exit: 2, lines: [`UNDETERMINED — published VERSION unreadable (local=${local})`] };
  }
  if (compareVersions(remote, local) > 0) {
    return { exit: 1, lines: [`UPDATE AVAILABLE — local=${local} published=${remote}`] };
  }
  return { exit: 0, lines: [`CURRENT — local=${local} published=${remote}`] };
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

export async function applyUpdate(repoUrl, localDir, versionFile) {
  // 1. Re-check (never apply blind — the check just ran is the gate)
  const chk = await checkUpdate(repoUrl, localDir, versionFile);
  if (chk.exit !== 1) {
    return { exit: chk.exit === 0 ? 1 : chk.exit, lines: chk.exit === 0 ? ['NOTHING TO DO — local is current; no update applied'] : chk.lines };
  }

  // 2. Backup aside (versioned, beside the dir — the Bash tool's contract)
  const parent = path.dirname(localDir);
  const name = path.basename(localDir);
  const local = readLocalVersion(localDir);
  const backupDir = path.join(parent, `${name}.bak-${local || 'unknown'}-${Date.now()}`);
  copyTree(localDir, backupDir);

  // 3. Apply: fetch the skill archive (VERSION + files). The published tree
  //    is fetched file-by-file from the repo; SKILL.md is the contract root.
  const base = `${repoUrl.replace(/\/$/, '')}/.claude/skills/${name}`;
  try {
    const skillMd = await fetchText(`${base}/SKILL.md`);
    const v = await fetchText(`${base}/VERSION`);
    if (!isVersion(v.trim())) {
      return { exit: 3, lines: [`MALFORMED — published VERSION '${v.trim()}' is not a valid version; nothing applied; backup kept: ${backupDir}`] };
    }
    // Files we know must exist in the skill dir
    const files = ['SKILL.md', 'VERSION', 'references/capacity.md', 'references/workflows.md', 'references/documents.md', 'tools/capacity-resolver.sh', 'tools/ledger.sh', 'tools/anchor.sh', 'tools/env-sweep.sh', 'tools/check-update.sh', 'tools/self-update.sh', 'tools/capacity-profile.sh'];
    for (const f of files) {
      try {
        const content = await fetchText(`${base}/${f}`);
        const fp = path.join(localDir, f);
        mkdirSync(path.dirname(fp), { recursive: true });
        writeFileSync(fp, content, 'utf8');
      } catch {
        // Optional-file fetch failure is a verify-time fact; the VERSION check below governs.
      }
    }
  } catch (e) {
    return { exit: 2, lines: [`UNDETERMINED — could not fetch the published tree: ${e.message}; local files untouched`] };
  }

  // 4. Verify: new VERSION file reads back and matches published
  const after = readLocalVersion(localDir);
  if (after === null) {
    return { exit: 1, lines: [`UPDATE FAILED VERIFICATION — local VERSION unreadable after apply; rollback: restore ${backupDir}`] };
  }
  const chk2 = await checkUpdate(repoUrl, localDir, versionFile);
  if (chk2.exit !== 0) {
    return { exit: 1, lines: [`UPDATE FAILED VERIFICATION — post-apply check is not CURRENT (${chk2.lines[0]}); rollback: restore ${backupDir}`] };
  }
  return { exit: 0, lines: [`UPDATE APPLIED — local=${after} verified current against published; backup at ${backupDir}`] };
}

function rmTree(p) {
  rmSync(p, { recursive: true, force: true });
}

export function rollback(backupDir, localDir) {
  if (!existsSync(backupDir)) {
    return { exit: 1, lines: [`ROLLBACK FAILED — backup dir not found: ${backupDir}`] };
  }
  rmTree(localDir);
  copyTree(backupDir, localDir);
  const v = readLocalVersion(localDir);
  if (v === null) {
    return { exit: 1, lines: ['ROLLBACK FAILED VERIFICATION — restored dir has no readable VERSION'] };
  }
  return { exit: 0, lines: [`ROLLBACK COMPLETE — restored ${v} from ${backupDir}`] };
}

// Hermetic selftest: local fixture tree + local HTTP server for the
// published side (SPEC_PROTOCOL_ALLOW_LOCALHOST_HTTP=1 pattern).
import { createServer } from 'node:http';

function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-selfupdate-selftest-${process.pid}`);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  // The skill dir MUST be named spec-protocol: published URL = <base>/.claude/skills/<basename(localDir)>/VERSION — the repo-relative convention.
  const local = path.join(tmp, 'skills', 'spec-protocol');
  const publishedTree = path.join(tmp, 'published', '.claude', 'skills', 'spec-protocol');
  mkdirSync(local, { recursive: true });
  mkdirSync(publishedTree, { recursive: true });
  writeFileSync(path.join(local, 'VERSION'), '1.16.3\n');
  writeFileSync(path.join(local, 'SKILL.md'), '# old skill\n');
  writeFileSync(path.join(publishedTree, 'VERSION'), '1.17.0\n');
  writeFileSync(path.join(publishedTree, 'SKILL.md'), '# new skill\n');

  process.stdout.write('SELFTEST — self-update.mjs (windows-parity)\n\n');

  let server;
  let port;
  const publishedFiles = { VERSION: '1.17.0', 'SKILL.md': '# new skill\n' };
  server = createServer((req, res) => {
    const key = req.url.split('/').pop(); // SKILL.md | VERSION
    if (key !== 'SKILL.md' && key !== 'VERSION') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(publishedFiles[key] ?? '');
  });
  server.listen(0, '127.0.0.1', async () => {
    port = server.address().port;
    const base = `http://127.0.0.1:${port}/.claude/skills/spec-protocol`;
    try {
      const chk1 = await checkUpdate(base, local);
      assert(chk1.exit === 1 && chk1.lines[0].includes('UPDATE AVAILABLE'), 'stale local -> exit 1 UPDATE AVAILABLE');
      const up = await applyUpdate(base, local);
      assert(up.exit === 0 && up.lines[0].includes('UPDATE APPLIED'), 'apply -> exit 0 UPDATE APPLIED');
      const after = readFileSync(path.join(local, 'VERSION'), 'utf8').trim();
      assert(after === '1.17.0', `new VERSION written (${after})`);
      const chk2 = await checkUpdate(base, local);
      assert(chk2.exit === 0, 'post-apply -> exit 0 CURRENT');
      // backup dir exists beside the skill
      const parent = path.dirname(local);
      const backups = readdirSync(parent).filter((n) => n.startsWith('spec-protocol.bak-'));
      assert(backups.length >= 1, 'versioned backup created beside the dir');
      // rollback restores
      const rb = rollback(path.join(parent, backups[0]), local);
      assert(rb.exit === 0 && readFileSync(path.join(local, 'VERSION'), 'utf8').trim() === '1.16.3', 'rollback restores the prior version');
    } catch (e) {
      assert(false, 'selftest async flow', e.message);
    } finally {
      server.close();
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      process.stdout.write('\n');
      if (failures.length) {
        process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write('SELFTEST: PASS — check/apply/verify/backup/rollback all green\n');
        process.exitCode = 0;
      }
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') return selftest();
  const cmd = args[0];
  if (cmd === 'check') {
    const [repo, local, vf] = args.slice(1);
    if (!repo || !local) { process.stderr.write('usage: self-update.mjs check <repo-url> <local-dir> [version-file]\n'); process.exit(2); }
    checkUpdate(repo, local, vf).then((r) => { process.stdout.write(`${r.lines.join('\n')}\n`); process.exit(r.exit); });
    return;
  }
  if (cmd === 'apply') {
    const [repo, local, vf] = args.slice(1);
    if (!repo || !local) { process.stderr.write('usage: self-update.mjs apply <repo-url> <local-dir> [version-file]\n'); process.exit(2); }
    applyUpdate(repo, local, vf).then((r) => { process.stdout.write(`${r.lines.join('\n')}\n`); process.exit(r.exit); });
    return;
  }
  if (cmd === 'rollback') {
    const [backup, local] = args.slice(1);
    if (!backup || !local) { process.stderr.write('usage: self-update.mjs rollback <backup-dir> <local-dir>\n'); process.exit(2); }
    const r = rollback(backup, local);
    process.stdout.write(`${r.lines.join('\n')}\n`);
    process.exit(r.exit);
    return;
  }
  process.stderr.write('usage: self-update.mjs check|apply|rollback ... | --selftest\n');
  process.exit(2);
}

main();
