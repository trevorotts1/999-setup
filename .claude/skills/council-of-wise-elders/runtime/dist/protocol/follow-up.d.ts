/**
 * Follow-up questions (CWE-050; directive Sections 17.5, 25.6): after
 * a council completes, the owner may put ONE follow-up question to ONE
 * seat. A follow-up is a discrete consult operation in a NEW linked
 * session, never a reopened deliberation and never a re-vote:
 *
 * - The child session is a consult (one seat, one ConsultCard, no
 *   scoring), created over the accepted CWE-006 store with the
 *   parent's frozen brief material carried over and the follow-up
 *   question in place of the original question.
 * - The link is recorded on the PARENT session's journal as an
 *   operation_completed event whose payload carries kind
 *   'follow_up_link' (the frozen CWE-003 vocabulary has no dedicated
 *   link event type; the payload-kind convention is the same one
 *   CWE-038 uses for report exports; the vocabulary is not forked).
 * - The follow-up runs under its OWN purpose-bound grant: the caller
 *   supplies a grant approved for purpose 'follow_up' (T142: purposes
 *   never borrow a council_run grant). Admission enforces the
 *   binding; this service never mints or widens a grant.
 */
import { type SeatId, type Verdict } from '../contracts/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { PinnedRouteSnapshot } from '../budgets/route-snapshot.js';
/** The composition's session driver, as a port (composition.ts). */
export interface FollowUpDriver {
    runSession(envelope: AuthorizationEnvelope, sessionId: string, options: {
        grant_id: string;
        route_snapshot: PinnedRouteSnapshot;
        purpose?: string;
    }): Promise<{
        status: string;
        verdict?: Verdict | null;
    }>;
}
export interface FollowUpLink {
    parent_session_id: string;
    follow_up_session_id: string;
    seat_id: SeatId;
    parent_verdict_revision: number | null;
}
export declare class FollowUpService {
    private readonly deps;
    constructor(deps: {
        db: CouncilDatabase;
        repositories: CouncilRepositories;
        driver: FollowUpDriver;
        ids: {
            newId(): string;
        };
        clock: {
            nowUtc(): string;
        };
    });
    /**
     * Create the linked consult session for a follow-up (DRAFT state)
     * and record the link on the parent's journal. The caller then
     * previews and approves a follow_up-purpose grant FOR THE CHILD
     * SESSION (CWE-049) and runs it through the composition driver.
     */
    createFollowUp(envelope: AuthorizationEnvelope, parentSessionId: string, args: {
        seat_id: SeatId;
        question: string;
    }): FollowUpLink;
    /**
     * Create a follow-up, let the caller authorize the CHILD session
     * under a follow_up-purpose grant, and run it end to end. Returns
     * the child consult's verdict.
     */
    askFollowUp(envelope: AuthorizationEnvelope, parentSessionId: string, args: {
        seat_id: SeatId;
        question: string;
        authorize: (followUpSessionId: string) => Promise<{
            grant_id: string;
            route_snapshot: PinnedRouteSnapshot;
        }> | {
            grant_id: string;
            route_snapshot: PinnedRouteSnapshot;
        };
    }): Promise<{
        link: FollowUpLink;
        verdict: Verdict;
    }>;
    /** All follow-up links recorded on a session's journal, in order. */
    listFollowUps(envelope: AuthorizationEnvelope, parentSessionId: string): FollowUpLink[];
}
