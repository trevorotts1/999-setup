/**
 * CTR-146: reader-facing seat descriptors for the report.
 *
 * The advisor packs already ship a plain-language `role` and the one
 * `owned_question` each seat exists to answer. The report shows both so a
 * reader understands what each elder was looking at — without copying any
 * pack text, prompt, evidence, or quotation into the report.
 *
 * Read boundary: `advisors/<seat>/profile.json` only, the two descriptive
 * string fields (`role`, `owned_question`). Nothing else is read. A missing
 * or malformed profile is reported as absent, never guessed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_IDS } from '../contracts/index.js';
const MAX_TEXT = 320;
function clean(value) {
    if (typeof value !== 'string')
        return null;
    const text = value.replace(/\s+/g, ' ').trim();
    return text === '' ? null : text.slice(0, MAX_TEXT);
}
/** Locate the skill folder (SKILL.md beside advisors/ and manifest.json). */
function skillRoot() {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
        if (existsSync(join(dir, 'SKILL.md')) &&
            existsSync(join(dir, 'advisors')) &&
            existsSync(join(dir, 'manifest.json'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
let cached = null;
/**
 * Load the shipped seat descriptors once. Returns an empty map when the
 * packs are not beside the runtime; the report then omits the focus line
 * instead of inventing one.
 */
export function loadSeatDescriptors() {
    if (cached !== null)
        return cached;
    const out = {};
    const root = skillRoot();
    if (root === null) {
        cached = out;
        return out;
    }
    for (const seatId of SEAT_IDS) {
        try {
            const raw = readFileSync(join(root, 'advisors', seatId, 'profile.json'), 'utf8');
            const parsed = JSON.parse(raw);
            out[seatId] = {
                seat_id: seatId,
                lane: clean(parsed.role),
                owned_question: clean(parsed.owned_question),
            };
        }
        catch {
            // No readable profile for this seat: omit, never invent.
        }
    }
    cached = out;
    return out;
}
