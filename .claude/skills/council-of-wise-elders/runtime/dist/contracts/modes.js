/**
 * Council sizes (W77S-MODES): light / medium / heavy.
 *
 * One source of truth for the per-mode round policy, the consensus stop
 * rule constants and the advisor-card round ceiling. The four older modes
 * (full, selected, quick, consult) are unchanged and keep their own
 * behaviour in every consumer; nothing here reinterprets them.
 *
 * A ROUND is one pass in which every panel seat answers once. Round 1 is
 * the isolated opening; every later pass challenges the open cruxes from
 * the previous round's cards.
 */
export const COUNCIL_SIZES = ['light', 'medium', 'heavy'];
export const MODE_ROUND_POLICY = {
    light: {
        seats: 3,
        min_rounds: 2,
        max_rounds: 2,
        stop_from_round: null,
        max_provider_requests: 50,
    },
    medium: {
        seats: 9,
        min_rounds: 1,
        max_rounds: 4,
        stop_from_round: 1,
        max_provider_requests: 50,
    },
    heavy: {
        seats: 9,
        min_rounds: 3,
        max_rounds: 10,
        stop_from_round: 3,
        max_provider_requests: 100,
    },
};
/** Seats that must share the same top option for the consensus stop rule. */
export const CONSENSUS_MIN_SEATS = 7;
/** Points by which the leading option must beat the runner-up. */
export const CONSENSUS_LEAD = 1.5;
/** Highest advisor-card round number a challenge pass may carry. */
export const MAX_ADVISOR_ROUND = 10;
export function isCouncilSize(mode) {
    return COUNCIL_SIZES.includes(mode);
}
