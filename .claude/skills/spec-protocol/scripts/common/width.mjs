// width.mjs — the Node twin of tools/width.sh (E6 step 2: the enforcement kit
// must run where bash does not — native Windows PowerShell, chiefly).
//
// Usage: node scripts/common/width.mjs              print the three lines
//        node scripts/common/width.mjs --selftest   three fixtures + no-instrument
//
// IDENTICAL OUTPUT to tools/width.sh: the same three KEY=VALUE lines, the same
// bracketed provenance marks, the same exit codes (0 / 2 / 64), the same
// WIDTH_FIXTURE_CORES / WIDTH_FIXTURE_RAM_GB / WIDTH_FIXTURE_NO_INSTRUMENT test
// door. The formula is copied, not reinterpreted:
//
//     harness_cap = min(16, cores − 2)
//     ram_cap     = floor((ram_gb − 6) / 1.5)
//     CLIENT_CAP  = max(2, min(harness_cap, ram_cap))
//     BROWSER_CAP = floor((ram_gb − 6) / 1.5)
//     WORKFLOW_CEILING = 50            operator doctrine 2026-08-16, hard
//
// Integer arithmetic mirrors bash exactly: bytes / 1073741824 and kB / 1048576
// are floored, and ram_cap is ((ram_gb − 6) * 2) / 3 floored, so the two twins
// can never disagree by a rounding rule.
//
// ONE DELIBERATE DIFFERENCE, and the reason for the port: Node carries its own
// instrument (os.cpus() / os.totalmem()), so it is tried LAST, after the same
// shell instruments width.sh uses, and it names itself "node-os.cpus" /
// "node-os.totalmem" in the mark. That is what lets the gate answer on a
// PowerShell-only Windows box where no bash tool can run at all. Everything
// earlier in the order is the same instrument in the same position, so on a box
// where width.sh answers, both twins print the same instrument name.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const WORKFLOW_CEILING = Number(process.env.WORKFLOW_CEILING || 50);

const CORE_SOURCES = 'sysctl-hw.ncpu, nproc, $NUMBER_OF_PROCESSORS, wmic, powershell, node-os.cpus';
const RAM_SOURCES  = 'sysctl-hw.memsize, /proc/meminfo MemTotal, wmic, powershell, node-os.totalmem';

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Run an instrument. A command that does not exist, or that fails, is NOT an
// answer of zero — it is silence, and the next instrument is tried.
function run(cmd, args) {
  try {
    return String(execFileSync(cmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      encoding: 'utf8',
    })).replace(/\r/g, '').trim();
  } catch {
    return '';
  }
}

function firstPositiveInt(text) {
  if (!text) return null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^\d+$/.test(t) && Number(t) > 0) return Number(t);
  }
  return null;
}

// --- Measure cores. Never inherit a number. ---------------------------------
// Returns { n, instrument } or null — the instrument NAMES itself so the mark
// can say which one answered.
export function measureCores() {
  let v = firstPositiveInt(run('sysctl', ['-n', 'hw.ncpu']));
  if (v) return { n: v, instrument: 'sysctl-hw.ncpu' };

  v = firstPositiveInt(run('nproc', []));
  if (v) return { n: v, instrument: 'nproc' };

  v = firstPositiveInt(process.env.NUMBER_OF_PROCESSORS || '');
  if (v) return { n: v, instrument: 'env-NUMBER_OF_PROCESSORS' };

  const wmic = run('wmic', ['cpu', 'get', 'NumberOfLogicalProcessors']);
  if (wmic) {
    let sum = 0;
    for (const line of wmic.split('\n')) {
      const t = line.trim();
      if (/^\d+$/.test(t)) sum += Number(t);
    }
    if (sum > 0) return { n: sum, instrument: 'wmic-NumberOfLogicalProcessors' };
  }

  v = firstPositiveInt(run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '[Environment]::ProcessorCount']));
  if (v) return { n: v, instrument: 'powershell-ProcessorCount' };

  // Node's own instrument, tried last — this is the line that answers on a
  // PowerShell-only Windows box.
  const cpus = Array.isArray(os.cpus()) ? os.cpus().length : 0;
  if (cpus > 0) return { n: cpus, instrument: 'node-os.cpus' };

  return null;   // UNDETERMINED is a correct answer
}

