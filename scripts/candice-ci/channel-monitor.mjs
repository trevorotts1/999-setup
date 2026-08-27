#!/usr/bin/env node
/**
 * Candice live-channel monitor (FIX-021 layer 2).
 *
 * Owned glob: `scripts/candice-ci/**` (FIX-021 repair integration lane;
 * PROJECT-MANIFEST 9.4 class 4 — global CI tooling, non-partitionable).
 *
 * Operations tool, NOT a release-blocking check. The release-blocking
 * upgrade suite is hermetic only (temp install roots + pinned local channel
 * fixture); this monitor is the one place that talks to the live
 * operator-controlled channel, and its result never participates in a
 * release verdict except as an operations note.
 *
 * It reuses the WS-32 detector (`scripts/candice-upgrade/detect.mjs`) with
 * its default live fetch and the caller's real HOME, so the verdict is
 * exactly what `upgrade.mjs check` would conclude on this host. The
 * detector's own contract holds: a failed instrument reports
 * `undetermined`, never `current`.
 *
 * Usage:
 *   node scripts/candice-ci/channel-monitor.mjs [--root <dir>] [--fail-on-stale] [--url <channel-url>]
 *
 * `--url` is the detector's test seam (detect.mjs `url` override) — tests
 * point it at the pinned local channel fixture; production invocations omit
 * it and hit the live operator-controlled channel.
 *
 * Exit codes:
 *   0  current — every installed root is at or ahead of the published version
 *   1  stale   — at least one installed root is older than published
 *   2  undetermined — the published version could not be read (network
 *      failure, non-2xx, unparseable page), or usage error
 *
 * The monitor never writes to any installed tree and never downloads
 * payloads (detect.mjs contract).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detect } from "../candice-upgrade/detect.mjs";

const args = process.argv.slice(2);
const readArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function usage() {
  console.error("usage: node scripts/candice-ci/channel-monitor.mjs [--root <dir>] [--fail-on-stale] [--url <channel-url>]");
  process.exit(2);
}

function saveRecord(root, record) {
  if (!root) return;
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "channel-monitor.json"), JSON.stringify(record, null, 2) + "\n");
  } catch (err) {
    console.error(`WARN record write failed: ${err.message}`);
  }
}

async function main() {
  const rootArg = readArg("--root");
  const failOnStale = args.includes("--fail-on-stale");
  const urlArg = readArg("--url");
  const known = ["--root", "--fail-on-stale", "--url"];
  if (args.some((a) => a.startsWith("-") && !known.includes(a))) usage();
  if (args.includes("--url") && !urlArg) usage();

  const root = rootArg ? resolve(rootArg) : null;
  const d = await detect(urlArg ? { url: urlArg } : {});
  const record = {
    schema: "candice/ci/channel-monitor@1",
    generatedAt: new Date().toISOString(),
    status: d.status,
    published: d.published,
    installed: d.installed,
    reason: d.reason ?? null,
    recommended: d.recommended ?? null,
  };

  if (d.status === "undetermined") {
    console.error(`UNDETERMINED — published spec-protocol version unreadable: ${d.reason}`);
    saveRecord(root, record);
    process.exit(2);
  }
  for (const [dir, v] of Object.entries(d.installed)) {
    console.log(`  ${v === null ? "UNKNOWN" : v}  ${dir}`);
  }
  if (d.status === "update") {
    console.log(`STALE — published ${d.published}; ${d.recommended ?? "self-update spec-protocol"}`);
    saveRecord(root, record);
    process.exit(failOnStale ? 1 : 0);
  }
  console.log(`CURRENT — installed spec-protocol is ${d.published} (published)`);
  saveRecord(root, record);
  process.exit(0);
}

main().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(2);
});
