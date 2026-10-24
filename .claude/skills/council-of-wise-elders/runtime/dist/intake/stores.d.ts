import { type DecisionBrief } from '../contracts/index.js';
import type { StoredSession } from '../cli/host-ports.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilRepositories } from '../persistence/repositories.js';
import type { FreezeRecord } from './service-types.js';
import { type ClientPreferencePrivate, type IntakeDraft, type ProposedAmendment } from './types.js';
/** The canonical brief-revision store port (CWE-006 backed). */
export interface IntakeBriefStore {
    getSession(sessionId: string): Promise<StoredSession | null>;
    createSession(session: StoredSession): Promise<void>;
    saveBriefRevision(brief: DecisionBrief): Promise<void>;
}
/** Intake working records port. See the module header for the split. */
export interface IntakeWorkingStore {
    saveDraft(draft: IntakeDraft): Promise<void>;
    loadDraft(intakeId: string): Promise<IntakeDraft | null>;
    loadDraftBySession(sessionId: string): Promise<IntakeDraft | null>;
    /** Immutable: an existing revision with different content conflicts. */
    saveDraftBriefRevision(brief: DecisionBrief): Promise<void>;
    loadDraftBriefRevision(sessionId: string, revision: number): Promise<DecisionBrief | null>;
    listDraftBriefRevisions(sessionId: string): Promise<DecisionBrief[]>;
    savePreference(record: ClientPreferencePrivate): Promise<void>;
    loadPreference(preferenceId: string): Promise<ClientPreferencePrivate | null>;
    deletePreference(preferenceId: string): Promise<void>;
    saveFreezeRecord(record: FreezeRecord): Promise<void>;
    loadFreezeRecord(sessionId: string): Promise<FreezeRecord | null>;
    saveAmendment(record: ProposedAmendment): Promise<void>;
    listAmendments(sessionId: string): Promise<ProposedAmendment[]>;
}
export declare class RepositoryIntakeBriefStore implements IntakeBriefStore {
    private readonly repositories;
    private readonly envelope;
    constructor(repositories: CouncilRepositories, envelope: AuthorizationEnvelope);
    getSession(sessionId: string): Promise<StoredSession | null>;
    createSession(session: StoredSession): Promise<void>;
    saveBriefRevision(brief: DecisionBrief): Promise<void>;
}
export declare class MemoryIntakeWorkingStore implements IntakeWorkingStore {
    private readonly drafts;
    private readonly draftBySession;
    private readonly briefRevisions;
    private readonly preferences;
    private readonly freezeRecords;
    private readonly amendments;
    saveDraft(draft: IntakeDraft): Promise<void>;
    loadDraft(intakeId: string): Promise<IntakeDraft | null>;
    loadDraftBySession(sessionId: string): Promise<IntakeDraft | null>;
    saveDraftBriefRevision(brief: DecisionBrief): Promise<void>;
    loadDraftBriefRevision(sessionId: string, revision: number): Promise<DecisionBrief | null>;
    listDraftBriefRevisions(sessionId: string): Promise<DecisionBrief[]>;
    savePreference(record: ClientPreferencePrivate): Promise<void>;
    loadPreference(preferenceId: string): Promise<ClientPreferencePrivate | null>;
    deletePreference(preferenceId: string): Promise<void>;
    saveFreezeRecord(record: FreezeRecord): Promise<void>;
    loadFreezeRecord(sessionId: string): Promise<FreezeRecord | null>;
    saveAmendment(record: ProposedAmendment): Promise<void>;
    listAmendments(sessionId: string): Promise<ProposedAmendment[]>;
}
/**
 * One canonical-JSON document per record under `directory`, in
 * kind-prefixed files. Writes go to a temp file renamed over the
 * target, so an interrupted write never leaves a torn record; loads
 * parse the exact canonical bytes. Record IDs are validated opaque
 * IDs by the contracts layer, so file names carry no client text.
 */
export declare class FileIntakeWorkingStore implements IntakeWorkingStore {
    private readonly directory;
    constructor(directory: string);
    private pathFor;
    private write;
    private read;
    private listByPrefix;
    saveDraft(draft: IntakeDraft): Promise<void>;
    loadDraft(intakeId: string): Promise<IntakeDraft | null>;
    loadDraftBySession(sessionId: string): Promise<IntakeDraft | null>;
    saveDraftBriefRevision(brief: DecisionBrief): Promise<void>;
    loadDraftBriefRevision(sessionId: string, revision: number): Promise<DecisionBrief | null>;
    listDraftBriefRevisions(sessionId: string): Promise<DecisionBrief[]>;
    savePreference(record: ClientPreferencePrivate): Promise<void>;
    loadPreference(preferenceId: string): Promise<ClientPreferencePrivate | null>;
    deletePreference(preferenceId: string): Promise<void>;
    saveFreezeRecord(record: FreezeRecord): Promise<void>;
    loadFreezeRecord(sessionId: string): Promise<FreezeRecord | null>;
    saveAmendment(record: ProposedAmendment): Promise<void>;
    listAmendments(sessionId: string): Promise<ProposedAmendment[]>;
}
