# WF-6A Slice 2 Evidence — Issue 20 status-line: shared script, both stores reference it

**Slice:** 2 (FIX: the shared status-line script — one script both stores reference (the statusline command))
**Workstream:** WF-6A (Issue 20 — Progress Visibility + Session Health)
**Branch:** fix/20-statusline @ 47f5ce1 (working copy /Users/blackceomacmini/work-999-setup-fix/WF-6A)
**Dispatch:** WAVE 6 DISPATCH 2026-08-16T22:06Z (FIX-LEDGER.md line 140)
**Date:** 2026-08-16
**Builder:** Opus builder (this agent)

## Slice scope

Extract the shared status-line script from the existing skill wiring and ensure BOTH
settings stores reference that one shared script. The settings.json files are LIVE on
the operator box — both stores = `~/.claude/settings.json` and `~/.claude-nine/settings.json`.

## 1. Finding: slice-2 requirement already fully satisfied at base commit 797bcff

The wave-6 base commit already carried the complete Issue 20 status-line wiring. The
installer `setup-statusline.sh` (which writes the shared script and registers the key in
both stores) is present in the base tree:

- `git show 797bcff:.claude/skills/spec-protocol/scripts/setup-statusline.sh` exists and contains:
  - line 18: `STATUSLINE_SCRIPT="$HOME/.claude/statusline-command.sh"` — the ONE shared script path
  - lines 19-20: `CLAUDE_SETTINGS="$HOME/.claude/settings.json"` and `CC9_SETTINGS="$HOME/.claude-nine/settings.json"` — BOTH stores
  - lines 52-53: writes `statusLine = {"type": "command", "command": $cmd}` with the shared path
  - line 119: heredoc `cat > "$STATUSLINE_SCRIPT" <<'STATUSLINE_EOF'` writes the shared script body
  - lines 267-281: registers the key in BOTH stores (both-stores rule)
- Base md5: `a156c4d1c8423da81cf4d1afc36961f1` == HEAD md5 (verified: `md5` of base-tree path equal to working-tree path; `git diff 797bcff..HEAD -- scripts/setup-statusline.sh` = empty).
- Commit introducing it: `6bf371c spec-protocol: progress visibility capability (Issue 20)` (prior wave, pre-dispatch).

So the FIX step for this slice (one shared script referenced by both stores) was
delivered in the base; this slice's job is independent verification that the wiring is
present, correct, and live — plus evidence + commit.

## 2. Shared script extraction — live state matches the skill wiring

- Skill installer: `/Users/blackceomacmini/.claude/skills/spec-protocol/scripts/setup-statusline.sh`
  (12.4K, Aug 16 12:15, md5 a156c4d1c8423da81cf4d1afc36961f1)
- Repo copy: `/Users/blackceomacmini/work-999-setup/.claude/skills/spec-protocol/scripts/setup-statusline.sh`
  (md5 a156c4d1c8423da81cf4d1afc36961f1 — identical)
- Live shared script: `/Users/blackceomacmini/.claude/statusline-command.sh` (5806 bytes, Aug 16 12:04, rwxr-xr-x)
- The live shared script is byte-identical to the heredoc body embedded in the installer:
  `diff <(sed -n '119,260p' setup-statusline.sh) ~/.claude/statusline-command.sh` shows only the
  two heredoc framing lines (`cat > ... <<'STATUSLINE_EOF'` and `STATUSLINE_EOF`) — script body
  zero differences.
- Live script content verified (read in full, 140 lines): marker `SPEC-PROTOCOL-STATUSLINE`
  present (live line 2), client-facing segments — model extraction (embedded copy line 134
  = live line 15), derived session cost from real token counts × published per-model pricing
  with `~` label (embedded lines 139-182 = live lines 20-63), git branch/status (embedded
  lines 233-243 = live lines 114-124), Project completion bar from
  `$cwd/CONTROL/project_state.json` disk truth (embedded lines 184-206 = live lines 65-87),
  Wave bar from FIX-LEDGER.md (embedded lines 208-231 = live lines 89-112). Context usage
  and 5h/7d rates are NOT rendered (INTERNAL doctrine only) — assembly (embedded lines
  245-258 = live lines 126-139). Citation scheme: "embedded" = body inside
  `setup-statusline.sh` (heredoc opens at installer line 119; body line N = installer line
  119+N); "live" = `~/.claude/statusline-command.sh`.
- No second copy exists: `~/.claude-nine/statusline-command.sh` does NOT exist
  (verified via `ls`); one shared script is the only statusline script on the box.

## 3. Both stores reference the shared script (LIVE operator-box stores, read in full)

