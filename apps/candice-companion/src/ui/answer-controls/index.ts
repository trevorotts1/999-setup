/**
 * Floating answer controls — public surface (Master Spec 0E WS-09).
 *
 * The WS-09 lane exports the floating answer controls (the two answer
 * methods + the separate voice toggle + the spec-6 transcript
 * confirmation) and the PTT control they embed. Ownership:
 * `apps/candice-companion/src/ui/answer-controls/**` +
 * `apps/candice-companion/src/ui/ptt/**` (PROJECT-MANIFEST 9.2, WS-09 glob).
 *
 * Consumers:
 * - WS-06 shell boot: mounts the answer surface into the interview stage
 *   and forwards bridge events to the controller.
 * - WS-10 compact lane: consumes the SAME labels/classes for its own
 *   (separate) surface.
 * - WR-009/WS-17 capture path: receives PTT intent via the control hooks.
 */

export {
  ANSWER_CONTROLS_CONTRACT_VERSION,
  ANSWER_CONTROLS_ROOT_CLASS,
  ANSWER_CONFIRM_CLASS,
  ANSWER_INPUT_CLASS,
  ANSWER_REDUCED_MOTION_CLASS,
  ANSWER_CONTROLS_STYLE_ID,
  ANSWER_CONTROLS_LABELS,
  ANSWER_METHODS,
  type AnswerMethod,
  type AnswerControlsPreferences,
} from './config.ts';

export {
  answerControlsModel,
  normalizeMethod,
  isQuestionPromptStatus,
  type AnswerControlsModel,
} from './model.ts';

export {
  createAnswerControlsView,
  mountAnswerControlsStyle,
  ANSWER_CONTROLS_STYLE_TEXT,
  type AnswerControlsView,
  type AnswerControlsViewHandlers,
} from './view.ts';

export {
  createAnswerControlsController,
  type AnswerControlsController,
  type AnswerControlsControllerOptions,
} from './controller.ts';
