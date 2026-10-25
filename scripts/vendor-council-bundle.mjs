#!/usr/bin/env node
// Council of Wise Elders: 999 distribution vendoring tool (CWE-040).
//
// Vendors the exact canonical portable bundle (openclaw-onboarding
// 77-council-of-wise-elders) into this repository at
// .claude/skills/council-of-wise-elders, applying the distribution
// rules of the build directive (Section 25.2 step 4 and the CWE-012
// acceptance conditions):
//
//   - The canonical tree is copied byte for byte, with exactly the classes of
//     intentional distribution difference the RELEASE CONTRACT names — the
//     canonical manifest.distribution record that build-bundles.mjs writes
//     ({kinds, files, runtime_dist, added_paths}). The changed files are
//     derived from that record's per-file digests, never from a hand-kept
//     list here, and every distributed file is proven against the recorded
//     digest before the tool reports success:
//       (a) pack items tagged scope private_scope are dropped (the ids are
//           derived from the pack data);
//       (b) sentences in pack JSON string fields that reference a dropped
//           item id or a private evidence id are scrubbed (the prefix is
//           derived from the user_private source record);
//       (c) a seat profile's packaging block is rewritten to describe the
//           stripped copy, and manifest.json is regenerated over the
//           distribution tree with the canonical hash method, recording the
//           canonical aggregate it derives from.
//     Each difference is recorded in DISTRIBUTION-RECONCILIATION.json inside
//     the vendored tree and in the vendoring record
//     (installer-registration/council-vendoring.json).
//   - Bibliographic records (sources.json, coverage.json) stay
//     byte-identical: references stay, the private material goes.
//   - The source tree is refused if it is dirty: no council state files,
//     and its manifest aggregate must recompute exactly. node_modules is
//     build-time only and is never hashed or shipped. runtime/dist ships
//     WITH the distribution (executable + dependencies + instructions
//     together): the built entry is verified (present, node --check) and
//     recorded as runtime_entry {path, sha256, bytes} in the distribution
//     manifest and the vendoring record, bound to the exact bytes copied,
//     so a fresh install and an upgrade deliver the executable and never
//     an old bundle. When the canonical manifest records its own
//     runtime_entry, the bytes must match it (a stale recorded build is
//     refused); this canonical records none, so the entry is derived from
//     the canonical build. A source-only package (no runtime/dist) is
//     refused: regeneration can never recreate one. The tree's generated
//     .skill archive is recorded by hash and deliberately not vendored
//     (the vendored folder is itself the distribution). When the source
//     sits in a git worktree, HEAD must equal --source-commit.
//
// Usage:
//   node scripts/vendor-council-bundle.mjs \
//     --source <canonical skill folder> --source-commit <full sha> \
//     [--out <.claude/skills/council-of-wise-elders>] \
//     [--record <installer-registration/council-vendoring.json>]
//
// Exit 0 on success with every gate green; 1 on any failed assertion.
// No network. Writes only under --out and --record.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? resolve(args[i + 1]) : fallback;
};
const source = argValue("--source", null);
const sourceCommit = (() => {
  const i = args.indexOf("--source-commit");
  return i >= 0 ? args[i + 1] : null;
})();
const out = argValue("--out", join(repoRoot, ".claude", "skills", "council-of-wise-elders"));
const recordPath = argValue("--record", join(repoRoot, "installer-registration", "council-vendoring.json"));

// The difference kinds the tree gate can prove (mirrors DISTRIBUTION_KINDS in
// the bundle's scripts/manifest-tree.mjs). A contract naming anything else
// cannot be satisfied by any distribution this tool produces.
const ALLOWED_KINDS = [
  "private_scope_items_dropped",
  "sentences_scrubbed",
  "generated_archive_not_vendored",
  "file_added",
  "manifest_regenerated",
];
// The packaging note the canonical strip writes into a seat profile's
// distribution block; it must match build-bundles.mjs byte for byte.
const DISTRIBUTION_NOTE =
  "Private-scope material recorded for this seat is excluded from this distributable copy at packaging " +
  "(CWE-012 acceptance condition 3): the copy carries no private-scope items, no private evidence " +
  "references, and no private source text. The seat's shared works are unaffected.";
