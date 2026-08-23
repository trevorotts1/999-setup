/**
 * FIX-010-readiness — codesign-readiness.mjs node:test coverage.
 * Owned path: scripts/candice-release/__tests__/** (WR-017 app-level
 * candice scripts lane, alongside status.test.mjs).
 *
 * Hermetic: every macOS host/tool command is supplied by a scripted
 * dependency double, so these tests run identically on macOS and in Linux
 * CI. The fixture DMG/plist/mount are in-memory strings — never real
 * binaries, never real signing — so nothing here can be mistaken for a
 * signing pass.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateReadiness,
  finalize,
  REPORT_SCHEMA,
  FIX_ID,
  REPORT_MARKER,
  POSTURES,
  DEFAULT_POSTURE,
  ADHOC_SKIP_REASON,
  infoPlistUsageDescriptions,
} from "../codesign-readiness.mjs";

// --- scripted deps -----------------------------------------------------------

const ADHOC_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>NSMicrophoneUsageDescription</key>
	<string>Candice uses the microphone only when you hold the push-to-talk key.</string>
	<key>NSSpeechRecognitionUsageDescription</key>
	<string>Candice transcribes your push-to-talk speech on-device; audio is never uploaded.</string>
</dict>
</plist>
`;

const MAC_DEVELOPER_ID_LINE =
  '  1) 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789 "Developer ID Application: Candice Operator (TEAM1234)"';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<false/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<false/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<false/>
</dict>
</plist>
`;

const DMG_MOUNT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>mount-point</key>
	<string>/Volumes/Candice Companion</string>
</dict>
</plist>
`;

function res(status, stdout = "", stderr = "") {
  return { status, stdout, stderr, error: undefined };
}

function findIdentity(identText) {
  return res(0, `${identText}\n1 valid identities found`);
}

/** Fully passing macOS environment double. */
function greenDeps(overrides = {}) {
  const calls = [];
  const deps = {
    uname: () => "Darwin",
    hasTool: () => true,
    run: (cmd, args) => {
      calls.push([cmd, args]);
      const argString = args.join(" ");
      if (cmd === "security") return findIdentity(MAC_DEVELOPER_ID_LINE);
      if (cmd === "codesign" && argString.includes("--verify")) return res(0, "satisfies its Designated Requirement", "");
      if (cmd === "codesign" && argString.includes("-dv --verbose=4")) {
        return res(0, "", `Executable=/Volumes/x/Candice Companion.app/Contents/MacOS/candice-companion
Identifier=com.blackceo.candice
Format=app bundle with Mach-O thin (arm64)
CodeDirectory flags=0x10002(runtime) size=1234
TeamIdentifier=TEAM1234
Signature size=4567
Authority=Developer ID Application: Candice Operator (TEAM1234)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
`);
      }
      if (cmd === "codesign" && argString.includes("-dvvv")) {
        return res(0, "CodeDirectory flags=0x10002(runtime)", "");
      }
      if (cmd === "codesign" && argString.includes("--entitlements")) return res(0, PLIST, "");
      if (cmd === "spctl") return res(0, `${argString}: accepted\nsource=Notarized Developer ID`, "");
      if (cmd === "xcrun" && argString.includes("--find stapler")) return res(0, "/usr/bin/stapler", "");
      if (cmd === "xcrun" && argString.includes("stapler validate")) return res(0, "The validate action worked!", "");
      throw new Error(`greenDeps: unscripted command ${cmd} ${argString}`);
    },
    buildDmg: () => {
      calls.push(["bash", "build-macos-bundle.sh prod dmg"]);
      return { ...res(0, "DONE", ""), dmgPath: "/fixture/Candice-Companion.dmg" };
    },
    mount: () => {
      calls.push(["hdiutil", "attach"]);
      return { mountPoint: "/Volumes/Candice Companion" };
    },
    unmount: (mountPoint) => calls.push(["hdiutil", "detach", mountPoint]),
    findApp: () => ({ appPath: "/Volumes/Candice Companion/Candice Companion.app", appCount: 1 }),
    // QFIX-adhoc seam: text of the mounted .app's Contents/Info.plist.
    readInfoPlist: () => ADHOC_INFO_PLIST,
  };
  return Object.assign(deps, overrides);
}

