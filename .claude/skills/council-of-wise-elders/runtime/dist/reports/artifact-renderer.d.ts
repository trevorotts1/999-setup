import type { StoredSession } from '../cli/host-ports.js';
/** One elder card as the renderer shows it. */
export interface RenderCard {
    seat_id: string;
    take: string;
}
/** The verdict view the renderer shows: one consensus line plus steps. */
export interface RenderVerdictView {
    consensus: string;
    action_steps: string[];
}
/** W74-B's session record: the flat shape `render-counsel-artifact.mjs` validates. */
export interface RenderSessionRecord {
    session_id: string;
    client_name: string;
    date: string;
    decision: string;
    model_used: string;
    question_count: number;
    cards: RenderCard[];
    verdict: RenderVerdictView;
    /** Labeled fixture/replay render; never a production claim. */
    synthetic?: boolean;
}
/** The runtime-only rows the assembler projects; never fabricated. */
export interface RenderExtras {
    client_name: string;
    model_used: string;
    question_count: number;
    cards: RenderCard[];
    verdict: RenderVerdictView;
    /** `YYYY-MM-DD`; defaults to the session's created-at date. */
    date?: string;
}
/** The W74-B result shape (pdf is best effort and may be absent). */
export interface ArtifactRenderResult {
    path: string;
    link: string;
    pdf?: unknown;
}
export interface RenderOptions {
    /** Council data directory; the renderer writes `<dataDir>/artifacts/...`. */
    dataDir?: string;
    assetsDir?: string;
    /** Public origin for an absolute link; relative when omitted. */
    linkBase?: string | null;
    pdf?: boolean;
    env?: NodeJS.ProcessEnv;
    /** Runtime rows, required when the record is a bare StoredSession. */
    extras?: RenderExtras;
}
/**
 * The typed state surfaced when a renderer input cannot honestly be
 * derived from the store's own records. Never a guessed value: the
 * renderer contract requires real rows, and a session without them is
 * reported, not papered over.
 */
export declare const RENDER_INPUT_INCOMPLETE: "RENDER_INPUT_INCOMPLETE";
export type RenderInputIncompleteCode = typeof RENDER_INPUT_INCOMPLETE | 'NO_CARDS' | 'NO_VERDICT';
export declare class RenderInputError extends Error {
    readonly code: RenderInputIncompleteCode;
    constructor(code: RenderInputIncompleteCode, message: string);
}
/**
 * Project the runtime rows into the renderer's session record. The
 * session supplies identity and the decision; the extras supply the
 * runtime-only rows. Missing extras surface at the renderer's own trust
 * boundary (it validates and throws) — nothing is guessed here.
 */
export declare function assembleRenderRecord(session: StoredSession, extras: RenderExtras): RenderSessionRecord;
/**
 * renderArtifact(sessionRecord) -> { path, link, pdf }
 *
 * The W74-B entry point, called by export name. Accepts the assembled
 * render record, or a bare StoredSession plus `options.extras` (the
 * session-close protocol hands over what its close port assembled).
 * A bare StoredSession WITHOUT extras is a contract violation, not a
 * default: it carries none of the runtime rows the renderer validates,
 * and this seam reports it with the typed `RenderInputError` instead of
 * casting undefined through (the R1 defect: `options.extras as
 * RenderExtras` let a bare record dereference undefined in
 * assembleRenderRecord). Delegates to the fixed-template renderer
 * unchanged.
 */
export declare function renderArtifact(sessionRecord: RenderSessionRecord | StoredSession, options?: RenderOptions): Promise<ArtifactRenderResult>;
/** Resolve a render function bound to one session's runtime extras. */
export declare function renderArtifactWithExtras(extras: RenderExtras, options?: RenderOptions): (sessionRecord: StoredSession | RenderSessionRecord) => Promise<ArtifactRenderResult>;
