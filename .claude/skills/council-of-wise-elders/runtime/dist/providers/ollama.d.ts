/**
 * Local Ollama-compatible transport profile (CWE-009; directive
 * Sections 13 and 28.4).
 *
 * This is the SAME OpenAI-compatible adapter as compatible.ts, bound
 * through a local profile: local and remote routes differ only through
 * the adapter's configuration, never through separate council
 * algorithms (T031). The profile exists to hold the local guarantees:
 *
 * - the endpoint is the installation's configured compatible endpoint
 *   for the local daemon (default http://127.0.0.1:11434/v1, the
 *   documented local Ollama surface). A deliberately configured
 *   loopback endpoint is allowed and expected (Section 28.4); there
 *   is no blanket loopback ban;
 * - local and cloud identity are preserved: the pinned model string
 *   reaches the wire byte-identical, including local tags (for
 *   example an `:8b` tag) and cloud suffixes (for example `:cloud`).
 *   Nothing in this profile strips, rewrites, or re-resolves a model
 *   name, and a signed-in local daemon serving cloud models through
 *   the loopback endpoint is used exactly as configured;
 * - no side effects on the daemon: the shared request builder sends
 *   only model, messages, stream, and a mapped reasoning parameter.
 *   This profile never calls a pull, delete, or unload operation,
 *   never sends keep_alive overrides, and never changes context
 *   settings (no num_ctx or other daemon options) as a side effect
 *   of a council request;
 * - credentials: a local route normally records credential state
 *   not_required and sends no Authorization header. When a daemon is
 *   configured to require one, the value still travels only through
 *   the host credential resolver path, exactly as for remote routes.
 */
import { CompatibleHttpTransport, type CompatibleTransportBinding } from './compatible.js';
/** The documented local Ollama compatible base URL, when configuration names none. */
export declare const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export interface OllamaTransportBinding extends Omit<CompatibleTransportBinding, 'baseUrl'> {
    /** Configured local compatible base URL. Default: the local daemon surface. */
    baseUrl?: string;
}
/**
 * Create a local-profile compatible transport. The binding's selection
 * stays the single source of the wire model; the profile only supplies
 * local defaults and refuses a non-local endpoint unless the binding
 * explicitly marks the route as a configured remote Ollama endpoint
 * through the generic compatible transport instead.
 */
export declare function createOllamaTransport(binding: OllamaTransportBinding): CompatibleHttpTransport;
