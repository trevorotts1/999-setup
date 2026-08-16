# WF-4E slice 5 — Issue 18 FIX verification: seeded-violation test transcript

**Builder:** Opus (verification slice). **Date:** 2026-08-16.
**Issue 18 QC bar (spec 999-master-fix-spec-20260815.md line 402):** "every seeded violation
class was caught within one cycle, stopped, marked, and restarted from the named checkpoint;
a clean cycle logs BOSSCYCLE-CLEAN; a killed cron fires the heartbeat alert."

**Target under test:** the installed interim boss `/Users/blackceomacmini/work-999-setup/tools/boss-cron`
(13,317 bytes, sha256 `fd1dd124ea51c5f68ea51ab91962aed6240edf56900ff7fdb98beda79a2f22e8`),
the same script the crontab runs every 5 minutes
(crontab entry verified: `*/5 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-cron >> /Users/blackceomacmini/work-999-setup/CONTROL/boss-cron.log 2>&1`).
The full WF-4E upgrade (8-check boss + Telegram alert) has NOT landed — the WF-4E clone branch
`fix/18-boss-cron` contains no boss-cron file (git ls-files empty for boss; diff vs main for
tools/ empty), and slices 1-4 are in progress. This verification therefore tests the boss as
INSTALLED and RUNNING.

## Test method

Sandbox copy at `holding/slice5-test/boss-cron-sandbox` — byte-identical to the live script
(sha256 matched) with ONLY the four hardcoded path constants patched (lines 37-40) to
`holding/slice5-test/{ledger,control,workflows}`. No logic touched; `ast.parse` passed.
Sandboxed because the boss's paths are hardcoded (lines 37-40, no env/arg override exists —
verified: no `os.environ`/`getenv`/argv handling except `--check` at line 262) and a live
seeded test would corrupt the production ledger. Live control run of the unmodified script:
`boss-cron --check` exits 0 on the production ledger (no false positives), confirming the
sandbox and live behavior are the same code.

## CONTROL: clean cycle

- Dry: `python3 boss-cron-sandbox --check` on a ledger with only sanctioned lines →
  `0 violation(s)`, exit 0, "checks run: caps,census,width,wavelock,claims,beat,stop,scope,kill".
- Wet: same ledger → exit 0, appended `BOSSCYCLE-CLEAN 2026-08-16T20:41:27Z: checks=... (baseline)`.
- PASS: clean cycle logs BOSSCYCLE-CLEAN (matches the QC bar).

## Seeded violation matrix (each class seeded once, one cycle, results below)

| # | Check (PART 4) | Seeded violation | Caught within one cycle? | Evidence |
|---|---|---|---|---|
| 1 | CAPS | fake live workflow agent with model `totally-fake-model` | **PASS** — `1 violation(s)`, exit 2, "live agent with unknown model totally-fake-model x1" | sandbox run 20:43Z |
| 2 | CENSUS | `WAVE 4 DISPATCH ... full PART 2 scripted width — Width justification: test but NO census` | **FAIL** — exit 0, 0 violations | sandbox run 20:42Z |
| 3 | WIDTH | `WAVE 4 DISPATCH ... WF-4A only — no justification — Census before dispatch: 0 live agents` (1 of 5 locked workflows named) | **FAIL** — exit 0, 0 violations | sandbox run 20:42Z |
| 4 | WAVELOCK | `WAVE 4 DISPATCH` present with only `WAVE 1 CLOSED` (waves 2,3 never closed) | **FAIL** — exit 0, 0 violations | sandbox run 20:42Z |
| 5 | CLAIMS | (structural proof below — live ledger analysis) | **FAIL** — 97 of 99 live ledger lines never examined | analysis 20:43Z |
| 6 | BEAT/heartbeat | last `BOSSCYCLE-CLEAN` 73 minutes old (19:30:00Z, cycle at 20:43Z) = killed-cron simulation | **FAIL** — exit 0, 0 violations; boss even appended a FRESH `BOSSCYCLE-CLEAN`, masking the gap | sandbox run 20:43:33Z |
| 7 | STOP | `CONTROL/stop-workstream` file present | **PASS** — `1 violation(s)`, exit 2, "stop file active on workstream" | sandbox run 20:42Z |
| 8 | SCOPE | ledger line `EVIL-CLASS 2026-08-16T20:00:00Z: rogue line not in allowlist` | **PASS** — VIOLATION-STOP appended, stop file written, exit 2 | sandbox run 20:42:20Z |
| 8b | SCOPE bypass | `SMUGGLED-CLASS: 2026-08-16T20:00:00Z: rogue line with colon` (colon-suffixed class, <60 chars) | **FAIL** — exit 0, 0 violations | sandbox run 20:42Z |
| 9 | KILL | pids file pinning a live sleep pid + scope violation | **FAIL** — `0 kill(s)`; the pinned process was NOT killed; pids file key never matches the derived stream name | sandbox run 20:44:09Z |

