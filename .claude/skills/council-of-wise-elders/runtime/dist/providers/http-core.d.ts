/**
 * Single-attempt HTTP executor for OpenAI-compatible endpoints
 * (CWE-009; directive Sections 13, 15.5, 15.8, 16.6).
 *
 * One call to executeHttpAttempt performs exactly one network attempt:
 * it never retries, never follows a redirect, and never substitutes
 * anything. Retry policy lives in the transport (compatible.ts); this
 * module owns the wire facts:
 *
 * - the per-operation deadline (an AbortController separate from any
 *   operation lease, Section 15.8) and caller cancellation;
 * - failure classification: a failure provably before acceptance
 *   (connection refused, DNS) is a retryable network failure; a
 *   failure after the request may have been submitted (deadline while
 *   awaiting the response, a broken stream, an ambiguous socket
 *   error) is provider_submitted_unresolved and is never replayed
 *   blindly (Section 15.5);
 * - response parsing: text, the provider's structured reported model
 *   id, usage, and the provider request id, for both the JSON envelope
 *   and server-sent-event streams. Model identity is read ONLY from
 *   structured fields, never from prose content (Section 13.4), and
 *   hidden-reasoning fields are never read into any output;
 * - safe parse diagnostics: a malformed envelope yields only an error
 *   code, a schema path, a byte count, and a body hash (Section 16.6).
 *   Bodies are hashed and counted in memory and never retained.
 */
import { TransportError } from './errors.js';
/** Hard read cap for one response body, in memory. */
export declare const MAX_RESPONSE_BYTES: number;
export interface FetchResponseLike {
    status: number;
    headers: {
        get(name: string): string | null;
    };
    body: ReadableStream<Uint8Array> | null;
}
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'manual';
}) => Promise<FetchResponseLike>;
export interface HttpAttemptInput {
    url: string;
    headers: Record<string, string>;
    /** Canonical request body text, built once per operation by the transport. */
    bodyText: string;
    /** Request the streaming form of the compatible API. */
    stream: boolean;
    /** Remaining operation deadline for this attempt, in milliseconds. */
    deadlineMs: number;
    /** Caller cancellation (the engine's operation signal). */
    signal?: AbortSignal;
}
export interface HttpAttemptOutcome {
    status: number;
    retryAfterMs: number | null;
    providerRequestId: string | null;
    /** Structured provider-reported model id (2xx only). */
    reportedModelId: string | null;
    /** Model text (2xx only). Hidden-reasoning fields are never included. */
    text: string | null;
    usage: {
        input_tokens: number | null;
        output_tokens: number | null;
    };
    bodyBytes: number;
    bodySha256: string;
}
export interface HttpCoreDeps {
    fetchImpl?: FetchLike;
    nowMs?: () => number;
}
/** Parse a Retry-After header (delay-seconds or HTTP-date) to milliseconds. */
export declare function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null;
/**
 * Classify a rejected fetch. `submitted` is true once the request has
 * been handed to fetch: from that point an ambiguous failure means the
 * provider may have accepted it, and the honest state is unresolved.
 */
export declare function classifyFetchFailure(err: unknown, flags: {
    deadlineFired: boolean;
    callerAborted: boolean;
}): TransportError;
interface ParsedEnvelope {
    text: string;
    reportedModelId: string | null;
    providerRequestId: string | null;
    usage: {
        input_tokens: number | null;
        output_tokens: number | null;
    };
}
/** Parse one non-streaming chat-completion envelope. Throws safe errors only. */
export declare function parseChatCompletionEnvelope(bodyText: string, byteCount: number, responseSha256: string, headerRequestId: string | null): ParsedEnvelope;
/**
 * Perform exactly one HTTP attempt and return its wire outcome. HTTP
 * error statuses are RETURNED (the transport classifies them); network
 * failures, deadline expiry, cancellation, and malformed success
 * envelopes are THROWN as typed TransportErrors.
 */
export declare function executeHttpAttempt(input: HttpAttemptInput, deps?: HttpCoreDeps): Promise<HttpAttemptOutcome>;
export {};
