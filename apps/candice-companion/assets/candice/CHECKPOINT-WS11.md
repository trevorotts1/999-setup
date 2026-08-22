# CHECKPOINT WS-11 — asset manifest + final-art loader

- Date: 2026-08-21
- Slice: Candice W1, WR-010 / WR-013 (assets/candice/**)
- Workflow: wf_b113f3f8-24d (rebuild attempt after wf_0124be94-ce4)

## Builder state

Both builder attempts (wf_0124be94-ce4 19:15Z, wf_b113f3f8-24d 21:29Z) failed at
the model layer: `deepseek-v4-flash:0731` exceeded its 1M-token context reading
full PNGs ("Prompt is too long: 1170336") and produced no deliverable. QC lane
built the deliverable directly (QC-as-fixer, doctrine 0B).

## Built here

- `source/` — 17 PNGs staged from the operator KIE asset pack
  (`images-transparent/`), chmod 444, sha256-verified.
- `asset-manifest.json` — 17 entries: id, role, stable production filename,
  width/height, byteSize, sha256, RGBA alpha extrema+mean, batch provenance
  (first-batch 9 / second-batch 7 / operator-supplied 1), stateMap for all
  spec-11B roles, derivedAssets slot (empty; WS-12/WS-13 fill it).
- `loader.ts` — zero-dep TypeScript registry: validateManifest(), resolve(group,
  key) metadata-only, loadImage() as the single decode path. Injectable image
  factory proves laziness under test.
- `__tests__/loader.test.ts` — 9 node --test cases: shape validation, 16+1
  mapping, sha256/dims/bytes match on-disk source, derivedAssets slot, no raw
  download filenames, laziness proof, loud failures, batch provenance, blink
  anomaly recorded.
- `README.md` (this directory).

## Test evidence

```
node --test apps/candice-companion/assets/candice/__tests__/loader.test.ts
→ tests 9, pass 9, fail 0
```

## Compliance notes

- E.1: PASS — manifest maps all 16 supplied assets (9+7) with stable production
  filenames, source->derived mapping metadata, checksums; no ChatGPT download
  filenames in production code (grep sweep of src/** and assets/candice/** clean).
- Spec 11B roles resolved through stateMap: body/idle-standing,
  body/welcome-wave, body/presenting, body/listening, body/thinking,
  body/approval, body/focus-processing (17th), face/idle-neutral, face/smile,
  face/speech-small|medium|wide, eye open/half/closed, gesture welcome|presenting|
  listening|thinking|affirmative|processing.
- Spec 11A: source PNGs untouched (read-only 444), derivatives deferred to
  WS-12/WS-13 under `derived/`.
- Ownership: files live under assets/candice/** only (map 9.2 beats the workflow
  prompt's `src/` wording). No shared/root files touched. Nothing committed
  (workflow: do NOT commit).
- Anomaly flagged: `10-eye-half-blink.png` alpha mean 169.9 (near-opaque) —
  non-blocking, recorded in manifest notes for WS-15.

## Deferred (next lanes, not this slice)

- Final-art binding in `src/shell/visual-stage.ts` (placeholder removal, spec
  step 7) — WS-09/WS-10 integration concern.
- Vite publicDir wiring for `assets/candice/` in the bundle — build config
  ownership sits with the shell lane; loader paths are manifest-relative so no
  change needed in this directory.
- Runtime derived assets (resizes/crops) — WS-12/WS-13.

## FRESH RECHECK REQUIRED

Per doctrine 0J: QC performed a fix, so the box is flipped — a fresh QC pass on
WS-11 (against E.1 + spec 11/11A/11B) must re-verify before this workstream
closes.

## ROOT-CAUSE FIX 2026-08-21T22:00Z — builder lane asset handling (BINDING)

Both WS-11 builder attempts (wf_0124be94-ce4 19:15Z, wf_b113f3f8-24d 21:29Z)
died with `"Prompt is too long: 1170336"` / `"model maximum context length:
1048576"` — `deepseek-v4-flash:0731` (1M-token ceiling) had the full PNGs read
into its context (1.1M tokens). Root cause: the builder prompt ("The 16 Candice
art assets live at .../candice-asset-pack/") was read as an invitation to read
PNG bytes into context. This note fixes the lane instructions for WS-11 and
every future asset lane (WS-12, WS-13, WS-15 and successors). See
DOC-ASSET-HANDLING-NOTE.md in this directory.

BINDING ASSET-LANE RULES:

1. **NEVER read image bytes into context.** No `cat`, no `base64`, no Read tool
   on PNG/JPEG/webp files, no image attach. This is what killed B-WS-11 twice.
2. **Metadata only, via shell tools.** Get dimensions with
   `sips -g pixelWidth -g pixelHeight <file>`, hashes with `shassum -a 256`
   (macOS built-in; `shasum -a 256` also present), byte counts with
   `stat -f%z <file>`. Alpha extrema/mean via Python PIL
   (`from PIL import Image; im = Image.open(p); im.getextrema()` /
   numpy channel means) — PIL computes off-disk, never into context.
   Same toolchain the QC fixer used (shell + PIL only).
3. **Stage with `cp`**, then `chmod 444` staged sources. Do not base64, do not
   embed bytes in JSON, do not put PNG contents in prompts or transcripts.
4. **Manifest records data, not pixels:** filename, width/height, byteSize,
   sha256, alpha stats, provenance. Context cost of a full 17-asset metadata
   pass is a few thousand tokens; a single PNG read is ~60K tokens.

TOKEN BUDGET FACTS (verified against live config and the two failure records):

- Model ceiling: `deepseek-v4-flash:0731` max context = **1,048,576 tokens**
  (from both 400 responses). Failure sizes measured: 1,090,678 (19:15Z run),
  1,170,336 (21:29Z run) — 4% and 11.6% over the wall.
- Harness bound (`~/.claude-nine/settings.json`):
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS = 700000` — the profile ceiling Claude Code
  believes it has for this route. It is a harness-side compaction trigger, not
  a provider guarantee; the model wall at ~1M still applies, and compaction
  cannot run at all once the API rejects the request. Budget any lane at
  ≤700K tokens, with images at ZERO of that budget.
- `MAX_MODE_TOKENS`: no such symbol exists anywhere on this box. Searched
  (2026-08-21T22:00Z): worktree `launchers/`, `tools/`, `CONTROL/`,
  `scripts/`, all worktree *.md, repo root `/Users/blackceomacmini/Downloads/999-setup`,
  workflow scripts store
  (`~/.claude/projects/-Users-blackceomacmini-Downloads-999-setup/.../workflows/scripts/`),
  `~/.claude/hooks/`, `~/.claude-nine/settings.json`, `~/.claude/settings.json`,
  `~/.9router/`, live workflow store (37 run dirs). The only hits are this
  task's own dispatch text. Zero-grep control: the same greps return
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` hits, proving the instrument works. The
  operative bound is the pair above: 1,048,576 model wall / 700,000 harness
  ceiling.
- ggml STT model memory: **ggml-tiny.en-q5_1 = 32,166,155 bytes (~32 MB)**
  (WS-16 CHECKPOINT pin, sha256
  `c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b`). That is
  the runtime model loaded into process memory at transcription time — also a
  bytes-file, also never to be read into context; sibling q5_1 candidates for
  scale: base 59,721,011 B, small 190,098,681 B, medium-q5_0 539,225,533 B.
  (Task asked for "q5_1 ggml model memory" — this is the only q5_1 ggml model
  in this workstream.)

PROVENANCE: appended by the root-cause fixer seat (wf_34182d8e-604 /
wf_cee37201-e2c sibling run, sonnet). Backup of this file before edit:
`CHECKPOINT-WS11.md.bak-asset-handling-20260821` (same directory).
