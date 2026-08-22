#!/usr/bin/env node
// tools/windows-parity/anchor.mjs — WS-27 native parity for
// .claude/skills/spec-protocol/tools/anchor.sh
//
// THREE-WAY RECONCILER parity: reconciles project manifest / native task
// graph / project state against each other AND against disk, and carries the
// TERMINAL-DRIFT stop. DETECTS and LOGS; never mutates task state; emits
// ACTION lines for the conductor to execute (scripts cannot call session
// tools — the conductor executes actions with TaskUpdate).
//
// EXIT-CODE CONTRACT (identical to anchor.sh)
//   0  clean          a RE-ANCHOR or RECONCILE line was written; nothing fired
//   2  TOOLING FAILURE / BROKEN INSTRUMENT — loud, never silent, never a verdict
//   3  drift found    DRIFT-ALARM written; ACTION|verb|target|evidence on stdout
//   4  TERMINAL-DRIFT CONTROL/TERMINAL-DRIFT.flag created; escalation written
//
// USAGE
//   anchor.mjs <project-home> [current-unit]
//             [--mode anchor|reconcile]
//             [--tasks <task-graph-snapshot.json>]
//             [--state <project_state.json>]
//             [--intents <file of the last K stated-intent lines>]
//   anchor.mjs --selftest
//
// ENVIRONMENT KNOBS (defaults = the doctrine's numbers, same as anchor.sh)
//   ANCHOR_MAX_AGE_MIN=35   ANCHOR_TERMINAL_N=6   ANCHOR_STALE_MIN=10
//   ANCHOR_INTENT_K=5        ANCHOR_INTENT_OVERLAP_PCT=60
//   ANCHOR_CENSUS_DEPTH=6    ANCHOR_HARD_CAP=200   ANCHOR_BUDGET_TOL=5
//   ANCHOR_CLAIM_UNPAIRED_TOL=3
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// INSTRUMENT PROOF — embedded fixtures, checked on EVERY invocation. A
// positive that MUST match, a negative that MUST NOT, and the brittle literal
// which MUST NOT match the positive (that is the trap, kept live as a
// control). Control failure is exit 2, never an all-clear.
// ---------------------------------------------------------------------------
export const FIXTURE_POSITIVE = '  - heartbeat 2026-08-06T20:10:38Z (ledger auto-tick)';
export const FIXTURE_NEGATIVE = '  - heartbeat 2026-08-06T20:10:38Z (ledger auto-tick) — analysis complete, 3 lanes dispatched';
export const FIXTURE_BRITTLE = '  - heartbeat (ledger auto-tick)';

