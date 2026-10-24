/**
 * The council persistence configuration surface (CWE-006).
 *
 * This is the exact configuration the persistence layer accepts, locked
 * here rather than scattered as hidden hardcoded promises:
 *
 * - `authority_mode`: where council state is authoritative for this
 *   installation (directive Sections 4.5 and 16.1). It is chosen at
 *   installation or session creation, persisted in the data profile,
 *   and NEVER silently switched: opening a profile with a different
 *   mode is refused (see profile.ts), and a managed-mode failure never
 *   falls back to a standalone database.
 * - The bounded SQLite busy policy (Section 16.4): per-attempt busy
 *   timeout, maximum attempts, base backoff. Exhaustion defers the
 *   write visibly (T056); it never blocks forever and never applies
 *   partially.
 * - `outbox_max_attempts`: delivery attempts before a projection intent
 *   is parked as dead_letter for operator attention (Section 18.2).
 * - `settings`: the session budget and behavior settings of Section
 *   15.6, carried verbatim from the CWE-003 canonical contract
 *   (DEFAULT_COUNCIL_SETTINGS). Not redefined here.
 * - `diagnostics`: the single DiagnosticRetentionPolicy of Section
 *   16.6, carried verbatim from the CWE-003 canonical contract
 *   (DEFAULT_DIAGNOSTIC_RETENTION_POLICY: capture disabled by default;
 *   60-minute default window, 4-hour maximum; 24-hour default TTL,
 *   72-hour maximum; 5 MiB per operation, 25 MiB per session). Not
 *   redefined here.
 *
 * Validation fails precisely: an unknown key at any level is rejected
 * by name, and an unsafe value is rejected with its field path. There
 * are no secret values in this surface by construction: credentials
 * are only ever reached through the host's existing resolver paths
 * (CouncilHost.secrets reports presence only), and no configuration
 * value is a credential.
 */
import { z } from 'zod';
import { type CouncilSettings, type DiagnosticRetentionPolicy } from '../contracts/index.js';
export declare const PERSISTENCE_CONFIG_SCHEMA_VERSION = "wise-elders.persistence-config/v1";
export declare const AUTHORITY_MODES: readonly ["standalone", "managed"];
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];
export declare const persistenceConfigSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"wise-elders.persistence-config/v1">;
    authority_mode: z.ZodEnum<{
        standalone: "standalone";
        managed: "managed";
    }>;
    busy_timeout_ms: z.ZodNumber;
    busy_max_attempts: z.ZodNumber;
    busy_base_delay_ms: z.ZodNumber;
    outbox_max_attempts: z.ZodNumber;
    settings: z.ZodObject<{
        schema_version: z.ZodLiteral<"wise-elders.settings/v1">;
        max_session_provider_requests: z.ZodNumber;
        max_output_repair_requests: z.ZodNumber;
        max_semantic_verification_requests: z.ZodNumber;
        max_transport_retries_total: z.ZodNumber;
        max_transport_retries_per_request: z.ZodNumber;
        max_output_repairs_per_original_operation: z.ZodNumber;
        max_concurrent_seat_calls: z.ZodNumber;
        max_active_council_sessions_per_client: z.ZodNumber;
        fallback_policy: z.ZodEnum<{
            none: "none";
            client_approved_only: "client_approved_only";
        }>;
    }, z.core.$strict>;
    diagnostics: z.ZodObject<{
        schema_version: z.ZodLiteral<"wise-elders.diagnostic-retention-policy/v1">;
        enabled: z.ZodBoolean;
        authorized_by_principal: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        authorization_kind: z.ZodNullable<z.ZodEnum<{
            owner: "owner";
            audited_support: "audited_support";
        }>>;
        session_id: z.ZodNullable<z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>>;
        capture_window_minutes: z.ZodNumber;
        payload_ttl_hours: z.ZodNumber;
        max_bytes_per_operation: z.ZodNumber;
        max_bytes_per_session: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CouncilPersistenceConfig = z.infer<typeof persistenceConfigSchema>;
export declare const DEFAULT_PERSISTENCE_CONFIG: CouncilPersistenceConfig;
/**
 * Parse caller-supplied persistence configuration over the locked
 * defaults. An omitted value selects the full default surface. A
 * supplied object may override any subset of fields; nested `settings`
 * and `diagnostics` objects merge over their canonical defaults field
 * by field. Unknown keys and unsafe values throw
 * PERSISTENCE_CONFIG_INVALID with the exact key or field path.
 */
export declare function parsePersistenceConfig(input?: unknown): CouncilPersistenceConfig;
export type { CouncilSettings, DiagnosticRetentionPolicy };
