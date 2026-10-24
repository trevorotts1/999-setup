/**
 * blackceo-council CLI dispatcher (CWE-004; CWE-050 composition).
 *
 * Argument arrays only: no shell strings. Every command prints either
 * clean JSON (--json) or a short human summary, and failures are
 * stable typed envelopes (Section 17.3) with nonzero exit codes. The
 * dispatcher is a thin shell over the engine and the injected host;
 * importing it has no side effects.
 *
 * Composed surface (CWE-050): the authorization commands delegate to
 * CWE-049's handleAuthorizationCommand (preview, approve, status,
 * revoke) with controlling-terminal confirmation wired here; export
 * runs through CWE-038's validated ReportExportService (PDF stays
 * registered not ready by that service, naming CWE-044's renderer).
 * Live route probes remain FEATURE_NOT_READY naming CWE-009/CWE-010
 * with CWE-049: no live transport is composed in the standalone host.
 */
import { type LocalHost } from './local-host.js';
export interface CliIo {
    out(text: string): void;
    err(text: string): void;
}
export interface CliDeps {
    createHost?: (options: {
        dataDir?: string;
        skillRoot?: string;
    }) => LocalHost;
}
/**
 * The skill folder that contains this runtime (state must stay outside it).
 *
 * CWE-045 (finding F-4): the fixed three-level climb was written for
 * the src/cli and dist/cli layouts, but the bundled CLI ships as ONE
 * file at dist/blackceo-council.mjs, one level shallower, so the
 * climb landed on the skill folder's PARENT and resolveDataDir's
 * refusal became a fail-closed superset (it refused data directories
 * anywhere in the parent folder, including siblings of the skill).
 * The resolution now walks up from the module directory to the first
 * ancestor carrying the skill folder's signature (a SKILL.md beside
 * a runtime/ directory), which is exact in every shipped layout:
 * runtime/src/cli, runtime/dist/cli, and the bundled
 * runtime/dist/blackceo-council.mjs. When no signature is found
 * (an exotic embedding), the historical three-level climb is kept
 * as the fallback rather than guessing a different boundary.
 */
export declare function skillRootFromModule(): string;
/**
 * The ACTUAL skill folder. Two mechanisms, in order:
 *
 * 1. The install record, read from `../../install-record.json` beside
 *    the running module. Neither installed layout has a SKILL.md,
 *    advisors/ or manifest.json above it, so the record is the
 *    install's own statement of which folder it was built from. Two
 *    installers write it, one per layout:
 *    - this repo's scripts/install-runtime.mjs (INSTALL.md Step 4)
 *      installs <prefix>/releases/<id>/dist/blackceo-council.mjs and
 *      writes <prefix>/releases/install-record.json;
 *    - the 999-setup vendoring's scripts/council-runtime-install.sh
 *      (that repo only, not this tree) installs
 *      <prefix>/runtime/dist/council-entry.mjs and writes
 *      <prefix>/install-record.json.
 * 2. A layout-independent walk to the nearest ancestor carrying the
 *    skill signature (SKILL.md beside advisors/ and manifest.json).
 *
 * null when neither applies: the guard then has no root, and every
 * command that must keep state out of the skill tree refuses rather
 * than measuring a guessed boundary (see runCli: doctor reports
 * data_dir_outside_skill_tree as not ready; session, authorization,
 * sample and the host-backed commands throw invalidInput).
 */
export declare function skillRootForAssets(): string | null;
export declare function runCli(argv: string[], io?: CliIo, deps?: CliDeps): Promise<number>;
