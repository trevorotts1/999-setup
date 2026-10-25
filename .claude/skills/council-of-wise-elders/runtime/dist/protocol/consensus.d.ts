/**
 * Consensus stop rule for the council sizes (W77S-MODES).
 *
 * One deterministic, unweighted arithmetic question, asked of ONE
 * completed round's advisor cards: do enough seats share the same top
 * option, and does that option lead the runner-up by enough points?
 *
 * Per seat, the top option is the single highest-scored option on that
 * seat's card. A tie for highest scores nothing (no top), and a card
 * that abstains, is not an advisor card, or scores nothing is equally
 * silent. Nothing here is weighted, sampled or model-derived: the same
 * committed cards always produce the same answer.
 *
 * The caller owns the round policy (contracts/modes.ts): this module
 * never decides WHEN the rule may fire, only whether it holds.
 */
import type { AdvisorCard } from '../contracts/index.js';
export interface ConsensusResult {
    /** True only when the seat share and the lead threshold both hold. */
    readonly stop: boolean;
    /** The most common seat top this round; null when no seat has a top. */
    readonly top_option_id: string | null;
    /** Seats whose top is `top_option_id`. */
    readonly share: number;
    /** Seats evaluated this round (deduplicated by seat id). */
    readonly panel: number;
    /** Mean(T) minus mean(next-best) over the seats scoring both; null when unknown. */
    readonly lead: number | null;
}
/** The single highest-scored option on one seat's card, or null. */
export declare function topOptionOf(card: AdvisorCard, optionIds: readonly string[]): string | null;
/**
 * Evaluate the consensus stop rule over one round's panel seats.
 * Unweighted and pure; `optionIds` gives both the candidate set and the
 * deterministic tie-break order.
 */
export declare function evaluateConsensusStop(cards: readonly AdvisorCard[], optionIds: readonly string[]): ConsensusResult;
