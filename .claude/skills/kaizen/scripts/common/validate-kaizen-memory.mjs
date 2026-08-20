#!/usr/bin/env node
// Validate a Kaizen Memory folder: required structure, JSON shapes, loop-id
// agreement, template-placeholder sweep, and (with --scan-secrets) a
// credential scan that covers backups and stale/broken lock artifacts.
// Read-only. Exit 0 = clean, 1 = problems, 2 = usage error.

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const REQUIRED_FILES = [
  "KAIZEN_CONTRACT.md",
  "KAIZEN_MEMORY.md",
  "STATE.json",
  "LOCAL_STATE.json",
  "RESUME.md",
  "BACKLOG.md",
  "DECISIONS.md",
];
const REQUIRED_DIRS = ["cycles", "evidence"];
const REQUIRED_MANIFEST = "evidence/manifest.json";
const STATE_KEYS = [
  "loop_id",
  "target",
  "direction",
  "scope",
  "permission_mode",
  "proof_strategy",
  "schedule",
  "model",
  "last_cycle",
  "backup",
  "contract_version",
];
const PERMISSION_MODES = ["A", "B", "C"];
const SCHEDULER_MECHANISMS = [
  "loop",
  "/loop",
  "desktop-task",
  "cloud-schedule",
  "launchd",
  "manual",
  "none",
];
const PLACEHOLDER_RE = /<[a-z][a-z0-9 _-]*>/gi;
const LOOP_ID_RE = /\bloop[-_ ]?id\b\s*[:*\s]*([A-Za-z0-9][A-Za-z0-9_-]{0,63})/i;
const CONTRACT_VERSION_RE = /\bcontract\s*version\b\s*[:*\s]*(\d+)/i;

const PLACEHOLDER_VALUES = new Set([
  "", "none", "null", "n/a", "na", "xxx", "changeme", "example", "dummy",
  "placeholder", "redacted", "replace-me", "fill-me", "your-api-key",
  "your_api_key", "your-password", "your-secret",
]);

const SECRET_FAMILIES = [
  { name: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-api-key", re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/i },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "stripe-key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "bearer-token", re: /\bbearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/ },
  { name: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "oauth-client-secret", re: /"client_secret"\s*:\s*"([^"]{6,})"/, capture: 1 },
  { name: "router-token", re: /"(?:ROUTER_TOKEN|OPENCLAW_TOKEN|9ROUTER_TOKEN|LOCAL_ROUTER_TOKEN|API_TOKEN)"\s*:\s*"([^"]+)"/i, capture: 1 },
  { name: "credential-field", re: /"(?:password|api_key|secret)"\s*:\s*"([^"]*)"/, capture: 1 },
  { name: "url-with-credentials", re: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@|[?&](?:api_key|apikey|token|key)=[^&\s"'<>]+/i },
];

const problem = (file, reason) => ({ file, reason });

function isPlaceholderValue(value) {
  if (value === undefined || value === null) return true;
  const v = value.trim();
  if (v === "") return true;
  if (/^<[^>]*>$/.test(v)) return true;
  return PLACEHOLDER_VALUES.has(v.toLowerCase());
}

function insideRoot(p, root) {
  const r = resolve(p);
  return r === root || r.startsWith(root + sep);
}

function walk(dir, files, problems, realRoot, prefix, depth) {
  if (depth > 16) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (e.name === ".git") continue;
    const full = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    let isLink = false;
    try {
      isLink = lstatSync(full).isSymbolicLink();
    } catch {
      continue;
    }
    if (isLink) {
      let target;
      try {
        target = realpathSync(full);
      } catch {
        problems.push(problem(rel, "symlink target cannot be resolved"));
        continue;
      }
      if (!insideRoot(target, realRoot)) {
        problems.push(problem(rel, "symlink escapes memory root"));
      }
      continue;
    }
    if (e.isDirectory()) {
      walk(full, files, problems, realRoot, rel, depth + 1);
    } else if (e.isFile()) {
      files.push({ abs: full, rel });
    }
  }
}

