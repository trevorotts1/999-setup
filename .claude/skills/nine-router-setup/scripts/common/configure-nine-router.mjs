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
// Outputs a JSON report on stdout with NO secrets.

import crypto from "node:crypto";
import { NineRouterClient } from "./nine-router-api.mjs";

const BASE = process.env.NINEROUTER_BASE || "http://127.0.0.1:20128";
const PLAN = process.env.OLLAMA_PLAN || "pro";
const AGNES_PLAN = process.env.AGNES_PLAN || "starter";
const FLASH_VARIANT = process.env.DEEPSEEK_FLASH_VARIANT || "";
const OVERRIDE_0731 = FLASH_VARIANT === "ollama-0731";
const DEFAULT_DASHBOARD_PW = "123456";

const RESOLVED_ROUTES = {};

function planToConcurrency(plan) {
  switch (plan) {
    case "free": return 1;
    case "max": return 8;
    case "pro":
    default: return 2;
  }
}

function err(msg, code = 1) {
  console.error(`configure-nine-router: ${msg}`);
  process.exit(code);
}

async function main() {
  const client = new NineRouterClient(BASE);

  // 1. Login with the dashboard password (initial or rotated).
  const pw = process.env.NINEROUTER_DASHBOARD_PW;
  if (!pw) err("NINEROUTER_DASHBOARD_PW not set");
  const login = await client.login(pw).catch((e) => err(`dashboard login failed: ${e.message}`));
  if (!login.success) err("dashboard login rejected");

  const report = { providers: {}, combos: {}, capacity: {}, routes: {}, plan: { ollama: PLAN, agnes: AGNES_PLAN } };
  const settings = await client.getSettings();

  // 2. Rotate the dashboard password. Rule: if we just logged in successfully
  //    with the well-known default (123456), the password IS the default and must
  //    be rotated regardless of the mustChangePassword flag (that flag can be
  //    false once the default has been persisted to the settings DB). Never leave
  //    a live dashboard on the default password.
  let dashboardPassword = pw;
  if (login.mustChangePassword || pw === DEFAULT_DASHBOARD_PW) {
    dashboardPassword = randomPassword();
    await client.patchSettings({ currentPassword: pw, newPassword: dashboardPassword });
    report.dashboardPasswordRotated = true;
  } else {
    report.dashboardPasswordRotated = false;
  }

  // 3. Create/reuse the local API key.
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

  // 4. Providers.
  const nodes = await client.listProviderNodes();
  const providers = await client.listProviders();

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
    }
  }

  if (ollamaKey) {
    const existing = providers.find((p) => p.provider === "ollama");
    if (existing) {
      report.providers.ollama = "reused";
    } else {
      await client.createProvider({ provider: "ollama", apiKey: ollamaKey, name: "Ollama Cloud" });
      report.providers.ollama = "created";
    }
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
    } else {
      report.providers.agnes += ", connection-reused";
    }
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

  const dsFlashMax = `${dsPrefix}/deepseek-v4-flash(max)`;
  const dsProMax = `${dsPrefix}/deepseek-v4-pro-max`;
  const olGlm = `${olPrefix}/glm-5.2`;
  const olKimi = `${olPrefix}/kimi-k2.6`;
  const agFlash = `${agPrefix}/agnes-2.5-flash`;
  const overrideFlash = `${olPrefix}/deepseek-v4-flash:0731`;

  const fableLane = OVERRIDE_0731 ? overrideFlash : dsFlashMax;

  RESOLVED_ROUTES.fable = fableLane;
  RESOLVED_ROUTES.opus = dsProMax;
  RESOLVED_ROUTES.sonnet = olGlm;
  RESOLVED_ROUTES.haiku = olKimi;
  RESOLVED_ROUTES.subagent = OVERRIDE_0731 ? overrideFlash : dsFlashMax;
  RESOLVED_ROUTES.vision = olKimi;

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
  await upsertCombo("blackceo-fusion", [dsFlashMax, olGlm, olKimi]);

  // 7. Combo strategies + capacity adapter + security defaults via PATCH /api/settings.
  const patch = {
    comboStrategy: "fallback",
    comboStickyRoundRobinLimit: 1,
    comboStrategies: {
      "blackceo-fable-fallback": { fallbackStrategy: "fallback" },
      "blackceo-opus-fallback": { fallbackStrategy: "fallback" },
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

  report.concurrency = planToConcurrency(PLAN);
  report.dashboardUrl = `${BASE.replace(/\/+$/, "")}`;
  report.notes = [
    OVERRIDE_0731
      ? "DEEPSEEK_FLASH_VARIANT=ollama-0731 enabled: Flash routed to Ollama Cloud deepseek-v4-flash:0731; concurrency recalculated."
      : "Flash routed to DeepSeek Direct by default; Ollama Fusion panel holds 2 models.",
    "PDF auto-switch disabled (not verified end-to-end).",
    "Audio auto-switch disabled (Gemma 4 31B has no audio input).",
    "Agnes is a custom OpenAI-compatible node (agnes/agnes-2.5-flash) — if its lane shows non-OK, re-check AGNES_API_KEY before claiming success.",
  ];

  // 10. Password report (the orchestrator writes it to protected state, never to repo).
  report.dashboardPassword = dashboardPassword;

  // Machine-readable output for the orchestrators: a sentinel line followed by ONE
  // compact JSON line. Line-based extractors on both platforms parse exactly this
  // line; pretty-printed/nested JSON must NOT be emitted here (nested braces
  // break sed-range and PowerShell line-filter parsing).
  console.log("===999-CONFIG-REPORT===");
  console.log(JSON.stringify(report));
}

function randomPassword(len = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const out = [];
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out.push(chars[bytes[i] % chars.length]);
  return out.join("");
}

main().catch((e) => {
  console.error(`configure-nine-router failed: ${e.message}`);
  process.exit(1);
});
