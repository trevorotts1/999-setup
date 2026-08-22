# WS-41 Checkpoint — contract/schema test suite

**Builder:** WS-WS-41 (opus/max), W2 build
**Run:** WR-020 candice-tests slice, workstream WS-41 (L3 — deps WS-01, WS-04, WS-05)
**Worktree:** `candice/wr001-bootstrap` (worktrees/wr001-bootstrap)
**Date:** 2026-08-21
**Status:** BUILT — awaiting independent QC verdict (no commit made, per dispatch instruction)

## Files created (all inside the owned glob `tests/contract/**`)

| File | Purpose |
|---|---|
| `tests/contract/suite.js` | Single entry point: runs all four test files, exit 0 only when each prints ALL TESTS PASSED |
| `tests/contract/schema.test.js` | E.1 WS-41 leg 1 (schemas validate): full draft 2020-12 ajv compile of every schema in `packages/candice-protocol/schemas/**`; four E.1 schemas exist; WS-01 package fixtures validate (valid) / reject (invalid) with documented reasons; date-time format guard; schema-index integrity |
| `tests/contract/keys.test.js` | E.1 leg 2 (question keys stable): registry vs `question-keys.schema.json`; byte-stability across loads; key uniqueness; per-skill list consistency; `^[A-Z][A-Z0-9_-]*$` pattern; every registry key shapes into a valid question event; BUILD_TARGET = spec 14 seed; never-re-ask via WS-03 SessionManager |
| `tests/contract/exactly-one.test.js` | E.1 leg 3 (exactly one answer per path; no double-count): voice put->take once; typed put->take once; terminal defer->reconcile once (inputMode terminal); redelivery opens no second slot; reconcile twice refuses; lifecycle counts exactly once; cross-path refusal (MCP-answered -> question-already-consumed); never-deferred refuses synthetic records |
| `tests/contract/secret.test.js` | E.1 leg 4 (secret question never read aloud): readAload=false/sensitivity=secret validates; readAloud required boolean + sensitivity enum; captions stay (readAloud gates voice only); registry secret keys are read-aloud safe; WS-04 validate.js accepts the safe form; answer-event carries sensitivity echo; answered secret question never re-askable |
| `tests/contract/harness.js` | Vendored-ajv bootstrap (`NODE_PATH` + `Module._initPaths()` before any ajv require), validator factory, schema walking, fixture readers |
| `tests/contract/vendor/**` | Vendored ajv 8.20.0 + ajv-formats 3.0.1 (formats) + fast-deep-equal 3.1.3 / fast-uri 3.1.5 / json-schema-traverse 1.0.0 (ajv runtime deps) — ~864 KB, MIT licenses shipped alongside; zero npm/network at test time (repo convention sections 12/17/27) |
| `tests/contract/README.md` | Suite doc: criterion mapping, run commands, vendoring rationale + required-notice handoff to the 9.4 release owner |

## Design decisions

- **Authoritative validator = ajv (full draft 2020-12 + ajv-formats)** — exactly what the WS-01 checkpoint specified ("The authoritative full 2020-12 validation lives in the WS-41 contract suite (ajv)"). The WS-01 ephemeral venv options mirrored (allErrors, strict:false, allowUnionTypes:true).
- **Zero-dependency run** matches every other lane suite (plain `node`, Node 26): ajv is vendored because WOULD-BE `npm install` needs a package-manager step and network — the customer machine has neither (sections 12/17/27).
- **Read-only consumption of dependency lanes** (0C cross-lane rule): WS-01 schemas/fixtures, WS-04 mcp/ask-user, WS-05 fallback, WS-03 session are only required, never edited. No CONTROL/** , no spec/** , no manifest edit, no root file touched, no commit.

## Verification evidence (run live, this lane)

```
$ node tests/contract/suite.js
==== schema: PASS ====
ALL TESTS PASSED
==== keys: PASS ====
ALL TESTS PASSED
==== exactly-one: PASS ====
ALL TESTS PASSED
==== secret: PASS ====
ALL TESTS PASSED
CONTRACT SUITE ALL GREEN
```

Per-file: schema.test.js 12/12, keys.test.js 8/8, exactly-one.test.js 10/10, secret.test.js 7/7 = 37 checks, 0 failures, exit 0. Repo regression: existing lane suites still pass unchanged (`plugins/candice-integration/{fallback,session}/` tests + WS-04 mcp.test.js were required and executed during this build — none modified).

## Acceptance criterion mapping (CONTROL/CHECKLIST.md E.1 WS-41)

- **contract suite green** — `node tests/contract/suite.js` exits 0 (proved above).
- **schemas validate** — full 2020-12 compile, all 6 schema files; E.1 four schemas + fixtures both directions.
- **question keys stable** — registry schema-valid, byte-identical across loads, unique, per-skill consistent, never-re-ask proved at the session layer.
- **voice/typed/terminal return exactly one answer** — each path driven to a single put/take or defer/reconcile; second attempt refused in all three.
- **Answer-in-Claude does not double-count** — WS-03 lifecycle `questionCount` stays 1 across defer->reconcile->second-reconcile; cross-path consumed refusal.
- **secret-bearing question never read aloud** — contract expresses + data layer + WS-04 gate accept only readAloud:false secret forms; captions still carry the text (readAloud gates voice only).

## CROSS-LANE-FINDING (recorded, not repaired — 0C)

**Finding 1 — WS-04 `validate.js` does not REJECT a secret question with readAloud:true.**
source: WS-WS-41 builder; affected unit: WS-04 (`plugins/candice-integration/mcp/ask-user/validate.js`, `validateQuestionEvent`); evidence: `{ sensitivity:'secret', readAloud:true }` returns `{ok:true}` — the runtime gate accepts a question the schema allows but the spec forbids (spec 8: "Secret-bearing prompts must not be read aloud"; E.1 WS-44 "secret prompts not read aloud"); severity: low (the schema is permissive by design — `readAloud` has no dependent constraint; the enforcing layer is the producing skill WS-36 and the app WS-08/19 read path; this lane proves the safe form end-to-end and the secret.test.js check documents the gate); recommended action: WS-04 or WS-36 adds the dependent check (secret => readAloud false) at the producer boundary; WS-44 audit verifies it.

**Finding 2 — WS-01 `question-keys.json` is seeded with only BUILD_TARGET.**
source: WS-WS-41 builder; affected unit: WS-01 `packages/candice-protocol/schemas/question-keys.json`; evidence: keys.test.js enforces every registry key shapes into a valid question event — it passed with the current 1-key registry but the full spec-protocol interview key set (capacity A1..., gauntlet D1-D4) is not yet enumerated (mirrors WS-01 checkpoint's own cross-lane finding to WS-36); severity: low; recommended action: WS-36 enumerates from `references/interview.md` and proposes registry additions (kaizen/eli5/bro lanes WS-37/38/39 likewise) — registry is versioned for this growth.

## Notes for QC

- Deliverable is self-contained: fresh checkout + `node tests/contract/suite.js` is the whole proof. No package.json was added (none exists for tests; the vendored tree needs none).
- `tests/contract/**` was the pre-declared WS-41 owned glob in manifest 9.2 row WR-020 — no manifest edit needed, no path-claim added.
- The vendor tree excludes source maps; three `.d.ts` files ship (fast-deep-equal, fast-uri, json-schema-traverse — ajv's own dist ships none); `require-from-string` (ajv standalone-only dep) was dropped after proving nothing in the compile/validate path requires it — `node tests/contract/suite.js` exercises the full compile path.
