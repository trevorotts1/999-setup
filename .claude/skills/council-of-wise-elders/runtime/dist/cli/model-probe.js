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
import { assertDispatchableSnapshot, BoundedSubprocessTransport, BoundedSubprocessError, operationIdFor, } from './subprocess-transport.js';
import { OperationAttemptLedger, } from './operation-attempts.js';
/** Explicit schema identifier for the probe receipt. */
export const MODEL_PROBE_SCHEMA = 'wise-elders.model-probe/v1';
/** A probe is covered only by this purpose. Never an unrelated run grant. */
export const PROBE_PURPOSE = 'capability_probe';
/** The exact answer schema a probe response must satisfy to qualify. */
export const PROBE_ANSWER_SCHEMA = 'wise-elders.capability-probe-answer/v1';
/** A probe result never claims more than one transport response. */
export const PROBE_QUALIFICATION_SCOPE = 'single_transport_response';
/**
 * Shown on EVERY result. One bounded probe response is capability
 * evidence for the pinned route only; it is not a completed Council.
 */
export const PROBE_QUALIFICATION_NOTE = 'One bounded probe response is capability evidence for the pinned route only. It does not qualify a complete Council, a deliberation run, or any seat output; a complete Council requires the full governed run.';
/** A single token never satisfies the probe schema. */
export function isSingleToken(text) {
    return text.trim().split(/\s+/).filter(Boolean).length === 1;
}
/**
 * Qualify one response text against the probe answer schema. Strict:
 * a prose answer, a single token, or any JSON object that does not carry
 * the exact schema and status is answered-but-not-qualified.
 */
export function qualifyProbeAnswer(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return { answer: null, issue: 'the response was empty' };
    }
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        // A bare word is the "one token" case; compact JSON is a single
        // whitespace token too, so JSON is parsed FIRST and never mistaken
        // for prose.
        if (isSingleToken(trimmed)) {
            return {
                answer: null,
                issue: 'the response is a single token; one token does not qualify a complete Council and does not satisfy the probe answer schema',
            };
        }
        return { answer: null, issue: 'the response is not valid JSON' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { answer: null, issue: 'the response is not a JSON object' };
    }
    const record = parsed;
    if (record.schema_version !== PROBE_ANSWER_SCHEMA) {
        return {
            answer: null,
            issue: `the response schema_version is not ${JSON.stringify(PROBE_ANSWER_SCHEMA)}`,
        };
    }
    if (record.status !== 'ok') {
        return {
            answer: null,
            issue: 'the response status is not "ok"; a non-ok probe is never qualified',
        };
    }
    const modelId = record.model_id ?? null;
    if (modelId !== null && typeof modelId !== 'string') {
        return { answer: null, issue: 'the response model_id must be a string or null' };
    }
    return {
        answer: {
            schema_version: PROBE_ANSWER_SCHEMA,
            status: 'ok',
            model_id: modelId,
        },
        issue: null,
    };
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function errorCode(error) {
    if (error !== null && typeof error === 'object' && 'code' in error) {
        const code = error.code;
        return typeof code === 'string' ? code : null;
    }
    return null;
}
/** The default probe instruction: one small, unambiguous JSON answer. */
const DEFAULT_PROBE_SYSTEM = 'You are answering one bounded capability probe. Return exactly one JSON object and nothing else: ' +
    `{"schema_version":"${PROBE_ANSWER_SCHEMA}","status":"ok","model_id":<the model id you are running as, or null>}. ` +
    'No prose, no markdown, no code fences.';
/**
 * The bounded capability probe. One instance dispatches at most one probe
 * per `run()` call; the reservation, attempt ledger and transport are
 * created for that call so a refusal can never leave a half-built state.
 */
