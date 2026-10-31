export declare const COUNCIL_SIZES: readonly ["light", "medium", "heavy"];
export type CouncilSize = (typeof COUNCIL_SIZES)[number];
/**
 * Every council size seats the FULL roster. Mode never selects a smaller
 * panel (Trevor decision 2026-10-25: "all of the modes should be all of the
 * agents... all council members are used"). Mode controls ROUNDS and
 * CONCURRENCY only.
 */
export declare const MODE_SEATS: 9;
export interface ModeRoundPolicy {
    /** Panel seats: the full roster in every mode. */
    seats: number;
    /** Rounds that always run before any stop rule may fire. */
    min_rounds: number;
    /** Hard ceiling on rounds. */
    max_rounds: number;
    /** Earliest round at which the consensus rule may stop; null never stops early. */
    stop_from_round: number | null;
    /** Provider-request cap for the session (the only enforced limit). */
    max_provider_requests: number;
    /** Provider calls dispatched at once (wave width) — the one concurrency knob. */
    max_concurrent_calls: number;
}
export declare const MODE_ROUND_POLICY: Readonly<Record<CouncilSize, ModeRoundPolicy>>;
/** Seats that must share the same top option for the consensus stop rule. */
export declare const CONSENSUS_MIN_SEATS = 7;
/** Points by which the leading option must beat the runner-up. */
export declare const CONSENSUS_LEAD = 1.5;
/** Highest advisor-card round number a challenge pass may carry. */
export declare const MAX_ADVISOR_ROUND = 10;
export declare function isCouncilSize(mode: string): mode is CouncilSize;
