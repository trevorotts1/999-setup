# 9Router management API — verified schemas

> Re-verify against the installed version before relying on any schema. 9Router is actively
> developed; the request/response shapes below were verified against **9router 0.5.45**
> (2026-08-07). Source of truth: `https://github.com/decolua/9router` and the installed
> package. Use the management API, never direct database edits.

## Authentication

The management API is protected by a **dashboard session cookie** (`auth_token`) obtained by
logging in — OR the machine-local **CLI token** sent as the `x-9r-cli-token` header. The
chat/v1 gateway is protected by the **API key** (`Authorization: Bearer`). They are separate.

### Authentication — two valid paths for `/api/*`

1. **Dashboard session cookie** (`auth_token`) from `POST /api/auth/login`. Spec §7 uses
   this path: log in, rotate password, keep the cookie in memory.
2. **`x-9r-cli-token` header** — the machine-id-derived CLI token
   (`sha256(machineId + "9r-cli-auth" + cliSecret)[:16]`). The dashboard guard
   (`src/dashboardGuard.js`) accepts it for all `/api/*` routes. Useful as a repair path
   when the dashboard password is unknown; the shared `NineRouterClient` supports it via
   `useCliToken()`, falling back to it automatically when no session cookie is set.

The chat gateway (`/v1/*`) is gated separately by `requireApiKey` and the API key.

### Login — `POST /api/auth/login`

```json
{ "password": "<dashboard password>" }
```

Response `200`: `{ "success": true, "mustChangePassword": <bool> }` and a session cookie.

`mustChangePassword` is true when the password was never set (fresh install with default
`123456`).

### Auth status — `GET /api/auth/status`

Returns `{ authenticated, requireLogin, authMode, hasPassword, ... }`. Use it to decide
whether a login is needed before calling management endpoints.

## Settings — `PATCH /api/settings`

- `GET /api/settings` returns current settings with `password` redacted.
- `PATCH /api/settings` merges the JSON body into settings.
- Protected keys (`password`, `mitmSudoEncrypted`) are **never** mass-assigned from the
  body.

### Changing the dashboard password

```json
{ "currentPassword": "<old>", "newPassword": "<strong new value>" }
```

- If a password already exists, `currentPassword` is required and verified.
- On a fresh install (no password), `currentPassword` may be empty or `123456`.

### Security-relevant settings

```json
{
  "requireLogin": true,
  "requireApiKey": true,
  "tunnelEnabled": false,
  "tailscaleEnabled": false,
  "tunnelDashboardAccess": false
}
```

### Capacity auto-switch

```json
{
  "capacityAdapter": {
    "vision":     { "enabled": true,  "roundRobin": false, "models": ["ollama/kimi-k2.6"] },
    "pdf":        { "enabled": false, "roundRobin": false, "models": [] },
    "audioInput": { "enabled": false, "roundRobin": false, "models": [] },
    "videoInput": { "enabled": false, "roundRobin": false, "models": [] }
  }
}
```

Verified defaults in 0.5.45: `vision` enabled, `pdf` disabled, `audioInput` enabled,
`videoInput` disabled. This repository explicitly disables `audioInput` (Gemma 4 31B has no
audio) and keeps `pdf`/`video` disabled.

### Combo strategies

```json
{
  "comboStrategy": "fallback",
  "comboStickyRoundRobinLimit": 1,
  "comboStrategies": {
    "blackceo-fusion": {
      "fallbackStrategy": "fusion",
      "judgeModel": "ds/deepseek-v4-pro",
      "fusionTuning": { "minPanel": 2, "stragglerGraceMs": 8000, "panelHardTimeoutMs": 90000 }
    }
  }
}
```

The SSE chat handler reads `comboStrategies[comboName]` for `fallbackStrategy` (fusion vs
fallback/round-robin) and `judgeModel` for fusion. Without `judgeModel`, fusion falls back
to the first panel model.

## API keys — `POST /api/keys`