export class ModelProbe {
    options;
    constructor(options) {
        this.options = options;
    }
    /**
     * Reservation projection (the meaningful supported bounds). Unknown
     * values stay null, never zero. `requests` is the one provider request
     * this probe dispatches.
     */
    reservationProjection() {
        const ceilings = this.options.grant.proof.ceilings;
        const tokens = ceilings.max_input_tokens !== null && ceilings.max_output_tokens !== null
            ? ceilings.max_input_tokens + ceilings.max_output_tokens
            : null;
        const money = ceilings.max_money;
        const costKnowledge = tokens !== null && money !== null ? 'estimated' : 'unknown';
        return {
            requests: 1,
            tokens,
            moneyMinorUnits: money === null ? null : money.amount_minor,
            currency: money === null ? null : money.currency,
            costKnowledge,
        };
    }
    buildRequest(signal) {
        const snapshot = this.options.route_snapshot;
        return {
            purpose: 'consult',
            session_id: this.options.session_id,
            seat_id: this.options.seat_id,
            round: null,
            route_id: snapshot.selection.routeId,
            model_policy: {
                selection: snapshot.selection.selectionSource,
                route_id: snapshot.selection.routeId,
                requested_model_id: snapshot.identity.configured.modelId,
                reasoning_preference: snapshot.reasoning.applied,
                fallback_policy: snapshot.selection.fallbackPolicy,
            },
            system: this.options.system ?? DEFAULT_PROBE_SYSTEM,
            input: this.options.input ?? { probe_id: this.options.probe_id },
            ...(signal ? { signal } : {}),
        };
    }
    result(status, overrides = {}) {
        return {
            schema_version: MODEL_PROBE_SCHEMA,
            probe_id: this.options.probe_id,
            status,
            attempted: status !== 'refused',
            answered: status === 'answered' || status === 'schema_qualified',
            schema_qualified: status === 'schema_qualified',
            callable: status === 'schema_qualified',
            qualifies_complete_council: false,
            qualification_scope: PROBE_QUALIFICATION_SCOPE,
            qualification_note: PROBE_QUALIFICATION_NOTE,
            reason: null,
            operation_id: null,
            attempt_id: null,
            attempt_disposition: 'not_attempted',
            admission_operation_id: null,
            admission_reservation_id: null,
            admission_state: null,
            reservation: this.reservationProjection(),
            reserved: false,
            response: {
                provider_request_id: null,
                reported_model_id: null,
                usage: null,
            },
            answer: null,
            ...overrides,
        };
    }
    /**
     * Run the probe. Never throws for an expected outcome: snapshot refusal,
     * purpose refusal, admission refusal, timeout, cancel, exit failure,
     * malformed output and empty output all return a typed result.
     */
    async run(signal) {
        // 1. The frozen snapshot must satisfy its own published hash BEFORE
        //    anything is admitted or spawned. A tampered pin spawns nothing.
        try {
            assertDispatchableSnapshot(this.options.route_snapshot);
        }
        catch (error) {
            return this.result('refused', {
                reason: `route snapshot refused before dispatch: ${errorMessage(error)}`,
            });
        }
        // A cancel that arrived before launch must not mint a reservation.
        if (signal?.aborted) {
            return this.result('refused', {
                reason: 'cancelled before any dispatch; no reservation was minted',
            });
        }
        const request = this.buildRequest(signal);
        const operationId = operationIdFor(request);
        const attemptId = `${this.options.probe_id}:attempt:1`;
        const admissionOperationId = `model-probe:${this.options.probe_id}`;
        // 2. Purpose-bound admission. This is the ONE existing authority path:
        //    it validates the grant (purpose capability_probe) and commits the
        //    CWE-028 reservation before dispatch. An unrelated council_run
        //    grant is refused here with RUN_GRANT_PURPOSE_MISMATCH.
        let admission;
        try {
            admission = this.options.admission.admitOperation(this.options.envelope, {
                grant_id: this.options.grant.grant_id,
                session_id: this.options.session_id,
                operation_id: admissionOperationId,
                kind: 'provider_request',
                purpose: PROBE_PURPOSE,
                estimate_minor: this.options.grant.proof.ceilings.max_money?.amount_minor ?? 0,
                currency: this.options.grant.proof.ceilings.max_money?.currency ?? null,
                lease_epoch: this.options.lease_epoch,
                route_snapshot: this.options.route_snapshot.selection,
            });
        }
        catch (error) {
            const code = errorCode(error);
            return this.result('refused', {
                reason: `probe admission refused before dispatch${code ? ` (${code})` : ''}: ${errorMessage(error)}`,
                admission_operation_id: admissionOperationId,
            });
        }
        const admitted = {
            admission_operation_id: admissionOperationId,
            admission_reservation_id: admission.reservation_id,
            admission_state: admission.state,
        };
        // 3. Build the reviewed bounded transport from the already-verified
        //    snapshot. Its constructor re-verifies the pin; if it somehow
        //    refuses, the reservation is released (definite pre-launch failure)
        //    and nothing is spawned.
        const ledger = new OperationAttemptLedger({
            now: this.options.transport.now ?? (() => new Date()),
        });
        let transport;
        try {
            transport = new BoundedSubprocessTransport({
                ...this.options.transport,
                snapshot: this.options.route_snapshot,
                ledger,
                attemptIdFactory: () => attemptId,
            });
        }
        catch (error) {
            this.release(admissionOperationId, `transport refused to build: ${errorMessage(error)}`);
            return this.result('refused', {
                ...admitted,
                reason: `bounded transport refused before dispatch: ${errorMessage(error)}`,
                reserved: false,
            });
        }
        // 4. Dispatch. The transport records operationId/attemptId BEFORE launch
        //    and enforces the deadline/abort bounds itself.
        let response;
        try {
            response = await transport.generate(request);
        }
        catch (error) {
            const disposition = error instanceof BoundedSubprocessError ? error.disposition : null;
            const attempt = ledger.get(operationId, attemptId);
            if (disposition === 'failed_definitely') {
                // The executable never ran: no provider work is possible, so this
                // is the only class that may release the reservation.
                this.release(admissionOperationId, `definite pre-launch failure: ${errorMessage(error)}`);
                return this.result('refused', {
                    ...admitted,
                    reason: `dispatch failed definitively before launch: ${errorMessage(error)}`,
                    operation_id: operationId,
                    attempt_id: attemptId,
                    attempt_disposition: attempt?.disposition ?? 'failed_definitely',
                    reserved: false,
                });
            }
            // Timeout, cancel after launch, non-zero exit, empty output or an
            // over-bound stream: the provider MAY have completed. Mark completion
            // unknown (still counted, never zeroed) and never claim an answer.
            if (disposition === 'potentially_dispatched') {
                this.markUnknown(admissionOperationId, errorMessage(error));
            }
            return this.result('attempted', {
                ...admitted,
                reason: `dispatch attempted but not answered: ${errorMessage(error)}`,
                operation_id: operationId,
                attempt_id: attemptId,
                attempt_disposition: attempt?.disposition ?? 'potentially_dispatched',
                reserved: true,
            });
        }
        const attempt = ledger.get(operationId, attemptId);
        const base = {
            ...admitted,
            operation_id: operationId,
            attempt_id: attemptId,
            attempt_disposition: attempt?.disposition ?? 'completed',
            reserved: true,
            response: {
                provider_request_id: response.provider_request_id,
                reported_model_id: response.reported_model_id,
                usage: response.usage,
            },
        };
        // 5. Answer qualification is a SEPARATE outcome from answering. A
        //    malformed answer is answered-but-not-qualified and never callable.
        const qualification = qualifyProbeAnswer(response.text);
        if (qualification.answer === null) {
            return this.result('answered', {
                ...base,
                reason: `answered but not schema-qualified: ${qualification.issue ?? 'unknown issue'}`,
            });
        }
        return this.result('schema_qualified', {
            ...base,
            answer: qualification.answer,
        });
    }
    /** Never let a release/lookup failure mask the probe outcome. */
    release(operationId, reason) {
        const releaser = this.options.releaser;
        if (!releaser)
            return;
        try {
            releaser.release(this.options.envelope, {
                session_id: this.options.session_id,
                operation_id: operationId,
                lease_epoch: this.options.lease_epoch,
                reason,
            });
        }
        catch {
            // The reservation hold expires on its own; the outcome stands.
        }
    }
    /** Mark provider completion unknown; the reservation stays counted. */
    markUnknown(operationId, detail) {
        try {
            this.options.admission.recordConsumption(this.options.envelope, {
                grant_id: this.options.grant.grant_id,
                session_id: this.options.session_id,
                operation_id: operationId,
                lease_epoch: this.options.lease_epoch,
                outcome: 'unknown',
            });
        }
        catch {
            // Accounting must never turn a failed probe into a thrown error.
            // The reservation remains 'reserved' and therefore still counted.
            void detail;
        }
    }
}
