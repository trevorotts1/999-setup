import { createRequire } from 'node:module';
import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

const require = createRequire(import.meta.url);
// DERIVED, not hand-stamped. This was the literal string '0.2.0' with a
// comment promising it was "kept in sync with package.json" -- while
// package.json and tauri.conf.json both said 1.0.0-rc.1. It is the fallback
// behind `shellInfo?.appVersion` in shell/shell-commands.ts, so any support
// conversation that reached the fallback was told the wrong version. A
// comment is not a mechanism; reading the file is.
const { version: APP_VERSION } = require('./package.json') as { version: string };

// Production build config: base config + build-time injection.
// mergeConfig keeps outDir (src-tauri/dist) from the base config.
export default defineConfig(
  mergeConfig(
    baseConfig,
    defineConfig({
      define: {
        // Injected at build time from package.json, which the release owner
        // bumps at the coordinated version bump (spec 26, 0G). One source.
        __CANDICE_APP_VERSION__: JSON.stringify(APP_VERSION),
      },
    }),
  ),
);
