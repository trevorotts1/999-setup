#!/usr/bin/env node
/**
 * Deterministic SPDX SBOM generator for Candice Companion (FIX-023 F23-05,
 * plan layer 6).
 *
 * Emits one SPDX 2.3 JSON document whose component list is exactly:
 *   - every npm package in apps/candice-companion/package-lock.json
 *   - every crate in the seven Cargo.lock trees (merged across trees;
 *     the same name@version from several trees is one component, with the
 *     tree list recorded in its comment)
 *   - the pinned STT runtime manifests (bundled-model.json, windows-runtime.json):
 *     whisper.cpp runtime, the pinned model weight, the release archives, and
 *     every per-file archive entry
 *
 * Determinism contract: no network, no clock, no randomness, no filesystem
 * order. Component order and JSON key order are sorted; the document
 * namespace and creation date derive from the git HEAD commit (stable for a
 * given checkout). Two runs on the same checkout emit byte-identical output
 * — that is the FIX-023 acceptance check.
 *
 * Fail-closed: any required input missing or unparseable exits nonzero.
 *
 * License provenance: npm licenses are taken from the lockfile's own
 * `license` fields (missing => NOASSERTION). Crate licenses are NOT read
 * from registry metadata here (cargo metadata would require index state);
 * they are gated by the cargo-deny license allow-list in deny.toml, which
 * runs as a required CI step and exits 0 on all seven trees as of the
 * FIX-023 supply-chain commit. The license inventory lives in
 * CONTROL/crate-tree-ownership.md and the exception registry in
 * CONTROL/dependency-exceptions.md. The pinned runtime files are MIT
 * (whisper.cpp 1.9.2 — recorded in the manifests and tts/NOTICE.md).
 *
 * The Python TTS worker chain (phonemizer/espeak-ng) is not in this SBOM: it
 * is a fetch-at-install GPL worker boundary governed by
 * apps/candice-companion/src-tauri/tts/NOTICE.md, with its pip wheel hashes
 * pinned in src-tauri/tts/scripts/requirements.lock (uv, deterministic).
 *
 * Usage:
 *   node scripts/candice-release/sbom.mjs [--root <repository-root>] [--out <file>]
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_DIR = join(scriptRoot, "apps", "candice-companion");
const MANIFEST_DIR = join(APP_DIR, "src-tauri", "stt", "runtime", "manifests");
const CARGO_TREES = [
  "src-tauri",
  "src-tauri/audio/capture",
  "src-tauri/audio/capture-windows",
  "src-tauri/permissions",
  "src-tauri/binding/macos",
  "src-tauri/binding/windows",
  "scripts/package-macos/signature-helper",
];

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed in ${root}: ${error.message}`);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function spdxId(name, version, taken) {
  // Scoped names carry `@` and `/`, both stripped by the sanitizer, so
  // distinct names can sanitize to one base (e.g. `@a/b@1.0.0` and
  // `a-b@1.0.0` both become `a-b-1.0.0`). Salt the base with a short hash
  // of the exact `name@version` string to make ids collision-safe without
  // changing the id of any existing unscoped package (Q-08).
  const exact = `${String(name)}@${String(version)}`;
  const clean = String(name).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+/, "");
  const suffix = /[^A-Za-z0-9.-]/.test(String(name))
    ? `-${sha256Hex(exact).slice(0, 8)}`
    : "";
  const base = `SPDXRef-Package-${clean}-${String(version).replace(/[^A-Za-z0-9.-]+/g, "-")}${suffix}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

function integrityToHex(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity || "");
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64").toString("hex");
  } catch {
    return null;
  }
}

function readRequired(path, label) {
  if (!existsSync(path)) {
    throw new Error(`required ${label} missing: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`required ${label} unparseable: ${path} (${error.message})`);
  }
}

/**
 * npm package identity from one package-lock `packages` entry.
 * name/version/lock entry stay separate data: name is never re-derived from
 * a `name@version` string, so scoped names survive intact (Q-08).
 */
