// NIN001: configure-nine-router.mjs against an in-process fake 9Router.
// Covers: OpenRouter-DeepSeek route with no DeepSeek/Agnes keys, existing combos
// kept, --update-combos, CLI-token auth, default (direct) regression, no key leaks.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/common/configure-nine-router.mjs");
const ORD = "openrouter/deepseek/deepseek-v4.1-flash";
const SECRET = "sk-SECRETVALUE-nin001";
const TOKEN = "clitoken-nin001";

function fakeRouter(seed = {}) {
  const st = { combos: seed.combos || [], providers: [], nodes: [], keys: [], settings: { comboStrategies: seed.strategies || {} }, log: [], n: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = body ? JSON.parse(body) : {};
      const u = req.url.split("?")[0];
      st.log.push(`${req.method} ${u}`);
      const send = (o, h = {}) => { res.writeHead(200, { "content-type": "application/json", ...h }); res.end(JSON.stringify(o)); };
      if (u === "/api/auth/login") return send({ success: true }, { "set-cookie": "auth_token=x; Path=/" });
      if (seed.requireToken && req.headers["x-9r-cli-token"] !== TOKEN && !req.headers.cookie) { res.writeHead(401); return res.end("{}"); }
      if (u === "/api/settings") { if (req.method === "PATCH") Object.assign(st.settings, j); return send(st.settings); }
      if (u === "/api/keys") { if (req.method === "POST") { const k = { id: "k1", name: j.name, key: "localkey" }; st.keys.push(k); return send(k); } return send({ keys: st.keys }); }
      if (u === "/api/provider-nodes") { if (req.method === "POST") { const n = { id: `node${++st.n}`, ...j }; st.nodes.push(n); return send({ node: n }); } return send({ nodes: st.nodes }); }
      if (u === "/api/providers") { if (req.method === "POST") { const c = { id: `c${++st.n}`, ...j }; st.providers.push(c); return send({ connection: c }); } return send({ connections: st.providers }); }
      if (u.startsWith("/api/providers/")) return send({ connection: {} });
      if (u === "/api/combos") { if (req.method === "POST") { st.combos.push({ id: `cb${++st.n}`, ...j }); return send({}); } return send({ combos: st.combos }); }
      if (u.startsWith("/api/combos/")) { const c = st.combos.find((x) => x.id === decodeURIComponent(u.split("/").pop())); Object.assign(c, j); return send({}); }
      if (u === "/v1/messages") return send({ content: "ok" });
      res.writeHead(404); res.end("{}");
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, st, base: `http://127.0.0.1:${server.address().port}` })));
}

function run(base, env, args = []) {
  return new Promise((resolve) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nin001-"));
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, HOME: home, NINEROUTER_BASE: base, ...env },
    });
    let out = "", err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (code) => {
      const line = out.split("\n").find((l, i, a) => a[i - 1] === "===999-CONFIG-REPORT===");
      resolve({ code, out, err, report: line ? JSON.parse(line) : null });
    });
  });
}

