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
//   `--selftest` runs the same fixtures here, so a drift between the twins
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
// A PROFILED PROJECT REDIRECTS THIS TICK; IT NEVER SWITCHES IT OFF
//   references/project-profile.md: the five-minute tick is NEVER skipped, and
//   a profile redirects it rather than refusing it. A home holding
//   `.spec-protocol.json` logs beside its BOUND state
//   (`<home>/<dirname of documents.state>/watch-tick.log`, not CONTROL/), and the
//   tick runs the profile's own `commands.validate` argv at the project root —
//   spawned as argv with no shell, so a profile value can NAME a program and can
//   never be evaluated as one — printing exactly one line:
//     PROFILE-TICK | <ISO8601Z> | home=<home> | validate_rc=0 | <stdout, 200 chars>   -> 0
//     PROFILE-TICK STALL | <ISO8601Z> | home=<home> | validate_rc=<rc> | <stderr…>   -> 3
//   Then the batch merge when due (MERGE-BATCH), the optional commands.refresh
//   (PROFILE-REFRESH; logged, never fatal) and the post-interview stalled-turn
//   check with AUTO-RESUME, exactly as on a legacy project. It never creates
//   CONTROL/: records, locks and stamps live in <statedir>/spec-protocol/, and
//   ledger lines go through tools/ledger.sh to <statedir>/spec-protocol/LEDGER.md.
//   Unparseable JSON or a missing documents.state / commands.validate is exit 2
//   NAMING the file and the key, never a silent fall back to CONTROL/.
//   Identical to tools/watch-tick.sh (MERGE_BATCH_MINUTES, WATCH_MERGE_TRAIN_SH
//   and WATCH_REFRESH_TIMEOUT mean the same here).
//
// THE REPO SWEEPS (watch-tick.sh 4g) run every tick after the merge batch:
//   proof of merge re-checked on every MERGED/landed claim (MERGE-CLAIM-FALSE +
//   re-queue), merged worktrees and branches cleaned, stale unmerged ones
//   reported (STALE-UNMERGED + re-queue), and release claims proven from the
//   remote (MINT-CLAIM-FALSE). The git logic lives ONCE, in the bash twin:
//   this file runs `bash tools/watch-tick.sh <home> --sweep` and emits its
//   ACTION lines. No bash -> `sweeps=undetermined(no bash …)`, never a pass.
//
// USAGE
//   node scripts/common/watch-tick.mjs <project-home>
//   node scripts/common/watch-tick.mjs <project-home> --cron-line
//   node scripts/common/watch-tick.mjs <project-home> --arm     # Windows: schtasks, idempotent
//   node scripts/common/watch-tick.mjs <project-home> --check   # read-only, 0/3/2
//   node scripts/common/watch-tick.mjs <project-home> --record-session  # interview end: 0/2
//   node scripts/common/watch-tick.mjs --selftest
//   A stalled post-interview run auto-resumes (see AUTO-RESUME below).
//
// EXIT-CODE CONTRACT (identical to tools/watch-tick.sh)
//   0 clean · 2 TOOLING FAILURE / BROKEN INSTRUMENT · 3 violations
//   4 CONTROL/TERMINAL-DRIFT.flag exists
//=============================================================================

import { spawn, spawnSync } from 'node:child_process';
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
const MERGE_BATCH_MIN = intEnv('MERGE_BATCH_MINUTES', 10);
const REFRESH_TIMEOUT = intEnv('WATCH_REFRESH_TIMEOUT', 120);
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
// AUTO-RESUME (the port of tools/watch-tick.sh 4d, F1-F3) — so a machine with
// no Git Bash also resumes a hung run. Same file (CONTROL/auto-resume.txt),
// same 30-minute lock (CONTROL/auto-resume.lock), same command:
//   <launcher> -p --permission-mode bypassPermissions --resume <id> "/spec-protocol resume"
// The launcher is claude-nine when this session is routed (a .claude-nine
// config root on macOS; on Windows the launcher keeps the shared root and
// points ANTHROPIC_BASE_URL at the loopback router), else claude. It is
// resolved to an absolute path the way the shell does (PATH, plus PATHEXT on
// Windows), and on Windows the installed claude-nine.cmd under
// %LOCALAPPDATA%\BlackCEO\999\bin first — the path setup-windows.ps1 installs.
// WATCH_TICK_LAUNCHER_CMD replaces the launcher (selftest stub only).
//-----------------------------------------------------------------------------
const STALLED_MIN = intEnv('WATCH_STALLED_MIN', 15);
const IS_WIN = process.platform === 'win32';

function whichOnPath(name) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').concat(['']) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, name + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return '';
}

function resolveLauncher() {
  const cfg = process.env.CLAUDE_CONFIG_DIR || '';
  const routed = /\.claude-nine[\\/]?$/.test(cfg) || /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.ANTHROPIC_BASE_URL || '');
  const name = routed ? 'claude-nine' : 'claude';
  if (IS_WIN && name === 'claude-nine' && process.env.LOCALAPPDATA) {
    const inst = path.join(process.env.LOCALAPPDATA, 'BlackCEO', '999', 'bin', 'claude-nine.cmd');
    if (fs.existsSync(inst)) return { name, lpath: inst };
  }
  return { name, lpath: whichOnPath(name) || name };
}

