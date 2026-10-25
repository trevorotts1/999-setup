/**
 * JSON Schema generation for the canonical contracts (CWE-003 build step 3).
 *
 * The JSON Schema artifacts are generated from the exact zod definitions in
 * schemas.ts, so generated schemas and generated TypeScript types (types.ts)
 * share one canonical source. Run as a script to (re)write the committed
 * artifact at ../../../schemas/json-schemas.json (the skill-level schemas/ directory):
 *
 *   node --import tsx 77-council-of-wise-elders/runtime/src/contracts/generate.ts
 *
 * The drift test regenerates the artifact in memory and compares it to the
 * committed file byte for byte; a mismatch fails the suite.
 */
import { z } from 'zod';
export declare const JSON_SCHEMA_ARTIFACT_PATH = "../../../schemas/json-schemas.json";
declare const CARD_AUTHOR_SCHEMAS: {
    readonly advisor: z.ZodObject<{
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
    readonly ratification: z.ZodObject<{
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
    readonly consult: z.ZodObject<{
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
};
export type CardAuthorKind = keyof typeof CARD_AUTHOR_SCHEMAS;
/**
 * The canonical card contract for one card kind, as a JSON Schema
 * generated from the exact zod author definition the validator
 * enforces (RP-046-3, DEFECT-046-B Cause 2). A composed provider
 * request carries this schema so the model is told the precise shape,
 * including the closed card_kind discriminator, instead of being
 * asked to guess it. Generated per call from the same definitions as
 * the committed artifact above; the artifact registry is untouched,
 * so the committed artifact bytes do not change.
 */
export declare function cardAuthorJsonSchema(kind: CardAuthorKind): unknown;
/** Generate the full JSON Schema artifact text (deterministic byte output). */
export declare function generateJsonSchemaArtifact(): string;
export {};
