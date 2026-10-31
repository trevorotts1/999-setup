/**
 * Standalone Council front door (WER-021 dependency-ready slice).
 *
 * One same-origin loopback service exposes the health, identity, session
 * URL and admission contract AROUND the canonical durable owner. It is
 * deliberately not an engine: admissions are forwarded to an injected
 * sink, the event stream is served from an injected adapter over the
 * canonical journal, and the session route reads through an injected
 * reader. With neither adapter bound the service keeps its historical
 * unbound answers byte-for-byte (`EVENT_STREAM_ADAPTER_NOT_BOUND`,
 * `ui: "not_bundled"`) — it never fabricates a stream or a session.
 *
 * Behaviour proven by the colocated tests:
 * - duplicate start resolves and reuses ONLY a verified matching service;
 *   an unrelated listener is refused and left running;
 * - the emitted session URL is derived from the actual bound origin;
 * - a managed session returns its owning external URL and is never
 *   started locally;
 * - drain fences new admissions while existing sessions stay reachable;
 * - browser-open failure preserves the usable URL (WER-005 pattern).
 *
 * Deferred, never claimed: a registered system service, launchd/systemd
 * units, a bundled shared UI, a live event stream, a real browser launch
 * in tests, and any host mutation.
 */
import { type BrowserOpenResult } from '../bridges/browser-open.js';
import type { CouncilReportDownloadPort } from '../reports/report-download.js';
import type { ConveneInput } from './driver.js';
import { type CouncilEventStreamAdapter, type CouncilSessionReader } from './events.js';
import { type ReadinessOptions, type ServiceReadinessDeps } from './readiness.js';
import { type AdmissionDecision, type AdmissionRequest, type AdmissionSink, type CouncilConveningPort, type DrainOutcome, type ServiceIdentity, type ServiceReadiness, type ServiceState, type SessionAuthorityRecord, type SessionTarget, type StartOutcome, type StopOutcome } from './types.js';
export interface OpenSessionResult {
    target: SessionTarget;
    /** Null when the caller asked not to open, or the target is blocked. */
    browser: BrowserOpenResult | null;
}
export type FrontDoorReadinessDeps = Omit<ServiceReadinessDeps, 'origin'>;
export interface FrontDoorOptions {
    /** Owner identity served at the identity endpoint (started_at excluded from matching). */
    identity: ServiceIdentity;
    /** Bind host. Loopback only in this slice; remote exposure belongs to WER-023. */
    host?: string;
    /** Candidate ports, tried in order. Default DEFAULT_SERVICE_PORTS. */
    ports?: readonly number[];
    fetchImpl?: typeof fetch;
    /** Injected browser opener; defaults to the WER-005 helper. */
    openUrl?: (url: string) => BrowserOpenResult;
    /** The owning authority's admission surface (composition root supplies it). */
    admissionSink?: AdmissionSink;
    /**
     * Durable event stream source (composition root supplies it over the
     * canonical journal/outbox). Unbound keeps the 501 contract.
     */
    eventsAdapter?: CouncilEventStreamAdapter;
    /**
     * Durable session reader (composition root supplies it over the
     * canonical repositories). Unbound keeps the historical 200 body.
     */
    sessionReader?: CouncilSessionReader;
    /**
     * Saved-session PDF download (composition root supplies it over the
     * canonical repositories, the export journal and the host renderer).
     * Unbound answers 501; the door never fabricates a report document.
     */
    reportDownload?: CouncilReportDownloadPort;
    /**
     * Route listing and convening (composition root supplies it over the
     * composed driver). Unbound answers 501; the door never convenes itself.
     */
    convening?: CouncilConveningPort;
    readiness?: FrontDoorReadinessDeps;
    /**
     * Override the packaged chamber asset directory (absolute path). Unset
     * keeps the packaged `public/chamber` roots. Tests use this to simulate
     * a missing-assets build in an isolated temp dir instead of renaming
     * the shared `public/chamber` path, which races sibling tests running
     * in the same `npm test` process.
     */
    chamberAssetDir?: string;
}
/** Exact loopback set plus the 127/8 block; nothing else is a local front door. */
export declare function isLoopbackHost(host: string): boolean;
export declare function originFor(host: string, port: number): string;
export declare class CouncilFrontDoor {
    private readonly options;
    private server;
    private state;
    private origin;
    private boundPort;
    private startResult;
    private startPromise;
    private draining;
    private lastServerError;
    constructor(options: FrontDoorOptions);
    getState(): ServiceState;
    getOrigin(): string | null;
    getPort(): number | null;
    getIdentity(): ServiceIdentity;
    getLastServerError(): string | null;
    /**
     * Start or resolve the local service.
     *
     * Per candidate port: bind; on EADDRINUSE probe the listener's identity.
     * A verified matching service is reused (no second listener, and this
     * handle never drains or stops it). An unrelated listener is recorded
     * as a blocker and the next candidate is tried; it is never killed.
     */
    start(): Promise<StartOutcome>;
    private refuse;
    private doStart;
    private listen;
    private handleRequest;
    private route;
    /**
     * `POST /api/council/convene`. Convening IS the approval, so this route
     * sits behind the same fence as admissions (loopback-only listener, drain
     * and not-owner refusals) and additionally accepts JSON only, which keeps
     * a cross-site form post from ever spending the client's model allowance.
     */
    private handleConvene;
    /**
     * The fence every state-changing route shares (admissions and convene):
     * a draining, reused or stopped handle never accepts new work.
     */
    private serviceFence;
    /**
     * Serve one session's committed events from the injected adapter.
     *
     * Frames are committed journal rows only: `replay` is the catch-up and
     * the optional `subscribe` follows new rows. A failed read is retried
     * by the adapter from the same cursor; nothing is fabricated to cover
     * it. Without a follow hook the response ends after replay (a bounded,
     * honest read), and a browser/harness disconnect detaches at once.
     */
    private serveEventStream;
    /**
     * The service-provided report address for one session record. Only a
     * COMPLETED, non-blocked session that carries a verdict gets one, and
     * only when the download port and a bound origin exist. A caller never
     * has to build the address itself, and an unfinished sitting never
     * advertises a report it cannot serve.
     */
    private reportUrlFor;
    /**
     * Serve one packaged chamber asset. Returns false for anything outside the
     * fixed file set (so the caller falls through to the unchanged catch-all).
     * No directory listing, no traversal, no external asset.
     */
    private serveChamberAsset;
    /**
     * Self-contained landing page for `GET /`.
     *
     * Every value is read from this handle — identity, verified origin,
     * readiness layers and service state — so nothing is hardcoded, no
     * external asset is fetched and the page is explicit that the full
     * chamber UI is not packaged (the notice says so only then).
     */
    private renderLanding;
    /**
     * Admit one operation through the owning authority. Drain fences NEW
     * admissions; already-admitted durable work continues at the owner.
     */
    admit(request: AdmissionRequest): Promise<AdmissionDecision>;
    /** Graceful drain: stop admitting, keep serving existing sessions. */
    drain(): DrainOutcome;
    /**
     * Stop the listener this handle owns. A reused handle never closes the
     * owning service (launcher exit must not stop admitted work).
     */
    stop(): Promise<StopOutcome>;
    /** Layered readiness against this handle's verified origin. */
    readiness(options?: ReadinessOptions): Promise<ServiceReadiness>;
    /**
     * Resolve and optionally open a session URL. A browser-open failure
     * preserves the verified URL; a blocked target opens nothing.
     */
    openSession(record: SessionAuthorityRecord, options?: {
        open?: boolean;
    }): OpenSessionResult;
}
/** Convenience export for the composition root's local session URL. */
export declare function localSessionUrl(origin: string, sessionId: string): string;
type ConveneBodyResult = {
    ok: true;
    input: ConveneInput;
} | {
    ok: false;
    detail: string;
};
/**
 * Shape validation only. Deep validation of the brief and the seats is the
 * driver's job (it owns the contract validators); this layer exists so a
 * malformed request is refused with a typed 422 before any state changes.
 */
export declare function parseConveneBody(value: unknown): ConveneBodyResult;
export {};
