/**
 * The usable approval front door (WER-009 dependency-ready slice).
 *
 * One structured approval command, one idempotency key, one committed
 * receipt. This module is the user-facing front door in front of the
 * ONE existing authority service (`RunAuthorizationService` in
 * run-grants.ts, consumed here, never duplicated). It owns NO second
 * authority database: the durable grant, preview, journal, outbox, and
 * the idempotency registry are the existing CWE-006/CWE-049 rows. The
 * request-key row written here lives in the existing
 * `council_request_keys` table, the same registry WER-011's durable
 * operation producer uses; no new table is introduced.
 *
 * Laws:
 *
 * - The fingerprint covers the ENTIRE normalized approval command:
 *   trusted scope and acting principal, session, preview, authority
 *   mode, interactive confirmation, chosen ceilings, chosen expiry,
 *   standing-parent linkage, renewal linkage, and the route options
 *   (route policy hash, the preview's pinned route fingerprint, the
 *   host's re-resolved CWE-008 snapshot fingerprint, the WER-006
 *   frozen-route snapshot hash, and any host-exposed route options).
 *   An exact retry with the same idempotency key returns the ORIGINAL
 *   committed receipt and creates no second grant. The same key with
 *   ANY changed option conflicts BEFORE any write; the conflict path
 *   is a read-only check outside a transaction.
 *
 * - Preview-to-session association is checked before anything else.
 *   A preview minted for session B and submitted to session A's
 *   approval command is refused with RUN_PREVIEW_SESSION_MISMATCH and
 *   zero grant, session-state, journal, outbox, or request-key writes,
 *   even when both sessions have the same owner. `approveRun` also
 *   enforces `expected_session_id` itself, so the same guard holds for
 *   callers that compose the service directly.
 *
 * - Principal and scope checks are the trusted CWE-007 checks, reused:
 *   the envelope must match the host-resolved TrustedPrincipal, the
 *   preview must belong to the named session in the same tenant,
 *   company, and installation, and the service's existing
 *   assertSessionMutate rule still decides who may approve a private
 *   session.
 *
 * - Revoked and expired authority refuses WITHOUT mutating state. The
 *   start path re-reads the durable record and refuses a revoked
 *   record, an elapsed expiry, or a session whose revocation
 *   generation advanced past the grant's epoch. It deliberately does
 *   NOT call the service's lazy expiry transition on the refusal path,
 *   so a refused Start leaves every row untouched.
 *
 * - Start does not require a fabricated grant id. A new user approves
 *   with a structured command and starts with the SAME idempotency
 *   key: the front door resolves the committed grant through the
 *   request-key row. Start is read-only and therefore idempotent by
 *   construction; retrying it returns the same grant and writes
 *   nothing.
 *
 * Authority separation (directive Section 1.2, non-negotiable):
 * a Council spending authorization is `council_run` ONLY. It is NOT
 * development merge permission and it is NOT `action_plan_approval`
 * or `execution` authority. Nothing here approves a plan, creates a
 * task, executes an external action, or authorizes a merge; those
 * remain separate authorization kinds with separate grants
 * (`AUTHORIZATION_KIND_FOR_PERMISSION` in permissions.ts). A run
 * grant that exists says only that the inferred run's spending
 * envelope was approved.
 */
import { type AuthorizationKind, type Clock, type RunCeilings, type RunGrant, type RunGrantAuthorityMode, type RunPreview, type RunPurpose } from '../contracts/index.js';
import { type PinnedRouteSnapshot } from '../budgets/index.js';
import type { AuthorizationEnvelope } from '../persistence/envelope.js';
import type { CouncilDatabase } from '../persistence/sqlite.js';
import { type CouncilRouteSnapshot } from '../providers/route-snapshot.js';
import { RunAuthorizationService } from './run-grants.js';
import { type TrustedPrincipal } from './scope.js';
/** The idempotency registry source for approval commands. */
export declare const APPROVAL_IDEMPOTENCY_SOURCE = "council-run-approval";
/** The idempotency registry operation for approval commands. */
export declare const APPROVAL_IDEMPOTENCY_OPERATION = "approve";
/** Receipt schema identifier. */
export declare const APPROVAL_RECEIPT_VERSION = "wise-elders.approval-receipt/v1";
/**
 * A Council spending authorization is this kind and nothing else.
 * `permissions.ts` maps it to the 'run' permission; development merge
 * permission and `action_plan_approval`/`execution` are different
 * kinds and never travel as this constant.
 */
export declare const COUNCIL_SPENDING_AUTHORIZATION_KIND: AuthorizationKind;
/** Host-exposed route options the approver can change (scalar map). */
export type RouteOptions = Readonly<Record<string, string | number | boolean | null>>;
/**
 * The structured approval command. This is the front door's input: a
 * caller supplies typed values, never raw JSON, and never a grant id.
 */
