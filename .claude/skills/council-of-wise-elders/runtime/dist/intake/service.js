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
import { evidenceManifestEntrySchema, } from '../contracts/index.js';
import { briefContentHash, composeBrief, evidenceManifestHash } from './brief.js';
import { classifyIntakeDomains } from './classify.js';
import { assessPanel, validatePanel } from './panel.js';
import { currentQuestion, missingMaterialQuestions, questionById, } from './questions.js';
import { modelPolicyFromSnapshot, resolveRouteSnapshot, } from './routes.js';
import { EMPTY_ANSWERS, INTAKE_SCHEMA_VERSION, IntakeError, } from './types.js';
export class IntakeService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    // ------------------------------------------------------------ lifecycle
    async begin(input) {
        const now = this.deps.clock.nowUtc();
        const knownFacts = [];
        let dropped = 0;
        for (const fact of input.known_facts ?? []) {
            const sameScope = fact.scope.tenant_id === input.scope.tenant_id &&
                fact.scope.company_id === input.scope.company_id &&
                fact.scope.installation_id === input.scope.installation_id;
            if (!sameScope) {
                dropped += 1;
                continue;
            }
            const { scope: _scope, ...rest } = fact;
            knownFacts.push(rest);
        }
        const draft = {
            schema_version: INTAKE_SCHEMA_VERSION,
            intake_id: this.deps.ids.newId(),
            session_id: this.deps.ids.newId(),
            brief_id: this.deps.ids.newId(),
            scope: input.scope,
            visibility: input.visibility,
            display_timezone: input.display_timezone,
            source_pack_version: input.source_pack_version,
            status: 'in_progress',
            intake_revision: 1,
            current_brief_revision: 0,
            answers: EMPTY_ANSWERS,
            known_facts: knownFacts,
            dropped_known_fact_count: dropped,
            evidence_manifest: [],
            mode: null,
            panel_seat_ids: null,
            professional_review_arranged: null,
            route_choice: null,
            route_snapshot: null,
            brief_dirty: true,
            constraints_explicit_unknown: false,
            facts_explicit_unknown: false,
            preference_ref: null,
            answered_question_ids: [],
            skipped_question_ids: [],
            created_at: now,
            updated_at: now,
        };
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async resume(intakeId) {
        const draft = await this.loadDraft(intakeId);
        return { draft, current_question: currentQuestion(draft) };
    }
    async getDraft(intakeId) {
        return this.loadDraft(intakeId);
    }
    // ------------------------------------------------------------ answers
    async answer(intakeId, value, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        const question = questionById(value.question_id);
        if (!question) {
            throw new IntakeError('INTAKE_QUESTION_UNKNOWN', `Unknown intake question ${value.question_id}.`);
        }
        draft = this.applyAnswer(draft, value);
        draft = await this.syncBriefRevision(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async skipQuestion(intakeId, questionId, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        const question = questionById(questionId);
        if (!question) {
            throw new IntakeError('INTAKE_QUESTION_UNKNOWN', `Unknown intake question ${questionId}.`);
        }
        if (question.material) {
            throw new IntakeError('INTAKE_ANSWER_INVALID', `Question ${questionId} is material and cannot be skipped; answer it or state an explicit unknown where allowed.`);
        }
        if (!draft.skipped_question_ids.includes(questionId)) {
            draft = {
                ...draft,
                skipped_question_ids: [...draft.skipped_question_ids, questionId],
            };
        }
        draft = this.touch(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    // ------------------------------------------------------------ preference
    /**
     * Store (or clear) the client's private preference. The value lives
     * only in its own record; the draft keeps the opaque reference the
     * brief will carry. Clearing removes the record and the reference.
     */
    async setPreference(intakeId, preference, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        if (preference === null) {
            if (draft.preference_ref !== null) {
                await this.deps.workingStore.deletePreference(draft.preference_ref);
            }
            draft = { ...draft, preference_ref: null, brief_dirty: true };
        }
        else {
            if (preference.leaning_option_id !== null &&
                draft.answers.options !== null &&
                !draft.answers.options.some((o) => o.id === preference.leaning_option_id)) {
                throw new IntakeError('INTAKE_ANSWER_INVALID', 'The preference leans toward an option that is not one of the brief options.', { leaning_option_id: preference.leaning_option_id });
            }
            const preferenceId = draft.preference_ref ?? this.deps.ids.newId();
            const record = {
                schema_version: INTAKE_SCHEMA_VERSION,
                preference_id: preferenceId,
                session_id: draft.session_id,
                leaning_option_id: preference.leaning_option_id,
                statement: preference.statement,
                updated_at: this.deps.clock.nowUtc(),
            };
            await this.deps.workingStore.savePreference(record);
            draft = { ...draft, preference_ref: preferenceId, brief_dirty: true };
        }
        draft = await this.syncBriefRevision(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async getPreference(preferenceId) {
        return this.deps.workingStore.loadPreference(preferenceId);
    }
    // ------------------------------------------------------------ panel/route
    async chooseModePanel(intakeId, mode, seatIds, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        validatePanel(mode, seatIds);
        draft = { ...draft, mode, panel_seat_ids: [...seatIds], brief_dirty: true };
        draft = await this.syncBriefRevision(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async setProfessionalReviewArranged(intakeId, arranged, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        draft = { ...draft, professional_review_arranged: arranged, brief_dirty: true };
        draft = await this.syncBriefRevision(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async chooseRoute(intakeId, choice, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        const snapshot = resolveRouteSnapshot(this.deps.routeCatalog, choice, this.deps.clock.nowUtc());
        draft = { ...draft, route_choice: choice, route_snapshot: snapshot };
        draft = this.touch(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    async setEvidenceManifest(intakeId, entries, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        for (const entry of entries) {
            const parsed = evidenceManifestEntrySchema.safeParse(entry);
            if (!parsed.success) {
                throw new IntakeError('INTAKE_ANSWER_INVALID', 'An evidence manifest entry failed contract validation.', {
                    issues: parsed.error.issues.map((i) => i.message),
                });
            }
        }
        draft = { ...draft, evidence_manifest: entries.map((e) => ({ ...e })) };
        draft = await this.syncBriefRevision(draft);
        await this.deps.workingStore.saveDraft(draft);
        return draft;
    }
    // ------------------------------------------------------------ review/freeze
    /** The pre-start review summary (Section 9.4). Pure read. */
    async reviewSummary(intakeId) {
        const draft = await this.loadDraft(intakeId);
        let briefPreview = null;
        if (draft.answers.decision !== null && draft.answers.options !== null) {
            briefPreview = composeBrief({
                draft,
                revision: draft.current_brief_revision + 1,
                createdAt: draft.updated_at,
            });
        }
        let panelAssessment = null;
        if (draft.mode !== null && draft.panel_seat_ids !== null) {
            panelAssessment = assessPanel({
                mode: draft.mode,
                seatIds: draft.panel_seat_ids,
                requirements: classifyIntakeDomains({
                    draft,
                    panelSeatIds: draft.panel_seat_ids,
                    professionalReviewArranged: draft.professional_review_arranged,
                }),
                professionalReviewArranged: draft.professional_review_arranged,
            });
        }
        const missing = missingMaterialQuestions(draft);
        return {
            session_id: draft.session_id,
            status: draft.status,
            brief_preview: briefPreview,
            panel_assessment: panelAssessment,
            route_snapshot: draft.route_snapshot,
            evidence_manifest_count: draft.evidence_manifest.length,
            missing_material_questions: missing,
            ready_to_freeze: missing.length === 0 && draft.status === 'in_progress',
        };
    }
    /**
     * Freeze the brief revision and evidence manifest for run start.
     * Writes the canonical session into the CWE-006 store and records
     * the freeze. After this, content edits refuse with INTAKE_FROZEN.
     */
    async freeze(intakeId, expectedIntakeRevision) {
        let draft = await this.loadMutableDraft(intakeId, expectedIntakeRevision);
        const missing = missingMaterialQuestions(draft);
        if (missing.length > 0) {
            throw new IntakeError('INTAKE_NOT_READY', 'Material intake questions are still unanswered.', {
                missing_material_questions: missing,
            });
        }
        if (draft.mode === null || draft.panel_seat_ids === null || draft.route_snapshot === null) {
            throw new IntakeError('INTAKE_NOT_READY', 'Mode, panel, and route must be chosen before freeze.');
        }
        const mode = draft.mode;
        const panelSeatIds = draft.panel_seat_ids;
        const routeSnapshot = draft.route_snapshot;
        // Compose the frozen revision: reuse the latest draft revision
        // when nothing brief-affecting changed since it was composed.
        if (draft.brief_dirty || draft.current_brief_revision === 0) {
            draft = await this.syncBriefRevision(draft);
        }
        const brief = await this.deps.workingStore.loadDraftBriefRevision(draft.session_id, draft.current_brief_revision);
        if (brief === null) {
            throw new IntakeError('INTAKE_NOT_READY', 'No composed brief revision exists to freeze.');
        }
        const frozenAt = this.deps.clock.nowUtc();
        const briefSha = briefContentHash(brief);
        const requirements = classifyIntakeDomains({
            draft,
            panelSeatIds,
            professionalReviewArranged: draft.professional_review_arranged,
        });
        const panelAssessment = assessPanel({
            mode,
            seatIds: panelSeatIds,
            requirements,
            professionalReviewArranged: draft.professional_review_arranged,
        });
        const spec = {
            schema_version: 'wise-elders.session/v1',
            session_id: draft.session_id,
            mode,
            visibility: draft.visibility,
            brief_revision: brief.revision,
            brief_sha256: briefSha,
            options: brief.options.map((o) => ({ ...o })),
            seat_ids: [...panelSeatIds],
            model_policy: modelPolicyFromSnapshot(routeSnapshot),
            source_pack_version: draft.source_pack_version,
            execution_policy: 'advisory_only',
            created_at: frozenAt,
            display_timezone: draft.display_timezone,
        };
        const existing = await this.deps.briefStore.getSession(draft.session_id);
        if (existing === null) {
            const state = {
                schema_version: 'wise-elders.session-state/v1',
                session_id: draft.session_id,
                mode,
                state: 'READY',
                state_version: 0,
                brief_revision: brief.revision,
                resume_phase: null,
                cancel_generation: 0,
                revocation_generation: 0,
                attempt: 1,
                lease_epoch: 0,
                archived: false,
                updated_at: frozenAt,
            };
            await this.deps.briefStore.createSession({
                spec,
                brief,
                scope: draft.scope,
                state,
                sample: false,
            });
        }
        else {
            await this.deps.briefStore.saveBriefRevision(brief);
        }
        const freezeRecord = {
            schema_version: INTAKE_SCHEMA_VERSION,
            session_id: draft.session_id,
            brief_revision: brief.revision,
            brief_sha256: briefSha,
            evidence_manifest_sha256: evidenceManifestHash(brief),
            route_snapshot: routeSnapshot,
            panel_assessment: panelAssessment,
            frozen_at: frozenAt,
        };
        await this.deps.workingStore.saveFreezeRecord(freezeRecord);
        draft = { ...draft, status: 'frozen' };
        draft = this.touch(draft);
        await this.deps.workingStore.saveDraft(draft);
        return { brief, spec, freeze_record: freezeRecord };
    }
    // ------------------------------------------------------------ amendments
    /**
     * Queue new factual input received during a round. The frozen brief
     * is never touched; the proposal is recorded against the frozen
     * revision and applies only to a new revision (child session,
     * CWE-050).
     */
    async proposeAmendment(sessionId, input) {
        const draft = await this.deps.workingStore.loadDraftBySession(sessionId);
        if (draft === null) {
            throw new IntakeError('INTAKE_NOT_FOUND', 'No intake exists for this session.');
        }
        if (draft.status !== 'frozen') {
            throw new IntakeError('INTAKE_NOT_FROZEN', 'Amendments queue against a frozen brief; this intake has not frozen yet. Edit the draft instead.');
        }
        const freezeRecord = await this.deps.workingStore.loadFreezeRecord(sessionId);
        if (freezeRecord === null) {
            throw new IntakeError('INTAKE_NOT_FROZEN', 'No freeze record exists for this session.');
        }
        const amendment = {
            schema_version: INTAKE_SCHEMA_VERSION,
            amendment_id: this.deps.ids.newId(),
            session_id: sessionId,
            base_revision: freezeRecord.brief_revision,
            statement: input.statement,
            evidence_ids: [...(input.evidence_ids ?? [])],
            status: 'proposed',
            recorded_at: this.deps.clock.nowUtc(),
        };
        await this.deps.workingStore.saveAmendment(amendment);
        return amendment;
    }
    async listAmendments(sessionId) {
        return this.deps.workingStore.listAmendments(sessionId);
    }
    // ------------------------------------------------------------ internals
    async loadDraft(intakeId) {
        const draft = await this.deps.workingStore.loadDraft(intakeId);
        if (draft === null) {
            throw new IntakeError('INTAKE_NOT_FOUND', 'No intake exists with this ID.');
        }
        return draft;
    }
    async loadMutableDraft(intakeId, expectedIntakeRevision) {
        const draft = await this.loadDraft(intakeId);
        if (draft.status === 'frozen') {
            throw new IntakeError('INTAKE_FROZEN', 'This brief is frozen for a run. New factual input is queued as a proposed amendment, never applied to the frozen revision.');
        }
        if (draft.intake_revision !== expectedIntakeRevision) {
            throw new IntakeError('INTAKE_REVISION_CONFLICT', 'The intake changed underneath this writer. Reload the current intake revision and retry; nothing was overwritten.', { expected: expectedIntakeRevision, current: draft.intake_revision });
        }
        return draft;
    }
    touch(draft) {
        return {
            ...draft,
            intake_revision: draft.intake_revision + 1,
            updated_at: this.deps.clock.nowUtc(),
        };
    }
    markAnswered(draft, questionId) {
        if (draft.answered_question_ids.includes(questionId))
            return draft;
        return {
            ...draft,
            answered_question_ids: [...draft.answered_question_ids, questionId],
            skipped_question_ids: draft.skipped_question_ids.filter((id) => id !== questionId),
        };
    }
    applyAnswer(draft, value) {
        const answers = {
            ...draft.answers,
        };
        let next = draft;
        switch (value.question_id) {
            case 'decision':
                answers.decision = { statement: value.statement, flags: value.flags };
                break;
            case 'options': {
                if (value.options.length < 2 || value.options.length > 5) {
                    throw new IntakeError('INTAKE_ANSWER_INVALID', 'Scored modes need two to five explicit options (Section 9.1).');
                }
                const seen = new Set();
                for (const option of value.options) {
                    if (seen.has(option.id)) {
                        throw new IntakeError('INTAKE_ANSWER_INVALID', `Duplicate option id ${option.id}.`);
                    }
                    seen.add(option.id);
                }
                answers.options = value.options.map((o) => ({ ...o }));
                break;
            }
            case 'success':
                answers.success = value.success;
                break;
            case 'constraints':
                if ('explicit_unknown' in value) {
                    answers.constraints = [];
                    next = { ...next, constraints_explicit_unknown: true };
                }
                else {
                    answers.constraints = value.constraints.map((c) => ({
                        ...c,
                        applies_to_option_ids: [...c.applies_to_option_ids],
                    }));
                    next = { ...next, constraints_explicit_unknown: false };
                }
                break;
            case 'facts':
                if ('explicit_unknown' in value) {
                    answers.facts = [];
                    next = { ...next, facts_explicit_unknown: true };
                }
                else {
                    answers.facts = value.facts.map((f) => ({ ...f, evidence_ids: [...f.evidence_ids] }));
                    next = { ...next, facts_explicit_unknown: false };
                }
                break;
            case 'unknowns':
                answers.unknowns = value.unknowns.map((u) => ({ ...u, evidence_ids: [...u.evidence_ids] }));
                break;
            case 'assumptions':
                answers.assumptions = value.assumptions.map((u) => ({ ...u, evidence_ids: [...u.evidence_ids] }));
                break;
            case 'stakeholders':
                answers.stakeholders = [...value.stakeholders];
                break;
        }
        next = { ...next, answers, brief_dirty: true };
        next = this.markAnswered(next, value.question_id);
        return this.touch(next);
    }
    /**
     * Compose and save the next immutable brief revision when the draft
     * is composable (decision and options answered). Called after every
     * brief-affecting mutation; the composed revision records the
     * intake revision it was composed at, which is what lets freeze
     * reuse it byte-for-byte when nothing changed since.
     */
    async syncBriefRevision(draft) {
        if (draft.answers.decision === null || draft.answers.options === null) {
            return draft;
        }
        const revision = draft.current_brief_revision + 1;
        const brief = composeBrief({
            draft,
            revision,
            createdAt: this.deps.clock.nowUtc(),
        });
        await this.deps.workingStore.saveDraftBriefRevision(brief);
        return {
            ...draft,
            current_brief_revision: revision,
            brief_dirty: false,
        };
    }
}
