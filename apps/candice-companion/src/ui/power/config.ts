/**
 * Turn-off control — configuration.
 *
 * The operator asked what happened to the off button. There was none. The
 * only power-shaped control on screen was the ANIMATION checkbox, which
 * turns her motion off and leaves her sitting there — so "I turned it off"
 * and "she is still on my screen" were both true at once, which reads as a
 * broken button rather than a different one.
 *
 * This is the missing control: it turns HER off, not her motion.
 *
 * @module
 */

/** Root class of the turn-off surface. */
export const POWER_OFF_CLASS = 'candice-power-off';

/** Stable id so the control mounts exactly once. */
export const POWER_OFF_ID = 'candice-power-off';

/** Exported style id so the style tag is injected exactly once. */
export const POWER_OFF_STYLE_ID = 'candice-power-off-style';

/**
 * Visible label.
 *
 * "Turn off", not "Quit" or "Exit": the operator's own word for what he
 * wanted was "turn candice off", and the control beside it says "Animation",
 * so the pair now reads as motion versus Candice herself.
 */
export const POWER_OFF_LABEL = 'Turn off';

/**
 * The reassurance, which is the whole reason this needs no confirm dialog.
 * A user who thinks "off" might be permanent hesitates over the button; one
 * sentence saying she comes back removes both the hesitation and the modal.
 */
export const POWER_OFF_HINT = 'Closes Candice. She opens again on your next question.';

/** Shown between the click and the process actually going away. */
export const POWER_OFF_BUSY_HINT = 'Closing…';

/**
 * Shown when the close could not be delivered to native. Rare, and the
 * honest thing to say: the button did not work, here is the other way.
 */
/*
 * Platform-neutral ON PURPOSE, following the same ruling already made for
 * the microphone refusal in ui/answer-controls/consent.ts.
 *
 * This named "the Dock or Task Manager" -- one of which is always wrong for
 * whoever is reading it, and a Mac has no Task Manager. Branching is not
 * available: there is no platform signal in this layer (nothing reaches the
 * webview; prefs/profile.ts reads Node's process.platform in a different
 * process), and inventing a capability field to carry one is a larger change
 * than this one sentence is worth. Saying what is true on both is correct
 * everywhere -- and shorter.
 */
export const POWER_OFF_FAILED_HINT = 'Could not close her. You can quit Candice the way you quit any other app on this computer.';
