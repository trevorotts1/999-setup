#!/usr/bin/env node
// write-routing-state.mjs — writes the routed-session state that the claude-nine
// launcher reads. Platform-specific secret protection is handled by the caller
// (Windows: DPAPI; macOS: Keychain for the token + mode-600 file for the rest).
// This script writes ONLY non-secret route names and paths into a state file.
//
// Input: JSON on stdin:
//   {
//     "statePath": "/abs/path/router-session.json",   // caller resolves platform path
//     "routes": {
//       "fable": "ds/deepseek-v4-flash(max)",
//       "opus": "ds-max/deepseek-v4-pro(max)",
//       "sonnet": "ds/deepseek-v4-flash(max)",
//       "haiku": "ds-light/deepseek-v4-flash",
//       "subagent": "ds/deepseek-v4-flash(max)",
//       "vision": "ollama/kimi-k2.6",
//       "haikuFallback": "ds-light/deepseek-v4-flash → agnes/agnes-2.5-flash"
//     },
//     "concurrency": 2,
//     "maxOutputTokens": 32000,
//     "effortLevel": "xhigh",       // highest PERSISTABLE effort ("max" is
//                                   // session-scoped and cannot be saved)
//     "claudeBinary": "/abs/path/to/claude",       // resolved by caller
//     "nineRouterBinary": "/abs/path/to/9router",   // resolved by caller
//     "port": 20128
//   }
//
// The routes object is passed through verbatim from configure-nine-router.mjs
// (report.resolvedRoutes) — never hardcode a lane here. The subagent lane MUST
// carry the "(max)" thinking suffix; a missing suffix is warned about below but
// still written (the caller may have a valid reason).
//
// The state file never contains API keys or the router token. The token is
// stored separately by the platform orchestrator (DPAPI / Keychain).

import fs from "node:fs";
import path from "node:path";

function readStdin() {
  return new Promise((resolve, reject) => {
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", reject);
  });
}

// Route schema: the known lanes plus the prefix families the configurator may
// emit. Unknown keys or prefixes are warned about (not fatal — the caller may
// carry a newer route family this writer has not seen), and the routes are
// still written as given. "→" marks a fallback lane: "ds-light/deepseek-v4-flash
// → agnes/agnes-2.5-flash" means try the first, fall back to the second.
const KNOWN_ROUTE_KEYS = new Set([
  "fable", "opus", "sonnet", "haiku", "subagent", "vision", "haikuFallback",
]);
// Allowed route prefixes, split by thinking capability:
//   ds/        DeepSeek Direct, thinking at default level (parsed from "(max)")
//   ds-light/  DeepSeek Direct light — no "(max)" thinking (cheap lane, e.g. Haiku)
//   ds-max/    DeepSeek Direct max — always max thinking, "(max)" optional
//   ollama/    Ollama Cloud (haiku/vision lanes; never max)
//   agnes/     Agnes AI, custom OpenAI-compatible node (fallback target only)
const ALLOWED_ROUTE_PREFIXES = ["ds/", "ds-light/", "ds-max/", "ollama/", "agnes/"];

// Validate the route map against the schema. Returns an array of warning
// strings (empty when the map is clean). Never throws — this is advisory.
function validateRoutes(routes) {
  const warnings = [];
  if (!routes || typeof routes !== "object") return warnings;

  for (const key of Object.keys(routes)) {
    if (!KNOWN_ROUTE_KEYS.has(key)) {
      warnings.push(`unknown route key "${key}" — written as given, verify upstream`);
      continue;
    }
    const value = routes[key];
    if (typeof value !== "string") {
      warnings.push(`route "${key}" is not a string (${typeof value})`);
      continue;
    }
    if (value.includes("→")) continue; // fallback lane — whole string is advisory
    const prefixOk = ALLOWED_ROUTE_PREFIXES.some((p) => value.startsWith(p));
    if (!prefixOk) {
      warnings.push(`route "${key}" uses unrecognized prefix "${value.split("/")[0]}" — written as given, verify upstream`);
    }
  }

  const subagent = routes.subagent;
  if (typeof subagent === "string") {
    if (!subagent.includes("(max)")) {
      warnings.push(`subagent route "${subagent}" lacks the "(max)" suffix — subagents will lose max thinking; verify upstream`);
    }
  } else if (subagent !== undefined) {
    warnings.push(`subagent route is not a string (${typeof subagent})`);
  }
  return warnings;
}

async function main() {
  // Windows PowerShell 5.1 emits a UTF-8 BOM when piping text to a native
  // command; strip it before JSON.parse or the first key is mangled.
  const raw = (await readStdin()).replace(/^﻿/, "");
  const input = JSON.parse(raw || "{}");
  const statePath = input.statePath;
  if (!statePath) {
    console.error("write-routing-state: statePath required");
    process.exit(2);
  }

  // Advisory schema check — warns on unknown lanes/prefixes or a subagent lane
  // missing "(max)". Warnings only: the state is still written (the caller may
  // have a valid reason for the shape it sent).
  for (const w of validateRoutes(input.routes)) {
    console.error(`write-routing-state: WARNING: ${w}`);
  }

  const state = {
    version: 1,
    updatedAt: new Date().toISOString(),
    port: input.port || 20128,
    baseUrl: `http://127.0.0.1:${input.port || 20128}/v1`,
    routes: input.routes || {},
    concurrency: input.concurrency,
    maxOutputTokens: input.maxOutputTokens,
    // Seeded at "xhigh": the highest effort Claude Code can PERSIST in a
    // profile ("max" is session-scoped only). The launcher no longer exports
    // this as CLAUDE_CODE_EFFORT_LEVEL — that env var overrides the in-session
    // /effort picker (the 2026-08-11 ultracode-revert bug) — so this value is
    // the recorded default, honoured only under CLAUDE_NINE_FORCE_EFFORT.
    effortLevel: input.effortLevel || "xhigh",
    claudeBinary: input.claudeBinary || "",
    nineRouterBinary: input.nineRouterBinary || "",
    // tokenRef only: the launcher resolves the actual token from platform storage.
    tokenRef: input.tokenRef || null,
  };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  // Write via a temp file + rename for atomicity.
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  // Mode 600 on POSIX; on Windows the ACL is set by the orchestrator.
  if (process.platform !== "win32") {
    fs.chmodSync(tmp, 0o600);
  }
  fs.renameSync(tmp, statePath);

  // Never print secrets (there are none in this file by construction).
  console.log(`state written: ${statePath}`);
  console.log(`routes: ${Object.keys(state.routes).join(", ")}`);
  console.log(`concurrency: ${state.concurrency}, maxOutputTokens: ${state.maxOutputTokens}`);
}

main().catch((e) => {
  console.error(`write-routing-state failed: ${e.message}`);
  process.exit(1);
});
