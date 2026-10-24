/**
 * The ONE canonical run authorization service (CWE-049, directive
 * Sections 1.2, 11, 15, 17.5, 25.6, 28).
 *
 * This service issues, resolves, and revokes purpose-bound run grants
 * (the RunGrant contract of CWE-003) over CWE-006's scoped store. The
 * durable grant record is the council_approvals row with
 * kind 'run_grant': it is the money authority CWE-028's budget service
 * reads (max_cost_minor, status, expiry, session binding), and the full
 * binding (installation, owner, route pin, brief hash, ceilings,
 * revocation epoch, preview hash, standing-parent link) travels in the
 * row's scope_proof as canonical JSON, with the seat allowlist in
 * seat_allowlist_json.
 *
 * Surface (Section 25.6, exactly): previewRun, approveRun,
 * resolveRunGrant, revokeRunGrant here; admitOperation and
 * recordConsumption live in admission.ts, composed on this service and
 * CWE-028's DurableBudgetService. No other module in this build issues
 * grants. Standing authorizations are PRE-EXISTING records by design
 * (Section 25.6: "the host verifies a pre-existing standing grant");
 * provisionStandingAuthorization is the host provisioning path that
 * records one, kept visibly separate from the six canonical operations.
 *
 * Laws enforced here:
 * - Purpose binding: a grant binds principal, scope (installation,
 *   tenant, company, owner), session, purpose, the pinned route
 *   snapshot fingerprint, the frozen brief hash, mode and seats, pack
 *   and protocol versions, allowed operation kinds, ceilings, and
 *   expiry. Previews default to 15 minutes validity, grants to 24
 *   hours; a stricter chosen limit wins; a standing parent's earlier
 *   expiry wins over both.
 * - No bypass: there is no code path in this module that reads a flag,
 *   an environment variable, a file, or model output as approval.
 *   Approval is an explicit decision object carrying a TrustedPrincipal
 *   resolved by the host (CWE-007 ports): a local interactive owner
 *   must additionally present the host's controlling-terminal
 *   confirmation, a managed principal must arrive on a managed channel,
 *   and a standing grant satisfies approval only through the coverage
 *   check in approveRun itself, never through a side door. Headless
 *   approval without one of those three is RUN_AUTHORIZATION_REQUIRED
 *   and the preview (and any draft session) is preserved untouched.
 * - No authority before approval: council_run_previews.grant_id is a
 *   foreign key to council_approvals, so previewRun writes the grant
 *   row and the preview row in one transaction. The pre-approval row is
 *   born with status 'expired' and the preview's own expiry: it is a
 *   durable anchor that confers NOTHING (CWE-028 refuses reservations
 *   under non-active grants, and resolveRunGrant returns null for it).
 *   approveRun is the only transition that makes a row 'active'.
 * - Revocation and expiry are durable and immediate: revocation flips
 *   the row in the same transaction that journals grant_revoked, and
 *   every resolve or admission re-reads the row, so a revoked or
 *   expired grant admits nothing, including replays of an earlier
 *   admission (admission.ts re-checks through this service and through
 *   CWE-028's in-transaction grant check). Expiry is lazy but journaled:
 *   the first resolve or admission that observes a lapsed active grant
 *   flips it to 'expired' and journals the transition; a worker restart
 *   or browser refresh never extends an expiry.
 * - Preview-to-session binding and revoked authority: approveRun
 *   enforces `expected_session_id` when the caller names the approval
 *   session (a preview from session B can never approve session A,
 *   even under one owner), and refuses a preview whose revocation
 *   epoch was overtaken by the session's revocation generation. Both
 *   checks run before the single approval transaction, so a refusal
 *   writes nothing. `resolveRunGrant(..., { mutate_on_expiry: false })`
 *   lets a read-only caller (the WER-009 Start gate) refuse an expired
 *   grant without the lazy expiry transition.
 * - Renewal never resets accounting: reservations and consumption are
 *   session-scoped in CWE-028's ledger, so a renewal grant for the same
 *   session inherits the session's consumed and reserved totals (and a
 *   standing parent's aggregate, which is the same session ledger when
 *   the parent serves that session). approveRun records the renewed
 *   grant id in the new grant's proof; nothing here zeroes a counter.
 * - The journal is the audit trail: preview, approval (including
 *   standing satisfaction), revocation, and observed expiry are
 *   journaled in CWE-006's hash-chained journal under the bound session
 *   with the frozen vocabulary (grant_issued and grant_revoked carry a
 *   grant_kind 'run_grant' discriminator and a lifecycle field, the
 *   same payload-discriminator pattern CWE-006's diagnostic grants and
 *   CWE-028's route outcomes established; no event type is invented).
 *   Admission refusals are journaled by admission.ts.
 * - No credential values exist anywhere in a grant record, a preview,
 *   a journal payload, or an outbox intent: the shapes carry hashes,
 *   references, and presence only.
 */
