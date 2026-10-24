/**
 * The composed durable admission sink (W25-U001 Lane E).
 *
 * The front door forwards one bounded admission request to the owning
 * authority; this module is that authority for a composed standalone
 * service. It is a thin adapter over the canonical durable producer
 * (`queue/producer.ts`), never a second queue:
 *
 *   POST /api/council/admissions
 *     -> AdmissionRequest { session_id, operation_id, payload }
 *     -> DurableOperationProducer.admitOperation(envelope, AdmissionCommand)
 *     -> one transaction: request key, optional session transition,
 *        council_jobs row, `operation_reserved` journal event, outbox intent
 *
 * The payload carries the operator-supplied command fields the front door
 * cannot invent: the granted run id, the frozen route snapshot hash, the
 * input hash and the reservation. A missing or malformed payload is a
 * typed refusal; the service never fabricates a grant, a hash, a
 * reservation or a session to make an admission succeed.
 */
import { DurableOperationProducer, type AdmissionCommand } from '../queue/producer.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { AdmissionRequest, AdmissionSink } from './types.js';
/** The payload keys the sink requires before the producer validates types. */
export declare const REQUIRED_ADMISSION_PAYLOAD_FIELDS: readonly ["operation_kind", "purpose", "input_hash", "route_snapshot_hash", "grant_id", "reservation"];
export interface DurableAdmissionSinkOptions {
    producer: DurableOperationProducer;
    /** The owner/worker write envelope this installation acts under. */
    envelope: AuthorizationEnvelope;
}
/** Typed refusal for a front-door payload that cannot be mapped honestly. */
export declare class DurableAdmissionError extends Error {
    readonly code = "ADMISSION_COMMAND_INCOMPLETE";
    readonly retryable = false;
    constructor(missing: readonly string[]);
}
/**
 * Map one front-door request onto the canonical command. The request's
 * session_id and operation_id are the identity; every other field comes
 * from the caller's payload and is validated by the producer itself.
 */
export declare function admissionCommandFromRequest(request: AdmissionRequest, payload: Readonly<Record<string, unknown>>): AdmissionCommand;
/** Build the canonical durable admission sink bound to one producer. */
export declare function createDurableAdmissionSink(options: DurableAdmissionSinkOptions): AdmissionSink;
