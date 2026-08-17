# WF-6A Slice 3 Evidence — task-progress wiring (Project% + Wave% into the shared script)

**Unit:** WF-6A (Issue 20 — Progress Visibility + Session Health)
**Slice:** 3 (FIX: task-progress wiring — Project completion bar + Wave bar computation wired into the shared statusline script)
**Date:** 2026-08-16
**Branch:** fix/20-statusline
**Ledger line:** WAVE 6 DISPATCH 2026-08-16T22:06Z (FIX-LEDGER.md line 139)
**Slice scope:** the Project% + Wave% computation in the shared statusline script, per Issue 20 FIX items 13 and 14 (spec lines 453-454) and operator order 2026-08-16 (client bar = model | cost | git | Project% | Wave% — context and 5h/7d INTERNAL doctrine; PROJECT bar = THE MAIN METRIC).

---

## 1. Sources read (full-file reads, no grep-judgment)

- `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` — Issue 20 (lines 434-456, FIX items 13-14 at 453-454), PART 4 check 8 statusline (line 545), PART 6.6 (lines 601-614).
- `/Users/blackceomacmini/.claude/statusline-command.sh` (live operator-box shared script, 141 lines, full read).
- `/Users/blackceomacmini/work-999-setup-fix/WF-6A/.claude/skills/spec-protocol/scripts/setup-statusline.sh` (repo installer, full read — the script is embedded in it, lines 119-260).
- `/Users/blackceomacmini/work-999-setup-fix/WF-6A/.claude/skills/spec-protocol/references/progress-visibility.md` (derivation + guardrails, §6 lines 215-262 full read).
- `/Users/blackceomacmini/.claude-nine/projects/-Users-blackceomacmini/memory/session-cost-status-bar-operator-order.md` (operator order doctrine).
- `/Users/blackceomacmini/work-999-setup-fix/WF-6A/CONTROL/project_state.json` (live state file).
- `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` (live ledger; wave table + WAVE 6 DISPATCH line 139) and the clone's `FIX-LEDGER.md`.
- `/Users/blackceomacmini/.claude/settings.json` + `/Users/blackceomacmini/.claude-nine/settings.json` (name-only statusLine check, JSON parse — READ only, both stores).
- Live skill store `/Users/blackceomacmini/.claude/skills/spec-protocol/scripts/setup-statusline.sh` (byte-diff vs repo).

## 2. What was found (wiring already present — verified, not rewritten)

Slice 3's mandate — "wire the Project% + Wave% computation into the shared script" — is satisfied by the already-landed commit `6bf371c` (spec-protocol: progress visibility capability, Issue 20 — BASELINE line in FIX-LEDGER.md) plus the subsequent operator-order revisions (`.bak-pre-projectbar` backups in the repo tree). This slice VERIFIED the wiring end-to-end; nothing needed writing.

**Project% wiring — live script lines 65-87 (setup-statusline.sh embedded copy lines 184-206):**
- Reads `$cwd/CONTROL/project_state.json` via stdin `.cwd` — disk truth only, never conversation memory (spec line 453).
- Percent = `tasks.counts.completed / (pending + in_progress + completed)` (line 72: `jq -r '.tasks.counts // empty | "\(.pending // 0) \(.in_progress // 0) \(.completed // 0)"'`; lines 76-78: `ptotal=$(( $1 + $2 + $3 ))`, `ppct=$(( $3 * 100 / ptotal ))`).
- No state file → segment omitted, 0% never faked before the plan exists (lines 70-71 guard).
- Blocked tasks count in the total (they land in `pending`); `run_status` ≠ RUNNING is appended `[<status>]` (lines 82-84).
- Bar renders `Project ████░░░░░░ NN%` (lines 80-81).
- Derivation matches progress-visibility.md §6 lines 217-235 (percent formula, omitted-until-state-file, blocked-counted, run_status shown, bar moves on validation only, can go down on repair — all guardrails present in the doc and the code).

**Wave% wiring — live script lines 89-112 (embedded copy lines 208-231):**
- Looks for `FIX-LEDGER.md` at `$cwd` first, then `$HOME/work-999-setup/FIX-LEDGER.md` (lines 95-99) — the spec's named absolute ledger path (spec line 454; PART 2.1 line 512).
- Current wave = highest `WAVE <n>` line (line 101).
- Percent = that wave's `WF-<n>` lines carrying `PASS|DONE` divided by total `WF-<n>` lines (lines 103-104).
- No wave lines → segment omitted, never guessed (lines 100, 105).
- Matches progress-visibility.md §6 lines 245-262.

**Assembly — live script lines 126-140:** client display order `model | cost | git | Project | Wave`, nothing else. Context usage and 5h/7d rates are read only for the cost derivation; never rendered (operator order doctrine). Verified: the rendered output carries NO context percentage and NO 5h/7d figures.

