# DOC-ASSET-HANDLING-NOTE — builder lane rules for image assets (BINDING)

- Scope: WS-11 (asset manifest + final-art loader) and every future lane that
  touches image assets — WS-12 (viseme), WS-13 (blink/gesture), WS-15 (visual
  test harness), and successors.
- Why this exists: builder B-WS-11 failed twice — `wf_0124be94-ce4` 19:15Z and
  `wf_b113f3f8-24d` 21:29Z — with `"Prompt is too long: 1170336"`, model
  maximum context 1,048,576 (`deepseek-v4-flash:0731`). The lane read full PNG
  bytes into context (~1.1M tokens). QC built the deliverable (doctrine 0B);
  this note fixes the lane instructions so the next dispatch cannot repeat it.

## BINDING RULES (dispatch these with the prompt, every asset lane)

1. **NEVER read image bytes into context.** No `cat`, no `base64`, no Read
   tool on PNG/JPEG/webp, no image attachment, no embedding bytes in JSON or
   prompts. The model's context is for text. One PNG read = ~60K tokens.
2. **Metadata only, via shell tools:**
   - dimensions: `sips -g pixelWidth -g pixelHeight <file>`
   - hash: `shassum -a 256 <file>` (macOS built-in; `shasum -a 256` also present)
   - byte size: `stat -f%z <file>`
   - alpha extrema/mean: Python PIL
     (`from PIL import Image; im = Image.open(p); im.getextrema()`; numpy for
     channel means) — PIL computes off-disk, results are numbers, never pixels
     in context.
3. **Stage with `cp`**, then `chmod 444` staged sources (spec 11A read-only).
4. **Manifest records data, not pixels:** id, role, stable production
   filename, width/height, byteSize, sha256, alpha stats, batch provenance.
   Full metadata pass for 17 assets ≈ a few thousand tokens total.

## Token budget facts (verified 2026-08-21)

- Model ceiling: `deepseek-v4-flash:0731` max context = **1,048,576 tokens**
  (from both 400 responses). Measured failure sizes: 1,090,678 (19:15Z),
  1,170,336 (21:29Z) — 4% / 11.6% over the wall.
- Harness bound: `CLAUDE_CODE_MAX_CONTEXT_TOKENS = 700000` in
  `~/.claude-nine/settings.json` — the profile ceiling Claude Code believes it
  has for this route. It is a harness-side compaction trigger, NOT a provider
  guarantee; the ~1M model wall still applies, and once the API rejects a
  request compaction cannot run at all. Budget lanes at ≤700K tokens with
  images at ZERO of that budget.
- `MAX_MODE_TOKENS`: **no such symbol exists anywhere on this box.** Searched
  (2026-08-21T22:00Z): worktree `launchers/`, `tools/`, `CONTROL/`,
  `scripts/`, all worktree *.md, repo root `/Users/blackceomacmini/Downloads/999-setup`,
  workflow scripts store
  (`~/.claude/projects/-Users-blackceomacmini-Downloads-999-setup/.../workflows/scripts/`),
  `~/.claude/hooks/`, `~/.claude-nine/settings.json`, `~/.claude/settings.json`,
  `~/.9router/`, live workflow store (37 run dirs). Only hits: this task's own
  dispatch text. Zero-grep control: same greps return
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` hits — instrument proven. The operative
  bounds are the pair above.
- ggml STT model memory (the q5_1 ggml model in this workstream):
  **ggml-tiny.en-q5_1 = 32,166,155 bytes (~32 MB)**, WS-16 production pin,
  sha256 `c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b`.
  Runtime model, loaded into process memory at transcription time — also a
  bytes file, also never read into context. Sibling q5_1 scale: base
  59,721,011 B, small 190,098,681 B, medium-q5_0 539,225,533 B.

## Dispatch template (paste into future asset-lane prompts)

"Asset bytes are OFF-CONTEXT. You may only use: `sips -g pixelWidth -g
pixelHeight`, `shassum -a 256`, `stat -f%z`, and Python PIL for alpha
statistics. Stage files with `cp` and `chmod 444` staged sources. Reading a
PNG into context is a lane failure."

## Provenance

Written by the root-cause fixer seat 2026-08-21 (wf_34182d8e-604 /
wf_cee37201-e2c sibling run, sonnet). Companion to the ROOT-CAUSE FIX section
appended to CHECKPOINT-WS11.md (backup:
`CHECKPOINT-WS11.md.bak-asset-handling-20260821`, same directory).
