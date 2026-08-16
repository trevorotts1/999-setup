# WF-4E slice 2 evidence — Issue 18 FIX: stop on violation + restart from last clean checkpoint; BOSSCYCLE-CLEAN on clean

Branch: `fix/18-boss-cron`. Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (live ledger `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 70).

Slice scope (from dispatch): FIX — on violation: immediately STOP the violating workstream, mark `VIOLATION-STOP` with the finding, RESTART from the last clean checkpoint. On clean: `BOSSCYCLE-CLEAN`. Verify the interim boss does both; fix gaps.

## Spec authority

- `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` Issue 18 FIX (line 398): "On violation: immediately STOP the violating workstream, mark `VIOLATION-STOP` with the finding, RESTART from the last clean checkpoint. On clean: `BOSSCYCLE-CLEAN`."
- PART 4 "On violation" (line 552): "Immediately STOP the violating workstream (no further dispatches on it), mark the ledger `VIOLATION-STOP` with the exact finding, and RESTART the workstream from the last clean checkpoint recorded in project_state.json. The restart re-runs until done the required way — the loop bound is the QC protocol's 20 cycles per finding, then escalation with full history."
- PART 4 "On clean" (line 553): "Write `BOSSCYCLE-CLEAN` with the timestamp and the checks run."
- Issue 18 QC bar (line 402): "every seeded violation class was caught within one cycle, stopped, marked, and restarted from the named checkpoint; a clean cycle logs BOSSCYCLE-CLEAN; a killed cron fires the heartbeat alert."
- WAVE 0 BOOTSTRAP (line 400): interim boss checks "concurrency caps, dispatch census, PART 4 width, wave lock, claim-vs-evidence, heartbeat, stop file, stop-and-rerun kill via `CONTROL/workflow-pids.json`" — WF-4E keeps the upgrade job; the interim checks exist from minute one.

## Baseline facts (measured, not assumed)

- Interim boss live at `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (333 lines), crontab entry `*/5 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-cron >> .../CONTROL/boss-cron.log 2>&1` present, log tail 20:50:01Z clean cycle (control passed).
- Ledger line 70: `WAVE 4 DISPATCH 2026-08-16T20:12Z: full PART 2 scripted width — 5 parallel workflows WF-4A..WF-4E (Issues 13, 14, 15, 17, 18) ... Clones: ... branches fix/13-anti-drift, fix/14-fanout, fix/15-wave-lock, fix/17-qc-protocol, fix/18-boss-cron.` — this commit cites that line.
- Sibling slices confirmed non-overlapping: WF-4B and WF-4C holdings hold `boss-cron.bak-pre-*` files byte-identical (md5 8038937285eaf50f11a17712dacdfaad) to the live script — their slices edited docs (capacity.md, SKILL.md, ledger), not the script. WF-4E slice 3 owns `tools/boss-heartbeat-alert` (untouched by this slice). WF-4E slice 5 owns the seeded-violation test (untouched).

## Gaps found (full-file read of tools/boss-cron at branch base, lines cited)

1. **Heartbeat parser blind to its own writer (lines 96-98 vs 70-71).** `now_iso()` writes timestamps as `2026-08-16T20:35:01Z` (HH:MM:SS with seconds); `line_timestamp`'s regex required `HH:MMZ` with NO seconds. Probe: `re.search(r"20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}Z", "<BOSSCYCLE-CLEAN ...20:35:01Z...>")` → NO MATCH. Executing the real function against the live ledger: `check_heartbeat` returned "no BOSSCYCLE-CLEAN line yet (first cycle baseline)" while 40+ BOSSCYCLE-CLEAN lines existed. Consequence: the heartbeat check could never age — the boss's self-governance (PART 4 line 555-557: no `BOSSCYCLE-*` line within two intervals → Telegram alert) was structurally dead.
2. **Stop/restart instructions did not name a checkpoint (lines 315-326).** VIOLATION-STOP ledger lines said only "re-dispatch from its last clean checkpoint" with no checkpoint named, and the stop file carried findings only. Spec line 552 requires restart "from the last clean checkpoint recorded in project_state.json" — the boss never read `CONTROL/project_state.json`, so the conductor had no named checkpoint to restart from.
3. **No loop bound in the stop instruction.** Spec line 552 names the bound: "the QC protocol's 20 cycles per finding, then escalation with full history." The stop file and VIOLATION-STOP lines omitted it.
4. **No dedupe on repeated violations.** A recurring violation re-appended an identical VIOLATION-STOP every 5-minute cycle (same finding, same text), inflating the ledger without new information.

## Fix (committed in this slice; installed live)

All edits in `/Users/blackceomacmini/work-999-setup-fix/WF-4E/tools/boss-cron`, then installed to `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (live path, identical md5 verified cc63db9324096accf8dc8d856afa1c7d on both).

1. `line_timestamp` — seconds made optional in the regex: `r"20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z"`. Heartbeat now sees every written beat.
2. New `last_clean_checkpoint()` — reads `CONTROL/project_state.json` `checkpoints[]`, returns the last entry as `name / commit / ts`; returns None (never invents) when the file or checkpoints are absent, with the stop instruction then telling the conductor to name it.
3. VIOLATION-STOP lines and the stop file now carry: the exact finding, `restart from last clean checkpoint: <named checkpoint>`, and `loop bound: QC protocol 20 cycles per finding, then escalation with full history` (spec line 552).
4. Dedupe — identical ledger lines are not re-appended on a later cycle (a new "stop file active" violation still fires while the stop file persists, which is the correct hold-open behavior).

Backup before write (PART 5 rule 4): `/Users/blackceomacmini/work-999-setup-fix/WF-4E/holding/boss-cron.bak-pre-slice2-stoprestart` (md5 8038937285eaf50f11a17712dacdfaad — pre-edit state). Restore one command: `cp /Users/blackceomacmini/work-999-setup-fix/WF-4E/holding/boss-cron.bak-pre-slice2-stoprestart /Users/blackceomacmini/work-999-setup/tools/boss-cron`.

## Verification (independent, instrument = the fixed script itself)

**A. Heartbeat fix, real functions on live ledger:** heartbeat returns `None` (age < 600s) — beats now parsed; before the fix the same call returned "first cycle baseline" forever.

**B. Seeded-violation end-to-end (scratch dir, no live writes):** synthetic ledger with a clean beat at 20:35:01Z (seconds format), a scope violation line, and `project_state.json` with `checkpoints: [{"name":"ckpt-9","commit":"abc123","ts":"2026-08-16T19:55:00Z"}]`.
- `--check` (dry): printed `heartbeat: last BOSSCYCLE-CLEAN 15 min ago (> 2 cycles)` + the scope line; exit 2. The heartbeat finding was real — the parser read the seconds-format beat. (Before the fix this exact scenario printed no heartbeat finding.)
- Live run (scratch): exit 2, appended two VIOLATION-STOP lines, each carrying the finding + `restart from last clean checkpoint: ckpt-9 / abc123 / 2026-08-16T19:55:00Z` + the 20-cycle loop bound.
- Stop file written with the same trio.
- Run 2: the two original finding lines NOT duplicated (dedupe); only a new "stop file active" VIOLATION-STOP appended — the hold-open behavior while the stop file persists.

**C. Clean cycle on live install:** after install, `boss-cron --check` on the live ledger → `0 violation(s)`, exit 0, and the 20:50:01Z cron cycle appended `BOSSCYCLE-CLEAN 2026-08-16T20:50:01Z: checks=caps,census,width,wavelock,claims,beat,stop,scope,kill` — the clean path still writes BOSSCYCLE-CLEAN with timestamp and checks run (spec line 553).

**D. Syntax:** `python3 -m py_compile` clean on clone and live copies.

## Touch list (slice scope only)

1. `/Users/blackceomacmini/work-999-setup-fix/WF-4E/tools/boss-cron` (new file in clone; installed live) — 4 edits above.
2. `/Users/blackceomacmini/work-999-setup-fix/WF-4E/holding/boss-cron.bak-pre-slice2-stoprestart` (backup).
Nothing else touched. Sibling-owned files (`tools/boss-heartbeat-alert`, slice 3; `holding/slice5-test/`, slice 5; `holding/WF-4E-slice4-evidence.md`, slice 4; `holding/boss-cron.live-20260816T1640Z.bak`, slice 4) left as found.