const OR_ENV = {
  NINEROUTER_DASHBOARD_PW: "pw",
  OPENROUTER_API_KEY: SECRET,
  NINE_DEEPSEEK_ROUTE: "openrouter",
  RESOLVED_MODELS: JSON.stringify({ openrouter: { free: ["a:free"], total: 2, ids: ["deepseek/deepseek-v4.1-flash", "a:free"] } }),
};
const names = (st) => Object.fromEntries(st.combos.map((c) => [c.name, c.models]));
let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}: ${e.message}`); }
}

await t("openrouter route, no DeepSeek/Agnes keys: OpenRouter-DeepSeek combos, no Agnes, no dead provider", async () => {
  const { server, st, base } = await fakeRouter();
  const r = await run(base, OR_ENV);
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  const c = names(st);
  assert.deepEqual(c["sonnet-chain"], [ORD]);
  assert.deepEqual(c["opus-chain"], [ORD]);
  assert.deepEqual(c["haiku-chain"], [ORD]);
  assert.deepEqual(c["fusion-chain"], [ORD, "openrouter-nvidia-free/nvidia/nemotron-3-ultra-550b-a55b:free"]);
  assert.ok(!JSON.stringify(c).includes("agnes"), "agnes member present");
  assert.ok(!st.providers.some((p) => p.provider === "deepseek" || /agnes/.test(p.name || "")), "dead provider created");
  assert.ok(!st.nodes.some((n) => ["agnes", "ds-light", "ds-max"].includes(n.prefix)), "dead node created");
  assert.equal(r.report.resolvedRoutes.subagent, ORD);
  assert.equal(r.report.verified.agnes.startsWith("skipped"), true);
  assert.ok(!(r.out + r.err).includes(SECRET), "key printed");
  assert.deepEqual(r.report.combosCreated.sort(), ["fusion-chain", "haiku-chain", "opus-chain", "sonnet-chain"]);
});

await t("openrouter route fails precisely when the exact model is not in the live catalog", async () => {
  const { server, base } = await fakeRouter();
  const r = await run(base, { ...OR_ENV, RESOLVED_MODELS: JSON.stringify({ openrouter: { free: [], total: 1, ids: ["other/model"] } }) });
  server.close();
  assert.notEqual(r.code, 0);
  assert.match(r.err, /does not contain deepseek\/deepseek-v4\.1-flash/);
});

await t("existing combo is kept untouched (models and strategy), missing ones created", async () => {
  const { server, st, base } = await fakeRouter({
    combos: [{ id: "mine", name: "sonnet-chain", models: ["custom/client-model"] }],
    strategies: { "sonnet-chain": { fallbackStrategy: "round-robin" } },
  });
  const r = await run(base, OR_ENV);
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  assert.deepEqual(names(st)["sonnet-chain"], ["custom/client-model"]);
  assert.ok(!st.log.some((l) => l.startsWith("PUT /api/combos/")), "PUT on existing combo");
  assert.deepEqual(st.settings.comboStrategies["sonnet-chain"], { fallbackStrategy: "round-robin" });
  assert.equal(st.settings.comboStrategies["opus-chain"].fallbackStrategy, "fallback");
  assert.match(r.report.combos["sonnet-chain"], /^kept/);
  assert.deepEqual(r.report.combosKept, ["sonnet-chain"]);
  assert.match(r.err, /combos created: .*kept: sonnet-chain/);
});

await t("--update-combos updates the existing combo", async () => {
  const { server, st, base } = await fakeRouter({ combos: [{ id: "mine", name: "sonnet-chain", models: ["custom/client-model"] }] });
  const r = await run(base, OR_ENV, ["--update-combos"]);
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  assert.deepEqual(names(st)["sonnet-chain"], [ORD]);
  assert.match(r.report.combos["sonnet-chain"], /^updated/);
});

await t("CLI token is preferred over the dashboard password", async () => {
  const { server, st, base } = await fakeRouter({ requireToken: true });
  const r = await run(base, { ...OR_ENV, NINEROUTER_CLI_TOKEN: TOKEN });
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  assert.equal(r.report.auth, "cli-token");
  assert.ok(!st.log.includes("POST /api/auth/login"), "logged in with password anyway");
  assert.ok(!(r.out + r.err).includes(TOKEN), "token printed");
});

await t("bad CLI token falls back to the dashboard password", async () => {
  const { server, base } = await fakeRouter({ requireToken: true });
  const r = await run(base, { ...OR_ENV, NINEROUTER_CLI_TOKEN: "wrong" });
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  assert.equal(r.report.auth, "dashboard-password");
});

await t("default direct route with all keys still builds the original Agnes + DeepSeek Direct combos", async () => {
  const { server, st, base } = await fakeRouter();
  const r = await run(base, {
    NINEROUTER_DASHBOARD_PW: "pw", DEEPSEEK_API_KEY: "d", OLLAMA_API_KEY: "o", AGNES_API_KEY: "a", OLLAMA_PLAN: "pro", AGNES_PLAN: "starter",
  });
  server.close();
  assert.equal(r.code, 0, r.err.slice(-400));
  const c = names(st);
  assert.deepEqual(c["sonnet-chain"], ["agnes/agnes-2.5-flash", "ds/deepseek-v4-flash(max)"]);
  assert.deepEqual(c["opus-chain"], ["ds-max/deepseek-v4-flash(max)", "agnes/agnes-2.5-flash"]);
  assert.deepEqual(c["fusion-chain"], ["ds-max/deepseek-v4-flash(max)", "ollama/glm-5.2"]);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
