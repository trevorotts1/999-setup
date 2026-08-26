/**
 * WS-45 phase-enforcing harness — the harness WS-24's cross-lane finding
 * says is missing ("real-app windows require the WS-45 phase-enforcing
 * harness"). This turns the REAL WS-08 state machine's status events into
 * phase windows and enforces the WS-24 window-title contract while each
 * phase is active.
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 * The state machine lives in the WS-08 lane; this lane IMPORTS it (read
 * only) and never edits it. Cross-lane read is how a test suite verifies
 * real production code paths (spec 28: measured against the real thing,
 * not a mock).
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const MACHINE_ENTRY = path.resolve(
  process.cwd(),
  'apps/candice-companion/src/state/machine.ts',
);
const PROBE_ENTRY = path.resolve(
  process.cwd(),
  'apps/candice-companion/src/platform/macos/instrumentation/window-probe.ts',
);
const STATUS_ENTRY = path.resolve(
  process.cwd(),
  'apps/candice-companion/src/state/status.ts',
);

function abs(p) {
  return pathToFileURL(p).href;
}

/**
 * Load the REAL production modules. If the app tree is missing, the
 * harness degrades and every window records unavailable — WS-45 never
 * ships a mock of the state machine (that would prove nothing).
 */
export async function loadRealModules() {
  if (!existsSync(MACHINE_ENTRY)) {
    return { ok: false, note: `WS-08 state machine not found at ${MACHINE_ENTRY}` };
  }
  if (!existsSync(PROBE_ENTRY)) {
    return { ok: false, note: `WS-24 window probe not found at ${PROBE_ENTRY}` };
  }
  const machine = await import(abs(MACHINE_ENTRY));
  const probe = await import(abs(PROBE_ENTRY));
  const status = existsSync(STATUS_ENTRY) ? await import(abs(STATUS_ENTRY)) : null;
  return { ok: true, machine, probe, status };
}

/**
 * Drive the real state machine into a measured phase with real status
 * events — the same events the bridge delivers (spec 13.2). Returns the
 * phase names the machine reached, or a violation note.
 *
 * Phase contract (WS-24 window-probe):
 *   idle     <- CandiceStatus 'idle'
 *   speaking <- 'speaking'
 *   listening <- 'listening' | 'transcribing'
 */
export function driveMachineToPhase(machineApi, phase) {
  const machine = machineApi.createCandiceStateMachine();
  // session:begin puts the machine in the interview phase with status idle.
  machine.transition({ type: 'session:begin' });
  const statusFor = {
    idle: 'idle',
    speaking: 'speaking',
    listening: 'listening',
  };
  const target = statusFor[phase];
  if (!target) {
    return { ok: false, note: `unknown phase ${phase}` };
  }
  const result = machine.transition({ type: 'status', detail: target });
  if (result === null) {
    // The real machine reports null for a NO-OP (sameState) as well as a
    // rejection. The initial state already IS idle — so a null for a
    // status the current state already carries is a successful drive.
    const s = machine.getState();
    if (s.status === target) {
      return { ok: true, status: s.status, phase: s.phase, note: 'already in target status (no-op)' };
    }
    return { ok: false, note: `status ${target} rejected by the real state machine` };
  }
  const state = machine.getState();
  return { ok: true, status: state.status, phase: state.phase };
}

/**
 * Enforce the exact title contract WS-24 measures: for each phase, the
 * machine's real status label must equal the suffix the window probe
 * classifies as that phase. Uses CANDICE_STATUS_LABELS from the real
 * WS-08 status module and PHASE_TITLE_SUFFIXES from the real WS-24 probe.
 * Any mismatch is a contract break between state machine and probe.
 */
export function enforceTitleContract(machineApi, probeApi, statusApi) {
  const labels = statusApi ? statusApi.CANDICE_STATUS_LABELS : null;
  const suffixMap = probeApi.PHASE_TITLE_SUFFIXES; // { idle:'Idle', speaking:'Speaking', listening:'Listening' }
  const violations = [];
  for (const [phase, marker] of Object.entries(suffixMap)) {
    if (labels) {
      const statusKey = { idle: 'idle', speaking: 'speaking', listening: 'listening' }[phase];
      const expected = labels[statusKey];
      if (expected !== marker) {
        violations.push(
          `title contract break: WS-08 label for '${statusKey}' is "${expected}" but WS-24 probe suffix is "${marker}"`,
        );
      }
    }
  }
  // Round-trip through the probe's own classifier: 'Candice — <marker>'
  // must classify as <phase> (the exact string the probe reads on the box).
  for (const [phase, marker] of Object.entries(suffixMap)) {
    const title = `${probeApi.WINDOW_TITLE_PREFIX}${marker}`;
    const classified = { ...probeApi }.classifyTitle?.(title);
    if (classified !== phase) {
      violations.push(
        `title contract break: probe classifies "${title}" as ${classified}, expected ${phase}`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}
