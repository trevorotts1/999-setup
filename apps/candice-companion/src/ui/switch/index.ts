/**
 * The sliding on/off switch.
 *
 * The operator asked for it in his own words, twice, after being handed a
 * checkbox: "I want that on off but slide to the left off, slide to the right
 * on... slide to the left, red. Slide to the right, green."
 *
 * ## Why this is one module and not three copies
 *
 * Voice, Hologram and Candice sit on a single line and must be
 * indistinguishable from each other. Three modules each building their own
 * markup would drift the moment one of them is edited, and "they look the
 * same" would be a claim nothing enforces. They call this instead, and the
 * one stylesheet that dresses it lives in `src/styles.css` beside the layout
 * tokens, for the same reason.
 *
 * ## Why there is still a real checkbox under it
 *
 * The visible switch is two spans, but the CONTROL is a native
 * `input[type=checkbox]`, transparent and stretched over the track:
 *
 *   - Space toggles it and Tab reaches it, with no keydown handling to write;
 *   - the OS draws its own focus ring, on the track, because the input is
 *     exactly where the track is;
 *   - the checked state is announced natively, so there is no `aria-checked`
 *     to keep in sync with a `div` — the failure mode where the screen reader
 *     and the screen disagree cannot happen here;
 *   - `opacity: 0`, never `display: none` or `visibility: hidden`: those
 *     remove it from the focus order and the accessibility tree, which would
 *     make the switch unreachable by keyboard and invisible to a reader.
 *
 * The caller supplies the accessible NAME by pointing a `<label for>` at the
 * id it passes in.
 *
 * @module
 */

/** The positioned host: the input and the visible track live inside it. */
export const SWITCH_CLASS = 'candice-switch';

/** The pill that changes colour. */
export const SWITCH_TRACK_CLASS = 'candice-switch-track';

/** The dot that slides left for off and right for on. */
export const SWITCH_KNOB_CLASS = 'candice-switch-knob';

export interface SwitchParts {
  /** Drop this in the row. */
  root: HTMLElement;
  /** The real checkbox: state, focus and keyboard all live here. */
  input: HTMLInputElement;
}

/**
 * Build one switch. `id` becomes the checkbox's id, so a `<label for=id>`
 * elsewhere in the row names it.
 */
export function createSwitch(doc: Document, id: string): SwitchParts {
  const root = doc.createElement('span');
  root.className = SWITCH_CLASS;

  const input = doc.createElement('input');
  input.setAttribute('type', 'checkbox');
  input.id = id;

  const track = doc.createElement('span');
  track.className = SWITCH_TRACK_CLASS;

  const knob = doc.createElement('span');
  knob.className = SWITCH_KNOB_CLASS;
  track.append(knob);

  // INPUT FIRST, TRACK SECOND. The stylesheet moves the knob and recolours
  // the track with `input:checked + .candice-switch-track`, an adjacent
  // sibling selector, so this order is load-bearing: reverse it and the
  // switch renders but never visibly changes state.
  root.append(input, track);

  return { root: root as unknown as HTMLElement, input: input as unknown as HTMLInputElement };
}
