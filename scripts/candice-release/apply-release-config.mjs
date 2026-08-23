#!/usr/bin/env node
/**
 * apply-release-config.mjs — release-lane signing wiring for
 * apps/candice-companion/tauri.conf.json (FIX-022).
 *
 * The tauri.conf.json in the repository is the fail-closed commit state:
 *   - bundle.macOS.signingIdentity  = null  (no Apple identity claimed)
 *   - bundle.windows.certificateThumbprint = null (no Authenticode claimed)
 *   - bundle.createUpdaterArtifacts = false (no updater content claimed)
 *   - plugins.updater.pubkey        = real committed pubkey whose private
 *                                     key was discarded (Q-10: the app
 *                                     embeds a real updater identity, but a
 *                                     smoke build can never produce an
 *                                     updater-ready artifact)
 *
 * This script overlays release secrets from the environment onto a COPY of
 * the config (never the tracked file), so a build machine that has the
 * operator-held credentials produces signed artifacts, and one that does not
 * produces unsigned artifacts whose posture is explicit (spec 23, WS-23,
 * WS-29 doctrines: never misrepresent trust).
 *
 * Secrets are read from environment variables and are NEVER printed:
 *   - APPLE_DEVELOPER_IDENTITY        -> bundle.macOS.signingIdentity
 *   - APPLE_PROVIDER_SHORT_NAME       -> bundle.macOS.providerShortName (optional)
 *   - CANDICE_WIN_CERT_THUMBPRINT     -> bundle.windows.certificateThumbprint
 *                                        (exactly 40 hex chars; verified)
 *   - CANDICE_UPDATER_PUBKEY          -> plugins.updater.pubkey (base64 minisign
 *                                        public key string from `tauri signer
 *                                        generate`; must be non-placeholder) and
 *                                        re-enables bundle.createUpdaterArtifacts
 *                                        (Q-10: release intent is explicit)
 *   - CANDICE_TIMESTAMP_URL           -> bundle.windows.timestampUrl (optional,
 *                                        defaults to DigiCert)
 *
 * Exit codes:
 *   0  overlay written to the output path (always, in any credential state);
 *      the reported state is one of SIGNED-SIGNED-SIGNED / SIGNED-SIGNED-UNSIGNED /
 *      SIGNED-UNSIGNED-SIGNED / SIGNED-UNSIGNED-UNSIGNED / UNSIGNED-... — an
 *      unsigned posture is a recorded fact, not an error.
 *   1  malformed input (bad thumbprint shape, bad JSON, missing source, or a
 *      pubkey that matches the commit-state placeholder).
 *   2  tooling/usage error.
 *
 * The caller chooses the output path. The caller of a RELEASE build MUST pass
 * `--output` pointing at a gitignored location and build from that config;
 * writing over the tracked apps/candice-companion/tauri.conf.json from a
 * credential overlay is a distribution-honesty violation and this script
 * refuses to do it when the output resolves to the tracked app-root config.
 *
 * The updater keypair is NOT part of this overlay. `tauri signer generate`
 * produces it (operator-held). TAURI_SIGNING_PRIVATE_KEY is consumed by
 * tauri-bundler itself at bundle time, exactly as the WS-29 fragment
 * documented; this script does not touch it.
 *
 * Updater endpoint tag-namespace constraint (FIX-022 wiringfix): the
 * release-authority job in candice-ci.yml runs only on refs/tags/candice-v*,
 * and RELEASE-PROTECTION.md restricts publication to candice-v* tags. Tauri
 * substitutes the raw `version` string from this config into
 * {{current_version}} — it NEVER emits a v-prefix — so the endpoint template
 * carries the literal candice-v prefix before {{current_version}} to resolve
 * into the enforced tag namespace (.../download/candice-v{{current_version}}/
 * latest.json — the static manifest published per release inside that tag's
 * asset set; Tauri v1Compatible updater artifacts serve one manifest per
 * release, not per-{{target}}/{{arch}} JSON files, so the endpoint names
 * latest.json). An endpoint whose substituted path does not match the
 * candice-v* namespace must never be served: if a future Tauri version
 * changes placeholder expansion, the release owner must instead publish the
 * manifest from a path that DOES match the enforced tag (e.g. latest.json at
 * the repo root of the release) and change the endpoint accordingly. The
 * apply-release-config.test.mjs fixture pins the exact endpoint shape and
 * namespace test.
 */

