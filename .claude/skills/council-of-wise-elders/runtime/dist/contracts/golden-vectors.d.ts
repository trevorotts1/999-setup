/**
 * Golden vectors (directive Section 32.2) and canonical-hash fixtures.
 *
 * The arithmetic fixture is hand-calculated in the directive and verified
 * independently of this implementation: weights [2,3,2,3,3,2,3,2,2] total 22;
 * option A weighted sum 132 (score 6.0); option B weighted sum 168 (score
 * 168/22 = 7.63636..., display 7.6, spread 3); option C weighted sum 145
 * (score 145/22 = 6.59090..., display 6.6). If Tiffany Aliche abstains on B,
 * the sum becomes 150 over denominator 19, coverage 19/22 (about 86.36
 * percent), which still cannot produce an unconditional GO while a critical
 * affordability question is unresolved.
 *
 * The hash fixtures pin canonical serialization: the same logical value in
 * different key orders must hash identically in every consumer (T148).
 */
import type { SeatScoreEntry } from './scoring.js';
export declare const GOLDEN_WEIGHTS: readonly number[];
export declare const GOLDEN_TOTAL_WEIGHT = 22;
export declare const GOLDEN_SCORES: {
    readonly A: SeatScoreEntry[];
    readonly B: SeatScoreEntry[];
    readonly C: SeatScoreEntry[];
    /** B with Tiffany Aliche (seat index 3) abstaining: sum 150 over 19. */
    readonly B_TIFFANY_ABSTAINS: SeatScoreEntry[];
};
export declare const GOLDEN_EXPECTED: {
    readonly A: {
        readonly weighted_sum: 132;
        readonly denominator: 22;
        readonly score: 6;
        readonly display_score: 6;
        readonly coverage: 1;
        readonly spread: 3;
    };
    readonly B: {
        readonly weighted_sum: 168;
        readonly denominator: 22;
        readonly score: number;
        readonly display_score: 7.6;
        readonly coverage: 1;
        readonly spread: 3;
    };
    readonly C: {
        readonly weighted_sum: 145;
        readonly denominator: 22;
        readonly score: number;
        readonly display_score: 6.6;
        readonly coverage: 1;
        readonly spread: 6;
    };
    readonly B_TIFFANY_ABSTAINS: {
        readonly weighted_sum: 150;
        readonly denominator: 19;
        readonly score: number;
        readonly display_score: 7.9;
        readonly coverage: number;
        readonly spread: 2;
    };
};
/**
 * Canonical-hash fixture: two key orderings of one logical payload. Both
 * must serialize to CANONICAL_TEXT and hash to the same digest everywhere.
 */
export declare const HASH_FIXTURE_A: {
    readonly session_id: "sess-golden-1";
    readonly brief_revision: 1;
    readonly options: readonly [{
        readonly id: "A";
        readonly label: "Keep the current offer";
        readonly kind: "status_quo";
    }, {
        readonly id: "B";
        readonly label: "Pilot the revised offer";
        readonly kind: "bounded_test";
    }];
    readonly money: {
        readonly amount_minor: 12500;
        readonly currency: "USD";
    };
    readonly unknown_field: null;
};
export declare const HASH_FIXTURE_B: {
    readonly unknown_field: null;
    readonly money: {
        readonly currency: "USD";
        readonly amount_minor: 12500;
    };
    readonly options: readonly [{
        readonly kind: "status_quo";
        readonly label: "Keep the current offer";
        readonly id: "A";
    }, {
        readonly label: "Pilot the revised offer";
        readonly kind: "bounded_test";
        readonly id: "B";
    }];
    readonly brief_revision: 1;
    readonly session_id: "sess-golden-1";
};
export declare const HASH_FIXTURE_CANONICAL_TEXT = "{\"brief_revision\":1,\"money\":{\"amount_minor\":12500,\"currency\":\"USD\"},\"options\":[{\"id\":\"A\",\"kind\":\"status_quo\",\"label\":\"Keep the current offer\"},{\"id\":\"B\",\"kind\":\"bounded_test\",\"label\":\"Pilot the revised offer\"}],\"session_id\":\"sess-golden-1\",\"unknown_field\":null}";
