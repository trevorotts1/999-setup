# FIX-019 human/hardware runbook — operator procedure

Owned path: `tests/e2e-acceptance/human/**` (FIX-019 implementation lane).
This is the procedure for the two human interviews. It names platform, OS
version, terminal host, shell, launcher, and test date per run (evidence
README human-test rule). Run results feed the HUMAN_HARDWARE tier via
`human/record-run.js`; the tier cannot PASS without these legs.

## 0. What must be true before you start

1. Packaged artifact exists and is codesign-verified (Layer 4):

   ```sh
   npm --prefix apps/candice-companion run tauri:build
   (cd apps/candice-companion && bash scripts/package-macos/build-macos-bundle.sh adhoc)
   codesign --verify --deep --strict "apps/candice-companion/dist/Candice Companion.app"
   ```

   Record the artifact path and SHA in every trace template:

   ```sh
   shasum -a 256 "apps/candice-companion/dist/Candice Companion.app/Contents/MacOS/candice-companion"
   git rev-parse HEAD
   ```

2. Terminal host running the interview has Accessibility permission
   (System Settings → Privacy & Security → Accessibility) — the companion
   is driven through its accessibility tree.
3. `claude` and `claude-nine` both resolve on the host. Plain `claude`
   carries NO `CLAUDE_CONFIG_DIR` override (repo rule 10, spec 0.3).
   Verify per run and record which launcher was used.
4. No other interview session is live in the same workspace — one governed
   question at a time (spec: exactly-one).

## 1. The four runs (all required — no required leg may be skipped)

| # | Launcher | Mode | Runbook | Trace template filled |
| --- | --- | --- | --- | --- |
| 1 | `claude` | default | `default-mode-runbook.md` | `trace-template.json` → `default-mode-claude.json` |
| 2 | `claude-nine` | default | `default-mode-runbook.md` | `trace-template.json` → `default-mode-claude-nine.json` |
| 3 | `claude` | advanced | `advanced-mode-runbook.md` | `trace-template.json` → `advanced-mode-claude.json` |
| 4 | `claude-nine` | advanced | `advanced-mode-runbook.md` | `trace-template.json` → `advanced-mode-claude-nine.json` |

Each filled template is the evidence for one required leg id
(`default-mode-claude`, `default-mode-claude-nine`, `advanced-mode-claude`,
`advanced-mode-claude-nine`) plus the legs every run must record
(`clarification-loop`, `ceiling-count`, `input-mode-per-question`,
`final-write-through`).

Optional legs, skippable ONLY with the sanctioned reason recorded:

- `live-mic-voice` — voice answers; skip with reason
  "no operator-approved voice hardware available; typed answers still
  required" when no approved mic path exists.
- `windows-interactive-smoke` — owned by FIX-018/WS-46 matrix, never
  FIX-019; record SKIPPED with that reason.

Any other skip in this tier = tier BLOCKED (mechanical promotion).

## 2. Per-run procedure

1. Fill one `trace-template.json` copy: runId
   (`human-<launcher>-<mode>-<timestamp>`), launcher, mode, platform,
   OS version (`sw_vers -productVersion`), terminal host (`hostname`),
   shell, test date, sessionId (the real Claude session id), artifact
   path, packaged binary SHA, commit SHA.
2. Start the interview with the activation command:

   ```text
   /spec-protocol
   ```

   Say the test brief verbatim: "Build me a simple one-page website for a
   local coffee shop." (Same brief for all four runs.)
3. Follow the mode runbook exactly (default or advanced). Every counted
   question: append one `question-presented` frame, then one
   `answer-submitted` frame (inputMode `typed`, or `voice` when a real
   approved mic path is used), then one `answer-returned` frame. Every
   clarification round trip appends `clarification-asked` and
   `clarification-returned`. Every compact question appends
   `compact-entered` + `compact-submit`. Duplicate/wrong-session refusals
   append `duplicate-refused` / `wrong-session-refused`. Terminal fallback
   appends `fallback-returned`. End with `interview-complete`, then
   `write-through`.
4. The `countedSequence` array must list every counted question key in
   order, one entry per counted occurrence (BUILD_TARGET appears once per
   counted ask; see the mode runbook for the expected sequences).
5. Verify final write-through: `documentPath` + `ledgerPath` exist on disk
   and contain the decisions. Set `verified: true` only after reading
   both files.

## 3. Recording the tier

After all four runs:

```sh
node tests/e2e-acceptance/human/record-run.js \
  --template tests/e2e-acceptance/human/trace-template.json \
  --runs <filled-1.json> <filled-2.json> <filled-3.json> <filled-4.json>
```

`record-run.js` writes `evidence/FIX-019/builder/human-report.json` (+
`HUMAN-REPORT.md`) from the filled templates — never from prose — and
exits mechanically: 0 = all required human legs PASS, 1 = FAIL, 2 =
BLOCKED. Frames are validated against the twelve eventKind vocabulary and
questionKey against `packages/candice-protocol/schemas/question-inventory.json`
(active records only; retired B3/C7/C8 are never accepted in a frame).
Secrets never enter: any frame content that looks like question/answer
text fails validation.

## 4. QC replay (ceiling oracle)

QC replays `countedSequence` from each filled template against:

- `.claude/skills/spec-protocol/references/interview.md` — ceiling
  arithmetic and the per-target table; the counter rules (mode question
  first, DEFAULT MODE wall = nine, ADVANCED MODE wall = target row, every
  counted question spoken "Question <N> of no more than <C>");
- `.claude/skills/spec-protocol/references/candice-question-contract.md` —
  question governance, exactly-once, never-re-ask.

A mismatch between the observed counted sequence and doctrine is a tier
FAIL, not a narrative.