// --- Measure RAM in whole GB. Never inherit a number. ------------------------
export function measureRamGb() {
  const bytesToGb = (b) => Math.floor(b / 1073741824);

  let v = firstPositiveInt(run('sysctl', ['-n', 'hw.memsize']));
  if (v) return { gb: bytesToGb(v), instrument: 'sysctl-hw.memsize' };

  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const m = meminfo.match(/^MemTotal:\s+(\d+)/m);
    if (m) return { gb: Math.floor(Number(m[1]) / 1048576), instrument: 'proc-meminfo-MemTotal' };
  } catch { /* not Linux, or unreadable — silence, not zero */ }

  v = firstPositiveInt(run('wmic', ['ComputerSystem', 'get', 'TotalPhysicalMemory']));
  if (v) return { gb: bytesToGb(v), instrument: 'wmic-TotalPhysicalMemory' };

  v = firstPositiveInt(run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory']));
  if (v) return { gb: bytesToGb(v), instrument: 'powershell-TotalPhysicalMemory' };

  const total = os.totalmem();
  if (total > 0) return { gb: bytesToGb(total), instrument: 'node-os.totalmem' };

  return null;
}

// --- THE WIDTH FORMULA (S1) — copied from tools/width.sh, arithmetic unchanged.
export function harnessCapOf(cores) {
  let w = cores - 2;
  if (w > 16) w = 16;
  if (w < 1) w = 1;
  return w;
}

export function ramCapOf(ramGb) {
  if (ramGb <= 6) return 0;
  return Math.floor(((ramGb - 6) * 2) / 3);   // floor((ram_gb − 6) / 1.5)
}

export function clientCapOf(harnessCap, ramCap) {
  let c = harnessCap;
  if (ramCap !== null && ramCap !== undefined && ramCap !== '' && ramCap < c) c = ramCap;
  if (c < 2) c = 2;
  return c;
}

export function browserCapOf(ramGb) {
  return ramCapOf(ramGb);   // each blind visual judge holds a Chromium
}