function blockingDeps(overrides = {}) {
  return greenDeps({
    hasTool: () => true,
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "security") return res(0, "0 valid identities found", "");
      if (cmd === "codesign" && argString.includes("--verify")) return res(1, "", "code object is not signed at all");
      if (cmd === "codesign" && argString.includes("-dv --verbose=4")) return res(1, "", "code object is not signed at all");
      if (cmd === "codesign" && argString.includes("-dvvv")) return res(1, "", "code object is not signed at all");
      if (cmd === "codesign" && argString.includes("--entitlements")) return res(1, "", "code object is not signed at all");
      if (cmd === "spctl") return res(3, "", "rejected");
      if (cmd === "xcrun" && argString.includes("--find stapler")) return res(0, "/usr/bin/stapler", "");
      if (cmd === "xcrun" && argString.includes("stapler validate")) return res(65, "", "record not found");
      throw new Error(`blockingDeps: unscripted command ${cmd} ${argString}`);
    },
    buildDmg: () => {
      return {
        ...res(1, "", "build-macos-bundle: prod mode but no Developer ID identity found (keychain empty or APPLE_DEVELOPER_IDENTITY unset)"),
        dmgPath: null,
      };
    },
    mount: () => ({ mountPoint: "/Volumes/Candice Companion" }),
    findApp: () => ({ appPath: "/Volumes/Candice Companion/Candice Companion.app", appCount: 1 }),
    ...overrides,
  });
}

function findCheck(report, id) {
  return report.checks.find((check) => check.id === id);
}

// --- tests -------------------------------------------------------------------

test("fully passing environment yields RELEASE_AUTHORIZED and exit 0", () => {
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps: greenDeps(), posture: "devid" });
  assert.equal(report.posture, "devid");
  assert.equal(report.schema, REPORT_SCHEMA);
  assert.equal(report.fix, FIX_ID);
  assert.equal(report.marker, REPORT_MARKER);
  assert.equal(report.verdict, "RELEASE_AUTHORIZED");
  assert.equal(exitCode, 0);
  assert.equal(report.artifact.path, "/fixture/Candice-Companion.dmg");
  for (const id of [
    "host-macos", "tools", "artifact", "identity", "dmg-signature", "dmg-signature-kind",
    "dmg-gatekeeper", "dmg-notarization", "embedded-app", "app-signature", "app-signature-kind",
    "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements",
  ]) {
    assert.equal(findCheck(report, id).status, "PASS", `${id} should PASS`);
  }
  // Anti-fabrication: every PASS carries real captured evidence.
  for (const check of report.checks) {
    if (check.status === "PASS") {
      assert.ok(check.evidence.length > 0, `${check.id} PASS must carry evidence`);
      for (const item of check.evidence) {
        assert.equal(typeof item.exitCode, "number", `${check.id} evidence exitCode must be a number`);
      }
    }
  }
  assert.equal(report.blockers.length, 0);
});

test("zero-identity keychain is BLOCKED with the Developer ID credential action", () => {
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps: blockingDeps(), posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const blocker = report.blockers.find((entry) => entry.checkId === "identity");
  assert.ok(blocker, "identity blocker must exist");
  assert.match(blocker.missingCredential, /Developer ID Application certificate/);
  assert.match(blocker.operatorAction.what, /developer\.apple\.com/);
  assert.ok(blocker.operatorAction.commands.some((cmd) => cmd.startsWith("security import ")));
  assert.ok(blocker.operatorAction.commands.includes("security find-identity -v -p codesigning"));
});

