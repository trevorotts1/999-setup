/**
 * Compact progress-companion configuration (Master Spec 0E WS-10, sections
 * 10 / 16 / 19).
 *
 * Canonical WS-10 declarations. The compact companion is the small
 * always-present surface Candice keeps after the structured interview ends
 * (spec 16: "When the interview is complete, Candice does not disappear").
 *
 * Spec 19 resource discipline: the compact state uses MINIMAL animation.
 * This lane therefore declares NO continuous animation of its own — the
 * only motion is a short one-shot expansion transition, and even that is
 * dropped under OS reduced motion (WS-14's class; this lane consumes it,
 * never defines it).
 *
 * Transparency contract (spec 11): no rectangular UI background behind the
 * character; the small interaction surface is a separate UI layer that
 * floats above the transparent window. No name references final artwork —
 * the WR-013 asset contract binds the character image; this lane only
 * defines where the rendered surface goes.
 *
 * @module
 */

/** Version bump on any breaking shape change of the surface below. */
export const COMPACT_CONTRACT_VERSION = 1;

/** Root class marking the compact surface. */
export const COMPACT_ROOT_CLASS = 'candice-compact';

/** Class toggled on the expanded interaction surface. */
export const COMPACT_EXPANDED_CLASS = 'candice-compact-expanded';

/** Reduced-motion class consumed from the WS-14 lane (never defined here). */
export const COMPACT_REDUCED_MOTION_CLASS = 'candice-reduced-motion';

/**
 * Compact visual modes. `bubble` paints no background at all (the
 * character's own alpha is the only pixel content, spec 11); `surface`
 * shows the small interaction surface the component owns. Never a
 * rectangular card behind the character.
 */
export const COMPACT_VISUAL_MODES = ['bubble', 'surface'] as const;
export type CompactVisualMode = (typeof COMPACT_VISUAL_MODES)[number];

/** One-shot expansion transition duration, dropped under reduced motion. */
export const COMPACT_EXPAND_MS = 180;

/**
 * Character stage slot id. WR-013 mounts the final character image in
 * (late-binding manifest; source PNGs are READ-ONLY for all lanes, 9.4
 * item 8). The compact view only reserves the slot — it never loads or
 * names artwork.
 */
export const COMPACT_STAGE_SLOT_ID = 'candice-compact-stage-slot';

/** Status-change visuals used by the compact surface. */
export const COMPACT_STATUS_ATTR = 'data-candice-compact-status';

/** One interactive element type per input surface. */
export const COMPACT_EXPAND_BUTTON_ROLE = 'button';

/**
 * Accessible name of the compact message input.
 *
 * Deliberately not the placeholder. The packaged accessibility suite finds
 * this field by label; when the label WAS the placeholder, rewording the
 * placeholder for users broke a ship gate with no test naming the cause.
 */
export const COMPACT_INPUT_LABEL = 'Compact message input';