// A line is a CONTENTLESS heartbeat tick only when it is the auto-tick shape
// AND carries nothing besides timestamp + marker + label. Anything else is
// content (a real progress step).
export function heartbeatLineIsContentless(line) {
  if (!line.includes('heartbeat')) return false;
  if (!line.includes('(ledger auto-tick)')) return false;
  if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(line)) return false;
  const stripped = line
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/heartbeat/, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/, '')
    .replace(/\(ledger auto-tick\)/, '')
    .replace(/[|,;:()\[\]{}'"`]/g, ' ')
    .trim();
  return stripped === '';
}

export function heartbeatDriftCensus(fileText) {
  const lines = fileText.split(/\r?\n/).filter(Boolean);
  let contentless = 0;
  for (const l of lines) {
    if (heartbeatLineIsContentless(l)) contentless++;
  }
  return { total: lines.length, contentless, ratio: lines.length ? contentless / lines.length : 0 };
}

export function proveInstrument() {
  const pos = heartbeatLineIsContentless(FIXTURE_POSITIVE);
  const neg = heartbeatLineIsContentless(FIXTURE_NEGATIVE);
  const brittle = heartbeatLineIsContentless(FIXTURE_BRITTLE);
  if (!pos) return { ok: false, reason: 'fixture positive did not classify as contentless heartbeat' };
  if (neg) return { ok: false, reason: 'fixture negative (content-bearing heartbeat) misclassified as contentless' };
  if (brittle) return { ok: false, reason: 'brittle literal matched — the timestamp trap is live, instrument is broken' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function jsonFingerprint(doc) {
  return crypto.createHash('sha256').update(stableStringify(doc)).digest('hex');
}

function loadJson(file, label) {
  if (!existsSync(file)) return { ok: false, reason: `${label} missing (${file})` };
  try {
    return { ok: true, doc: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { ok: false, reason: `${label} unparseable: ${e.message}` };
  }
}

function diskCensus(root, depth) {
  const seen = [];
  const walk = (dir, d) => {
    if (d > depth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      if (e.name.startsWith('.anchor-')) continue; // our own state — never a delta
      const p = path.join(dir, e.name);
      seen.push(p);
      if (e.isDirectory()) walk(p, d + 1);
    }
  };
  walk(root, 0);
  return seen.sort();
}

// ---------------------------------------------------------------------------
// THE RECONCILER
// ---------------------------------------------------------------------------
export function reconcile(projectRoot, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const mode = opts.mode === 'anchor' ? 'anchor' : 'reconcile';

  const inst = proveInstrument();
  if (!inst.ok) {
    return { exit: 2, lines: [`TOOLING FAILURE — ${inst.reason} — exit 2, never an all-clear`] };
  }

  const maxAgeMin = Number(process.env.ANCHOR_MAX_AGE_MIN || opts.maxAgeMin || 35);
  const terminalN = Number(process.env.ANCHOR_TERMINAL_N || opts.terminalN || 6);
  const staleMin = Number(process.env.ANCHOR_STALE_MIN || opts.staleMin || 10);
  const intentK = Number(process.env.ANCHOR_INTENT_K || opts.intentK || 5);
  const hardCap = Number(process.env.ANCHOR_HARD_CAP || opts.hardCap || 200);
  const budgetTol = Number(process.env.ANCHOR_BUDGET_TOL || opts.budgetTol || 5);
  const claimUnpairedTol = Number(process.env.ANCHOR_CLAIM_UNPAIRED_TOL || opts.claimUnpairedTol || 3);
  const censusDepth = Number(process.env.ANCHOR_CENSUS_DEPTH || opts.censusDepth || 6);

  const tasksPath = opts.tasks ? path.resolve(opts.tasks) : path.join(projectRoot, 'CONTROL', 'task-graph-snapshot.json');
  const statePath = opts.state ? path.resolve(opts.state) : path.join(projectRoot, 'CONTROL', 'project_state.json');
  const manifestPath = path.join(projectRoot, 'SPEC', 'PROJECT-MANIFEST.md');
  const ledgerPath = path.join(projectRoot, 'CONTROL', 'LEDGER.md');
  const flagPath = path.join(projectRoot, 'CONTROL', 'TERMINAL-DRIFT.flag');
  const fpFile = path.join(projectRoot, 'CONTROL', '.anchor-fingerprint');
  const consecFile = path.join(projectRoot, 'CONTROL', '.anchor-consecutive');

  const tasks = loadJson(tasksPath, 'task graph snapshot');
  const state = loadJson(statePath, 'project state');
  if (!tasks.ok) return { exit: 2, lines: [`BROKEN INSTRUMENT — ${tasks.reason} — exit 2, never a clean`] };
  if (!state.ok) return { exit: 2, lines: [`BROKEN INSTRUMENT — ${state.reason} — exit 2, never a clean`] };
  if (!existsSync(manifestPath)) {
    return { exit: 2, lines: ['BROKEN INSTRUMENT — SPEC/PROJECT-MANIFEST.md missing — exit 2, never a clean'] };
  }

  // Disk census + fingerprint delta across the three layers
  const census = diskCensus(projectRoot, censusDepth);
  const fpNow = jsonFingerprint({
    tasks: tasks.doc,
    state: state.doc,
    census,
    manifestMtime: statSync(manifestPath).mtimeMs,
  });
  let prevFp = null;
  try { prevFp = readFileSync(fpFile, 'utf8').trim(); } catch { /* first run */ }

  let ledText = '';
  try { ledText = readFileSync(ledgerPath, 'utf8'); } catch { /* no ledger yet — a fact, not drift */ }
  const ledCensus = heartbeatDriftCensus(ledText);
  const ledRatio = ledCensus.total ? ledCensus.contentless / ledCensus.total : 0;

  // Actions (drift conditions) — each names verb + target + evidence.
  const actions = [];

  // 1. Ledger heartbeat contentless ratio (class-1 drift)
  if (ledCensus.total > 20 && ledRatio > 0.3) {
    actions.push({ verb: 'CONDENSE', target: 'CONTROL/LEDGER.md', evidence: `${ledCensus.contentless} of ${ledCensus.total} lines are contentless heartbeat ticks (${Math.round(ledRatio * 100)}%)` });
  }

  // 2. State staleness
  const last = state.doc && state.doc.last_reconciliation ? Date.parse(state.doc.last_reconciliation) : NaN;
  if (!Number.isNaN(last) && Date.now() - last > maxAgeMin * 60000) {
    actions.push({ verb: 'RECONCILE', target: 'CONTROL/project_state.json', evidence: `last_reconciliation ${new Date(last).toISOString()} older than ${maxAgeMin} min` });
  }

  // 3. Ledger staleness
  try {
    if (Date.now() - statSync(ledgerPath).mtimeMs > maxAgeMin * 60000) {
      actions.push({ verb: 'VERIFY', target: 'CONTROL/LEDGER.md', evidence: `no ledger write in ${maxAgeMin} min` });
    }
  } catch { /* no ledger */ }

  // 4. CLAIM-before/RESULT-after provenance (class 7): every DISPATCH/CLAIM
  //    line must have a matching RESULT/CLOSED/COMPLETE line.
  const claimLines = ledText.split(/\r?\n/).filter((l) => /(DISPATCH|CLAIM)\s*\||\| (DISPATCH|CLAIM) /.test(l));
  let unpaired = 0;
  const unpairedSamples = [];
  for (const l of claimLines) {
    const m = l.match(/(?:WS-\d+|WR-\d+|[A-Za-z0-9._-]+)(?=\||$)/g);
    const probe = l.split('|').map((s) => s.trim()).find((s) => /^[A-Z0-9_-]+$/.test(s));
    const key = probe || (m ? m[0] : '');
    if (key && !ledText.includes(`${key} RESULT`) && !ledText.includes(`${key} COMPLETE`) && !ledText.includes(`${key} CLOSED`)) {
      unpaired++;
      if (unpairedSamples.length < 3) unpairedSamples.push(key);
    }
  }
  if (unpaired > claimUnpairedTol) {
    actions.push({ verb: 'PROVENANCE', target: 'CONTROL/LEDGER.md', evidence: `${unpaired} dispatched/claimed unit(s) without a RESULT/CLOSED line (e.g. ${unpairedSamples.join(', ')})` });
  }

  // 5. Class-6 hard agent-execution cap from the ledger
  for (const l of ledText.split(/\r?\n/)) {
    const m = l.match(/^(\d+)\s+executions?\b/i);
    if (m && Number(m[1]) >= hardCap) {
      actions.push({ verb: 'STOP', target: 'run', evidence: `ledger reports ${m[1]} executions — hard cap ${hardCap} reached` });
    }
  }

  // 6. Repeated-intent window (only when an intents file is supplied)
  if (opts.intents && existsSync(opts.intents)) {
    const intents = readFileSync(opts.intents, 'utf8').split(/\r?\n/).filter(Boolean).slice(-intentK);
    if (intents.length >= intentK) {
      const core = new Set(intents.slice(0, 2).map((i) => i.replace(/\d+/g, '')).filter(Boolean));
      const overlap = intents.filter((t) => {
        const n = t.replace(/\d+/g, '');
        return [...core].some((c) => c && n.includes(c));
      }).length;
      if (overlap / intents.length >= 0.6) {
        actions.push({ verb: 'ESCALATE', target: 'stated-intent', evidence: `${overlap}/${intents.length} recent intent lines overlap — same ask repeated, no progress` });
      }
    }
  }

  // 7. Disk census vs state: a project_state.json entry with no disk artifact
  const stateCount = state.doc && state.doc.tasks ? Object.keys(state.doc.tasks).length : 0;
  if (stateCount > 0 && census.length === 0) {
    actions.push({ verb: 'VERIFY', target: 'disk', evidence: 'project state claims tasks but census found no files' });
  }

  // -------------------------------------------------------------------------
  // Fingerprint delta / TERMINAL-DRIFT
  const isDelta = prevFp === null || prevFp !== fpNow;
  let consecutive = 0;
  try { consecutive = Number(readFileSync(consecFile, 'utf8').trim()) || 0; } catch { /* first run */ }
  consecutive = isDelta ? 0 : consecutive + 1;
  try {
    mkdirSync(path.dirname(consecFile), { recursive: true });
    writeFileSync(consecFile, String(consecutive), 'utf8');
    writeFileSync(fpFile, fpNow, 'utf8');
  } catch { /* best-effort state */ }

  if (!isDelta && consecutive >= terminalN) {
    try {
      mkdirSync(path.dirname(flagPath), { recursive: true });
      writeFileSync(flagPath, `${nowIso} TERMINAL-DRIFT — ${consecutive} consecutive no-delta reconciles\n`, 'utf8');
    } catch { /* best-effort */ }
    return {
      exit: 4,
      lines: [
        `TERMINAL-DRIFT — STOP — ${consecutive} consecutive no-delta reconciles (threshold ${terminalN})`,
        `TERMINAL-DRIFT.flag created: ${flagPath}`,
        'ESCALATE to the operator — the project is alive but nothing reconciles',
      ],
    };
  }

  const lines = [];
  if (mode === 'anchor' || isDelta) {
    lines.push(`RE-ANCHOR ${nowIso} — three layers + disk reconciled, ${actions.length} action(s) emitted`);
  } else {
    lines.push(`RECONCILE ${nowIso} — no delta since last anchor`);
  }
  for (const a of actions) lines.push(`ACTION|${a.verb}|${a.target}|${a.evidence}`);

  if (actions.length > 0) {
    lines.push(`DRIFT-ALARM — ${actions.length} condition(s); run anchor again after the conductor executes the actions`);
    return { exit: 3, lines };
  }
  return { exit: 0, lines };
}

// ---------------------------------------------------------------------------
// SELFTEST — proves: fixtures discriminate (trap live), drift fires exit 3
// with ACTION lines, clean exits 0 with RE-ANCHOR, BROKEN INSTRUMENT exits 2
// on a missing task graph, TERMINAL-DRIFT exits 4 after N no-delta runs.
// ---------------------------------------------------------------------------
function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-anchor-selftest-${process.pid}`);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  const proj = path.join(tmp, 'proj');
  mkdirSync(path.join(proj, 'SPEC'), { recursive: true });
  mkdirSync(path.join(proj, 'CONTROL'), { recursive: true });

  process.stdout.write('SELFTEST — anchor.mjs (windows-parity)\n\n');

  // Instrument proof
  const inst = proveInstrument();
  assert(inst.ok, 'instrument fixtures discriminate (positive matches, negative does not, brittle trap does not)', inst.reason);

  writeFileSync(path.join(proj, 'SPEC', 'PROJECT-MANIFEST.md'), '# manifest\n', 'utf8');
  writeFileSync(path.join(proj, 'CONTROL', 'task-graph-snapshot.json'), JSON.stringify({ nodes: [{ id: 'WS-01' }] }), 'utf8');
  writeFileSync(path.join(proj, 'CONTROL', 'project_state.json'), JSON.stringify({ last_reconciliation: new Date().toISOString(), tasks: {} }), 'utf8');

  const r1 = reconcile(proj, { nowIso: '2026-08-21T00:00:00Z' });
  assert(r1.exit === 0, 'clean project -> exit 0 RE-ANCHOR');
  assert(r1.lines[0].includes('RE-ANCHOR'), 'first run writes RE-ANCHOR');

  // drift: a ledger full of contentless ticks
  const ticks = [];
  for (let i = 0; i < 30; i++) ticks.push(`- heartbeat 2026-08-2${(i % 9) + 1}T10:00:0${i % 10}Z (ledger auto-tick)`);
  writeFileSync(path.join(proj, 'CONTROL', 'LEDGER.md'), `${ticks.join('\n')}\n`, 'utf8');
  const r2 = reconcile(proj, { nowIso: '2026-08-21T00:00:01Z' });
  assert(r2.exit === 3, 'drift (contentless ledger) -> exit 3');
  assert(r2.lines.some((l2) => l2.startsWith('ACTION|CONDENSE|CONTROL/LEDGER.md')), 'ACTION|CONDENSE|CONTROL/LEDGER.md emitted with evidence');
  assert(r2.lines.some((l2) => l2.includes('contentless heartbeat ticks')), 'evidence names the contentless count');

  // unpaired claim
  writeFileSync(path.join(proj, 'CONTROL', 'LEDGER.md'), '2026-08-21T00:00:00Z | WAVE 1 DISPATCH | WS-01\n'.repeat(6) + '- heartbeat 2026-08-21T00:00:01Z (ledger auto-tick)\n', 'utf8');
  const r3 = reconcile(proj, { nowIso: '2026-08-21T00:00:02Z' });
  assert(r3.exit === 3, 'unpaired claims -> exit 3');
  assert(r3.lines.some((l3) => l3.startsWith('ACTION|CLAIM') || l3.startsWith('ACTION|PROVENANCE')), 'CLAIM/PROVENANCE action emitted');

  // BROKEN INSTRUMENT: remove the task graph
  rmSync(path.join(proj, 'CONTROL', 'task-graph-snapshot.json'), { force: true });
  const r4 = reconcile(proj, { nowIso: '2026-08-21T00:00:03Z' });
  assert(r4.exit === 2 && r4.lines[0].includes('BROKEN INSTRUMENT'), 'missing task graph -> exit 2 BROKEN INSTRUMENT, never a clean');

  // TERMINAL-DRIFT: N consecutive identical runs on a fully clean project
  const proj2 = path.join(tmp, 'proj2');
  mkdirSync(path.join(proj2, 'SPEC'), { recursive: true });
  mkdirSync(path.join(proj2, 'CONTROL'), { recursive: true });
  writeFileSync(path.join(proj2, 'SPEC', 'PROJECT-MANIFEST.md'), '# manifest\n', 'utf8');
  writeFileSync(path.join(proj2, 'CONTROL', 'task-graph-snapshot.json'), JSON.stringify({ nodes: [{ id: 'WS-01' }] }), 'utf8');
  writeFileSync(path.join(proj2, 'CONTROL', 'project_state.json'), JSON.stringify({ last_reconciliation: new Date().toISOString() }), 'utf8');
  let lastExit = 0;
  for (let i = 0; i < 7; i++) {
    lastExit = reconcile(proj2, { nowIso: `2026-08-21T00:00:1${i}Z` }).exit;
  }
  assert(lastExit === 4, `7 no-delta reconciles -> exit 4 TERMINAL-DRIFT (got ${lastExit})`);
  assert(existsSync(path.join(proj2, 'CONTROL', 'TERMINAL-DRIFT.flag')), 'TERMINAL-DRIFT.flag created');

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — fixtures, drift, provenance, instrument, terminal-stop all green\n');
    process.exitCode = 0;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') return selftest();
  const projectRoot = args[0];
  if (!projectRoot) {
    process.stderr.write('usage: anchor.mjs <project-home> [--mode anchor|reconcile] [--tasks <json>] [--state <json>] [--intents <file>] | --selftest\n');
    process.exit(2);
  }
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) opts.mode = args[++i];
    else if (args[i] === '--tasks' && args[i + 1]) opts.tasks = args[++i];
    else if (args[i] === '--state' && args[i + 1]) opts.state = args[++i];
    else if (args[i] === '--intents' && args[i + 1]) opts.intents = args[++i];
  }
  const r = reconcile(projectRoot, opts);
  process.stdout.write(`${r.lines.join('\n')}\n`);
  process.exit(r.exit);
}

main();