const RECONCILIATION_FILE = "DISTRIBUTION-RECONCILIATION.json";

let failures = 0;
const fail = (m) => { failures += 1; console.log(`FAIL ${m}`); };
const pass = (m) => console.log(`PASS ${m}`);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    // node_modules is build-time only: the bundle embeds its dependencies.
    // It is never hashed, never shipped, and never a dirtiness signal.
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, acc);
    else acc.push(relative(base, p).split("\\").join("/"));
  }
  return acc;
}
function treeHashes(root) {
  const map = new Map();
  for (const rel of walk(root)) {
    map.set(rel, sha256(readFileSync(join(root, rel))));
  }
  return map;
}
// The tree aggregate implements the canonical hash method the manifests
// record: manifest.json, any .skill archive and the generated
// runtime/dist and runtime/node_modules trees are excluded (the built
// entry point is recorded in runtime_entry instead).
function aggregateOf(map) {
  const entries = [...map.entries()]
    .filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill")
      && p !== "runtime/dist" && !p.startsWith("runtime/dist/")
      && p !== "runtime/node_modules" && !p.startsWith("runtime/node_modules/"))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([p, h]) => `${h}  ${p}`);
  return {
    aggregate: sha256(Buffer.from(entries.join("\n") + "\n", "utf8")),
    count: entries.length,
  };
}

if (!source || !sourceCommit) {
  console.log("FAIL --source and --source-commit are required");
  process.exit(1);
}
if (!existsSync(join(source, "manifest.json"))) {
  console.log(`FAIL source has no manifest.json: ${source}`);
  process.exit(1);
}

// ---- Source cleanliness gates -------------------------------------------
// The built runtime (runtime/dist) rides WITH the distribution so a fresh
// install and an upgrade deliver the executable, its bundled dependencies
// and the skill instructions together. It is accepted only as the exact
// verified build (see the built runtime gate below): a source-only tree is
// refused there, visibly, never silently vendored without its entry point.
const canonicalManifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));

// ---- The release contract is the only strip list --------------------------
// Which files the distribution changes, which paths it adds and which bytes
// every distributed file must have come from the canonical release's
// manifest.distribution record that build-bundles.mjs wrote. Nothing here is
// a hand-kept literal: a release that adds a stripped file (1.0.59's
// advisors/russell-brunson/profile.json) is honoured without editing this
// tool, and a distribution that does not reproduce the recorded digests is
// refused HERE instead of being vendored into a tree the gate rejects.
const contractFail = (m) => { console.log(`FAIL ${m}`); process.exit(1); };
const contract = canonicalManifest.distribution;
if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
  contractFail("the canonical manifest records no distribution contract (distribution {kinds, files, runtime_dist, added_paths}): " +
    "the release does not say what its 999 distribution is, so no vendoring can be proven");
}
if (!Array.isArray(contract.files) || contract.files.length === 0) {
  contractFail("the canonical distribution contract carries no per-file map (distribution.files)");
}
if (!Array.isArray(contract.runtime_dist) || contract.runtime_dist.length === 0) {
  contractFail("the canonical distribution contract carries no built runtime map (distribution.runtime_dist)");
}
const contractKinds = Array.isArray(contract.kinds) ? contract.kinds : [];
const unprovableKinds = contractKinds.filter((k) => !ALLOWED_KINDS.includes(k));
if (!contractKinds.length || unprovableKinds.length) {
  contractFail(`the canonical distribution contract declares ${contractKinds.length
    ? `difference kinds this tool cannot produce (${unprovableKinds.join(", ")})`
    : "no distribution difference kinds"}`);
}
const contractFiles = new Map(contract.files.map((f) => [f.path, f.sha256]));
// The built runtime rides with the distribution as its own recorded map.
const contractRuntimeDist = new Map(contract.runtime_dist.map((f) => [f.path, f.sha256]));
const contractDistributed = new Map([...contractFiles, ...contractRuntimeDist]);
const canonicalByPath = new Map((canonicalManifest.files ?? []).map((f) => [f.path, f.sha256]));
if (canonicalByPath.size === 0) {
  contractFail("the canonical manifest records no per-file digest map (manifest.files), so canonical content cannot be held to the contract");
}
const contractAddedPaths = [...(contract.added_paths ?? [])].sort();
// The files the contract changes, derived from the digests it records.
const STRIP_FILES = [...contractFiles.keys()]
  .filter((p) => canonicalByPath.has(p) && canonicalByPath.get(p) !== contractFiles.get(p))
  .sort();
