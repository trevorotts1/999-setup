#!/usr/bin/env node
// swarm-plan.mjs — the swarm plan contract "blackceo.swarm-plan/v2" (references/swarm-plan.md).
//
//   node swarm-plan.mjs generate <project> <breakdown.json>   write + validate SWARM-PLAN.json
//                                                              (the per-workflow cap is MEASURED here by hooks/capacity_probe.py)
//   node swarm-plan.mjs check <plan.json>                      validate a plan file
//   node swarm-plan.mjs capacity                               print this box's measured capacity (the probe)
//   node swarm-plan.mjs ready <plan.json> [--root <dir>] [--running a,b]
//   node swarm-plan.mjs launch-check <plan.json> <workflowId> <unit,unit,...> --attempt-id <id> [--root <dir>] [--running a,b]
//   node swarm-plan.mjs --selftest
//
// Exit codes: 0 ok · 1 plan/launch REFUSED (reasons on stderr) · 2 tooling failure.
// The hooks (workflow-guard staffing.py, dispatch-gate.py) enforce the same contract at
// launch time; this tool is how the skill writes a plan that passes them. THE RULES ARE
// ONE RULESET shared with staffing.py (validate_plan) and the packet's swarm_plan_check.py;
// tests/test_plan_validators_agree.py proves the accept/reject results match.
//
// THE NUMBERS: the per-workflow cap is measured on the box (RAM, cores, container limits;
// hooks/capacity_probe.py) and recorded as policy.max_agents_per_workflow (integer 1..10);
// agent_count = min(policy.max_agents_per_workflow, len(units)). The 10 is a ceiling, never a
// floor. Nobody types the cap: `generate` runs the probe, and `check` refuses a plan whose
// cap differs from policy.capacity_probe.per_workflow_cap.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'blackceo.swarm-plan/v2';
export const MAX_AGENTS = 10;
export const MAX_WORKFLOWS = 50;
export const MAX_WORKING = 500;
export const MAX_REPAIR_CYCLES = 2;
// Contract v2.1: a workflow has no verdict_file of its own (it is DONE when every unit verdict is PASS).
// Leftover staffing arithmetic: staffing is derived from units, so these keys never appear (same list as staffing.py LEFTOVER_KEYS).
const LEFTOVER_KEYS = ['verdict_file', 'builders', 'checkers', 'repair_extra_executions_max', 'max_total_executions', 'total_executions', 'repair_reserve', 'executions_total'];
// Padding (same two rules as staffing.py and swarm_plan_check.py): "slice N of M" text, or the same work text twice in a workflow (digits, whitespace and case ignored).
const SLICE_TEXT = /slice \d+ of \d+/i;
const PLACEHOLDER = /slices\/|[<>*]|TBD|TODO/i;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);

function enumerated(work) {
  // three or more numbered/semicolon-separated items in ONE unit is probably under-splitting. A WARNING only:
  // the other two validators have no such rule, so an error here would be a disagreement.
  const semi = work.split(';').filter((x) => x.trim()).length;
  const nums = (work.match(/(?:^|\s)\(?\d+[.)]\s/g) || []).length;
  return Math.max(semi, nums) >= 3;
}

// owned_output: a concrete repo-relative file, or a directory ending in "/" (same rule as staffing.py _bad_owned).
function badOwned(p) {
  if (!isStr(p)) return 'must be a concrete repo-relative file or directory path (empty)';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('~')) return `must be repo-relative, not absolute: '${p}'`;
  if (p.split('/').includes('..')) return `must not contain '..': '${p}'`;
  if (PLACEHOLDER.test(p)) return `is a placeholder: '${p}'`;
  return null;
}
// Equal, or one is a directory ("a/b/") that is a path-prefix of the other. "a/b" vs "a/bc.py" do not overlap.
const overlap = (a, b) => a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));

/** The per-workflow cap a plan carries: an integer 1..MAX_AGENTS, else null. */
export const planCap = (plan) => {
  const v = plan && plan.policy && plan.policy.max_agents_per_workflow;
  return Number.isInteger(v) && v >= 1 && v <= MAX_AGENTS ? v : null;
};

