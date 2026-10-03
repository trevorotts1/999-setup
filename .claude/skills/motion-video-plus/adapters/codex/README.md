# Codex Adapter

Evaluate the packaged skill against the current Codex runtime without redesigning the motion-video-plus methodology.

1. Verify the current Codex skill-discovery mechanism in the local install.
2. If the normal local skills root is `~/.agents/skills` or `~/.codex/skills`, install the skill there.
3. Confirm that the runtime discovers the skill and can load references/assets/scripts.
4. Note: the router-aware model guidance in `references/router-model-guidance.md` assumes nine-router. Under Codex without nine-router, the operator picks the code-strong model for animation and the vision-capable model for critique manually, and records both in the run manifest. The pipeline itself is provider-independent.
5. Run one preview-gate scene end to end to confirm the frame driver and FFmpeg work in this environment.
6. Record any compatibility-only changes in the evaluation report.

Do not overwrite an existing target. Do not add credentials to the skill folder.
