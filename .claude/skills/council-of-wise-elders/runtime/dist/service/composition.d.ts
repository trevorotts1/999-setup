/**
 * Canonical Council front-door and backend composition root.
 *
 * W20-U001 (F5) moved the host launcher's wiring INTO the repository and
 * bound the four probes that slice could observe truthfully: `ui`,
 * `discovery`, `executable`, `packs`.
 *
 * W22-U001 (this slice) binds the intended BACKEND over the service data
 * directory, so `store`, `route` and `worker` become observed truth
 * instead of READINESS_PROBE_NOT_BOUND:
 *
 *   store    one canonical SQLite handle opens at `<dataDir>/council.db`,
 *            the canonical CWE-005 schema is applied (additive), and all
 *            eighteen Section 16.2 tables are observed in sqlite_master.
 *            `EventJournal` and `ProjectionOutbox` are constructed by
 *            `CouncilRepositories` over that same handle.
 *   route    ready when at least one discovered route is composable
 *            (W28). The route is chosen PER SESSION by the client (or the
 *            convening harness default), never once for the whole service;
 *            several composable routes are normal. Offline readiness never
 *            calls a provider.
 *   worker   one `startCouncilWorkers` supervisor runs over the durable
 *            runner composed by `composeDeliberationService`, with a live
 *            read of the budget ledger and its poll generation.
 *
 * The deliberation composition's host bindings (W28) are all bound here:
 * the elder-knowledge catalog and seat briefing loader, the standalone
 * trusted principal, a transport resolved per pinned route snapshot, and
 * the route limits (measured numbers where shipped, conservative
 * defaults otherwise; no approval step). Convening is wired through one driver; this
 * module never claims a completed deliberation or a live advisor turn.
 *
 * Lifecycle: one database handle, one worker supervisor, one listener.
 * `stop()` drains the listener, stops the workers (awaiting in-flight
 * work), and closes the handle exactly once. The supervisor timers are
 * unref'd; no child process is ever spawned.
 *
 * Module-load discipline: no child_process, no process.env read, no
 * network call, no directory is created, no database is opened and no
 * listener is started until the caller invokes the exported functions.
 */
