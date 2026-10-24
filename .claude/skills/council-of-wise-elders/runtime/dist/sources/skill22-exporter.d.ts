import { type Skill22ExportPackage } from './export-package.js';
export interface ExportDiagnostic {
    code: string;
    entry?: number;
    passage?: number;
    seat_id?: string;
    persona_key?: string;
    field?: string;
}
export declare function exportSkill22(skill22Root: string, mapping: unknown): {
    schema: string;
    scope: string;
    packages: Skill22ExportPackage[];
    seats: {
        seat_id: string;
        package_sha256: string;
        evidence_units: number;
        qualification: import("./coverage.js").PackQualification | null;
        works: import("./coverage.js").WorkCoverage[];
    }[];
    receipts: {
        evidence_id: string;
        file: string;
        sha256: string;
        start_line: number;
        end_line: number;
        hash_basis: string;
        provenance_reference: string;
    }[];
    diagnostics: ExportDiagnostic[];
    mapping_sha256: string;
    source_verification: string;
};
