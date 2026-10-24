/**
 * CWE-023 intake persistence: ports and store implementations.
 *
 * Two persistence concerns, kept separate on purpose:
 *
 * 1. Brief revisions (the canonical product record) persist through
 *    the CWE-006 scoped store. RepositoryIntakeBriefStore adapts
 *    CouncilRepositories: session creation, immutable revision rows,
 *    and the repository's own strictly-sequential revision discipline,
 *    with its state conflicts mapped to the intake conflict error.
 *    The frozen brief revision lives there, under the session's
 *    composite scope, with its canonical hash.
 *
 * 2. Intake working records (the resumable draft, draft brief
 *    revisions composed before freeze, the private preference value,
 *    the freeze record, and queued amendments) persist through the
 *    IntakeWorkingStore port. Two implementations ship here: an
 *    in-memory store (deterministic tests) and a durable file store
 *    for the standalone composition (one canonical-JSON document per
 *    record under a caller-supplied data directory, written by
 *    temp-file rename so a crash never leaves a torn record). The
 *    managed Command Center draft service binds the same port at
 *    CWE-050 composition; the port is the contract either way.
 *
 * Draft brief revisions are composed during intake and held as
 * working records because the canonical store creates a session only
 * with its complete frozen spec (CWE-006 createSession). At freeze,
 * the service writes the session and the frozen brief revision into
 * the canonical store in one step, preserving the revision number;
 * earlier draft revisions remain in the working record chain.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalHash, canonicalStringify, } from '../contracts/index.js';
import { PersistenceError } from '../persistence/errors.js';
import { IntakeError, } from './types.js';
// ---------------------------------------------------------------------------
// CWE-006 repository adapter
// ---------------------------------------------------------------------------
function mapStoreError(error) {
    if (error instanceof PersistenceError && error.code === 'PERSISTENCE_STATE_CONFLICT') {
        throw new IntakeError('INTAKE_REVISION_CONFLICT', 'The brief changed underneath this writer. Reload the current revision and retry; nothing was overwritten.', { store_code: error.code });
    }
    throw error;
}
export class RepositoryIntakeBriefStore {
    repositories;
    envelope;
    constructor(repositories, envelope) {
        this.repositories = repositories;
        this.envelope = envelope;
    }
    async getSession(sessionId) {
        return this.repositories.getSession(this.envelope, sessionId);
    }
    async createSession(session) {
        try {
            this.repositories.createSession(this.envelope, session);
        }
        catch (error) {
            mapStoreError(error);
        }
    }
    async saveBriefRevision(brief) {
        try {
            this.repositories.saveBriefRevision(this.envelope, brief);
        }
        catch (error) {
            mapStoreError(error);
        }
    }
}
// ---------------------------------------------------------------------------
// In-memory working store (deterministic tests)
// ---------------------------------------------------------------------------
export class MemoryIntakeWorkingStore {
    drafts = new Map();
    draftBySession = new Map();
    briefRevisions = new Map();
    preferences = new Map();
    freezeRecords = new Map();
    amendments = new Map();
    async saveDraft(draft) {
        this.drafts.set(draft.intake_id, draft);
        this.draftBySession.set(draft.session_id, draft.intake_id);
    }
    async loadDraft(intakeId) {
        return this.drafts.get(intakeId) ?? null;
    }
    async loadDraftBySession(sessionId) {
        const intakeId = this.draftBySession.get(sessionId);
        return intakeId ? (this.drafts.get(intakeId) ?? null) : null;
    }
    async saveDraftBriefRevision(brief) {
        const key = `${brief.session_id}:${brief.revision}`;
        const existing = this.briefRevisions.get(key);
        if (existing) {
            if (canonicalHash(existing) !== canonicalHash(brief)) {
                throw new IntakeError('INTAKE_STORE_CONFLICT', `Draft brief revision ${brief.revision} already exists with different content. Revisions are immutable.`);
            }
            return;
        }
        this.briefRevisions.set(key, brief);
    }
    async loadDraftBriefRevision(sessionId, revision) {
        return this.briefRevisions.get(`${sessionId}:${revision}`) ?? null;
    }
    async listDraftBriefRevisions(sessionId) {
        return [...this.briefRevisions.values()]
            .filter((b) => b.session_id === sessionId)
            .sort((a, b) => a.revision - b.revision);
    }
    async savePreference(record) {
        this.preferences.set(record.preference_id, record);
    }
    async loadPreference(preferenceId) {
        return this.preferences.get(preferenceId) ?? null;
    }
    async deletePreference(preferenceId) {
        this.preferences.delete(preferenceId);
    }
    async saveFreezeRecord(record) {
        this.freezeRecords.set(record.session_id, record);
    }
    async loadFreezeRecord(sessionId) {
        return this.freezeRecords.get(sessionId) ?? null;
    }
    async saveAmendment(record) {
        const list = this.amendments.get(record.session_id) ?? [];
        list.push(record);
        this.amendments.set(record.session_id, list);
    }
    async listAmendments(sessionId) {
        return [...(this.amendments.get(sessionId) ?? [])];
    }
}
// ---------------------------------------------------------------------------
// Durable file working store (standalone composition)
// ---------------------------------------------------------------------------
/**
 * One canonical-JSON document per record under `directory`, in
 * kind-prefixed files. Writes go to a temp file renamed over the
 * target, so an interrupted write never leaves a torn record; loads
 * parse the exact canonical bytes. Record IDs are validated opaque
 * IDs by the contracts layer, so file names carry no client text.
 */
