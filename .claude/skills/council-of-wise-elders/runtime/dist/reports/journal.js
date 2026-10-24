/**
 * Export journaling (CWE-038, brief scope point 4; directive Sections
 * 16.2, 18).
 *
 * Every export writes one journal record per format through the
 * CWE-006 event journal on the stack: who exported (exporter subject
 * and access path), what verdict revision and content hash, what
 * format, and the artifact's own content hash.
 *
 * Vocabulary note: the frozen CWE-003 event vocabulary has no
 * export-specific event type, and the council_events table enforces
 * that vocabulary with a CHECK constraint. An export is therefore
 * journaled as an 'operation_completed' event whose payload carries
 * kind 'report_export' and the full export record. Adding a dedicated
 * event type is a CWE-003 contract amendment for integration to
 * consider; this unit does not modify the frozen contracts.
 */
import { SCHEMA_VERSIONS } from '../contracts/index.js';
/** The journal event ID for one export of one format under one request. */
export function exportEventId(request_id, format) {
    return `export-${request_id}-${format}`;
}
function recordFromPayload(payload, session_id, export_id, created_at) {
    if (payload.kind !== 'report_export')
        return null;
    return {
        export_id,
        request_id: String(payload.request_id ?? ''),
        session_id,
        format: payload.format,
        verdict_revision: Number(payload.verdict_revision ?? 0),
        verdict_content_sha256: String(payload.verdict_content_sha256 ?? ''),
        artifact_sha256: String(payload.artifact_sha256 ?? ''),
        exporter_subject: String(payload.exporter_subject ?? ''),
        via: payload.via === 'owner' ? 'owner' : 'company',
        actor: payload.actor === 'owner' ||
            payload.actor === 'system' ||
            payload.actor === 'chair'
            ? payload.actor
            : 'worker',
        redacted: payload.redacted === true,
        redaction_profile_id: typeof payload.redaction_profile_id === 'string'
            ? payload.redaction_profile_id
            : null,
        created_at,
    };
}
/**
 * The CWE-006 adapter: appends through CouncilStoreService.appendEvent
 * (the composed store's journal port) and reads back through
 * listEvents, which is per-session by construction. The journal row's
 * actor_subject is the composing host's service identity per the
 * CWE-006 port semantics; the export record itself, including the
 * exporter subject, is the event payload.
 */
export function createCwe006ExportJournal(store, scope) {
    return {
        async appendExportRecord(record) {
            await store.appendEvent({
                schema_version: SCHEMA_VERSIONS.event,
                event_id: record.export_id,
                session_id: record.session_id,
                event_type: 'operation_completed',
                tenant_id: scope.tenant_id,
                company_id: scope.company_id,
                owner_subject: null,
                actor: record.actor,
                payload: {
                    kind: 'report_export',
                    request_id: record.request_id,
                    format: record.format,
                    verdict_revision: record.verdict_revision,
                    verdict_content_sha256: record.verdict_content_sha256,
                    artifact_sha256: record.artifact_sha256,
                    exporter_subject: record.exporter_subject,
                    via: record.via,
                    actor: record.actor,
                    redacted: record.redacted,
                    redaction_profile_id: record.redaction_profile_id,
                },
                created_at: record.created_at,
            });
        },
        async findExportRecord(session_id, export_id) {
            const events = await store.listEvents(session_id);
            const event = events.find((e) => e.event_id === export_id);
            if (!event)
                return null;
            return recordFromPayload(event.payload, session_id, export_id, event.created_at);
        },
    };
}
/** In-memory journal for tests and standalone composition. */
export class InMemoryExportJournal {
    byId = new Map();
    async appendExportRecord(record) {
        this.byId.set(record.export_id, record);
    }
    async findExportRecord(session_id, export_id) {
        const record = this.byId.get(export_id);
        if (!record || record.session_id !== session_id)
            return null;
        return record;
    }
    /** Test and diagnostic view of everything journaled, in append order. */
    records() {
        return [...this.byId.values()];
    }
}
export function createCwe006SessionLiveness(store) {
    return {
        isSessionDeleted(scope, session_id) {
            return store.repositories.isDeleted(scope.tenant_id, session_id);
        },
    };
}
