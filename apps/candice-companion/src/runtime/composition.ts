/**
 * Runtime composition root (FIX-009).
 *
 * This intentionally has no answer-submission method. FIX-011 will attach a
 * verified same-session bridge; until it does, this root exposes that absence
 * to the visual shell without hiding the approved companion artwork.
 */

import type { CandiceStateMachine } from '../state/machine.ts';
import {
  probeRuntimeCapabilities,
  type RuntimeCapabilities,
  type RuntimeInvokeAdapter,
} from './capabilities.ts';
import { initializeAuthenticatedBridge } from './bridge.ts';
import { AssetRegistry } from '../../assets/candice/loader.ts';
import {
  GESTURE_CHARACTER_CLASS,
  mountGestureStage,
} from '../shell/gesture-stage.ts';
import { VISUAL_STAGE_ID } from '../shell/visual-stage.ts';
import {
  bindStatusFlow,
  type GestureStageHost,
} from '../shell/candice-composition.ts';
import { createCaptionsController } from '../ui/captions/index.ts';
import { defaultProfile } from '../prefs/profile.ts';
import type { CandiceProfile } from '../prefs/schema.ts';
import type { PrefsLoadResult } from '../prefs/ipc.ts';
import {
  initializeCandiceInteractionComposition,
  type InteractionComposition,
} from './interaction-composition.ts';
import { initializeSpeechRuntime, defaultSpeechInvokeAdapter, type SpeechRuntime } from './speech-runtime.ts';
import { SpeechOrchestrator } from './speech-orchestrator.ts';

/**
 * The welcome shown by the slash-command wake path before preflight or any
 * governed question. It is presentation only: no answer is requested and no
 * protocol count/order changes here.
 */
const SETUP_CHECK_GREETING =
  "Hi, I'm Candice. I'm here to help you build the app, the software, or the thing you've always dreamed about. Think of me as your fairy godmother: you make a wish, and I help make it real. I'm getting everything ready for us now.";

export interface RuntimeCompositionOptions {
  invokeAdapter?: RuntimeInvokeAdapter;
  /**
   * FIX-014 (I-08/I-11): the profile loaded ONCE at boot by main.ts, plus
   * its load result. Absent (tests/legacy callers) the composition falls
   * back to the defaults profile with a truthful failed-load result.
   */
  profile?: CandiceProfile;
  prefsLoad?: PrefsLoadResult;
  /**
   * Speech runtime seam (FIX-015). Optional: tests and headless runs may
   * omit it; the visual shell stays fully usable (spec 20 fail closed).
   */
  speech?: { invokeAdapter?: import('./speech-runtime.ts').SpeechInvokeAdapter };
}

