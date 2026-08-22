# WS-07 — transparent/frameless window behavior — tests

Owned lane: `apps/candice-companion/src/window/**` (PROJECT-MANIFEST 9.2,
WS-07 glob) plus this test directory `__tests__/`.

## What is proven

Binary acceptance criteria (CHECKLIST E.1 WS-07):

1. **Transparent** — declared `transparent: true`; the style contract
   forces the root background transparent (`!important`), test-enforced:
   no hex / rgba / url background may exist in `WINDOW_STYLE_TEXT`.
2. **Frameless** — declared `decorations: false`; measured via
   `isDecorated()`; the drag surface restores movability without a title
   bar (`data-tauri-drag-region="deep"` on the character stage).
3. **Always-on-top** — declared `alwaysOnTop: true`; re-asserted at ready
   (`setAlwaysOnTop`) so platform defaults cannot drop it; measured back
   via `isAlwaysOnTop()`.
4. **No baked terminal/UI background** — `assertNoBakedBackground()` checks
   the live DOM; the style text forbids backgrounds; the config declares
   `shadow: false` so no system drop shadow paints a baked rectangle behind
   the hologram (spec 10/11B).
5. **Spec 20 failure isolation** — broken/null window objects degrade to
   `windowAvailable: false` and `candice:window-unavailable`, never throw.
6. **Cross-lane lockstep** — the lane's `MAIN_WINDOW_LABEL === 'main'`
   matches the WS-06 shell capability surface and the WS-06 `tauri.conf.json`
   window label.

## What is NOT proven here (owned by other lanes)

- Real OS window pixels on a desktop — the visual transparent-background
  harness (WS-15) and the interactive desktop smoke (spec 18/28) prove the
  pixels. This suite proves the contract the runtime must observe.
- macOS `macOSPrivateApi` config flag — `tauri.conf.json` is a 9.3
  within-run shared file (WS-06 shell lane applies it); this lane documents
  the requirement in `PLATFORM_NOTES`.
- Positioning / anchoring / monitor tracking — WR-015 / WR-016 platform
  lanes.

## Run

```bash
node --test apps/candice-companion/src/window/__tests__/window.test.ts
```

Requires Node >= 22.6 (node:test + TS type-stripping), zero deps, matching
the WS-17/WS-40 lane convention. `tsc --noEmit` (app tsconfig) typechecks
the lane when the app toolchain is present.
