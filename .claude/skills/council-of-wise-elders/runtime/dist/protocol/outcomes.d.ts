/**
 * Outcome reviews (CWE-050; directive Section 24.5): after a decision
 * is acted on, the outcome is reviewed against what the council
 * planned to measure, at a recorded horizon (7d, 30d, 90d, custom).
 * Reviews are stored in CWE-006's council_outcome_reviews table,
 * linked to the session and its verdict label at review time.
 *
 * Discipline: one review per session and horizon (the table's UNIQUE
 * constraint); a second review for the same horizon is a precise
 * conflict, never an overwrite. A review requires a completed session
 * with a verdict: outcomes attach to decisions, not to drafts. The
 * planned measure is recorded BEFORE the actual evidence in the
 * record's own fields, so a review cannot quietly rewrite what was
 * planned; both are stored verbatim as supplied.
 */
import { z } from 'zod';
import type { VerdictLabel } from '../contracts/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
export declare const OUTCOME_HORIZONS: readonly ["7d", "30d", "90d", "custom"];
export type OutcomeHorizon = (typeof OUTCOME_HORIZONS)[number];
export declare const outcomeReviewInputSchema: z.ZodObject<{
    horizon: z.ZodEnum<{
        custom: "custom";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>;
    planned_measure: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    actual_evidence: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    assessment: z.ZodObject<{
        outcome: z.ZodEnum<{
            met: "met";
            partially_met: "partially_met";
            missed: "missed";
            too_early_to_tell: "too_early_to_tell";
        }>;
        notes: z.ZodString;
    }, z.core.$strict>;
    client_conclusion: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type OutcomeReviewInput = z.infer<typeof outcomeReviewInputSchema>;
export interface OutcomeReview {
    id: string;
    session_id: string;
    horizon: OutcomeHorizon;
    planned_measure: Record<string, unknown>;
    actual_evidence: Record<string, unknown>;
    assessment: OutcomeReviewInput['assessment'];
    client_conclusion: string | null;
    verdict_label: VerdictLabel | null;
    reviewed_by_subject: string;
    created_at: string;
}
export declare class OutcomeReviewService {
    private readonly deps;
    constructor(deps: {
        db: CouncilDatabase;
        repositories: CouncilRepositories;
        ids: {
            newId(): string;
        };
        clock: {
            nowUtc(): string;
        };
    });
    recordReview(envelope: AuthorizationEnvelope, sessionId: string, input: OutcomeReviewInput): OutcomeReview;
    getReview(envelope: AuthorizationEnvelope, sessionId: string, horizon: OutcomeHorizon): OutcomeReview | null;
    listReviews(envelope: AuthorizationEnvelope, sessionId: string): OutcomeReview[];
}
