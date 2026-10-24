/**
 * Council state-authority profile (CWE-006, directive Sections 4.5,
 * 16.1, and 30.2.18).
 *
 * One installation has one authoritative store. The state-authority
 * mode (standalone SQLite on this installation, or managed by the
 * Command Center server) is chosen at installation or session
 * creation, recorded here in the council data directory, and never
 * switched silently: opening the store with a different mode than the
 * recorded one fails loudly with PERSISTENCE_AUTHORITY_MODE_MISMATCH.
 * A managed authority that becomes unreachable surfaces a connection
 * failure to the caller; it never falls back to a standalone database
 * that would diverge and conflict later.
 *
 * The profile contains no secret material by construction: it records
 * the chosen mode, the authority locator (a host-and-path reference,
 * never a credential), and installation bookkeeping only.
 */
import { type AuthorityMode } from './config.js';
export declare const COUNCIL_PROFILE_FILE_NAME = "council-profile.json";
export interface CouncilInstallationProfile {
    schema_version: string;
    authority_mode: AuthorityMode;
    /** Managed-mode authority locator (reference only, never a credential). */
    authority_ref: string | null;
    installation_id: string;
    recorded_at: string;
    config_schema_version: string;
}
/** Read the recorded profile, or null when no store was ever opened. */
export declare function readInstallationProfile(dataDir: string): CouncilInstallationProfile | null;
/**
 * Ensure the profile records exactly `requestedMode`. When no profile
 * exists yet, this installation chooses the mode now and records it
 * (atomic write via a temp file and rename, mode 0600). When a profile
 * exists with a different mode, the open is refused: switching
 * authority mode is an explicit migration, never a silent fallback,
 * including when the recorded authority is unreachable.
 */
export declare function ensureInstallationProfile(dataDir: string, requested: {
    authority_mode: AuthorityMode;
    authority_ref: string | null;
    installation_id: string;
    recorded_at: string;
}): CouncilInstallationProfile;
