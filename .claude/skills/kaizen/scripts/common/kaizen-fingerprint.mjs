#!/usr/bin/env node
// Kaizen Fingerprint helper — deterministic, no network, no secrets, read-only.
//
// commands:
//   compute <target-dir>          -> {"fingerprint":"<hex>","file_count":N}
//   compare <fp1> <fp2>           -> {"changed":true|false}
//   finding-id <seed> [cycle-id]  -> {"id":"KZ-<cycle>-<n>"}  (stable per seed)
//   reconsider-check --json '<{finding_id,backlog_entry,current_fingerprint,
//       original_fingerprint,target_changed,conditions_met:[...]}>'
//                                 -> {"reconsider":bool,"reasons":[...]}
//
// Exit 0 with JSON on success, 1 on failure.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);
const SKIP_FILES = new Set([".DS_Store"]);

const RECONSIDER_RULES = [
  { name: "target changed materially", re: /(target changed)|(changed materially)|(materially changed)/ },
  { name: "prior blocker disappeared", re: /(blocker disappeared)|(blocker (gone|resolved|removed|cleared|no longer))/ },
  { name: "previous test became invalid", re: /(test became invalid)|(test (now )?invalid)|(invalid(ated)? test)/ },
  { name: "user changed the Contract", re: /(user changed the contract)|(contract (was )?changed by user)|(changed the contract)/ },
  { name: "new evidence materially changes priority", re: /(new evidence)|(evidence materially)/ },
];

const NEVER_REPRESENT = "no new evidence; never re-present an old idea as newly discovered";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function fail(msg) {
  console.error(`kaizen-fingerprint: ${msg}`);
  process.exit(1);
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

function walkFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (SKIP_FILES.has(e.name) || e.name.endsWith(".log")) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

function cmdCompute(targetDir) {
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    fail(`not a directory: ${targetDir}`);
  }
  const root = resolve(targetDir);
  const lines = [];
  for (const f of walkFiles(root)) {
    const rel = relative(root, f).split("\\").join("/");
    lines.push(`${rel} ${sha256(readFileSync(f))}`);
  }
  lines.sort();
  emit({ fingerprint: sha256(lines.join("\n")), file_count: lines.length });
}

function cmdCompare(fp1, fp2) {
  if (!/^[0-9a-f]{64}$/.test(String(fp1)) || !/^[0-9a-f]{64}$/.test(String(fp2))) {
    fail("fingerprints must be 64-char hex");
  }
  emit({ changed: fp1 !== fp2 });
}

function cmdFindingId(seed, cycleId) {
  if (!seed || String(seed).trim() === "") fail("finding-id requires a seed");
  const cycle = cycleId && String(cycleId).trim() !== "" ? String(cycleId).trim() : "000";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(cycle)) fail(`invalid cycle id: ${cycle}`);
  const n = String((parseInt(sha256(String(seed)).slice(0, 6), 16) % 900) + 100).padStart(3, "0");
  emit({ id: `KZ-${cycle}-${n}` });
}

function normalizeCondition(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function cmdReconsiderCheck(jsonArg) {
  let input;
  try {
    input = JSON.parse(jsonArg);
  } catch (err) {
    fail(`--json must be valid JSON: ${err.message}`);
  }
  const {
    finding_id: findingId = "",
    current_fingerprint: current = "",
    original_fingerprint: original = "",
    target_changed: targetChanged = false,
    conditions_met: conditions = [],
  } = input;
  const matched = [];
  for (const c of conditions) {
    const norm = normalizeCondition(c);
    for (const rule of RECONSIDER_RULES) {
      if (rule.re.test(norm) && !matched.includes(rule.name)) {
        matched.push(rule.name);
        break;
      }
    }
  }
  if (matched.length > 0) {
    emit({
      reconsider: true,
      reasons: [`reconsidering ${findingId}: ${matched.join("; ")}`],
      matched_conditions: matched,
    });
    return;
  }
  const identicalTarget = String(current) === String(original) && !targetChanged;
  if (identicalTarget) {
    emit({ reconsider: false, reasons: [NEVER_REPRESENT], matched_conditions: [] });
    return;
  }
  emit({
    reconsider: false,
    reasons: ["fingerprint changed, but no named reconsideration condition met"],
    matched_conditions: [],
  });
}

const [cmd, a, b] = process.argv.slice(2);
switch (cmd) {
  case "compute":
    if (!a) fail("usage: compute <target-dir>");
    cmdCompute(a);
    break;
  case "compare":
    if (!a || !b) fail("usage: compare <fp1> <fp2>");
    cmdCompare(a, b);
    break;
  case "finding-id":
    if (!a) fail("usage: finding-id <seed> [cycle-id]");
    cmdFindingId(a, b);
    break;
  case "reconsider-check": {
    if (a !== "--json" || !b) fail('usage: reconsider-check --json \'<{...}>\'');
    cmdReconsiderCheck(b);
    break;
  }
  default:
    fail(`unknown command: ${cmd || "(none)"}`);
}
