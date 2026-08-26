#!/usr/bin/env node
// tools/windows-parity/capacity-resolver.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/capacity-resolver.sh
//
// IDENTICAL input schema (KEY=VALUE answers file), output schema (Capacity
// Ledger card) and exit-code semantics (0 resolved, 2 invalid input, 3
// UNDETERMINED/refuse-to-plan). Runs natively on Windows (Node) and POSIX.
// Cores probe: Windows -> [Environment]::ProcessorCount; POSIX -> sysctl/nproc.
//
// Usage: capacity-resolver.mjs <answers-file>
//        capacity-resolver.mjs --selftest
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAnswers, resolveCapacity } from './src/engine.mjs';
import { probeCores } from './src/platform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- selftest
// Proves the instrument before any run is believed: known-good scenario cards
// match their golden fixture; known-bad inputs fail closed with plain errors
// and the exact exit codes; live cores measure and feed the formula; missing
// systemConcurrentMax refuses to plan (never 16). No network, no writes.
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const goldenDir = path.join(__dirname, 'tests', 'golden');
  const run = (answersPath, cores) => {
    const answers = parseAnswers(readFileSync(answersPath, 'utf8'));
    return resolveCapacity(answers, { cores, nowIso: '2026-08-21T00:00:00Z' });
  };

  process.stdout.write('SELFTEST — capacity-resolver.mjs (windows-parity)\n\n');

  // Scenario cards vs golden fixtures (fixtures captured from the Bash tool
  // run on macOS; the node card must match modulo the measured-instrument
  // timestamp line, which the fixture pins).
  for (const name of ['scenario-anthropic', 'scenario-deepseek-direct', 'scenario-ollama20', 'scenario-ollama100', 'scenario-agnes40']) {
    const res = run(path.join(goldenDir, `${name}.answers`), 12);
    assert(res.exit === 0, `${name}: resolves exit 0`);
    const gold = readFileSync(path.join(goldenDir, `${name}.card`), 'utf8').split(/\r?\n/);
    const got = res.lines.join('\n').split(/\r?\n/);
    const diffs = [];
    for (let i = 0; i < Math.max(gold.length, got.length); i++) {
      if ((gold[i] ?? '') !== (got[i] ?? '')) diffs.push(`line ${i + 1}: GOLD=${gold[i]} GOT=${got[i]}`);
    }
    if (diffs.length === 0) {
      assert(true, `${name}: card matches golden fixture`);
    } else {
      assert(false, `${name}: card matches golden fixture`, diffs.slice(0, 4).join(' | '));
    }
  }

  // Instrument checks
  const bad = parseAnswers('BUILDER_PROVIDER=not-a-provider\nHARNESS=claude-nine\nSYSTEM_CONCURRENT_MAX=10\n');
  const badRes = resolveCapacity(bad, { cores: 12 });
  assert(badRes.exit === 2, 'known-bad provider rejected (exit 2)', badRes.error);
  assert(badRes.error.includes('BUILDER_PROVIDER'), 'known-bad provider names the field');

  const badHarness = parseAnswers('HARNESS=nope\nBUILDER_PROVIDER=anthropic\nSYSTEM_CONCURRENT_MAX=10\n');
  assert(resolveCapacity(badHarness, { cores: 12 }).exit === 2, 'known-bad harness rejected (exit 2)');

  const missing = resolveCapacity(parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\n'), { cores: 12 });
  assert(missing.exit === 3 && missing.error.includes('systemConcurrentMax UNDETERMINED'), 'missing systemConcurrentMax refused to plan (exit 3, never 16)');
  assert(missing.error.includes('never defaults to 16'), 'refusal names the never-16 rule');

  const badCores = parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\nSYSTEM_CONCURRENT_MAX=10\nCORES=banana\n');
  assert(resolveCapacity(badCores, {}).exit === 3, 'non-numeric CORES rejected fail-closed (exit 3)');

  // Live cores measurement (same instrument the Bash tool uses)
  const live = probeCores();
  assert(live.cores !== null && live.cores > 0, `live cores measured (${live.cores}, instrument=${live.instrument})`);
  if (live.cores !== null) {
    const capExpected = Math.min(10, Math.max(live.cores - 2, 1));
    const liveRes = resolveCapacity(parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\nSYSTEM_CONCURRENT_MAX=10\n'), {});
    assert(liveRes.exit === 0, 'live resolve succeeds');
    const capLine = liveRes.lines.find((l) => l.startsWith('Cores: '));
    assert(capLine && capLine.includes(`clientCap = min(systemConcurrentMax, cores−2) = ${capExpected}`), `live cores → clientCap=${capExpected} = min(10, ${live.cores}−2)`, capLine || 'no Cores line');
  }

  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — all scenario and instrument checks passed\n');
    process.exitCode = 0;
  }
}

// ---------------------------------------------------------------- main
function main() {
  const arg = process.argv[2];
  if (arg === '--selftest') return selftest();
  if (!arg) {
    process.stderr.write('ERROR: no answers file given — usage: capacity-resolver.mjs <answers-file>\n');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(arg, 'utf8');
  } catch (e) {
    process.stderr.write(`ERROR: answers file not found: ${arg}\n`);
    process.exit(2);
  }
  const answers = parseAnswers(text);
  const res = resolveCapacity(answers, {});
  if (res.error) {
    process.stderr.write(`${res.error}\n`);
    process.exit(res.exit);
  }
  process.stdout.write(`${res.lines.join('\n')}\n`);
  process.exit(0);
}

main();
