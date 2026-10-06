#!/usr/bin/env node
// swarm-plan.mjs — the swarm plan contract "blackceo.swarm-plan/v2" (references/swarm-plan.md).
//
//   node swarm-plan.mjs generate <project> <breakdown.json>   write + validate SWARM-PLAN.json
//   node swarm-plan.mjs check <plan.json>                      validate a plan file
//   node swarm-plan.mjs ready <plan.json> [--root <dir>] [--running a,b]
//   node swarm-plan.mjs launch-check <plan.json> <workflowId> <unit,unit,...> [--root <dir>] [--running a,b]
//   node swarm-plan.mjs --selftest
//
// Exit codes: 0 ok · 1 plan/launch REFUSED (reasons on stderr) · 2 tooling failure.
// The hooks (workflow-guard staffing.py, dispatch-gate.py) enforce the same contract at
// launch time; this tool is how the skill writes a plan that passes them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCHEMA = 'blackceo.swarm-plan/v2';
export const MAX_AGENTS = 10;
export const MAX_WORKFLOWS = 50;
export const MAX_WORKING = 500;
export const MAX_REPAIR_CYCLES = 2;
const LEGACY_KEYS = ['checkers', 'total_executions', 'repair_reserve', 'executions_total'];
const PADDING = [/\bpart\s*\d+\s*(of|\/)\s*\d+/i, /\b(slice|chunk|piece|batch|shard)\s*#?\d+\s*(of|\/)\s*\d+/i,
  /^\s*(filler|placeholder|padding|tbd|todo|dummy)\b/i, /\bfake\b/i];
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);

function enumerated(work) {
  // three or more numbered/semicolon-separated items in ONE unit is under-splitting
  const semi = work.split(';').filter((x) => x.trim()).length;
  const nums = (work.match(/(?:^|\s)\(?\d+[.)]\s/g) || []).length;
  return Math.max(semi, nums) >= 3;
}

function concretePath(p) {
  if (!isStr(p)) return 'owned_output is missing';
  if (/[*?\[\]{}<>|,;\s]/.test(p)) return `owned_output "${p}" is not one concrete path (glob, list or whitespace)`;
  if (p.startsWith('/') || p.includes('..') || p.endsWith('/')) return `owned_output "${p}" must be a relative file path inside the project`;
  if (!/\.[A-Za-z0-9]+$/.test(path.basename(p))) return `owned_output "${p}" names no file (no extension)`;
  return null;
}

