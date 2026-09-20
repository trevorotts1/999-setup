#!/usr/bin/env node
//=============================================================================
// watch-tick.mjs — the Node twin of tools/watch-tick.sh
//=============================================================================
//
// WHY A TWIN EXISTS
//   Git Bash is a hard prerequisite on Windows, but a PowerShell-only machine
//   is the case where the client is told the least and protected the worst:
//   without bash there is no ledger, no reconcile, no measured width and no
//   tick, and nothing says so out loud. Node is guaranteed wherever Claude
//   Code runs, so the enforcement kit is ported here (references/platform.md;
//   the shared-helper convention this repo already uses for scripts/common/).
//
//   This file is a PORT, not a second opinion. Same counts, same S-checks,
//   same ACTION verbs, same `S-CHECK` line, same exit-code contract as
//   tools/watch-tick.sh — which stays the reference implementation and the
//   one the crontab line names. Where the two could differ they must not:
//   `--selftest` runs the same ten fixtures here, so a drift between the twins
//   fails a test rather than passing quietly.
//
// WHAT IS DIFFERENT, HONESTLY
//   - The reconcile is still tools/anchor.sh, run through bash. Where bash is
//     absent the tick records `anchor=undetermined(no bash …)` and says so in
//     the line's `undetermined=` field. It never reports a reconcile it did
//     not run.
//   - The ledger write prefers tools/ledger.sh — the locked, atomic, verified
//     primitive — and only falls back to an equivalent lock-directory +
//     temp-file + rename write of its own where bash cannot be reached.
//
// USAGE
//   node scripts/common/watch-tick.mjs <project-home>
//   node scripts/common/watch-tick.mjs <project-home> --cron-line
//   node scripts/common/watch-tick.mjs --selftest
//
// EXIT-CODE CONTRACT (identical to tools/watch-tick.sh)
//   0 clean · 2 TOOLING FAILURE / BROKEN INSTRUMENT · 3 violations
//   4 CONTROL/TERMINAL-DRIFT.flag exists
//=============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));          // scripts/common
const SKILL_ROOT = path.resolve(HERE, '..', '..');                  // the skill root
const TOOLS = path.join(SKILL_ROOT, 'tools');
const ANCHOR_SH = path.join(TOOLS, 'anchor.sh');
const LEDGER_SH = path.join(TOOLS, 'ledger.sh');

const STALE_MIN = intEnv('WATCH_STALE_MIN', 10);
const MERGE_STALE_MIN = intEnv('WATCH_MERGE_STALE_MIN', 20);
const BREAK_LABEL = process.env.WATCH_TICK_SELFTEST_BREAK_LABEL === '1';

function intEnv(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  if (!/^[0-9]+$/.test(v)) dieTool(`${name} must be a non-negative integer (got: ${v})`);
  return Number(v);
}

//-----------------------------------------------------------------------------
// Failure primitives. A tooling failure is LOUD and is never a verdict.
//-----------------------------------------------------------------------------
function dieTool(msg) {
  process.stderr.write(`watch-tick.mjs: TOOLING FAILURE (exit 2): ${msg}\n`);
  process.stderr.write('watch-tick.mjs: this is NOT an all-clear. Nothing about the swarm was determined.\n');
  process.exit(2);
}
function dieInstrument(msg) {
  process.stderr.write(`watch-tick.mjs: BROKEN INSTRUMENT (exit 2): ${msg}\n`);
  process.stderr.write('watch-tick.mjs: the detector failed its own control, so it may not report "clean".\n');
  process.stderr.write('watch-tick.mjs: BROKEN INSTRUMENT is never ALL CLEAR.\n');
  process.exit(2);
}

//-----------------------------------------------------------------------------
// Helpers.
//-----------------------------------------------------------------------------
const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const epochNow = () => Math.floor(Date.now() / 1000);

function isoToEpoch(ts) {                 // returns a number, or null (UNDETERMINED)
  if (!ts) return null;
  const m = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.exec(ts.trim());
  if (!m) return null;
  const v = Date.parse(ts.trim().replace(' ', 'T').replace(/Z?$/, 'Z'));
  return Number.isFinite(v) ? Math.floor(v / 1000) : null;
}
const sanitize = (s) => String(s).replace(/[\r\n]/g, '').replace(/\|/g, '/').slice(0, 160);
// The `undetermined=` field is the one place a truncation would be a LIE, so it
// gets its own budget (see the bash twin's sanitize_long).
const sanitizeLong = (s) => String(s).replace(/[\r\n]/g, '').replace(/\|/g, '/').slice(0, 600);
const trim = (s) => String(s == null ? '' : s).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

