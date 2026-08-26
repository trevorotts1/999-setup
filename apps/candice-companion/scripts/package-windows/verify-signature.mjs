#!/usr/bin/env node
// WS-29 Windows packaging/signing/SmartScreen path — deterministic signature
// policy engine (cross-platform Node core; native probe lives in
// verify-signature.ps1 which pipes its JSON here).
//
// Design contract (Master Spec 0.3, 23):
//  - reusable deterministic logic in Node .mjs; thin native .ps1 wrapper.
//  - identical input/output schemas and exit-code semantics across platforms.
//  - an unsigned build is NEVER reported as trusted. The only way an unsigned
//    artifact passes (exit 0) is an explicit operator-recorded limitation
//    marker (scripts/package-windows/SIGNING-STATUS.md) or --allow-unsigned-with-record.
//  - no secrets, no network, no cloud endpoints. Pure policy over JSON input.
//
// Exit codes:
//   0  signed and valid  OR  unsigned with a recorded limitation
//   1  unsigned WITHOUT a recorded limitation (enforcement failure)
//   2  usage / input error
//
// Usage:
//   node verify-signature.mjs check --input-json '<json>' [--limitation-marker <path>] [--allow-unsigned-with-record]
//   node verify-signature.mjs check --file <path> [--limitation-marker <path>]   # reads a report JSON file
//   node verify-signature.mjs self-test                                          # fixture self-test, no I/O
//   node verify-signature.mjs help

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Authenticode statuses as reported by PowerShell Get-AuthenticodeSignature
// (.Status.ToString()) plus the strings signtool /verify emits.
// PowerShell 5.1 System.Management.Automation.SignatureStatus enum values:
//   Valid, UnknownError, NotSupportedFileFormat, Incompatible,
//   NotTrusted, HashMismatch, NotSigned
// (older docs also list NotSupportedFileFormat under the pre-5.1 name
// "NotSupportedFileFormat"; "Tampered" and "NotSupported" are kept as
// defensive aliases for non-PowerShell probes.)
const VALID_STATUSES = new Set(['Valid', 'ValidSignature']);
// "NotSigned" is the honest unsigned state (limitation path applies).
// The rest are signatures that are PRESENT but broken or unverifiable —
// never excusable.
const INVALID_STATUSES = new Set([
  'HashMismatch',
  'NotTrusted',
  'UnknownError',
  'NotSupportedFileFormat',
  'Incompatible',
  'NotSupported',
  'Tampered',
]);
const UNSIGNED_STATUSES = new Set(['NotSigned']);

export function classify(status) {
  if (typeof status !== 'string' || status.length === 0) {
    return { trusted: false, known: false, label: 'UNKNOWN' };
  }
  if (VALID_STATUSES.has(status)) {
    return { trusted: true, known: true, label: 'SIGNED_VALID' };
  }
  if (UNSIGNED_STATUSES.has(status)) {
    return { trusted: false, known: true, label: 'UNSIGNED' };
  }
  if (INVALID_STATUSES.has(status)) {
    return { trusted: false, known: true, label: 'SIGNED_INVALID' };
  }
  return { trusted: false, known: false, label: 'UNKNOWN' };
}