function checkState(s) {
  const problems = [];
  if (s === null || typeof s !== "object" || Array.isArray(s)) {
    return [problem("STATE.json", "must be a JSON object")];
  }
  if (s.schema_version !== 1) {
    problems.push(problem("STATE.json", `schema_version must be 1, got ${JSON.stringify(s.schema_version)}`));
  }
  if (typeof s.loop_id !== "string" || s.loop_id.length === 0) {
    problems.push(problem("STATE.json", "loop_id must be a non-empty string"));
  }
  for (const k of STATE_KEYS) {
    if (s[k] === undefined) problems.push(problem("STATE.json", `missing required key "${k}"`));
  }
  if (s.contract_version !== undefined && (!Number.isInteger(s.contract_version) || s.contract_version < 1)) {
    problems.push(problem("STATE.json", `contract_version must be a positive integer, got ${JSON.stringify(s.contract_version)}`));
  }
  if (s.direction !== undefined) {
    const d = s.direction;
    const goalOk = d !== null && typeof d === "object" && typeof d.user_goal === "string" && d.user_goal.trim().length > 0;
    const discoveryOk = d !== null && typeof d === "object" && d.open_discovery === true;
    if (!goalOk && !discoveryOk) {
      problems.push(problem("STATE.json", "direction must include a non-empty user_goal or open_discovery === true"));
    }
  }
  const scope = s.scope !== undefined && s.scope !== null && typeof s.scope === "object"
    ? s.scope.max_items_per_cycle
    : undefined;
  if (!Number.isInteger(scope) || scope < 3 || scope > 7) {
    problems.push(problem("STATE.json", `scope.max_items_per_cycle must be an integer 3..7, got ${JSON.stringify(scope)}`));
  }
  if (!PERMISSION_MODES.includes(s.permission_mode)) {
    problems.push(problem("STATE.json", `permission_mode must be A, B, or C, got ${JSON.stringify(s.permission_mode)}`));
  }
  if (s.approval !== undefined) {
    const a = s.approval;
    if (a === null || typeof a !== "object" || Array.isArray(a)) {
      problems.push(problem("STATE.json", "approval must be an object with timestamp and approved_by"));
    } else {
      if (typeof a.timestamp !== "string" || a.timestamp.length === 0) {
        problems.push(problem("STATE.json", "approval.timestamp must be a non-empty string"));
      }
      if (typeof a.approved_by !== "string" || a.approved_by.length === 0) {
        problems.push(problem("STATE.json", "approval.approved_by must be a non-empty string"));
      }
    }
  }
  const approved = !!(s.approval && typeof s.approval.timestamp === "string" && s.approval.timestamp.length > 0);
  const mech = s.schedule !== undefined && s.schedule !== null && typeof s.schedule === "object"
    ? s.schedule.mechanism
    : undefined;
  if (mech !== undefined && mech !== "none" && mech !== "manual" && !approved) {
    problems.push(problem("STATE.json", `schedule.mechanism "${mech}" may not be active before approval`));
  }
  const status = s.status !== undefined ? s.status : s.state_status;
  if (status === "active" && !approved) {
    problems.push(problem("STATE.json", "status active requires approval.timestamp"));
  }
  if (s.state_status !== undefined && typeof s.state_status !== "string") {
    problems.push(problem("STATE.json", "state_status must be a string when present"));
  }
  return problems;
}

function checkLocalState(l, state) {
  const problems = [];
  if (l === null || typeof l !== "object" || Array.isArray(l)) {
    return [problem("LOCAL_STATE.json", "must be a JSON object")];
  }
  if (l.schema_version !== 1) {
    problems.push(problem("LOCAL_STATE.json", `schema_version must be 1, got ${JSON.stringify(l.schema_version)}`));
  }
  if (l.loop_id === undefined) {
    problems.push(problem("LOCAL_STATE.json", "missing loop_id"));
  } else if (state && typeof state.loop_id === "string" && l.loop_id !== state.loop_id) {
    problems.push(problem("LOCAL_STATE.json", `loop_id "${l.loop_id}" does not match STATE.json loop_id "${state.loop_id}"`));
  }
  if (l.scheduler !== undefined && l.scheduler !== null && typeof l.scheduler === "object") {
    const m = l.scheduler.mechanism;
    if (m !== undefined && !SCHEDULER_MECHANISMS.includes(m)) {
      problems.push(problem("LOCAL_STATE.json", `scheduler.mechanism must be one of ${SCHEDULER_MECHANISMS.join(" | ")}, got ${JSON.stringify(m)}`));
    }
  }
  return problems;
}

