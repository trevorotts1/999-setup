/**
 * Skill 22 export package validation (CWE-012, Sections 8.5 and 34).
 *
 * The Skill 22 exporter (CWE-011) emits source records and evidence for
 * one seat at a time; this module is the receiving contract. The
 * exporter must reject unsupported source references and preserve
 * authorship and provenance metadata (Section 8.5): a package whose
 * evidence cites a source it does not carry, whose quotation evidence
 * lost its original speaker, or whose claimed titles are not backed by
 * records is rejected here with the same named diagnostics the pack
 * validator uses, so integration drift surfaces as a diagnostic, not a
 * silent format fork.
 *
 * FORMAT ASSUMPTION A1 (see README): the export package is expected to
 * carry Section 8.3 source records and evidence units under the field
 * names used here. Drift between this reading and CWE-011's emitted
 * packages is reconciled at the integration review, per the build plan.
 */
import type { PackQualification, WorkCoverage } from './coverage';
import { type PackValidationOptions } from './packs';
import { type Diagnostic } from './schemas';
export interface Skill22ExportPackage {
    seat_id: string;
    pack_version: string;
    /** Section 8.3 source records (full records, not stubs). */
    sources: readonly unknown[];
    /** Evidence units for this seat. */
    evidence: readonly unknown[];
    /** Foundation titles the package claims to cover, if it claims any. */
    claimed_titles?: readonly string[];
}
export interface ExportPackageValidation {
    accepted: boolean;
    qualification: PackQualification | null;
    works: WorkCoverage[];
    diagnostics: Diagnostic[];
}
export declare function validateExportPackage(pkg: Skill22ExportPackage, options?: PackValidationOptions): ExportPackageValidation;
