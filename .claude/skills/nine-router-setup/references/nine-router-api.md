# 9Router management API — verified schemas

> Re-verify against the installed version before relying on any schema. 9Router is actively
> developed; the request/response shapes below were verified against **9router 0.5.45**
> (2026-08-07); surface re-verified against **0.5.50** on 2026-08-08. Source of truth:
> `https://github.com/decolua/9router` and the installed package. Use the management API,
> never direct database edits.

## Authentication

The management API is protected by a **dashboard session cookie** (`auth_token`) obtained by
logging in — OR the machine-local **CLI token** sent as the `x-9r-cli-token` header. The
chat/v1 gateway is protected by the **API key** (`Authorization: Bearer`). They are separate.

### Authentication — two valid paths for `/api/*`

1. **Dashboard session cookie** (`auth_token`) from `POST /api/auth/login`. This repo uses
   this path: log in with the dashboard password (default `123456`, or the user's current
   password via `NINEROUTER_DASHBOARD_PW`) and keep the cookie in memory. **No password
   rotation is performed** — the user owns the dashboard password.
2. **`x-9r-cli-token` header** — the machine-id-derived CLI token
   (`sha256(machineId + "9r-cli-auth" + cliSecret)[:16]`). The management API's
   authentication middleware accepts it for all `/api/*` routes (no `src/dashboardGuard.js`
   file exists in 0.5.50 — the mechanism is confirmed live, the file citation is dropped).
   Useful as a repair path when the dashboard password is unknown; the shared
   `NineRouterClient` supports it via `useCliToken()`, falling back to it automatically
   when no session cookie is set.

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

### Provider thinking for custom nodes

Custom nodes use their full `providerNodes.id` (e.g. `openai-compatible-chat-<uuid>`) as the key in `settings.providerThinking`. The dashboard UI does not expose this for custom nodes — it must be set via `PATCH /api/settings`:

```json
{
  "providerThinking": {
    "<ds-light-node-id>": {"mode": "off"},
    "<ds-max-node-id>": {"mode": "max"}
  }
}
```

The `mode` values map to the same format table as built-in providers (see model-routing.md reasoning effort rules). `"off"` means no thinking fields are sent. `"max"` maps to the provider's highest tier.

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
  `ollama`, `openrouter`, or a custom-node id).
- `openrouter` (verified against installed 9router 0.5.50 registry): `authType` `apikey`,
  transport `thinkingFormat` `openai`, a live `modelsFetcher` (type `openrouter-free`) against
  `https://openrouter.ai/api/v1/models`, and `passthroughModels: true` — every catalog model
  routes as `openrouter/<vendor>/<model>` once the connection exists. 9Router's own dashboard
  provider validator uses `GET https://openrouter.ai/api/v1/auth/key`.
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

// DS Light — DeepSeek v4 Flash with thinking OFF
{
  "name": "DS Light",
  "prefix": "ds-light",
  "type": "openai-compatible",
  "apiType": "chat",
  "baseUrl": "https://api.deepseek.com/anthropic"
}

// DS Max — DeepSeek v4 Pro with thinking MAX
{
  "name": "DS Max",
  "prefix": "ds-max",
  "type": "openai-compatible",
  "apiType": "chat",
  "baseUrl": "https://api.deepseek.com/anthropic"
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

### Model registration for custom providers — `kv` table

Custom provider nodes (Agnes AI, DS Light, DS Max) require model registration in
the `kv` table for the dashboard to show available models and for routing to work
deterministically. Without `kv` rows, the dashboard shows an empty model list even
when the node and connection are correctly configured.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS kv (
  scope TEXT NOT NULL,   -- 'customModels' for model registration
  key   TEXT NOT NULL,   -- '<nodeId>|<modelId>|llm'
  value TEXT NOT NULL,   -- JSON: {"providerAlias":"<nodeId>","id":"<modelId>","type":"llm","name":"<modelId>"}
  PRIMARY KEY (scope, key)
);
```

**Insert pattern (gateway stopped — see Platform section):**
```bash
/usr/bin/python3 - <<'PY'
import sqlite3, os, json, uuid
NODE_ID = os.environ["NODE_ID"]      # set by caller, never printed
MODELS  = os.environ["MODELS"].split(",")  # comma-separated model IDs
db = sqlite3.connect(os.path.expanduser("~/.9router/db/data.sqlite"))
for mid in MODELS:
    key = f"{NODE_ID}|{mid.strip()}|llm"
    value = json.dumps({"providerAlias": NODE_ID, "id": mid.strip(), "type": "llm", "name": mid.strip()},
                       separators=(",", ":"))
    db.execute("INSERT OR REPLACE INTO kv(scope,key,value) VALUES(?,?,?)",
               ("customModels", key, value))
db.commit()
print(f"registered {len(MODELS)} models under {NODE_ID}")
PY
```

**Verification:**
```bash
sqlite3 -header ~/.9router/db/data.sqlite \
  "SELECT key FROM kv WHERE scope='customModels' AND key LIKE '<NODE_ID>|%';"
```

**Required registers per provider:**
- Agnes AI: `agnes-2.5-flash`, `agnes-2.5-pro`, `agnes-2.5-pro-alpha`
- DS Light: `deepseek-v4-flash`
- DS Max: `deepseek-v4-pro`

**TRAP — compact JSON:** The value must use `separators=(",", ":")` — no spaces.
A space between `:` and the value (`{"key": "value"}`) still parses, but a
hand-written row is visually obvious in a diff against dashboard-written rows.

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
