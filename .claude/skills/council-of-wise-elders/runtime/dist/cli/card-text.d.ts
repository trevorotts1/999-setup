/**
 * Provider response text handling for card parsing (RP-046-3 repair
 * for DEFECT-046-B, Cause 2).
 *
 * Harness and chat-style providers do not always return the bare card
 * JSON: the card object may arrive wrapped in prose or a markdown
 * fence. Feeding the whole text to JSON.parse then fails a valid card
 * for a formatting reason ("response is not valid JSON"), while the
 * canonical validator never sees the card at all.
 *
 * This module only LOCATES the card JSON object inside the response
 * text. It never edits field values, never invents a card, and never
 * weakens validation: whatever object is located is handed to the
 * canonical validator unchanged, so a JSON object whose card_kind is
 * outside the closed discriminator enum still fails validation and
 * flows to the one permitted repair, exactly as designed.
 *
 * Behavior for text that is already valid JSON is unchanged: the
 * direct parse result (object or not) is returned untouched, and the
 * validator produces the same issues it always has. Extraction runs
 * only when the direct parse fails.
 */
export type CardTextParse = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    message: string;
};
/**
 * Locate the first balanced-brace JSON object in the text that parses
 * as a JSON object. Brace matching is string and escape aware, so
 * braces inside string values never unbalance the scan; a brace span
 * that does not parse (prose braces, a truncated fragment) is skipped
 * and the scan continues at the next opening brace.
 */
export declare function extractJsonObject(text: string): Record<string, unknown> | null;
/**
 * Parse a provider response into the candidate card value. Direct
 * JSON keeps its historical semantics; prose-wrapped JSON is located
 * by extraction; anything else reports not-ok, which the engine
 * records with the same "response is not valid JSON" issue it has
 * always used for unparseable output.
 */
export declare function parseCardResponseText(text: string): CardTextParse;
/**
 * The author payload for one provider reply, plus the parse failure
 * when there is none: an unparseable or non-object reply yields the
 * empty payload (which can never validate) and the reason, so the one
 * bounded repair can say "not valid JSON" instead of a schema error.
 */
export declare function authorPayloadFromText(text: string): {
    author: Record<string, unknown>;
    parse_error?: string;
};
