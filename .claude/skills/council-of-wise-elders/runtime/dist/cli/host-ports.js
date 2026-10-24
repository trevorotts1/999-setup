/**
 * Injected host ports for the portable council core (CWE-004).
 *
 * Directive Section 5.1: the core owns protocol state, schemas, scoring,
 * evidence references, cancellation rules, and output validation. It does
 * NOT own Command Center authentication or a host's global model
 * configuration. Hosts supply every capability through these ports
 * (dependency injection); the portable core never imports Command Center
 * modules. The Command Center adapter supplies its existing DB, tenant
 * context, scheduler, credential resolver, event channel, and task
 * service. The standalone adapter (local-host.ts) supplies local
 * equivalents and has no Kanban mutation authority.
 *
 * Ownership map for the implementations behind these ports:
 * - CouncilStore repositories, event journal, outbox: CWE-006.
 * - Authorization and privacy adapters: CWE-007.
 * - Route registry and selection policy: CWE-008.
 * - HTTP/local transports: CWE-009. Host bridges: CWE-010.
 * - Durable scheduling and operation leases in production: CWE-027.
 * - Budget reservations and capacity service: CWE-028.
 * - Run authorization service (RunGrant issuance): CWE-049.
 * This unit defines the ports and a standalone local composition so the
 * CLI and the engine have a real, testable foundation today.
 */
export {};
