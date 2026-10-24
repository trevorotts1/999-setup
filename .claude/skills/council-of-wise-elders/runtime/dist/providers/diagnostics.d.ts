/**
 * Transport diagnostic sink (CWE-009; directive Section 16.6).
 *
 * One sink governs everything the transports record. It applies the
 * canonical DiagnosticRetentionPolicy (CWE-003 contracts) and holds
 * these non-negotiables:
 *
 * - raw request and response bodies are MEMORY-ONLY by default and,
 *   in this build, are never captured at all: capture requires an
 *   enabled policy for one named session, redaction, AND a protected
 *   store. No protected store is composed into the transports in this
 *   unit, so `protectionEstablished` is false and every capture
 *   decision degrades to metadata only (T132). Nothing here writes to
 *   disk, console, an error tracker, or an export, in any mode.
 * - failed redaction or missing protected storage yields metadata-only
 *   diagnostics; there is no plaintext fallback (T132).
 * - parser failures record only a safe error code, a schema path, a
 *   byte count, and a response hash (T130).
 * - hidden reasoning, access tokens, cookies, authentication headers,
 *   and private keys are never captured in any mode. As a second line
 *   of defense, the transport registers each resolved credential value
 *   with the sink for the duration of a request so a capture candidate
 *   that contains it is refused outright; the value is held only in
 *   process memory for that scan and is never recorded.
 */
import { type DiagnosticRetentionPolicy } from '../contracts/index.js';
/** Metadata-only diagnostic entry. Safe to persist; contains no body. */
export interface SafeDiagnosticEntry {
    kind: 'parse_failure' | 'http_error' | 'network_failure' | 'capture_refused' | 'capture_allowed';
    /** Stable error code (Section 17.3 style), never body text. */
    errorCode: string;
    /** JSON schema path of a parse failure, when applicable. */
    schemaPath: string | null;
    byteCount: number;
    /** SHA-256 of the response body, when a body existed. */
    responseSha256: string | null;
    sessionId: string | null;
    routeId: string | null;
    at: string;
    note: string | null;
}
export interface CaptureCandidate {
    sessionId: string;
    /** Data class per Section 16.6 (for example 'provider_response_body'). */
    dataClass: string;
    body: Uint8Array;
    minutesSinceWindowStart: number;
    sessionDeletedOrRevoked: boolean;
}
export interface CaptureOutcome {
    captured: boolean;
    reason: string;
    truncated: boolean;
    effectiveBytes: number;
}
export declare class TransportDiagnosticSink {
    private readonly policy;
    private readonly nowUtc;
    private readonly entries;
    private readonly sensitiveValues;
    private sessionBytesCaptured;
    constructor(policy?: DiagnosticRetentionPolicy, options?: {
        nowUtc?: () => string;
    });
    get capturePolicy(): DiagnosticRetentionPolicy;
    /**
     * Register a credential value for capture scanning only. Held in
     * memory, never recorded in any entry, and removable with
     * clearSensitiveValues when the request completes.
     */
    registerSensitiveValue(value: string): void;
    clearSensitiveValues(): void;
    /** Record safe metadata. This is the only unconditional recording path. */
    recordSafe(entry: Omit<SafeDiagnosticEntry, 'at'>): void;
    /** All recorded metadata entries. Bodies are never present here. */
    safeEntries(): readonly SafeDiagnosticEntry[];
    /**
     * Ask whether a raw body may be captured under the policy. In this
     * build the answer is always no: no protected store is composed, so
     * protection is not established and the policy decision degrades to
     * metadata only, exactly as T132 requires. The decision is still run
     * through the canonical evaluateCapture so the reason recorded is
     * the policy's own, and a candidate containing a registered
     * credential value is refused on that ground first.
     */
    considerCapture(candidate: CaptureCandidate): CaptureOutcome;
}
