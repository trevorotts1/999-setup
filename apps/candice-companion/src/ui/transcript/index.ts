/**
 * Transcript confirmation/edit/retry — public surface (Master Spec 0E
 * WS-18, spec 6 / 5.1).
 *
 * The WS-18 lane owns the full confirmation UX: the heard prompt
 * ("Here is what I heard…"), the unconfirmed transcript display, the
 * USE ANSWER / EDIT / TRY AGAIN actions, the EDIT editor with wire-bound
 * validation, and the EXACTLY-ONCE submission latch (E.1 WS-18: no voice
 * transcription is submitted to the skill until the user confirms; EDIT
 * and TRY AGAIN work; a confirmed answer is counted exactly once).
 *
 * Ownership:
 * `apps/candice-companion/src/ui/transcript/**`
 * (PROJECT-MANIFEST 9.2, WR-014/WS-18 glob).
 *
 * Consumers:
 * - WS-06 shell boot: mounts the transcript surface into the interview
 *   stage, feeds bridge events to the controller.
 * - WS-09 answer-controls controller: hooks its EDIT/TRY AGAIN intent
 *   transports and USE ANSWER submission into the SAME session answer
 *   path — one answer, one route, one count.
 * - WS-16/WS-17 capture path: delivers `speech:transcript`; the
 *   transcript is UNCONFIRMED until this lane's latch opens (contract of
 *   whisper-runtime.mjs: "returned text is UNCONFIRMED — WS-18 owns the
 *   confirm-before-submit gate").
 * - WS-04 MCP answer path: consumes the confirmed text with
 *   `userConfirmedTranscript: true` (validate.js rejects anything else).
 */

export {
  TRANSCRIPT_CONTRACT_VERSION,
  TRANSCRIPT_ROOT_CLASS,
  TRANSCRIPT_HEARD_CLASS,
  TRANSCRIPT_EDITOR_CLASS,
  TRANSCRIPT_ACTIONS_CLASS,
  TRANSCRIPT_STYLE_ID,
  TRANSCRIPT_REDUCED_MOTION_CLASS,
  TRANSCRIPT_MAX_TEXT_LENGTH,
  TRANSCRIPT_LABELS,
} from './config.ts';

export {
  transcriptModel,
  validateTranscriptEdit,
  type TranscriptModel,
  type TranscriptEditValidity,
} from './model.ts';

export {
  createTranscriptView,
  mountTranscriptStyle,
  TRANSCRIPT_STYLE_TEXT,
  type TranscriptView,
  type TranscriptViewHandlers,
} from './view.ts';

export {
  createTranscriptController,
  type TranscriptController,
  type TranscriptControllerOptions,
} from './controller.ts';
