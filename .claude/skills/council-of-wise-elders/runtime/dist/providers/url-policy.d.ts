/**
 * Provider endpoint URL policy (CWE-009; directive Section 28.4).
 *
 * Only an authorized configuration path may add a provider endpoint:
 * for this transport layer, that path is the transport binding a host
 * composes at startup. Every configured endpoint is assessed before
 * the transport is constructed:
 *
 * - scheme must be http or https; plain http is accepted only for
 *   loopback or private-network endpoints (a deliberately configured
 *   local route) unless the binding explicitly allows insecure remote
 *   http;
 * - credentials embedded in the URL (userinfo) are always rejected:
 *   secrets travel only through the host credential resolver;
 * - cloud metadata and link-local targets are always blocked, in every
 *   configuration, including the instance metadata addresses and the
 *   metadata hostname;
 * - hostnames are normalized before classification: a single trailing
 *   dot (a rooted FQDN such as "metadata.google.internal.") is removed,
 *   because the URL parser preserves it for hostnames while DNS
 *   resolves the dotted and undotted spellings to the same host; and
 *   an IPv4-mapped IPv6 literal ("[::ffff:a9fe:a9fe]") is classified
 *   by its embedded IPv4 address, because a dual-stack connect
 *   through the mapped form reaches that IPv4 service;
 * - loopback endpoints are NOT blanket-banned: a deliberately
 *   configured local Ollama or 9Router loopback endpoint is a first
 *   class local route (Section 28.4), classified as loopback so its
 *   locality is visible in every attempt record;
 * - redirects are never followed by the transport (fetch is issued
 *   with redirect: manual and a 3xx is a typed refusal), so a
 *   configured endpoint cannot bounce a request, or its credential,
 *   to a different origin.
 *
 * Assessment is lexical, on the configured URL itself. It performs no
 * DNS resolution and no network I/O; a host that needs resolution-time
 * checks (rebinding defense) layers them at its own boundary.
 */
export type EndpointLocality = 'loopback' | 'private_network' | 'public';
export interface EndpointAssessment {
    /** The final request URL (base plus chat-completions path). */
    url: string;
    /** scheme://host:port; safe to record (never contains userinfo). */
    origin: string;
    locality: EndpointLocality;
    isLoopback: boolean;
}
export interface EndpointPolicyOptions {
    /** Path appended to the configured base URL. Default '/chat/completions'. */
    chatCompletionsPath?: string;
    /** Explicit opt-in for plain http to a public endpoint. Default false. */
    allowInsecureRemoteHttp?: boolean;
}
/**
 * Assess a configured provider base URL. Throws a typed
 * TRANSPORT_ENDPOINT_BLOCKED error for anything the policy refuses;
 * construction of a transport fails closed on a refused endpoint.
 */
export declare function assessEndpoint(baseUrl: string, options?: EndpointPolicyOptions): EndpointAssessment;
