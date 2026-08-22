import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

// Production build config: base config + build-time injection.
// mergeConfig keeps outDir (src-tauri/dist) from the base config.
export default defineConfig(
  mergeConfig(
    baseConfig,
    defineConfig({
      define: {
        // Injected at build time; release owner stamps the real version at
        // the final coordinated bump (spec 26, 0G). Kept in sync with
        // package.json.
        __CANDICE_APP_VERSION__: JSON.stringify('0.2.0'),
      },
    }),
  ),
);
