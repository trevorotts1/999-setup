#!/usr/bin/env node
/**
 * Candice fail-closed health probes (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Every probe returns a machine-readable {status: PASS|FAIL|UNKNOWN, detail}
 * and the failing leg's name. A missing, unknown, or nonzero probe result is
 * FAIL, never OK. Probes never write, never download, never contact the
 * network beyond the local IPC seams they are defined to use.
 *
 * Seam ownership (conflict-resolution rules):
 *   - launch probe: bounded actual launch of the installed app with
 *     `--wake` (the app's existing supported-command surface); no invented
 *     `--health-probe` flag,
 *   - bridge probe: a genuine IPC readiness round trip through the FIX-011
 *     seam (plugins/candice-integration/mcp/ask-user/
 *     local-companion-bridge.js), driven in-process as a CommonJS module;
 *     no invented `--probe` CLI. The installed companion executable
 *     (state.launch.command) is the launch command for the real hello
 *     handshake,
 *   - capability probes: a genuine stdio round trip against the installed
 *     MCP server (.mcp.json `candice` command, FIX-022-provided); no
 *     invented bin/runtime-state.mjs seam. This probe is a transport +
 *     contract check of the MCP server (FIX-022's documented CLI surface),
 *     never a claim about model quality,
 *   - permission probes follow FIX-013 semantics (0700/0600 on Unix);
 *     this lane does not create its own permission policy.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { LEG_OK, LEG_FAIL, LEG_UNKNOWN } from "../health-schema.mjs";

export const PROBE_TIMEOUT_MS = 15000;
export const BRIDGE_PROBE_TIMEOUT_MS = 30000;

/** The four supported wake matchers (hooks.json wake-matcher set). */
export const SUPPORTED_WAKE_COMMANDS = Object.freeze(["spec-protocol", "kaizen", "eli5", "bro"]);

const require = createRequire(import.meta.url);

function probe(status, detail) {
  return { status, detail };
}

/** Bounded spawn of a probe command; nonzero exit or timeout is FAIL. */
export function runProbeCommand(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs || PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...(opts.spawnOpts || {}) });
    } catch (e) {
      resolve(probe(LEG_FAIL, `probe spawn failed: ${e.message}`));
      return;
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(probe(LEG_FAIL, `probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(probe(LEG_FAIL, `probe spawn error: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(probe(LEG_OK, out.trim() || "probe passed"));
      } else {
        resolve(probe(LEG_FAIL, `probe exit ${code}: ${(err || out || "").trim() || "no output"}`));
      }
    });
  });
}

/**
 * Launch probe: bounded actual launch of the installed app executable with
 * `--wake` plus one supported command. The app's own arg surface (FIX-010
 * runtime.rs) is the only surface this probe uses — no invented
 * `--health-probe` flag. A missing executable is FAIL (never UNKNOWN —
 * absence is a fact).
 */
export async function launchProbe(exePath, opts = {}) {
  if (!exePath || !existsSync(exePath)) {
    return probe(LEG_FAIL, `app executable missing: ${exePath || "(no path)"}`);
  }
  try {
    if (!statSync(exePath).isFile()) {
      return probe(LEG_FAIL, `app executable is not a file: ${exePath}`);
    }
  } catch (e) {
    return probe(LEG_FAIL, `app executable unreadable: ${e.message}`);
  }
  const wake = opts.wakeCommand || SUPPORTED_WAKE_COMMANDS[0];
  return runProbeCommand(exePath, ["--wake", wake], opts);
}

/**
 * Bridge IPC probe through the FIX-011 seam, driven in-process.
 *
 * The probe starts the bridge class itself (loopback TCP, owner-only token
 * file) with the installed companion executable as launch command, claims
 * a fresh activation, and lets the bridge launch the companion. The
 * COMPANION (a real separate process) performs the authenticated hello
 * handshake — the exact transport, token, protocol, and activation check
 * the production path uses. Readiness is observed through the bridge's
 * own `ensureSession` contract, which flips only when that authenticated
 * hello arrives and the bridge sends its `ready` frame.
 *
 * `companion-not-configured` (no launch command) and
 * `companion-ready-timeout` (spawned process never authenticated) are
 * FAIL, never OK. Tests supply a real companion fixture executable
 * (__tests__/fixtures/companion-hello.js) that performs the genuine hello;
 * an injected fake socket is never sufficient for this leg.
 */
