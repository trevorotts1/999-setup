/**
 * W74-D: the artifact-renderer entry point (the name the session-close
 * protocol resolves first, `../reports/artifact-renderer.js`).
 *
 * This module wires W74-A's finalize to W74-B's renderer. It holds the
 * one seam between the runtime's stored session and the renderer's
 * session record:
 *
 * - `assembleRenderRecord(session, extras)` builds the renderer's
 *   session record the way W74-B documents it: the session row plus the
 *   runtime data that only exists at run time (client name, model used,
 *   question count, the nine seat takes, the verdict view). Nothing is
 *   invented here: the caller supplies the runtime rows, this projects
 *   them.
 * - `renderArtifact(sessionRecord, options)` delegates to the W74-B
 *   entry point `scripts/render-counsel-artifact.mjs` by export name and
 *   returns its `{ path, link, pdf }`. It accepts either the assembled
 *   render record or a bare `StoredSession` with `options.extras`, so
 *   `resolveRenderArtifact()`'s by-name fallback works unchanged.
 *
 * The repo stays client-name-free: `client_name` enters only as runtime
 * data through `extras`, exactly as W74-B's contract requires.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
function isStoredSession(record) {
    const r = record;
    return typeof r === 'object' && r !== null && 'spec' in r && 'brief' in r;
}
/**
 * The typed state surfaced when a renderer input cannot honestly be
 * derived from the store's own records. Never a guessed value: the
 * renderer contract requires real rows, and a session without them is
 * reported, not papered over.
 */
export const RENDER_INPUT_INCOMPLETE = 'RENDER_INPUT_INCOMPLETE';
export class RenderInputError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'RenderInputError';
    }
}
/**
 * Project the runtime rows into the renderer's session record. The
 * session supplies identity and the decision; the extras supply the
 * runtime-only rows. Missing extras surface at the renderer's own trust
 * boundary (it validates and throws) — nothing is guessed here.
 */
export function assembleRenderRecord(session, extras) {
    return {
        session_id: session.spec.session_id,
        client_name: extras.client_name,
        date: extras.date ?? String(session.spec.created_at).slice(0, 10),
        decision: session.brief.question,
        model_used: extras.model_used,
        question_count: extras.question_count,
        cards: extras.cards.map((c) => ({ seat_id: c.seat_id, take: c.take })),
        verdict: { consensus: extras.verdict.consensus, action_steps: [...extras.verdict.action_steps] },
        synthetic: session.sample,
    };
}
/**
 * Locate the skill folder (SKILL.md beside advisors/ and manifest.json),
 * the same signature the CLI's data-dir guard measures. ponytail: local
 * walk duplicated from cli/dispatcher.ts to keep the protocol->reports
 * edge type-only; unify through a shared helper if a third caller lands.
 */
function skillRoot() {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
        if (existsSync(join(dir, 'SKILL.md')) &&
            existsSync(join(dir, 'advisors')) &&
            existsSync(join(dir, 'manifest.json'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
let cached = null;
/** Load the W74-B renderer module once (scripts/render-counsel-artifact.mjs). */
function loadRenderer() {
    cached ??= (async () => {
        const root = skillRoot();
        const script = root === null ? null : join(root, 'scripts', 'render-counsel-artifact.mjs');
        if (script === null || !existsSync(script)) {
            throw new Error('RENDERER_UNAVAILABLE: scripts/render-counsel-artifact.mjs not found beside this skill');
        }
        const mod = (await import(pathToFileURL(script).href));
        if (typeof mod.renderArtifact !== 'function') {
            throw new Error('RENDERER_UNAVAILABLE: scripts/render-counsel-artifact.mjs has no renderArtifact export');
        }
        return mod;
    })();
    return cached;
}
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
export async function renderArtifact(sessionRecord, options = {}) {
    let record;
    if (isStoredSession(sessionRecord)) {
        if (options.extras === undefined) {
            throw new RenderInputError(RENDER_INPUT_INCOMPLETE, 'renderArtifact received a bare StoredSession without options.extras: ' +
                `the close-to-render contract requires the runtime rows (client name, model, question count, cards, verdict) for session ${sessionRecord.spec.session_id}.`);
        }
        record = assembleRenderRecord(sessionRecord, options.extras);
    }
    else {
        record = sessionRecord;
    }
    const renderer = await loadRenderer();
    const rendererOptions = {};
    if (options.dataDir !== undefined)
        rendererOptions['dataDir'] = options.dataDir;
    if (options.assetsDir !== undefined)
        rendererOptions['assetsDir'] = options.assetsDir;
    if (options.linkBase !== undefined)
        rendererOptions['linkBase'] = options.linkBase;
    if (options.pdf !== undefined)
        rendererOptions['pdf'] = options.pdf;
    if (options.env !== undefined)
        rendererOptions['env'] = options.env;
    return renderer.renderArtifact(record, rendererOptions);
}
/** Resolve a render function bound to one session's runtime extras. */
export function renderArtifactWithExtras(extras, options = {}) {
    return (sessionRecord) => renderArtifact(sessionRecord, { ...options, extras });
}
