/**
 * Candice shell commands (WS-06 application shell).
 *
 * The WS-06 shell registers the app-level backend capabilities that are
 * shared shell infrastructure: the command capability list (what the shell
 * supports, for the MCP/plugin lanes to probe), the window visibility
 * primitive, and the shell-error latch that drops the companion to the
 * text fallback (Master Spec 20).
 *
 * The session bridge (MCP `candice.*` tools, spec 13.2) is owned by the
 * plugin lane (WR-011) and the structured `ask_user` path (WR-011/WS-04);
 * the shell does NOT duplicate an answer store and never talks to a second
 * AI conversation (spec 2, 13).
 *
 * Consumers:
 *   - WS-03/WS-04 (session bridge): import getShellCapabilities() to probe
 *     which shell primitives exist before using them.
 *   - WS-07 (window behavior): consumes getShellCapabilities().windows.
 */

import type { CandiceStateMachine } from '../state/machine';
import type { ShellInfo } from './boot-health';

export interface ShellCapabilities {
  /** Commands the shared shell backend exposes over IPC (WS-06 subset). */
  commands: {
    showWindow: boolean;
    hideWindow: boolean;
    /** May be used only by an explicit future user interaction. */
    focusWindow: boolean;
  };
  /** Window primitive availability. Window behavior details are WS-07's. */
  windows: {
    /** Main companion window label, as declared in tauri.conf.json. */
    mainLabel: 'main';
    /** Whether the window layer is reachable in this runtime. */
    available: boolean;
  };
  /** App version as bundled (release owner bumps at final stamp, spec 26). */
  appVersion: string;
}

export interface ShellCommandRegistry {
  dispose: () => void;
  getCapabilities: () => ShellCapabilities;
}

/**
 * Register the shell command surface. The lazy dynamic import keeps the
 * Tauri IPC bindings out of the plain-web (browser) boot path; when the
 * bridge is absent (e.g. dev preview in a browser tab) the commands report
 * unavailable and the UI degrades — failure never stops Claude (spec 20).
 */
export function registerShellCommands(
  _machine: CandiceStateMachine,
  shellInfo?: Pick<ShellInfo, 'appVersion' | 'shellReady'>,
): ShellCommandRegistry {
  let disposed = false;
  const nativeShellAvailable = shellInfo?.shellReady === true;

  const getCapabilities = (): ShellCapabilities => {
    if (disposed) {
      throw new Error('candice: shell command registry disposed');
    }
    return {
      commands: {
        showWindow: nativeShellAvailable,
        hideWindow: nativeShellAvailable,
        focusWindow: nativeShellAvailable,
      },
      windows: { mainLabel: 'main', available: nativeShellAvailable },
      appVersion: shellInfo?.appVersion ?? __CANDICE_APP_VERSION__,
    };
  };

  const showWindow = async (): Promise<boolean> => {
    if (disposed || !nativeShellAvailable) return false;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().show();
      return true;
    } catch (err) {
      console.warn('[candice] window.show unavailable', err);
      window.dispatchEvent(new Event('candice:shell-error'));
      return false;
    }
  };

  const hideWindow = async (): Promise<boolean> => {
    if (disposed || !nativeShellAvailable) return false;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().hide();
      return true;
    } catch (err) {
      console.warn('[candice] window.hide unavailable', err);
      return false;
    }
  };

  /** Deliberate focus transfer only; never call as part of wake/show. */
  const focusWindow = async (): Promise<boolean> => {
    if (disposed || !nativeShellAvailable) return false;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFocus();
      return true;
    } catch (err) {
      console.warn('[candice] window.focus unavailable', err);
      return false;
    }
  };

  // Shell IPC contract: consumers invoke through the window-global registry,
  // never through ad-hoc internals.
  (window as unknown as { __candiceShell?: unknown }).__candiceShell = {
    showWindow,
    hideWindow,
    focusWindow,
    getCapabilities,
  };

  return {
    getCapabilities,
    dispose: () => {
      disposed = true;
      delete (window as unknown as { __candiceShell?: unknown }).__candiceShell;
    },
  };
}

export function unregisterShellCommands(registry: ShellCommandRegistry): void {
  registry.dispose();
}

/** Injected by vite (define) at build time; falls back for plain-web dev. */
declare const __CANDICE_APP_VERSION__: string;
