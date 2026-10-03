# Changelog: motion-video-plus

## [1.0.0] - 2026-10-03

Initial release: the nine-router variant of the motion-video-plus skill.

Produces finished motion-graphics videos through a proven deterministic pipeline: a code-strong routed model writes scene animation as HTML/JS exposing `window.__setTime(t)`, headless Chromium renders it frame by frame at 30fps, FFmpeg stitches frames with a Fish Audio TTS voiceover into an MP4. Scene-based manifests scale from 30 seconds to 2 hours.

Includes the full adapted system set: motion grammar with linting, fresh-critic protocol with 8+ gates, synthesized score and SFX as the default sound (mixed to -14 LUFS), determinism verification, review tooling (`--still`, `--cliprange`, `--mux`, `--beatsheet`), and the six-chapter pre-production workflow.

Router-aware model guidance: animation code resolves to `ollama/glm-5.3-flash` (preferred) or `ds/deepseek-v4.1-flash`; critique rounds resolve to `ollama/kimi-k3` (vision). All models resolved against the live router catalog; the run stops with a precise error if a required model is absent. Pipeline, segments, audio-first timing, cleanup, and QC are identical to the OpenClaw onboarding-repo release of this skill.