function checkManifest(m) {
  const problems = [];
  if (m === null || typeof m !== "object" || Array.isArray(m)) {
    return [problem(REQUIRED_MANIFEST, "must be a JSON object")];
  }
  if (m.schema_version !== 1) {
    problems.push(problem(REQUIRED_MANIFEST, `schema_version must be 1, got ${JSON.stringify(m.schema_version)}`));
  }
  if (!Array.isArray(m.entries)) {
    problems.push(problem(REQUIRED_MANIFEST, "entries must be an array"));
  }
  return problems;
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function redact(s) {
  if (s.length <= 6) return "***";
  return s.slice(0, 3) + "..." + s.slice(-3);
}

function scanSecrets(abs, rel) {
  const hits = [];
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return hits;
  }
  if (text.indexOf(" ") !== -1) return hits;
  for (const fam of SECRET_FAMILIES) {
    const flags = fam.re.flags.includes("g") ? fam.re.flags : `${fam.re.flags}g`;
    const re = new RegExp(fam.re.source, flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (fam.capture !== undefined && isPlaceholderValue(m[fam.capture])) {
        if (m.index === re.lastIndex) re.lastIndex += 1;
        continue;
      }
      hits.push({
        file: rel,
        line: lineNumber(text, m.index),
        family: fam.name,
        redacted: redact(fam.capture !== undefined ? m[fam.capture] : m[0]),
      });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return hits;
}

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);
const scanSecretsFlag = args.includes("--scan-secrets");
const folder = args.find((a) => a !== "--scan-secrets");
if (!folder) {
  console.error("usage: validate-kaizen-memory.mjs <memory-folder> [--scan-secrets]");
  process.exit(2);
}
if (!existsSync(folder) || !statSync(folder).isDirectory()) {
  console.error(`validate-kaizen-memory: not a folder: ${folder}`);
  process.exit(2);
}

const realRoot = realpathSync(folder);
const files = [];
const problems = [];
walk(folder, files, problems, realRoot, "", 0);

// 1. Required items.
for (const f of REQUIRED_FILES) {
  if (!existsSync(join(folder, f))) problems.push(problem(f, "missing required file"));
}
for (const d of REQUIRED_DIRS) {
  const p = join(folder, d);
  if (!existsSync(p)) problems.push(problem(`${d}/`, "missing required directory"));
  else if (!statSync(p).isDirectory()) problems.push(problem(`${d}/`, "must be a directory"));
}
if (!existsSync(join(folder, REQUIRED_MANIFEST))) {
  problems.push(problem(REQUIRED_MANIFEST, "missing required file"));
}

// 2. Every *.json file under the root must parse.
const parsedFiles = new Map();
for (const f of files) {
  if (!f.rel.endsWith(".json")) continue;
  let text;
  try {
    text = readFileSync(f.abs, "utf8");
  } catch {
    problems.push(problem(f.rel, "unreadable JSON file"));
    continue;
  }
  try {
    parsedFiles.set(f.rel, JSON.parse(text));
  } catch (err) {
    problems.push(problem(f.rel, `invalid JSON: ${err.message}`));
  }
}

// Schema checks.
const state = parsedFiles.get("STATE.json");
if (state !== undefined) problems.push(...checkState(state));
if (parsedFiles.has("LOCAL_STATE.json")) {
  problems.push(...checkLocalState(parsedFiles.get("LOCAL_STATE.json"), state));
}
if (parsedFiles.has(REQUIRED_MANIFEST)) {
  problems.push(...checkManifest(parsedFiles.get(REQUIRED_MANIFEST)));
}

// Contract: version and loop id agreement.
const contractPath = join(folder, "KAIZEN_CONTRACT.md");
if (existsSync(contractPath)) {
  let text = "";
  try {
    text = readFileSync(contractPath, "utf8");
  } catch {
    text = "";
  }
  const loopM = LOOP_ID_RE.exec(text);
  if (loopM) {
    if (state && typeof state.loop_id === "string" && loopM[1] !== state.loop_id) {
      problems.push(problem("KAIZEN_CONTRACT.md", `Loop ID "${loopM[1]}" does not match STATE.json loop_id "${state.loop_id}"`));
    }
  } else {
    problems.push(problem("KAIZEN_CONTRACT.md", "no Loop ID found in contract"));
  }
  const verM = CONTRACT_VERSION_RE.exec(text);
  if (verM && state && Number.isInteger(state.contract_version)) {
    const v = Number(verM[1]);
    if (v !== state.contract_version) {
      problems.push(problem("KAIZEN_CONTRACT.md", `contract version ${v} does not match STATE.json contract_version ${state.contract_version}`));
    }
  }
}

// Cycle records: loop id agreement.
const cyclesDir = join(folder, "cycles");
if (existsSync(cyclesDir) && statSync(cyclesDir).isDirectory()) {
  let names = [];
  try {
    names = readdirSync(cyclesDir);
  } catch {
    names = [];
  }
  const loopIdGlobal = new RegExp(LOOP_ID_RE.source, `${LOOP_ID_RE.flags}g`);
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    let text = "";
    try {
      text = readFileSync(join(cyclesDir, name), "utf8");
    } catch {
      continue;
    }
    loopIdGlobal.lastIndex = 0;
    let m;
    while ((m = loopIdGlobal.exec(text)) !== null) {
      if (state && typeof state.loop_id === "string" && m[1] !== state.loop_id) {
        problems.push(problem(`cycles/${name}`, `loop_id "${m[1]}" does not match STATE.json loop_id "${state.loop_id}"`));
      }
    }
  }
}

