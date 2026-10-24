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
import { createHash } from 'node:crypto';
import { SERVICE_API_VERSION, SERVICE_IDENTITY_SCHEMA, } from './types.js';
export const SERVICE_IDENTITY_PATH = '/api/council/service/identity';
/** Trim a trailing slash so origin + path concatenation stays exact. */
export function normalizeOrigin(origin) {
    return origin.replace(/\/+$/, '');
}
export function sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function buildServiceOwner(input) {
    return {
        tenant_id: input.tenant_id,
        company_id: input.company_id,
        data_dir_sha256: sha256Hex(input.data_dir),
    };
}
export function buildServiceIdentity(input) {
    return {
        schema_version: SERVICE_IDENTITY_SCHEMA,
        service: 'council-of-wise-elders',
        composition: 'standalone',
        api_version: SERVICE_API_VERSION,
        owner: buildServiceOwner(input),
        started_at: input.started_at,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Structural validation of a served identity document. */
export function isServiceIdentity(value) {
    if (!isRecord(value))
        return false;
    if (value.schema_version !== SERVICE_IDENTITY_SCHEMA)
        return false;
    if (value.service !== 'council-of-wise-elders')
        return false;
    if (value.composition !== 'standalone')
        return false;
    if (value.api_version !== SERVICE_API_VERSION)
        return false;
    if (typeof value.started_at !== 'string')
        return false;
    if (!isRecord(value.owner))
        return false;
    const owner = value.owner;
    return (typeof owner.tenant_id === 'string' &&
        typeof owner.company_id === 'string' &&
        typeof owner.data_dir_sha256 === 'string');
}
/**
 * Exact identity match. Port, host, process id and `started_at` are NOT
 * part of the match: only the service contract and owner scope are.
 */
export function serviceIdentityMatches(expected, observed) {
    if (!observed)
        return false;
    return (observed.schema_version === expected.schema_version &&
        observed.service === expected.service &&
        observed.composition === expected.composition &&
        observed.api_version === expected.api_version &&
        observed.owner.tenant_id === expected.owner.tenant_id &&
        observed.owner.company_id === expected.owner.company_id &&
        observed.owner.data_dir_sha256 === expected.owner.data_dir_sha256);
}
/**
 * Read the identity endpoint at an origin. Never throws; every outcome is
 * reported, and `checked` names the URL consulted.
 */
export async function probeServiceIdentity(origin, fetchImpl = globalThis.fetch, timeoutMs = 1_500) {
    const url = `${normalizeOrigin(origin)}${SERVICE_IDENTITY_PATH}`;
    const checked = [url];
    try {
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            return {
                reachable: true,
                identity: null,
                error: `The identity endpoint answered HTTP ${response.status}.`,
                checked,
            };
        }
        let body;
        try {
            body = await response.json();
        }
        catch {
            return {
                reachable: true,
                identity: null,
                error: 'The identity endpoint did not return JSON.',
                checked,
            };
        }
        if (!isServiceIdentity(body)) {
            return {
                reachable: true,
                identity: null,
                error: 'The listener answered, but its document is not a Council service identity.',
                checked,
            };
        }
        return { reachable: true, identity: body, error: null, checked };
    }
    catch (error) {
        return {
            reachable: false,
            identity: null,
            error: error instanceof Error ? error.message : String(error),
            checked,
        };
    }
}
/**
 * Classify a listener. Only a reachable, structurally valid, exactly
 * matching identity is reusable. Anything else is refused as unrelated
 * (or unreachable) and must be left running.
 */
export async function classifyListener(origin, expected, fetchImpl = globalThis.fetch) {
    const probe = await probeServiceIdentity(origin, fetchImpl);
    if (probe.identity && serviceIdentityMatches(expected, probe.identity)) {
        return { classification: 'matching_service', probe };
    }
    return {
        classification: probe.reachable ? 'unrelated_listener' : 'unreachable',
        probe,
    };
}
