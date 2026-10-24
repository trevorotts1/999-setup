/**
 * CWE-050 integration adapter: CWE-011 Skill 22 export (v1 shape) to
 * the strict CWE-012 source and evidence schemas, WITHOUT loosening
 * the strict schemas (CWE-022 carried finding; CWE-024 flag 4).
 *
 * What the real export carries, and what the adapter does with it:
 *
 * - Source records: the v1 export adds bookkeeping fields the strict
 *   schema rejects (status, record_status, anchor_role, artifacts,
 *   content_hash_basis, export_skill, extraction, flags, gaps,
 *   locator_kinds_available, retained_text, rights_note,
 *   skill22_persona_folder, coverage_label). The adapter constructs
 *   each strict record field by field from the canonical subset only;
 *   the dropped field names are reported, never silently merged in.
 * - Present records (content_sha256 set) adapt to strict records.
 *   Their content hash is the Skill 22 derivative artifact's hash
 *   (extraction-notes.md), per the export's own content_hash_basis;
 *   originals were never hashed or copied, and the adapter does not
 *   pretend otherwise.
 * - retrieved_at: only ONE record in the export carries its own
 *   retrieval date (Brunson Network Marketing Secrets, 2026-06-26);
 *   it is kept verbatim. For every other present record the adapter
 *   uses the export package's exported_at, recorded in the adaptation
 *   report as the date the record's content hash was fixed in the
 *   council pipeline by the CWE-011 export. That is a pipeline date,
 *   NOT the underlying Skill 22 retrieval date, and the record's
 *   quality label is carried verbatim (never upgraded).
 * - Absent records (no content hash: the verifiably absent works) get
 *   NO strict record: no hash or date is fabricated for them. They are
 *   emitted as absence entries in the adaptation report with their
 *   export-recorded gaps, and nothing loads for them downstream,
 *   matching the packs' source_absent treatment.
 * - Evidence units: concept units load with paraphrase = the export's
 *   summary. Quotation units are ALL verification_status 'candidate'
 *   in the export (build-wide standing fact: zero verified
 *   quotations; their verification_basis values are unverified-grade).
 *   Candidate quote text is therefore WITHHELD: quote units adapt with
 *   excerpt null and paraphrase null, carry no loadable text, and the
 *   adapted catalog never offers them as candidates. The permanent fix
 *   is a v2 export shape carrying located retained text; until then a
 *   candidate quote is never presented as a verified quotation.
 *
 * Every constructed record and unit is parsed through the strict
 * CWE-012 schemas; a parse failure throws naming the record or unit.
 * Fail closed, never drop silently.
 */
import type { MaterialCatalog } from '../context/types.js';
import type { ScopeFields, SessionVisibility } from '../contracts/index.js';
import { type EvidenceUnit, type SourceRecord } from './schemas.js';
/** One absent work: no strict record exists for it, by design. */
export interface ExportAbsence {
    source_id: string;
    seat_id: string;
    work_title: string;
    /** The export's own gap notes, verbatim. */
    gaps: string[];
}
export interface AdaptationReport {
    exporter: string;
    exported_at: string;
    basis_commit: string | null;
    records_seen: number;
    records_adapted: number;
    absences: ExportAbsence[];
    /** source_id -> where its retrieved_at came from. */
    retrieved_at_basis: Record<string, 'record_verbatim' | 'export_package'>;
    /** Export-only field names the adapter dropped, sorted. */
    dropped_fields: string[];
    units_seen: number;
    units_adapted: number;
    concept_units: number;
    /** Quote units whose candidate text was withheld (excerpt null). */
    quote_units_text_withheld: number;
}
export interface AdaptedExport {
    records: SourceRecord[];
    units: EvidenceUnit[];
    report: AdaptationReport;
}
/**
 * Adapt a CWE-011 export directory (the directory holding
 * export-manifest.json and one subdirectory per seat) into strict
 * CWE-012 records and units plus the adaptation report.
 */
export declare function adaptSkill22Export(exportsDir: string): AdaptedExport;
/**
 * A CWE-022 MaterialCatalog over an adapted export. Only units with
 * loadable text (a paraphrase or a permitted excerpt) are offered as
 * candidates; withheld candidate quotations are never listed, so the
 * retrieval path can never load them. Header hashes are the canonical
 * hash of the strict unit, as the accepted context path requires.
 */
export declare function createAdaptedMaterialCatalog(adapted: AdaptedExport, options: {
    scope: ScopeFields;
    visibility?: SessionVisibility;
}): MaterialCatalog;
