/**
 * Council service driver (W28, decisions 2 and 5).
 *
 * A session convened through the service must actually be deliberated:
 * create the session, approve the run, then hand it to runSession in the
 * background over the service's own database, so the existing
 * repositories journal every transition, card and verdict into
 * council_events (which the SSE route streams).
 *
 * CONVENING = APPROVAL (Trevor decision 2026-10-19). The client chose
 * the model and pays for it, so the driver builds the run preview and
 * approves it on the owner's behalf in the same call, using the existing
 * authority mode 'local_interactive_owner' with interactive_confirmation
 * true: the confirmation IS the client's convene act. The authority enum
 * and DB CHECK are untouched (no migration). There is no money ceiling
 * and no extra prompt. The approval row plus one append-only JSONL audit
 * line per run is the audit record. The 50-provider-request ceiling is
 * the protocol's own runaway guard, not a spend gate.
 *
 * No content is invented: the sample path only rebinds the built-in
 * synthetic sample brief (cli/fixture-transport.ts) to a new session id,
 * and every card comes from the resolved route's transport.
 */
import type { TrustedPrincipal } from '../authorization/index.js';
import type { PinnedRouteSnapshot } from '../budgets/route-snapshot.js';
import type { Clock, IdSource } from '../cli/host-ports.js';
import { type ProposalInferenceRequest } from '../brief/proposal-stage.js';
import { type CouncilSize, type DecisionBrief, type ModelPolicy, type RunCeilings, type ScopeFields, type SeatId, type SessionMode, type SessionVisibility } from '../contracts/index.js';
import { type OllamaPlan } from '../providers/parallel.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { DeliberationService, RunSessionResult } from '../protocol/composition.js';
export type RouteChoiceErrorCode = 'ROUTE_CHOICE_REQUIRED' | 'ROUTE_NOT_CONFIGURED' | 'ROUTE_NOT_COMPOSABLE' | 'ROUTE_MODEL_LIST_UNAVAILABLE' | 'ROUTE_LATEST_FLASH_NOT_FOUND' | 'ROUTE_MODEL_NOT_OFFERED';
export interface RouteChoiceRequest {
    route_id?: string | null;
    model?: string | null;
    harness?: 'claude-nine' | 'claude-code' | 'deepseek' | 'unknown' | null;
}
export interface ResolvedSessionRoute {
    snapshot: PinnedRouteSnapshot;
    model_policy: ModelPolicy;
    model_label: string;
    selection_source: 'explicit' | 'client_default';
    harness: string | null;
}
/**
 * CTR-134: the configured runtime model request adapter, bound to the exact
 * route/model the caller's convene resolved. The service composition supplies
 * this from `transportForSnapshot(snapshot)` — the SAME adapter the sitting
 * uses — in its one-shot form (one attempt, no retry, no fallback).
 */
export type PreparationInference = (route: ResolvedSessionRoute, request: ProposalInferenceRequest, context: {
    session_id: string;
}) => Promise<{
    text: string;
}>;
/** Bounded preparation accounting shown with the accepted sitting. */
export interface PreparationRecord {
    state: 'prepared';
    request_budget: 1;
    request_count: 1;
    route_id: string;
    model_label: string;
    alternatives_are_proposals: true;
}
/** A web finding gathered by the convening agent (sources/elder-knowledge.ts). */
export interface FreshFact {
    claim: string;
    url: string;
    title: string | null;
    retrieved_at: string;
}
export interface ConveneInput {
    /** Built-in harmless sample decision, rebound to a new session id. */
    sample?: boolean;
    brief?: DecisionBrief;
    mode?: SessionMode;
    seat_ids?: SeatId[];
    /** The client's Ollama plan; remembered in <dataDir>/provider-plan.json. */
    ollama_plan?: OllamaPlan | null;
    /** OpenRouter model to fall back to when the primary route is Ollama. */
    fallback_model?: string | null;
    visibility?: SessionVisibility;
    route: RouteChoiceRequest;
    fresh_facts?: FreshFact[];
    requested_by: string;
}
/** Rounds a council size may run, as the client-facing summary prints them. */
export interface ConveneRoundsPolicy {
    min_rounds: number;
    max_rounds: number;
    stop_from_round: number | null;
}
/**
 * Why and how the sitting's mode was chosen (W77S AUTO-MODE-1062). The
 * client sees this with the session: `mode` is the mode the run uses,
 * `source` says who picked it — the client explicitly, or the automatic
 * classification of the question — and `reason` says why.
 */