export const warnings = [];
export function validate(plan) {
  const errs = [];
  warnings.length = 0;
  const e = (m) => errs.push(m);
  if (!plan || typeof plan !== 'object') return ['plan is not a JSON object'];
  if (plan.schema !== SCHEMA) e(`schema must be "${SCHEMA}"`);
  const pol = plan.policy || {};
  if (!isInt(pol.max_active_workflows) || pol.max_active_workflows < 1 || pol.max_active_workflows > MAX_WORKFLOWS) e(`policy.max_active_workflows must be an integer 1..${MAX_WORKFLOWS}`);
  const cap = planCap(plan);
  if (cap === null) e(`policy.max_agents_per_workflow must be an integer 1..${MAX_AGENTS} (the measured per-workflow cap)`);
  const cp = pol.capacity_probe;
  if (cp !== undefined && (cp === null || typeof cp !== 'object' || Array.isArray(cp) || cp.per_workflow_cap !== pol.max_agents_per_workflow)) e('policy.max_agents_per_workflow must equal policy.capacity_probe.per_workflow_cap');
  if (!isInt(pol.max_working_agents) || pol.max_working_agents < 1 || pol.max_working_agents > MAX_WORKING) e(`policy.max_working_agents must be an integer 1..${MAX_WORKING}`);
  if (pol.max_repair_cycles !== undefined && (!isInt(pol.max_repair_cycles) || pol.max_repair_cycles < 0 || pol.max_repair_cycles > MAX_REPAIR_CYCLES)) e(`policy.max_repair_cycles must be 0..${MAX_REPAIR_CYCLES}`);
  const wfs = plan.workflows;
  if (!Array.isArray(wfs) || !wfs.length) { e('workflows must be a non-empty array'); return errs; }
  const ids = new Set(); const outs = []; const unitIds = new Set();
  for (const w of wfs) {
    const wid = w && w.workflow_id;
    if (!isStr(wid)) { e('every workflow needs a nonempty workflow_id'); continue; }
    if (ids.has(wid)) e(`duplicate workflow_id ${wid}`);
    ids.add(wid);
    const units = w.units;
    if (!Array.isArray(units) || !units.length) { e(`${wid}: units must be a non-empty array`); continue; }
    for (const k of LEFTOVER_KEYS) if (k in w) e(`${wid}: leftover key ${k} \u2014 staffing is derived from units`);
    const want = Math.min(cap === null ? MAX_AGENTS : cap, units.length);
    if (w.agent_count !== want) e(`${wid}: agent_count must be min(max_agents_per_workflow, len(units)) = ${want}`);
    if (w.concurrency !== want) e(`${wid}: concurrency must equal agent_count = ${want}`);
    if (!Array.isArray(w.dependencies)) e(`${wid}: dependencies must be an array`);
    const works = new Set(); const seen = new Set();
    const uidRe = new RegExp(`^${wid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-U[0-9]+$`);
    units.forEach((u, i) => {
      if (!u || typeof u !== 'object' || Array.isArray(u)) { e(`${wid}: unit ${i + 1} must be an object`); return; }
      const uid = u.unit_id;
      if (typeof uid !== 'string' || !uidRe.test(uid)) e(`${wid}: unit_id '${uid}' must look like ${wid}-U<n>`);
      else if (seen.has(uid)) e(`${wid}: duplicate unit_id ${uid}`);
      seen.add(uid);
      for (const k of ['work', 'acceptance', 'source']) if (!isStr(u[k])) e(`${wid}: ${uid} needs a nonempty ${k}`);
      if (u.verdict_file !== `evidence/${wid}/${uid}.verdict.json`) e(`${wid}: ${uid} verdict_file must be evidence/${wid}/${uid}.verdict.json`);
      const bad = badOwned(u.owned_output);
      if (bad) e(`${wid}: ${uid} owned_output ${bad}`);
      else {
        for (const [q, other] of outs) if (overlap(u.owned_output, q)) e(`${uid}: owned_output ${u.owned_output} overlaps ${other} ${q}`);
        outs.push([u.owned_output, uid]);
      }
      if (isStr(u.work)) {
        if (SLICE_TEXT.test(u.work)) e(`${wid}: ${uid} work is "slice N of M" padding`);
        const key = u.work.replace(/[\d\s]+/g, '').toLowerCase();
        if (key && works.has(key)) e(`${wid}: ${uid} work duplicates another unit (padding)`);
        works.add(key);
        if (enumerated(u.work)) warnings.push(`${uid}: possibly under-split: one unit lists several items; consider splitting them into units`);
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

// A unit verdict (contract v2.1) is JSON {verdict, unit_id, attempt_id, builder_model, reviewer_model}: PASS only
// counts when it names the unit, an attempt, and a reviewer that is not the builder. (That attempt_id is an
// ADMITTED launch is the guard journal's check, not this file's.)
export function unitPassed(root, u) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, u.verdict_file), 'utf8'));
    return d.verdict === 'PASS' && d.unit_id === u.unit_id && isStr(d.attempt_id) && isStr(d.builder_model)
      && isStr(d.reviewer_model) && d.reviewer_model !== d.builder_model;
  } catch { return false; }
}
// A workflow is DONE when every one of its units passed.
export const workflowDone = (root, w) => (w.units || []).length > 0 && w.units.every((u) => unitPassed(root, u));

