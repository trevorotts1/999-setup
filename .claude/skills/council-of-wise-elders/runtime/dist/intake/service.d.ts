/**
 * CWE-023 IntakeService: guided intake, brief revisions, freeze,
 * preference storage, and amendment queueing (directive Sections 9,
 * 10, 11).
 *
 * Write discipline:
 * - Every mutation takes the caller's expected intake revision. A
 *   stale writer gets INTAKE_REVISION_CONFLICT and nothing is
 *   overwritten. The same discipline the CWE-006 store enforces on
 *   brief revisions, applied at the intake boundary (Section 17.1's
 *   expected-revision rule).
 * - Brief-affecting answers immediately compose and save the next
 *   immutable brief revision (revisioned draft autosave, Section 34
 *   CWE-023 step 3). A saved revision is never edited; the next
 *   answer creates the next revision.
 * - Freeze is the only path into the canonical CWE-006 store: it
 *   writes the session with its frozen spec and the frozen brief
 *   revision, and records the freeze record. After freeze every
 *   content mutation refuses with INTAKE_FROZEN.
 * - Amendments after freeze are queued records against the frozen
 *   revision. Applying one means a new revision in a child session;
 *   that rerun composition belongs to CWE-050, not this unit.
 */
import { type Clock, type DecisionOption, type EvidenceManifestEntry, type IdSource, type ScopeFields, type SeatId, type SessionMode, type SessionVisibility, type TypedFact } from '../contracts/index.js';
import { type IntakeQuestion, type IntakeQuestionId } from './questions.js';
import { type RouteCatalogPort } from './routes.js';
import type { FreezeResult, IntakeReviewSummary } from './service-types.js';
import type { IntakeBriefStore, IntakeWorkingStore } from './stores.js';
import { type ClientPreferencePrivate, type DecisionFlags, type IntakeConstraint, type IntakeDraft, type IntakeFact, type ProposedAmendment, type RouteChoice, type SuccessAnswer } from './types.js';
export interface IntakeServiceDeps {
    readonly briefStore: IntakeBriefStore;
    readonly workingStore: IntakeWorkingStore;
    readonly routeCatalog: RouteCatalogPort;
    readonly clock: Clock;
    readonly ids: IdSource;
}
export interface BeginIntakeInput {
    readonly scope: ScopeFields;
    readonly visibility: SessionVisibility;
    readonly display_timezone: string;
    readonly source_pack_version: string;
    /**
     * Confirmed facts supplied through authorized CWE-022 retrieval,
     * each carrying the scope it was retrieved under. Facts whose scope
     * does not match this intake are excluded silently (count only);
     * intake never pulls out-of-scope facts into a brief.
     */
    readonly known_facts?: readonly (IntakeFact & {
        readonly scope: ScopeFields;
    })[];
}
export type IntakeAnswerValue = {
    readonly question_id: 'decision';
    readonly statement: string;
    readonly flags: DecisionFlags;
} | {
    readonly question_id: 'options';
    readonly options: readonly DecisionOption[];
} | {
    readonly question_id: 'success';
    readonly success: SuccessAnswer;
} | {
    readonly question_id: 'constraints';
    readonly constraints: readonly IntakeConstraint[];
} | {
    readonly question_id: 'constraints';
    readonly explicit_unknown: true;
} | {
    readonly question_id: 'facts';
    readonly facts: readonly IntakeFact[];
} | {
    readonly question_id: 'facts';
    readonly explicit_unknown: true;
} | {
    readonly question_id: 'unknowns';
    readonly unknowns: readonly TypedFact[];
} | {
    readonly question_id: 'assumptions';
    readonly assumptions: readonly TypedFact[];
} | {
    readonly question_id: 'stakeholders';
    readonly stakeholders: readonly string[];
};
export declare class IntakeService {
    private readonly deps;
    constructor(deps: IntakeServiceDeps);
    begin(input: BeginIntakeInput): Promise<IntakeDraft>;
    resume(intakeId: string): Promise<{
        draft: IntakeDraft;
        current_question: IntakeQuestion | null;
    }>;
    getDraft(intakeId: string): Promise<IntakeDraft>;
    answer(intakeId: string, value: IntakeAnswerValue, expectedIntakeRevision: number): Promise<IntakeDraft>;
    skipQuestion(intakeId: string, questionId: IntakeQuestionId, expectedIntakeRevision: number): Promise<IntakeDraft>;
    /**
     * Store (or clear) the client's private preference. The value lives
     * only in its own record; the draft keeps the opaque reference the
     * brief will carry. Clearing removes the record and the reference.
     */
    setPreference(intakeId: string, preference: {
        leaning_option_id: string | null;
        statement: string | null;
    } | null, expectedIntakeRevision: number): Promise<IntakeDraft>;
    getPreference(preferenceId: string): Promise<ClientPreferencePrivate | null>;
    chooseModePanel(intakeId: string, mode: SessionMode, seatIds: readonly SeatId[], expectedIntakeRevision: number): Promise<IntakeDraft>;
    setProfessionalReviewArranged(intakeId: string, arranged: boolean, expectedIntakeRevision: number): Promise<IntakeDraft>;
    chooseRoute(intakeId: string, choice: RouteChoice, expectedIntakeRevision: number): Promise<IntakeDraft>;
    setEvidenceManifest(intakeId: string, entries: readonly EvidenceManifestEntry[], expectedIntakeRevision: number): Promise<IntakeDraft>;
    /** The pre-start review summary (Section 9.4). Pure read. */
    reviewSummary(intakeId: string): Promise<IntakeReviewSummary>;
    /**
     * Freeze the brief revision and evidence manifest for run start.
     * Writes the canonical session into the CWE-006 store and records
     * the freeze. After this, content edits refuse with INTAKE_FROZEN.
     */
    freeze(intakeId: string, expectedIntakeRevision: number): Promise<FreezeResult>;
    /**
     * Queue new factual input received during a round. The frozen brief
     * is never touched; the proposal is recorded against the frozen
     * revision and applies only to a new revision (child session,
     * CWE-050).
     */
    proposeAmendment(sessionId: string, input: {
        statement: string;
        evidence_ids?: readonly string[];
    }): Promise<ProposedAmendment>;
    listAmendments(sessionId: string): Promise<ProposedAmendment[]>;
    private loadDraft;
    private loadMutableDraft;
    private touch;
    private markAnswered;
    private applyAnswer;
    /**
     * Compose and save the next immutable brief revision when the draft
     * is composable (decision and options answered). Called after every
     * brief-affecting mutation; the composed revision records the
     * intake revision it was composed at, which is what lets freeze
     * reuse it byte-for-byte when nothing changed since.
     */
    private syncBriefRevision;
}
