// ledger.mjs — the Node twin of tools/ledger.sh (E6 step 2: the enforcement kit
// must run where bash does not — a native Windows box with PowerShell and no
// Git Bash, chiefly).
//
// Usage: node scripts/common/ledger.mjs <home> <file> <line> [upsert-key]
//        node scripts/common/ledger.mjs --selftest
//
// SAME LINE SHAPES, SAME ATOMIC WRITE, SAME EXIT CODES as tools/ledger.sh. The
// twin writes byte-identical files for the same arguments; the selftest proves
// that against the bash original rather than asserting it.
//
//   * <line> is appended VERBATIM, LF-terminated, through .tmp + rename, with
//     the whole read-modify-write held under a lock. Copy-append-rename alone is
//     NOT atomic across concurrent writers: two writers can each read the same
//     starting state and the second rename clobbers the first writer's line.
//     The lock makes the read-modify-write indivisible; .tmp+rename keeps each
//     locked write crash-safe.
//   * [upsert-key] gives overwrite-in-place semantics: any existing line
//     containing the literal substring "| <upsert-key> |" is removed before
//     <line> is appended, so the file ends with exactly one line for that key.
//     That is HEARTBEAT.md's contract (references/documents.md, document 13).
//   * THE SCORE LINE CLASS (references/gauntlet.md section 5) is checked BEFORE
//     the lock and before any file is touched: a line that opens the class
//         SCORE | unit=<id> | round=<n> | score=<x.x> | best=<x.x> | delta=<d>
//     (an ISO8601Z prefix allowed) but does not carry all five fields in order
//     with numeric round/score/best/delta is REFUSED with exit 2 and never
//     written. No other line class is shape-checked.
//   * Every "| CLAIM |" line has its plan= appended to
//     <home>/CONTROL/last-intents.txt, rolling, last 20 — the only input
//     anchor.sh's class 5 (repeated-intent stall) reads.
//   * LF is written explicitly on every platform (references/platform.md §2,
//     line-endings row). Never CRLF, never "whatever the host does".
//
// TWO DELIBERATE DIFFERENCES, both named rather than hidden:
//
//  1. LOCK PRIMITIVE. ledger.sh prefers flock(1) when it resolves and falls back
//     to a mkdir lock at <target>.lock.d otherwise. Node cannot hold an flock on
//     a descriptor across a synchronous critical section, so this twin ALWAYS
//     takes the mkdir lock, at the SAME path, with the same 45s deadline, the
//     same jittered retries and the same 60s stale reclaim. Consequence, stated
//     plainly: on a box with NO flock(1) (stock macOS, and every Windows box —
//     which is the case this port exists for) the two twins interlock correctly
//     with each other. On a box WHERE flock(1) resolves, they take different
//     primitives, so do not run both twins concurrently against the same file
//     there. On the PowerShell-only machine this port serves, no bash twin can
//     run at all, so the window is empty by construction.
//  2. iCloud pin-local mitigation runs only on darwin (brctl/xattr are macOS
//     programs); elsewhere it is a no-op and the sentinel is still written, so
//     the two twins agree on <home>/.ledger-pinned.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// The SCORE line class. Two expressions, exactly as in ledger.sh: one that says
// "this line is OF the class", one that says "and it is well formed". A line
// matching the first and failing the second is the only thing ever refused.
const SCORE_CLASS_RE = /(^|\|)\s*SCORE\s*\|/;
const SCORE_SHAPE_RE = /^([^|]*\|\s*)?SCORE\s*\|\s*unit=[^|]+\|\s*round=[0-9]+\s*\|\s*score=-?[0-9]+(\.[0-9]+)?\s*\|\s*best=-?[0-9]+(\.[0-9]+)?\s*\|\s*delta=-?[0-9]+(\.[0-9]+)?\s*$/;
const CLAIM_RE = /\|\s*CLAIM\s*\|/;

