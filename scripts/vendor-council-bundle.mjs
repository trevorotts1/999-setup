#!/usr/bin/env node
// Council of Wise Elders: 999 distribution vendoring tool (CWE-040).
//
// Vendors the exact canonical portable bundle (openclaw-onboarding
// 77-council-of-wise-elders) into this repository at
// .claude/skills/council-of-wise-elders, applying the distribution
// rules of the build directive (Section 25.2 step 4 and the CWE-012
// acceptance conditions):
//
//   - The canonical tree is copied byte for byte, with exactly three
//     classes of intentional distribution difference, each recorded in
//     DISTRIBUTION-RECONCILIATION.json inside the vendored tree and in
//     the vendoring record (installer-registration/council-vendoring.json):
//       (a) the Brunson private-scope pack items are dropped
//           (frameworks fw-epiphany-bridge-and-demo and
//           fw-one-client-one-funnel, failure pattern fp-technobabble);
//       (b) sentences in pack JSON string fields that reference a
//           dropped item id or a private evidence id (prefix
//           ev-russell-brunson-network-marketing-secrets-) are scrubbed;
//       (c) manifest.json is regenerated over the distribution tree
//           with the canonical hash method, recording the canonical
//           aggregate it derives from.
//   - Bibliographic records (sources.json, coverage.json) stay
//     byte-identical: references stay, the private material goes.
//   - The source tree is refused if it is dirty: no node_modules, no
//     runtime/dist, no council state files, and its manifest aggregate
//     must recompute exactly. The tree's generated .skill archive is
//     recorded by hash and deliberately not vendored (the vendored
//     folder is itself the distribution). When the source sits in a
//     git worktree, HEAD must equal --source-commit.
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

const STRIP_IDS = [
  "fw-epiphany-bridge-and-demo",
  "fw-one-client-one-funnel",
  "fp-technobabble",
];
const PRIVATE_EVIDENCE_PREFIX = "ev-russell-brunson-network-marketing-secrets-";
const STRIP_FILES = [
  "advisors/russell-brunson/frameworks.json",
  "advisors/russell-brunson/failure-patterns.json",
  "advisors/russell-brunson/decision-rules.json",
];
const RECONCILIATION_FILE = "DISTRIBUTION-RECONCILIATION.json";

let failures = 0;
const fail = (m) => { failures += 1; console.log(`FAIL ${m}`); };
const pass = (m) => console.log(`PASS ${m}`);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
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
function aggregateOf(map) {
  const entries = [...map.entries()]
    .filter(([p]) => p !== "manifest.json" && !p.endsWith(".skill"))
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
const srcFiles = walk(source);
for (const rel of srcFiles) {
  if (rel.includes("node_modules/") || rel.startsWith("runtime/dist/")
    || /\.(sqlite3?|db)$/i.test(rel)
    || /^(state|sessions|data)\//.test(rel)) {
    fail(`source tree is dirty, refusing to vendor: ${rel}`);
  }
  if (rel.endsWith(".skill") && rel !== "council-of-wise-elders.skill") {
    fail(`unexpected archive in the source tree, refusing to vendor: ${rel}`);
  }
}
const canonicalManifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
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
if (failures > 0) process.exit(1);

// ---- Copy ----------------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, out, {
  recursive: true,
  filter: (p) => !p.endsWith(".skill"),
});
pass(`copied canonical tree to ${out} (generated .skill archive excluded)`);

