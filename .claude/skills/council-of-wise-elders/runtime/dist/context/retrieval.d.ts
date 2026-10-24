/**
 * CWE-022 authorized retrieval (directive Sections 8.6, 9.2, 28.2).
 *
 * Every retrieval passes the CWE-007 authorization ports with the
 * caller's trusted principal:
 *
 * 1. The session gate runs first (assertSessionRead). A denied caller
 *    gets the CWE-007 AuthorizationError and the catalog is never
 *    touched: no headers are listed, no content is loaded.
 * 2. Each candidate header is then decided with the same port
 *    (checkSessionRead against the material's own scope and
 *    visibility). Cross-tenant, cross-company, and cross-installation
 *    material is skipped; private material is admitted only for its
 *    owner (or an auditable host-granted support read, exactly as the
 *    CWE-007 session rule allows); company scope alone never admits
 *    private material.
 * 3. Source-scope rules from Section 8.3 apply on top: a user_private
 *    source is admitted only for its owner, and never into an assembly
 *    marked distributable (the CWE-012 condition 3 bar on the Brunson
 *    private-scope record). A revoked source (Section 8.6) is excluded
 *    from retrieval. Only evidence named by the frozen brief manifest,
 *    with a matching content hash, is admitted.
 * 4. Skips are silent and total: the result contains only admitted
 *    items. There are no exclusion counts, no skipped digests, and no
 *    error text derived from skipped material, so an out-of-scope item
 *    cannot be detected from any output of this layer.
 * 5. Content loads only for admitted IDs, and every loaded candidate is
 *    revalidated against the CWE-012 schemas and cross-checked (unit
 *    cites the record, version matches sourceVersionOf, canonical hash
 *    matches the header and the frozen manifest) before it becomes a
 *    RetrievedItem. A candidate that fails validation after admission
 *    fails the retrieval with a generic ContextError; no partial
 *    candidate set is returned.
 */
import { type AccessVia, type TrustedPrincipal } from '../authorization/index.js';
import { type EvidenceManifestEntry } from '../contracts/index.js';
import { type Skill22ExportPackage } from '../sources/export-package.js';
import { type CandidateHeader, type MaterialCatalog, type RetrievedItem, type SessionAccessTarget } from './types.js';
export interface RetrievalOptions {
    /** True when the assembly will be marked distributable. */
    readonly distributable?: boolean;
    /** Source IDs withdrawn under Section 8.6. */
    readonly revokedSourceIds?: ReadonlySet<string>;
}
export interface RetrievalResult {
    readonly items: readonly RetrievedItem[];
    /** How the session gate admitted the caller (owner, company, support). */
    readonly access_via: AccessVia;
}
/** Deterministic candidate order: roster order, then evidence ID. */
export declare function compareHeaders(a: CandidateHeader, b: CandidateHeader): number;
/**
 * Retrieve the authorized candidate set for one session and one frozen
 * brief manifest. Throws the CWE-007 AuthorizationError when the
 * session gate denies the caller, and ContextError when an admitted
 * candidate fails provenance validation.
 */
export declare function retrieveAuthorizedMaterial(args: {
    principal: TrustedPrincipal;
    session: SessionAccessTarget;
    manifest: readonly EvidenceManifestEntry[];
    catalog: MaterialCatalog;
    options?: RetrievalOptions;
}): RetrievalResult;
/**
 * Package pre-flight: run the CWE-012 export package validator over the
 * packages an assembly will draw on. A package the validator does not
 * accept (unknown seat, evidence citing a source it does not carry,
 * version mismatch, revoked source) fails here with a generic error,
 * before any retrieval happens. Diagnostic detail stays with the
 * validator's own audit surface; it is never copied into context errors.
 */
export declare function assertPackagesValid(packages: readonly Skill22ExportPackage[], revokedSourceIds?: ReadonlySet<string>): void;
