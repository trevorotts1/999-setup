/**
 * Canonical enums for the Council of Wise Elders contracts (CWE-003).
 *
 * Unknown enum values are rejected at every boundary. These lists are the
 * single source from which the zod schemas, JSON Schema artifacts, and
 * TypeScript consumer types are all generated, so consumers cannot drift.
 */
/** The nine fixed council seats, in approved roster order (Section 7). */
export const SEAT_IDS = [
    'simon-sinek',
    'td-jakes',
    'oprah-winfrey',
    'tiffany-aliche',
    'russell-brunson',
    'michelle-obama',
    'brene-brown',
    'dennis-kimbro',
    'les-brown',
];
/**
 * Display roster. T. D. Jakes is ONE seat with three book lenses, never three
 * votes (Section 7). The label for Brené Brown preserves the accented
 * spelling in data.
 */
export const SEAT_ROSTER = [
    { seat_id: 'simon-sinek', display_name: 'Simon Sinek', lenses: [] },
    {
        seat_id: 'td-jakes',
        display_name: 'T. D. Jakes',
        lenses: ['instinct', 'disruptive-thinking', 'dont-drop-the-mic'],
    },
    { seat_id: 'oprah-winfrey', display_name: 'Oprah Winfrey', lenses: [] },
    { seat_id: 'tiffany-aliche', display_name: 'Tiffany Aliche', lenses: [] },
    { seat_id: 'russell-brunson', display_name: 'Russell Brunson', lenses: [] },
    { seat_id: 'michelle-obama', display_name: 'Michelle Obama', lenses: [] },
    { seat_id: 'brene-brown', display_name: 'Brené Brown', lenses: [] },
    { seat_id: 'dennis-kimbro', display_name: 'Dr. Dennis Kimbro', lenses: [] },
    { seat_id: 'les-brown', display_name: 'Les Brown', lenses: [] },
];
/** Mandatory label on every advisor profile (Section 8 source honesty). */
export function advisorProfileLabel(displayName) {
    return `AI perspective inspired by the published work of ${displayName}. Not the individual and not an endorsement.`;
}
export const SESSION_MODES = [
    'full',
    'selected',
    'quick',
    'consult',
    'light',
    'medium',
    'heavy',
];
export const SESSION_VISIBILITIES = ['private', 'company'];
/**
 * Canonical session states (Sections 15.1 and 11.7). CONSULTING is a real
 * state on the consult branch. Archive is NOT a state: it is a separate
 * visibility flag on the session record.
 */
export const SESSION_STATES = [
    'DRAFT',
    'READY',
    'QUEUED',
    'PREPARING',
    'ROUND_1',
    'CRUX_REVIEW',
    'ROUND_2',
    'DRAFT_RESOLUTION',
    'ROUND_3',
    'CONSULTING',
    'VERIFYING',
    'COMPLETED',
    'PAUSE_REQUESTED',
    'PAUSED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'BLOCKED',
    'RESUMING',
    'FAILED',
];
export const TERMINAL_STATES = new Set([
    'COMPLETED',
    'CANCELLED',
    'FAILED',
]);
export const OPTION_KINDS = ['status_quo', 'bounded_test', 'change', 'other'];
export const STANCES = ['support', 'conditional', 'oppose', 'abstain'];
/** Round 3 judgment about the exact draft resolution; distinct from stance. */
export const RESOLUTION_STANCES = [
    'support',
    'conditional_support',
    'oppose',
    'abstain',
];
export const EVIDENCE_STRENGTHS = ['low', 'medium', 'high'];
export const ATTRIBUTION_KINDS = ['source_principle', 'blackceo_adaptation'];
export const CARD_KINDS = ['advisor', 'ratification', 'consult'];
export const CONDITION_KINDS = [
    'evidence_required',
    'external_action',
    'prerequisite',
    'safeguard',
];
export const CONDITION_STATUSES = [
    'open',
    'satisfied',
    'waived_by_owner',
    'unresolved',
];
export const RISK_CLASSES = ['low', 'medium', 'high', 'critical'];
/** Verdict labels (Section 12.4). */
export const VERDICT_LABELS = [
    'GO',
    'GO_WITH_CONDITIONS',
    'RESHAPE',
    'DONT_DO_IT',
    'WAIT',
    'INSUFFICIENT_EVIDENCE',
];
export const VALIDATION_STATUSES = ['pending', 'valid', 'invalid'];
export const RATIFICATION_STATUSES = [
    'not_required',
    'pending',
    'ratified',
    'not_run_by_quick_mode_policy',
    'material_change_unratified',
    'rejected',
];
export const CONSTRAINT_RESULTS = ['pass', 'fail', 'unknown'];
/** Critical domains (Section 12.7), frozen before scoring. */
export const CRITICAL_DOMAINS = [
    'financial_feasibility',
    'demand_and_delivery',
    'purpose_and_commitments',
    'trust_and_stakeholders',
    'communication',
    'qualified_professional_review',
];
export const CRITICAL_DOMAIN_STATUSES = [
    'assessed',
    'not_assessed',
    'unresolved',
];
export const AMENDMENT_MATERIALITIES = ['material', 'nonmaterial'];
export const AMENDMENT_DISPOSITIONS = [
    'proposed',
    'accepted',
    'rejected',
];
/** The four authorizations stay separate at all times (Section 1). */
export const AUTHORIZATION_KINDS = [
    'build',
    'council_run',
    'action_plan_approval',
    'execution',
];
export const RUN_GRANT_AUTHORITY_MODES = [
    'managed_principal',
    'local_interactive_owner',
    'existing_standing_grant',
];
export const RUN_PURPOSES = [
    'council_run',
    'capability_probe',
    'intake_refinement',
    'follow_up',
];
export const GRANT_STATUSES = [
    'active',
    'expired',
    'revoked',
    'exhausted',
];
export const OPERATION_STATUSES = [
    'reserved',
    'dispatched',
    'accepted',
    'provider_completion_unknown',
    'failed',
    'cancelled',
];
export const EXECUTION_POLICIES = ['advisory_only'];
export const MODEL_SELECTION_SOURCES = [
    'explicit',
    'client_default',
    'route_default',
];
export const FALLBACK_POLICIES = ['none', 'client_approved_only'];
export const EVENT_TYPES = [
    'session_created',
    'session_state_changed',
    'brief_revised',
    'card_accepted',
    'crux_identified',
    'resolution_drafted',
    'verdict_validated',
    'grant_issued',
    'grant_revoked',
    'operation_reserved',
    'operation_completed',
    'session_paused',
    'session_cancelled',
    'session_blocked',
    'session_failed',
];
