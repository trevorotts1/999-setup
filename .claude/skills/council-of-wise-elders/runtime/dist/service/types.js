/**
 * Standalone Council front-door service contract (WER-021 dependency-ready
 * slice).
 *
 * One same-origin local service owns the API/event surface AROUND the
 * canonical durable owner. It is NOT a second engine, scheduler, budget
 * ledger, event history or identity database: admissions are forwarded to
 * the owning authority through an injected sink, and a managed session is
 * LINKED to its owning Command Center URL rather than duplicated locally.
 *
 * This slice emits contracts, commands and artifacts only. Registering a
 * system service, loading a launchd unit, installing a UI build or binding
 * a remote origin is deferred (host authority, WER-021 full packaging /
 * WER-023 remote access) and is never claimed here.
 */
/** Identity document schema served at /api/council/service/identity. */
export const SERVICE_IDENTITY_SCHEMA = 'wise-elders.service-identity/v1';
/** Readiness receipt schema. */
export const SERVICE_READINESS_SCHEMA = 'wise-elders.service-readiness/v1';
/** Front-door API version; part of identity matching. */
export const SERVICE_API_VERSION = 'v1';
/** Default loopback candidates, tried in order. Port 0 is allowed in tests. */
export const DEFAULT_SERVICE_PORTS = [8787, 8788, 8789];
/** Default bind host. Remote exposure belongs to WER-023, not here. */
export const DEFAULT_SERVICE_HOST = '127.0.0.1';
/**
 * The independent readiness layers the plan names. Each layer is observed
 * and reported separately: a registered handler, a model listing, a zero
 * exit code, an outbox scheduler or a queue admission is never combined
 * into `usable`.
 */
export const READINESS_LAYER_IDS = [
    'discovery',
    'executable',
    'store',
    'route',
    'packs',
    'worker',
    'ui',
];
// ---------------------------------------------------------------- convening
/**
 * The convening surface the composition root binds into the front door
 * (W28). Types only: the front door never builds a session, a route or a
 * grant itself; it forwards a validated request to the composed driver.
 */
export const CONVENE_HARNESSES = [
    'claude-nine',
    'claude-code',
    'deepseek',
    'unknown',
];
