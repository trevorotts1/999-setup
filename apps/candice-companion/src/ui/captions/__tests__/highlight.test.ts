/**
 * Caption sentence-highlighting (Trevor: "IT WOULD BE NICE IF THE SENTENCE WAS
 * HIGHLIGHTED AS SHE SPOKE").
 *
 * The invariant that matters most is NOT which sentence lights up -- it is that
 * highlighting never changes the words on screen. The view rebuilds the caption
 * out of these spans, so if splitSentences ever dropped or duplicated a
 * character the user would silently read a different question than the one the
 * protocol delivered.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitSentences, activeSentenceIndex, durationFromTimings } from '../highlight.ts';
import { attachCaptionHighlight, HIGHLIGHT_TICK_MS } from '../highlight-driver.ts';
import { SPEECH_START_EVENT, SPEECH_DRAIN_EVENT } from '../../../runtime/speech-timing.ts';

const REAL = 'I will build your idea from start to finish - designed, quality-checked, '
  + 'and deployed. You can walk away once we start and come back to it done.\n\n'
  + 'Two ways to begin. Pick whichever suits you:\n\n'
  + '1. Interview me. Tell me what you want to build in your own words.';

test('splitSentences preserves every character of the caption', () => {
  for (const text of [REAL, 'One.', '', 'no terminator', 'A! B? C.', '...', 'a\n\nb']) {
    const joined = splitSentences(text).map((s) => s.text).join('');
    assert.equal(joined, text, `text must survive splitting: ${JSON.stringify(text)}`);
  }
});

test('splitSentences finds the real questions sentences', () => {
  const s = splitSentences(REAL);
  assert.ok(s.length >= 4, `expected several sentences, got ${s.length}`);
  assert.ok(s[0]?.text.startsWith('I will build'));
});

test('a punctuation-only run never becomes its own highlightable sentence', () => {
  // "..." has no speakable characters; a zero-weight sentence could never be
  // reached by any fraction and would be dead space in the timeline.
  for (const s of splitSentences('Hello. ... World.')) {
    assert.ok(s.weight > 0, `zero-weight sentence: ${JSON.stringify(s.text)}`);
  }
});

test('activeSentenceIndex walks forward and never goes backwards', () => {
  const s = splitSentences(REAL);
  let last = -1;
  for (let f = 0; f <= 1.0001; f += 0.01) {
    const i = activeSentenceIndex(s, f);
    assert.ok(i >= last, `index went backwards at ${f}: ${i} < ${last}`);
    last = i;
  }
  assert.equal(activeSentenceIndex(s, 0), 0);
  assert.equal(activeSentenceIndex(s, 1), s.length - 1);
});

test('activeSentenceIndex clamps instead of throwing on junk', () => {
  const s = splitSentences(REAL);
  assert.equal(activeSentenceIndex(s, -5), 0);
  assert.equal(activeSentenceIndex(s, 99), s.length - 1);
  assert.equal(activeSentenceIndex(s, Number.NaN), -1);
  assert.equal(activeSentenceIndex([], 0.5), -1);
});

test('longer sentences get proportionally more of the timeline', () => {
  // "A." is far shorter than the long one, so most fractions land on the long
  // sentence. This is the whole basis of the mapping.
  const s = splitSentences('A. ' + 'w'.repeat(200) + '.');
  assert.equal(activeSentenceIndex(s, 0.5), 1);
});

test('durationFromTimings reads the real end of the utterance', () => {
  assert.equal(durationFromTimings([{ endSec: 0.5 }, { endSec: 2.25 }, { endSec: 1.0 }]), 2250);
  assert.equal(durationFromTimings([]), 0);
  assert.equal(durationFromTimings([{ endSec: Number.NaN }]), 0);
});

// ------------------------------------------------------------------- driver

function fakeApi() {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  return {
    handlers,
    api: {
      listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
        handlers.set(name, cb);
        return () => handlers.delete(name);
      },
    } as never,
  };
}

test('driver turns real timings into progress, and clears on drain', async () => {
  const seen: (number | null)[] = [];
  const { handlers, api } = fakeApi();
  let clock = 1000;
  // An array, not a `let`: TypeScript narrows a closure-assigned `let` to its
  // initializer type and then refuses to call it.
  const ticks: Array<() => void> = [];
  const driver = await attachCaptionHighlight((f) => seen.push(f), {
    listenApi: api,
    now: () => clock,
    setInterval: (fn) => { ticks.push(fn); return 1; },
    clearInterval: () => { ticks.length = 0; },
  });
  assert.equal(driver.listening, true);

  handlers.get(SPEECH_START_EVENT)?.({
    payload: { schemaVersion: '1.0', utteranceId: 'u-1', timings: [{ phoneme: 'a', startSec: 0, endSec: 4 }] },
  });
  assert.equal(seen.at(-1), 0, 'progress starts at 0');

  clock = 3000; ticks[0]?.();
  assert.equal(seen.at(-1), 0.5, '2s into a 4s utterance is halfway');

  clock = 99999; ticks[0]?.();
  assert.equal(seen.at(-1), 1, 'an overrun clamps to the last sentence, never wraps');

  handlers.get(SPEECH_DRAIN_EVENT)?.({ payload: { schemaVersion: '1.0', utteranceId: 'u-1' } });
  assert.equal(seen.at(-1), null, 'drain clears the highlight');
  driver.dispose();
});

test('a drain for a REPLACED utterance never clears the live highlight', async () => {
  const seen: (number | null)[] = [];
  const { handlers, api } = fakeApi();
  const driver = await attachCaptionHighlight((f) => seen.push(f), {
    listenApi: api, now: () => 0, setInterval: () => 1, clearInterval: () => {},
  });
  handlers.get(SPEECH_START_EVENT)?.({
    payload: { schemaVersion: '1.0', utteranceId: 'u-2', timings: [{ phoneme: 'a', startSec: 0, endSec: 4 }] },
  });
  const before = seen.length;
  handlers.get(SPEECH_DRAIN_EVENT)?.({ payload: { schemaVersion: '1.0', utteranceId: 'u-OLD' } });
  assert.equal(seen.length, before, 'a stale drain must be ignored entirely');
  driver.dispose();
});

test('timings with no usable duration highlight nothing rather than guessing', async () => {
  const seen: (number | null)[] = [];
  const { handlers, api } = fakeApi();
  const driver = await attachCaptionHighlight((f) => seen.push(f), {
    listenApi: api, now: () => 0, setInterval: () => 1, clearInterval: () => {},
  });
  handlers.get(SPEECH_START_EVENT)?.({
    payload: { schemaVersion: '1.0', utteranceId: 'u-3', timings: [] },
  });
  assert.equal(seen.at(-1), null);
  driver.dispose();
});

test('no native event API: inert, never throws, caption still renders', async () => {
  const driver = await attachCaptionHighlight(() => {
    throw new Error('must not be called');
  }, { listenApi: { listen: async () => { throw new Error('no tauri'); } } as never });
  assert.equal(driver.listening, false);
  driver.dispose();
  assert.ok(HIGHLIGHT_TICK_MS > 0);
});