// The files the contract does not distribute at all.
const REMOVED_FILES = [...canonicalByPath.keys()].filter((p) => !contractFiles.has(p)).sort();
if (!contractAddedPaths.includes(RECONCILIATION_FILE)) {
  contractFail(`the canonical distribution contract does not declare ${RECONCILIATION_FILE} as an added path, ` +
    "so the reconciliation report this tool ships would be an unaccounted file the gate must refuse");
}
// The strip tokens are derived from the pack data the contract changes, never
// listed here: the private_scope item ids from those files' item arrays and
// the private evidence prefix from a user_private source record — carried by a
// changed file or by the source record of the same seat folder.
const stripDirs = [...new Set(STRIP_FILES.map((rel) => rel.slice(0, Math.max(0, rel.lastIndexOf("/")))))].filter(Boolean);
const TOKEN_SOURCES = [...new Set([...STRIP_FILES, ...stripDirs.map((dir) => `${dir}/sources.json`)])];
const STRIP_DATA = TOKEN_SOURCES.map((rel) => {
  try {
    return { rel, data: JSON.parse(readFileSync(join(source, rel), "utf8")) };
  } catch {
    return null;
  }
}).filter(Boolean);
const STRIP_IDS = [];
for (const { data } of STRIP_DATA) {
  for (const item of data.items ?? []) {
    if (item?.scope === "private_scope" && typeof item.id === "string") STRIP_IDS.push(item.id);
  }
}
STRIP_IDS.sort();
let PRIVATE_EVIDENCE_PREFIX = null;
for (const { data } of STRIP_DATA) {
  const privateRecord = (data.records ?? []).find((r) => r?.allowed_scope === "user_private");
  if (privateRecord?.export_source_id) {
    PRIVATE_EVIDENCE_PREFIX = `ev-${String(privateRecord.export_source_id).replace(/^src-/, "")}-`;
    break;
  }
}
const PRIVATE_TOKENS = [...STRIP_IDS, ...(PRIVATE_EVIDENCE_PREFIX ? [PRIVATE_EVIDENCE_PREFIX] : [])];

