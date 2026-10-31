export type CouncilMode = 'light' | 'medium' | 'heavy';
export type ModeSource = 'client' | 'auto';
export interface ModeSelection {
    readonly mode: CouncilMode;
    readonly source: ModeSource;
    readonly reason: string;
}
export declare const MODE_SCORE_THRESHOLDS: {
    readonly lightMax: 4;
    readonly heavyMin: 14;
};
/**
 * Pick the deliberation mode for one question.
 *
 * `explicitMode` is the client's own choice: any canonical SESSION_MODES value
 * is honoured (matched case-insensitively) and mapped to its council size, so
 * an explicit quick/consult/full/selected never falls through to automatic
 * classification. An unrecognized value is not a mode and does fall back to
 * the automatic classification. Every mode seats all nine advisors.
 */
export declare function selectMode(question: string, explicitMode?: string | null): ModeSelection;