function readLines(p) {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch { return null; }
}

//-----------------------------------------------------------------------------
// THE DETECTOR. Same rules as the bash twin: the multiplication sign the
// research-row format uses is normalised to `x` first, a bracket with no count
// is NOT a label (the trap), and a bare word with no bracket is not one either.
//-----------------------------------------------------------------------------
const LABEL_RE = /^\[[ \t]*[^\]\s][^\]]*[ \t][xX][0-9]+[ \t]*\]$/;
function labelOk(s) {
  if (BREAK_LABEL) return true;
  const norm = String(s || '').replace(/×/g, 'x');
  const groups = norm.match(/\[[^\]]*\]/g) || [];
  return groups.some((g) => LABEL_RE.test(g));
}

function unitOf(line, fallback) {
  const m = /(^|[ \t|])unit=([^ \t|]+)/.exec(line);
  if (m) return trim(m[2]);
  return trim(fallback).split(/[ \t]/)[0] || '';
}

const ROW_RE = /^[ \t]*(- )?\d{4}-\d{2}-\d{2}/;

function parseRows(text) {
  // Keyed by unit + stage; the LATEST row wins, so a post-reconciliation
  // re-dispatch replaces a proven-absent worker's row instead of counting twice.
  const order = [];
  const rec = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!ROW_RE.test(line)) continue;
    const f = line.split('|');
    const ts = trim(f[0] || '').replace(/^-[ \t]*/, '');
    const item = f.length >= 2 ? f[1] : '';
    const stage = f.length >= 3 ? trim(f[2]) : '';
    const label = f.length >= 4 ? trim(f[3]) : '';
    const tree = f.length >= 5 ? trim(f[4]) : '';
    const unit = unitOf(line, item);
    if (!unit) continue;
    const key = `${unit}\t${stage}`;
    if (!rec.has(key)) order.push(key);
    rec.set(key, { unit, stage, labelOk: labelOk(label), tree, ts, label });
  }
  return order.map((k) => rec.get(k));
}

function parseChecklist(text) {
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/^[ \t]*[-*][ \t]*\[[ \t]*\]/.test(line)) continue;
    const rest = line.replace(/^[ \t]*[-*][ \t]*\[[ \t]*\][ \t]*/, '');
    const u = unitOf(line, rest);
    if (u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

function parseResults(text) {
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/\|[ \t]*RESULT[ \t]*\|/.test(line)) continue;
    const m = /(^|[ \t|])unit=([^ \t|]+)/.exec(line);
    if (m) seen.add(trim(m[2]));
  }
  return seen;
}

