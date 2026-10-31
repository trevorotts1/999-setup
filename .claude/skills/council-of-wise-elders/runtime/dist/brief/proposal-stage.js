/**
 * CTR-133 preparation/proposal stage.
 *
 * A decision brief requires at least one real alternative. When the permitted
 * context states none, the honest path is NOT to invent one and score it: it
 * is one bounded preparation pass through the SAME configured provider route
 * the sitting will use, returning proposed strategies for confirmation.
 *
 * Boundaries enforced here:
 * - ONE provider request, maximum. No retry, no fan-out, no cascade, no
 *   per-seat calls. `request_budget` is part of the returned record.
 * - The provider port is INJECTED. This module never selects a provider,
 *   route, model, or credential, and never falls back to another route.
 * - Output is proposals, never facts: no catalog entry, price, customer fact,
 *   result, or promise may be invented. Missing material input is recorded as
 *   an explicit unknown, not filled in.
 * - No scoring, no recommendation, no GO, no external action. Proposals enter
 *   the normal brief only after the caller passes them here; the seats then
 *   score them as proposed alternatives in a NEW sitting.
 * - The known unresolved exploration placeholder is filtered out, never
 *   renamed into a plausible strategy.
 */
import { isUnresolvedExplorationOption } from './exploration.js';
export const PROPOSAL_STAGE_MAX_REQUESTS = 1;
export const PROPOSAL_STAGE_MIN_OPTIONS = 2;
export const PROPOSAL_STAGE_MAX_OPTIONS = 5;
const OPTION_KINDS = ['status_quo', 'bounded_test', 'change', 'other'];
const SYSTEM = [
    'You prepare a decision for a council of advisors.',
    'Return 2 to 5 concrete alternatives as a JSON object of the exact shape',
    '{"options":[{"label":"...","kind":"status_quo|bounded_test|change|other"}],"unknowns":["..."]}.',
    'Each label is a proposed strategy, specific enough to be scored against the others.',
    'Do not recommend, rank, score, or choose. Do not execute anything.',
    'Do not invent facts: no catalog, price, customer data, result, figure, or promise',
    'that the supplied question and permitted context do not state.',
    'When a material fact is missing, put it in "unknowns" instead of guessing.',
    'Never return an option that only says to explore the question.',
].join(' ');
function blocked(detail, missing, requestCount, requestBudget = 0) {
    return {
        ok: false,
        state: 'input-needed',
        detail,
        missing,
        request_budget: requestBudget,
        request_count: requestCount,
    };
}
function parseProposalPayload(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start)
        return null;
    try {
        return JSON.parse(raw.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
function normaliseKind(value) {
    return typeof value === 'string' && OPTION_KINDS.includes(value)
        ? value
        : 'other';
}
/**
 * Run the ONE preparation request. Returns proposed alternatives or an honest
 * input-needed refusal. It never returns a placeholder option and never scores.
 */
export async function prepareProposals(input, deps = {}) {
    const question = typeof input?.question === 'string' ? input.question.trim() : '';
    if (question.length === 0) {
        return blocked('The preparation stage needs a non-empty question.', ['question'], 0);
    }
    if (input.request_budget !== undefined && input.request_budget !== PROPOSAL_STAGE_MAX_REQUESTS) {
        return blocked(`Preparation accepts exactly ${PROPOSAL_STAGE_MAX_REQUESTS} provider request; ${String(input.request_budget)} was refused, never clamped.`, ['a one-request preparation budget'], 0);
    }
    if (deps.max_requests !== undefined && deps.max_requests !== PROPOSAL_STAGE_MAX_REQUESTS) {
        return blocked(`Preparation accepts exactly ${PROPOSAL_STAGE_MAX_REQUESTS} provider request; ${String(deps.max_requests)} was refused, never clamped.`, ['a one-request preparation budget'], 0);
    }
    const infer = deps.infer ?? null;
    if (typeof infer !== 'function') {
        return blocked('No configured provider route is available to prepare alternatives, and none is invented.', ['a configured provider route for the one preparation request'], 0);
    }
    const context = input.permitted_context ?? {
        sources_read: [],
        facts: [],
        constraints: [],
        unknowns: [],
    };
    const user = JSON.stringify({
        question,
        permitted_context: {
            sources_read: context.sources_read ?? [],
            facts: (context.facts ?? []).slice(0, 40),
            constraints: (context.constraints ?? []).slice(0, 40),
            unknowns: (context.unknowns ?? []).slice(0, 60),
        },
        display_timezone: input.display_timezone,
        max_options: Math.min(input.max_options ?? PROPOSAL_STAGE_MAX_OPTIONS, PROPOSAL_STAGE_MAX_OPTIONS),
    });
    let text;
    try {
        const response = await infer({ system: SYSTEM, user, max_requests: PROPOSAL_STAGE_MAX_REQUESTS }, { max_requests: PROPOSAL_STAGE_MAX_REQUESTS });
        text = String(response?.text ?? '');
    }
    catch (error) {
        return blocked(`The preparation request failed: ${String(error?.message ?? error)}. No retry was attempted.`, ['a successful preparation response'], PROPOSAL_STAGE_MAX_REQUESTS, PROPOSAL_STAGE_MAX_REQUESTS);
    }
    const payload = parseProposalPayload(text);
    const parsedOptions = Array.isArray(payload?.options)
        ? (payload.options)
        : [];
    const proposed = [];
    const seen = new Set();
    for (const entry of parsedOptions) {
        if (!entry || typeof entry !== 'object')
            continue;
        const label = typeof entry.label === 'string'
            ? entry.label.trim()
            : '';
        if (label.length === 0)
            continue;
        const candidate = {
            id: `option-proposed-${proposed.length + 1}`,
            label,
            kind: normaliseKind(entry.kind),
        };
        if (isUnresolvedExplorationOption(candidate))
            continue;
        const key = candidate.label.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        proposed.push(candidate);
        if (proposed.length >= PROPOSAL_STAGE_MAX_OPTIONS)
            break;
    }
    if (proposed.length < PROPOSAL_STAGE_MIN_OPTIONS) {
        return blocked(`The preparation response returned ${proposed.length} substantive alternative(s); at least ${PROPOSAL_STAGE_MIN_OPTIONS} are required, and none is invented.`, ['two to five substantive alternatives'], PROPOSAL_STAGE_MAX_REQUESTS, PROPOSAL_STAGE_MAX_REQUESTS);
    }
    const unknowns = [
        'The alternatives above are PROPOSED strategies from the configured provider, not client-chosen facts; confirm them before any irreversible action.',
    ];
    const payloadUnknowns = Array.isArray(payload?.unknowns)
        ? (payload.unknowns)
        : [];
    for (const statement of payloadUnknowns) {
        if (typeof statement === 'string' && statement.trim())
            unknowns.push(statement.trim());
        if (unknowns.length >= 40)
            break;
    }
    return {
        ok: true,
        state: 'preparing',
        options: proposed,
        unknowns,
        request_budget: PROPOSAL_STAGE_MAX_REQUESTS,
        request_count: PROPOSAL_STAGE_MAX_REQUESTS,
    };
}
