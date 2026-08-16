# WF-3B slice 5 — Issue 7 FIX step 5 verification evidence

Date: 2026-08-16. Workflow: WF-3B (image lane), branch fix/7-image-lane.
Slice: FIX step 5 — verification. QC bar: "1 manifest row = 1 real generated
image, or an honestly marked gap; provider verified before the promise."

Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md Issue 7
(lines 157-171). Contract: media-pipeline.md section 14.3 (lines 2316-2326),
section 2 polling contract (lines 227-330), section 13.2 Phase A, section 9.3
(without-media path), section 14.1 (manifest before dispatch), section 14.2
(fail-closed).

## Verification bar (from dispatch)

1. A test run with a real provider produces a manifest with images.
2. Every image has a real file.
3. Zero images generated without a manifest row.
4. A provider failure produces a fail-closed state (no blank squares).

Live provider calls cost credits, so the acceptable verification is:
(a) a manifest-driven test harness where a STUB provider produces files and
the manifest accounting holds (generated = manifest rows), and (b) a
dead-key/stub-failure path proving fail-closed behavior (MEDIA-GAPS marked,
no blank squares). Both are delivered below, plus an independent
re-verification of the existing live-run artifacts (no credit re-spend).

## Harness

`holding/slice5-test/verify-image-lane.sh` — four modes:

| Mode | Provider | Network | Cost | Proves |
|---|---|---|---|---|
| `live` | kie.ai real key | yes | credits | real generation, real files |
| `dead` | kie.ai dead key | yes | free | gate fail-closed, MEDIA-GAPS |
| `stub` | STUB provider | no | free | manifest-driven 1:1 accounting |
| `stubfail` | STUB provider failing mid-run | no | free | mid-run failure fail-closed |

The harness executes the lane's exact ordering: PROVIDER-READY gate (14) ->
manifest rows PLANNED before first dispatch (14.1) -> SUBMITTED -> poll per
section 2 (first poll 30s, 30s cadence, 10 min timeout) -> GENERATED-CAPTURED
with download + magic + sha256 in the SAME poll iteration (13.2 Phase A).
Failure paths mark rows FAILED with a named error and emit MEDIA-GAPS entries
with `placeholder=DECLARED` (9.3) — never a blank square, never a stock
stand-in. Credential safety: key from env only, never on argv (curl
`--config` temp file, chmod 600), never printed, never committed.

## Instrument findings (measured, load-bearing)

### F1 — HTTP status is NOT the kie.ai discriminator; body.code is
Measured 2026-08-16: the kie.ai API answers EVERY authenticated call with
HTTP 200 regardless of key validity.
- Dead key (`sk-dead-0000...`), `GET /api/v1/chat/credit` → HTTP 200, body
  `{"code":401,"msg":"Unauthorized – Authentication failed..."}`
- Live key, same endpoint → HTTP 200, body `{"code":200,...}`
- Dead key, `POST /api/v1/jobs/createTask` → HTTP 200, body `{"code":401,...}`
- Live key, same endpoint → HTTP 200, body `{"code":200,"data":{"taskId":...}}`

Consequence: `env-sweep.sh` `curl_bearer_status` (reads `%{http_code}` only,
line 104-110) CANNOT discriminate LIVE from FOUND_NOT_LIVE on kie.ai — a dead
key reports 200 and would be read as LIVE. Any liveness gate MUST parse the
body `code` field. This is a finding for the env-sweep owner (Issue-scoped:
the image lane's PROVIDER-READY gate must parse body.code, as the harness
does).

### F2 — Content-Type: application/json is REQUIRED on createTask
Measured 2026-08-16: `POST /api/v1/jobs/createTask` with valid key but WITHOUT
`Content-Type: application/json` returns HTTP 200, body
`{"code":500,"msg":"Server exception, please try again later or contact
customer service","data":null}` (gpt-image-2-text-to-image AND
bytedance/seedream-v4-text-to-image both). WITH the header, the same body
returns `{"code":200,"msg":"success","data":{"taskId":...}}`.
The header is load-bearing and part of the lane's request shape. (The spec's
contract at Issue 7 FIX step 2 line 161 does not state the header; the lane's
request shape includes it.)

