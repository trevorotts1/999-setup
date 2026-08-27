#!/usr/bin/env node
/**
 * Speech-audio content check (FIX-015 acceptance gate).
 *
 * WHY THIS EXISTS
 * ---------------
 * A TTS worker returning `ok:true`, a non-zero byte count, a non-zero RMS and
 * `afplay` exiting 0 prove only that the MECHANISM ran. None of them prove the
 * bytes are speech. A decoder bug (e.g. reading the worker's float32 PCM as
 * int16) yields full-scale white noise that satisfies every one of those
 * checks. This script tests the OUTCOME instead, against thresholds calibrated
 * on known-good Kokoro renders.
 *
 * `afplay rc=0` is not evidence. This is.
 *
 * Usage:  node scripts/verify-speech-audio.mjs <file.wav> [more.wav ...]
 * Exit:   0 every file passed | 1 a file failed | 2 tooling/parse error
 */
import { readFileSync } from 'node:fs';

/**
 * Calibrated against the 12 known-good FIX-015 QC renders in
 * /private/tmp/kokoro-verify/ and two files corrupted by a float32-read-as-
 * int16 decoder bug. Measured separation:
 *
 *            known-good speech (n=12)   corrupted noise (n=2)
 *   zcr          0.036 – 0.097               0.482 – 0.487
 *   silence      0.155 – 0.490               0.022 – 0.034
 *   rms/peak     0.137 – 0.175               0.529 – 0.532
 *   peak         11160 – 16360               32768 (clipped)
 *
 * Thresholds sit roughly midway between the two populations so a genuine
 * short, dense render (af_jessica: silence 0.155) still passes while noise
 * cannot. Any change here MUST be re-validated against all 12 controls —
 * if the checker rejects a known-good file, the checker is wrong.
 */
const THRESHOLDS = {
  zcrMax: 0.20,           // speech <= 0.097; ~0.5 is white noise
  rmsPeakMin: 0.08,       // speech 0.137–0.175
  rmsPeakMax: 0.30,
  silenceMin: 0.08,       // speech >= 0.155; noise <= 0.034
  peakMax: 32767,         // 32768 means clipped/full-scale
};

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`expected 16-bit PCM, got format=${fmt.audioFormat} bits=${fmt.bitsPerSample}`);
  }
  const n = Math.floor(data.length / 2 / fmt.channels);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = data.readInt16LE(i * 2 * fmt.channels); // channel 0
  return { fmt, samples: s };
}

function measure(samples, sampleRate) {
  const n = samples.length;
  let peak = 0, sumSq = 0, crossings = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    if (i > 0 && ((samples[i - 1] < 0 && v >= 0) || (samples[i - 1] >= 0 && v < 0))) crossings++;
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = n > 1 ? crossings / (n - 1) : 0;

  // Silence: 20 ms windows whose RMS is under 2% of peak.
  const win = Math.max(1, Math.round(sampleRate * 0.02));
  let silent = 0, windows = 0;
  for (let start = 0; start + win <= n; start += win) {
    let ss = 0;
    for (let i = start; i < start + win; i++) ss += samples[i] * samples[i];
    if (Math.sqrt(ss / win) < peak * 0.02) silent++;
    windows++;
  }
  return {
    sampleRate,
    durationSec: n / sampleRate,
    peak,
    rms,
    rmsOverPeak: peak > 0 ? rms / peak : 0,
    zcr,
    silenceFraction: windows > 0 ? silent / windows : 0,
  };
}

function verdict(m) {
  const checks = [
    ['zcr', m.zcr, m.zcr < THRESHOLDS.zcrMax, `< ${THRESHOLDS.zcrMax}`],
    ['rms/peak', m.rmsOverPeak,
      m.rmsOverPeak >= THRESHOLDS.rmsPeakMin && m.rmsOverPeak <= THRESHOLDS.rmsPeakMax,
      `${THRESHOLDS.rmsPeakMin}–${THRESHOLDS.rmsPeakMax}`],
    ['silence', m.silenceFraction, m.silenceFraction > THRESHOLDS.silenceMin, `> ${THRESHOLDS.silenceMin}`],
    ['peak', m.peak, m.peak <= THRESHOLDS.peakMax, `<= ${THRESHOLDS.peakMax}`],
  ];
  return { checks, pass: checks.every((c) => c[2]) };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/verify-speech-audio.mjs <file.wav> [more.wav ...]');
  process.exit(2);
}

let anyFail = false;
for (const f of files) {
  let m, v;
  try {
    const { fmt, samples } = parseWav(readFileSync(f));
    m = measure(samples, fmt.sampleRate);
    v = verdict(m);
  } catch (err) {
    console.log(`ERROR  ${f}\n       ${err.message}`);
    process.exit(2);
  }
  console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${f}`);
  console.log(
    `      rate=${m.sampleRate} dur=${m.durationSec.toFixed(2)}s ` +
    `peak=${m.peak} rms=${m.rms.toFixed(1)}`,
  );
  for (const [name, value, ok, want] of v.checks) {
    console.log(`      ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${Number(value).toFixed(3).padStart(9)}  want ${want}`);
  }
  if (!v.pass) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
