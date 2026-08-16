# WF-4C slice 6 evidence — Issue 15 FIX step 6: verification — undocumented wave 6 stopped within one boss cycle

**Slice:** WF-4C slice 6 (Issue 15 FIX step 6 — verification)
**Branch:** fix/15-wave-lock
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 15 FIX step 6 (line 327) + QC (line 329) + PART 4 check 2 (line 539) + PART 5 (lines 570-577)

## 1. Spec read — what this slice must prove

- Spec line 327 (FIX step 6): "Verification: a test run attempting an undocumented wave 6 is stopped within one boss cycle."
- Spec line 329 (QC bar): "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."
- Spec line 539 (PART 4 check 2): "Wave check: any wave in the ledger not in the locked table without a `NEW-WAVE-N` dependency line = violation."
- Spec line 317 (PROBLEM): "planned at 5 waves, found at 15 hours later" — the drift scenario: a run whose plan locked at 5 waves, then a 6th appears undocumented. The bar is: that 6th wave is STOPPED within one boss cycle.

## 2. Test target

`tools/boss-cron` at commit `e56d374` on fix/15-wave-lock (Issue 15 FIX step 5's locked-table wave check, `check_locked_table`, wired as `lock-table:` violations; VIOLATION-STOP machinery + stop file + exit 2). The test exercised the FULL boss main() cycle (non-dry): violation -> VIOLATION-STOP line appended to the ledger + stop file written + exit 2; clean -> BOSSCYCLE-CLEAN + exit 0.

Also tested the worktree state (includes sibling slice 2's uncommitted `check_wave_growth`); the scope defect below reproduces in BOTH the committed and worktree code.

## 3. Finding F-1 (found by this verification) — documented wave 6 falsely VIOLATION-STOPPED by scope check

The verification's documented-growth scenario (wave 6 opened by a valid `NEW-WAVE-6` dependency line) failed: exit 2, `scope:` violation on the `NEW-WAVE-6` line.

Root cause, proven by direct analysis of tools/boss-cron at e56d374:
- `SANCTIONED_CLASSES` (line 64-70) contains only the literal `"NEW-WAVE-N"` — not the concrete `NEW-WAVE-<n>` class a real opening line carries.
- `check_scope` (line 269-280) exemptions: `SANCTIONED_CLASSES`, `WF_PREFIX` (`^WF-\d[A-Z]? `), `^WF-\d[A-Z]$`, `^WAVE$`, trailing-colon classes. `NEW-WAVE-6` matches none — checked each exemption explicitly:
  - `NEW-WAVE-6` in SANCTIONED: False
  - WF_PREFIX match: False
  - `^WF-\d[A-Z]$` match: False
  - `^WAVE$` match: False
  - ends-with-colon escape: False (class has no colon)
- `check_locked_table` (line 171-213) treats a `NEW-WAVE-<n>` class line as the dependency opening (line 195-207: `re.match(r"^NEW-WAVE-\d+$", toks[0].rstrip(":"))` adds wave n to `deps`). So the growth path's own opening line is simultaneously the check's dependency evidence AND a scope violation. Any documented wave — exactly the sanctioned growth the QC bar requires — trips the scope check and is VIOLATION-STOPPED.

Spec authority that this is a defect: spec line 323 names the opening line class as `NEW-WAVE-N` (placeholder); PART 4 check 2 (line 539) requires "without a `NEW-WAVE-N` dependency line" to be the ONLY basis for the violation — a present dependency line must NOT be flagged. Slice 4's own T4 test (holding/test-lock-table.py) asserts the intent: a `NEW-WAVE-7` opening line + wave 7 DISPATCH = clean.

### Fix (this slice's only touch)

File: `tools/boss-cron` (worktree on fix/15-wave-lock). Two additions:
1. New module constant after `WF_PREFIX` (line 71): `NEW_WAVE_CLASS_RE = re.compile(r"^NEW-WAVE-\d+$")` — sanctions concrete opening lines.
2. `check_scope` gains the exemption before the wave checks (after the SANCTIONED/WF_PREFIX continue):
```python
        if NEW_WAVE_CLASS_RE.match(cls):
            continue
```

Backup before edit: `holding/boss-cron.bak-pre-slice6-scope` (sha256 `4711ba872f8a58fd51eb29c12b7992df6886462380cf149bbeaba6860561cf30`, byte-identical to the pre-edit worktree file).

Edit is purely additive: adds a class regex + one exemption. Verified: `python3 -c "import ast"` syntax OK; slice 4's 7/7 unit tests still pass against the edited file; scope now clean on both `NEW-WAVE-6` and `NEW-WAVE-N` lines.

## 4. The verification — full boss cycle, end-to-end (after fix)

Instrument: `holding/wave6-test/run-cycles.py` — exec's the boss source into a namespace, patches `LEDGER`/`STOP`/`PIDS` to temp paths per run (the script's real constants are absolute; the harness never touches the live ledger, live stop file, or live pids file), sets `LOCKED_WAVES` to a 5-wave table (the drift scenario: this run's plan locked at 5 waves), and calls `main()` with `sys.argv=["boss-cron"]` (non-dry — the real cycle path that appends to the ledger and writes the stop file). Stop-file path is isolated per scenario so one scenario's stop file never bleeds into the next (a shared-stop-path harness artifact would surface as a spurious "stop file active" violation on the following scenario).

| Scenario | Fixture | Exit | VIOLATION-STOP | Stop file | Result |
|---|---|---|---|---|---|
| S1 clean (waves 1-5, WAVE 5 CLOSED) | fixtures/s1-clean.md + WAVE 5 CLOSED | 0 | 0 | no | BOSSCYCLE-CLEAN — clean cycle |
| S2 undocumented wave 6 (dispatch + `## WAVE 6` section, no NEW-WAVE-6 line) | s1 + WAVE 5 CLOSED + WAVE 6 section | 2 | 1 | yes | `lock-table: wave 6 in ledger not in locked table and no NEW-WAVE-6 dependency line` — THE BAR |
| S3 documented wave 6 (`NEW-WAVE-6` line naming dependency + dispatch) | s1 + WAVE 5 CLOSED + NEW-WAVE-6 + dispatch | 0 | 0 | no | BOSSCYCLE-CLEAN — sanctioned growth allowed |

Exact S2 VIOLATION-STOP line appended by the boss cycle (verbatim from the committed test output, holding/wave6-test/cycles-output.txt, run 2026-08-16T20:54:18Z):
```
- `VIOLATION-STOP 2026-08-16T20:54:18Z: lock-table: wave 6 in ledger not in locked table and no NEW-WAVE-6 dependency line: - `WAVE 6 DISPATCH 2026-08-16T21:40Z: undocumented wave 6 attempt. Census be...` — conductor MUST TaskStop the named workstream and re-dispatch from its last clean checkpoint`
```

Before the F-1 fix, the documented-wave-6 run failed with `scope: - `NEW-WAVE-6 ...`` VIOLATION-STOP (exit 2; captured at 2026-08-16T20:50:25Z in the pre-fix cycles-output run — a shared-stop-path harness artifact added a second spurious VIOLATION-STOP on that run; the scope finding itself is independent and reproduces with isolated paths). After the fix, S3 exits 0. This is the proof that F-1's fix restored the documented-growth path while keeping the undocumented path stopped.

### Supplementary scenarios (against the committed 6-wave table — the FIX EXECUTION's own table)

| Scenario | Exit | VIOLATION-STOP | Result |
|---|---|---|---|
| S4 undocumented wave 7 vs committed 6-wave table | 2 | 1 | `lock-table: wave 7 in ledger not in locked table and no NEW-WAVE-7 dependency line` — undocumented growth stopped |
| S5 documented wave 7 (`NEW-WAVE-7` naming wave 6's output) vs committed 6-wave table | 0 | 0 | sanctioned growth allowed |
| S6 literal `NEW-WAVE-N` class line (no number) + wave 6 dispatch | 2 | 1 | `lock-table` violation — bare placeholder class opens no wave (matches slice 4's T6 intent: class name alone opens nothing; spec's `N` is a placeholder for the number) |

## 5. Controls and cross-checks (PART 5)

- Known-good control: live boss `boss-cron --check` on the real ledger returns 0 violations, exit 0 (run 2026-08-16T20:50Z). Same instrument, same code path, answer known non-empty — proves the harness discriminates (clean cycle passes, seeded violation fails).
- Slice 4's 7 unit tests (holding/test-lock-table.py) re-run against the edited file: 7 passed, 0 failed — the F-1 fix breaks nothing in the sibling slice's coverage.
- Sibling slice 2's `check_wave_growth` (worktree, uncommitted) — F-1 reproduces in the worktree boss too (run 2026-08-16T20:51:07Z: scope VIOLATION-STOP on NEW-WAVE-6 with slice 2's code present), so the defect is not an artifact of the committed-vs-worktree split; the fix here resolves it for both.
- All fixture ledgers, harness, and raw outputs preserved: `holding/wave6-test/` (make-fixtures.py, run-cycles.py, boss-under-test.py, fixtures/, cycles-output.txt).
- Not checked: the live deployed boss-cron at /Users/blackceomacmini/work-999-setup/tools/boss-cron still lacks check_locked_table entirely (verified: grep count 0) — the live copy is Wave 0 interim and is WF-4E's jurisdiction to sync; the merged branch is the deliverable this verification tests. UNDETERMINED on live sync timing.

## 6. QC bar mapping (spec line 329)

- "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines" — S2/S4 prove undocumented waves STOP within one boss cycle (VIOLATION-STOP appended, stop file written, exit 2); S3/S5 prove waves with valid dependency lines pass. F-1's fix made the second half true.
- "all four documents render the same table" — covered by sibling slices 1/3 (SKILL.md step 16 lock + one-source-render references); not this slice's scope.
- PART 5 rule 1 (verify before reporting): every claim above is a direct run output captured in the test transcripts; no relayed claims.

## 7. Scope discipline

Touched by this unit: `tools/boss-cron` only (the F-1 fix, 4 lines + comment). Evidence + fixtures live under holding/. Backups: holding/boss-cron.bak-pre-slice6-scope. No other file touched. The sibling slices' uncommitted work (slice 2's check_wave_growth in the worktree boss, slice 1/2 evidence edits) left as found.