```json
{ "name": "BlackCEO Claude Code" }
```

Response `201`:

```json
{ "key": "<the full key, returned once>", "name": "...", "id": "...", "machineId": "..." }
```

- `GET /api/keys` lists keys (masked).
- The key value is only returned at creation — capture it, store it in platform-protected
  local state, never commit it.

## Providers — `POST /api/providers`

Creates an API-key provider connection.

```json
{
  "provider": "deepseek",
  "apiKey": "<key>",
  "name": "DeepSeek Direct"
}
```

- `provider` is normalized via `normalizeProviderId` (accepts the built-in slug `deepseek`,
  `ollama`, or a custom-node id).
- For a built-in provider, `apiKey` is required (except `ollama-local`).
- For an **OpenAI-compatible** custom node, the node must already exist (see below) and the
  connection's `providerSpecificData` (prefix/baseUrl/nodeName) is pulled from the node
  automatically.

Response `201`: `{ "connection": { ... without apiKey ... } }`.

## Provider nodes — `POST /api/provider-nodes`

Creates a custom OpenAI-compatible node (used for Agnes):

```json
{
  "name": "Agnes AI",
  "prefix": "agnes",
  "type": "openai-compatible",
  "apiType": "chat",
  "baseUrl": "https://apihub.agnes-ai.com/v1"
}
```

- `type` defaults to `openai-compatible`; `apiType` must be `chat` or `responses`.
- Response `201`: `{ "node": { id, type, prefix, apiType, baseUrl, name } }`.
- Then create a provider connection with `provider` = the node's `id` and the Agnes API key.
- `GET /api/provider-nodes` lists nodes; reuse an existing node with the right prefix/baseUrl
  rather than duplicating it.

## Combos — `POST /api/combos`

```json
{
  "name": "blackceo-fusion",
  "models": ["ds/deepseek-v4-flash", "ollama/glm-5.2", "ollama/kimi-k2.6"],
  "kind": null
}
```

- Name must match `^[a-zA-Z0-9_.\-]+$`.
- A duplicate name returns `400` — check `GET /api/combos` first and update instead.
- `GET /api/combos` lists combos. `PUT/DELETE /api/combos/<id>` update/delete.
- The combo's **strategy** (fusion vs fallback) is set in **settings.comboStrategies**, not
  on the combo row itself.

## Models — `GET /api/models` and `/api/models/alias`

- `GET /api/models` returns the registry model list enriched with `fullModel`,
  `routedModel`, `alias`, and `caps` (vision/search/reasoning/contextWindow/maxOutput).
- `PUT /api/models/alias` body `{ "model": "ds/deepseek-v4-flash", "alias": "fable" }` sets
  a model alias; `DELETE /api/models/alias?alias=<name>` removes it.

## Provider model listing — `GET /api/providers/<id>/models`

Fetches the live model list for a provider connection. Verified endpoints used by 0.5.45:

- DeepSeek: `https://api.deepseek.com/models` (Bearer).
- Ollama Cloud: `https://ollama.com/api/tags` (Bearer) — parses `data.models[]`.
- Custom OpenAI-compatible node: `<baseUrl>/models` (Bearer).

Use this (or the provider's direct catalog) for live model resolution; never trust a static
list more than the live catalog.

## Chat gateway

- `POST /v1/messages` — Anthropic/Claude format (used by Claude Code).
- `POST /v1/chat/completions` — OpenAI format.
- Auth: `Authorization: Bearer <local 9Router API key>` (when `requireApiKey=true`).
- Model routing: `provider/model` (`ds/deepseek-v4-flash`), or a **combo name with no slash**
  (`blackceo-fusion`), which is looked up in the combos table.
- When a combo name routes: `comboStrategies[comboName].fallbackStrategy` decides
  fusion vs fallback; `judgeModel` is the fusion judge.

## Do not use

- `/api/cli-tools/claude-settings` — this repository **must not** use it to persist 9Router
  routing globally. `claude-nine` owns the routed-session boundary.
