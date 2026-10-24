/**
 * CWE-022 bounded context assembly (directive Sections 9.2, 9.4, 9.5,
 * 11.6, 13.6).
 *
 * Assembly takes the frozen DecisionBrief, retrieves the authorized
 * candidate set through retrieval.ts, and builds one per-operation
 * context payload that provably fits the route's actual context limit:
 *
 * - The budget is arithmetic on canonical bytes. The route supplies its
 *   actual context limit plus the byte sizes of the system rules, the
 *   response schema, and the output reserve (each measured by the
 *   caller with the same canonical serializer); the context budget is
 *   what remains. Every fit decision measures the exact payload with
 *   canonicalBytes, hash field included at its final size.
 * - The minimum valid context is the brief view plus, for every
 *   selected seat that has authorized material, that seat's first item
 *   in deterministic order. If the minimum cannot fit, the result is
 *   the typed CONTEXT_TOO_SMALL readiness result for the session's
 *   mode, with the modes that would fit computed and offered. The
 *   council is never silently shrunk, no seat is dropped, no item is
 *   truncated mid-item, and no other model is substituted.
 * - Beyond the minimum, items are added whole, in deterministic order,
 *   while they fit the remaining budget and the seat's input budget
 *   (Section 34 build step 3). Constraints and provenance are part of
 *   the payload structure itself, so budget reduction can never strip
 *   them: an item enters with its full provenance or not at all.
 * - Round 1 (Section 9.4): the brief view omits private_preference_ref
 *   entirely, so the client's private preference is not part of Round 1
 *   context in any form. Legitimate values and constraints are brief
 *   content and are always present. The preference content itself is
 *   never an input to this module at all; only the brief's reference
 *   field exists, and Round 1 drops even that.
 * - Determinism: no clock, no randomness, no host state. Same inputs
 *   produce a byte-identical payload and the same content hash. The
 *   hash is the canonical hash of the payload with self-referential
 *   fields excluded (Section 11.6), computed over a placeholder of the
 *   final field size so the measured bytes are the shipped bytes.
 * - Peer material is never a candidate kind here: the catalog port
 *   carries source, pack, and session material only, so peer openings
 *   cannot enter any operation's context through this layer (the
 *   Section 34 acceptance proof for CWE-022).
 * - The brief view inside the payload carries the evidence manifest
 *   reduced to the included items, so excluded material leaves no
 *   identifier or digest in the payload. The full frozen manifest
 *   remains in the brief record in the store; the assembly-level
 *   evidence_manifest field carries the same reduced set as the
 *   frozen manifest of this context.
 */