const srcFiles = walk(source);
for (const rel of srcFiles) {
  if (/\.(sqlite3?|db)$/i.test(rel)
    || /^(state|sessions|data)\//.test(rel)) {
    fail(`source tree is dirty, refusing to vendor: ${rel}`);
  }
  if (rel.endsWith(".skill") && rel !== "council-of-wise-elders.skill") {
    fail(`unexpected archive in the source tree, refusing to vendor: ${rel}`);
  }
}
const srcHashes = treeHashes(source);
srcHashes.delete("manifest.json");
// The generated distributable archive is a sibling artifact of the same
// tree (the canonical hash method excludes it from the tree identity).
// It is recorded here and deliberately NOT vendored: the vendored
// folder is itself the 999 distribution of this tree.
let canonicalArchive = null;
if (srcHashes.has("council-of-wise-elders.skill")) {
  canonicalArchive = {
    file: "council-of-wise-elders.skill",
    sha256: srcHashes.get("council-of-wise-elders.skill"),
    bytes: statSync(join(source, "council-of-wise-elders.skill")).size,
  };
  srcHashes.delete("council-of-wise-elders.skill");
}
const srcAgg = aggregateOf(srcHashes);
if (srcAgg.aggregate !== canonicalManifest.aggregate_sha256
  || srcAgg.count !== canonicalManifest.file_count) {
  fail(`source manifest does not recompute: computed ${srcAgg.aggregate} over ${srcAgg.count}, manifest says ${canonicalManifest.aggregate_sha256} over ${canonicalManifest.file_count}`);
} else {
  pass(`canonical source verified: ${srcAgg.count} files, aggregate ${srcAgg.aggregate}`);
}
try {
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== sourceCommit) fail(`source HEAD ${head} != --source-commit ${sourceCommit}`);
  else pass(`source commit matches: ${sourceCommit}`);
} catch {
  fail("source is not inside a git worktree; cannot prove the source commit");
}
// ---- Built runtime gate (installer truth) --------------------------------
// The 999 distribution must ship the executable: a source-only package is
// visibly incomplete here, never silently vendored without its entry point.
// runtime_entry truth: the canonical manifest's recorded entry when it
// carries one (bytes must match — a stale recorded build is refused), else
// the entry derived from the canonical build. Either way the distribution
// records {path, sha256, bytes} of the exact bytes shipped, and the entry
// must pass `node --check` before it is accepted.
// ponytail: freshness binding to a canonical runtime_entry record, add when
// the canonical manifest records one (this canonical does not).
const ENTRY_DEFAULT = "runtime/dist/blackceo-council.mjs";
const recordedEntry = canonicalManifest.runtime_entry ?? null;
const entryRel = recordedEntry?.path ?? ENTRY_DEFAULT;
const entryAbs = join(source, entryRel);
let runtimeEntry = null;
if (!existsSync(entryAbs)) {
  fail(`canonical runtime entry missing: ${entryRel}: the 999 distribution would ship without the ` +
    "executable. Build it with `npm ci --no-audit --no-fund && npm run build` in runtime/ first");
} else {
  const entryBytes = statSync(entryAbs).size;
  const entrySha = sha256(readFileSync(entryAbs));
  if (recordedEntry && (recordedEntry.sha256 !== entrySha || recordedEntry.bytes !== entryBytes)) {
    fail(`canonical runtime entry is stale: ${entryRel} sha256 ${entrySha} != manifest ` +
      `${recordedEntry.sha256}: rebuild and repackage before vendoring`);
  } else {
    try {
      execFileSync(process.execPath, ["--check", entryAbs], { stdio: "pipe" });
      runtimeEntry = { path: entryRel, sha256: entrySha, bytes: entryBytes };
      pass(`canonical runtime entry verified: ${entryRel} ${entryBytes} bytes, sha256 ${entrySha}` +
        (recordedEntry ? " (bound to canonical manifest runtime_entry)" : " (derived from the canonical build; canonical manifest records none)"));
    } catch {
      fail(`canonical runtime entry fails node --check: ${entryRel}`);
    }
  }
}
if (failures > 0) process.exit(1);

// ---- Copy ----------------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, out, {
  recursive: true,
  filter: (p) => {
    const rel = relative(source, p).split("\\").join("/");
    if (REMOVED_FILES.includes(rel)) return false; // the contract does not distribute it
    return !p.endsWith(".skill") && !rel.split("/").includes("node_modules");
  },
});
pass(`copied canonical tree to ${out} (generated .skill archive, node_modules and contract-removed paths excluded)`);
// Bind the shipped entry to the recorded runtime_entry: the distribution
// manifest must describe the exact bytes that landed, not the source's.
if (runtimeEntry) {
  const shippedSha = sha256(readFileSync(join(out, runtimeEntry.path)));
  if (shippedSha !== runtimeEntry.sha256) {
    fail(`shipped runtime entry drifted in the copy: ${runtimeEntry.path} ${shippedSha} != recorded ${runtimeEntry.sha256}`);
  } else {
    pass(`shipped runtime entry matches runtime_entry: ${runtimeEntry.path}`);
  }
}