import { existsSync, readFileSync, writeFileSync, realpathSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const THUMBPRINT_PATTERN = /^[0-9A-Fa-f]{40}$/;
const PUBKEY_PLACEHOLDER = "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY";
const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";
const DEFAULT_CONF_PATH = resolve(
  import.meta.dirname,
  "../../apps/candice-companion/tauri.conf.json",
);

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function stripWhitespace(value) {
  // PEM/JSON values pasted from CI secrets sometimes carry surrounding
  // whitespace; strip it silently but never print the value.
  return String(value).trim();
}

export function applyReleaseConfigOverlay(conf, env = process.env) {
  const bundle = conf && typeof conf === "object" ? conf.bundle : null;
  const plugins = conf && typeof conf === "object" ? conf.plugins : null;
  const updater = plugins && typeof plugins === "object" ? plugins.updater : null;
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, state: null, errors: ["bundle section is missing"] };
  }
  if (!updater || typeof updater !== "object") {
    return { ok: false, state: null, errors: ["plugins.updater section is missing"] };
  }

  const errors = [];
  const state = { macos: "UNSIGNED", windows: "UNSIGNED", updater: "UNSIGNED" };

  const identity = env.APPLE_DEVELOPER_IDENTITY
    ? stripWhitespace(env.APPLE_DEVELOPER_IDENTITY)
    : "";
  const provider = env.APPLE_PROVIDER_SHORT_NAME
    ? stripWhitespace(env.APPLE_PROVIDER_SHORT_NAME)
    : "";
  const thumbprint = env.CANDICE_WIN_CERT_THUMBPRINT
    ? stripWhitespace(env.CANDICE_WIN_CERT_THUMBPRINT)
    : "";
  const pubkey = env.CANDICE_UPDATER_PUBKEY ? stripWhitespace(env.CANDICE_UPDATER_PUBKEY) : "";
  const timestampUrl = env.CANDICE_TIMESTAMP_URL
    ? stripWhitespace(env.CANDICE_TIMESTAMP_URL)
    : "";

  if (identity) {
    bundle.macOS = bundle.macOS ?? {};
    bundle.macOS.signingIdentity = identity;
    state.macos = "SIGNED";
  }
  if (provider) bundle.macOS.providerShortName = provider;

  if (thumbprint) {
    if (!THUMBPRINT_PATTERN.test(thumbprint)) {
      errors.push(
        "CANDICE_WIN_CERT_THUMBPRINT must be exactly 40 hex characters (SHA-1 thumbprint); a malformed or placeholder identity is rejected",
      );
    } else {
      bundle.windows = bundle.windows ?? {};
      bundle.windows.certificateThumbprint = thumbprint;
      state.windows = "SIGNED";
    }
  }
  if (timestampUrl) {
    bundle.windows = bundle.windows ?? {};
    bundle.windows.timestampUrl = timestampUrl;
  } else if ((bundle.windows ?? {}).timestampUrl == null) {
    bundle.windows = bundle.windows ?? {};
    bundle.windows.timestampUrl = DEFAULT_TIMESTAMP_URL;
  }

  if (pubkey) {
    if (pubkey === PUBKEY_PLACEHOLDER) {
      errors.push(
        "CANDICE_UPDATER_PUBKEY matches the commit-state placeholder; a placeholder public key is never accepted as a real signing identity",
      );
    } else {
      updater.pubkey = pubkey;
      state.updater = "SIGNED";
      // Release intent (Q-10): the overlay re-enables updater artifact
      // production, which the committed smoke config disables. The produced
      // artifacts are then signed by updater-sign.mjs and verified against
      // this pubkey before the release may proceed.
      bundle.createUpdaterArtifacts = "v1Compatible";
    }
  } else if (updater.pubkey === PUBKEY_PLACEHOLDER) {
    errors.push(
      "plugins.updater.pubkey is still the commit-state placeholder — replace it with the real base64 public key (Q-10); a placeholder is never a real signing identity",
    );
  }

  return { ok: errors.length === 0, state, errors };
}

export function main(argv = process.argv.slice(2)) {
  const outputArg = argValue(argv, "--output") || argValue(argv, "-o");
  const inputArg = argValue(argv, "--input") || argValue(argv, "-i");

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "apply-release-config.mjs — overlay release signing secrets onto a copy of tauri.conf.json",
        "",
        "Usage:",
        "  node scripts/candice-release/apply-release-config.mjs [--input <path>] --output <path>",
        "",
        "Env inputs (never printed):",
        "  APPLE_DEVELOPER_IDENTITY   Developer ID identity (macOS signing)",
        "  APPLE_PROVIDER_SHORT_NAME  optional Apple provider short name",
        "  CANDICE_WIN_CERT_THUMBPRINT  40-hex Authenticode SHA-1 thumbprint",
        "  CANDICE_UPDATER_PUBKEY     base64 minisign public key (tauri signer generate)",
        "  CANDICE_TIMESTAMP_URL      optional Windows timestamp URL (default DigiCert)",
        "",
        "The tracked tauri.conf.json is the fail-closed commit state; this script",
        "never writes it. Exit 0 in any credential state (posture is a recorded",
        "fact), 1 on malformed input or placeholder pubkey, 2 on usage errors.",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!outputArg) {
    process.stderr.write("apply-release-config: missing --output <path>\n");
    process.exit(2);
  }

  const inputPath = resolve(inputArg || DEFAULT_CONF_PATH);
  const outputPath = resolve(outputArg);

  if (!existsSync(inputPath)) {
    process.stderr.write(`apply-release-config: input config not found: ${inputPath}\n`);
    process.exit(2);
  }

  // Distribution-honesty guard: the overlay output must never be the tracked
  // app-root config. The tracked file may be deliberately targeted as an
  // input; as an OUTPUT it is rejected.
  try {
    if (realpathSync(outputPath) === realpathSync(DEFAULT_CONF_PATH)) {
      process.stderr.write(
        "apply-release-config: refused — the tracked apps/candice-companion/tauri.conf.json must never be overwritten by a credential overlay; emit to a gitignored path and build from there\n",
      );
      process.exit(2);
    }
  } catch {
    // output does not exist yet; nothing to resolve
  }

  let conf;
  try {
    conf = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    process.stderr.write(`apply-release-config: invalid input JSON: ${error.message}\n`);
    process.exit(2);
  }

  const result = applyReleaseConfigOverlay(conf, process.env);
  const posture = `${result.state.macos}-${result.state.windows}-${result.state.updater}`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(conf, null, 2) + "\n");

  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`apply-release-config: ${error}\n`);
    process.stderr.write(`apply-release-config: overlay written to ${outputPath} but the posture is NOT releaseable: ${posture}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `apply-release-config: ${outputPath} -> ${posture} (macOS=${result.state.macos} windows=${result.state.windows} updater=${result.state.updater})\n`,
  );
  process.stdout.write(
    `apply-release-config: unsigned posture is explicit and never presented as trusted; release gate stays closed per scripts/candice-release/status.mjs\n`,
  );
  process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  main();
}