### F3 — Model resolution
`gpt-image-2-text-to-image` is confirmed in the live catalog
(docs.kie.ai/llms.txt, fetched 2026-08-16, 515 lines) and callable with the
live key (F2 proof: taskId issued). Succession discovery per section 2 ran:
llms.txt fetched, member's own doc page (docs.kie.ai/market/gpt/gpt-image-2-
text-to-image.md) read — schema: model + input{prompt, aspect_ratio,
resolution}, x-apidog-orders confirmed.

## Run 1 — DEAD KEY (gate fail-closed, free)

Harness: `verify-image-lane.sh dead dead/`

- PROVIDER-READY gate: credit-liveness body.code=401 → **FAIL**
- Path taken: without-media (9.3)
- Manifest rows written: **0** (no generation-eligible rows)
- Images created: **0**. Fake images: **0**.
- MEDIA-GAPS: 2 entries, one per planned slot, each with fully-prepared
  prompt, estimated cost, named error `PROVIDER-READY-FAIL-body.code-401`,
  `placeholder=DECLARED`
- gate.txt: `GATE:FAIL body.code=401`
- accounting.txt: `manifest-rows=0 result-records=0 image-files=0
  orphan-images=0 generated-captured-missing-file=0`

PASS: dead key produces the honest gap path and zero fake images.

## Run 2 — LIVE KEY (real generation, artifacts independently re-verified)

Harness: `verify-image-lane.sh live live/` (run by the slice-5 builder;
NOT re-run here — re-running would spend credits, and the dispatch permits
stub+dead verification instead. Every artifact below was independently
re-verified 2026-08-16: file existence, byte counts, PNG magic bytes, and
sha256 all match the recorded values.)

- PROVIDER-READY gate: credit-liveness body.code=200 → **PASS**
- Manifest: 2 rows written BEFORE first build dispatch (PLANNED):
  row1 slot=hero:main page=index 1K 1:1 model=gpt-image-2-text-to-image
  row2 slot=body:feature page=index 1K 1:1 model=gpt-image-2-text-to-image
- row1: createTask HTTP 200 body.code=200, taskId
  c7896550b4c71bfcf8dd23ef4a36943f (submit-row1.json)
- row2: createTask HTTP 200 body.code=200, taskId
  d890ccce5c77741f66e227567b799e94 (submit-row2.json)
- Poll per section 2: first poll 30s, then 30s cadence, timeout 10 min.
- Terminal: state=success → resultUrls extracted → captured in the SAME poll
  iteration (13.2 Phase A) → downloaded file, verified non-empty, magic
  bytes, sha256.
- row1 task record (free recordInfo GET, 2026-08-16T15:21Z):
  state=success, creditsConsumed=6.0 — the exact measured 1K cost from
  section 2's exhibit (taskId ec345a09... 2026-08-12); resultUrl class =
  tempfile.aiquickdraw.com temp host, confirming the temp-URL contract.
- row2 task record (free recordInfo GET, 2026-08-16T15:22Z):
  state=success, creditsConsumed=6.0, costTime=65.

Independent re-verification (2026-08-16, no credit spend):
- `live/row1-hero:main.png` — 945,874 bytes, PNG 1254x1254 8-bit RGB,
  magic `89504e470d0a1a0a`, sha256
  `2e79fad48684ba1d824108cf7d5a863fe9c08ec3be5503127e850112f93c2668`
- `live/row2-body:feature.png` — 900,030 bytes, PNG 1254x1254 8-bit RGB,
  magic `89504e470d0a1a0a`, sha256
  `d4d644698e5a329c63d3e5479438807e3e9d05b0c765fdbfce2f345e995dc98c`
- Both match the recorded rowN-result.txt values exactly.

PASS: every manifest row produced a real file (2/2 GENERATED-CAPTURED).

## Run 3 — STUB PROVIDER (manifest-driven 1:1 accounting, free)