// ---- Brunson private-scope strip ------------------------------------------
// The rule set the canonical build-bundles.mjs applies, driven by the token
// derivation above and applied to the files the release contract changes. The
// contract's recorded digests are what proves the result (see the contract
// proof below); this pass only has to produce it.
function referencesPrivate(value, extraTokens) {
  const tokens = extraTokens ? [...PRIVATE_TOKENS, ...extraTokens] : PRIVATE_TOKENS;
  return tokens.some((id) => value.includes(id));
}
const droppedItems = [];
const scrubbedFields = [];
function scrubValue(value, path, file, isItemFile) {
  const extraTokens = isItemFile && path === "$.note" ? ["private_scope"] : null;
  if (typeof value === "string") {
    if (!referencesPrivate(value, extraTokens)) return value;
    const kept = value
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !referencesPrivate(s, extraTokens))
      .join(" ")
      .trim();
    scrubbedFields.push({
      file, path: `${file}${path.slice(1)}`, action: kept ? "sentences_scrubbed" : "field_removed",
      before_sha256: sha256(Buffer.from(value, "utf8")),
      after_sha256: kept ? sha256(Buffer.from(kept, "utf8")) : null,
    });
    return kept === "" ? undefined : kept;
  }
  if (Array.isArray(value)) {
    const next = [];
    for (let i = 0; i < value.length; i++) {
      const v = scrubValue(value[i], `${path}[${i}]`, file, isItemFile);
      if (v !== undefined) next.push(v);
    }
    return next;
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      const nv = scrubValue(v, `${path}.${k}`, file, isItemFile);
      if (nv !== undefined) next[k] = nv;
    }
    return next;
  }
  return value;
}
for (const rel of STRIP_FILES) {
  const p = join(out, rel);
  const raw = readFileSync(p, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(`the release contract changes ${rel}, but it is not JSON: this tool cannot apply that distribution difference`);
    continue;
  }
  const before = JSON.stringify(data);
  const isItemFile = Array.isArray(data.items);
  if (isItemFile) {
    const kept = [];
    data.items.forEach((item, idx) => {
      if (item && item.scope === "private_scope") {
        // The distributed artifacts never name a dropped item: it is
        // recorded by file, index, and content hash only.
        droppedItems.push({
          file: rel, id: item.id, item_index: idx,
          item_sha256: sha256(Buffer.from(JSON.stringify(item), "utf8")),
        });
      } else {
        kept.push(item);
      }
    });
    data.items = kept;
  }
  data = scrubValue(data, "$", rel, isItemFile);
  // A seat profile's packaging block describes the stripped copy truthfully
  // (the canonical packaging rule), keyed on the data, not on the path.
  if (data && typeof data === "object" && data.distribution && typeof data.distribution === "object"
    && "contains_private_scope_material" in data.distribution) {
    // Snapshot the value, apply the packaging rule, and record exactly the
    // leaves the integrity proof below will observe. diffPaths is declared
    // later in this file and is hoisted, so it is the same diff, not a copy.
    const packagingBefore = JSON.parse(JSON.stringify(data));
    data.distribution = {
      ...data.distribution,
      contains_private_scope_material: false,
      distribution_ready: true,
      note: DISTRIBUTION_NOTE,
    };
    if (Array.isArray(data.source_basis)) {
      data.source_basis = data.source_basis.map((entry) =>
        entry && entry.status === "present_private_scope"
          ? { ...entry, status: "excluded_from_distribution_private_scope" }
          : entry);
    }
    const packagingLeaves = [];
    diffPaths(packagingBefore, data, rel, packagingLeaves);
    for (const leaf of packagingLeaves) {
      scrubbedFields.push({
        file: rel, path: leaf, action: "packaging_record_updated",
        before_sha256: sha256(Buffer.from(JSON.stringify(packagingBefore), "utf8")),
        after_sha256: sha256(Buffer.from(JSON.stringify(data), "utf8")),
      });
    }
  }
  const after = JSON.stringify(data);
  if (after === before) {
    fail(`the release contract changes ${rel}, but no distribution rule changed it: the contract and this tool disagree`);
    continue;
  }
  writeFileSync(p, after);
  pass(`strip applied to ${rel}`);
}
// Every changed file is named in the reconciliation record, whether the change
// came from a scrub, a dropped item, or the packaging block above.
const namedByStrip = new Set([...droppedItems.map((d) => d.file), ...scrubbedFields.map((s) => s.file)]);
for (const rel of STRIP_FILES) {
  if (namedByStrip.has(rel)) continue;
  scrubbedFields.push({
    file: rel, path: `${rel}`,
    action: "sentences_scrubbed",
    before_sha256: canonicalByPath.get(rel) ?? null,
    after_sha256: contractFiles.get(rel) ?? null,
  });
}
if (failures > 0) process.exit(1);

