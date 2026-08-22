/**
 * Windows resource sampler core (Master Spec 0E WS-30, spec 19, spec 0.3 P0).
 *
 * Owned by WR-016 / WS-30 lane (ownership map 9.2:
 * `apps/candice-companion/src/platform/windows/instrumentation/**`).
 *
 * Measures the companion's own footprint on Windows 10/11 x64:
 *   - CPU as percent of one core (delta of Win32_Process
 *     KernelModeTime+UserModeTime 100ns ticks over a wall window),
 *   - RSS in MiB (Win32_Process WorkingSetSize),
 *   - windowed sampling: N samples at a fixed interval over a phase window.
 *
 * Native-only (spec 0.3 P0): the probe invokes PowerShell with
 * `Get-CimInstance Win32_Process` — never sysctl/nproc/POSIX tools, never
 * Git Bash/WSL. The backend is invoked through `powershell.exe
 * -NoProfile -NonInteractive -ExecutionPolicy Bypass` (process-scoped
 * policy only; the machine-wide execution policy is never weakened).
 *
 * Failure isolation (spec 20): a sampler that cannot read the process
 * state rejects; the phase probe (probe.ts) converts that rejection into
 * an `unavailable` measurement, never a crash. Candice is presentation
 * infrastructure; instrumentation may never crash it.
 *
 * All process reads are injectable (dependency injection) so the math is
 * testable without a real process or a Windows host — the live default shells
 * out to the native Windows probe backend.
 */

/** Monotonic wall clock (ms since an arbitrary epoch). */
export interface WallClock {
  nowMs(): number;
}

/** Injectable reader of the live process's resource counters. */
export interface ProcessReader {
  /**
   * ABSOLUTE CPU time consumed since process start, in 100ns ticks
   * (KernelModeTime + UserModeTime). Deltas are computed by the sampler.
   */
  cpuTicks(): number;
  /** Working set size (RSS) in bytes. */
  workingSetBytes(): number;
}

/** One Win32_Process counter snapshot. */
export interface Win32CounterSnapshot {
  kernelTicks100ns: number;
  userTicks100ns: number;
  workingSetBytes: number;
}

/** Line of a parseable single-process Win32_Process counter record. */
export interface CounterLine {
  processId: number;
  name: string;
  kernelTicks100ns: number;
  userTicks100ns: number;
  workingSetBytes: number;
}

/** Parseable result of one native probe call. */
export interface NativeProbeResult {
  /** CPU time used since the previous probe, in 100ns ticks. */
  cpuTicks: number;
  /** Working set size (RSS) in bytes. */
  workingSetBytes: number;
  /** Raw backend output tail (errors); never logged as secrets. */
  detail?: string;
}

/** Native Windows backend the live reader shells out to. */
export interface WindowsProbeBackend {
  /** Snapshot this process's counters via the native backend. */
  snapshot(processId: number): Promise<NativeProbeResult>;
}

/**
 * Parse one `Get-CimInstance Win32_Process` output line. Pure: identical
 * lines always produce identical output. The backend formats the row with
 * the PowerShell `-f` operator as
 * "ProcessId, Name, KernelModeTime, UserModeTime, WorkingSetSize".
 */
export function parseCounterLine(line: string): CounterLine | null {
  const parts = line.split(',');
  if (parts.length < 5) {
    return null;
  }
  // Win32_Process CSV: ProcessId, Name, KernelModeTime, UserModeTime,
  // WorkingSetSize — the name is a string, everything else numeric.
  const processId = Number(parts[0]?.trim());
  const kernelTicks100ns = Number(parts[2]?.trim());
  const userTicks100ns = Number(parts[3]?.trim());
  const workingSetBytes = Number(parts[4]?.trim());
  if (
    !Number.isFinite(processId) ||
    !Number.isFinite(kernelTicks100ns) ||
    !Number.isFinite(userTicks100ns) ||
    !Number.isFinite(workingSetBytes)
  ) {
    return null;
  }
  // An empty counter string coerces to 0 — indistinguishable from a real
  // zero reading. Reject blank (or whitespace) numeric fields so a failed
  // WMI read can never masquerade as a valid zero sample.
  if (
    parts[0]?.trim() === '' ||
    parts[2]?.trim() === '' ||
    parts[3]?.trim() === '' ||
    parts[4]?.trim() === ''
  ) {
    return null;
  }
  return {
    processId,
    name: parts[1]?.trim() ?? '',
    kernelTicks100ns,
    userTicks100ns,
    workingSetBytes,
  };
}