// =============================================================================
// THE REPORT — the only layer that reads WIDTH_FIXTURE_* (same rule as the
// bash twin: the measure functions stay pure instruments).
// Returns { lines: [...stdout], notes: [...stderr], code }.
// =============================================================================
export function widthReport(env = process.env) {
  const now = nowUtc();
  const ceilingMark = `[DEFAULT-CONFIRMED operator-doctrine-2026-08-16 ${now}]`;
  const lines = [];
  const notes = [];

  let cores = null, coresInstr = '', coresKind = '';
  let ram = null, ramInstr = '', ramKind = '';

  if (String(env.WIDTH_FIXTURE_NO_INSTRUMENT || '0') === '1') {
    coresKind = 'UNDETERMINED'; ramKind = 'UNDETERMINED';
    coresInstr = 'fixture: every instrument silenced';
    ramInstr = 'fixture: every instrument silenced';
  } else {
    const fc = env.WIDTH_FIXTURE_CORES;
    if (fc !== undefined && fc !== '') {
      if (!/^\d+$/.test(String(fc)) || Number(fc) < 1) {
        notes.push(`ERROR: WIDTH_FIXTURE_CORES must be a positive whole number (got: ${fc})`);
        return { lines, notes, code: 64 };
      }
      cores = Number(fc); coresInstr = 'WIDTH_FIXTURE_CORES'; coresKind = 'FIXTURE';
    } else {
      const m = measureCores();
      if (m) { cores = m.n; coresInstr = m.instrument; coresKind = 'MEASURED'; }
      else { coresKind = 'UNDETERMINED'; coresInstr = `none (tried ${CORE_SOURCES})`; }
    }

    const fr = env.WIDTH_FIXTURE_RAM_GB;
    if (fr !== undefined && fr !== '') {
      if (!/^\d+$/.test(String(fr)) || Number(fr) < 1) {
        notes.push(`ERROR: WIDTH_FIXTURE_RAM_GB must be a positive whole number of GB (got: ${fr})`);
        return { lines, notes, code: 64 };
      }
      ram = Number(fr); ramInstr = 'WIDTH_FIXTURE_RAM_GB'; ramKind = 'FIXTURE';
    } else {
      const m = measureRamGb();
      if (m && m.gb >= 1) { ram = m.gb; ramInstr = m.instrument; ramKind = 'MEASURED'; }
      else { ramKind = 'UNDETERMINED'; ramInstr = `none (tried ${RAM_SOURCES})`; }
    }
  }

  // --- NEITHER instrument answered: the only exit 2 --------------------------
  if (coresKind === 'UNDETERMINED' && ramKind === 'UNDETERMINED') {
    lines.push(`CLIENT_CAP=UNDETERMINED   [UNDETERMINED cores: ${coresInstr}; ram: ${ramInstr} ${now}]`);
    lines.push(`BROWSER_CAP=UNDETERMINED   [UNDETERMINED ram: ${ramInstr} ${now}]`);
    lines.push(`WORKFLOW_CEILING=${WORKFLOW_CEILING}   ${ceilingMark}`);
    notes.push(`NOTE: neither instrument answered — cores tried ${CORE_SOURCES}; ram tried ${RAM_SOURCES}.`);
    notes.push('      The caller uses clientCap 4 AND SAYS SO in the ledger. It never stalls, and it never asks.');
    return { lines, notes, code: 2 };
  }

  let clientCap, capKind, capInstr;
  if (coresKind === 'UNDETERMINED') {
    clientCap = 4;
    capKind = 'ASSUMED';
    capInstr = `no-instrument — cores unmeasurable (tried ${CORE_SOURCES}), clientCap fallback 4`;
  } else {
    const harnessCap = harnessCapOf(cores);
    if (ramKind === 'UNDETERMINED') {
      clientCap = clientCapOf(harnessCap, null);
      capKind = coresKind;
      capInstr = `${coresInstr} ${now}; ram UNDETERMINED (tried ${RAM_SOURCES}) — harness cap governs`;
    } else {
      clientCap = clientCapOf(harnessCap, ramCapOf(ram));
      capKind = (coresKind === 'FIXTURE' || ramKind === 'FIXTURE') ? 'FIXTURE' : 'MEASURED';
      capInstr = `${coresInstr}+${ramInstr} ${now}`;
    }
  }

  lines.push(`CLIENT_CAP=${clientCap}   [${capKind} ${capInstr}]`);

  if (ramKind === 'UNDETERMINED') {
    lines.push(`BROWSER_CAP=UNDETERMINED   [UNDETERMINED ram: none (tried ${RAM_SOURCES}) ${now}]`);
  } else {
    lines.push(`BROWSER_CAP=${browserCapOf(ram)}   [${ramKind} ${ramInstr} ${now}]`);
  }

  lines.push(`WORKFLOW_CEILING=${WORKFLOW_CEILING}   ${ceilingMark}`);

  if (coresKind === 'FIXTURE' || ramKind === 'FIXTURE') {
    notes.push('NOTE: a WIDTH_FIXTURE_* override is active — this run is a FIXTURE, not a measurement.');
  }
  return { lines, notes, code: 0 };
}