test("unsigned DMG is BLOCKED with signing, Gatekeeper, and notarization actions", () => {
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps: blockingDeps(), posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  for (const id of ["dmg-signature", "dmg-gatekeeper", "dmg-notarization", "app-signature", "app-gatekeeper", "app-notarization"]) {
    assert.equal(findCheck(report, id).status, "FAIL", `${id} should FAIL on an unsigned artifact`);
  }
  const signBlocker = report.blockers.find((entry) => entry.checkId === "dmg-signature");
  assert.ok(signBlocker.operatorAction.commands.some((cmd) => cmd.startsWith("codesign --force --timestamp --options runtime --entitlements")));
  const gatekeeperBlocker = report.blockers.find((entry) => entry.checkId === "dmg-gatekeeper");
  assert.match(gatekeeperBlocker.operatorAction.what, /Gatekeeper must never be disabled/);
  const notarizeBlocker = report.blockers.find((entry) => entry.checkId === "dmg-notarization");
  assert.ok(notarizeBlocker.operatorAction.commands.some((cmd) => cmd.includes("notarytool store-credentials")));
  assert.ok(notarizeBlocker.operatorAction.commands.some((cmd) => cmd.includes("stapler staple")));
});

test("prod build with no identity is BLOCKED and names the build-macos-bundle.sh command", () => {
  const { report, exitCode } = evaluateReadiness({ build: true, deps: blockingDeps() });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const buildCheck = findCheck(report, "build");
  assert.equal(buildCheck.status, "BLOCKED");
  assert.match(buildCheck.detail, /no Developer ID identity/);
  const blocker = report.blockers.find((entry) => entry.checkId === "build");
  assert.match(blocker.missingCredential, /Developer ID Application certificate/);
  assert.ok(blocker.operatorAction.commands.includes("bash apps/candice-companion/scripts/package-macos/build-macos-bundle.sh prod dmg"));
  assert.ok(blocker.operatorAction.commands.includes("node scripts/candice-release/codesign-readiness.mjs --build"));
});

test("ad-hoc signature is FAIL with the exact re-sign commands, never a pass", () => {
  const deps = greenDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "codesign" && argString.includes("-dv --verbose=4")) {
        return res(0, "", `Identifier=com.blackceo.candice\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory flags=0x10002(runtime)\nSignature=adhoc\nTeamIdentifier=not set\n`);
      }
      return greenDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  // codesign --verify passes on ad-hoc; the kind check must still FAIL.
  assert.equal(findCheck(report, "dmg-signature").status, "PASS");
  assert.equal(findCheck(report, "dmg-signature-kind").status, "FAIL");
  assert.match(findCheck(report, "dmg-signature-kind").detail, /ad-hoc signature/);
  const blocker = report.blockers.find((entry) => entry.checkId === "dmg-signature-kind");
  assert.ok(blocker.operatorAction.commands.some((cmd) => cmd.startsWith("codesign --force --timestamp --options runtime")));
});

test("hardened runtime missing is FAIL with the runtime re-sign command", () => {
  const deps = greenDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "codesign" && argString.includes("-dvvv")) {
        return res(0, "CodeDirectory flags=0x2(adhoc)", "");
      }
      return greenDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "hardened-runtime");
  assert.equal(check.status, "FAIL");
  assert.ok(check.operatorAction.commands.some((cmd) => cmd.includes("--options runtime")));
});

test("entitlement baseline violations are FAIL naming the exact keys and the entitlements file", () => {
  const weakPlist = PLIST.replace(
    "<key>com.apple.security.cs.allow-jit</key>\n\t<false/>",
    "<key>com.apple.security.cs.allow-jit</key>\n\t<true/>",
  );
  const deps = greenDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "codesign" && argString.includes("--entitlements")) return res(0, weakPlist, "");
      return greenDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "entitlements");
  assert.equal(check.status, "FAIL");
  assert.match(check.detail, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(check.missingCredential, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(check.operatorAction.what, /apps\/candice-companion\/scripts\/package-macos\/entitlements\.plist/);
  assert.ok(check.operatorAction.commands.some((cmd) => cmd.includes("--entitlements apps/candice-companion/scripts/package-macos/entitlements.plist")));
});

