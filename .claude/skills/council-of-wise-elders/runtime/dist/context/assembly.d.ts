/**
 * CWE-022 bounded context assembly (directive Sections 9.2, 9.4, 9.5,
 * 11.6, 13.6).
 *
 * Assembly takes the frozen DecisionBrief, retrieves the authorized
 * candidate set through retrieval.ts, and builds one per-operation
 * context payload that provably fits the route's actual context limit:
 *
 * - The budget is arithmetic on canonical bytes. The route supplies its
 *   actual context limit plus the byte sizes of the system rules, the
 *   response schema, and the output reserve (each measured by the
 *   caller with the same canonical serializer); the context budget is
 *   what remains. Every fit decision measures the exact payload with
 *   canonicalBytes, hash field included at its final size.
 * - The minimum valid context is the brief view plus, for every
 *   selected seat that has authorized material, that seat's first item
 *   in deterministic order. If the minimum cannot fit, the result is
 *   the typed CONTEXT_TOO_SMALL readiness result for the session's
 *   mode, with the modes that would fit computed and offered. The
 *   council is never silently shrunk, no seat is dropped, no item is
 *   truncated mid-item, and no other model is substituted.
 * - Beyond the minimum, items are added whole, in deterministic order,
 *   while they fit the remaining budget and the seat's input budget
 *   (Section 34 build step 3). Constraints and provenance are part of
 *   the payload structure itself, so budget reduction can never strip
 *   them: an item enters with its full provenance or not at all.
 * - Round 1 (Section 9.4): the brief view omits private_preference_ref
 *   entirely, so the client's private preference is not part of Round 1
 *   context in any form. Legitimate values and constraints are brief
 *   content and are always present. The preference content itself is
 *   never an input to this module at all; only the brief's reference
 *   field exists, and Round 1 drops even that.
 * - Determinism: no clock, no randomness, no host state. Same inputs
 *   produce a byte-identical payload and the same content hash. The
 *   hash is the canonical hash of the payload with self-referential
 *   fields excluded (Section 11.6), computed over a placeholder of the
 *   final field size so the measured bytes are the shipped bytes.
 * - Peer material is never a candidate kind here: the catalog port
 *   carries source, pack, and session material only, so peer openings
 *   cannot enter any operation's context through this layer (the
 *   Section 34 acceptance proof for CWE-022).
 * - The brief view inside the payload carries the evidence manifest
 *   reduced to the included items, so excluded material leaves no
 *   identifier or digest in the payload. The full frozen manifest
 *   remains in the brief record in the store; the assembly-level
 *   evidence_manifest field carries the same reduced set as the
 *   frozen manifest of this context.
 */
import { type DecisionBrief, type EvidenceManifestEntry, type SeatId, type SessionMode } from '../contracts/index.js';
import type { TrustedPrincipal } from '../authorization/index.js';
import { type ContextOperation, type MaterialCatalog, type RetrievedItem, type SessionAccessTarget } from './types.js';
export declare const CONTEXT_ASSEMBLY_SCHEMA_VERSION = "wise-elders.context-assembly/v1";
/**
 * The route's actual limits and reserves, in canonical bytes (Sections
 * 9.5 and 13.6). context_limit_bytes is the configured route's real
 * limit, never a guessed family default.
 */
export interface RouteContextBudget {
    readonly context_limit_bytes: number;
    readonly system_rules_bytes: number;
    readonly response_schema_bytes: number;
    readonly output_reserve_bytes: number;
}
export interface AssembleContextRequest {
    readonly principal: TrustedPrincipal;
    readonly session: SessionAccessTarget & {
        readonly session_id: string;
        readonly mode: SessionMode;
        readonly seat_ids: readonly SeatId[];
    };
    readonly brief: DecisionBrief;
    readonly operation: ContextOperation;
    readonly route: RouteContextBudget;
    readonly catalog: MaterialCatalog;
    /** Seat-specific input budgets in canonical bytes (Section 34 step 3). */
    readonly seat_budgets?: Readonly<Partial<Record<SeatId, number>>>;
    readonly distributable?: boolean;
    readonly revoked_source_ids?: ReadonlySet<string>;
}
/** The brief as it appears inside an assembled context. */
export type BriefContextView = Omit<DecisionBrief, 'private_preference_ref'> & {
    readonly private_preference_ref?: string | null;
};
export interface AssembledContext {
    readonly schema_version: typeof CONTEXT_ASSEMBLY_SCHEMA_VERSION;
    readonly session_id: string;
    readonly operation: ContextOperation;
    readonly mode: SessionMode;
    readonly distributable: boolean;
    /** True exactly when the private preference was withheld (Round 1). */
    readonly preference_excluded: boolean;
    readonly brief: BriefContextView;
    readonly items: readonly RetrievedItem[];
    /** The frozen manifest, reduced to the included items only. */
    readonly evidence_manifest: readonly EvidenceManifestEntry[];
    readonly content_sha256: string;
}
export type ContextAssemblyResult = {
    readonly status: 'assembled';
    readonly context: AssembledContext;
    readonly context_sha256: string;
    /** Exact canonical byte length of the assembled context. */
    readonly byte_length: number;
    /** The context budget the assembly was fitted into. */
    readonly budget_bytes: number;
} | {
    readonly status: 'context_too_small';
    /** The Section 9.5 readiness vocabulary for this outcome. */
    readonly readiness: 'CONTEXT_TOO_SMALL';
    readonly mode: SessionMode;
    /** Canonical bytes the minimum valid context for this mode needs. */
    readonly minimum_required_bytes: number;
    /** Canonical bytes available for context under this route. */
    readonly available_bytes: number;
    /** Lower-context modes whose minimum would fit, when any. */
    readonly supported_lower_context_modes: readonly SessionMode[];
};
export declare function assembleContext(request: AssembleContextRequest): ContextAssemblyResult;
/** The frozen evidence manifest of an assembled context, for CWE-023/024. */
export declare function frozenManifestOf(context: AssembledContext): readonly EvidenceManifestEntry[];
/** Content hash check a consumer can re-run against a stored context. */
export declare function verifyContextHash(context: AssembledContext): boolean;
