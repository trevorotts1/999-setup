/**
 * Canonical contract schemas for @blackceo/wise-elders-core (CWE-003).
 *
 * This module is the single schema source for the Council of Wise Elders
 * contracts (directive Sections 11, 12.7, 15, 16.6, 17, 25.6). JSON Schema
 * artifacts and TypeScript consumer types are generated from these exact
 * definitions (see generate.ts, generated/, and types.ts); drift between
 * them is a test failure, not a review comment.
 *
 * Boundary rules enforced here:
 * - strict objects: unknown fields are rejected, never silently dropped;
 * - unknown enum values and invalid IDs fail validation;
 * - unknown values are null, never empty strings masquerading as facts;
 * - author-created values are separate from trusted host-filled identity
 *   and accounting fields: an author payload that tries to carry tenant,
 *   verified-source status, grant, operation ID, or permission fields is
 *   rejected, because those exist only inside the host stamp.
 */
import { z } from 'zod';
import type { ValidationResult } from './errors.js';
/** Current canonical contract version for this package surface. */
export declare const CONTRACT_PACKAGE_VERSION = "wise-elders.core/1.0.0";
/** Schema version stamps carried by individual contract payloads. */
export declare const SCHEMA_VERSIONS: {
    readonly session: "wise-elders.session/v1";
    readonly brief: "wise-elders.brief/v1";
    readonly card: "wise-elders.card/v1";
    readonly verdict: "wise-elders.verdict/v1";
    readonly grant: "wise-elders.run-grant/v1";
    readonly preview: "wise-elders.run-preview/v1";
    readonly event: "wise-elders.event/v1";
    readonly diagnosticPolicy: "wise-elders.diagnostic-retention-policy/v1";
    readonly endpoint: "wise-elders.endpoint-contract/v1";
};
export declare const idSchema: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
export declare const sha256Schema: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
export declare const utcTimestampSchema: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
export declare const moneySchema: z.ZodObject<{
    amount_minor: z.ZodNumber;
    currency: z.ZodString;
}, z.core.$strict>;
/** A score is 0..10 or null (abstention). NaN can never reach validation. */
export declare const scoreSchema: z.ZodNullable<z.ZodNumber>;
export declare const seatIdSchema: z.ZodEnum<{
    "simon-sinek": "simon-sinek";
    "td-jakes": "td-jakes";
    "oprah-winfrey": "oprah-winfrey";
    "tiffany-aliche": "tiffany-aliche";
    "russell-brunson": "russell-brunson";
    "michelle-obama": "michelle-obama";
    "brene-brown": "brene-brown";
    "dennis-kimbro": "dennis-kimbro";
    "les-brown": "les-brown";
}>;
export declare const sessionStateSchema: z.ZodEnum<{
    DRAFT: "DRAFT";
    READY: "READY";
    QUEUED: "QUEUED";
    PREPARING: "PREPARING";
    ROUND_1: "ROUND_1";
    CRUX_REVIEW: "CRUX_REVIEW";
    ROUND_2: "ROUND_2";
    DRAFT_RESOLUTION: "DRAFT_RESOLUTION";
    ROUND_3: "ROUND_3";
    CONSULTING: "CONSULTING";
    VERIFYING: "VERIFYING";
    COMPLETED: "COMPLETED";
    PAUSE_REQUESTED: "PAUSE_REQUESTED";
    PAUSED: "PAUSED";
    CANCEL_REQUESTED: "CANCEL_REQUESTED";
    CANCELLED: "CANCELLED";
    BLOCKED: "BLOCKED";
    RESUMING: "RESUMING";
    FAILED: "FAILED";
}>;
/**
 * Trusted scope binding. For private sessions owner_subject is required;
 * that rule is enforced by the refinements on scoped contracts below.
 * A caller never gains authority by supplying these fields (Section 11.1);
 * they are host-filled and authorization is checked before content loads.
 */
