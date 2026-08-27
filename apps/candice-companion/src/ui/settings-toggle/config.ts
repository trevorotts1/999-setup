/**
 * A plain on/off settings row — shared configuration.
 *
 * ## Why this exists
 *
 * The operator asked for three switches: turn her off, turn her voice off,
 * and turn her holographic image off. Only two controls existed. Motion had
 * one (`ui/animation-toggle`), presence got one (`ui/power`), and the other
 * two had nowhere to live:
 *
 *   - voice could only be switched while a question was ON SCREEN. The
 *     `Voice: ON/OFF` button belongs to the answer surface, which is created
 *     when a question arrives and destroyed when it closes, so at rest there
 *     was no way to mute her at all.
 *   - the hologram had no control of ANY kind. "Animation off" only reduces
 *     motion; she stays fully visible. The operator said it plainly --
 *     "u have animation off, when i turn it off its suppose to turn candace
 *     off" -- and motion, presence and visibility are three different
 *     things.
 *
 * This is the generic row those two use. It is deliberately NOT a rewrite of
 * `ui/animation-toggle`: that control maps a two-state checkbox onto a
 * three-state field (`reducedMotion: null | true`) for accessibility reasons
 * that do not generalise, and rewriting a working accessibility control to
 * share code with two new ones would risk the thing that already works.
 *
 * @module
 */

/** Shared row class, so one CSS block and one hit-test entry serve all rows. */
export const SETTINGS_TOGGLE_CLASS = 'candice-settings-toggle';

/**
 * The single container that holds every settings row.
 *
 * Each row used to paint its own opaque background and border, because each
 * has to stay readable over a transparent window with an arbitrary desktop
 * behind it. Individually correct, collectively a stack of separate floating
 * cards. The paint moves here: this container is opaque once, and the rows
 * inside it are transparent.
 */
export const SETTINGS_PANEL_CLASS = 'candice-settings-panel';

/** Style element id — injected once, however many rows mount. */
export const SETTINGS_TOGGLE_STYLE_ID = 'candice-settings-toggle-style';

/** Suffix for the live-region hint under each row. */
export const SETTINGS_TOGGLE_HINT_CLASS = 'candice-settings-toggle-hint';

/** The voice row. */
export const VOICE_TOGGLE = Object.freeze({
  id: 'candice-voice-toggle',
  className: 'candice-voice-toggle',
  label: 'Voice',
  /* Says what SHE does, not what the setting is named. */
  onHint: 'Candice reads questions out loud.',
  offHint: 'Candice stays quiet. You can still read everything on screen.',
});

/** The hologram row. */
export const HOLOGRAM_TOGGLE = Object.freeze({
  id: 'candice-hologram-toggle',
  className: 'candice-hologram-toggle',
  /* The operator's own word for her on-screen image. */
  label: 'Hologram',
  onHint: 'Candice is visible.',
  offHint: 'Candice is hidden. She still asks and answers as normal.',
});
