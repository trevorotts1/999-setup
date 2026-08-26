/**
 * WS-45 unit tests — phase-enforcing harness against the REAL WS-08
 * state machine and the REAL WS-24 window probe (cross-lane READ only;
 * this lane never edits either).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 * These tests FAIL if the app's own state machine and the probe contract
 * drift apart — which is exactly the regression the harness exists to
 * catch at the WS-45 gate, in the same run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRealModules,
  driveMachineToPhase,
  enforceTitleContract,
} from '../lib/phase-harness.mjs';

test('real modules load from the app tree (WS-08 machine + WS-24 probe)', async () => {
  const modules = await loadRealModules();
  assert.equal(modules.ok, true, modules.note ?? '');
  assert.ok(modules.machine.createCandiceStateMachine, 'createCandiceStateMachine missing');
  assert.ok(modules.probe.WINDOW_TITLE_PREFIX, 'WINDOW_TITLE_PREFIX missing');
});

test('real machine reaches idle/speaking/listening through status events', async () => {
  const modules = await loadRealModules();
  for (const phase of ['idle', 'speaking', 'listening']) {
    const driven = driveMachineToPhase(modules.machine, phase);
    assert.equal(driven.ok, true, `${phase}: ${driven.note ?? ''}`);
    assert.equal(driven.status, phase);
  }
});

test('real machine rejects an (impossible) unknown phase', async () => {
  const modules = await loadRealModules();
  const driven = driveMachineToPhase(modules.machine, 'compacting');
  assert.equal(driven.ok, false);
});

test('WS-08 labels match the WS-24 probe title suffixes (title contract enforces)', async () => {
  const modules = await loadRealModules();
  const contract = enforceTitleContract(modules.machine, modules.probe, modules.status);
  assert.equal(contract.ok, true, contract.violations.join('\n'));
});

test('probe round-trip: "Candice — Listening" classifies as listening', async () => {
  const modules = await loadRealModules();
  const title = `${modules.probe.WINDOW_TITLE_PREFIX}${modules.probe.PHASE_TITLE_SUFFIXES.listening}`;
  const probeResult = modules.probe.probeCandiceWindowTitle({ listTitles: () => [title] });
  assert.equal(probeResult.phase, 'listening');
  assert.equal(probeResult.title, title);
});

test('nearestPhase maps transcribing->listening, speaking->speaking, idle default', async () => {
  const modules = await loadRealModules();
  assert.equal(modules.probe.nearestPhase('transcribing'), 'listening');
  assert.equal(modules.probe.nearestPhase('speaking'), 'speaking');
  assert.equal(modules.probe.nearestPhase('building'), 'idle');
});
