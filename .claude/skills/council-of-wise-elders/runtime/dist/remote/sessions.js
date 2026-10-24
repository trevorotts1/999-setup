/**
 * Remote session resolution and reauthentication (WER-023).
 *
 * Reuses the merged WER-021 shapes rather than inventing parallel ones:
 * `sessionUrl` builds the true URL from a bound origin, and the session
 * authority vocabulary (`standalone` | `managed`) is the existing one.
 *
 * Guarantees proven by the colocated tests:
 * - remote access is opt-in: a disabled configuration refuses remote
 *   resolution with a typed reason and never emits a localhost URL;
 * - one session resolves to exactly ONE verified HTTPS endpoint URL, or a
 *   typed failure — an ambiguous ownership record is refused, never
 *   guessed;
 * - reauthentication resumes the SAME durable session id and issues ZERO
 *   billable Start calls;
 * - connection loss is a transport state, never a cancellation, and the
 *   durable session survives token expiry and reconnect;
 * - a cross-user attempt is refused with the SAME reason as an unknown
 *   session, so it cannot confirm that the other subject's session exists.
 */
import { sessionUrl } from '../service/sessions.js';
import { authenticateRemoteRequest } from './auth.js';
import { createAccessJwksSource, expectedIssuer } from './access-jwt.js';
import { REMOTE_CONFIG_SCHEMA } from './types.js';
const MAX_SESSION_ID_LENGTH = 512;
/** Identical refusal for unknown sessions and other subjects' sessions. */
const NOT_AVAILABLE_DETAIL = 'The requested session is not available to this verified subject.';
const NOT_AVAILABLE_RECOVERY = 'Use a durable session id belonging to the authenticated subject.';
export class RemoteConfigurationError extends Error {
    code;
    constructor(detail) {
        super(`REMOTE_CONFIG_INVALID: ${detail}`);
        this.name = 'RemoteConfigurationError';
        this.code = 'REMOTE_CONFIG_INVALID';
    }
}
function absoluteHttpsOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:')
            return null;
        if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0)
            return null;
        return url.origin.toLowerCase();
    }
    catch {
        return null;
    }
}
function absoluteHttpOrigin(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return null;
        return url.origin.toLowerCase();
    }
    catch {
        return null;
    }
}
/**
 * Build a validated configuration. An absent/disabled configuration is
 * valid and returns the typed disabled variant; only a half-enabled
 * configuration throws, so a partially configured customer never runs.
 */
export function buildRemoteConfiguration(input) {
    if (input.enabled !== true) {
        return { schema_version: REMOTE_CONFIG_SCHEMA, enabled: false };
    }
    const teamDomain = (input.team_domain ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(teamDomain)) {
        throw new RemoteConfigurationError('An enabled configuration requires the Access team domain.');
    }
    const audience = (input.audience ?? '').trim();
    if (audience.length === 0) {
        throw new RemoteConfigurationError('An enabled configuration requires the pinned Access audience.');
    }
    const allowed = [...new Set((input.allowed_origins ?? []).map((origin) => absoluteHttpOrigin(origin)))];
    if (allowed.length === 0 || allowed.some((origin) => origin === null)) {
        throw new RemoteConfigurationError('An enabled configuration requires at least one absolute HTTP(S) allowed origin.');
    }
    const allowedSet = new Set(allowed);
    const endpoints = input.endpoints ?? [];
    if (endpoints.length === 0) {
        throw new RemoteConfigurationError('An enabled configuration requires at least one verified endpoint.');
    }
    const seen = new Set();
    const normalizedEndpoints = endpoints.map((endpoint) => {
        const id = endpoint.endpoint_id.trim();
        if (id.length === 0) {
            throw new RemoteConfigurationError('Every endpoint requires a non-empty endpoint_id.');
        }
        if (seen.has(id)) {
            throw new RemoteConfigurationError(`Endpoint id ${JSON.stringify(id)} is declared twice.`);
        }
        seen.add(id);
        if (endpoint.verified !== true) {
            throw new RemoteConfigurationError(`Endpoint ${id} is not a verified endpoint.`);
        }
        const origin = absoluteHttpsOrigin(endpoint.origin);
        if (origin === null) {
            throw new RemoteConfigurationError(`Endpoint ${id} must be an absolute HTTPS origin.`);
        }
        if (!allowedSet.has(origin)) {
            throw new RemoteConfigurationError(`Endpoint ${id} is outside the configured allowed origin set.`);
        }
        return { endpoint_id: id, origin, verified: true };
    });
    const skew = input.clock_skew_seconds ?? 60;
    if (!Number.isFinite(skew) || skew < 0) {
        throw new RemoteConfigurationError('clock_skew_seconds must be a non-negative number.');
    }
    return {
        schema_version: REMOTE_CONFIG_SCHEMA,
        enabled: true,
        team_domain: teamDomain,
        audience,
        allowed_origins: allowed,
        endpoints: normalizedEndpoints,
        jwks: input.jwks ?? createAccessJwksSource(teamDomain),
        clock_skew_seconds: skew,
    };
}
function refused(sessionId, code, detail, recovery, billableStarts) {
    return {
        kind: 'refused',
        session_id: sessionId,
        url: null,
        code,
        detail,
        recovery,
        billable_starts: billableStarts,
    };
}
function refusalOf(sessionId, refusal, billableStarts) {
    return refused(sessionId, refusal.code, refusal.detail, refusal.recovery, billableStarts);
}
/**
 * Resolve one session to exactly one verified HTTPS endpoint URL.
 * Ownership, endpoint selection and origin membership are all enforced.
 */
