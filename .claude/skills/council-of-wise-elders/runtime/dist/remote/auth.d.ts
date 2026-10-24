/**
 * Trusted remote identity (WER-023).
 *
 * The plan's rule is literal: arbitrary forwarded headers do NOT
 * establish identity. `Cf-Access-Authenticated-User-Email` is read only
 * as a hint AFTER a JWT verifies; on its own it establishes nothing and
 * is refused exactly like no credential at all.
 *
 * Identity is also bound to the exact configured origin set. A request
 * whose Host (or, when present, Origin) is outside that set is refused
 * even when it carries a perfectly valid JWT.
 */
import type { RemoteAuthentication, RemoteEnabledConfig, RemoteHeaders } from './types.js';
/**
 * Exact origin-set membership. Host is compared as an exact `host[:port]`
 * string, never by suffix, so `council.example.com.evil.test` cannot pass.
 */
export declare function requestOriginIsAllowed(config: RemoteEnabledConfig, headers: RemoteHeaders): boolean;
export interface RemoteAuthOptions {
    /** Injected clock in epoch seconds; tests fix it. */
    now_seconds?: () => number;
}
/**
 * Authenticate one request behind Access.
 *
 * Order matters: the JWT is the only identity input, and it is verified
 * before any claim is read. The origin set is then enforced.
 */
export declare function authenticateRemoteRequest(headers: RemoteHeaders, config: RemoteEnabledConfig, options?: RemoteAuthOptions): Promise<RemoteAuthentication>;
