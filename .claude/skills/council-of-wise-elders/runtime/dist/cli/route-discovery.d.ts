/**
 * Read-only discovery of the client's EXISTING configured routes
 * (RP-046-1 repair for DEFECT-046-A; WER-007 host-configuration slice;
 * directive Sections 13.4, 25.2 step 7, 25.6).
 *
 * The standalone composition binds to the route configuration the
 * client already has on this machine. Discovery reads that
 * configuration; it never writes it, never creates a parallel config
 * format, never registers a new surface, and never copies a credential
 * value anywhere (credential state is recorded as presence by NAME only;
 * a value is resolved at flight time through the resolver the local host
 * composes, Section 13.7).
 *
 * HOST LAYOUT (WER-007). Nothing here assumes `~/.openclaw` and nothing
 * assumes JSON:
 *
 * - the config root is `OPENCLAW_ROOT`, then `OC_ROOT`, then `OC_CONFIG`,
 *   then the existing platform default (`$HOME/.openclaw`, or
 *   `/data/.openclaw` on a Linux box where that installation exists);
 * - the config file is the explicit `OPENCLAW_CONFIG_PATH` / `OC_JSON` /
 *   `CONFIG_JSON`, else `openclaw.json`, `openclaw.json5` or
 *   `openclaw.jsonc` inside that root. `.json5`/`.jsonc` are parsed with
 *   the JSON5 reader below, so a host that uses comments, unquoted keys,
 *   single quotes or trailing commas is read as written;
 * - the selected agent's workspace is
 *   `OPENCLAW_WORKSPACE_PATH` / `OPENCLAW_WORKSPACE_ROOT`, then the
 *   selected agent entry (`agents.entries.<id>.workspace`, legacy
 *   `agents.list[id].workspace`), then `agents.defaults.workspace`, then
 *   `<root>/workspace` — the same resolver `install.sh` and
 *   `update-skills.sh` use;
 * - the state root is the host root itself (agent homes, logs,
 *   credentials, secrets env and skills all live under it);
 * - extra skill directories come from `OPENCLAW_SKILLS_DIR` /
 *   `OC_SKILLS_DIR`, `<root>/skills`, and the configuration's own
 *   `skills.load.extraDirs` / `skills.extraDirs`.
 *
 * ROUTES. Two existing configuration families are discovered:
 *
 * 1. Harness config roots (Section 13.4 adapter 3): a Claude Code /
 *    Claude-Nine config root that exists on this machine
 *    (~/.claude-nine, ~/.claude, or the directory CLAUDE_CONFIG_DIR
 *    names for the .claude root) is a configured harness route. The
 *    route id is `<slug>-configured`, exactly the id a session spec
 *    pins for that harness (the CWE-046 canary pinned
 *    `claude-nine-configured`).
 *
 * 2. OpenClaw provider configuration (Section 13.4 adapter 1): each
 *    `models.providers` entry is a configured route, route id
 *    `<provider>-configured`. The wire model is the configuration's OWN
 *    selection: the agent default primary when it names this provider,
 *    else the single allowed model, else the provider's single listed
 *    model. More than one candidate is AMBIGUOUS and is refused, never
 *    guessed. The API family is classified from the provider's declared
 *    `api`; only an OpenAI-compatible endpoint is composed here, and a
 *    provider of another family fails explicitly instead of being
 *    reinterpreted as compatible.
 *
 * FAILURE IS EXPLICIT. Every route carries a typed `failure`
 * (`ROUTE_MODEL_AMBIGUOUS`, `ROUTE_API_FAMILY_UNSUPPORTED`,
 * `ROUTE_SECRET_REFERENCE_UNRESOLVED`, ...). `discoverConfiguredRoutes`
 * stays total and reports discovered-but-uncomposed routes; the strict
 * `resolveRouteForDispatch` / `discoverRouteSnapshot` entry points throw
 * a `RouteDiscoveryError` with the same code, so no developer default
 * can silently stand in for the host's real answer.
 *
 * IDENTITY. A discovered route is `configured` identity only.
 * `buildRouteSnapshot` freezes it through the WER-006 contract
 * (`freezeRouteSnapshot`), where configured identity and
 * transport-reported identity are separate fields. Discovery never
 * reports transport identity: an unreported fixed route and every
 * unreported combination member stay `UNKNOWN` with an explicit reason.
 *
 * SECRETS. A named reference (`${NAME}`, `$NAME`, `env:NAME`, or an
 * object form) is resolved by NAME through the host's existing stores
 * (process env, the config's own `env` block, `<root>/secrets/.env`,
 * `<root>/.env`). The reference text and the stores checked are
 * recorded; the VALUE never is, and every error message built here is
 * scrubbed of candidate values before it is thrown.
 */
