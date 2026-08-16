# WF-4B slice 3 evidence — Issue 14 FIX step 3: boss cron width check (enforcement)

Wave: WAVE 4, WF-4B (Issue 14 fan-out). Branch: fix/14-fanout.
Slice: FIX step 3 — "Enforcement: the boss cron checks fan-out per cycle — fan-out below
scripted width without a recorded dependency line is a violation (PART 4)."
Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (real ledger
/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70).

## Spec citation (authoritative text)

- Spec line 307 (Issue 14 FIX step 3): "Enforcement: the boss cron checks fan-out per
  cycle — fan-out below scripted width without a recorded dependency line is a violation
  (PART 4)."
- Spec line 541 (PART 4 check 4): "Width check: fan-out below scripted width (10 per
  workflow, pairs of five; up to 50 workflows — operator doctrine, not a product limit)
  without a recorded dependency line = violation. Padding past the work = violation."
- Spec line 305 (FIX step 1): max 10 agents per workflow (5 builders + 5 blind critics),
  max 50 workflows.
- Spec line 306 (FIX step 2): never dispatch fewer streams than the work allows, and
  never pad (TIMIDITY and PADDING).

## Defect found (full-file read, not grep)

The interim boss script lives at /Users/blackceomacmini/work-999-setup/tools/boss-cron
(installed per ISSUE-18-EARLY ledger line, spec WAVE 0 BOOTSTRAP). Its check_width()
(lines 167-189 of the live script) was structurally dead and incomplete:

1. DEAD DISPATCH DETECTION — check_width matched dispatch lines via
   `"DISPATCH" in ledger_class(ln)`. ledger_class() on a "WAVE 4 DISPATCH ..." line
   returns "WAVE" (first token after "- `"), so the width check NEVER fired on real
   wave-dispatch lines. Verified by direct call: ledger_class returns "WAVE" for
   "WAVE 4 DISPATCH ..." lines. The check was vacuous-pass on every real ledger.
2. BROKEN WORKFLOW NEEDLE — `named = all(f"WF-{wave}{wf[3:]}" in ln for wf in wfs)`:
   for wf = "WF-4A", wf[3:] = "4A", building the needle "WF-44A" — never present in any
   ledger line. The full-width "all workflows named" test could never pass. Verified by
   direct call: all five needles "WF-44A".."WF-44E" returned False on a line that names
   all five workflows.
3. NO DEPENDENCY-LINE ESCAPE — Issue 14 FIX step 3 / PART 4 check 4 require a fan-out
   below scripted width to be legal when a dependency line is recorded. The old code had
   no dependency escape (docstring claimed one; the code had none).
4. NO PADDING CLAUSE — PART 4 check 4: "Padding past the work = violation." The old
   code had no padding detection at all.

## Change applied (one unit)

File added: tools/boss-cron in the WF-4B working copy (branch fix/14-fanout, base
dc688c7 = origin/main). The repo does NOT track tools/ — `git ls-files` over the live
repo shows no tools/ paths; the interim boss is untracked working-copy state. This unit
is the first to bring tools/boss-cron into the repository (the batch merge lands it),
base = live script byte-identical (sha256 c42a64ee509cb5ae5646eea0370a02a07749670b),
then the width check upgraded:

1. Dispatch detection: class guard `cls == "WAVE"` (wave-dispatch lines read
   "WAVE N DISPATCH/REDISPATCH ...") + "DISPATCH" in the raw line. Result lines ending
   "Cites WAVE 3 REDISPATCH" have a different class and are excluded — verified no false
   positive on real ledger lines.
2. Workflow needle: `named = all(wf in ln for wf in wfs)` — correct substring check.
3. Dependency escape: `DEPENDENCY` token or `NEW-WAVE-N` on the dispatch line makes an
   under-width dispatch legal (Issue 14 FIX step 3 / PART 4 check 4).
4. Padding clause: "padded" or "padding past the work" (case-insensitive) on the
   dispatch line = violation, reported as width padding violation.
5. Resolution rule preserved: latest dispatch line per wave wins; a historical
   under-width line superseded by a later full-width redispatch is not re-fired.

Only check_width and its two docstring blocks changed — diff vs backup
(holding/boss-cron.bak-pre-slice3-width-check) shows exactly that, nothing else.

## Backup

holding/boss-cron.bak-pre-slice3-width-check (sha256 c42a64ee..., byte-identical to the
live script at backup time). Live script /Users/blackceomacmini/work-999-setup/tools/
boss-cron left untouched (sha256 re-verified c42a64ee after the edit).

## Verification (each result independently produced)

1. python3 -m py_compile tools/boss-cron — OK.
2. Real-ledger dry run: `python3 tools/boss-cron --check` against the live FIX-LEDGER.md
   (path constant in the script): 0 violations, exit 0 — no false positive on the real
   ledger, including the 12 real dispatch lines and the "Cites WAVE N REDISPATCH" result
   lines.
3. Unit suite (7 cases, synthetic lines in the real ledger dialect):
   - full width + justification -> clean (0 violations)
   - under width, no dependency -> VIOLATION (1)
   - under width + DEPENDENCY: line -> clean (Issue 14 escape works)
   - under width + NEW-WAVE-6 line -> clean
   - "padded" admission -> VIOLATION
   - "Padding past the work" -> VIOLATION
   - historical under-width superseded by later full redispatch -> clean
   ALL PASS.
4. Enforcement proof (stop authority): temp ledger with a violating under-width
   dispatch, full main() via --check -> exit code 2 (governance-exit contract per PART 4:
   exit 2 = stop). Clean temp ledger -> exit 0. Both proven.
5. Live-boss isolation: /Users/blackceomacmini/work-999-setup/tools/boss-cron sha
   unchanged (c42a64ee) — the running cron is untouched by this unit; WF-4E owns the
   live upgrade path, this unit owns the repo copy + Issue 14 width contract.

## Scope discipline

Touched ONLY tools/boss-cron in this clone (added). No SKILL.md, no references, no
other tool. Slice 2 (forced-width doctrine, commit 20b1cc5) and slice 4 (provider
ceilings) own their own files. WF-4E owns the full 8-check boss upgrade — this unit
does not restructure main(), checks 1-2 and 5-8, or the live install.
