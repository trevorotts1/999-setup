/**
 * Canonical enums for the Council of Wise Elders contracts (CWE-003).
 *
 * Unknown enum values are rejected at every boundary. These lists are the
 * single source from which the zod schemas, JSON Schema artifacts, and
 * TypeScript consumer types are all generated, so consumers cannot drift.
 */
/** The nine fixed council seats, in approved roster order (Section 7). */
export declare const SEAT_IDS: readonly ["simon-sinek", "td-jakes", "oprah-winfrey", "tiffany-aliche", "russell-brunson", "michelle-obama", "brene-brown", "dennis-kimbro", "les-brown"];
export type SeatId = (typeof SEAT_IDS)[number];
/**
 * Display roster. T. D. Jakes is ONE seat with three book lenses, never three
 * votes (Section 7). The label for Brené Brown preserves the accented
 * spelling in data.
 */
export declare const SEAT_ROSTER: ReadonlyArray<{
    seat_id: SeatId;
    display_name: string;
    lenses: readonly string[];
}>;
/** Mandatory label on every advisor profile (Section 8 source honesty). */
export declare function advisorProfileLabel(displayName: string): string;
export declare const SESSION_MODES: readonly ["full", "selected", "quick", "consult", "light", "medium", "heavy"];
export type SessionMode = (typeof SESSION_MODES)[number];
export declare const SESSION_VISIBILITIES: readonly ["private", "company"];
export type SessionVisibility = (typeof SESSION_VISIBILITIES)[number];
/**
 * Canonical session states (Sections 15.1 and 11.7). CONSULTING is a real
 * state on the consult branch. Archive is NOT a state: it is a separate
 * visibility flag on the session record.
 */
export declare const SESSION_STATES: readonly ["DRAFT", "READY", "QUEUED", "PREPARING", "ROUND_1", "CRUX_REVIEW", "ROUND_2", "DRAFT_RESOLUTION", "ROUND_3", "CONSULTING", "VERIFYING", "COMPLETED", "PAUSE_REQUESTED", "PAUSED", "CANCEL_REQUESTED", "CANCELLED", "BLOCKED", "RESUMING", "FAILED"];
export type SessionState = (typeof SESSION_STATES)[number];
export declare const TERMINAL_STATES: ReadonlySet<SessionState>;
export declare const OPTION_KINDS: readonly ["status_quo", "bounded_test", "change", "other"];
export type OptionKind = (typeof OPTION_KINDS)[number];
export declare const STANCES: readonly ["support", "conditional", "oppose", "abstain"];
export type Stance = (typeof STANCES)[number];
/** Round 3 judgment about the exact draft resolution; distinct from stance. */
export declare const RESOLUTION_STANCES: readonly ["support", "conditional_support", "oppose", "abstain"];
export type ResolutionStance = (typeof RESOLUTION_STANCES)[number];
export declare const EVIDENCE_STRENGTHS: readonly ["low", "medium", "high"];
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];
export declare const ATTRIBUTION_KINDS: readonly ["source_principle", "blackceo_adaptation"];
export type AttributionKind = (typeof ATTRIBUTION_KINDS)[number];
export declare const CARD_KINDS: readonly ["advisor", "ratification", "consult"];
export type CardKind = (typeof CARD_KINDS)[number];
export declare const CONDITION_KINDS: readonly ["evidence_required", "external_action", "prerequisite", "safeguard"];
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export declare const CONDITION_STATUSES: readonly ["open", "satisfied", "waived_by_owner", "unresolved"];
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];
export declare const RISK_CLASSES: readonly ["low", "medium", "high", "critical"];
export type RiskClass = (typeof RISK_CLASSES)[number];
/** Verdict labels (Section 12.4). */
export declare const VERDICT_LABELS: readonly ["GO", "GO_WITH_CONDITIONS", "RESHAPE", "DONT_DO_IT", "WAIT", "INSUFFICIENT_EVIDENCE"];
export type VerdictLabel = (typeof VERDICT_LABELS)[number];
export declare const VALIDATION_STATUSES: readonly ["pending", "valid", "invalid"];
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];
export declare const RATIFICATION_STATUSES: readonly ["not_required", "pending", "ratified", "not_run_by_quick_mode_policy", "material_change_unratified", "rejected"];
export type RatificationStatus = (typeof RATIFICATION_STATUSES)[number];
export declare const CONSTRAINT_RESULTS: readonly ["pass", "fail", "unknown"];
export type ConstraintResult = (typeof CONSTRAINT_RESULTS)[number];
/** Critical domains (Section 12.7), frozen before scoring. */
export declare const CRITICAL_DOMAINS: readonly ["financial_feasibility", "demand_and_delivery", "purpose_and_commitments", "trust_and_stakeholders", "communication", "qualified_professional_review"];
export type CriticalDomain = (typeof CRITICAL_DOMAINS)[number];
export declare const CRITICAL_DOMAIN_STATUSES: readonly ["assessed", "not_assessed", "unresolved"];
export type CriticalDomainStatus = (typeof CRITICAL_DOMAIN_STATUSES)[number];
export declare const AMENDMENT_MATERIALITIES: readonly ["material", "nonmaterial"];
export type AmendmentMateriality = (typeof AMENDMENT_MATERIALITIES)[number];
export declare const AMENDMENT_DISPOSITIONS: readonly ["proposed", "accepted", "rejected"];
export type AmendmentDisposition = (typeof AMENDMENT_DISPOSITIONS)[number];
/** The four authorizations stay separate at all times (Section 1). */
export declare const AUTHORIZATION_KINDS: readonly ["build", "council_run", "action_plan_approval", "execution"];
export type AuthorizationKind = (typeof AUTHORIZATION_KINDS)[number];
export declare const RUN_GRANT_AUTHORITY_MODES: readonly ["managed_principal", "local_interactive_owner", "existing_standing_grant"];
export type RunGrantAuthorityMode = (typeof RUN_GRANT_AUTHORITY_MODES)[number];
export declare const RUN_PURPOSES: readonly ["council_run", "capability_probe", "intake_refinement", "follow_up"];
export type RunPurpose = (typeof RUN_PURPOSES)[number];
export declare const GRANT_STATUSES: readonly ["active", "expired", "revoked", "exhausted"];
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export declare const OPERATION_STATUSES: readonly ["reserved", "dispatched", "accepted", "provider_completion_unknown", "failed", "cancelled"];
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export declare const EXECUTION_POLICIES: readonly ["advisory_only"];
export type ExecutionPolicy = (typeof EXECUTION_POLICIES)[number];
export declare const MODEL_SELECTION_SOURCES: readonly ["explicit", "client_default", "route_default"];
export type ModelSelectionSource = (typeof MODEL_SELECTION_SOURCES)[number];
export declare const FALLBACK_POLICIES: readonly ["none", "client_approved_only"];
export type FallbackPolicy = (typeof FALLBACK_POLICIES)[number];
export declare const EVENT_TYPES: readonly ["session_created", "session_state_changed", "brief_revised", "card_accepted", "crux_identified", "resolution_drafted", "verdict_validated", "grant_issued", "grant_revoked", "operation_reserved", "operation_completed", "session_paused", "session_cancelled", "session_blocked", "session_failed"];
export type CouncilEventType = (typeof EVENT_TYPES)[number];
