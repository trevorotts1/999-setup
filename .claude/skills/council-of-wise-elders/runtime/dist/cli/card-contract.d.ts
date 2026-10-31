/**
 * Card contract conveyance (RP-046-4, DEFECT-046-C; CTR-138).
 *
 * Attempt 4 of the D-021 canary proved the transport, the lease
 * heartbeat (RP-046-3), the response extraction, and the strict
 * validator all working as designed, and the session still blocked
 * in Round 1: five of nine seats returned parseable JSON whose
 * CONTENT failed the card schema even after the one permitted
 * repair. Diagnosis from the code, per failure class:
 *
 * - The two format rules that failed (challenges_answered entries
 *   must be opaque IDs; conditions[].due_at must be a UTC ISO 8601
 *   timestamp or null) exist only as zod refinement messages. The
 *   JSON Schema generated from the same definitions drops
 *   refinements, so in the schema the model actually receives those
 *   fields are plain strings: the rules reached the model nowhere,
 *   in prose or in schema.
 * - The complete required-field list existed only as the JSON
 *   Schema's required array, buried in the input payload; the prose
 *   instruction never named the fields, so a partial card had no
 *   checklist to be written against.
 * - For a Round 1 call, no challenge IDs are issued or conveyed at
 *   all (challenges are computed after Round 1 and assigned in
 *   Round 2), so the model had to guess what challenges_answered
 *   should hold; the seats that failed wrote names and text.
 * - The repair turn forwarded only the validator's error strings.
 *   Section 15.5 requires the repair to carry the exact validation
 *   errors AND the original constraints; the constraints were never
 *   restated, so the repair gave the model nothing new to comply
 *   with, and every failed seat failed again in the same shape.
 *
 * This module is the conveyance repair: the exact contract for THIS
 * call, stated in prose, in the composed request and restated in
 * full in the repair instruction. It changes only what the model is
 * told. The validator, the schemas, the single permitted repair,
 * the ledger, and the lease behavior are all unchanged: a
 * non-conforming card still fails validation in exactly the same
 * words as before.
 *
 * CTR-138, from the round-3 sitting sess-ad4ee659 (2026-10-30):
 * three further rules the validator enforces were missing from the
 * explicit card contract before generation.
 * - The call's round number was absent from that contract, and from
 *   the prompt for seats that already had a challenge assigned, so
 *   seats reported the previous round ("round: challenge cards are
 *   round 3, got 2").
 * - The three approved Jakes lens IDs were named only AFTER a
 *   failure, so the seat invented them
 *   ("source_use JAKES_LENS_UNKNOWN: Lens instinct-intellect-balance
 *   is not one of the seat's three lenses"), and the generated
 *   schema typed lenses_used as free text while the validator
 *   accepts three values.
 * - The closed-object rule was never stated, so an option_scores
 *   entry carried an extra "evidence_ids_note" key and was rejected
 *   ("option_scores.0: Unrecognized key: \"evidence_ids_note\"").
 * The same rules are now stated up front and restated on the one
 * permitted repair.
 */
export type CardContractPurpose = 'advisor' | 'ratification' | 'consult';
/** A concrete value in the only due_at shape the validator accepts. */
export declare const DUE_AT_EXAMPLE = "2026-11-15T17:00:00Z";
/**
 * The three approved lenses of the Jakes seat, read from the same
 * roster the validator checks (src/sources/packs.ts), so the contract
 * can never name a lens the validator rejects.
 */
export declare const JAKES_LENS_IDS: readonly string[];
/**
 * The required field names for a card kind, read from the same
 * generated JSON Schema the validator enforces, so the prose list
 * can never drift from the enforced contract.
 */
export declare function requiredCardFields(purpose: CardContractPurpose): string[];
/**
 * The keys one option_scores entry accepts, read from the same
 * generated JSON Schema the validator enforces.
 */
export declare function optionScoreFields(purpose: CardContractPurpose): string[];
/**
 * Two validator rules the contract never told the model (real-run
 * acceptance, session sess-3d85c907): evidence reference fields accept
 * only evidence manifest IDs, and lenses_used belongs to td-jakes only.
 */
export declare const EVIDENCE_ID_RULE = "Evidence reference arrays (evidence_ids, option_scores[].evidence_ids, framework_applications[].case_evidence_ids) may hold only evidence_id values copied from the evidence manifest in the supplied input. The brief's own fact, assumption, unknown, and constraint IDs (for example fact-1, asm-1, unk-1, con-1) are NOT evidence IDs and fail validation if used there. When the evidence manifest is empty or no entry fits, those arrays must be [].";
/** The Jakes lens rule, with the three approved IDs named up front. */
export declare const LENSES_RULE: string;
/** The object's round number, which the validator checks per round. */
export declare function roundRule(round: number): string;
/**
 * CTR-151 future-generation wording.
 *
 * The reader report builds its summary, its ordered actions, and its
 * "information needed" list from fields the seat already writes. In the
 * observed 47-page report those fields carried round-internal shorthand
 * ("crux-2", "opt-repurpose-longform") that a client cannot act on.
 *
 * This rule names only fields the strict schema ALREADY enforces. It adds
 * no field, relaxes no validation, and spends no extra call. CTR-155: it is
 * sent only for `purpose === 'advisor'`, the one card kind whose schema
 * defines the named fields; ratification and consult never receive it.
 */
export declare const PLAIN_LANGUAGE_RULE: string;
/**
 * Every card object is a strict object in the enforced schema: a key
 * the schema does not name fails validation.
 */
export declare function closedObjectRule(purpose: CardContractPurpose): string;
/**
 * The contract lines for one operation.
 *
 * `challengeIds` is the per-call challenge issuance: for advisor
 * calls, the challenge IDs issued to this seat for THIS call (an
 * empty array when none have been issued, which is every Round 1
 * call); null for purposes that issue no challenges.
 *
 * `round` is the round number this call must report on the card;
 * null when the purpose carries no round (consult).
 */
export declare function cardContractLines(purpose: CardContractPurpose, challengeIds: string[] | null, round?: number | null): string[];
/** The instruction carried in every composed request's output contract. */
export declare function cardContractInstruction(purpose: CardContractPurpose, challengeIds: string[] | null, round?: number | null): string;
/** Marks a repair issue as "the reply did not parse"; the text after it is the parser's message. */
export declare const NOT_JSON_ISSUE = "response was not valid JSON: ";
/**
 * The repair instruction (Section 15.5: the exact validation errors
 * AND the original constraints). The validator's failures verbatim,
 * then the full contract for this call restated, then the explicit
 * demand for the complete corrected card only.
 */
export declare function cardRepairInstruction(purpose: CardContractPurpose, challengeIds: string[] | null, issues: string[], round?: number | null): string;
/**
 * The card contract for one request on any path (RP-046-3/4 on the
 * CLI engine; W30 on the service executors): the output_contract
 * object that rides in the request input, and the system text with
 * the contract instruction (plus, on the one permitted repair, the
 * exact validation issues and the full contract restated).
 */
export declare function cardOutputContract(purpose: CardContractPurpose, challengeIds: string[] | null, round?: number | null): {
    card_kind: CardContractPurpose;
    instruction: string;
    json_schema: unknown;
};
export declare function cardRequestSystem(baseSystem: string, purpose: CardContractPurpose, challengeIds: string[] | null, repairIssues: string[], round?: number | null): string;
/**
 * Worst-case system bytes for a request (the repair form), so the
 * context budget reserves room for the contract prose it now carries.
 */
export declare function cardSystemBytes(baseSystem: string, purpose: CardContractPurpose, round?: number | null): number;
