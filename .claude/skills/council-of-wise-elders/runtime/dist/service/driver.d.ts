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
import { type DecisionBrief, type ModelPolicy, type ScopeFields, type SeatId, type SessionMode, type SessionVisibility } from '../contracts/index.js';
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
    visibility?: SessionVisibility;
    route: RouteChoiceRequest;
    fresh_facts?: FreshFact[];
    requested_by: string;
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
}
export type DriverRefusalCode = 'COMPOSITION_NOT_READY' | 'CONVENE_INPUT_INVALID' | RouteChoiceErrorCode;
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
    onSettled?: (sessionId: string, result: RunSessionResult | {
        status: 'error';
        code: string;
    }) => void;
    /** Pack version stamped on non-sample sessions. */
    sourcePackVersion?: string;
}
export declare function createCouncilDriver(deps: CouncilDriverDeps): {
    convene(input: ConveneInput): Promise<ConveneAccepted>;
    inFlight(): number;
    drain(): Promise<void>;
};
