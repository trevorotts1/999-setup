/**
 * What do we CALL the window Candice is working with?
 *
 * Every user-facing string in this app said "Claude". The operator does not
 * run one harness -- he runs `claude`, `claude-nine`, `claude-9` and
 * `claude-codex` -- so a message reading "Keep answering in the Claude
 * window" named a window that was not the one on his screen. Sending a stuck
 * user to the wrong window is worse than not naming one at all.
 *
 * Native measures the answer (see `src-tauri/src/harness.rs`, which reads
 * `CLAUDE_CONFIG_DIR`); this module is the single place that turns it into
 * words, so the phrasing cannot drift between the four surfaces that use it.
 *
 * ## The unknown case is a real case, not an error
 *
 * When the app is opened from the Dock there is no harness environment to
 * read, and native truthfully reports `null`. We then say "your terminal".
 * That is deliberate: guessing "Claude" would be a fabrication, and it is
 * exactly the fabrication this module exists to remove.
 *
 * @module
 */

/** What we say when nobody told us which harness is running. */
export const UNKNOWN_HARNESS_PHRASE = 'your terminal';

/** The harness names native is allowed to report. */
const KNOWN_HARNESSES = ['Claude', 'Claude-Nine'] as const;

export type HarnessName = (typeof KNOWN_HARNESSES)[number];

/**
 * The resolved name, or null for "not told". Module-level because the answer
 * cannot change while the process lives: it comes from the environment this
 * process was launched with.
 */
let resolved: HarnessName | null = null;

/**
 * Accept a name from native. Anything that is not a name we recognise is
 * discarded rather than displayed -- a malformed IPC value must not become
 * on-screen copy.
 */
export function setHarnessName(value: unknown): HarnessName | null {
  resolved = KNOWN_HARNESSES.includes(value as HarnessName) ? (value as HarnessName) : null;
  return resolved;
}

/** The resolved name, or null when unknown. */
export function harnessName(): HarnessName | null {
  return resolved;
}

/**
 * Probe native once. Never throws and never rejects: not knowing the harness
 * name is a cosmetic loss, and it must not be able to cost the boot (spec 20).
 *
 * A missing adapter means "production" here, NOT "skip the probe" -- the
 * composition root leaves `invokeAdapter` undefined outside tests, so an
 * early return on null would have made every real run report the unknown
 * phrase while every test passed. Resolve the live Tauri bridge instead,
 * exactly as the capability probe next to it does.
 */
export async function probeHarnessName(
  adapter?: { invoke(command: string): Promise<unknown> } | null,
): Promise<HarnessName | null> {
  try {
    const bridge = adapter ?? (await import('@tauri-apps/api/core'));
    return setHarnessName(await bridge.invoke('cmd_get_harness_name'));
  } catch {
    // No native boundary (browser dev run), or a build whose native side
    // predates the command. Stay unknown and say "your terminal".
    return resolved;
  }
}

/**
 * The place to go, as a noun phrase: "the Claude window", "the Claude-Nine
 * window", or "your terminal".
 */
export function harnessWindowPhrase(): string {
  return resolved === null ? UNKNOWN_HARNESS_PHRASE : `the ${resolved} window`;
}

/**
 * Button label for the fallback path (spec 5.1).
 *
 * The spec pins this string as "Answer in Claude instead", so this
 * PARAMETERISES that wording rather than rewriting it: with the plain
 * harness the result is byte-identical to the spec, and only the name
 * varies. That is also what keeps the packaged accessibility driver
 * working -- it finds this control by its exact accessible name.
 */
export function answerElsewhereLabel(): string {
  return `Answer in ${resolved ?? UNKNOWN_HARNESS_PHRASE} instead`;
}

/** Button label for handing focus back (spec 13.3), parameterised the same way. */
export function returnToHarnessLabel(): string {
  return `Return to ${resolved ?? UNKNOWN_HARNESS_PHRASE}`;
}

/**
 * Does this caption belong to the fallback path? The captions lane used to
 * compare against the literal string `'Answer in Claude instead'`, which
 * silently stops matching the moment the label carries a harness name -- and
 * the only symptom would have been that this caption quietly started fading
 * out like a status message instead of holding like an instruction.
 */
export function isAnswerElsewhereCaption(caption: string): boolean {
  return caption.startsWith('Answer in ');
}

/** Reset for tests. Production never calls this. */
export function resetHarnessNameForTest(): void {
  resolved = null;
}
