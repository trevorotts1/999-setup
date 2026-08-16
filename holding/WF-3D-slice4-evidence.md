# WF-3D Slice 4 Evidence — Issue 9 FIX steps 5-7 (manifest mapping, fail-closed, no-GHL)

**Branch:** fix/9-ghl-media
**Spec:** `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md`, Issue 9 FIX steps 5-7
**Ledger line cited:** WAVE 3 DISPATCH 2026-08-16T17:07Z — live ledger `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 59 (the clone's `FIX-LEDGER.md` is the pre-dispatch snapshot; the live ledger is the citation source)
**Backup:** `.claude/skills/spec-protocol/references/media-pipeline.md.backup-issue9-slice4`

## Scope of this slice (Issue 9 FIX steps 5-7)

- Step 5: Manifest mapping — each manifest row carries `local path -> GHL URL -> usage (page + slot)`, written at upload time per image.
- Step 6: Fail-closed on upload failure — row marked UPLOAD-FAILED, no temp URL in deliverable, honest marked-space treatment, morning report names it.
- Step 7: No-GHL case — images persist inside the project per existing media-pipeline contract, said plainly, never a silent skip.

## Edits made (single file: `references/media-pipeline.md`)

### 1. MEDIA ledger line template extended (section 10, line ~1632-1639)
Added the mapping fields to the MEDIA line shape:
```
| stored=<ghl|repo|ghl+repo|local-pending|lost-paid|upload-failed> | local-path=<repo-relative path> | usage=<page+slot> | perm-url=<GHL URL and/or repo path|—>
```
Added preamble sentence: "The mapping from local path to GHL URL to usage is written at upload time, per image. Every generated asset has exactly one manifest row, one upload (or a marked gap), and all its page/slot references counted."

### 2. Failure table (section 11) — Phase B upload fails row rewritten fail-closed
Old: "still failing -> PERSIST-PENDING" (row left ambiguous about deliverable reference).
New: "still failing -> **UPLOAD-FAILED**: the item enters the MEDIA-GAPS manifest's PERSIST-PENDING section, its `stored` value is `upload-failed`, and the build continues — the asset is captured and safe locally. **No temporary provider URL is used in the deliverable:** the page slot receives the honest marked-space treatment (section 9.3 item 2). The morning report names each UPLOAD-FAILED row. When GHL answers again, the manifest carries it for one resumable push batch."
Never-column strengthened: "never reference a dead temp URL from a page; never substitute a provider URL for the permanent one".

### 3. State table (section 13.3) — new `UPLOAD-FAILED` state added
Added row between `FAILED-CAPTURE` and `PERSIST-PENDING`: "Download succeeded, GHL upload failed after all retries exhausted. The asset is captured and safe locally. **No temporary provider URL is used in the deliverable** — the page slot gets the honest marked-space treatment (section 9.3 item 2), and the morning report names it. The row's `stored` value is `upload-failed`. The MEDIA-GAPS manifest's PERSIST-PENDING section carries it for one resumable push batch when GHL answers again."

### 4. New section 13.11 — Manifest mapping (local path to GHL URL to usage)
Full new subsection after 13.10 covering:
- Three-component mapping written at upload time per image: (1) local path (Phase A capture path), (2) GHL URL (upload response, read-back verified) or repo asset path on the no-GHL path, (3) usage `<page-id>:<slot-name>`.
- Mapping data-model table: `local-path`, `perm-url`, `usage`, `stored` — with sources and write timing.
- Fail-closed block: upload failure after retries = `stored=upload-failed`, `perm-url=—`, marked-space treatment, one resumable push batch, morning report naming.
- No-GHL block: `stored=repo`, repo asset path as perm-url, evidence of searched names/stores, persistence per interview.md lines 933-940 and media-pipeline.md section 13.7, said plainly, never silent.
- Verification: every MEDIA line has populated `local-path`, `perm-url` (or `stored=upload-failed|lost-paid`), `usage`; S15 enforces.

## Verification performed

- `grep` confirmed all new content present at expected locations (lines 1638, 1684, 2034, 2239-2273).
- `git diff 6b3fa1a e96884f -- .claude/skills/spec-protocol/references/media-pipeline.md` shows exactly 4 hunks, all in scope of steps 5-7. (The backup file is pre-slice1, not pre-slice4: `diff -u media-pipeline.md.backup-issue9-slice4 media-pipeline.md` yields 6 hunks — slices 1-4 combined. The slice-4-only diff is the commit diff above.)
- No other file touched. No temp/provider URL prohibition regressed (S15 text untouched).

## Claim
Slice 4 (Issue 9 FIX steps 5-7) implemented in `media-pipeline.md`. One file, one commit.
