# Candice Companion — final art (assets/candice/)

Owned by WR-013 (ownership map 9.2: `assets/candice/**`). WS-11: asset manifest + final-art loader.

## Layout

| Path | Contents |
|---|---|
| `source/` | 17 source PNGs, READ-ONLY (chmod 444). Never written by any lane (spec 11A/11B). |
| `asset-manifest.json` | Stable production names, roles, dimensions, sha256, byte sizes, alpha stats, batch provenance, stateMap. |
| `loader.ts` | Zero-dep TypeScript loader. Lazy: metadata on demand, pixels only via `loadImage()`. |
| `__tests__/loader.test.ts` | node --test suite (9 tests) covering E.1. |
| `derived/` | Reserved. WS-12/WS-13 runtime derivatives land here; sources never touched. |

## Usage

```ts
import { AssetRegistry } from './assets/candice/loader';

const assets = AssetRegistry.create();           // metadata only, nothing decoded
const speech = assets.resolve('face', 'speech-medium'); // role -> stable entry
const img = assets.loadImage(speech);            // the only decode call
```

## Tests

```bash
node --test apps/candice-companion/assets/candice/__tests__/loader.test.ts
```

9/9 passing as of the WS-11 checkpoint.

## Contracts

- Spec 11/11A/11B: 16 supplied assets (9 first-batch + 7 second-batch), RGBA,
  alpha 0..255 preserved, never flattened onto black.
- 17th asset (`17-processing-pose`) is operator-supplied (KIE pack MASTER-BRIEF
  deliverable 17); recorded as optional-provenance, safe to omit from V1 builds.
- No ChatGPT download filenames anywhere in production paths. Provenance lives
  in `batch` labels only.
- Known anomaly: `10-eye-half-blink` alpha mean ~169.9 (near-opaque frame) vs
  siblings ~70-82. Flagged for WS-15 light/dark transparency verification.