export async function resolveRemoteSession(input) {
    const { config, identity, resumed, billable_starts } = input;
    const sessionId = typeof input.session_id === 'string' ? input.session_id.trim() : '';
    if (config.enabled !== true) {
        return refused(sessionId.length > 0 ? sessionId : null, 'REMOTE_DISABLED', 'Remote access is not enabled for this customer.', 'Enable the customer remote configuration (team domain, audience, allowed origin and endpoint) to use remote sessions; local and managed operation are unaffected.', billable_starts);
    }
    if (sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) {
        return refused(null, 'REMOTE_SESSION_ID_MISSING', 'A remote resolution requires a bounded non-empty durable session id.', 'Supply the durable session id returned by the owning authority.', billable_starts);
    }
    const record = await input.lookupSession(sessionId);
    if (record === null) {
        return refused(sessionId, 'REMOTE_SESSION_NOT_AVAILABLE', NOT_AVAILABLE_DETAIL, NOT_AVAILABLE_RECOVERY, billable_starts);
    }
    if (record.session_id !== sessionId) {
        // A lookup that answers with another id is a broken owner, not a hint.
        return refused(sessionId, 'REMOTE_SESSION_NOT_AVAILABLE', NOT_AVAILABLE_DETAIL, NOT_AVAILABLE_RECOVERY, billable_starts);
    }
    if (record.owner_subject !== identity.subject) {
        // Same reason and text as an unknown session: existence never leaks.
        return refused(sessionId, 'REMOTE_SESSION_NOT_AVAILABLE', NOT_AVAILABLE_DETAIL, NOT_AVAILABLE_RECOVERY, billable_starts);
    }
    const endpointIds = [...new Set(record.endpoint_ids.filter((id) => typeof id === 'string' && id.trim().length > 0))];
    if (endpointIds.length === 0) {
        return refused(sessionId, 'REMOTE_SESSION_ENDPOINT_MISSING', 'The session names no owning endpoint.', 'Record exactly one owning endpoint for the session on the owning authority; no localhost fallback is used.', billable_starts);
    }
    if (endpointIds.length > 1) {
        return refused(sessionId, 'REMOTE_SESSION_ENDPOINT_AMBIGUOUS', 'The session names more than one owning endpoint; a phone uses one selected owning endpoint.', 'Record exactly one owning endpoint for the session on the owning authority.', billable_starts);
    }
    const endpoint = config.endpoints.find((candidate) => candidate.endpoint_id === endpointIds[0]);
    if (!endpoint) {
        return refused(sessionId, 'REMOTE_SESSION_ENDPOINT_UNKNOWN', 'The session names an endpoint that is not configured for this customer.', 'Configure the owning endpoint, or correct the session record on the owning authority.', billable_starts);
    }
    if (endpoint.verified !== true || absoluteHttpsOrigin(endpoint.origin) === null) {
        return refused(sessionId, 'REMOTE_SESSION_ENDPOINT_UNVERIFIED', 'The owning endpoint is not a verified HTTPS origin.', 'Verify the endpoint HTTPS origin before resolving remote sessions through it.', billable_starts);
    }
    return {
        kind: 'resolved',
        session_id: sessionId,
        url: sessionUrl(endpoint.origin, sessionId),
        endpoint_id: endpoint.endpoint_id,
        authority: record.authority,
        subject: identity.subject,
        resumed,
        billable_starts,
    };
}
/**
 * One durable remote session per phone. Tracks the active session id and
 * the billable Start count so reauthentication can be proven to issue
 * zero Starts.
 */
