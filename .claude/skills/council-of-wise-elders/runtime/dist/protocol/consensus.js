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
import { CONSENSUS_LEAD, CONSENSUS_MIN_SEATS } from '../contracts/modes.js';
function scoreOf(card, optionId) {
    const found = card.option_scores.find((s) => s.option_id === optionId);
    const score = found?.score;
    return score === null || score === undefined || !Number.isFinite(score) ? null : score;
}
/** The single highest-scored option on one seat's card, or null. */
export function topOptionOf(card, optionIds) {
    if (card.card_kind !== 'advisor')
        return null;
    if (card.stance === 'abstain')
        return null;
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let tied = false;
    for (const optionId of optionIds) {
        const score = scoreOf(card, optionId);
        if (score === null)
            continue;
        if (score > bestScore) {
            best = optionId;
            bestScore = score;
            tied = false;
        }
        else if (score === bestScore) {
            tied = true;
        }
    }
    return tied ? null : best;
}
function meanOver(cards, optionId) {
    let sum = 0;
    for (const card of cards)
        sum += scoreOf(card, optionId);
    return sum / cards.length;
}
/**
 * Evaluate the consensus stop rule over one round's panel seats.
 * Unweighted and pure; `optionIds` gives both the candidate set and the
 * deterministic tie-break order.
 */
export function evaluateConsensusStop(cards, optionIds) {
    const bySeat = new Map();
    for (const card of cards) {
        if (card.card_kind !== 'advisor')
            continue;
        if (!bySeat.has(card.seat_id))
            bySeat.set(card.seat_id, card);
    }
    const seats = [...bySeat.values()];
    const counts = new Map();
    for (const card of seats) {
        const top = topOptionOf(card, optionIds);
        if (top !== null)
            counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    let topOption = null;
    let share = 0;
    for (const optionId of optionIds) {
        const count = counts.get(optionId) ?? 0;
        if (count > share) {
            share = count;
            topOption = optionId;
        }
    }
    let lead = null;
    if (topOption !== null) {
        let runnerUp = null;
        let runnerUpMean = Number.NEGATIVE_INFINITY;
        for (const optionId of optionIds) {
            if (optionId === topOption)
                continue;
            const paired = seats.filter((card) => scoreOf(card, topOption) !== null && scoreOf(card, optionId) !== null);
            if (paired.length === 0)
                continue;
            const mean = meanOver(paired, optionId);
            if (mean > runnerUpMean) {
                runnerUpMean = mean;
                runnerUp = optionId;
            }
        }
        if (runnerUp !== null) {
            const paired = seats.filter((card) => scoreOf(card, topOption) !== null && scoreOf(card, runnerUp) !== null);
            lead = meanOver(paired, topOption) - meanOver(paired, runnerUp);
        }
    }
    return {
        stop: topOption !== null &&
            share >= CONSENSUS_MIN_SEATS &&
            lead !== null &&
            lead >= CONSENSUS_LEAD,
        top_option_id: topOption,
        share,
        panel: seats.length,
        lead,
    };
}
