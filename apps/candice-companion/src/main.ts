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
import { mountVisualStage } from './shell/visual-stage';
import { initializeRuntimeComposition } from './runtime/composition';
import {
  initializeAccessibilityRuntime,
  type AccessibilityRuntime,
} from './a11y/runtime';
import { createWindowInputPolicy, readyWindowAppearance } from './window';
import {
  registerShellCommands,
  type ShellCommandRegistry,
  unregisterShellCommands,
} from './shell/shell-commands';

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
  const enterTextFallback = (): void => {
    if (fellBack) return;
    fellBack = true;
    window.removeEventListener('candice:shell-error', onShellError);
    if (registry) teardown(registry);
    accessibility?.dispose();
    speechTiming?.dispose();
    setStatus('text-fallback');
    showTextFallback(root);
  };
  const onShellError = (): void => enterTextFallback();

  try {
    // Surface the boot markup as fast as possible (spec 28: Candice appears
    // quickly; setup-check is reported before long preflight work).
    document.body.classList.add('candice-ready');
    setStatus('starting');

    // Install this before visual creation or any IPC work can report failure.
    window.addEventListener('candice:shell-error', onShellError, { once: true });
    mountVisualStage(root);

    // The state machine is the sibling WS-08 lane's pure reducer; the shell
    // hosts one instance and keeps a reference for the boot latch. It has no
    // dispose lifecycle of its own (nothing to tear down).
    const machine = createCandiceStateMachine();
    // The viseme scheduler owns the TTS timing clock (WS-12). The
    // FIX-016 channel feeds it native speech-start/boundary/drain
    // events; the render lane consumes its steps later. Absent the
    // native event API the channel stays inert and never throws.
    const visemeScheduler = new VisemeScheduler();
    speechTiming = await attachSpeechTimingChannel(visemeScheduler);
    // Invoke is the durable initial shell latch. A native ready event can be
    // emitted before the WebView starts; it is therefore not accepted as the
    // sole proof of readiness.
    const shellInfo = await probeNativeShell();
    // The window is visible but pointer-transparent until a future native
    // input-region adapter can prove bounded visible controls. This prevents
    // the 420x640 transparent companion rectangle from eating Terminal clicks.
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const nativeWindow = getCurrentWindow();
    const windowState = await readyWindowAppearance(nativeWindow);
    if (!windowState.windowAvailable) {
      throw new Error('candice: native window appearance unavailable');
    }
    const inputPolicy = createWindowInputPolicy(nativeWindow);
    if (!await inputPolicy.enablePassThrough()) {
      try {
        await nativeWindow.hide();
      } catch {
        // Failure remains contained by the text-mode fallback below.
      }
      throw new Error('candice: safe pointer pass-through unavailable');
    }
    root.dataset.candiceInputPolicy = inputPolicy.mode;
    accessibility = initializeAccessibilityRuntime(root, {
      // The actual local preference IPC is not implemented yet. `null` is
      // deliberately the truthful "follow OS" setting, not a fabricated
      // persisted preference.
      reducedMotion: null,
      textScale: 1,
    });
    registry = registerShellCommands(machine, shellInfo);
    await initializeRuntimeComposition(root, machine);
    setStatus('shell-ready');

  } catch (err) {
    console.error('[candice] shell boot failed, entering text fallback', err);
    enterTextFallback();
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