### Restart-from-checkpoint (QC bar clause 1)

The VIOLATION-STOP line the boss writes says "...conductor MUST TaskStop the named workstream
and re-dispatch from its last clean checkpoint" (boss-cron lines 315-319, verified in sandbox
output `VIOLATION-STOP 2026-08-16T20:43:26Z: scope: ... — conductor MUST TaskStop...`). The
stop file written contains only the finding text, no checkpoint name (verified:
`cat control/stop-workstream` → `boss-cron-20260816: scope: ...`). The restart action and the
checkpoint name are delegated to the conductor; the boss itself names no checkpoint. For the
checks that DO catch (stop, scope), "stopped + marked" is proven; "restarted from the named
checkpoint" is a conductor action, not in the script.

## Root causes (all in /Users/blackceomacmini/work-999-setup/tools/boss-cron)

**FINDING F1 — census/width dead (same root cause): `ledger_class()` returns only the FIRST
token.** Line 85-93: `ledger_class` returns `toks[0]`. A live ledger line
`- \`WAVE 4 DISPATCH ...\`` therefore has class `"WAVE"`, so:
- census check line 144: `if "DISPATCH" in cls` → `"DISPATCH" in "WAVE"` = False → the
  WAVE-n DISPATCH lines are never checked. Only a line whose first token literally contains
  DISPATCH (e.g. a bare `DISPATCH 2026-08-16T09:05Z:...` line) is checked. Live ledger: 1 such
  bare line (has census), 11 WAVE-n DISPATCH/REDISPATCH lines exempt.
- width check lines 176-177: same gate `("DISPATCH" in cls or "REDISPATCH" in cls)` → the
  wave's dispatch line never registers in `latest` → width violation impossible.
  Verified by direct logic walk (wave search = 4, class = "WAVE", named = False, justified =
  False, yet width returned `[]`).

**FINDING F2 — wavelock dead: regex at line 157 `r"- \`(WF-(\d)[A-Z])"` matches only
`- \`WF-4A...` lines, never `- \`WAVE 4 DISPATCH...` lines.** Verified: `re.match` on the
real line shape returns None; on `- \`WF-4A BUILDER DONE` returns ('WF-4A','4'). In the live
ledger the only lines matching WF-n + "DISPATCH" are `WF-1A REPAIR DISPATCH` and
`WF-1B REPAIR DISPATCH` (wave 1) → `max_dispatched` = 1 → the loop
`for w in range(2, max_dispatched + 1)` never iterates → the check has never fired.
Sandbox seed (wave 4 without wave 3 closed) confirmed exit 0.

**FINDING F3 — claims dead: line 195 gate `if "DONE" not in ledger_class(ln) and "FAIL" not in
ledger_class(ln): continue`.** `ledger_class` = first token. Live ledger histogram (99 lines):
`WAVE` 11, `WF-1A` 4, `WF-1B` 3, `WF-3A` 3, `DISPATCH` 1, `DOC` 1, `BASELINE:` 4, `WF-3B` 1,
`WF-2B` 1, `FAIL` 2, `ISSUE-18-EARLY` 1, `BOSSCYCLE-CLEAN` 67. Only the 2 F-2/F-3 `FAIL`
lines pass the gate (F-prefix branch at line 91 returns `toks[1]` = "FAIL"). All
`WF-1B BUILDER DONE ... Evidence: holding/...` lines (class "WF-1B") are skipped — their
evidence paths are never verified. 97/99 lines unexamined.

