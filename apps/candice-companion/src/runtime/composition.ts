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
import { attachCaptionHighlight } from '../ui/captions/highlight-driver.ts';
import { defaultProfile } from '../prefs/profile.ts';
import type { CandiceProfile } from '../prefs/schema.ts';
import type { PrefsLoadResult } from '../prefs/ipc.ts';
import {
  initializeCandiceInteractionComposition,
  type InteractionComposition,
} from './interaction-composition.ts';
import { probeHarnessName, harnessWindowPhrase } from '../harness/name.ts';
import { createPowerOff } from '../ui/power/index.ts';
import {
  createSettingsToggle,
  HOLOGRAM_TOGGLE,
  VOICE_TOGGLE,
  type SettingsToggleController,
} from '../ui/settings-toggle/index.ts';
import { initializeSpeechRuntime, defaultSpeechInvokeAdapter, type SpeechRuntime } from './speech-runtime.ts';
import { SpeechOrchestrator } from './speech-orchestrator.ts';

/**
 * The welcome shown by the slash-command wake path before preflight or any
 * governed question. It is presentation only: no answer is requested and no
 * protocol count/order changes here.
 *
 * Keep it SHORT. This is the very first thing a new user sees, it is read
 * aloud, and it lands in a 420px column while they are waiting for setup to
 * finish -- so every extra word is a second of someone waiting on a
 * paragraph before anything happens. The first version ran 228 characters
 * across four sentences; most of that was one idea said three ways ("the
 * app, the software, or the thing you've always dreamed about") plus a
 * sentence of framing before the metaphor it was framing.
 *
 * Cut again at 134 characters, this time for plainness rather than length:
 *   - "Think of me as your fairy godmother" -> "your fairy godmother". The
 *     instruction to imagine something is longer than the image itself, and
 *     spoken aloud it delays the only word that carries the idea.
 *   - "you make a wish, I help make it real" -> "make a wish, I'll make it
 *     real". Direct address, and "help make" hedges the promise in the one
 *     line meant to land it.
 *   - "Setting things up now" -> "Setting up now". "Things" names nothing.
 * Now 107 characters, two sentences and a fragment, no word above two
 * syllables except her own name.
 *
 * What must survive any rewrite: she says her name, the fairy-godmother
 * idea with its wish/real pairing, and a reason the user is waiting.
 */
const SETUP_CHECK_GREETING =
  "Hi, I'm Candice — your fairy godmother for building things. Make a wish, I'll make it real. Setting up now.";

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
  /**
   * The live WS-14 accessibility runtime from main.ts, which owns the
   * SINGLE writer of the `candice-reduced-motion` class. The animation
   * toggle drives motion through this handle and never touches the class
   * itself — a second writer would fight the controller's OS listener.
   * Absent (tests/headless) the toggle still mounts and still persists; it
   * simply has nothing live to apply to.
   */
  accessibility?: { setReducedMotionPreference(preference: boolean | null): void };
  /**
   * Called after the composition changes which controls are on screen, so
   * the native hit test can republish its regions
   * (`src/window/native-input-regions.ts`). Without it the toggle paints
   * but the pointer passes straight through it.
   */
  onLayoutChange?: () => void;
  /**
   * The live WS-12 viseme scheduler from main.ts. `speech-timing.ts` already
   * feeds it real phoneme timings; handing it down here is what finally
   * gives those timings a READER, through the mouth renderer the gesture
   * stage owns. Omitted in tests/headless: the bust still mounts and the
   * mouth simply rests closed.
   */
  visemeScheduler?: import('../animation/viseme/mouth-renderer.ts').VisemeSource;
}