// C5/twin fix: the clock and the writer signature, ported from ledger.sh's
// FIRST_LINE/REST_LINES stamp-and-sign block. Only the payload's FIRST line is
// stamped and signed; a multi-line payload's remaining lines travel unchanged.
// Markdown STRUCTURE (#, >, ---, a table row, a "- [ ]"/"- [x]" checklist row)
// and a blank first line are never stamped and never signed -- a live reader
// of those rows (tools/anchor.sh) would be blinded by a prefix. A payload that
// already carries an ISO8601Z timestamp or the signature keeps it exactly,
// never stamped or signed a second time.
const LEDGER_STRUCT_RE = /^[ \t]*([#>]|-{3,}|\||[-*+][ \t]*\[[ xX]\])/;
const LEDGER_ISO8601Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/;
const LEDGER_WRITER_SIG = ' | writer=ledger.sh';
// Port of ledger.sh's st_written_ok: what a write MEANS now -- the payload's
// first line, prefixed with an ISO8601Z stamp ONLY when the caller supplied
// none, and always signed. A caller-supplied timestamp survives byte-for-byte;
// nothing else changes. Selftest cases assert THROUGH this, never against the
// raw payload, so a writer that quietly stopped stamping or signing fails here.
const LEDGER_ISO8601Z_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \| /;
function writtenOk(actual, expectedFirstLine) {
  if (!actual.endsWith(LEDGER_WRITER_SIG)) return false;
  const w = actual.slice(0, -LEDGER_WRITER_SIG.length);
  if (LEDGER_ISO8601Z_RE.test(expectedFirstLine)) return w === expectedFirstLine;
  if (!LEDGER_ISO8601Z_PREFIX_RE.test(w)) return false;
  return w.replace(LEDGER_ISO8601Z_PREFIX_RE, '') === expectedFirstLine;
}

function stampAndSign(payload) {
  const nl = payload.indexOf('\n');
  let firstLine = nl === -1 ? payload : payload.slice(0, nl);
  const rest = nl === -1 ? '' : payload.slice(nl);   // keeps its own leading \n
  const isRecord = firstLine.trim() !== '' && !LEDGER_STRUCT_RE.test(firstLine);
  if (isRecord && !LEDGER_ISO8601Z_RE.test(firstLine)) firstLine = `${nowUtc()} | ${firstLine}`;
  if (isRecord && !firstLine.endsWith(LEDGER_WRITER_SIG)) firstLine += LEDGER_WRITER_SIG;
  return firstLine + rest;
}

const LOCK_DEADLINE_SECS = 45;
const STALE_LOCK_SECS = 60;
const SLEEP_CHOICES_MS = [50, 70, 90, 110, 130, 150, 170, 190, 210, 230];

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* SharedArrayBuffer unavailable — spin, briefly */ }
  }
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// tail -n 1, with the same answer bash gives: the last NON-EMPTY physical line.
function tailLine(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return ''; }
  if (text === '') return '';
  const lines = text.split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines[lines.length - 1] : '';
}

// wc -l: the number of LF bytes, which is what bash's `wc -l < f` reports.
function lineCount(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return 0; }
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

// plan=<...> up to the next field separator. Ported from ledger.sh's two seds:
// the first is greedy, so it takes the LAST "| plan="; the second cuts at the
// first following "|", trimming the whitespace in front of it.
function extractPlan(line) {
  const m = /^[\s\S]*\|\s*plan=/.exec(line);
  if (!m) return '';
  let rest = line.slice(m[0].length);
  const cut = /\s*\|/.exec(rest);
  if (cut) rest = rest.slice(0, cut.index);
  return rest;
}

function acquireLock(target) {
  const lockdir = `${target}.lock.d`;
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockdir);
      try {
        fs.writeFileSync(path.join(lockdir, 'owner'),
          `pid=${process.pid} acquired=${Math.floor(Date.now() / 1000)}\n`);
      } catch { /* the owner note is a diagnostic; its absence never voids the lock */ }
      return lockdir;
    } catch (e) {
      if (e && e.code !== 'EEXIST') {
        return { error: `ERROR: ledger.mjs could not create lock dir ${lockdir}: ${e.message}` };
      }
    }
    // TOCTOU guard, identical to ledger.sh: reclaim ONLY on a successful stat
    // that proves real age. A stat failure here means the directory vanished
    // between the attempt and this line — almost always because the true owner
    // just released it — and is NEVER evidence of staleness.
    try {
      const st = fs.statSync(lockdir);
      const ageSecs = (Date.now() - st.mtimeMs) / 1000;
      if (ageSecs > STALE_LOCK_SECS) {
        try { fs.rmSync(lockdir, { recursive: true, force: true }); } catch { /* raced */ }
        continue;
      }
    } catch { /* vanished — not staleness */ }
    if ((Date.now() - start) / 1000 >= LOCK_DEADLINE_SECS) return null;
    sleepMs(SLEEP_CHOICES_MS[Math.floor(Math.random() * SLEEP_CHOICES_MS.length)]);
  }
}