**FINDING F4 — heartbeat dead: `line_timestamp` regex (line 97) `r"20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}Z"`
requires no seconds, but the boss's OWN `now_iso()` (line 71) writes
`"%Y-%m-%dT%H:%M:%SZ"` WITH seconds.** Verified: regex matches `2026-08-16T13:43Z` but NOT
`2026-08-16T13:43:12Z` (False). Every BOSSCYCLE-CLEAN line the boss itself writes carries
seconds (live sample `BOSSCYCLE-CLEAN 2026-08-16T20:40:01Z`). `check_heartbeat` (lines 203-217)
therefore always returns "no BOSSCYCLE-CLEAN line yet (first cycle baseline)", which is
suppressed at line 288. Killed-cron simulation: 73-min-stale beat → exit 0, and the wet run
appended a fresh BOSSCYCLE-CLEAN, erasing the evidence of the gap. PART 4 "The boss is governed
too" (spec line 557) is unimplemented: the boss never reads its own log (zero occurrences of
the word "log" in the script) and no Telegram/alert send exists anywhere in
`/Users/blackceomacmini/work-999-setup/tools/` or `/Users/blackceomacmini/work-999-setup/scripts/`
(grep for sendMessage/send_message/api.telegram.org: 0 hits; the only Telegram mention in the
whole repo is the docstring comment at boss-cron line 26).

**FINDING F5 — scope bypass: line 228 `if cls.endswith(":") and len(cls) < 60: continue`.**
A rogue line class ending with a colon and under 60 chars is unconditionally allowed.
Seeded `SMUGGLED-CLASS:` passed (exit 0). Note the live ledger's own `BASELINE:` lines ride
this bypass (class "BASELINE:" ends with colon).

**FINDING F6 — kill authority dead: lines 301-305 derive the kill stream from the violation
text's first word.** For a scope violation, `v.split()[0]` = `"scope:"`; for wave-lock =
`"wave-lock"` — always the CHECK name, never the workstream name. `kill_pids` (lines 241-258)
looks up the workstream key in `workflow-pids.json` (keys are workstream names such as
"WF-4E") → no match → 0 kills, every time. Verified in sandbox with a real pinned sleep pid:
`0 kill(s)`, process survived.

**FINDING F7 — PART 4 checks 3, 6, 7, 8 unimplemented.** Zero occurrences in the script of:
`tick`/`contentless` (drift check, spec line 543), `orphan` (media 1:1:1, spec line 544),
`statusline` (spec line 545), `promised`/`asked` (count check, spec line 540). The boss's own
docstring claims "checks 1-8 above" (line 6) and the checks line printed says
"caps,census,width,wavelock,claims,beat,stop,scope,kill" — none of the four PART 4 checks
3/6/7/8 are among them.

## Verdict against the QC bar (spec line 402)

1. "every seeded violation class was caught within one cycle, stopped, marked, and restarted
   from the named checkpoint" — **FAIL**: 5 of 9 installed checks dead or bypassable (census,
   width, wavelock, claims, beat, scope-bypass, kill — 7 failure cells in the matrix), 4 PART 4
   checks unimplemented, and the restart checkpoint is never named by the script.
2. "a clean cycle logs BOSSCYCLE-CLEAN" — **PASS** (verified, both dry and wet).
3. "a killed cron fires the heartbeat alert" — **FAIL**: killed-cron simulation produced
   exit 0 + a masking BOSSCYCLE-CLEAN append; no alert mechanism exists (regex dead, no log
   read, no Telegram wiring).

## Files

- Test sandbox (paths patched copy + seeded ledgers + outputs): `/Users/blackceomacmini/work-999-setup-fix/WF-4E/holding/slice5-test/`
- Boss under test: `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (live, untracked in git)
- Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` lines 392-402 (Issue 18), 532-567 (PART 4)
