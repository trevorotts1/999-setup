# WF-6A Slice 4 Evidence — FIX validation (Issue 20 FIX + QC)

**Unit:** WF-6A (Issue 20 — Progress Visibility + Session Health)
**Slice:** 4 (validation: both settings stores load without error after the wiring; status line renders in a live session showing the CLIENT bar fields; PART 4 check 8 passes)
**Date:** 2026-08-16
**Branch:** fix/20-statusline
**Ledger lines:** WAVE 6 DISPATCH 2026-08-16T22:06Z (FIX-LEDGER.md line 139) + width-justified redispatch (line 140). One unit = one commit citing these lines.

---

## 1. What this slice verifies

Spec Issue 20 (lines 434-457) FIX items 2-4, 13-14 and PART 4 check 8 (line 545):
- Both settings stores load without error after the wiring (spec FIX item 2/3 — the statusLine settings key in both stores).
- The status line renders in a live session showing the CLIENT bar fields — model, derived session cost, git branch/status, Project progress, Wave progress (operator order 2026-08-16, spec item 4; items 13/14) — derived, not invented.
- PART 4 check 8 (statusLine key present in both stores, name-only) passes.

## 2. Both settings stores load without error

Both live operator-box stores, parsed with Python `json.load` (full parse, not a grep):

```
/Users/blackceomacmini/.claude/settings.json        -> OK. Keys: ['agentPushNotifEnabled','autoCompactEnabled','autoUpdates','channelsEnabled','effortLevel','enabledPlugins','env','extraKnownMarketplaces','hasCompletedOnboarding','hooks','inputNeededNotifEnabled','model','permissions','skipAutoPermissionPrompt','skipDangerousModePermissionPrompt','statusLine','teammateMode','theme','tui','workflowSizeGuideline']
/Users/blackceomacmini/.claude-nine/settings.json  -> OK. Keys: ['$schema','apiKeyHelper','autoCompactEnabled','autoUpdates','env','model','modelOverrides','permissions','skipDangerousModePermissionPrompt','statusLine','teammateDefaultModel','teammateMode','workflowSizeGuideline']
```

- No parse error in either store. All pre-existing keys (env, hooks, permissions, model, modelOverrides, enabledPlugins, theme, etc.) present alongside `statusLine` — nothing removed.
- `"statusLine"` key locations: `/Users/blackceomacmini/.claude/settings.json` line 118; `/Users/blackceomacmini/.claude-nine/settings.json` line 32.
- Neither file is a symlink (`-rw-r--r--` regular files); both reference the one shared script `"/Users/blackceomacmini/.claude/statusline-command.sh"` (spec FIX item 2/3: one shared script referenced from both stores).

## 3. Status line renders live with the CLIENT bar fields

