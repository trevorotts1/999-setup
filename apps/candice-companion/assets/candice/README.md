# Candice Companion — final art (assets/candice/)

Owned by WR-013 (ownership map 9.2: `assets/candice/**`). WS-11: asset manifest + final-art loader.

## Layout

| Path | Contents |
|---|---|
| `source/operator-approved/` | 16 byte-for-byte operator originals. Canonical, policy-read-only, never written by any lane. |
| `derived/experimental-kie/` | Quarantined 17-file generated pack; never production authority. |
| `asset-manifest.json` | Canonical stable names, original filename provenance, dimensions, SHA-256, byte sizes, alpha/color type, approval, and stateMap. |
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

The source-integrity suite verifies SHA-256, dimensions, byte equality with the
Downloads originals, exact canonical roster, and manifest provenance.

## Contracts

- Spec 11/11A/11B: 16 supplied assets (9 first-batch + 7 second-batch), RGBA,
  alpha preserved, never flattened onto black.
- The former 17-file KIE set is experimental only and cannot become production
  authority silently.
- No ChatGPT download filenames anywhere in production paths. Provenance lives
  in `batch` labels only.
- Known anomaly: `10-eye-half-blink` alpha mean ~169.9 (near-opaque frame) vs
  siblings ~70-82. Flagged for WS-15 light/dark transparency verification.
