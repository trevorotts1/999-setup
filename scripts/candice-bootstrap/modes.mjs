#!/usr/bin/env node
/**
 * Candice lifecycle mode enum — single parse/validate authority (FIX-018).
 *
 * Owned glob: `scripts/candice-bootstrap/**` (PROJECT-MANIFEST 9.2 WR-017).
 *
 * Every Candice lifecycle operation runs in exactly one mode:
 *
 *   - `test-fixture` — hermetic tests only. Requires an explicit temporary
 *     `--root`; never touches the live config root. Always prints
 *     `NOT_RELEASE_INSTALL`.
 *   - `developer` — repo-checkout skills/plugin install under an explicit
 *     test root. The app leg is allowed ONLY from an internally signed
 *     fixture (opts.appFixture), never from a caller-selected path. Always
 *     prints `NOT_RELEASE_INSTALL`.
 *   - `release` — production path. Unknown or missing mode exits nonzero
 *     before any filesystem write. In release mode every required leg is
 *     mandatory and fails closed.
 *
 * Production invocations (CLI) reject a missing or unknown mode before the
 * first write. Programmatic callers may omit `mode` and receive
 * `mode: "unknown"`, which every engine treats as an immediate hard failure.
 * No mode string is ever inferred from the environment.
 */
export const MODES = Object.freeze(["test-fixture", "developer", "release"]);

/** Release-authority gate: the only caller allowed to hand a signed fixture to the app leg. */
export const INTERNAL_SIGNED_FIXTURE = "scripts/candice-release/status.mjs";

/**
 * Parse and validate a mode string.
 * @param {string|undefined} mode raw mode value
 * @returns {{ok:boolean, mode:string, message:string}}
 *   ok:true  -> mode is one of the enum values
 *   ok:false -> mode "unknown"; engines must fail before any write
 */
export function parseMode(mode) {
  if (typeof mode === "string" && MODES.includes(mode)) {
    return { ok: true, mode, message: "mode accepted" };
  }
  const got = mode === undefined || mode === null || mode === "" ? "missing" : `unknown (${String(mode)})`;
  return { ok: false, mode: "unknown", message: `mode ${got} — refused before any write; valid modes: ${MODES.join(", ")}` };
}

/** True when the mode is a non-release fixture/dev mode that must self-label. */
export function isNonRelease(mode) {
  return mode === "test-fixture" || mode === "developer";
}

/**
 * Enforce the mandatory CLI mode contract (production invocation):
 * a missing/unknown mode exits nonzero before any filesystem write.
 * @returns {never} on violation (exit 2); returns the validated mode otherwise
 */
export function requireCliMode(raw, label = "command") {
  const parsed = parseMode(raw);
  if (!parsed.ok) {
    console.error(`FAIL ${parsed.message}`);
    console.error(`usage: ${label} requires --mode ${MODES.join("|")}`);
    process.exit(2);
  }
  return parsed.mode;
}

/**
 * Non-release modes (`test-fixture` and `developer`) may only target an
 * explicit temporary/test root — never the live install root.
 * @returns {never} on violation (exit 2)
 */
export function enforceNonReleaseRoot(mode, root) {
  if (!isNonRelease(mode)) return;
  if (!root) {
    console.error(`FAIL ${mode} mode requires an explicit --root (test root); refusing the live install root`);
    process.exit(2);
  }
}
