/**
 * The authorization envelope for repository access (CWE-006, directive
 * Sections 11.1, 16.2, and 34 CWE-006 build step 1).
 *
 * Every repository read and write carries an envelope: the trusted
 * scope (tenant, company, installation) plus the acting subject and
 * the purpose of the access. The envelope is host-filled by the caller
 * that resolved the trusted principal (CWE-007 owns that resolution);
 * the repository layer only enforces it:
 *
 * - Scope is checked before any content loads and before any write.
 *   A caller never gains authority by supplying scope fields: a write
 *   whose envelope scope does not match the record's scope is denied,
 *   and a read outside the envelope scope resolves to nothing (the two
 *   cases "does not exist" and "not yours" are indistinguishable).
 * - Private sessions additionally require the envelope actor to be the
 *   recorded owner for content reads (Section 11.1). Company-visible
 *   sessions are readable by any actor inside the same scope.
 * - Destructive and diagnostic purposes are explicit envelope purposes,
 *   never implied by a general write.
 */
import type { ScopeFields, SessionVisibility } from '../contracts/index.js';
export type EnvelopeActor = 'owner' | 'system' | 'worker' | 'chair';
export type EnvelopePurpose = 'read' | 'write' | 'delete' | 'diagnostic_capture' | 'diagnostic_read' | 'admin';
export interface AuthorizationEnvelope {
    tenant_id: string;
    company_id: string;
    installation_id: string;
    actor_subject: string;
    actor: EnvelopeActor;
    purpose: EnvelopePurpose;
}
export declare function envelopeFromScope(scope: ScopeFields, actorSubject: string, actor: EnvelopeActor, purpose: EnvelopePurpose): AuthorizationEnvelope;
/** The envelope's scope triple, in the column order the schema uses. */
export declare function envelopeScope(envelope: AuthorizationEnvelope): {
    tenantId: string;
    companyId: string;
};
/**
 * Assert that a record's scope is exactly the envelope's scope. Used on
 * writes, where silently writing across a scope boundary must be a loud
 * failure rather than an invisible no-op.
 */
export declare function assertEnvelopeMatchesScope(envelope: AuthorizationEnvelope, scope: ScopeFields): void;
/**
 * Section 11.1 visibility: a company session is visible to any actor in
 * its scope; a private session is visible only to its recorded owner.
 */
export declare function sessionVisibleToEnvelope(envelope: AuthorizationEnvelope, session: {
    visibility: SessionVisibility;
    owner_subject: string | null;
}): boolean;
/** Assert a purpose the caller must hold explicitly (delete, diagnostics). */
export declare function assertEnvelopePurpose(envelope: AuthorizationEnvelope, purpose: EnvelopePurpose, what: string): void;