// Done = every unit verdict PASS. Ready = not done, not running, dependencies done.
export function readiness(plan, root, running = []) {
  const done = new Set(plan.workflows.filter((w) => workflowDone(root, w)).map((w) => w.workflow_id));
  const run = new Set(running);
  const ready = plan.workflows.filter((w) => !done.has(w.workflow_id) && !run.has(w.workflow_id)
    && (w.dependencies || []).every((d) => done.has(d))).map((w) => w.workflow_id);
  const room = Math.max(0, plan.policy.max_active_workflows - run.size);
  return { done: [...done], running: [...run], ready, owed: ready.slice(0, room) };
}

export function launchCheck(plan, workflowId, units, root, running = [], attemptId = null) {
  const w = plan.workflows.find((x) => x.workflow_id === workflowId);
  if (!w) return [`BLOCKED: ${workflowId} is not a workflow of this plan`];
  const r = readiness(plan, root, running);
  const errs = [];
  if (!r.ready.includes(workflowId)) errs.push(`BLOCKED: ${workflowId} is not READY (done, running, or a dependency is not PASS)`);
  else if (!r.owed.includes(workflowId)) errs.push(`BLOCKED: max_active_workflows ${plan.policy.max_active_workflows} would be exceeded`);
  if (!isStr(attemptId)) errs.push('BLOCKED: args.attemptId is required (contract v2.1: each launch names its attempt; unit verdicts cite it)');
  const want = w.units.map((u) => u.unit_id);
  if (units.length !== want.length || want.some((u) => !units.includes(u))) errs.push(`BLOCKED: args.units must be exactly ${want.join(',')}`);
  return errs;
}

// The ONE capacity probe: hooks/capacity_probe.py (Python, stdlib; the same file Hook Skill ships as
// workflow-guard/capacity_probe.py -- GB_PER_AGENT lives only there). It prints
// {ram_gb, cores, source, per_workflow_cap, max_working_agents, measured_at}. fixtureFile is the
// selftest/test door only: it reads that JSON instead of measuring.
export function measureCapacity(fixtureFile = null) {
  if (fixtureFile) return JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const probe = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hooks', 'capacity_probe.py');
  const tried = [];
  for (const [bin, pre] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const r = spawnSync(bin, [...pre, probe], { encoding: 'utf8', timeout: 20000 });
    tried.push(bin);
    if (r.status === 0) { try { return JSON.parse(r.stdout); } catch { /* try the next interpreter */ } }
  }
  throw new Error(`capacity probe failed (tried ${tried.join(', ')} on ${probe}); the cap is measured, never typed`);
}

export function buildPlan(breakdown, capacity) {
  const cap = capacity.per_workflow_cap;
  const workflows = breakdown.workflows.map((w) => {
    const units = w.units.map((u, i) => ({
      unit_id: `${w.workflow_id}-U${i + 1}`, work: u.work, owned_output: u.owned_output,
      acceptance: u.acceptance, source: u.source, verdict_file: `evidence/${w.workflow_id}/${w.workflow_id}-U${i + 1}.verdict.json`,
    }));
    const n = Math.min(cap, units.length);
    return { workflow_id: w.workflow_id, dependencies: w.dependencies || [], units, agent_count: n, concurrency: n,
    };
  });
  const active = Math.min(MAX_WORKFLOWS, breakdown.max_active_workflows || workflows.length);
  return { schema: SCHEMA,
    policy: { max_active_workflows: active, max_agents_per_workflow: cap, max_working_agents: capacity.max_working_agents,
      max_repair_cycles: MAX_REPAIR_CYCLES,
      capacity_probe: { ram_gb: capacity.ram_gb, cores: capacity.cores, source: capacity.source, per_workflow_cap: cap, max_working_agents: capacity.max_working_agents, measured_at: capacity.measured_at } },
    workflows };
}

