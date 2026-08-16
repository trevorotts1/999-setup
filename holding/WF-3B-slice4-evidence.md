# WF-3B slice 4 evidence — FIX step 4: wire the image lane into the pipeline

Unit: Issue 7 FIX step 4 (master spec /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md lines 151-171).
Commit: 5f7b12a on fix/7-image-lane in clone /Users/blackceomacmini/work-999-setup-fix/WF-3B.
Cites: WAVE 3 REDISPATCH in /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md (line 53 pattern; wave 3 dispatched per line 59).
Backup: holding/media-pipeline.md.bak-pre-slice4 (restored from commit 4c13086 — the parent of slice-4 commit 5f7b12a — via `git show 4c13086:.claude/skills/spec-protocol/references/media-pipeline.md`; verified byte-identical with `git show 4c13086:... | diff -q -` returning identical).

## What the slice names (from the master spec, Issue 7)

- FIX step 4 (line 167): "Fail-closed: a provider failure mid-run stops the image lane (not the build), marks the affected manifest rows FAILED with the error (402 = no credits is an account condition — report it and wait, or spill per the consented overflow clause), and falls to the MEDIA-GAPS path for those rows. Never a silent skip, never a stock stand-in passed off as final art."
- FIX step 3 (line 166): the image manifest — "every planned image is a manifest row (slot, page, size, aspect, generation prompt, provider, model, cost, and — because KI.ai URLs are temporary — the generated temp URL and its 24h expiry deadline) written before the first build dispatch."
- FIX step 1 (line 158): "Verify provider reachability BEFORE promising" — the PROVIDER-READY gate.
- FIX step 6 (line 169): verification — working key produces real files; dead key produces the honest gap path and zero fake images.
- Issue 8 STAGE-IMAGES/STAGE-HERO (lines 185-186): the manifest is the stage input.
- Task brief: "The image lane is not a standalone step; it is the image sub-pipeline inside the staged pipeline, gated by PROVIDER-READY check."

## Baseline state (before this slice)

Verified by recursive search across the whole skill: zero occurrences of `STAGE-IMAGES`, `STAGE-HERO`, `STAGE-WIREFRAMES`, `STAGE-SCAFFOLDING`, `STAGE-BUILD`, `STAGE-LOGO`, `PROVIDER-READY`, `image lane`, `image-lane`, or `image manifest` in /Users/blackceomacmini/work-999-setup/.claude/skills/spec-protocol/ (SKILL.md + all 24 reference files, grep rc=1 = no match on every file). The image lane wiring was genuinely absent; the staged-pipeline stage names themselves land via WF-3C (fix/8-staged-pipeline), which is a separate workflow — this slice binds the image lane to those stage names without defining them.

## Changes made (1 file, +103 lines)

File: .claude/skills/spec-protocol/references/media-pipeline.md (in clone WF-3B, on branch fix/7-image-lane).

1. New section 14 "THE IMAGE LANE IN THE STAGED PIPELINE — the sub-pipeline, gated by PROVIDER-READY" (lines 2229-2330):
   - Declares the lane as the image sub-pipeline INSIDE the staged pipeline — not a standalone step; the manifest feeds STAGE-HERO and STAGE-IMAGES; each ledger line is a stage ledger line.
   - The PROVIDER-READY gate (line 2242): live smoke before any image promise; ledger line shape `PROVIDER-READY: <kie|agnes> | <PASS|FAIL|UNDETERMINED> | smoke=<ISO8601> | fail=<which check> | path=<media|without-media>`; PASS opens the lane, FAIL takes the without-media path (9.3), UNDETERMINED treated as FAIL for promising; re-taken at every decision it gates (9.5), including before STAGE-IMAGES opens.
   - 14.1 The image manifest (line 2273): one row per generation, written before the first build dispatch, as a section of the execution plan (document 16); row fields table (slot, page, size, aspect, prompt, provider, model, cost, temp-url audit-only, 24h expiry, status); status vocabulary references the exhaustive 13.3 states; temp-url + expiry written in the SAME pipeline step as capture (13.2 Phase A).
   - 14.2 The lane's fail-closed behavior (line 2302): provider-wide failure (401/402/403 cluster, balance exhausted, sustained 429) stops the IMAGE LANE, never the build; affected rows marked FAILED with the error; 402 named as an account condition (report and wait, or spill per the consented overflow clause); MEDIA-GAPS entries per failed row; 9.3 declared-placeholder treatment, never a stock stand-in passed off as final art; never a silent skip.
   - 14.3 The lane's verification (line 2318): working key → every manifest row a real file (GENERATED-CAPTURED with verified bytes, PERSISTED with read-back URL); dead key → PROVIDER-READY fails closed, zero fake images, without-media path.