export function validate(plan) {
  const errs = [];
  const e = (m) => errs.push(m);
  if (!plan || typeof plan !== 'object') return ['plan is not a JSON object'];
  if (plan.schema !== SCHEMA) e(`schema must be "${SCHEMA}"`);
  const pol = plan.policy || {};
  if (!isInt(pol.max_active_workflows) || pol.max_active_workflows < 1 || pol.max_active_workflows > MAX_WORKFLOWS) e(`policy.max_active_workflows must be an integer 1..${MAX_WORKFLOWS}`);
  if (pol.max_agents_per_workflow !== MAX_AGENTS) e(`policy.max_agents_per_workflow must be ${MAX_AGENTS}`);
  if (!isInt(pol.max_working_agents) || pol.max_working_agents < MAX_AGENTS || pol.max_working_agents > MAX_WORKING) e(`policy.max_working_agents must be an integer ${MAX_AGENTS}..${MAX_WORKING}`);
  if (pol.max_repair_cycles !== undefined && (!isInt(pol.max_repair_cycles) || pol.max_repair_cycles < 0 || pol.max_repair_cycles > MAX_REPAIR_CYCLES)) e(`policy.max_repair_cycles must be 0..${MAX_REPAIR_CYCLES}`);
  const wfs = plan.workflows;
  if (!Array.isArray(wfs) || !wfs.length) { e('workflows must be a non-empty array'); return errs; }
  const ids = new Set(); const outs = new Map(); const unitIds = new Set();
  for (const w of wfs) {
    const wid = w && w.workflow_id;
    if (!isStr(wid) || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(wid)) { e(`workflow_id "${wid}" is missing or malformed`); continue; }
    if (ids.has(wid)) e(`duplicate workflow_id ${wid}`);
    ids.add(wid);
    for (const k of LEGACY_KEYS) if (k in w) e(`${wid}: legacy key "${k}" is refused (no checker-count or executions arithmetic; one checker per unit)`);
    const units = w.units;
    if (!Array.isArray(units) || !units.length) { e(`${wid}: units must be a non-empty array`); continue; }
    const want = Math.min(MAX_AGENTS, units.length);
    if (w.agent_count !== want) e(`${wid}: agent_count is ${w.agent_count}, must be min(${MAX_AGENTS}, ${units.length} units) = ${want}`);
    if (w.concurrency !== w.agent_count) e(`${wid}: concurrency ${w.concurrency} must equal agent_count ${w.agent_count}`);
    if (w.verdict_file !== `evidence/${wid}/verdict.json`) e(`${wid}: verdict_file must be evidence/${wid}/verdict.json`);
    if (!Array.isArray(w.dependencies)) e(`${wid}: dependencies must be an array`);
    const works = new Set();
    units.forEach((u, i) => {
      const uid = u && u.unit_id;
      if (uid !== `${wid}-U${i + 1}`) e(`${wid}: unit ${i + 1} unit_id must be ${wid}-U${i + 1} (got ${uid})`);
      if (unitIds.has(uid)) e(`duplicate unit_id ${uid}`);
      unitIds.add(uid);
      for (const k of ['work', 'acceptance', 'source']) if (!isStr(u[k])) e(`${uid}: ${k} is missing`);
      if (u.verdict_file !== `evidence/${wid}/${uid}.verdict.json`) e(`${uid}: verdict_file must be evidence/${wid}/${uid}.verdict.json`);
      const pe = concretePath(u.owned_output);
      if (pe) e(`${uid}: ${pe}`);
      else {
        const norm = path.posix.normalize(u.owned_output);
        if (outs.has(norm)) e(`${uid}: owned_output ${norm} is already owned by ${outs.get(norm)} (outputs are unique across the plan)`);
        outs.set(norm, uid);
      }
      if (isStr(u.work)) {
        if (PADDING.some((r) => r.test(u.work))) e(`${uid}: padding unit (fake slice / "part k of n" / filler): ${u.work}`);
        const key = u.work.trim().toLowerCase();
        if (works.has(key)) e(`${uid}: duplicate work text in ${wid}: padding`);
        works.add(key);
        if (enumerated(u.work)) e(`${uid}: under-split: one unit lists several items; split them into units`);
      }
    });
  }
  const byId = new Map(wfs.filter((w) => w && isStr(w.workflow_id)).map((w) => [w.workflow_id, w]));
  for (const w of byId.values()) for (const d of w.dependencies || []) {
    if (d === w.workflow_id) e(`${w.workflow_id}: depends on itself`);
    else if (!byId.has(d)) e(`${w.workflow_id}: unknown dependency ${d}`);
  }
  // acyclic
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { e(`dependency cycle: ${[...stack, id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const d of byId.get(id)?.dependencies || []) if (byId.has(d)) visit(d, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return errs;
}

export function isDone(root, file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).verdict === 'PASS'; } catch { return false; }
}

// Done = verdict_file says PASS. Ready = not done, not running, dependencies done.
export function readiness(plan, root, running = []) {
  const done = new Set(plan.workflows.filter((w) => isDone(root, w.verdict_file)).map((w) => w.workflow_id));
  const run = new Set(running);
  const ready = plan.workflows.filter((w) => !done.has(w.workflow_id) && !run.has(w.workflow_id)
    && (w.dependencies || []).every((d) => done.has(d))).map((w) => w.workflow_id);
  const room = Math.max(0, plan.policy.max_active_workflows - run.size);
  return { done: [...done], running: [...run], ready, owed: ready.slice(0, room) };
}

export function launchCheck(plan, workflowId, units, root, running = []) {
  const w = plan.workflows.find((x) => x.workflow_id === workflowId);
  if (!w) return [`BLOCKED: ${workflowId} is not a workflow of this plan`];
  const r = readiness(plan, root, running);
  const errs = [];
  if (!r.ready.includes(workflowId)) errs.push(`BLOCKED: ${workflowId} is not READY (done, running, or a dependency is not PASS)`);
  else if (!r.owed.includes(workflowId)) errs.push(`BLOCKED: max_active_workflows ${plan.policy.max_active_workflows} would be exceeded`);
  const want = w.units.map((u) => u.unit_id);
  if (units.length !== want.length || want.some((u) => !units.includes(u))) errs.push(`BLOCKED: args.units must be exactly ${want.join(',')}`);
  return errs;
}

export function buildPlan(breakdown) {
  const workflows = breakdown.workflows.map((w) => {
    const units = w.units.map((u, i) => ({
      unit_id: `${w.workflow_id}-U${i + 1}`, work: u.work, owned_output: u.owned_output,
      acceptance: u.acceptance, source: u.source, verdict_file: `evidence/${w.workflow_id}/${w.workflow_id}-U${i + 1}.verdict.json`,
    }));
    const n = Math.min(MAX_AGENTS, units.length);
    return { workflow_id: w.workflow_id, dependencies: w.dependencies || [], units, agent_count: n, concurrency: n,
      verdict_file: `evidence/${w.workflow_id}/verdict.json` };
  });
  const active = Math.min(MAX_WORKFLOWS, breakdown.max_active_workflows || workflows.length);
  return { schema: SCHEMA,
    policy: { max_active_workflows: active, max_agents_per_workflow: MAX_AGENTS,
      max_working_agents: Math.min(MAX_WORKING, active * MAX_AGENTS), max_repair_cycles: MAX_REPAIR_CYCLES },
    workflows };
}

function argv(name, a) { const i = a.indexOf(name); return i < 0 ? null : a[i + 1]; }
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { console.error(`SWARM-PLAN tooling failure: ${f}: ${err.message}`); process.exit(2); } };
const refuse = (errs) => { for (const m of errs) console.error(`SWARM-PLAN REFUSED | ${m}`); process.exit(1); };

function selftest() {
  let fails = 0;
  const t = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${d ? ' ' + d : ''}`); if (!ok) fails++; };
  const mk = (n, extra = {}) => ({ workflow_id: 'W1', dependencies: [], units: Array.from({ length: n }, (_, i) => ({
    work: `build screen number ${i + 1} of the app shell ${'x'.repeat(i)}`.replace(/ of the app shell/, ' view'), owned_output: `src/screens/s${i + 1}.tsx`,
    acceptance: `screen ${i + 1} renders and its test passes`, source: 'SPEC section 4' })), ...extra });
  const good = (n) => buildPlan({ workflows: [mk(n)] });
  for (const n of [1, 3, 10, 14]) {
    const p = good(n); const want = Math.min(10, n);
    t(`valid-plan-${n}-units`, validate(p).length === 0 && p.workflows[0].agent_count === want && p.workflows[0].concurrency === want, `agent_count=${p.workflows[0].agent_count}`);
  }
  const mut = (n, fn) => { const p = good(n); fn(p); return validate(p); };
  t('agent_count-below-min(10,units)-refused', mut(14, (p) => { p.workflows[0].agent_count = 6; p.workflows[0].concurrency = 6; }).some((m) => /agent_count is 6/.test(m)));
  t('agent_count-1-for-12-units-refused', mut(12, (p) => { p.workflows[0].agent_count = 1; p.workflows[0].concurrency = 1; }).length > 0);
  t('agent_count-above-units-refused', mut(3, (p) => { p.workflows[0].agent_count = 10; p.workflows[0].concurrency = 10; }).length > 0);
  t('concurrency-mismatch-refused', mut(10, (p) => { p.workflows[0].concurrency = 4; }).some((m) => /concurrency/.test(m)));
  t('max_agents_per_workflow-not-10-refused', mut(10, (p) => { p.policy.max_agents_per_workflow = 6; }).length > 0);
  t('max_active_workflows-51-refused', mut(10, (p) => { p.policy.max_active_workflows = 51; }).length > 0);
  t('max_working_agents-501-refused', mut(10, (p) => { p.policy.max_working_agents = 501; }).length > 0);
  t('legacy-checkers-key-refused', mut(10, (p) => { p.workflows[0].checkers = 1; }).some((m) => /legacy key/.test(m)));
  t('total_executions-key-refused', mut(10, (p) => { p.workflows[0].total_executions = 14; }).some((m) => /legacy key/.test(m)));
  t('duplicate-owned-output-refused', mut(10, (p) => { p.workflows[0].units[1].owned_output = p.workflows[0].units[0].owned_output; }).some((m) => /already owned/.test(m)));
  t('glob-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/**/*.tsx'; }).length > 0);
  t('directory-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/screens/'; }).length > 0);
  t('padding-part-k-of-n-refused', mut(10, (p) => { p.workflows[0].units[2].work = 'write part 3 of 10 of the parser'; }).some((m) => /padding/.test(m)));
  t('padding-duplicate-work-refused', mut(10, (p) => { p.workflows[0].units[2].work = p.workflows[0].units[1].work; }).some((m) => /duplicate work/.test(m)));
  t('under-split-list-refused', mut(10, (p) => { p.workflows[0].units[0].work = 'build login; build signup; build reset; build profile'; }).some((m) => /under-split/.test(m)));
  t('bad-unit-verdict-path-refused', mut(10, (p) => { p.workflows[0].units[0].verdict_file = 'evidence/other.json'; }).length > 0);
  t('bad-workflow-verdict-path-refused', mut(10, (p) => { p.workflows[0].verdict_file = 'verdict.json'; }).length > 0);
  t('repair-cycles-3-refused', mut(10, (p) => { p.policy.max_repair_cycles = 3; }).length > 0);
  const two = buildPlan({ workflows: [mk(10), { ...mk(4), workflow_id: 'W2', dependencies: ['W1'], units: mk(4).units.map((u, i) => ({ ...u, owned_output: `lib/m${i}.ts`, work: `module ${i} logic` })) }] });
  t('two-workflow-plan-valid', validate(two).length === 0);
  const cyc = JSON.parse(JSON.stringify(two)); cyc.workflows[0].dependencies = ['W2'];
  t('dependency-cycle-refused', validate(cyc).some((m) => /cycle/.test(m)));
  // readiness: done = verdict PASS, never a status field
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-plan-'));
  let r = readiness(two, root);
  t('ready-only-W1-at-start', r.ready.join() === 'W1' && r.owed.join() === 'W1');
  fs.mkdirSync(path.join(root, 'evidence/W1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence/W1/verdict.json'), '{"verdict":"FAIL","status":"done"}');
  t('status-done-with-FAIL-verdict-is-not-done', readiness(two, root).ready.join() === 'W1');
  fs.writeFileSync(path.join(root, 'evidence/W1/verdict.json'), '{"verdict":"PASS"}');
  r = readiness(two, root);
  t('PASS-verdict-releases-dependent', r.ready.join() === 'W2' && r.done.join() === 'W1');
  t('running-workflow-not-ready', readiness(two, root, ['W2']).ready.length === 0);
  const ids = two.workflows[1].units.map((u) => u.unit_id);
  t('launch-exact-units-allowed', launchCheck(two, 'W2', ids, root).length === 0);
  t('launch-missing-unit-blocked', launchCheck(two, 'W2', ids.slice(1), root).length > 0);
  t('launch-blocked-dependency', launchCheck(buildPlan({ workflows: [mk(3), { ...mk(3), workflow_id: 'W2', dependencies: ['W1'], units: mk(3).units.map((u, i) => ({ ...u, owned_output: `lib/n${i}.ts`, work: `n ${i}` })) }] }), 'W2', ['W2-U1', 'W2-U2', 'W2-U3'], fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-plan-'))).length > 0);
  const cap = buildPlan({ max_active_workflows: 1, workflows: [mk(3), { ...mk(3), workflow_id: 'W9', units: mk(3).units.map((u, i) => ({ ...u, owned_output: `lib/z${i}.ts`, work: `z ${i}` })) }] });
  t('max-active-limits-owed', readiness(cap, root, []).owed.length === 1 && readiness(cap, root, ['W1']).owed.length === 0);
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `swarm-plan selftest: ${fails} FAILED` : 'swarm-plan selftest: ALL PASS');
  process.exit(fails ? 1 : 0);
}