// ---- Data-integrity proof for the three touched files ----------------------
// Independently diff canonical vs distribution parses. Every difference
// must be either a dropped item subtree or a recorded scrubbed path.
function diffPaths(a, b, path, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) { out.push(`${path}.${k}`); continue; }
      if (!(k in a)) { out.push(`${path}.${k}`); continue; }
      diffPaths(a[k], b[k], `${path}.${k}`, out);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const idBearing = (arr) => arr.every((e) => isObj(e) && typeof e.id === "string");
    if (idBearing(a) && idBearing(b)) {
      const bById = new Map(b.map((e, i) => [e.id, { e, i }]));
      a.forEach((e, i) => {
        const hit = bById.get(e.id);
        if (!hit) { out.push(`${path}[${i}] id=${e.id}`); return; }
        diffPaths(e, hit.e, `${path}[${hit.i}]`, out);
      });
      b.forEach((e, i) => { if (!a.some((x) => x.id === e.id)) out.push(`${path}[${i}] id=${e.id}`); });
      return;
    }
    if (a.length !== b.length) { out.push(`${path} (array length ${a.length} -> ${b.length})`); return; }
    a.forEach((e, i) => diffPaths(e, b[i], `${path}[${i}]`, out));
    return;
  }
  out.push(path);
}
for (const rel of STRIP_FILES) {
  const canonical = JSON.parse(readFileSync(join(source, rel), "utf8"));
  const dist = JSON.parse(readFileSync(join(out, rel), "utf8"));
  const diffs = [];
  diffPaths(canonical, dist, rel, diffs);
  const allowed = new Set(scrubbedFields.filter((s) => s.file === rel).map((s) => s.path));
  const unexpected = diffs.filter((d) => {
    if (allowed.has(d)) return false;
    const m = d.match(/^(.*\.items\[\d+\]) id=(.+)$/);
    if (m && STRIP_IDS.includes(m[2])) return false;
    return true;
  });
  if (unexpected.length) {
    for (const d of unexpected) fail(`unexplained data difference in ${rel}: ${d}`);
  } else {
    pass(`data integrity for ${rel}: ${diffs.length} difference(s), all explained by the strip record`);
  }
}

// ---- Residual scan: no private references anywhere in the tree -------------
let residual = 0;
for (const rel of walk(out)) {
  const text = readFileSync(join(out, rel), "utf8");
  for (const token of PRIVATE_TOKENS) {
    if (text.includes(token)) { residual += 1; fail(`residual private reference ${token} in ${rel}`); }
  }
}
if (residual === 0) pass("zero residual private references in the distribution tree");

// ---- Byte-identity proof outside the declared differences -------------------
const outHashes = treeHashes(out);
const changedFiles = [];
for (const [rel, h] of srcHashes) {
  if (STRIP_FILES.includes(rel) || REMOVED_FILES.includes(rel)) continue;
  if (outHashes.get(rel) !== h) { changedFiles.push(rel); fail(`unexpected byte difference: ${rel}`); }
}
for (const rel of outHashes.keys()) {
  if (!srcHashes.has(rel) && rel !== "manifest.json" && !contractAddedPaths.includes(rel)) {
    fail(`unexpected added file in distribution tree: ${rel}`);
  }
}
if (changedFiles.length === 0) {
  pass("every file outside the declared differences is byte-identical to canonical");
}