import { canonicalBytes, hashCanonicalExcludingSelfReferential, validateDecisionBrief, } from '../contracts/index.js';
import { retrieveAuthorizedMaterial } from './retrieval.js';
import { ContextError, } from './types.js';
export const CONTEXT_ASSEMBLY_SCHEMA_VERSION = 'wise-elders.context-assembly/v1';
const HASH_PLACEHOLDER = '0'.repeat(64);
function briefView(brief, operation) {
    if (operation !== 'round_1_opening')
        return brief;
    const { private_preference_ref: _omitted, ...view } = brief;
    return view;
}
function buildPayload(args) {
    const { request } = args;
    // The brief view carries the manifest reduced to the included items:
    // material excluded from this context leaves no identifier and no
    // digest anywhere in the payload (the same silence rule retrieval
    // applies to out-of-scope material). The full frozen manifest stays
    // in the brief record itself, in the store.
    const view = {
        ...briefView(request.brief, request.operation),
        evidence_manifest: [...args.manifest],
    };
    const payload = {
        schema_version: CONTEXT_ASSEMBLY_SCHEMA_VERSION,
        session_id: request.session.session_id,
        operation: request.operation,
        mode: request.session.mode,
        distributable: request.distributable === true,
        preference_excluded: request.operation === 'round_1_opening',
        brief: view,
        items: args.items,
        evidence_manifest: args.manifest,
        content_sha256: HASH_PLACEHOLDER,
    };
    return { ...payload, content_sha256: hashCanonicalExcludingSelfReferential(payload) };
}
function measure(payload) {
    return canonicalBytes(payload).length;
}
function manifestFor(brief, items) {
    const byId = new Map(brief.evidence_manifest.map((e) => [e.evidence_id, e]));
    return items
        .map((item) => byId.get(item.evidence_id))
        .filter((e) => e !== undefined);
}
/** The mandatory minimum: brief view plus each seated seat's first item. */
function minimumItems(seatIds, items) {
    const chosen = [];
    const seen = new Set();
    for (const seatId of seatIds) {
        const first = items.find((item) => item.seat_id === seatId);
        if (first && !seen.has(first.evidence_id)) {
            chosen.push(first);
            seen.add(first.evidence_id);
        }
    }
    // Items arrive in retrieval order (roster order, then evidence ID),
    // so the first item found per seat is that seat's deterministic first.
    return chosen;
}
export function assembleContext(request) {
    const briefCheck = validateDecisionBrief(request.brief);
    if (!briefCheck.ok) {
        throw new ContextError('CONTEXT_BRIEF_INVALID', 'The decision brief failed contract validation.');
    }
    const { route } = request;
    const budget = route.context_limit_bytes -
        route.system_rules_bytes -
        route.response_schema_bytes -
        route.output_reserve_bytes;
    if (!Number.isSafeInteger(route.context_limit_bytes) ||
        route.context_limit_bytes <= 0 ||
        budget < 0) {
        throw new ContextError('CONTEXT_ROUTE_INVALID', 'The route context budget is not usable for assembly.');
    }
    const retrievalOptions = {
        distributable: request.distributable === true,
        revokedSourceIds: request.revoked_source_ids,
    };
    const { items } = retrieveAuthorizedMaterial({
        principal: request.principal,
        session: request.session,
        manifest: request.brief.evidence_manifest,
        catalog: request.catalog,
        options: retrievalOptions,
    });
    const mandatory = minimumItems(request.session.seat_ids, items);
    const minimumPayload = buildPayload({
        request,
        items: mandatory,
        manifest: manifestFor(request.brief, mandatory),
    });
    const minimumBytes = measure(minimumPayload);
    if (minimumBytes > budget) {
        // Section 9.5: name the lower-context modes that would fit instead
        // of shrinking this one. Consult (exactly one seat) is the only
        // mode whose seat count the contracts fix below the current set.
        const lower = [];
        if (request.session.mode !== 'consult' && mandatory.length > 0) {
            const consultMinimum = buildPayload({
                request: {
                    ...request,
                    session: { ...request.session, mode: 'consult' },
                },
                items: mandatory.slice(0, 1),
                manifest: manifestFor(request.brief, mandatory.slice(0, 1)),
            });
            if (measure(consultMinimum) <= budget)
                lower.push('consult');
        }
        return {
            status: 'context_too_small',
            readiness: 'CONTEXT_TOO_SMALL',
            mode: request.session.mode,
            minimum_required_bytes: minimumBytes,
            available_bytes: budget,
            supported_lower_context_modes: lower,
        };
    }
    // Greedy whole-item fill in deterministic (retrieval) order. Seat
    // budgets cap discretionary additions per seat; the mandatory minimum
    // is already in and is never removed by a seat budget.
    const included = [...mandatory];
    const includedIds = new Set(included.map((i) => i.evidence_id));
    const seatBytes = new Map();
    for (const item of mandatory) {
        seatBytes.set(item.seat_id, (seatBytes.get(item.seat_id) ?? 0) + canonicalBytes(item).length);
    }
    let currentBytes = minimumBytes;
    for (const item of items) {
        if (includedIds.has(item.evidence_id))
            continue;
        if (request.seat_budgets) {
            const cap = request.seat_budgets[item.seat_id];
            if (cap !== undefined &&
                (seatBytes.get(item.seat_id) ?? 0) + canonicalBytes(item).length > cap) {
                continue;
            }
        }
        const trial = [...included, item];
        const trialPayload = buildPayload({
            request,
            items: trial,
            manifest: manifestFor(request.brief, trial),
        });
        const trialBytes = measure(trialPayload);
        if (trialBytes > budget)
            continue;
        included.push(item);
        includedIds.add(item.evidence_id);
        currentBytes = trialBytes;
        seatBytes.set(item.seat_id, (seatBytes.get(item.seat_id) ?? 0) + canonicalBytes(item).length);
    }
    const finalPayload = buildPayload({
        request,
        items: included,
        manifest: manifestFor(request.brief, included),
    });
    const byteLength = measure(finalPayload);
    if (byteLength !== currentBytes || byteLength > budget) {
        // Defensive: the greedy loop measured exactly this payload, so a
        // mismatch would mean the measurement path is broken. Fail closed.
        throw new ContextError('CONTEXT_ROUTE_INVALID', 'The route context budget is not usable for assembly.');
    }
    return {
        status: 'assembled',
        context: finalPayload,
        context_sha256: finalPayload.content_sha256,
        byte_length: byteLength,
        budget_bytes: budget,
    };
}
/** The frozen evidence manifest of an assembled context, for CWE-023/024. */
export function frozenManifestOf(context) {
    return context.evidence_manifest;
}
/** Content hash check a consumer can re-run against a stored context. */
export function verifyContextHash(context) {
    return hashCanonicalExcludingSelfReferential(context) === context.content_sha256;
}
