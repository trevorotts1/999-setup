/**
 * Truthful boot-health contract for the Candice shell.
 *
 * This module deliberately proves only that the local Tauri shell answered
 * its own health probe. It does not make claims about an MCP/session bridge,
 * microphone, speech runtimes, or Claude availability.
 */

export type BootPresentationStatus =
  | 'starting'
  | 'shell-ready'
  | 'text-fallback';

/** Wire shape returned by Rust `cmd_get_shell_info`. */
export interface ShellInfo {
  appVersion: string;
  suppliedAssetCount: number;
  windowVisible: boolean;
  shellReady: boolean;
  subsystems: string[];
}

export interface ShellInvokeAdapter {
  invoke(command: string): Promise<unknown>;
}

export class ShellHealthError extends Error {
  override name = 'ShellHealthError';
}

/** Validate untrusted IPC data before allowing it to alter the UI state. */
export function parseShellInfo(value: unknown): ShellInfo {
  if (!value || typeof value !== 'object') {
    throw new ShellHealthError('shell info response is not an object');
  }

  const info = value as Record<string, unknown>;
  if (
    typeof info.appVersion !== 'string' ||
    info.appVersion.length === 0 ||
    typeof info.suppliedAssetCount !== 'number' ||
    !Number.isSafeInteger(info.suppliedAssetCount) ||
    info.suppliedAssetCount < 0 ||
    typeof info.windowVisible !== 'boolean' ||
    info.shellReady !== true ||
    !Array.isArray(info.subsystems) ||
    !info.subsystems.every((item) => typeof item === 'string')
  ) {
    throw new ShellHealthError('shell info response does not satisfy the boot contract');
  }

  return {
    appVersion: info.appVersion,
    suppliedAssetCount: info.suppliedAssetCount,
    windowVisible: info.windowVisible,
    shellReady: true,
    subsystems: [...info.subsystems],
  };
}

async function defaultInvokeAdapter(): Promise<ShellInvokeAdapter> {
  // The module is lazy so a plain browser preview can reach the explicit
  // fallback instead of failing while this bundle is evaluated.
  const { invoke } = await import('@tauri-apps/api/core');
  return { invoke };
}

/**
 * Durable boot latch. Unlike a ready event, this works even when the native
 * shell became ready before the WebView began listening.
 */
export async function probeNativeShell(
  adapter?: ShellInvokeAdapter,
): Promise<ShellInfo> {
  try {
    const bridge = adapter ?? await defaultInvokeAdapter();
    return parseShellInfo(await bridge.invoke('cmd_get_shell_info'));
  } catch (error) {
    if (error instanceof ShellHealthError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ShellHealthError(`native shell health probe failed: ${detail}`);
  }
}
