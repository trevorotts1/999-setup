#!/usr/bin/env node
/**
 * WS-45 suite runner — one command, one verdict, one JSON report.
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 *
 * Runs, in order:
 *   1. contract unit tests (node --test tests/performance/unit/) — FAIL -> stop
 *   2. phase-harness contract check (real WS-08 machine + WS-24 probe)
 *   3. REAL measurements: idle app window, whisper-listening window,
 *      say/Kokoro-speaking window, latency instruments
 *   4. threshold gate (imports WS-24/WS-30 registries) + latency budgets
 *   5. JSON report + verdict
 *
 * Verdict rule: every required metric must be measured and every gate
 * must pass. A measurement that could not run is reported and FAILS the
 * run unless it is explicitly in the honest-skip table of this lane
 * (only for platform-native probes that need a host this box is not,
 * e.g. Windows native probes on macOS — WS-30's own declared rule).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createReport } from './lib/schema.mjs';
import { measureStt, measureTts, measureAppIdle } from './lib/engines.mjs';
import { checkLatency, LATENCY_THRESHOLDS_MS } from './lib/latency.mjs';
import { loadThresholdRegistries, gateReport } from './lib/thresholds-gate.mjs';
import {
  loadRealModules,
  driveMachineToPhase,
  enforceTitleContract,
} from './lib/phase-harness.mjs';
import { hostPlatform } from './lib/platform.mjs';

const has = (name) => process.argv.includes(`--${name}`);
const QUICK = has('quick');
const IDLE_MS = Number(process.env.CANDICE_PERF_IDLE_MS || (QUICK ? 3000 : 8000));
const ENGINE_MS = Number(process.env.CANDICE_PERF_ENGINE_MS || (QUICK ? 3000 : 5000));
const INTERVAL_MS = Number(process.env.CANDICE_PERF_INTERVAL_MS || (QUICK ? 300 : 500));
const REPORTS_DIR = path.resolve('tests/performance/reports');

async function main() {
  const report = createReport(['macos', 'windows']);
  const failures = [];
  const skips = [];

  // ---- 1. unit tests (contract) -----------------------------------------
  if (!has('live-only')) {
    const unitDir = path.join(process.cwd(), 'tests/performance/unit');
    const unitFiles = readdirSync(unitDir)
      .filter((f) => f.endsWith('.test.mjs'))
      .sort()
      .map((f) => path.join(unitDir, f));
    const unit = spawnSync(process.execPath, ['--test', ...unitFiles], {
      encoding: 'utf8',
      timeout: 300_000,
    });
    if (unit.status !== 0) {
      failures.push(
        `unit tests failed (exit ${unit.status}):\n${unit.stdout}\n${unit.stderr}`,
      );
      report.verdict.failures.push(...failures);
      finalize(report, 1);
      return;
    }
    console.log('[ws45] unit tests green');
  }

  // ---- 2. phase harness + title contract (real modules) ------------------
  const modules = await loadRealModules();
  if (!modules.ok) {
    failures.push(`phase harness: ${modules.note}`);
  } else {
    const contract = enforceTitleContract(modules.machine, modules.probe, modules.status);
    report.titleContract = {
      ok: contract.ok,
      violations: contract.violations,
      statusModuleLoaded: Boolean(modules.status),
    };
    if (!contract.ok) {
      failures.push(...contract.violations.map((v) => `title contract: ${v}`));
    } else {
      console.log('[ws45] phase-harness title contract enforced (real WS-08 machine + WS-24 probe)');
    }
    // Drive each phase through the REAL machine — proof the statuses the
    // app's own reducer accepts are exactly the measured ones.
    for (const phase of ['idle', 'speaking', 'listening']) {
      const driven = driveMachineToPhase(modules.machine, phase);
      if (!driven.ok) {
        failures.push(`machine rejected phase ${phase}: ${driven.note}`);
      }
    }
  }

  // ---- 3. real measurements ---------------------------------------------
  const platform = hostPlatform();
  const { macos: regMacOS, windows: regWindows, notes: registryNotes } =
    await loadThresholdRegistries();
  report.registryNotes = registryNotes;

  const stt = await measureStt({ sampleWindowMs: ENGINE_MS, sampleIntervalMs: INTERVAL_MS });
  const tts = await measureTts({ sampleWindowMs: ENGINE_MS, sampleIntervalMs: INTERVAL_MS });
  const idleSteady = await measureAppIdle({
    warmupMs: QUICK ? 2000 : 6000,
    sampleWindowMs: IDLE_MS,
    sampleIntervalMs: INTERVAL_MS,
    measureFirstVisible: !has('no-first-visible'),
  });

  report.measurements = { stt, tts, idleApp: idleSteady };

  if (stt.status === 'ok') {
    console.log(
      `[ws45] STT listening: release→transcript ${stt.latencyMs}ms, ` +
        `transcript="${(stt.transcript ?? '').slice(0, 40)}...", ` +
        `cpuMean=${stt.window?.cpuPercentMean?.toFixed(2)}% rssMax=${stt.window?.rssMiBMax?.toFixed(1)}MiB`,
    );
  } else {
    console.log(`[ws45] STT listening: UNAVAILABLE — ${stt.note}`);
  }
  if (tts.status === 'ok') {
    console.log(
      `[ws45] TTS speaking: firstAudio=${tts.latencyFirstAudioMs}ms ` +
        `cpuMean=${tts.window?.cpuPercentMean?.toFixed(2)}% rssMax=${tts.window?.rssMiBMax?.toFixed(1)}MiB`,
    );
  } else {
    console.log(`[ws45] TTS speaking: UNAVAILABLE — ${tts.note}`);
  }
  if (idleSteady.status === 'ok') {
    console.log(
      `[ws45] app idle: cpuMean=${idleSteady.window?.cpuPercentMean?.toFixed(2)}% ` +
        `rssMax=${idleSteady.window?.rssMiBMax?.toFixed(1)}MiB`,
    );
  } else {
    console.log(`[ws45] app idle: UNAVAILABLE — ${idleSteady.note}`);
  }
  if (idleSteady.firstVisible?.ok) {
    console.log(
      `[ws45] first-visible: window mapped at ${idleSteady.firstVisible.mappedAtMs}ms ` +
        `(title="${idleSteady.firstVisible.windows?.[0] ?? ''}")`,
    );
  } else {
    console.log(
      `[ws45] first-visible: UNAVAILABLE — ${idleSteady.firstVisible?.note ?? idleSteady.note}`,
    );
  }

  // ---- 4. gates ----------------------------------------------------------
  const metricQueue = [
    [
      'ptt-release-to-transcript',
      stt.status === 'ok' ? stt.latencyMs : null,
      'macos',
      stt.status === 'ok' ? 'ws16 whisper-cli real run (canonical jfk.wav fixture)' : stt.note,
    ],
    [
      'first-spoken-audio',
      tts.status === 'ok' ? tts.latencyFirstAudioMs : null,
      'macos',
      tts.status === 'ok' ? tts.note : tts.note,
    ],
    [
      'time-to-first-visible',
      idleSteady.firstVisible?.ok ? idleSteady.firstVisible.mappedAtMs : null,
      'macos',
      idleSteady.firstVisible?.ok
        ? `real app window mapped via CGWindowList (title "${idleSteady.firstVisible.windows?.[0] ?? ''}")`
        : idleSteady.firstVisible?.note ?? 'no window measurement',
    ],
  ];
  for (const [key, value, platformOn, note] of metricQueue) {
    const gate =
      value === null
        ? {
            key,
            ok: false,
            valueMs: null,
            budgetMs: LATENCY_THRESHOLDS_MS[key]?.budgetMs ?? null,
            violation: `${key}: not measured — ${note}`,
          }
        : checkLatency(key, value);
    report.metrics.push({
      key,
      phase:
        key === 'ptt-release-to-transcript'
          ? 'ptt'
          : key === 'time-to-first-visible'
            ? 'activation'
            : 'speaking',
      platform: platformOn,
      status: gate.ok ? 'ok' : 'unavailable',
      valueMs: gate.valueMs,
      budgetMs: gate.budgetMs,
      note,
      provenance: note,
      measuredAt: new Date().toISOString(),
      gateOk: gate.ok,
      violation: gate.violation,
    });
    if (!gate.ok) {
      failures.push(gate.violation);
    } else {
      console.log(`[ws45] latency ${key}: ${gate.valueMs}ms <= ${gate.budgetMs}ms PASS`);
    }
  }

  // Phase gates per platform.
  const macWindows = {
    idle: idleSteady.status === 'ok' ? idleSteady.window : null,
    speaking: tts.status === 'ok' ? tts.window : null,
    listening: stt.status === 'ok' ? stt.window : null,
  };
  const macGate = gateReport({ platform: 'macos', windows: macWindows, registry: regMacOS });
  report.phases.push(...macGate.results);
  for (const r of macGate.results) {
    if (!r.gateOk) failures.push(`${r.phase}: ${r.violations.join('; ')}`);
  }
  const windowsGate = gateReport({ platform: 'windows', windows: {}, registry: regWindows });
  report.phases.push(...windowsGate.results);
  for (const r of windowsGate.results) {
    if (!r.gateOk) {
      skips.push(
        `windows/${r.phase}: ${r.note} — requires a real Windows x64 host ` +
          '(WS-30 native probe; release-blocking at WS-46 smoke)',
      );
    }
  }

  // ---- 5. verdict --------------------------------------------------------
  report.verdict.ok = failures.length === 0;
  report.verdict.failures = failures;
  report.verdict.skippedReasons = skips;
  finalize(report, failures.length === 0 ? 0 : 1);
}

function finalize(report, exitCode) {
  if (!has('no-report')) {
    try {
      mkdirSync(REPORTS_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(REPORTS_DIR, `perf-${stamp}.json`);
      writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
      console.log(`[ws45] report: ${file}`);
    } catch (err) {
      console.error(`[ws45] report write failed: ${err.message}`);
    }
  }
  if (report.verdict.failures.length) {
    console.error('[ws45] GATE FAIL');
    for (const f of report.verdict.failures) console.error(`  - ${f}`);
  } else {
    console.log('[ws45] GATE PASS');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[ws45] runner crashed: ${err.stack ?? err}`);
  process.exit(3); // tooling failure, not a violation
});
