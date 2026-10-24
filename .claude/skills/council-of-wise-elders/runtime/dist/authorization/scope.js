/** The principal's own scope. owner_subject is null: a principal is a
 * caller, not a session; session scopes carry their owner. */
export function principalScope(principal) {
    return {
        tenant_id: principal.tenant_id,
        company_id: principal.company_id,
        installation_id: principal.installation_id,
        owner_subject: null,
    };
}
/** Stable denial error. Messages never contain credential values. */
export class AuthorizationError extends Error {
    code;
    status;
    constructor(code, message, status = 403) {
        super(message);
        this.name = 'AuthorizationError';
        this.code = code;
        this.status = status;
    }
}
function deny(code, message) {
    return { allowed: false, code, message };
}
function firstClaimed(claimed, snake, camel) {
    for (const value of [claimed[snake], claimed[camel]]) {
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return null;
}
/**
 * Returns the name of the first claimed field that conflicts with the
 * trusted principal, or null when every claimed field agrees (or none was
 * claimed). A claimed owner is honored only when the caller claims ITSELF:
 * naming another subject as owner is a conflict even inside the caller's
 * own tenant and company.
 */
export function findScopeConflict(principal, claimed) {
    const tenant = firstClaimed(claimed, 'tenant_id', 'tenantId');
    if (tenant !== null && tenant !== principal.tenant_id)
        return 'tenant_id';
    const company = firstClaimed(claimed, 'company_id', 'companyId');
    if (company !== null && company !== principal.company_id)
        return 'company_id';
    const installation = firstClaimed(claimed, 'installation_id', 'installationId');
    if (installation !== null && installation !== principal.installation_id) {
        return 'installation_id';
    }
    const owner = firstClaimed(claimed, 'owner_subject', 'ownerSubject');
    if (owner !== null && owner !== principal.subject)
        return 'owner_subject';
    return null;
}
/** Throws COUNCIL_SCOPE_MISMATCH when claimed scope conflicts. */
export function assertClaimedScopeMatches(principal, claimed) {
    const conflict = findScopeConflict(principal, claimed);
    if (conflict !== null) {
        throw new AuthorizationError('COUNCIL_SCOPE_MISMATCH', `Claimed ${conflict} does not match the trusted authorization context.`);
    }
}
function scopeBarrier(principal, target) {
    if (target.scope.tenant_id !== principal.tenant_id) {
        return deny('COUNCIL_CROSS_SCOPE', 'Session belongs to another tenant.');
    }
    if (target.scope.company_id !== principal.company_id) {
        return deny('COUNCIL_CROSS_SCOPE', 'Session belongs to another company.');
    }
    if (target.scope.installation_id !== principal.installation_id) {
        return deny('COUNCIL_CROSS_SCOPE', 'Session belongs to another installation.');
    }
    return null;
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
export function checkSessionRead(principal, target) {
    const barrier = scopeBarrier(principal, target);
    if (barrier)
        return barrier;
    if (target.visibility === 'company')
        return { allowed: true, via: 'company' };
    const owner = target.scope.owner_subject;
    if (owner !== null && owner === principal.subject) {
        return { allowed: true, via: 'owner' };
    }
    if (principal.support_access)
        return { allowed: true, via: 'support' };
    return deny('COUNCIL_PRIVATE_OWNER_REQUIRED', 'Private council sessions are readable only by their owner.');
}
/** Throwing form of checkSessionRead; returns how access was granted. */
export function assertSessionRead(principal, target) {
    const decision = checkSessionRead(principal, target);
    if (!decision.allowed) {
        throw new AuthorizationError(decision.code, decision.message);
    }
    return decision.via;
}
/**
 * Mutation rule: identical scope barrier to reads, but support access
 * never authorizes a write. Private-session mutations require the owner;
 * company-session mutations require any in-scope principal (finer
 * permission kinds are checked separately through permissions.ts).
 */
export function checkSessionMutate(principal, target) {
    const barrier = scopeBarrier(principal, target);
    if (barrier)
        return barrier;
    if (target.visibility === 'company')
        return { allowed: true, via: 'company' };
    const owner = target.scope.owner_subject;
    if (owner !== null && owner === principal.subject) {
        return { allowed: true, via: 'owner' };
    }
    return deny('COUNCIL_PRIVATE_OWNER_REQUIRED', 'Private council sessions can be changed only by their owner.');
}
/** Throwing form of checkSessionMutate. */
export function assertSessionMutate(principal, target) {
    const decision = checkSessionMutate(principal, target);
    if (!decision.allowed) {
        throw new AuthorizationError(decision.code, decision.message);
    }
    return decision.via;
}
