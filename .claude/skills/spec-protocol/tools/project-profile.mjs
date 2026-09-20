#!/usr/bin/env node
/**
 * Project-profile adapter. Profile commands are argv arrays, never shell text.
 *
 * The project command is the sole state/lifecycle writer. This adapter only
 * resolves a profile, proves its structural validator ran, and forwards the
 * caller's original dispatch argv. It never reserves, consumes, or recreates a
 * CONTROL state graph.
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const [action, rootArg, ...forwarded] = process.argv.slice(2);
const root = resolve(rootArg || '.');
const file = resolve(root, '.spec-protocol.json');
const schema = 'spec-protocol.project-profile/v1';
const documentKeys = ['spec', 'protocol', 'state', 'ledger', 'todo', 'checklist', 'qc'];
const policyKeys = ['maxActiveWorkflows', 'maxAgentsPerWorkflow', 'maxWorkingAgents', 'maxBuilderSubmissions', 'maxQCVerdicts'];
const fail = (message, code = 64) => {
  console.error(`SPEC-PROTOCOL PROFILE REFUSED | ${message}`);
  process.exit(code);
};
const validArgv = value => Array.isArray(value) && value.length >= 2
  && value.every(item => typeof item === 'string' && item && !/[\u0000\r\n]/.test(item));
const isBoundPath = value => {
  if (typeof value !== 'string' || !value || /[\u0000\r\n]/.test(value)) return false;
  const bound = resolve(root, value);
  const rel = relative(root, bound);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
};

if (!action || !rootArg) fail('usage: project-profile.mjs <bootstrap|dispatch|validate|release|resume-authorized|detect> <project> [original args...]');
if (!existsSync(file)) process.exit(66);
let profile;
try { profile = JSON.parse(readFileSync(file, 'utf8')); } catch { fail(`invalid JSON: ${file}`); }
if (profile?.schema !== schema) fail(`unsupported schema in ${file}`);
if (!profile.documents || documentKeys.some(key => !isBoundPath(profile.documents[key]))) {
  fail(`documents must bind in-root ${documentKeys.join(', ')} paths in ${file}`);
}
if (!profile.policy || policyKeys.some(key => !Number.isInteger(profile.policy[key]) || profile.policy[key] < 1)) {
  fail(`policy must contain positive integer bounds in ${file}`);
}
if (typeof profile.policy.builderRoute !== 'string' || !profile.policy.builderRoute
  || typeof profile.policy.qcRoute !== 'string' || !profile.policy.qcRoute
  || !Array.isArray(profile.targets) || !profile.targets.length
  || profile.targets.some(value => typeof value !== 'string' || !value)) {
  fail(`policy routes and targets are required in ${file}`);
}
if (!profile.commands || !['validate', 'dispatch', 'release'].every(key => validArgv(profile.commands[key]))) {
  fail(`commands.validate/dispatch/release must be argv arrays in ${file}`);
}
if (profile.commands.init !== undefined && !validArgv(profile.commands.init)) {
  fail(`commands.init must be an argv array when supplied in ${file}`);
}
if (profile.runtime !== undefined && (!profile.runtime || typeof profile.runtime !== 'object'
  || Array.isArray(profile.runtime))) {
  fail(`runtime must be an object when supplied in ${file}`);
}
if (action === 'detect') { console.log(file); process.exit(0); }
if (!['bootstrap', 'validate', 'dispatch', 'release', 'resume-authorized'].includes(action)) fail(`unknown action: ${action}`);

function run(command, args = [], capture = false) {
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) fail(`could not execute profile command: ${result.error.message}`, 2);
  return result;
}

function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function validatedReport(purpose) {
  const result = run(profile.commands.validate, [], true);
  if (result.status !== 0) {
    emit(result);
    fail(`commands.validate did not pass; ${purpose} is not authorized.`, result.status || 2);
  }
  let report;
  try { report = JSON.parse(result.stdout); } catch { fail('commands.validate must emit one JSON readiness report.', 2); }
  if (report?.ok !== true) fail(`commands.validate did not report ok:true; ${purpose} is not authorized.`, 12);
  // Before production readiness, the project must explicitly report structural
  // or bootstrap readiness rather than silently treating a false global bit as
  // permission. `dispatchReady` remains an accepted stronger report.
  if (report.dispatchReady !== true && report.structuralReady !== true && report.bootstrapReady !== true) {
    fail(`commands.validate did not prove structural or bootstrap readiness; ${purpose} is not authorized.`, 12);
  }
  return { result, report };
}

function statePath() { return resolve(root, profile.documents.state); }

if (action === 'bootstrap') {
  if (!existsSync(statePath())) {
    if (!profile.commands.init) fail(`canonical state is absent at ${profile.documents.state}, but profile supplies no commands.init.`, 2);
    const init = run(profile.commands.init, forwarded);
    if (init.status !== 0) process.exit(typeof init.status === 'number' ? init.status : 2);
  }
  const { result } = validatedReport('bootstrap');
  emit(result);
  process.exit(0);
}

if (action === 'validate') {
  const { result } = validatedReport('validation');
  emit(result);
  process.exit(0);
}

if (action === 'resume-authorized') {
  const { result, report } = validatedReport('saved resume');
  if (report.savedResumeAuthorized !== true) {
    fail('profile did not provide an explicit current savedResumeAuthorized:true binding; normal GATE 0 remains required.', 12);
  }
  emit(result);
  process.exit(0);
}

if (action === 'dispatch') {
  // A production-ready report is not a universal precondition: a profile may
  // ask its own checker about one exact bootstrap/audit/route task. The packet
  // sees untouched positional args and flags, decides that narrow exception,
  // and remains the only reservation/counter writer.
  validatedReport('dispatch');
  const result = run(profile.commands.dispatch, forwarded);
  process.exit(typeof result.status === 'number' ? result.status : 2);
}

const result = run(profile.commands.release, forwarded);
process.exit(typeof result.status === 'number' ? result.status : 2);
