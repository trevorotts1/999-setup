/**
 * W74-D: the wired convene flow — the one place the three W74 builds
 * come together, in this exact order (load-bearing):
 *
 *   1. brief-builder FIRST (permitted context): `assembleBrief` reads
 *      the door's permitted memory files through the door's own adapter
 *      (W74-C) and assembles the brief the elders read — selective
 *      facts, explicit unknowns, private detail excluded.
 *   2. deliberation, then 3. verdict: the injected deliberation port
 *      runs the session on that brief and returns the settled result.
 *   4. session-close manages the sitting (W74-A): the soft-close
 *      question after five quiet minutes, an explicit close phrase
 *      finalizes now, ten minutes of silence auto-finalizes. The
 *      sitting controls below are that protocol, over store timestamps.
 *   5. finalize calls `renderArtifact(sessionRecord)` (W74-B, resolved
 *      and called by export name) and the delivery carries the artifact
 *      link in the reply beside the chamber link.
 *
 * Doors: the OpenClaw door runs the OpenClaw adapter; the
 * claude-nine / Claude Code (999) door runs its adapter. `doorForEnv`
 * selects by harness marker, and every adapter feeds the SAME
 * assembler, so the brief shape and the rest of the flow are identical
 * across doors.
 */
import { type DoorKind, type PermittedContextBrief } from '../brief/permitted-brief.js';
import { SOFT_CLOSE_QUESTION, type CloseAction, type CloseReason, type FinalizeResult, type RenderArtifactFn, type SessionClosePort } from '../protocol/session-close.js';
import { type RenderCard, type RenderOptions, type RenderVerdictView } from '../reports/artifact-renderer.js';
export type { DoorKind, PermittedContextBrief };
export { SOFT_CLOSE_QUESTION };
/** Harness markers the doors recognize (same rules as the CLI's detectHarness). */
export type HarnessKind = 'openclaw' | 'claude-nine' | 'claude-code' | 'deepseek' | 'unknown';
/**
 * The door -> adapter map. The OpenClaw door uses the OpenClaw adapter
 * (memory.md, agents.md, soul.md, user.md); the claude-nine / Claude
 * Code (999) door uses its adapter (CLAUDE.md, AGENTS.md,
 * memory/MEMORY.md). One assembler behind both.
 */
export declare function doorAdapterFor(door: DoorKind): DoorKind;
/** Select the door from the running harness's environment markers. */
export declare function doorForEnv(env: NodeJS.ProcessEnv): DoorKind;
/** The deliberation leg: runs the session on the prepared brief. */
export interface DeliberationResult {
    sessionId: string;
    /** The settled session row (identity and the decision). */
    session: import('../cli/host-ports.js').StoredSession;
    /** Runtime-only rows; the client's name enters here and nowhere else. */
    clientName: string;
    modelUsed: string;
    questionCount: number;
    cards: RenderCard[];
    verdict: RenderVerdictView;
    /** The chamber link the convene command printed, when the box has one. */
    chamberUrl: string | null;
}
export interface ConveneFlowInput {
    door: DoorKind;
    /** The client's context root for the door (their memory files). */
    contextRoot: string;
    decision: string;
    options?: readonly string[];
}
export interface ConveneFlowDeps {
    /** Step 2-3: deliberation, then verdict. */
    deliberate(input: {
        permittedBrief: PermittedContextBrief;
    }): Promise<DeliberationResult>;
    /** The store-backed close port (W74-A storeSessionClosePort in production). */
    closePort: SessionClosePort;
    /** W74-B renderer; resolved by export name when omitted. */
    renderArtifact?: RenderArtifactFn;
    renderOptions?: RenderOptions;
}
export interface ConveneFlowResult {
    /** The permitted-context brief the elders read (step 1). */
    permittedBrief: PermittedContextBrief;
    sessionId: string;
    chamberUrl: string | null;
    /** The sitting controls (step 4): session-close manages the sitting. */
    sitting: {
        status(nowIso: string): CloseAction;
        tick(nowIso: string): Promise<import('../protocol/session-close.js').TickResult>;
        handleClientMessage(text: string, nowIso: string): Promise<{
            finalized: FinalizeResult | null;
        }>;
    };
    /** Step 5: finalize -> renderArtifact(sessionRecord) -> the delivery. */
    finalize(reason: CloseReason, nowIso: string): Promise<{
        delivery: {
            reply_link: string | null;
            chamber_url: string | null;
        } | null;
    } & FinalizeResult>;
}
/**
 * Run the wired convene flow once: brief-builder first (permitted
 * context, through the door's adapter), deliberation and verdict, then
 * the session-close protocol manages the sitting and finalize renders
 * the counsel artifact. Deliberation is injected; everything else is
 * the three landed W74 modules, wired.
 */
export declare function conveneFlow(input: ConveneFlowInput, deps: ConveneFlowDeps): Promise<ConveneFlowResult>;
