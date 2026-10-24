/**
 * Reasoning-effort parameter mapping (CWE-009; directive Section 13.5).
 *
 * The pinned selection carries the reasoning outcome CWE-008 resolved:
 * what the client requested, what may be claimed applied, whether the
 * route supports it, and the limitation when it does not. This module
 * turns the APPLIED level into wire parameters through an explicit,
 * tested mapping table, and nothing else:
 *
 * - `auto` is preserved as no forced vendor parameter: the request
 *   carries no reasoning field at all (Sections 13.5 and CWE-008's
 *   resolveReasoning both define auto this way);
 * - an applied level of null sends nothing; the limitation is already
 *   recorded on the selection and is never silently upgraded;
 * - a level with no verified mapping for the endpoint's parameter
 *   style (for example `max` on the generic compatible profile) is
 *   NEVER sent blindly and NEVER renamed to another level: the
 *   transport refuses before dispatch with a typed error, so the
 *   mismatch is fixed in the catalog instead of hidden in the request.
 */
import type { ReasoningPreferenceOutcome } from './selection.js';
/** How an endpoint family accepts a reasoning-effort parameter. */
export type ReasoningParamStyle = 'reasoning_effort' | 'reasoning_object' | 'none';
/**
 * The explicit mapping table. A level absent from this table has no
 * verified wire mapping and is refused, never improvised. `off` and
 * `none` map to sending no parameter: they ask for no forced reasoning,
 * which is represented by absence, not by an invented vendor value.
 */
export declare const REASONING_EFFORT_MAP: Readonly<Record<string, string | null>>;
export interface ReasoningMapping {
    /** Wire parameters to merge into the request body. Empty when none may be sent. */
    params: Record<string, unknown>;
    /** The applied level the parameters represent. Null when nothing is sent. */
    appliedLevel: string | null;
}
/**
 * Map the selection's reasoning outcome to wire parameters for one
 * endpoint parameter style. Throws TRANSPORT_REASONING_UNMAPPED before
 * any dispatch when the applied level cannot be represented honestly.
 */
export declare function mapReasoningToParams(reasoning: ReasoningPreferenceOutcome, style: ReasoningParamStyle): ReasoningMapping;
