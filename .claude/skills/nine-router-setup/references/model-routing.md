# Model routing

## Production-default routing matrix

| Role / feature | Provider | Model | Thinking | Notes |
|---|---|---|---|---|
| Fable / subagents | DeepSeek Direct | `ds/deepseek-v4-flash` | Max | Also set `CLAUDE_CODE_SUBAGENT_MODEL` |
| Opus | DS Max (custom) | `ds-max/deepseek-v4-pro` | Max | Custom node forces max |
| Sonnet | DeepSeek Direct | `ds/deepseek-v4-flash` | Max | Swarm builder |
| Haiku | DS Light (custom) | `ds-light/deepseek-v4-flash` | Off | Cheap reads |
| Haiku fallback | Agnes AI | `agnes/agnes-2.5-flash` | Provider-supported | OpenAI-compatible |
| Selectable | Ollama Cloud | `ollama/glm-5.2` | Max | ~976K cloud context |
| Selectable | Ollama Cloud | `ollama/kimi-k2.6` | Highest verified | 256K, Text+Image |
| Selectable | Ollama Cloud | `ollama/gemma4:31b` | Provider-supported | 256K, Text+Image, **no audio** |
| Selectable | Ollama Cloud | `ollama/minimax-m3` | Provider-supported | Use 512K operational context |
| Vision auto-switch | Ollama Cloud | `ollama/kimi-k2.6` | Highest verified | Must pass image smoke test |
| PDF auto-switch | — | — | — | Disabled until verified end-to-end |
| Audio auto-switch | — | — | — | Disabled; Gemma 4 31B has no audio input |
| Selectable (optional) | OpenRouter | any live-catalog model via `openrouter/<vendor>/<model>`; `:free` lane verified | `thinkingFormat` openai (built-in) | never in default combos/lanes |

## Provider model IDs

### DeepSeek Direct

Official endpoints:

```text
OpenAI-compatible base: https://api.deepseek.com
Anthropic-compatible base: https://api.deepseek.com/anthropic
```

Model IDs required from the live catalog (`https://api.deepseek.com/models`):

```text
deepseek-v4-flash
deepseek-v4-pro
```

If either is absent, stop that provider configuration with a precise error — never silently
substitute an older DeepSeek model.

9Router's registry (verified 0.5.45) exposes the alias `ds` (and `deepseek`) and a
`deepseek-v4-pro-max` variant that maps upstream to `deepseek-v4-pro`. Resolve and
smoke-test the installed version rather than assuming the syntax.

### Ollama Cloud

Direct host and live discovery endpoint:

```text
https://ollama.com
https://ollama.com/api/tags
```

Required IDs from the live `/api/tags` catalog (exact returned IDs):

```text
glm-5.2
kimi-k2.6
minimax-m3
gemma4:31b
deepseek-v4-flash:0731   (only when the override is enabled)
```

⚠️ Use the exact IDs returned by the live endpoint. Do not assume the local CLI `:cloud`
suffix is used by the remote API. Do not hardcode stale registry data — 9Router's static
Ollama registry has historically lagged the live catalog.

### Agnes AI

Custom OpenAI-compatible provider node:

```text
name:    Agnes AI
prefix:  agnes
type:    openai-compatible
apiType: chat
baseUrl: https://apihub.agnes-ai.com/v1
```

Model: `agnes-2.5-flash`. Do not substitute `agnes-2.0-flash` or another model without
explicit user approval.

### DS Light and DS Max — DeepSeek custom provider nodes

Two custom OpenAI-compatible nodes for deterministic thinking control:

```text
DS Light:  prefix=ds-light,  baseUrl=https://api.deepseek.com/anthropic, model=deepseek-v4-flash, thinking=off
DS Max:    prefix=ds-max,    baseUrl=https://api.deepseek.com/anthropic, model=deepseek-v4-pro,  thinking=max
```

These exist because the 9Router `(max)` suffix mechanism (`stripThinkingSuffix`/`applyThinking`) is parsed per-route and is not verified — a custom node with explicit provider-level thinking wiring is deterministic. DS Light gives Haiku fast reads without thinking overhead; DS Max ensures Opus always gets max reasoning.

### OpenRouter (optional)

Built-in `apikey` provider (slug `openrouter`, verified against installed 9router 0.5.50):

```text
transport baseUrl: https://openrouter.ai/api/v1/chat/completions
auth-key endpoint: https://openrouter.ai/api/v1/auth/key
live catalog:      https://openrouter.ai/api/v1/models
thinkingFormat:    openai (native, no custom-node translation needed)
passthroughModels: true — every catalog model routes as openrouter/<vendor>/<model>
                    the moment the connection exists; there is no per-model
                    "register" endpoint in the management API.
```