2. Section 11 failure table (line 1673): new row "Provider fails MID-RUN" — image lane STOPS (never the build); affected rows FAILED with named error; MEDIA-GAPS path; 9.3 marked-space treatment; morning report note; loss ladder applies to already-billed rows; never a silent skip, never the image lane's failure reported as a build failure.
3. Section 13.3 state table (line 2032): new `FAILED` state — the mid-run provider-failure state, marked with the error, falls to MEDIA-GAPS with the 9.3 treatment, morning report notes it.

## Contract citations (every claim anchored)

- PROVIDER-READY gate order "before promising": master spec Issue 7 FIX step 1 (line 158).
- Smoke = media-pipeline.md section 2 submit-and-poll / section 3 liveness; "key present but failing its smoke test means that provider is NOT USABLE NOW" — media-pipeline.md 9.1 (line 1394).
- Without-media path = media-pipeline.md 9.3 (lines 1538-1564): declared placeholders, MEDIA-GAPS manifest as required deliverable, never a stock image passed off as final.
- Re-take at every decision: media-pipeline.md 9.5 (lines 1596-1605).
- Manifest as execution-plan section: media-pipeline.md 14.1 cites document 16 via references/documents.md; Issue 7 FIX step 3 says "a section of the execution plan (document 16), not a new file" (line 166).
- 13.2 Phase A same-iteration capture; 13.3 states; 13.6 expiry windows (24h/14 days/20 min) — pre-existing sections, cited not duplicated.
- 402 account condition / consented overflow clause: media-pipeline.md section 10 capacity events + capacity.md response ladder; Issue 7 FIX step 4 wording quoted verbatim in 14.2.
- Stage names STAGE-HERO / STAGE-IMAGES: master spec Issue 8 FIX step 1 (lines 185-186); wired onto funnel pages by WF-3A section 15 Stage 6 (commit b880837, funnel-architecture.md) — referenced here as the consumer.

## Verification (post-edit)

- `grep -n '^## 14. THE IMAGE LANE' media-pipeline.md` → line 2229 present.
- `grep -n 'PROVIDER-READY' media-pipeline.md` → 5 hits (section header context, gate line 2242, ledger shape 2251, fail-closed line 2260, verification 2324).
- Diff scope: `git diff --stat` = exactly 1 file, 103 insertions, 0 deletions elsewhere.
- Commit 5f7b12a on fix/7-image-lane, message cites "Cites WAVE 3 REDISPATCH in /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md".
- Backup verified: holding/media-pipeline.md.bak-pre-slice4 restored from commit 4c13086 (parent of 5f7b12a) and byte-identical to `git show 4c13086:.claude/skills/spec-protocol/references/media-pipeline.md` (diff -q returned identical). The earlier claim that the backup was captured pre-edit was wrong — the original backup was a mid-edit state (it already contained the section 11 and 13.3 hunks and lacked section 14); this corrected backup is the true pre-slice4 state.

## Scope fence

Touched ONLY: .claude/skills/spec-protocol/references/media-pipeline.md (one file). No other file modified in this unit. holding/ is gitignored scratch (evidence + backup). No STAGE-* definitions introduced (WF-3C owns those); no GHL upload contract (WF-3D owns Issue 9); no 1:1:1 sweep (WF-3E owns Issue 10) — the expiry field exists in the manifest so WF-3E's expiry-class orphan sweep has its input.

VERDICT: DONE
