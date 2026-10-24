/**
 * Council remote access contract (WER-023 code half).
 *
 * This directory is the APPLICATION-side half of the Cloudflare remote
 * topology. It never creates, modifies or calls a Cloudflare resource:
 * the Tunnel, the Access application, the audience and the origin already
 * exist and are bound here as configuration.
 *
 * Non-negotiables encoded by these types:
 * - a forwarded identity header is NEVER identity on its own; only a
 *   verified Access JWT yields a subject;
 * - remote resolution is opt-in per customer; a disabled configuration
 *   refuses remote resolution with a typed reason while local/managed
 *   operation stays untouched;
 * - one session resolves to exactly ONE owning endpoint URL, or a typed
 *   failure — never two candidates, never a fallback to localhost.
 */
export const REMOTE_CONFIG_SCHEMA = 'wise-elders.remote-config/v1';