test("missing entitlement baseline keys are FAIL naming the absent keys", () => {
  const missingKeyPlist = PLIST.replace(
    "<key>com.apple.security.cs.allow-jit</key>\n\t<false/>",
    "",
  );
  const deps = greenDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "codesign" && argString.includes("--entitlements")) return res(0, missingKeyPlist, "");
      return greenDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "entitlements");
  assert.equal(check.status, "FAIL");
  assert.match(check.detail, /com\.apple\.security\.cs\.allow-jit/);
});

test("DMG that fails to mount is BLOCKED and skips embedded-app checks, with mount evidence captured", () => {
  const mountErr = "hdiutil: attach failed - Resource busy";
  const deps = greenDeps({
    mount: () => {
      throw new Error(mountErr);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const mountCheck = findCheck(report, "embedded-app");
  assert.equal(mountCheck.status, "BLOCKED");
  assert.match(mountCheck.detail, /Resource busy/);
  assert.ok(mountCheck.evidence.some((item) => item.stderr.includes("Resource busy")));
  for (const id of ["app-signature", "app-signature-kind", "app-gatekeeper", "app-notarization", "hardened-runtime", "entitlements"]) {
    assert.equal(findCheck(report, id).status, "SKIP", `${id} should SKIP when the DMG cannot mount`);
  }
});

test("DMG with zero .app bundles is BLOCKED naming the WS-23 rebuild command", () => {
  const deps = greenDeps({
    findApp: () => ({ appPath: null, appCount: 0 }),
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "embedded-app");
  assert.equal(check.status, "BLOCKED");
  assert.match(check.detail, /expected exactly one/);
  assert.ok(check.operatorAction.commands.includes("bash apps/candice-companion/scripts/package-macos/build-macos-bundle.sh prod dmg"));
});

test("non-macOS host is BLOCKED immediately with host evidence and skipped artifact checks", () => {
  const deps = greenDeps({ uname: () => "Linux" });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  assert.equal(findCheck(report, "host-macos").status, "BLOCKED");
  assert.equal(findCheck(report, "host-macos").evidence.length, 1);
  for (const id of ["tools", "artifact", "identity", "dmg-signature", "embedded-app", "entitlements"]) {
    assert.equal(findCheck(report, id).status, "SKIP", `${id} should SKIP on a non-macOS host`);
  }
});

test("missing tools are BLOCKED naming xcode-select --install", () => {
  const deps = greenDeps({ hasTool: (tool) => tool !== "xcrun" });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "tools");
  assert.equal(check.status, "BLOCKED");
  assert.match(check.detail, /xcrun/);
  assert.ok(check.operatorAction.commands.includes("xcode-select --install"));
});

test("no artifact and no dist DMG triggers the WS-23 build and still fails closed when the build fails", () => {
  const deps = greenDeps({
    buildDmg: () => ({
      ...res(1, "", "build-macos-bundle: required tool missing: codesign"),
      dmgPath: null,
    }),
  });
  // Force the "no --dmg given" branch: dmgPath null. The default dist path
  // never exists in this process's repo layout, so the build path runs.
  const { report, exitCode } = evaluateReadiness({ dmgPath: null, deps });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "build");
  assert.equal(check.status, "BLOCKED");
  assert.match(check.detail, /required tool missing: codesign/);
  assert.ok(check.operatorAction.commands.includes("xcode-select --install"));
});

test("build that exits 0 without producing a DMG is BLOCKED, never a fabricated pass", () => {
  const deps = greenDeps({
    buildDmg: () => ({ ...res(0, "DONE", ""), dmgPath: null }),
  });
  const { report, exitCode } = evaluateReadiness({ build: true, deps });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "build");
  assert.equal(check.status, "BLOCKED");
  assert.match(check.detail, /no DMG/);
});

test("evidence guard forces BLOCKED when a PASS lacks evidence (fail-closed self-check)", () => {
  // The guard is a finalize() invariant: every PASS must carry captured
  // evidence. A double that returns bare exit codes can only produce
  // evidence if the structural path attaches it — so attack the invariant
  // directly with a hand-built check list, the one way the public
  // evaluateReadiness API cannot reach.
  const verdictPass = [
    { id: "fabricated-pass", label: "fabricated", status: "PASS", detail: "no evidence", evidence: [] },
    { id: "real-check", label: "real", status: "PASS", detail: "ok", evidence: [{ cmd: "spctl -a -t exec -vv x", exitCode: 0, stdout: "accepted", stderr: "" }] },
  ];
  const { report, exitCode } = finalize({ artifactPath: "/fixture/Candice-Companion.dmg", built: false, checks: verdictPass });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const guard = report.checks.find((check) => check.id === "internal-evidence-guard");
  assert.ok(guard, "evidence guard check must be present");
  assert.equal(guard.status, "BLOCKED");
  assert.match(guard.detail, /fabricated-pass reported PASS without evidence/);
});

test("DMG Gatekeeper rejection is FAIL carrying the spctl output in evidence", () => {
  const deps = greenDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "spctl") {
        return res(3, "", `${argString}: rejected\nsource=no usable signature`);
      }
      return greenDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps, posture: "devid" });
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  const check = findCheck(report, "dmg-gatekeeper");
  assert.equal(check.status, "FAIL");
  assert.match(check.detail, /rejected by Gatekeeper/);
  assert.ok(check.evidence.some((item) => item.stderr.includes("rejected")));
  assert.match(check.operatorAction.what, /Gatekeeper must never be disabled/);
});

