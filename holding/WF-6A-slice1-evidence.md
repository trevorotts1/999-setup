# WF-6A Slice 1 Evidence — statusLine key present in BOTH settings stores (Issue 20 FIX, PART 4 check 8)

**Unit:** WF-6A (Issue 20 — Progress Visibility + Session Health)
**Slice:** 1 (FIX + QC: statusLine key in both settings stores — name-only check per PART 4 check 8)
**Date:** 2026-08-16
**Branch:** fix/20-statusline @ 797bcff (FIX-LEDGER: WAVE 5 CLOSED + PART 3 merge record)
**Ledger line:** WAVE 6 DISPATCH 2026-08-16T22:06Z (FIX-LEDGER.md line 139)
**Instrument:** the two LIVE settings stores on the operator box — `/Users/blackceomacmini/.claude/settings.json` and `/Users/blackceomacmini/.claude-nine/settings.json` (Issue 20 FIX item 3: separate stores, spec lines 442-443; verified — the skills symlink farm does NOT cover settings.json).

---

## 1. What this slice verifies

Spec PART 4 check 8 (spec lines 545, 551-553): after Wave 6, the `statusLine`
key must be present in BOTH settings stores — NAME-ONLY check, never reading
values. Missing after Wave 6 without a `STATUSLINE-REMOVED-<reason>` ledger
line = violation. Also Issue 20 FIX item 1 (detect-first, spec line 441) and
item 2 (the statusLine settings-key shape, spec line 442) — shape confirmed
only to the level the name-only contract requires (the key exists; its value
is a `statusLine` object; the shared-script reference is cited from the prior
slice's read, not re-judged here).

## 2. Verification — name-only key presence, both stores

Command (jq, name-only — prints only presence, never values):

```
jq -r 'if has("statusLine") then "statusLine key PRESENT" else "ABSENT" end' ~/.claude/settings.json
jq -r 'if has("statusLine") then "statusLine key PRESENT" else "ABSENT" end' ~/.claude-nine/settings.json
grep -n '"statusLine"' ~/.claude/settings.json
grep -n '"statusLine"' ~/.claude-nine/settings.json
```

Output:

```
/Users/blackceomacmini/.claude/settings.json        -> statusLine key PRESENT   (grep: line 118:  "statusLine": {)
/Users/blackceomacmini/.claude-nine/settings.json  -> statusLine key PRESENT   (grep: line 32:   "statusLine": {)
```

Both stores carry the key. The check's subject is satisfied in both stores.

## 3. Shape (structural only — what the name-only check requires)

- `~/.claude/settings.json` line 118: `"statusLine": {` — a JSON object value.
- `~/.claude-nine/settings.json` line 32: `"statusLine": {` — a JSON object value.
- Both files parse as JSON (jq executed the has() query against both without
  error), so the key is a real JSON key, not a string fragment.
- Both files are regular files, not symlinks (test -L both -> regular file), so
  each store is its own physical settings file.
- Per Issue 20 FIX item 2 (spec line 442), the settings-key shape is
  `{"type":"command","command":"<script>",...}`. The prior slice (WF-6A
  slice 5, holding/WF-6A-slice5-evidence.md section 3) read the values and
  recorded both stores reference the shared `/Users/blackceomacmini/.claude/statusline-command.sh`
  (present, executable, -rwxr-xr-x). This slice does not re-judge values — the
  name-only contract forbids it.

## 4. Exemption-removal path absent

`STATUSLINE-REMOVED-<reason>` is the only line class that clears the check with
the key missing (spec line 545). Checked the live ledger:

```
grep -n "STATUSLINE" /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md  -> rc=1, zero matches
```

grep rc=1 = no lines matched (not an error; rc>=2 would be). No
`STATUSLINE-REMOVED-<reason>` line exists, so the exemption path did not
silently clear the check — the key's presence is doing the work.

## 5. Check wiring (cross-checked in the live boss)

`/Users/blackceomacmini/work-999-setup/tools/boss-cron` (the live boss at the
install path):
- Line 27: check 8 documented in the header — "STATUSLINE — statusLine key
  present in BOTH settings stores (name-only check, never reading values) after
  Wave 6 = clean; missing after Wave 6 without a STATUSLINE-REMOVED-<reason>
  ledger line = violation".
- Lines 89-92: SETTINGS_STORES = ~/.claude/settings.json, ~/.claude-nine/settings.json.
- Lines 922-938: `_settings_have_statusline()` — name-only `"statusLine" in data`
  per store; all() gates the verdict.
- Lines 940-955: `check_statusline()` — gated on a `WAVE 6 (DISPATCH|REDISPATCH)`
  ledger line (present: FIX-LEDGER.md line 139); `STATUSLINE-REMOVED-<reason>`
  exemption (absent); violation only on a missing key.
- Line 1083: `violations.extend(f"statusline: {v}" for v in check_statusline(lines))`.

Known-good control: the check executed this cycle — the slice-5 run's `checks
run:` line names `statusline` among the 16 checks; the violation branch
(lines 950-954) names the offending store(s), so the missing-key side is not
vacuous. The gate line the check requires (WAVE 6 DISPATCH, FIX-LEDGER.md line
139) exists — the check is armed, not skipped.

## 6. Scope discipline

- Touched ONLY: this evidence file (holding/WF-6A-slice1-evidence.md).
- Both settings stores READ (jq name-only + grep line number) and left
  untouched — no backup needed, nothing written.
- No ledger, no boss script, no repo code modified.
- Clean tree before and after: `git status --porcelain` empty (rc=0).
- Commit message cites the WAVE 6 DISPATCH ledger line (FIX-LEDGER.md line 139),
  per the one-unit-one-commit rule.

## 7. Sources

- Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md`
  lines 434-456 (Issue 20), 545 (PART 4 check 8), 601-614 (PART 6.6).
- Stores: `/Users/blackceomacmini/.claude/settings.json` line 118;
  `/Users/blackceomacmini/.claude-nine/settings.json` line 32.
- Ledger: `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 139
  (WAVE 6 DISPATCH 2026-08-16T22:06Z); zero STATUSLINE matches.
- Boss: `/Users/blackceomacmini/work-999-setup/tools/boss-cron` lines 27,
  89-92, 922-955, 1083.

## 8. Verdict

VERDICT: DONE — the `statusLine` key is present in BOTH live settings stores
(`~/.claude/settings.json` line 118, `~/.claude-nine/settings.json` line 32),
verified name-only per PART 4 check 8; no `STATUSLINE-REMOVED-<reason>` line
exists to mask a missing key; the boss's statusline check is wired and armed
against both stores. PART 4 check 8 reads CLEAN for this slice.