`/Users/blackceomacmini/.claude/settings.json` line 118-121:
```
"statusLine": {
  "type": "command",
  "command": "/Users/blackceomacmini/.claude/statusline-command.sh"
}
```

`/Users/blackceomacmini/.claude-nine/settings.json` line 32-35:
```
"statusLine": {
  "type": "command",
  "command": "/Users/blackceomacmini/.claude/statusline-command.sh"
}
```

Both point at the SAME shared path. Neither is a symlink (verified: `ls -la` shows
regular files, 3329 bytes / 1440 bytes). Detect-first honored: existing lines preserved,
identical to what the installer would write — installer `--check` (dry run, writes
nothing) reports both healthy:

```
DRY RUN (--check) — nothing will be written.
Already configured in /Users/blackceomacmini/.claude/settings.json — healthy, no action.
Already configured in /Users/blackceomacmini/.claude-nine/settings.json — healthy, no action.
Shared script already installed (ours) — would keep.
Stamp present — a real run would report already-installed.
exit=0
```

Idempotency artifacts from the original install (12:04):
- stamp: `/Users/blackceomacmini/.claude/.spec-protocol-statusline-stamp` = `2026-08-16`
- backups: `~/.claude/settings.json.bak-statusline-20260816-120433`,
  `~/.claude-nine/settings.json.bak-statusline-20260816-120433`

## 4. Runtime proof — the shared script executes and renders, in this session

Sample stdin (real schema fields: model.display_name, context_window.total_input_tokens /
total_output_tokens, cwd, session_id):

```
printf '%s' '{"model":{"display_name":"claude-opus-5"},"context_window":{"total_input_tokens":1000,"total_output_tokens":500},"cwd":"/Users/blackceomacmini/work-999-setup-fix/WF-6A","session_id":"slice2-runtime-test"}' | /Users/blackceomacmini/.claude/statusline-command.sh
```

Output (exit=0):
```
claude-opus-5 | ~$0.05 | fix/20-statusline ✓ | Project █░░░░░░░░░ 14% | Wave 6 ░░░░░░░░░░ 0%
```

Every segment live-verified against real disk truth:
- model: `claude-opus-5` (from stdin display_name)
- cost: `~$0.05` — derived from real token counts (1000 in × $15 + 500 out × $75 per 1M, from the
  published-price table in the script, embedded lines 150-152 = live lines 31-33) — ~-labeled,
  never invented
- git: `fix/20-statusline ✓` — branch of the working-copy cwd (clean; ✓ mark from
  `git status --porcelain` empty)
- Project bar: 14% — reads `/Users/blackceomacmini/work-999-setup-fix/WF-6A/CONTROL/project_state.json`
  (disk truth: counts pending 5 / in_progress 1 / completed 1 → 1/7 = 14%); blocked tasks would
  count in the total; bar moves on validation only; `run_status` ≠ RUNNING appends the state tag
- Wave bar: `Wave 6 0%` — reads FIX-LEDGER.md (highest WAVE line = 6; WF-6 lines with PASS/DONE
  markers / total WF-6 lines); omitted when no wave lines exist
- Context usage and 5h/7d usage: ABSENT from display (INTERNAL doctrine)

## 5. Skill wiring references (where the shared-script convention is documented)

- `SKILL.md` line 875-884: step 2.10 — "Configure via ONE shared script
  `~/.claude/statusline-command.sh` referenced from BOTH `~/.claude/settings.json` and
  `~/.claude-nine/settings.json`" (read in full)
- `references/progress-visibility.md` line 66: "Convention: one shared script at
  `~/.claude/statusline-command.sh` referenced from both"; line 274: same convention in the
  setup flow; line 335: disable flow leaves the shared script (runs only when referenced)
- `scripts/setup-statusline.sh`: the installer that owns both the script body and the
  two-store registration (base commit 797bcff, unchanged at HEAD)

## 6. Writes performed by this slice

- Evidence file only: `/Users/blackceomacmini/work-999-setup-fix/WF-6A/holding/WF-6A-slice2-evidence.md`
- No settings.json changes (both stores already correct — detect-first honored, nothing to write;
  no backup created because no write occurred; the 12:04 backups remain Trevor's one-command restores)
- No script changes (live script byte-identical to skill wiring)

## 7. Not in scope (per dispatch: touch ONLY what this slice names)

Task-progress wiring, validation/live claude-nine proof, the 15-item final report, and the
Project/Wave bar internals belong to other WF-6A slices. This slice verified the shared-script
wiring only.

## Verdict

The slice-2 FIX requirement — ONE shared statusline script referenced by BOTH settings stores —
is present, correct, idempotent, and runtime-proven. Nothing to fix; evidence committed.
