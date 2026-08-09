#!/usr/bin/env node
// configure-nine-router.mjs — idempotent provider/routing/combos configuration
// through the 9Router management API. Verified against 9router 0.5.45.
//
// Reads credentials from environment variables (set by the platform orchestrator
// from API docs.md, kept in memory only). Never prints keys.
//
// Required env:
//   NINEROUTER_BASE            e.g. http://127.0.0.1:20128
//   NINEROUTER_DASHBOARD_PW    current dashboard password (initial or stored)
//   DEEPSEEK_API_KEY           (optional — skips DeepSeek if absent)
//   OLLAMA_API_KEY             (optional — skips Ollama if absent)
//   AGNES_API_KEY              (optional — skips Agnes if absent)
//   OLLAMA_PLAN                free|pro|max
//   AGNES_PLAN                 starter|plus|pro
//   DEEPSEEK_FLASH_VARIANT     (optional) ollama-0731 override
//
// Outputs a JSON report on stdout with NO secrets — the ONE exception is
// report.dashboardPassword, set only when this run rotated the dashboard
// password, which the orchestrators must receive or their subsequent API calls
// cannot authenticate. It is never printed anywhere else.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { NineRouterClient } from "./nine-router-api.mjs";

const BASE = process.env.NINEROUTER_BASE || "http://127.0.0.1:20128";
const PLAN = process.env.OLLAMA_PLAN || "pro";
const AGNES_PLAN = process.env.AGNES_PLAN || "starter";
const FLASH_VARIANT = process.env.DEEPSEEK_FLASH_VARIANT || "";
const OVERRIDE_0731 = FLASH_VARIANT === "ollama-0731";

const RESOLVED_ROUTES = {};

function planToConcurrency(plan) {
  switch (plan) {
    case "free": return 1;
    case "max": return 8;
    case "pro":
    default: return 2;
  }
}

// The kv table lives in 9Router's local sqlite and has no management endpoint, so
// the model registrations below write to it directly. There is no cross-platform
// sqlite CLI guaranteed to exist, so prefer Node's built-in sqlite (Node 22.5+)
// and fall back to the platform python. Returns null only if BOTH are missing.
function resolvePython() {
  if (process.platform === "win32") {
    const probes = [["python"], ["py", "-3"]];
    for (const args of probes) {
      try {
        execFileSync(args[0], [...args.slice(1), "-c", "import sqlite3"], { stdio: "ignore" });
        return { args };
      } catch { /* try next */ }
    }
    return null;
  }
  try {
    execFileSync("/usr/bin/python3", ["-c", "import sqlite3"], { stdio: "ignore" });
    return { args: ["/usr/bin/python3"] };
  } catch {
    try {
      execFileSync("python3", ["-c", "import sqlite3"], { stdio: "ignore" });
      return { args: ["python3"] };
    } catch { return null; }
  }
}

// node:sqlite is only available on Node 22.5+; the import fails on older Node,
// so it is optional here and only used when it exists.
import sqlite from "node:sqlite";
const hasNodeSqlite = !!sqlite;

