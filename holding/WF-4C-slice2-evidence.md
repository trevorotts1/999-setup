# WF-4C slice 2 evidence — Issue 15 FIX step 2: growth only via dependency lines

**Slice:** WF-4C slice 2 (Issue 15 FIX step 2 — growth-only wave doctrine, wired into skill + boss cron)
**Branch:** fix/15-wave-lock
**Ledger line cited:** `WAVE 4 DISPATCH 2026-08-16T20:12Z` (FIX-LEDGER.md line 70, commit dc688c7)
**Spec:** /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md

## 1. Spec read — Issue 15 FIX step 2

- Spec line 323 (FIX step 2): "Growth only via dependency lines: a new wave exists ONLY when a documented dependency requires it, opened by a `NEW-WAVE-N` ledger line naming the dependency (which wave's output the new wave consumes). Any other new wave is a violation."
- Spec line 326 (FIX step 5): "Boss-cron check: waves found in the ledger that are not in the locked table and carry no `NEW-WAVE-N` dependency line = `VIOLATION-STOP`."
- Spec PART 2 line 498: "THE WAVE PLAN IS LOCKED. Six waves. Additional waves ONLY if one wave depends on another being done first, opened via a documented `NEW-WAVE-N` ledger line naming the dependency."
- Spec PART 4 check 2 (line 542): "Wave check: any wave in the ledger not in the locked table (PART 2) without a `NEW-WAVE-N` dependency line = violation."
- Spec line 317 (PROBLEM): "planned at 5 waves, found at 15 hours later."
- Spec line 329 (QC bar): "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."

## 2. What the slice names

Issue 15 FIX step 2 — wire the growth-only doctrine into:
1. **The skill** (`.claude/skills/spec-protocol/SKILL.md`, step 16 LOCK THE WAVE TABLE block)
2. **The boss cron** (`tools/boss-cron`, the per-cycle enforcement the skill teaches)

## 3. Change 1 — SKILL.md step 16 block: the opening line must NAME the dependency

File: `.claude/skills/spec-protocol/SKILL.md`

Added 8 lines to the LOCK THE WAVE TABLE block (inserted after the boss-cron wave-check sentence, lines 1127-1134 of the edited file):

> **The opening line must NAME the dependency (binding — a gate that names nothing gates nothing).** A bare `NEW-WAVE-N: wave N opened` line is NOT a valid opening: the line must name which wave's output the new wave consumes ("NEW-WAVE-7: consumes wave 6's output — <what the new wave needs>"), and the named wave must be a LOWER wave than the one being opened — a new wave consumes output that already exists, never output that has not been produced. The boss-cron growth check (PART 4 check 2) flags any `NEW-WAVE-N` line that names no dependency or names its own/later wave.

This closes the gap between the generic rule (slice 1 wrote "naming which wave's output it consumes") and the enforceable mechanic: the boss check must validate the NAMING, and the skill now teaches exactly what the boss validates.

## 4. Change 2 — tools/boss-cron: check_wave_growth

