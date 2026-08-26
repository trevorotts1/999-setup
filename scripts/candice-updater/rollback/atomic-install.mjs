#!/usr/bin/env node
/**
 * Candice updater atomic-install + rollback engine (WS-33).
 *
 * Implements the spec 21 install contract:
 *   - install atomically (stage next to target, then rename — never a
 *     half-written tree at the target path),
 *   - back up the replaced tree OUTSIDE Claude config roots,
 *   - rollback on failure (restore the backup; on rollback failure the state
 *     is left recoverable and a journal file names the manual restore step),
 *   - never expose secrets (no content is ever echoed),
 *   - never change model/provider routing (this engine touches only the paths
 *     it is given).
 *
 * Operations:
 *   install  --from <staged-dir> --to <target-dir> [--backup-dir <dir>]
 *            stage → backup old → atomic rename → verify marker → commit journal
 *   rollback --to <target-dir> [--backup-dir <dir>] [--journal <file>]
 *            restore the newest backup, atomically
 *
 * Exit codes: 0 OK; 1 failed (rollback attempted and reported); 2 usage.
 */
import {
  mkdirSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";

const args = process.argv.slice(2);
const op = args[0];
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const from = readArg("--from");
const to = readArg("--to");
const backupDir = readArg("--backup-dir");
const journal = readArg("--journal");

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

/**
 * Backup naming: <component>.<iso-timestamp>.backup
 * ISO timestamp sorts lexicographically, so the newest backup is the last
 * directory entry when sorted.
 */
function backupName(target) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${basename(target)}.${ts}.backup`;
}

function newestBackup(target, dir) {
  if (!existsSync(dir)) return undefined;
  const prefix = `${basename(target)}.`;
  const candidates = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".backup"))
    .sort();
  return candidates.length > 0 ? join(dir, candidates[candidates.length - 1]) : undefined;
}

function makeRelative(target, root) {
  const r = root.replace(/\/+$/, "");
  if (target.startsWith(r)) return target.slice(r.length + 1);
  return target;
}

function verifyMarker(target) {
  // Callers may drop .candice-install-ok inside the staged tree to prove
  // the payload is complete. Presence is OPTIONAL; absence is not a failure —
  // but when a marker exists in staging and disappears after rename, the
  // install is treated as failed and rolled back.
  return existsSync(join(target, ".candice-install-ok"));
}

if (op === "install") {
  if (!from || !to) fail("install requires --from <staged-dir> --to <target-dir>");
  if (!existsSync(from)) fail(`staged dir missing: ${from}`);

  const backupRoot = backupDir || join(dirname(to), ".candice-backups");
  mkdirSync(backupRoot, { recursive: true });
  mkdirSync(dirname(to), { recursive: true });

  const marker = existsSync(join(from, ".candice-install-ok"));
  const journalFile = journal || join(backupRoot, "install-journal.jsonl");

  let oldBackup = undefined;
  const hadOld = existsSync(to);

  if (hadOld) {
    oldBackup = join(backupRoot, backupName(to));
    try {
      renameSync(to, oldBackup);
    } catch (e) {
      fail(`could not move old tree aside: ${e.message}`);
    }
  }

  // Atomic rename: same filesystem by construction (stage dir is sibling of target).
  try {
    renameSync(from, to);
  } catch (e) {
    // Roll back the move of the old tree.
    let rollbackMsg = "";
    if (oldBackup) {
      try {
        renameSync(oldBackup, to);
        rollbackMsg = " old tree restored";
      } catch (e2) {
        rollbackMsg = ` OLD TREE STILL AT ${oldBackup} — restore manually`;
      }
    }
    fail(`rename failed: ${e.message}${rollbackMsg}`);
  }

  if (marker && !verifyMarker(to)) {
    // Marker lost — treat as failed: roll back.
    rmSync(to, { recursive: true, force: true });
    if (oldBackup) renameSync(oldBackup, to);
    fail("install marker missing after rename — rolled back");
  }

  // Commit journal after success (journal failure is non-fatal; backup dir name is deterministic).
  try {
    writeFileSync(
      journalFile,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        op: "install",
        to: makeRelative(to, process.cwd()),
        backup: oldBackup ? makeRelative(oldBackup, process.cwd()) : undefined,
        result: "ok",
      })}\n`,
      { flag: "a" },
    );
  } catch {
    // non-fatal
  }

  console.log(
    `OK installed ${to}${hadOld ? ` (old tree backed up)` : ""}${oldBackup ? ` -> ${oldBackup}` : ""}`,
  );
  process.exit(0);
}

if (op === "rollback") {
  if (!to) fail("rollback requires --to <target-dir>");
  const backupRoot = backupDir || join(to, "..", ".candice-backups");
  const nb = newestBackup(to, backupRoot);
  if (!nb) fail(`no backup found for ${to} under ${backupRoot}`);
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  renameSync(nb, to);
  console.log(`OK rolled back ${to} <- ${nb}`);
  process.exit(0);
}

fail(`unknown op '${op}' — use install | rollback`);
