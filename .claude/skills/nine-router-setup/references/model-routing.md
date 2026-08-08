# Model routing

## Production-default routing matrix

| Role / feature | Provider | Model | Thinking | Notes |
|---|---|---|---|---|
| Fable / subagents | DeepSeek Direct | `ds/deepseek-v4-flash` | Max | Also set `CLAUDE_CODE_SUBAGENT_MODEL` |
| Opus | DeepSeek Direct | `ds/deepseek-v4-pro` (via `ds/deepseek-v4-pro-max`) | Max | Use the verified Pro-Max route |
| Sonnet | Ollama Cloud | `ollama/glm-5.2` | Max | ~976K cloud context |
| Haiku | Ollama Cloud | `ollama/kimi-k2.6` | Highest verified, target Max | 256K, Text+Image |
| Selectable | Ollama Cloud | `ollama/gemma4:31b` | Provider-supported | 256K, Text+Image, **no audio** |
| Selectable | Ollama Cloud | `ollama/minimax-m3` | Provider-supported | Use 512K operational context |
| Fallback | Agnes AI | `agnes/agnes-2.5-flash` | Highest verified | OpenAI-compatible |
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

| Route | Desired | Fallback |
|---|---|---|
| DeepSeek Flash / Pro | `max` | none (deepseek format honors max) |
| GLM 5.2 | `max` | highest verified |
| Kimi K2.6 | max, only if a live probe confirms | highest verified |
| Agnes 2.5 Flash | max, only if accepted | provider-supported default |

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
blackceo-fable-fallback:
  1. ds/deepseek-v4-flash (max)
  2. agnes/agnes-2.5-flash (highest verified reasoning)

blackceo-opus-fallback:
  1. ds/deepseek-v4-pro (max)
  2. agnes/agnes-2.5-flash (highest verified reasoning)

blackceo-fusion (strategy: fusion):
  Panels:
  1. ds/deepseek-v4-flash (max)
  2. ollama/glm-5.2 (max)
  3. ollama/kimi-k2.6 (highest verified, target max)
  Judge: ds/deepseek-v4-pro (max)
```

Fallback activates on real upstream failure conditions (timeout, 429, upstream 5xx) where
9Router supports those semantics. If 9Router cannot expose a fallback combo as the exact
model target used by Claude Code, use 9Router's native provider/account fallback mechanism
instead. Do not silently create an unused combo and claim failover is working.
