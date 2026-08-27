/**
 * Captions configuration (Master Spec 0E WS-14, spec 5.2 / 6 / 28).
 *
 * Canonical WS-14 declarations for the captions surface, owned by this
 * lane: `apps/candice-companion/src/ui/captions/**`.
 *
 * Spec 5.2: "Always show captions regardless of voice-output state." The
 * caption is the LAST thing said/asked — it is never gated by
 * `voiceOutputEnabled`, never blanked by mute, and never silently
 * cleared while the content it reflects is still active. Captions are
 * presentation only: they never replace the question/answer contract
 * (WS-01/WS-04) and never carry an AI answer (the brain is the active
 * Claude session, spec 2).
 *
 * @module
 */

/** Version bump on any breaking shape change of the captions surface. */
export const CAPTIONS_CONTRACT_VERSION = 1;

/** Root class of the captions surface. */
export const CAPTIONS_ROOT_CLASS = 'candice-captions';

/** A11y live-region role (always present; captions are read aloud by AT). */
export const CAPTIONS_ROLE = 'status';

/** A11y live setting: polite announcements only (spec 14 may be assertive). */
export const CAPTIONS_LIVE = 'polite';

/** Exported style id, so the style tag can be asserted/mounted once. */
export const CAPTIONS_STYLE_ID = 'candice-captions-style';

/** Default caption visibility (never hidden by the voice toggle). */
export const CAPTIONS_DEFAULT_VISIBLE = true;

/** Anti-runaway ceiling on caption text, NOT a display bound.
 *
 * This was 500 and it was a readability device: a 765-char question rendered
 * as 499 chars plus an ellipsis, and the remainder was unreachable because
 * the panel did not scroll. Truncating the thing the user is being asked to
 * answer is worse than a tall panel. The panel now scrolls (see
 * `.candice-captions-text` in view.ts) and this ceiling exists only so a
 * malformed or hostile question cannot push unbounded text into the DOM.
 * It sits far above any real question in the registry (longest: 765). */
export const CAPTIONS_MAX_CHARS = 20000;

/** Text scale tiers (spec 9 "text size" preference consumed as a plain factor). */
export const CAPTIONS_TEXT_SCALES = ['small', 'medium', 'large'] as const;
export type CaptionsTextScale = (typeof CAPTIONS_TEXT_SCALES)[number];

/** CSS class toggled when the caption is stale (faded, still visible). */
export const CAPTIONS_STALE_CLASS = 'candice-captions-stale';

/** Exact spec-5.2 acceptance label shown in the caption settings row. */
export const CAPTIONS_SETTINGS_LABEL = 'Always show captions';