function releaseLock(lockdir) {
  if (typeof lockdir === 'string') {
    try { fs.rmSync(lockdir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
}

// The rolling stated-intent window — class 5's only input. It runs AFTER the
// verified write of the real line and can never fail that write: a problem here
// is a loud warning on stderr, never a non-zero exit.
function appendIntent(homeDir, line, warn, profiled = false) {
  const intentsFile = profiled ? path.join(homeDir, 'last-intents.txt')
    : path.join(homeDir, 'CONTROL', 'last-intents.txt');
  const itmp = `${intentsFile}.tmp.${process.pid}`;
  let plan = extractPlan(line);
  if (plan === '') {
    // A CLAIM with no plan= is a malformed claim, not a reason to write nothing:
    // the window keeps one entry per claim and the defect stays visible.
    plan = `(no plan= field) ${line.replace(/^[^|]*\|/, '')}`;
  }
  plan = plan.replace(/[\n\r]/g, '').slice(0, 300);
  try {
    fs.mkdirSync(path.dirname(intentsFile), { recursive: true });
    let keep = '';
    if (fs.existsSync(intentsFile)) {
      const lines = fs.readFileSync(intentsFile, 'utf8').split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      keep = lines.slice(-19).map((l) => `${l}\n`).join('');
    }
    fs.writeFileSync(itmp, `${keep}${plan}\n`);
    fs.renameSync(itmp, intentsFile);
  } catch (e) {
    try { fs.rmSync(itmp, { force: true }); } catch { /* nothing to clean */ }
    warn(`WARNING: ledger.mjs wrote the ledger line but could not update ${intentsFile} — anchor.sh's class 5 (repeated-intent) will be undetermined until this is fixed: ${e.message}`);
  }
}

// The whole writer. Returns { code, err: [] } — never throws for an ordinary
// failure, so the CLI and the selftest read the same result the same way.
export function ledgerWrite(homeDir, file, line, upsertKey = '') {
  const err = [];
  const warn = (m) => err.push(m);

  // --- a PROFILED project (.spec-protocol.json): never a CONTROL/ folder. The
  //     file lands in <statedir>/spec-protocol/ (tools/project-profile.mjs
  //     workdir) with a leading CONTROL/ dropped, exactly as tools/ledger.sh.
  let profiled = false;
  if (fs.existsSync(path.join(homeDir, '.spec-protocol.json'))) {
    try {
      const profileTool = fileURLToPath(new URL('../../tools/project-profile.mjs', import.meta.url));
      homeDir = execFileSync(process.execPath, [profileTool, 'workdir', homeDir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      warn(`ERROR: ledger.mjs could not resolve the profiled work folder (tools/project-profile.mjs workdir failed); wrote NOTHING: ${String(e.stderr || e.message).trim()}`);
      return { code: 2, err };
    }
    if (!homeDir) { warn('ERROR: ledger.mjs got an empty profiled work folder; wrote NOTHING'); return { code: 2, err }; }
    file = file.replace(/^CONTROL\//, '');
    profiled = true;
  }

  // --- the SCORE class gate: before the lock, before any file is touched, so a
  //     refused line leaves nothing behind.
  if (SCORE_CLASS_RE.test(line) && !SCORE_SHAPE_RE.test(line)) {
    warn(`ERROR: ledger.mjs refused a malformed SCORE line and wrote NOTHING. The class requires all five fields, in order, with numeric round/score/best/delta: SCORE | unit=<id> | round=<n> | score=<x.x> | best=<x.x> | delta=<d> (an ISO8601Z prefix is allowed). Got: ${line}`);
    return { code: 2, err };
  }

  // --- the clock and the signature (twin fix): everything below this line —
  //     the file write, the tail verification, and the CLAIM/last-intents.txt
  //     append — reads the STAMPED line, exactly as ledger.sh reassigns LINE
  //     before its own write.
  line = stampAndSign(line);

  const target = path.join(homeDir, file);
  const tmp = `${target}.tmp.${process.pid}`;

  // --- iCloud pin-local mitigation, once per home (macOS only; the sentinel is
  //     written on every platform so both twins agree it has been done).
  const pinSentinel = path.join(homeDir, '.ledger-pinned');
  if (!fs.existsSync(pinSentinel)) {
    if (process.platform === 'darwin') {
      for (const [cmd, args] of [['brctl', ['download', homeDir]],
        ['xattr', ['-w', 'com.apple.metadata:com_apple_cloudDocs:PID', '0', homeDir]]]) {
        try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 10000 }); } catch { /* best effort */ }
      }
    }
    try {
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(pinSentinel, '');
    } catch { /* best effort, exactly as the bash twin */ }
  }

  // TARGET's own directory, not just HOME_DIR: FILE can carry subdirectory
  // components, and the lock lives beside TARGET.
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (e) {
    warn(`ERROR: ledger.mjs could not create ${path.dirname(target)}: ${e.message}`);
    return { code: 1, err };
  }

  const lock = acquireLock(target);
  if (lock === null) {
    warn(`ERROR: ledger.mjs could not acquire lock dir ${target}.lock.d within ${LOCK_DEADLINE_SECS}s. Refusing to write ${target} unlocked — that is exactly the lost-line bug this lock exists to close. Inspect ${target}.lock.d/owner (pid + acquire time) before removing it; only remove it once you have confirmed that pid is dead.`);
    return { code: 1, err };
  }
  if (typeof lock === 'object') { warn(lock.error); return { code: 1, err }; }

  try {
    // Sweep stale .tmp files from interrupted prior writes. Safe under the lock:
    // no other writer can be mid-write right now.
    const dir = path.dirname(target);
    const base = path.basename(target);
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`${base}.tmp.`)) {
          try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* raced */ }
        }
      }
    } catch { /* an unreadable directory surfaces below, on the real write */ }

    let body = '';
    if (fs.existsSync(target)) body = fs.readFileSync(target, 'utf8');

    if (upsertKey !== '') {
      // Overwrite-in-place: drop this key's existing line before re-adding it.
      const marker = `| ${upsertKey} |`;
      const lines = body.split('\n');
      const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
      if (hadTrailingNewline) lines.pop();
      const kept = lines.filter((l) => !l.includes(marker));
      body = kept.length ? `${kept.map((l) => `${l}\n`).join('')}` : '';
    }

    fs.writeFileSync(tmp, `${body}${line}\n`);
    fs.renameSync(tmp, target);   // atomic, still inside the lock

    // --- post-write eviction check (iCloud pulled the file out from under us)
    if (!fs.existsSync(target)) {
      const warnLine = `${nowUtc()} | WARNING | iCloud-eviction | ${homeDir} is iCloud-evicted — files may be missing. Run: brctl download ${homeDir}`;
      try { fs.appendFileSync(target, `${warnLine}\n`); } catch { /* nothing more to try */ }
      warn(`WARNING: iCloud eviction detected for ${homeDir}`);
    }

    // --- verify THIS write landed (tail, not a whole-file search: a whole-file
    //     search would pass on an earlier identical line and mask a failed append)
    if (tailLine(target) !== line) {
      warn(`ERROR: ledger write verification failed — last line of ${target} is not the line just written`);
      return { code: 1, err };
    }

    if (!file.endsWith('last-intents.txt') && CLAIM_RE.test(line)) {
      appendIntent(homeDir, line, warn, profiled);
    }
    return { code: 0, err, target: profiled ? target : undefined };
  } catch (e) {
    warn(`ERROR: ledger.mjs failed writing ${target}: ${e.message}`);
    return { code: 1, err };
  } finally {
    releaseLock(lock);
  }
}

