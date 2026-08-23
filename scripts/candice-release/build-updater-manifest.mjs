#!/usr/bin/env node
/**
 * build-updater-manifest.mjs — Q-10 updater release manifest (latest.json).
 *
 * Emits the static-format manifest the tauri-plugin-updater consumes
 * (plugin v2: `version` + `platforms.<target> { url, signature }`, verified
 * against the plugin source deserializer). Each platform entry must carry
 * the exact `.sig` payload produced by `updater-sign.mjs`.
 *
 * The manifest is keyed on the release URL root; the URL in the manifest
 * must live under the same candice-v* tag namespace enforced by
 * RELEASE-PROTECTION.md, so the manifest can only advertise content inside
 * the release it is attached to.
 *
 * Usage:
 *   node scripts/candice-release/build-updater-manifest.mjs \
 *     --root <repository-root> \
 *     --out <path> \
 *     --artifact-url-root <https://github.com/.../releases/download/candice-v1.0.0> \
 *     --platform darwin-aarch64 --artifact <path-to.tar.gz> [--signature <path-to.tar.gz.sig>] \
 *     [--platform darwin-x86_64 --artifact <...>] \
 *     [--notes <release notes>] [--pub-date <RFC3339>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argPairs(args, nameA, nameB) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === nameA && args[i + 1] !== undefined && args[i + 2] === nameB && args[i + 3] !== undefined) {
      out.push([args[i + 1], args[i + 3]]);
      i += 3;
    }
  }
  return out;
}

const CANDICE_TAG_NAMESPACE = /candice-v\d/;

export function buildUpdaterManifest({
  version,
  artifactUrlRoot,
  platforms,
  notes = "",
  pubDate = null,
}) {
  const errors = [];
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    errors.push("version must be a semantic version string (the plugin parses it strictly)");
  }
  if (typeof artifactUrlRoot !== "string" || !/^https:\/\//.test(artifactUrlRoot)) {
    errors.push("artifact URL root must be an https URL");
  }
  if (!Array.isArray(platforms) || platforms.length === 0) {
    errors.push("at least one platform entry is required");
  } else {
    const seen = new Set();
    for (const entry of platforms) {
      if (!entry || !/^[a-z0-9_]+-[a-z0-9_]+$/.test(entry.target || "")) {
        errors.push(`platform entry ${JSON.stringify(entry)} has a malformed target`);
        continue;
      }
      if (seen.has(entry.target)) {
        errors.push(`duplicate platform target: ${entry.target}`);
        continue;
      }
      seen.add(entry.target);
      if (typeof entry.file !== "string" || entry.file.length === 0) {
        errors.push(`platform ${entry.target} has no artifact file name`);
      }
      if (typeof entry.signature !== "string" || entry.signature.length === 0) {
        errors.push(`platform ${entry.target} has no signature (unsigned updater content is never advertised)`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors, manifest: null };

  const urlRoot = artifactUrlRoot.replace(/\/+$/, "");
  const urlPath = (() => {
    try {
      return new URL(urlRoot).pathname;
    } catch {
      return "";
    }
  })();
  if (!CANDICE_TAG_NAMESPACE.test(urlPath)) {
    return {
      ok: false,
      errors: [
        `artifact URL root ${urlRoot} is outside the enforced candice-v* tag namespace (RELEASE-PROTECTION.md); a release manifest can only advertise content inside its own release`,
      ],
      manifest: null,
    };
  }

  const platformsObject = {};
  for (const entry of platforms) {
    platformsObject[entry.target] = {
      url: `${urlRoot}/${entry.file}`,
      signature: entry.signature,
    };
  }

  const manifest = { version };
  if (notes) manifest.notes = notes;
  if (pubDate) manifest.pub_date = pubDate;
  manifest.platforms = platformsObject;

  return { ok: true, errors, manifest };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "build-updater-manifest.mjs — emit the Tauri updater latest.json (Q-10)",
        "",
        "Usage:",
        "  node scripts/candice-release/build-updater-manifest.mjs \\",
        "    --version 1.0.0-rc.1 \\",
        "    --artifact-url-root <https://.../releases/download/candice-v1.0.0-rc.1> \\",
        "    --platform darwin-aarch64 --artifact <app.tar.gz> [--signature <app.tar.gz.sig>] \\",
        "    [--notes <release notes>] [--pub-date <RFC3339>] \\",
        "    --out <path>",
        "",
        "Platform entries repeat; signatures default to <artifact>.sig.",
        "Exit 0 on success.",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  const version = argValue(argv, "--version");
  const artifactUrlRoot = argValue(argv, "--artifact-url-root");
  const out = argValue(argv, "--out");
  const notes = argValue(argv, "--notes") || "";
  const pubDate = argValue(argv, "--pub-date") || null;
  const rawPairs = argPairs(argv, "--platform", "--artifact");
  const sigOverrides = argPairs(argv, "--platform", "--signature");
  const sigByTarget = Object.fromEntries(sigOverrides.map(([target, sigPath]) => [target, sigPath]));

  if (!version || !artifactUrlRoot || !out || rawPairs.length === 0) {
    process.stderr.write(
      "build-updater-manifest: --version, --artifact-url-root, --out, and at least one --platform/--artifact pair are required\n",
    );
    process.exit(2);
  }

  const platforms = [];
  for (const [target, artifactPath] of rawPairs) {
    const resolvedArtifact = resolve(artifactPath);
    if (!existsSync(resolvedArtifact)) {
      process.stderr.write(`build-updater-manifest: artifact not found: ${resolvedArtifact}\n`);
      process.exit(2);
    }
    const sigPath = resolve(sigByTarget[target] || `${resolvedArtifact}.sig`);
    if (!existsSync(sigPath)) {
      process.stderr.write(`build-updater-manifest: signature not found for ${target}: ${sigPath}\n`);
      process.exit(2);
    }
    platforms.push({
      target,
      file: basename(resolvedArtifact),
      signature: readFileSync(sigPath, "utf8").trim(),
    });
  }

  const result = buildUpdaterManifest({ version, artifactUrlRoot, platforms, notes, pubDate });
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`build-updater-manifest: ${error}\n`);
    process.exit(1);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(result.manifest, null, 2)}\n`);
  process.stdout.write(`build-updater-manifest: wrote ${out} (${platforms.length} platform(s))\n`);
  process.exit(0);
}

function isMainModule() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
  } catch {
    return false;
  }
}

if (isMainModule()) main();
