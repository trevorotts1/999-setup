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
import { measureCapacity } from '../../.claude/skills/spec-protocol/scripts/common/width.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- selftest
// Proves the instrument before any run is believed: known-good scenario cards
// match their golden fixture; known-bad inputs fail closed with plain errors
// and the exact exit codes; live cores and RAM measure and feed the ONE formula
// (capacity_probe.py: clientCap = clamp(1, 10, min(floor(ram / GB_PER_AGENT), cores))). No network, no writes.
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const goldenDir = path.join(__dirname, 'tests', 'golden');
  const run = (answersPath, cores) => {
    const answers = parseAnswers(readFileSync(answersPath, 'utf8'));
    return resolveCapacity(answers, { cores, ramGb: 24, nowIso: '2026-08-21T00:00:00Z' });
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
  const bad = parseAnswers('BUILDER_PROVIDER=not-a-provider\nHARNESS=claude-nine\n');
  const badRes = resolveCapacity(bad, { cores: 12 });
  assert(badRes.exit === 2, 'known-bad provider rejected (exit 2)', badRes.error);
  assert(badRes.error.includes('BUILDER_PROVIDER'), 'known-bad provider names the field');

  const badHarness = parseAnswers('HARNESS=nope\nBUILDER_PROVIDER=anthropic\n');
  assert(resolveCapacity(badHarness, { cores: 12 }).exit === 2, 'known-bad harness rejected (exit 2)');

  const badRam = resolveCapacity(parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\nCORES=12\nRAM_GB=lots\n'), {});
  assert(badRam.exit === 3 && badRam.error.includes('RAM_GB must be a positive whole number'), 'non-numeric RAM_GB rejected fail-closed (exit 3)');

  // The cap is the probe's formula on the supplied numbers: 12 cores / 24 GB -> 10; 6 cores / 9 GB -> 6; 8 cores / 8 GB -> 5.
  for (const [c, r, want] of [[12, 24, 10], [6, 9, 6], [8, 8, 5], [2, 8, 2]]) {
    const res = resolveCapacity(parseAnswers(`HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\nCORES=${c}\nRAM_GB=${r}\n`), {});
    const line = (res.lines || []).find((l) => l.startsWith('clientCap = '));
    assert(res.exit === 0 && line && line.includes(`effective_cores)) = ${want}`), `${c} cores / ${r} GB -> clientCap ${want}`, line || res.error);
  }
  const six = resolveCapacity(parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=deepseek-direct\nCORES=6\nRAM_GB=9\n'), {});
  assert(six.lines.some((l) => l.includes('harness 50×6=300')) && six.lines.some((l) => l.includes('AGENTS PER WORKFLOW: ≤6 (= clientCap 6)')), 'a cap-6 box narrows the whole card (50 x 6 = 300)');
  assert(!six.lines.join('\n').includes('cores−2') && !six.lines.join('\n').includes('batches = ceil'), 'no cores-minus-two or hand-batch statement survives on the card');

  const badCores = parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\nCORES=banana\n');
  assert(resolveCapacity(badCores, {}).exit === 3, 'non-numeric CORES rejected fail-closed (exit 3)');

  // Live measurement (same instruments the Bash tool uses; the cap comes from capacity_probe.py)
  const live = probeCores();
  assert(live.cores !== null && live.cores > 0, `live cores measured (${live.cores}, instrument=${live.instrument})`);
  const cap = measureCapacity();
  assert(cap !== null && cap.cap >= 1 && cap.cap <= 10, `live capacity probe answers (cap=${cap && cap.cap}, ${cap && cap.ramGb} GB, ${cap && cap.cores} cores, ${cap && cap.source})`);
  const liveRes = resolveCapacity(parseAnswers('HARNESS=claude-nine\nBUILDER_PROVIDER=anthropic\n'), {});
  const capLine = (liveRes.lines || []).find((l) => l.startsWith('clientCap = '));
  assert(liveRes.exit === 0 && cap && capLine && capLine.includes(`effective_cores)) = ${cap.cap}`), `live resolve: clientCap = the probe's cap ${cap && cap.cap}`, capLine || liveRes.error);

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
