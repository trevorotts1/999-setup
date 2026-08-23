/**
 * Speech runtime composition seam (FIX-015, plan section 3A).
 *
 * The single webview consumer of the speech lanes. Mounts the deterministic
 * duplex controller (WS-20) and probes the native speech boundary
 * (`speech_health` / `speech_permissions`, registered in the Rust shell).
 * Heavy engines (whisper-cli, the Kokoro Python worker) live in subprocesses
 * spawned by the shell side; raw audio never crosses this boundary — every
 * command carries bounded text, request ids, and paths the cleanup lane
 * (WS-20) owns.
 *
 * FAIL-CLOSED CONTRACT (spec 20):
 *  - this module never invents a capability: every fact comes from the
 *    native probe or stays false;
 *  - the duplex controller gates every PTT press, including the interrupt
 *    of an active utterance (abort() fires in the press call);
 *  - permission prompting happens only at PTT (plan 3D), never here on
 *    startup; a denied or missing mic leaves typed answers and captions
 *    untouched;
 *  - the final privacy decision (FIX-017) is applied by the caller before
 *    any transcript reaches a speech/caption sink. This seam carries
 *    text only; it never calls a speak path on its own authority.
 */

import { DuplexController } from '../../src-tauri/audio/duplex/index.ts';
import type { SpeechTarget } from '../../src-tauri/audio/duplex/index.ts';

/** Mirrors the native SpeechHealth shape (src-tauri/speech/mod.rs, camelCase). */
export interface SpeechHealthFact {
  contractVersion: string;
  capabilities: {
    sttAvailable: boolean;
    ttsAvailable: boolean;
    systemTtsAvailable: boolean;
    duplexMounted: boolean;
    captureMounted: boolean;
    canonicalVoiceApproved: boolean;
  };
  sttRuntime: string;
  sttRuntimeVersion: string;
  sttModel: string;
  sttModelSha256: string;
  sttEngineReady: boolean;
  ttsEngineReady: boolean;
  ttsModel: string;
  ttsVoicepackRelease: string;
  canonicalVoiceId: string;
  canonicalVoiceApproval: string;
  degraded: boolean;
  degradedReason: string | null;
}

/** Mirrors the native SpeechPermissions shape (camelCase). */
export interface SpeechPermissionsFact {
  microphone: 'granted' | 'denied' | 'not-determined' | 'no-device' | 'error';
  promptSource: string;
  explanation: string;
}

/** IPC seam: any Tauri invoke adapter (real @tauri-apps/api/core or test stub). */
export interface SpeechInvokeAdapter {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface SpeechRuntime {
  /** The WS-20 controller — the single press/release authority. */
  readonly duplex: DuplexController;
  /** Fact snapshot from the last probe (never re-probed implicitly). */
  readonly health: SpeechHealthFact | null;
  readonly permissions: SpeechPermissionsFact | null;
  probe(): Promise<SpeechHealthFact>;
  probePermissions(): Promise<SpeechPermissionsFact>;
  /**
   * Attach the speech output target (TTS engine handle adapter). The
   * controller calls abort() synchronously on interrupt and awaits stop()
   * through its tail/force limbs.
   */
  attachSpeechTarget(target: SpeechTarget): void;
  detachSpeechTarget(): void;
}

export class SpeechRuntimeError extends Error {
  override name = 'SpeechRuntimeError';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new SpeechRuntimeError('speech response is not an object');
  }
  return value as Record<string, unknown>;
}

function parseSpeechHealth(value: unknown): SpeechHealthFact {
  const record = asRecord(value);
  const caps = asRecord(record.capabilities);
  const bool = (k: string): boolean => {
    if (typeof caps[k] !== 'boolean') {
      throw new SpeechRuntimeError(`speech health capability ${k} must be boolean`);
    }
    return caps[k] as boolean;
  };
  const topBool = (k: string): boolean => {
    if (typeof record[k] !== 'boolean') {
      throw new SpeechRuntimeError(`speech health field ${k} must be boolean`);
    }
    return record[k] as boolean;
  };
  const str = (k: string): string => {
    if (typeof record[k] !== 'string') {
      throw new SpeechRuntimeError(`speech health field ${k} must be a string`);
    }
    return record[k] as string;
  };
  const degradedReason = record.degradedReason === null ? null : str('degradedReason');
  if (typeof record.degraded !== 'boolean') {
    throw new SpeechRuntimeError('speech health degraded must be boolean');
  }
  return {
    contractVersion: str('contractVersion'),
    capabilities: {
      sttAvailable: bool('sttAvailable'),
      ttsAvailable: bool('ttsAvailable'),
      systemTtsAvailable: bool('systemTtsAvailable'),
      duplexMounted: bool('duplexMounted'),
      captureMounted: bool('captureMounted'),
      canonicalVoiceApproved: bool('canonicalVoiceApproved'),
    },
    sttRuntime: str('sttRuntime'),
    sttRuntimeVersion: str('sttRuntimeVersion'),
    sttModel: str('sttModel'),
    sttModelSha256: str('sttModelSha256'),
    sttEngineReady: topBool('sttEngineReady'),
    ttsEngineReady: topBool('ttsEngineReady'),
    ttsModel: str('ttsModel'),
    ttsVoicepackRelease: str('ttsVoicepackRelease'),
    canonicalVoiceId: str('canonicalVoiceId'),
    canonicalVoiceApproval: str('canonicalVoiceApproval'),
    degraded: record.degraded as boolean,
    degradedReason,
  };
}

