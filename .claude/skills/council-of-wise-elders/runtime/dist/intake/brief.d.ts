/**
 * CWE-023 brief composition (directive Sections 9.1, 9.4, 11.6, 12.1).
 *
 * Composition is deterministic: the same draft and revision number
 * always produce the same DecisionBrief and therefore the same
 * canonical content hash. The composed brief is validated against the
 * CWE-003 canonical contract before it is saved anywhere.
 *
 * Honesty rules enforced here:
 * - Client statements, retrieved facts, assumptions, ranges, and
 *   unknowns stay distinguishable (T017): confirmed facts compose
 *   into facts; assumptions compose into assumptions; scaffold
 *   placeholders and explicit unknowns compose into unknowns, never
 *   into facts (T014).
 * - The client's preference is never composed in. The brief carries
 *   only private_preference_ref, the opaque ID of the separate
 *   preference record.
 * - Relevance weights freeze with the brief (Section 12.1): seats
 *   responsible for a triggered critical domain weigh 3, other panel
 *   seats weigh 2. A weight correction after freeze requires a new
 *   revision by construction, because any change changes the hash.
 */
import { type DecisionBrief } from '../contracts/index.js';
import { type IntakeDraft } from './types.js';
/** Compose the DecisionBrief for `revision` from the current draft. */
export declare function composeBrief(args: {
    draft: IntakeDraft;
    revision: number;
    createdAt: string;
}): DecisionBrief;
/** The canonical content hash of a brief revision (Sections 11.6, 17). */
export declare function briefContentHash(brief: DecisionBrief): string;
/**
 * The frozen evidence manifest hash recorded on the freeze record:
 * the canonical hash of exactly the brief's evidence manifest, the
 * manifest of authorized evidence assembled via CWE-022.
 */
export declare function evidenceManifestHash(brief: DecisionBrief): string;
