#!/usr/bin/env node
// WS-29 Windows packaging/signing/SmartScreen path — NSIS release-artifact
// policy audit (cross-platform Node; runs anywhere a release is prepared,
// including macOS CI lanes that cross-compile Windows artifacts).
//
// The production NSIS installer mechanism (scripts/package-windows/installerHooks.nsh)
// is a HOOKS file, not a full installer template. A custom nsis.template
// REPLACES the entire Tauri-generated installer script — including the
// payload-copy, WebView2, shortcut, and uninstall logic — so this lane uses
// the supported extension point instead: bundle.windows.nsis.installerHooks,
// which Tauri INCLUDEs into its own generated script (see
// scripts/package-windows/TAURI-SIGNING-FRAGMENT.md for the fragment the 9.4
// integration owner applies at fan-in).
//
// Posture contract (QC round 3 — verified against tauri-bundler 2.11.5
// crates/tauri-bundler/src/bundle/windows/nsis/mod.rs + installer.nsi):
//   - tauri-bundler invokes makensis with NO /D flags and NsisConfig has no
//     defines field, so NO build pipeline can define a flag that a hooks
//     file could branch on. Any !ifdef-based "signed posture" branch is
//     unreachable code.
//   - The honest mechanism is a RUNTIME PROBE: NSIS_HOOK_POSTINSTALL calls
//     WinVerifyTrust via the System plugin (bundled with every makensis)
//     against $INSTDIR\${MAINBINARYNAME}.exe — the app exe Tauri's signing
//     pass signs after makensis runs — and stamps release-posture.txt with
//     the PROBED state. The AUTHENTICODE-SIGNED literal must appear ONLY
//     inside the StrCmp-$0=0 (probe-validated) branch; every other outcome
//     writes NOT-SIGNED. A broken probe fails closed, never to SIGNED.
//
// This audit enforces the honesty contract (Master Spec 23, E.1 WS-29):
//   - the hooks file must carry both posture literals and a runtime
//     signature probe that stamps them;
//   - the SIGNED literal must be reachable ONLY via the probe-validated
//     branch (and must never be written unconditionally);
//   - the hooks file must define the hook macros Tauri's generated script
//     invokes, and must not re-declare core-script responsibilities;
//   - exit 0 = releaseable under current policy; 1 = policy violation.
//
// Also validates the tauri.conf.json bundle.windows signing fragment when a
// file path is supplied (installerHooks path, certificateThumbprint presence
// and shape; the fragment itself is applied by the integration owner at
// fan-in — this lane only audits, never writes tauri.conf.json).

import { readFileSync, existsSync } from 'node:fs';

const NOT_SIGNED_LITERAL = 'CANDICE-INSTALLER-NOT-SIGNED';
const SIGNED_LITERAL = 'CANDICE-INSTALLER-AUTHENTICODE-SIGNED';
const PENDING_DEFINE = '!define CANDICE_INSTALLER_SIGNING_PENDING';
const PENDING_PATTERN = /CANDICE_INSTALLER_SIGNING_PENDING/i;
const THUMBPRINT_PATTERN = /^[0-9A-Fa-f]{40}$/;

// Hook macros the Tauri default installer script invokes (verified against
// crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi on tauri-apps/tauri:
// NSIS_HOOK_PREINSTALL / NSIS_HOOK_POSTINSTALL in Section Install,
// NSIS_HOOK_PREUNINSTALL / NSIS_HOOK_POSTUNINSTALL in Section Uninstall).
const REQUIRED_HOOK_MACROS = [
  'NSIS_HOOK_PREINSTALL',
  'NSIS_HOOK_POSTINSTALL',
  'NSIS_HOOK_PREUNINSTALL',
  'NSIS_HOOK_POSTUNINSTALL',
];

