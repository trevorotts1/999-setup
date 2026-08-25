/**
 * Native partial-input-region adapter — the implementation
 * `src/window/input-policy.ts` declared and never had.
 *
 * `createWindowInputPolicy(win, partialAdapter)` fails closed to whole-window
 * pass-through whenever `partialAdapter` is null, which it always was: the
 * companion therefore ignored every pointer event, and the operator could not
 * grab the character to move the window.
 *
 * This module supplies the adapter. It publishes the measured visible boxes
 * (`./visible-regions.ts`) to `cmd_set_input_regions`, and the native hit test
 * lifts click-through only while the cursor is inside one of them. Everywhere
 * else the window stays pointer-transparent, which is the FIX-008 guarantee
 * the header of `input-policy.ts` is written to protect.
 *
 * The adapter returns true only when native reports it installed those exact
 * regions. Anything else — a rejected payload, a missing command, a thrown
 * IPC error — returns false, and the policy falls back to pass-through on its
 * own. A failure here costs dragging; it never costs the operator's Terminal.
 */

import type { InputRegion, PartialInputRegionAdapter, WindowInputPolicy } from './input-policy.ts';
import { measureVisibleRegions, regionsDiffer } from './visible-regions.ts';

/** Native command that installs the regions (src-tauri/src/hit_test.rs). */
export const SET_INPUT_REGIONS_COMMAND = 'cmd_set_input_regions';
/** Native command returning the live policy, for diagnostics and tests. */
export const GET_POINTER_POLICY_COMMAND = 'cmd_get_pointer_policy';
/** Event native emits on a real capture-state transition. */
export const POINTER_POLICY_EVENT = 'candice:pointer-policy';

export type RegionInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Wrap an invoke function as a `PartialInputRegionAdapter`. Kept separate
 * from the Tauri import so tests can drive it with a fake.
 */
export function createNativeInputRegionAdapter(invoke: RegionInvoke): PartialInputRegionAdapter {
  return {
    async setInteractiveRegions(regions: readonly InputRegion[]): Promise<boolean> {
      try {
        const installed = await invoke(SET_INPUT_REGIONS_COMMAND, {
          regions: regions.map((region) => ({
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            purpose: region.purpose,
          })),
        });
        // Only an explicit `true` counts as installed. A shell without the
        // command resolves to undefined or rejects; both mean not installed.
        return installed === true;
      } catch {
        return false;
      }
    },
  };
}

/** Load the real Tauri invoke. Throws if the native shell is absent. */
export async function defaultRegionInvoke(): Promise<RegionInvoke> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (command, args) => invoke(command, args);
}

export interface InputRegionControllerOptions {
  /** The policy to drive. Its own fail-closed behavior is preserved. */
  policy: WindowInputPolicy;
  /** Subtree to measure — the shell root. */
  root: HTMLElement;
  /**
   * Safety re-measure cadence. CSS animations (the character's breathing
   * scale) change the painted box without firing any observer, so a timer
   * is the only way to notice. 500ms is far below human drag latency.
   */
  intervalMs?: number;
  /** Coalescing window for observer bursts. */
  debounceMs?: number;
}

export interface InputRegionController {
  /**
   * Measure and publish now. Resolves true when native installed the exact
   * measured regions, false when it did not (including the legitimate case
   * of nothing visible to publish, which forces pass-through).
   */
  refresh(): Promise<boolean>;
  /** The regions last published. */
  readonly regions: readonly InputRegion[];
  /** True when native accepted the last publish. */
  readonly installed: boolean;
  /** Stop observing. Idempotent. */
  dispose(): void;
}

/**
 * Keep the published regions in step with what the shell paints.
 *
 * Sources of change, all of them real: DOM mutations (layer swaps, mounted
 * views, status text), element resizes, window resizes, image loads, and —
 * only reachable by polling — CSS animation. Every path funnels through one
 * debounced refresh, and a publish is skipped entirely when the measured
 * regions have not moved beyond tolerance, so the breathing animation does
 * not generate continuous IPC.
 */
export function createInputRegionController(
  options: InputRegionControllerOptions,
): InputRegionController {
  const { policy, root } = options;
  const intervalMs = options.intervalMs ?? 500;
  const debounceMs = options.debounceMs ?? 80;
  const view = root.ownerDocument?.defaultView ?? null;

  let published: InputRegion[] = [];
  let installed = false;
  let disposed = false;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<boolean> | null = null;

  async function publish(): Promise<boolean> {
    if (disposed) return installed;
    const measured = measureVisibleRegions(root);
    if (measured.length === 0) {
      // Nothing is painted: the correct policy is the resting one. Do not
      // hand native an empty set and call it "installed".
      if (published.length > 0 || installed) {
        published = [];
        installed = false;
        await policy.enablePassThrough();
      }
      return false;
    }
    if (installed && !regionsDiffer(measured, published)) return true;
    published = measured;
    installed = await policy.setInteractiveRegions(measured);
    return installed;
  }

  function refresh(): Promise<boolean> {
    // Serialize: a burst of observer callbacks must not interleave publishes
    // and leave native holding an older measurement than the last one taken.
    const next = (inFlight ?? Promise.resolve(installed)).then(publish, publish);
    inFlight = next;
    return next;
  }

  function schedule(): void {
    if (disposed || pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      void refresh();
    }, debounceMs);
  }

  const mutations = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(schedule);
  mutations?.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  const resizes = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(schedule);
  resizes?.observe(root);

  // Artwork changes the painted box only once it has decoded.
  root.addEventListener('load', schedule, true);
  view?.addEventListener('resize', schedule);
  const timer = setInterval(schedule, intervalMs);

  return {
    refresh,
    get regions(): readonly InputRegion[] {
      return published;
    },
    get installed(): boolean {
      return installed;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
      clearInterval(timer);
      mutations?.disconnect();
      resizes?.disconnect();
      root.removeEventListener('load', schedule, true);
      view?.removeEventListener('resize', schedule);
    },
  };
}
