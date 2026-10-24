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
import { councilSettingsSchema, DEFAULT_COUNCIL_SETTINGS, diagnosticRetentionPolicySchema, DEFAULT_DIAGNOSTIC_RETENTION_POLICY, } from '../contracts/index.js';
import { configInvalid } from './errors.js';
export const PERSISTENCE_CONFIG_SCHEMA_VERSION = 'wise-elders.persistence-config/v1';
export const AUTHORITY_MODES = ['standalone', 'managed'];
const persistenceConfigShape = {
    schema_version: z.literal(PERSISTENCE_CONFIG_SCHEMA_VERSION),
    authority_mode: z.enum(AUTHORITY_MODES),
    busy_timeout_ms: z.number().int().min(0).max(30_000),
    busy_max_attempts: z.number().int().min(1).max(10),
    busy_base_delay_ms: z.number().int().min(0).max(1_000),
    outbox_max_attempts: z.number().int().min(1).max(20),
    settings: councilSettingsSchema,
    diagnostics: diagnosticRetentionPolicySchema,
};
export const persistenceConfigSchema = z.strictObject(persistenceConfigShape);
export const DEFAULT_PERSISTENCE_CONFIG = {
    schema_version: PERSISTENCE_CONFIG_SCHEMA_VERSION,
    authority_mode: 'standalone',
    busy_timeout_ms: 2_000,
    busy_max_attempts: 4,
    busy_base_delay_ms: 25,
    outbox_max_attempts: 5,
    settings: DEFAULT_COUNCIL_SETTINGS,
    diagnostics: DEFAULT_DIAGNOSTIC_RETENTION_POLICY,
};
function knownKeys(schema) {
    return new Set(Object.keys(schema.shape));
}
function collectUnknownKeys(value, schema, path, out) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return;
    const known = knownKeys(schema);
    for (const key of Object.keys(value)) {
        if (!known.has(key))
            out.push(path ? `${path}.${key}` : key);
    }
}
function assertNoUnknownKeys(input) {
    const unknown = [];
    collectUnknownKeys(input, persistenceConfigSchema, '', unknown);
    if (typeof input.settings === 'object' && input.settings !== null) {
        collectUnknownKeys(input.settings, councilSettingsSchema, 'settings', unknown);
    }
    if (typeof input.diagnostics === 'object' && input.diagnostics !== null) {
        collectUnknownKeys(input.diagnostics, diagnosticRetentionPolicySchema, 'diagnostics', unknown);
    }
    if (unknown.length > 0) {
        throw configInvalid(`Unknown council persistence configuration key(s): ${unknown.join(', ')}. The configuration surface is locked; unknown keys fail rather than being ignored.`, { unknown_keys: unknown });
    }
}
/**
 * Parse caller-supplied persistence configuration over the locked
 * defaults. An omitted value selects the full default surface. A
 * supplied object may override any subset of fields; nested `settings`
 * and `diagnostics` objects merge over their canonical defaults field
 * by field. Unknown keys and unsafe values throw
 * PERSISTENCE_CONFIG_INVALID with the exact key or field path.
 */
export function parsePersistenceConfig(input) {
    if (input === undefined || input === null) {
        return structuredClone(DEFAULT_PERSISTENCE_CONFIG);
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw configInvalid('Council persistence configuration must be an object.');
    }
    const raw = input;
    assertNoUnknownKeys(raw);
    const merged = {
        ...structuredClone(DEFAULT_PERSISTENCE_CONFIG),
        ...raw,
        settings: {
            ...structuredClone(DEFAULT_COUNCIL_SETTINGS),
            ...(typeof raw.settings === 'object' && raw.settings !== null
                ? raw.settings
                : {}),
        },
        diagnostics: {
            ...structuredClone(DEFAULT_DIAGNOSTIC_RETENTION_POLICY),
            ...(typeof raw.diagnostics === 'object' && raw.diagnostics !== null
                ? raw.diagnostics
                : {}),
        },
    };
    const parsed = persistenceConfigSchema.safeParse(merged);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        const path = first?.path.map((p) => String(p)).join('.') ?? '';
        throw configInvalid(`Invalid council persistence configuration at ${path || '(root)'}: ${first?.message ?? 'validation failed'}.`, {
            issues: parsed.error.issues.map((issue) => ({
                path: issue.path.map((p) => String(p)).join('.'),
                code: issue.code,
                message: issue.message,
            })),
        });
    }
    return parsed.data;
}
