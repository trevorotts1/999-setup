/**
 * Bridge parity check surface (CWE-010; directive Sections 13, 34).
 *
 * CWE-040 verifies that both harnesses produce the same catalog
 * behavior for the same selection. This module is that surface: a
 * deterministic fixture set plus two checkers.
 *
 * - runParityCheck runs each fixture's selection and resolution attempt
 *   through the shared catalog semantics each bridge is built on and
 *   reports a canonical summary per fixture. Both harnesses must
 *   produce byte-identical summaries.
 * - runBridgeParity goes end to end: it composes the REAL OpenClaw
 *   bridge and the REAL Claude-Nine bridge per fixture (temporary data
 *   directories, fixture delegates that only count calls), feeds the
 *   fixture attempt through each bridge's own resolver port and guard,
 *   and compares the journal outcomes and whether the delegate was
 *   reached. This is the check that proves the isolation did not fork
 *   the semantics: the resolvers differ per harness, the catalog
 *   behavior does not.
 *
 * This module is a verification surface, not a runtime path for either
 * bridge; importing both bridges here does not put either bridge in the
 * other's runtime graph.
 */
import { type HostResolutionAttempt, type ProviderRouteDescriptor, type RouteEvidence, type RouteResolutionOutcome, type RouteSelectionRequest, type TrustedScope } from './host-bridge.js';
export interface ParityFixture {
    name: string;
    descriptor: ProviderRouteDescriptor;
    evidence?: RouteEvidence;
    request: RouteSelectionRequest;
    scope: TrustedScope;
    attempt: HostResolutionAttempt;
}
/** Canonical, timestamp-free summary of one resolution outcome. */
export interface ResolutionSummary {
    outcome: RouteResolutionOutcome['outcome'];
    effectiveModelId: string | null;
    identityLevel: RouteResolutionOutcome['identityLevel'];
    identityStatement: string | null;
    changeRecord: RouteResolutionOutcome['changeRecord'];
    eventTypes: string[];
}
export declare function summarizeResolutionOutcome(outcome: RouteResolutionOutcome): ResolutionSummary;
export interface ParityFixtureResult {
    name: string;
    summary: ResolutionSummary;
    outcomeHash: string;
}
export declare function runParityCheck(fixtures: ParityFixture[]): {
    ok: boolean;
    results: ParityFixtureResult[];
};
interface BridgeRunResult {
    summary: ResolutionSummary | null;
    delegateCalls: number;
    refused: boolean;
}
export interface BridgeParityResult {
    name: string;
    equal: boolean;
    openclaw: BridgeRunResult;
    claudeNine: BridgeRunResult;
}
export declare function runBridgeParity(fixtures: ParityFixture[]): Promise<{
    ok: boolean;
    results: BridgeParityResult[];
}>;
export declare const PARITY_FIXTURES: ParityFixture[];
export {};
