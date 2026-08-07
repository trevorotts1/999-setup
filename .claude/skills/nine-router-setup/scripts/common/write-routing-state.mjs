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
//       "opus": "ds/deepseek-v4-pro-max",
//       "sonnet": "ollama/glm-5.2",
//       "haiku": "ollama/kimi-k2.6",
//       "subagent": "ds/deepseek-v4-flash"
//     },
//     "concurrency": 2,
//     "maxOutputTokens": 32000,
//     "effortLevel": "max",
//     "claudeBinary": "/abs/path/to/claude",       // resolved by caller
//     "nineRouterBinary": "/abs/path/to/9router",   // resolved by caller
//     "port": 20128
//   }
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

async function main() {
  const input = JSON.parse((await readStdin()) || "{}");
  const statePath = input.statePath;
  if (!statePath) {
    console.error("write-routing-state: statePath required");
    process.exit(2);
  }

  const state = {
    version: 1,
    updatedAt: new Date().toISOString(),
    port: input.port || 20128,
    baseUrl: `http://127.0.0.1:${input.port || 20128}/v1`,
    routes: input.routes || {},
    concurrency: input.concurrency,
    maxOutputTokens: input.maxOutputTokens,
    effortLevel: input.effortLevel || "max",
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
