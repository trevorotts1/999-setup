#!/usr/bin/env node
// resolve-models.mjs — live model resolution for DeepSeek Direct, Ollama Cloud,
// and Agnes AI. Queries the provider catalogs and validates that the required model
// IDs exist. Never prints API keys.

const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";
const OLLAMA_TAGS_URL = "https://ollama.com/api/tags";
const AGNES_BASE = "https://apihub.agnes-ai.com/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const REQUIRED_DEEPSEEK = ["deepseek-v4-flash", "deepseek-v4-pro"];
export const REQUIRED_OLLAMA = ["glm-5.2", "kimi-k2.6", "minimax-m3", "gemma4:31b"];
export const OLLAMA_0731 = "deepseek-v4-flash:0731";
export const REQUIRED_AGNES = ["agnes-2.5-flash"];

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Resolve DeepSeek models from the live catalog.
 * @param {string} apiKey
 * @returns {Promise<string[]>} model IDs
 */
export async function resolveDeepSeek(apiKey) {
  const data = await fetchJson(DEEPSEEK_MODELS_URL, {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
  const ids = (data?.data || []).map((m) => m.id).filter(Boolean);
  const missing = REQUIRED_DEEPSEEK.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `DeepSeek live catalog missing required model IDs: ${missing.join(", ")}. ` +
      `Do not substitute an older DeepSeek model.`
    );
  }
  return ids;
}

/**
 * Resolve Ollama Cloud models from the live /api/tags catalog.
 * @param {string} apiKey
 * @param {{include0731?:boolean}} opts
 * @returns {Promise<string[]>} model IDs
 */
export async function resolveOllama(apiKey, opts = {}) {
  const data = await fetchJson(OLLAMA_TAGS_URL, {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
  const ids = (data?.models || []).map((m) => m.model || m.name).filter(Boolean);
  const want = [...REQUIRED_OLLAMA];
  if (opts.include0731) want.push(OLLAMA_0731);
  const missing = want.filter((id) => !ids.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `Ollama Cloud live catalog missing required model IDs: ${missing.join(", ")}. ` +
      `Use the exact IDs returned by the live endpoint.`
    );
  }
  return ids;
}

/**
 * Resolve Agnes models. Prefer the /models endpoint; fall back to a tiny probe
 * when /models is not available. Never substitutes a model id.
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
export async function resolveAgnes(apiKey) {
  try {
    const data = await fetchJson(`${AGNES_BASE}/models`, {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    });
    const ids = (data?.data || data?.models || []).map((m) => m.id || m.model).filter(Boolean);
    if (ids.length > 0) return ids;
    // fall through to probe
  } catch {
    // fall through to probe
  }
  // Tiny chat-completions probe against agnes-2.5-flash.
  const res = await fetch(`${AGNES_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "agnes-2.5-flash",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Agnes credential rejected (HTTP " + res.status + ")");
  }
  if (res.ok) return ["agnes-2.5-flash"];
  // A 4xx model-not-found proves the key works but the model id is wrong — fail
  // with a precise error rather than substituting another model.
  throw new Error(`Agnes probe failed (HTTP ${res.status}); cannot validate agnes-2.5-flash`);
}

/**
 * Resolve OpenRouter (OPTIONAL provider). Validates the key via /auth/key,
 * then live-discovers the catalog and its :free models. Never hardcodes IDs.
 * @returns {Promise<{free:string[], total:number}>}
 */
export async function resolveOpenRouter(apiKey) {
  const auth = await fetch(`${OPENROUTER_BASE}/auth/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (auth.status === 401 || auth.status === 403) throw new Error(`OpenRouter credential rejected (HTTP ${auth.status})`);
  const data = await fetchJson(`${OPENROUTER_BASE}/models`, { Authorization: `Bearer ${apiKey}` });
  const ids = (data?.data || []).map((m) => m.id).filter(Boolean);
  const free = ids.filter((id) => id.endsWith(":free"));
  if (free.length === 0) throw new Error("live OpenRouter catalog returned no :free models");
  return { free, total: ids.length };
}

/**
 * Resolve all three catalogs. Returns a single report object. Never prints keys.
 */
export async function resolveAll(credentials) {
  const report = {};
  if (credentials.deepseek) {
    report.deepseek = await resolveDeepSeek(credentials.deepseek);
  }
  if (credentials.ollama) {
    report.ollama = await resolveOllama(credentials.ollama, {
      include0731: credentials.flashVariant === "ollama-0731",
    });
  }
  if (credentials.agnes) {
    report.agnes = await resolveAgnes(credentials.agnes);
  }
  if (credentials.openrouter) {
    report.openrouter = await resolveOpenRouter(credentials.openrouter);
  }
  return report;
}

// CLI entry point for manual verification: node resolve-models.mjs --deepseek|--ollama|--agnes|--all
// Intentionally avoids printing keys — caller passes via env, not argv.
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  const run = async () => {
    if (arg === "--deepseek" && process.env.DEEPSEEK_API_KEY) {
      const ids = await resolveDeepSeek(process.env.DEEPSEEK_API_KEY);
      console.log(`DeepSeek OK (${ids.length} models)`);
    } else if (arg === "--ollama" && process.env.OLLAMA_API_KEY) {
      const ids = await resolveOllama(process.env.OLLAMA_API_KEY, {
        include0731: process.env.DEEPSEEK_FLASH_VARIANT === "ollama-0731",
      });
      console.log(`Ollama OK (${ids.length} models)`);
    } else if (arg === "--agnes" && process.env.AGNES_API_KEY) {
      const ids = await resolveAgnes(process.env.AGNES_API_KEY);
      console.log(`Agnes OK (${ids.length} models)`);
    } else if (arg === "--openrouter" && process.env.OPENROUTER_API_KEY) {
      const r = await resolveOpenRouter(process.env.OPENROUTER_API_KEY);
      console.log(`OpenRouter OK (${r.free.length} free of ${r.total} models)`);
    } else if (arg === "--all") {
      const out = {};
      const errors = [];
      if (process.env.DEEPSEEK_API_KEY) {
        try { out.deepseek = await resolveDeepSeek(process.env.DEEPSEEK_API_KEY); }
        catch (e) { errors.push(`deepseek: ${e.message}`); }
      }
      if (process.env.OLLAMA_API_KEY) {
        try { out.ollama = await resolveOllama(process.env.OLLAMA_API_KEY, {
          include0731: process.env.DEEPSEEK_FLASH_VARIANT === "ollama-0731",
        }); }
        catch (e) { errors.push(`ollama: ${e.message}`); }
      }
      if (process.env.AGNES_API_KEY) {
        try { out.agnes = await resolveAgnes(process.env.AGNES_API_KEY); }
        catch (e) { errors.push(`agnes: ${e.message}`); }
      }
      if (process.env.OPENROUTER_API_KEY) {
        try { out.openrouter = await resolveOpenRouter(process.env.OPENROUTER_API_KEY); }
        catch (e) { errors.push(`openrouter: ${e.message}`); }
      }
      if (errors.length) {
        // Partial resolution is acceptable when a lane is optional; report which
        // lanes failed so the caller can skip them.
        out.errors = errors;
      }
      process.stdout.write(JSON.stringify(out));
    } else {
      console.error("usage: DEEPSEEK_API_KEY=... node resolve-models.mjs --deepseek|--ollama|--agnes|--openrouter|--all");
      process.exit(2);
    }
  };
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
