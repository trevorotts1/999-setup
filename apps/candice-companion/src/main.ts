/**
 * Candice Companion — front-end entry point (WS-06 application shell).
 *
 * Owned by WR-008 / WS-06 lane (ownership map 9.2). This file is the root
 * entry of the webview payload. It owns ONLY shell boot concerns:
 *   - create the application state machine host,
 *   - register shell commands (backend capabilities of the shared shell),
 *   - render the boot surface and attach the canonical visual stage,
 *   - never decide interview outcome, question order, or progress.
 *
 * The brain, rules, memory, and source of truth are the active Claude Code
 * session and the invoked skill (Master Spec section 2). Every subsystem
 * below (state machine, session bridge, UI controls) is presentation
 * infrastructure and degrades to text mode on failure (Master Spec 20).
 */

import { createCandiceStateMachine } from './state/machine';
import { VisemeScheduler } from './animation/viseme/scheduler';
import { attachSpeechTimingChannel, type SpeechTimingChannel } from './runtime/speech-timing';
import {
  probeNativeShell,
  type BootPresentationStatus,
} from './shell/boot-health';
import { showTextFallback } from './shell/text-fallback';
import { dismissBootSurface } from './shell/boot-surface';
import { mountVisualStage } from './shell/visual-stage';
import { initializeRuntimeComposition } from './runtime/composition';
import { loadProfileViaIpc } from './prefs/ipc';
import { textSizeToScale } from './runtime/interaction-composition';
import {
  initializeAccessibilityRuntime,
  type AccessibilityRuntime,
} from './a11y/runtime';
import { createDragSurface, createWindowInputPolicy, readyWindowAppearance } from './window';
import {
  createInputRegionController,
  createNativeInputRegionAdapter,
  defaultRegionInvoke,
  type InputRegionController,
} from './window/native-input-regions';
import {
  registerShellCommands,
  type ShellCommandRegistry,
  unregisterShellCommands,
} from './shell/shell-commands';

/**
 * Name the failing boot step AND the code that threw.
 *
 * The fallback card is the only diagnostic surface a packaged run has: there
 * is no console to read once the app is installed. A bare `error.message`
 * names the step but not the thrower, which cost several sessions on a
 * WebKit-only DOM exception whose message ("The string did not match the
 * expected pattern.") is identical for every SyntaxError. The error name and
 * the first frames of the stack make the throwing function self-evident.
 */
function bootStepError(step: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error && error.name ? error.name : 'UnknownError';
  const frames = error instanceof Error && typeof error.stack === 'string'
    ? error.stack
      .split('\n')
      .map((line) => line.trim())
      // Drop the leading "Name: message" header WebKit/V8 print above frames.
      .filter((line) => line.length > 0 && !line.startsWith(`${name}:`))
      .slice(0, 3)
      .join(' | ')
    : '';
  const trace = frames.length > 0 ? ` @ ${frames}` : '';
  return new Error(`${step}: ${name}: ${detail}${trace}`);
}