File: `tools/boss-cron` (working-copy copy of the live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` base; the live repo tracks no tools/, so the clone carries it until the merge train syncs)

Added:
- `NEW_WAVE_RE = re.compile(r"NEW-WAVE-(\d+)")` and `WAVE_REF_RE` (matches both "NEW-WAVE-6" and "wave 6"/"waves 5 and 6" in a line body)
- `NEW_WAVE_DEP_HINTS` — dependency phrasings that name what the new wave consumes ("consume", "depend", "dependency", "requires", "after", "output of", "output from", "feeds", "built on", "on top of", "post-", "outputs")
- `check_wave_growth(lines)` — every `NEW-WAVE-N` ledger line whose class token is the opening itself is validated:
  1. The line body must carry a dependency phrasing (bare "NEW-WAVE-7: wave 7 opened" = violation).
  2. The line must name a LOWER-numbered wave as the consumed dependency (naming its own wave, a later wave, or no wave at all = violation — a new wave consumes output that already exists, spec line 323: "which wave's output the new wave consumes").
  3. Lines where `NEW-WAVE-N` appears inside a VIOLATION-STOP finding or other class are evidence, not openings — skipped.
- Wired in `main()`: `violations.extend(f"wave-growth: {v}" for v in check_wave_growth(lines))`
- `checks` string extended: `caps,census,width,wavelock,locktable,wavegrowth,claims,beat,stop,scope,kill`

Division of labor with the concurrent WF-4E addition (`check_locked_table`, wired as `lock-table:`): that check catches a WAVE heading/dispatch NOT in the locked table with no NEW-WAVE-N line at all; `check_wave_growth` catches a NEW-WAVE-N line that is present but names no dependency (or the wrong wave). Both are PART 4 check 2; together they close both halves of the growth gate.

## 5. Verification — unit tests (23 cases, all PASS — corrected harness)

Instrument: python3 SourceFileLoader import of `tools/boss-cron` (`holding/test-lock-table.py`), calling `check_locked_table` and `check_wave_growth` directly.

**Correction (critic finding #1 upheld):** the original 16-case table used bare-body inputs (e.g. `NEW-WAVE-7: consumes the output of wave 6`) with no `- \`` ledger wrapper, so `check_wave_growth`'s `ln[3:]` class-token guard never saw `NEW-WAVE-7` as the class token and every violation case silently returned 0 — the table proved nothing. The harness was rebuilt so every input line is a REAL ledger line: `` - `CLASS <timestamp>: body` `` exactly as `ledger_lines()` feeds the checks. Each T-case below now runs the full wrapped line; the bare-body forms quoted in the prior table were instruments of the bug, not of the check.

With real-format lines the code flags every violation case (independent probe confirmed all 7 bad cases return violations). Re-run result: **23 passed, 0 failed** (7 locked-table cases L1-L7 + 16 growth cases T1-T16), exit 0.

| Case | Input line (real ledger format, wrapper elided for width) | Expected | Result |
|---|---|---|---|
| T1 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes the output of wave 6` | 0 violations | PASS |
| T2 | `NEW-WAVE-7 2026-08-17T09:00:00Z: opening wave 7` (bare) | 1 violation (names no dependency) | PASS |
| T3 | `VIOLATION-STOP 2026-08-17T09:30:00Z: wave 7 missing NEW-WAVE-7 line` | 0 violations (citation skip) | PASS |
| T4 | `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on wave 6 completing` | 0 violations | PASS |
| T5 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes wave 6 output` | 0 violations | PASS |
| T6 | empty ledger | 0 violations | PASS |
| T7 | `NEW-WAVE-7: 2026-08-17T09:00:00Z: just opening` (colon class token) | 1 violation | PASS |
| T8 | `NEW-WAVE-12 2026-08-17T09:00:00Z: requires wave 11 landed` | 0 violations | PASS |
| T9 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes wave 8` (later wave) | 1 violation | PASS |
| T10 | `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on wave 7` (own wave) | 1 violation | PASS |
| T11 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes the output of wave 7` | 1 violation | PASS |
| T12 | `NEW-WAVE-7 2026-08-17T09:00:00Z: depends on the merge train finishing` (no wave named) | 1 violation | PASS |
| T13 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes output of waves 5 and 6` (plural) | 0 violations | PASS |
| T14 | `NEW-WAVE-7 2026-08-17T09:00:00Z: consumes NEW-WAVE-6 output` | 0 violations | PASS |
| T15 | `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 opened, consumes wave 6` | 0 violations | PASS |
| T16 | `NEW-WAVE-7 2026-08-17T09:00:00Z: wave 7 added per the wave flag` (hint-like word, no dependency) | 1 violation | PASS |

## 6. Verification — integration on the live ledger (corrected)

`python3 tools/boss-cron --check` against the live `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md`:
- `wave-growth:` violations: **0** — no NEW-WAVE-N opening lines exist in the live ledger (grep count of `NEW-WAVE-[0-9]` in the live ledger = **0**, re-verified; the only `NEW-WAVE` text is the lock-rule sentence at line 21, the literal `NEW-WAVE-N` placeholder, not a numbered opening line; the class token guard skips it anyway). Live ledger currently has zero undocumented waves, consistent with the locked table.
- Total violations: **0**, exit code: **0** (governance-exit contract: exit 2 only on violation; clean run = 0).
- **Correction (critic finding #2 upheld):** the prior section 6 claimed exit 2 with 1 violation (a WF-4E `check_locked_table` false positive). That claim was wrong. The live-run facts now, independently re-run: 0 violations, exit 0. The earlier "1 violation" reading was not reproducible — WF-4E's locked-table check does not fire on the current live ledger, and no `NEW-WAVE-[0-9]` lines exist to trip wave-growth. The corrected claim is: clean run, 0 violations, exit 0, matching the observable state.

## 7. Scope discipline

Touched: `.claude/skills/spec-protocol/SKILL.md` (step 16 block only), `tools/boss-cron` (check_wave_growth + wiring + checks string). Nothing else. Backups:
- `holding/SKILL.md.bak-pre-wave-lock-slice2` (pre-edit copy)
- `holding/boss-cron.bak-pre-wave-lock-slice2` (pre-edit copy)

The tools/boss-cron file in this clone carries concurrent WF-4E additions (check_locked_table + lock-table wiring + docstring 4b); this slice's additions coexist and are complementary, verified by the integration run.

## 8. QC bar mapping (Issue 15 QC, spec line 329)

Bar: "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table."
- Growth only via valid NEW-WAVE-N lines: now taught (SKILL.md step 16) AND mechanically enforced (boss-cron check_wave_growth — a bare or wrongly-named opening line is a VIOLATION-STOP). Valid openings pass, invalid openings fire.
- "Any other new wave is a violation": both halves of the boss check now exist — check_locked_table (wave present, no line) + check_wave_growth (line present, no named dependency).