function npmIdentity(path, entry, rootPackageJson) {
  // lockfileVersion 3 entries usually omit `name`; the installed path is the
  // canonical name (node_modules/@scope/pkg keeps the scope as one segment).
  // Scoped path form must be matched BEFORE the plain-leaf fallback: the leaf
  // of node_modules/@scope/pkg is `pkg` and must never win (Q-08).
  const parts = path.split("/");
  const isRoot = path === "";
  const scoped = parts[0] === "node_modules" && parts[1]?.startsWith("@") && parts.length >= 3
    ? `${parts[1]}/${parts[2]}`
    : undefined;
  const name = (isRoot && rootPackageJson?.name)
    || (typeof entry.name === "string" && entry.name)
    || scoped
    || (/^node_modules\//.test(path) ? parts[parts.length - 1] : undefined);
  return name ? { name, version: entry.version, entry, path } : null;
}

function npmComponents(packageJson, lock) {
  const components = [];
  const byKey = new Map();
  const rootEntry = lock.packages[""];
  if (rootEntry?.version) {
    const rootId = npmIdentity("", rootEntry, packageJson);
    if (rootId) {
      byKey.set(`${rootId.name}@${rootId.version}`, { ...rootId, path: "" });
    }
  }
  for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (path === "") continue;
    const id = npmIdentity(path, entry, packageJson);
    if (!id || !id.version) continue;
    const key = `${id.name}@${id.version}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...id, path });
    }
  }
  // Single source of truth for the component loop: iterate the lockfile
  // itself, never a re-parsed name@version key (Q-08).
  const lockEntries = [];
  for (const key of [...byKey.keys()].sort()) {
    lockEntries.push({ key, ...byKey.get(key) });
  }
  for (const { key, name, version, entry } of lockEntries) {
    const component = {
      name,
      SPDXID: "PLACEHOLDER",
      versionInfo: version,
      downloadLocation: entry.resolved || "NOASSERTION",
      licenseConcluded: typeof entry.license === "string" && entry.license ? entry.license : "NOASSERTION",
      licenseDeclared: typeof entry.license === "string" && entry.license ? entry.license : "NOASSERTION",
    };
    const hex = integrityToHex(entry.integrity);
    if (hex) component.checksums = [{ algorithm: "SHA512", checksumValue: hex }];
    components.push({ key, component });
  }
  return components;
}

function parseCargoLock(path) {
  if (!existsSync(path)) {
    throw new Error(`required Cargo.lock missing: ${path}`);
  }
  const text = readFileSync(path, "utf8");
  const blocks = text.split(/^\[\[package\]\]$/m).slice(1);
  const crates = [];
  for (const block of blocks) {
    const name = /^name = "([^"]+)"/m.exec(block);
    const version = /^version = "([^"]+)"/m.exec(block);
    const source = /^source = "([^"]+)"/m.exec(block);
    const checksum = /^checksum = "([^"]+)"/m.exec(block);
    if (!name || !version) continue;
    crates.push({
      name: name[1],
      version: version[1],
      source: source ? source[1] : null,
      checksum: checksum ? checksum[1] : null,
    });
  }
  return crates;
}

function cargoComponents() {
  const byKey = new Map();
  for (const tree of CARGO_TREES) {
    const lockPath = join(APP_DIR, tree, "Cargo.lock");
    for (const crate of parseCargoLock(lockPath)) {
      const key = `${crate.name}@${crate.version}`;
      if (!byKey.has(key)) byKey.set(key, { crate, trees: [] });
      byKey.get(key).trees.push(tree);
    }
  }
  const components = [];
  for (const [key, { crate, trees }] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const component = {
      name: crate.name,
      SPDXID: "PLACEHOLDER",
      versionInfo: crate.version,
      downloadLocation: crate.source?.startsWith("registry+")
        ? `https://crates.io/api/v1/crates/${crate.name}/${crate.version}/download`
        : "NOASSERTION",
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      comment: `license gated by deny.toml allow-list (cargo-deny required CI step); cargo.lock trees: ${[...trees].sort().join(", ")}`,
    };
    if (crate.checksum) component.checksums = [{ algorithm: "SHA256", checksumValue: crate.checksum }];
    components.push({ key: `cargo:${key}`, component });
  }
  return components;
}

