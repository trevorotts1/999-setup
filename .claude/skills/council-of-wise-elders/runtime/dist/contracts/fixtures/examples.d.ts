/**
 * Valid and invalid contract fixtures (CWE-003 build step 4).
 *
 * The valid fixtures exercise the frozen Section 11.2 session shape and the
 * Section 11.6 contract inventory. The invalid fixtures each break exactly
 * one named rule, so a validation failure is attributable to the intended
 * boundary (the Section 35 rule for negative tests).
 */
export declare const FIXTURE_HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export declare const FIXTURE_HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export declare const validSessionSpec: {
    readonly schema_version: "wise-elders.session/v1";
    readonly session_id: "sess-fixture-1";
    readonly mode: "full";
    readonly visibility: "company";
    readonly brief_revision: 1;
    readonly brief_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    readonly options: readonly [{
        readonly id: "A";
        readonly label: "Keep the current offer";
        readonly kind: "status_quo";
    }, {
        readonly id: "B";
        readonly label: "Pilot the revised offer";
        readonly kind: "bounded_test";
    }, {
        readonly id: "C";
        readonly label: "Launch the revised offer broadly";
        readonly kind: "change";
    }];
    readonly seat_ids: readonly ["simon-sinek", "td-jakes", "oprah-winfrey", "tiffany-aliche", "russell-brunson", "michelle-obama", "brene-brown", "dennis-kimbro", "les-brown"];
    readonly model_policy: {
        readonly selection: "explicit";
        readonly route_id: "route-fixture-1";
        readonly requested_model_id: "model-selected-by-client";
        readonly reasoning_preference: null;
        readonly fallback_policy: "none";
    };
    readonly source_pack_version: "pack-fixture-1.0.0";
    readonly execution_policy: "advisory_only";
    readonly created_at: "2026-10-14T02:00:00Z";
    readonly display_timezone: "America/New_York";
};
export declare const validBrief: {
    readonly schema_version: "wise-elders.brief/v1";
    readonly brief_id: "brief-fixture-1";
    readonly session_id: "sess-fixture-1";
    readonly revision: 1;
    readonly question: "Should we pilot the revised offer before a broad launch?";
    readonly facts: readonly [{
        readonly id: "fact-1";
        readonly statement: "Current offer converts at a measured baseline.";
        readonly evidence_ids: readonly ["ev-1"];
    }];
    readonly assumptions: readonly [{
        readonly id: "asm-1";
        readonly statement: "Pilot capacity exists for one cohort.";
        readonly evidence_ids: readonly [];
    }];
    readonly unknowns: readonly [{
        readonly id: "unk-1";
        readonly statement: "Pilot cohort retention is not yet measured.";
        readonly evidence_ids: readonly [];
    }];
    readonly constraints: readonly [{
        readonly id: "con-1";
        readonly description: "Pilot spend must stay within the amount already set aside.";
        readonly hard: true;
        readonly applies_to_option_ids: readonly ["B", "C"];
    }];
    readonly options: readonly [{
        readonly id: "A";
        readonly label: "Keep the current offer";
        readonly kind: "status_quo";
    }, {
        readonly id: "B";
        readonly label: "Pilot the revised offer";
        readonly kind: "bounded_test";
    }, {
        readonly id: "C";
        readonly label: "Launch the revised offer broadly";
        readonly kind: "change";
    }];
    readonly relevance_weights: {
        readonly 'simon-sinek': 2;
        readonly 'td-jakes': 3;
        readonly 'oprah-winfrey': 2;
        readonly 'tiffany-aliche': 3;
        readonly 'russell-brunson': 3;
        readonly 'michelle-obama': 2;
        readonly 'brene-brown': 3;
        readonly 'dennis-kimbro': 2;
        readonly 'les-brown': 2;
    };
    readonly critical_domains: readonly [{
        readonly schema_version: "wise-elders.critical-domain-requirement/v1";
        readonly domain: "financial_feasibility";
        readonly status: "unresolved";
        readonly trigger_evidence_ids: readonly ["ev-1"];
        readonly trigger_field_paths: readonly ["constraints.con-1"];
        readonly required_seat_id: "tiffany-aliche";
        readonly required_checker: "seat";
        readonly unresolved_questions: readonly ["Is the pilot affordable at committed cash levels?"];
        readonly policy_version: "critical-domains/v1";
    }];
    readonly evidence_manifest: readonly [{
        readonly evidence_id: "ev-1";
        readonly sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly source_kind: "client_document";
        readonly locator: "doc:baseline-metrics";
    }];
    readonly private_preference_ref: null;
    readonly created_at: "2026-10-14T02:00:00Z";
    readonly display_timezone: "America/New_York";
};
export declare const validAdvisorCardAuthor: {
    readonly schema_version: "wise-elders.card/v1";
    readonly card_kind: "advisor";
    readonly session_id: "sess-fixture-1";
    readonly brief_revision: 1;
    readonly round: 1;
    readonly seat_id: "tiffany-aliche";
    readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    readonly pack_version: "pack-fixture-1.0.0";
    readonly stance: "conditional";
    readonly preferred_option_id: "B";
    readonly option_scores: readonly [{
        readonly option_id: "A";
        readonly score: 5;
        readonly rationale: "Safe but leaves the pricing question open.";
        readonly evidence_ids: readonly ["ev-1"];
    }, {
        readonly option_id: "B";
        readonly score: 8;
        readonly rationale: "Bounded spend with measurable evidence.";
        readonly evidence_ids: readonly ["ev-1"];
    }, {
        readonly option_id: "C";
        readonly score: 6;
        readonly rationale: "Broad launch exceeds verified capacity.";
        readonly evidence_ids: readonly ["ev-1"];
    }];
    readonly framework_applications: readonly [{
        readonly framework_id: "budget-baseline-check";
        readonly source_evidence_ids: readonly ["ev-1"];
        readonly case_evidence_ids: readonly [];
        readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
        readonly attribution_kind: "source_principle";
    }];
    readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
    readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
    readonly conditions: readonly [];
    readonly critical_unknowns: readonly ["Pilot cohort retention"];
    readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
    readonly challenges_answered: readonly [];
    readonly quotes: readonly [];
    readonly evidence_strength: "medium";
    readonly minority_position: null;
};
export declare const validHostStamp: {
    readonly scope: {
        readonly tenant_id: "tenant-fixture";
        readonly company_id: "company-fixture";
        readonly installation_id: "install-fixture";
        readonly owner_subject: null;
    };
    readonly operation_id: "op-fixture-1";
    readonly route_id: "route-fixture-1";
    readonly session_id: "sess-fixture-1";
    readonly stamped_at: "2026-10-14T02:05:00Z";
    readonly source_status: "verified";
};
/** Each invalid fixture breaks exactly one named rule. */
export declare const invalidFixtures: {
    /** Unknown session state value in a state record. */
    readonly unknownState: {
        readonly schema_version: "wise-elders.session-state/v1";
        readonly session_id: "sess-fixture-1";
        readonly mode: "full";
        readonly state: "THINKING";
        readonly state_version: 0;
        readonly brief_revision: 1;
        readonly resume_phase: null;
        readonly cancel_generation: 0;
        readonly revocation_generation: 0;
        readonly attempt: 1;
        readonly lease_epoch: 0;
        readonly archived: false;
        readonly updated_at: "2026-10-14T02:00:00Z";
    };
    /** Duplicate option id inside one session spec. */
    readonly duplicateOptions: {
        readonly options: readonly [{
            readonly id: "A";
            readonly label: "Keep the current offer";
            readonly kind: "status_quo";
        }, {
            readonly id: "A";
            readonly label: "Duplicate of A";
            readonly kind: "change";
        }];
        readonly schema_version: "wise-elders.session/v1";
        readonly session_id: "sess-fixture-1";
        readonly mode: "full";
        readonly visibility: "company";
        readonly brief_revision: 1;
        readonly brief_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        readonly seat_ids: readonly ["simon-sinek", "td-jakes", "oprah-winfrey", "tiffany-aliche", "russell-brunson", "michelle-obama", "brene-brown", "dennis-kimbro", "les-brown"];
        readonly model_policy: {
            readonly selection: "explicit";
            readonly route_id: "route-fixture-1";
            readonly requested_model_id: "model-selected-by-client";
            readonly reasoning_preference: null;
            readonly fallback_policy: "none";
        };
        readonly source_pack_version: "pack-fixture-1.0.0";
        readonly execution_policy: "advisory_only";
        readonly created_at: "2026-10-14T02:00:00Z";
        readonly display_timezone: "America/New_York";
    };
    /** Score above the 0..10 range. */
    readonly scoreOutOfRange: {
        readonly option_scores: readonly [{
            readonly option_id: "A";
            readonly score: 11;
            readonly rationale: "Out of range on purpose.";
            readonly evidence_ids: readonly [];
        }, {
            readonly option_id: "B";
            readonly score: 8;
            readonly rationale: "In range.";
            readonly evidence_ids: readonly [];
        }, {
            readonly option_id: "C";
            readonly score: 6;
            readonly rationale: "In range.";
            readonly evidence_ids: readonly [];
        }];
        readonly schema_version: "wise-elders.card/v1";
        readonly card_kind: "advisor";
        readonly session_id: "sess-fixture-1";
        readonly brief_revision: 1;
        readonly round: 1;
        readonly seat_id: "tiffany-aliche";
        readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly pack_version: "pack-fixture-1.0.0";
        readonly stance: "conditional";
        readonly preferred_option_id: "B";
        readonly framework_applications: readonly [{
            readonly framework_id: "budget-baseline-check";
            readonly source_evidence_ids: readonly ["ev-1"];
            readonly case_evidence_ids: readonly [];
            readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
            readonly attribution_kind: "source_principle";
        }];
        readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
        readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
        readonly conditions: readonly [];
        readonly critical_unknowns: readonly ["Pilot cohort retention"];
        readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
        readonly challenges_answered: readonly [];
        readonly quotes: readonly [];
        readonly evidence_strength: "medium";
        readonly minority_position: null;
    };
    /** Author payload trying to assign its own tenant (host-only field). */
    readonly authorAssignsTenant: {
        readonly tenant_id: "tenant-forged";
        readonly schema_version: "wise-elders.card/v1";
        readonly card_kind: "advisor";
        readonly session_id: "sess-fixture-1";
        readonly brief_revision: 1;
        readonly round: 1;
        readonly seat_id: "tiffany-aliche";
        readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly pack_version: "pack-fixture-1.0.0";
        readonly stance: "conditional";
        readonly preferred_option_id: "B";
        readonly option_scores: readonly [{
            readonly option_id: "A";
            readonly score: 5;
            readonly rationale: "Safe but leaves the pricing question open.";
            readonly evidence_ids: readonly ["ev-1"];
        }, {
            readonly option_id: "B";
            readonly score: 8;
            readonly rationale: "Bounded spend with measurable evidence.";
            readonly evidence_ids: readonly ["ev-1"];
        }, {
            readonly option_id: "C";
            readonly score: 6;
            readonly rationale: "Broad launch exceeds verified capacity.";
            readonly evidence_ids: readonly ["ev-1"];
        }];
        readonly framework_applications: readonly [{
            readonly framework_id: "budget-baseline-check";
            readonly source_evidence_ids: readonly ["ev-1"];
            readonly case_evidence_ids: readonly [];
            readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
            readonly attribution_kind: "source_principle";
        }];
        readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
        readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
        readonly conditions: readonly [];
        readonly critical_unknowns: readonly ["Pilot cohort retention"];
        readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
        readonly challenges_answered: readonly [];
        readonly quotes: readonly [];
        readonly evidence_strength: "medium";
        readonly minority_position: null;
    };
    /** Unknown enum value for mode. */
    readonly unknownMode: {
        readonly mode: "turbo";
        readonly schema_version: "wise-elders.session/v1";
        readonly session_id: "sess-fixture-1";
        readonly visibility: "company";
        readonly brief_revision: 1;
        readonly brief_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        readonly options: readonly [{
            readonly id: "A";
            readonly label: "Keep the current offer";
            readonly kind: "status_quo";
        }, {
            readonly id: "B";
            readonly label: "Pilot the revised offer";
            readonly kind: "bounded_test";
        }, {
            readonly id: "C";
            readonly label: "Launch the revised offer broadly";
            readonly kind: "change";
        }];
        readonly seat_ids: readonly ["simon-sinek", "td-jakes", "oprah-winfrey", "tiffany-aliche", "russell-brunson", "michelle-obama", "brene-brown", "dennis-kimbro", "les-brown"];
        readonly model_policy: {
            readonly selection: "explicit";
            readonly route_id: "route-fixture-1";
            readonly requested_model_id: "model-selected-by-client";
            readonly reasoning_preference: null;
            readonly fallback_policy: "none";
        };
        readonly source_pack_version: "pack-fixture-1.0.0";
        readonly execution_policy: "advisory_only";
        readonly created_at: "2026-10-14T02:00:00Z";
        readonly display_timezone: "America/New_York";
    };
    /** Card whose preferred option does not exist in the brief. */
    readonly invalidPreferredOption: {
        readonly preferred_option_id: "Z";
        readonly schema_version: "wise-elders.card/v1";
        readonly card_kind: "advisor";
        readonly session_id: "sess-fixture-1";
        readonly brief_revision: 1;
        readonly round: 1;
        readonly seat_id: "tiffany-aliche";
        readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly pack_version: "pack-fixture-1.0.0";
        readonly stance: "conditional";
        readonly option_scores: readonly [{
            readonly option_id: "A";
            readonly score: 5;
            readonly rationale: "Safe but leaves the pricing question open.";
            readonly evidence_ids: readonly ["ev-1"];
        }, {
            readonly option_id: "B";
            readonly score: 8;
            readonly rationale: "Bounded spend with measurable evidence.";
            readonly evidence_ids: readonly ["ev-1"];
        }, {
            readonly option_id: "C";
            readonly score: 6;
            readonly rationale: "Broad launch exceeds verified capacity.";
            readonly evidence_ids: readonly ["ev-1"];
        }];
        readonly framework_applications: readonly [{
            readonly framework_id: "budget-baseline-check";
            readonly source_evidence_ids: readonly ["ev-1"];
            readonly case_evidence_ids: readonly [];
            readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
            readonly attribution_kind: "source_principle";
        }];
        readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
        readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
        readonly conditions: readonly [];
        readonly critical_unknowns: readonly ["Pilot cohort retention"];
        readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
        readonly challenges_answered: readonly [];
        readonly quotes: readonly [];
        readonly evidence_strength: "medium";
        readonly minority_position: null;
    };
    /** Card scoring an option that is not in the brief. */
    readonly invalidScoredOption: {
        readonly option_scores: readonly [{
            readonly option_id: "A";
            readonly score: 5;
            readonly rationale: "In the brief.";
            readonly evidence_ids: readonly [];
        }, {
            readonly option_id: "B";
            readonly score: 8;
            readonly rationale: "In the brief.";
            readonly evidence_ids: readonly [];
        }, {
            readonly option_id: "Z";
            readonly score: 6;
            readonly rationale: "Not in the brief.";
            readonly evidence_ids: readonly [];
        }];
        readonly schema_version: "wise-elders.card/v1";
        readonly card_kind: "advisor";
        readonly session_id: "sess-fixture-1";
        readonly brief_revision: 1;
        readonly round: 1;
        readonly seat_id: "tiffany-aliche";
        readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly pack_version: "pack-fixture-1.0.0";
        readonly stance: "conditional";
        readonly preferred_option_id: "B";
        readonly framework_applications: readonly [{
            readonly framework_id: "budget-baseline-check";
            readonly source_evidence_ids: readonly ["ev-1"];
            readonly case_evidence_ids: readonly [];
            readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
            readonly attribution_kind: "source_principle";
        }];
        readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
        readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
        readonly conditions: readonly [];
        readonly critical_unknowns: readonly ["Pilot cohort retention"];
        readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
        readonly challenges_answered: readonly [];
        readonly quotes: readonly [];
        readonly evidence_strength: "medium";
        readonly minority_position: null;
    };
    /** Card citing evidence outside the frozen manifest. */
    readonly invalidEvidenceReference: {
        readonly option_scores: readonly [{
            readonly option_id: "A";
            readonly score: 5;
            readonly rationale: "Cites missing evidence.";
            readonly evidence_ids: readonly ["ev-missing"];
        }, {
            readonly option_id: "B";
            readonly score: 8;
            readonly rationale: "In range.";
            readonly evidence_ids: readonly [];
        }, {
            readonly option_id: "C";
            readonly score: 6;
            readonly rationale: "In range.";
            readonly evidence_ids: readonly [];
        }];
        readonly schema_version: "wise-elders.card/v1";
        readonly card_kind: "advisor";
        readonly session_id: "sess-fixture-1";
        readonly brief_revision: 1;
        readonly round: 1;
        readonly seat_id: "tiffany-aliche";
        readonly input_manifest_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        readonly pack_version: "pack-fixture-1.0.0";
        readonly stance: "conditional";
        readonly preferred_option_id: "B";
        readonly framework_applications: readonly [{
            readonly framework_id: "budget-baseline-check";
            readonly source_evidence_ids: readonly ["ev-1"];
            readonly case_evidence_ids: readonly [];
            readonly application: "Compared pilot spend against the measured baseline before endorsing launch.";
            readonly attribution_kind: "source_principle";
        }];
        readonly decisive_arguments: readonly ["The pilot bounds the downside while producing the missing evidence."];
        readonly strongest_objection: "Retention for the pilot cohort is unmeasured.";
        readonly conditions: readonly [];
        readonly critical_unknowns: readonly ["Pilot cohort retention"];
        readonly change_my_mind: "Evidence that committed cash cannot cover the pilot without missing obligations.";
        readonly challenges_answered: readonly [];
        readonly quotes: readonly [];
        readonly evidence_strength: "medium";
        readonly minority_position: null;
    };
};
