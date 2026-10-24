import { AuthorizationError, } from './scope.js';
/**
 * Which of the four separate authorizations a permission requires
 * (Section 1.2). build, council_run, action_plan_approval, and execution
 * are never interchangeable: a council_run grant does not approve a plan,
 * and no council outcome is an execution credential. Read-family
 * permissions map to null because they are governed by the scope and
 * visibility decisions in scope.ts, not by a grant kind.
 */
export const AUTHORIZATION_KIND_FOR_PERMISSION = {
    run: 'council_run',
    approve_plan: 'action_plan_approval',
    create_tasks: 'action_plan_approval',
    execute: 'execution',
    read: null,
    evidence: null,
    export: null,
    diagnostic_capture: null,
};
export function authorizationKindForPermission(permission) {
    return AUTHORIZATION_KIND_FOR_PERMISSION[permission];
}
/**
 * Machine-binding check (T077). Fails unless the principal arrived on the
 * machine channel, its trusted scope equals the binding's installation
 * and company, the operation is inside the binding's operation set, and
 * a session-pinned binding is used only for that session. A browser or
 * local-owner principal can never satisfy a machine binding, and a
 * machine principal gains nothing beyond its binding.
 */
export function checkMachineBinding(principal, binding, operation, sessionId) {
    const fail = (message) => ({
        allowed: false,
        code: 'COUNCIL_MACHINE_BINDING',
        message,
    });
    if (principal.channel !== 'machine') {
        return fail('Machine operations require a machine-bound principal.');
    }
    if (principal.installation_id !== binding.installation_id) {
        return fail('Principal is not bound to this installation.');
    }
    if (principal.company_id !== binding.company_id) {
        return fail('Principal is not bound to this company.');
    }
    if (!binding.operations.includes(operation)) {
        return fail(`Operation ${operation} is outside this machine binding.`);
    }
    if (binding.session_id !== undefined &&
        binding.session_id !== null &&
        binding.session_id !== sessionId) {
        return fail('Machine binding is pinned to a different session.');
    }
    // A binding decision is not a session visibility grant; report the
    // generic 'company' channel since the binding is company-scoped.
    return { allowed: true, via: 'company' };
}
/** Throwing form of checkMachineBinding. */
export function assertMachineBinding(principal, binding, operation, sessionId) {
    const decision = checkMachineBinding(principal, binding, operation, sessionId);
    if (!decision.allowed) {
        throw new AuthorizationError(decision.code, decision.message);
    }
}
/**
 * Query parameter names that would carry a credential (Section 17.1: API
 * keys and tokens never appear in URL query parameters). Council
 * surfaces reject any request carrying one of these names, regardless of
 * value, so a credential can never leak through a logged URL.
 */
export const QUERY_CREDENTIAL_PARAMETERS = new Set([
    'api_key',
    'apikey',
    'api-key',
    'access_token',
    'token',
    'key',
    'secret',
    'password',
    'auth',
    'bearer',
]);
/** Returns the offending parameter name (never its value), or null. */
export function findQueryCredentialParameter(parameterNames) {
    for (const name of parameterNames) {
        if (QUERY_CREDENTIAL_PARAMETERS.has(name.toLowerCase()))
            return name;
    }
    return null;
}
/** Throws COUNCIL_QUERY_CREDENTIAL naming the parameter, never its value. */
export function assertNoQueryCredentialParameter(parameterNames) {
    const offender = findQueryCredentialParameter(parameterNames);
    if (offender !== null) {
        throw new AuthorizationError('COUNCIL_QUERY_CREDENTIAL', `Credentials are not accepted in URL query parameters (${offender}).`, 400);
    }
}