export declare const scopeFieldsSchema: z.ZodObject<{
    tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type ScopeFields = z.infer<typeof scopeFieldsSchema>;
/**
 * Trusted host stamp. Only the host fills this: tenant scope, operation
 * identity, route, and verified-source status live here and nowhere else.
 */
export declare const hostStampSchema: z.ZodObject<{
    scope: z.ZodObject<{
        tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>;
    operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    source_status: z.ZodEnum<{
        verified: "verified";
        unverified: "unverified";
        not_applicable: "not_applicable";
    }>;
}, z.core.$strict>;
export type HostStamp = z.infer<typeof hostStampSchema>;
/** Field names an author payload may never carry (host-filled only). */
export declare const HOST_ONLY_FIELDS: ReadonlySet<string>;
export declare const decisionOptionSchema: z.ZodObject<{
    id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    label: z.ZodString;
    kind: z.ZodEnum<{
        status_quo: "status_quo";
        bounded_test: "bounded_test";
        change: "change";
        other: "other";
    }>;
}, z.core.$strict>;
export type DecisionOption = z.infer<typeof decisionOptionSchema>;
export declare const typedFactSchema: z.ZodObject<{
    id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    statement: z.ZodString;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type TypedFact = z.infer<typeof typedFactSchema>;
export declare const evidenceManifestEntrySchema: z.ZodObject<{
    evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    source_kind: z.ZodEnum<{
        other: "other";
        book: "book";
        article: "article";
        transcript: "transcript";
        client_document: "client_document";
    }>;
    locator: z.ZodString;
}, z.core.$strict>;
export type EvidenceManifestEntry = z.infer<typeof evidenceManifestEntrySchema>;
export declare const criticalDomainRequirementSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.critical-domain-requirement/v1">;
    domain: z.ZodEnum<{
        financial_feasibility: "financial_feasibility";
        demand_and_delivery: "demand_and_delivery";
        purpose_and_commitments: "purpose_and_commitments";
        trust_and_stakeholders: "trust_and_stakeholders";
        communication: "communication";
        qualified_professional_review: "qualified_professional_review";
    }>;
    status: z.ZodEnum<{
        unresolved: "unresolved";
        assessed: "assessed";
        not_assessed: "not_assessed";
    }>;
    trigger_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    trigger_field_paths: z.ZodArray<z.ZodString>;
    required_seat_id: z.ZodNullable<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>>;
    required_checker: z.ZodEnum<{
        seat: "seat";
        deterministic_code: "deterministic_code";
        qualified_professional: "qualified_professional";
    }>;
    unresolved_questions: z.ZodArray<z.ZodString>;
    policy_version: z.ZodString;
}, z.core.$strict>;
export type CriticalDomainRequirement = z.infer<typeof criticalDomainRequirementSchema>;
export declare const decisionBriefSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.brief/v1">;
    brief_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    revision: z.ZodNumber;
    question: z.ZodString;
    facts: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        statement: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    assumptions: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        statement: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    unknowns: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        statement: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    constraints: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        description: z.ZodString;
        hard: z.ZodBoolean;
        applies_to_option_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    options: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        label: z.ZodString;
        kind: z.ZodEnum<{
            status_quo: "status_quo";
            bounded_test: "bounded_test";
            change: "change";
            other: "other";
        }>;
    }, z.core.$strict>>;
    relevance_weights: z.ZodRecord<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }> & z.core.$partial, z.ZodNumber>;
    critical_domains: z.ZodArray<z.ZodObject<{
        schema_version: z.ZodLiteral<"wise-elders.critical-domain-requirement/v1">;
        domain: z.ZodEnum<{
            financial_feasibility: "financial_feasibility";
            demand_and_delivery: "demand_and_delivery";
            purpose_and_commitments: "purpose_and_commitments";
            trust_and_stakeholders: "trust_and_stakeholders";
            communication: "communication";
            qualified_professional_review: "qualified_professional_review";
        }>;
        status: z.ZodEnum<{
            unresolved: "unresolved";
            assessed: "assessed";
            not_assessed: "not_assessed";
        }>;
        trigger_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        trigger_field_paths: z.ZodArray<z.ZodString>;
        required_seat_id: z.ZodNullable<z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>>;
        required_checker: z.ZodEnum<{
            seat: "seat";
            deterministic_code: "deterministic_code";
            qualified_professional: "qualified_professional";
        }>;
        unresolved_questions: z.ZodArray<z.ZodString>;
        policy_version: z.ZodString;
    }, z.core.$strict>>;
    evidence_manifest: z.ZodArray<z.ZodObject<{
        evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_kind: z.ZodEnum<{
            other: "other";
            book: "book";
            article: "article";
            transcript: "transcript";
            client_document: "client_document";
        }>;
        locator: z.ZodString;
    }, z.core.$strict>>;
    private_preference_ref: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    created_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    display_timezone: z.ZodString;
}, z.core.$strict>;
export type DecisionBrief = z.infer<typeof decisionBriefSchema>;
export declare const modelPolicySchema: z.ZodObject<{
    selection: z.ZodEnum<{
        explicit: "explicit";
        client_default: "client_default";
        route_default: "route_default";
    }>;
    route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    requested_model_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    reasoning_preference: z.ZodNullable<z.ZodString>;
    fallback_policy: z.ZodEnum<{
        none: "none";
        client_approved_only: "client_approved_only";
    }>;
}, z.core.$strict>;
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export declare const sessionSpecSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.session/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    mode: z.ZodEnum<{
        full: "full";
        selected: "selected";
        quick: "quick";
        consult: "consult";
        light: "light";
        medium: "medium";
        heavy: "heavy";
    }>;
    visibility: z.ZodEnum<{
        private: "private";
        company: "company";
    }>;
    brief_revision: z.ZodNumber;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    options: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        label: z.ZodString;
        kind: z.ZodEnum<{
            status_quo: "status_quo";
            bounded_test: "bounded_test";
            change: "change";
            other: "other";
        }>;
    }, z.core.$strict>>;
    seat_ids: z.ZodArray<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>>;
    model_policy: z.ZodObject<{
        selection: z.ZodEnum<{
            explicit: "explicit";
            client_default: "client_default";
            route_default: "route_default";
        }>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        requested_model_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        reasoning_preference: z.ZodNullable<z.ZodString>;
        fallback_policy: z.ZodEnum<{
            none: "none";
            client_approved_only: "client_approved_only";
        }>;
    }, z.core.$strict>;
    source_pack_version: z.ZodString;
    execution_policy: z.ZodEnum<{
        advisory_only: "advisory_only";
    }>;
    created_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    display_timezone: z.ZodString;
}, z.core.$strict>;
export type SessionSpec = z.infer<typeof sessionSpecSchema>;
export declare const conditionSchema: z.ZodObject<{
    id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    description: z.ZodString;
    kind: z.ZodEnum<{
        evidence_required: "evidence_required";
        external_action: "external_action";
        prerequisite: "prerequisite";
        safeguard: "safeguard";
    }>;
    blocking: z.ZodBoolean;
    verification_method: z.ZodString;
    required_evidence: z.ZodArray<z.ZodString>;
    responsible_role: z.ZodString;
    due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    status: z.ZodEnum<{
        open: "open";
        satisfied: "satisfied";
        waived_by_owner: "waived_by_owner";
        unresolved: "unresolved";
    }>;
    depends_on: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type Condition = z.infer<typeof conditionSchema>;
export declare const actionProposalSchema: z.ZodObject<{
    action_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    verdict_revision: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodString;
    rationale: z.ZodString;
    source_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    department_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    assigned_agent_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    sop_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    persona_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    acceptance_criteria: z.ZodArray<z.ZodString>;
    budget_limit: z.ZodNullable<z.ZodObject<{
        amount_minor: z.ZodNumber;
        currency: z.ZodString;
    }, z.core.$strict>>;
    due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    depends_on_action_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    risk_class: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
        critical: "critical";
    }>;
    execution_authorization_required: z.ZodLiteral<true>;
}, z.core.$strict>;
export type ActionProposal = z.infer<typeof actionProposalSchema>;
export declare const optionScoreSchema: z.ZodObject<{
    option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    score: z.ZodNullable<z.ZodNumber>;
    rationale: z.ZodString;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type OptionScore = z.infer<typeof optionScoreSchema>;
export declare const frameworkApplicationSchema: z.ZodObject<{
    framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    application: z.ZodString;
    attribution_kind: z.ZodEnum<{
        source_principle: "source_principle";
        blackceo_adaptation: "blackceo_adaptation";
    }>;
}, z.core.$strict>;
export type FrameworkApplication = z.infer<typeof frameworkApplicationSchema>;
export declare const verifiedQuoteCandidateSchema: z.ZodObject<{
    quote_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    text: z.ZodString;
    evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    locator: z.ZodString;
    verification_status: z.ZodEnum<{
        rejected: "rejected";
        verified: "verified";
        candidate: "candidate";
    }>;
}, z.core.$strict>;
export type VerifiedQuoteCandidate = z.infer<typeof verifiedQuoteCandidateSchema>;
export declare const advisorCardAuthorSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"advisor">;
    round: z.ZodNumber;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    decisive_arguments: z.ZodArray<z.ZodString>;
    strongest_objection: z.ZodString;
    conditions: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        description: z.ZodString;
        kind: z.ZodEnum<{
            evidence_required: "evidence_required";
            external_action: "external_action";
            prerequisite: "prerequisite";
            safeguard: "safeguard";
        }>;
        blocking: z.ZodBoolean;
        verification_method: z.ZodString;
        required_evidence: z.ZodArray<z.ZodString>;
        responsible_role: z.ZodString;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        status: z.ZodEnum<{
            open: "open";
            satisfied: "satisfied";
            waived_by_owner: "waived_by_owner";
            unresolved: "unresolved";
        }>;
        depends_on: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    change_my_mind: z.ZodString;
    challenges_answered: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    lenses_used: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quotes: z.ZodArray<z.ZodObject<{
        quote_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        text: z.ZodString;
        evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        locator: z.ZodString;
        verification_status: z.ZodEnum<{
            rejected: "rejected";
            verified: "verified";
            candidate: "candidate";
        }>;
    }, z.core.$strict>>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    minority_position: z.ZodNullable<z.ZodString>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>;
export type AdvisorCardAuthor = z.infer<typeof advisorCardAuthorSchema>;
export declare const amendmentSchema: z.ZodObject<{
    amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    proposing_seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    target_path: z.ZodString;
    old_value: z.ZodNullable<z.ZodString>;
    new_value: z.ZodNullable<z.ZodString>;
    statement: z.ZodString;
    reason: z.ZodString;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    materiality: z.ZodEnum<{
        material: "material";
        nonmaterial: "nonmaterial";
    }>;
    disposition: z.ZodEnum<{
        rejected: "rejected";
        proposed: "proposed";
        accepted: "accepted";
    }>;
    reviewer_reason: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type Amendment = z.infer<typeof amendmentSchema>;
export declare const ratificationCardAuthorSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"ratification">;
    round: z.ZodLiteral<3>;
    draft_resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    resolution_stance: z.ZodEnum<{
        support: "support";
        oppose: "oppose";
        abstain: "abstain";
        conditional_support: "conditional_support";
    }>;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    accepted_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    unresolved_objections: z.ZodArray<z.ZodString>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>;
export type RatificationCardAuthor = z.infer<typeof ratificationCardAuthorSchema>;
export declare const consultCardAuthorSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"consult">;
    answer: z.ZodString;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    assumptions: z.ZodArray<z.ZodString>;
    limits: z.ZodArray<z.ZodString>;
    next_step: z.ZodString;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>;
export type ConsultCardAuthor = z.infer<typeof consultCardAuthorSchema>;
/** Author-created card payloads. Carries NO host identity fields. */
export declare const cardAuthorSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    card_kind: z.ZodLiteral<"advisor">;
    round: z.ZodNumber;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    decisive_arguments: z.ZodArray<z.ZodString>;
    strongest_objection: z.ZodString;
    conditions: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        description: z.ZodString;
        kind: z.ZodEnum<{
            evidence_required: "evidence_required";
            external_action: "external_action";
            prerequisite: "prerequisite";
            safeguard: "safeguard";
        }>;
        blocking: z.ZodBoolean;
        verification_method: z.ZodString;
        required_evidence: z.ZodArray<z.ZodString>;
        responsible_role: z.ZodString;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        status: z.ZodEnum<{
            open: "open";
            satisfied: "satisfied";
            waived_by_owner: "waived_by_owner";
            unresolved: "unresolved";
        }>;
        depends_on: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    change_my_mind: z.ZodString;
    challenges_answered: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    lenses_used: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quotes: z.ZodArray<z.ZodObject<{
        quote_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        text: z.ZodString;
        evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        locator: z.ZodString;
        verification_status: z.ZodEnum<{
            rejected: "rejected";
            verified: "verified";
            candidate: "candidate";
        }>;
    }, z.core.$strict>>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    minority_position: z.ZodNullable<z.ZodString>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    card_kind: z.ZodLiteral<"ratification">;
    round: z.ZodLiteral<3>;
    draft_resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    resolution_stance: z.ZodEnum<{
        support: "support";
        oppose: "oppose";
        abstain: "abstain";
        conditional_support: "conditional_support";
    }>;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    accepted_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    unresolved_objections: z.ZodArray<z.ZodString>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    card_kind: z.ZodLiteral<"consult">;
    answer: z.ZodString;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    assumptions: z.ZodArray<z.ZodString>;
    limits: z.ZodArray<z.ZodString>;
    next_step: z.ZodString;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
}, z.core.$strict>], "card_kind">;
export type CardAuthor = z.infer<typeof cardAuthorSchema>;
/** A persisted card: the author payload plus the trusted host stamp. */
export declare const advisorCardSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"advisor">;
    round: z.ZodNumber;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    decisive_arguments: z.ZodArray<z.ZodString>;
    strongest_objection: z.ZodString;
    conditions: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        description: z.ZodString;
        kind: z.ZodEnum<{
            evidence_required: "evidence_required";
            external_action: "external_action";
            prerequisite: "prerequisite";
            safeguard: "safeguard";
        }>;
        blocking: z.ZodBoolean;
        verification_method: z.ZodString;
        required_evidence: z.ZodArray<z.ZodString>;
        responsible_role: z.ZodString;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        status: z.ZodEnum<{
            open: "open";
            satisfied: "satisfied";
            waived_by_owner: "waived_by_owner";
            unresolved: "unresolved";
        }>;
        depends_on: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    change_my_mind: z.ZodString;
    challenges_answered: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    lenses_used: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quotes: z.ZodArray<z.ZodObject<{
        quote_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        text: z.ZodString;
        evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        locator: z.ZodString;
        verification_status: z.ZodEnum<{
            rejected: "rejected";
            verified: "verified";
            candidate: "candidate";
        }>;
    }, z.core.$strict>>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    minority_position: z.ZodNullable<z.ZodString>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ratificationCardSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"ratification">;
    round: z.ZodLiteral<3>;
    draft_resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    resolution_stance: z.ZodEnum<{
        support: "support";
        oppose: "oppose";
        abstain: "abstain";
        conditional_support: "conditional_support";
    }>;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    accepted_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    unresolved_objections: z.ZodArray<z.ZodString>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const consultCardSchema: z.ZodObject<{
    card_kind: z.ZodLiteral<"consult">;
    answer: z.ZodString;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    assumptions: z.ZodArray<z.ZodString>;
    limits: z.ZodArray<z.ZodString>;
    next_step: z.ZodString;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const cardSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    card_kind: z.ZodLiteral<"advisor">;
    round: z.ZodNumber;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    decisive_arguments: z.ZodArray<z.ZodString>;
    strongest_objection: z.ZodString;
    conditions: z.ZodArray<z.ZodObject<{
        id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        description: z.ZodString;
        kind: z.ZodEnum<{
            evidence_required: "evidence_required";
            external_action: "external_action";
            prerequisite: "prerequisite";
            safeguard: "safeguard";
        }>;
        blocking: z.ZodBoolean;
        verification_method: z.ZodString;
        required_evidence: z.ZodArray<z.ZodString>;
        responsible_role: z.ZodString;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        status: z.ZodEnum<{
            open: "open";
            satisfied: "satisfied";
            waived_by_owner: "waived_by_owner";
            unresolved: "unresolved";
        }>;
        depends_on: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    change_my_mind: z.ZodString;
    challenges_answered: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    lenses_used: z.ZodOptional<z.ZodArray<z.ZodString>>;
    quotes: z.ZodArray<z.ZodObject<{
        quote_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        text: z.ZodString;
        evidence_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        locator: z.ZodString;
        verification_status: z.ZodEnum<{
            rejected: "rejected";
            verified: "verified";
            candidate: "candidate";
        }>;
    }, z.core.$strict>>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    minority_position: z.ZodNullable<z.ZodString>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    card_kind: z.ZodLiteral<"ratification">;
    round: z.ZodLiteral<3>;
    draft_resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    resolution_stance: z.ZodEnum<{
        support: "support";
        oppose: "oppose";
        abstain: "abstain";
        conditional_support: "conditional_support";
    }>;
    stance: z.ZodEnum<{
        support: "support";
        conditional: "conditional";
        oppose: "oppose";
        abstain: "abstain";
    }>;
    preferred_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        rationale: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    accepted_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    unresolved_objections: z.ZodArray<z.ZodString>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    card_kind: z.ZodLiteral<"consult">;
    answer: z.ZodString;
    framework_applications: z.ZodArray<z.ZodObject<{
        framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        application: z.ZodString;
        attribution_kind: z.ZodEnum<{
            source_principle: "source_principle";
            blackceo_adaptation: "blackceo_adaptation";
        }>;
    }, z.core.$strict>>;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    assumptions: z.ZodArray<z.ZodString>;
    limits: z.ZodArray<z.ZodString>;
    next_step: z.ZodString;
    schema_version: z.ZodLiteral<"wise-elders.card/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    seat_id: z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>;
    input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    host: z.ZodObject<{
        scope: z.ZodObject<{
            tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        }, z.core.$strict>;
        operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        source_status: z.ZodEnum<{
            verified: "verified";
            unverified: "unverified";
            not_applicable: "not_applicable";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>], "card_kind">;
export type AdvisorCard = z.infer<typeof advisorCardSchema>;
export type RatificationCard = z.infer<typeof ratificationCardSchema>;
export type ConsultCard = z.infer<typeof consultCardSchema>;
export type CouncilCard = z.infer<typeof cardSchema>;
export declare const CARD_KIND_VALUES: readonly ["advisor", "ratification", "consult"];
export declare const draftResolutionSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.draft-resolution/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    revision: z.ZodNumber;
    recommended_option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    actions: z.ZodArray<z.ZodString>;
    prerequisites: z.ZodArray<z.ZodString>;
    limits: z.ZodArray<z.ZodString>;
    semantic_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type DraftResolution = z.infer<typeof draftResolutionSchema>;
/**
 * Weighted support counts keyed to one exact resolution hash (Section 11.6).
 * These are counts, never a probability, and are never inferred from scores.
 */
export declare const resolutionSupportSchema: z.ZodObject<{
    resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    support: z.ZodNumber;
    conditional_support: z.ZodNumber;
    opposition: z.ZodNumber;
    abstention: z.ZodNumber;
}, z.core.$strict>;
export type ResolutionSupport = z.infer<typeof resolutionSupportSchema>;
export declare const hardConstraintFindingSchema: z.ZodObject<{
    constraint_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    result: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        unknown: "unknown";
    }>;
    checker: z.ZodEnum<{
        seat: "seat";
        deterministic_code: "deterministic_code";
        qualified_professional: "qualified_professional";
    }>;
    evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type HardConstraintFinding = z.infer<typeof hardConstraintFindingSchema>;
export declare const optionScoreSummarySchema: z.ZodObject<{
    option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    score: z.ZodNullable<z.ZodNumber>;
    display_score: z.ZodNullable<z.ZodNumber>;
    weighted_sum: z.ZodNumber;
    denominator: z.ZodNumber;
    coverage: z.ZodNumber;
    spread: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export type OptionScoreSummary = z.infer<typeof optionScoreSummarySchema>;
export declare const scoredVerdictSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.verdict/v1">;
    result_kind: z.ZodLiteral<"scored">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    verdict_revision: z.ZodNumber;
    recommended_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    label: z.ZodEnum<{
        GO: "GO";
        GO_WITH_CONDITIONS: "GO_WITH_CONDITIONS";
        RESHAPE: "RESHAPE";
        DONT_DO_IT: "DONT_DO_IT";
        WAIT: "WAIT";
        INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE";
    }>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        display_score: z.ZodNullable<z.ZodNumber>;
        weighted_sum: z.ZodNumber;
        denominator: z.ZodNumber;
        coverage: z.ZodNumber;
        spread: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    active_weights: z.ZodRecord<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }> & z.core.$partial, z.ZodNumber>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    hard_constraint_findings: z.ZodArray<z.ZodObject<{
        constraint_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        result: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            unknown: "unknown";
        }>;
        checker: z.ZodEnum<{
            seat: "seat";
            deterministic_code: "deterministic_code";
            qualified_professional: "qualified_professional";
        }>;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    main_reasons: z.ZodArray<z.ZodString>;
    strongest_dissent: z.ZodNullable<z.ZodString>;
    accepted_amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    rejected_amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    prerequisites: z.ZodArray<z.ZodString>;
    action_proposals: z.ZodArray<z.ZodObject<{
        action_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        verdict_revision: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
        rationale: z.ZodString;
        source_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        department_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        assigned_agent_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        sop_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        persona_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        acceptance_criteria: z.ZodArray<z.ZodString>;
        budget_limit: z.ZodNullable<z.ZodObject<{
            amount_minor: z.ZodNumber;
            currency: z.ZodString;
        }, z.core.$strict>>;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        depends_on_action_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        risk_class: z.ZodEnum<{
            medium: "medium";
            low: "low";
            high: "high";
            critical: "critical";
        }>;
        execution_authorization_required: z.ZodLiteral<true>;
    }, z.core.$strict>>;
    cheapest_informative_test: z.ZodNullable<z.ZodString>;
    stop_criteria: z.ZodArray<z.ZodString>;
    review_criteria: z.ZodArray<z.ZodString>;
    resolution_support: z.ZodNullable<z.ZodObject<{
        resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        support: z.ZodNumber;
        conditional_support: z.ZodNumber;
        opposition: z.ZodNumber;
        abstention: z.ZodNumber;
    }, z.core.$strict>>;
    validation_status: z.ZodEnum<{
        pending: "pending";
        valid: "valid";
        invalid: "invalid";
    }>;
    ratification_status: z.ZodEnum<{
        pending: "pending";
        not_required: "not_required";
        ratified: "ratified";
        not_run_by_quick_mode_policy: "not_run_by_quick_mode_policy";
        material_change_unratified: "material_change_unratified";
        rejected: "rejected";
    }>;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    content_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type ScoredVerdict = z.infer<typeof scoredVerdictSchema>;
/** Consult mode result: a discriminated result, no invented scores (11.5). */
export declare const consultResultSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.verdict/v1">;
    result_kind: z.ZodLiteral<"consult">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    verdict_revision: z.ZodNumber;
    consult_card: z.ZodObject<{
        card_kind: z.ZodLiteral<"consult">;
        answer: z.ZodString;
        framework_applications: z.ZodArray<z.ZodObject<{
            framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            application: z.ZodString;
            attribution_kind: z.ZodEnum<{
                source_principle: "source_principle";
                blackceo_adaptation: "blackceo_adaptation";
            }>;
        }, z.core.$strict>>;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        assumptions: z.ZodArray<z.ZodString>;
        limits: z.ZodArray<z.ZodString>;
        next_step: z.ZodString;
        schema_version: z.ZodLiteral<"wise-elders.card/v1">;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        brief_revision: z.ZodNumber;
        seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        pack_version: z.ZodString;
        host: z.ZodObject<{
            scope: z.ZodObject<{
                tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            }, z.core.$strict>;
            operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            source_status: z.ZodEnum<{
                verified: "verified";
                unverified: "unverified";
                not_applicable: "not_applicable";
            }>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    next_step: z.ZodString;
    validation_status: z.ZodEnum<{
        pending: "pending";
        valid: "valid";
        invalid: "invalid";
    }>;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    content_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type ConsultResult = z.infer<typeof consultResultSchema>;
export declare const verdictSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.verdict/v1">;
    result_kind: z.ZodLiteral<"scored">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    verdict_revision: z.ZodNumber;
    recommended_option_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    label: z.ZodEnum<{
        GO: "GO";
        GO_WITH_CONDITIONS: "GO_WITH_CONDITIONS";
        RESHAPE: "RESHAPE";
        DONT_DO_IT: "DONT_DO_IT";
        WAIT: "WAIT";
        INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE";
    }>;
    option_scores: z.ZodArray<z.ZodObject<{
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        score: z.ZodNullable<z.ZodNumber>;
        display_score: z.ZodNullable<z.ZodNumber>;
        weighted_sum: z.ZodNumber;
        denominator: z.ZodNumber;
        coverage: z.ZodNumber;
        spread: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>>;
    active_weights: z.ZodRecord<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }> & z.core.$partial, z.ZodNumber>;
    evidence_strength: z.ZodEnum<{
        medium: "medium";
        low: "low";
        high: "high";
    }>;
    hard_constraint_findings: z.ZodArray<z.ZodObject<{
        constraint_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        option_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        result: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            unknown: "unknown";
        }>;
        checker: z.ZodEnum<{
            seat: "seat";
            deterministic_code: "deterministic_code";
            qualified_professional: "qualified_professional";
        }>;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>>;
    main_reasons: z.ZodArray<z.ZodString>;
    strongest_dissent: z.ZodNullable<z.ZodString>;
    accepted_amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    rejected_amendments: z.ZodArray<z.ZodObject<{
        amendment_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        proposing_seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        target_path: z.ZodString;
        old_value: z.ZodNullable<z.ZodString>;
        new_value: z.ZodNullable<z.ZodString>;
        statement: z.ZodString;
        reason: z.ZodString;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        materiality: z.ZodEnum<{
            material: "material";
            nonmaterial: "nonmaterial";
        }>;
        disposition: z.ZodEnum<{
            rejected: "rejected";
            proposed: "proposed";
            accepted: "accepted";
        }>;
        reviewer_reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    critical_unknowns: z.ZodArray<z.ZodString>;
    prerequisites: z.ZodArray<z.ZodString>;
    action_proposals: z.ZodArray<z.ZodObject<{
        action_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        verdict_revision: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
        rationale: z.ZodString;
        source_condition_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        department_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        assigned_agent_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        sop_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        persona_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        acceptance_criteria: z.ZodArray<z.ZodString>;
        budget_limit: z.ZodNullable<z.ZodObject<{
            amount_minor: z.ZodNumber;
            currency: z.ZodString;
        }, z.core.$strict>>;
        due_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        depends_on_action_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        risk_class: z.ZodEnum<{
            medium: "medium";
            low: "low";
            high: "high";
            critical: "critical";
        }>;
        execution_authorization_required: z.ZodLiteral<true>;
    }, z.core.$strict>>;
    cheapest_informative_test: z.ZodNullable<z.ZodString>;
    stop_criteria: z.ZodArray<z.ZodString>;
    review_criteria: z.ZodArray<z.ZodString>;
    resolution_support: z.ZodNullable<z.ZodObject<{
        resolution_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        support: z.ZodNumber;
        conditional_support: z.ZodNumber;
        opposition: z.ZodNumber;
        abstention: z.ZodNumber;
    }, z.core.$strict>>;
    validation_status: z.ZodEnum<{
        pending: "pending";
        valid: "valid";
        invalid: "invalid";
    }>;
    ratification_status: z.ZodEnum<{
        pending: "pending";
        not_required: "not_required";
        ratified: "ratified";
        not_run_by_quick_mode_policy: "not_run_by_quick_mode_policy";
        material_change_unratified: "material_change_unratified";
        rejected: "rejected";
    }>;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    content_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>, z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.verdict/v1">;
    result_kind: z.ZodLiteral<"consult">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    verdict_revision: z.ZodNumber;
    consult_card: z.ZodObject<{
        card_kind: z.ZodLiteral<"consult">;
        answer: z.ZodString;
        framework_applications: z.ZodArray<z.ZodObject<{
            framework_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            source_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            case_evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            application: z.ZodString;
            attribution_kind: z.ZodEnum<{
                source_principle: "source_principle";
                blackceo_adaptation: "blackceo_adaptation";
            }>;
        }, z.core.$strict>>;
        evidence_ids: z.ZodArray<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        assumptions: z.ZodArray<z.ZodString>;
        limits: z.ZodArray<z.ZodString>;
        next_step: z.ZodString;
        schema_version: z.ZodLiteral<"wise-elders.card/v1">;
        session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        brief_revision: z.ZodNumber;
        seat_id: z.ZodEnum<{
            "simon-sinek": "simon-sinek";
            "td-jakes": "td-jakes";
            "oprah-winfrey": "oprah-winfrey";
            "tiffany-aliche": "tiffany-aliche";
            "russell-brunson": "russell-brunson";
            "michelle-obama": "michelle-obama";
            "brene-brown": "brene-brown";
            "dennis-kimbro": "dennis-kimbro";
            "les-brown": "les-brown";
        }>;
        input_manifest_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        pack_version: z.ZodString;
        host: z.ZodObject<{
            scope: z.ZodObject<{
                tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
                owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
            }, z.core.$strict>;
            operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            route_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            stamped_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
            source_status: z.ZodEnum<{
                verified: "verified";
                unverified: "unverified";
                not_applicable: "not_applicable";
            }>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    next_step: z.ZodString;
    validation_status: z.ZodEnum<{
        pending: "pending";
        valid: "valid";
        invalid: "invalid";
    }>;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    content_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>], "result_kind">;
export type Verdict = z.infer<typeof verdictSchema>;
export declare const sessionStateRecordSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.session-state/v1">;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    mode: z.ZodEnum<{
        full: "full";
        selected: "selected";
        quick: "quick";
        consult: "consult";
        light: "light";
        medium: "medium";
        heavy: "heavy";
    }>;
    state: z.ZodEnum<{
        DRAFT: "DRAFT";
        READY: "READY";
        QUEUED: "QUEUED";
        PREPARING: "PREPARING";
        ROUND_1: "ROUND_1";
        CRUX_REVIEW: "CRUX_REVIEW";
        ROUND_2: "ROUND_2";
        DRAFT_RESOLUTION: "DRAFT_RESOLUTION";
        ROUND_3: "ROUND_3";
        CONSULTING: "CONSULTING";
        VERIFYING: "VERIFYING";
        COMPLETED: "COMPLETED";
        PAUSE_REQUESTED: "PAUSE_REQUESTED";
        PAUSED: "PAUSED";
        CANCEL_REQUESTED: "CANCEL_REQUESTED";
        CANCELLED: "CANCELLED";
        BLOCKED: "BLOCKED";
        RESUMING: "RESUMING";
        FAILED: "FAILED";
    }>;
    state_version: z.ZodNumber;
    brief_revision: z.ZodNumber;
    resume_phase: z.ZodNullable<z.ZodEnum<{
        DRAFT: "DRAFT";
        READY: "READY";
        QUEUED: "QUEUED";
        PREPARING: "PREPARING";
        ROUND_1: "ROUND_1";
        CRUX_REVIEW: "CRUX_REVIEW";
        ROUND_2: "ROUND_2";
        DRAFT_RESOLUTION: "DRAFT_RESOLUTION";
        ROUND_3: "ROUND_3";
        CONSULTING: "CONSULTING";
        VERIFYING: "VERIFYING";
        COMPLETED: "COMPLETED";
        PAUSE_REQUESTED: "PAUSE_REQUESTED";
        PAUSED: "PAUSED";
        CANCEL_REQUESTED: "CANCEL_REQUESTED";
        CANCELLED: "CANCELLED";
        BLOCKED: "BLOCKED";
        RESUMING: "RESUMING";
        FAILED: "FAILED";
    }>>;
    cancel_generation: z.ZodNumber;
    revocation_generation: z.ZodNumber;
    attempt: z.ZodNumber;
    lease_epoch: z.ZodNumber;
    archived: z.ZodBoolean;
    updated_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type SessionStateRecord = z.infer<typeof sessionStateRecordSchema>;
export declare const jobCheckpointSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.job-checkpoint/v1">;
    installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    attempt: z.ZodNumber;
    brief_revision: z.ZodNumber;
    phase: z.ZodString;
    seat_id: z.ZodNullable<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>>;
    input_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    model_policy_revision: z.ZodNumber;
    status: z.ZodEnum<{
        accepted: "accepted";
        reserved: "reserved";
        dispatched: "dispatched";
        provider_completion_unknown: "provider_completion_unknown";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    provider_request_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    usage: z.ZodObject<{
        input_tokens: z.ZodNullable<z.ZodNumber>;
        output_tokens: z.ZodNullable<z.ZodNumber>;
        provider_requests: z.ZodNumber;
    }, z.core.$strict>;
    committed_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type JobCheckpoint = z.infer<typeof jobCheckpointSchema>;
export declare const runCeilingsSchema: z.ZodObject<{
    max_provider_requests: z.ZodNumber;
    max_output_repairs: z.ZodNumber;
    max_transport_retries: z.ZodNumber;
    max_input_tokens: z.ZodNullable<z.ZodNumber>;
    max_output_tokens: z.ZodNullable<z.ZodNumber>;
    max_money: z.ZodNullable<z.ZodObject<{
        amount_minor: z.ZodNumber;
        currency: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type RunCeilings = z.infer<typeof runCeilingsSchema>;
export declare const runPreviewSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.run-preview/v1">;
    preview_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    mode: z.ZodEnum<{
        full: "full";
        selected: "selected";
        quick: "quick";
        consult: "consult";
        light: "light";
        medium: "medium";
        heavy: "heavy";
    }>;
    seat_ids: z.ZodArray<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>>;
    purpose: z.ZodEnum<{
        council_run: "council_run";
        capability_probe: "capability_probe";
        intake_refinement: "intake_refinement";
        follow_up: "follow_up";
    }>;
    route_policy_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    pack_version: z.ZodString;
    ceilings: z.ZodObject<{
        max_provider_requests: z.ZodNumber;
        max_output_repairs: z.ZodNumber;
        max_transport_retries: z.ZodNumber;
        max_input_tokens: z.ZodNullable<z.ZodNumber>;
        max_output_tokens: z.ZodNullable<z.ZodNumber>;
        max_money: z.ZodNullable<z.ZodObject<{
            amount_minor: z.ZodNumber;
            currency: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    money_bounded: z.ZodBoolean;
    created_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    expires_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    preview_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type RunPreview = z.infer<typeof runPreviewSchema>;
export declare const runGrantSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.run-grant/v1">;
    grant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    authority_mode: z.ZodEnum<{
        managed_principal: "managed_principal";
        local_interactive_owner: "local_interactive_owner";
        existing_standing_grant: "existing_standing_grant";
    }>;
    issuer_principal: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    scope: z.ZodObject<{
        tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        installation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
        owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    }, z.core.$strict>;
    purpose: z.ZodEnum<{
        council_run: "council_run";
        capability_probe: "capability_probe";
        intake_refinement: "intake_refinement";
        follow_up: "follow_up";
    }>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    brief_revision: z.ZodNumber;
    brief_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    mode: z.ZodEnum<{
        full: "full";
        selected: "selected";
        quick: "quick";
        consult: "consult";
        light: "light";
        medium: "medium";
        heavy: "heavy";
    }>;
    seat_ids: z.ZodArray<z.ZodEnum<{
        "simon-sinek": "simon-sinek";
        "td-jakes": "td-jakes";
        "oprah-winfrey": "oprah-winfrey";
        "tiffany-aliche": "tiffany-aliche";
        "russell-brunson": "russell-brunson";
        "michelle-obama": "michelle-obama";
        "brene-brown": "brene-brown";
        "dennis-kimbro": "dennis-kimbro";
        "les-brown": "les-brown";
    }>>;
    route_policy_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    account_ref: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    pack_version: z.ZodString;
    protocol_version: z.ZodString;
    allowed_operation_kinds: z.ZodArray<z.ZodString>;
    ceilings: z.ZodObject<{
        max_provider_requests: z.ZodNumber;
        max_output_repairs: z.ZodNumber;
        max_transport_retries: z.ZodNumber;
        max_input_tokens: z.ZodNullable<z.ZodNumber>;
        max_output_tokens: z.ZodNullable<z.ZodNumber>;
        max_money: z.ZodNullable<z.ZodObject<{
            amount_minor: z.ZodNumber;
            currency: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    created_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    expires_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    revocation_epoch: z.ZodNumber;
    status: z.ZodEnum<{
        active: "active";
        expired: "expired";
        revoked: "revoked";
        exhausted: "exhausted";
    }>;
    standing_parent_grant_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    preview_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    consumed: z.ZodObject<{
        provider_requests: z.ZodNumber;
        output_repairs: z.ZodNumber;
        transport_retries: z.ZodNumber;
    }, z.core.$strict>;
    reserved: z.ZodObject<{
        provider_requests: z.ZodNumber;
        output_repairs: z.ZodNumber;
        transport_retries: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type RunGrant = z.infer<typeof runGrantSchema>;
/** A user approval record. The four authorization kinds never merge. */
export declare const approvalRecordSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.approval/v1">;
    approval_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    kind: z.ZodEnum<{
        build: "build";
        council_run: "council_run";
        action_plan_approval: "action_plan_approval";
        execution: "execution";
    }>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    target_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    approved_by_principal: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    approved_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    expires_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
/**
 * Council event envelope (Section 18). Scope is mandatory and non-null:
 * no council content event may use null or company-free scope.
 */
export declare const councilEventSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.event/v1">;
    event_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    sequence: z.ZodNumber;
    event_type: z.ZodEnum<{
        session_created: "session_created";
        session_state_changed: "session_state_changed";
        brief_revised: "brief_revised";
        card_accepted: "card_accepted";
        crux_identified: "crux_identified";
        resolution_drafted: "resolution_drafted";
        verdict_validated: "verdict_validated";
        grant_issued: "grant_issued";
        grant_revoked: "grant_revoked";
        operation_reserved: "operation_reserved";
        operation_completed: "operation_completed";
        session_paused: "session_paused";
        session_cancelled: "session_cancelled";
        session_blocked: "session_blocked";
        session_failed: "session_failed";
    }>;
    tenant_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    company_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    owner_subject: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    actor: z.ZodEnum<{
        owner: "owner";
        system: "system";
        worker: "worker";
        chair: "chair";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    created_at: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
}, z.core.$strict>;
export type CouncilEvent = z.infer<typeof councilEventSchema>;
/** Session budget and behavior settings (defaults from Section 15.6). */
export declare const councilSettingsSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.settings/v1">;
    max_session_provider_requests: z.ZodNumber;
    max_output_repair_requests: z.ZodNumber;
    max_semantic_verification_requests: z.ZodNumber;
    max_transport_retries_total: z.ZodNumber;
    max_transport_retries_per_request: z.ZodNumber;
    max_output_repairs_per_original_operation: z.ZodNumber;
    max_concurrent_seat_calls: z.ZodNumber;
    max_active_council_sessions_per_client: z.ZodNumber;
    fallback_policy: z.ZodEnum<{
        none: "none";
        client_approved_only: "client_approved_only";
    }>;
}, z.core.$strict>;
export type CouncilSettings = z.infer<typeof councilSettingsSchema>;
export declare const DEFAULT_COUNCIL_SETTINGS: CouncilSettings;
/** Operation receipt: safe accounting only, never raw provider bodies. */
export declare const operationReceiptSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.operation-receipt/v1">;
    operation_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    session_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    status: z.ZodEnum<{
        accepted: "accepted";
        reserved: "reserved";
        dispatched: "dispatched";
        provider_completion_unknown: "provider_completion_unknown";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    provider_request_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    input_sha256: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    output_sha256: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    usage: z.ZodObject<{
        input_tokens: z.ZodNullable<z.ZodNumber>;
        output_tokens: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    cost: z.ZodNullable<z.ZodObject<{
        amount_minor: z.ZodNumber;
        currency: z.ZodString;
    }, z.core.$strict>>;
    completed_at: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
}, z.core.$strict>;
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
export declare const DIAGNOSTIC_LIMITS: {
    readonly defaultCaptureWindowMinutes: 60;
    readonly maxCaptureWindowMinutes: 240;
    readonly defaultPayloadTtlHours: 24;
    readonly maxPayloadTtlHours: 72;
    readonly maxBytesPerOperation: number;
    readonly maxBytesPerSession: number;
};
export declare const diagnosticRetentionPolicySchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.diagnostic-retention-policy/v1">;
    enabled: z.ZodBoolean;
    authorized_by_principal: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    authorization_kind: z.ZodNullable<z.ZodEnum<{
        owner: "owner";
        audited_support: "audited_support";
    }>>;
    session_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
    capture_window_minutes: z.ZodNumber;
    payload_ttl_hours: z.ZodNumber;
    max_bytes_per_operation: z.ZodNumber;
    max_bytes_per_session: z.ZodNumber;
}, z.core.$strict>;
export type DiagnosticRetentionPolicy = z.infer<typeof diagnosticRetentionPolicySchema>;
export declare const DEFAULT_DIAGNOSTIC_RETENTION_POLICY: DiagnosticRetentionPolicy;
export declare const endpointContractSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.endpoint-contract/v1">;
    contract_id: z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>;
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        PATCH: "PATCH";
        DELETE: "DELETE";
    }>;
    path: z.ZodString;
    request_schema: z.ZodNullable<z.ZodString>;
    response_schema: z.ZodString;
    authorization_purpose: z.ZodEnum<{
        build: "build";
        council_run: "council_run";
        action_plan_approval: "action_plan_approval";
        execution: "execution";
    }>;
    idempotency: z.ZodEnum<{
        not_applicable: "not_applicable";
        required_key: "required_key";
        safe_read: "safe_read";
    }>;
    version_rule: z.ZodString;
    service_owner: z.ZodString;
    contract_test_gate: z.ZodString;
    live_integration_gate: z.ZodString;
}, z.core.$strict>;
export type EndpointContract = z.infer<typeof endpointContractSchema>;
export declare function validateSessionSpec(value: unknown): ValidationResult<SessionSpec>;
export declare function validateDecisionBrief(value: unknown): ValidationResult<DecisionBrief>;
export declare function validateCardAuthor(value: unknown): ValidationResult<CardAuthor>;
export declare function validateCard(value: unknown): ValidationResult<CouncilCard>;
export declare function validateVerdict(value: unknown): ValidationResult<Verdict>;
export declare function validateCondition(value: unknown): ValidationResult<Condition>;
export declare function validateActionProposal(value: unknown): ValidationResult<ActionProposal>;
export declare function validateRunPreview(value: unknown): ValidationResult<RunPreview>;
export declare function validateRunGrant(value: unknown): ValidationResult<RunGrant>;
export declare function validateSessionStateRecord(value: unknown): ValidationResult<SessionStateRecord>;
export declare function validateJobCheckpoint(value: unknown): ValidationResult<JobCheckpoint>;
export declare function validateCouncilEvent(value: unknown): ValidationResult<CouncilEvent>;
export declare function validateDiagnosticRetentionPolicy(value: unknown): ValidationResult<DiagnosticRetentionPolicy>;
export declare function validateEndpointContract(value: unknown): ValidationResult<EndpointContract>;
export declare function validateApprovalRecord(value: unknown): ValidationResult<ApprovalRecord>;
export declare function validateCouncilSettings(value: unknown): ValidationResult<CouncilSettings>;
export declare function validateOperationReceipt(value: unknown): ValidationResult<OperationReceipt>;
/**
 * Semantic card checks beyond shape (Section 11.3): every active option
 * appears exactly once in option_scores, and the preferred option exists.
 * Reference checks against the frozen brief manifest happen here, at the
 * contract boundary, so an invalid reference fails before any consumer runs.
 */
export declare function validateCardAgainstBrief(card: CardAuthor, brief: DecisionBrief): ValidationResult<CardAuthor>;
/**
 * Contract version compatibility: a payload is compatible when its schema
 * version major line matches the version this package implements for that
 * contract family. Anything else is VERSION_MISMATCH, never a silent accept.
 */
export declare function checkSchemaVersionCompatibility(family: keyof typeof SCHEMA_VERSIONS, payloadVersion: unknown): boolean;
