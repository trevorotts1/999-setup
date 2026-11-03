/**
 * Standalone per-user data locations (CWE-004; directive Section 16.1).
 *
 * Council state is NOT source code: it never lives inside the skill
 * folder, because update sync replaces skill folders wholesale. Both Mac
 * Claude config roots share this one data profile; no duplicate history
 * is created per skill root.
 *
 * ONE AUTHORITY. The supported OpenClaw entry is the `blackceo-council`
 * shim; the durable store is the one the Council service itself runs on.
 * When the box is wired (wire.sh) the service launcher is given
 * COUNCIL_SERVICE_DATA_DIR and records the same directory in
 * `<runtime prefix>/active.json`. The CLI must read THAT store for a
 * session it convened, never an unrelated per-user default: otherwise
 * `blackceo-council status <id>` answers "not found" for a session the
 * service just created.
 *
 * Resolution order for the data directory:
 *   1. an explicit override (CLI --data-dir)
 *   2. BLACKCEO_COUNCIL_DATA_DIR (documented operator override)
 *   3. COUNCIL_SERVICE_DATA_DIR (the service launcher's own value)
 *   4. `<runtime prefix>/active.json` `dataDir` (durable install receipt)
 *   5. `<openclaw root>/council-data` when it exists (wire.sh layout)
 *   6. the per-platform default below
 *
 * The per-platform default applies only when no wired Council store
 * exists: macOS `~/Library/Application Support/BlackCEO/WiseElders`,
 * Windows `%LOCALAPPDATA%\BlackCEO\WiseElders`, Linux
 * `${XDG_DATA_HOME:-$HOME/.local/share}/blackceo/wise-elders`.
 * An override pointing inside the skill tree is always rejected so state
 * can never be swept away by a skill update.
 */
export declare const DATA_DIR_ENV = "BLACKCEO_COUNCIL_DATA_DIR";
/** The service launcher's own durable data directory (wire.sh sets it). */
export declare const SERVICE_DATA_DIR_ENV = "COUNCIL_SERVICE_DATA_DIR";
/** The immutable Council runtime prefix (WER-004 receipts live here). */
export declare const RUNTIME_PREFIX_ENV = "COUNCIL_RUNTIME_PREFIX";
/** OPENCLAW_ROOT under the name the Council shim exports. */
export declare const OPENCLAW_ROOT_ENV = "WISE_ELDERS_OPENCLAW_ROOT";
/** The home directory every default is measured from. */
export declare function homeDirFor(env?: NodeJS.ProcessEnv, homeDir?: string): string;
/**
 * The OpenClaw root, by the same rule wire.sh and chamber-visual.sh use:
 * the environment value, else a container's /data/.openclaw, else
 * ~/.openclaw.
 */
export declare function openclawRoot(env?: NodeJS.ProcessEnv, homeDir?: string): string;
/** The immutable runtime prefix: explicit, else <openclaw root>/council-runtime. */
export declare function councilRuntimePrefix(env?: NodeJS.ProcessEnv, homeDir?: string): string;
/**
 * Is `dir` a skill folder, named positively?
 *
 * A SKILL.md alone is too weak a signature: any ordinary ancestor (a
 * repository root, a home directory) may carry an unrelated SKILL.md,
 * and the guard would then refuse data directories far outside the
 * skill. A council skill folder carries all three of SKILL.md,
 * advisors/ and manifest.json.
 */
export declare function isSkillFolder(dir: string): boolean;
/**
 * The ACTUAL skill folder, for assets (advisor packs, config) and for the
 * data-directory boundary. Two mechanisms, in order:
 *
 * 1. The install record. Neither installed layout has a SKILL.md,
 *    advisors/ or manifest.json above its module, so the record is the
 *    install's own statement of which folder it was built from. Two
 *    installers write it, one per layout:
 *    - this repo's scripts/install-runtime.mjs (INSTALL.md Step 4)
 *      installs <prefix>/releases/<id>/dist/blackceo-council.mjs and
 *      writes <prefix>/releases/install-record.json;
 *    - the 999-setup vendoring's scripts/council-runtime-install.sh
 *      installs <prefix>/runtime/dist/council-entry.mjs and writes
 *      <prefix>/install-record.json.
 *    The record is found by walking up from this module rather than by a
 *    fixed relative URL, because the service launcher imports
 *    src/service/* and src/cli/* (two levels below the release root)
 *    while the bundled CLI sits at dist/ (one level). Walking serves
 *    every shipped layout with ONE rule and still refuses to guess.
 * 2. A layout-independent walk to the nearest ancestor carrying the
 *    skill signature (SKILL.md beside advisors/ and manifest.json).
 *
 * null when neither applies: the caller refuses rather than measuring a
 * guessed boundary.
 */
export declare function skillFolderForAssets(moduleUrl?: string | URL): string | null;
/**
 * The directory the Council service itself runs on, when this box says
 * so. Null when nothing on the box has recorded one, never a guess.
 */
export declare function serviceDataDirHint(env?: NodeJS.ProcessEnv, homeDir?: string): string | null;
export declare function defaultDataDir(env?: NodeJS.ProcessEnv, homeDir?: string): string;
export declare function resolveDataDir(options: {
    override?: string | null;
    env?: NodeJS.ProcessEnv;
    skillRoot?: string | null;
    /** Test seam: the home directory defaults are measured from. */
    homeDir?: string;
}): string;
/** Create the data directory (and a named subdirectory) with private perms. */
export declare function ensureDataDir(dataDir: string, sub?: string): string;
