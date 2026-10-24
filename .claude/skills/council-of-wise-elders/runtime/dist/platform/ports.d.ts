/**
 * Loopback endpoint acquisition (WER-022).
 *
 * The port-selection contract is the WER-021 front door's, NOT a copy:
 * identity-based reuse, an unrelated listener refused and LEFT RUNNING, and
 * every candidate port's blocker reported. This module only maps that
 * contract into platform refusal codes, so there is exactly one
 * implementation of "which listener is mine" in the runtime.
 *
 * What is added here is the honest platform statement: a free port proves
 * only that the current network namespace can bind it. It never proves the
 * host can reach it, and it never proves a container is reachable from
 * outside (`host.docker.internal` and a fixed port are not evidence).
 */
import type { CouncilFrontDoor } from '../service/front-door.js';
import { type PlatformCondition, type PlatformRefusal, type PlatformRefusalCode } from './types.js';
export interface EndpointRefusal {
    code: PlatformRefusalCode;
    condition: PlatformCondition;
    service_code: string;
    port: number | null;
    detail: string;
    recovery: string;
}
export type EndpointAcquisition = {
    kind: 'acquired';
    outcome: 'started' | 'reused';
    origin: string;
    port: number;
    /** True: the caller owns the handle and must stop() it when started. */
    owns_listener: boolean;
} | {
    kind: 'refused';
    code: 'PLATFORM_ENDPOINT_UNAVAILABLE';
    refusals: EndpointRefusal[];
};
/**
 * Start/resolve the front door and report the endpoint it actually owns.
 *
 * A verified matching service is reused (the caller never stops it); an
 * unrelated listener is refused untouched; when no candidate works, every
 * refusal is returned so the caller sees all checked ports.
 */
export declare function acquireServiceEndpoint(frontDoor: CouncilFrontDoor): Promise<EndpointAcquisition>;
/** A refusal view of the same acquisition, for callers that want one shape. */
export declare function endpointRefusal(acquisition: EndpointAcquisition): PlatformRefusal | null;
