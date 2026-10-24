/**
 * @blackceo/wise-elders-core package surface (CWE-004 foundation;
 * integration completed by CWE-050).
 *
 * Re-exports the CWE-003 canonical contracts and the full portable
 * core: injected host ports, the standalone local host, the
 * deliberation engine, budget and lease implementations, the local
 * SQLite store, the blackceo-council CLI dispatcher, and every
 * composed service family (authorization, budgets, persistence,
 * context, intake, scoring, protocol, sources, reports). The bridges
 * family is consumed by path imports only (see the note at the foot
 * of this file). This completes the barrel/exports alignment
 * CWE-007's integrator flag deferred to integration: the
 * authorization composition is part of the package surface, and path
 * imports keep working alongside it.
 *
 * Importing this package has no side effects: it opens no database,
 * starts no job, and performs no provider request. Hosts compose a
 * CouncilHost explicitly (createLocalHost for standalone mode) and hand
 * it to CouncilEngine or the CLI dispatcher.
 */
export * from './contracts/index.js';
export * from './cli/errors.js';
export * from './cli/host-ports.js';
export * from './cli/paths.js';
export * from './cli/budget.js';
export * from './cli/leases.js';
export * from './cli/local-store.js';
export * from './cli/local-host.js';
export * from './cli/engine.js';
export * from './cli/fixture-transport.js';
export * from './cli/dispatcher.js';
export * from './cli/authorization.js';
export * from './cli/report-export.js';
export * from './queue/index.js';
export * from './providers/errors.js';
export * from './providers/selection.js';
export * from './providers/url-policy.js';
export * from './providers/reasoning.js';
export * from './providers/diagnostics.js';
export * from './providers/http-core.js';
export * from './providers/compatible.js';
export * from './providers/ollama.js';
export * from './persistence/index.js';
export * from './context/index.js';
export * from './intake/index.js';
export * from './scoring/index.js';
export * from './protocol/index.js';
export * from './sources/index.js';
export * from './reports/index.js';
export type { SessionAccessTarget } from './authorization/index.js';
export type { RouteIdentityLevel } from './providers/selection.js';
export { CONSULT_SYSTEM } from './cli/engine.js';