export async function initializeRuntimeComposition(
  root: HTMLElement,
  machine: CandiceStateMachine,
  options: RuntimeCompositionOptions = {},
): Promise<RuntimeCapabilities> {
  const capabilities = await probeRuntimeCapabilities(options.invokeAdapter);
  // FIX-014 (I-08/I-11): the boot-loaded profile (main.ts loads it once via
  // the native seam). Absent options degrade truthfully to defaults with a
  // failed-load result — never a fabricated persisted preference.
  const profile: CandiceProfile = options.profile ?? defaultProfile();
  const prefsLoad: PrefsLoadResult = options.prefsLoad ?? {
    ok: false,
    profile: defaultProfile(),
    recoveredFromCorruption: false,
    error: 'profile not provided to composition',
  };
  root.dataset.runtimeContractVersion = capabilities.contractVersion;
  root.dataset.runtimeComposition = 'active';
  root.dataset.bridgeAvailable = String(capabilities.bridgeAvailable);
  root.dataset.answerRoundTripAvailable = String(capabilities.answerRoundTripAvailable);

  const status = document.createElement('p');
  status.id = 'candice-runtime-status';
  status.className = 'candice-runtime-status candice-status-surface';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = runtimeStatusText(capabilities);
  root.append(status);

  // FIX-015 speech seam + QFIX Q-02 orchestrator (design section 2): mount
  // the duplex controller, probe the native boundary once, and create THE
  // one speech command executor. Failure is silent capability absence —
  // the shell never blocks composition on speech (spec 20).
  let speech: SpeechRuntime | null = null;
  let orchestrator: SpeechOrchestrator | null = null;
  try {
    speech = await initializeSpeechRuntime(options.speech?.invokeAdapter);
    root.dataset.speechSeam = 'active';
    if (speech.health) {
      root.dataset.speechStatus = speech.health.degraded ? 'degraded' : 'available';
      root.dataset.canonicalVoiceApproval = speech.health.canonicalVoiceApproval;
    } else {
      root.dataset.speechStatus = 'unprobed';
    }
    // The sole-caller rule (design 2.1): every `cmd_speech_*` invoke on the
    // voice path originates inside this orchestrator — consent, capture,
    // transcribe, speak, stop. The fake `Date.now()` target that used to be
    // attached here is GONE; the duplex target now drives the real native
    // stop through the orchestrator.
    orchestrator = new SpeechOrchestrator({
      invoke: options.speech?.invokeAdapter
        ?? await defaultSpeechInvokeAdapter(),
      machine,
      duplex: speech.duplex,
    });
    speech.attachSpeechTarget(orchestrator.createSpeechTarget());
  } catch {
    root.dataset.speechStatus = 'unavailable';
  }

  // Animation host (FIX-016): bind the gesture stage to the machine only
  // after the backend handshake, per the audit repair plan. Shell errors
  // while the host is attached return the machine to its original
  // transition surface so the text fallback cannot drive stale layers.
  // Reduced motion is owned by the WS-14 runtime in main.ts, which
  // applies the class to `<html>` before this root runs; the driver
  // reads it through the stage's ownerDocument root.
  const character = document.querySelector<HTMLElement>(`.${GESTURE_CHARACTER_CLASS}`);
  let host: GestureStageHost | null = null;
  let unbind: (() => void) | null = null;
  const detachHost = (): void => {
    unbind?.();
    unbind = null;
    host?.detach();
    host = null;
  };
  window.addEventListener('candice:shell-error', detachHost, { once: true });
  if (character) {
    try {
      host = mountGestureStage({
        document,
        character,
        registry: AssetRegistry.create(),
        reportShellError: () => {
          window.dispatchEvent(new Event('candice:shell-error'));
        },
      });
      unbind = bindStatusFlow(machine, host);
      // The gesture host now owns the same canonical idle artwork. Remove
      // the bootstrap-only stage so the hologram is rendered once and gets
      // the available viewport rather than sharing it with a duplicate.
      document.getElementById(VISUAL_STAGE_ID)?.remove();
    } catch {
      host = null;
      unbind = null;
    }
  }

  // FIX-014 (step 6): one persistent caption live region. The captions view
  // clears its mount on creation, so it gets a DEDICATED mount element —
  // never the shared #app root (the answer-controls view also clears its
  // mount). The controller wraps the machine's transition surface so every
  // real transition renders captions from `machine.lastEffects`; the
  // original transition stays the single authority (mirror of
  // `bindStatusFlow`). Installed BEFORE the bridge so bridge-driven
  // `question:received` transitions render captions.
  const captionsMount = document.createElement('div');
  captionsMount.id = 'candice-captions-mount';
  root.append(captionsMount);
  const captions = createCaptionsController({
    machine,
    mount: captionsMount,
    // FIX-014 (I-08): the persisted text size, not the defaults profile.
    textScale: profile.textSize ?? 'medium',
    initialCaption: SETUP_CHECK_GREETING,
  });
  const originalTransition = machine.transition.bind(machine);
  machine.transition = (event) => {
    const result = originalTransition(event);
    if (result !== null) captions.render();
    return result;
  };

  // FIX-014 (EXECUTION-PLAN step 8): the application-owned interaction
  // composition — one instance, mounted once, wiring the boot-loaded
  // profile into the mounted surfaces (captions text size, voice-output
  // persistence, first-run name flow). It never loads the profile a second
  // time; main.ts owns the single boot load.
  const interaction: InteractionComposition = await initializeCandiceInteractionComposition(
    root,
    machine,
    captions,
    { profile, prefsLoad, invokeAdapter: options.invokeAdapter },
  );

  // The event listener itself is inert until native has authenticated the
  // local launch token and the MCP server delivers a validated question.
  // A connected transport does not by itself display controls or invent a
  // session; those conditions are met only by the delivered event.
  await initializeAuthenticatedBridge(root, machine, {
    // FIX-014 (I-11): the persisted convenience values feed the answer
    // surface; the voice toggle reports back and is persisted through the
    // native seam (spec 5.2 / 9).
    lastUsedMethod: interaction.profile.lastUsedAnswerMethod,
    voiceEnabled: interaction.profile.voiceOutputEnabled,
    onVoiceToggleChange: (voiceEnabled) => {
      void interaction.persist({ voiceOutputEnabled: voiceEnabled });
    },
    // QFIX Q-02 (design 2.2): the consent query routes through the
    // orchestrator — the bridge never invokes a `cmd_speech_*` command.
    queryConsent: orchestrator
      ? () => orchestrator.queryConsent()
      : undefined,
    // The speech call site (FIX-015 last wire). Same sole-caller rule as
    // queryConsent: the bridge decides WHETHER to speak, the orchestrator is
    // the only thing that may issue `cmd_speech_speak`. `voiceId` is
    // deliberately omitted so the native side resolves the operator-approved
    // canonical voice from the bundled SPEECH-INVENTORY.json — the voice can
    // change without this call site changing.
    speakQuestion: orchestrator
      ? (text: string) => orchestrator.speak(text)
      : undefined,
    cancelSpeech: orchestrator
      ? () => orchestrator.abortSpeech()
      : undefined,
    // Read-only view of the user's preference; the profile lane owns the
    // store (spec 5.2). Re-read on every question so a mid-session toggle
    // takes effect on the next one.
    voiceOutputEnabled: () => interaction.profile.voiceOutputEnabled === true,
  });

  // FIX-014 (I-11): the post-setup name flow (spec 4). Deferred until after
  // the bridge is installed so a delivered question can never be wiped by
  // the prompt mount, and the prompt can never sit under a live answer
  // surface.
  interaction.beginNameFlow();

  return capabilities;
}

export function runtimeStatusText(capabilities: RuntimeCapabilities): string {
  if (capabilities.rejectedLaunchReason) {
    return 'Candice wake request was rejected. Continue in Claude text mode.';
  }
  if (!capabilities.bridgeAvailable) {
    return 'Candice visual shell is available. Session bridge is unavailable; continue in Claude text mode.';
  }
  // This branch is deliberately defensive: the parser does not permit a
  // false-ready answer path to be inferred from a bridge alone.
  return capabilities.answerRoundTripAvailable
    ? 'Candice session bridge is available.'
    : 'Candice session bridge is connected without answer submission.';
}
