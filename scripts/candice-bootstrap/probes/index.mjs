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
 *   - launch/bridge probes go through the FIX-011 IPC seam only
 *     (plugins/candice-integration/mcp/ask-user/local-companion-bridge.js);
 *     no second readiness authority,
 *   - capability probes go through the FIX-009 seam (the plugin's
 *     runtime-state command surface),
 *   - permission probes follow FIX-013 semantics (0700/0600 on Unix);
 *     this lane does not create its own permission policy.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { LEG_OK, LEG_FAIL, LEG_UNKNOWN } from "../health-schema.mjs";

export const PROBE_TIMEOUT_MS = 15000;

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
 * Launch probe: bounded actual launch of the installed app executable.
 * The executable must exist, be a file, and exit 0 within the bound.
 * A missing executable is FAIL (never UNKNOWN — absence is a fact).
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
  return runProbeCommand(exePath, opts.args || ["--health-probe"], opts);
}

/**
 * Bridge IPC probe through the FIX-011 seam: the plugin's
 * local-companion-bridge module answers a bounded readiness round trip.
 * The bridge module is the single readiness authority; this probe never
 * invents a second one.
 */
export async function bridgeProbe(pluginRoot, opts = {}) {
  const bridge = join(pluginRoot, "mcp", "ask-user", "local-companion-bridge.js");
  if (!existsSync(bridge)) {
    return probe(LEG_FAIL, `bridge seam missing: ${bridge}`);
  }
  return runProbeCommand(process.execPath, [bridge, "--probe"], opts);
}

/**
 * Capability probe through the FIX-009 seam: the plugin's runtime-state
 * command surface reports STT/TTS capability. A missing seam or a nonzero
 * exit is FAIL.
 */
export async function capabilityProbe(pluginRoot, kind, opts = {}) {
  const seam = join(pluginRoot, "bin", "runtime-state.mjs");
  if (!existsSync(seam)) {
    return probe(LEG_FAIL, `capability seam missing: ${seam}`);
  }
  return runProbeCommand(process.execPath, [seam, "--capability", kind], opts);
}

/**
 * Permission probe (FIX-013 semantics): the installed state directory must
 * be owner-only (0700) and the state document owner-only (0600) on Unix.
 * Windows ACL enforcement is FIX-013-owned; on win32 this probe reports
 * UNKNOWN (never OK) until that lane supplies the ACL check.
 */
export function permissionProbe(root) {
  if (process.platform === "win32") {
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
