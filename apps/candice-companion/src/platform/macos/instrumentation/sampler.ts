/**
 * macOS resource sampler core (Master Spec 0E WS-24, spec 19).
 *
 * Owned by WR-015 / WS-24 lane (ownership map 9.2:
 * `apps/candice-companion/src/platform/macos/instrumentation/**`).
 *
 * Measures the companion's own footprint on Apple Silicon:
 *   - CPU as percent of one core (process.cpuUsage delta over a wall window),
 *   - RSS in MiB (process.memoryUsage().rss),
 *   - windowed sampling: N samples at a fixed interval over a phase window.
 *
 * Failure isolation (spec 20): every entry point is total. A sampler that
 * cannot read the process state returns an `Err`-shaped result, never throws.
 * Candice is presentation infrastructure; instrumentation may never crash it.
 *
 * All process reads are injectable (dependency injection) so the math is
 * testable without a real process — the live default reads the running
 * process directly.
 */

export interface CpuUsageLike {
  /** User CPU time in microseconds. */
  user: number;
  /** System CPU time in microseconds. */
  system: number;
}

export interface MemUsageLike {
  /** Resident set size in bytes. */
  rss: number;
}

export interface ProcessLike {
  cpuUsage(previous?: CpuUsageLike): CpuUsageLike;
  memoryUsage(): MemUsageLike;
  hrtime(previous?: [number, number]): [number, number];
}

/** Injectable process reader; defaults to the live process. */
export interface ProcessReader {
  cpuUsage(previous?: CpuUsageLike): CpuUsageLike;
  memoryUsage(): MemUsageLike;
  hrtime(previous?: [number, number]): [number, number];
  /** Monotonic ms since an arbitrary epoch (hrtime-derived). */
  nowMs(): number;
}

/** Live reader bound to the current process (the default instrument). */
export const liveProcessReader: ProcessReader = {
  cpuUsage(previous) {
    return process.cpuUsage(previous);
  },
  memoryUsage() {
    return process.memoryUsage();
  },
  hrtime(previous) {
    return process.hrtime(previous);
  },
  nowMs() {
    return process.hrtime()[0] * 1_000 + process.hrtime()[1] / 1_000_000;
  },
};

/** A single CPU/RSS observation. */
export interface ResourceSample {
  /** Percent of one core, fractional (e.g. 12.5 = 12.5% of one core). */
  cpuPercent: number;
  /** Resident set size in MiB. */
  rssMiB: number;
  /** Wall time of the sample, monotonic ms. */
  atMs: number;
}

/** Aggregate over a sampling window. */
export interface WindowSample {
  samples: ResourceSample[];
  cpuPercentMean: number;
  cpuPercentMax: number;
  rssMiBMean: number;
  rssMiBMax: number;
  windowMs: number;
  sampleCount: number;
  /** Set when the instrument failed mid-window; samples before the
   *  failure are still valid. Never thrown (spec 20). */
  error?: string;
}

export interface SampleWindowOptions {
  /** Total wall duration of the window in ms (default 30_000). */
  durationMs?: number;
  /** Interval between samples in ms (default 1_000). */
  intervalMs?: number;
  /** Inject a fake reader (tests); default live process. */
  reader?: ProcessReader;
  /** Inject a clock for deterministic wall timing (tests). */
  clockMs?: () => number;
}

export const SAMPLE_DEFAULTS = {
  durationMs: 30_000,
  intervalMs: 1_000,
} as const;

/** Convert an hrtime tuple to monotonic ms. */
export function hrtimeToMs(tuple: [number, number]): number {
  return tuple[0] * 1_000 + tuple[1] / 1_000_000;
}

/**
 * Percent of one core used between two cpuUsage snapshots across a wall
 * delta. Pure math: same inputs always produce the same output.
 */
