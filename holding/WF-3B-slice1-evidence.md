# WF-3B slice 1 evidence — image manifest as execution-plan section (Issue 7 FIX step 3)

Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md
Issue 7 FIX step 3 (line 166): "Image manifest BEFORE build: every planned
image is a manifest row (slot, page, size, aspect, generation prompt, provider,
model, cost, and — because KI.ai URLs are temporary — the generated temp URL
and its 24h expiry deadline) written before the first build dispatch. The
manifest is a section of the execution plan (document 16), not a new file."

Ledger: /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 59 —
"WAVE 3 DISPATCH 2026-08-16T17:07Z" (the only WAVE 3 line naming the wave's
dispatch; verified no "WAVE 3 REDISPATCH" line exists in the ledger).

Commit: 3265937 on fix/7-image-lane in /Users/blackceomacmini/work-999-setup-fix/WF-3B
(amended from 9410276, parent 5f7b12a — slice 4's media-pipeline.md commit).
Message cites: "WAVE 3 DISPATCH 2026-08-16T17:07Z".

## What was written (two files, one commit)

### 1. references/documents.md — document 16 shape (lines 409-435)
Added "THE IMAGE-MANIFEST section (media fold — folds into document 16; never a
new file)" to the execution plan's shape:
- Enumerated list, one row per planned image, written BEFORE the first build
  dispatch. Each row is one generation.
- Row contract cites media-pipeline.md section 14.1 (the slice-4 image-lane
  section, same branch): slot (page + section), page, size, aspect, generation
  prompt (band-passing), provider, model, cost, and — because provider URLs are
  temporary (Kie.ai 24h expiry, media-pipeline.md section 13.6) — the generated
  temp URL and its 24h expiry deadline, recorded at generation time in the same
  pipeline step as the capture, plus the row's status from the exhaustive state
  list (13.3).
- Authority: "The manifest is the AUTHORITATIVE image list: no image is
  generated outside it; every generation has exactly one manifest row."
- Gate ordering: rows written only after the provider-reachability gate passes
  (interview.md, PROVIDER-READY); on gate fail the run takes the without-media
  path (media-pipeline.md section 9.3) and writes no generation-eligible rows.
- Boss-cron orphan sweep (Issue 10) reads this section: generated = manifest =
  uploaded = referenced, zero orphans.
- "What makes it wrong" extended: a media build whose execution plan lacks the
  IMAGE-MANIFEST section, or a generation that exists without a manifest row, or
  a manifest row written before the provider-reachability gate passed.

### 2. SKILL.md — step 16 (lines 1113-1122) and reference 19 (line 1694)
- Step 16 "Write the execution plan" now carries: when the build generates
  images, the execution plan ALSO carries the IMAGE-MANIFEST section
  (documents.md, document 16): an enumerated list written BEFORE the first
  build dispatch, one row per planned image (slot, page, size, aspect,
  generation prompt, provider, model, cost, and the temp URL + 24h expiry
  recorded at generation time — full row contract = media-pipeline.md section
  14.1). "The manifest is the authoritative image list — no image is generated
  outside it." Rows written only after the provider-reachability gate passes
  (step 6's media-block close); on a gate fail the run takes the without-media
  path and writes no generation-eligible rows.
- Reference 19 (media-pipeline.md) description extended: its image-manifest
  section (14.1) is the row contract for the execution plan's IMAGE-MANIFEST
  section (step 16, document 16) — one row per planned image, written before
  the first build dispatch, no image generated outside the manifest.

## Composition with sibling slices on this branch
- 4c13086 (slice 2): interview.md provider-reachability gate (FIX step 2) —
  the gate my manifest rows depend on; my text cites PROVIDER-READY from it.
- 5f7b12a (slice 4): media-pipeline.md section 14 (FIX step 4) with 14.1 the
  image-manifest row contract; my text cites 14.1 precisely.
- Slice 1 unique scope: the execution-plan registration (document 16) that the
  spec's "section of the execution plan, not a new file" mandate requires.
  No overlap: I touched only documents.md + SKILL.md; slice 4 owns
  media-pipeline.md; slice 2 owns interview.md.

## Verification (all run, all passed)
- git diff --stat at commit: 2 files, +34/-3, only documents.md + SKILL.md.
- git status clean except holding/ (evidence + backups).
- grep confirms the row contract fields (slot, page, size, aspect, prompt,
  provider, model, cost, temp URL, 24h expiry) present at documents.md lines
  415-418 and SKILL.md lines 1116-1117.
- grep confirms media-pipeline.md section 14.1 exists at line 2270 ("The image
  manifest — the lane's single source of truth") — the cited contract.
- Section 13.6 (Kie.ai 24h expiry) exists at line 2080; section 9.3
  (without-media path) at line 1538; state list 13.3 at line 2024 — all cited
  sections verified present.
- Ledger line cited verbatim: "WAVE 3 DISPATCH 2026-08-16T17:07Z" — verified
  at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 59.

## Backups (PART 5 rule 4)
- holding/documents.md.bak-pre-slice1 (pre-edit)
- holding/SKILL.md.bak-pre-slice1 (pre-edit)