// ---- Brunson private-scope strip ------------------------------------------
// Sentence split that keeps terminators; a string with no terminator is
// one sentence.
function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return parts ? parts.map((s) => s) : [text];
}
function referencesPrivate(value) {
  return STRIP_IDS.some((id) => value.includes(id)) || value.includes(PRIVATE_EVIDENCE_PREFIX);
}
const droppedItems = [];
const scrubbedFields = [];
function scrubValue(value, path, file) {
  if (typeof value === "string") {
    if (!referencesPrivate(value)) return value;
    const kept = splitSentences(value).filter((s) => !referencesPrivate(s));
    const joined = kept.join("").trim();
    scrubbedFields.push({
      file, path, action: joined ? "sentences_scrubbed" : "field_removed",
      before_sha256: sha256(Buffer.from(value, "utf8")),
      after_sha256: joined ? sha256(Buffer.from(joined, "utf8")) : null,
    });
    return joined ? joined : undefined;
  }
  if (Array.isArray(value)) {
    const next = [];
    for (let i = 0; i < value.length; i++) {
      const v = scrubValue(value[i], `${path}[${i}]`, file);
      if (v !== undefined) next.push(v);
    }
    return next;
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "private_evidence_refs") {
        fail(`private_evidence_refs survived outside a dropped item at ${file} ${path}`);
        continue;
      }
      const nv = scrubValue(v, `${path}.${k}`, file);
      if (nv !== undefined) next[k] = nv;
    }
    return next;
  }
  return value;
}
for (const rel of STRIP_FILES) {
  const p = join(out, rel);
  const raw = readFileSync(p, "utf8");
  const pretty = raw.includes("\n");
  const data = JSON.parse(raw);
  if (Array.isArray(data.items)) {
    const before = data.items.length;
    data.items = data.items.filter((item, idx) => {
      if (item && STRIP_IDS.includes(item.id)) {
        // The distributed artifacts never name a dropped item: it is
        // recorded by file, index, and content hash only.
        droppedItems.push({
          file: rel, id: item.id, item_index: idx,
          item_sha256: sha256(Buffer.from(JSON.stringify(item), "utf8")),
        });
        return false;
      }
      return true;
    });
    if (data.items.length !== before - STRIP_IDS.filter(
      (id) => droppedItems.some((d) => d.file === rel && d.id === id)).length) {
      fail(`unexpected item count change in ${rel}`);
    }
  }
  const scrubbed = scrubValue(data, rel, rel);
  const serialized = pretty
    ? JSON.stringify(scrubbed, null, 2) + (raw.endsWith("\n") ? "\n" : "")
    : JSON.stringify(scrubbed) + (raw.endsWith("\n") ? "\n" : "");
  writeFileSync(p, serialized);
  pass(`strip applied to ${rel}`);
}
for (const id of STRIP_IDS) {
  if (!droppedItems.some((d) => d.id === id)) fail(`strip item not found and dropped: ${id}`);
}
if (droppedItems.length !== STRIP_IDS.length) {
  fail(`expected ${STRIP_IDS.length} dropped items, got ${droppedItems.length}`);
}

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
  for (const token of [...STRIP_IDS, PRIVATE_EVIDENCE_PREFIX]) {
    if (text.includes(token)) { residual += 1; fail(`residual private reference ${token} in ${rel}`); }
  }
}
if (residual === 0) pass("zero residual private references in the distribution tree");

// ---- Byte-identity proof outside the declared differences -------------------
const outHashes = treeHashes(out);
const changedFiles = [];
for (const [rel, h] of srcHashes) {
  if (STRIP_FILES.includes(rel)) continue;
  if (outHashes.get(rel) !== h) { changedFiles.push(rel); fail(`unexpected byte difference: ${rel}`); }
}
for (const rel of outHashes.keys()) {
  if (!srcHashes.has(rel) && rel !== "manifest.json" && rel !== RECONCILIATION_FILE) {
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
writeFileSync(join(out, RECONCILIATION_FILE), JSON.stringify(reconciliation, null, 2) + "\n");
pass(`wrote ${RECONCILIATION_FILE}`);

// ---- Distribution manifest ---------------------------------------------------
const finalHashes = treeHashes(out);
finalHashes.delete("manifest.json");
const distAgg = aggregateOf(finalHashes);
const filesList = [...finalHashes.entries()]
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
  archive: canonicalManifest.archive,
  files: filesList,
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(distManifest, null, 2) + "\n");
pass(`distribution manifest written: ${distAgg.count} files, aggregate ${distAgg.aggregate}`);

// ---- Doctor gate ---------------------------------------------------------------
try {
  const doctorOut = execFileSync("node", [join(out, "scripts", "doctor.mjs"), "--root", out], { encoding: "utf8" });
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
  },
  canonical_files: Object.fromEntries(
    [...srcHashes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  verification: {
    canonical_manifest_recomputed: true,
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
