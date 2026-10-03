# Claude-Nine Adapter

claude-nine shares the same `~/.claude` config root as plain Claude Code, so one skill install is visible to both. This adapter is about model guidance and install verification, not a duplicated skill. Do not invent a claude-nine path and do not create a second independently maintained copy of this skill.

1. Install the skill once into the shared skills root (the same root plain Claude Code reads). Verify with the nine-router-setup skill that the router is installed and the DeepSeek Direct and Ollama Cloud providers are verified.
2. Resolve the two model roles before the first run, per `references/router-model-guidance.md`:
   - Animation code: `ollama/glm-5.3-flash` (preferred), or `ds/deepseek-v4.1-flash` with the `(max)` reasoning suffix, confirmed present in the live catalog.
   - Critic (vision): `ollama/kimi-k3`, confirmed present in the live Ollama catalog and passing the image smoke test.
3. If the router catalog does not carry a required model, stop with a precise error naming the model and the catalog checked. Never silently substitute.
4. Run one preview-gate scene end to end (pre-production through the preview gate) to confirm the routed models, the headless Chromium frame driver, and FFmpeg are all reachable from the claude-nine environment.
5. Record any compatibility-only changes in the evaluation report. Do not overwrite an existing target. Do not add credentials to the skill folder.
