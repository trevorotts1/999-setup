# Claude Code Adapter

Evaluate the packaged skill against the current Claude Code runtime without redesigning the motion-video-plus methodology.

1. Verify the current Claude Code skill-discovery mechanism in the local install.
2. If the normal local skills root is `~/.claude/skills`, install the skill there (one install; claude-nine shares this root, so it is visible to both).
3. Confirm that the runtime discovers the skill and can load references/assets/scripts.
4. Confirm the nine-router model roles resolve: animation code to `ollama/glm-5.3-flash` (or `ds/deepseek-v4.1-flash`), critique to `ollama/deepseek-v4.1-flash` with the image smoke test passing, fallback `openrouter/meta/muse-spark-1.3-contributor`.
5. Run one preview-gate scene end to end to confirm the frame driver and FFmpeg work in this environment.
6. Record any compatibility-only changes in the evaluation report.

Do not overwrite an existing target. Do not add credentials to the skill folder.
