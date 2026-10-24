/**
 * CWE-023 deterministic critical-domain classification from structured
 * intake facts (directive Section 12.7), reconciled by CWE-050.
 *
 * Classification reads ONLY structured intake material: the decision
 * flags answered with the decision question, and the typed constraint
 * kinds. No keyword guessing, no model proposal surface at intake:
 * a model may propose tags during an authorized intake step elsewhere,
 * but nothing here can remove a domain these facts trigger.
 *
 * CWE-050 reconciliation (CWE-023 carried item, decided for ONE
 * implementation): the composition is scoring/critical-domains.ts
 * `classifyCriticalDomains` (CWE-026), including its fixed Section
 * 12.7 reviewer table. This module now only (1) derives
 * CriticalDomainSignal[] from the intake draft, (2) calls the canonical
 * classifier with the intake policy version, and (3) applies the
 * intake panel overlay: a triggered domain whose responsible seat is
 * not on the chosen panel stays `not_assessed` in the frozen brief,
 * because the assessment the verdict would need cannot happen; an
 * unarranged qualified-professional review is likewise `not_assessed`.
 * The overlay is intake's Section 12.7 panel concern and stays here.
 *
 * Trigger-path dialect: constraint triggers are recorded in the
 * canonical `constraints.<id>` form (the dialect the ONE applicability
 * derivation in scoring/critical-domains.ts consumes), so briefs frozen
 * by intake carry applicability the completion side can recompute.
 * Decision-flag paths keep the `answers.decision.flags.<name>` form;
 * no derivation consumes them. Disclosure: briefs frozen by this
 * reconciled classifier differ in constraint trigger paths (and
 * therefore in canonical brief hash) from briefs frozen by the
 * pre-reconciliation intake classifier; no production briefs exist,
 * and the golden fixtures remain the arbiter.
 */
import { type CriticalDomain, type CriticalDomainRequirement, type SeatId } from '../contracts/index.js';
import { CRITICAL_DOMAIN_REVIEWERS } from '../scoring/critical-domains.js';
import { type IntakeDraft } from './types.js';
export { CRITICAL_DOMAIN_REVIEWERS };
interface DomainSignal {
    domain: CriticalDomain;
    factIds: Set<string>;
    fieldPaths: Set<string>;
}
/**
 * Derive the triggered domains from the draft's structured answers.
 * Pure and deterministic: the same draft always yields the same set.
 * Constraint field paths use the canonical `constraints.<id>` dialect.
 */
export declare function deriveSignals(draft: IntakeDraft): Map<CriticalDomain, DomainSignal>;
/**
 * Compose the frozen critical-domain requirements for a brief by
 * delegating to the ONE canonical classifier (CWE-026) and applying
 * the intake panel overlay (see the module header).
 */
export declare function classifyIntakeDomains(args: {
    draft: IntakeDraft;
    panelSeatIds: readonly SeatId[] | null;
    professionalReviewArranged: boolean | null;
}): CriticalDomainRequirement[];
