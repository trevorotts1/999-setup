/**
 * Standalone per-user data locations (CWE-004; directive Section 16.1).
 *
 * Council state is NOT source code: it never lives inside the skill
 * folder, because update sync replaces skill folders wholesale. Both Mac
 * Claude config roots share this one data profile; no duplicate history
 * is created per skill root.
 *
 * Defaults: macOS `~/Library/Application Support/BlackCEO/WiseElders`;
 * Windows `%LOCALAPPDATA%\BlackCEO\WiseElders`; Linux
 * `${XDG_DATA_HOME:-$HOME/.local/share}/blackceo/wise-elders`.
 * An explicit override (CLI --data-dir or BLACKCEO_COUNCIL_DATA_DIR) is
 * validated and wins; an override pointing inside the skill tree is
 * rejected so state can never be swept away by a skill update.
 */
export declare const DATA_DIR_ENV = "BLACKCEO_COUNCIL_DATA_DIR";
export declare function defaultDataDir(env?: NodeJS.ProcessEnv): string;
export declare function resolveDataDir(options: {
    override?: string | null;
    env?: NodeJS.ProcessEnv;
    skillRoot?: string | null;
}): string;
/** Create the data directory (and a named subdirectory) with private perms. */
export declare function ensureDataDir(dataDir: string, sub?: string): string;
