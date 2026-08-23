import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkflows } from "../check-workflow.mjs";

const SHA = "a".repeat(40);

function fixture(workflows) {
  const root = mkdtempSync(join(tmpdir(), "candice-ci-check-"));
  const dir = join(root, ".github", "workflows");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(dir, name), body);
  }
  return root;
}

const CLEAN = `name: candice-ci
on: workflow_dispatch
jobs:
  macos-arm64:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@${SHA}
      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22
      - uses: dtolnay/rust-toolchain@${SHA}
        with:
          toolchain: 1.97.1
      - name: App frontend build
        run: |
          cd apps/candice-companion
          npm ci
          npm run build
      - name: Q-10 smoke posture gate (no updater content, real pubkey)
        run: node scripts/candice-release/updater-sign.mjs --posture smoke --config apps/candice-companion/tauri.conf.json
      - name: Tauri release bundle build (macOS, unsigned)
        run: |
          cd apps/candice-companion
          npm run tauri:build
      - name: current-commit evidence
        run: git rev-parse HEAD > commit-sha.txt
      - uses: actions/upload-artifact@${SHA}
        with:
          name: commit-sha
          path: commit-sha.txt
  windows-x64:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@${SHA}
      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22
  determinism:
    needs: [macos-arm64]
    strategy:
      matrix:
        shard: [1, 2]
    runs-on: macos-14
    steps:
      - uses: actions/checkout@${SHA}
  release-authority:
    if: startsWith(github.ref, 'refs/tags/candice-v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${SHA}
      - uses: actions/setup-node@${SHA}
        with:
          node-version: 22
      - run: node scripts/candice-release/status.mjs --root $GITHUB_WORKSPACE
`;

const PERF_STEP = `      - name: WS-45 performance suite (quick gate)
        run: node tests/performance/run.mjs --quick --require-bundle "apps/candice-companion/src-tauri/target/release/bundle/macos/Candice Companion.app"
      - uses: actions/upload-artifact@${SHA}
        with:
          name: perf-report
          path: tests/performance/reports/perf-*.json
`;

test("clean workflow passes", () => {
  const root = fixture({ "candice-ci.yml": CLEAN });
  const r = checkWorkflows(root);
  assert.equal(r.ok, true, r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("continue-on-error in a required job fails", () => {
  const root = fixture({
    "candice-ci.yml": CLEAN.replace(
      "      - name: current-commit evidence",
      "      - name: bad verifier\n        continue-on-error: true\n        run: bash tests/macos/verify-macos.sh\n      - name: current-commit evidence",
    ),
  });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("macos-arm64 is required but uses continue-on-error")));
  rmSync(root, { recursive: true, force: true });
});

test("unpinned action refs fail", () => {
  const root = fixture({
    "candice-ci.yml": CLEAN.replace(`actions/checkout@${SHA}`, "actions/checkout@v4"),
  });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unpinned action actions/checkout@v4")));
  rmSync(root, { recursive: true, force: true });
});

test("floating stable toolchain fails", () => {
  const root = fixture({
    "candice-ci.yml": CLEAN.replace(`dtolnay/rust-toolchain@${SHA}`, "dtolnay/rust-toolchain@stable"),
  });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("unpinned action dtolnay/rust-toolchain@stable")));
  rmSync(root, { recursive: true, force: true });
});

test("npm install fails", () => {
  const root = fixture({
    "candice-ci.yml": CLEAN.replace("          npm ci\n", "          npm install\n"),
  });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("uses npm install")));
  rmSync(root, { recursive: true, force: true });
});

