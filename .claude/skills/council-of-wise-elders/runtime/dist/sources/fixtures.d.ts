/**
 * Synthetic fixtures for the CWE-012 test suite.
 *
 * Every string here is invented fixture data, written for this suite and
 * labeled as such. No fixture text is a real quotation, a real source
 * excerpt, or a real biographical claim; the fixtures exist to exercise
 * validator boundaries, never to stand in for source material.
 */
import type { PackInput } from './packs.js';
/** A valid minimal substantive pack: Simon Sinek, Start with Why. */
export declare function validSinekPack(): PackInput;
/** Oprah pack whose one quotation is spoken by a guest, not by Oprah (T004). */
export declare function oprahGuestPack(): PackInput;
/** A valid Jakes pack: three books, three lenses, one seat. */
export declare function validJakesPack(): PackInput;
/** Deep clone helper for negative-fixture mutations. */
export declare function clonePack(pack: PackInput): PackInput;