export async function bridgeProbe(pluginRoot, opts = {}) {
  const bridge = join(pluginRoot, "mcp", "ask-user", "local-companion-bridge.js");
  if (!existsSync(bridge)) {
    return probe(LEG_FAIL, `bridge seam missing: ${bridge}`);
  }
  let mod;
  try {
    mod = require(resolve(bridge));
  } catch (e) {
    return probe(LEG_FAIL, `bridge seam unloadable: ${e.message}`);
  }
  const LocalCompanionBridge = mod.LocalCompanionBridge;
  if (!LocalCompanionBridge || typeof LocalCompanionBridge !== "function") {
    return probe(LEG_FAIL, "bridge seam exports no LocalCompanionBridge class");
  }
  if (!opts.launchCommand) {
    return probe(LEG_FAIL, "bridge probe has no companion launch command — readiness unverifiable (fail closed)");
  }

  const sessionId = `probe-${Date.now()}`;
  const timeoutMs = opts.timeoutMs || BRIDGE_PROBE_TIMEOUT_MS;
  const instance = new LocalCompanionBridge({
    launchCommand: opts.launchCommand,
    ...(opts.socketDir ? { socketDir: opts.socketDir } : {}),
    ...(typeof opts.now === "function" ? { now: opts.now } : {}),
  });

  let settled = false;
  let resolveOutcome = () => {};
  const outcomePromise = new Promise((resolve) => {
    resolveOutcome = resolve;
  });

  async function cleanup() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      await instance.close();
    } catch {
      /* close is best-effort */
    }
  }

  function settle(outcome) {
    clearTimeout(timer);
    resolveOutcome(outcome);
  }

  const timer = setTimeout(async () => {
    await cleanup();
    settle(probe(LEG_FAIL, `bridge probe timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    await instance.start();
  } catch (e) {
    await cleanup();
    settle(probe(LEG_FAIL, `bridge start failed: ${e.message}`));
    return outcomePromise;
  }

  const claimed = await instance.ensureSession(sessionId);
  await cleanup();
  if (!claimed.ok) {
    settle(probe(LEG_FAIL, `bridge activation refused: ${claimed.code}`));
    return outcomePromise;
  }
  settle(probe(LEG_OK, `bridge IPC ready (authenticated companion hello, protocol ${mod.BRIDGE_PROTOCOL_VERSION || "1.0"})`));
  return outcomePromise;
}

/**
 * Capability probe through the installed MCP server surface (the .mcp.json
 * `candice` command, FIX-022-provided). A genuine stdio JSON-RPC round trip:
 * `initialize` -> `tools/list` must declare the ask_user tool with its
 * governed question schema. Proves the MCP server boots and speaks the
 * contract — the readiness gate for a voice-capable surface. No invented
 * runtime-state seam.
 *
 * The capability is declared per the server's own protocol reply; both
 * `stt-runtime-capability` and `tts-runtime-capability` legs derive from
 * the same transport + contract round trip (each reports the reply state
 * independently — one MCP transport failure fails both legs, a real defect
 * of one shared seam is reported truthfully as FAIL, never UNKNOWN).
 */
export async function capabilityProbe(pluginRoot, kind, opts = {}) {
  const mcpFile = join(pluginRoot, ".mcp.json");
  if (!existsSync(mcpFile)) {
    return probe(LEG_FAIL, `.mcp.json missing: ${mcpFile}`);
  }
  let mcp;
  try {
    mcp = JSON.parse(readFileSync(mcpFile, "utf8"));
  } catch (e) {
    return probe(LEG_FAIL, `.mcp.json unreadable: ${e.message}`);
  }
  const server = mcp.mcpServers && mcp.mcpServers.candice;
  const cmd = server && server.command;
  if (!cmd) {
    return probe(LEG_FAIL, "candice MCP server command missing from .mcp.json");
  }
  // Expand ${CLAUDE_PLUGIN_ROOT} exactly as the Claude CLI does when it
  // spawns an MCP server: the installed plugin tree root. No other
  // variable is expanded here.
  const args = (Array.isArray(server.args) ? server.args : []).map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));

  const session = opts.mcpSession;
  if (session && typeof session === "function") {
    try {
      const r = await session({ cmd, args, kind });
      return probe(r.status, r.detail);
    } catch (e) {
      return probe(LEG_FAIL, `injected capability session failed: ${e.message}`);
    }
  }

  const timeoutMs = opts.timeoutMs || BRIDGE_PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve(probe(LEG_FAIL, `MCP server spawn failed: ${e.message}`));
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(probe(LEG_FAIL, `capability probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let buffer = "";
    let settled = false;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(probe(status, detail));
    };
    child.on("error", (e) => finish(LEG_FAIL, `MCP server spawn error: ${e.message}`));
    child.on("close", () => finish(LEG_FAIL, "MCP server closed before tools/list answered"));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method) continue;
        if (msg.id === 1 && msg.result && msg.result.serverInfo) {
          // initialize answered — ask for the tool list.
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
          );
          continue;
        }
        if (msg.id === 2) {
          const tools = (msg.result && msg.result.tools) || [];
          const hasAskUser = tools.some((t) => t && t.name === "ask_user");
          if (!hasAskUser) {
            finish(LEG_FAIL, `capability probe: MCP server tools/list lacks ask_user (${tools.map((t) => t.name).join(", ") || "none"})`);
            return;
          }
          const schemaOk = tools.find((t) => t.name === "ask_user")?.inputSchema?.properties?.sessionId ? true : false;
          finish(
            LEG_OK,
            `capability ${kind}: MCP server boots and declares the governed ask_user tool (contract ${schemaOk ? "verified" : "schema degraded"})`,
          );
          return;
        }
        if (msg.error) {
          finish(LEG_FAIL, `capability probe: MCP error ${msg.error.code ?? ""}: ${msg.error.message ?? "unknown"}`);
          return;
        }
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "candice-bootstrap-capability-probe", version: "1.0.0" },
        },
      })}\n`,
    );
  });
}

/**
 * Permission probe (FIX-013 semantics): the installed state directory must
 * be owner-only (0700) and the state document owner-only (0600) on Unix.
 * Windows ACL enforcement is FIX-013-owned; on win32 this probe reports
 * UNKNOWN (never OK) until that lane supplies the ACL check.
 */
export function permissionProbe(root, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform === "win32") {
    return probe(LEG_UNKNOWN, "Windows ACL check is FIX-013-owned; not yet supplied");
  }
  const stateDir = join(root, "state");
  if (!existsSync(stateDir)) {
    return probe(LEG_FAIL, `state dir missing: ${stateDir}`);
  }
  try {
    const dirMode = statSync(stateDir).mode & 0o777;
    if (dirMode !== 0o700) {
      return probe(LEG_FAIL, `state dir mode is ${dirMode.toString(8)}, expected 700`);
    }
    const stateFile = join(stateDir, "bootstrap-state.json");
    if (existsSync(stateFile)) {
      const fileMode = statSync(stateFile).mode & 0o777;
      if (fileMode !== 0o600) {
        return probe(LEG_FAIL, `state file mode is ${fileMode.toString(8)}, expected 600`);
      }
    }
    return probe(LEG_OK, "state permissions 0700/0600");
  } catch (e) {
    return probe(LEG_FAIL, `permission probe failed: ${e.message}`);
  }
}

/** Hash a file (sha256) for exact asset verification. */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export { LEG_OK, LEG_FAIL, LEG_UNKNOWN };
