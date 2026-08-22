/**
 * WS-45 host/platform detection + process CPU/RSS reader (POSIX).
 *
 * Owned by WR-020 / WS-45 lane (ownership map 9.2: tests/performance/**).
 *
 * CPU discipline: `ps -o %cpu` on macOS is a LIFETIME average — worthless
 * for a windowed regression gate. This reader takes cumulative CPU time
 * deltas (macOS `ps -o time`; ktime on BSD accepts `ps -o time`), computes
 * percent-of-one-core over a wall window — the same math contract as the
 * WS-24 sampler. On Windows the WS-30 native probe owns the measurement
 * (this lane never shells to POSIX tools there; spec 0.3 P0).
 */

import { spawnSync } from 'node:child_process';

export function hostPlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return process.platform;
}

/**
 * One cumulative CPU-time + RSS read of a process (POSIX only).
 * time: seconds of CPU time consumed since process start (user+sys).
 */
export function readProcessCounters(pid) {
  if (process.platform === 'win32') {
    // Windows is measured by the WS-30 native probe (spec 0.3 P0 — no
    // POSIX tools on Windows). This lane returns null and the caller
    // records `unavailable` with the reason.
    return { ok: false, reason: 'windows-measurement-uses-ws30-native-probe' };
  }
  const res = spawnSync('ps', ['-o', 'pid=,time=,rss=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (res.status !== 0) {
    return { ok: false, reason: `ps failed: stdout=${res.stdout} stderr=${res.stderr}` };
  }
  const line = res.stdout.trim();
  if (!line) {
    return { ok: false, reason: `ps returned no line for pid ${pid}` };
  }
  const m = line.match(/^\s*(\d+)\s+([\d:.-]+)\s+(\d+)\s*$/);
  if (!m) {
    return { ok: false, reason: `unparseable ps line: ${JSON.stringify(line)}` };
  }
  return {
    ok: true,
    pid: Number(m[1]),
    cpuSeconds: parseMacTime(m[2]),
    rssBytes: Number(m[3]) * 1024, // ps rss is in KiB on macOS
  };
}

/** Parse `ps -o time` forms: [[dd-]hh:]mm:ss (or mm:ss). */
export function parseMacTime(s) {
  if (typeof s !== 'string') return NaN;
  if (s.includes('-')) {
    const [days, rest] = s.split('-');
    return Number(days) * 86400 + parseClock(rest);
  }
  return parseClock(s);
}

function parseClock(s) {
  if (typeof s !== 'string' || s.length === 0) return NaN;
  const raw = s.split(':');
  if (raw.some((part) => part.length === 0)) return NaN; // Number('') is 0, not NaN
  const parts = raw.map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

export function cpuPercentBetween(previousCpuSeconds, currentCpuSeconds, wallMs) {
  if (!Number.isFinite(wallMs) || wallMs <= 0) return 0;
  const delta = currentCpuSeconds - previousCpuSeconds;
  if (!Number.isFinite(delta) || delta < 0) return 0;
  const wallSec = wallMs / 1000;
  return Math.min((delta / wallSec) * 100, 200); // 200% cap, same artifact guard as WS-24
}

export function bytesToMiB(bytes) {
  return bytes / (1024 * 1024);
}

/**
 * Parent-process aware reader: cumulative seconds since the process started.
 * A PID reuse guard: if cpuSeconds or rss decreases, reject the read (the
 * process died and a different one got the PID).
 */
export function createCounter(pid) {
  let previous = null;
  return {
    /** @returns {{ok:true, cpuSeconds:number, rssBytes:number}|{ok:false, reason:string}} */
    read() {
      const now = readProcessCounters(pid);
      if (!now.ok) return now;
      if (previous) {
        if (now.cpuSeconds <= previous.cpuSeconds && now.rssBytes < previous.rssBytes * 0.5) {
          return { ok: false, reason: 'pid reused or process exited (counters went backwards)' };
        }
      }
      previous = now;
      return now;
    },
  };
}

/** Synchronous sleep via Atomics; fine for a regression runner. */
export function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, ms);
}

/** Async sleep: lets sibling promises (e.g. the say first-growth poll) run. */
export function asynSleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * EXACT resource usage of a SHORT-LIVED child process via /usr/bin/time
 * rusage (macOS only). `ps` CPU-time granularity is 1 second — a 350 ms
 * engine would read zero. rusage gives exact user/sys CPU + peak RSS.
 * Returns a WindowSample-shaped single-sample window (cpuPercent = CPU
 * used / wall, rssMiB = peak RSS).
 */
