/**
 * Native runtime capability contract (FIX-009).
 *
 * This is the webview half of the single executable composition. A successful
 * probe proves only fields that are explicitly true. In particular, a shell
 * that mounts Candice art is not evidence of a session/MCP answer bridge.
 */

export interface RuntimeCapabilities {
  contractVersion: string;
  runtimeCompositionActive: boolean;
  wakeReceived: boolean;
  wakeCommand: string | null;
  sessionBindingActive: boolean;
  bridgeAvailable: boolean;
  answerRoundTripAvailable: boolean;
  singleInstanceRoutingAvailable: boolean;
  rejectedLaunchReason: string | null;
}

export interface RuntimeInvokeAdapter {
  invoke(command: string): Promise<unknown>;
}

export class RuntimeCapabilityError extends Error {
  override name = 'RuntimeCapabilityError';
}

export function parseRuntimeCapabilities(value: unknown): RuntimeCapabilities {
  if (!value || typeof value !== 'object') {
    throw new RuntimeCapabilityError('runtime capabilities response is not an object');
  }
  const capabilities = value as Record<string, unknown>;
  const optionalString = (field: string): string | null => {
    const candidate = capabilities[field];
    if (candidate === null) return null;
    if (typeof candidate === 'string') return candidate;
    throw new RuntimeCapabilityError(`runtime capability ${field} must be a string or null`);
  };

  if (
    typeof capabilities.contractVersion !== 'string' ||
    capabilities.contractVersion.length === 0 ||
    capabilities.runtimeCompositionActive !== true ||
    typeof capabilities.wakeReceived !== 'boolean' ||
    typeof capabilities.sessionBindingActive !== 'boolean' ||
    typeof capabilities.bridgeAvailable !== 'boolean' ||
    typeof capabilities.answerRoundTripAvailable !== 'boolean' ||
    typeof capabilities.singleInstanceRoutingAvailable !== 'boolean'
  ) {
    throw new RuntimeCapabilityError('runtime capabilities response is malformed');
  }

  return {
    contractVersion: capabilities.contractVersion,
    runtimeCompositionActive: true,
    wakeReceived: capabilities.wakeReceived,
    wakeCommand: optionalString('wakeCommand'),
    sessionBindingActive: capabilities.sessionBindingActive,
    bridgeAvailable: capabilities.bridgeAvailable,
    answerRoundTripAvailable: capabilities.answerRoundTripAvailable,
    singleInstanceRoutingAvailable: capabilities.singleInstanceRoutingAvailable,
    rejectedLaunchReason: optionalString('rejectedLaunchReason'),
  };
}

async function defaultInvokeAdapter(): Promise<RuntimeInvokeAdapter> {
  const { invoke } = await import('@tauri-apps/api/core');
  return { invoke };
}

export async function probeRuntimeCapabilities(
  adapter?: RuntimeInvokeAdapter,
): Promise<RuntimeCapabilities> {
  try {
    const bridge = adapter ?? await defaultInvokeAdapter();
    return parseRuntimeCapabilities(await bridge.invoke('cmd_get_runtime_capabilities'));
  } catch (error) {
    if (error instanceof RuntimeCapabilityError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new RuntimeCapabilityError(`runtime capabilities probe failed: ${detail}`);
  }
}
