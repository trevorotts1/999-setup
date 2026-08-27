// tools/windows-parity/tests/parity-tests.mjs — the WS-27 unit guard.
// Runs every parity tool's selftest AND the golden cross-check: each scenario
// card is produced by BOTH the Bash tool and the node tool on the same pinned
// answers; the normalized cards must be identical (only the measured-core
// instrument timestamp differs). That cross-check is the "golden fixtures
// match macOS semantics" proof that the equivalent Windows implementation
// must reproduce byte-for-byte.
//
// Usage: node tests/parity-tests.mjs   (also: npm test)
// Exit: 0 all green; 1 any failure.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const repoRoot = path.resolve(root, '..', '..'); // worktree root (tools/windows-parity -> worktree)
const bashResolver = path.join(repoRoot, '.claude', 'skills', 'spec-protocol', 'tools', 'capacity-resolver.sh');

const NODE = process.execPath;
const TOOLS = ['capacity-resolver', 'capacity-profile', 'env-sweep', 'ledger', 'anchor', 'watchdog', 'check-update', 'self-update'];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function normalizeCard(s) {
  return s.split(/\r?\n/).map((l) => l
    .replace(/# CAPACITY LEDGER — .* — [0-9T:Z-]+$/, '# CAPACITY LEDGER — <p> — <ts>')
    .replace(/\[MEASURED [^\]]*\]/g, '[MEASURED <ts>]')
    .replace(/Cores: \d+ \(MEASURED\)/, 'Cores: <n> (<src>)')
    .replace(/clientCap = min\(systemConcurrentMax, cores−2\) = \d+/, 'clientCap = min(systemConcurrentMax, cores−2) = <n>')
    .replace(/clientCap \d+/g, 'clientCap <n>')
    .replace(/×\d+=/g, '×<n>=')
    .replace(/\(10 \+ 6\)/, '(<a> + <b>)')
    .replace(/≤\d+/g, '≤<n>')
    .replace(/lead\+\d+/, 'lead+<n>')
    .replace(/WORKFLOW COUNT: \d+/, 'WORKFLOW COUNT: <n>')
  );
}

const failures = [];
const assert = (ok, name, extra) => {
  process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
  if (!ok) failures.push(name);
};

process.stdout.write('WS-27 PARITY GUARD — tools/windows-parity\n\n');

// 1. Every tool selftest
for (const t of TOOLS) {
  try {
    const out = run(NODE, [path.join(root, `${t}.mjs`), '--selftest']);
    assert(out.includes('SELFTEST: PASS'), `${t}.mjs selftest`);
  } catch (e) {
    assert(false, `${t}.mjs selftest`, e.stderr ? e.stderr.split('\n').slice(0, 3).join(' ') : e.message);
  }
}

// 2. Bash-vs-node golden parity: pinned answers -> identical cards.
if (existsSync(bashResolver)) {
  const scenarios = ['scenario-anthropic', 'scenario-deepseek-direct', 'scenario-ollama20', 'scenario-ollama100', 'scenario-agnes40'];
  for (const s of scenarios) {
    const answers = path.join(here, 'golden', `${s}.answers`);
    let b, n;
    try {
      b = normalizeCard(run('bash', [bashResolver, answers]));
    } catch {
      assert(false, `${s}: bash reference run`, 'bash resolver failed');
      continue;
    }
    try {
      n = normalizeCard(run(NODE, [path.join(root, 'capacity-resolver.mjs'), answers]));
    } catch (e) {
      assert(false, `${s}: node parity run`, e.stderr || e.message);
      continue;
    }
    const max = Math.max(b.length, n.length);
    let diffs = 0;
    for (let i = 0; i < max; i++) if ((b[i] ?? '') !== (n[i] ?? '')) diffs++;
    assert(diffs === 0, `${s}: bash card == node card (${b.length} lines)`, `${diffs} normalized line diff(s)`);
  }
  // CRLF regression (WS-27). Git checks this repo out with CRLF on Windows,
  // so the golden fixtures ARRIVE that way there. The bash resolver's
  // `while IFS='=' read -r k v` left the carriage return on the value, so
  // HARNESS was "claude-nine\r" and it refused its own fixture with a
  // message whose closing paren landed on the next line. node parsed the
  // same bytes fine -- which is precisely what "bash resolver failed" meant,
  // and why this guard was red on Windows and green everywhere else.
  //
  // A Windows user writing an answers file in Notepad hits the same wall, so
  // this is a product fix, not a CI accommodation.
  const crlfSource = path.join(here, 'golden', 'scenario-anthropic.answers');
  if (existsSync(crlfSource)) {
    const lf = readFileSync(crlfSource, 'utf8');
    const crlfPath = path.join(tmpdir(), `ws27-crlf-${process.pid}.answers`);
    writeFileSync(crlfPath, lf.replace(/\r?\n/g, '\r\n'), 'utf8');
    try {
      // CONTROL: the fixture must genuinely differ on disk, or converting it
      // proved nothing and this test passes for free.
      assert(
        readFileSync(crlfPath, 'utf8') !== lf,
        'CONTROL: the CRLF fixture differs from the LF original',
      );
      const fromCrlf = normalizeCard(run('bash', [bashResolver, crlfPath]));
      const fromLf = normalizeCard(run('bash', [bashResolver, crlfSource]));
      let diffs = 0;
      const max = Math.max(fromCrlf.length, fromLf.length);
      for (let i = 0; i < max; i++) if ((fromCrlf[i] ?? '') !== (fromLf[i] ?? '')) diffs++;
      assert(diffs === 0, 'bash resolver: CRLF answers == LF answers', `${diffs} line diff(s)`);
    } catch (e) {
      assert(false, 'bash resolver: CRLF answers == LF answers', e.stderr || e.message);
    } finally {
      try { unlinkSync(crlfPath); } catch { /* best effort */ }
    }
  }
} else {
  assert(false, 'bash capacity-resolver.sh present', `not found at ${bashResolver}`);
}

process.stdout.write('\n');
if (failures.length) {
  process.stderr.write(`PARITY GUARD: FAIL (${failures.length} check(s) failed)\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('PARITY GUARD: PASS — all tool selftests and cross-implementation goldens green\n');
  process.exitCode = 0;
}
