/**
 * Process UID and service-name resolution (WER-022).
 *
 * The host is never assumed to be `localhost`, and the hostname is never
 * used as a service name. A service name resolves from, in order:
 *
 *   1. an explicit caller value;
 *   2. `BLACKCEO_COUNCIL_SERVICE_NAME`;
 *   3. `SYSTEMD_UNIT` (the unit suffix is stripped);
 *   4. a container-provided name, when this process is inside a container.
 *
 * Nothing else qualifies. When a name is required and none resolves, the
 * answer is a typed refusal — the adapter does not fall back to the hostname,
 * to `localhost` or to a fixed port.
 *
 * `uid`/`gid` are observed where the platform exposes them and reported as
 * `unobservable` where it does not (Windows); they are never invented. On
 * Windows the observable account facts are `os.userInfo().username` with
 * `USERNAME` as fallback, plus `USERDOMAIN` and `COMPUTERNAME`. When none of
 * them resolve the user stays `unobservable`.
 */
import { type ProcessIdentity, type PlatformRefusal } from './types.js';
export interface ServiceIdentityOptions {
    /** Highest-precedence service name. */
    serviceName?: string | null;
    env?: NodeJS.ProcessEnv;
    /** Platform whose observable identity values are read. Default `process.platform`. */
    platform?: NodeJS.Platform;
    /** Injected process ids; defaults to `process.getuid()`/`getgid()` when present. */
    uid?: number | null;
    gid?: number | null;
    /** Injected login name; defaults to `os.userInfo().username`. */
    user?: string | null;
    /** Container-provided name (only used when `containerNameIsFromContainer` is true). */
    containerName?: string | null;
    /** Defaults to `os.hostname()`. Recorded, never used as a service name. */
    hostname?: string | null;
    /** When true, an unresolved name is an explicit refusal. Default true. */
    requireServiceName?: boolean;
}
export declare const SERVICE_NAME_ENV = "BLACKCEO_COUNCIL_SERVICE_NAME";
export declare function resolveServiceIdentity(options?: ServiceIdentityOptions): {
    ok: true;
    identity: ProcessIdentity;
} | PlatformRefusal;