// Deterministic verdict over a probe report.
// report fields:
//   file            string  absolute path of the probed artifact
//   status          string  Authenticode status string
//   signer          string? signer subject when present
//   statusMessage   string? native tool message
// options:
//   limitationMarker      path of an operator-recorded limitation doc
//   allowUnsignedWithRecord  bool — explicitly permit unsigned pass when a
//                            limitation record exists (CI opt-in)
export function verdict(report, options = {}) {
  const cls = classify(report && report.status);
  const limitationRecorded =
    Boolean(options.allowUnsignedWithRecord) ||
    (typeof options.limitationMarker === 'string' &&
      options.limitationMarker.length > 0 &&
      existsSync(options.limitationMarker));

  if (cls.trusted) {
    return {
      exitCode: 0,
      pass: true,
      trusted: true,
      signed: true,
      limitationRecorded: false,
      reason: 'SIGNED_VALID',
      file: report && report.file ? report.file : null,
      signer: report && report.signer ? report.signer : null,
      statusMessage: report && report.statusMessage ? report.statusMessage : null,
    };
  }

  // Every non-valid path is untrusted. Honesty invariant: `trusted` is only
  // ever true for a VALID Authenticode signature.
  if (cls.label === 'SIGNED_INVALID') {
    // Presence of a limitation record NEVER excuses a broken signature:
    // tampering/hash-mismatch is a distribution-stopping defect, not a
    // credential gap.
    return {
      exitCode: 1,
      pass: false,
      trusted: false,
      signed: true,
      limitationRecorded: false,
      reason:
        'SIGNED_INVALID — signature present but invalid (tampered, hash mismatch, or untrusted chain); never distribute, never present as trusted',
      file: report && report.file ? report.file : null,
      signer: null,
      statusMessage: report && report.statusMessage ? report.statusMessage : null,
    };
  }

  // An unrecognized status string is NOT "unsigned" — it means the probe
  // could not be interpreted, so the artifact is unverifiable. The
  // recorded-limitation path exists only for a KNOWN-unsigned artifact
  // (status "NotSigned"); an unverifiable artifact must fail closed
  // regardless of the marker, or a broken probe would pass the release
  // gate. (Real PS 5.1 statuses like NotSupportedFileFormat/Incompatible
  // are already classified SIGNED_INVALID above.)
  if (cls.label === 'UNKNOWN') {
    return {
      exitCode: 1,
      pass: false,
      trusted: false,
      signed: null,
      limitationRecorded: false,
      reason:
        'UNVERIFIABLE — unrecognized probe status; artifact cannot be verified as signed or as a known-unsigned limitation build; release gate refuses this artifact',
      file: report && report.file ? report.file : null,
      signer: null,
      statusMessage: report && report.statusMessage ? report.statusMessage : null,
    };
  }

  // Unsigned (or unknown status).
  if (limitationRecorded) {
    return {
      exitCode: 0,
      pass: true,
      trusted: false,
      signed: false,
      limitationRecorded: true,
      reason:
        'UNSIGNED_WITH_RECORDED_LIMITATION — not Authenticode-signed; operator-recorded limitation present; installer must not be presented as trusted; SmartScreen "Windows protected your PC" is expected until a signed release exists',
      file: report && report.file ? report.file : null,
      signer: null,
      statusMessage: report && report.statusMessage ? report.statusMessage : null,
    };
  }

  return {
    exitCode: 1,
    pass: false,
    trusted: false,
    signed: false,
    limitationRecorded: false,
    reason:
      'UNSIGNED_NO_LIMITATION_RECORD — not Authenticode-signed and no recorded limitation; release gate refuses this artifact',
    file: report && report.file ? report.file : null,
    signer: null,
    statusMessage: report && report.statusMessage ? report.statusMessage : null,
  };
}

const HELP = `verify-signature.mjs — deterministic Windows Authenticode policy engine (WS-29)

Commands:
  check --input-json '<json>' [--limitation-marker <path>] [--allow-unsigned-with-record]
  check --file <report.json>  [--limitation-marker <path>] [--allow-unsigned-with-record]
  self-test
  help

Probe report JSON fields: { "file": "...", "status": "Valid", "signer": "...", "statusMessage": "..." }

Exit codes: 0 = signed+valid, or unsigned with a recorded limitation;
1 = unsigned without a recorded limitation, or invalid signature;
2 = usage/input error.

SmartScreen honesty: an unsigned installer is NOT trusted. Windows will show
"Windows protected your PC" with an Unknown publisher. Do not instruct
customers to bypass that warning as the normal install path (Master Spec 23).
`;

