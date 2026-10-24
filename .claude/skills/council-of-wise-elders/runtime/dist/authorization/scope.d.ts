/**
 * CWE-007 trusted authorization ports: scope resolution and session
 * visibility decisions (directive Sections 17.1, 17.5, 28.2).
 *
 * These are pure decision functions in canonical contract terms. They own
 * no transport and no storage: a host adapter (Command Center
 * src/lib/council/auth.ts on the product side, the local host in
 * src/cli on the portable side) resolves a TrustedPrincipal from its own
 * verified identity mechanism and then asks these functions whether an
 * operation is allowed. A caller never gains authority by supplying scope
 * fields; claimed scope is only ever compared against the trusted
 * principal, and a conflict is a denial, never an override.
 *
 * CWE-049 composes its run-grant and admission services on top of this
 * module; it owns runtime/src/authorization/run-grants.ts and the
 * preview/admission modules, which are deliberately not defined here.
 */
import type { ScopeFields, SessionVisibility } from '../contracts/index.js';
/** How the principal authenticated. Machine principals are the existing
 * approved bearer/pairing clients; they are additionally bound by
 * checkMachineBinding in permissions.ts. */
export type CouncilChannel = 'browser' | 'machine' | 'local_owner';
/**
 * A principal whose scope was resolved by a trusted host mechanism
 * (Command Center tenant context, or the local single-owner host), never
 * from request body or query input.
 */
export interface TrustedPrincipal {
    readonly tenant_id: string;
    readonly company_id: string;
    readonly installation_id: string;
    /** Trusted subject identity, for example an owner subject or the
     * machine subject. Never a caller-supplied string. */
    readonly subject: string;
    readonly channel: CouncilChannel;
    /**
     * Support access is granted ONLY by host configuration, never by
     * request input (directive Section 17.5, T075). A support read of a
     * private session is allowed through checkSessionRead with
     * via 'support' so the caller can audit it; support never grants a
     * mutation (checkSessionMutate).
     */
    readonly support_access: boolean;
}
/** The principal's own scope. owner_subject is null: a principal is a
 * caller, not a session; session scopes carry their owner. */
export declare function principalScope(principal: TrustedPrincipal): ScopeFields;
export type AuthorizationErrorCode = 'COUNCIL_UNAUTHENTICATED' | 'COUNCIL_AUTH_NOT_CONFIGURED' | 'COUNCIL_SCOPE_MISMATCH' | 'COUNCIL_CROSS_SCOPE' | 'COUNCIL_PRIVATE_OWNER_REQUIRED' | 'COUNCIL_PERMISSION_DENIED' | 'COUNCIL_MACHINE_BINDING' | 'COUNCIL_QUERY_CREDENTIAL' | 'COUNCIL_CSRF_REQUIRED' | 'COUNCIL_SECRET_LEAK';
/** Stable denial error. Messages never contain credential values. */
export declare class AuthorizationError extends Error {
    readonly code: AuthorizationErrorCode;
    readonly status: number;
    constructor(code: AuthorizationErrorCode, message: string, status?: number);
}
export type AccessVia = 'owner' | 'company' | 'support';
export type AccessDecision = {
    readonly allowed: true;
    readonly via: AccessVia;
} | {
    readonly allowed: false;
    readonly code: AuthorizationErrorCode;
    readonly message: string;
};
/**
 * Scope fields as a caller might claim them in a request body or query
 * string. Both the contract's snake_case and the Command Center's
 * camelCase spellings are inspected. Presence of a conflicting value is a
 * denial; presence of an equal value is tolerated (Section 17.1: reject
 * conflicting body/query scope); absence is normal.
 */
export interface ClaimedScope {
    tenant_id?: string | null;
    tenantId?: string | null;
    company_id?: string | null;
    companyId?: string | null;
    installation_id?: string | null;
    installationId?: string | null;
    owner_subject?: string | null;
    ownerSubject?: string | null;
}
/**
 * Returns the name of the first claimed field that conflicts with the
 * trusted principal, or null when every claimed field agrees (or none was
 * claimed). A claimed owner is honored only when the caller claims ITSELF:
 * naming another subject as owner is a conflict even inside the caller's
 * own tenant and company.
 */
export declare function findScopeConflict(principal: TrustedPrincipal, claimed: ClaimedScope): string | null;
/** Throws COUNCIL_SCOPE_MISMATCH when claimed scope conflicts. */
export declare function assertClaimedScopeMatches(principal: TrustedPrincipal, claimed: ClaimedScope): void;
export interface SessionAccessTarget {
    readonly scope: ScopeFields;
    readonly visibility: SessionVisibility;
}
/**
 * The session read rule (Section 17.5). Cross-tenant, cross-company, and
 * cross-installation reads always fail. A company-visible session is
 * readable by any principal inside the same scope. A private session is
 * readable only by its owner subject; company membership alone never
 * grants a private read. A host-granted support principal may read a
 * private session only through this decision, which reports via
 * 'support' so the caller records the auditable reason (T075).
 */
export declare function checkSessionRead(principal: TrustedPrincipal, target: SessionAccessTarget): AccessDecision;
/** Throwing form of checkSessionRead; returns how access was granted. */
export declare function assertSessionRead(principal: TrustedPrincipal, target: SessionAccessTarget): AccessVia;
/**
 * Mutation rule: identical scope barrier to reads, but support access
 * never authorizes a write. Private-session mutations require the owner;
 * company-session mutations require any in-scope principal (finer
 * permission kinds are checked separately through permissions.ts).
 */
export declare function checkSessionMutate(principal: TrustedPrincipal, target: SessionAccessTarget): AccessDecision;
/** Throwing form of checkSessionMutate. */
export declare function assertSessionMutate(principal: TrustedPrincipal, target: SessionAccessTarget): AccessVia;
