/**
 * Pack audit records (CWE-012 step 3): a pack-level structural and
 * substantive audit with immutable version/hash output (Section 34).
 *
 * The audit binds the pack's canonical content hash to the validator
 * version, the pack version, the computed qualification, and the full
 * diagnostic set. The audit hash is a self-excluding canonical hash over
 * the audit record, so any later edit to the record is detectable.
 * Hash stability, stated precisely (CWE-042 Defect 1, corrected by
 * CWE-050; hash semantics unchanged): `pack_sha256` covers pack content
 * only and is identical for the same content under the same validator
 * version. `audit_sha256` covers the audit record INCLUDING `audited_at`,
 * so two audits of the same pack differ in `audit_sha256` whenever
 * their `audited_at` values differ; audits are reproducible only with
 * the same `audited_at`, and runners therefore always pass an explicit
 * `audited_at` rather than relying on a clock default. `audited_at` is
 * host-supplied (the trusted clock stamps audits; validators never
 * invent a time).
 */
import { canonicalHash } from '../contracts/canonical-json';
import { validateAdvisorPack } from './packs';
export const VALIDATOR_VERSION = 'wise-elders.source-validator/v1';
/** The exact content the pack hash binds: claims, not file bytes. */
function packContent(pack) {
    return {
        folder: pack.folder,
        profile: pack.profile,
        sources: pack.sources,
        coverage: pack.coverage,
        frameworks: pack.frameworks ?? null,
        decision_rules: pack.decisionRules ?? null,
        failure_patterns: pack.failurePatterns ?? null,
        questions: pack.questions ?? null,
        evals: pack.evals ?? null,
        markdown_texts: pack.markdownTexts ?? [],
    };
}
export function auditPack(pack, options = {}) {
    const validation = validateAdvisorPack(pack, options);
    const audit = {
        validator_version: VALIDATOR_VERSION,
        seat_id: validation.seat_id,
        pack_version: validation.pack_version,
        audited_at: options.audited_at ?? null,
        valid: validation.valid,
        qualification: validation.qualification,
        works: validation.works,
        diagnostics: validation.diagnostics,
        pack_sha256: canonicalHash(packContent(pack)),
        audit_sha256: '',
    };
    audit.audit_sha256 = computeAuditHash(audit);
    return { validation, audit };
}
/** Canonical hash of the audit record with its own hash field removed. */
function computeAuditHash(audit) {
    const { audit_sha256: _own, ...rest } = audit;
    return canonicalHash(rest);
}
/**
 * Verify an existing audit record has not been altered since it was
 * produced: the stored audit hash must still equal the self-excluding
 * canonical hash of the record.
 */
export function verifyAuditIntegrity(audit) {
    return audit.audit_sha256 === computeAuditHash(audit);
}
