/**
 * Deterministic fixture transport and sample session (CWE-004).
 *
 * This transport exists ONLY for isolated foundation tests and the
 * labeled sample/replay path. It is never registered by the production
 * composition (local-host.ts registers no transport by default), it
 * spends nothing, and its output is synthetic by construction: for the
 * golden brief shape it answers with the Section 32.2 golden score
 * table, so the full pipeline (validation, scoring, verdict) can be
 * proven end to end deterministically. It proves wiring only
 * (Section 34.2); it is not a model, not a qualification, and not live
 * inference.
 *
 * Sample sessions use CWE-003's synthetic fixtures, are stored with
 * sample: true, carry the sample label in every surface the CLI
 * renders, and can never create production actions: this core exposes
 * no task-creation operation at all, and sample action proposals are
 * data with execution_authorization_required, nothing more.
 */
import { type DecisionBrief, type ScopeFields, type SessionSpec } from '../contracts/index.js';
import type { ModelTransport, TransportRequest, TransportResponse } from './host-ports.js';
export declare class DeterministicFixtureTransport implements ModelTransport {
    private counter;
    generate(request: TransportRequest): Promise<TransportResponse>;
}
/** The labeled synthetic sample session, built from CWE-003 fixtures. */
export declare function buildSampleSession(): {
    spec: SessionSpec;
    brief: DecisionBrief;
    scope: ScopeFields;
};