OpenRouter joins **none** of the default combos or Claude lanes (Fable/Opus/Sonnet/Haiku/
Subagent/Vision), because free-tier caps (200 req/day, 429s) would poison fallback lanes
clients depend on. It is an additional selectable provider only.

Only the live-discovered `:free` lane is verified (a zero-credit account still passes;
paid models are never probed — that would 402 on a zero-credit account and could burn
client money otherwise). A 402 (insufficient credits) or 429 (free-tier rate limit) on the
verification probe means the credential is valid and the request routed correctly — this
is an **account condition**, reported as such, and still counts as a passing setup, never a
config failure.

Credential rejection (`HTTP 401`/`403` from `/auth/key`) is the only OpenRouter condition
that is reported as an error — and even then it never blocks DeepSeek/Ollama/Agnes.

## The DeepSeek Flash 0731 correction

- `deepseek-v4-flash` and `deepseek-v4-pro` are **DeepSeek Direct** API model IDs.
- `deepseek-v4-flash:0731` is an **Ollama Cloud** catalog ID, not a documented DeepSeek
  Direct model.

Production default — DeepSeek Direct is the Flash lane:

```text
Fable/Subagent lane -> DeepSeek Direct deepseek-v4-flash, max reasoning
Fusion Flash panel -> DeepSeek Direct deepseek-v4-flash, max reasoning
```

This keeps the Ollama Fusion panel at **2** simultaneous Ollama calls, preserving 1 Ollama
slot for OpenClaw on the $20 Pro plan.

Advanced override (only when deliberately enabled):

```text
DEEPSEEK_FLASH_VARIANT=ollama-0731
```

which may use `ollama/deepseek-v4-flash:0731`. When enabled, recalculate concurrency
safety — do not silently violate the reserved-capacity policy.

## Reasoning effort rules

Desired effort per route (probe, don't assume):

| Route | Desired | Fallback | Mechanism |
|---|---|---|---|
| DeepSeek Flash (direct) | `max` | high | `(max)` suffix |
| DS Max (custom node) | `max` | N/A | Provider-level forced |
| DS Light (custom node) | `off` | N/A | Provider-level forced |
| GLM 5.2 | `max` | highest verified | zai binary on/off |
| Kimi K2.6 | max if probed | highest verified | Probe required |
| Agnes 2.5 Flash | max if accepted | provider default | OpenRouter format |
| Agnes 2.5 Pro/Alpha | provider-supported | provider-supported | — |

Do not fail the entire installation solely because Agnes (or any provider) lacks a `max`
effort parameter. Downgrade only that route, keep reasoning enabled, and record it.

## Concurrency policy

Ollama individual-plan concurrency:

```text
Free: 1 concurrent cloud model
Pro ($20/mo): 3 concurrent cloud models
Max ($100/mo): 10 concurrent cloud models
```

BlackCEO reserve policy:

```text
Free -> Claude/9Router budget: 1, reserve: 0
Pro  -> Claude/9Router budget: 2, reserve: 1 for OpenClaw
Max  -> Claude/9Router budget: 8, reserve: 2 for OpenClaw
```

`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (set in the `claude-nine` child process only):

```text
free -> 1
pro  -> 2
max  -> 8
```

This variable limits Claude Code's read-only tools/subagents; it is **not** a perfect
provider-level semaphore. The skill must not claim it is a complete Ollama concurrency
limiter. The default Fusion design uses exactly 2 Ollama panel calls (GLM 5.2 + Kimi K2.6),
fitting the Pro budget of 2 while leaving 1 slot for OpenClaw. Do not add a third Ollama
model to the default Fusion panel on Pro.

## Output and context policy

- `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in the `claude-nine` child process only (conservative
  floor for the lower-output Ollama routes). Never persist globally. Do not set 200K routed —
  that is unsafe for Ollama routes.
- DeepSeek's ~200K output cap is an **application policy**, not a provider limit.
- Ollama's 32K output cap is an **application policy**, not a vendor maximum.
- Do not confuse `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (context) with output tokens.

## Combo definitions

```text
blackceo-fable-fallback:  ds/deepseek-v4-flash(max) → agnes/agnes-2.5-flash
blackceo-opus-fallback:   ds-max/deepseek-v4-pro(max) → agnes/agnes-2.5-flash
blackceo-haiku-fallback:  ds-light/deepseek-v4-flash → agnes/agnes-2.5-flash
blackceo-fusion:
  Panels: ds/deepseek-v4-flash(max), ollama/glm-5.2(max), ollama/kimi-k2.6
  Judge: ds-max/deepseek-v4-pro(max)
```

Fallback activates on real upstream failure conditions (timeout, 429, upstream 5xx) where
9Router supports those semantics. If 9Router cannot expose a fallback combo as the exact
model target used by Claude Code, use 9Router's native provider/account fallback mechanism
instead. Do not silently create an unused combo and claim failover is working.
