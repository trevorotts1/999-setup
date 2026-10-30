/**
 * DiagnosticRetentionPolicy behavior (directive Section 16.6).
 *
 * There is one policy implementation, applied by a single diagnostic sink;
 * other modules cannot write raw bodies directly. This module holds the
 * policy defaults, the bounds, and the pure capture/read decision functions
 * the sink consults. It performs no I/O itself.
 *
 * Non-negotiable rules encoded here:
 * - capture is disabled by default;
 * - enabling requires explicit owner or audited support authorization for
 *   one named session; an enabled flag in a request body is not authority;
 * - defaults: 60 minute capture window (max 4 hours), 24 hour payload TTL
 *   (max 72 hours), at most 5 MiB per operation and 25 MiB per session;
 * - truncation is labeled and never treated as complete source evidence;
 * - hidden reasoning, access tokens, cookies, authentication headers, and
 *   private keys are NEVER captured, in any mode, diagnostic included.
 */
import { DEFAULT_DIAGNOSTIC_RETENTION_POLICY, DIAGNOSTIC_LIMITS, type DiagnosticRetentionPolicy } from './schemas.js';
export { DEFAULT_DIAGNOSTIC_RETENTION_POLICY, DIAGNOSTIC_LIMITS };
export type { DiagnosticRetentionPolicy };
/** Data classes that must never be persisted or displayed, in any mode. */
export declare const NEVER_CAPTURED_DATA_CLASSES: readonly string[];
export declare function isNeverCaptured(dataClass: string): boolean;
export interface CaptureRequest {
    policy: DiagnosticRetentionPolicy;
    /** Session the capture would record; must equal the authorized session. */
    sessionId: string;
    dataClass: string;
    byteLength: number;
    /** Bytes already captured for this session under this policy. */
    sessionBytesAlreadyCaptured: number;
    /** Minutes since the capture window opened. */
    minutesSinceWindowStart: number;
    /** Whether redaction and a protected store are established. */
    protectionEstablished: boolean;
    /** Whether the session has been deleted or capture revoked. */
    sessionDeletedOrRevoked: boolean;
}
export type CaptureDecision = {
    allowed: true;
    truncated: boolean;
    effectiveBytes: number;
} | {
    allowed: false;
    reason: string;
};
/**
 * Decide whether one payload may be captured. On any failure the sink
 * records only safe metadata (error code, schema path, byte count, response
 * hash); it never falls back to plaintext temporary files.
 */
export declare function evaluateCapture(req: CaptureRequest): CaptureDecision;
/** A captured payload is inaccessible at or after its TTL, even before cleanup. */
export declare function isCaptureExpired(capturedAtMs: number, nowMs: number, ttlHours: number): boolean;
