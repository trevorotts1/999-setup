import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const CLI = join(here, "..", "upgrade.mjs");
function runCli(args, env = process.env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
// Async spawn — keeps this process's event loop alive so the local channel
// server can answer while the CLI's fetch is in flight (spawnSync blocks it).
function runCliAsync(args, env = process.env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}
function freshRoot() { return mkdtempSync(join(tmpdir(), "candice-upgrade-cli-")); }

// FIX-021 hermetic `check`: temp HOME + the pinned local channel fixture
// served over 127.0.0.1 (the same local-channel pattern the WS-47 upgrade
// journey uses), so the verdict never depends on the live home or the live
// published channel.
const CHANNEL_FIXTURE = join(repoRoot, "tests", "upgrade-fixtures", "fixtures", "channel", "VERSION");

// Serve the pinned fixture VERSION over a local HTTP server.
function serveChannel() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(readFileSync(CHANNEL_FIXTURE));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/VERSION` });
    });
  });
}

test("check is never a false current result", async () => {
  // Dead-instrument control first: with a temp HOME and a refused local
  // channel URL, the instrument must report UNDETERMINED — never current —
  // out of a failed channel read. Proves the instrument, not the channel.
  const deadHome = mkdtempSync(join(tmpdir(), "candice-upgrade-cli-dead-"));
  const dead = runCli(["check"], {
    ...process.env,
    HOME: deadHome,
    CANDICE_UPGRADE_PUBLISHED_URL: "http://127.0.0.1:1/published-version",
  });
  assert.equal(dead.status, 2, dead.stdout + dead.stderr);
  assert.match(dead.stderr, /UNDETERMINED/);
  rmSync(deadHome, { recursive: true, force: true });

  // Hermetic local-channel fixture: published VERSION pinned at
  // tests/upgrade-fixtures/fixtures/channel/VERSION and served locally;
  // installed tree pinned to the same version -> deterministic OK current,
  // no live network.
  const { server, url } = await serveChannel();
  try {
    const home = mkdtempSync(join(tmpdir(), "candice-upgrade-cli-"));
    const installedRoot = join(home, ".claude", "skills", "spec-protocol");
    mkdirSync(installedRoot, { recursive: true });
    writeFileSync(join(installedRoot, "VERSION"), "1.17.0\n");
    const hermetic = await runCliAsync(["check"], {
      ...process.env,
      HOME: home,
      CANDICE_UPGRADE_SKILLS_ROOT: installedRoot,
      CANDICE_UPGRADE_PUBLISHED_URL: url,
    });
    assert.equal(hermetic.status, 0, hermetic.stdout + hermetic.stderr);
    assert.match(hermetic.stdout, /OK current/);
    rmSync(home, { recursive: true, force: true });

    // Stale leg: installed tree pinned OLDER than the fixture -> UPDATE
    // AVAILABLE, still fully local.
    const staleHome = mkdtempSync(join(tmpdir(), "candice-upgrade-cli-stale-"));
    const staleRoot = join(staleHome, ".claude", "skills", "spec-protocol");
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(join(staleRoot, "VERSION"), "1.0.0\n");
    const stale = await runCliAsync(["check"], {
      ...process.env,
      HOME: staleHome,
      CANDICE_UPGRADE_SKILLS_ROOT: staleRoot,
      CANDICE_UPGRADE_PUBLISHED_URL: url,
    });
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stdout, /UPDATE AVAILABLE/);
    rmSync(staleHome, { recursive: true, force: true });
  } finally {
    server.close();
  }
});

test("release repair exits nonzero for a quarantined app and writes no partial tree", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root, "--mode", "release"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /repair blocked.*release-authorized/i);
  assert.equal(existsSync(join(root, "skills")), false);
  assert.equal(existsSync(join(root, "state", "bootstrap-state.json")), false);
  rmSync(root, { recursive: true, force: true });
});

test("release repair --simulate reports the same release block and writes nothing", () => {
  const root = freshRoot();
  const r = runCli(["repair", "--offline", "--root", root, "--simulate", "--mode", "release"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /repair blocked/);
  assert.equal(existsSync(join(root, "state")), false);
  rmSync(root, { recursive: true, force: true });
});

test("health reports the unavailable application", () => {
  const root = freshRoot();
  const r = runCli(["--health", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MISS candice-companion.*release-authorized/);
  rmSync(root, { recursive: true, force: true });
});

test("usage error exits 2", () => {
  const r = runCli(["bogus-command"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