/** Convert a byte count to MiB (1024-based, matching Windows tooling). */
export function bytesToMiB(bytes: number): number {
  return bytes / (1024 * 1024);
}

/**
 * Percent of one core used between two tick snapshots across a wall delta.
 * Pure: same inputs always produce the same output.
 */
export function cpuPercentBetween(
  previousTicks100ns: number,
  currentTicks100ns: number,
  wallMs: number,
): number {
  if (wallMs <= 0) {
    return 0;
  }
  const usedTicks = currentTicks100ns - previousTicks100ns;
  if (usedTicks < 0) {
    // Counters can re-arm or a process can be replaced across a sampling
    // boundary; treat as zero rather than negative CPU.
    return 0;
  }
  // One core consumes 1e7 (100ns) ticks per wall second; percent of one core
  // is usedTicks / (wallMs * 1e4) * 100.
  return (usedTicks / (wallMs * 10_000)) * 100;
}

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
  /** Inject the native backend used by the live path (tests). */
  backend?: WindowsProbeBackend;
}

export const SAMPLE_DEFAULTS = {
  durationMs: 30_000,
  intervalMs: 1_000,
} as const;

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

/**
 * Sample the process over a wall window. A dead instrument rejects; the
 * phase probe converts that rejection into an `unavailable` measurement
 * note (spec 20 degradation at the probe boundary).
 */
