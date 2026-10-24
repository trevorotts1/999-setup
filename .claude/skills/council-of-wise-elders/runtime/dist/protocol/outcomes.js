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
import { ProtocolError } from './errors.js';
export const OUTCOME_HORIZONS = ['7d', '30d', '90d', 'custom'];
export const outcomeReviewInputSchema = z.strictObject({
    horizon: z.enum(OUTCOME_HORIZONS),
    /** What the council planned to measure, recorded verbatim. */
    planned_measure: z.record(z.string(), z.unknown()),
    /** The actual evidence observed at the horizon, recorded verbatim. */
    actual_evidence: z.record(z.string(), z.unknown()),
    /** The reviewer's structured assessment of plan versus actual. */
    assessment: z.strictObject({
        outcome: z.enum(['met', 'partially_met', 'missed', 'too_early_to_tell']),
        notes: z.string().min(1),
    }),
    client_conclusion: z.string().min(1).nullable(),
});
export class OutcomeReviewService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    recordReview(envelope, sessionId, input) {
        const parsed = outcomeReviewInputSchema.safeParse(input);
        if (!parsed.success) {
            throw new ProtocolError('OUTCOME_INVALID', `Outcome review failed validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`, { session_id: sessionId });
        }
        const session = this.deps.repositories.getSession(envelope, sessionId);
        if (!session) {
            throw new ProtocolError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`, {
                session_id: sessionId,
            });
        }
        const verdict = this.deps.repositories.getVerdict(envelope, sessionId);
        if (session.state.state !== 'COMPLETED' || !verdict) {
            throw new ProtocolError('OUTCOME_INVALID', `Outcome reviews attach to a completed session with a verdict; session ${sessionId} is ${session.state.state}.`, { session_id: sessionId, state: session.state.state });
        }
        const existing = this.getReview(envelope, sessionId, parsed.data.horizon);
        if (existing) {
            throw new ProtocolError('OUTCOME_CONFLICT', `Session ${sessionId} already has a ${parsed.data.horizon} outcome review (${existing.id}); reviews are never overwritten.`, { session_id: sessionId, horizon: parsed.data.horizon, existing_id: existing.id });
        }
        const review = {
            id: this.deps.ids.newId(),
            session_id: sessionId,
            horizon: parsed.data.horizon,
            planned_measure: parsed.data.planned_measure,
            actual_evidence: parsed.data.actual_evidence,
            assessment: parsed.data.assessment,
            client_conclusion: parsed.data.client_conclusion,
            verdict_label: verdict.result_kind === 'scored' ? verdict.label : null,
            reviewed_by_subject: envelope.actor_subject,
            created_at: this.deps.clock.nowUtc(),
        };
        this.deps.db.write((handle) => {
            handle
                .prepare(`INSERT INTO council_outcome_reviews
             (tenant_id, company_id, session_id, id, horizon, planned_measure_json,
              actual_evidence_json, review_json, client_conclusion, verdict_label,
              reviewed_by_subject, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(envelope.tenant_id, envelope.company_id, sessionId, review.id, review.horizon, JSON.stringify(review.planned_measure), JSON.stringify(review.actual_evidence), JSON.stringify(review.assessment), review.client_conclusion, review.verdict_label, review.reviewed_by_subject, review.created_at);
        });
        return review;
    }
    getReview(envelope, sessionId, horizon) {
        const rows = this.listReviews(envelope, sessionId);
        return rows.find((r) => r.horizon === horizon) ?? null;
    }
    listReviews(envelope, sessionId) {
        const session = this.deps.repositories.getSession(envelope, sessionId);
        if (!session) {
            throw new ProtocolError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`, {
                session_id: sessionId,
            });
        }
        const rows = this.deps.db.read((handle) => handle
            .prepare(`SELECT id, horizon, planned_measure_json, actual_evidence_json, review_json,
                  client_conclusion, verdict_label, reviewed_by_subject, created_at
             FROM council_outcome_reviews
            WHERE tenant_id = ? AND company_id = ? AND session_id = ?
            ORDER BY created_at ASC`)
            .all(envelope.tenant_id, envelope.company_id, sessionId));
        return rows.map((row) => ({
            id: row.id,
            session_id: sessionId,
            horizon: row.horizon,
            planned_measure: JSON.parse(row.planned_measure_json),
            actual_evidence: JSON.parse(row.actual_evidence_json),
            assessment: JSON.parse(row.review_json),
            client_conclusion: row.client_conclusion,
            verdict_label: row.verdict_label,
            reviewed_by_subject: row.reviewed_by_subject,
            created_at: row.created_at,
        }));
    }
}
