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
 * W77S auto-mode: before deliberation, the sitting's mode (light /
 * medium / heavy) is resolved through the ONE selector,
 * `selectMode(question, explicitMode)`. An explicit client mode always
 * wins verbatim; with no client mode the question's complexity decides.
 * The chosen mode, its source (`client` / `auto`) and the reason travel
 * with the sitting on the returned session record and the convene
 * result. What a mode DOES (rounds, concurrency, request caps) is
 * contracts/modes.ts and is not reinterpreted here.
 *
 * Doors: the OpenClaw door runs the OpenClaw adapter; the
 * claude-nine / Claude Code (999) door runs its adapter. `doorForEnv`
 * selects by harness marker, and every adapter feeds the SAME
 * assembler, so the brief shape and the rest of the flow are identical
 * across doors.
 */
import { type DoorKind, type PermittedContextBrief } from '../brief/permitted-brief.js';
import { type CouncilSize } from '../contracts/modes.js';
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
/** Who chose the sitting's mode: the client explicitly, or the system. */
export type ModeSource = 'client' | 'auto';
/**
 * The resolved mode and WHY — shown to the client with the sitting. The
 * shape is the selector's own return: `selectMode` decides it, this flow
 * only carries it.
 */
export interface ModeSelection {
    mode: CouncilSize;
    source: ModeSource;
    reason: string;
}
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
/**
 * The settled session record as this flow hands it back: the store's own
 * row plus the mode provenance for the sitting. SessionSpec has no
 * council-size seat yet (its `mode` is the older four-mode enum), so the
 * provenance rides here rather than in a field the store cannot validate.
 */
export type ConveneSessionRecord = DeliberationResult['session'] & {
    mode_selection: ModeSelection;
};
export interface ConveneFlowInput {
    door: DoorKind;
    /** The client's context root for the door (their memory files). */
    contextRoot: string;
    decision: string;
    options?: readonly string[];
    /**
     * The client's explicit mode — a `--mode` flag or a `mode` field on the
     * request. It ALWAYS wins, verbatim: the system never second-guesses a
     * mode the client asked for. Omitted or null means the system picks
     * from the question's complexity. One of `light`, `medium`, `heavy`.
     */
    mode?: string | null;
}
export interface ConveneFlowDeps {
    /**
     * Step 2-3: deliberation, then verdict. `mode` is the resolved sitting
     * mode: the deliberation leg reads its rounds and concurrency from the
     * mode policy (contracts/modes.ts) — this flow does not.
     */
    deliberate(input: {
        permittedBrief: PermittedContextBrief;
        mode: ModeSelection;
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
    /** The resolved mode, its source and the reason — the convene output says why. */
    modeSelection: ModeSelection;
    /** The settled session record, carrying the same mode provenance. */
    session: ConveneSessionRecord;
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