test("perf before bundle build fails", () => {
  const bundleStep = `      - name: Q-10 smoke posture gate (no updater content, real pubkey)
        run: node scripts/candice-release/updater-sign.mjs --posture smoke --config apps/candice-companion/tauri.conf.json
      - name: Tauri release bundle build (macOS, unsigned)
        run: |
          cd apps/candice-companion
          npm run tauri:build
`;
  const body = CLEAN.replace(bundleStep, PERF_STEP + bundleStep);
  const root = fixture({ "candice-ci.yml": body });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("perf suite before the bundle build")), r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("perf without --require-bundle fails", () => {
  const bundleStep = `      - name: Q-10 smoke posture gate (no updater content, real pubkey)
        run: node scripts/candice-release/updater-sign.mjs --posture smoke --config apps/candice-companion/tauri.conf.json
      - name: Tauri release bundle build (macOS, unsigned)
        run: |
          cd apps/candice-companion
          npm run tauri:build
`;
  const body = CLEAN.replace(bundleStep, PERF_STEP + bundleStep);
  const noBundle = body.replace("--require-bundle \"apps/candice-companion/src-tauri/target/release/bundle/macos/Candice Companion.app\"", "");
  const root = fixture({ "candice-ci.yml": noBundle });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("no step passes --require-bundle")), r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});

test("missing determinism, upload-artifact, or commit evidence fails", () => {
  const root = fixture({ "candice-ci.yml": CLEAN.replace(/  determinism:[\s\S]*?release-authority:/, "  release-authority:") });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("no determinism matrix job")));
  rmSync(root, { recursive: true, force: true });

  const root2 = fixture({ "candice-ci.yml": CLEAN.replace(/      - uses: actions\/upload-artifact@[a-f0-9]{40}\n        with:\n          name: commit-sha\n          path: commit-sha.txt\n/, "") });
  const r2 = checkWorkflows(root2);
  assert.ok(r2.errors.some((e) => e.includes("no upload-artifact step")));
  rmSync(root2, { recursive: true, force: true });

  const root3 = fixture({ "candice-ci.yml": CLEAN.replace(/git rev-parse HEAD > commit-sha.txt/, "git rev-parse HEAD > commit-sha-other.txt") });
  const r3 = checkWorkflows(root3);
  assert.ok(r3.errors.some((e) => e.includes("no current-commit evidence step")), r3.errors.join("; "));
  rmSync(root3, { recursive: true, force: true });
});

test("kaizen workflow SHA pins are validated too", () => {
  const kaizen = `name: kaizen-tests
on: push
jobs:
  unix-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
`;
  const root = fixture({ "kaizen-tests.yml": kaizen });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("kaizen-tests.yml") && e.includes("unpinned action actions/checkout@v4")));
  rmSync(root, { recursive: true, force: true });
});

test("Tauri build without Q-10 smoke posture gate fails", () => {
  const gate = `      - name: Q-10 smoke posture gate (no updater content, real pubkey)
        run: node scripts/candice-release/updater-sign.mjs --posture smoke --config apps/candice-companion/tauri.conf.json
`;
  const body = CLEAN.replace(gate, "");
  const root = fixture({ "candice-ci.yml": body });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes("macos-arm64") && e.includes("Q-10 smoke posture gate")),
    r.errors.join("; "),
  );
  rmSync(root, { recursive: true, force: true });
});

test("Tauri build before the Q-10 smoke posture gate fails", () => {
  const gate = `      - name: Q-10 smoke posture gate (no updater content, real pubkey)
        run: node scripts/candice-release/updater-sign.mjs --posture smoke --config apps/candice-companion/tauri.conf.json
`;
  const bundleStep = `      - name: Tauri release bundle build (macOS, unsigned)
        run: |
          cd apps/candice-companion
          npm run tauri:build
`;
  const body = CLEAN.replace(gate + bundleStep, bundleStep + gate);
  const root = fixture({ "candice-ci.yml": body });
  const r = checkWorkflows(root);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes("macos-arm64") && e.includes("before the Q-10 smoke posture gate")),
    r.errors.join("; "),
  );
  rmSync(root, { recursive: true, force: true });
});

test("clean workflow with the smoke posture gate still passes", () => {
  const root = fixture({ "candice-ci.yml": CLEAN });
  const r = checkWorkflows(root);
  assert.equal(r.ok, true, r.errors.join("; "));
  rmSync(root, { recursive: true, force: true });
});
