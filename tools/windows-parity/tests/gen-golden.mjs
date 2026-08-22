// tests/gen-golden.mjs — regenerates the golden fixtures for the capacity
// resolver parity selftest. Pinned inputs (cores=12, nowIso fixed) make the
// cards deterministic and machine-independent: the SAME card is produced on
// macOS and on Windows, which is the semantic-equivalence claim the goldens
// prove. Regenerate only when the card format legitimately changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseAnswers, resolveCapacity } from '../src/engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = path.join(here, 'golden');
mkdirSync(golden, { recursive: true });

const scenarios = {
  'scenario-anthropic': [
    'HARNESS=claude-nine',
    'LAUNCHER=claude-nine',
    'BUILDER_PROVIDER=anthropic',
    'SYSTEM_CONCURRENT_MAX=10',
    'RESERVE_PCT=25',
    'MODE=team',
    'COMMANDERS=4',
    'PROJECT=golden-fixture',
    'ROLE_BUILDER=opus',
    'ROLE_RESEARCHER=sonnet',
    'CONFIG_FP=a1b2c3d4',
  ].join('\n') + '\n',
  'scenario-deepseek-direct': [
    'HARNESS=claude-nine',
    'BUILDER_PROVIDER=deepseek-direct',
    'DEEPSEEK_TIER=flash',
    'SYSTEM_CONCURRENT_MAX=10',
    'RESERVE_PCT=25',
    'PROJECT=golden-fixture',
    'DEEPSEEK_TIER_SOURCE=recalled-confirmed:answered=2026-08-01',
  ].join('\n') + '\n',
  'scenario-ollama20': [
    'HARNESS=claude-nine',
    'BUILDER_PROVIDER=ollama-cloud',
    'OLLAMA_PLAN=20',
    'SYSTEM_CONCURRENT_MAX=10',
    'RESERVE_PCT=25',
    'PROJECT=golden-fixture',
  ].join('\n') + '\n',
  'scenario-ollama100': [
    'HARNESS=regular',
    'BUILDER_PROVIDER=ollama-cloud',
    'OLLAMA_PLAN=100',
    'SYSTEM_CONCURRENT_MAX=10',
    'PROJECT=golden-fixture',
  ].join('\n') + '\n',
  'scenario-agnes40': [
    'HARNESS=claude-nine',
    'BUILDER_PROVIDER=agnes',
    'AGNES_PLAN=40',
    'SYSTEM_CONCURRENT_MAX=10',
    'PROJECT=golden-fixture',
  ].join('\n') + '\n',
};

for (const [name, answersText] of Object.entries(scenarios)) {
  writeFileSync(path.join(golden, `${name}.answers`), answersText, 'utf8');
  const res = resolveCapacity(parseAnswers(answersText), { cores: 12, nowIso: '2026-08-21T00:00:00Z' });
  if (res.exit !== 0) {
    console.error(`scenario ${name} failed to resolve: ${res.error}`);
    process.exit(1);
  }
  writeFileSync(path.join(golden, `${name}.card`), `${res.lines.join('\n')}\n`, 'utf8');
  console.log(`wrote ${name} (${res.lines.length} card lines)`);
}
console.log('golden fixtures regenerated');
