/**
 * Council worker supervision (CWE-027, directive Section 15.8).
 *
 * The scoped worker lifecycle functions the directive names:
 * startCouncilWorkers, wakeCouncilWorkers, stopCouncilWorkers. They
 * are NEW scoped functions in the portable runtime: the host registers
 * only a short council maintenance/admission wakeup with its own
 * scheduler (never a 27-turn council inside the host's 90-second
 * runLeasedJob lease) and calls startCouncilWorkers once per
 * supervised process; the workers themselves poll the durable store.
 *
 * Registration integrity (T158):
 * - Exactly one supervisor per supervisor id per process: a second
 *   startCouncilWorkers for the same id returns the existing handle
 *   and spawns nothing. Hot reload, restart, and shutdown therefore
 *   cannot duplicate workers for the same job; the durable claim CAS
 *   in the runner is the second line of defense even if two processes
 *   poll the same store.
 * - Polling is state-driven, not wakeup-driven: a lost wakeup costs at
 *   most one interval, because every cycle re-reads the durable queue.
 *   wakeCouncilWorkers exists to cut latency after an enqueue, not to
 *   carry correctness.
 * - Boot reconciliation runs before the first claim: expired leases
 *   are recovered and lapsed budget holds expired (runner
 *   reconcileScope), so a restart strands no durable queue work and
 *   resurrects no uncertain operation.
 * - An ephemeral-only hosting surface (no approved durable worker)
 *   refuses with WORKER_CAPABILITY_UNAVAILABLE instead of silently
 *   pretending to schedule (Section 15.8).
 */
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import { DurableJobRunner, type RunnerTimers } from './runner.js';
export interface CouncilWorkerScope {
    envelope: AuthorizationEnvelope;
    worker_id: string;
}
export interface StartCouncilWorkersOptions {
    runner: DurableJobRunner;
    scopes: CouncilWorkerScope[];
    /** Registry key; default 'council-workers'. One live supervisor per key. */
    supervisor_id?: string;
    /** Idle poll interval; default 1 second (Section 15.8), configurable. */
    poll_interval_ms?: number;
    timers?: RunnerTimers;
    /**
     * Host capability declaration: a surface that cannot run durable
     * workers (ephemeral-only hosting without an approved worker) must
     * say so here; startCouncilWorkers then refuses typed instead of
     * silently supporting what it cannot do.
     */
    durable_worker_capability?: boolean;
    /**
     * Every claim, reconcile or execution failure is reported here with the
     * session it concerns (when known); never swallowed.
     */
    on_error?: (error: unknown, context?: {
        session_id?: string;
    }) => void;
}
export interface CouncilWorkerHandle {
    supervisor_id: string;
    running: boolean;
    /** Number of poll cycles started (observability for tests/hosts). */
    cycles_started: number;
    /** Claims currently executing under this supervisor. */
    in_flight: number;
    wake(): void;
    stop(): Promise<void>;
}
/**
 * Start the council workers for this process. Registering the same
 * supervisor id twice returns the existing handle (idempotent across
 * hot reloads); use stopCouncilWorkers before starting a replacement.
 */
export declare function startCouncilWorkers(options: StartCouncilWorkersOptions): CouncilWorkerHandle;
/** Trigger an immediate poll cycle (cuts enqueue-to-claim latency). */
export declare function wakeCouncilWorkers(handle: CouncilWorkerHandle): void;
/** Stop a supervisor and unregister it, leaving durable work intact. */
export declare function stopCouncilWorkers(handle: CouncilWorkerHandle): Promise<void>;
/** Test and diagnostics surface: the live supervisor ids in this process. */
export declare function liveCouncilWorkerSupervisors(): string[];