function parseArgs(argv) {
  const out = { command: null, inputJson: null, file: null, limitationMarker: null, allowUnsignedWithRecord: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === 'check' || a === 'self-test' || a === 'help') {
      out.command = a;
    } else if (a === '--input-json') {
      out.inputJson = argv[i + 1];
      i += 1;
    } else if (a === '--file') {
      out.file = argv[i + 1];
      i += 1;
    } else if (a === '--limitation-marker') {
      out.limitationMarker = argv[i + 1];
      i += 1;
    } else if (a === '--allow-unsigned-with-record') {
      out.allowUnsignedWithRecord = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`verify-signature.mjs: ${err.message}\n${HELP}`);
    process.exit(2);
  }

  if (args.command === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (args.command === 'self-test') {
    const cases = [
      [{ status: 'Valid', file: 'x.exe' }, {}, 0, true],
      [{ status: 'NotSigned', file: 'x.exe' }, {}, 1, false],
      [{ status: 'NotSigned', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 0, false],
      [{ status: 'HashMismatch', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 1, false],
      [{ status: 'NotTrusted', file: 'x.exe' }, {}, 1, false],
      [{ status: 'UnknownError', file: 'x.exe' }, {}, 1, false],
      // Real PowerShell 5.1 SignatureStatus enum values must refuse even
      // with a recorded limitation present.
      [{ status: 'NotSupportedFileFormat', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 1, false],
      [{ status: 'Incompatible', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 1, false],
      // Unrecognized statuses are unverifiable, not unsigned: fail closed
      // even when a limitation record exists (a broken probe must never
      // pass the release gate).
      [{ status: 'BogusStatus', file: 'x.exe' }, {}, 1, false],
      [{ status: 'BogusStatus', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 1, false],
      [{ status: '', file: 'x.exe' }, { allowUnsignedWithRecord: true }, 1, false],
      [{ status: 'NotSigned', file: 'x.exe' }, { limitationMarker: '/nonexistent-marker-xyz' }, 1, false],
    ];
    let failures = 0;
    for (const [report, opts, wantExit, wantTrusted] of cases) {
      const v = verdict(report, opts);
      const ok = v.exitCode === wantExit && v.trusted === wantTrusted;
      if (!ok) {
        failures += 1;
        process.stderr.write(
          `self-test FAIL: status=${report.status} opts=${JSON.stringify(opts)} -> exit=${v.exitCode} trusted=${v.trusted} (want ${wantExit}/${wantTrusted})\n`,
        );
      }
    }
    if (failures > 0) {
      process.stderr.write(`self-test: ${failures} failure(s)\n`);
      process.exit(1);
    }
    process.stdout.write('verify-signature.mjs self-test: all fixtures pass\n');
    process.exit(0);
  }

  if (args.command !== 'check') {
    process.stderr.write(`verify-signature.mjs: missing command\n${HELP}`);
    process.exit(2);
  }

  let report;
  try {
    if (args.inputJson != null) {
      report = JSON.parse(args.inputJson);
    } else if (args.file != null) {
      report = JSON.parse(readFileSync(args.file, 'utf8'));
    } else {
      throw new Error('check requires --input-json or --file');
    }
  } catch (err) {
    process.stderr.write(`verify-signature.mjs: cannot read probe report: ${err.message}\n`);
    process.exit(2);
  }

  if (report == null || typeof report !== 'object' || typeof report.status !== 'string') {
    process.stderr.write('verify-signature.mjs: probe report must be an object with a string "status" field\n');
    process.exit(2);
  }

  const v = verdict(report, {
    limitationMarker: args.limitationMarker,
    allowUnsignedWithRecord: args.allowUnsignedWithRecord,
  });
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  process.exit(v.exitCode);
}

// Self-contained default marker path when invoked from this directory.
export const DEFAULT_LIMITATION_MARKER = join(
  dirname(fileURLToPath(import.meta.url)),
  'SIGNING-STATUS.md',
);

main();
