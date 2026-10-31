/**
 * CTR-146: the installation capability snapshot for the reader-facing
 * "Your installed tools" section of a council report.
 *
 * What this module is allowed to read, and nothing else:
 * - `<openclaw root>/skills/<folder>/SKILL.md` — the YAML frontmatter
 *   `name` and `description` only (first 12 KB of the file);
 * - `<openclaw root>/skills/<folder>` existence — a folder without a
 *   SKILL.md is not a skill;
 * - `<openclaw root>/agents/dept-*` — the folder name only, and only
 *   when it looks operational (it carries `models.json` or an `agent/`
 *   directory). A bare or template directory is not a department;
 * - optionally `<claude root>/skills/<folder>/SKILL.md` frontmatter.
 *
 * It never reads or renders prompts, instructions, private memory,
 * credentials, databases, or configuration values. It never executes a
 * skill. It never reads another box (no network, no remote host).
 *
 * The snapshot is validated again at the report trust boundary so a
 * caller-supplied inventory cannot grow into a catalog dump or smuggle
 * a different installation's list into a client export. Matching to the
 * plan is exact work only (CTR-151): an exact recorded reference on the
 * action proposal, or the step naming the capability's exact name or id.
 * Shared vocabulary is not a match basis, so a backup skill is never
 * suggested for a video step. A match is labelled optional assistance,
 * never a promise that a tool can execute a step.
 */
export declare const CAPABILITY_SNAPSHOT_SCHEMA: "wise-elders.capability-snapshot/v1";
export declare const CAPABILITY_SNAPSHOT_LIMITS: {
    readonly max_items: 120;
    readonly max_name: 90;
    readonly max_description: 320;
    readonly max_id: 140;
    readonly max_reference_ids: 24;
    readonly max_limitations: 24;
    readonly max_limitation_text: 400;
    readonly max_matched_steps: 6;
};
export type CapabilityKind = 'skill' | 'department';
export type CapabilityAvailability = 'available_now' | 'available_at_sitting';
export type CapabilitySource = 'openclaw.skills' | 'openclaw.departments' | 'claude.skills';
export interface InstallationCapabilityEntry {
    /** Stable bounded id: `skill:<slug>` or `department:<folder>`. */
    capability_id: string;
    kind: CapabilityKind;
    name: string;
    description: string | null;
    availability: CapabilityAvailability;
    source: CapabilitySource;
    /** Recorded plan references that name this capability, when any. */
    recorded_reference_ids: string[];
}
export interface InstallationCapabilitySnapshot {
    schema_version: typeof CAPABILITY_SNAPSHOT_SCHEMA;
    /**
     * The installation the inventory was read from. The report refuses a
     * snapshot whose installation does not match the session's own.
     */
    installation_id: string;
    /** `YYYY-MM-DD` (sitting date or export date). */
    captured_at: string;
    /**
     * `at_sitting` when a snapshot captured at convene time is supplied;
     * `at_export` when the box was inspected while building this report.
     */
    basis: 'at_sitting' | 'at_export';
    items: InstallationCapabilityEntry[];
    limitations: string[];
}
export declare class CapabilitySnapshotError extends Error {
    readonly code: 'CAPABILITY_SNAPSHOT_INVALID' | 'CAPABILITY_SNAPSHOT_MISMATCH' | 'CAPABILITY_SNAPSHOT_TOO_LARGE';
    constructor(code: CapabilitySnapshotError['code'], message: string);
}
/**
 * Strict validation at the report boundary. Unknown fields are rejected,
 * every string is bounded, and the item count is capped so a catalog
 * dump can never ride into a client report.
 */
export declare function validateCapabilitySnapshot(value: unknown): InstallationCapabilitySnapshot;
/** The report refuses a snapshot from another installation (fail closed). */
export declare function assertSnapshotInstallation(snapshot: InstallationCapabilitySnapshot, installationId: string | null | undefined): void;
export interface DiscoverCapabilitiesOptions {
    /** The box's own OpenClaw root (`openclawRoot()` in the CLI). */
    openclaw_root: string;
    installation_id: string;
    /** `YYYY-MM-DD`; the sitting date or the export date. */
    captured_at: string;
    availability?: CapabilityAvailability;
    /** Optional claude-nine / Claude Code skills root on the same box. */
    claude_skills_root?: string | null;
    max_items?: number;
}
/**
 * Read this installation's inventory. Never throws: an unreadable folder
 * is reported in `limitations`, never turned into an invented entry.
 */
export declare function discoverInstallationCapabilities(options: DiscoverCapabilitiesOptions): InstallationCapabilitySnapshot;
export interface PlanProposalReference {
    action_id: string;
    title: string;
    description: string;
    department_id?: string | null;
    sop_id?: string | null;
    persona_id?: string | null;
    assigned_agent_id?: string | null;
}
/** The bases a match may rest on. All are exact, not statistical. */
export type CapabilityMatchBasis = 'recorded_reference' | 'named_in_step'
/** CTR-155: at least one step recorded a reference and another only named it. */
 | 'mixed';
/** CTR-155: one step's own match basis and exact literals, never merged. */
export interface CapabilityMatchedAction {
    action_id: string;
    action_title: string;
    basis: 'recorded_reference' | 'named_in_step';
    /** The exact literals this one step supplied, prefixed with its action id. */
    evidence: string[];
}
export interface CapabilityPlanMatch extends InstallationCapabilityEntry {
    matched_action_ids: string[];
    matched_action_titles: string[];
    match_basis: CapabilityMatchBasis;
    /** The exact literals that justified the match, for the reader. */
    match_evidence: string[];
    /**
     * CTR-155: the per-step basis, so a renderer can say "this step records
     * it" without claiming the same for a step that only named the tool.
     */
    matched_actions: CapabilityMatchedAction[];
    recorded_reference_action_ids: string[];
    named_in_step_action_ids: string[];
    /**
     * Retained only so older readers keep their shape; always empty.
     *
     * CTR-151 removed the previous generic word-overlap rule. It matched on
     * any two shared tokens of four or more letters, so the observed report
     * linked a backup-protocol skill to a video step through "before" and
     * "every", and a GHL setup skill to a production-hours step through
     * "before" and "search". Shared vocabulary is not task fit.
     */
    shared_terms: string[];
}
/**
 * Match installed capabilities to plan steps. Two verified bases only:
 *
 * 1. `recorded_reference` — the action proposal itself records this
 *    department, SOP, persona, or agent.
 * 2. `named_in_step` — the step text contains the capability's exact name,
 *    slug, or id as a whole phrase.
 *
 * The basis is recorded PER STEP (`matched_actions`). A capability whose
 * steps split between the two bases reports `mixed`; it is never described
 * as recorded for the whole plan. No token overlap, no scoring, no model
 * call. A step that names no capability gets no suggestion, and "installed"
 * never means "operational".
 */
export declare function matchCapabilitiesToPlan(snapshot: InstallationCapabilitySnapshot, proposals: readonly PlanProposalReference[]): CapabilityPlanMatch[];
/** True when a path exists and is a directory (used by the seat loader). */
export declare function directoryExists(path: string): boolean;