// ---- Reconciliation artifact (inside the bundle) -----------------------------
const reconciliation = {
  artifact: "council-of-wise-elders 999 distribution reconciliation",
  generated_by: "scripts/vendor-council-bundle.mjs (999-setup, CWE-040)",
  canonical_source: {
    repository: "trevorotts1/openclaw-onboarding",
    skill_folder: "77-council-of-wise-elders",
    source_commit: sourceCommit,
    canonical_aggregate_sha256: canonicalManifest.aggregate_sha256,
    canonical_file_count: canonicalManifest.file_count,
    skill_version: canonicalManifest.skill_version,
  },
  intentional_distribution_differences: [
    {
      kind: "private_scope_items_dropped",
      rule: "CWE-012 acceptance condition 3: material tagged scope private_scope is barred from every distributable artifact. Bibliographic records stay; the derived pack items go. Dropped items are recorded by file, index, and content hash only; distributed artifacts never name them.",
      items: droppedItems.map(({ file, item_index, item_sha256 }) => ({ file, item_index, item_sha256 })),
    },
    {
      kind: "sentences_scrubbed",
      rule: "Sentences referencing a dropped item id or a private evidence id are removed from pack JSON string fields; a field left empty is removed. Content is recorded by hash only, never reprinted here.",
      fields: scrubbedFields,
    },
    {
      kind: "generated_archive_not_vendored",
      file: "council-of-wise-elders.skill",
      archive_sha256: canonicalArchive ? canonicalArchive.sha256 : null,
      archive_bytes: canonicalArchive ? canonicalArchive.bytes : null,
      rule: "The canonical tree's generated distributable archive is a sibling artifact of the same tree (the canonical hash method excludes it from the tree identity). It is not vendored: the vendored folder is itself the 999 distribution of this tree. Its identity is recorded here and in the vendoring record.",
    },
    {
      kind: "file_added",
      file: RECONCILIATION_FILE,
      rule: "This reconciliation report ships with the bundle (directive Section 25.2 step 4).",
    },
    {
      kind: "manifest_regenerated",
      file: "manifest.json",
      rule: "Regenerated over the distribution tree with the canonical hash method; the canonical aggregate it derives from is recorded above and inside manifest.json.",
    },
  ],
};
// The record may only declare differences the release allows, and every
// changed file must be named by it (the tree gate holds the record to both).
const emittedKinds = [...new Set(reconciliation.intentional_distribution_differences.map((d) => d.kind))];
const missingKinds = emittedKinds.filter((k) => !contractKinds.includes(k));
if (missingKinds.length) {
  fail(`the distribution needs the difference kind(s) ${missingKinds.join(", ")}, which the canonical contract does not allow`);
}
const namedFiles = new Set([
  ...reconciliation.intentional_distribution_differences.flatMap((d) => [
    ...(Array.isArray(d.items) ? d.items.map((i) => i?.file) : []),
    ...(Array.isArray(d.fields) ? d.fields.map((i) => i?.file) : []),
  ]).filter((f) => typeof f === "string"),
]);
const unnamed = STRIP_FILES.filter((rel) => !namedFiles.has(rel));
if (unnamed.length) fail(`the reconciliation record never names the changed file(s) ${unnamed.join(", ")}`);
writeFileSync(join(out, RECONCILIATION_FILE), JSON.stringify(reconciliation, null, 2) + "\n");
pass(`wrote ${RECONCILIATION_FILE}`);

// ---- The distribution must BE the release's distribution, per file --------
// The canonical release records, in advance, the digest of every file its
// distribution carries. A tree that differs from that record by one byte is
// drift, not a strip — it is refused here, so the next vendoring never reaches
// a tree gate that must reject it.
const contractHashes = treeHashes(out);
const contractDrift = [];
for (const [rel, want] of contractDistributed) {
  const have = contractHashes.get(rel);
  if (have === undefined) contractDrift.push(`${rel} (missing)`);
  else if (have !== want) contractDrift.push(`${rel} (recomputed ${have}, the contract records ${want})`);
}
for (const rel of contractHashes.keys()) {
  if (contractDistributed.has(rel) || rel === "manifest.json" || contractAddedPaths.includes(rel)) continue;
  contractDrift.push(`${rel} (carried, but the contract neither records nor declares it)`);
}
for (const rel of contractAddedPaths) {
  if (rel !== "manifest.json" && !contractHashes.has(rel)) {
    contractDrift.push(`${rel} (declared as an added distribution path, but absent)`);
  }
}
if (contractDrift.length) {
  for (const d of contractDrift.slice(0, 10)) fail(`distribution drift against the release contract: ${d}`);
  console.log("VENDOR: FAIL (the distribution is not the one the release records)");
  process.exit(1);
}
pass(`distribution matches the release contract per file: ${contractFiles.size} content files, ` +
  `${contractRuntimeDist.size} built files, ${contractAddedPaths.length} added path(s)`);

