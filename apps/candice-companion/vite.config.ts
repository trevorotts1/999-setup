import { defineConfig } from 'vite';

// Candice Companion dev server. Fixed port 1420 so the Rust shell
// (devUrl in tauri.conf.json) always finds the same origin in dev.
// No React plugin: the shell renders plain TS/DOM until the visual
// lanes (WS-09/WS-10) choose their render approach.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri's bundler resolves frontendDist relative to src-tauri/; the
    // macro reads the mirrored config at src-tauri/tauri.conf.json. Both
    // consumers therefore expect the payload at src-tauri/dist — emit it
    // there directly (no symlinks, no shell copies, Windows-safe).
    outDir: 'src-tauri/dist',
    emptyOutDir: true,
    target: 'es2021',
  },
});