export async function initializeRuntimeComposition(
  root: HTMLElement,
  machine: CandiceStateMachine,
  options: RuntimeCompositionOptions = {},
): Promise<RuntimeCapabilities> {
  const capabilities = await probeRuntimeCapabilities(options.invokeAdapter);
  // Ask native which harness launched us BEFORE any copy is rendered, so
  // the status line and both fallback buttons name the right window on
  // their first paint rather than correcting themselves. Never throws: not
  // knowing the name costs a noun, never the boot (spec 20).
  await probeHarnessName(options.invokeAdapter);
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
  // Say nothing when there is nothing wrong.
  //
  // This chip sat on screen for the entire session reading "Candice session
  // bridge is available." -- engineering vocabulary, addressed to nobody the
  // product has, permanently occupying a row of a 640px column that the
  // character is already fighting for. A status line that only ever reports
  // success is not information; it is furniture. It earns its row only when
  // something is actually degraded and the user has to do something about
  // it, which is the only case the text below is now written for.
  status.hidden = runtimeStatusHealthy(capabilities);
  root.append(status);

  // FIX-015 speech seam + QFIX Q-02 orchestrator (design section 2): mount
  // the duplex controller, probe the native boundary once, and create THE
  // one speech command executor. Failure is silent capability absence —
  // the shell never blocks composition on speech (spec 20).
  // Set when the native side first reports the OS voice standing in for
  // Candice's own. Read after the captions controller exists, because the
  // orchestrator is constructed before it.
  let pendingSystemVoiceNotice = false;
  let systemVoiceSink: (() => void) | null = null;
  let speech: SpeechRuntime | null = null;
  let orchestrator: SpeechOrchestrator | null = null;
  try {
    speech = await initializeSpeechRuntime(options.speech?.invokeAdapter);
    root.dataset.speechSeam = 'active';
    if (speech.health) {
      root.dataset.speechStatus = speech.health.degraded ? 'degraded' : 'available';
      root.dataset.canonicalVoiceApproval = speech.health.canonicalVoiceApproval;
      // Evidence for the packaged tier: whether HOLD TO TALK is offered at
      // all is a measured native fact, not a preference, and a reviewer
      // should be able to read it off the DOM without a debugger.
      root.dataset.sttEngineReady = String(speech.health.sttEngineReady);
      root.dataset.ttsEngineReady = String(speech.health.ttsEngineReady);
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
      // Say it plainly, once, if the computer's voice stands in for hers.
      // Never concealed -- that is the whole condition on which a voice
      // fallback is acceptable at all.
      onSystemVoice: () => {
        if (systemVoiceSink !== null) systemVoiceSink();
        else pendingSystemVoiceNotice = true;
      },
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
  /** Set when the gesture stage fails; announced once captions exist. */
  let captionsFailure: string | null = null;
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
        visemeScheduler: options.visemeScheduler,
        reportShellError: () => {
          window.dispatchEvent(new Event('candice:shell-error'));
        },
      });
      unbind = bindStatusFlow(machine, host);
      // The gesture host now owns the same canonical idle artwork. Remove
      // the bootstrap-only stage so the hologram is rendered once and gets
      // the available viewport rather than sharing it with a duplicate.
      document.getElementById(VISUAL_STAGE_ID)?.remove();
    } catch (error) {
      // NEVER swallow this. A throw here means the hologram silently does not
      // mount — the bust, blink, lip sync and head drift simply are not there,
      // and the app looks like it is working. That cost this campaign hours.
      // The shell still degrades (spec 20): the session continues without the
      // gesture stage, but the reason is recorded where a human can find it.
      host = null;
      unbind = null;
      root.dataset.gestureStage = 'failed';
      root.dataset.gestureStageError = error instanceof Error
        ? error.message
        : String(error);
      captionsFailure = 'Candice can\u2019t move right now. Everything else works.';
    }
    // The face stage fails CLOSED to an inert host, so a bust that cannot
    // mount never throws and never reaches the catch above -- it records
    // itself on `data-candice-face-failed` and stops there. That attribute is
    // DOM-only, and a packaged run can read neither the DOM nor the
    // accessibility tree (the WebView exposes no AXWebArea and
    // AXManualAccessibility is unsupported), so the record was exactly as
    // silent as the `return inert` it replaced. Captions are on-screen text,
    // so promoting it here is what makes it readable -- by a person, and by
    // the pixel capture that is now the only verification channel.
    const faceFailed = character.dataset.candiceFaceFailed;
    if (captionsFailure === null && faceFailed !== undefined && faceFailed !== '') {
      captionsFailure = `Candice\u2019s face didn\u2019t load (${faceFailed}). Everything else works.`;
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
  // The gesture stage may have failed before captions existed. Say so now,
  // once, rather than leaving a silently missing hologram.
  if (captionsFailure !== null) captions.announce(captionsFailure);
  // Drain a system-voice notice raised before this surface existed, and
  // take ownership of any later one.
  const announceSystemVoice = (): void => {
    captions.announce(
      'I’m using your computer’s voice — mine isn’t installed here.',
    );
  };
  if (pendingSystemVoiceNotice) announceSystemVoice();
  systemVoiceSink = announceSystemVoice;

  // Highlight the sentence she is currently saying. The duration comes from
  // the utterance's REAL phoneme timings, so the highlight tracks the actual
  // audio length rather than a guess. The driver cannot throw: with no native
  // event API it reports `listening: false` and the caption renders plain.
  const captionHighlight = await attachCaptionHighlight((fraction) => {
    captions.setSpokenProgress(fraction);
  });
  if (!captionHighlight.listening) {
    // Not an error worth interrupting the user over -- captions still work --
    // but it must not be invisible either, the way `data-speech-playback` was.
    root.dataset.candiceCaptionHighlight = 'unavailable';
  }

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

  // NO ANIMATION TOGGLE. The operator has asked for it to be gone more than
  // once, and it kept coming back. The shipping control set is exactly three,
  // and this is the list: hologram on/off, voice on/off, turn Candice off.
  //
  // The FEATURE is untouched — reduced motion still works. The app still
  // honours the OS `prefers-reduced-motion: reduce` setting through the same
  // WS-14 controller and the same spec-9 `reducedMotion` field; the saved
  // value is still read at boot and still applied. What is gone is the
  // fourth checkbox on her face. Anyone who wants minimal motion sets it once
  // in System Settings, where every other app reads it from, instead of
  // finding a control here that no other app has.
  //
  // ui/animation-toggle/ is left in the tree, built and tested, so this is a
  // one-line remount if that call is ever reversed. It has no other caller.
  root.dataset.candiceAnimationToggle = 'absent';

  // Voice, at rest.
  //
  // A `Voice: ON/OFF` button already existed, but it belongs to the ANSWER
  // SURFACE, which is created when a question arrives and destroyed when it
  // closes. So the only moment you could mute her was while she was already
  // talking at you; between questions there was no control at all. This row
  // is always mounted, writes the same spec-9 `voiceOutputEnabled` field,
  // and the two views are kept in step below so they can never disagree.
  const voiceToggle: SettingsToggleController = createSettingsToggle({
    mount: root,
    id: VOICE_TOGGLE.id,
    className: VOICE_TOGGLE.className,
    label: VOICE_TOGGLE.label,
    onHint: VOICE_TOGGLE.onHint,
    offHint: VOICE_TOGGLE.offHint,
    checked: interaction.profile.voiceOutputEnabled === true,
    apply: (on) => {
      // Turning voice OFF has to stop the voice that is playing NOW, not
      // just the next one. The gate this field feeds is read when the next
      // question is delivered, so without this she finishes the sentence
      // while the control says OFF.
      if (!on) orchestrator?.abortSpeech();
    },
    persist: (on) => interaction.persist({ voiceOutputEnabled: on }),
    onLayoutChange: options.onLayoutChange,
  });
  root.dataset.candiceVoiceToggle = voiceToggle.element ? 'mounted' : 'absent';

  // The hologram.
  //
  // "u have animation off, when i turn it off its suppose to turn candace
  // off". Motion, presence and VISIBILITY are three different things and
  // only the first two had controls: animation-off merely calms her, and
  // Turn off ends the session. This hides her image while she keeps
  // working -- questions, answers and captions all continue.
  const hologramToggle: SettingsToggleController = createSettingsToggle({
    mount: root,
    id: HOLOGRAM_TOGGLE.id,
    className: HOLOGRAM_TOGGLE.className,
    label: HOLOGRAM_TOGGLE.label,
    onHint: HOLOGRAM_TOGGLE.onHint,
    offHint: HOLOGRAM_TOGGLE.offHint,
    checked: interaction.profile.characterHidden !== true,
    apply: (visible) => {
      // The class goes on the documentElement, like the reduced-motion class
      // the a11y lane owns, so one rule can reach the character wherever it
      // sits in the column.
      root.ownerDocument?.documentElement?.classList.toggle('candice-hologram-hidden', !visible);
    },
    persist: (visible) => interaction.persist({ characterHidden: !visible }),
    onLayoutChange: options.onLayoutChange,
  });
  root.dataset.candiceHologramToggle = hologramToggle.element ? 'mounted' : 'absent';
  root.dataset.candiceHologram = hologramToggle.isOn() ? 'on' : 'off';
  // Paint the BOOT state: a stored `characterHidden: true` must be in force
  // before the first frame, not only after the user touches the control.
  root.ownerDocument?.documentElement?.classList.toggle(
    'candice-hologram-hidden',
    interaction.profile.characterHidden === true,
  );

  // The off button. It sits directly under the animation toggle because
  // that toggle is what the operator kept pressing while trying to turn
  // HER off -- "u have animation off, when i turn it off its suppose to
  // turn candace off". Motion and presence are two different things, and
  // until now only one of them had a control.
  const powerOff = createPowerOff({
    mount: root,
    quit: async () => {
      const bridge = options.invokeAdapter ?? (await import('@tauri-apps/api/core'));
      return bridge.invoke('cmd_quit_app');
    },
    onLayoutChange: options.onLayoutChange,
  });
  // Evidence for QC and the packaged-bundle sentinel, same as the toggle
  // above: an absent off button is the exact regression being fixed here,
  // so it has to be observable from outside without a screenshot.
  root.dataset.candicePowerOff = powerOff.element ? 'mounted' : 'absent';

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
    // Whether a speech-to-text engine exists is a NATIVE fact, and until
    // now it was measured and then thrown away: `stt_engine_ready` was
    // computed in Rust, parsed into `capabilities.sttEngineReady`, and read
    // by nothing. So HOLD TO TALK was offered on builds that ship no
    // whisper-cli -- and today NO build ships one, all three STT rows in
    // SPEECH-INVENTORY.json are `sha256Status: absent`. A user pressing it
    // was prompted for the microphone, recorded, and then told "Answer in
    // Claude instead", every time, because transcribe had nothing to run.
    //
    // An UNPROBED run passes undefined, not false: no health report means
    // we were never told, and a dev run must not silently lose the control.
    // Only a report that actually says false suppresses it.
    sttAvailable: speech?.health ? speech.health.sttEngineReady : undefined,
    // Same story on the output side. On Windows TODAY she is mute: no
    // Windows Python ships in speech-assets, and `system_tts_available` is
    // hardcoded false off macOS because the WR-016 adapter never landed.
    // So `tts_engine_ready` is false, every `speak` rejects, and the bridge
    // announced "Candice could not speak this question aloud: <raw engine
    // error>" on EVERY question. Knowing it in advance, the right move is
    // to stay quiet rather than narrate the same failure forever.
    // "Can she speak at all", not "is the Kokoro engine ready".
    //
    // This was `ttsEngineReady` alone, which was correct until the system
    // voice landed and then quietly cancelled it: on Windows
    // ttsEngineReady is false, so the bridge returned BEFORE calling
    // speak, and speak_impl's system-voice fallback could never be
    // reached. The gate would have suppressed the very capability that
    // was added to fix the thing it was suppressing for.
    ttsAvailable: speech?.health
      ? speech.health.ttsEngineReady || speech.health.capabilities.systemTtsAvailable
      : undefined,
    // A refused microphone press now SAYS so. The explanation was already
    // being computed for a callback nobody supplied, so a denied mic made
    // the button look simply broken.
    announceCaptureBlocked: (explanation) => captions.announce(explanation),
    onVoiceToggleChange: (voiceEnabled) => {
      void interaction.persist({ voiceOutputEnabled: voiceEnabled });
      // Two controls, one field. `set` repaints without re-persisting, so
      // the at-rest row cannot sit at ON while the in-question button says
      // OFF -- which would leave the user unable to tell what she will
      // actually do next.
      voiceToggle.set(voiceEnabled);
      // Turning voice OFF has to stop the voice.
      //
      // This handler used to persist the preference and nothing else, and the
      // gate it feeds (`voiceOutputEnabled` below) is only ever read when the
      // NEXT question is delivered. So a user who pressed the toggle because
      // Candice was talking watched the button say OFF while she carried on
      // to the end of the utterance — which is what an off switch failing
      // looks like, whatever the preference file says afterwards.
      if (!voiceEnabled) orchestrator?.abortSpeech();
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
    // A speech failure must reach the user IN WORDS. The caption surface is
    // the only channel anything actually reads — `data-speech-playback` has
    // no reader in the app at all. Without this, the native side's refusal to
    // speak in an unapproved voice becomes an unexplained silence.
    announceSpeechFailure: (text: string) => captions.announce(text),
  });

  // FIX-014 (I-11): the post-setup name flow (spec 4). Deferred until after
  // the bridge is installed so a delivered question can never be wiped by
  // the prompt mount, and the prompt can never sit under a live answer
  // surface.
  interaction.beginNameFlow();

  return capabilities;
}

