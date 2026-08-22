/**
 * Canonical Candice statuses (Master Spec 0E WS-08).
 *
 * Two families, one type:
 * - CANDICE_STATUSES — the nine canonical states of the WS-08 acceptance
 *   criterion: idle, listening, transcribing, confirming, thinking, speaking,
 *   compact, recovering, text-fallback.
 * - SKILL_PROGRESS_STATUSES — real skill-run progress states from spec 16
 *   (BUILDING, QUALITY CHECKING, FIXING, WAITING FOR USER, COMPLETE). They are
 *   reported by the bridge as real status events, never invented.
 *
 * The protocol schema in `packages/candice-protocol/schemas/status-event.schema.json`
 * (WS-01) is the wire contract; this list mirrors it. If the schema and this
 * list ever diverge, the schema wins on the wire and this list is repaired
 * through the owning lanes (CROSS-LANE-FINDING), never silently.
 */
export const CANDICE_STATUSES = [
  'idle',
  'listening',
  'transcribing',
  'confirming',
  'thinking',
  'speaking',
  'compact',
  'recovering',
  'text-fallback',
] as const;

export const SKILL_PROGRESS_STATUSES = [
  'building',
  'quality-checking',
  'fixing',
  'waiting-for-user',
  'complete',
] as const;

export const ALL_CANDICE_STATUSES = [
  ...CANDICE_STATUSES,
  ...SKILL_PROGRESS_STATUSES,
] as const;

export type CandiceStatus = (typeof ALL_CANDICE_STATUSES)[number];

export const CANDICE_STATUS_LABELS: Record<CandiceStatus, string> = {
  idle: 'Idle',
  listening: 'Listening',
  transcribing: 'Transcribing',
  confirming: 'Confirming',
  thinking: 'Thinking',
  speaking: 'Speaking',
  compact: 'Compact companion',
  recovering: 'Recovering',
  'text-fallback': 'Text fallback',
  building: 'Building',
  'quality-checking': 'Quality checking',
  fixing: 'Fixing',
  'waiting-for-user': 'Waiting for user',
  complete: 'Complete',
};
