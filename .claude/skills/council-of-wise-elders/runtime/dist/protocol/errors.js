export class ProtocolError extends Error {
    code;
    detail;
    constructor(code, message, detail = null) {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
        this.detail = detail;
    }
}
