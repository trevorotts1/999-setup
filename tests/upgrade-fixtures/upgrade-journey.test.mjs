/**
 * WS-47 — the existing-user upgrade journey (Master Spec section 21,
 * "Existing user flow" + "Existing-user update tests"; E.1 WS-47).
 *
 * Fixture: old Spec Protocol installed, Candice absent, older
 * Kaizen/ELI5/Bro. Proof legs (spec 27 "Existing-user update tests"):
 *   1. update is detected,
 *   2. Spec Protocol updates safely,
 *   3. new bootstrap installs Candice,
 *   4. supported skills refresh,
 *   5. plain Claude settings/provider config remain untouched,
 *   6. rollback works after an injected failure.
 *
 * Every leg drives the REAL shipped surfaces — never a re-implementation:
 *   - `scripts/candice-upgrade/{detect.mjs,upgrade.mjs,repair.mjs}` (WS-32)
 *   - `.claude/skills/spec-protocol/tools/self-update.sh` (spec 21 first hop)
 *   - `scripts/candice-bootstrap/{install.mjs,health.mjs,state.mjs,paths.mjs}`
 *     (WS-31)
 *   - `scripts/candice-updater/rollback/atomic-install.mjs` (WS-33)
 *
 * Hermetic: every fixture lives under mkdtemp; a fixture HOME stands in for
 * the live home directory. Nothing touches the real `~/.claude`,
 * `~/.claude-nine`, or any real config root. The published VERSION is served
 * by a local 127.0.0.1 HTTP server; the self-update's transport is a curl
 * stub that hands the script a local tarball (the real backup/extract/
 * version-gate/replace/restore logic runs unmodified). No external network.
 *
 * No commit, no push (builder contract).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { detect, compareVersions } from "../../scripts/candice-upgrade/detect.mjs";
import { SKILL_PINS, PLUGIN_PINS } from "../../scripts/candice-bootstrap/install.mjs";
import { pluginDir, assetsDir } from "../../scripts/candice-bootstrap/paths.mjs";
import { readState, STATE_SCHEMA } from "../../scripts/candice-bootstrap/state.mjs";
import { healthCheck } from "../../scripts/candice-bootstrap/health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const UPGRADE_CLI = join(REPO, "scripts", "candice-upgrade", "upgrade.mjs");
const SELF_UPDATE = join(REPO, ".claude", "skills", "spec-protocol", "tools", "self-update.sh");
const ATOMIC_ENGINE = join(REPO, "scripts", "candice-updater", "rollback", "atomic-install.mjs");

const PUBLISHED = "1.17.6";
const OLD = "1.15.0";

/** Fixture HOME — stands in for the live home directory; never the real one. */
function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "ws47-home-"));
  mkdirSync(join(home, ".claude", "skills"), { recursive: true });
  return home;
}

/** Old machine: the bundled skills under ~/.claude/skills, Candice absent. */
function oldMachine(home) {
  const skills = join(home, ".claude", "skills");
  for (const name of Object.keys(SKILL_PINS)) mkdirSync(join(skills, name), { recursive: true });
  return skills;
}

function freshBootstrapRoot() {
  return mkdtempSync(join(tmpdir(), "ws47-root-"));
}

/** Plant a skill tree (the REAL repo tree) at a chosen version. */
function plantOldSkill(targetDir, skillName, version) {
  mkdirSync(targetDir, { recursive: true });
  cpSync(join(REPO, ".claude", "skills", skillName), targetDir, { recursive: true });
  writeFileSync(join(targetDir, "VERSION"), `${version}\n`);
}

/** Local HTTP server serving the published VERSION (operator channel stand-in). */
function serveVersion(version) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${version}\n`);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/VERSION` });
    });
  });
}

/** Run a Node CLI; returns exit code + merged output. */
function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", ...opts });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * A local "published" tarball of the current spec-protocol tree (stands in
 * for the operator-controlled release tarball). Structure mirrors the repo:
 * tree/.claude/skills/spec-protocol — the self-update finder locates it.
 */