// =============================================================================
// THE SELFTEST — the same four cases as tools/width.sh, plus the live control.
// =============================================================================
function selftest() {
  let fails = 0;
  const capOf = (lines, key) => {
    const l = lines.find((x) => x.startsWith(`${key}=`));
    return l ? l.slice(key.length + 1).split(/\s/)[0] : '<none>';
  };

  console.log('SELFTEST — width.mjs');
  console.log('');
  console.log('FIXTURES — the S1 worked values');
  for (const [label, c, r, wantC, wantB] of [
    ['operator Mac mini', 12, 24, '10', '12'],
    ['8-core, 16 GB laptop', 8, 16, '6', '6'],
    ['24-core, 64 GB Studio', 24, 64, '16', '38'],
  ]) {
    const out = widthReport({ WIDTH_FIXTURE_CORES: String(c), WIDTH_FIXTURE_RAM_GB: String(r) });
    const gotC = capOf(out.lines, 'CLIENT_CAP');
    const gotB = capOf(out.lines, 'BROWSER_CAP');
    const fixtureMarked = out.lines.some((l) => l.includes('[FIXTURE '));
    const claimsMeasured = out.lines.some((l) => l.includes('[MEASURED '));
    if (out.code === 0 && gotC === wantC && gotB === wantB && fixtureMarked && !claimsMeasured) {
      console.log(`  [PASS] ${label}: ${c} cores, ${r} GB → CLIENT_CAP ${gotC}, BROWSER_CAP ${gotB}, exit 0`);
    } else {
      console.log(`  [FAIL] ${label}: exit ${out.code}, CLIENT_CAP ${gotC} (want ${wantC}), BROWSER_CAP ${gotB} (want ${wantB}), fixture-marked=${fixtureMarked}, claims-measured=${claimsMeasured}`);
      fails += 1;
    }
  }

  console.log('NO INSTRUMENT — neither answers → exit 2, and the sources are named');
  const ni = widthReport({ WIDTH_FIXTURE_NO_INSTRUMENT: '1' });
  if (ni.code === 2) console.log('  [PASS] no instrument → exit 2 (the caller uses 4 and says so)');
  else { console.log(`  [FAIL] no instrument → exit ${ni.code}, expected 2`); fails += 1; }
  if (capOf(ni.lines, 'CLIENT_CAP') === 'UNDETERMINED') console.log('  [PASS] no instrument → CLIENT_CAP=UNDETERMINED, never a silent number');
  else { console.log('  [FAIL] no instrument → CLIENT_CAP was not UNDETERMINED'); fails += 1; }
  if (ni.lines.some((l) => l.includes('[MEASURED '))) { console.log('  [FAIL] an unmeasurable box claimed a measurement'); fails += 1; }
  else console.log('  [PASS] an unmeasurable box never claims a measurement');
  if (ni.notes.join('\n').includes('sysctl-hw.ncpu')) console.log('  [PASS] the negative names the sources it tried');
  else { console.log('  [FAIL] the negative did not name the sources it tried'); fails += 1; }

  console.log('CONTROL — the live machine (if this fails, the CHECK is broken, not the box)');
  const live = widthReport({});
  const liveCap = capOf(live.lines, 'CLIENT_CAP');
  if (live.code === 0 && /^\d+$/.test(liveCap) && Number(liveCap) >= 2
      && live.lines.some((l) => l.includes('[MEASURED '))) {
    console.log(`  [PASS] live: CLIENT_CAP=${liveCap} with a [MEASURED …] mark, exit 0`);
  } else {
    console.log(`  [FAIL] live: exit ${live.code}, CLIENT_CAP=${liveCap}, mark check failed — this checker cannot be trusted`);
    fails += 1;
  }

  console.log('INSTRUMENT PROOF — a malformed fixture is refused, never used');
  const bad = widthReport({ WIDTH_FIXTURE_CORES: 'abc' });
  if (bad.code === 64 && bad.notes.join('\n').includes('WIDTH_FIXTURE_CORES must be a positive whole number')) {
    console.log('  [PASS] a non-numeric fixture is refused with a plain ERROR (exit 64)');
  } else {
    console.log(`  [FAIL] a non-numeric fixture was accepted (exit ${bad.code})`);
    fails += 1;
  }

  console.log('');
  if (fails === 0) {
    console.log('SELFTEST: PASS — all fixture, no-instrument, control and instrument checks passed');
    return 0;
  }
  console.log(`SELFTEST: FAIL (${fails} check(s) failed)`);
  return 1;
}

// --- CLI ---------------------------------------------------------------------
const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const arg = process.argv[2] || '';
  if (arg === '--selftest') {
    process.exit(selftest());
  } else if (arg === '' || arg === '--print') {
    const out = widthReport();
    for (const l of out.lines) console.log(l);
    for (const n of out.notes) console.error(n);
    process.exit(out.code);
  } else {
    console.error(`ERROR: unknown argument: ${arg} (usage: node width.mjs [--print|--selftest])`);
    process.exit(64);
  }
}
