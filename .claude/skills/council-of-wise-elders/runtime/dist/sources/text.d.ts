/**
 * Documented text normalization for quotation verification (Section 8.4).
 *
 * "Normalize only documented typographic differences." The complete list
 * of permitted normalizations is:
 * - Unicode NFKC compatibility folding;
 * - curly single/double quotation marks to straight ASCII quotes;
 * - em dash and en dash to a hyphen;
 * - the horizontal ellipsis character to three periods;
 * - any run of whitespace (including newlines) to one space, trimmed.
 *
 * Letter case is NOT folded: a quotation must match the source's words,
 * including capitalization. No words are removed or reordered.
 */
export declare function normalizeQuotedText(text: string): string;
/**
 * Speaker-name comparison key. Names are compared case-insensitively,
 * without punctuation, and without an honorific prefix ("Dr."), so
 * "Dr. Dennis Kimbro" and "Dennis Kimbro" name the same speaker while a
 * different person never matches.
 */
export declare function normalizeSpeakerName(name: string): string;
export declare function sameSpeaker(a: string, b: string): boolean;
/** Title comparison key for work matching (coverage gate). */
export declare function normalizeTitle(title: string): string;
/**
 * A tuple locator is a plain string (the CWE-003 VerifiedQuoteCandidate
 * carries `locator: string`). It matches an evidence locator when it
 * equals the locator value ("41") or the kind-qualified form
 * ("page:41"). Anything else is a mismatch, never a fuzzy pass.
 */
export declare function locatorMatches(tupleLocator: string, locator: {
    kind: string;
    value: string;
}): boolean;