import { type Clock, type GrantStatus, type IdSource, type RunCeilings, type RunGrant, type RunGrantAuthorityMode, type RunPreview, type RunPurpose } from '../contracts/index.js';
import type { StoredSession } from '../cli/host-ports.js';
import { type PinnedRouteSnapshot } from '../budgets/route-snapshot.js';
import { type AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilRepositories } from '../persistence/repositories.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import { type TrustedPrincipal } from './scope.js';
export type RunAuthorizationErrorCode = 'RUN_AUTHORIZATION_REQUIRED' | 'RUN_CONFIRMATION_REQUIRED' | 'RUN_AUTHORITY_MODE_MISMATCH' | 'RUN_INVALID_INPUT' | 'RUN_SESSION_NOT_FOUND' | 'RUN_PREVIEW_NOT_FOUND' | 'RUN_PREVIEW_EXPIRED' | 'RUN_PREVIEW_STALE' | 'RUN_PREVIEW_TAMPERED' | 'RUN_MONEY_UNBOUNDED' | 'RUN_GRANT_NOT_FOUND' | 'RUN_GRANT_INACTIVE' | 'RUN_GRANT_SCOPE_MISMATCH' | 'RUN_GRANT_ROUTE_MISMATCH' | 'RUN_GRANT_PURPOSE_MISMATCH' | 'RUN_GRANT_KIND_NOT_ALLOWED' | 'RUN_GRANT_PARENT_INVALID' | 'RUN_GRANT_WOULD_BROADEN' | 'RUN_OPERATION_GRANT_MISMATCH' | 'RUN_PREVIEW_SESSION_MISMATCH' | 'RUN_AUTHORITY_REVOKED' | 'RUN_APPROVAL_IDEMPOTENCY_CONFLICT' | 'RUN_APPROVAL_RECEIPT_UNAVAILABLE' | 'RUN_START_APPROVAL_NOT_FOUND' | 'RUN_START_GRANT_REVOKED' | 'RUN_START_GRANT_EXPIRED' | 'RUN_START_GRANT_INACTIVE' | 'RUN_START_SCOPE_MISMATCH';
/**
 * Stable typed refusal for run authorization. Callers branch on `code`,
 * never on message text (Section 17.3 style, matching CWE-006/CWE-028).
 * Messages never carry credential values or private decision text.
 */