function parseHeartbeat(text) {
  const byUnit = new Map();
  const byLabel = new Map();
  let unparsed = 0;
  for (const line of text.split(/\r?\n/)) {
    const f = line.split('|');
    if (f.length < 2) continue;
    const ts = trim(f[0]).replace(/^-[ \t]*/, '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(ts)) continue;
    const agent = trim(f[1]);
    const item = f.length >= 3 ? f[2] : '';
    const unit = unitOf(line, item);
    const ep = isoToEpoch(ts);
    if (ep === null) { unparsed += 1; continue; }
    if (unit && (!byUnit.has(unit) || byUnit.get(unit) < ep)) byUnit.set(unit, ep);
    if (agent && (!byLabel.has(agent) || byLabel.get(agent) < ep)) byLabel.set(agent, ep);
  }
  return { byUnit, byLabel, unparsed };
}

//-----------------------------------------------------------------------------
// THE SELF-PROOF. Same fixtures as the bash twin; a positive that MUST match,
// negatives that MUST NOT, and the bracket-with-no-count trap.
//-----------------------------------------------------------------------------
const FIX = [
  '2026-09-07T12:00:00Z | U-01 build | build | [opus x10] WF01 builder | run-abc',
  '2026-09-07T12:00:00Z | U-02 qc | qc | [sonnet ×4] WF02 judge | run-def',
  '2026-09-07T12:00:00Z | U-03 build | build | WF03 builder | run-ghi',
  '2026-09-07T12:00:00Z | U-04 build | build | [WF04 builder] | run-jkl',
  '# Dispatch log — one line written BEFORE each agent fires',
];

function selfProve() {
  const rows = parseRows(FIX.join('\n'));
  if (rows.length !== 4) {
    dieInstrument(`the row parser returned ${rows.length} rows for a fixture of 4 rows + 1 header — it is either eating rows or parsing prose as a dispatch`);
  }
  const at = (u) => rows.find((r) => r.unit === u);
  if (!at('U-01') || at('U-01').stage !== 'build' || at('U-01').labelOk !== true) {
    dieInstrument(`the POSITIVE control failed: '${FIX[0]}' did not parse as unit=U-01 stage=build with a valid [<model> x<N>] label`);
  }
  if (!at('U-02') || at('U-02').labelOk !== true) {
    dieInstrument(`the POSITIVE control failed: the multiplication-sign label in '${FIX[1]}' was not accepted (the research-row format in SKILL.md writes [<model> ×1])`);
  }
  if (!at('U-03') || at('U-03').labelOk !== false) {
    dieInstrument(`the NEGATIVE control failed: '${FIX[2]}' has no bracketed label and was accepted anyway`);
  }
  if (!at('U-04') || at('U-04').labelOk !== false) {
    dieInstrument(`the NEGATIVE control failed (THE TRAP): '${FIX[3]}' is a bracket with no count and was accepted as a [<model> x<N>] label`);
  }
}

//-----------------------------------------------------------------------------
// THE WRITE. tools/ledger.sh first — locked, atomic, verified. Only where bash
// cannot be reached does this file write the line itself, with the same
// lock-then-rename shape, so the fallback is never the silent one.
//-----------------------------------------------------------------------------
function haveBash() {
  const r = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

function ledgerWrite(home, relFile, line) {
  if (fs.existsSync(LEDGER_SH) && haveBash()) {
    const r = spawnSync('bash', [LEDGER_SH, home, relFile, line], { encoding: 'utf8' });
    if (r.error) dieTool(`could not run tools/ledger.sh: ${r.error.message}`);
    if (r.status !== 0) dieTool(`ledger.sh failed (rc=${r.status}) writing ${relFile}: ${(r.stderr || r.stdout || '').trim()}`);
    return 'ledger.sh';
  }
  // Fallback: mkdir is atomic on every filesystem Node runs on, so exactly one
  // writer holds the lock; the temp file + rename is what keeps the write
  // crash-safe. Same contract as tools/ledger.sh, minus the parts only bash
  // needs (the iCloud pin, the CLAIM intents window — this file writes neither).
  const target = path.join(home, relFile);
  const lockDir = `${target}.lock.d`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const deadline = Date.now() + 45000;
  let held = false;
  while (Date.now() < deadline) {
    try { fs.mkdirSync(lockDir); held = true; break; } catch { /* contended */ }
    try {
      const age = (Date.now() - fs.statSync(lockDir).mtimeMs) / 1000;
      if (age > 60) { fs.rmSync(lockDir, { recursive: true, force: true }); continue; }
    } catch { /* the owner released it in the race window — never staleness */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 + Math.floor(Math.random() * 150));
  }
  if (!held) dieTool(`could not acquire ${lockDir} within 45s. Refusing to write ${target} unlocked — that is exactly the lost-line bug the lock exists to close.`);
  try {
    const tmp = `${target}.tmp.${process.pid}`;
    const prior = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    fs.writeFileSync(tmp, prior + (prior && !prior.endsWith('\n') ? '\n' : '') + line + '\n');
    fs.renameSync(tmp, target);
    const after = fs.readFileSync(target, 'utf8').split(/\r?\n/).filter((l) => l !== '');
    if (after[after.length - 1] !== line) {
      dieTool(`ledger write verification failed — the last line of ${target} is not the line just written`);
    }
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
  return 'internal(no bash — tools/ledger.sh unreachable)';
}

//-----------------------------------------------------------------------------
// THE TICK.
//-----------------------------------------------------------------------------
function cronLine(home) {
  return `*/5 * * * * bash ${TOOLS}/watch-tick.sh ${home} >> ${home}/CONTROL/watch-tick.log 2>&1`;
}

function runTick(homeArg, wantCronLine) {
  if (!homeArg) dieTool('no project home given. Usage: watch-tick.mjs <project-home> [--cron-line]');
  if (!fs.existsSync(homeArg) || !fs.statSync(homeArg).isDirectory()) {
    dieTool(`project home does not exist: ${homeArg}`);
  }
  const home = fs.realpathSync(homeArg);
  if (wantCronLine) { process.stdout.write(`${cronLine(home)}\n`); return 0; }

  selfProve();

  const CHK = path.join(home, 'CONTROL', 'CHECKLIST.md');
  const DL = path.join(home, 'CONTROL', 'dispatch-log.md');
  const LED = path.join(home, 'CONTROL', 'LEDGER.md');
  const HB = path.join(home, 'CONTROL', 'HEARTBEAT.md');
  const FLAG = path.join(home, 'CONTROL', 'TERMINAL-DRIFT.flag');
  const CAPLED = path.join(home, 'CAPACITY-LEDGER.md');

  const undetermined = [];
  const addUndet = (s) => undetermined.push(s);

  // --- (1) the reconcile, always first
  let anchorNote = '';
  let anchorRc = 0;
  if (process.env.WATCH_SKIP_ANCHOR === '1') {
    anchorNote = 'skipped(WATCH_SKIP_ANCHOR)';
  } else if (!fs.existsSync(ANCHOR_SH)) {
    dieTool(`tools/anchor.sh is missing at ${ANCHOR_SH} — the tick reconciles before it counts`);
  } else if (!haveBash()) {
    anchorNote = 'undetermined(no bash on this machine — anchor.sh could not run)';
    addUndet('anchor=undetermined(no bash: the reconcile half of this tick was NOT run and is NOT claimed)');
  } else {
    const args = [ANCHOR_SH, home, 'IDLE', '--mode', 'reconcile'];
    const opt = (rel, flag) => {
      const p = path.join(home, 'CONTROL', rel);
      if (fs.existsSync(p)) args.push(flag, p);
    };
    opt('task-graph-snapshot.json', '--tasks');
    opt('project_state.json', '--state');
    opt('last-intents.txt', '--intents');
    const r = spawnSync('bash', args, { encoding: 'utf8' });
    if (r.error) dieTool(`could not run tools/anchor.sh: ${r.error.message}`);
    anchorRc = r.status;
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (anchorRc === 0) anchorNote = 'reconcile-clean';
    else if (anchorRc === 3) anchorNote = 'reconcile-drift(exit 3)';
    else if (anchorRc === 4) anchorNote = 'terminal-drift(exit 4)';
    else {
      process.stderr.write(out);
      dieTool(`anchor.sh exited ${anchorRc} (BROKEN INSTRUMENT or TOOLING FAILURE) — the reconcile did not complete, so no S-check verdict is claimed`);
    }
    process.stdout.write(out.endsWith('\n') || out === '' ? out : `${out}\n`);
  }

  // The stop gate, read AFTER the reconcile: anchor.sh clears the flag itself
  // when a fresh session has named the blocker on CONTROL/TODO.md.
  if (anchorRc === 4 || fs.existsSync(FLAG)) {
    process.stdout.write(`TERMINAL-DRIFT | flag present: ${FLAG}\n`);
    process.stdout.write(`TERMINAL-DRIFT | the tick counts nothing and writes no S-CHECK line while this file exists — the flag IS the state. Name the blocker in ${home}/CONTROL/TODO.md as a row starting "- [x] BLOCKER-NAMED | <the blocker> | session=<this session>" and the next tick clears it.\n`);
    return 4;
  }

  if (!fs.existsSync(CHK)) {
    dieTool(`CONTROL/CHECKLIST.md is missing at ${CHK} — the runnable count has no source. Checked: ${CHK}. Not checked: the dispatch log and the heartbeat, because the run stopped here.`);
  }

  // --- (2) the three counts
  const ledText = fs.existsSync(LED) ? fs.readFileSync(LED, 'utf8') : '';
  const results = parseResults(ledText);

  let rows = [];
  let dlProven = true;
  if (fs.existsSync(DL)) {
    const dlText = fs.readFileSync(DL, 'utf8');
    rows = parseRows(dlText);
    if (rows.length === 0) {
      const lines = dlText.split(/\r?\n/);
      const content = lines.filter((l) => /\S/.test(l) && !/^[ \t]*(#|-{3,}|\|)/.test(l)).length;
      if (content > 0) {
        dlProven = false;
        addUndet('open=undetermined(dispatch-log-unparseable: CONTROL/dispatch-log.md has content but no timestamped row)');
      }
    }
  } else {
    dlProven = false;
    addUndet('open=undetermined(no-dispatch-log: CONTROL/dispatch-log.md does not exist — an absent log is not a census of zero)');
  }

  const openRows = rows.filter((r) => !results.has(r.unit));
  const closedRows = rows.filter((r) => results.has(r.unit));
  const OPEN = openRows.length;

  const openUnits = new Set(openRows.map((r) => r.unit));
  const boxes = parseChecklist(fs.readFileSync(CHK, 'utf8'));
  const runnable = boxes.filter((u) => !openUnits.has(u));
  const RUNNABLE = runnable.length;

  const treeIds = new Set(openRows.map((r) => r.tree).filter((t) => t !== ''));
  const TREES = treeIds.size;
  const unkeyed = openRows.filter((r) => r.tree === '').length;
  let treeNote = String(TREES);
  if (unkeyed > 0) {
    treeNote = `${TREES}(+${unkeyed} rows with no run id)`;
    addUndet(`trees=partial(${unkeyed} open rows carry no run id, so they are in no tree)`);
  }

  // --- the width, for S5
  let cap = null;
  let capNote = '';
  if (process.env.WATCH_CLIENT_CAP) {
    if (!/^[0-9]+$/.test(process.env.WATCH_CLIENT_CAP)) dieTool(`WATCH_CLIENT_CAP must be a non-negative integer (got: ${process.env.WATCH_CLIENT_CAP})`);
    cap = Number(process.env.WATCH_CLIENT_CAP);
    capNote = `${cap}[env WATCH_CLIENT_CAP]`;
  } else if (fs.existsSync(CAPLED)) {
    const t = fs.readFileSync(CAPLED, 'utf8');
    let m = /CLIENT_CAP[ \t]*=[ \t]*(\d+)/.exec(t);
    if (!m) m = /clientCap[^=\n]*=[^=\n]*=[ \t]*(\d+)/.exec(t);
    if (m) { cap = Number(m[1]); capNote = `${cap}[CAPACITY-LEDGER.md]`; }
    else {
      capNote = 'undetermined(CAPACITY-LEDGER.md present but carries no CLIENT_CAP= or clientCap … = <n> value)';
      addUndet('S5=undetermined(no width in CAPACITY-LEDGER.md)');
    }
  } else {
    capNote = 'undetermined(no CAPACITY-LEDGER.md — an absent ledger is not a width of zero)';
    addUndet('S5=undetermined(no CAPACITY-LEDGER.md)');
  }

  // --- (3) the heartbeat map
  const hb = fs.existsSync(HB) ? parseHeartbeat(fs.readFileSync(HB, 'utf8')) : { byUnit: new Map(), byLabel: new Map(), unparsed: 0 };
  if (hb.unparsed > 0) {
    addUndet(`heartbeat=partial(${hb.unparsed} lines in CONTROL/HEARTBEAT.md carry a timestamp this tick cannot parse; those rows' ages are UNDETERMINED and neither S6 nor S13 fires on them)`);
  }
  const hbEpochFor = (unit, label) => {
    if (hb.byUnit.has(unit)) return hb.byUnit.get(unit);
    if (label && hb.byLabel.has(label)) return hb.byLabel.get(label);
    return null;
  };
  const staleMinFor = (stage) => (/merge/i.test(stage || '') ? MERGE_STALE_MIN : STALE_MIN);

  // --- (4) the S-checks
  const actions = [];
  const verbs = [];
  const emit = (verb, target, evidence) => {
    actions.push(`ACTION|${verb}|${sanitize(target)}|${sanitize(evidence)}`);
    if (!verbs.includes(verb)) verbs.push(verb);
  };

  let V = 0;
  if (anchorRc === 3) { V += 1; verbs.push('anchor-drift'); }

  // S2 — only on a PROVEN zero.
  if (RUNNABLE > 0 && OPEN === 0 && dlProven) {
    emit('dispatch-now', runnable.slice(0, 3).join(' '),
      `S2 zero-workflow: runnable=${RUNNABLE} open=0 — runnable work with no open dispatch row is an EMERGENCY; dispatch every runnable unit in the SAME turn (SKILL.md RULE 5 S2)`);
  }

  // S3 — the visible [<model> x<N>] label.
  for (const r of openRows) {
    if (!r.labelOk) {
      emit('relabel-and-redispatch', r.unit,
        `S3 label: the open row for unit=${r.unit} stage=${r.stage} carries no [<model> x<N>] label (label field: '${r.label || '<empty>'}') — the operator cannot see how wide this tree is; kill it and re-launch with the prefix (SKILL.md RULE 5 S3)`);
    }
  }

  // S5 — no capacity idle while dispatchable work exists.
  if (cap !== null && RUNNABLE > 0 && TREES > 0) {
    const room = cap * TREES;
    if (OPEN < room) {
      emit('widen', `${TREES} tree(s)`,
        `S5 idle capacity: open=${OPEN} < CLIENT_CAP ${cap} x trees ${TREES} = ${room} while runnable=${RUNNABLE} — widen the running trees or launch another one; never under-dispatch (SKILL.md RULE 5 S5)`);
    }
  }

  const now = epochNow();

  // S6 — heartbeat freshness. A row with no heartbeat at all is judged by its
  // own dispatch timestamp (loops.md Loop 5's trap: an agent that died before
  // its first stamp leaves no line).
  for (const r of openRows) {
    const thr = staleMinFor(r.stage);
    let ep = hbEpochFor(r.unit, r.label);
    let src = 'heartbeat';
    if (ep === null) {
      ep = isoToEpoch(r.ts);
      src = 'dispatch row (no heartbeat line — identity must be reconciled)';
    }
    if (ep === null) {
      addUndet(`S6=undetermined(unit=${r.unit}: neither a parseable heartbeat nor a parseable dispatch timestamp '${r.ts}')`);
      continue;
    }
    const age = Math.floor((now - ep) / 60);
    if (age > thr) {
      emit('reconcile-native-identity', r.unit,
        `S6 stale: unit=${r.unit} stage=${r.stage} last stamped ${age} min ago by its ${src}, past the ${thr}-minute threshold — stale is identity-unverified, not dead. Reconcile actual Workflow/session/run or Agent-Team identity through the host driver: proven absent → retire and re-dispatch; proven live → retain; unknown → escalate without replacement (SKILL.md RULE 5 S6).`);
    }
  }

  // S13 — finished but alive.
  for (const r of closedRows) {
    const thr = staleMinFor(r.stage);
    const ep = hbEpochFor(r.unit, r.label);
    if (ep === null) continue;
    const age = Math.floor((now - ep) / 60);
    if (age <= thr) {
      emit('reconcile-native-identity', r.unit,
        `S13 finished-but-alive: unit=${r.unit} has a RESULT line on CONTROL/LEDGER.md and its heartbeat is still fresh (${age} min old, threshold ${thr}) — reconcile the matching Workflow/session/run or Agent-Team identity before any TaskStop; unknown identity is retained and escalated (SKILL.md RULE 5 S13)`);
    }
  }

  V += actions.length;

  // --- (5) the line
  if (actions.length) process.stdout.write(`${actions.join('\n')}\n`);
  const line = `${isoNow()} | S-CHECK | violations=${V} | runnable=${RUNNABLE} open=${OPEN} trees=${TREES}`
    + ` | cap=${capNote} | anchor=${anchorNote} | trees-detail=${treeNote}`
    + ` | actions=${sanitize(verbs.length ? verbs.join(',') : 'none')}`
    + ` | undetermined=${sanitizeLong(undetermined.length ? undetermined.join(',') : 'none')}`;
  ledgerWrite(home, path.join('CONTROL', 'LEDGER.md'), line);
  process.stdout.write(`${line}\n`);

  return V > 0 ? 3 : 0;
}

//=============================================================================
// SELFTEST — the same ten fixtures as tools/watch-tick.sh, so a drift between
// the twins fails a test instead of passing quietly.
//=============================================================================
function selftest() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-tick-mjs-selftest-'));
  let passes = 0;
  let fails = 0;
  const report = (n, name, ok, detail) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} | case ${n} | ${name} | ${detail}\n`);
    if (ok) passes += 1; else fails += 1;
  };
  const mkHome = (name) => {
    const d = path.join(T, name);
    fs.mkdirSync(path.join(d, 'SPEC'), { recursive: true });
    fs.mkdirSync(path.join(d, 'CONTROL'), { recursive: true });
    fs.writeFileSync(path.join(d, 'SPEC', 'GOAL.md'), 'Goal: build the thing.\n');
    fs.writeFileSync(path.join(d, 'CONTROL', 'CHECKLIST.md'), '- [x] U-01 build the parser\n- [ ] U-02 qc the parser\n');
    fs.writeFileSync(path.join(d, 'CONTROL', 'TODO.md'), '- [ ] U-02 qc the parser\n');
    return d;
  };
  const stamp = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const w = (d, rel, text) => fs.writeFileSync(path.join(d, rel), text);
  const run = (args, env = {}) => {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args],
      { encoding: 'utf8', env: { ...process.env, ...env } });
    return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const led = (d) => { try { return fs.readFileSync(path.join(d, 'CONTROL', 'LEDGER.md'), 'utf8'); } catch { return ''; } };

  // 1 — S2
  let d = mkHome('c1');
  w(d, 'CONTROL/CHECKLIST.md', '- [ ] U-01 build the parser\n- [ ] U-02 qc the parser\n');
  w(d, 'CONTROL/dispatch-log.md', '# Dispatch log\n');
  let r = run([d]);
  report(1, 'S2-dispatch-now',
    r.rc === 3 && /^ACTION\|dispatch-now\|/m.test(r.out) && /runnable=2 open=0 trees=0/.test(r.out) && /S-CHECK \| violations=1/.test(led(d)),
    `rc=${r.rc} (want 3); ACTION|dispatch-now emitted; runnable=2 open=0 trees=0`);

  // 2 — S3
  d = mkHome('c2');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(1)} | U-02 qc | qc | WF01 judge | run-002\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 judge | U-02 | qc\n`);
  r = run([d]);
  report(2, 'S3-unlabelled-row',
    r.rc === 3 && /^ACTION\|relabel-and-redispatch\|U-02\|/m.test(r.out) && /runnable=0 open=1 trees=1/.test(r.out) && !/^ACTION\|reap/m.test(r.out),
    `rc=${r.rc} (want 3); ACTION|relabel-and-redispatch for U-02; no reap (the row is fresh — S3 fired alone)`);

  // 3 — S6
  d = mkHome('c3');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(12)} | U-02 qc | qc | [sonnet x4] WF01 judge | run-003\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(11)} | WF01 judge | U-02 | qc\n`);
  r = run([d]);
  report(3, 'S6-stale-heartbeat',
    r.rc === 3 && /^ACTION\|reconcile-native-identity\|U-02\|/m.test(r.out) && /S6 stale/.test(r.out) && !/^ACTION\|relabel-and-redispatch/m.test(r.out),
    `rc=${r.rc} (want 3); reconcile-native-identity at 11 min > 10; stale evidence alone cannot kill or replace a worker`);

  // 4 — clean
  d = mkHome('c4');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(1)} | U-02 qc | qc | [opus x10] WF01 judge | run-004\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 judge | U-02 | qc\n`);
  r = run([d]);
  const n4 = (led(d).match(/S-CHECK \| violations=0 \| runnable=0 open=1 trees=1/g) || []).length;
  report(4, 'clean',
    r.rc === 0 && n4 === 1 && !/^ACTION\|/m.test(r.out),
    `rc=${r.rc} (want 0); exactly ${n4} 'S-CHECK | violations=0 | runnable=0 open=1 trees=1' line (want 1); no ACTION line`);

  // 5 — the flag
  d = mkHome('c5');
  w(d, 'CONTROL/TERMINAL-DRIFT.flag', 'TERMINAL-DRIFT after 6 no-delta reconciles\n');
  r = run([d]);
  report(5, 'terminal-drift-flag',
    r.rc === 4 && /TERMINAL-DRIFT/.test(r.out) && !/S-CHECK/.test(led(d)),
    `rc=${r.rc} (want 4); the flag was named; NO S-CHECK line written (the flag IS the state)`);

  // 6 — S13
  d = mkHome('c6');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(3)} | U-01 build | build | [opus x10] WF01 builder | run-006\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 builder | U-01 | build\n`);
  w(d, 'CONTROL/LEDGER.md', `${stamp(4)} | CLAIM | unit=U-01 | plan=build the parser\n${stamp(2)} | RESULT | unit=U-01 | verdict=PASS\n`);
  r = run([d]);
  report(6, 'S13-finished-but-alive',
    r.rc === 3 && /^ACTION\|reconcile-native-identity\|U-01\|/m.test(r.out) && /S13 finished-but-alive/.test(r.out),
    `rc=${r.rc} (want 3); ACTION|reconcile-native-identity for U-01 — RESULT on the ledger, heartbeat still fresh`);

  // 7 — S5
  d = mkHome('c7');
  w(d, 'CONTROL/CHECKLIST.md', '- [ ] U-02 qc\n- [ ] U-03 build\n- [ ] U-04 build\n- [ ] U-05 build\n');
  w(d, 'CAPACITY-LEDGER.md', 'clientCap = max(2, min(harness_cap, ram_cap)) = 10   [MEASURED sysctl-hw.ncpu 2026-09-07T00:00:00Z]\n');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(1)} | U-02 qc | qc | [opus x10] WF01 judge | run-007\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 judge | U-02 | qc\n`);
  r = run([d]);
  report(7, 'S5-widen',
    r.rc === 3 && /^ACTION\|widen\|/m.test(r.out) && /CLIENT_CAP 10 x trees 1 = 10/.test(r.out) && /cap=10\[CAPACITY-LEDGER\.md\]/.test(r.out),
    `rc=${r.rc} (want 3); ACTION|widen with open=1 < 10 x 1 while runnable=3; the width was READ, never assumed`);

  // 8 — broken instrument
  d = mkHome('c8');
  r = run([d], { WATCH_TICK_SELFTEST_BREAK_LABEL: '1' });
  report(8, 'broken-instrument',
    r.rc === 2 && /BROKEN INSTRUMENT/.test(r.out) && /NEGATIVE control failed/.test(r.out),
    `rc=${r.rc} (want 2); named BROKEN INSTRUMENT and refused to report clean`);

  // 9 — missing project
  r = run([path.join(T, 'does-not-exist')]);
  report(9, 'missing-project',
    r.rc === 2 && /does-not-exist/.test(r.out),
    `rc=${r.rc} (want 2); the message NAMES the path it checked`);

  // 10 — undetermined is not a violation
  d = mkHome('c10');
  w(d, 'CONTROL/CHECKLIST.md', '- [ ] U-02 qc the parser\n- [ ] U-03 build\n');
  r = run([d]);
  report(10, 'undetermined-not-violation',
    r.rc === 0 && !/^ACTION\|dispatch-now\|/m.test(r.out) && /no-dispatch-log/.test(r.out)
      && /S5=undetermined\(no CAPACITY-LEDGER\.md\)/.test(r.out) && /S-CHECK \| violations=0/.test(led(d)),
    `rc=${r.rc} (want 0); S2 did NOT fire on an absent dispatch log; the line names both undetermined counts`);

  fs.rmSync(T, { recursive: true, force: true });
  process.stdout.write(`\n-------------------------------------------------------------\n`);
  process.stdout.write(`watch-tick.mjs selftest: ${passes} passed, ${fails} failed\n`);
  return fails > 0 ? 1 : 0;
}

//=============================================================================
// ENTRY
//=============================================================================
const argv = process.argv.slice(2);
let home = '';
let wantCron = false;
let wantSelftest = false;
for (const a of argv) {
  if (a === '--selftest') wantSelftest = true;
  else if (a === '--cron-line') wantCron = true;
  else if (a === '-h' || a === '--help') {
    process.stdout.write('Usage: node scripts/common/watch-tick.mjs <project-home> [--cron-line] | --selftest\n');
    process.exit(0);
  } else if (a.startsWith('--')) dieTool(`unknown option: ${a}`);
  else if (!home) home = a;
  else dieTool(`unexpected argument: ${a}`);
}

process.exit(wantSelftest ? selftest() : runTick(home, wantCron));
