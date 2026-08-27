/**
 * WS-35 real startup recovery runner (FIX-013 S5, audit F13-06).
 *
 * The production caller of the WS-35 startup sequence. Everything here is
 * REAL — no injected fakes:
 *
 *   - the WS-03 SessionManager (via SessionLifecycle) with its real
 *     write-through protected store;
 *   - the REAL WS-20 `sweepStaleTempAudio` engine over the real
 *     node:fs/promises adapter;
 *   - the WS-33 updater journal, read and VALIDATED (never executed).
 *
 * Order (plan §5): recovery + cleanup run BEFORE the interactive surface is
 * exposed. Partial cleanup fails SOFT: it records a bounded degraded status
 * with a safe retry and never blocks Claude. The recovered record stays
 * `recovering` — `resumeSession` is NEVER called here; the exact handoff is
 * acknowledged later by the app (`cmd_ack_replayed_question` -> the bridge
 * `recovered-result` frame) or the terminal fallback
 * (`acknowledgeRecoveryHandoff`).
 *
 * Runs under plain `node --experimental-strip-types` (Node 22.6+), zero
 * deps, cross-platform — same transport rule as the MCP server itself.
 *
 * CLI (production startup hooks):
 *
 *   node --experimental-strip-types startup-runner.ts \
 *     --state-dir <dir> --temp-root <dir> [--session-id <id>] \
 *     [--journal <install-journal.jsonl>] [--component <name>]
 *   node --experimental-strip-types startup-runner.ts --sweep-only \
 *     --temp-root <dir> [--state-dir <dir>]
 *
 * Prints ONE JSON line to stdout with the full outcome (failures and the
 * bounded degraded status; no secrets, no payloads).
 */

import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { SessionLifecycle } from "../../../../plugins/candice-integration/session/session-lifecycle.js";
import { sweepStaleTempAudio } from "../audio/cleanup/sweep.ts";
import type { FsAdapter } from "../audio/cleanup/types.ts";
import { runStartupRecovery, type StartupOutcome } from "./startup.ts";
import { FileUpdaterJournal, readUpdaterJournal } from "./disposition.ts";
import type { UpdaterJournal } from "./types.ts";

/** Real node:fs/promises surface shaped to the WS-20 FsAdapter contract. */
export const realFs: FsAdapter = {
  mkdir: (p, mode) => import("node:fs/promises").then((m) => m.mkdir(p, { mode })) as Promise<void>,
  readdir: (p) => import("node:fs/promises").then((m) => m.readdir(p)),
  stat: async (p) => {
    const s = await import("node:fs/promises").then((m) => m.stat(p));
    return { isDirectory: s.isDirectory(), isFile: s.isFile(), mtimeMs: s.mtimeMs, mode: s.mode & 0o777 };
  },
  rm: (p, opts) => import("node:fs/promises").then((m) => m.rm(p, opts as { recursive: boolean; force?: boolean })) as Promise<void>,
  writeFile: (p, data) => import("node:fs/promises").then((m) => m.writeFile(p, data)) as Promise<void>,
  realpath: (p) => import("node:fs/promises").then((m) => m.realpath(p)),
  exists: async (p) => {
    try {
      await import("node:fs/promises").then((m) => m.stat(p));
      return true;
    } catch {
      return false;
    }
  },
};

/** Canonical per-user state root for the protected store (WS-03 default). */
export function defaultStateDir(): string {
  return join(homedir(), ".candice", "state");
}

/** Canonical updater journal (WS-33 atomic-install default path). */
export function defaultUpdaterJournal(): string {
  return join(homedir(), ".candice", ".candice-backups", "install-journal.jsonl");
}

/** Default updater component whose install disposition gates startup. */
export const DEFAULT_UPDATER_COMPONENT = "candice-app";

/** Find the ONE active session carrying a pending question (spec 20). */
function findPendingSessionId(lifecycle: SessionLifecycle): string | null {
  try {
    const record = lifecycle.sessions.findPendingQuestion();
    return record && record.sessionId ? record.sessionId : null;
  } catch {
    return null;
  }
}

/**
 * The production startup entry. Constructs the REAL lifecycle over the REAL
 * store, runs recovery + sweep + disposition, and returns the outcome —
 * partial failures degrade (soft) and never block the caller. The session id
 * is taken from the caller when bound; otherwise it is derived from the
 * durable store (the pending record's session).
 */
