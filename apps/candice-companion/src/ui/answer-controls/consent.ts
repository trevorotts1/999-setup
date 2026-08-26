/**
 * FIX-015 FAIL-5 capture consent gate (plan section 3D).
 *
 * Gating doctrine: the mic opens only when the OS-level state says it may.
 * The native `cmd_speech_permissions` command (name via
 * `SPEECH_COMMANDS.permissions` — Rust registration is truth) reports the
 * capture lane's real last-known state; this gate consults it on every
 * HOLD TO TALK press.
 *
 *  - `granted` / `not-determined` -> capture proceeds. Not-determined
 *    proceeds BY DESIGN: the macOS TCC prompt appears at the press itself
 *    (prompt_source "ptt-only") — the press IS the consent moment, and a
 *    first-run user must never be blocked before they have ever been
 *    asked.
 *  - `denied` / `no-device` / `error` -> capture is blocked. The machine
 *    is untouched: the typed-answer surface stays exactly as it was
 *    (spec 5.1: typing is always available).
 *  - a failed query -> blocked ("error"). Fail closed: unknown consent
 *    state never opens the mic.
 *
 * Press/release single-flight: the query may be async. A press whose
 * answer arrives AFTER release is discarded — the mic can never open
 * while the button is up. One live press at a time, mirroring the WS-08
 * `ptt:start` guard.
 */

export type CaptureConsent =
  | 'granted'
  | 'not-determined'
  | 'denied'
  | 'no-device'
  | 'error';

export const BLOCKED_CONSENTS: ReadonlySet<CaptureConsent> = new Set([
  'denied',
  'no-device',
  'error',
]);

/**
 * What the user is told when a HOLD TO TALK press is refused.
 *
 * Written the way Candice speaks, because that is who says it. The old
 * wording was IT-ticket voice -- "access was denied", "could not be
 * determined", "remain available" -- and it used > characters that read
 * badly if this text is ever spoken rather than shown.
 *
 * Each one ends by pointing at the way in that still works. A refusal the
 * user cannot act on is just a dead end with an explanation attached.
 */
export const BLOCKED_EXPLANATIONS: Readonly<Record<string, string>> = {
  denied:
    'I’m not allowed to use your microphone. To turn it on: System Settings, then Privacy & Security, then Microphone, then switch on Candice Companion. You can still type your answer.',
  'no-device':
    'I can’t find a microphone on this computer. You can still type your answer.',
  error:
    'I can’t check the microphone right now. You can still type your answer.',
};

export function isConsentBlocked(consent: CaptureConsent): boolean {
  return BLOCKED_CONSENTS.has(consent);
}

export interface CaptureConsentGateOptions {
  /** Real or injected permission query. Never throws by contract. */
  query: () => CaptureConsent | Promise<CaptureConsent>;
  /** Route a cleared press to the capture path (machine `ptt:start`). */
  onAllowed: () => void;
  /** Route the release (machine `ptt:stop`). */
  onStopped: () => void;
  /** Blocked press (machine untouched; typing stays). */
  onBlocked?: (consent: CaptureConsent, explanation: string) => void;
}

export interface CaptureConsentGate {
  /** Fire-and-forget press; a late answer is discarded after release. */
  requestStart(): void;
  /** Release the press; routes onStopped. */
  release(): void;
  /** True while a press is live (gated or not). */
  isPressed(): boolean;
  /** Idempotent teardown; pending answers are discarded. */
  destroy(): void;
}

export function createCaptureConsentGate(
  options: CaptureConsentGateOptions,
): CaptureConsentGate {
  let pressed = false;
  let destroyed = false;

  return {
    requestStart(): void {
      if (pressed || destroyed) return; // single-flight
      pressed = true;
      let answer: CaptureConsent | Promise<CaptureConsent>;
      try {
        answer = options.query();
      } catch {
        answer = 'error'; // fail closed: unknown consent never opens mic
      }
      void Promise.resolve(answer)
        .then((consent) => {
          // Released while the query was in flight: the mic must never open
          // with the button up. Discard.
          if (!pressed || destroyed) return;
          if (isConsentBlocked(consent)) {
            options.onBlocked?.(
              consent,
              BLOCKED_EXPLANATIONS[consent] ?? BLOCKED_EXPLANATIONS.error,
            );
            return;
          }
          options.onAllowed();
        })
        .catch(() => {
          // Rejected query: fail closed, never open the mic.
          if (!pressed || destroyed) return;
          options.onBlocked?.('error', BLOCKED_EXPLANATIONS.error);
        });
    },

    release(): void {
      if (!pressed) return;
      pressed = false;
      if (!destroyed) options.onStopped();
    },

    isPressed(): boolean {
      return pressed;
    },

    destroy(): void {
      destroyed = true;
      pressed = false;
    },
  };
}