function argv(name, a) { const i = a.indexOf(name); return i < 0 ? null : a[i + 1]; }
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { console.error(`SWARM-PLAN tooling failure: ${f}: ${err.message}`); process.exit(2); } };
const refuse = (errs) => { for (const m of errs) console.error(`SWARM-PLAN REFUSED | ${m}`); process.exit(1); };
const warn = () => { for (const m of warnings) console.error(`SWARM-PLAN WARNING | ${m}`); };

function selftest() {
  let fails = 0;
  const t = (name, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${d ? ' ' + d : ''}`); if (!ok) fails++; };
  const cap10 = { ram_gb: 24, cores: 12, source: 'fixture', per_workflow_cap: 10, max_working_agents: 500, measured_at: '2026-01-01T00:00:00Z' };
  const cap6 = { ram_gb: 9, cores: 6, source: 'fixture', per_workflow_cap: 6, max_working_agents: 300, measured_at: '2026-01-01T00:00:00Z' };
  const mk = (n, extra = {}) => ({ workflow_id: 'W1', dependencies: [], units: Array.from({ length: n }, (_, i) => ({
    work: `build screen number ${i + 1} of the app shell ${'x'.repeat(i)}`.replace(/ of the app shell/, ' view'), owned_output: `src/screens/s${i + 1}.tsx`,
    acceptance: `screen ${i + 1} renders and its test passes`, source: 'SPEC section 4' })), ...extra });
  const good = (n, cap = cap10) => buildPlan({ workflows: [mk(n)] }, cap);
  for (const n of [1, 3, 10, 14]) {
    const p = good(n); const want = Math.min(10, n);
    t(`valid-plan-${n}-units`, validate(p).length === 0 && p.workflows[0].agent_count === want && p.workflows[0].concurrency === want, `agent_count=${p.workflows[0].agent_count}`);
  }
  const p6 = good(8, cap6);
  t('cap-6-plan-8-units-agent_count-6', validate(p6).length === 0 && p6.workflows[0].agent_count === 6 && p6.policy.max_working_agents === 300);
  const mut = (n, fn, cap = cap10) => { const p = good(n, cap); fn(p); return validate(p); };
  t('cap-6-plan-agent_count-10-refused', mut(8, (p) => { p.workflows[0].agent_count = 8; p.workflows[0].concurrency = 8; }, cap6).some((m) => /agent_count must be/.test(m)));
  t('cap-hand-edited-to-10-on-a-cap-6-probe-refused', mut(8, (p) => { p.policy.max_agents_per_workflow = 10; }, cap6).some((m) => /capacity_probe/.test(m)));
  t('agent_count-below-min(cap,units)-refused', mut(14, (p) => { p.workflows[0].agent_count = 6; p.workflows[0].concurrency = 6; }).some((m) => /agent_count must be/.test(m)));
  t('agent_count-1-for-12-units-refused', mut(12, (p) => { p.workflows[0].agent_count = 1; p.workflows[0].concurrency = 1; }).length > 0);
  t('agent_count-above-units-refused', mut(3, (p) => { p.workflows[0].agent_count = 10; p.workflows[0].concurrency = 10; }).length > 0);
  t('concurrency-mismatch-refused', mut(10, (p) => { p.workflows[0].concurrency = 4; }).some((m) => /concurrency/.test(m)));
  t('max_agents_per_workflow-11-refused', mut(10, (p) => { p.policy.max_agents_per_workflow = 11; }).length > 0);
  t('max_agents_per_workflow-0-refused', mut(10, (p) => { p.policy.max_agents_per_workflow = 0; }).length > 0);
  t('max_agents_per_workflow-missing-refused', mut(10, (p) => { delete p.policy.max_agents_per_workflow; }).length > 0);
  t('max_active_workflows-51-refused', mut(10, (p) => { p.policy.max_active_workflows = 51; }).length > 0);
  t('max_working_agents-501-refused', mut(10, (p) => { p.policy.max_working_agents = 501; }).length > 0);
  for (const k of LEFTOVER_KEYS) t(`leftover-key-${k}-refused`, mut(10, (p) => { p.workflows[0][k] = 1; }).some((m) => m === `W1: leftover key ${k} — staffing is derived from units`));
  t('duplicate-owned-output-refused', mut(10, (p) => { p.workflows[0].units[1].owned_output = p.workflows[0].units[0].owned_output; }).some((m) => /overlaps/.test(m)));
  t('glob-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/**/*.tsx'; }).length > 0);
  t('directory-owned-output-accepted', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/screens/dirA/'; }).length === 0);
  t('directory-prefix-overlap-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/screens/'; }).some((m) => /overlaps/.test(m)));
  t('a/b-vs-a/bc.py-do-not-overlap', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'src/screens/s'; p.workflows[0].units[1].owned_output = 'src/screens/sx.tsx'; }).length === 0);
  t('absolute-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = '/etc/x.md'; }).length > 0);
  t('dotdot-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'a/../b.md'; }).length > 0);
  t('placeholder-owned-output-refused', mut(10, (p) => { p.workflows[0].units[0].owned_output = 'slices/W1/a.md'; }).length > 0);
  t('padding-slice-n-of-m-refused', mut(10, (p) => { p.workflows[0].units[2].work = 'write slice 3 of 10 of the parser'; }).some((m) => /padding/.test(m)));
  t('padding-duplicate-work-refused', mut(10, (p) => { p.workflows[0].units[2].work = p.workflows[0].units[1].work; }).some((m) => /padding/.test(m)));
  t('under-split-is-a-warning-not-an-error', mut(10, (p) => { p.workflows[0].units[0].work = 'build login; build signup; build reset; build profile'; }).length === 0 && warnings.length === 1);
  t('bad-unit-verdict-path-refused', mut(10, (p) => { p.workflows[0].units[0].verdict_file = 'evidence/other.json'; }).length > 0);
  t('workflow-level-verdict_file-refused-as-leftover', mut(10, (p) => { p.workflows[0].verdict_file = 'evidence/W1/verdict.json'; }).some((m) => /leftover key verdict_file/.test(m)));
  t('repair-cycles-3-refused', mut(10, (p) => { p.policy.max_repair_cycles = 3; }).length > 0);
  const two = buildPlan({ workflows: [mk(10), { ...mk(4), workflow_id: 'W2', dependencies: ['W1'], units: mk(4).units.map((u, i) => ({ ...u, owned_output: `lib/m${i}.ts`, work: `module ${'abcd'[i]} logic` })) }] }, cap10);
  t('two-workflow-plan-valid', validate(two).length === 0);
  const cyc = JSON.parse(JSON.stringify(two)); cyc.workflows[0].dependencies = ['W2'];
  t('dependency-cycle-refused', validate(cyc).some((m) => /cycle/.test(m)));
  // readiness: done = verdict PASS, never a status field
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-plan-'));
  let r = readiness(two, root);
  t('ready-only-W1-at-start', r.ready.join() === 'W1' && r.owed.join() === 'W1');
  fs.mkdirSync(path.join(root, 'evidence/W1'), { recursive: true });
  const verdict = (u, o = {}) => fs.writeFileSync(path.join(root, u.verdict_file), JSON.stringify({ verdict: 'PASS', unit_id: u.unit_id, attempt_id: 'a1', builder_model: 'opus', reviewer_model: 'sonnet', ...o }));
  const w1 = two.workflows[0].units;
  w1.forEach((u) => verdict(u, { verdict: 'FAIL' }));
  t('all-units-FAIL-is-not-done', readiness(two, root).ready.join() === 'W1');
  w1.forEach((u) => verdict(u));
  fs.writeFileSync(path.join(root, 'evidence/W1/verdict.json'), '{"verdict":"PASS"}');  // a workflow-level file decides nothing
  w1.slice(1).forEach((u) => verdict(u));
  verdict(w1[0], { reviewer_model: 'opus' });
  t('self-review-(reviewer == builder)-is-not-done', readiness(two, root).ready.join() === 'W1');
  verdict(w1[0], { attempt_id: '' });
  t('verdict-without-attempt_id-is-not-done', readiness(two, root).ready.join() === 'W1');
  verdict(w1[0], { unit_id: 'W1-U9' });
  t('verdict-naming-another-unit-is-not-done', readiness(two, root).ready.join() === 'W1');
  verdict(w1[0]);
  r = readiness(two, root);
  t('every-unit-PASS-releases-dependent', r.ready.join() === 'W2' && r.done.join() === 'W1');
  t('running-workflow-not-ready', readiness(two, root, ['W2']).ready.length === 0);
  const ids = two.workflows[1].units.map((u) => u.unit_id);
  t('launch-exact-units-allowed', launchCheck(two, 'W2', ids, root, [], 'att-1').length === 0);
  t('launch-without-attemptId-blocked', launchCheck(two, 'W2', ids, root).some((m) => /attemptId/.test(m)));
  t('launch-missing-unit-blocked', launchCheck(two, 'W2', ids.slice(1), root, [], 'att-1').length > 0);
  const dep3 = buildPlan({ workflows: [mk(3), { ...mk(3), workflow_id: 'W2', dependencies: ['W1'], units: mk(3).units.map((u, i) => ({ ...u, owned_output: `lib/n${i}.ts`, work: `n${'abc'[i]} logic` })) }] }, cap10);
  t('launch-blocked-dependency', validate(dep3).length === 0 && launchCheck(dep3, 'W2', ['W2-U1', 'W2-U2', 'W2-U3'], fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-plan-'))).length > 0);
  const capped = buildPlan({ max_active_workflows: 1, workflows: [mk(3), { ...mk(3), workflow_id: 'W9', units: mk(3).units.map((u, i) => ({ ...u, owned_output: `lib/z${i}.ts`, work: `z${'abc'[i]} logic` })) }] }, cap10);
  t('max-active-limits-owed', validate(capped).length === 0 && readiness(capped, root, []).owed.length === 1 && readiness(capped, root, ['W1']).owed.length === 0);
  // the real probe runs, and what it measures yields a plan that validates
  let live = null; try { live = measureCapacity(); } catch (err) { /* reported below */ }
  t('live-probe-runs-and-yields-a-valid-plan', live !== null && live.per_workflow_cap >= 1 && live.per_workflow_cap <= 10 && validate(buildPlan({ workflows: [mk(12)] }, live)).length === 0, live ? `cap=${live.per_workflow_cap} (${live.ram_gb} GB, ${live.cores} cores, ${live.source})` : 'probe failed');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `swarm-plan selftest: ${fails} FAILED` : 'swarm-plan selftest: ALL PASS');
  process.exit(fails ? 1 : 0);
}

const A = process.argv.slice(2);
const cmd = A[0];
if (cmd === '--selftest') selftest();
else if (cmd === 'check') { const e = validate(read(A[1])); warn(); if (e.length) refuse(e); console.log(`SWARM-PLAN OK | ${A[1]}`); }
else if (cmd === 'generate') {
  const project = path.resolve(A[1] || '.');
  let capacity; try { capacity = measureCapacity(argv('--capacity-fixture', A)); } catch (err) { console.error(`SWARM-PLAN tooling failure: ${err.message}`); process.exit(2); }
  const plan = buildPlan(read(A[2]), capacity);
  const e = validate(plan); warn(); if (e.length) refuse(e);
  fs.writeFileSync(path.join(project, 'SWARM-PLAN.json'), JSON.stringify(plan, null, 2) + '\n');
  const prof = path.join(project, '.spec-protocol.json');
  if (fs.existsSync(prof)) { const p = read(prof); p.swarmPlan = 'SWARM-PLAN.json'; fs.writeFileSync(prof, JSON.stringify(p, null, 2) + '\n'); }
  console.log(`SWARM-PLAN WRITTEN | ${path.join(project, 'SWARM-PLAN.json')} | workflows=${plan.workflows.length} | per-workflow cap ${capacity.per_workflow_cap} (${capacity.ram_gb} GB, ${capacity.cores} cores, ${capacity.source}) | swarmPlan key ${fs.existsSync(prof) ? 'set' : 'not set (no .spec-protocol.json; discovery falls back to SWARM-PLAN.json)'}`);
} else if (cmd === 'capacity') { try { console.log(JSON.stringify(measureCapacity(argv('--capacity-fixture', A)), null, 2)); } catch (err) { console.error(`SWARM-PLAN tooling failure: ${err.message}`); process.exit(2); } }
else if (cmd === 'ready' || cmd === 'launch-check') {
  const plan = read(A[1]); const e = validate(plan); if (e.length) refuse(e);
  const root = argv('--root', A) || path.dirname(path.resolve(A[1]));
  const running = (argv('--running', A) || '').split(',').filter(Boolean);
  if (cmd === 'ready') console.log(JSON.stringify(readiness(plan, root, running)));
  else { const b = launchCheck(plan, A[2], (A[3] || '').split(',').filter(Boolean), root, running, argv('--attempt-id', A)); if (b.length) refuse(b); console.log('LAUNCH OK'); }
} else { console.error('usage: swarm-plan.mjs generate|check|capacity|ready|launch-check|--selftest'); process.exit(2); }
