/**
 * Typed transport errors (CWE-009).
 *
 * Codes follow the stable-code style of directive Section 17.3: callers
 * branch on `code`, never on message text. Messages are plain English
 * and NEVER contain a credential value, a request or response body, an
 * authorization header, or a complete prompt (Sections 16.6 and 28.5):
 * a parse failure carries only a safe error code, a schema path, a byte
 * count, and a response hash.
 *
 * Two flags are part of the CWE-004 host-port contract and are read by
 * the deliberation engine's operation loop:
 * - `retryable`: true only for transient classes where the request is
 *   provably not accepted or the failure is a retryable status (429 or
 *   5xx). Auth, missing-model, policy, and endpoint errors are never
 *   retryable (Section 15.5).
 * - `unknownCompletion`: true when the provider may have accepted the
 *   request but completion is unknown (the first-class
 *   provider_submitted_unresolved state). Such a request is never
 *   replayed blindly; its budget reservation is retained until the
 *   outcome is reconciled.
 */
export class TransportError extends Error {
    code;
    /** Engine contract flag: transient, provably safe to retry once. */
    retryable;
    /** Engine contract flag: provider completion is unknown. */
    unknownCompletion;
    cancelled;
    httpStatus;
    retryAfterMs;
    parseDiagnostics;
    resolution;
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'TransportError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.unknownCompletion = options.unknownCompletion ?? false;
        this.cancelled = options.cancelled ?? false;
        this.httpStatus = options.httpStatus ?? null;
        this.retryAfterMs = options.retryAfterMs ?? null;
        this.parseDiagnostics = options.parseDiagnostics ?? null;
        this.resolution = options.resolution ?? null;
    }
}
export function isTransportError(value) {
    return value instanceof TransportError;
}
export function configError(message) {
    return new TransportError('TRANSPORT_CONFIG_INVALID', message);
}
