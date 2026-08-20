#!/usr/bin/env node
// Validate a Kaizen Memory folder: JSON shapes, required files, and
// (with --scan-secrets) a pattern sweep for credentials.
// Reads only. Exit 0 = clean, 1 = problems, 2 = usage error.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,                         // OpenAI-style (incl. sk-proj-)
  /gh[pousr]_[A-Za-z0-9]{20,}/,                   // GitHub tokens
  /AIza[0-9A-Za-z_-]{30,}/,                       // Google API keys
  /AKIA[0-9A-Z]{16}/,                             // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/,                 // Slack tokens
  /Bearer [A-Za-z0-9._-]{20,}/,                   // bearer tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /service_account\.json/i,
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/,
];

const REQUIRED_STATE_KEYS = [
  "loop_id", "target", "direction", "scope", "permission_mode",
  "proof_strategy", "schedule", "model", "last_cycle", "backup",
];

function problemsForJson(path) {
  const problems = [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [`unreadable: ${path}`];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [`invalid JSON: ${path} (${err.message})`];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [`not a JSON object: ${path}`];
  }
  if (basename(path) === "STATE.json") {
    if (parsed.schema_version !== 1) problems.push(`STATE.json schema_version must be 1, got ${parsed.schema_version}`);
    for (const k of REQUIRED_STATE_KEYS) {
      if (parsed[k] === undefined) problems.push(`STATE.json missing "${k}"`);
    }
    const n = Number(parsed.scope?.max_items_per_cycle);
    if (!Number.isInteger(n) || n < 3 || n > 7) {
      problems.push(`scope.max_items_per_cycle must be an integer 3..7, got ${parsed.scope?.max_items_per_cycle}`);
    }
    const d = parsed.direction || {};
    if (!d.user_goal && !d.open_discovery) {
      problems.push("direction must include user_goal and/or open_discovery");
    }
  }
  return problems;
}

function secretsIn(path) {
  const hits = [];
  try {
    const text = readFileSync(path, "utf8");
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) hits.push(re.source);
    }
  } catch {
    // binary or unreadable: skip
  }
  return hits;
}

function walk(dir, out, depth = 0) {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git") continue;
      walk(full, out, depth + 1);
    } else if (e.isFile()) {
      if (e.name.endsWith(".bak") || e.name.startsWith(".DS_Store")) continue;
      out.push(full);
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: validate-kaizen-memory.mjs <memory-folder> [--scan-secrets]");
  process.exit(2);
}
const [root, flag] = args;
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`validate-kaizen-memory: not a folder: ${root}`);
  process.exit(2);
}

const files = [];
walk(root, files);
const problems = [];
let jsonCount = 0;
for (const f of files) {
  if (f.endsWith(".json")) {
    jsonCount += 1;
    problems.push(...problemsForJson(f));
  }
}
if (jsonCount === 0) problems.push("no JSON files found in memory folder");

let secretHits = [];
if (flag === "--scan-secrets") {
  for (const f of files) {
    const hits = secretsIn(f);
    for (const h of hits) secretHits.push({ file: f, pattern: h });
  }
  if (secretHits.length > 0) {
    problems.push(`${secretHits.length} potential secret(s) found`);
  }
}

if (problems.length === 0) {
  console.log(JSON.stringify({ ok: true, folder: root, files_checked: files.length }));
  process.exit(0);
}
console.log(JSON.stringify({ ok: false, folder: root, files_checked: files.length, problems, secret_hits: secretHits }, null, 2));
process.exit(1);
