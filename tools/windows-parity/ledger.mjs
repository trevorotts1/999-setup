#!/usr/bin/env node
// tools/windows-parity/ledger.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/ledger.sh
//
// Same contract: ledger.mjs <home> <file> <line> [upsert-key]
// Atomic, LOCKED read-modify-write for project MD files. The lock is what
// makes the read-modify-write indivisible across concurrent writers; the
// .tmp+rename is what keeps each locked write crash-safe. [upsert-key]
// overwrites-in-place ("one line per live agent" for HEARTBEAT.md), exactly
// like the Bash tool's grep -v -F "| <key> |" filter.
//
// Lock: mkdir-based (atomic on every filesystem, incl. NTFS) with jittered
// backoff and a stale-lock timeout, mirroring the Bash tool's flock-less
// path. iCloud pin-local mitigation is macOS-only and therefore a POSIX
// no-op here; Windows writes never touch iCloud.
//
// Exit: 0 written + verified; 1 lock timeout or write verification failure
// (loud, never silent).
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function appendLine(homeDir, file, line, upsertKey, opts = {}) {
  const target = path.join(homeDir, file);
  const tmp = `${target}.tmp.${process.pid}`;
  const lockDir = `${target}.lock.d`;
  const timeoutMs = opts.timeoutMs || 30000;
  const staleMs = opts.staleMs || 60000;

  try {
    mkdirSync(path.dirname(target), { recursive: true });
  } catch (e) {
    return { exit: 1, error: `cannot create target directory: ${e.message}` };
  }

  // Acquire lock (jittered backoff, stale-reclaim after 60s — same doctrine
  // as the Bash tool: never write unlocked, never treat a stat failure as
  // staleness).
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      writeFileSync(path.join(lockDir, 'owner'), `pid=${process.pid} acquired=${new Date().toISOString()}\n`, 'utf8');
      acquired = true;
      break;
    } catch {
      try {
        const st = statSync(lockDir);
        if (Date.now() - st.mtimeMs > staleMs) {
          try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* raced */ }
        }
      } catch {
        // stat failed — the dir vanished between check and stat; that is
        // ownership changing hands, NEVER staleness (Bash tool lesson).
      }
      const jitter = 50 + Math.floor(Math.random() * 160);
      const t0 = Date.now();
      while (Date.now() - t0 < jitter) { /* jittered backoff */ }
    }
  }
  if (!acquired) {
    return { exit: 1, error: `ERROR: ledger.mjs could not acquire lock dir ${lockDir} within ${timeoutMs}ms. Refusing to write ${target} unlocked — that is exactly the lost-line bug this lock exists to close. Inspect ${path.join(lockDir, 'owner')} (pid + acquire time) before removing it; only remove it yourself once you have confirmed that pid is dead.` };
  }

  try {
    // Sweep stale .tmp files from interrupted prior writes (crash between
    // copy and rename) — safe under the lock.
    try {
      const dir = path.dirname(target);
      const base = path.basename(target);
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(`${base}.tmp.`)) {
          try { rmSync(path.join(dir, entry), { force: true }); } catch { /* ignore */ }
        }
      }
    } catch { /* dir unreadable — continue; the write will fail loudly below */ }

    if (existsSync(target)) {
      copyFileSync(target, tmp);
    } else {
      writeFileSync(tmp, '', 'utf8');
    }

    if (upsertKey) {
      const existing = readFileSync(tmp, 'utf8').split(/\r?\n/);
      const needle = `| ${upsertKey} |`;
      const kept = existing.filter((l) => l !== '' && !l.includes(needle));
      writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
    }

    writeFileSync(tmp, `${line}\n`, { flag: 'a' });
    renameSync(tmp, target);

    // Verify THIS write landed (tail compare, not whole-file grep — a
    // whole-file grep would pass on an earlier identical line).
    const lines = readFileSync(target, 'utf8').split(/\r?\n/).filter((l) => l !== '');
    if (lines[lines.length - 1] !== line) {
      return { exit: 1, error: 'ERROR: ledger write verification failed — last line of target is not the line just written' };
    }
    return { exit: 0 };
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return { exit: 1, error: `ERROR: ledger write failed: ${e.message}` };
  } finally {
    try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- selftest
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-ledger-selftest-${process.pid}`);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(tmp, { recursive: true });

  process.stdout.write('SELFTEST — ledger.mjs (windows-parity)\n\n');

  const home = path.join(tmp, 'home');
  const r1 = appendLine(home, 'CONTROL/LEDGER.md', '2026-08-21T00:00:00Z | first');
  assert(r1.exit === 0, 'first append succeeds (creates nested dirs)');
  const r2 = appendLine(home, 'CONTROL/LEDGER.md', '2026-08-21T00:00:01Z | second');
  assert(r2.exit === 0, 'second append succeeds');
  let content = readFileSync(path.join(home, 'CONTROL/LEDGER.md'), 'utf8');
  assert(content.split(/\r?\n/).filter(Boolean).length === 2, 'both lines present');

  // upsert: key line replaced, not duplicated
  const r3 = appendLine(home, 'CONTROL/HEARTBEAT.md', '2026-08-21T00:00:00Z | alpha | tick=1', 'alpha');
  assert(r3.exit === 0, 'upsert write succeeds');
  const r4 = appendLine(home, 'CONTROL/HEARTBEAT.md', '2026-08-21T00:00:01Z | alpha | tick=2', 'alpha');
  assert(r4.exit === 0, 'upsert overwrite succeeds');
  content = readFileSync(path.join(home, 'CONTROL/HEARTBEAT.md'), 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  assert(lines.length === 1 && lines[0].includes('tick=2'), 'upsert keeps exactly one line for the key, newest wins');

  // crash-stale tmp sweep: plant a stale .tmp, next write removes it
  const staleTmp = path.join(home, 'CONTROL', 'LEDGER.md.tmp.99999');
  writeFileSync(staleTmp, 'half-written garbage', 'utf8');
  const r5 = appendLine(home, 'CONTROL/LEDGER.md', '2026-08-21T00:00:02Z | third');
  assert(r5.exit === 0, 'write after stale tmp succeeds');
  assert(!existsSync(staleTmp), 'stale .tmp swept under the lock');

  // tail verification: last line is exactly the line written
  content = readFileSync(path.join(home, 'CONTROL/LEDGER.md'), 'utf8');
  assert(content.trim().endsWith('2026-08-21T00:00:02Z | third'), 'tail verification passes on last write');

  // subdirectory file component works (file = "CONTROL/HEARTBEAT.md")
  assert(existsSync(path.join(home, 'CONTROL', 'HEARTBEAT.md')), 'subdirectory component created');

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — lock, append, upsert, sweep, verify all green\n');
    process.exitCode = 0;
  }
}

function main() {
  if (process.argv[2] === '--selftest') return selftest();
  const home = process.argv[2];
  const file = process.argv[3];
  const line = process.argv[4];
  const upsertKey = process.argv[5];
  if (!home || !file || line === undefined) {
    process.stderr.write('usage: ledger.mjs <home> <file> <line> [upsert-key]\n');
    process.exit(2);
  }
  const r = appendLine(home, file, line, upsertKey);
  if (r.exit !== 0) {
    process.stderr.write(`${r.error}\n`);
    process.exit(r.exit);
  }
  process.exit(0);
}

// Guard: run CLI main() only when executed directly (watchdog.mjs imports
// appendLine — an import must never trigger the CLI parser).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
