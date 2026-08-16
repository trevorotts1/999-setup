#!/usr/bin/env node
// record-effort-selection.mjs — write the user's last /effort selection into
// router-session.json so the claude-nine launcher can re-apply it at the next
// exec. The ONLY sanctioned writer of lastEffortSelection (Issue 1 fix):
// nothing else may edit the field, so a setup re-run (write-routing-state)
// carries the value forward instead of wiping it.
//
// Usage:
//   node record-effort-selection.mjs <statePath> <low|medium|high|xhigh|max|ultracode>
//
// Edits the existing state file in place (temp file + rename), preserving
// every other field. Refuses unknown values. Never prints secrets (the state
// file contains none by construction).
//
// ultracode lives ONLY in this file — it is not accepted by any settings key
// or env var, so the launcher translates it into the --effort ultracode CLI
// flag at exec time.

import fs from "node:fs";

const VALID = new Set(["low", "medium", "high", "xhigh", "max", "ultracode"]);

function main() {
  const [, , statePath, value] = process.argv;
  if (!statePath || !value) {
    console.error("record-effort-selection: usage: node record-effort-selection.mjs <statePath> <low|medium|high|xhigh|max|ultracode>");
    process.exit(2);
  }
  if (!VALID.has(value)) {
    console.error(`record-effort-selection: unrecognized effort value "${value}" (valid: ${[...VALID].join("|")})`);
    process.exit(2);
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (e) {
    console.error(`record-effort-selection: cannot read state file ${statePath}: ${e.message}`);
    process.exit(1);
  }
  state.lastEffortSelection = value;
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  if (process.platform !== "win32") fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, statePath);
  console.log(`lastEffortSelection recorded: ${value} -> ${statePath}`);
}

main();
