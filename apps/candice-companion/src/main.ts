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
import { showTextFallback } from './shell/text-fallback';
import { mountVisualStage } from './shell/visual-stage';
import {
  registerShellCommands,
  type ShellCommandRegistry,
  unregisterShellCommands,
} from './shell/shell-commands';

/** Boot the companion shell. Never throws: failure must never stop Claude. */
export async function bootCandice(): Promise<void> {
  try {
    // Surface the boot markup as fast as possible (spec 28: Candice appears
    // quickly; setup-check is reported before long preflight work).
    document.body.classList.add('candice-ready');
    mountVisualStage(document.getElementById('app') as HTMLElement);

    // The state machine is the sibling WS-08 lane's pure reducer; the shell
    // hosts one instance and keeps a reference for the boot latch. It has no
    // dispose lifecycle of its own (nothing to tear down).
    const machine = createCandiceStateMachine();
    const registry = registerShellCommands(machine);

    // Bind actual shell failures to text fallback (spec 20). There is no
    // synthetic readiness timer here: a visual composition is not evidence
    // that a native/session/backend bridge is ready, and it must not vanish
    // merely because another integration lane has not connected yet.
    window.addEventListener('candice:shell-error', () => {
      teardown(registry);
      showTextFallback(document.getElementById('app') as HTMLElement);
    }, { once: true });
  } catch (err) {
    console.error('[candice] shell boot failed, entering text fallback', err);
    showTextFallback(document.getElementById('app') as HTMLElement);
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