const A = process.argv.slice(2);
const cmd = A[0];
if (cmd === '--selftest') selftest();
else if (cmd === 'check') { const e = validate(read(A[1])); if (e.length) refuse(e); console.log(`SWARM-PLAN OK | ${A[1]}`); }
else if (cmd === 'generate') {
  const project = path.resolve(A[1] || '.'); const plan = buildPlan(read(A[2]));
  const e = validate(plan); if (e.length) refuse(e);
  fs.writeFileSync(path.join(project, 'SWARM-PLAN.json'), JSON.stringify(plan, null, 2) + '\n');
  const prof = path.join(project, '.spec-protocol.json');
  if (fs.existsSync(prof)) { const p = read(prof); p.swarmPlan = 'SWARM-PLAN.json'; fs.writeFileSync(prof, JSON.stringify(p, null, 2) + '\n'); }
  console.log(`SWARM-PLAN WRITTEN | ${path.join(project, 'SWARM-PLAN.json')} | workflows=${plan.workflows.length} | swarmPlan key ${fs.existsSync(prof) ? 'set' : 'not set (no .spec-protocol.json; discovery falls back to SWARM-PLAN.json)'}`);
} else if (cmd === 'ready' || cmd === 'launch-check') {
  const plan = read(A[1]); const e = validate(plan); if (e.length) refuse(e);
  const root = argv('--root', A) || path.dirname(path.resolve(A[1]));
  const running = (argv('--running', A) || '').split(',').filter(Boolean);
  if (cmd === 'ready') console.log(JSON.stringify(readiness(plan, root, running)));
  else { const b = launchCheck(plan, A[2], (A[3] || '').split(',').filter(Boolean), root, running); if (b.length) refuse(b); console.log('LAUNCH OK'); }
} else { console.error('usage: swarm-plan.mjs generate|check|ready|launch-check|--selftest'); process.exit(2); }
