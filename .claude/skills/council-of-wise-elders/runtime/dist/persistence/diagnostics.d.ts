/**
 * The single diagnostic capture sink (CWE-006, directive Section 16.6).
 *
 * Section 16.6 is absolute: there is ONE DiagnosticRetentionPolicy
 * implementation, applied by a single diagnostic sink; other modules
 * cannot write raw bodies directly. This class is that sink for the
 * persistence layer. Raw provider and tool bodies are memory-only by
 * default; a body is persisted only when ALL of the following hold:
 *
 * - an explicit grant is on record for this one named session, issued
 *   by the session owner or an audited support action (a grant row in
 *   council_diagnostic_capture, recorded by recordGrant);
 * - the canonical contracts gate (CWE-003 evaluateCapture) allows the
 *   capture: window open, byte ceilings respected, session not deleted
 *   or revoked;
 * - redaction succeeded and the protected payload store is available.
 *
 * On any failure the sink records only safe metadata (error code,
 * byte count, response hash) and never falls back to plaintext
 * temporary files. Stored payload bytes live in protected files under
 * the council data directory (mode 0600); the database holds only the
 * reference, the counters, and the deadline. Byte counters are
 * computed from the stored rows, so the per-operation and per-session
 * ceilings survive restart and resume. Reads re-check grant
 * revocation and the TTL deadline at read time: an expired payload is
 * inaccessible before any physical cleanup runs.
 *
 * The never-captured classes (hidden reasoning, access tokens,
 * cookies, authentication headers, private keys) are refused by the
 * contracts gate and additionally by the schema CHECK; the sink
 * records only a metadata row naming the refusal, never the content.
 */
import { type Clock, type DiagnosticRetentionPolicy, type IdSource } from '../contracts/index.js';
import { type AuthorizationEnvelope } from './envelope.js';
import type { EventJournal } from './journal.js';
import type { CouncilDatabase } from './sqlite.js';
/**
 * Redact secret-shaped material from a body before capture. Returns
 * the redacted body, or null when redaction is unavailable (the sink
 * then stores metadata only). The default implementation scrubs the
 * shapes the never-captured and secret rules name; hosts may inject a
 * stronger redactor.
 */
export declare function defaultDiagnosticRedactor(body: string): string;
export type DiagnosticRedactor = (body: string) => string | null;
export interface DiagnosticGrant {
    grant_id: string;
    policy: DiagnosticRetentionPolicy;
    window_started_at: string;
    window_ends_at: string;
    revoked_at: string | null;
}
export type CaptureOutcome = {
    stored: 'payload';
    capture_id: string;
    byte_count: number;
    truncated: boolean;
    payload_deadline_at: string;
} | {
    stored: 'metadata';
    capture_id: string;
    reason_code: string;
} | {
    stored: 'none';
    reason_code: string;
};
export declare class DiagnosticSink {
    private readonly db;
    private readonly deps;
    private readonly payloadDir;
    constructor(db: CouncilDatabase, deps: {
        clock: Clock;
        ids: IdSource;
        dataDir: string;
        journal: EventJournal;
        redact?: DiagnosticRedactor;
    });
    private sessionExists;
    private isDeleted;
    private grantRow;
    private policyFromGrant;
    /** Bytes captured under one grant, computed from stored rows. */
    capturedBytesForGrant(envelope: AuthorizationEnvelope, sessionId: string, grantId: string): number;
    /**
     * Record an explicit diagnostic grant for one named session. The
     * policy must be enabled and carry an authorizing principal and
     * kind (the canonical contract refuses anything weaker), the
     * envelope actor must be that principal, and the session must exist
     * and not be deleted. The grant is journaled (grant_issued).
     */
    recordGrant(envelope: AuthorizationEnvelope, policy: DiagnosticRetentionPolicy): DiagnosticGrant;
    /** The session's active (unrevoked) grant, or null. */
    activeGrant(envelope: AuthorizationEnvelope, sessionId: string): DiagnosticGrant | null;
    /**
     * Revoke a grant. Revocation blocks late writes immediately (the
     * schema trigger also refuses payload inserts under a revoked
     * grant) and every later read re-checks revocation, so previously
     * captured content becomes inaccessible to reads and export at once.
     * Payload files are removed by sweepRevokedAndExpired or by the
     * caller's deletion flow; access never waits for the sweep.
     */
    revokeGrant(envelope: AuthorizationEnvelope, sessionId: string, grantId: string): void;
    /**
     * Capture one provider or tool body under the session's grant. This
     * is the only write path for raw bodies in the persistence layer.
     * Policy denials never throw: they return a metadata or none outcome
     * with a reason code, so a denied capture cannot crash the operation
     * it was observing.
     */
    capture(envelope: AuthorizationEnvelope, input: {
        sessionId: string;
        operationId: string;
        dataClass: string;
        body: string;
        errorCode?: string | null;
    }): CaptureOutcome;
    /**
     * Read one captured payload. Access is re-decided at read time: the
     * grant must still be active, the session must not be deleted, and
     * the payload must be inside its TTL deadline. An expired or revoked
     * payload is inaccessible even while its file still exists on disk.
     */
    readPayload(envelope: AuthorizationEnvelope, sessionId: string, captureId: string): {
        body: string;
        byte_count: number;
        truncated: boolean;
    };
    /** Metadata view of a session's captures (never payload bytes). */
    listCaptures(envelope: AuthorizationEnvelope, sessionId: string): Array<Record<string, unknown>>;
    /**
     * Physical cleanup: delete payload files and rows whose retention
     * deadline has passed, and payload files under revoked grants.
     * Access decisions never depend on this sweep having run.
     */
    sweepExpiredAndRevoked(): {
        removed: number;
    };
    /** Remove protected payload files by reference (post-deletion sweep). */
    purgePayloadFiles(refs: string[]): void;
}
