/**
 * Typed contract errors for @blackceo/wise-elders-core (CWE-003).
 *
 * Every validation or canonicalization failure in the deterministic core is a
 * ContractError carrying a stable machine-readable code. Callers must branch on
 * `code`, never on message text. No host, network, filesystem, clock, or random
 * dependency exists in this module.
 */
export class ContractError extends Error {
    code;
    /** JSON-path style location of the offending value, when known. */
    path;
    constructor(code, message, path = null) {
        super(message);
        this.name = 'ContractError';
        this.code = code;
        this.path = path;
    }
}