export interface ModeSelection {
    mode: SessionMode;
    source: 'client' | 'auto';
    reason: string;
}
export interface ConveneAccepted {
    session_id: string;
    state: string;
    sample: boolean;
    route_id: string;
    model_label: string;
    selection_source: 'explicit' | 'client_default';
    grant_id: string;
    session_path: string;
    events_path: string;
    /** Real session mode (light/medium/heavy or one of the four older modes). */
    mode: SessionMode;
    /** The mode, its source (client|auto) and the reason it was chosen. */
    mode_selection: ModeSelection;
    /** Panel seats the run actually uses. */
    seats: number;
    /** null for the four older modes, whose round shape is fixed. */
    rounds: ConveneRoundsPolicy | null;
    /** The enforced provider-request cap for this session. */
    request_cap: number;
    /** Seats dispatched at once (1 for the older modes, today's behaviour). */
    parallel_limit: number;
    /** One plain line: the fallback route, or none and why. */
    fallback: string;
    /**
     * Present only when the brief carried no substantive alternative and ONE
     * preparatory request proposed them. The alternatives are labelled
     * proposals, never client facts, and the sitting's cap already accounts
     * for the request.
     */
    preparation?: PreparationRecord;
}
export type DriverRefusalCode = 'COMPOSITION_NOT_READY' | 'CONVENE_INPUT_INVALID' | 'COUNCIL_PREPARATION_REQUIRED' | 'OLLAMA_PLAN_REQUIRED' | RouteChoiceErrorCode;
export declare class DriverRefusal extends Error {
    readonly code: DriverRefusalCode;
    readonly recovery: string;
    readonly http_status: 409 | 422 | 503;
    readonly detail: Record<string, unknown>;
    constructor(code: DriverRefusalCode, message: string, recovery: string, http_status: 409 | 422 | 503, detail?: Record<string, unknown>);
}
export interface CouncilDriverDeps {
    deliberation: DeliberationService;
    /** Owner write envelope. */
    envelope: AuthorizationEnvelope;
    scope: ScopeFields;
    /** Principal arriving through the local_owner channel. */
    principal: TrustedPrincipal;
    clock: Clock;
    ids: IdSource;
    resolveRoute: (req: RouteChoiceRequest) => Promise<ResolvedSessionRoute>;
    recordFreshFacts?: (sessionId: string, facts: FreshFact[]) => void;
    /** <dataDir>/convening-audit.jsonl */
    auditLogPath: string;
    /** Durable data directory for the remembered Ollama plan. Defaults to dirname(auditLogPath). */
    dataDir?: string;
    onSettled?: (sessionId: string, result: RunSessionResult | {
        status: 'error';
        code: string;
    }) => void;
    /** Pack version stamped on non-sample sessions. */
    sourcePackVersion?: string;
    /**
     * CTR-134: the configured adapter used for the ONE preparatory request.
     * Absent means an exploratory brief is refused as input-needed instead of
     * being scored on an invented option.
     */
    prepareInference?: PreparationInference;
}
export declare function ceilingsForMode(mode: SessionMode): RunCeilings;
/** The round shape a council size runs, for the client-facing summary. */
export declare function roundsPolicyOf(mode: CouncilSize): ConveneRoundsPolicy;
/**
 * Resolve the sitting's mode through the ONE selector (flow/mode-select.ts).
 *
 * An explicit client mode always wins verbatim — all seven SESSION_MODES,
 * including the four older ones, whose round shape stays fixed. With no
 * explicit mode the question's complexity decides (light / medium / heavy).
 * A question with no text at all cannot be classified, so the old default
 * holds: medium, with a reason that says so rather than inventing a score.
 */
export declare function resolveModeSelection(explicit: SessionMode | undefined, question: string): ModeSelection;
export declare function createCouncilDriver(deps: CouncilDriverDeps): {
    convene(input: ConveneInput): Promise<ConveneAccepted>;
    inFlight(): number;
    drain(): Promise<void>;
};