// --- QFIX-adhoc posture coverage ---------------------------------------------

/** Ad-hoc fixture double: valid ad-hoc .app signature, unsigned DMG level,
 * no Developer ID identity, spctl would reject, stapler absent. The
 * mounted Info.plist carries both usage descriptions (inherited from
 * greenDeps via readInfoPlist). */
function adhocDeps(overrides = {}) {
  const base = greenDeps();
  const baseRun = base.run;
  return Object.assign(base, {
    hasTool: (tool) => ["codesign", "security", "hdiutil"].includes(tool),
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "security") return res(0, "0 valid identities found", "");
      if (cmd === "codesign" && argString.includes("-dv --verbose=4")) {
        return res(0, "", `Identifier=com.blackceo.candice\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory flags=0x10002(runtime)\nSignature=adhoc\nTeamIdentifier=not set\n`);
      }
      // Everything else (codesign --verify, -dvvv, --entitlements) delegates
      // to the green double: the artifact verifies cleanly as ad-hoc.
      return baseRun(cmd, args);
    },
    readInfoPlist: () => ADHOC_INFO_PLIST,
  }, overrides);
}

test("adhoc is the default release posture and is declared with devid", () => {
  assert.equal(DEFAULT_POSTURE, "adhoc");
  assert.deepEqual([...POSTURES], ["adhoc", "devid"]);
});

test("adhoc posture accepts a valid ad-hoc-signed artifact and authorizes release", () => {
  const deps = adhocDeps();
  // Fixture sanity: both usage descriptions present in the injected plist.
  assert.deepEqual(
    infoPlistUsageDescriptions(ADHOC_INFO_PLIST, [
      "NSMicrophoneUsageDescription",
      "NSSpeechRecognitionUsageDescription",
    ]),
    [],
    "fixture plist must carry both descriptions",
  );

  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps });
  assert.equal(report.posture, "adhoc");
  assert.equal(findCheck(report, "app-signature").status, "PASS");
  assert.equal(findCheck(report, "usage-descriptions").status, "PASS");
  assert.equal(findCheck(report, "entitlements").status, "PASS");
  assert.equal(report.verdict, "RELEASE_AUTHORIZED");
  assert.equal(exitCode, 0);
});