**Byte-identity chain:**
- Live shared script `/Users/blackceomacmini/.claude/statusline-command.sh` == embedded copy inside repo installer `setup-statusline.sh` (extracted via awk and `diff` — IDENTICAL, 0 lines differ).
- Live skill store `/Users/blackceomacmini/.claude/skills/spec-protocol/scripts/setup-statusline.sh` == repo copy (byte-identical, `diff` clean).
- Both live settings stores reference the same shared script: `~/.claude/settings.json` and `~/.claude-nine/settings.json` both carry `"statusLine": {"type": "command", "command": "/Users/blackceomacmini/.claude/statusline-command.sh"}` (JSON parse, name-only check).

## 3. Functional verification (the instrument, live — real data, real files)

All runs: `cat <stdin-json> | /Users/blackceomacmini/.claude/statusline-command.sh`, cwd = the WF-6A clone (carries both `CONTROL/project_state.json` and `FIX-LEDGER.md`). State dir isolated per test via `XDG_STATE_HOME`.

**Test A — full bar with real state (cwd = WF-6A clone):**
```
Opus 4.6 | ~$30.00 | fix/20-statusline ✓ | Project █░░░░░░░░░ 14% | Wave 6 ░░░░░░░░░░ 0%
EXIT=0
```
- Project 14% independently computed: state file `tasks.counts` = pending 5, in_progress 1, completed 1 → 1/(5+1+1) = 14.28% → 14%. Correct.
- Wave 6 0% independently computed: clone ledger highest `WAVE <n>` = 6 (grep -o + sort -n + tail -1); WF-6 total lines 5 (`grep -c "WF-6"`), PASS/DONE markers 0 (`grep -c 'PASS\|DONE'`) → 0/5 = 0%. Correct — the ledger writes PASS/DONE only after verification (boss-enforced), so 0% before verification is the ledger's truthfulness.
- Order: model | cost | git | Project | Wave — the operator-order client display, nothing else. No context %, no 5h/7d.
- bash -n syntax check: EXIT 0.

**Test B — omission guardrails:**
- B1 cwd without `CONTROL/project_state.json` → Project segment OMITTED (no fake 0%): `Haiku 4.5 | ~$0.00 | Wave 6 ░░░░░░░░░░ 0%`.
- B2 cwd without FIX-LEDGER.md, fallback to `$HOME/work-999-setup/FIX-LEDGER.md` fires (live ledger exists there): Wave 6 segment present.
- B3 `run_status: "PASS"` → `Project █░░░░░░░░░ 14% [PASS]` — non-RUNNING status shown (spec line 453).

**Test C — edge safety:**
- C1 all-zero task counts (pending 0, in_progress 0, completed 0) → no division-by-zero, Project omitted, EXIT=0.
- C2 ledger with no `WAVE <n>` lines → Wave segment OMITTED, never guessed: `Haiku 4.5 | ~$0.00`.
- C3 unpriced model (qwen3.8-max) → cost segment omitted, never invented (operator order doctrine; spec line 444): `qwen3.8-max | Wave 6 ░░░░░░░░░░ 0%`.

## 4. Negative-result discipline

- "Context and 5h/7d never displayed": proven by the rendered outputs of all 6 runs above — the assembly (live script lines 126-140) concatenates only model, cost, gitseg, projseg, wavseg; no context/rate segment exists in any output.
- "Ledger fallback path exists": proven by B2 (rendered Wave segment while cwd lacked a ledger).
- Sources checked and NOT checked: I did not run a live `/statusline` inside an interactive claude session this slice (slice 5's boss --check covers the both-stores key presence; interactive live-line acceptance is the wave's validation slice, not this slice's scope).

## 5. Scope discipline

- Touched ONLY: this evidence file (`holding/WF-6A-slice3-evidence.md`).
- No settings files, no ledger, no script, no repo code modified. Working tree clean before and after (git status empty).
- Test artifacts (/tmp/slice3-test-*) removed after the runs.
- This is the slice-3 evidence commit on branch fix/20-statusline — one unit, one commit, message cites the WAVE 6 DISPATCH ledger line (FIX-LEDGER.md line 139), per PART 2.1.

## 6. Verdict

VERDICT: DONE — the Project% and Wave% computation is wired into the shared statusline script and proven live: real `project_state.json` counts → `Project █░░░░░░░░░ 14%` (1/(5+1+1), disk truth, blocked counted, run_status shown, omitted before the state file exists); real `FIX-LEDGER.md` wave lines → `Wave 6 ░░░░░░░░░░ 0%` (highest WAVE line, PASS/DONE markers only, cwd-first then `$HOME/work-999-setup` fallback, omitted when no wave lines). Client display = model | cost | git | Project | Wave — context and 5h/7d absent from every rendered output (internal doctrine preserved). Live script, repo installer, and live skill store are byte-identical; both settings stores reference the shared script. Zero writes needed — the wiring landed in commit 6bf371c and the operator-order revisions; this slice verified it end-to-end.
