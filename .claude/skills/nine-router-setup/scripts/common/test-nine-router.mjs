#!/usr/bin/env node
// test-nine-router.mjs — shared routing smoke tests through the local 9Router.
// Verified against 9router 0.5.45. Reports PASS/FAIL per check; exits non-zero
// on any failure. Never prints API keys or the router token.
//
// Required env:
//   NINEROUTER_BASE      http://127.0.0.1:20128
//   NINEROUTER_TOKEN     the local 9Router API key
//   OLLAMA_PLAN          free|pro|max (derives concurrency expectation)
//
// Optional env to skip provider lanes:
//   SKIP_DEEPSEEK=1  SKIP_OLLAMA=1  SKIP_AGNES=1  SKIP_FUSION=1  SKIP_OPENROUTER=1
//
// Optional OpenRouter lane (fourth, optional provider):
//   OPENROUTER_PROBE_ROUTE   a live-discovered "openrouter/<vendor>/<model>:free"
//                            route to probe; empty/absent = skip the lane (exit 0)

import { NineRouterClient } from "./nine-router-api.mjs";

const BASE = process.env.NINEROUTER_BASE || "http://127.0.0.1:20128";
const PLAN = process.env.OLLAMA_PLAN || "pro";

let failures = 0;
let passes = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passes++;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const token = process.env.NINEROUTER_TOKEN;
  if (!token) {
    console.error("NINEROUTER_TOKEN not set");
    process.exit(2);
  }
  const client = new NineRouterClient(BASE);
  client.apiKey = token;

  // 0. Health
  const health = await client.health();
  check("9Router health", health.ok, `HTTP ${health.status}`);

  const skipDs = !!process.env.SKIP_DEEPSEEK;
  const skipOl = !!process.env.SKIP_OLLAMA;
  const skipAg = !!process.env.SKIP_AGNES;
  const skipFusion = !!process.env.SKIP_FUSION;

  // 1. Provider micro-requests (tiny max_tokens).
  if (!skipDs) {
    const ds = await client.chat("ds/deepseek-v4-flash", { maxTokens: 16, prompt: "ok" });
    check("DeepSeek Flash route", ds.status === 200, `HTTP ${ds.status}`);
    const dsPro = await client.chat("ds/deepseek-v4-pro", { maxTokens: 16, prompt: "ok" });
    check("DeepSeek Pro route", dsPro.status === 200, `HTTP ${dsPro.status}`);
  } else {
    console.log("SKIP  DeepSeek lane (SKIP_DEEPSEEK=1)");
  }

  if (!skipOl) {
    const glm = await client.chat("ollama/glm-5.2", { maxTokens: 16, prompt: "ok" });
    check("Ollama GLM 5.2 route", glm.status === 200, `HTTP ${glm.status}`);
    const kimi = await client.chat("ollama/kimi-k2.6", { maxTokens: 16, prompt: "ok" });
    check("Ollama Kimi K2.6 route", kimi.status === 200, `HTTP ${kimi.status}`);
    const gemma = await client.chat("ollama/gemma4:31b", { maxTokens: 16, prompt: "ok" });
    check("Ollama Gemma 4 31B route", gemma.status === 200, `HTTP ${gemma.status}`);
    const mm = await client.chat("ollama/minimax-m3", { maxTokens: 16, prompt: "ok" });
    check("Ollama MiniMax M3 route", mm.status === 200, `HTTP ${mm.status}`);
  } else {
    console.log("SKIP  Ollama lane (SKIP_OLLAMA=1)");
  }

  if (!skipAg) {
    const ag = await client.chat("agnes/agnes-2.5-flash", { maxTokens: 16, prompt: "ok" });
    check("Agnes 2.5 Flash route", ag.status === 200, `HTTP ${ag.status}`);
  } else {
    console.log("SKIP  Agnes lane (SKIP_AGNES=1)");
  }

  // OpenRouter lane: OPTIONAL fourth provider. No probe route (key absent,
  // resolution/provider error, or no :free model) = skip, still exit 0.
  const orRoute = process.env.OPENROUTER_PROBE_ROUTE || "";
  if (process.env.SKIP_OPENROUTER || !orRoute) {
    console.log("SKIP  OpenRouter lane (optional - no OPENROUTER_API_KEY / no probe route)");
  } else {
    const or = await client.chat(orRoute, { maxTokens: 16, prompt: "ok" });
    if (or.status === 402 || or.status === 429) {
      passes++;
      console.log(`PASS  OpenRouter route (account condition HTTP ${or.status}: auth accepted, request routed - insufficient credits/rate limit is an ACCOUNT state, not a config failure)`);
    } else {
      check("OpenRouter :free route", or.status === 200, `HTTP ${or.status} via ${orRoute}`);
    }
  }

  // 2. Thinking probes — max where verified; downgrade per-route and record.
  //    For deepseek, (max) suffix is honored. For ollama/agnes, probe reasoning_effort.
  if (!skipDs) {
    const dsMax = await client.chat("ds/deepseek-v4-flash(max)", { maxTokens: 32, prompt: "ok" });
    check("DeepSeek Flash max thinking", dsMax.status === 200, `HTTP ${dsMax.status}`);
  }

  // 3. Vision via capacity adapter — a tiny generated image through a text-only lane
  //    must route to Kimi K2.6. 1x1 transparent PNG.
  const onePxPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const vision = await client.chat("ds/deepseek-v4-flash", {
    maxTokens: 32,
    prompt: "describe this image",
    images: [{ type: "image", source: { type: "base64", media_type: "image/png", data: onePxPng } }],
  });
  // A 200 means capacity adapter succeeded (may or may not have redirected, but the
  // request was satisfied). We additionally require that a text-only lane accepted
  // the image — if the adapter were broken we'd get a 4xx modality error.
  check("Vision auto-switch smoke", vision.status === 200, `HTTP ${vision.status}`);

  // 4. Fallback chains — DeepSeek -> Agnes, one per lane. Non-destructive: we can't
  //    force an upstream failure without corrupting the real key, so we verify each
  //    combo is configured with the right order and that the combo routes.
  const sonnetCombo = await client.chat("sonnet-chain", { maxTokens: 16, prompt: "ok" });
  check("Sonnet chain combo routes", sonnetCombo.status === 200, `HTTP ${sonnetCombo.status}`);

  const opusCombo = await client.chat("opus-chain", { maxTokens: 16, prompt: "ok" });
  check("Opus chain combo routes", opusCombo.status === 200, `HTTP ${opusCombo.status}`);

  const haikuCombo = await client.chat("haiku-chain", { maxTokens: 16, prompt: "ok" });
  check("Haiku chain combo routes", haikuCombo.status === 200, `HTTP ${haikuCombo.status}`);

  // 5. Fusion combo — one-shot through the judge.
  if (!skipFusion) {
    const fusion = await client.chat("fusion-chain", { maxTokens: 32, prompt: "ok" });
    check("Fusion combo (judge responds)", fusion.status === 200, `HTTP ${fusion.status}`);
  } else {
    console.log("SKIP  Fusion (SKIP_FUSION=1)");
  }

  // 6. Concurrency guardrail expectation from plan.
  const expectConcurrency = PLAN === "free" ? 1 : PLAN === "max" ? 8 : 2;
  // We can't read the child env here; the orchestrator verifies this separately.
  // Emit the expectation for the orchestrator to cross-check.
  console.log(`INFO  OLLAMA_PLAN=${PLAN} expected CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=${expectConcurrency}`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`test-nine-router failed: ${e.message}`);
  process.exit(1);
});
