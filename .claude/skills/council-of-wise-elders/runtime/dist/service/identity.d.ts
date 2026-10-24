/**
 * Service identity and listener verification (WER-021).
 *
 * Duplicate-start protection is identity-based, never port-based: a
 * listener is reused ONLY when it answers the identity endpoint with an
 * exact match for this service, composition, API version and owner
 * scope. An unrelated listener is refused untouched — this module never
 * sends a signal, never kills a process and never takes over a socket.
 *
 * `started_at` is observed but excluded from matching, so a restart of
 * the same owner's service still matches.
 */
import { type IdentityProbe, type ListenerClassification, type ServiceIdentity, type ServiceOwner } from './types.js';
export declare const SERVICE_IDENTITY_PATH = "/api/council/service/identity";
/** Trim a trailing slash so origin + path concatenation stays exact. */
export declare function normalizeOrigin(origin: string): string;
export declare function sha256Hex(value: string): string;
export declare function buildServiceOwner(input: {
    tenant_id: string;
    company_id: string;
    data_dir: string;
}): ServiceOwner;
export declare function buildServiceIdentity(input: {
    tenant_id: string;
    company_id: string;
    data_dir: string;
    started_at: string;
}): ServiceIdentity;
/** Structural validation of a served identity document. */
export declare function isServiceIdentity(value: unknown): value is ServiceIdentity;
/**
 * Exact identity match. Port, host, process id and `started_at` are NOT
 * part of the match: only the service contract and owner scope are.
 */
export declare function serviceIdentityMatches(expected: ServiceIdentity, observed: ServiceIdentity | null): boolean;
/**
 * Read the identity endpoint at an origin. Never throws; every outcome is
 * reported, and `checked` names the URL consulted.
 */
export declare function probeServiceIdentity(origin: string, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<IdentityProbe>;
/**
 * Classify a listener. Only a reachable, structurally valid, exactly
 * matching identity is reusable. Anything else is refused as unrelated
 * (or unreachable) and must be left running.
 */
export declare function classifyListener(origin: string, expected: ServiceIdentity, fetchImpl?: typeof fetch): Promise<{
    classification: ListenerClassification;
    probe: IdentityProbe;
}>;
