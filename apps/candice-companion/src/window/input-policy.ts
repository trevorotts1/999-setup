/**
 * Transparent-window pointer policy (FIX-008).
 *
 * A transparent webview still receives events across its rectangular native
 * bounds. Until an OS adapter can prove partial hit regions, the only safe
 * policy is complete pointer pass-through. We never disable click-through for
 * a future control and silently turn its invisible surrounding rectangle into
 * a terminal blocker.
 */

export interface CursorEventsWindowLike {
  setIgnoreCursorEvents(ignore: boolean): Promise<void>;
}

export interface InputRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Every accepted region must correspond to a visible control/handle. */
  purpose: 'control' | 'drag-handle' | 'character-activate';
}

export interface PartialInputRegionAdapter {
  /** Returns true only when the native layer installed these exact regions. */
  setInteractiveRegions(regions: readonly InputRegion[]): Promise<boolean>;
}

export type InputPolicyMode = 'pass-through' | 'partial-interactive' | 'unavailable';

export interface WindowInputPolicy {
  readonly mode: InputPolicyMode;
  /** Make every transparent and visible pixel pass pointer input to Terminal. */
  enablePassThrough(): Promise<boolean>;
  /**
   * Enable only native-proven visible regions. Without an adapter this fails
   * closed and keeps pass-through enabled.
   */
  setInteractiveRegions(regions: readonly InputRegion[]): Promise<boolean>;
}

function validRegion(region: InputRegion): boolean {
  return Number.isFinite(region.x)
    && Number.isFinite(region.y)
    && Number.isFinite(region.width)
    && Number.isFinite(region.height)
    && region.width > 0
    && region.height > 0;
}

export function createWindowInputPolicy(
  win: CursorEventsWindowLike | null,
  partialAdapter: PartialInputRegionAdapter | null = null,
): WindowInputPolicy {
  let mode: InputPolicyMode = win === null ? 'unavailable' : 'pass-through';

  const enablePassThrough = async (): Promise<boolean> => {
    if (win === null) {
      mode = 'unavailable';
      return false;
    }
    try {
      await win.setIgnoreCursorEvents(true);
      mode = 'pass-through';
      return true;
    } catch {
      // The native shell may not support this API. Do not claim partial
      // interaction and do not attempt a whole-rectangle capture fallback.
      mode = 'unavailable';
      return false;
    }
  };

  return {
    get mode() {
      return mode;
    },
    enablePassThrough,
    setInteractiveRegions: async (regions): Promise<boolean> => {
      if (partialAdapter === null || regions.length === 0 || !regions.every(validRegion)) {
        await enablePassThrough();
        return false;
      }
      try {
        const installed = await partialAdapter.setInteractiveRegions(regions);
        if (installed) {
          mode = 'partial-interactive';
          return true;
        }
      } catch {
        // Fall through to the safe policy below.
      }
      await enablePassThrough();
      return false;
    },
  };
}