import type { CredentialSourceName } from '../providers/selection.js';
import { type CouncilRouteSnapshot, type RouteApiFamily, type RouteSnapshotLimits, type RouteSnapshotReasoning, type TransportReportedRouteIdentity } from '../providers/route-snapshot.js';
import type { RouteCapabilitySnapshot, TrustedScope } from '../providers/selection.js';
export type DiscoveredRouteKind = 'harness' | 'compatible' | 'unsupported';
/** Precise, secret-free route-discovery failure codes. */
export type RouteDiscoveryFailureCode = 'ROUTE_HOST_ROOT_AMBIGUOUS' | 'ROUTE_HOST_CONFIG_AMBIGUOUS' | 'ROUTE_HOST_CONFIG_MISSING' | 'ROUTE_HOST_CONFIG_INVALID' | 'ROUTE_ID_UNKNOWN' | 'ROUTE_HARNESS_EXECUTABLE_MISSING' | 'ROUTE_ENDPOINT_MISSING' | 'ROUTE_API_FAMILY_UNSUPPORTED' | 'ROUTE_MODEL_MISSING' | 'ROUTE_MODEL_AMBIGUOUS' | 'ROUTE_SECRET_REFERENCE_UNRESOLVED';
export interface RouteFailure {
    code: RouteDiscoveryFailureCode;
    /** Secret-free explanation: names, API families and paths only. */
    detail: string;
}
/** Typed, secret-free discovery failure. */
export declare class RouteDiscoveryError extends Error {
    readonly code: RouteDiscoveryFailureCode;
    readonly checked: string[];
    constructor(code: RouteDiscoveryFailureCode, detail: string, checked?: string[]);
}
/** Presence-only credential record (Section 13.7): names, never values. */
export interface DiscoveredCredential {
    state: 'present' | 'absent' | 'not_required';
    envVar: string | null;
    source: CredentialSourceName | null;
    /** The reference text as configured (for example `${OPENAI_API_KEY}`). */
    reference: string | null;
    /** Stores checked, by name/path. Never a value. */
    checked: string[];
}
export interface RouteHostBinding {
    configRoot: string;
    stateRoot: string;
    workspace: string;
    selectedAgentId: string;
    configProfile: string;
}
export interface DiscoveredRoute {
    routeId: string;
    providerSlug: string;
    kind: DiscoveredRouteKind;
    identityLevel: 'configured';
    /** True when a real transport can be composed for this route now. */
    composable: boolean;
    /** Why the route is not composable, when it is not. */
    notComposableReason: string | null;
    /** Typed reason, so strict callers never re-parse prose. */
    failure: RouteFailure | null;
    host: RouteHostBinding;
    harness?: {
        configDir: string;
        configRootName: string;
        /** Absolute path of the harness executable, when found. */
        executable: string | null;
    };
    compatible?: {
        baseUrl: string;
        /** The configuration's own model for this provider, when unambiguous. */
        modelId: string | null;
        /** Every configured candidate model id (never a secret). */
        modelCandidates: string[];
        /** Declared API family; only `openai_compatible` is composed here. */
        apiFamily: RouteApiFamily;
        credential: DiscoveredCredential;
        /** The existing config file the credential resolver re-reads at flight time. */
        configPath: string;
        configFormat: 'json' | 'json5';
        /** Existing secret env stores the flight-time resolver also checks. */
        envFiles: string[];
        providerId: string;
        capabilitySnapshot: RouteCapabilitySnapshot;
    };
}
/** The secret-free shape surfaced by `models` and the doctor. */
export interface RouteDiscoveryInfo {
    route_id: string;
    provider_slug: string;
    kind: DiscoveredRouteKind;
    identity_level: 'configured';
    composed: boolean;
    not_composed_reason: string | null;
}
export declare function routeDiscoveryInfo(route: DiscoveredRoute, composed: boolean): RouteDiscoveryInfo;
/** The WER-005 receipt bridge's answer about the installed runtime. */
export interface HostRuntimeReceipt {
    installed: boolean;
    prefix: string;
    releaseId: string | null;
    dataDir: string | null;
    cliPath: string | null;
    failureCode: string | null;
    checked: string[];
}
/** The ACTUAL host layout discovery resolved, with its provenance. */
export interface HostLayout {
    homeDir: string;
    /** OpenClaw installation root (not assumed to be ~/.openclaw). */
    configRoot: string;
    configRootName: string;
    configPath: string;
    configExists: boolean;
    configFormat: 'json' | 'json5';
    /** Root of the host's own state (agents, logs, credentials, skills). */
    stateRoot: string;
    statePaths: {
        agents: string;
        logs: string;
        credentials: string;
        authProfiles: string;
        secretsEnv: string;
        skills: string;
    };
    workspace: string;
    workspaceSource: 'env_pin' | 'agent_override' | 'agents_default' | 'root_default';
    selectedAgentId: string;
    /** Existing skill directories the host actually has. */
    skillDirs: string[];
    /** Configured extra skill directories (may not exist yet). */
    extraSkillDirs: string[];
    /** Secret env files checked for named references, by path. */
    secretsEnvFiles: string[];
    /** Every input consulted, by name/path (negative-result evidence). */
    sources: string[];
    /** The WER-005 installed-runtime receipt answer, consumed not re-derived. */
    runtime: HostRuntimeReceipt;
}
export interface HostLayoutOptions {
    /** Home directory to resolve under. Default: the OS home directory. */
    homeDir?: string;
    /** Environment for root/config/workspace/skills/credential presence. Default: process.env. */
    env?: NodeJS.ProcessEnv;
    /** Explicit root; wins over the environment. */
    root?: string;
    /** Explicit config file; wins over the environment and the root candidates. */
    configPath?: string;
    /** Selected agent id. Default: OPENCLAW_AGENT_ID, else `main`. */
    agentId?: string;
    /** Platform override for the Linux /data installation check (tests). */
    platform?: string;
    /** When true, a missing config file is an explicit failure. */
    requireConfig?: boolean;
}
export type RouteDiscoveryOptions = HostLayoutOptions;
export interface DiscoveredHostRoutes {
    layout: HostLayout;
    routes: DiscoveredRoute[];
}
export interface ResolvedRoute {
    route: DiscoveredRoute;
    layout: HostLayout;
}
/** Snapshot input for the frozen WER-006 contract. */
export interface RouteSnapshotOptions {
    sessionId: string;
    sessionOwner: string;
    policySha256: string;
    createdAt: string;
    scope: TrustedScope;
    capabilityVersion: string;
    routeRevision?: number;
    /** Absent means UNKNOWN/not_probed. Never inferred from configuration. */
    transportReported?: TransportReportedRouteIdentity;
    /** Optional combination pin; each unreported member freezes as UNKNOWN. */
    combination?: {
        alias: string;
        members: string[];
    };
    reasoning?: Partial<RouteSnapshotReasoning>;
    limits?: Partial<RouteSnapshotLimits>;
}
/** Parse JSON5 (comments, unquoted keys, single quotes, trailing commas). */
export declare function parseJson5(text: string): unknown;
/**
 * The public layout view. It deliberately carries NO raw configuration
 * object, so a literal apiKey or an `env` block can never be copied out
 * of discovery by accident.
 */
