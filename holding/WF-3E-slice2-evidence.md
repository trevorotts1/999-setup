# WF-3E slice 2 evidence — time-bounded ordering: the pipeline step is ONE unit, never split

**Slice:** WF-3E slice 2 (Issue 10 FIX step 2 — the time-bounded ordering contract)
**Branch:** fix/10-orphan-accounting (working copy /Users/blackceomacmini/work-999-setup-fix/WF-3E)
**HEAD before this commit:** 7ff5881 (slice 4 commit)
**Ledger line cited:** `WAVE 3 DISPATCH 2026-08-16T17:07Z` (/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 59)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 10 FIX step 2 (line 238)

## What the slice names

ISSUE 10 FIX step 2 (spec line 238, verbatim):

> "**Time-bounded ordering is a hard contract — this IS the token-waste mechanism, sourced.** KI.ai result URLs expire in 24 hours (https://docs.kie.ai/market/common/get-task-detail: "Generated content URLs typically expire after 24 hours"; generated files in 14 days — https://docs.kie.ai/4o-image-api/quickstart: "Generated images are stored for 14 days before automatic deletion"; fresh download links in 20 minutes via `POST /api/v1/common/download-url` — https://docs.kie.ai/common-api/quickstart: "Download links are valid for only 20 minutes"). The GHL upload is the ONLY step that turns a temporary URL into a permanent asset. The pipeline step is therefore ONE unit, never split: generate → poll to `state=success` → parse `resultUrls` → download → upload to GHL (Issue 9's API contract) → read-back → ledger line. An item left at "generated, URL in ledger" with the GHL upload deferred is fail-closed STOPPED on that item — the temp URL will expire overnight and the spend is already gone. A 24-hour clock sits between two stages of the same pipeline; only the ordering contract that forbids splitting the step watches it."

## Change

Two files, slice-2 hunks only (surgical staging — see below).

### 1. SKILL.md — S15 watch-check row extended (line 247)

The S15 requirement cell now carries the one-unit contract: **generate → poll to `state=success` → parse `resultUrls` → download → upload to GHL → read-back → ledger line, in the same step**, with the three expiry windows (24h / 14d / 20 min) and the GHL-upload-only-permanence clause. The violation cell now carries the fail-closed disposition: **an item left at "generated, URL in ledger" with the GHL upload deferred is fail-closed STOPPED on that item — the temp URL will expire overnight and the spend is already gone**. Cites `references/media-pipeline.md 13.1`.

### 2. media-pipeline.md — three blocks

- **13.1 (line 2040):** the contract itself — the step runs start to finish as a single unit; the three expiry windows named with their measured figures (section 2); the GHL upload is the ONLY step that turns a temporary URL into a permanent asset; deferred-upload items are fail-closed STOPPED; the 24-hour-clock sentence lands verbatim in substance.
- **13.2 (line 2070):** `PERSIST-PENDING` is a WAREHOUSE-OUTAGE state only, never a scheduling choice. Phase A and Phase B run in the SAME pipeline step, back to back. The only legitimate `PERSIST-PENDING` is a GHL outage (5xx/timeout after 3 retries), and the morning report names every such item.
- **13.3 (line 2088):** the state machine is a SINGLE-STEP traversal, never a resting ladder. `GENERATED-CAPTURED` is a waypoint inside the one pipeline step, not a completion state; an item whose ledger line reads "generated, URL in ledger" with no `perm-url=` and no `persist-proof=` is fail-closed STOPPED.

### Clause-for-clause mapping (spec line 238 → landed text)

| Spec clause | Landed at | Match |
|---|---|---|
| result URLs expire in 24 hours | 13.1 "result URLs expire in 24 hours"; S15 "(result URLs expire in 24h, files in 14d, download links in 20 min)" | yes |
| generated files in 14 days | 13.1 "generated files in 14 days" | yes |
| fresh download links in 20 minutes | 13.1 "fresh download links in 20 minutes" | yes |
| GHL upload is the ONLY step that turns a temporary URL into a permanent asset | 13.1 verbatim; S15 same clause | yes |
| ONE unit, never split: generate → poll → parse → download → upload → read-back → ledger line | 13.1 full chain; S15 full chain | yes |
| deferred upload = fail-closed STOPPED, temp URL expires overnight, spend gone | 13.1, 13.2, 13.3, S15 violation cell — all four carry it | yes |
| 24-hour clock between two stages; only the ordering contract watches it | 13.1 closing sentence | yes |

## Cross-reference verification

- 13.1's citation of "13.7's API contract" resolves: §13.7 exists (line 2173), the GHL media-storage contract.
- "section 2, the measured figures" resolves: 14-day file retention (lines 275-276), 24-hour URL expiry (line 305), 20-minute fresh download links (line 2156).
- S15's citation of `references/media-pipeline.md 13.1` resolves (line 2040).
- No numbering collision: 13.1/13.2/13.3 blocks sit inside the existing 13.x section structure; S15 remains between S14 and S16.

## Surgical staging — slice 1 material excluded

The working tree carries slice 1's uncommitted changes (S17 row in SKILL.md, §10.1 in media-pipeline.md) interleaved in the same two files. This slice staged ONLY its own hunks via a filtered patch (`git apply --cached`); the staged diff contains zero slice-1 lines (grep for `S17` and `10.1` in `git diff --cached`: 0 matches). After the commit, `git diff` shows exactly the slice-1 remainder (+1 SKILL.md, +37 media-pipeline.md) — untouched, exactly as found.

## Files touched (this slice only)

- `.claude/skills/spec-protocol/SKILL.md` — S15 row extension (slice-2 hunk only)
- `.claude/skills/spec-protocol/references/media-pipeline.md` — 13.1/13.2/13.3 blocks (slice-2 hunks only)
- `holding/WF-3E-slice2-evidence.md` — this file (new)

NOT touched: slice 1's uncommitted changes (S17, §10.1), the .bak files, holding/WF-3E-slice1-evidence.md, tools/__pycache__/ — all remain exactly as found.

## Commit

One unit = one commit: `spec-protocol: time-bounded ordering — pipeline step is one unit, never split (Issue 10 FIX step 2, WAVE 3 DISPATCH 2026-08-16T17:07Z)` — cites the WAVE 3 ledger line.

## VERDICT: DONE
