/**
 * Shared speech command-name constants (QFIX Q-04, design doc q2-design.md
 * section 4).
 *
 * Authority: Rust registration is truth. Every Tauri speech command is
 * registered as `cmd_speech_<noun>` in the shell invoke_handler
 * (`src-tauri/src/lib.rs`, `generate_handler![...]`); TypeScript must call
 * exactly those names. No dual naming, no alias layer.
 *
 * The strings below are the exact names registered in
 * `src-tauri/src/lib.rs` and implemented in `src-tauri/speech/mod.rs`.
 * Drift fails CI: `speech-commands.test.ts` re-parses the Rust
 * registration block from the checked-out source and asserts the module
 * equals it, so a rename on either side without the other cannot merge
 * green.
 *
 * The `cmd_speech_timing_*` trio is a different subsystem and keeps its
 * own module (`speech-timing.ts`) — deliberately not listed here.
 */

export const SPEECH_COMMANDS = {
  health: 'cmd_speech_health',
  permissions: 'cmd_speech_permissions',
  captureStart: 'cmd_speech_capture_start',
  captureStop: 'cmd_speech_capture_stop',
  transcribe: 'cmd_speech_transcribe',
  speak: 'cmd_speech_speak',
  stop: 'cmd_speech_stop',
} as const;

export type SpeechCommandName = typeof SPEECH_COMMANDS[keyof typeof SPEECH_COMMANDS];

/** Every command name exactly once, for iteration in contract tests. */
export const SPEECH_COMMAND_NAMES: readonly SpeechCommandName[] = Object.values(SPEECH_COMMANDS);
