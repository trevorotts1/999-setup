# Contract test suite — WS-41 (`tests/contract/**`)

Candice contract/schema test suite (Master Spec spec 27 Contract tests;
Checklist E.1 WS-41), deps WS-01 (schemas+registry), WS-04 (ask_user MCP
path), WS-05 (terminal fallback / Answer-in-Claude).

## What it proves (E.1 WS-41)

> contract suite green — schemas validate, question keys stable,
> voice/typed/terminal paths each return exactly one answer,
> Answer-in-Claude does not double-count, secret-bearing question is never
> read aloud.

| Test file | Criterion leg |
|---|---|
| `schema.test.js` | schemas validate (full draft 2020-12 ajv), four E.1 schemas exist + validate WS-01 fixtures, format guards, schema-index integrity |
| `keys.test.js` | question keys stable (registry schema-valid, byte-stable, unique, per-skill consistent, each key forms a valid question event), never-re-ask at the session layer |
| `exactly-one.test.js` | voice/typed/terminal paths each return exactly one answer; Answer-in-Claude (terminal) never double-counts; cross-path refusal |
| `secret.test.js` | secret-bearing question is never read aloud (schema + registry data + WS-04 gate accept the readAloud:false safe form); answered secret question never re-askable |

## Run

Zero dependencies, zero network, plain `node` (Node >= 22.6; 26 strips types
natively — this suite is CommonJS so any Node 18+ works):

```bash
node tests/contract/suite.js          # all four files
node tests/contract/schema.test.js    # one file
```

Exit 0 only when every check passes; every check prints PASS/FAIL with the
exact input that produced it (primary-source evidence for the acceptance run).

## Why ajv is vendored (`vendor/**`, ~864 KB)

The WS-01 checkpoint states the authoritative full draft 2020-12 validation
"lives in the WS-41 contract suite (ajv)", and the repo test convention
(sections 12/17/27: no package-manager step on the customer machine; every
lane suite is plain `node`) means the suite cannot depend on `npm install`.
The vendored packages are the WS-01 ephemeral venv's exact pin set:

| Package | Version | License | Role |
|---|---|---|---|
| ajv | 8.20.0 | MIT | draft 2020-12 compiler |
| ajv-formats | 3.0.1 | MIT | date-time / uri formats |
| fast-deep-equal | 3.1.3 | MIT | ajv runtime dep |
| fast-uri | 3.1.5 | BSD-3-Clause | ajv runtime dep |
| json-schema-traverse | 1.0.0 | MIT | ajv runtime dep |

`harness.js` puts `vendor/` on `NODE_PATH` before anything requires ajv
(`Module._initPaths()` re-reads the env — the documented Node mechanism).
Licenses ship beside each package. Root `THIRD_PARTY_NOTICES.md` is a 9.4
shared file (integration/release owner only): the required notices live here
for the release owner to fold in at fan-in.

## Read-only references (never modified by this lane)

- `packages/candice-protocol/schemas/**`, `packages/candice-protocol/tests/fixtures/**` (WS-01)
- `plugins/candice-integration/mcp/ask-user/**` (WS-04) — required read-only
- `plugins/candice-integration/fallback/**` (WS-05) — required read-only
- `plugins/candice-integration/session/**` (WS-03) — required read-only

Cross-lane defects found here are recorded in `CHECKPOINT-WS-41.md` as
CROSS-LANE-FINDING, never repaired (0C cross-lane defect rule).
