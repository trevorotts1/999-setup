#!/usr/bin/env node
/**
 * updater-sign.mjs — Q-10 signing path for Tauri updater artifacts.
 *
 * Two distinct build paths exist and must never blur (Q-10):
 *
 *   - SMOKE builds (CI matrix, local dev): unsigned, build from the committed
 *     tauri.conf.json, and carry `createUpdaterArtifacts: false` with the
 *     committed real pubkey (its private key was discarded). They produce
 *     no latest.json and no `.sig` files, so a smoke artifact can never be
 *     mistaken for updater-ready content.
 *   - RELEASE builds (protected release workflow on a candice-v* tag):
 *     build from a release overlay config with the real updater public key
 *     and `createUpdaterArtifacts` enabled, with
 *     TAURI_SIGNING_PRIVATE_KEY injected through the CI secrets mechanism.
 *     tauri-bundler hard-fails when the key is missing and only warns when
 *     the key does not match the configured public key, so this script is
 *     the hard match gate: after signing it VERIFIES every signature against
 *     the configured pubkey (via --verify-helper, the updater-sign-helper
 *     binary from scripts/candice-release/release-config-guard) and refuses
 *     to continue when the secret key and the overlay public key are not the
 *     same key pair.
 *
 * No secret material is ever printed. The signing key never reaches the
 * command line: it is materialized as a gitignored temp file, deleted
 * afterward, and consumed by `cargo tauri signer sign -k <file>`.
 *
 * Usage (release workflow only):
 *   node scripts/candice-release/updater-sign.mjs
 *     --signing-key-env TAURI_SIGNING_PRIVATE_KEY
 *     --pubkey-file <release-overlay-tauri.conf.json>
 *     --artifact <path>            (repeatable)
 *     --key-password-env TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (optional)
 *     --out-signatures-dir <dir>   (optional; default: alongside each artifact)
 *     --fail-on-absent             (optional; default: absent files are an error)
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_CONF_PATH = resolve(
  scriptRoot,
  "apps/candice-companion/tauri.conf.json",
);

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argValues(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
  }
  return out;
}

export function readUpdaterPubkey(confPath = DEFAULT_CONF_PATH) {
  let conf;
  try {
    conf = JSON.parse(readFileSync(confPath, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`cannot read config ${confPath}: ${error.message}`] };
  }
  const pubkey = conf?.plugins?.updater?.pubkey;
  const createUpdaterArtifacts = conf?.bundle?.createUpdaterArtifacts;
  if (typeof pubkey !== "string" || pubkey.length === 0) {
    return { ok: false, errors: [`plugins.updater.pubkey is missing or empty in ${confPath}`] };
  }
  if (pubkey === "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY") {
    return { ok: false, errors: [`plugins.updater.pubkey in ${confPath} is the commit-state placeholder; a placeholder is never a real signing identity`] };
  }
  if (!createUpdaterArtifacts) {
    return { ok: false, errors: [`bundle.createUpdaterArtifacts is not enabled in ${confPath}; there is nothing to sign`] };
  }
  return { ok: true, errors: [], pubkey, createUpdaterArtifacts };
}

export function failHard(reason) {
  return { ok: false, errors: [reason], signatures: [] };
}

/**
 * Validate one build path posture (Q-10).
 *   mode "smoke":    createUpdaterArtifacts must be absent/false AND the
 *                    pubkey must be a real non-placeholder key (the committed
 *                    config carries the real pubkey whose private key was
 *                    discarded) — no updater content, real updater identity.
 *   mode "release":  createUpdaterArtifacts must be enabled and the pubkey
 *                    must not be the placeholder.
 */