let publishedTarball = null;
function makePublishedTarball() {
  if (publishedTarball) return publishedTarball;
  const dir = mkdtempSync(join(tmpdir(), "ws47-tarball-"));
  const tree = join(dir, "tree");
  const sp = join(tree, ".claude", "skills", "spec-protocol");
  mkdirSync(sp, { recursive: true });
  cpSync(join(REPO, ".claude", "skills", "spec-protocol"), sp, { recursive: true });
  writeFileSync(join(sp, "VERSION"), `${PUBLISHED}\n`);
  const tarball = join(dir, "source.tar.gz");
  const r = spawnSync("tar", ["-czf", tarball, "-C", dir, "tree"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  publishedTarball = tarball;
  return tarball;
}

/**
 * A curl stub that serves the local tarball for the self-update transport.
 * self-update.sh runs `curl -sS -L --proto '=https' ... -o "$TARBALL" -w
 * '%{http_code}'`; the stub copies the tarball and prints 200. Everything
 * after the fetch (backup, version gate, extract, replace, restore) is the
 * REAL script, unmodified.
 */
let curlStubBin = null;
function curlStub() {
  if (curlStubBin) return curlStubBin;
  curlStubBin = mkdtempSync(join(tmpdir(), "ws47-curlstub-"));
  const tarball = makePublishedTarball();
  writeFileSync(
    join(curlStubBin, "curl"),
    `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$out" ]; then
  cp '${tarball}' "$out"
fi
echo 200
`,
    { mode: 0o755 },
  );
  return curlStubBin;
}

/** Run the REAL spec-protocol self-update.sh against the local tarball. */
function runSelfUpdate({ skillDir, backupDir, env = {} }) {
  const r = spawnSync(
    "bash",
    [SELF_UPDATE],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${curlStub()}:${process.env.PATH}`,
        ...env,
        SPEC_PROTOCOL_DIR: skillDir,
        SPEC_PROTOCOL_TARBALL_URL: "https://operator-controlled.invalid/999-setup/tar.gz/main",
        SPEC_PROTOCOL_BACKUP_DIR: backupDir,
      },
      timeout: 120000,
    },
  );
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

test("fixture sanity: pins, versions, and compare semantics", () => {
  assert.equal(SKILL_PINS["spec-protocol"], PUBLISHED, "checkout pin must be the published fixture");
  assert.equal(compareVersions(PUBLISHED, OLD), 1);
  assert.equal(compareVersions(OLD, OLD), 0);
  assert.equal(compareVersions(OLD, PUBLISHED), -1);
  assert.ok(
    process.platform === "darwin" || process.platform === "linux",
    "self-update legs run on darwin/linux (bash updater)",
  );
});

test("leg 1: update is detected — installed old, published newer (local channel)", async () => {
  const home = freshHome();
  const skills = oldMachine(home);
  const sp = join(skills, "spec-protocol");
  plantOldSkill(sp, "spec-protocol", OLD);

  const { server, url } = await serveVersion(PUBLISHED);
  try {
    const d = await detect({ roots: [sp], url });
    assert.equal(d.status, "update", JSON.stringify(d));
    assert.equal(d.published, PUBLISHED);
    assert.equal(d.installed[sp], OLD);
  } finally {
    server.close();
  }
  rmSync(home, { recursive: true, force: true });
});

test("leg 1: detection never reports current out of a failed instrument", async () => {
  const home = freshHome();
  const skills = oldMachine(home);
  const sp = join(skills, "spec-protocol");
  plantOldSkill(sp, "spec-protocol", OLD);

  const { server, url } = await serveVersion(PUBLISHED);
  server.close(); // instrument is dead -> UNDETERMINED, never current
  const d = await detect({ roots: [sp], url });
  assert.equal(d.status, "undetermined", JSON.stringify(d));
  assert.equal(d.ok, false);
  rmSync(home, { recursive: true, force: true });
});

test("leg 1: a machine already at the published version is current (fast path, spec 21 step 7)", async () => {
  const home = freshHome();
  const skills = oldMachine(home);
  const sp = join(skills, "spec-protocol");
  plantOldSkill(sp, "spec-protocol", PUBLISHED);

  const { server, url } = await serveVersion(PUBLISHED);
  try {
    const d = await detect({ roots: [sp], url });
    assert.equal(d.status, "current", JSON.stringify(d));
    assert.equal(d.ok, true);
  } finally {
    server.close();
  }
  rmSync(home, { recursive: true, force: true });
});

test("leg 2: Spec Protocol self-updates safely through the real tools/self-update.sh", () => {
  const home = freshHome();
  const skills = oldMachine(home);
  const sp = join(skills, "spec-protocol");
  plantOldSkill(sp, "spec-protocol", OLD);
  const backupDir = join(home, ".spec-protocol-backups");

  const r = runSelfUpdate({ skillDir: sp, backupDir });
  assert.equal(r.status, 0, r.out);

  // New tree installed at the published version.
  assert.equal(readFileSync(join(sp, "VERSION"), "utf8").trim(), PUBLISHED);
  assert.ok(existsSync(join(sp, "SKILL.md")));
  assert.ok(existsSync(join(sp, "tools", "self-update.sh")), "new tree carries the updater");

  // Backup of the old tree exists, outside the config root.
  const backups = readdirSync(backupDir).filter((n) => n.startsWith("spec-protocol.bak-v1.15.0"));
  assert.ok(backups.length >= 1, `backup missing: ${backups.join(",")}`);
  assert.equal(readFileSync(join(backupDir, backups[0], "VERSION"), "utf8").trim(), OLD);

  // Nothing else in the fixture home was touched (leg 5, plain Claude).
  assert.equal(existsSync(join(home, ".claude", "settings.json")), false);
  assert.equal(existsSync(join(home, ".claude", ".claude.json")), false);
  assert.equal(existsSync(join(home, ".claude-nine")), false);

  // A downgrade attempt is refused — never silently downgrades. (Separate
  // fixture home: the tree must sit at a real .../skills/spec-protocol path
  // for the script's path guard to pass; a "newer" tree is refused at the
  // version gate, exit 2, old tree intact.)
  const home2 = freshHome();
  const sp2 = join(home2, ".claude", "skills", "spec-protocol");
  plantOldSkill(sp2, "spec-protocol", "2.0.0");
  const dr = runSelfUpdate({ skillDir: sp2, backupDir: join(home2, ".spec-protocol-backups") });
  assert.equal(dr.status, 2, dr.out);
  assert.match(dr.out, /OLDER/);
  assert.equal(readFileSync(join(sp2, "VERSION"), "utf8").trim(), "2.0.0", "old tree intact after refusal");
  rmSync(home2, { recursive: true, force: true });

  rmSync(home, { recursive: true, force: true });
});

test("leg 3: next invocation repair installs missing Candice components (spec 21 steps 3-6)", () => {
  const root = freshBootstrapRoot();
  const r = runNode([UPGRADE_CLI, "repair", "--offline", "--root", root]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /OK repaired/);

  // Plugin, skills, asset records, state, journal — the full tree.
  assert.ok(existsSync(join(root, "skills", "spec-protocol", "SKILL.md")));
  assert.ok(existsSync(join(pluginDir(root), ".claude-plugin", "plugin.json")));
  assert.ok(existsSync(join(root, "state", "bootstrap-state.json")));
  assert.ok(existsSync(join(root, "state", "upgrade-journal.jsonl")));
  assert.ok(
    existsSync(join(assetsDir(root, "tts"), ".record-kokoro-v1.0.fp16.onnx")),
    "speech asset record marker present (offline record mode)",
  );

  const state = readState(root, "darwin");
  assert.equal(state.schema, STATE_SCHEMA);
  assert.equal(state.components["spec-protocol"].version, PUBLISHED);
  assert.equal(state.components.kaizen.version, SKILL_PINS.kaizen);
  assert.equal(state.components["candice-integration"].version, PLUGIN_PINS["candice-integration"]);

  // The prebuilt app has no verifiable payload record today (zero GitHub
  // releases) — the leg is SKIPPED and reported, never invented (fail closed).
  assert.ok(!state.components["candice-companion"], "app must not be faked");
  const h = healthCheck({ root, platform: "darwin" });
  assert.equal(h.ok, false);
  assert.ok(h.missing.includes("candice-companion"), JSON.stringify(h.missing));
  assert.ok(!h.missing.includes("spec-protocol"));
  rmSync(root, { recursive: true, force: true });
});

test("leg 4: stale supported skills refresh through the deterministic bundle path", () => {
  const root = freshBootstrapRoot();
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  plantOldSkill(join(skills, "kaizen"), "kaizen", "0.9.0"); // stale -> upgrade
  plantOldSkill(join(skills, "eli5"), "eli5", "9.9.9"); // ahead -> never downgrade

  const r = runNode([UPGRADE_CLI, "repair", "--offline", "--root", root]);
  assert.equal(r.status, 0, r.out);

  assert.equal(readFileSync(join(skills, "kaizen", "VERSION"), "utf8").trim(), SKILL_PINS.kaizen);
  assert.equal(readFileSync(join(skills, "eli5", "VERSION"), "utf8").trim(), "9.9.9");

  const state = readState(root, "darwin");
  assert.equal(state.components.kaizen.version, SKILL_PINS.kaizen);
  assert.ok(!state.components.eli5, "ahead component must not be recorded as repaired");
  rmSync(root, { recursive: true, force: true });
});

test("leg 5: plain Claude settings/provider config remain untouched by repair", () => {
  const home = freshHome();
  const settings = join(home, ".claude", "settings.json");
  const claudeJson = join(home, ".claude", ".claude.json");
  writeFileSync(settings, '{"env":{"ANTHROPIC_MODEL":"claude-sonnet-4-5"}}\n');
  writeFileSync(claudeJson, '{"globalConfigVersion":7,"projects":{}}\n');
  const beforeSettings = readFileSync(settings, "utf8");
  const beforeClaudeJson = readFileSync(claudeJson, "utf8");
  const beforeListing = readdirSync(join(home, ".claude")).sort();

  const root = freshBootstrapRoot();
  const r = runNode([UPGRADE_CLI, "repair", "--offline", "--root", root]);
  assert.equal(r.status, 0, r.out);

  // Repair writes only under --root. The fixture config root is byte-identical.
  assert.deepEqual(readdirSync(join(home, ".claude")).sort(), beforeListing);
  assert.equal(readFileSync(settings, "utf8"), beforeSettings);
  assert.equal(readFileSync(claudeJson, "utf8"), beforeClaudeJson);
  assert.equal(existsSync(join(home, ".claude-nine")), false);
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("leg 6: rollback restores the old tree after an injected failure (WS-33 engine)", () => {
  const root = freshBootstrapRoot();
  const skills = join(root, "skills");
  const sp = join(skills, "spec-protocol");
  mkdirSync(sp, { recursive: true });
  writeFileSync(join(sp, "SKILL.md"), "# old spec-protocol tree\n");
  writeFileSync(join(sp, "VERSION"), `${OLD}\n`);

  const backups = join(skills, ".candice-backups");
  const staged = join(root, "state", "staging", "spec-protocol");
  mkdirSync(staged, { recursive: true });
  writeFileSync(join(staged, "SKILL.md"), "# new spec-protocol tree\n");
  writeFileSync(join(staged, "VERSION"), `${PUBLISHED}\n`);
  writeFileSync(join(staged, ".candice-install-ok"), "marker\n");

  const install = spawnSync(
    "node",
    [ATOMIC_ENGINE, "install", "--from", staged, "--to", sp, "--backup-dir", backups],
    { encoding: "utf8" },
  );
  assert.equal(install.status, 0, install.out);
  assert.equal(readFileSync(join(sp, "VERSION"), "utf8").trim(), PUBLISHED, "new tree live");
  assert.equal(readFileSync(join(sp, "SKILL.md"), "utf8"), "# new spec-protocol tree\n");
  const backupDirs = readdirSync(backups).filter((n) => n.startsWith("spec-protocol.") && n.endsWith(".backup"));
  assert.ok(backupDirs.length >= 1, "old tree backed up");

  // Injected failure: the installed tree is broken mid-life (SKILL.md lost).
  rmSync(join(sp, "SKILL.md"));

  // Rollback restores the exact old tree.
  const rb = runNode([ATOMIC_ENGINE, "rollback", "--to", sp, "--backup-dir", backups]);
  assert.equal(rb.status, 0, rb.out);
  assert.equal(readFileSync(join(sp, "VERSION"), "utf8").trim(), OLD, "rollback restored the exact old version");
  assert.equal(readFileSync(join(sp, "SKILL.md"), "utf8"), "# old spec-protocol tree\n");
  rmSync(root, { recursive: true, force: true });
});
