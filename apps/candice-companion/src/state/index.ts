/**
 * Candice state machine public surface (Master Spec 0E WS-08).
 *
 * Single-file barrel: everything this lane owns is exported here so the rest
 * of the app imports one stable path (`@candice/state`), never deep imports
 * that could be re-claimed by another slice.
 */
export {
  createCandiceStateMachine,
  INITIAL_STATE,
  CANDICE_ERRORS,
  isBusy,
} from './machine.ts';

export type {
  CandiceState,
  CandiceEvent,
  CandiceEventType,
  CandiceStatus,
  CandicePhase,
  CandiceErrorCode,
  CandiceTransition,
  CandiceSideEffect,
  CandiceStateMachine,
} from './machine.ts';

export { CANDICE_STATUSES, SKILL_PROGRESS_STATUSES, ALL_CANDICE_STATUSES, CANDICE_STATUS_LABELS } from './status.ts';

export { STATUS_EVENT_SOURCE } from './event-sources.ts';