export declare function discoverHostLayout(options?: HostLayoutOptions): HostLayout;
/**
 * Resolve the host layout and every configured route. Throws a typed,
 * secret-free `RouteDiscoveryError` when the host is ambiguous or
 * malformed, because no developer default may stand in for the host's
 * real answer.
 */
export declare function discoverHostRoutes(options?: RouteDiscoveryOptions): DiscoveredHostRoutes;
/**
 * Total, read-only discovery for listing surfaces (`models`, doctor).
 * A route that cannot be composed stays visible with its typed reason. A
 * host-level ambiguity yields no routes here; strict callers use
 * `resolveRouteForDispatch`/`discoverRouteSnapshot`, which throw it.
 */
export declare function discoverConfiguredRoutes(options?: RouteDiscoveryOptions): DiscoveredRoute[];
/**
 * Strict route resolution for dispatch. Every failure is explicit and
 * secret-free: missing config, unknown route id, unsupported API family,
 * ambiguous model, or an unresolved named secret reference.
 */
export declare function resolveRouteForDispatch(routeId: string, options?: RouteDiscoveryOptions): ResolvedRoute;
/**
 * Freeze one discovered route into the published WER-006 contract. The
 * configured model is the configuration's own; transport-reported
 * identity defaults to UNKNOWN/not_probed and is never inferred.
 */
export declare function buildRouteSnapshot(route: DiscoveredRoute, options: RouteSnapshotOptions): CouncilRouteSnapshot;
/** Resolve one route strictly and freeze it through the WER-006 path. */
export declare function discoverRouteSnapshot(routeId: string, snapshotOptions: RouteSnapshotOptions, discoveryOptions?: RouteDiscoveryOptions): {
    route: DiscoveredRoute;
    layout: HostLayout;
    snapshot: CouncilRouteSnapshot;
};
/**
 * Resolve a discovered compatible route's credential VALUE at flight
 * time, through the existing configuration only: the provider's literal
 * apiKey in the config file it was discovered from, or the named
 * reference through process env, the config's own `env` block, or the
 * host's existing secret env files. The value is returned to the
 * transport for the in-flight Authorization header only; it is never
 * recorded, and no error built here ever carries it.
 */
export declare function resolveDiscoveredCredential(route: DiscoveredRoute, env?: NodeJS.ProcessEnv): string | null;
