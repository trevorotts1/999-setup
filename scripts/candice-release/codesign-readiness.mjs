#!/usr/bin/env node
/**
 * FIX-010 — macOS codesign/spctl release readiness (H04 fault-baseline).
 * Marker: FIX-010-readiness.
 *
 * Owned path: scripts/candice-release/** (PROJECT-MANIFEST 9.2, WR-017 row:
 * app-level candice scripts). Sibling of status.mjs (the control-state
 * gate). This is the macOS artifact gate: a shipped DMG must be Developer
 * ID-signed, hardened-runtime, notarized, stapled, and Gatekeeper-accepted,
 * or release is BLOCKED with a precise report naming the exact missing
 * credential or entitlement step and the operator command that resolves it.
 *
 * Never fabricates a pass:
 *   - every PASS derives from a really-executed command or filesystem read
 *     whose exit code is captured in the report evidence;
 *   - there are no environment overrides and no skip flags;
 *   - Gatekeeper is never disabled and no weakening step is ever printed
 *     (Master Spec 23);
 *   - a fail-closed self-check forces BLOCKED if any PASS lacks evidence.
 *
 * Exit codes:
 *   0  RELEASE_AUTHORIZED — every check passed on a real artifact.
 *   2  BLOCKED — structured JSON report on stdout, human report on stderr.
 *
 * Usage:
 *   node scripts/candice-release/codesign-readiness.mjs [--root <repo-root>]
 *       [--dmg <path-to.dmg> | --build] [--posture adhoc|devid]
 *   --dmg      assess the given DMG (never builds).
 *   --build    build via the WS-23 lane (build-macos-bundle.sh prod dmg) first.
 *   --posture  adhoc (DEFAULT, operator decision 2026-08-23: free-path
 *              release — ad-hoc signature valid + codesign verify gates;
 *              Developer ID / notary / Gatekeeper checks are named SKIPS)
 *              or devid (original FIX-010 posture, all credentials required).
 *   default    use apps/candice-companion/dist/Candice-Companion.dmg when it
 *              exists, otherwise build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REPORT_SCHEMA = "candice/codesign-readiness@1";
export const FIX_ID = "FIX-010";
export const REPORT_MARKER = "FIX-010-readiness";

// QFIX-adhoc 2026-08-23 — release postures.
//   adhoc (DEFAULT): operator decision — free-path release with NO Developer
//     ID cert, NO notarization, NO $99 Apple account. Clients bypass
//     Gatekeeper once at first launch. What REMAINS fail-closed: a valid
//     signature (ad-hoc acceptable), codesign --verify passes, the
//     entitlements baseline stays false/false/false, and the mic/speech
//     usage descriptions are present. Developer ID identity, notarytool
//     credential, Gatekeeper (spctl), and notarization checks become named
//     SKIPS — never fabricated PASSes.
//   devid: the pre-existing FIX-010 posture (Developer ID + notarization +
//     Gatekeeper all required). Preserved verbatim for when a paid Apple
//     account exists again.
export const POSTURES = Object.freeze(["adhoc", "devid"]);
export const DEFAULT_POSTURE = "adhoc";
export const ADHOC_SKIP_REASON =
  "adhoc posture per operator decision 2026-08-23 (free-path release: no Developer ID cert, no notarization; clients bypass Gatekeeper once)";
const ADHOC_UNSIGNED_DMG_REASON =
  "unsigned DMG — acceptable under adhoc posture per operator decision 2026-08-23; signature assessment happens on the mounted .app";

const OUTPUT_CAP = 4000;
const APP_REL = "apps/candice-companion";
const DIST_DMG = "Candice-Companion.dmg";
const BUILD_REL = `${APP_REL}/scripts/package-macos/build-macos-bundle.sh`;
const NOTARIZE_REL = `${APP_REL}/scripts/package-macos/notarize.sh`;
const ENTITLEMENTS_REL = `${APP_REL}/scripts/package-macos/entitlements.plist`;

const ENTITLEMENT_BASELINE = Object.freeze([
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
]);

// --- operator actions (the precise failure report contract) -----------------

const ACTION_DEVELOPER_ID = Object.freeze({
  missingCredential: "Apple Developer ID Application certificate (login keychain)",
  operatorAction: Object.freeze({
    what: "Create a Developer ID Application certificate at developer.apple.com (Certificates, Identifiers & Profiles > Certificates > Create > Developer ID Application), download the .cer, install it into the login keychain, then rebuild and re-run this check.",
    commands: Object.freeze([
      "security import /path/to/developerID_application.cer -k ~/Library/Keychains/login.keychain-db",
      "security find-identity -v -p codesigning",
      `bash ${BUILD_REL} prod dmg`,
      "node scripts/candice-release/codesign-readiness.mjs --build",
    ]),
  }),
});

const ACTION_SIGN = Object.freeze({
  missingCredential: "Developer ID Application signature on the artifact",
  operatorAction: Object.freeze({
    what: "Sign the artifact with the Developer ID Application identity, hardened runtime on, timestamp, and the WS-23 entitlement baseline, then notarize and staple. Gatekeeper must never be disabled.",
    commands: Object.freeze([
      `codesign --force --timestamp --options runtime --entitlements ${ENTITLEMENTS_REL} --sign "Developer ID Application: <Common Name> (<TEAM>)" "<artifact>"`,
      `bash ${BUILD_REL} prod dmg`,
    ]),
  }),
});

const ACTION_NOTARIZE = Object.freeze({
  missingCredential: "Apple notarization credential (keychain profile, App Store Connect API key, or Apple ID app-specific password)",
  operatorAction: Object.freeze({
    what: "Store a notarization credential, submit the artifact, and staple the ticket. Gatekeeper must never be disabled.",
    commands: Object.freeze([
      'xcrun notarytool store-credentials "candice-notary" --apple-id "<APPLE_ID>" --team-id "<TEAM_ID>" --password "<app-specific-password>"',
      'xcrun notarytool store-credentials "candice-notary" --key "<path.p8>" --key-id "<KEY_ID>" --issuer "<ISSUER_ID>"',
      `NOTARY_KEYCHAIN_PROFILE=candice-notary bash ${NOTARIZE_REL}`,
      'xcrun stapler staple "<artifact>"',
    ]),
  }),
});

const ACTION_GATEKEEPER = Object.freeze({
  missingCredential: "Gatekeeper acceptance (spctl assessment) of the artifact",
  operatorAction: Object.freeze({
    what: "Gatekeeper rejected or could not assess the artifact. Re-sign with Developer ID (hardened runtime + entitlements), notarize, staple, then re-assess. Gatekeeper must never be disabled and customers must never be told to weaken security (Master Spec 23).",
    commands: Object.freeze([
      `bash ${BUILD_REL} prod dmg`,
      `NOTARY_KEYCHAIN_PROFILE=candice-notary bash ${NOTARIZE_REL}`,
      'spctl -a -t exec -vv "<artifact>"',
    ]),
  }),
});

const ACTION_HARDENED_RUNTIME = Object.freeze({
  missingCredential: "hardened runtime flag on the signed artifact",
  operatorAction: Object.freeze({
    what: "The artifact was signed without hardened runtime (--options runtime), which notarization requires. Re-sign with the runtime option and the WS-23 entitlement baseline.",
    commands: Object.freeze([
      `codesign --force --timestamp --options runtime --entitlements ${ENTITLEMENTS_REL} --sign "Developer ID Application: <Common Name> (<TEAM>)" "<app>"`,
      `bash ${BUILD_REL} prod dmg`,
    ]),
  }),
});

function actionEntitlements(violations) {
  return {
    missingCredential: `hardened-runtime entitlement baseline violated: ${violations.join(", ")}`,
    operatorAction: {
      what: `Set the listed keys to <false/> in ${ENTITLEMENTS_REL}, then re-sign with --entitlements and hardened runtime.`,
      commands: [
        `codesign --force --timestamp --options runtime --entitlements ${ENTITLEMENTS_REL} --sign "Developer ID Application: <Common Name> (<TEAM>)" "<app>"`,
        `bash ${BUILD_REL} prod dmg`,
      ],
    },
  };
}

const ACTION_TOOLING = Object.freeze({
  missingCredential: "macOS signing tooling",
  operatorAction: Object.freeze({
    what: "Required signing tools are missing. Install Xcode Command Line Tools (provides xcrun, stapler, notarytool); codesign/spctl ship with macOS and their absence indicates a damaged OS install.",
    commands: Object.freeze(["xcode-select --install"]),
  }),
});

const ACTION_HOST = Object.freeze({
  missingCredential: "macOS host",
  operatorAction: Object.freeze({
    what: "Release authorization for the macOS artifact can only be granted on a macOS host (Apple Silicon reference platform, Master Spec 0.3). Run this check on the operator Mac.",
    commands: Object.freeze(["node scripts/candice-release/codesign-readiness.mjs --build"]),
  }),
});

// --- real dependencies (CLI path; tests inject their own) -------------------

export function realDeps() {
  const run = (cmd, args, opts = {}) => {
    const res = spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: opts.timeout ?? 60000,
      ...opts,
    });
    return {
      status: res.status,
      stdout: String(res.stdout ?? "").slice(0, OUTPUT_CAP),
      stderr: String(res.stderr ?? "").slice(0, OUTPUT_CAP),
      error: res.error ? String(res.error.message) : undefined,
    };
  };
  return {
    uname: () => {
      const res = run("uname", ["-s"]);
      return res.status === 0 ? res.stdout.trim() : "unknown";
    },
    hasTool: (tool) => run("sh", ["-c", `command -v ${tool}`]).status === 0,
    run,
    buildDmg: (appDir) => {
      const res = run("bash", [join(appDir, "scripts/package-macos/build-macos-bundle.sh"), "prod", "dmg"], {
        cwd: appDir,
        timeout: 600000,
      });
      const dmgPath = join(appDir, "dist", DIST_DMG);
      return { ...res, dmgPath: existsSync(dmgPath) ? dmgPath : null };
    },
    mount: (dmgPath) => {
      const res = run("hdiutil", ["attach", "-readonly", "-nobrowse", "-plist", dmgPath], { timeout: 120000 });
      if (res.status !== 0) {
        throw new Error(`hdiutil attach failed (exit ${res.status}): ${res.stderr || res.stdout}`);
      }
      const match = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(res.stdout);
      if (!match) throw new Error("hdiutil attach succeeded but mount-point was not found in the plist output");
      return { mountPoint: match[1] };
    },
    unmount: (mountPoint) => {
      run("hdiutil", ["detach", mountPoint], { timeout: 60000 });
    },
    findApp: (mountPoint) => {
      const apps = readdirSync(mountPoint)
        .filter((entry) => entry.endsWith(".app"))
        .filter((entry) => existsSync(join(mountPoint, entry, "Contents", "MacOS")));
      return { appPath: apps.length === 1 ? join(mountPoint, apps[0]) : null, appCount: apps.length };
    },
  };
}

// --- helpers -----------------------------------------------------------------

function evidence(cmd, res) {
  return {
    cmd,
    exitCode: res.status ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function plistBool(xml, key) {
  const match = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`).exec(xml);
  return match ? match[1] === "true" : null;
}

// QFIX-adhoc: usage-description presence in a bundled Info.plist. A key with
// an empty <string/> is treated as absent — macOS shows a blank permission
// prompt, which is the same user-facing defect as omitting the key.
export function infoPlistUsageDescriptions(plistXml, keys) {
  const missing = [];
  for (const key of keys) {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plistXml);
    if (!match || match[1].trim() === "") missing.push(key);
  }
  return missing;
}

function buildBlocker(stdout, stderr) {
  const text = `${stderr}\n${stdout}`;
  if (/no Developer ID identity/.test(text)) return { ...ACTION_DEVELOPER_ID, detail: "prod build failed: no Developer ID identity in keychain and APPLE_DEVELOPER_IDENTITY unset" };
  const toolMatch = /required tool missing: (\S+)/.exec(text);
  if (toolMatch) {
    return { ...ACTION_TOOLING, detail: `prod build failed: required tool missing: ${toolMatch[1]}` };
  }
  if (/entitlements file is not valid plist/.test(text)) {
    return { ...actionEntitlements(["invalid entitlements.plist"]), detail: `prod build failed: ${ENTITLEMENTS_REL} is not valid plist` };
  }
  if (/codesign failed/.test(text)) return { ...ACTION_SIGN, detail: "prod build failed: codesign failed on the bundle" };
  if (/spctl assessment FAILED/.test(text)) return { ...ACTION_GATEKEEPER, detail: "prod build failed: Gatekeeper assessment failed on the built .app" };
  if (/not a macOS host/.test(text)) return { ...ACTION_HOST, detail: "prod build failed: not a macOS host" };
  return {
    missingCredential: "successful WS-23 prod build",
    operatorAction: {
      what: "The WS-23 prod build failed for an unclassified reason. Inspect the captured output (in the check evidence) and retry.",
      commands: [`bash ${BUILD_REL} prod dmg`],
    },
    detail: "prod build failed (unclassified)",
  };
}

// --- the evaluation ----------------------------------------------------------

export function evaluateReadiness({ root = scriptRoot, dmgPath = null, build = false, posture = DEFAULT_POSTURE, deps = realDeps() } = {}) {
  // QFIX-adhoc: hermetic doubles may inject readInfoPlist (the mounted .app's
  // Info.plist text); production reads the real file from disk. The seam is
  // normalized onto deps.readTextFile so assessDmg has one call shape.
  if (typeof deps?.readInfoPlist === "function" && typeof deps.readTextFile !== "function") {
    deps.readTextFile = () => deps.readInfoPlist();
  }
  if (!POSTURES.includes(posture)) {
    throw new Error(`unknown posture '${posture}' (expected one of: ${POSTURES.join(", ")})`);
  }
  const adhoc = posture === "adhoc";
  const checks = [];
  const add = (id, label, status, detail, extra = {}) =>
    checks.push({
      id,
      label,
      status,
      detail,
      evidence: extra.evidence ?? [],
      ...(extra.missingCredential ? { missingCredential: extra.missingCredential } : {}),
      ...(extra.operatorAction ? { operatorAction: extra.operatorAction } : {}),
    });

  const appDir = join(root, APP_REL);
  let artifactPath = dmgPath;
  let built = false;

  // 1. host -------------------------------------------------------------
  const osName = deps.uname();
  if (osName !== "Darwin") {
    add("host-macos", "macOS host", "BLOCKED", `not a macOS host (uname -s = ${osName}) — release authorization cannot be granted here`, {
      ...ACTION_HOST,
      evidence: [evidence("uname -s", { status: 0, stdout: osName, stderr: "" })],
    });
    for (const id of ["tools", "artifact", "build", "identity", "dmg-signature", "dmg-signature-kind", "dmg-gatekeeper", "dmg-notarization", "embedded-app", "app-signature", "app-signature-kind", "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements"]) {
      add(id, id, "SKIP", "not evaluated: not a macOS host", {});
    }
    return finalize({ root, artifactPath, built, posture, checks });
  }
  add("host-macos", "macOS host", "PASS", `uname -s = ${osName}`, { evidence: [evidence("uname -s", { status: 0, stdout: osName, stderr: "" })] });

  // 2. tools ------------------------------------------------------------
  const requiredToolList = adhoc ? ["codesign", "security", "hdiutil"] : ["codesign", "spctl", "security", "hdiutil", "xcrun"];
  const missingTools = requiredToolList.filter((tool) => !deps.hasTool(tool));
  if (missingTools.length > 0) {
    add("tools", "required tools present", "BLOCKED", `missing: ${missingTools.join(", ")}`, {
      ...ACTION_TOOLING,
      evidence: missingTools.map((tool) => ({ cmd: `command -v ${tool}`, exitCode: 1, stdout: "", stderr: "not found" })),
    });
  } else {
    add("tools", "required tools present", "PASS", `${requiredToolList.join(", ")} all present`, {
      evidence: [{ cmd: `command -v ${requiredToolList.join(" ")}`, exitCode: 0, stdout: "all present", stderr: "" }],
    });
  }

  // 3. artifact ---------------------------------------------------------
  if (build) {
    const res = deps.buildDmg(appDir);
    if (res.status === 0 && res.dmgPath) {
      built = true;
      artifactPath = res.dmgPath;
      add("build", "WS-23 prod build", "PASS", `built ${res.dmgPath}`, { evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)] });
    } else if (res.status !== 0) {
      const blocker = buildBlocker(res.stdout, res.stderr);
      add("build", "WS-23 prod build", "BLOCKED", blocker.detail, { ...blocker, evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)] });
    } else {
      add("build", "WS-23 prod build", "BLOCKED", `build exited 0 but no DMG at ${join(appDir, "dist", DIST_DMG)}`, {
        missingCredential: "build output DMG",
        operatorAction: {
          what: `The build reported success but ${join(appDir, "dist", DIST_DMG)} does not exist. Inspect the build output and re-run.`,
          commands: [`bash ${BUILD_REL} prod dmg`],
        },
        evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)],
      });
    }
  } else if (!artifactPath) {
    const existing = join(appDir, "dist", DIST_DMG);
    if (existsSync(existing)) {
      artifactPath = existing;
    } else {
      const res = deps.buildDmg(appDir);
      built = true;
      if (res.status === 0 && res.dmgPath) {
        artifactPath = res.dmgPath;
        add("build", "WS-23 prod build", "PASS", `built ${res.dmgPath}`, { evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)] });
      } else if (res.status !== 0) {
        const blocker = buildBlocker(res.stdout, res.stderr);
        add("build", "WS-23 prod build", "BLOCKED", blocker.detail, { ...blocker, evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)] });
      } else {
        add("build", "WS-23 prod build", "BLOCKED", `build exited 0 but no DMG at ${join(appDir, "dist", DIST_DMG)}`, {
          missingCredential: "build output DMG",
          operatorAction: {
            what: `The build reported success but ${join(appDir, "dist", DIST_DMG)} does not exist. Inspect the build output and re-run.`,
            commands: [`bash ${BUILD_REL} prod dmg`],
          },
          evidence: [evidence(`bash ${BUILD_REL} prod dmg`, res)],
        });
      }
    }
  }
  if (artifactPath) {
    add("artifact", "release DMG resolved", "PASS", `${built ? "built " : ""}${artifactPath}`, {
      evidence: [{ cmd: "node:fs.existsSync", exitCode: 0, stdout: artifactPath, stderr: "" }],
    });
  } else {
    add("artifact", "release DMG resolved", "BLOCKED", "no DMG path resolved — provide --dmg <path> to a real built DMG or use --build", {
      missingCredential: "release DMG artifact",
      operatorAction: {
        what: "Provide a real built DMG via --dmg <path>, or build it with the WS-23 lane.",
        commands: [`bash ${BUILD_REL} prod dmg`, "node scripts/candice-release/codesign-readiness.mjs --build"],
      },
    });
  }

  // 4. identity ---------------------------------------------------------
  if (adhoc) {
    add("identity", "Developer ID identity in keychain", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON}`, {});
  } else {
    const identRes = deps.run("security", ["find-identity", "-v", "-p", "codesigning"]);
    const identText = `${identRes.stdout}\n${identRes.stderr}`;
    const identCount = Number(/(\d+) valid identities found/.exec(identText)?.[1] ?? 0);
    const identLine = identText.split("\n").find((line) => line.includes("Developer ID Application"));
    if (identRes.status !== 0) {
      add("identity", "Developer ID identity in keychain", "BLOCKED", `security(1) probe failed (exit ${identRes.status}) — cannot enumerate identities`, {
        ...ACTION_DEVELOPER_ID,
        evidence: [evidence("security find-identity -v -p codesigning", identRes)],
      });
    } else if (identCount === 0 || !identLine) {
      add("identity", "Developer ID identity in keychain", "BLOCKED", `no Developer ID Application identity (${identCount} valid identities found${identLine ? "" : ", none Developer ID"})`, {
        ...ACTION_DEVELOPER_ID,
        evidence: [evidence("security find-identity -v -p codesigning", identRes)],
      });
    } else {
      add("identity", "Developer ID identity in keychain", "PASS", `${identLine.trim()} (${identCount} valid identit${identCount === 1 ? "y" : "ies"})`, {
        evidence: [evidence("security find-identity -v -p codesigning", identRes)],
      });
    }
  }

  // 5. DMG checks -------------------------------------------------------
  const skipArtifactChecks = (reason) => {
    for (const id of ["dmg-signature", "dmg-signature-kind", "dmg-gatekeeper", "dmg-notarization", "embedded-app", "app-signature", "app-signature-kind", "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements"]) {
      add(id, id, "SKIP", reason, {});
    }
  };
  if (!artifactPath) {
    skipArtifactChecks("no artifact to assess");
  } else {
    assessDmg(deps, add, artifactPath, posture);
  }

  return finalize({ root, artifactPath, built, posture, checks });
}

function assessDmg(deps, add, artifactPath, posture) {
  const adhoc = posture === "adhoc";
  const findRes = deps.run("xcrun", ["--find", "stapler"]);

  // DMG signature (codesign --verify)
  // QFIX-adhoc recheck 2026-08-23: the WS-23 lane deliberately emits an
  // UNSIGNED DMG under the adhoc posture (build-macos-bundle.sh refuses dmg
  // for non-prod modes), so there is no DMG-level signature to verify — the
  // tamper-detection gate lives on the mounted .app below. This is the named
  // skip ADHOC_UNSIGNED_DMG_REASON already documented here, not a fabricated
  // pass; under devid posture the verify requirement stands unchanged.
  if (adhoc) {
    add("dmg-signature", "DMG codesign --verify", "SKIP", `SKIPPED: ${ADHOC_UNSIGNED_DMG_REASON}`, {});
  } else {
  const verifyRes = deps.run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", artifactPath]);
  if (verifyRes.status === 0) {
    add("dmg-signature", "DMG codesign --verify", "PASS", `${artifactPath} passes codesign --verify --deep --strict`, {
      evidence: [evidence(`codesign --verify --deep --strict --verbose=2 ${artifactPath}`, verifyRes)],
    });
  } else {
    add("dmg-signature", "DMG codesign --verify", "FAIL", `codesign --verify failed (exit ${verifyRes.status}): ${verifyRes.stderr.trim() || "no signature"}`, {
      ...ACTION_SIGN,
      evidence: [evidence(`codesign --verify --deep --strict --verbose=2 ${artifactPath}`, verifyRes)],
    });
  }
  }

  // DMG signature kind (Developer ID vs ad-hoc — codesign --verify alone
  // cannot tell them apart, so this check is the anti-fabrication gate).
  // Under adhoc posture the DMG itself is typically unsigned; the signature
  // gate is the mounted .app. An unsigned DMG is a named SKIP, not a PASS.
  if (adhoc) {
    add("dmg-signature-kind", "DMG signature kind", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON} — DMG-level signature identity is not required`, {});
    add("dmg-gatekeeper", "DMG Gatekeeper assessment", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON}`, {});
    add("dmg-notarization", "DMG notarization ticket", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON}`, {});
  } else {
  const dvRes = deps.run("codesign", ["-dv", "--verbose=4", artifactPath]);
  const dvText = `${dvRes.stdout}\n${dvRes.stderr}`;
  if (dvRes.status !== 0) {
    add("dmg-signature-kind", "DMG signature kind", "FAIL", `no signature readable (codesign -dv exit ${dvRes.status})`, {
      ...ACTION_SIGN,
      evidence: [evidence(`codesign -dv --verbose=4 ${artifactPath}`, dvRes)],
    });
  } else if (/Signature=adhoc/.test(dvText)) {
    add("dmg-signature-kind", "DMG signature kind", "FAIL", "ad-hoc signature — local smoke only, never a distribution artifact (codesign --verify passes on ad-hoc; Gatekeeper rejects it)", {
      ...ACTION_SIGN,
      evidence: [evidence(`codesign -dv --verbose=4 ${artifactPath}`, dvRes)],
    });
  } else if (!/Authority=Developer ID Application/.test(dvText) || !/TeamIdentifier=/.test(dvText)) {
    add("dmg-signature-kind", "DMG signature kind", "FAIL", "signature is not a Developer ID Application signature (missing Authority/TeamIdentifier)", {
      ...ACTION_SIGN,
      evidence: [evidence(`codesign -dv --verbose=4 ${artifactPath}`, dvRes)],
    });
  } else {
    const team = /TeamIdentifier=(\S+)/.exec(dvText)?.[1] ?? "unknown";
    add("dmg-signature-kind", "DMG signature kind", "PASS", `Developer ID Application signature, TeamIdentifier=${team}`, {
      evidence: [evidence(`codesign -dv --verbose=4 ${artifactPath}`, dvRes)],
    });
  }

  // DMG Gatekeeper assessment (spctl -a -t exec — the same verdict
  // Gatekeeper applies at download/open; never weakened, Master Spec 23)
  const spctlRes = deps.run("spctl", ["-a", "-t", "exec", "-vv", artifactPath]);
  if (spctlRes.status === 0) {
    add("dmg-gatekeeper", "DMG Gatekeeper assessment", "PASS", `spctl -a -t exec accepted ${artifactPath}`, {
      evidence: [evidence(`spctl -a -t exec -vv ${artifactPath}`, spctlRes)],
    });
  } else {
    const why = spctlRes.status === 3 ? "rejected by Gatekeeper" : `cannot be assessed (exit ${spctlRes.status}; no usable signature)`;
    add("dmg-gatekeeper", "DMG Gatekeeper assessment", "FAIL", `${why}: ${(spctlRes.stdout + spctlRes.stderr).trim().split("\n").slice(-3).join(" | ")}`, {
      ...ACTION_GATEKEEPER,
      evidence: [evidence(`spctl -a -t exec -vv ${artifactPath}`, spctlRes)],
    });
  }

  // DMG notarization ticket (stapler validate)
  {
    if (findRes.status !== 0) {
    add("dmg-notarization", "DMG notarization ticket", "BLOCKED", "stapler not available via xcrun (Xcode Command Line Tools too old or missing)", {
      ...ACTION_TOOLING,
      evidence: [evidence("xcrun --find stapler", findRes)],
    });
  } else {
    const stapleRes = deps.run("xcrun", ["stapler", "validate", artifactPath]);
    if (stapleRes.status === 0) {
      add("dmg-notarization", "DMG notarization ticket", "PASS", `valid notarization ticket stapled to ${artifactPath}`, {
        evidence: [evidence(`xcrun stapler validate ${artifactPath}`, stapleRes)],
      });
    } else {
      add("dmg-notarization", "DMG notarization ticket", "FAIL", `no valid stapled notarization ticket (exit ${stapleRes.status})`, {
        ...ACTION_NOTARIZE,
        evidence: [evidence(`xcrun stapler validate ${artifactPath}`, stapleRes)],
      });
    }
  }
  }
  }

  // Embedded .app (mount the DMG read-only, assess, always detach)
  let mountPoint = null;
  try {
    mountPoint = deps.mount(artifactPath).mountPoint;
  } catch (error) {
    add("embedded-app", "embedded .app bundle", "BLOCKED", `DMG could not be mounted: ${error.message}`, {
      missingCredential: "mountable DMG",
      operatorAction: {
        what: "The DMG failed to mount read-only. Verify DMG integrity, rebuild it, and re-run.",
        commands: [`hdiutil verify ${artifactPath}`, `bash ${BUILD_REL} prod dmg`],
      },
      evidence: [{ cmd: `hdiutil attach -readonly -nobrowse -plist ${artifactPath}`, exitCode: 1, stdout: "", stderr: String(error.message) }],
    });
    for (const id of ["app-signature", "app-signature-kind", "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements", "usage-descriptions"]) {
      add(id, id, "SKIP", "not evaluated: DMG could not be mounted", {});
    }
    return;
  }
  try {
    const { appPath, appCount } = deps.findApp(mountPoint);
    if (!appPath) {
      add("embedded-app", "embedded .app bundle", "BLOCKED", `DMG contains ${appCount} .app bundle(s) at its root — expected exactly one`, {
        missingCredential: "embedded .app bundle",
        operatorAction: {
          what: `The DMG must contain exactly one .app bundle at its root (the WS-23 build stage produces this). Rebuild with the lane.`,
          commands: [`bash ${BUILD_REL} prod dmg`],
        },
        evidence: [{ cmd: "node:fs.readdirSync", exitCode: 0, stdout: `mount=${mountPoint} appCount=${appCount}`, stderr: "" }],
      });
      for (const id of ["app-signature", "app-signature-kind", "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements", "usage-descriptions"]) {
        add(id, id, "SKIP", "not evaluated: no .app bundle in DMG", {});
      }
      return;
    }
    add("embedded-app", "embedded .app bundle", "PASS", `mounted ${artifactPath} at ${mountPoint}, found ${appPath}`, {
      evidence: [{ cmd: "node:fs.readdirSync", exitCode: 0, stdout: appPath, stderr: "" }],
    });

    // App signature
    const appVerify = deps.run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
    if (appVerify.status === 0) {
      add("app-signature", "app codesign --verify", "PASS", `${appPath} passes codesign --verify --deep --strict`, {
        evidence: [evidence(`codesign --verify --deep --strict --verbose=2 ${appPath}`, appVerify)],
      });
    } else {
      add("app-signature", "app codesign --verify", "FAIL", `codesign --verify failed (exit ${appVerify.status}): ${appVerify.stderr.trim() || "no signature"}`, {
        ...ACTION_SIGN,
        evidence: [evidence(`codesign --verify --deep --strict --verbose=2 ${appPath}`, appVerify)],
      });
    }

    // App signature kind
    if (adhoc) {
      add("app-signature-kind", "app signature kind", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON} (ad-hoc signature on the .app is acceptable)`, {});
    } else {
    const appDv = deps.run("codesign", ["-dv", "--verbose=4", appPath]);
    const appDvText = `${appDv.stdout}\n${appDv.stderr}`;
    if (appDv.status !== 0) {
      add("app-signature-kind", "app signature kind", "FAIL", `no signature readable (codesign -dv exit ${appDv.status})`, {
        ...ACTION_SIGN,
        evidence: [evidence(`codesign -dv --verbose=4 ${appPath}`, appDv)],
      });
    } else if (/Signature=adhoc/.test(appDvText)) {
      add("app-signature-kind", "app signature kind", "FAIL", "ad-hoc signature — local smoke only, never a distribution artifact", {
        ...ACTION_SIGN,
        evidence: [evidence(`codesign -dv --verbose=4 ${appPath}`, appDv)],
      });
    } else if (!/Authority=Developer ID Application/.test(appDvText) || !/TeamIdentifier=/.test(appDvText)) {
      add("app-signature-kind", "app signature kind", "FAIL", "signature is not a Developer ID Application signature (missing Authority/TeamIdentifier)", {
        ...ACTION_SIGN,
        evidence: [evidence(`codesign -dv --verbose=4 ${appPath}`, appDv)],
      });
    } else {
      const team = /TeamIdentifier=(\S+)/.exec(appDvText)?.[1] ?? "unknown";
      add("app-signature-kind", "app signature kind", "PASS", `Developer ID Application signature, TeamIdentifier=${team}`, {
        evidence: [evidence(`codesign -dv --verbose=4 ${appPath}`, appDv)],
      });
    }
    }

    // App Gatekeeper — spctl can never accept an ad-hoc signature, so under
    // adhoc posture it is a named SKIP (clients bypass Gatekeeper once).
    if (adhoc) {
      add("app-gatekeeper", "app Gatekeeper assessment", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON} (spctl cannot assess ad-hoc signatures; first-launch bypass is the operator-documented install step)`, {});
      add("app-notarization", "app notarization ticket", "SKIP", `SKIPPED: ${ADHOC_SKIP_REASON}`, {});
    } else {
    // App Gatekeeper
    const appSpctl = deps.run("spctl", ["-a", "-t", "exec", "-vv", appPath]);
    if (appSpctl.status === 0) {
      add("app-gatekeeper", "app Gatekeeper assessment", "PASS", `spctl -a -t exec accepted ${appPath}`, {
        evidence: [evidence(`spctl -a -t exec -vv ${appPath}`, appSpctl)],
      });
    } else {
      const why = appSpctl.status === 3 ? "rejected by Gatekeeper" : `cannot be assessed (exit ${appSpctl.status})`;
      add("app-gatekeeper", "app Gatekeeper assessment", "FAIL", `${why}: ${(appSpctl.stdout + appSpctl.stderr).trim().split("\n").slice(-3).join(" | ")}`, {
        ...ACTION_GATEKEEPER,
        evidence: [evidence(`spctl -a -t exec -vv ${appPath}`, appSpctl)],
      });
    }

    // App notarization ticket
    if (findRes.status !== 0) {
      add("app-notarization", "app notarization ticket", "BLOCKED", "stapler not available via xcrun", {
        ...ACTION_TOOLING,
        evidence: [evidence("xcrun --find stapler", findRes)],
      });
    } else {
      const appStaple = deps.run("xcrun", ["stapler", "validate", appPath]);
      if (appStaple.status === 0) {
        add("app-notarization", "app notarization ticket", "PASS", `valid notarization ticket stapled to ${appPath}`, {
          evidence: [evidence(`xcrun stapler validate ${appPath}`, appStaple)],
        });
      } else {
        add("app-notarization", "app notarization ticket", "FAIL", `no valid stapled notarization ticket (exit ${appStaple.status})`, {
          ...ACTION_NOTARIZE,
          evidence: [evidence(`xcrun stapler validate ${appPath}`, appStaple)],
        });
      }
    }
    }

    // Hardened runtime
    // QFIX-adhoc recheck 2026-08-23: ad-hoc signatures emit
    // `flags=0x10002(adhoc,runtime)` — the runtime flag IS present; the old
    // pattern demanded `(runtime)` as the sole flag word and misread a
    // hardened ad-hoc signature as unsigned-runtime. Match runtime as one of
    // the comma-separated flag words instead.
    const rtRes = deps.run("codesign", ["-dvvv", appPath]);
    const rtText = `${rtRes.stdout}\n${rtRes.stderr}`;
    if (rtRes.status === 0 && /flags=0x[0-9a-f]+\([^)]*\bruntime\b[^)]*\)/.test(rtText)) {
      add("hardened-runtime", "hardened runtime enabled", "PASS", "CodeDirectory flags include runtime (0x10000)", {
        evidence: [evidence(`codesign -dvvv ${appPath}`, rtRes)],
      });
    } else if (rtRes.status === 0) {
      add("hardened-runtime", "hardened runtime enabled", "FAIL", "CodeDirectory flags do not include runtime — artifact signed without --options runtime", {
        ...ACTION_HARDENED_RUNTIME,
        evidence: [evidence(`codesign -dvvv ${appPath}`, rtRes)],
      });
    } else {
      add("hardened-runtime", "hardened runtime enabled", "FAIL", `codesign -dvvv failed (exit ${rtRes.status}) — hardened runtime unverifiable`, {
        ...ACTION_HARDENED_RUNTIME,
        evidence: [evidence(`codesign -dvvv ${appPath}`, rtRes)],
      });
    }

    // Entitlement baseline
    const entRes = deps.run("codesign", ["-d", "--entitlements", ":-", appPath]);
    if (entRes.status !== 0) {
      add("entitlements", "entitlement baseline", "FAIL", `entitlements not readable (codesign -d --entitlements exit ${entRes.status})`, {
        ...actionEntitlements(["unreadable entitlements"]),
        evidence: [evidence(`codesign -d --entitlements :- ${appPath}`, entRes)],
      });
    } else {
      const violations = ENTITLEMENT_BASELINE.filter((key) => plistBool(entRes.stdout, key) === true);
      const unknown = ENTITLEMENT_BASELINE.filter((key) => plistBool(entRes.stdout, key) === null);
      if (violations.length > 0) {
        add("entitlements", "entitlement baseline", "FAIL", `hardened-runtime baseline violated: ${violations.join(", ")} = true (WS-23 baseline requires false)`, {
          ...actionEntitlements(violations),
          evidence: [evidence(`codesign -d --entitlements :- ${appPath}`, entRes)],
        });
      } else if (unknown.length > 0) {
        add("entitlements", "entitlement baseline", "FAIL", `entitlement baseline keys absent from the signed entitlements: ${unknown.join(", ")}`, {
          ...actionEntitlements(unknown),
          evidence: [evidence(`codesign -d --entitlements :- ${appPath}`, entRes)],
        });
      } else {
        add("entitlements", "entitlement baseline", "PASS", "allow-jit, allow-unsigned-executable-memory, disable-library-validation all false", {
          evidence: [evidence(`codesign -d --entitlements :- ${appPath}`, entRes)],
        });
      }
    }

    // Usage descriptions (QFIX-adhoc): the packaged-build lane found the
    // bundle missing NSMicrophoneUsageDescription / NSSpeechRecognitionUsageDescription.
    // macOS shows a blank TCC prompt (or silently denies) without them, in
    // every posture — so this is a hard gate under adhoc AND devid.
    const infoPlistPath = join(appPath, "Contents", "Info.plist");
    const readTextFile = typeof deps.readTextFile === "function"
      ? deps.readTextFile
      : (path) => readFileSync(path, "utf8");
    let infoPlistXml = null;
    try {
      infoPlistXml = readTextFile(infoPlistPath);
      if (typeof infoPlistXml !== "string") infoPlistXml = null;
    } catch {
      infoPlistXml = null;
    }
    if (infoPlistXml === null) {
      add("usage-descriptions", "mic/speech usage descriptions in Info.plist", "FAIL", `Info.plist not readable at ${infoPlistPath} — cannot verify NSMicrophoneUsageDescription / NSSpeechRecognitionUsageDescription`, {
        missingCredential: `readable Info.plist at Contents/Info.plist`,
        operatorAction: {
          what: "The .app bundle has no readable Info.plist; rebuild via the WS-23 lane.",
          commands: [`bash ${BUILD_REL} prod dmg`],
        },
        evidence: [{ cmd: `node:fs.readFileSync ${infoPlistPath}`, exitCode: 1, stdout: "", stderr: "not readable" }],
      });
    } else {
      const USAGE_KEYS = Object.freeze(["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]);
      const missingKeys = infoPlistUsageDescriptions(infoPlistXml, USAGE_KEYS);
      if (missingKeys.length > 0) {
        add("usage-descriptions", "mic/speech usage descriptions in Info.plist", "FAIL", `Info.plist is missing required usage-description keys: ${missingKeys.join(", ")}`, {
          missingCredential: `Info.plist keys: ${missingKeys.join(", ")}`,
          operatorAction: {
            what: `Add ${missingKeys.join(" and ")} to apps/candice-companion/src-tauri/Info.plist (merged into the bundle by the Tauri CLI), then rebuild.`,
            commands: [`bash ${BUILD_REL} prod dmg`],
          },
          evidence: [{ cmd: `node:RegExp over ${infoPlistPath}`, exitCode: 0, stdout: `missing: ${missingKeys.join(", ")}`, stderr: "" }],
        });
      } else {
        add("usage-descriptions", "mic/speech usage descriptions in Info.plist", "PASS", "NSMicrophoneUsageDescription and NSSpeechRecognitionUsageDescription present with non-empty strings", {
          evidence: [{ cmd: `node:RegExp over ${infoPlistPath}`, exitCode: 0, stdout: "both keys present, non-empty", stderr: "" }],
        });
      }
    }
  } finally {
    if (mountPoint) deps.unmount(mountPoint);
  }
}

export function finalize({ artifactPath, built, checks, posture = DEFAULT_POSTURE }) {
  if (!POSTURES.includes(posture)) {
    throw new Error(`unknown posture '${posture}' (expected one of: ${POSTURES.join(", ")})`);
  }
  const adhoc = posture === "adhoc";
  // Fail-closed self-check: a PASS without real evidence is a fabricated
  // pass. Force BLOCKED rather than ever emit one.
  const unproven = checks.filter((check) => check.status === "PASS" && check.evidence.length === 0);
  if (unproven.length > 0) {
    checks.push({
      id: "internal-evidence-guard",
      label: "evidence guard",
      status: "BLOCKED",
      detail: `internal fail-closed trip: ${unproven.map((c) => c.id).join(", ")} reported PASS without evidence`,
      missingCredential: "internal integrity",
      operatorAction: {
        what: "This is an internal invariant violation, not an operator credential gap. Re-run; if it persists, inspect the script.",
        commands: ["node scripts/candice-release/codesign-readiness.mjs --build"],
      },
      evidence: [],
    });
  }
  const blocked = checks.filter((check) => check.status === "FAIL" || check.status === "BLOCKED");
  // Verdict gate per posture:
  //   devid  — both Gatekeeper assessments must PASS (unchanged FIX-010 rule).
  //   adhoc  — Gatekeeper cannot accept an ad-hoc signature, so the
  //            signature gate is the app codesign --verify (must PASS).
  //            SKIPS are honest non-evaluations and never satisfy a gate.
  const gatekeeperDmgPass = adhoc
    ? true
    : checks.some((check) => check.id === "dmg-gatekeeper" && check.status === "PASS");
  const gatekeeperAppPass = adhoc
    ? checks.some((check) => check.id === "app-signature" && check.status === "PASS")
    : checks.some((check) => check.id === "app-gatekeeper" && check.status === "PASS");
  const verdict = blocked.length === 0 && gatekeeperDmgPass && gatekeeperAppPass ? "RELEASE_AUTHORIZED" : "BLOCKED";
  const report = {
    schema: REPORT_SCHEMA,
    fix: FIX_ID,
    marker: REPORT_MARKER,
    posture,
    verdict,
    generatedAt: new Date().toISOString(),
    artifact: { path: artifactPath ?? null, built: Boolean(built) },
    checks,
    blockers: blocked.map((check) => ({
      checkId: check.id,
      detail: check.detail,
      missingCredential: check.missingCredential ?? null,
      operatorAction: check.operatorAction ?? null,
    })),
  };
  return { report, exitCode: verdict === "RELEASE_AUTHORIZED" ? 0 : 2 };
}

// --- CLI ---------------------------------------------------------------------

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printHuman(report) {
  const lines = [`CODESIGN-READINESS ${FIX_ID} — ${report.verdict}`];
  if (report.artifact?.path) lines.push(`artifact: ${report.artifact.path}`);
  for (const check of report.checks) {
    lines.push(`${check.status.padEnd(7)} ${check.id.padEnd(22)} ${check.detail}`);
    if (check.missingCredential) lines.push(`  missing: ${check.missingCredential}`);
    if (check.operatorAction) {
      lines.push(`  action:  ${check.operatorAction.what}`);
      for (const cmd of check.operatorAction.commands) lines.push(`    $ ${cmd}`);
    }
  }
  console.error(lines.join("\n"));
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.error(
      [
        "usage: node scripts/candice-release/codesign-readiness.mjs [--root <repo-root>] [--dmg <path> | --build] [--posture adhoc|devid]",
        "  --posture adhoc (DEFAULT) — free-path release posture per operator decision 2026-08-23:",
        "      valid signature required (ad-hoc OK), codesign --verify gates, entitlement baseline and",
        "      usage descriptions gate; Developer ID / notarytool / Gatekeeper / notarization are named SKIPS.",
        "  --posture devid — original FIX-010 posture: Developer ID + hardened runtime + notarization + Gatekeeper all required.",
        "  --dmg    assess the given DMG (never builds)",
        "  --build  build via the WS-23 lane first (build-macos-bundle.sh prod dmg)",
        "  default  use apps/candice-companion/dist/Candice-Companion.dmg when present, otherwise build",
        "exit codes: 0 RELEASE_AUTHORIZED, 2 BLOCKED (structured JSON on stdout)",
      ].join("\n"),
    );
    return 2;
  }
  const root = resolve(argValue(args, "--root") || scriptRoot);
  const dmgArg = argValue(args, "--dmg");
  const postureArg = argValue(args, "--posture") || DEFAULT_POSTURE;
  if (!POSTURES.includes(postureArg)) {
    console.error(`codesign-readiness: unknown posture '${postureArg}' (expected one of: ${POSTURES.join(", ")})`);
    return 2;
  }
  const { report, exitCode } = evaluateReadiness({
    root,
    dmgPath: dmgArg ? resolve(dmgArg) : null,
    build: args.includes("--build"),
    posture: postureArg,
  });
  console.log(JSON.stringify(report, null, 2));
  printHuman(report);
  return exitCode;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) process.exit(main());
