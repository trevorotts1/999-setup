/**
 * CTR-133 preparation/proposal stage.
 *
 * A decision brief requires at least one real alternative. When the permitted
 * context states none, the honest path is NOT to invent one and score it: it
 * is one bounded preparation pass through the SAME configured provider route
 * the sitting will use, returning proposed strategies for confirmation.
 *
 * Boundaries enforced here:
 * - ONE provider request, maximum. No retry, no fan-out, no cascade, no
 *   per-seat calls. `request_budget` is part of the returned record.
 * - The provider port is INJECTED. This module never selects a provider,
 *   route, model, or credential, and never falls back to another route.
 * - Output is proposals, never facts: no catalog entry, price, customer fact,
 *   result, or promise may be invented. Missing material input is recorded as
 *   an explicit unknown, not filled in.
 * - No scoring, no recommendation, no GO, no external action. Proposals enter
 *   the normal brief only after the caller passes them here; the seats then
 *   score them as proposed alternatives in a NEW sitting.
 * - The known unresolved exploration placeholder is filtered out, never
 *   renamed into a plausible strategy.
 */
import type { OptionKind } from '../contracts/index.js';
export declare const PROPOSAL_STAGE_MAX_REQUESTS = 1;
export declare const PROPOSAL_STAGE_MIN_OPTIONS = 2;
export declare const PROPOSAL_STAGE_MAX_OPTIONS = 5;
export interface ProposalStageInput {
    question: string;
    permitted_context: {
        sources_read: readonly string[];
        facts: readonly {
            statement: string;
            source: string | null;
        }[];
        constraints: readonly string[];
        unknowns: readonly string[];
    };
    display_timezone: string;
    /** Requested ceiling; the stage never returns more than MAX_OPTIONS. */
    max_options?: number;
    /** Always 1. A larger value is refused, not clamped into more calls. */
    request_budget?: number;
}
export interface ProposalInferenceRequest {
    system: string;
    user: string;
    max_requests: 1;
}
/** The configured provider port. The caller pins the route; the stage does not. */
export type ProposalInferencePort = (request: ProposalInferenceRequest, options: {
    max_requests: 1;
}) => Promise<{
    text: string;
}>;
export interface ProposedOption {
    id: string;
    label: string;
    kind: OptionKind;
}
export interface PreparedProposals {
    ok: true;
    state: 'preparing';
    options: ProposedOption[];
    unknowns: string[];
    request_budget: number;
    request_count: number;
}
export interface PreparationBlocked {
    ok: false;
    state: 'input-needed';
    detail: string;
    missing: string[];
    request_budget: number;
    request_count: number;
}
export interface ProposalStageDeps {
    infer?: ProposalInferencePort | null;
    max_requests?: number;
}
/**
 * Run the ONE preparation request. Returns proposed alternatives or an honest
 * input-needed refusal. It never returns a placeholder option and never scores.
 */
export declare function prepareProposals(input: ProposalStageInput, deps?: ProposalStageDeps): Promise<PreparedProposals | PreparationBlocked>;