Harness: `verify-image-lane.sh stub stub/` — STUB provider, no network.
The stub exercises the lane's exact manifest-driven ordering: gate PASS ->
2 PLANNED rows written before first dispatch -> per-row submit (stub
createTask returns code 200 + taskId) -> terminal success -> capture ->
deterministic real PNG file (1x1, real magic bytes) -> GENERATED-CAPTURED
record -> manifest status updated in place.

- gate.txt: `GATE:PASS body.code=200`
- Manifest: 2 rows, both `status=GENERATED-CAPTURED`
- Files: `stub/row1-hero:main.png`, `stub/row2-body:feature.png` — both
  valid PNG (magic `89504e470d0a1a0a`), non-empty
- accounting.txt: `manifest-rows=2 result-records=2 image-files=2
  orphan-images=0 generated-captured-missing-file=0`

PASS: generated = manifest rows exactly; every image has a real file; zero
orphan images; zero GENERATED-CAPTURED rows missing their file.

## Run 4 — STUB PROVIDER FAILING MID-RUN (fail-closed, free)

Harness: `verify-image-lane.sh stubfail stubfail/` — STUB provider, no
network. The stub createTask returns HTTP 200 with body
`{"code":500,"msg":"Server exception (stub provider failure)","data":null}`
— the exact F2-measured mid-run failure shape (HTTP 200 + body.code 500).

- gate.txt: `GATE:PASS body.code=200` (gate passed; failure hits at submit)
- Manifest: 2 rows, both `status=FAILED`
- rowN-result.txt: `status=FAILED error=http-200-body-500`
- MEDIA-GAPS: 2 entries, one per slot, named error `http-200-body-500`,
  `placeholder=DECLARED`
- Images created: **0**. Fake images: **0**.
- accounting.txt: `manifest-rows=2 result-records=2 image-files=0
  orphan-images=0 generated-captured-missing-file=0`

PASS: mid-run provider failure stops the lane, every row marked FAILED with
the named error, every slot carried in MEDIA-GAPS with a DECLARED
placeholder — no blank squares, no stock stand-ins, zero images.

## 1:1 accounting (all runs)

| Run | manifest-rows | result-records | image-files | orphan-images | missing-file |
|---|---|---|---|---|---|
| dead | 0 | 0 | 0 | 0 | 0 |
| live | 2 | 2 | 2 | 0 | 0 |
| stub | 2 | 2 | 2 | 0 | 0 |
| stubfail | 2 | 2 | 0 | 0 | 0 |

Orphan images (image with no manifest row): 0 in every run — every
generation traces to a manifest row read from the manifest file; the
accounting function scans the output dir for any PNG not referenced by a
result record. GENERATED-CAPTURED rows missing their file: 0 in every run.

## Verdict

VERDICT: DONE — FIX step 5 verification PASS.

1. Real provider run: every manifest row produced a real file (2/2 rows →
   GENERATED-CAPTURED, magic bytes + sha256 independently re-verified
   2026-08-16, no credit re-spend). Bar 1 and 2 met.
2. Stub provider run: manifest-driven accounting holds exactly — 2 rows = 2
   records = 2 real files, 0 orphans, 0 missing. Bar 1, 2, 3 met.
3. Dead key: PROVIDER-READY gate failed (body.code=401), zero images,
   MEDIA-GAPS with DECLARED placeholders (9.3). Bar 4 met.
4. Mid-run provider failure (stubfail, F2 shape): rows FAILED with named
   error, MEDIA-GAPS entries, zero images, no blank squares. Bar 4 met.
5. Zero images without a manifest row: 0 orphan generations in all four runs.
6. Provider verified before the promise: gate PASS/FAIL precedes any image
   work in every run.

Instrument findings carried forward (fixes for later slices / env-sweep
owner):
- F1: kie.ai answers every authenticated call with HTTP 200; body.code is the
  discriminator (401 dead / 200 live). HTTP-status-only checks (env-sweep.sh
  curl_bearer_status) misread a dead key as LIVE.
- F2: createTask REQUIRES Content-Type: application/json; without it, valid
  key returns body.code 500 "Server exception". The header is load-bearing
  request shape.