export class RemoteSessionBridge {
    options;
    activeSessionId = null;
    starts = 0;
    reauthenticationStarts = 0;
    cancels = 0;
    constructor(options) {
        this.options = options;
    }
    get sessionId() {
        return this.activeSessionId;
    }
    get billableStarts() {
        return this.starts;
    }
    /** Starts issued during reauthentication. Always 0 by construction. */
    get reauthenticationBillableStarts() {
        return this.reauthenticationStarts;
    }
    get cancellations() {
        return this.cancels;
    }
    /** First establishment: may issue the one billable Start for this session. */
    async establish(request) {
        return this.run(request, {
            reauthentication: false,
            resumed: false,
            requireActiveSession: false,
        });
    }
    /** Resume after token expiry. Same durable session id; never a Start. */
    async reauthenticate(request) {
        return this.run(request, {
            reauthentication: true,
            resumed: true,
            requireActiveSession: true,
        });
    }
    /** Resume after connection loss. Same durable session id; never a Start. */
    async resume(request) {
        return this.run(request, {
            reauthentication: true,
            resumed: true,
            requireActiveSession: true,
        });
    }
    /**
     * Observe a transport loss. The durable session id and its live state
     * are preserved; this is never a cancellation.
     */
    connectionLost(input) {
        return {
            state: 'reconnecting',
            session_id: input.session_id,
            cancelled: false,
            detail: 'Transport lost. The durable session is preserved and resumes after reauthentication.',
            billable_starts: this.starts,
            cancellations: this.cancels,
        };
    }
    async run(request, mode) {
        const config = this.options.config;
        const requestedId = typeof request.session_id === 'string' ? request.session_id.trim() : null;
        if (mode.requireActiveSession && this.activeSessionId !== null && requestedId !== this.activeSessionId) {
            return refused(requestedId, 'REMOTE_REAUTH_SESSION_MISMATCH', 'Reauthentication must resume the same durable session id.', 'Reauthenticate the session that is already established; a reauthentication never switches sessions.', this.starts);
        }
        if (config.enabled !== true) {
            return refused(requestedId, 'REMOTE_DISABLED', 'Remote access is not enabled for this customer.', 'Enable the customer remote configuration (team domain, audience, allowed origin and endpoint) to use remote sessions; local and managed operation are unaffected.', this.starts);
        }
        const authentication = await authenticateRemoteRequest(request.headers, config, { now_seconds: this.options.now_seconds });
        if (!authentication.ok) {
            return refusalOf(requestedId, authentication, this.starts);
        }
        const resolution = await resolveRemoteSession({
            session_id: request.session_id,
            identity: authentication.identity,
            config,
            lookupSession: this.options.lookupSession,
            resumed: mode.resumed,
            billable_starts: this.starts,
        });
        if (resolution.kind === 'refused') {
            return resolution;
        }
        if (!mode.reauthentication && this.activeSessionId !== resolution.session_id) {
            this.options.startBillable?.({ session_id: resolution.session_id });
            this.starts += 1;
        }
        // Deliberately no Start on the reauthentication path. `starts` is the
        // only counter the Start port can move, and this branch never reaches it.
        this.activeSessionId = resolution.session_id;
        return { ...resolution, resumed: mode.resumed, billable_starts: this.starts };
    }
}
/** Exposed so the composition root can bind the real team's key source. */
export { createAccessJwksSource, expectedIssuer };