export function validateBuildPosture(conf, mode) {
  const bundle = conf && typeof conf === "object" ? conf.bundle : null;
  const updater = conf?.plugins && typeof conf.plugins === "object" ? conf.plugins.updater : null;
  const createUpdaterArtifacts = bundle?.createUpdaterArtifacts;
  const pubkey = updater?.pubkey;
  if (mode === "smoke") {
    if (createUpdaterArtifacts) {
      return failHard("smoke build must not enable bundle.createUpdaterArtifacts (smoke artifacts must never claim updater-ready posture)");
    }
    if (!pubkey || pubkey === "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY") {
      return failHard("smoke build must carry a real plugins.updater.pubkey, never the commit-state placeholder (Q-10)");
    }
    return { ok: true, errors: [], signatures: [] };
  }
  if (!createUpdaterArtifacts) {
    return failHard("release build must enable bundle.createUpdaterArtifacts; a release artifact without an updater manifest is not a release artifact");
  }
  if (!pubkey || pubkey === "RELEASE_OWNER_MUST_REPLACE_WITH_BASE64_PUBLIC_KEY") {
    return failHard("release build must carry a real plugins.updater.pubkey, never the commit-state placeholder");
  }
  return { ok: true, errors: [], signatures: [] };
}

/**
 * Run `cargo tauri signer sign` for each artifact, then VERIFY every
 * produced signature against the configured public key. Verification is the
 * Q-10 hard match gate: tauri-bundler only warns on a key/pubkey mismatch,
 * so a release must never proceed on signatures this script has not proven
 * the configured pubkey accepts.
 *
 * The private key never reaches argv: it is written to a temp file that is
 * deleted afterward.
 *
 * Returns { ok, errors, signatures: [{ path, file }] }.
 */
export function signUpdaterArtifacts({
  signingKey,
  signingKeyPassword,
  pubkeyB64,
  artifacts,
  outSignaturesDir,
  tauriSignerBin,
  tauriCliDir,
  signatureHelper,
  verifyHelper,
}) {
  if (typeof signingKey !== "string" || signingKey.trim().length === 0) {
    return failHard("TAURI_SIGNING_PRIVATE_KEY is missing or empty; a release build must fail hard, not fall back to an unsigned artifact");
  }
  if (typeof pubkeyB64 !== "string" || pubkeyB64.length === 0) {
    return failHard("public key is missing; cannot prove the signing key matches the configured pubkey");
  }
  const artifacts_ = (artifacts || []).filter(Boolean);
  if (artifacts_.length === 0) {
    return failHard("no artifacts were provided to sign");
  }
  const missing = artifacts_.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    return failHard(`updater artifact missing: ${missing.join(", ")}`);
  }

  const workDir = (() => {
    for (let i = 0; i < 10; i += 1) {
      const candidate = join(tmpdir(), `candice-updater-sign-${process.pid}-${Math.random().toString(36).slice(2)}`);
      try {
        mkdirSync(candidate, { recursive: true, mode: 0o700 });
        return candidate;
      } catch {
        // collide; retry
      }
    }
    throw new Error("could not allocate updater signing temp dir");
  })();

  const keyFilePath = join(workDir, "candice_updater.key");
  let commandUsed = tauriSignerBin;

  const cleanup = () => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  };

  try {
    // Materialize the key to disk with a mode-600 inode. The dir is 700 and
    // unique per run, so the key is readable only by the runner user and
    // only while the run lives.
    try {
      writeFileSync(keyFilePath, signingKey, { encoding: "utf8", mode: 0o600 });
      symlinkSync(keyFilePath, join(workDir, "candice_updater_key_link"));
    } catch (error) {
      cleanup();
      return failHard(`cannot materialize signing key temp file: ${error.message}`);
    }

    const run = (args) => {
      const r = spawnSync(commandUsed, args, {
        encoding: "utf8",
        cwd: tauriCliDir || scriptRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.status === null) {
        return { status: -1, stdout: "", stderr: `signer failed to start: ${r.error?.message ?? "unknown"}` };
      }
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    };

    // Unsupported tool path mode (explicit opt-in, never used by the
    // release workflow): materialize an unsupported signature directly from
    // the private key so the verify step (wrong data, wrong key) still
    // proves the sign/verify contract.
    let createdSignatures;
    if (signatureHelper) {
      createdSignatures = materializeUnsupportedSignatures({
        helperPath: signatureHelper,
        keyFilePath,
        signingKeyPassword,
        artifacts: artifacts_,
      });
      if (!createdSignatures.ok) {
        cleanup();
        return createdSignatures;
      }
      createdSignatures = createdSignatures.signatures;
    } else {
      createdSignatures = [];
      for (const artifactPath of artifacts_) {
        const sigOutDir = outSignaturesDir || dirname(resolve(artifactPath));
        mkdirSync(sigOutDir, { recursive: true });
        const signArgs = ["tauri", "signer", "sign", "-k", keyFilePath];
        if (signingKeyPassword) signArgs.push("--password", signingKeyPassword);
        signArgs.push("--signature-dir", sigOutDir, artifactPath);
        const r = run(signArgs);
        if (r.status !== 0) {
          cleanup();
          return failHard(
            `tauri signer sign failed for ${artifactPath} (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 1000)}`,
          );
        }
        createdSignatures.push({
          path: join(sigOutDir, `${basename(artifactPath)}.sig`),
          file: artifactPath,
        });
      }
    }

    const signatures = [];
    const errors = [];
    for (const sig of createdSignatures) {
      if (!sig || !sig.path || !existsSync(sig.path)) {
        errors.push(`signature file was not created: ${sig?.path ?? "unnamed"} (artifact ${sig?.file ?? "unknown"})`);
        continue;
      }
      // Q-10 hard match gate: every produced signature must be accepted by
      // the configured public key before the release may proceed.
      const verifyResult = verifySignatureAgainstPubkey({
        helperPath: verifyHelper,
        pubkeyB64,
        signaturePath: sig.path,
        artifactPath: sig.file,
      });
      if (!verifyResult.ok) {
        errors.push(
          `signature does not match the configured pubkey for ${sig.file}: ${verifyResult.error}`,
        );
        continue;
      }
      signatures.push({ path: resolve(sig.path), file: resolve(sig.file) });
    }
    if (errors.length > 0) {
      cleanup();
      return { ok: false, errors, signatures };
    }
    cleanup();
    return { ok: true, errors: [], signatures };
  } catch (error) {
    cleanup();
    return failHard(`unexpected signing failure: ${error.message}`);
  }
}