export declare class RunAuthorizationError extends Error {
    readonly code: RunAuthorizationErrorCode;
    readonly retryable: boolean;
    readonly action: string;
    readonly detail: Record<string, unknown> | null;
    constructor(code: RunAuthorizationErrorCode, message: string, options?: {
        retryable?: boolean;
        action?: string;
        detail?: Record<string, unknown> | null;
    });
}
export declare function isRunAuthorizationError(value: unknown): value is RunAuthorizationError;
/** Default preview validity (Section 25.6): 15 minutes. */
export declare const DEFAULT_PREVIEW_TTL_MS = 900000;
/** Default grant validity (Section 25.6): 24 hours. */
export declare const DEFAULT_GRANT_TTL_MS = 86400000;
/** The full grant binding carried in council_approvals.scope_proof. */
export interface RunGrantProof {
    proof_version: 'run-grant-proof/v1';
    /** 'preview' until approveRun flips the row active; then 'granted'. */
    stage: 'preview' | 'granted';
    standing: boolean;
    installation_id: string;
    owner_subject: string | null;
    route_policy_sha256: string;
    route_snapshot: PinnedRouteSnapshot | null;
    route_snapshot_fingerprint: string | null;
    brief_sha256: string | null;
    brief_revision: number | null;
    mode: string | null;
    pack_version: string | null;
    protocol_version: string;
    allowed_operation_kinds: string[];
    ceilings: RunCeilings;
    account_ref: string | null;
    preview_id: string | null;
    preview_sha256: string | null;
    revocation_epoch: number;
    renews_grant_id: string | null;
}
/** One council_approvals run_grant row, decoded. */
export interface RunGrantRecord {
    grant_id: string;
    session_id: string | null;
    authority_mode: RunGrantAuthorityMode;
    purpose: RunPurpose;
    issuer_principal: string;
    /** The seat allowlist column, decoded (requested seats for session grants, covered seats for standing records). */
    seat_ids: string[];
    status: GrantStatus;
    issued_at: string;
    expires_at: string;
    revoked_at: string | null;
    revoked_by: string | null;
    consumed_at: string | null;
    max_cost_minor: number | null;
    currency: string | null;
    parent_grant_id: string | null;
    proof: RunGrantProof;
}
export interface PreviewRunInput {
    session_id: string;
    /** Defaults to 'council_run' (Section 25.6). */
    purpose?: RunPurpose;
    /** The pinned CWE-008 route selection this run charges against. */
    route_snapshot: PinnedRouteSnapshot;
    route_policy_sha256: string;
    /** The requested envelope: ceilings the approver will see and bind. */
    ceilings: RunCeilings;
    /** Defaults by purpose; may only name kinds the purpose allows. */
    allowed_operation_kinds?: string[];
    account_ref?: string | null;
    /**
     * When true, the caller requires a hard currency ceiling: a preview
     * whose ceilings carry no money bound is refused rather than allowed
     * to imply a guarantee (an unknown price is not zero, Section 25.6).
     */
    require_money_bound?: boolean;
}
export interface ApproveRunDecision {
    /** The trusted approver, resolved by the host (CWE-007 ports). */
    principal: TrustedPrincipal;
    authority_mode: RunGrantAuthorityMode;
    /**
     * Required true when authority_mode is 'local_interactive_owner':
     * the host asserts the authorized owner confirmed the exact saved
     * preview on the controlling terminal. The service never reads a
     * terminal, a file, or stdin itself; without this assertion the
     * approval is headless and refused.
     */
    interactive_confirmation?: boolean;
    /** Required when authority_mode is 'existing_standing_grant'. */
    standing_parent_grant_id?: string | null;
    /** A stricter chosen expiry; a later one is refused, never applied. */
    chosen_expires_at?: string | null;
    /** May only tighten the previewed ceilings, field by field. */
    chosen_ceilings?: Partial<RunCeilings> | null;
    /** The grant this approval renews, when it is a renewal. */
    renews_grant_id?: string | null;
    /**
     * The route snapshot the host re-resolved at approval time, when it
     * re-resolves: its fingerprint must equal the preview's pin or the
     * preview is stale (a route change is a material change).
     */
    current_route_snapshot?: PinnedRouteSnapshot | null;
    /**
     * The session whose approval URL / approval command was used. When
     * present, the stored preview must belong to exactly this session.
     * Submitting session B's preview through session A's approval URL is
     * refused BEFORE any grant, state, event, or outbox write, even when
     * both sessions share the same owner.
     */
    expected_session_id?: string | null;
}
export interface StandingAuthorizationInput {
    principal: TrustedPrincipal;
    purpose: RunPurpose;
    route_policy_sha256: string;
    pack_version: string;
    /** Seat allowlist the standing authorization covers (superset rule). */
    seat_ids: string[];
    ceilings: RunCeilings;
    allowed_operation_kinds?: string[];
    account_ref?: string | null;
    /** Standing authorizations always carry an explicit expiry. */
    expires_at: string;
}
export interface RunAuthorizationServiceDeps {
    db: CouncilDatabase;
    clock: Clock;
    ids: IdSource;
    /** Preview validity; defaults to DEFAULT_PREVIEW_TTL_MS (15 minutes). */
    previewTtlMs?: number;
    /** Grant validity; defaults to DEFAULT_GRANT_TTL_MS (24 hours). */
    grantTtlMs?: number;
}
export declare class RunAuthorizationService {
    private readonly db;
    private readonly clock;
    private readonly ids;
    private readonly previewTtlMs;
    private readonly grantTtlMs;
    readonly repositories: CouncilRepositories;
    constructor(deps: RunAuthorizationServiceDeps);
    /**
     * Freeze a run preview: the exact data-sharing scope, mode and seats,
     * route pin, and maximum allowance the approver will be shown. A
     * preview confers no authority. It is stale immediately on any
     * material change, which approveRun detects by re-deriving the
     * session facts and comparing hashes. No provider call happens here.
     */
    previewRun(envelope: AuthorizationEnvelope, input: PreviewRunInput): RunPreview;
    /**
     * Approve a preview into an active grant. Three authority paths, and
     * no fourth: an authorized owner approving interactively on the
     * controlling terminal (local_interactive_owner), a host-verified
     * managed principal (managed_principal), or a pre-existing standing
     * grant that verifiably covers the exact envelope
     * (existing_standing_grant). No provider call happens here.
     */
    approveRun(envelope: AuthorizationEnvelope, previewId: string, decision: ApproveRunDecision): RunGrant;
    /**
     * Resolve a grant reference to the canonical RunGrant, or null. Null
     * covers: unknown id, another scope's grant, a session mismatch, a
     * pre-approval preview anchor, a revoked grant, an expired grant
     * (lazily transitioned and journaled on first observation), a grant
     * whose standing parent no longer stands, and a grant fenced by the
     * session's revocation generation. Callers never learn which case
     * from this method; admission reports its own typed reason.
     */
    resolveRunGrant(envelope: AuthorizationEnvelope, grantRef: string, sessionId?: string, options?: {
        mutate_on_expiry?: boolean;
    }): RunGrant | null;
    /**
     * Revoke a grant, durably and immediately: the row flip and the
     * grant_revoked journal event commit in one transaction, and every
     * later resolve or admission re-reads the row. Revoking an already
     * revoked or expired grant is reported, not re-journaled.
     */
    revokeRunGrant(envelope: AuthorizationEnvelope, grantId: string, revoker: TrustedPrincipal): {
        grant_id: string;
        status: GrantStatus;
        already_final: boolean;
    };
    /**
     * Host provisioning for a PRE-EXISTING standing authorization (the
     * record approveRun's existing_standing_grant path verifies). This is
     * not one of the six canonical operations: standing authorizations are
     * created by host administration (managed tenant configuration or the
     * standalone owner's recorded standing instruction), never by a run
     * flow, and this method is the single write path for such a record.
     * A standing record binds scope, purpose, route policy, pack, a seat
     * allowlist, and ceilings; it can never authorize task creation or
     * external execution (Section 1.2: it is a council_run authorization
     * only, and its purpose field cannot name anything else).
     */
    provisionStandingAuthorization(envelope: AuthorizationEnvelope, input: StandingAuthorizationInput): RunGrantRecord;
    /** Load one run_grant record in the envelope scope, or null. */
    loadGrantRecord(envelope: AuthorizationEnvelope, grantId: string): RunGrantRecord | null;
    /** The bound session, or a typed not-found refusal. */
    sessionFor(envelope: AuthorizationEnvelope, sessionId: string): StoredSession;
    /**
     * Flip an active-but-lapsed grant to 'expired' and journal the
     * transition. Returns true when this call performed the transition.
     * Called on the resolve and admission paths, so expiry takes effect
     * at first observation and never depends on a sweep or a restart.
     */
    expireGrantIfLapsed(envelope: AuthorizationEnvelope, record: RunGrantRecord): boolean;
    /** True when a standing parent currently stands (active, unexpired, granted stage). */
    standingParentStands(parent: RunGrantRecord): boolean;
    /**
     * Journal an admission refusal under its session (admission.ts calls
     * this in its own transaction, so the refusal is durable even though
     * the admission itself is refused). No-ops when the session does not
     * exist in scope: there is no journal to write to, and the typed
     * error still reaches the caller.
     */
    journalAdmissionRefused(envelope: AuthorizationEnvelope, sessionId: string, detail: {
        grant_id: string | null;
        operation_id: string;
        code: string;
    }): void;
    /** Mark a grant's first consumption time (accounting bookkeeping). */
    markConsumed(envelope: AuthorizationEnvelope, grantId: string): void;
    private approvalRow;
    private previewRow;
    /** Recompute the preview hash from the stored JSON; tamper is a refusal. */
    private verifyPreviewRow;
    /**
     * Freshness at approval: the preview must be inside its validity, and
     * every material input (brief revision and hash, mode, seats, pack,
     * scope, route pin) must still equal what the preview froze. Any
     * change stales the preview immediately (Section 25.6).
     */
    private assertPreviewFresh;
    /**
     * Standing coverage: the parent must stand in the same tenant and
     * company, bind the same installation, owner, purpose, route policy,
     * and pack, cover every requested seat, and carry ceilings at least
     * the previewed ones, field by field, in the same currency. A parent
     * that fails any field covers nothing (T141: no broader scope, ever).
     */
    private assertStandingCoverage;
    private assertPrincipalMatchesEnvelope;
    private assertCeilings;
    private allowedKinds;
    /**
     * Build the canonical RunGrant for an active record: the stored
     * binding plus live consumed and reserved counters derived from
     * CWE-028's reservation ledger for this grant (never a second
     * ledger: the counters are a read model over the reservation rows).
     */
    private toRunGrant;
    private grantCounters;
}