// Registry: path safety and loop id agreement.
const parentDir = dirname(folder);
for (const name of ["REGISTRY.json", "registry.json"]) {
  for (const rp of [join(folder, name), join(parentDir, name)]) {
    if (!existsSync(rp)) continue;
    let reg = null;
    let regErr = null;
    try {
      reg = JSON.parse(readFileSync(rp, "utf8"));
    } catch (err) {
      regErr = err;
    }
    if (regErr) {
      problems.push(problem("REGISTRY.json", `invalid JSON: ${regErr.message}`));
      continue;
    }
    const entries = Array.isArray(reg && reg.loops)
      ? reg.loops
      : reg && typeof reg === "object"
        ? Object.values(reg).filter((v) => v && typeof v === "object" && !Array.isArray(v))
        : [];
    const regRoot = resolve(dirname(rp));
    for (const entry of entries) {
      const md = entry.memory_dir !== undefined ? entry.memory_dir : entry.root;
      if (typeof md !== "string" || md.length === 0) continue;
      const resolved = resolve(dirname(rp), md);
      if (!insideRoot(resolved, regRoot)) {
        problems.push(problem("REGISTRY.json", `memory_dir "${md}" escapes the Kaizen root`));
      }
      const isThisLoop = resolved === resolve(folder) || entry.loop_id === (state && state.loop_id);
      if (isThisLoop && state && typeof state.loop_id === "string" && entry.loop_id !== undefined && entry.loop_id !== state.loop_id) {
        problems.push(problem("REGISTRY.json", `registry entry loop_id "${entry.loop_id}" does not match STATE.json loop_id "${state.loop_id}"`));
      }
    }
  }
}

// Template placeholders in the required .md files.
for (const f of ["KAIZEN_CONTRACT.md", "KAIZEN_MEMORY.md", "RESUME.md", "BACKLOG.md", "DECISIONS.md"]) {
  const p = join(folder, f);
  if (!existsSync(p)) continue;
  let text = "";
  try {
    text = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    problems.push(problem(f, `unresolved template placeholder "${m[0]}"`));
  }
}

// Secret scan (optional): covers backups and stale/broken lock artifacts.
const secretHits = [];
if (scanSecretsFlag) {
  for (const f of files) {
    secretHits.push(...scanSecrets(f.abs, f.rel));
  }
  for (const h of secretHits) {
    problems.push(problem(h.file, `credential detected (family ${h.family}, line ${h.line})`));
  }
}

const out = {
  ok: problems.length === 0,
  folder,
  files_checked: files.length,
  problems,
  secret_hits: secretHits,
};
console.log(JSON.stringify(out));
process.exit(problems.length === 0 ? 0 : 1);
