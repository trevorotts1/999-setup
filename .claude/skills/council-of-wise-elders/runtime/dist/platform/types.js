/**
 * OpenClaw VPS/container platform adapter contract (WER-022 dependency-ready
 * slice).
 *
 * Consumed by path import — this slice adds no package export map entry:
 *
 *   import { resolvePlatform } from '../platform/index.js';
 *
 * WHAT THIS IS. A typed, dependency-injected answer to the questions a real
 * VPS or container deployment must answer BEFORE a service may start:
 *
 * - is the durable data directory on a persistent writable mount, and is it
 *   outside every replaceable tree (skill folder, runtime release dir)?
 * - which UID/service identity and service NAME does this process actually
 *   run as (never assumed to be `localhost`)?
 * - does `127.0.0.1` name the host or the current container?
 * - which loopback port is free, without killing an unrelated listener?
 * - after a container recreate, do sessions and reservations come back from
 *   durable state with no duplicate?
 *
 * WHAT THIS IS NOT. No VPS and no container is available to this unit, so
 * nothing here executes a real deployment, recreates a real container,
 * proves real gateway connectivity or yields an authenticated remote URL.
 * Those stay DEFERRED and are named in `PLATFORM_DEFERRED_TO_REAL_HOST`.
 * A condition only a real host can answer is a typed `BLOCKED_PLATFORM`
 * refusal, never a pass.
 *
 * No external product is required: Command Center and Vercel are always
 * optional (`PLATFORM_EXTERNAL_REQUIREMENTS` is empty).
 */
/** Receipt schema for a resolved platform. */
export const PLATFORM_SCHEMA = 'wise-elders.platform-adapter/v1';
/** Durable handoff schema written by the owning authority before a recreate. */
export const HANDOFF_SCHEMA = 'wise-elders.platform-handoff/v1';
/**
 * Proven only on a real host. Never claimed by this unit, and never reported
 * as done by the adapter.
 */
export const PLATFORM_DEFERRED_TO_REAL_HOST = [
    'a real VPS deployment and a real container recreate',
    'a real gateway connectivity check from a recreated container',
    'an authenticated remote origin (Cloudflare Tunnel/Access, WER-023)',
    'systemd/launchd service registration and unit start',
    'proof of host reachability from inside a container beyond an explicit published address',
];
/** Empty on purpose: no Command Center, no Vercel, no third party. */
export const PLATFORM_EXTERNAL_REQUIREMENTS = [];
export function platformRefusal(input) {
    return {
        schema_version: PLATFORM_SCHEMA,
        kind: 'refused',
        code: input.code,
        condition: input.condition,
        detail: input.detail,
        recovery: input.recovery,
        requires_real_host: input.requires_real_host === true,
        checked: [...(input.checked ?? [])],
        unknowns: [...(input.unknowns ?? [])],
    };
}
export function isPlatformRefusal(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.kind === 'refused' &&
        typeof value.code === 'string');
}