test("adhoc posture SKIPS Developer ID / notary / Gatekeeper checks with the named operator-decision reason", () => {
  const deps = adhocDeps();
  const { report } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps });
  assert.equal(report.posture, "adhoc");
  for (const id of ["identity", "dmg-signature-kind", "dmg-gatekeeper", "dmg-notarization", "app-signature-kind", "app-gatekeeper", "app-notarization"]) {
    const check = findCheck(report, id);
    assert.equal(check.status, "SKIP", `${id} must SKIP under adhoc posture`);
    assert.match(check.detail, /SKIPPED:/);
    assert.ok(check.detail.includes(ADHOC_SKIP_REASON), `${id} SKIP detail must carry the named reason`);
  }
  // Skips are honest non-evaluations: they carry NO evidence and never PASS.
  for (const id of ["identity", "dmg-gatekeeper", "app-gatekeeper"]) {
    assert.equal(findCheck(report, id).evidence.length, 0);
    assert.notEqual(findCheck(report, id).status, "PASS");
  }
});

test("broken signature still fails closed under adhoc posture", () => {
  const deps = adhocDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "xcrun") return res(0, "/usr/bin/stapler", "");
      if (cmd === "codesign" && argString.includes("--verify")) return res(1, "", "code object is not signed at all");
      if (cmd === "codesign" && argString.includes("-dvvv")) return res(1, "", "code object is not signed at all");
      if (cmd === "codesign" && argString.includes("--entitlements")) return res(1, "", "code object is not signed at all");
      throw new Error(`broken-adhoc unscripted ${cmd} ${argString}`);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps });
  assert.equal(report.posture, "adhoc");
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  assert.equal(findCheck(report, "app-signature").status, "FAIL");
});

test("tampered signature fails under adhoc even when verify-style probes are forged green elsewhere", () => {
  // Tamper simulation: codesign --verify reports the code was modified.
  const deps = adhocDeps({
    run: (cmd, args) => {
      const argString = args.join(" ");
      if (cmd === "codesign" && argString.includes("--verify")) return res(2, "", "invalid signature (code or signature have been modified)");
      return adhocDeps().run(cmd, args);
    },
  });
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps });
  assert.equal(report.posture, "adhoc");
  assert.equal(report.verdict, "BLOCKED");
  assert.equal(exitCode, 2);
  assert.equal(findCheck(report, "app-signature").status, "FAIL");
  assert.match(findCheck(report, "app-signature").detail, /modified|codesign --verify failed/);
});

test("missing mic/speech usage descriptions still fail under adhoc posture", () => {
  // Direct unit of the gate helper: empty strings and absent keys both miss.
  const barePlist = `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Candice</string></dict></plist>`;
  const emptyPlist = ADHOC_INFO_PLIST
    .replace("<string>Candice uses the microphone only when you hold the push-to-talk key.</string>", "<string></string>")
    .replace(/<key>NSSpeechRecognitionUsageDescription<\/key>\s*<string>[^<]*<\/string>/, "");
  assert.deepEqual(
    infoPlistUsageDescriptions(barePlist, ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]),
    ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"],
  );
  assert.deepEqual(infoPlistUsageDescriptions(emptyPlist, ["NSMicrophoneUsageDescription"]), ["NSMicrophoneUsageDescription"]);
  assert.deepEqual(infoPlistUsageDescriptions(emptyPlist, ["NSSpeechRecognitionUsageDescription"]), ["NSSpeechRecognitionUsageDescription"]);
});

test("unknown posture is refused, never silently treated as a pass", () => {
  assert.throws(() => evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps: adhocDeps(), posture: "yolo" }), /unknown posture/);
});

test("devid posture remains available and keeps the original FIX-010 semantics", () => {
  const { report, exitCode } = evaluateReadiness({ dmgPath: "/fixture/Candice-Companion.dmg", deps: greenDeps(), posture: "devid" });
  assert.equal(report.posture, "devid");
  assert.equal(report.verdict, "RELEASE_AUTHORIZED");
  assert.equal(exitCode, 0);
  assert.equal(findCheck(report, "identity").status, "PASS");
  assert.equal(findCheck(report, "app-gatekeeper").status, "PASS");
});