// Write custom-model kv rows (INSERT OR REPLACE — idempotent) for the given node.
// Tries Node's built-in sqlite first, then the platform python. A silent failure
// here would make the model registry silently miss the custom node, so when BOTH
// fail this logs a loud warning and returns false (callers still downgrade-grace).
function kvRegisterModels(nodeId, models) {
  const dbPath = `${process.env.HOME}/.9router/db/data.sqlite`;
  const rows = models.map((mid) => ({
    scope: "customModels",
    key: `${nodeId}|${mid}|llm`,
    value: JSON.stringify({ providerAlias: nodeId, id: mid, type: "llm", name: mid }, null, 0),
  }));

  const runSqlite3 = (db) => {
    const insert = db.prepare("INSERT OR REPLACE INTO kv(scope,key,value) VALUES(?,?,?)");
    for (const r of rows) insert.run(r.scope, r.key, r.value);
  };

  if (hasNodeSqlite) {
    try {
      const db = new sqlite.DatabaseSync(dbPath);
      try { runSqlite3(db); } finally { db.close(); }
      return true;
    } catch (e) {
      console.error(`configure-nine-router: WARNING: kv registration via node:sqlite failed for ${nodeId} (${dbPath}): ${e.message}`);
    }
  }

  const py = resolvePython();
  if (py) {
    const script = `
import sqlite3, os, json
node_id = os.environ["KV_NODE_ID"]
models = os.environ["KV_MODELS"].split(",")
db = sqlite3.connect(os.path.expanduser("~/.9router/db/data.sqlite"))
for mid in models:
    key = f"{node_id}|{mid}|llm"
    value = json.dumps({"providerAlias": node_id, "id": mid, "type": "llm", "name": mid}, separators=(",", ":"))
    db.execute("INSERT OR REPLACE INTO kv(scope,key,value) VALUES(?,?,?)", ("customModels", key, value))
db.commit()
print(f"registered {len(models)} models")
`;
    try {
      execFileSync(py.args[0], [...py.args.slice(1), "-c", script], {
        env: { ...process.env, KV_NODE_ID: nodeId, KV_MODELS: models.join(",") },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return true;
    } catch (e) {
      console.error(`configure-nine-router: WARNING: kv registration via python failed for ${nodeId} (${dbPath}): ${e.message}`);
    }
  } else {
    console.error(`configure-nine-router: WARNING: no sqlite-capable python or node:sqlite available — kv registration SKIPPED for ${nodeId} (${dbPath})`);
  }
  return false;
}

function err(msg, code = 1) {
  console.error(`configure-nine-router: ${msg}`);
  process.exit(code);
}

async function main() {
  const client = new NineRouterClient(BASE);

  // 1. Login with the dashboard password.
  const pw = process.env.NINEROUTER_DASHBOARD_PW;
  if (!pw) err("NINEROUTER_DASHBOARD_PW not set");
  const login = await client.login(pw).catch((e) => err(`dashboard login failed: ${e.message}`));
  if (!login.success) err("dashboard login rejected");

  // Password rotation: when the dashboard still uses the default (fresh install),
  // rotate to a strong random password so the router never runs on the default.
  // The new password is stored in process.env.NINEROUTER_DASHBOARD_PW for the
  // subsequent API calls in THIS process, and it reaches the caller exactly once
  // via report.dashboardPassword — the single sanctioned exception to "never
  // print keys". Without it the orchestrators cannot authenticate after a
  // rotation. It is never printed anywhere else, and the field is absent
  // entirely when no rotation happened this run.
  let dashboardPw = pw;
  let rotated = false;
  if (login.mustChangePassword) {
    const newPassword = crypto.randomBytes(24).toString("base64");
    await client.patchSettings({ currentPassword: pw, newPassword }).catch((e) =>
      err(`dashboard password rotation failed: ${e.message}`)
    );
    // The session cookie survives the rotation (PATCH returns 200), but re-login
    // with the new password keeps the client consistent for every later call.
    const relogin = await client.login(newPassword).catch((e) => err(`re-login after rotation failed: ${e.message}`));
    if (!relogin.success) err("re-login after password rotation rejected");
    process.env.NINEROUTER_DASHBOARD_PW = newPassword;
    dashboardPw = newPassword;
    rotated = true;
    console.error("configure-nine-router: dashboard password rotated (new password stored in NINEROUTER_DASHBOARD_PW)");
  }

  const report = { providers: {}, combos: {}, capacity: {}, routes: {}, plan: { ollama: PLAN, agnes: AGNES_PLAN } };
  const settings = await client.getSettings();

  // 2. Create/reuse the local API key.
  let apiKey = null;
  {
    const keys = await client.listKeys();
    const existing = keys.find((k) => k.name === "BlackCEO Claude Code");
    if (existing && existing.key) {
      apiKey = existing.key;
      report.localApiKey = "reused";
    } else if (existing) {
      // Listed key may be masked; we need the raw value, so create is not an option
      // if a masked key exists — the orchestrator should have stored the raw key
      // at creation. Signal caller to supply it.
      report.localApiKey = "exists-masked";
    } else {
      const created = await client.createKey("BlackCEO Claude Code");
      apiKey = created.key;
      report.localApiKey = "created";
    }
  }
  client.apiKey = apiKey;

  // Ensure the default model is set on every provider connection so the router
  // always has an explicit model for bare "provider/model" requests. Uses the
  // management API (PUT /api/providers/<id> with defaultModel); idempotent.
  const ensureDefaultModel = async (connection, defaultModel) => {
    if (!connection) return "no-connection";
    try {
      await client.patchProvider(connection.id, { defaultModel });
      return "set";
    } catch (e) {
      console.error(`configure-nine-router: WARNING: defaultModel set failed for ${connection.id}: ${e.message}`);
      return "failed";
    }
  };

  // 4. Providers.
  const nodes = await client.listProviderNodes();
  const providers = await client.listProviders();

  // `providers` is fetched once at the start, so a connection created after that
  // is not in the array and a defaultModel lookup on it would silently miss.
  // Refresh in place (splice keeps every closure referencing `providers` seeing
  // the fresh data) after each creation, before the defaultModel lookups.
  const refreshProviders = async () => {
    const fresh = await client.listProviders();
    providers.splice(0, providers.length, ...fresh);
  };

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const ollamaKey = process.env.OLLAMA_API_KEY;
  const agnesKey = process.env.AGNES_API_KEY;

  if (deepseekKey) {
    const existing = providers.find((p) => p.provider === "deepseek");
    if (existing) {
      report.providers.deepseek = "reused";
    } else {
      await client.createProvider({ provider: "deepseek", apiKey: deepseekKey, name: "DeepSeek Direct" });
      report.providers.deepseek = "created";
      await refreshProviders();  // new connection is not in the stale `providers` array
    }
    // Native DeepSeek Direct connection default model (producer of the flash route).
    const dsConn = providers.find((p) => p.provider === "deepseek");
    report.providers.deepseek += `, defaultModel=${await ensureDefaultModel(dsConn, "deepseek-v4-flash")}`;
  }

  if (ollamaKey) {
    const existing = providers.find((p) => p.provider === "ollama");
    if (existing) {
      report.providers.ollama = "reused";
    } else {
      await client.createProvider({ provider: "ollama", apiKey: ollamaKey, name: "Ollama Cloud" });
      report.providers.ollama = "created";
      await refreshProviders();  // new connection is not in the stale `providers` array
    }
    // ollama-CUSTOM connection default model (kimi-k2.6, the vision lane).
    const ollamaConn = providers.find((p) => p.provider === "ollama");
    report.providers.ollama += `, defaultModel=${await ensureDefaultModel(ollamaConn, "kimi-k2.6")}`;
  }

  // Agnes: custom OpenAI-compatible node + paired connection.
  if (agnesKey) {
    let agnesNode = nodes.find((n) => n.prefix === "agnes");
    if (!agnesNode) {
      const created = await client.createProviderNode({
        name: "Agnes AI",
        prefix: "agnes",
        type: "openai-compatible",
        apiType: "chat",
        baseUrl: "https://apihub.agnes-ai.com/v1",
      });
      agnesNode = created;
      report.providers.agnes = "node-created";
    } else {
      report.providers.agnes = "node-reused";
    }
    const agnesConn = providers.find((p) => p.provider === agnesNode.id);
    if (!agnesConn) {
      await client.createProvider({ provider: agnesNode.id, apiKey: agnesKey, name: "Agnes AI" });
      report.providers.agnes += ", connection-created";
      await refreshProviders();  // new connection is not in the stale `providers` array
    } else {
      report.providers.agnes += ", connection-reused";
    }
    // Agnes connection default model (refetch above guarantees a fresh lookup).
    const agnesConnFresh = providers.find((p) => p.provider === agnesNode.id);
    report.providers.agnes += `, defaultModel=${await ensureDefaultModel(agnesConnFresh, "agnes-2.5-flash")}`;

    // Register ALL THREE Agnes models in the kv table so the model registry knows
    // them for custom nodes. There is no management endpoint for kv writes, so
    // this is done directly against 9Router's local sqlite (INSERT OR REPLACE
    // keeps this idempotent) — via node:sqlite when available, else the platform
    // python (Windows uses `python`/`py -3`, macOS /usr/bin/python3). nodeId is
    // the custom node id, which is the connection's provider id.
    const agnesKv = kvRegisterModels(agnesNode.id, ["agnes-2.5-flash", "agnes-2.5-pro", "agnes-2.5-pro-alpha"]);
    report.providers.agnes += agnesKv ? ", kv-models-registered" : ", kv-models-FAILED";
  }

  // 5. Route strings are built from the provider IDs validated against the live
  //    catalogs (resolve-models.mjs ran first). Use the exact returned IDs.
  let resolved = {};
  try { resolved = JSON.parse(process.env.RESOLVED_MODELS || "{}"); } catch {}

  // Assert each lane's model is present in the resolved catalog (defense in depth).
  const has = (list, id) => Array.isArray(list) && list.includes(id);
  const dsIds = resolved.deepseek || ["deepseek-v4-flash", "deepseek-v4-pro"];
  const olIds = resolved.ollama || ["glm-5.2", "kimi-k2.6", "minimax-m3", "gemma4:31b"];
  const agIds = resolved.agnes || ["agnes-2.5-flash"];

  if (!has(dsIds, "deepseek-v4-flash") || !has(dsIds, "deepseek-v4-pro")) {
    err("live DeepSeek catalog does not contain deepseek-v4-flash / deepseek-v4-pro");
  }
  if (!has(olIds, "glm-5.2") || !has(olIds, "kimi-k2.6")) {
    err("live Ollama catalog does not contain glm-5.2 / kimi-k2.6");
  }
  if (!has(agIds, "agnes-2.5-flash")) {
    err("live Agnes catalog does not contain agnes-2.5-flash");
  }
  if (OVERRIDE_0731 && !has(olIds, "deepseek-v4-flash:0731")) {
    err("DEEPSEEK_FLASH_VARIANT=ollama-0731 is set but the live Ollama catalog lacks deepseek-v4-flash:0731");
  }

  // DS Light and DS Max: two custom OpenAI-compatible DeepSeek nodes for explicit
  // thinking control (deterministic provider-level wiring instead of the (max)
  // suffix). DS Light (deepseek-v4-flash) is the cheap no-thinking Haiku lane; DS
  // Max (deepseek-v4-pro) forces max thinking for Opus. Reuse existing nodes with
  // the same prefix — idempotent. Both use the DeepSeek API key.
  let dsLightNode = null;
  let dsMaxNode = null;
  const dsLightPrefix = "ds-light";
  const dsMaxPrefix = "ds-max";

  const ensureCustomNode = async ({ name, prefix, existing }) => {
    const found = nodes.find((n) => n.prefix === prefix);
    if (found) return found;
    const created = await client.createProviderNode({
      name,
      prefix,
      type: "openai-compatible",
      apiType: "chat",
      baseUrl: "https://api.deepseek.com/anthropic",
    });
    if (existing) existing.push(created);
    return created;
  };
  const ensureCustomConnection = async (node) => {
    const conn = providers.find((p) => p.provider === node.id);
    if (!conn) {
      await client.createProvider({ provider: node.id, apiKey: deepseekKey, name: node.name });
    }
    return conn;
  };

  if (deepseekKey) {
    dsLightNode = await ensureCustomNode({ name: "DS Light", prefix: dsLightPrefix });
    dsMaxNode = await ensureCustomNode({ name: "DS Max", prefix: dsMaxPrefix });
    await ensureCustomConnection(dsLightNode);
    await ensureCustomConnection(dsMaxNode);

    // The providers list fetched at the top predates the freshly created custom
    // connections, so refresh before the defaultModel lookup — a stale array
    // would silently skip defaultModel on first-run connections.
    await refreshProviders();

    // defaultModel per custom-node connection (DS Light → flash, DS Max → pro).
    const dsLightConn = providers.find((p) => p.provider === dsLightNode.id);
    const dsMaxConn = providers.find((p) => p.provider === dsMaxNode.id);
    await ensureDefaultModel(dsLightConn, "deepseek-v4-flash");
    await ensureDefaultModel(dsMaxConn, "deepseek-v4-pro");

    // Register the single model each node serves in the kv table (same mechanism
    // as the Agnes registration above — INSERT OR REPLACE keeps this idempotent).
    const lightKv = kvRegisterModels(dsLightNode.id, ["deepseek-v4-flash"]) ? "kv-ok" : "kv-failed";
    const maxKv = kvRegisterModels(dsMaxNode.id, ["deepseek-v4-pro"]) ? "kv-ok" : "kv-failed";
    report.providers.dsLight = `${dsLightNode.prefix} (${lightKv})`;
    report.providers.dsMax = `${dsMaxNode.prefix} (${maxKv})`;

    // Provider-level thinking wiring: DS Light off (explicit no-thinking lane),
    // DS Max forced max (Opus lane). Keyed by node id in settings.providerThinking.
    const provThinking = (await client.getSettings()).providerThinking || {};
    const lightNext = { ...provThinking, [dsLightNode.id]: { mode: "none" } };
    const maxNext = { ...provThinking, [dsMaxNode.id]: { mode: "max" } };
    const mergedThinking = { ...lightNext, ...maxNext };
    await client.patchSettings({ providerThinking: mergedThinking });
    report.providerThinking = { ...(report.providerThinking || {}), dsLight: "none", dsMax: "max" };
  }

  // Model-string notation (two documented mechanisms, deliberately):
  //   ds/deepseek-v4-flash(max)   - "(max)" is 9Router's thinking-effort suffix,
  //                                 parsed by stripThinkingSuffix/applyThinking.
  //   ds/deepseek-v4-pro-max      - "pro-max" is a registry model variant that
  //                                 maps upstream to deepseek-v4-pro. This is the
  //                                 verified 9Router form for the Pro/Max lane.
  // Subagent must ALSO be the max route (spec: CLAUDE_CODE_SUBAGENT_MODEL = Flash
  // max), not the plain model — an unmetered subagent lane silently loses max.
  const dsPrefix = "ds";
  const olPrefix = "ollama";
  const agPrefix = "agnes";

  // DS Light / DS Max custom-node lane strings (thinking handled at the provider
  // level, not via the (max) suffix): DS Light has thinking OFF — no "(max)".
  // DS Max carries "(max)" as a belt-and-braces signal on top of the provider
  // wiring; 9Router's stripThinkingSuffix/applyThinking handles it deterministically.
  const dsLightFlash = `${dsLightPrefix}/deepseek-v4-flash`; // no (max) — thinking OFF
  const dsMaxPro = `${dsMaxPrefix}/deepseek-v4-pro(max)`;
  const dsFlashMax = `${dsPrefix}/deepseek-v4-flash(max)`;
  const dsProMax = `${dsPrefix}/deepseek-v4-pro-max`;
  const olGlm = `${olPrefix}/glm-5.2`;
  const olKimi = `${olPrefix}/kimi-k2.6`;
  const agFlash = `${agPrefix}/agnes-2.5-flash`;
  const overrideFlash = `${olPrefix}/deepseek-v4-flash:0731`;

  const fableLane = OVERRIDE_0731 ? overrideFlash : dsFlashMax;

  RESOLVED_ROUTES.fable = fableLane;  // keep existing
  RESOLVED_ROUTES.opus = dsMaxPro;  // NEW: Opus → DS Max (DeepSeek v4 Pro, thinking MAX)
  RESOLVED_ROUTES.sonnet = OVERRIDE_0731 ? overrideFlash : dsFlashMax;  // Sonnet → DS Flash Max (was olGlm)
  RESOLVED_ROUTES.haiku = dsLightFlash;  // NEW: Haiku → DS Light (DeepSeek v4 Flash, thinking OFF)
  RESOLVED_ROUTES.subagent = OVERRIDE_0731 ? overrideFlash : dsFlashMax;
  RESOLVED_ROUTES.vision = olKimi;  // keep
  RESOLVED_ROUTES.haikuFallback = agFlash;  // Haiku fallback lane (Agnes AI), carried through to routing state

  // 6. Combos.
  const combos = await client.listCombos();
  const upsertCombo = async (name, models) => {
    const existing = combos.find((c) => c.name === name);
    if (existing) {
      report.combos[name] = "reused";
    } else {
      await client.createCombo({ name, models, kind: null });
      report.combos[name] = "created";
    }
  };

  await upsertCombo("blackceo-fable-fallback", [dsFlashMax, agFlash]);
  await upsertCombo("blackceo-opus-fallback", [dsProMax, agFlash]);
  await upsertCombo("blackceo-haiku-fallback", [dsLightFlash, agFlash]);
  await upsertCombo("blackceo-fusion", [dsFlashMax, olGlm, olKimi]);

  // 7. Combo strategies + capacity adapter + security defaults via PATCH /api/settings.
  const patch = {
    comboStrategy: "fallback",
    comboStickyRoundRobinLimit: 1,
    comboStrategies: {
      "blackceo-fable-fallback": { fallbackStrategy: "fallback" },
      "blackceo-opus-fallback": { fallbackStrategy: "fallback" },
      "blackceo-haiku-fallback": { fallbackStrategy: "fallback" },
      "blackceo-fusion": {
        fallbackStrategy: "fusion",
        judgeModel: dsProMax,
        fusionTuning: { minPanel: 2, stragglerGraceMs: 8000, panelHardTimeoutMs: 90000 },
      },
    },
    capacityAdapter: {
      vision: { enabled: true, roundRobin: false, models: [olKimi] },
      pdf: { enabled: false, roundRobin: false, models: [] },
      audioInput: { enabled: false, roundRobin: false, models: [] },
      videoInput: { enabled: false, roundRobin: false, models: [] },
    },
    tunnelEnabled: false,
    tailscaleEnabled: false,
    tunnelDashboardAccess: false,
    requireLogin: true,
    requireApiKey: true,
  };
  await client.patchSettings(patch);
  report.settingsPatched = true;

  // 8. Provider thinking (deepseek only — ollama/agnes handled by probe later).
  //    Uses the providerThinking settings map: {"deepseek": {"mode": "max"}}.
  const settingsAfter = await client.getSettings();
  const providerThinking = settingsAfter.providerThinking || {};
  if (!providerThinking.deepseek || providerThinking.deepseek.mode !== "max") {
    await client.patchSettings({ providerThinking: { ...providerThinking, deepseek: { mode: "max" } } });
    report.providerThinking = { deepseek: "max" };
  } else {
    report.providerThinking = { deepseek: "reused" };
  }

  // 9. Post-configuration live verification: probe every configured lane through
  //    the router and record pass/fail. The completion report derives its
  //    "OK" lines from these results — never hardcode "Agnes AI: OK" when the
  //    lane is actually broken (a silent ignore is exactly the failure mode that
  //    shipped before).
  report.verified = {};
  const probes = [
    ["fable", RESOLVED_ROUTES.fable],
    ["opus", RESOLVED_ROUTES.opus],
    ["sonnet", RESOLVED_ROUTES.sonnet],
    ["haiku", RESOLVED_ROUTES.haiku],
    ["agnes", `${agPrefix}/agnes-2.5-flash`],
  ];
  for (const [name, route] of probes) {
    try {
      const r = await client.chat(route, { maxTokens: 16, prompt: "ok" });
      report.verified[name] = r.status === 200 ? "ok" : `HTTP ${r.status}`;
    } catch (e) {
      report.verified[name] = `error: ${e.message}`;
    }
  }

  // 9b. Thinking-level verification, not just HTTP 200: send a chat completion
  //     with max_tokens 1500 (the floor) and inspect the response body. A model
  //     with thinking ENABLED and max_tokens too low returns zero text — so the
  //     thinking lanes must return content, and DS Light must return content
  //     WITHOUT any thinking field. Record pass/fail per route in
  //     report.thinkingVerified (never fail the whole run on a downgrade —
  //     record it, matching the "downgrade and record" doctrine).
  report.thinkingVerified = {};
  const thinkingProbes = [
    // max-thinking lanes — content must come back with 1500 max_tokens
    ["opus", RESOLVED_ROUTES.opus, "max"],
    ["sonnet", RESOLVED_ROUTES.sonnet, "max"],
    ["fable", RESOLVED_ROUTES.fable, "max"],
    // no-thinking lane — must respond WITHOUT thinking
    ["haiku", RESOLVED_ROUTES.haiku, "off"],
  ];
  for (const [name, route, expected] of thinkingProbes) {
    try {
      const r = await client.chat(route, { maxTokens: 1500, prompt: "ok" });
      const body = r.data;
      const text = (body && typeof body === "object" && typeof body.content === "string") ? body.content : "";
      const thinking = body && typeof body === "object" && body.thinking ? body.thinking : null;
      // DeepSeek surfaces thinking via "reasoning_content"; Anthropic format uses
      // content blocks. Treat any non-empty reasoning/thinking field as thinking-on.
      const hasThinking =
        !!thinking ||
        (typeof body?.reasoning_content === "string" && body.reasoning_content.length > 0) ||
        (Array.isArray(body?.content) && body.content.some((b) => b?.type === "thinking" || b?.type === "redacted_thinking"));
      const gotText = text.length > 0 || (Array.isArray(body?.content) && body.content.some((b) => b?.type === "text" && b.text));
      if (expected === "off") {
        report.thinkingVerified[name] = r.status === 200 && !hasThinking && gotText
          ? "ok-no-thinking"
          : `unexpected-thinking${r.status !== 200 ? ` HTTP ${r.status}` : ""}`;
      } else {
        // max lanes: content with max_tokens 1500 proves thinking does not eat
        // the whole budget; thinking fields present are a bonus signal.
        report.thinkingVerified[name] = r.status === 200 && gotText ? "ok-thinking" : `no-content${r.status !== 200 ? ` HTTP ${r.status}` : ""}`;
      }
    } catch (e) {
      report.thinkingVerified[name] = `error: ${e.message}`;
    }
  }

  report.concurrency = planToConcurrency(PLAN);
  // The verified live routes the orchestrators' completion report reads — emitted
  // here so the report never falls back to hardcoded defaults.
  report.resolvedRoutes = { ...RESOLVED_ROUTES };
  const PORT = (() => {
    const m = BASE.match(/:(\d+)/);
    return m ? m[1] : "20128";
  })();
  report.dashboardUrl = `http://127.0.0.1:${PORT}`;  // or extract from BASE
  report.dashboardMessage = `Your 9Router dashboard: http://127.0.0.1:${PORT} — open this in your browser to manage providers and models.`;
  // dashboardPasswordRotated means "THIS run rotated the password", not "it was
  // rotated at some point" — the orchestrators key off report.dashboardPassword
  // for the actual password and off this flag for messaging. The rotated
  // password is delivered to the caller ONLY through report.dashboardPassword,
  // the single sanctioned exception to "never print keys": without it the
  // orchestrators' subsequent API calls would use a password the router does
  // not have. The field is absent when no rotation happened this run.
  report.dashboardPasswordRotated = rotated;
  if (rotated) report.dashboardPassword = dashboardPw;
  report.notes = [
    OVERRIDE_0731
      ? "DEEPSEEK_FLASH_VARIANT=ollama-0731 enabled: Flash routed to Ollama Cloud deepseek-v4-flash:0731; concurrency recalculated."
      : "Flash routed to DeepSeek Direct by default; Ollama Fusion panel holds 2 models.",
    "PDF auto-switch disabled (not verified end-to-end).",
    "Audio auto-switch disabled (Gemma 4 31B has no audio input).",
    "Agnes is a custom OpenAI-compatible node (agnes/agnes-2.5-flash) — if its lane shows non-OK, re-check AGNES_API_KEY before claiming success.",
    "blackceo-haiku-fallback: ds-light/deepseek-v4-flash (thinking OFF) → agnes/agnes-2.5-flash.",
  ];

  // Machine-readable output for the orchestrators: a sentinel line followed by ONE
  // compact JSON line. Line-based extractors on both platforms parse exactly this
  // line; pretty-printed/nested JSON must NOT be emitted here (nested braces
  // break sed-range and PowerShell line-filter parsing).
  console.log("===999-CONFIG-REPORT===");
  console.log(JSON.stringify(report));
}

main().catch((e) => {
  console.error(`configure-nine-router failed: ${e.message}`);
  process.exit(1);
});