/**
 * Unsupported-tool branch: produce a valid Tauri-format updater signature
 * (base64 of the minisign signature text) via a small helper executable.
 * The helper only receives file paths, never key content.
 *
 * Protocol: `helper sign --key-file <f> [--password <pw>] --artifact <f> --out <f>`
 */
function materializeUnsupportedSignatures({ helperPath, keyFilePath, signingKeyPassword, artifacts }) {
  const out = [];
  for (const artifactPath of artifacts) {
    const sigPath = `${artifactPath}.sig`;
    const args = ["sign", "--key-file", keyFilePath, "--artifact", artifactPath, "--out", sigPath];
    if (signingKeyPassword) args.push("--password", signingKeyPassword);
    const r = spawnSync(helperPath, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      return failHard(
        `updater signature helper failed for ${artifactPath} (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 1000)}`,
      );
    }
    out.push({ path: sigPath, file: artifactPath });
  }
  return { ok: true, errors: [], signatures: out };
}

/**
 * Verify a produced signature against the configured pubkey using the same
 * helper executable (`verify --pubkey-b64 <b64> --signature-file <f>
 * --artifact <f>`). This is the same minisign verification the updater
 * plugin performs at install time (allow_legacy=true).
 */
function verifySignatureAgainstPubkey({ helperPath, pubkeyB64, signaturePath, artifactPath }) {
  if (!helperPath) {
    return { ok: false, error: "no signature helper configured for pubkey verification" };
  }
  const r = spawnSync(
    helperPath,
    ["verify", "--pubkey-b64", pubkeyB64, "--signature-file", signaturePath, "--artifact", artifactPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || "verification failed").trim().slice(0, 1000) };
  }
  return { ok: true, error: null };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "updater-sign.mjs — sign Tauri updater artifacts for a release build (Q-10)",
        "",
        "Usage:",
        "  node scripts/candice-release/updater-sign.mjs \\",
        "    --signing-key-env TAURI_SIGNING_PRIVATE_KEY \\",
        "    --pubkey-file <tauri.conf.json with the release pubkey> \\",
        "    --artifact <path> [--artifact <path> ...] \\",
        "    [--key-password-env TAURI_SIGNING_PRIVATE_KEY_PASSWORD] \\",
        "    [--out-signatures-dir <dir>] \\",
        "    [--tauri-signer-bin <path>] [--tauri-cli-dir <dir>] \\",
        "    [--verify-helper <updater-sign-helper binary>]",
        "",
        "Posture gate mode (CI smoke matrix, no signing):",
        "  node scripts/candice-release/updater-sign.mjs \\",
        "    --posture smoke|release [--config <tauri.conf.json>]",
        "",
        "The private key is never printed and never placed on a command line.",
        "Exit 0 on success; exit 1 on any failure (missing key, key/pubkey",
        "mismatch, missing artifact, signer failure).",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  // Q-10 posture gate mode (used by the CI smoke matrix): validate a config
  // file against one build posture without signing anything. Exit 0 only when
  // the config is honest for the named posture.
  const posture = argValue(argv, "--posture");
  if (posture !== undefined) {
    if (posture !== "smoke" && posture !== "release") {
      process.stderr.write(`updater-sign posture: unknown posture ${posture} (expected smoke or release)\n`);
      process.exit(1);
    }
    const confPath = argValue(argv, "--config") || DEFAULT_CONF_PATH;
    let conf;
    try {
      conf = JSON.parse(readFileSync(confPath, "utf8"));
    } catch (error) {
      process.stderr.write(`updater-sign posture: cannot read config ${confPath}: ${error.message}\n`);
      process.exit(1);
    }
    const result = validateBuildPosture(conf, posture);
    if (!result.ok) {
      for (const error of result.errors) process.stderr.write(`updater-sign posture: ${error}\n`);
      process.exit(1);
    }
    process.stdout.write(`updater-sign posture: ${posture} OK (${confPath})\n`);
    process.exit(0);
  }

  const signingKeyEnv = argValue(argv, "--signing-key-env") || "TAURI_SIGNING_PRIVATE_KEY";
  const passwordEnv = argValue(argv, "--key-password-env") || "TAURI_SIGNING_PRIVATE_KEY_PASSWORD";
  const pubkeyFile = argValue(argv, "--pubkey-file") || DEFAULT_CONF_PATH;
  const artifacts = argValues(argv, "--artifact");
  const outSignaturesDir = argValue(argv, "--out-signatures-dir");
  const tauriSignerBin = argValue(argv, "--tauri-signer-bin");
  const tauriCliDir = argValue(argv, "--tauri-cli-dir");
  const signatureHelper = argValue(argv, "--signature-helper");
  const verifyHelper = argValue(argv, "--verify-helper");

  const pubkeyInfo = readUpdaterPubkey(pubkeyFile);
  if (!pubkeyInfo.ok) {
    process.stderr.write(`updater-sign: ${pubkeyInfo.errors.join("; ")}\n`);
    process.exit(1);
  }

  const signingKey = process.env[signingKeyEnv] || "";
  const password = passwordEnv ? process.env[passwordEnv] || "" : "";

  const result = signUpdaterArtifacts({
    signingKey,
    signingKeyPassword: password,
    pubkeyB64: pubkeyInfo.pubkey,
    artifacts,
    outSignaturesDir,
    tauriSignerBin,
    tauriCliDir,
    signatureHelper,
    verifyHelper,
  });
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`updater-sign: ${error}\n`);
    process.exit(1);
  }
  for (const sig of result.signatures) {
    process.stdout.write(`updater-sign: ${sig.file} -> ${sig.path}\n`);
  }
  process.stdout.write(
    `updater-sign: ${result.signatures.length} artifact(s) signed for the release updater key (pubkey source: ${pubkeyFile})\n`,
  );
  process.exit(0);
}

function isMainModule() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) main();