export async function runRealStartupRecovery(options: {
  stateDir?: string;
  tempRoot?: string;
  sessionId?: string;
  journalFile?: string;
  updaterComponent?: string;
} = {}): Promise<StartupOutcome> {
  const stateDir = options.stateDir ?? defaultStateDir();
  const lifecycle = new SessionLifecycle({ stateDir });
  const sessionId = options.sessionId ?? findPendingSessionId(lifecycle);
  const tempRoot = options.tempRoot ?? tmpdir();
  const journalFile = options.journalFile ?? defaultUpdaterJournal();
  const journal: UpdaterJournal | undefined = new FileUpdaterJournal((component) =>
    readUpdaterJournal(journalFile, component)
  );
  return runStartupRecovery({
    lifecycle,
    sweep: sweepStaleTempAudio,
    fs: realFs,
    tempRoot,
    sessionId: sessionId ?? undefined,
    // The runner performed the discovery itself: an unbound session here
    // means "nothing pending in the real store", a neutral fact.
    recoveryOptional: true,
    updaterJournal: journal,
    updaterComponent: options.updaterComponent ?? DEFAULT_UPDATER_COMPONENT,
  });
}

/** Sweep-only mode for the NATIVE startup hook (the app owns temp audio).
 * Runs only the WS-20 engine — no store, no recovery, no disposition. A
 * partial sweep degrades (bounded, safe retry) and never blocks. */
export async function runNativeStartupSweep(options: {
  tempRoot?: string;
} = {}): Promise<StartupOutcome> {
  const tempRoot = options.tempRoot ?? tmpdir();
  const raw = await sweepStaleTempAudio({ fs: realFs, baseRoot: tempRoot });
  const sweep = {
    scanned: raw.scanned ?? 0,
    removed: raw.removed ?? 0,
    kept: raw.kept ?? 0,
    failed: raw.failed ?? 0,
  };
  const failures: string[] = [];
  let degraded: StartupOutcome["degraded"] = null;
  if (sweep.failed > 0) {
    failures.push("sweep:partial-failure");
    degraded = { reason: "sweep-partial", detail: `${sweep.failed} stale dir(s) could not be removed`, retryAtStartup: true };
  }
  return {
    recovery: { recovered: false, pending: null, sessionId: null, failures: [], markedRecovering: false, counted: false },
    sweep,
    failures,
    ok: failures.length === 0,
    degraded,
  };
}

/** Read the runner CLI args into options (unknown flags ignored). */
export function parseRunnerArgs(argv: string[]): {
  sweepOnly?: boolean;
  stateDir?: string;
  tempRoot?: string;
  sessionId?: string;
  journalFile?: string;
  updaterComponent?: string;
} {
  const options: ReturnType<typeof parseRunnerArgs> = {};
  const read = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes("--sweep-only")) options.sweepOnly = true;
  const stateDir = read("--state-dir");
  const tempRoot = read("--temp-root");
  const sessionId = read("--session-id");
  const journalFile = read("--journal");
  const updaterComponent = read("--component");
  if (stateDir) options.stateDir = stateDir;
  if (tempRoot) options.tempRoot = tempRoot;
  if (sessionId) options.sessionId = sessionId;
  if (journalFile) options.journalFile = journalFile;
  if (updaterComponent) options.updaterComponent = updaterComponent;
  return options;
}

/**
 * Strip question text and other protected payloads from the CLI outcome —
 * the runner's stdout is a log/transport surface and must never carry the
 * exact question text (audit F13-06: "no logs containing question text").
 * The machine-readable identity stays: sessionId, questionKey, operationId,
 * durableState, counted.
 */
export function sanitizeOutcomeForCli(outcome: StartupOutcome): Record<string, unknown> {
  const pending = outcome.recovery.pending
    ? {
        questionKey: outcome.recovery.pending.questionKey,
        operationId: outcome.recovery.pending.operationId,
        durableState: outcome.recovery.pending.durableState,
        counted: outcome.recovery.pending.counted,
        leaseId: outcome.recovery.pending.leaseId,
      }
    : null;
  return {
    ...outcome,
    recovery: {
      ...outcome.recovery,
      pending,
    },
  };
}

/** CLI entry: prints exactly one JSON line with the outcome (payload-free). */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseRunnerArgs(argv);
    const outcome = options.sweepOnly
      ? await runNativeStartupSweep(options)
      : await runRealStartupRecovery(options);
    process.stdout.write(`${JSON.stringify(sanitizeOutcomeForCli(outcome))}\n`);
    return 0;
  } catch (err) {
    // The runner must never block the interactive surface: an unexpected
    // throw is reported as a total failure, never rethrown at the caller.
    process.stdout.write(`${JSON.stringify({
      ok: false,
      failures: ["runner:threw"],
      recovery: { recovered: false, pending: null, sessionId: null, failures: ["runner:threw"], markedRecovering: false, counted: false },
      sweep: { scanned: 0, removed: 0, kept: 0, failed: 0 },
      degraded: { reason: "sweep-failed", detail: err instanceof Error ? err.message : String(err), retryAtStartup: true },
    })}\n`);
    return 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