// Core-script responsibilities the default script owns. A hooks file must
// not re-declare these; doing so would double-copy payloads or redefine
// values mid-script.
const FORBIDDEN_CORE_TOKENS = [
  /^[ \t]*Section[ \t]+["']?Install/i,
  /^[ \t]*Section[ \t]+["']?Uninstall/i,
  /^[ \t]*OutFile[ \t]/i,
  /^[ \t]*InstallDir[ \t]/i,
  /^[ \t]*RequestExecutionLevel[ \t]/i,
  /^[ \t]*!include[ \t]+["']?MUI2\.nsh/i,
];

function auditHooks(scriptText) {
  if (typeof scriptText !== 'string') {
    throw new Error('auditHooks: scriptText must be a string');
  }
  const findings = [];
  let exitCode = 0;

  // --- Posture literals --------------------------------------------------
  const hasNotSignedLiteral = scriptText.includes(NOT_SIGNED_LITERAL);
  const hasSignedLiteral = scriptText.includes(SIGNED_LITERAL);
  if (!hasNotSignedLiteral || !hasSignedLiteral) {
    exitCode = 1;
    findings.push(
      `hooks file must carry BOTH posture literals (${NOT_SIGNED_LITERAL} and ${SIGNED_LITERAL}); an honest installer stamps one or the other; reject`,
    );
  }

  // --- Runtime signature probe (the only honest posture source) ----------
  // The probe must call WinVerifyTrust via System::Call and stamp the file.
  const hasWinVerifyTrust = /WinVerifyTrust/i.test(scriptText);
  const hasSystemCall = /System::Call/i.test(scriptText);
  if (!hasSystemCall || !hasWinVerifyTrust) {
    exitCode = 1;
    findings.push(
      'hooks file has no runtime signature probe (System::Call to WinVerifyTrust); without it the AUTHENTICODE-SIGNED posture could never be produced honestly; reject',
    );
  }

  // The SIGNED literal must appear only inside a probe-validated branch.
  // Signature: StrCmp $0 0 <jump> ... FileWrite ... SIGNED ... Goto done
  // (labels are opaque — order matters, not the label text).
  // Rule: every FileWrite of the SIGNED literal must be preceded (since the
  // StrCmp) by a StrCmp on the probe result register $0 for equality with 0,
  // and no OTHER StrCmp may intervene.
  if (hasSignedLiteral) {
    const signedWriteRe = new RegExp(
      `FileWrite[ \\t]+\\$0[ \\t]+"${SIGNED_LITERAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      'g',
    );
    for (const m of scriptText.matchAll(signedWriteRe)) {
      const before = scriptText.slice(0, m.index);
      const probeStrcmp = [...before.matchAll(/StrCmp[ \t]+\$0[ \t]+0[ \t]/g)].at(-1);
      const afterProbe = probeStrcmp ? before.slice(probeStrcmp.index) : null;
      const otherStrcmpBetween =
        afterProbe !== null && /StrCmp[ \t]+(?!\$0[ \t]+0[ \t])/.test(afterProbe);
      if (!probeStrcmp || otherStrcmpBetween) {
        exitCode = 1;
        findings.push(
          `SIGNED literal is written outside a probe-validated branch (no preceding "StrCmp $0 0" since the last probe, or another StrCmp intervenes) — the SIGNED posture must be reachable ONLY when WinVerifyTrust returned 0; reject`,
        );
      }
    }
  }

  // The probe result register must be consumed by a StrCmp-0 branch (i.e.
  // the probe is not decorative) and NOT-SIGNED must be the fall-through /
  // non-validated outcome.
  if (hasWinVerifyTrust) {
    // Count the REAL probe calls only (System::Call to wintrust::WinVerifyTrust),
    // not comment mentions.
    const probeCallRe = /System::Call[ \t]+'wintrust::WinVerifyTrust/g;
    let probeCount = 0;
    for (const _ of scriptText.matchAll(probeCallRe)) probeCount += 1;
    if (probeCount !== 1) {
      exitCode = 1;
      findings.push(
        `expected exactly one WinVerifyTrust probe call (System::Call 'wintrust::WinVerifyTrust...) in the hooks file; found ${probeCount}; a second probe re-arms $0 and can mis-stamp; reject`,
      );
    }
    const probeIdx = scriptText.search(probeCallRe);
    const afterProbe = probeIdx >= 0 ? scriptText.slice(probeIdx) : '';
    const hasStrcmpZero = /StrCmp[ \t]+\$0[ \t]+0[ \t]/.test(afterProbe);
    const hasNotSignedWrite = afterProbe.includes(
      `FileWrite $0 "${NOT_SIGNED_LITERAL}"`,
    );
    if (!hasStrcmpZero) {
      exitCode = 1;
      findings.push(
        'probe result register $0 is never compared to 0 — the probe cannot route to the SIGNED branch; reject',
      );
    }
    if (!hasNotSignedWrite) {
      exitCode = 1;
      findings.push(
        `non-validated path never writes ${NOT_SIGNED_LITERAL} — the probe must fail closed to NOT-SIGNED; reject`,
      );
    }
  }

  // --- Pending placeholder ----------------------------------------------
  const hasPending = PENDING_PATTERN.test(scriptText);
  if (hasPending) {
    findings.push(
      'hooks file still contains the SIGNING-PENDING placeholder; placeholder must be resolved before a signed release',
    );
  }

  // --- Hook macro completeness ------------------------------------------
  // The hooks file must define each macro NSIS will invoke. Per-macro closing
  // check: a !macroend must follow each macro OPEN before the next macro OPEN
  // (NSIS macros may not nest), so the check is open-index -> next-open-index
  // -> !macroend between them, per macro, not one global regex.
  // NOTE: every macro-name regex here needs the `m` flag — a bare `$`
  // alternative only matches end-of-string, and macro lines end with \n.
  const macroOpenRe = new RegExp(
    `!macro[ \\t]+(?:${REQUIRED_HOOK_MACROS.join('|')})(?:[ \\t]|$)`,
    'm',
  );
  const macroOpens = [...scriptText.matchAll(new RegExp(macroOpenRe.source, 'gm'))].map(
    (m) => ({ index: m.index, text: m[0] }),
  );
  for (const macro of REQUIRED_HOOK_MACROS) {
    const openRe = new RegExp(`!macro[ \\t]+${macro}(?:[ \\t]|$)`, 'm');
    const openMatch = openRe.exec(scriptText);
    const hasOpen = openMatch !== null;
    let hasClose = false;
    if (hasOpen) {
      const laterOpens = macroOpens.filter((o) => o.index > openMatch.index);
      const end = laterOpens.length > 0 ? laterOpens[0].index : scriptText.length;
      const body = scriptText.slice(openMatch.index, end);
      hasClose = /!macroend(?:[ \t]*;.*)?(?:\r?\n|$)/.test(body);
    }
    if (!hasOpen) {
      exitCode = 1;
      findings.push(
        `hook macro ${macro} is not defined — Tauri's generated script inserts it at install/uninstall time; missing macro breaks the build; reject`,
      );
    } else if (!hasClose) {
      exitCode = 1;
      findings.push(`hook macro ${macro} has no closing !macroend; reject`);
    }
  }

  // --- Core-script responsibility guard ---------------------------------
  for (const re of FORBIDDEN_CORE_TOKENS) {
    const lines = scriptText.split(/\r?\n/);
    for (const line of lines) {
      if (re.test(line)) {
        exitCode = 1;
        findings.push(
          `hooks file declares core-script responsibility (${re.source}) — only the Tauri default script may; a hooks file that does this is a broken full-template in disguise; reject`,
        );
        break;
      }
    }
  }

  return { exitCode, findings };
}

// posture: 'probe-validated' | 'no-probe' from auditHooks. In the recorded-
// limitation interim, the absence of the signing fragment is the DESIGNED
// state and must not fail the audit; only a malformed/fake thumbprint or a
// missing installerHooks path fails. A hooks file with no runtime probe
// (which therefore can never honestly produce the SIGNED posture) fails if
// a signing fragment is ALSO absent AND the posture claim is unsigned —
// actually it cannot claim anything; the probe check in auditHooks governs.
export function auditSigningFragment(bundleWindows, posture) {
  const findings = [];
  let exitCode = 0;
  if (bundleWindows == null || typeof bundleWindows !== 'object') {
    findings.push(
      'bundle.windows fragment absent — Windows builds are NOT Authenticode-signed by Tauri; this matches the unsigned posture (recorded limitation: scripts/package-windows/SIGNING-STATUS.md)',
    );
    return { exitCode, findings };
  }

  const nsis = bundleWindows.nsis;
  if (nsis == null || typeof nsis !== 'object' || typeof nsis.installerHooks !== 'string' || nsis.installerHooks.length === 0) {
    exitCode = 1;
    findings.push(
      'bundle.windows.nsis.installerHooks path is missing — the posture markers and release-posture.txt stamp would never be compiled into the installer; reject',
    );
  } else {
    findings.push(
      `bundle.windows.nsis.installerHooks = "${nsis.installerHooks}" — Tauri will merge the posture hooks into its generated installer script`,
    );
  }

  if (bundleWindows.certificateThumbprint == null) {
    findings.push(
      'bundle.windows.certificateThumbprint absent — unsigned build; record the limitation (scripts/package-windows/SIGNING-STATUS.md) before any unsigned distribution',
    );
  } else if (typeof bundleWindows.certificateThumbprint !== 'string' || !THUMBPRINT_PATTERN.test(bundleWindows.certificateThumbprint)) {
    exitCode = 1;
    findings.push(
      'bundle.windows.certificateThumbprint must be a 40-hex-char SHA-1 thumbprint — a placeholder/fake identity is rejected',
    );
  } else {
    findings.push(
      'bundle.windows.certificateThumbprint present — Tauri will sign with signtool (digestAlgorithm/timestampUrl should accompany it)',
    );
  }
  return { exitCode, findings };
}

function main() {
  const argv = process.argv.slice(2);
  const scriptPath = argv.find((a) => !a.startsWith('--') && /\.nsh$/i.test(a));
  const confPath = argv.find((a) => !a.startsWith('--') && (a.endsWith('.json') || a.endsWith('tauri.conf.json')));

  let exitCode = 0;
  const report = { hooks: null, signingFragment: null, notices: [] };

  if (argv.includes('--help') || argv.length === 0) {
    process.stdout.write(
      `nsis-policy-audit.mjs — NSIS release-posture audit (WS-29)\n\n` +
        `Usage: node nsis-policy-audit.mjs [<installerHooks.nsh>] [<tauri.conf.json>]\n\n` +
        `Audits the NSIS installer-hooks runtime-probe posture contract and the bundle.windows signing fragment.\n` +
        `Exit 0 = releaseable under current signing policy; 1 = policy violation.\n`,
    );
    process.exit(argv.length === 0 ? 2 : 0);
  }

  if (scriptPath) {
    if (!existsSync(scriptPath)) {
      process.stderr.write(`nsis-policy-audit.mjs: hooks file not found: ${scriptPath}\n`);
      process.exit(2);
    }
    const text = readFileSync(scriptPath, 'utf8');
    report.hooks = { path: scriptPath, audit: auditHooks(text) };
    exitCode = Math.max(exitCode, report.hooks.audit.exitCode);
  }

  const posture = report.hooks ? 'probe-audited' : 'indeterminate';

  if (confPath) {
    if (!existsSync(confPath)) {
      process.stderr.write(`nsis-policy-audit.mjs: config not found: ${confPath}\n`);
      process.exit(2);
    }
    const conf = JSON.parse(readFileSync(confPath, 'utf8'));
    const windows = conf && conf.bundle ? conf.bundle.windows : null;
    report.signingFragment = { path: confPath, audit: auditSigningFragment(windows, posture) };
    exitCode = Math.max(exitCode, report.signingFragment.audit.exitCode);
  }

  if (scriptPath && PENDING_PATTERN.test(readFileSync(scriptPath, 'utf8'))) {
    report.notices.push(
      'SIGNING-PENDING placeholder present in the NSIS hooks file — release gate stays closed until credentials arrive or the limitation is recorded',
    );
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(exitCode);
}

main();