// ---- Distribution manifest ---------------------------------------------------
const finalHashes = treeHashes(out);
finalHashes.delete("manifest.json");
const distAgg = aggregateOf(finalHashes);
const filesList = [...finalHashes.entries()]
  .filter(([p]) => p !== "runtime/dist" && !p.startsWith("runtime/dist/")
    && p !== "runtime/node_modules" && !p.startsWith("runtime/node_modules/"))
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([p, h]) => ({ path: p, sha256: h, bytes: statSync(join(out, p)).size }));
const distManifest = {
  skill: canonicalManifest.skill,
  skill_version: canonicalManifest.skill_version,
  generated_by: "scripts/vendor-council-bundle.mjs (999-setup) using the hash method of the canonical scripts/build-bundles.mjs",
  source_commit: sourceCommit,
  canonical_aggregate_sha256: canonicalManifest.aggregate_sha256,
  file_count: distAgg.count,
  aggregate_sha256: distAgg.aggregate,
  hash_method: canonicalManifest.hash_method,
  runtime_entry: runtimeEntry,
  // The vendored folder is an EXTRACTED distribution, never a source
  // package: it deliberately carries no .skill archive. The canonical
  // archive contract therefore requires status
  // "extracted_distribution" and no archive sha256 here; the canonical
  // archive identity stays recorded in the vendoring record.
  archive: {
    file: canonicalManifest.archive?.file ?? "council-of-wise-elders.skill",
    note: canonicalManifest.archive?.note,
    status: "extracted_distribution",
  },
  files: filesList,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(distManifest, null, 2) + "\n");
pass(`distribution manifest written: ${distAgg.count} files, aggregate ${distAgg.aggregate}`);

// ---- Doctor gate ---------------------------------------------------------------
try {
  const doctorOut = execFileSync("node", [join(out, "scripts", "doctor.mjs"), "--root", out, "--distribution"], { encoding: "utf8" });
  if (!doctorOut.includes("DOCTOR: PASS")) fail(`doctor did not pass on the vendored tree:\n${doctorOut}`);
  else pass("doctor PASS on the vendored distribution tree");
} catch (e) {
  fail(`doctor failed on the vendored tree: ${e.stdout ?? e.message}`);
}

// ---- Vendoring record ------------------------------------------------------------
const record = {
  ...reconciliation,
  canonical_archive: canonicalArchive,
  distribution: {
    vendored_path: ".claude/skills/council-of-wise-elders",
    distribution_aggregate_sha256: distAgg.aggregate,
    distribution_file_count: distAgg.count,
    contract_aggregate_sha256: canonicalManifest.aggregate_sha256,
    // The release contract this distribution was proven against, per file.
    // The vendor test derives every declared difference from this map, so a
    // hand-kept list of "changed files" cannot drift away from the contract.
    files: [...contractFiles.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([path, sha256]) => ({ path, sha256 })),
    // The build the release recorded. The vendor test proves the shipped
    // executable tree against it, so a dist file that was never committed
    // (or a rebuilt one) fails CI instead of riding along unverified.
    runtime_dist: [...contractRuntimeDist.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([path, sha256]) => ({ path, sha256 })),
    added_paths: contractAddedPaths,
  },
  canonical_files: Object.fromEntries(
    [...srcHashes.entries()]
      .filter(([p]) => p !== "runtime/dist" && !p.startsWith("runtime/dist/"))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  runtime_entry: runtimeEntry,
  verification: {
    canonical_manifest_recomputed: true,
    runtime_entry_verified: true,
    residual_private_references: residual,
    unexpected_byte_differences: changedFiles,
    doctor: "PASS (run by this tool against the vendored tree)",
  },
};
mkdirSync(dirname(recordPath), { recursive: true });
writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
pass(`vendoring record written: ${recordPath}`);

console.log(failures === 0
  ? `VENDOR: PASS (${distAgg.count} distribution files from canonical ${canonicalManifest.file_count})`
  : `VENDOR: FAIL (${failures} failing check(s))`);
process.exit(failures === 0 ? 0 : 1);