function pinnedComponents() {
  const bundled = readRequired(join(MANIFEST_DIR, "bundled-model.json"), "bundled-model.json");
  const windows = readRequired(join(MANIFEST_DIR, "windows-runtime.json"), "windows-runtime.json");
  const components = [];

  components.push({
    key: "pinned:whisper-cpp@1.9.2",
    component: {
      name: "whisper.cpp",
      SPDXID: "PLACEHOLDER",
      versionInfo: String(bundled.runtime?.version || "1.9.2"),
      downloadLocation: bundled.runtime?.canonicalRepo || "NOASSERTION",
      licenseConcluded: "MIT",
      licenseDeclared: "MIT",
      comment: "pinned STT runtime; per-platform hashes in windows-runtime.json and bundled-model.json",
    },
  });

  const model = bundled.model;
  if (!model?.name || !model.sha256) {
    throw new Error("bundled-model.json missing model name/sha256");
  }
  components.push({
    key: `pinned:${model.name}`,
    component: {
      name: model.name,
      SPDXID: "PLACEHOLDER",
      versionInfo: "pinned",
      downloadLocation: model.source || "NOASSERTION",
      licenseConcluded: model.license || "NOASSERTION",
      licenseDeclared: model.license || "NOASSERTION",
      checksums: [{ algorithm: "SHA256", checksumValue: model.sha256 }],
      comment: `sizeBytes ${model.sizeBytes}; bundled with app, installer verifies sha256 before load`,
    },
  });

  const seenFiles = new Set();
  const addFile = (label, sha256, archive) => {
    if (!sha256) return;
    const key = `pinned-file:${label}:${sha256}`;
    if (seenFiles.has(key)) return;
    seenFiles.add(key);
    components.push({
      key,
      component: {
        name: label,
        SPDXID: "PLACEHOLDER",
        versionInfo: "1.9.2",
        downloadLocation: archive?.source || "NOASSERTION",
        licenseConcluded: "MIT",
        licenseDeclared: "MIT",
        checksums: [{ algorithm: "SHA256", checksumValue: sha256 }],
        comment: "whisper.cpp release archive or contained file (windows-runtime.json pin)",
      },
    });
  };

  for (const key of Object.keys(windows).filter((k) => k.startsWith("archive")).sort()) {
    const archive = windows[key];
    addFile(archive.file || key, archive.sha256, archive);
  }
  for (const key of ["filesX64", "filesWin32"]) {
    for (const [file, sha256] of Object.entries(windows[key] || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      addFile(file, sha256, windows[key === "filesX64" ? "archiveX64" : "archiveWin32"]);
    }
  }
  return components;
}

export { npmComponents, npmIdentity, spdxId };
export function generateSbom(root = scriptRoot) {
  const appDir = join(root, "apps", "candice-companion");
  const manifestDir = join(appDir, "src-tauri", "stt", "runtime", "manifests");
  const packageJson = readRequired(join(appDir, "package.json"), "package.json");
  const lock = readRequired(join(appDir, "package-lock.json"), "package-lock.json");
  const headSha = git(root, ["rev-parse", "HEAD"]);
  const created = git(root, ["show", "-s", "--format=%cI", "HEAD"]);

  const taken = new Set();
  const all = [...npmComponents(packageJson, lock), ...cargoComponents(), ...pinnedComponents()];
  const packages = [];
  for (const { key, component } of [...all].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    component.SPDXID = spdxId(component.name, component.versionInfo, taken);
    packages.push(component);
  }

  const rootId = "SPDXRef-Package-candice-companion";
  taken.add(rootId);
  packages.unshift({
    name: "candice-companion",
    SPDXID: rootId,
    versionInfo: packageJson.version,
    downloadLocation: "NOASSERTION",
    licenseConcluded: "MIT",
    licenseDeclared: "MIT",
    comment: "first-party app package; repository root LICENSE is MIT",
  });

  const relationships = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: rootId,
    },
  ];
  for (const pkg of packages.slice(1)) {
    const bundled = pkg.name === "whisper.cpp"
      || pkg.comment?.includes("bundled with app")
      || pkg.comment?.includes("release archive or contained file");
    relationships.push({
      spdxElementId: rootId,
      relationshipType: bundled ? "CONTAINS" : "DEPENDS_ON",
      relatedSpdxElement: pkg.SPDXID,
    });
  }

  const document = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `Candice-Companion-${packageJson.version}-SPDX`,
    documentNamespace: `https://spdx.candice.local/Candice-Companion-${packageJson.version}-${headSha}`,
    creationInfo: {
      created,
      creators: [
        "Organization: BlackCEO",
        "Tool: scripts/candice-release/sbom.mjs",
      ],
    },
    packages,
    relationships: relationships.sort((a, b) => (a.relatedSpdxElement < b.relatedSpdxElement ? -1 : a.relatedSpdxElement > b.relatedSpdxElement ? 1 : 0)),
  };
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const root = resolve(argValue(args, "--root") || scriptRoot);
  const out = argValue(args, "--out");
  try {
    const sbom = generateSbom(root);
    if (out) {
      writeFileSync(out, sbom);
      console.log(`SBOM written: ${out}`);
    } else {
      process.stdout.write(sbom);
    }
  } catch (error) {
    console.error(`SBOM FAILED: ${error.message}`);
    process.exit(1);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) main();