export class FileIntakeWorkingStore {
    directory;
    constructor(directory) {
        this.directory = directory;
        mkdirSync(directory, { recursive: true });
    }
    pathFor(kind, id) {
        return join(this.directory, `${kind}-${id}.json`);
    }
    write(kind, id, value) {
        const target = this.pathFor(kind, id);
        const temp = `${target}.tmp`;
        writeFileSync(temp, canonicalStringify(value), 'utf8');
        renameSync(temp, target);
    }
    read(kind, id) {
        const target = this.pathFor(kind, id);
        if (!existsSync(target))
            return null;
        return JSON.parse(readFileSync(target, 'utf8'));
    }
    listByPrefix(kind) {
        const out = [];
        for (const name of readdirSync(this.directory)) {
            if (!name.startsWith(`${kind}-`) || !name.endsWith('.json'))
                continue;
            out.push(JSON.parse(readFileSync(join(this.directory, name), 'utf8')));
        }
        return out;
    }
    async saveDraft(draft) {
        this.write('draft', draft.intake_id, draft);
        this.write('draft-session', draft.session_id, { intake_id: draft.intake_id });
    }
    async loadDraft(intakeId) {
        return this.read('draft', intakeId);
    }
    async loadDraftBySession(sessionId) {
        const pointer = this.read('draft-session', sessionId);
        return pointer ? this.loadDraft(pointer.intake_id) : null;
    }
    async saveDraftBriefRevision(brief) {
        const id = `${brief.session_id}-r${brief.revision}`;
        const existing = this.read('brief', id);
        if (existing) {
            if (canonicalHash(existing) !== canonicalHash(brief)) {
                throw new IntakeError('INTAKE_STORE_CONFLICT', `Draft brief revision ${brief.revision} already exists with different content. Revisions are immutable.`);
            }
            return;
        }
        this.write('brief', id, brief);
    }
    async loadDraftBriefRevision(sessionId, revision) {
        return this.read('brief', `${sessionId}-r${revision}`);
    }
    async listDraftBriefRevisions(sessionId) {
        return this.listByPrefix('brief')
            .filter((b) => b.session_id === sessionId)
            .sort((a, b) => a.revision - b.revision);
    }
    async savePreference(record) {
        this.write('preference', record.preference_id, record);
    }
    async loadPreference(preferenceId) {
        return this.read('preference', preferenceId);
    }
    async deletePreference(preferenceId) {
        const target = this.pathFor('preference', preferenceId);
        if (existsSync(target))
            renameSync(target, `${target}.deleted`);
    }
    async saveFreezeRecord(record) {
        this.write('freeze', record.session_id, record);
    }
    async loadFreezeRecord(sessionId) {
        return this.read('freeze', sessionId);
    }
    async saveAmendment(record) {
        this.write('amendment', record.amendment_id, record);
    }
    async listAmendments(sessionId) {
        return this.listByPrefix('amendment')
            .filter((a) => a.session_id === sessionId)
            .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at) || a.amendment_id.localeCompare(b.amendment_id));
    }
}
