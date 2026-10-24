/**
 * Typed errors for the durable deliberation job runner (CWE-027,
 * directive Sections 15 and 34 CWE-027).
 *
 * Every refusal the runner raises is one of these codes, so callers
 * (and tests) distinguish a fencing loss from a control conflict from
 * a capability gap without matching message text. Errors from the
 * composed services keep their own types (CWE-028 BudgetCapacityError,
 * CWE-049 RunAuthorizationError, CWE-006 PersistenceError); the runner
 * never wraps them into its own codes, because their codes are the
 * contract CWE-050 reconciles against.
 */
export class JobRunnerError extends Error {
    code;
    retryable;
    detail;
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'JobRunnerError';
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.detail = options.detail ?? null;
    }
}
export function isJobRunnerError(error, code) {
    return (error instanceof JobRunnerError && (code === undefined || error.code === code));
}
/**
 * Thrown by test doubles and crash simulators to emulate a worker
 * process dying mid-operation. The runner deliberately does NOT catch
 * it as an operation failure: a crash is not a failure verdict, it is
 * the absence of one, and the durable state (job lease, attempt
 * ledger, reservation) is what the next worker reconciles. Production
 * transports never throw this; it exists so tests can kill an
 * operation at the defined points (after admission, after dispatch,
 * after commit) and prove recovery from durable state alone.
 */
export class SimulatedCrashError extends Error {
    code = 'SIMULATED_CRASH';
    constructor(point) {
        super(`Simulated worker crash at ${point}.`);
        this.name = 'SimulatedCrashError';
    }
}
export function isSimulatedCrash(error) {
    return (error instanceof SimulatedCrashError ||
        (error instanceof Error && error.code === 'SIMULATED_CRASH'));
}