export function cpuPercentBetween(
  previous: CpuUsageLike,
  current: CpuUsageLike,
  wallMs: number,
): number {
  if (wallMs <= 0) {
    return 0;
  }
  const usedUs = current.user - previous.user + (current.system - previous.system);
  if (usedUs < 0) {
    // cpuUsage deltas can go backwards on some platforms across thread
    // migrations; treat as zero rather than negative CPU.
    return 0;
  }
  // wallMs in ms -> wall microseconds; one core = wallUs/1000 of CPU us.
  const wallUs = wallMs * 1_000;
  const percent = (usedUs / wallUs) * 100;
  // Artifact guard: a busy-wait that stalls the event loop makes the
  // wall delta collapse to ~0 ms while CPU time accrues, producing
  // absurd percents (observed 4971% in capture runs). Cap at 200% of
  // one core — beyond that the sample measures loop stall, not load.
  return percent > 200 ? 200 : percent;
}

/** Bytes to MiB (1024-based, matching `ps -o rss` semantics on macOS). */
export function bytesToMiB(bytes: number): number {
  return bytes / (1024 * 1024);
}

/**
 * Sample the process over a wall window. Never throws: a reader failure
 * degrades to an error result carrying what was captured.
 */
export async function sampleWindow(
  options: SampleWindowOptions = {},
): Promise<WindowSample> {
  const durationMs = options.durationMs ?? SAMPLE_DEFAULTS.durationMs;
  const intervalMs = options.intervalMs ?? SAMPLE_DEFAULTS.intervalMs;
  const reader = options.reader ?? liveProcessReader;
  const clock = options.clockMs ?? reader.nowMs;

  const start = clock();
  const deadline = start + durationMs;
  const samples: ResourceSample[] = [];
  let error: string | undefined;

  let previousCpu: CpuUsageLike;
  let previousTick: number;
  try {
    previousCpu = reader.cpuUsage();
    previousTick = clock();
  } catch (err) {
    return {
      ...summarize([], durationMs),
      error: `instrument unavailable: ${String(err)}`,
    };
  }

  // Always capture at least one sample, even for a zero-length window.
  for (;;) {
    let now: number;
    let currentCpu: CpuUsageLike;
    let mem: MemUsageLike;
    try {
      now = clock();
      currentCpu = reader.cpuUsage(previousCpu);
      mem = reader.memoryUsage();
    } catch (err) {
      error = `instrument failed mid-window: ${String(err)}`;
      break;
    }
    const wallMs = now - previousTick;

    samples.push({
      cpuPercent: cpuPercentBetween(previousCpu, currentCpu, wallMs),
      rssMiB: bytesToMiB(mem.rss),
      atMs: now,
    });

    previousCpu = currentCpu;
    previousTick = now;

    if (now >= deadline) {
      break;
    }
    // Honor the real interval even when the injected clock advances
    // in larger steps: guard against a zero-sleep busy loop.
    const remaining = deadline - now;
    const waitMs = Math.min(intervalMs, remaining);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  const window = summarize(samples, durationMs);
  return error === undefined ? window : { ...window, error };
}

/** Summarize raw samples into window aggregates (pure). */
export function summarize(
  samples: ResourceSample[],
  windowMs: number,
): WindowSample {
  const count = samples.length;
  if (count === 0) {
    return {
      samples: [],
      cpuPercentMean: 0,
      cpuPercentMax: 0,
      rssMiBMean: 0,
      rssMiBMax: 0,
      windowMs,
      sampleCount: 0,
    };
  }
  const cpuSum = samples.reduce((acc, s) => acc + s.cpuPercent, 0);
  const rssSum = samples.reduce((acc, s) => acc + s.rssMiB, 0);
  let cpuMax = samples[0].cpuPercent;
  let rssMax = samples[0].rssMiB;
  for (const s of samples) {
    if (s.cpuPercent > cpuMax) cpuMax = s.cpuPercent;
    if (s.rssMiB > rssMax) rssMax = s.rssMiB;
  }
  return {
    samples,
    cpuPercentMean: cpuSum / count,
    cpuPercentMax: cpuMax,
    rssMiBMean: rssSum / count,
    rssMiBMax: rssMax,
    windowMs,
    sampleCount: count,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
