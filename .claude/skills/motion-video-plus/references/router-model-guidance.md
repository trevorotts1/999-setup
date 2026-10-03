# Router model guidance

This skill runs under nine-router. Model choice is resolved, never hardcoded and never guessed. This file is the procedure. It is written in our own words from the nine-router-setup skill's routing matrix and laws.

## The two roles

Every run needs exactly two model roles:

1. **Animation code** (code-strong). Writes the deterministic HTML/JS scenes.
2. **Critic** (vision). Reads contact sheets, stills, and per-beat sheets in the critique gate.

## The law

**Never hardcode a model ID.** Before a run starts, resolve each role against the LIVE catalog of its provider. If the catalog does not carry the required model, STOP with a precise error that names the missing model and the catalog checked. Never silently substitute another model. A silent substitution is a failed run wearing a passing run's clothes.

## Resolution procedure

At the start of every run, in order:

1. **DeepSeek Direct catalog.** Fetch `https://api.deepseek.com/models` and confirm it lists the DeepSeek IDs you intend to use. The ID this skill expects is `deepseek-v4.1-flash`. If it is absent, stop that provider configuration with a precise error. Never fall back to an older DeepSeek model on your own authority.
2. **Ollama Cloud catalog.** Fetch `https://ollama.com/api/tags` and confirm it lists the exact IDs returned there. The IDs this skill expects are `glm-5.3-flash` and `deepseek-v4.1-flash`. Use the exact IDs the live endpoint returns; do not assume a local CLI `:cloud` suffix, and do not trust a stale cached registry. If an ID is absent, stop with a precise error.
3. **OpenRouter catalog (critic fallback only).** Fetch `https://openrouter.ai/api/v1/models` and confirm it lists `meta/muse-spark-1.3-contributor` with image input in its architecture. If it is absent, the fallback lane is closed: the run may proceed on the primary critic, but may not silently substitute another model.
4. Record the resolved route strings in the run manifest as `animation_model` and `critic_model`.

## Role assignments

- **Animation code, preferred:** `ollama/glm-5.3-flash` via Ollama Cloud with max reasoning. Deterministic reasoning control matters more than raw speed when the output must be a pure function of time, and GLM's very large cloud context is useful when the script and brand bible are long.
- **Animation code, alternative:** `ds/deepseek-v4.1-flash` via DeepSeek Direct with the `(max)` reasoning suffix.
- **Critic, required:** `ollama/deepseek-v4.1-flash` via Ollama Cloud. It must pass the image smoke test before the first critique round; a critic that cannot reliably read the contact sheets is a failed gate, not a soft warning.
- **Critic, fallback:** `openrouter/meta/muse-spark-1.3-contributor` via OpenRouter (vision-capable: text+image+video input). Used only if the primary critic is absent from the live catalog or fails the image smoke test. Never silently substitute any other model.
- **Kimi is out:** Kimi K3 requires purchased tokens on Ollama Cloud, so it is not a default anywhere in this skill. Do not "fix" the critic back to Kimi.
- **OpenRouter:** a fallback lane for the critic only (`openrouter/meta/muse-spark-1.3-contributor`). It joins none of the other default combos or lanes in this skill. Keep it out of animation unless the operator explicitly asks for it.

## What stays identical

Everything downstream of model choice is provider-independent: the animation contract, the motion grammar, the manifest schema, the render driver, preflight math, the synthesized sound chain, the determinism gate, and the QC gate. A run on DeepSeek and a run on Ollama Cloud must produce the same pixels for the same manifest and seed. If they do not, the determinism gate has something to say about it.
