/**
 * CWE-023 guided intake question flow (directive Sections 9.2, 9.3).
 *
 * One question at a time, asked only when the missing answer could
 * materially change the recommendation. Stable question IDs are the
 * resume contract: the current step is computed from the saved draft,
 * so a refresh, disconnect, or process restart restores the exact
 * step and never re-issues an answered question.
 *
 * Retrieval runs before questions (Section 9.2): confirmed facts the
 * host supplied through CWE-022 at begin time pre-answer the facts
 * step. Intake never asks for what authorized retrieval already holds.
 *
 * Material questions must be answered before freeze; "I don't know
 * yet" is a valid answer where the question allows an explicit
 * unknown. Optional questions may be skipped; the skip is recorded,
 * not treated as an answer.
 */
import type { IntakeDraft } from './types.js';
export type IntakeQuestionId = 'decision' | 'options' | 'success' | 'constraints' | 'facts' | 'unknowns' | 'assumptions' | 'stakeholders' | 'mode_panel' | 'route' | 'preference';
export interface IntakeQuestion {
    readonly id: IntakeQuestionId;
    /** Material questions block freeze until answered. */
    readonly material: boolean;
    /** Whether an explicit "I don't know yet" counts as an answer. */
    readonly allows_explicit_unknown: boolean;
    readonly title: string;
    readonly guidance: string;
}
/** The canonical question order. Resume walks this list, nothing else. */
export declare const INTAKE_QUESTIONS: readonly IntakeQuestion[];
export declare function questionById(id: string): IntakeQuestion | null;
/**
 * Whether a question counts as answered for this draft. Facts are
 * answered when the client stated facts OR authorized retrieval
 * already supplied confirmed facts (Section 9.2: never re-ask).
 * Preference is answered exactly when a preference record exists.
 */
export declare function isQuestionAnswered(draft: IntakeDraft, id: IntakeQuestionId): boolean;
/**
 * The exact step an interrupted intake resumes at: the first question
 * in canonical order that is neither answered nor explicitly skipped.
 * Null when the flow is complete.
 */
export declare function currentQuestion(draft: IntakeDraft): IntakeQuestion | null;
/** Material questions still blocking freeze, in canonical order. */
export declare function missingMaterialQuestions(draft: IntakeDraft): IntakeQuestionId[];
/** Freeze readiness on the question flow alone (panel/route included). */
export declare function isFlowReadyToFreeze(draft: IntakeDraft): boolean;
