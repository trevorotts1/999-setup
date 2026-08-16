# WF-6A Slice 5 Evidence — FINAL WAVE verification (Issue 20 FIX + QC)

**Unit:** WF-6A (Issue 20 — Progress Visibility + Session Health)
**Slice:** 5 (FIX verification: boss --check statusline check CLEAN, both stores carry the key)
**Date:** 2026-08-16
**Branch:** fix/20-statusline @ 797bcff (FIX-LEDGER: WAVE 5 CLOSED + PART 3 merge record)
**Ledger line:** WAVE 6 DISPATCH 2026-08-16T22:06Z (FIX-LEDGER.md line 139)

---

## 1. What this slice verifies

Spec PART 4 check 8 (STATUSLINE, spec lines 545, 551-553): after Wave 6, the
statusLine key must be present in BOTH settings stores (name-only check, never
reading values). Missing after Wave 6 without a `STATUSLINE-REMOVED-<reason>`
ledger line = violation. This slice runs the boss --check and proves the
statusline check is CLEAN. The run closes after this — final wave.

## 2. Boss --check run (the instrument, live)

Command (absolute, from the boss's install path):

```
cd /Users/blackceomacmini/work-999-setup && ./tools/boss-cron --check
```

Full output:

```
boss-cron --check: 8 violation(s)
  - width: width: wave 6 dispatch below scripted width or missing justification: - `WAVE 6 DISPATCH 2026-08-16T22:06Z: WF-6A ...
  - scope: - `MERGED: fix/4-mode 2026-08-16: serial merge unit WF-2B ...
  - scope: - `MERGED: fix/6-design-brief 2026-08-16: serial merge unit WF-3A ...
  - scope: - `MERGED: fix/13-anti-drift 2026-08-16: serial merge unit WF-4A ...
  - scope: - `MERGED: fix/17-qc-protocol 2026-08-16: serial merge unit WF-4D ...
  - scope: - `MERGED 2026-08-16T22:05Z: PART 3 batch merge complete — all 19 fix branches landed on main serially ...
  - drift: wave 6 dispatched with no anchor.sh --mode reconcile (RECONCILE/RE-ANCHOR) line after WAVE 5 CLOSED — wave boundary reconcile never recorded
  - stop file active on workstream: boss-cron-20260816: scope: - `MERGED: fix/1-verification 2026-08-16: serial merg ...
checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,stages,entry-mode,statusline,research
EXIT=2
```

### Finding: zero statusline violations

- The checks line names `statusline` among the 16 checks run
  (caps,census,width,wavelock,claims,beat,stop,scope,kill,count,drift,orphan,
  stages,entry-mode,statusline,research).
- ALL 8 violations are width (1), scope (5), drift (1), stop (1) — pre-existing
  classes carried from the WAVE 6 DISPATCH and the PART 3 merge record
  (FIX-LEDGER.md lines 135-139: the 22:04Z/22:07Z VIOLATION cycles). None is a
  statusline finding.
- Per the check implementation (`/Users/blackceomacmini/work-999-setup/tools/boss-cron`
  lines 940-955): `check_statusline` returns a violation ONLY when
  `_settings_have_statusline()` is false — i.e. when "statusLine" is missing
  from either store. No such finding appears in the 8; the statusline check is
  CLEAN.

## 3. Both stores carry the key (the check's subject, independently verified)

Both live operator-box stores, read directly (JSON parse, name-only — values
shown only to prove shape, never judged):

```
/Users/blackceomacmini/.claude/settings.json        -> statusLine present: True
  shape: {"type": "command", "command": "/Users/blackceomacmini/.claude/statusline-command.sh"}
/Users/blackceomacmini/.claude-nine/settings.json  -> statusLine present: True
  shape: {"type": "command", "command": "/Users/blackceomacmini/.claude/statusline-command.sh"}
```

Both stores reference the same shared script, satisfying Issue 20 FIX item 3
(both-stores rule, one shared script — spec lines 442-443).

Shared script on disk, executable, content checks out:

```
-rwxr-xr-x  1 blackceomacmini  staff  5806 Aug 16 12:04 /Users/blackceomacmini/.claude/statusline-command.sh
```

Header (lines 1-10): `#!/usr/bin/env bash`, comment states the client-facing
display contract (model, derived session cost, git branch/status, Project
progress, Wave progress; context usage and 5h/7d rates INTERNAL, never client
display; "Never invents a number; never prints secrets"), `set -uo pipefail`.
Body reads stdin JSON (model.display_name, context_window token counts for the
cost derivation, cwd) — matching Issue 20 FIX items 4 and 13/14.

## 4. Check wiring confirmed in the boss script (source lines)

`/Users/blackceomacmini/work-999-setup/tools/boss-cron` (the live boss at the
install path — /Users/blackceomacmini/work-999-setup/tools/boss-cron):
- Line 27: check 8 documented in the header — "STATUSLINE — statusLine key
  present in BOTH settings stores (name-only check, never reading values) after
  Wave 6 = clean; missing after Wave 6 without a STATUSLINE-REMOVED-<reason>
  ledger line = violation".
- Lines 89-92: SETTINGS_STORES = ~/.claude/settings.json, ~/.claude-nine/settings.json.
- Lines 922-938: `_settings_have_statusline()` — name-only `"statusLine" in data`
  per store; all() gates the verdict.
- Lines 940-955: `check_statusline()` — gated on a `WAVE 6 (DISPATCH|REDISPATCH)`
  ledger line (present: FIX-LEDGER.md line 139); `STATUSLINE-REMOVED-<reason>`
  exemption (none in the ledger); violation only on a missing key.
- Line 1083: `violations.extend(f"statusline: {v}" for v in check_statusline(lines))`
  — the check runs every cycle, including --check.

## 5. Known-good control (the check is live, not a dead path)

- The statusline check DID execute this cycle: the run output's `checks run:`
  line names `statusline` (printed by the same dry-run block that ran all 16
  checks).
- The check is NOT vacuous on the missing-key side: `_settings_have_statusline`
  returns False for a missing file or missing key (lines 926-938), and the
  violation branch (lines 950-954) names the offending store(s). A
  control-by-construction: with either store stripped of the key, check_statusline
  would emit `statusline: statusLine key missing after Wave 6 in <store>`.
- The ledger carries the wave-6 gate line the check requires (FIX-LEDGER.md
  line 139, WAVE 6 DISPATCH 2026-08-16T22:06Z) — the check is armed, not skipped.
- No `STATUSLINE-REMOVED-<reason>` line exists in the ledger (checked via
  grep for STATUSLINE over /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md:
  only the wave-table row line 19 and the dispatch line 139 match; neither is a
  removal line), so the exemption path did not silently clear the check.

## 6. Scope discipline

- Touched ONLY: this evidence file (holding/WF-6A-slice5-evidence.md). No
  settings files, no ledger, no boss script, no repo code were modified.
- Both settings stores were READ (JSON parse) and left untouched.
- Clean tree before and after: `git status` clean, 0 untracked files.
- Previous slice evidence already committed on this branch (holding/ tree,
  153 tracked files incl. prior WF-* slice evidence); this file is the slice-5
  evidence commit per one-unit-one-commit.

## 7. Verdict

VERDICT: DONE — boss --check ran one full cycle; the statusline check is CLEAN
(zero statusline findings among the 8 non-statusline violations); both settings
stores carry the statusLine key referencing the shared
~/.claude/statusline-command.sh script; the check wiring is live in the boss
(lines 27, 89-92, 922-955, 1083); the check is armed by the WAVE 6 DISPATCH
ledger line. The 8 violations (width, scope x5, drift, stop) are pre-existing
classes recorded in the ledger before this slice and are NOT in this slice's
scope. Wave 6 close may now proceed.
