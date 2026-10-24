/** Typed context-layer failure. Messages never carry item content or IDs. */
export class ContextError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ContextError';
        this.code = code;
    }
}