// =============================================================================
// --selftest — the instrument proves itself before anyone trusts a line it
// wrote. Every case drives THE REAL WRITER as a caller would, in a child
// process: a shape checker that is never driven through the writer proves
// nothing about the writer. The accept cases are the CONTROL for the refuse
// cases: a checker that refused everything, or accepted everything, fails the
// set as a whole. Every refuse case re-reads the file, because a refusal with
// no proof the line was NOT written is not a refusal.
//
// Case 9 is the twin proof: the SAME CLAIM line through tools/ledger.sh and
// through this file must produce BYTE-IDENTICAL files. Where bash does not run,
// that case reports UNDETERMINED with the reason named — never a silent pass.
// =============================================================================
function selftest() {
  let passes = 0;
  let fails = 0;
  const ok = (m) => { console.log(`PASS | ${m}`); passes += 1; };
  const bad = (m, d) => { console.log(`FAIL | ${m} | ${d}`); fails += 1; };

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mjs-selftest-'));
  console.log(`ledger.mjs --selftest | self=${SELF} | home=${home}`);
  const LEDGER = 'CONTROL/LEDGER.md';
  let rc = 0;
  let errOut = '';

  const write = (h, ...args) => {
    try {
      errOut = String(execFileSync(process.execPath, [SELF, h, ...args],
        { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }) || '');
      rc = 0;
    } catch (e) {
      rc = typeof e.status === 'number' ? e.status : 1;
      errOut = String(e.stderr || e.message || '');
    }
  };
  const last = (f) => tailLine(path.join(home, f));
  const nlines = (f) => lineCount(path.join(home, f));

  // 1 — SCORE, well formed, bare: the exact shape gauntlet.md section 5 writes
  let L = 'SCORE | unit=U1 | round=2 | score=7.1 | best=7.1 | delta=1.3';
  write(home, LEDGER, L);
  if (rc === 0 && writtenOk(last(LEDGER), L)) ok(`SCORE class accepted and written: ${L}`);
  else bad('SCORE class accepted and written', `rc=${rc} last=[${last(LEDGER)}] err=${errOut}`);

  // 2 — SCORE with the ISO8601Z prefix every other ledger line carries
  L = '2026-09-07T04:11:00Z | SCORE | unit=U1 | round=3 | score=8.2 | best=8.2 | delta=1.1';
  write(home, LEDGER, L);
  if (rc === 0 && writtenOk(last(LEDGER), L)) ok('SCORE class accepted with a timestamp prefix, which is KEPT as given');
  else bad('SCORE class accepted with a timestamp prefix', `rc=${rc} last=[${last(LEDGER)}] err=${errOut}`);

  // 3 — SCORE missing a field: REFUSED, exit 2, and NOT written
  const guard = last(LEDGER);
  L = 'SCORE | unit=U1 | round=4 | score=8.4 | best=8.4';
  write(home, LEDGER, L);
  if (rc === 2 && last(LEDGER) === guard) ok('malformed SCORE (no delta=) refused with exit 2 and not written');
  else bad('malformed SCORE (no delta=) refused', `rc=${rc} last=[${last(LEDGER)}] err=${errOut}`);

  // 4 — SCORE with a non-numeric score: REFUSED, exit 2, and NOT written
  L = 'SCORE | unit=U1 | round=4 | score=high | best=8.4 | delta=0.2';
  write(home, LEDGER, L);
  if (rc === 2 && last(LEDGER) === guard) ok('malformed SCORE (score=high) refused with exit 2 and not written');
  else bad('malformed SCORE (score=high) refused', `rc=${rc} last=[${last(LEDGER)}] err=${errOut}`);

  // 5 — the CLAIM shape (anti-drift.md section 8): written, and its plan= lands
  //     in CONTROL/last-intents.txt, class 5's only input
  L = '2026-09-07T04:12:00Z | CLAIM | unit=U1 | agent=builder-a | model=builder | plan=build the home page';
  write(home, LEDGER, L);
  if (rc === 0 && writtenOk(last(LEDGER), L) && last('CONTROL/last-intents.txt') === 'build the home page') {
    ok('CLAIM shape written and its plan= appended to CONTROL/last-intents.txt');
  } else {
    bad('CLAIM shape written and intent appended', `rc=${rc} last=[${last(LEDGER)}] intent=[${last('CONTROL/last-intents.txt')}] err=${errOut}`);
  }

  // 6 — the RESULT shape: written, and it does NOT extend the intent window.
  //     This is the discrimination control for case 5.
  const before = nlines('CONTROL/last-intents.txt');
  L = '2026-09-07T04:20:00Z | RESULT | unit=U1 | PASS | evidence=CONTROL/LEDGER.md';
  write(home, LEDGER, L);
  const after = nlines('CONTROL/last-intents.txt');
  if (rc === 0 && writtenOk(last(LEDGER), L) && before === after) {
    ok(`RESULT shape written and the intent window left alone (${before} lines)`);
  } else {
    bad('RESULT shape written, intent window unchanged', `rc=${rc} last=[${last(LEDGER)}] before=${before} after=${after} err=${errOut}`);
  }

  // 7 — the control that keeps the SCORE check honest: a line of no class at all
  L = '2026-09-07T04:21:00Z | NOTE | unit=U1 | a line of no class at all';
  write(home, LEDGER, L);
  if (rc === 0 && writtenOk(last(LEDGER), L)) ok('control: an unclassed line is written unaltered but for the clock and the signature (the SCORE check is class-specific)');
  else bad('control: an unclassed line is written unaltered but for the clock and the signature', `rc=${rc} last=[${last(LEDGER)}] err=${errOut}`);

  // 8 — upsert mode still holds one line per key (HEARTBEAT's contract)
  write(home, 'CONTROL/HEARTBEAT.md', '2026-09-07T04:22:00Z | builder-a | U1 | build', 'builder-a');
  write(home, 'CONTROL/HEARTBEAT.md', '2026-09-07T04:27:00Z | builder-a | U1 | judge', 'builder-a');
  if (rc === 0 && nlines('CONTROL/HEARTBEAT.md') === 1) ok('upsert mode keeps exactly one line per key');
  else bad('upsert mode keeps one line per key', `rc=${rc} lines=${nlines('CONTROL/HEARTBEAT.md')} err=${errOut}`);

  // 9 — THE TWIN PROOF. The same CLAIM line through tools/ledger.sh and through
  //     this file, into two fresh homes, must give byte-identical files.
  const bashLedger = path.resolve(path.dirname(SELF), '..', '..', 'tools', 'ledger.sh');
  let bashRuns = false;
  let bashWhy = '';
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore', timeout: 10000 });
    bashRuns = true;
  } catch (e) {
    bashWhy = `bash --version did not run: ${e.code || e.message}`;
  }
  if (!fs.existsSync(bashLedger)) { bashRuns = false; bashWhy = `tools/ledger.sh not found at ${bashLedger}`; }
  if (bashRuns) {
    const hb = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-sh-twin-'));
    const hn = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mjs-twin-'));
    const CL = '2026-09-07T04:12:00Z | CLAIM | unit=U7 | agent=builder-b | model=builder | plan=wire the contact form';
    let shRc = 0;
    let shErr = '';
    try {
      execFileSync('bash', [bashLedger, hb, LEDGER, CL], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    } catch (e) { shRc = typeof e.status === 'number' ? e.status : 1; shErr = String(e.stderr || e.message); }
    write(hn, LEDGER, CL);
    const rd = (h, f) => { try { return fs.readFileSync(path.join(h, f)); } catch { return Buffer.alloc(0); } };
    const sameLedger = rd(hb, LEDGER).equals(rd(hn, LEDGER));
    const sameIntents = rd(hb, 'CONTROL/last-intents.txt').equals(rd(hn, 'CONTROL/last-intents.txt'));
    if (shRc === 0 && rc === 0 && sameLedger && sameIntents
        && rd(hn, LEDGER).toString('utf8') === `${CL}${LEDGER_WRITER_SIG}\n`) {
      ok(`twin proof: the CLAIM line and the intent window are BYTE-IDENTICAL to tools/ledger.sh's (${rd(hn, LEDGER).length} bytes, LF-terminated)`);
    } else {
      bad('twin proof: byte-identical to tools/ledger.sh',
        `sh_rc=${shRc} mjs_rc=${rc} ledger_same=${sameLedger} intents_same=${sameIntents} sh=[${rd(hb, LEDGER).toString('utf8')}] mjs=[${rd(hn, LEDGER).toString('utf8')}] sh_err=${shErr}`);
    }
    fs.rmSync(hb, { recursive: true, force: true });
    fs.rmSync(hn, { recursive: true, force: true });
  } else {
    // UNDETERMINED is a correct answer and is better than a confident pass.
    console.log(`UNDETERMINED | twin proof against tools/ledger.sh NOT run | reason=${bashWhy} | consequence=byte-identity with the bash twin is unproven on this box; every other case above still ran`);
  }

  fs.rmSync(home, { recursive: true, force: true });
  console.log(`ledger.mjs --selftest | passes=${passes} fails=${fails}`);
  return fails > 0 ? 1 : 0;
}

// --- CLI ---------------------------------------------------------------------
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--selftest') {
    process.exit(selftest());
  }
  if (argv.length < 3) {
    console.error('Usage: node ledger.mjs <home> <file> <line> [upsert-key]  |  node ledger.mjs --selftest');
    process.exit(1);
  }
  const out = ledgerWrite(argv[0], argv[1], argv[2], argv[3] || '');
  for (const m of out.err) console.error(m);
  if (out.target) console.log(`LEDGER | ${out.target}`);
  process.exit(out.code);
}
