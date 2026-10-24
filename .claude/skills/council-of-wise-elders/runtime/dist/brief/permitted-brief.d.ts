/** Hard cap on the brief's text, in words. */
export declare const BRIEF_WORD_CAP = 2000;
export type DoorKind = 'openclaw' | 'claude-nine';
export interface BriefFact {
    /** The selected fact, as it appears in the brief. */
    readonly statement: string;
    /** Relative path of the permitted file it came from. */
    readonly source: string;
    /** Decision-relevance score (distinct decision/option word overlap). */
    readonly relevance: number;
    /** Newest-first tiebreaker: the file's `updated: YYYY-MM-DD` date, if any. */
    readonly as_of: string | null;
}
export interface PermittedContextBrief {
    readonly schema: 'cwe-permitted-brief/1';
    readonly door: DoorKind;
    readonly decision: string;
    readonly options: readonly string[];
    readonly constraints: readonly string[];
    readonly facts: readonly BriefFact[];
    readonly unknowns: readonly string[];
    /** Opaque handle to the separate private-preference record; content never here. */
    readonly private_preference_ref: string | null;
    readonly meta: {
        readonly word_cap: number;
        readonly word_count: number;
        readonly truncated: boolean;
        /** Permitted files actually read (roots plus at most one hop). */
        readonly sources_read: readonly string[];
        readonly pointer_hops_followed: 1;
    };
}
export interface BriefInput {
    readonly door: DoorKind;
    /** The client context root (e.g. the OpenClaw or claude-nine state dir). */
    readonly rootDir: string;
    readonly decision: string;
    readonly options?: readonly string[];
    /** Test seam; production callers use BRIEF_WORD_CAP. */
    readonly wordCap?: number;
}
export interface ContextDocument {
    readonly rel: string;
    readonly text: string;
    readonly depth: 0 | 1;
    readonly updated: string | null;
}
/** The two door adapters: root lists plus at-most-one-hop link following. */
export declare function collectPermittedDocuments(door: DoorKind, rootDir: string): ContextDocument[];
export declare function assembleBrief(input: BriefInput): PermittedContextBrief;