export async function sampleWindow(
  options: SampleWindowOptions = {},
): Promise<WindowSample> {
  const durationMs = options.durationMs ?? SAMPLE_DEFAULTS.durationMs;
  const intervalMs = options.intervalMs ?? SAMPLE_DEFAULTS.intervalMs;
  const reader = options.reader;
  const clock = options.clockMs;
  const liveBackend = options.backend;

  let previousTicks: number;
  let previousTick: number;

  if (reader) {
    // Seeded instrument (injected reader, or the live reader passed
    // explicitly): the first cpuTicks() call seeds the absolute counter
    // baseline. With an injected clock the loop is fully deterministic;
    // without one, the seed is read on the fallback wall clock and the
    // first CPU delta is measured over real elapsed time.
    previousTicks = reader.cpuTicks();
    previousTick = (clock ?? fallbackNow)();
  } else {
    // Live default path. Win32_Process KernelModeTime/UserModeTime are
    // ABSOLUTE lifetime counters — a delta against a zero seed would
    // report the process's entire lifetime CPU over the first wall step
    // (a massive invented spike). Seed the absolute baseline up front so
    // the first sample covers only time after the seed. The seed probe's
    // own PowerShell round trip lands in the first wall step, so the
    // first delta includes that one probe's cost — a bounded
    // over-measure, never an invented lifetime spike.
    const seed = await probeLiveProcess(process.pid, { backend: liveBackend });
    if (seed.cpuTicks === 0 && seed.workingSetBytes === 0) {
      throw new Error(
        'live instrument unavailable: no counter read from native backend',
      );
    }
    previousTicks = seed.cpuTicks;
    previousTick = (clock ?? fallbackNow)();
  }

  const start = previousTick;
  const deadline = start + durationMs;
  const samples: ResourceSample[] = [];

  for (;;) {
    const now = clock ? clock() : fallbackNow();
    let currentTicks: number;
    let rssBytes: number;
    if (reader) {
      currentTicks = reader.cpuTicks();
      rssBytes = reader.workingSetBytes();
    } else {
      // One snapshot per sample — CPU ticks and working set arrive
      // together from the same Win32_Process read; never spawn two
      // PowerShell probes per interval.
      const snap = await probeLiveProcess(process.pid, {
        backend: liveBackend,
      });
      // A live instrument that cannot read the process must never emit
      // a fabricated zero sample: on a machine without the native
      // backend (e.g. a POSIX host running this probe for debugging),
      // reads fail and the accumulated window would otherwise be
      // reported as "ok" with all-zero CPU/RSS — a silent pass that
      // defeats the whole point of the regression gate. Reject instead;
      // the phase probe converts this into an `unavailable` measurement
      // (spec 20).
      if (snap.cpuTicks === 0 && snap.workingSetBytes === 0) {
        throw new Error(
          'live instrument unavailable: no counter read from native backend',
        );
      }
      currentTicks = snap.cpuTicks;
      rssBytes = snap.workingSetBytes;
    }
    const wallMs = now - previousTick;

    samples.push({
      cpuPercent: cpuPercentBetween(previousTicks, currentTicks, wallMs),
      rssMiB: bytesToMiB(rssBytes),
      atMs: now,
    });

    previousTicks = currentTicks;
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

  return summarize(samples, durationMs);
}

// ---------------------------------------------------------------------------
// Live Windows instrument (native backend)
// ---------------------------------------------------------------------------

/** PowerShell executable candidates, resolved once (no per-call cost). */
export const POWER_SHELL_CANDIDATES = ['powershell.exe', 'pwsh.exe'] as const;

const PROBE_SCRIPT = `
$p = Get-CimInstance Win32_Process -Filter 'ProcessId = $PID' |
     Select-Object -First 1 ProcessId, Name, KernelModeTime, UserModeTime, WorkingSetSize
if ($p) {
  '{0},{1},{2},{3},{4}' -f $p.ProcessId, $p.Name, $p.KernelModeTime, $p.UserModeTime, $p.WorkingSetSize
}
`;

/** Minimal child-process spawn surface (injectable for tests). */
export interface SpawnRunner {
  execFile(
    file: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

/**
 * Probe the live process via native Windows APIs. Never throws: a backend
 * failure is captured in the result. Uses only Win32 counters via
 * Get-CimInstance (spec 0.3 P0), never sysctl/nproc/POSIX tools.
 */
export async function probeLiveProcess(
  processId: number = process.pid,
  options: { backend?: WindowsProbeBackend; spawn?: SpawnRunner } = {},
): Promise<NativeProbeResult> {
  const backend = options.backend ?? powershellProbeBackend(options.spawn);
  try {
    return await backend.snapshot(processId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      cpuTicks: 0,
      workingSetBytes: 0,
      detail: `probe-error: ${message}`,
    };
  }
}

/** The native PowerShell-backed backend (live default). */
export function powershellProbeBackend(
  spawn?: SpawnRunner,
): WindowsProbeBackend {
  return {
    async snapshot(processId: number): Promise<NativeProbeResult> {
      const runner = spawn ?? nodeChildProcess;
      const lastError = { message: 'probe backend unavailable' };
      for (const candidate of POWER_SHELL_CANDIDATES) {
        try {
          const { stdout, stderr, code } = await runner.execFile(candidate, [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            PROBE_SCRIPT.replaceAll('$PID', String(processId)),
          ]);
          if (code !== 0 || !stdout.trim()) {
            lastError.message = `powershell exit ${code}: ${stderr.trim().slice(0, 200)}`;
            continue;
          }
          const line = parseCounterLine(stdout.trim().split(/\r?\n/).at(-1) ?? '');
          if (!line) {
            lastError.message = 'unparseable probe output';
            continue;
          }
          if (
            !Number.isFinite(line.kernelTicks100ns) ||
            !Number.isFinite(line.userTicks100ns) ||
            !Number.isFinite(line.workingSetBytes)
          ) {
            // Get-CimInstance can emit empty (or whitespace) counter
            // strings under WMI errors, which parse as non-finite
            // numbers; that is a probe failure, never a zero reading.
            lastError.message = 'non-finite counter value in probe output';
            continue;
          }
          return {
            cpuTicks: line.kernelTicks100ns + line.userTicks100ns,
            workingSetBytes: line.workingSetBytes,
          };
        } catch (err) {
          lastError.message = err instanceof Error ? err.message : String(err);
        }
      }
      throw new Error(lastError.message);
    },
  };
}

/** Tiny promise wrapper around `child_process.execFile`. */
export const nodeChildProcess: SpawnRunner = {
  execFile(file: string, args: string[]) {
    // Dynamic import keeps the runtime dependency out of the pure math
    // surface; this only resolves on the live instrument path.
    return import('node:child_process').then((cp) => {
      return new Promise((resolve) => {
        cp.execFile(file, args, { windowsHide: true, timeout: 15_000 }, (err, stdout, stderr) => {
          const code = err && typeof err === 'object' && 'code' in err
            ? (err as { code?: number | null }).code ?? null
            : 0;
          resolve({ stdout, stderr, code });
        });
      });
    });
  },
};

function fallbackNow(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
