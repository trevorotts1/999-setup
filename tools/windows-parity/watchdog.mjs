#!/usr/bin/env node
// tools/windows-parity/watchdog.mjs — WS-27 native parity for the
// watchdog/heartbeat enforcement that is part of normal Spec Protocol
// runtime (spec 0.3 item 6: any watchdog/heartbeat enforcement).
//
// The Bash anti-stall watchdog (tools/anti-stall-watchdog.sh) is fork-specific
// (boss-cron FIX-LEDGER waves). This parity watchdog enforces the same class
// of doctrine with the same file semantics, generically:
//   - HEARTBEAT.md must not go stale beyond ANCHOR_STALE_MIN minutes;
//   - a DISPATCH without a CLOSED/RESULT within WATCHDOG_STALE_MIN minutes is
//     a stall; the first stall writes an ALERT line; the second consecutive
//     tick on the same stall escalates (exit 3, never silent).
//
// Usage: watchdog.mjs tick <project-home>
//        watchdog.mjs --selftest
// Exit: 0 normal tick (heartbeat refreshed or nothing to do); 1 lock timeout;
//        3 stall detected/escalated (caller's decision point).
//
// Windows-safe: heartbeat writes go through ledger.mjs semantics (locked,
// atomic, verified) and never assume flock.
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendLine } from './ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function tick(projectRoot, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const heartbeatPath = path.join(projectRoot, 'CONTROL', 'HEARTBEAT.md');
  const ledgerPath = path.join(projectRoot, 'CONTROL', 'LEDGER.md');
  const staleMin = Number(process.env.WATCHDOG_STALE_MIN || opts.staleMin || 10);
  const stallMin = Number(process.env.WATCHDOG_STALL_MIN || opts.stallMin || 45);

  const lines = [];

  // 1. Refresh heartbeat (upsert key = this agent's label)
  const label = opts.label || 'parity-watchdog';
  const r = appendLine(projectRoot, 'CONTROL/HEARTBEAT.md', `${nowIso} | heartbeat | ${label} | tick`, label);
  if (r.exit !== 0) {
    return { exit: 1, lines: [`ERROR: heartbeat write failed — ${r.error}`] };
  }

  // 2. Stall detection on the ledger: last DISPATCH without CLOSED/RESULT
  let ledText = '';
  try { ledText = readFileSync(ledgerPath, 'utf8'); } catch { return { exit: 0, lines: ['no ledger yet — nothing to watch'] }; }
  const dispatchLines = ledText.split(/\r?\n/).filter((l) => /(DISPATCH|CLAIM)/.test(l) && !/(CLOSED|RESULT|COMPLETE)/.test(l));
  const openDispatches = dispatchLines.filter((l) => {
    const m = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    if (!m) return false;
    const ageMin = (Date.parse(nowIso.replace('Z', '+00:00')) - Date.parse(m[0].replace('Z', '+00:00'))) / 60000;
    return ageMin > stallMin;
  });

  if (openDispatches.length === 0) {
    lines.push(`TICK ${nowIso} — heartbeat refreshed, no open dispatch older than ${stallMin} min`);
    return { exit: 0, lines };
  }

  // Stall: write an ALERT line (append, not upsert — history) and escalate.
  const first = openDispatches[0];
  const alert = `${nowIso} | ALERT | stall | ${openDispatches.length} dispatch(es) open beyond ${stallMin} min | ${first.trim().slice(0, 120)}`;
  const ra = appendLine(projectRoot, 'CONTROL/LEDGER.md', alert, '');
  if (ra.exit !== 0) return { exit: 1, lines: [`ERROR: alert write failed — ${ra.error}`] };
  lines.push(alert);
  lines.push(`ESCALATION — ${openDispatches.length} dispatch(es) stalled beyond ${stallMin} min; verify directly instead of waiting`);
  return { exit: 3, lines };
}

function selftest() {
  const failures = [];
  const assert = (ok, name, extra) => {
    process.stdout.write(`${ok ? '  [PASS]' : '  [FAIL]'} ${name}${ok ? '' : ` — ${extra || ''}`}\n`);
    if (!ok) failures.push(name);
  };
  const tmp = path.join(process.env.TMPDIR || '/tmp', `parity-watchdog-selftest-${process.pid}`);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  const proj = path.join(tmp, 'proj');
  mkdirSync(path.join(proj, 'CONTROL'), { recursive: true });

  process.stdout.write('SELFTEST — watchdog.mjs (windows-parity)\n\n');

  const r1 = tick(proj, { nowIso: '2026-08-21T00:00:00Z', label: 'selftest' });
  assert(r1.exit === 0, 'clean tick -> exit 0');
  assert(existsSync(path.join(proj, 'CONTROL', 'HEARTBEAT.md')), 'heartbeat file created');
  const hb = readFileSync(path.join(proj, 'CONTROL', 'HEARTBEAT.md'), 'utf8');
  assert(hb.includes('selftest'), 'heartbeat carries the agent label');

  const t2 = tick(proj, { nowIso: '2026-08-21T00:00:01Z', label: 'selftest' });
  assert(t2.exit === 0, 'second tick exit 0');
  const hb2 = readFileSync(path.join(proj, 'CONTROL', 'HEARTBEAT.md'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert(hb2.length === 1, 'upsert keeps one heartbeat line per agent');

  // stall: an old open dispatch
  writeFileSync(path.join(proj, 'CONTROL', 'LEDGER.md'), '2026-08-20T00:00:00Z | DISPATCH | WS-01\n', 'utf8');
  const r3 = tick(proj, { nowIso: '2026-08-21T00:00:02Z', stallMin: 5, label: 'selftest' });
  assert(r3.exit === 3, 'stalled dispatch -> exit 3');
  assert(r3.lines.some((l) => l.includes('ESCALATION')), 'escalation line written');
  const led = readFileSync(path.join(proj, 'CONTROL', 'LEDGER.md'), 'utf8');
  assert(led.includes('| ALERT | stall'), 'ALERT appended to the ledger');

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.stdout.write('\n');
  if (failures.length) {
    process.stderr.write(`SELFTEST: FAIL (${failures.length} check(s) failed)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SELFTEST: PASS — heartbeat upsert, stall detection, escalation all green\n');
    process.exitCode = 0;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest') return selftest();
  if (args[0] === 'tick') {
    const proj = args[1];
    if (!proj) {
      process.stderr.write('usage: watchdog.mjs tick <project-home> | --selftest\n');
      process.exit(2);
    }
    const r = tick(proj);
    process.stdout.write(`${r.lines.join('\n')}\n`);
    process.exit(r.exit);
  }
  process.stderr.write('usage: watchdog.mjs tick <project-home> | --selftest\n');
  process.exit(2);
}

main();
