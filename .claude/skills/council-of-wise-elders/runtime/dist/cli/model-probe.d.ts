/**
 * Bounded capability probe (WER-006 remainder).
 *
 * This is the probe WER-006 left unbuilt. It is a SEQUENCER over reviewed
 * substrate, never a second authority, transport, or ledger:
 *
 * 1. The WER-006 frozen route snapshot is verified with
 *    `verifyRouteSnapshotHash` (via `assertDispatchableSnapshot`) BEFORE
 *    anything is admitted or spawned. A snapshot that fails its own
 *    published pin is refused with zero spawns.
 * 2. The probe is covered by a PURPOSE-BOUND grant: the ONE existing
 *    `RunAdmissionService.admitOperation` path is called with
 *    `purpose: 'capability_probe'`. That same path reuses the CWE-049
 *    grant validation (grant exists, is granted, is session-bound,
 *    active, unexpired, parent stands, revocation epoch, purpose match,
 *    allowed operation kind, route pin) and commits the CWE-028
 *    reservation in its own transaction BEFORE dispatch. There is no
 *    second authority check here: an unrelated Council run grant
 *    (`purpose: 'council_run'`) is refused by that service with
 *    RUN_GRANT_PURPOSE_MISMATCH and nothing is spawned.
 * 3. Dispatch goes through the existing platform-safe
 *    `BoundedSubprocessTransport`, which records the operationId and
 *    attemptId in the existing `OperationAttemptLedger` BEFORE launch.
 *    Timeout and cancel propagate through the transport's own abort and
 *    process-tree kill paths.
 * 4. The outcome model is deliberately three-valued and honest:
 *
 *      refused          nothing reached the provider (snapshot, purpose,
 *                       admission, pre-launch cancel, or spawn failure)
 *      attempted        a dispatch was launched but no answer came back
 *                       (timeout, cancel after launch, non-zero exit,
 *                       empty or over-bound output)
 *      answered         a response text came back but it did not satisfy
 *                       the probe answer schema
 *      schema_qualified a response text came back AND matched the schema
 *
 *    `callable` is true only for `schema_qualified`. A refused, failed,
 *    malformed or timed-out probe NEVER sets a callable or qualified
 *    success state.
 * 5. Unknown cost stays unknown: the reservation projection carries
 *    `costKnowledge: 'unknown'` whenever the grant's token or money
 *    bounds do not establish a real cost, and an unknown/answered probe
 *    NEVER releases or zeroes its reservation. A definitely-failed
 *    pre-launch dispatch is the only class that may release it.
 * 6. One probe response is capability evidence ONLY. It does not
 *    qualify a complete Council; the result says so on every path.
 *
 * Scope honesty: tests use simulated shims and local subprocesses. No
 * live provider probe, real transport capture, or network traffic is
 * claimed here; those are deferred to WER-026/027.
 */
import type { RunGrantRecord } from '../authorization/run-grants.js';
import type { Admission, AdmitOperationInput, ConsumptionRecord, RecordConsumptionInput } from '../authorization/admission.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { OperationReservation } from '../queue/index.js';
import type { SeatId } from '../contracts/index.js';
import { type SubprocessTransportOptions } from './subprocess-transport.js';
import { type AttemptDisposition } from './operation-attempts.js';
import type { CouncilRouteSnapshot } from '../providers/route-snapshot.js';
import type { RunPurpose } from '../contracts/index.js';
/** Explicit schema identifier for the probe receipt. */
export declare const MODEL_PROBE_SCHEMA = "wise-elders.model-probe/v1";
/** A probe is covered only by this purpose. Never an unrelated run grant. */
export declare const PROBE_PURPOSE: RunPurpose;
/** The exact answer schema a probe response must satisfy to qualify. */
export declare const PROBE_ANSWER_SCHEMA = "wise-elders.capability-probe-answer/v1";
/** A probe result never claims more than one transport response. */
export declare const PROBE_QUALIFICATION_SCOPE = "single_transport_response";
/**
 * Shown on EVERY result. One bounded probe response is capability
 * evidence for the pinned route only; it is not a completed Council.
 */
