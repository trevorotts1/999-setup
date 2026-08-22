/**
 * WS-24 window-probe tests — phase detection contract (spec 19/11).
 *
 * Runner: plain Node >= 22.6 with type stripping. `node --test
 * src/platform/macos/instrumentation/__tests__/window-probe.test.ts`.
 *
 * Proven here: the phase contract is exact (idle/speaking/listening
 * suffixes), an unknown suffix under the Candice prefix never throws and
 * classifies idle (best effort), a missing Candice window yields a
 * `null` phase with a one-line note, and the probe is total even when
 * the title source itself throws (spec 20).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  probeCandiceWindowTitle,
  classifyTitle,
  nearestPhase,
  WINDOW_TITLE_PREFIX,
  PHASE_TITLE_SUFFIXES,
} from '../window-probe.ts';

test('classifyTitle — exact phase suffixes', () => {
  assert.equal(classifyTitle(`${WINDOW_TITLE_PREFIX}Idle`), 'idle');
  assert.equal(classifyTitle(`${WINDOW_TITLE_PREFIX}Speaking`), 'speaking');
  assert.equal(classifyTitle(`${WINDOW_TITLE_PREFIX}Listening`), 'listening');
});

test('classifyTitle — non-Candice title is null', () => {
  assert.equal(classifyTitle('Terminal — zsh'), null);
  assert.equal(classifyTitle(''), null);
});

test('classifyTitle — unknown suffix under prefix classifies idle, never throws', () => {
  assert.equal(classifyTitle(`${WINDOW_TITLE_PREFIX}Transcribing`), 'idle');
});

test('PHASE_TITLE_SUFFIXES — contract matches WS-08 measured statuses', () => {
  assert.deepEqual(Object.keys(PHASE_TITLE_SUFFIXES).sort(), ['idle', 'listening', 'speaking']);
});

test('probeCandiceWindowTitle — finds the app window among many', () => {
  const result = probeCandiceWindowTitle({
    listTitles: () => ['Finder', 'Terminal — zsh', `${WINDOW_TITLE_PREFIX}Speaking`],
  });
  assert.equal(result.phase, 'speaking');
  assert.equal(result.title, `${WINDOW_TITLE_PREFIX}Speaking`);
  assert.equal(result.note, '');
});

test('probeCandiceWindowTitle — no Candice window yields null + note', () => {
  const result = probeCandiceWindowTitle({
    listTitles: () => ['Finder', 'Terminal — zsh'],
  });
  assert.equal(result.phase, null);
  assert.equal(result.title, null);
  assert.match(result.note, /no Candice window title found \(2 candidate/);
});

test('probeCandiceWindowTitle — throwing title source degrades, never throws (spec 20)', () => {
  const result = probeCandiceWindowTitle({
    listTitles: () => {
      throw new Error('window list denied');
    },
  });
  assert.equal(result.phase, null);
  assert.match(result.note, /probe failed/);
});

test('nearestPhase — WS-08 statuses map onto the three measured phases', () => {
  assert.equal(nearestPhase('idle'), 'idle');
  assert.equal(nearestPhase('thinking'), 'idle');
  assert.equal(nearestPhase('compact'), 'idle');
  assert.equal(nearestPhase('speaking'), 'speaking');
  assert.equal(nearestPhase('listening'), 'listening');
  assert.equal(nearestPhase('transcribing'), 'listening');
  assert.equal(nearestPhase('building'), 'idle');
});
