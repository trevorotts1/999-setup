# scripts/excellence-gate — FIX-024 final clean-machine excellence gate machinery

Owned path: `scripts/excellence-gate/**` (FIX-024 machinery lane). The G06
install-engine lane owns `scripts/candice-bootstrap/**`; this lane owns only
what is in this directory.

FIX-024 runs LAST, after all other gates. FIX-024 is evidence-only: no changes
to `src/`, plugin code, control files, or release scripts. These scripts are
the machinery the FIX-024 run executes. The FIX-024 run itself happens later,
after every FIX-001..023 row is COMPLETE.

## Scripts

| Script | Purpose |
|---|---|
| `prereq-gate.mjs` | Fail-closed dependency gate: every FIX-001..023 row must be COMPLETE in the operator LIVE-LEDGER.md before any FIX-024 candidate work. |
| `candidate-freeze.mjs` | Freeze the candidate identity: commit, new coordinated tag (never the quarantined 0.2.0 tag), artifacts with URL/size/SHA-256/signature. Validates against live git state; never moves tags or rebuilds artifacts. |
| `report-gen.mjs` | Build COMPLETION-REPORT.json — commit, tag, artifacts, one row per executed gate with status and evidence pointer. Refuses rows whose cited evidence files are missing. |
| `control-reconcile.mjs` | Control-file agreement: TODO.md / CHECKLIST.md / LEDGER.md markers, release-gate.json, project_state.json, and the report must agree with zero unexplained differences. |
| `verdict-gen.mjs` | Emit the PASS verdict block: candidate hashes, gate-by-gate evidence links, eight zero-variables, `FINAL_STATE=COMPLETE_EXCELLENT`, and a signer field left BLANK for the independent human reviewer. |

Shared library: `lib.mjs`. Gate registry: `gates.json`. Tests: `__tests__/suite.test.mjs`.

Exit codes everywhere: 0 OK; 1 gate/state failure; 2 usage; 3 tooling failure.

## Gates (gates.json)

All 17 release gates from FIXES-AND-QC.md FIX-024 (unit, build, integration,
contract, same-session, failure matrix, privacy, performance, installer
regression, interview shape, packaged E2E, clean-machine Mac, clean-machine
Windows matrix, accessibility matrix, release integrity, control agreement,
independent QC). Each gate records:

- the exact command(s) — verified against the real CLI parsers (the
  EXECUTION-PLAN.md defects are corrected in the `note` fields, not silently
  dropped):
  - `bootstrap.mjs` has NO `--release` flag: `install | --health [--offline]
    [--root <dir>]`; app install is fail-closed refused until a
    release-authorized candidate exists,
  - `checksums/verify.mjs` takes `--file` plus `--sha256`, or `--id` +
    `--version` (+ `--platform`); no bare positional manifest argument,
  - `r5-shape-check.mjs` requires `--fixtures-dir tests/interview/fixtures` or
    `--selfcheck`; a bare invocation exits 2,
  - `fallback.test.js` has no explicit exit-0 path — the runner records the
    captured PASS/FAIL output and exit code verbatim,
  - `verify-gatekeeper.sh` assesses a `.app` bundle (spctl), not a DMG path,
- the evidence pointer(s) the gate result must cite,
- the spec reference (real line numbers in
  `spec/MASTER-SPEC-2026-08-21.md` section 28 — the fabricated 28A/28B/28D
  BAR citations from the prior plan are not used anywhere in this machinery),
- the phase (1 clean checkout, 2 packaged E2E, 3 clean-machine evidence,
  4 release integrity).

## Sequence

```sh
# 1. dependency gate (fails until all FIX-001..023 rows are COMPLETE)
node scripts/excellence-gate/prereq-gate.mjs --ledger "<operator>/Downloads/CANDACE FIXES/LIVE-LEDGER.md"

# 2. freeze candidate identity
node scripts/excellence-gate/candidate-freeze.mjs \
  --commit <full-sha> --tag <new-vX.Y.Z> \
  --artifact "name=...,url=https://...,sha256=...,sizeBytes=...,signature=..." \
  --write evidence/FIX-024/builder/candidate-freeze.json

# 3. run every gate, then aggregate rows (repeat --gate per gate)
node scripts/excellence-gate/report-gen.mjs \
  --freeze evidence/FIX-024/builder/candidate-freeze.json \
  --gate unit --command \
  --gate packagedE2E --result '{"status":"PASS","evidenceFile":"evidence/FIX-024/builder/e2e-acceptance.txt"}' \
  --out evidence/FIX-024/builder/COMPLETION-REPORT.json

# 4. control agreement
node scripts/excellence-gate/control-reconcile.mjs \
  --report evidence/FIX-024/builder/COMPLETION-REPORT.json \
  --ledger "<operator>/Downloads/CANDACE FIXES/LIVE-LEDGER.md"

# 5. signable verdict block (independent reviewer signs; signer stays blank)
node scripts/excellence-gate/verdict-gen.mjs \
  --report evidence/FIX-024/builder/COMPLETION-REPORT.json \
  --ledger "<operator>/Downloads/CANDACE FIXES/LIVE-LEDGER.md" \
  --out evidence/FIX-024/qc/verdict-block.txt
```

A required skip is BLOCKED, never PASS. Builder state caps at
`BUILT_AWAITING_QC`; `release_ready=true` happens only after the independent
verdict — these scripts never set either.
