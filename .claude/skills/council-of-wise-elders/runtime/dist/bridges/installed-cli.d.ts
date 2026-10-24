/**
 * Installed-runtime receipt resolution (WER-005).
 *
 * The skill must reach the CLI that WER-004's installer actually activated,
 * not a path guessed from the process working directory and not a `dist/`
 * folder generated inside a checkout. The installer's own staged-release
 * receipt is the single source of truth, consumed here unchanged:
 *
 *   <prefix>/active.json                       wise-elders.council-runtime-active/v1
 *   <prefix>/receipts/<releaseId>.release.json wise-elders.council-runtime-release/v1
 *   <prefix>/receipts/<releaseId>.artifact.json wise-elders.council-runtime-artifact/v1
 *   <prefix>/releases/<releaseId>/dist/blackceo-council.mjs
 *
 * Resolution never reads `process.cwd()`. A relative COUNCIL_RUNTIME_PREFIX
 * is refused rather than silently resolved against the working directory,
 * because that would reintroduce the exact dependency this module removes.
 *
 * When no valid receipt exists the result is an explicit failure carrying
 * the exact paths checked and a concrete recovery command. Callers must not
 * substitute improvised advice, and this module never fabricates a release.
 */
/** Same variable the installer honors (install-runtime.mjs defaultPrefix). */
export declare const RUNTIME_PREFIX_ENV = "COUNCIL_RUNTIME_PREFIX";
/** Receipt schemas owned by WER-004's installer. Do not fork these. */
export declare const ACTIVE_RECEIPT_SCHEMA = "wise-elders.council-runtime-active/v1";
export declare const RELEASE_RECEIPT_SCHEMA = "wise-elders.council-runtime-release/v1";
export declare const ARTIFACT_RECEIPT_SCHEMA = "wise-elders.council-runtime-artifact/v1";
/** Required build product the installer records and this module resolves. */
export declare const INSTALLED_CLI_RELATIVE = "dist/blackceo-council.mjs";
export declare const INSTALLER_SCRIPT_RELATIVE: string;
export type InstalledCliFailureCode = 'RUNTIME_PREFIX_INVALID' | 'RUNTIME_NOT_INSTALLED' | 'RUNTIME_RECEIPT_INVALID' | 'RUNTIME_RELEASE_MISSING' | 'RUNTIME_ARTIFACT_INVALID';
export interface InstalledCliSuccess {
    ok: true;
    prefix: string;
    releaseId: string;
    releasePath: string;
    /** The active pointer the installer atomically replaced. */
    activeReceiptPath: string;
    /** WER-004's staged-release receipt for this release. */
    releaseReceiptPath: string;
    artifactReceiptPath: string;
    /** Absolute path to the installed CLI. Never a checkout `dist/` path. */
    cliPath: string;
    cliSha256: string;
    nodeExecutable: string;
    nodeVersion: string;
    dataDir: string;
    sourceManifestDigest: string;
    artifactDigest: string;
}
export interface InstalledCliFailure {
    ok: false;
    code: InstalledCliFailureCode;
    message: string;
    /** Concrete next action, naming the installer command and the prefix. */
    recovery: string;
    /** Every receipt/release path this resolution actually probed. */
    checked: string[];
}
export type InstalledCliResolution = InstalledCliSuccess | InstalledCliFailure;
export interface ResolveInstalledCliOptions {
    /** Explicit prefix. Default: COUNCIL_RUNTIME_PREFIX, else the installer default. */
    prefix?: string;
    /** Home directory used only for the installer's default prefix. */
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    /** Skill folder, used only to spell a concrete installer path in recovery. */
    skillRoot?: string;
}
/** Mirrors install-runtime.mjs defaultPrefix exactly. */
export declare function defaultRuntimePrefix(env?: NodeJS.ProcessEnv, home?: string): string;
/**
 * Resolve the ACTIVE installed CLI through WER-004's receipts.
 *
 * Total: every filesystem/parse problem becomes a typed failure result, so a
 * skill front door can print the recovery instead of crashing or inventing a
 * path.
 */
export declare function resolveInstalledCli(options?: ResolveInstalledCliOptions): InstalledCliResolution;
