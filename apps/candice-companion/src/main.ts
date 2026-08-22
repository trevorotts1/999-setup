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
import {
  probeNativeShell,
  type BootPresentationStatus,
} from './shell/boot-health';
import { showTextFallback } from './shell/text-fallback';
import { mountVisualStage } from './shell/visual-stage';
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
    // Invoke is the durable initial shell latch. A native ready event can be
    // emitted before the WebView starts; it is therefore not accepted as the
    // sole proof of readiness.
    const shellInfo = await probeNativeShell();
    registry = registerShellCommands(machine, shellInfo);
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
