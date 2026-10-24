/**
 * Authorization CLI handlers and the standalone composition for the
 * run authorization service (CWE-049, directive Sections 25.3, 25.4,
 * 25.6).
 *
 * This module owns the `authorization preview|approve|status|revoke`
 * command handlers behind CWE-004's stable dispatcher interface. The
 * dispatcher case for `authorization` still returns FEATURE_NOT_READY
 * in the foundation build; CWE-050 performs the final composition by
 * delegating that case to handleAuthorizationCommand below (named in
 * the CWE-049 build report). Handlers here are complete and tested in
 * an isolated profile without the final packaging.
 *
 * Standalone trust boundary (stated precisely, Section 25.4): the
 * standalone host is a single-user local profile. The trust boundary
 * is the local OS account: whoever controls the OS account controls
 * the profile's data directory and can approve runs as the local
 * owner. This protects against other OS accounts and against remote
 * or model-side actors; it does NOT protect against a malicious
 * process running with the same owner's privileges, and nothing here
 * claims otherwise. A local installation UUID is a workspace
 * namespace, never cross-company authority.
 *
 * First standalone use provisions a stable local installation UUID
 * and workspace namespace in protected configuration
 * (council-installation.json in the data directory, mode 0600). The
 * provisioned scope is what this module's sessions, envelopes, and
 * grants bind to.
 *
 * Approval interaction law: approve renders the exact saved preview
 * and takes confirmation from the controlling terminal through the
 * injected confirmPreview callback (the host shell wires it to the
 * terminal; it is never stdin data, never a flag, never a file). In
 * --json mode, machine results go to stdout and confirmation still
 * uses the controlling terminal callback. When no callback is wired
 * (headless), approval is refused with RUN_AUTHORIZATION_REQUIRED
 * unless a valid standing grant covers the preview, and the draft and
 * preview are preserved. There is deliberately no --yes flag, no
 * environment variable, and no approval-file path anywhere in this
 * module: the argument parser below reads only the documented flags,
 * and a test proves that presenting bypass-shaped flags changes
 * nothing.
 */
import { type ScopeFields } from '../contracts/index.js';
import { DurableBudgetService } from '../budgets/index.js';
import { type AuthorizationEnvelope } from '../persistence/envelope.js';
import { CouncilRepositories } from '../persistence/repositories.js';
import { CouncilDatabase } from '../persistence/sqlite.js';
import { RunAdmissionService, RunAuthorizationService, type TrustedPrincipal } from '../authorization/index.js';
import type { AuthorizationProvider, CouncilHost } from './host-ports.js';
export interface StandaloneInstallation {
    installation_id: string;
    tenant_id: string;
    company_id: string;
    owner_subject: string;
    created_at: string;
}
/**
 * Resolve the standalone installation scope, provisioning it on first
 * use: a stable local installation UUID and workspace namespace in
 * protected configuration (Section 25.4). An existing file is read,
 * never regenerated, so the namespace is stable across restarts.
 */
export declare function resolveStandaloneInstallation(dataDir: string): StandaloneInstallation;
export declare function standaloneScope(installation: StandaloneInstallation): ScopeFields;
export declare function standalonePrincipal(installation: StandaloneInstallation): TrustedPrincipal;
export declare function standaloneEnvelope(installation: StandaloneInstallation, purpose?: AuthorizationEnvelope['purpose']): AuthorizationEnvelope;
export interface RunAuthorizationComposition {
    installation: StandaloneInstallation;
    db: CouncilDatabase;
    repositories: CouncilRepositories;
    budget: DurableBudgetService;
    grants: RunAuthorizationService;
    admission: RunAdmissionService;
    envelope: AuthorizationEnvelope;
    principal: TrustedPrincipal;
    /** The host-ports AuthorizationProvider the engine resolves through. */
    authorize: AuthorizationProvider;
    close(): void;
}
/**
 * Compose the standalone run authorization stack over the profile's
 * own authorization database in the data directory (canonical CWE-005
 * schema, CWE-006 store). Sessions are mirrored into this store from
 * the host's session store by mirrorSession before preview, so the
 * journal, budget, and grant records share one durable home.
 */
/**
 * Compose the standalone run authorization stack over the installation's
 * ONE canonical council database (`<dataDir>/council.db`).
 *
 * Store-seam law (W25-U001 Lane E): the CLI host store, this authorization
 * composition and the service composition engine all open the same file.
 * A separate `council-authorization.db` made `mirrorSession` write canonical
 * `council_sessions`/`council_events` rows into a database the service never
 * reads, so a session created by `blackceo-council create` was invisible to
 * `GET /council/<id>` and its event stream. The local foundation tables
 * (`sessions`, `events`, ...) and the canonical `council_*` tables share the
 * file without collision because their names are disjoint.
 */
export declare function createStandaloneRunAuthorization(options: {
    dataDir: string;
    clock?: {
        nowUtc(): string;
    };
    ids?: {
        newId(): string;
    };
}): RunAuthorizationComposition;
/**
 * Mirror a session from the host's session store into the
 * authorization store (idempotent: an existing mirror is returned).
 * The mirror carries the same spec, brief, scope, and state record, so
 * previews freeze exactly what the host froze.
 */
export declare function mirrorSession(composition: RunAuthorizationComposition, session: import('./host-ports.js').StoredSession): void;
/** Compose the service into a local host (CWE-050's integration step, prebuilt here). */
export declare function withRunAuthorization(host: CouncilHost, composition: RunAuthorizationComposition): CouncilHost;
export interface AuthorizationCliIo {
    out(text: string): void;
    err(text: string): void;
}
export interface AuthorizationCliOptions {
    dataDir: string;
    json: boolean;
    io: AuthorizationCliIo;
    /**
     * Controlling-terminal confirmation for interactive approval: the
     * host shell renders the preview text and returns the owner's
     * decision. Absent means headless: approval then requires a valid
     * standing grant, else RUN_AUTHORIZATION_REQUIRED.
     */
    confirmPreview?: (previewText: string) => Promise<boolean>;
    clock?: {
        nowUtc(): string;
    };
    ids?: {
        newId(): string;
    };
}
/**
 * The authorization command handlers (preview, approve, status,
 * revoke). Argument arrays and flags arrive from the dispatcher;
 * results print as clean JSON (--json) or a short human summary, and
 * failures are CouncilError envelopes the dispatcher already renders.
 */
export declare function handleAuthorizationCommand(sub: string | undefined, positionals: string[], flags: Map<string, string | true>, options: AuthorizationCliOptions): Promise<void>;
