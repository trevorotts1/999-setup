/**
 * Cloudflare Access JWT verification (WER-023).
 *
 * The v2.4 plan states that arbitrary forwarded headers do not establish
 * identity. This module is the only place a remote subject is established,
 * and it accepts NOTHING except a real RS256 signature over the token,
 * checked against the Access JWKS, with the issuer, pinned audience and
 * validity window all enforced.
 *
 * The JWKS source is injected. Tests supply a fixture JWKS built from a
 * local keypair, so this adapter makes zero network calls at test time.
 *
 * `ponytail:` the JWKS is read per verification and not cached; a
 * production source may add a TTL cache behind the same `JwksSource`
 * signature when key rotation has been observed live.
 */
import type { JwksSource, RemoteRefusal } from './types.js';
/** Header Cloudflare Access sets on an authenticated request. */
export declare const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
/** Identity hint Cloudflare also sets. NEVER trusted without a valid JWT. */
export declare const ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
export interface AccessJwtExpectations {
    /** Team domain with or without scheme, e.g. sweet-wave-ca28.cloudflareaccess.com */
    team_domain: string;
    audience: string;
    jwks: JwksSource;
    /** Injected clock in epoch seconds. */
    now_seconds?: () => number;
    clock_skew_seconds?: number;
}
export interface AccessClaims {
    iss: string;
    aud: readonly string[];
    sub: string;
    email: string | null;
    iat: number | null;
    nbf: number | null;
    exp: number;
}
export type AccessJwtVerification = {
    ok: true;
    claims: AccessClaims;
} | ({
    ok: false;
} & RemoteRefusal);
export declare function normalizeTeamDomain(value: string): string;
export declare function expectedIssuer(teamDomain: string): string;
/** RFC 7517 endpoint for a Cloudflare Access team. */
export declare function accessJwksUrl(teamDomain: string): string;
/**
 * The ONLY network path in this module. Constructing it performs no I/O;
 * a fetch happens only when a verification actually reads keys.
 */
export declare function createAccessJwksSource(teamDomain: string, fetchImpl?: typeof fetch, timeoutMs?: number): JwksSource;
/**
 * Verify one Access JWT end to end. Every failure is typed; no failure
 * ever returns a subject.
 */
export declare function verifyAccessJwt(token: string, expectations: AccessJwtExpectations): Promise<AccessJwtVerification>;
