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
import { DEFAULT_DIAGNOSTIC_RETENTION_POLICY, evaluateCapture, } from '../contracts/index.js';
const MAX_SAFE_ENTRIES = 500;
export class TransportDiagnosticSink {
    policy;
    nowUtc;
    entries = [];
    sensitiveValues = new Set();
    sessionBytesCaptured = 0;
    constructor(policy = DEFAULT_DIAGNOSTIC_RETENTION_POLICY, options = {}) {
        this.policy = policy;
        this.nowUtc = options.nowUtc ?? (() => new Date().toISOString());
    }
    get capturePolicy() {
        return this.policy;
    }
    /**
     * Register a credential value for capture scanning only. Held in
     * memory, never recorded in any entry, and removable with
     * clearSensitiveValues when the request completes.
     */
    registerSensitiveValue(value) {
        if (value)
            this.sensitiveValues.add(value);
    }
    clearSensitiveValues() {
        this.sensitiveValues.clear();
    }
    /** Record safe metadata. This is the only unconditional recording path. */
    recordSafe(entry) {
        this.entries.push({ ...entry, at: this.nowUtc() });
        if (this.entries.length > MAX_SAFE_ENTRIES) {
            this.entries.splice(0, this.entries.length - MAX_SAFE_ENTRIES);
        }
    }
    /** All recorded metadata entries. Bodies are never present here. */
    safeEntries() {
        return this.entries;
    }
    /**
     * Ask whether a raw body may be captured under the policy. In this
     * build the answer is always no: no protected store is composed, so
     * protection is not established and the policy decision degrades to
     * metadata only, exactly as T132 requires. The decision is still run
     * through the canonical evaluateCapture so the reason recorded is
     * the policy's own, and a candidate containing a registered
     * credential value is refused on that ground first.
     */
    considerCapture(candidate) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(candidate.body);
        for (const value of this.sensitiveValues) {
            if (value && text.includes(value)) {
                this.recordSafe({
                    kind: 'capture_refused',
                    errorCode: 'DIAGNOSTIC_CAPTURE_REFUSED_SENSITIVE',
                    schemaPath: null,
                    byteCount: candidate.body.byteLength,
                    responseSha256: null,
                    sessionId: candidate.sessionId,
                    routeId: null,
                    note: 'Capture candidate contained a credential value; refused.',
                });
                return {
                    captured: false,
                    reason: 'capture candidate contained a credential value',
                    truncated: false,
                    effectiveBytes: 0,
                };
            }
        }
        const decision = evaluateCapture({
            policy: this.policy,
            sessionId: candidate.sessionId,
            dataClass: candidate.dataClass,
            byteLength: candidate.body.byteLength,
            sessionBytesAlreadyCaptured: this.sessionBytesCaptured,
            minutesSinceWindowStart: candidate.minutesSinceWindowStart,
            // No protected store (redaction plus protected persistence) is
            // composed into the transports in this unit.
            protectionEstablished: false,
            sessionDeletedOrRevoked: candidate.sessionDeletedOrRevoked,
        });
        if (!decision.allowed) {
            this.recordSafe({
                kind: 'capture_refused',
                errorCode: 'DIAGNOSTIC_CAPTURE_REFUSED',
                schemaPath: null,
                byteCount: candidate.body.byteLength,
                responseSha256: null,
                sessionId: candidate.sessionId,
                routeId: null,
                note: decision.reason,
            });
            return {
                captured: false,
                reason: decision.reason,
                truncated: false,
                effectiveBytes: 0,
            };
        }
        // Unreachable while protectionEstablished is hardwired false; kept
        // so a future protected store composes without changing call sites.
        this.sessionBytesCaptured += decision.effectiveBytes;
        return {
            captured: true,
            reason: 'captured under policy',
            truncated: decision.truncated,
            effectiveBytes: decision.effectiveBytes,
        };
    }
}