/**
 * True when nothing is wrong and the status line has nothing to add.
 * The chip is hidden in this case; see the mount site for why.
 */
export function runtimeStatusHealthy(capabilities: RuntimeCapabilities): boolean {
  return (
    !capabilities.rejectedLaunchReason
    && capabilities.bridgeAvailable
    && capabilities.answerRoundTripAvailable
  );
}

/**
 * What the user is told when something IS wrong.
 *
 * Rewritten out of engineering vocabulary. "Session bridge", "answer
 * submission" and "text mode" describe the plumbing; a person reading this
 * needs to know two things and no others: Candice cannot do her part right
 * now, and answering in the Claude window still works. Every branch says
 * exactly that, in words nobody needs this project explained to understand.
 */
export function runtimeStatusText(capabilities: RuntimeCapabilities): string {
  // Which window to send them to is not a constant. The operator runs
  // claude-nine as well as claude, and this text used to say "the Claude
  // window" unconditionally -- pointing a stuck user at a window that was
  // not on their screen. `harnessWindowPhrase()` says "the Claude window",
  // "the Claude-Nine window", or "your terminal" when we were not told.
  const where = harnessWindowPhrase();
  if (capabilities.rejectedLaunchReason) {
    return `Candice could not start this time. Keep answering in ${where}.`;
  }
  if (!capabilities.bridgeAvailable) {
    return `Candice cannot reach your session right now. Keep answering in ${where}.`;
  }
  // This branch is deliberately defensive: the parser does not permit a
  // false-ready answer path to be inferred from a bridge alone.
  return capabilities.answerRoundTripAvailable
    ? 'Candice is ready.'
    : `Candice can show questions but cannot send answers yet. Answer in ${where}.`;
}