export function measureViaRuntimeUsage(cmd, args) {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'rusage measurement is macOS-only' };
  }
  // -l only (NOT -p): on current macOS, -p switches to a POSIX envelope
  // that OMITS the real/user/sys lines — verified 2026-08-21 on this box.
  const res = spawnSync('/usr/bin/time', ['-l', cmd, ...args], {
    encoding: 'utf8',
    timeout: 300_000,
  });
  const combined = `${res.stdout}\n${res.stderr}`;
  const rusage = parseRusage(combined);
  if (!rusage) {
    return { ok: false, reason: 'rusage lines not found in time output' };
  }
  return { ok: true, rusage, childExit: res.status };
}

const RUSAGE_RE =
  /([\d.]+)\s+real.*?([\d.]+)\s+user.*?([\d.]+)\s+sys.*?(\d+)\s+maximum resident set size/s;

export function parseRusage(text) {
  const m = text.match(RUSAGE_RE);
  if (!m) return null;
  return {
    realSec: Number(m[1]),
    userSec: Number(m[2]),
    sysSec: Number(m[3]),
    peakRssBytes: Number(m[4]),
  };
}

/** Build a WindowSample-shaped single-sample window from rusage. */
export function rusageToWindow(rusage, wallMs = null) {
  const wall = wallMs ?? rusage.realSec * 1000;
  const cpuSec = rusage.userSec + rusage.sysSec;
  const cpuPercent = wall > 0 ? Math.min((cpuSec / (wall / 1000)) * 100, 200) : 0;
  return {
    samples: [
      { cpuPercent, rssMiB: bytesToMiB(rusage.peakRssBytes), atMs: Date.now() },
    ],
    cpuPercentMean: cpuPercent,
    cpuPercentMax: cpuPercent,
    rssMiBMean: bytesToMiB(rusage.peakRssBytes),
    rssMiBMax: bytesToMiB(rusage.peakRssBytes),
    windowMs: wall,
    sampleCount: 1,
  };
}

/** Sample a process over a wall window; never throws — errors degrade. */
export async function sampleProcessWindow({ pid, durationMs, intervalMs }) {
  const start = Date.now();
  const deadline = start + durationMs;
  const counter = createCounter(pid);
  const samples = [];
  let error = undefined;
  const first = counter.read();
  if (!first.ok) {
    return { samples: [], cpuPercentMean: 0, cpuPercentMax: 0, rssMiBMean: 0, rssMiBMax: 0,
      windowMs: durationMs, sampleCount: 0, error };
  }
  let previous = first;
  let previousTick = start;
  let lastRead = first;
  for (;;) {
    const now = Date.now();
    const read = counter.read();
    if (!read.ok) {
      // The instrument stopped answering. If at least one sample was
      // captured, close the window with a final AGGREGATE sample: the
      // process's total CPU time over the wall elapsed (a short-lived
      // engine like whisper may be dead before the next interval —
      // dropping it would lose the whole measurement). A zero successful
      // read is a real error.
      if (samples.length === 0) {
        error = read.reason;
        break;
      }
      const wallSec = (now - start) / 1000;
      samples.push({
        cpuPercent: Math.min((lastRead.cpuSeconds / wallSec) * 100, 200),
        rssMiB: bytesToMiB(lastRead.rssBytes),
        atMs: now,
      });
      break;
    }
    const wallMs = now - previousTick;
    samples.push({
      cpuPercent: cpuPercentBetween(previous.cpuSeconds, read.cpuSeconds, wallMs),
      rssMiB: bytesToMiB(read.rssBytes),
      atMs: now,
    });
    previous = read;
    lastRead = read;
    previousTick = now;
    if (now >= deadline) break;
    await asynSleepMs(Math.min(intervalMs, deadline - now));
  }
  const summarize = summarizeSamples(samples, durationMs);
  return error === undefined ? summarize : { ...summarize, error };
}

export function summarizeSamples(samples, windowMs) {
  if (samples.length === 0) {
    return {
      samples: [], cpuPercentMean: 0, cpuPercentMax: 0, rssMiBMean: 0, rssMiBMax: 0,
      windowMs, sampleCount: 0,
    };
  }
  let cpuSum = 0, rssSum = 0, cpuMax = 0, rssMax = 0;
  for (const s of samples) {
    cpuSum += s.cpuPercent;
    rssSum += s.rssMiB;
    if (s.cpuPercent > cpuMax) cpuMax = s.cpuPercent;
    if (s.rssMiB > rssMax) rssMax = s.rssMiB;
  }
  return {
    samples, cpuPercentMean: cpuSum / samples.length, cpuPercentMax: cpuMax,
    rssMiBMean: rssSum / samples.length, rssMiBMax: rssMax,
    windowMs, sampleCount: samples.length,
  };
}
