/**
 * Candice first-run name flow (Master Spec 0E WS-40, section 4).
 *
 * Requirements enforced here (spec 4):
 * - The name question is asked AT MOST ONCE per local user: `needsNameAsk`
 *   is true only until the user answers or explicitly dismisses; afterwards it
 *   stays false for that user.
 * - The name is NEVER inferred from the OS username (spec 4 item 8). This
 *   module has no code path that reads the OS username.
 * - The answer may arrive by voice or typed input (the caller's choice);
 *   this module only stores the approved text.
 * - The stored name is used naturally later ("Welcome back, <name>" is rendered
 *   by the UI layer; this module exposes the stored value and the greeting).
 * - The user can change the stored name later via `setPreferredName`.
 *
 * Dismissal vs answer: an explicit user dismissal records `nameAsked`
 * (the question WAS asked and declined); it does not permanently re-ask on
 * every future session. `setPreferredName('')` clears the stored name but the
 * question is not re-asked unless the user requests it.
 *
 * v3 shape (WS-34): the ask state is the object `nameAsked: { askedAt }`
 * (null when never asked). This module imports `mergeProfile` from
 * `profile.ts` — never from `store.ts` — so the webview bundle never pulls
 * `node:fs` through the name flow.
 */

import { type CandiceProfile } from './schema.ts';
import { mergeProfile } from './profile.ts';

/** Normalize an answer the user typed or dictated. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** A name is usable when it has at least one non-whitespace character. */
export function isUsableName(name: string | undefined | null): boolean {
  return typeof name === 'string' && name.trim().length > 0;
}

/**
 * True when the first-run name question still needs asking for this local
 * user: no usable stored name AND the question was never asked.
 */
export function needsNameAsk(profile: CandiceProfile): boolean {
  return !isUsableName(profile.preferredName) && profile.nameAsked === null;
}

/**
 * Record that the name question was asked (at most once per user). The
 * timestamp is supplied by the caller for determinism (no clock in this module
 * except through the caller).
 */
export function markNameAsked(profile: CandiceProfile, nowIso: string): CandiceProfile {
  return mergeProfile(profile, { nameAsked: { askedAt: nowIso } });
}

/**
 * Store the user's chosen name after confirmation. Empty string clears the
 * stored name (user requested removal) without re-arming the first-run ask.
 */
export function setPreferredName(profile: CandiceProfile, rawName: string): CandiceProfile {
  const name = normalizeName(rawName);
  return mergeProfile(profile, { preferredName: name.length > 0 ? name : null });
}

/**
 * Change the stored name later (spec 4 item 9: a simple way to change it).
 * Same as setPreferredName; kept as an explicit alias for callers that want
 * the "change later" intent named.
 */
export function changePreferredName(profile: CandiceProfile, rawName: string): CandiceProfile {
  return setPreferredName(profile, rawName);
}

/**
 * "Welcome back, <name>" — the natural-use phrasing. When no usable name is
 * stored, returns null so the caller decides whether to greet without a name.
 */
export function welcomeBackPhrase(profile: CandiceProfile): string | null {
  if (!isUsableName(profile.preferredName)) return null;
  return 'Welcome back, ' + profile.preferredName;
}
