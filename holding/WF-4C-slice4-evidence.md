# WF-4C slice 4 evidence — boss-cron locked-table wave check (Issue 15 FIX step 5)

**Slice:** WF-4C slice 4 (Issue 15 FIX step 5)
**Branch:** fix/15-wave-lock
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, ISSUE 15 FIX step 5 (line 326) + PART 4 check 2 (line 539)

## What the slice names

ISSUE 15 FIX step 5 (spec line 326):
> "Boss-cron check: waves found in the ledger that are not in the locked table and carry no `NEW-WAVE-N` dependency line = `VIOLATION-STOP`."

PART 4 check 2 (spec line 539):
> "Wave check: any wave in the ledger not in the locked table (PART 2) without a `NEW-WAVE-N` dependency line = violation."

## Change

**File:** `tools/boss-cron` — commit e56d374 on fix/15-wave-lock, message cites `WAVE 4 DISPATCH 2026-08-16T20:12Z`. Single unit = single commit (commit rule, PART 2.1 item 2).

Base: live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (backed up to `/Users/blackceomacmini/work-999-setup/tools/boss-cron.bak-wf4c-slice4` before copying, PART 5 rule 4). tools/ is untracked in the repo (verified: `git ls-files tools/` empty in live repo) — committed as a new file on the fix branch, same pattern as WF-3E slice 3 (commit 269ccba) and WF-3C slice 5 (commit 97e3d06).

### Added: `check_locked_table(lines)` — PART 4 check 2 / ISSUE 15 FIX step 5

Wired into `main()` as `lock-table:` violations (line 334), surfaced as `VIOLATION-STOP` by the existing machinery (main() appends VIOLATION-STOP lines for every violation, writes the stop file, exits 2 — lines 315-327). Checks string extended with `locktable` (line 357). Docstring check list gains 4b (lines 11-14).

The check:

1. Collects waves found in the ledger — only from wave-opening lines: `DISPATCH`/`REDISPATCH`/`CLOSED` ledger lines and `## WAVE <n>` section headings. Prose citations ("WAVE 7" inside a VIOLATION-STOP finding or a spec quote) are evidence, not openings — they do not count as a wave present.
2. Collects dependency lines: a ledger line whose class IS the wave name (`NEW-WAVE-N` or `NEW-WAVE-<n>` as the class token) opens wave n. `NEW-WAVE-7` cited inside a finding is not an opening.
3. Violation: wave w present in the ledger, not in the locked table, and no `NEW-WAVE-<w>` opening line → `lock-table: wave <w> in ledger not in locked table and no NEW-WAVE-<w> dependency line: <line>`.

Locked table semantics: `LOCKED_WAVES` (lines 49-56) holds wave -> workflow-count rows for waves 1-6. PART 2 also locks WAVE 0 (boss bootstrap row, Issue 18 WAVE 0 BOOTSTRAP, spec line 506) — it carries no workflows so it is absent from the dict; the check treats wave 0 as locked (comment at lines 176-179). A wave 0 mention is not a violation.

### Tests — 7/7 pass

`holding/test-lock-table.py` (SourceFileLoader against the committed file, same harness pattern as WF-3E slice 3):

| Test | Scenario | Result |
|---|---|---|
| T1 | locked waves 1-6 DISPATCH only | clean |
| T2 | wave 0 mention (boss bootstrap) | clean — wave 0 locked |
| T3 | wave 7 DISPATCH, no NEW-WAVE-7 line | violation "wave 7 in ledger not in locked table" |
| T4 | wave 7 DISPATCH + NEW-WAVE-7 opening naming dependency | clean |
| T5 | wave 8 DISPATCH + only a NEW-WAVE-7 line | violation (line number must match) |
| T6 | bare `NEW-WAVE-N` class line + wave 9 DISPATCH | violation (class name alone opens nothing) |
| T7 | VIOLATION-STOP line citing "NEW-WAVE-7" + wave 7 DISPATCH | violation (citations are not openings) |

### Live dry cycle against the real ledger

```
$ python3 tools/boss-cron --check
boss-cron --check: 0 violation(s)
checks run: caps,census,width,wavelock,locktable,wavegrowth,claims,beat,stop,scope,kill
EXIT: 0
```

No false positives on the live ledger (waves 0-6 all in the locked table; wave-growth check present from sibling slice 2 of this workflow). Negative control: the wave-0 false positive was caught and fixed (wave 0 added to the locked set) before the final run.

### Verification of the commit

- `git show e56d374 --stat`: 1 file changed, `tools/boss-cron` only (382 insertions, mode 100755).
- `git show e56d374:tools/boss-cron` byte-identical to the tested file (diff empty).
- Commit message cites the ledger line: `boss-cron: locked-table wave check — ledger wave not in locked table without NEW-WAVE-N dependency line = VIOLATION-STOP (Issue 15 FIX step 5, WAVE 4 DISPATCH 2026-08-16T20:12Z)`.

### Scope

Only `tools/boss-cron` in the committed unit. Working-tree files belonging to sibling slices (SKILL.md FIX step 1 changes, slice 1/2 evidence, backups) left uncommitted and untouched. Backup of the pre-edit live boss-cron at `/Users/blackceomacmini/work-999-setup/tools/boss-cron.bak-wf4c-slice4`.
