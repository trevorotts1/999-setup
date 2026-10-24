/** Schema/policy stamps for intake-owned records. */
export const INTAKE_SCHEMA_VERSION = 'wise-elders.intake/v1';
export const CRITICAL_DOMAIN_POLICY_VERSION = 'wise-elders.critical-domain-policy/v1';
/** Typed intake failure. Messages never carry private preference content. */
export class IntakeError extends Error {
    detail;
    code;
    constructor(code, message, detail) {
        super(message);
        this.detail = detail;
        this.name = 'IntakeError';
        this.code = code;
        this.detail = detail ?? null;
    }
}
export const EMPTY_ANSWERS = {
    decision: null,
    options: null,
    success: null,
    constraints: null,
    facts: null,
    assumptions: null,
    unknowns: null,
    stakeholders: null,
};