import type { ModelTransport } from '../cli/host-ports.js';
import type { MaterialCatalog } from '../context/types.js';
import type { StoredSession } from '../cli/host-ports.js';
import { type AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilRepositories } from '../persistence/repositories.js';
import { CouncilDatabase } from '../persistence/sqlite.js';
import { type DeliberationService } from '../protocol/composition.js';
import { DurableOperationProducer } from '../queue/producer.js';
import type { RunnerTimers } from '../queue/runner.js';
import { type CouncilWorkerHandle } from '../queue/workers.js';
import type { PinnedRouteSnapshot } from '../budgets/index.js';
import { createCouncilDriver } from './driver.js';
import { CouncilFrontDoor } from './front-door.js';
import type { AdmissionSink, CouncilConveningPort, ServiceIdentity, StartOutcome } from './types.js';
type CouncilDriverHandle = ReturnType<typeof createCouncilDriver>;
export interface CouncilServiceCompositionOptions {
    /** Owner tenant served at the identity endpoint. */
    tenantId?: string;
    /** Owner company served at the identity endpoint. */
    companyId?: string;
    /** Durable data directory; created on composition when absent. */
    dataDir?: string;
    /** Observed start time; defaults to the injected clock. */
    startedAt?: string;
    host?: string;
    ports?: readonly number[];
    fetchImpl?: typeof fetch;
    /** The owning authority's admission surface (approval front door + producer). */
    admissionSink?: AdmissionSink;
    /** Injected clock for identity/readiness observation times. */
    nowUtc?: () => string;
    /**
     * Readiness hint only (for example `<providerId>-configured`). The route
     * is chosen per session by the client or the convening harness default;
     * the service never picks one for everybody, and several composable
     * routes are normal.
     */
    routeId?: string;
    /** Home directory route discovery reads under. Default: the OS home. */
    routeHomeDir?: string;
    /** Environment route discovery reads. Default: process.env at call time. */
    routeEnv?: NodeJS.ProcessEnv;
    /**
     * The guarded provider dispatch port for the selected route. Bound by
     * the host launcher; readiness checks its presence and never invokes it
     * offline.
     */
    providerDispatch?: () => unknown | Promise<unknown>;
    /** Start the durable worker supervisor. Default true. */
    startWorkers?: boolean;
    /** Worker idle poll interval in milliseconds. Default: runner default. */
    workerPollIntervalMs?: number;
    /** Injected runner timers (tests). Default: unref'd system timers. */
    workerTimers?: RunnerTimers;
    /**
     * The CWE-022 material catalog the deliberation context assembler reads
     * evidence from. The standalone service has no installed Skill 22 export
     * by default, so this stays null there and `DeliberationService.readiness()`
     * reports the catalog unbound. A host that has an adapted export supplies
     * the catalog it built; the service never invents evidence.
     */
    materialCatalog?: MaterialCatalog | null;
    /**
     * Skill folder holding `advisors/` and `config/`. Default: the folder
     * containing this runtime. A null/absent root leaves seats with no
     * shipped briefing and the route budget config unresolved (never guessed).
     */
    skillRoot?: string | null;
    /** Route budget config override (tests). Default: the shipped config. */
    routeBudgetConfigPath?: string;
    /**
     * Transport override (tests). When set it replaces the per-snapshot
     * transport resolution; production leaves it unset.
     */
    resolveTransport?: (snapshot: PinnedRouteSnapshot, session: StoredSession) => ModelTransport | null | Promise<ModelTransport | null>;
    /**
     * Longest `stop()` waits for in-flight convened sessions before it
     * closes the database. Default 25000 ms.
     */
    conveneDrainTimeoutMs?: number;
}
/** The backend members this root actually constructed. */
export interface CouncilServiceBackend {
    dataDir: string;
    databasePath: string;
    /** The one canonical handle the store, journal and workers share. */
    database: CouncilDatabase;
    /** Canonical repositories; `journal` and `outbox` are constructed here. */
    repositories: CouncilRepositories;
    /** Journal and outbox, kept as first-class handles for future surfaces. */
    journal: CouncilRepositories['journal'];
    outbox: CouncilRepositories['outbox'];
    /** The durable deliberation composition (runner, jobs, ledger, grants). */
    deliberation: DeliberationService;
    /** The canonical durable producer the default admission sink forwards to. */
    producer: DurableOperationProducer;
    /** The convening driver (create, approve on convene, deliberate, journal). */
    convening: CouncilDriverHandle;
    /** Routes and convene, as the front door serves them. */
    conveningPort: CouncilConveningPort;
    /** The owner/write envelope every local composition member acts under. */
    ownerEnvelope: AuthorizationEnvelope;
    /** The running supervisor, or null when workers were disabled. */
    workers: CouncilWorkerHandle | null;
    /** Stop workers (awaiting in-flight work), then close the database once. */
    stop(): Promise<void>;
}
export interface CouncilServiceComposition {
    identity: ServiceIdentity;
    door: CouncilFrontDoor;
    backend: CouncilServiceBackend;
    /** Stop the backend (workers + database). The door is stopped separately. */
    stop(): Promise<void>;
}
export interface StartedCouncilService {
    composition: CouncilServiceComposition;
    outcome: StartOutcome;
    origin: string | null;
    port: number | null;
    /** Drain and stop the listener and backend this handle owns, exactly once. */
    stop(): Promise<void>;
}
/**
 * Build the identity, the durable backend and the front door with the
 * truthful probe set bound. No listener is started here; the database is
 * opened and the workers start (unref'd timers) so readiness observes a
 * live backend.
 */
export declare function composeCouncilService(options?: CouncilServiceCompositionOptions): CouncilServiceComposition;
/**
 * Compose, start, and keep the front door alive until SIGTERM/SIGINT.
 * Signal handlers can be disabled for tests and embedded callers.
 */
export declare function startCouncilService(options?: CouncilServiceCompositionOptions & {
    handleSignals?: boolean;
}): Promise<StartedCouncilService>;
export {};