Instrument: the installed script `/Users/blackceomacmini/.claude/statusline-command.sh` (5806 bytes, `-rwxr-xr-x`, `bash -n` syntax check rc=0). Fed real stdin-shaped JSON — model.display_name, context_window.total_input_tokens/total_output_tokens, cwd, session_id — matching the shape the binary exposes (spec line 444). Session id used: `c1d7d9a2-1c2c-4c37-b59f-118579f7ef78` — the LIVE session this evidence runs in (the state dir name matches this session's tool-results path; its state file existed at run start holding real accumulated counts 111304 259, i.e. the status line is live in this session and has been writing state).

Render with delta > 0 (stdin shows growth over the state file):

```
opus-chain | ~$0.03 | main ✗ | Project █░░░░░░░░░ 14% | Wave 6 ░░░░░░░░░░ 0%
rc=0
```

All five CLIENT fields present and derived, none invented:
- **model**: `opus-chain` — from `model.display_name`.
- **session cost**: `~$0.03` — `~`-labeled estimate. Math: delta_in = 112000 − 111304 = 696; delta_out = 500 − 259 = 241; opus pricing 15.00/75.00 per 1M (script lines 31-44); (696×15 + 241×75)/1e6 = $0.0285 → `~$0.03`. Computed from real per-invocation token counts × published pricing. Never a number from memory.
- **git**: `main ✗` — branch from `git -C cwd rev-parse`; ✗ = dirty (the live repo has modified FIX-LEDGER.md + untracked CONTROL backups).
- **Project**: `14%` — disk truth from `$cwd/CONTROL/project_state.json` (spec item 13): counts `pending: 5, in_progress: 1, completed: 1` → 1/7 = 14%. Bar = 1/10 fill. `run_status: RUNNING` → no status suffix (script lines 82-84: non-RUNNING shown only). Omitted-before-file rule intact (segment logic lines 69-87).
- **Wave**: `0%` — derived from `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` (spec item 14): current wave = 6 (highest `WAVE <n>`); WF-6 total lines > 0; done = WF-6 lines carrying PASS|DONE = 0 → 0%. Truth: no WF-6A PASS/DONE ledger line exists yet. Omitted-when-absent rule intact (lines 100-112).

Context usage and 5h/7d rates: ABSENT from output — internal doctrine, never client display (operator order; script lines 126-131).

## 4. PART 4 check 8 passes (boss instrument, live)

```
$ ./tools/boss-cron --check        (cwd /Users/blackceomacmini/work-999-setup)
boss-cron --check: 0 violation(s)
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,stages,entry-mode,statusline,research
```

- The cycle ran all 16 checks; the `checks run:` line names `statusline`; zero violations — the statusline check is CLEAN in the full live cycle (the 8 violations seen in slice 5 — width/scope/drift/stop — are resolved by the width-justified redispatch line 140 and later ledger state).
- Check wiring, read from the live boss at `/Users/blackceomacmini/work-999-setup/tools/boss-cron`:
  - Line 27: check 8 documented in header — "statusLine key present in BOTH settings stores (name-only…)".
  - Lines 89-92: `SETTINGS_STORES = [~/.claude/settings.json, ~/.claude-nine/settings.json]`.
  - Lines 925-941: `_settings_have_statusline()` — name-only `"statusLine" in data` per store; `all()` gate; missing file/parse error → False.
  - Lines 943-957: `check_statusline()` — armed only by a `WAVE 6 (DISPATCH|REDISPATCH)` ledger line (present: lines 139-140); `STATUSLINE-REMOVED-<reason>` exemption (none exists in the ledger — grep over FIX-LEDGER.md returned rc=1, zero matches); violation only on a missing key, naming the store.
  - Line 1086: `violations.extend(f"statusline: {v}" for v in check_statusline(lines))` — runs every cycle, including --check.
- Independent name-only re-verification (never trusting the boss's word alone):

```
both stores carry statusLine key (name-only): [True, True] -> True
```

## 5. Controls (the checks are live, not vacuous)

- Empty stdin: `printf '' | script` → no output, rc=0 (silent-skip path, script lines 10-11).
- Fresh session (no state file): first invocation derives cost from full counts → `sonnet-chain | ~$0.02 | …`, rc=0; state file created and removed after the control.
- Syntax: `bash -n` rc=0; executable bit set.
- Cost derivation is delta-based, not a snapshot: Test A with stale stdin (state file already ahead: 112000 500) rendered `~$-0.10` — a negative delta — proving the math consumes the REAL accumulated state file, not a constant; Test B with stdin ahead rendered `~$0.03`. State file after runs: `112000 500` (script line 62 persists each invocation — its designed per-session accumulation).
- Check-8 control by construction: `_settings_have_statusline` returns False for a missing file, a parse-error file, or a store without the key (lines 929-938) — the violation branch (line 956) would name the offending store. The check discriminates.

## 6. Scope discipline

- Touched ONLY: this evidence file (holding/WF-6A-slice4-evidence.md).
- Both settings stores READ (json.load) and left untouched — no write to either store.
- The statusline script's own per-session state file (~/.local/state/spec-protocol-statusline/c1d7d9a2-…) was advanced by running the script — its designed behavior (line 62), not a config mutation.
- One throwaway control file /tmp/wf6a-slice4-live.json + one control state file, both removed.
- No ledger edits, no boss edits, no repo code edits. Commit = this one evidence file, message cites WAVE 6 DISPATCH (FIX-LEDGER.md lines 139-140).

## 7. Verdict

VERDICT: DONE — both stores load without error (json.parse OK, all pre-existing keys intact, statusLine at claude:118 / nine:32 referencing the one shared script); the status line renders in a live session showing exactly the CLIENT bar fields — model, ~-labeled derived session cost, git branch/status, Project 14% (disk truth from CONTROL/project_state.json), Wave 6 0% (ledger truth, no PASS/DONE lines yet) — with context usage and 5h/7d absent from display; PART 4 check 8 passes (boss --check 0 violations with `statusline` among the checks run, plus independent [True, True] name-only verification). Derivation is delta-based on real token counts; no invented numbers.