// The folder the session was LAUNCHED in, from its own transcript — the
// conductor cd's into the project, and --resume looks the id up by launch folder.
function transcriptCwd(sid) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return ''; }
  for (const d of dirs) {
    const f = path.join(root, d, `${sid}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(0, 200)) {
      try { const j = JSON.parse(l); if (typeof j.cwd === 'string' && fs.existsSync(j.cwd)) return j.cwd; } catch { /* next */ }
    }
  }
  return '';
}

// THE STATE AREA: CONTROL/ on a legacy project; <statedir>/spec-protocol/ on a
// profiled one (statedir = the directory of documents.state). It holds the
// session record, the auto-resume lock and log, the batch stamp and lock and
// the refresh list, so a profiled project never grows a CONTROL/.
function bindPaths(home) {
  if (!isProfiled(home)) {
    return { area: path.join(home, 'CONTROL'), areaRel: 'CONTROL', stateDir: '', stateJson: path.join(home, 'CONTROL', 'project_state.json') };
  }
  const st = profileValues(home, 'state');
  const d = path.dirname(st);
  const areaRel = (d === '' || d === '.') ? 'spec-protocol' : `${d}/spec-protocol`;
  return { area: path.join(home, areaRel), areaRel, stateDir: path.join(home, d), stateJson: path.join(home, st) };
}

// Legacy: CONTROL/LEDGER.md through ledgerWrite (fatal on failure, as always).
// Profiled: tools/ledger.sh lands CONTROL/LEDGER.md in <statedir>/spec-protocol/;
// a failure is NAMED on stdout and the tick goes on. With no bash, the line goes
// to <area>/LEDGER.md directly — never a CONTROL/ on a profiled project.
function tickLedger(home, line) {
  if (!isProfiled(home)) { ledgerWrite(home, path.join('CONTROL', 'LEDGER.md'), line); return; }
  if (fs.existsSync(LEDGER_SH) && haveBash()) {
    const r = spawnSync('bash', [LEDGER_SH, home, 'CONTROL/LEDGER.md', line], { encoding: 'utf8' });
    if (r.error || r.status !== 0) process.stdout.write(`LEDGER | not written (rc=${r.error ? 'spawn-error' : r.status}): ${sanitize((r.stderr || r.stdout || '').trim())}\n`);
    return;
  }
  const b = bindPaths(home);
  fs.mkdirSync(b.area, { recursive: true });
  fs.appendFileSync(path.join(b.area, 'LEDGER.md'), `${line}\n`);
}

function readRecord(home) {
  const rec = {};
  for (const l of readLines(path.join(bindPaths(home).area, 'auto-resume.txt')) || []) {
    const i = l.indexOf('=');
    if (i > 0) rec[l.slice(0, i)] = l.slice(i + 1);
  }
  return rec;
}

function recordSession(home, done) {
  const sid = process.env.CLAUDE_CODE_SESSION_ID || '';
  if (!sid) return false;
  const { name, lpath } = resolveLauncher();
  const cwd = transcriptCwd(sid) || process.cwd();
  const isDone = done || readRecord(home).interview === 'done';
  const b = bindPaths(home);
  fs.mkdirSync(b.area, { recursive: true });
  fs.writeFileSync(path.join(b.area, 'auto-resume.txt'),
    `session_id=${sid}\nlauncher=${name}\nlauncher_path=${lpath}\ncwd=${cwd}\n${isDone ? 'interview=done\n' : ''}`);
  process.stdout.write(`ARM | session recorded for auto-resume: ${b.areaRel}/auto-resume.txt (launcher=${name}${isDone ? ', interview=done' : ''})\n`);
  return true;
}

// A2 fix: some profiled states carry "status" instead of "run_status" -- read
// run_status first, and only fall back to status when run_status is absent.
const runStatusOf = (home) => {
  try {
    const txt = fs.readFileSync(bindPaths(home).stateJson, 'utf8');
    const m = /"run_status"\s*:\s*"([A-Za-z_]*)"/.exec(txt);
    if (m) return m[1];
    const m2 = /"status"\s*:\s*"([A-Za-z_]*)"/.exec(txt);
    return m2 ? m2[1] : '';
  } catch { return ''; }
};
// A2 fix: these values mean the project is waiting ON PURPOSE -- auto-resume
// must never fire for them, no matter how stale the session looks.
const TERMINAL_RUN_STATUSES = new Set(['RELEASE_COMPLETE', 'STOPPED_BY_OWNER', 'PAUSED_BLOCKED', 'PAUSED_CAP', 'STOPPED_CAP']);
const runStatusIsTerminal = (rs) => TERMINAL_RUN_STATUSES.has(String(rs || '').toUpperCase());

// Newest mtime under the project home, the state area and the ledger's
// sentinels excluded (the tick's own writes are not progress). A profiled
// project also excludes <statedir>/watch-tick.log and the files the last
// commands.refresh wrote. null when none was read.
function newestWriteEpoch(home) {
  let newest = null;
  const b = bindPaths(home);
  const skip = new Set((readLines(path.join(b.area, 'refresh-outputs.txt')) || []).filter((l) => l));
  if (b.stateDir) skip.add(path.join(b.stateDir, 'watch-tick.log'));
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== b.area && !e.name.endsWith('.lock.d')) walk(p); continue; }
      if (!e.isFile() || skip.has(p) || e.name === '.ledger-pinned' || e.name.endsWith('.lock') || e.name.includes('.tmp.')) continue;
      try { const t = Math.floor(fs.statSync(p).mtimeMs / 1000); if (newest === null || t > newest) newest = t; } catch { /* next */ }
    }
  };
  walk(home);
  return newest;
}

function autoResume(home, elapsed, phase) {
  const rec = readRecord(home);
  const b = bindPaths(home);
  const lock = path.join(b.area, 'auto-resume.lock');
  if (!rec.session_id) { process.stdout.write(`AUTO-RESUME | not run | no session recorded (${b.areaRel}/auto-resume.txt is written by --arm / --record-session inside the conductor session)\n`); return; }
  if (!/^[A-Za-z0-9-]+$/.test(rec.session_id)) { process.stdout.write('AUTO-RESUME | not run | the recorded session id is unusable\n'); return; }
  try {
    const age = Math.floor((Date.now() - fs.statSync(lock).mtimeMs) / 60000);
    if (age < 30) { process.stdout.write(`AUTO-RESUME | held | lock is ${age}m old (< 30m): no second launch\n`); return; }
  } catch { /* no lock yet */ }
  const cmd = process.env.WATCH_TICK_LAUNCHER_CMD || rec.launcher_path || rec.launcher || 'claude';
  const cwd = rec.cwd && fs.existsSync(rec.cwd) ? rec.cwd : home;
  // PATH is set HERE on the resumed process (the scheduled line stays PATH-free),
  // same as watch-tick.sh's resume_path: a scheduler's PATH is minimal, and the
  // launcher's children need node (9Router's cli is `#!/usr/bin/env node`),
  // claude (~/.local/bin) and the 999 npm bin. The node running this tick is
  // the surest node dir; missing dirs are skipped.
  const H = os.homedir();
  let nodePathRec = '';
  try { nodePathRec = fs.readFileSync(path.join(H, '.local', 'share', '999', 'node-path'), 'utf8').split(/\r?\n/)[0].trim(); } catch { /* none recorded */ }
  try { if (nodePathRec && fs.statSync(nodePathRec).isFile()) nodePathRec = path.dirname(nodePathRec); } catch { /* checked below */ }
  const pre = [
    ...(/[\\/]/.test(cmd) ? [path.dirname(cmd)] : []),
    path.dirname(process.execPath), nodePathRec,
    path.join(H, '.local', 'share', '999', 'node', 'current', 'bin'), path.join(H, '.local', 'bin'),
    path.join(process.env.NINE_ROUTER_NPM_PREFIX || path.join(H, '.local', 'share', '999', 'npm'), 'bin'),
    ...(IS_WIN ? [process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : ''] : ['/opt/homebrew/bin', '/usr/local/bin']),
  ].filter((d) => { try { return d && fs.statSync(d).isDirectory(); } catch { return false; } });
  const env = { ...process.env };
  env.PATH = [...pre, process.env.PATH || ''].join(path.delimiter);
  fs.writeFileSync(lock, '');
  const log = fs.openSync(path.join(b.area, 'auto-resume.log'), 'a');
  // bypassPermissions: the run is unattended, a permission prompt would stall it forever.
  const args = ['-p', '--permission-mode', 'bypassPermissions', '--resume', rec.session_id, '/spec-protocol resume'];
  // A .cmd/.bat cannot be spawned without a shell on Windows; the only
  // argument with a space is the fixed slash command, and the id is [A-Za-z0-9-].
  const viaShell = IS_WIN && /\.(cmd|bat)$/i.test(cmd);
  const child = viaShell
    ? spawn(`"${cmd}" -p --permission-mode bypassPermissions --resume ${rec.session_id} "/spec-protocol resume"`, { cwd, env, shell: true, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
    : spawn(cmd, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', () => { /* recorded in the log by the absence of output; the ledger line names the attempt */ });
  child.unref();
  tickLedger(home,
    `${isoNow()} | AUTO-RESUME | session=${rec.session_id} | launcher=${rec.launcher || 'claude'} | stalled ${elapsed}m in ${phase} — launched -p --permission-mode bypassPermissions --resume with /spec-protocol resume (log ${b.areaRel}/auto-resume.log)`);
  process.stdout.write(`AUTO-RESUME | launched | ${rec.launcher || 'claude'} -p --permission-mode bypassPermissions --resume ${rec.session_id} "/spec-protocol resume" (stalled ${elapsed}m in ${phase})\n`);
}

// The widened stall check (F2): build, or an open spec/apparatus/audit/merge/
// publish row, or interview=done (covers research and the pre-plan tick).
// Outside build it waits while run_status is anything but RUNNING.
// Returns { note, fired, alarm } — alarm is the ACTION evidence when fired.
function stallCheck(home, openRows) {
  let phase = '';
  for (const r of Array.isArray(openRows) ? openRows : []) {
    const s = String(r.stage || '').toLowerCase();
    if (s.includes('build')) { phase = 'build'; break; }
    if (!phase && /spec|apparatus|audit|merge|publish/.test(s)) phase = sanitize(s);
  }
  if (!phase && readRecord(home).interview === 'done') phase = openRows === 'profiled' ? 'post-interview(profiled)' : openRows === null ? 'post-interview(pre-plan)' : 'post-interview';
  const rs = runStatusOf(home);
  if (phase && runStatusIsTerminal(rs)) phase = '';
  else if (phase && phase !== 'build' && rs && rs !== 'RUNNING') phase = '';
  if (!phase) return { note: `undetermined(no running post-interview phase — run_status=${rs || '?'})`, fired: false };
  const newest = newestWriteEpoch(home);
  if (newest === null) return { note: 'undetermined(no readable file mtime under the project folder)', fired: false };
  const age = Math.floor((epochNow() - newest) / 60);
  if (age < STALLED_MIN) return { note: `ok(newest write ${age}m ago, ceiling ${STALLED_MIN}m)`, fired: false };
  tickLedger(home,
    `${isoNow()} | DRIFT-ALARM | stalled-turn | elapsed=${age} | phase=${phase} | ${sanitize(`no file write under the project folder for ${age} minutes in phase ${phase} (ceiling ${STALLED_MIN}m)`)}`);
  const alarm = `DRIFT-ALARM stalled-turn: newest file mtime under the project folder is ${age} minutes old (ceiling ${STALLED_MIN}) in phase ${phase} — the turn is hung, not slow (RC-17)`;
  autoResume(home, age, phase);
  return { note: `stalled(elapsed=${age}m)`, fired: true, age, alarm };
}

//-----------------------------------------------------------------------------
// THE TICK.
//-----------------------------------------------------------------------------
// A supplied project may bind its own canonical state and its own commands
// (references/project-profile.md). The profile is DATA, never script: JSON.parse
// reads it and nothing in it is ever evaluated.
const isProfiled = (home) => fs.existsSync(path.join(home, '.spec-protocol.json'));

function profileValues(home, key) {   // 'state' -> string; 'validate' -> string[]
  const pf = path.join(home, '.spec-protocol.json');
  let d;
  try { d = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch (e) {
    dieTool(`PROFILE | ${pf} is not parseable JSON: ${e.message}. Checked: that one file. UNDETERMINED — the tick claims nothing about this project.`);
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) dieTool(`PROFILE | ${pf}: the top level is not a JSON object`);
  if (key === 'state') {
    const v = (d.documents || {}).state;
    if (typeof v !== 'string' || v.trim() === '') {
      dieTool(`PROFILE | ${pf} carries no usable documents.state (a non-empty string is required; references/project-profile.md). The profiled tick logs BESIDE the bound state and has no honest path without it — UNDETERMINED, never CONTROL/watch-tick.log.`);
    }
    if (/[\r\n]/.test(v)) dieTool(`PROFILE | ${pf} documents.state carries a newline — refused`);
    return v.trim();
  }
  const v = (d.commands || {}).validate;
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x !== '')) {
    dieTool(`PROFILE | ${pf} carries no usable commands.validate (a non-empty argv array of non-empty strings is required; references/project-profile.md). The profiled tick has nothing to run — UNDETERMINED, never a legacy CONTROL/ reconcile in its place.`);
  }
  if (v.some((x) => /[\r\n]/.test(x))) dieTool(`PROFILE | ${pf} commands.validate carries a newline in a value — refused`);
  return v;
}

function cronLine(home) {
  // THE REDIRECT: a profiled project's tick logs beside its BOUND state, never
  // into a CONTROL/ the profile forbids. documents.state is the only source for
  // that folder; without it profileValues refuses rather than inventing CONTROL/.
  let log = 'CONTROL/watch-tick.log';
  if (isProfiled(home)) {
    const dir = path.dirname(profileValues(home, 'state'));
    log = (dir === '' || dir === '.') ? 'watch-tick.log' : `${dir}/watch-tick.log`;
  }
  // Every path is ONE single-quoted sh word ("My Project Folder"); a % is \%
  // because cron reads a bare % as a newline even inside quotes.
  const sq = (x) => `'${String(x).replace(/'/g, "'\\''").replace(/%/g, '\\%')}'`;
  return `*/5 * * * * bash ${sq(`${TOOLS}/watch-tick.sh`)} ${sq(home)} >> ${sq(`${home}/${log}`)} 2>&1`;
}

//-----------------------------------------------------------------------------
// THE BATCH MERGE CADENCE (watch-tick.sh 4e): every MERGE_BATCH_MINUTES the
// tick runs `tools/merge-train.sh <home> --batch` at the project root under a
// pid lock (<area>/merge-batch.lock.d), so two batches never overlap. The
// stamp (<area>/merge-batch.stamp) is touched when a batch starts. merge-train
// decides what is waiting. Logged, never fatal. Returns a note.
//-----------------------------------------------------------------------------
function mergeBatch(home) {
  const { area } = bindPaths(home);
  const stamp = path.join(area, 'merge-batch.stamp');
  const lock = path.join(area, 'merge-batch.lock.d');
  try {
    const age = Math.floor((Date.now() - fs.statSync(stamp).mtimeMs) / 60000);
    if (age < MERGE_BATCH_MIN) return `not-due(last batch ${age}m ago, every ${MERGE_BATCH_MIN}m)`;
  } catch { /* never ran: due */ }
  fs.mkdirSync(area, { recursive: true });
  try { fs.mkdirSync(lock); } catch {
    let pid = '';
    try { pid = fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim(); } catch { /* none */ }
    let alive = false;
    try { if (/^\d+$/.test(pid)) { process.kill(Number(pid), 0); alive = true; } } catch { /* gone */ }
    if (alive) { process.stdout.write(`MERGE-BATCH | held | a batch is still running (pid ${pid}); no second batch\n`); return `held(batch pid ${pid} still running)`; }
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); } catch { return 'held(lock taken by another tick)'; }
  }
  fs.writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`);
  fs.writeFileSync(stamp, '');
  const script = process.env.WATCH_MERGE_TRAIN_SH || path.join(TOOLS, 'merge-train.sh');
  let r;
  try {
    let direct = false;
    try { fs.accessSync(script, fs.constants.X_OK); direct = !IS_WIN; } catch { /* run through bash */ }
    r = direct ? spawnSync(script, [home, '--batch'], { cwd: home, encoding: 'utf8' })
      : haveBash() ? spawnSync('bash', [script, home, '--batch'], { cwd: home, encoding: 'utf8' })
        : { status: null, error: new Error('no bash on this machine — merge-train.sh could not run') };
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (out.trim()) process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  const last = r.error ? r.error.message : (out.split(/\r?\n/).filter((l) => l.trim()).pop() || 'no output');
  const rc = r.error ? 'undetermined' : r.status;
  process.stdout.write(`MERGE-BATCH | rc=${rc} | ${sanitize(last)}\n`);
  return `ran(rc=${rc}: ${sanitize(last)})`;
}

//-----------------------------------------------------------------------------
// THE PROFILE REFRESH (watch-tick.sh 4f): commands.refresh, when present, runs
// as argv at the project root on every tick with a WATCH_REFRESH_TIMEOUT
// ceiling; one PROFILE-REFRESH line; a failure is logged, never fatal. The
// files it wrote go to <area>/refresh-outputs.txt for the stall census.
//-----------------------------------------------------------------------------
//-----------------------------------------------------------------------------
// THE REPO SWEEPS (watch-tick.sh 4g), run through the bash twin's --sweep so
// the git logic exists once. Its own lines (MERGE-CLAIM-FALSE, STALE-UNMERGED,
// ORPHAN-CLEANED, MINT-CLAIM-FALSE, SWEEP) are echoed; its ACTION lines are
// returned for the caller to emit. Never fatal.
//-----------------------------------------------------------------------------
function sweeps(home) {
  if (!haveBash()) return { note: 'undetermined(no bash on this machine — the repo sweeps could not run)', acts: [], und: true };
  const r = spawnSync('bash', [path.join(TOOLS, 'watch-tick.sh'), home, '--sweep'], { encoding: 'utf8' });
  if (r.error) return { note: `undetermined(${sanitize(r.error.message)})`, acts: [], und: true };
  const lines = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).filter((l) => l.trim());
  const acts = [];
  let note = r.status === 2 ? 'undetermined(the sweep exited 2)' : 'not-run';
  for (const l of lines) {
    const m = /^ACTION\|([^|]*)\|([^|]*)\|(.*)$/.exec(l);
    if (m) { acts.push({ verb: m[1], target: m[2], evidence: m[3] }); continue; }
    const s = /^SWEEP \| (.*)$/.exec(l);
    if (s) note = s[1];
    process.stdout.write(`${l}\n`);
  }
  return { note, acts, und: /undetermined(\(|=[1-9])/.test(note) };
}

function runRefresh(home) {
  const pf = path.join(home, '.spec-protocol.json');
  let v;
  try { v = (JSON.parse(fs.readFileSync(pf, 'utf8')).commands || {}).refresh; } catch { return; }
  if (v === undefined || v === null) return;
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x !== '' && !/[\r\n]/.test(x))) {
    process.stdout.write(`PROFILE-REFRESH | not run | ${pf} commands.refresh is not a non-empty argv array of non-empty strings\n`);
    return;
  }
  const { area } = bindPaths(home);
  fs.mkdirSync(area, { recursive: true });
  const t0 = Date.now();
  const r = spawnSync(v[0], v.slice(1), { cwd: home, encoding: 'utf8', timeout: REFRESH_TIMEOUT * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  const rc = r.error ? (r.error.code === 'ETIMEDOUT' ? 124 : 127) : r.status;
  const wrote = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== area) walk(p); continue; }
      try { if (e.isFile() && fs.statSync(p).mtimeMs >= t0) wrote.push(p); } catch { /* next */ }
    }
  };
  walk(home);
  fs.writeFileSync(path.join(area, 'refresh-outputs.txt'), wrote.length ? `${wrote.join('\n')}\n` : '');
  const snip = snip200(r.error ? r.error.message : `${r.stdout || ''}${r.stderr || ''}`);
  process.stdout.write(rc === 0 ? `PROFILE-REFRESH | ${isoNow()} | rc=0 | ${snip}\n`
    : `PROFILE-REFRESH FAILED | ${isoNow()} | rc=${rc} | ${snip} (logged, not fatal)\n`);
}

//-----------------------------------------------------------------------------
// --arm / --check. Windows has no crontab: the five-minute tick is a Scheduled
// Task, `spec-protocol-tick-<slug>`, running THIS file with the project home.
// WATCH_TICK_SCHTASKS_CMD names the schtasks program (selftest stub only; it
// also forces this path off Windows so the stub can prove it). Anywhere else
// both flags hand off to tools/watch-tick.sh, the crontab reference.
//   --arm   0 armed, 3 already present (queried first), 2 unavailable
//   --check 0 installed, 3 not installed, 2 could not query
//-----------------------------------------------------------------------------
const SCHTASKS = process.env.WATCH_TICK_SCHTASKS_CMD || (process.platform === 'win32' ? 'schtasks' : '');

function taskName(home) {
  return `spec-protocol-tick-${path.basename(home).replace(/[^A-Za-z0-9-]/g, '-')}`;
}

function schtasksQuery(name) {    // 0 present, 3 absent, 2 could not run
  const r = spawnSync(SCHTASKS, ['/Query', '/TN', name], { encoding: 'utf8' });
  if (r.error) return 2;
  return r.status === 0 ? 0 : 3;
}

function armOrCheck(home, mode) {
  if (!SCHTASKS) {
    const r = spawnSync('bash', [path.join(TOOLS, 'watch-tick.sh'), ...(mode === 'arm' ? ['--arm', home] : [home, '--check'])], { stdio: 'inherit' });
    if (r.error) dieTool(`could not run tools/watch-tick.sh for --${mode}: ${r.error.message}`);
    return r.status;
  }
  const name = taskName(home);
  const q = schtasksQuery(name);
  if (mode === 'check') {
    process.stdout.write(q === 0 ? `CHECK | INSTALLED (exit 0) | scheduled task ${name}\n`
      : q === 3 ? `CHECK | NOT INSTALLED (exit 3) | no scheduled task ${name}\n`
        : `CHECK | UNREADABLE (exit 2) | could not run ${SCHTASKS} /Query\n`);
    return q;
  }
  if (q === 2) { process.stdout.write(`ARM | UNAVAILABLE (exit 2) | could not run ${SCHTASKS}; the tick is NOT armed\n`); return 2; }
  if (q === 0) { process.stdout.write(`ARM | ALREADY PRESENT (exit 3) | scheduled task ${name}; nothing written\n`); return 3; }
  const tr = `"${process.execPath}" "${fileURLToPath(import.meta.url)}" "${home}"`;
  const r = spawnSync(SCHTASKS, ['/Create', '/SC', 'MINUTE', '/MO', '5', '/TN', name, '/TR', tr], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    process.stdout.write(`ARM | UNAVAILABLE (exit 2) | ${SCHTASKS} /Create failed (rc=${r.error ? 'spawn-error' : r.status}): ${snip200(r.stderr || r.stdout)}; the tick is NOT armed\n`);
    return 2;
  }
  process.stdout.write(`ARM | ARMED (exit 0) | scheduled task ${name} every 5 minutes: ${tr}\n`);
  return 0;
}

const snip200 = (s) => String(s || '').replace(/[\r\n\t]/g, ' ').replace(/ +/g, ' ').trim().slice(0, 200) || '(no output)';

// THE PROFILED TICK: the profile's OWN validator, run read-only at the project
// root, and one line printed. spawnSync without `shell` is execve — the argv is
// EXECUTED, never evaluated. A missing program is rc 127 NAMED in the stall
// line's stderr snippet, never a fact about the project's state.
function runProfileTick(home) {
  const argv = profileValues(home, 'validate');
  const r = spawnSync(argv[0], argv.slice(1), { cwd: home, encoding: 'utf8' });
  const rc = r.error ? 127 : r.status;
  const err = r.error ? r.error.message : r.stderr;
  let ret = 0;
  if (rc === 0) {
    process.stdout.write(`PROFILE-TICK | ${isoNow()} | home=${home} | validate_rc=0 | ${snip200(r.stdout)}\n`);
  } else {
    process.stdout.write(`PROFILE-TICK STALL | ${isoNow()} | home=${home} | validate_rc=${rc} | ${snip200(err)}\n`);
    ret = 3;
  }
  mergeBatch(home);   // A4, then A3: a merge is a state-changing step
  const sw = sweeps(home);   // 4g: re-prove what the batch claimed
  for (const a of sw.acts) process.stdout.write(`ACTION|${a.verb}|${sanitize(a.target)}|${sanitize(a.evidence)}\n`);
  if (sw.acts.length) ret = 3;
  runRefresh(home);
  const st = stallCheck(home, 'profiled');   // A2: the same stall + AUTO-RESUME
  if (st.fired) { process.stdout.write(`ACTION|stalled-turn|elapsed=${st.age}m|${sanitize(st.alarm)}\n`); ret = 3; }
  return ret;
}

function runTick(homeArg, wantCronLine, mode) {
  if (!homeArg) dieTool('no project home given. Usage: watch-tick.mjs <project-home> [--cron-line|--arm|--check]');
  if (!fs.existsSync(homeArg) || !fs.statSync(homeArg).isDirectory()) {
    dieTool(`project home does not exist: ${homeArg}`);
  }
  const home = fs.realpathSync(homeArg);
  if (wantCronLine) { process.stdout.write(`${cronLine(home)}\n`); return 0; }
  if (mode === 'record') {
    if (!recordSession(home, true)) { process.stdout.write('RECORD | not recorded (exit 2) | CLAUDE_CODE_SESSION_ID is not set — run this inside the conductor session\n'); return 2; }
    return 0;
  }
  if (mode) {
    const rc = armOrCheck(home, mode);
    // --arm also records the session (in the state area), as the bash twin does.
    // Off Windows the bash --arm it handed off to already recorded it.
    if (mode === 'arm' && SCHTASKS && (rc === 0 || rc === 3)) recordSession(home, false);
    return rc;
  }

  selfProve();

  // selfProve runs FIRST on both paths: it proves this file's own parser against
  // embedded fixtures and reads nothing of the project. Everything below reads
  // CONTROL/ and belongs to the legacy path alone.
  if (isProfiled(home)) return runProfileTick(home);

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

  // Pre-plan (no CHECKLIST yet) after the interview ended: research, spec and
  // apparatus run here, so the stall check and auto-resume must too (F2).
  if (!fs.existsSync(CHK) && readRecord(home).interview === 'done') {
    const st = stallCheck(home, null);
    process.stdout.write(`PRE-PLAN | the tick takes no counts before step 6.5 | stalled-turn=${st.note}\n`);
    if (st.fired) { process.stdout.write(`ACTION|stalled-turn|elapsed=${st.age}m|${sanitize(st.alarm)}\n`); return 3; }
    return 0;
  }
  if (!fs.existsSync(CHK)) {
    dieTool(`CONTROL/CHECKLIST.md is missing at ${CHK} — the runnable count has no source. Checked: ${CHK}. Not checked: the dispatch log and the heartbeat, because the run stopped here.`);
  }

  // A4: the batch merge cadence, once the plan exists.
  const mergeNote = mergeBatch(home);
  const sw = sweeps(home);   // 4g: the repo sweeps, after the batch
  if (sw.und) addUndet(`sweeps=${sw.note}`);

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

  // stalled-turn — the widened post-interview check, with auto-resume.
  const stall = stallCheck(home, openRows);
  if (stall.fired) emit('stalled-turn', `elapsed=${stall.age}m`, stall.alarm);

  // the repo sweeps' findings (4g)
  for (const a of sw.acts) emit(a.verb, a.target, a.evidence);

  V += actions.length;

  // --- (5) the line
  if (actions.length) process.stdout.write(`${actions.join('\n')}\n`);
  const line = `${isoNow()} | S-CHECK | violations=${V} | runnable=${RUNNABLE} open=${OPEN} trees=${TREES}`
    + ` | cap=${capNote} | anchor=${anchorNote} | trees-detail=${treeNote}`
    + ` | stalled-turn=${sanitize(stall.note)}`
    + ` | merge-batch=${sanitize(mergeNote)}`
    + ` | sweeps=${sanitizeLong(sw.note)}`
    + ` | actions=${sanitize(verbs.length ? verbs.join(',') : 'none')}`
    + ` | undetermined=${sanitizeLong(undetermined.length ? undetermined.join(',') : 'none')}`;
  ledgerWrite(home, path.join('CONTROL', 'LEDGER.md'), line);
  process.stdout.write(`${line}\n`);

  return V > 0 ? 3 : 0;
}

//=============================================================================
// SELFTEST — the same fixtures as tools/watch-tick.sh, so a drift between
// the twins fails a test instead of passing quietly.
//=============================================================================
function selftest() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-tick-mjs-selftest-'));
  // No selftest case may launch a real session: every AUTO-RESUME a fixture
  // reaches runs a no-op unless the case names its own stub (on Windows the
  // path does not exist, so the spawn fails harmlessly — still never a session).
  process.env.WATCH_TICK_LAUNCHER_CMD = '/usr/bin/true';
  // Nor may any case run the real merge train (the batch cadence).
  process.env.WATCH_MERGE_TRAIN_SH = '/usr/bin/true';
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

  // 11-15 — THE PROFILED PATH. A profile REDIRECTS this tick and never switches
  // it off (references/project-profile.md), and the twins must agree byte for
  // byte on the shape: tools/watch-tick.sh cases 35-41 are these same fixtures.
  const mkProfileHome = (name, validate = ['/bin/echo', 'validate-ok']) => {
    const dd = path.join(T, name);
    fs.mkdirSync(path.join(dd, 'state'), { recursive: true });
    fs.writeFileSync(path.join(dd, '.spec-protocol.json'), JSON.stringify({
      schema: 'spec-protocol.project-profile/v1',
      documents: { state: 'state/build-state.json' },
      commands: { validate },
    }));
    fs.writeFileSync(path.join(dd, 'state', 'build-state.json'), '{}\n');
    return dd;
  };

  // 11 — the profiled cron line logs beside the BOUND state, never CONTROL/.
  d = mkProfileHome('c11');
  r = run([d, '--cron-line']);
  report(11, 'profile-cron-line',
    r.rc === 0 && /^\*\/5 \* \* \* \* bash '.*watch-tick\.sh' '.*' >> '.*\/state\/watch-tick\.log' 2>&1$/m.test(r.out)
      && !/CONTROL\/watch-tick\.log/.test(r.out),
    `rc=${r.rc} (want 0); the line ends at state/watch-tick.log beside documents.state and names no CONTROL/ — line: [${r.out.trim()}]`);

  // 12 — the profiled tick runs the profile's own validator. The two absences
  // matter most: no CONTROL/ directory and no S-CHECK line, because the second
  // copy a profile forbids is exactly what a redirect must not build.
  d = mkProfileHome('c12');
  r = run([d]);
  report(12, 'profile-tick-runs',
    r.rc === 0 && /^PROFILE-TICK \| .* \| home=.*c12 \| validate_rc=0 \| validate-ok$/m.test(r.out)
      && !/S-CHECK/.test(r.out) && !fs.existsSync(path.join(d, 'CONTROL')),
    `rc=${r.rc} (want 0); one PROFILE-TICK line carrying the validator's own stdout; no S-CHECK line and no CONTROL/ created — line: [${r.out.trim()}]`);

  // 13 — THE STALL. The same fixture but for the validate argv, which exits 1.
  d = mkProfileHome('c13', ['/usr/bin/false']);
  r = run([d]);
  report(13, 'profile-tick-stall',
    r.rc === 3 && /^PROFILE-TICK STALL \| .* \| home=.*c13 \| validate_rc=1 \| /m.test(r.out)
      && !/^PROFILE-TICK \| /m.test(r.out),
    `rc=${r.rc} (want 3 — the same code the S-checks use); PROFILE-TICK STALL naming validate_rc=1, and NOT the clean line`);

  // 14 — a profile with no commands.validate. The one thing it may never do is
  // quietly run the legacy CONTROL/ path instead, watching the wrong tree.
  d = path.join(T, 'c14');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '.spec-protocol.json'),
    JSON.stringify({ schema: 'spec-protocol.project-profile/v1', documents: { state: 'state/build-state.json' }, commands: { init: ['/bin/echo', 'x'] } }));
  r = run([d]);
  report(14, 'profile-validate-missing',
    r.rc === 2 && /TOOLING FAILURE \(exit 2\): PROFILE \|/.test(r.out) && /commands\.validate/.test(r.out)
      && /NOT an all-clear/.test(r.out) && !fs.existsSync(path.join(d, 'CONTROL')),
    `rc=${r.rc} (want 2); the failure NAMES commands.validate and the profile file, says it is not an all-clear, and left no CONTROL/ behind`);

  // 15 — THE DISCRIMINATING CONTROL. ONE home, ONE file's difference. An
  // implementation that redirected on anything but the profile's presence
  // passes 11-14 and fails HERE.
  d = mkHome('c15');
  w(d, 'CONTROL/dispatch-log.md', `${stamp(1)} | U-02 qc | qc | [opus x10] WF01 judge | run-015\n`);
  w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 judge | U-02 | qc\n`);
  fs.writeFileSync(path.join(d, '.spec-protocol.json'),
    JSON.stringify({ schema: 'spec-protocol.project-profile/v1', documents: { state: 'state/build-state.json' }, commands: { validate: ['/bin/echo', 'validate-ok'] } }));
  const profCron = run([d, '--cron-line']);
  const profTick = run([d]);
  fs.rmSync(path.join(d, '.spec-protocol.json'));
  const legCron = run([d, '--cron-line']);
  const legTick = run([d]);
  report(15, 'profile-vs-legacy-control',
    profCron.rc === 0 && /\/state\/watch-tick\.log' 2>&1$/m.test(profCron.out)
      && /^PROFILE-TICK \| /m.test(profTick.out)
      && legCron.rc === 0 && /\/CONTROL\/watch-tick\.log' 2>&1$/m.test(legCron.out)
      && legTick.rc === 0 && /S-CHECK \| violations=0 \| runnable=0 open=1 trees=1/.test(legTick.out)
      && !/PROFILE-TICK/.test(legTick.out),
    `one home, one file: WITH .spec-protocol.json it printed the state/watch-tick.log line and a PROFILE-TICK; with that file removed the SAME home printed the CONTROL/watch-tick.log line and a legacy S-CHECK verdict (rc=${legTick.rc}, want 0) with no PROFILE-TICK anywhere`);

  // 16 — #35 --arm / #32 --check on the Windows path, against a STUB schtasks
  // (never the real one): check 3, arm 0, check 0, arm again 3, Create once.
  d = mkHome('c16');
  const st = path.join(T, 'c16.task');
  const log16 = path.join(T, 'c16.create');
  const stub = path.join(T, 'schtasks-stub');
  fs.writeFileSync(stub, `#!/bin/sh\ncase "$1" in /Query) [ -f "${st}" ] ;; /Create) echo "$*" >> "${log16}"; touch "${st}" ;; *) exit 9 ;; esac\n`, { mode: 0o755 });
  const env16 = { WATCH_TICK_SCHTASKS_CMD: stub };
  const rcs = [run([d, '--check'], env16).rc, run([d, '--arm'], env16).rc, run([d, '--check'], env16).rc, run([d, '--arm'], env16).rc];
  const created = (readLines(log16) || []).filter((l) => l);
  report(16, 'schtasks-arm-check',
    rcs.join(',') === '3,0,0,3' && created.length === 1
      && created[0].startsWith('/Create /SC MINUTE /MO 5 /TN spec-protocol-tick-c16 /TR ')
      && created[0].includes(fileURLToPath(import.meta.url)),
    `rcs check,arm,check,arm = ${rcs.join(',')} (want 3,0,0,3); Create calls=${created.length} (want 1): [${created[0] || ''}]`);

  // 17 — AUTO-RESUME (F1-F3, the port of tools/watch-tick.sh case 45). A
  // pre-plan project whose session was recorded at interview end; the recorded
  // cwd is the transcript's launch folder; a stale project resumes ONCE through
  // the stubbed launcher with /spec-protocol resume, and a second tick is held.
  d = mkHome('c17');
  fs.rmSync(path.join(d, 'CONTROL', 'CHECKLIST.md'));
  fs.rmSync(path.join(d, 'CONTROL', 'TODO.md'));
  const cfg17 = path.join(T, 'cfg17');
  const launch17 = path.join(T, 'launch17');
  fs.mkdirSync(path.join(cfg17, 'projects', 'x'), { recursive: true });
  fs.mkdirSync(launch17);
  fs.writeFileSync(path.join(cfg17, 'projects', 'x', 'sess-17.jsonl'), `${JSON.stringify({ cwd: launch17, sessionId: 'sess-17' })}\n`);
  const args17 = path.join(T, 'c17.args');
  const stub17 = path.join(T, 'launcher-stub.mjs');
  fs.writeFileSync(stub17, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(args17)}, process.cwd() + '|' + process.argv.slice(2).join(' ') + '\\n');\n`);
  // The stub is a node script, so the stub "launcher" is a tiny wrapper that runs it.
  const wrap17 = path.join(T, process.platform === 'win32' ? 'launcher-stub.cmd' : 'launcher-stub');
  fs.writeFileSync(wrap17, process.platform === 'win32'
    ? `@"${process.execPath}" "${stub17}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${stub17}" "$@"\n`, { mode: 0o755 });
  const rec17 = run([d, '--record-session'], { CLAUDE_CODE_SESSION_ID: 'sess-17', CLAUDE_CONFIG_DIR: cfg17 });
  const old17 = new Date(Date.now() - 20 * 60000);
  fs.utimesSync(path.join(d, 'SPEC', 'GOAL.md'), old17, old17);
  const t1 = run([d], { WATCH_TICK_LAUNCHER_CMD: wrap17 });
  for (let i = 0; i < 20 && !fs.existsSync(args17); i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  const t2 = run([d], { WATCH_TICK_LAUNCHER_CMD: wrap17 });
  const rec17txt = (readLines(path.join(d, 'CONTROL', 'auto-resume.txt')) || []).join('\n');
  const got17 = (readLines(args17) || []).filter((l) => l);
  report(17, 'auto-resume-post-interview',
    rec17.rc === 0 && /^interview=done$/m.test(rec17txt) && rec17txt.includes(`cwd=${launch17}`)
      && t1.rc === 3 && /AUTO-RESUME \| launched/.test(t1.out) && /AUTO-RESUME \| held/.test(t2.out)
      && got17.length === 1 && got17[0].endsWith('|-p --permission-mode bypassPermissions --resume sess-17 /spec-protocol resume')
      && fs.realpathSync(got17[0].split('|')[0]) === fs.realpathSync(launch17)
      && /phase=post-interview\(pre-plan\)/.test(led(d)),
    `record rc=${rec17.rc} (want 0); tick rc=${t1.rc} (want 3) then held; stub calls=${got17.length} (want 1): [${got17[0] || ''}]`);

  // 18 (A2 fix) — PROFILED TERMINAL STATUS. A profiled project whose bound
  // state carries ONLY "status":"RELEASE_COMPLETE" (no run_status key at
  // all) plus a stale, interview=done session must NEVER auto-resume — the
  // exact bug this fix closes: an absent run_status alone used to read as
  // "running" even when the profile's own status field said the run was
  // finished.
  d = mkProfileHome('c18');
  fs.writeFileSync(path.join(d, 'state', 'build-state.json'), '{"status":"RELEASE_COMPLETE"}\n');
  const args18 = path.join(T, 'c18.args');
  const stub18 = path.join(T, 'launcher-stub18.mjs');
  fs.writeFileSync(stub18, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(args18)}, process.argv.slice(2).join(' ') + '\\n');\n`);
  const wrap18 = path.join(T, process.platform === 'win32' ? 'launcher-stub18.cmd' : 'launcher-stub18');
  fs.writeFileSync(wrap18, process.platform === 'win32'
    ? `@"${process.execPath}" "${stub18}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${stub18}" "$@"\n`, { mode: 0o755 });
  const rec18 = run([d, '--record-session'], { CLAUDE_CODE_SESSION_ID: 'sess-18', CLAUDE_CONFIG_DIR: '/x/.claude-nine' });
  const old18 = new Date(Date.now() - 20 * 60000);
  fs.utimesSync(path.join(d, 'state', 'build-state.json'), old18, old18);
  fs.utimesSync(path.join(d, '.spec-protocol.json'), old18, old18);
  const t18 = run([d], { WATCH_TICK_LAUNCHER_CMD: wrap18 });
  report(18, 'profiled-terminal-status-no-resume',
    rec18.rc === 0 && t18.rc === 0 && !fs.existsSync(args18)
      && !/AUTO-RESUME/.test(t18.out) && !/ACTION\|stalled-turn/.test(t18.out),
    `record rc=${rec18.rc} (want 0); tick rc=${t18.rc} (want 0); launcher stub called=${fs.existsSync(args18)} (want false — RELEASE_COMPLETE via the status fallback must block auto-resume even though the session looks stale)`);

  // 19 — THE REPO SWEEPS through the bash twin (4g): a local-only repo whose
  // ledger claims MERGED on a commit that is not on the trunk -> exit 3,
  // MERGE-CLAIM-FALSE and ACTION|requeue, the re-queue line written, and the
  // S-CHECK line carrying sweeps=. The claim on the trunk's own commit, in the
  // same ledger, stays silent: the negative control.
  if (haveBash()) {
    d = mkHome('c19');
    const g = path.join(T, 'c19repo');
    const genv = { ...process.env, GIT_AUTHOR_NAME: 'st', GIT_AUTHOR_EMAIL: 'st@example.invalid', GIT_COMMITTER_NAME: 'st', GIT_COMMITTER_EMAIL: 'st@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (...a) => spawnSync('git', ['-C', g, ...a], { encoding: 'utf8', env: genv });
    fs.mkdirSync(g);
    git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(g, 'f'), 'f\n'); git('add', 'f'); git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'unit/N1'); fs.writeFileSync(path.join(g, 'n1'), 'n1\n'); git('add', 'n1'); git('commit', '-qm', 'N1'); git('checkout', '-q', 'main');
    const cN1 = (git('rev-parse', 'unit/N1').stdout || '').trim();
    const cMain = (git('rev-parse', 'main').stdout || '').trim();
    w(d, 'CONTROL/repos.json', JSON.stringify({ repos: [{ name: 'n', root: g, trunk: 'main', remote: null }] }));
    w(d, 'CONTROL/LEDGER.md', `${stamp(3)} | MERGED: unit=unit/N1 commit=${cN1} repo=n\n${stamp(3)} | MERGED: unit=unit/N0 commit=${cMain} repo=n\n`);
    w(d, 'CONTROL/dispatch-log.md', `${stamp(1)} | U-02 qc | qc | [opus x10] WF01 judge | run-019\n`);
    w(d, 'CONTROL/HEARTBEAT.md', `${stamp(1)} | WF01 judge | U-02 | qc\n`);
    r = run([d]);
    let rq = '';
    try { rq = fs.readFileSync(path.join(d, 'CONTROL', 'merge-train', 'requeue.tsv'), 'utf8'); } catch { /* none */ }
    report(19, 'repo-sweeps-via-bash-twin',
      r.rc === 3 && cN1 !== '' && new RegExp(`^MERGE-CLAIM-FALSE: unit=unit/N1 repo=n commit=${cN1} reason=not-an-ancestor-of-main`, 'm').test(r.out)
        && /^ACTION\|requeue\|unit\/N1\|/m.test(r.out) && !/unit\/N0/.test(r.out) && /^n\tunit\/N1\tmerge-claim-false\t/m.test(rq)
        && /S-CHECK \| .*\| sweeps=repos=1 claims=2 claim-false=1 /.test(led(d)),
      `rc=${r.rc} (want 3); MERGE-CLAIM-FALSE + ACTION|requeue for unit/N1, re-queue line written, the proven N0 claim silent, S-CHECK carries sweeps=`);
  } else {
    process.stdout.write('SKIP | case 19 | repo-sweeps-via-bash-twin | PLATFORM-SKIP: no bash on this machine, so the sweep did not run (never counted as a pass)\n');
  }

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
let mode = '';
for (const a of argv) {
  if (a === '--selftest') wantSelftest = true;
  else if (a === '--cron-line') wantCron = true;
  else if (a === '--arm') mode = 'arm';
  else if (a === '--check') mode = 'check';
  else if (a === '--record-session') mode = 'record';
  else if (a === '-h' || a === '--help') {
    process.stdout.write('Usage: node scripts/common/watch-tick.mjs <project-home> [--cron-line|--arm|--check] | --selftest\n');
    process.exit(0);
  } else if (a.startsWith('--')) dieTool(`unknown option: ${a}`);
  else if (!home) home = a;
  else dieTool(`unexpected argument: ${a}`);
}

process.exit(wantSelftest ? selftest() : runTick(home, wantCron, mode));