export interface ApprovalCommand {
    /** One approval interaction. The retry key; never a grant id. */
    idempotency_key: string;
    /** The session whose approval surface received this command. */
    session_id: string;
    preview_id: string;
    authority_mode: RunGrantAuthorityMode;
    /** Required true for local_interactive_owner (host confirmation). */
    interactive_confirmation?: boolean;
    /** Required for existing_standing_grant. */
    standing_parent_grant_id?: string | null;
    /** May only tighten the previewed expiry. */
    chosen_expires_at?: string | null;
    /** May only tighten the previewed ceilings, field by field. */
    chosen_ceilings?: Partial<RunCeilings> | null;
    /** The grant this approval renews, when it is a renewal. */
    renews_grant_id?: string | null;
    /** The host's re-resolved CWE-008 route snapshot (approval-time pin). */
    current_route_snapshot?: PinnedRouteSnapshot | null;
    /** The WER-006 frozen route snapshot, when the host carries it. */
    route_snapshot?: CouncilRouteSnapshot | null;
    /** Additional route options shown to the approver. */
    route_options?: RouteOptions | null;
}
/** The structured preview command: no route-snapshot JSON file needed. */
export interface PreviewCommand {
    session_id: string;
    purpose?: RunPurpose;
    route_snapshot: PinnedRouteSnapshot;
    route_policy_sha256: string;
    ceilings: RunCeilings;
    allowed_operation_kinds?: string[];
    account_ref?: string | null;
    require_money_bound?: boolean;
}
/**
 * The Start command. It names the session and the approval's
 * idempotency key. It has no grant-id field: the front door resolves
 * the committed grant itself, so a user never fabricates one.
 */
export interface StartCommand {
    session_id: string;
    approval_idempotency_key: string;
}
/** The normalized command the fingerprint is computed over. */
export interface NormalizedApprovalCommand {
    idempotency_key: string;
    session_id: string;
    preview_id: string;
    authority_mode: RunGrantAuthorityMode;
    interactive_confirmation: boolean;
    standing_parent_grant_id: string | null;
    chosen_expires_at: string | null;
    chosen_ceilings: Partial<RunCeilings> | null;
    renews_grant_id: string | null;
    current_route_snapshot: PinnedRouteSnapshot | null;
    route_snapshot_sha256: string | null;
    route_options: RouteOptions | null;
}
/**
 * The committed approval receipt. Built only from durable rows
 * (grant record + committed request-key row), so an exact retry
 * reconstructs the ORIGINAL receipt byte for byte. It intentionally
 * reports what was approved, not the grant's live status: a later
 * revocation changes Start admission, never the historical receipt.
 */
export interface ApprovalReceipt {
    schema_version: typeof APPROVAL_RECEIPT_VERSION;
    /** Canonical hash of every other receipt field. */
    receipt_id: string;
    idempotency_key: string;
    command_fingerprint: string;
    preview_id: string;
    preview_sha256: string;
    grant_id: string;
    session_id: string;
    authority_mode: RunGrantAuthorityMode;
    purpose: RunPurpose;
    approved_ceilings: RunCeilings;
    issued_at: string;
    expires_at: string;
    standing_parent_grant_id: string | null;
    renews_grant_id: string | null;
    /** The Start handle: no fabricated grant id is ever required. */
    start: {
        session_id: string;
        approval_idempotency_key: string;
    };
}
export interface ApprovalOutcome {
    /** True when this call replayed the committed receipt. */
    replayed: boolean;
    receipt: ApprovalReceipt;
}
export interface StartOutcome {
    /** The resolved active grant; identical on every idempotent retry. */
    grant: RunGrant;
    /** The ORIGINAL committed approval receipt. */
    receipt: ApprovalReceipt;
    start: {
        session_id: string;
        /** The caller passes this to the existing Start command. */
        grant_ref: string;
    };
}
/**
 * Normalize one approval command. Pure: no database access, no writes.
 * Every value the fingerprint covers is present in the returned shape.
 */
export declare function normalizeApprovalCommand(command: ApprovalCommand): NormalizedApprovalCommand;
/** Normalize the Start command. Pure; no grant id is accepted or needed. */
export declare function normalizeStartCommand(command: StartCommand): StartCommand;
export interface ApprovalFrontDoorDeps {
    /** The ONE existing authority service. Not a second one. */
    grants: RunAuthorizationService;
    db: CouncilDatabase;
    clock: Clock;
}
export declare class ApprovalFrontDoor {
    private readonly grants;
    private readonly db;
    private readonly clock;
    constructor(deps: ApprovalFrontDoorDeps);
    /**
     * Freeze a run preview from structured values. A caller never has to
     * author a route-snapshot JSON file or a limits file; the host
     * supplies the already-resolved CWE-008 snapshot in memory.
     */
    preview(envelope: AuthorizationEnvelope, command: PreviewCommand): RunPreview;
    /**
     * Approve a preview idempotently. Read-only preflight first: a
     * replay returns the committed receipt; a changed option under an
     * already-committed key conflicts with zero writes. Only a genuinely
     * new command enters the single write transaction, which nests the
     * existing `approveRun` write and commits the request-key row with
     * it.
     */
    approve(envelope: AuthorizationEnvelope, principal: TrustedPrincipal, command: ApprovalCommand): ApprovalOutcome;
    /**
     * Resolve Start authority from the approval's idempotency key.
     * Read-only: no grant, state, event, or request-key write happens on
     * this path, including every refusal. A revoked record, a lapsed
     * expiry, or an advanced session revocation generation refuses
     * without mutating the store.
     */
    start(envelope: AuthorizationEnvelope, principal: TrustedPrincipal, command: StartCommand): StartOutcome;
    private assertPrincipalMatchesEnvelope;
    private readPreviewContext;
    private approvalCommandFingerprint;
    private replay;
    private buildReceipt;
    /**
     * Namespace the caller's idempotency key by company and installation.
     * The registry's primary key is (tenant, source, operation,
     * request_key); two companies in one tenant must never share an
     * approval slot because they used the same click key.
     */
    private requestKey;
    private readRequestKey;
    private insertRequestKey;
}