/** Boot the companion shell. Never throws: failure must never stop Claude. */
export async function bootCandice(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    // There is no safe UI surface to repair. Claude remains usable directly;
    // importantly, a damaged/recovered DOM must not throw during boot.
    console.error('[candice] boot root missing; continue in Claude text mode');
    return;
  }

  let registry: ShellCommandRegistry | undefined;
  let accessibility: AccessibilityRuntime | undefined;
  let speechTiming: SpeechTimingChannel | undefined;
  let inputRegions: InputRegionController | undefined;
  let dragSurface: ReturnType<typeof createDragSurface> | undefined;
  let fellBack = false;
  const setStatus = (status: BootPresentationStatus): void => {
    const surface = document.getElementById('candice-boot-status');
    if (!surface) return;
    surface.dataset.status = status;
    surface.textContent = status === 'starting'
      ? 'Starting Candice…'
      : status === 'shell-ready'
        ? 'Candice shell ready'
        : 'Candice companion unavailable';
  };
  const enterTextFallback = (detail?: string): void => {
    if (fellBack) return;
    fellBack = true;
    window.removeEventListener('candice:shell-error', onShellError);
    if (registry) teardown(registry);
    accessibility?.dispose();
    speechTiming?.dispose();
    setStatus('text-fallback');
    showTextFallback(root, detail);
    // The drag surface and the region policy deliberately SURVIVE the
    // fallback. The companion degraded, but its window is still on screen
    // and still covers part of the operator's desktop, so he must still be
    // able to move it out of his way. Nothing is made less safe: the
    // regions still cover only pixels the fallback card actually paints,
    // and every other pixel stays click-through.
    void inputRegions?.refresh();
  };
  const onShellError = (): void => enterTextFallback('candice:shell-error event');

  try {
    // Surface the boot markup as fast as possible (spec 28: Candice appears
    // quickly; setup-check is reported before long preflight work).
    document.body.classList.add('candice-ready');
    setStatus('starting');

    // Install this before visual creation or any IPC work can report failure.
    window.addEventListener('candice:shell-error', onShellError, { once: true });
    try {
      mountVisualStage(root);
    } catch (error) {
      throw bootStepError('mount-visual-stage', error);
    }
    // The boot surface is only a first-paint placeholder. Keeping it after
    // the approved visual mounts competes for the fixed companion viewport
    // and visibly shrinks the hologram.
    dismissBootSurface(root);

    // The state machine is the sibling WS-08 lane's pure reducer; the shell
    // hosts one instance and keeps a reference for the boot latch. It has no
    // dispose lifecycle of its own (nothing to tear down).
    const machine = createCandiceStateMachine();
    // The viseme scheduler owns the TTS timing clock (WS-12). The
    // FIX-016 channel feeds it native speech-start/boundary/drain
    // events; the render lane consumes its steps later. Absent the
    // native event API the channel stays inert and never throws.
    const visemeScheduler = new VisemeScheduler();
    try {
      speechTiming = await attachSpeechTimingChannel(visemeScheduler);
    } catch (error) {
      throw bootStepError('attach-speech-timing', error);
    }
    // Invoke is the durable initial shell latch. A native ready event can be
    // emitted before the WebView starts; it is therefore not accepted as the
    // sole proof of readiness.
    const shellInfo = await probeNativeShell();
    // The window is visible but pointer-transparent until a future native
    // input-region adapter can prove bounded visible controls. This prevents
    // the 420x640 transparent companion rectangle from eating Terminal clicks.
    let nativeWindow;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      nativeWindow = getCurrentWindow();
    } catch (error) {
      throw bootStepError('get-current-window', error);
    }
    const windowState = await readyWindowAppearance(nativeWindow);
    if (!windowState.windowAvailable) {
      throw new Error('candice: native window appearance unavailable');
    }
    // The partial-region adapter is what FIX-008 left unimplemented, which
    // is why `setInteractiveRegions` always failed closed and the whole
    // window ignored the pointer. With it, pass-through stays the resting
    // state and native lifts it only over measured visible pixels. A shell
    // without the command yields a null adapter and the original
    // whole-window pass-through behavior, unchanged.
    let regionAdapter = null;
    try {
      regionAdapter = createNativeInputRegionAdapter(await defaultRegionInvoke());
    } catch {
      // No IPC: the policy below keeps the safe FIX-008 policy on its own.
    }
    const inputPolicy = createWindowInputPolicy(nativeWindow, regionAdapter);
    if (!await inputPolicy.enablePassThrough()) {
      try {
        await nativeWindow.hide();
      } catch {
        // Failure remains contained by the text-mode fallback below.
      }
      throw new Error('candice: safe pointer pass-through unavailable');
    }
    root.dataset.candiceInputPolicy = inputPolicy.mode;

    // The window is frameless, so the character IS the title bar: grabbing
    // Candice is the only way to move her. `createDragSurface` has existed
    // and been unit-tested since WS-07 but was never mounted by any boot
    // path, which is the second half of why dragging did nothing.
    //
    // Mounted on the shell root so every painted surface is a handle, while
    // clickable children (buttons, inputs, anything focusable) still act as
    // controls — both this controller and Tauri's own drag-region script
    // exclude them. Pointer input still only reaches the window over the
    // regions published below, so marking the root drags nothing invisible.
    //
    // Installed HERE, before the runtime composition, on purpose: the
    // composition ends by awaiting the session bridge, and the operator's
    // ability to move the window out of his own way must not be hostage to
    // a handshake that may never complete. The controller re-measures on
    // mutation, resize, image load and a safety interval, so every surface
    // the composition mounts afterwards is picked up on its own.
    try {
      dragSurface = createDragSurface(nativeWindow);
      dragSurface.attach(root);
    } catch (error) {
      // Dragging is a convenience; losing it must not cost the session.
      console.warn('[candice] drag surface unavailable', error);
    }
    try {
      inputRegions = createInputRegionController({ policy: inputPolicy, root });
    } catch (error) {
      // Failing here leaves the policy in whole-window pass-through: the
      // operator cannot drag, but nothing blocks the Terminal.
      console.warn('[candice] input regions unavailable', error);
    }
    // FIX-014 (I-08/I-11): load the local preference profile ONCE at boot
    // through the native seam (cmd_load_profile). A failed load degrades
    // truthfully: the a11y runtime follows the OS (reducedMotion null) and
    // the composition reports the machine's `preferences` error — never a
    // fabricated persisted preference.
    const { invoke } = await import('@tauri-apps/api/core');
    const prefsLoad = await loadProfileViaIpc({ invoke });
    try {
      accessibility = initializeAccessibilityRuntime(root, {
        reducedMotion: prefsLoad.profile.reducedMotion,
        textScale: textSizeToScale(prefsLoad.profile.textSize),
      });
    } catch (error) {
      throw bootStepError('initialize-accessibility', error);
    }
    try {
      registry = registerShellCommands(machine, shellInfo);
    } catch (error) {
      throw bootStepError('register-shell-commands', error);
    }
    try {
      await initializeRuntimeComposition(root, machine, {
        profile: prefsLoad.profile,
        prefsLoad,
        accessibility,
        visemeScheduler,
        onLayoutChange: () => { void inputRegions?.refresh(); },
      });
    } catch (error) {
      throw bootStepError('initialize-runtime-composition', error);
    }

    // A late refresh is not required for correctness — the controller's own
    // observers pick the composition's surfaces up — but taking one here
    // means the regions are already correct on the first frame the operator
    // can see, instead of up to one safety interval later.
    void inputRegions?.refresh();
    root.dataset.candiceInputPolicy = inputPolicy.mode;
    setStatus('shell-ready');

  } catch (err) {
    console.error('[candice] shell boot failed, entering text fallback', err);
    enterTextFallback(err instanceof Error ? err.message : String(err));
  }
}

function teardown(registry: ShellCommandRegistry): void {
  try {
    unregisterShellCommands(registry);
  } catch {
    // Teardown is best-effort; the app is already falling back to text.
  }
}

void bootCandice();