function parseSpeechPermissions(value: unknown): SpeechPermissionsFact {
  const record = asRecord(value);
  const microphone = record.microphone;
  if (
    microphone !== 'granted'
    && microphone !== 'denied'
    && microphone !== 'not-determined'
    && microphone !== 'no-device'
    && microphone !== 'error'
  ) {
    throw new SpeechRuntimeError('speech permissions microphone state is invalid');
  }
  if (typeof record.promptSource !== 'string' || typeof record.explanation !== 'string') {
    throw new SpeechRuntimeError('speech permissions fields must be strings');
  }
  return {
    microphone,
    promptSource: record.promptSource as string,
    explanation: record.explanation as string,
  };
}

/**
 * Consent-gated PTT adapter (plan 3D). Maps a duplex press to the native
 * capture admission with an explicit permission check. Denied or busy
 * capture never blocks the controller state; the caller falls through to
 * typed answers.
 */
export interface ConsentGate {
  /** The native permission fact (never re-probed on a press). */
  readonly permissions: SpeechPermissionsFact | null;
  /**
   * Press admission: true when the controller may open the mic. False keeps
   * typing available and reports the denial reason.
   */
  admitPress(): Promise<boolean>;
  /** Release admission: idempotent, always succeeds. */
  release(): Promise<void>;
}

export async function defaultSpeechInvokeAdapter(): Promise<SpeechInvokeAdapter> {
  const { invoke } = await import('@tauri-apps/api/core');
  return { invoke };
}

/**
 * Mount the speech runtime seam (FAIL-1 wiring). Pure composition: creates
 * the duplex controller, probes the native boundary once, and hands back
 * the adapter — the bridge owns tick-driving and event delivery.
 */
export async function initializeSpeechRuntime(
  invokeAdapter?: SpeechInvokeAdapter,
): Promise<SpeechRuntime> {
  const adapter = invokeAdapter ?? await defaultSpeechInvokeAdapter();
  const duplex = new DuplexController();
  let health: SpeechHealthFact | null = null;
  let permissions: SpeechPermissionsFact | null = null;
  try {
    health = parseSpeechHealth(await adapter.invoke('speech_health'));
  } catch {
    // Native boundary absent: duplex stays mounted, capabilities stay
    // unknown — captions/typing unaffected (spec 20 fail closed).
    health = null;
  }
  try {
    permissions = parseSpeechPermissions(await adapter.invoke('speech_permissions'));
  } catch {
    permissions = null;
  }

  const runtime: SpeechRuntime = {
    duplex,
    get health() {
      return health;
    },
    get permissions() {
      return permissions;
    },
    async probe(): Promise<SpeechHealthFact> {
      const next = parseSpeechHealth(await adapter.invoke('speech_health'));
      health = next;
      return next;
    },
    async probePermissions(): Promise<SpeechPermissionsFact> {
      const next = parseSpeechPermissions(await adapter.invoke('speech_permissions'));
      permissions = next;
      return next;
    },
    attachSpeechTarget(target: SpeechTarget): void {
      duplex.attachTarget(target);
    },
    detachSpeechTarget(): void {
      duplex.detachTarget();
    },
  };
  return runtime;
}

/**
 * Surface the honest voice-approval status (FAIL-6). `af_heart` is the
 * pre-approval default: it may be used as the canonical voice, but its
 * approval status must be visible — never claimed approved.
 */
export function voiceApprovalStatusText(health: SpeechHealthFact | null): string {
  if (!health) {
    return 'Voice availability unknown — captions and typed answers remain available.';
  }
  if (health.canonicalVoiceApproval === 'approved') {
    return 'Canonical voice approved.';
  }
  return 'Canonical voice pending operator approval.';
}

/**
 * Status text for the runtime surface. Degraded speech never hides the
 * captions/text fallback (plan 3D).
 */
export function speechStatusText(health: SpeechHealthFact | null): string {
  if (!health) {
    return 'Speech runtime not probed — typed answers and captions remain available.';
  }
  if (health.degraded) {
    return health.degradedReason ?? 'Speech is degraded — typed answers and captions remain available.';
  }
  const parts: string[] = [];
  if (health.capabilities.sttAvailable) parts.push('speech-to-text');
  if (health.capabilities.ttsAvailable) parts.push('text-to-speech');
  if (health.capabilities.systemTtsAvailable) parts.push('system voice fallback');
  if (parts.length === 0) {
    return 'No speech engines available — typed answers and captions remain available.';
  }
  return `Speech available: ${parts.join(', ')}.`;
}