export declare const PROBE_QUALIFICATION_NOTE = "One bounded probe response is capability evidence for the pinned route only. It does not qualify a complete Council, a deliberation run, or any seat output; a complete Council requires the full governed run.";
/** The distinct outcome states. `callable` is true ONLY for the last. */
export type ProbeStatus = 'refused' | 'attempted' | 'answered' | 'schema_qualified';
/** The answer a qualified probe response must carry. */
export interface ProbeAnswer {
    schema_version: typeof PROBE_ANSWER_SCHEMA;
    status: 'ok';
    model_id: string | null;
}
/** The admission surface this probe composes. Implemented by RunAdmissionService. */
export interface ProbeAdmissionPort {
    admitOperation(envelope: AuthorizationEnvelope, input: AdmitOperationInput): Admission;
    recordConsumption(envelope: AuthorizationEnvelope, input: RecordConsumptionInput): ConsumptionRecord;
}
/** The release surface used ONLY for a definite pre-launch failure. */
export interface ProbeReservationReleaser {
    release(envelope: AuthorizationEnvelope, input: {
        session_id: string;
        operation_id: string;
        lease_epoch: number;
        reason?: string | null;
    }): unknown;
}
export interface ModelProbeOptions {
    /** The ONE existing admission service. Not a second authority path. */
    admission: ProbeAdmissionPort;
    /** Scope the grant and the admission were issued under. */
    envelope: AuthorizationEnvelope;
    /** The purpose-bound grant record. Admission re-reads the durable record. */
    grant: RunGrantRecord;
    session_id: string;
    seat_id: SeatId;
    /** The WER-006 frozen snapshot this probe is pinned to. */
    route_snapshot: CouncilRouteSnapshot;
    /** The session's current budget lease epoch (CWE-028 fence). */
    lease_epoch: number;
    /** One probe identity; also names the admission operation idempotently. */
    probe_id: string;
    /** Optional probe instruction; a fixed safe default is sent otherwise. */
    system?: string;
    /** Optional structured probe input. */
    input?: unknown;
    /**
     * Optional release port. Without it a definite pre-launch failure leaves
     * the reservation held (never silently freed); with it, that one class
     * is released. Every other outcome keeps its reservation.
     */
    releaser?: ProbeReservationReleaser | null;
    /** Bounded transport launch/bounds options; snapshot/ledger are bound here. */
    transport: Omit<SubprocessTransportOptions, 'snapshot' | 'ledger' | 'attemptIdFactory'>;
}
export interface ModelProbeResult {
    schema_version: typeof MODEL_PROBE_SCHEMA;
    probe_id: string;
    /** Exactly one of the four distinct outcomes. */
    status: ProbeStatus;
    /** A dispatch was launched (or may have been; never true when refused). */
    attempted: boolean;
    /** A response text came back. */
    answered: boolean;
    /** A response text came back AND matched the probe answer schema. */
    schema_qualified: boolean;
    /** True ONLY for schema_qualified. Never set by a refused/failed probe. */
    callable: boolean;
    /** Always false: one probe never qualifies a complete Council. */
    qualifies_complete_council: false;
    qualification_scope: typeof PROBE_QUALIFICATION_SCOPE;
    qualification_note: string;
    /** Plain-English reason for the outcome; null only on schema_qualified. */
    reason: string | null;
    /** The operationId recorded by the existing attempt ledger before launch. */
    operation_id: string | null;
    /** The attemptId recorded by the existing attempt ledger before launch. */
    attempt_id: string | null;
    attempt_disposition: AttemptDisposition | 'not_attempted';
    /** The idempotent admission identity (and its committed reservation). */
    admission_operation_id: string | null;
    admission_reservation_id: string | null;
    admission_state: string | null;
    /** Reservation projection. `costKnowledge` stays 'unknown' when unbounded. */
    reservation: OperationReservation;
    /** True while the reservation is still counted (reserved or unknown). */
    reserved: boolean;
    response: {
        provider_request_id: string | null;
        reported_model_id: string | null;
        usage: {
            input_tokens: number | null;
            output_tokens: number | null;
        } | null;
    };
    answer: ProbeAnswer | null;
}
/** A single token never satisfies the probe schema. */
export declare function isSingleToken(text: string): boolean;
/**
 * Qualify one response text against the probe answer schema. Strict:
 * a prose answer, a single token, or any JSON object that does not carry
 * the exact schema and status is answered-but-not-qualified.
 */
export declare function qualifyProbeAnswer(text: string): {
    answer: ProbeAnswer | null;
    issue: string | null;
};
/**
 * The bounded capability probe. One instance dispatches at most one probe
 * per `run()` call; the reservation, attempt ledger and transport are
 * created for that call so a refusal can never leave a half-built state.
 */
export declare class ModelProbe {
    private readonly options;
    constructor(options: ModelProbeOptions);
    /**
     * Reservation projection (the meaningful supported bounds). Unknown
     * values stay null, never zero. `requests` is the one provider request
     * this probe dispatches.
     */
    private reservationProjection;
    private buildRequest;
    private result;
    /**
     * Run the probe. Never throws for an expected outcome: snapshot refusal,
     * purpose refusal, admission refusal, timeout, cancel, exit failure,
     * malformed output and empty output all return a typed result.
     */
    run(signal?: AbortSignal): Promise<ModelProbeResult>;
    /** Never let a release/lookup failure mask the probe outcome. */
    private release;
    /** Mark provider completion unknown; the reservation stays counted. */
    private markUnknown;
}
