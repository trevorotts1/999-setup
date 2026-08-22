# WS-48 Checkpoint — boss-cron portability repair (operator-specific path removal + proof suite)

**Builder:** B-WR-012-WS-48 (opus/max)
**Run:** first Candice production fan-out, slice WR-012 (W1-C boss-cron portability), workstream WS-48
**Branch/worktree:** `candice/wr001-bootstrap` @ `aa23ed9` (base `6bb00ec`)
**Date:** 2026-08-21
**Status:** QC-FIXED 2026-08-21 by QC-Q-WS-48 (sonnet/max) — blind verdict FAIL (Windows-path test gap), fix applied in this lane, FRESH RECHECK REQUIRED. No commit made, per dispatch instruction.

## Owned paths (per `CONTROL/task-graph-snapshot.json` WS-48 `owned_paths` + manifest 9.2 WR-019 row)

- `tools/boss-cron/`
- `tests/portability/`

## Baseline audit result (WR-001-era, re-verified this lane)

The committed `tools/boss-cron` is already path-portable: `d844f4b` ("boss tools: portable
paths, config-driven campaign data, neutralized docs") removed the hardcoded
`/Users/blackceomacmini/...` install path and moved campaign data (locked waves, wave count,
entry gate, caps, sanctioned classes) into `CONTROL/boss-config.json` (committed neutral
example: `CONTROL/boss-config.example.json`). Verified on the current file:

- `REPO_ROOT` derived from the script's own location (`tools/ -> parent`), every path constant
  env-overridable (`BOSS_REPO_ROOT`, `BOSS_STATE_DIR`, `BOSS_LEDGER`, `BOSS_WF_ROOT`,
  `BOSS_CONFIG`).
- Session-store discovery derives the per-user projects dir from the CURRENT `~`
  (`'-' + HOME.lstrip('/').replace('/','-')`), watching `~/.claude` and `~/.claude-nine`.
- `PROJECTS = os.path.expanduser("~/Downloads/projects")` — home-relative, arbitrary user.
- Claim check (check_claims) anchors its regex to the current `os.path.expanduser("~")`.
- Wave-lock/campaign data is CONFIG-driven; with no config the checks skip rather than guess.
- No `/Users/blackceomacmini` string anywhere in the committed `tools/boss-cron` (grep
  verified; the string appears only in `tools/boss-cron.bak-*` historical backups, which are
  inert history — spec 24 "do not delete historical evidence", never executed).

So the WS-48 repair deliverable = the **proof suite** that locks these properties against
regression, per spec 24 ("Add tests proving ...").

## Files created (all inside the owned glob `tests/portability/**`)

| File | Purpose |
|---|---|
| `tests/portability/run-portability-suite.py` | The WS-48 portability regression suite: 5 assertion groups (A-E below). Self-contained: builds synthetic fixtures in a scratch dir, runs REAL boss-cron live cycles with `HOME` + `BOSS_*` overrides pointed entirely at scratch. Never writes to this repo's `CONTROL/`, `FIX-LEDGER.md`, or the real `~/Downloads/projects` / `~/.claude` / `~/.claude-nine`. Exit 0 = all pass. |
| `tests/portability/build-fixture.sh` | Synthetic fixture builder (bash, self-contained): arbitrary user home with claude + claude-nine session stores (live workflow run with journal + agent metas), `~/Downloads/projects` with two unrelated projects (alpha-one, beta-two) + a legacy six-wave campaign history project + a research dispatch-log in alpha-one only. Prints the fixture root. |

## Verification evidence (run locally, real output)

```
$ python3 tests/portability/run-portability-suite.py
WARN: apps/candice-companion/src/speech/stt/CHECKPOINT-WS16.md: documentation file mentions the developer home path (verify it is not runtime code)
WARN: plugins/candice-integration/bin/CHECKPOINT-WS-03.md: documentation file mentions the developer home path (verify it is not runtime code)
PASS A: no /Users/blackceomacmini absolute path in the generic runtime
PASS B1: arbitrary user home '.../boss-portability.xxxx/b/home' works with a pinned root (clean cycle, BOSSCYCLE-CLEAN recorded)
PASS B2: discovery under '...' finds the session stores without BOSS_WF_ROOT (clean cycle)
PASS B3: windows-shaped home '.../b-win-shape/home/C:\Users\Jane Doe' (backslash segments + space) discovers the session stores and records a clean cycle
PASS C1: the legacy six-wave campaign history governs no generic project (clean cycle with the history project present)
PASS C2: wave-lock is config-driven — the neutral committed config (one wave) flags 'WAVE 6 DISPATCH'; no built-in six-wave table
PASS D: two unrelated projects are isolated — a violation in beta-two names beta-two only, and a stop file inside alpha-one never stops anything
PASS E: claim verification is current-user anchored — a present path under the arbitrary user home verifies clean, a missing one flags
ALL PORTABILITY ASSERTIONS PASS (exit 0)
```

B3 is the QC-FIX addition (2026-08-21): the pre-fix suite ran B1/B2 (POSIX-shaped
homes) only, and the pre-fix checkpoint mapped the checklist E.1 "arbitrary
macOS/Windows usernames work" criterion to those two assertions — an overclaim,
since nothing in the suite exercised a Windows-shaped user path. Spec 24 names
"arbitrary Windows user paths work" as a required test. B3 runs a real live
cycle under a HOME containing backslash segments and a space (`C:\Users\Jane
Doe` shape) and proves discovery + clean cycle. The suite's Python file itself
stays platform-neutral (no fcntl) so it can also run under a Windows
interpreter; full Windows-native execution parity is E.3 (verify-windows.ps1).

The two WARN lines are sibling builders' checkpoint documents (WS-16, WS-03) naming this
machine's worktree path in prose — documentation, not runtime code; verified by inspection
(single occurrence each, `**Worktree:** /Users/blackceomacmini/...` header lines).

## Acceptance criterion mapping (CONTROL/CHECKLIST.md E.1 WS-48)

- "no generic runtime file contains a developer-specific absolute home path (e.g.
  `/Users/blackceomacmini/...`)" — PASS A: scan of the runtime surface (`tools`, `launchers`,
  `templates`, `tests`, `apps`, `packages`, `plugins`, `.claude`; skipping build artifacts
  `node_modules`/`dist`/`target`, git, `spec/`+`CONTROL/` history/control-plane, `.bak`
  historical evidence) finds zero occurrences. The target path is derived from the machine's
  own `~` (`PORTABILITY_DEV_HOME` overridable), never a literal in the test.
- "arbitrary macOS/Windows usernames work" — PASS B: real live cycles run under synthetic
  homes in a scratch dir (B1 pinned `BOSS_WF_ROOT`, B2 full session-store discovery), each
  clean with `BOSSCYCLE-CLEAN` recorded; B3 (QC-FIX addition) proves the same under a
  Windows-shaped home (backslash segments + space), the spec-24 "arbitrary Windows user
  paths work" path-shape proof. Native Windows interpreter execution remains E.3 parity
  (verify-windows.ps1), not this lane.
- "the historical six-wave campaign governs no generic customer project" — PASS C: C1 a
  project carrying six-wave HISTORY passes clean (history is not governance); C2 the runtime
  flags `WAVE 6 DISPATCH` under the committed neutral one-wave config — no built-in six-wave
  table exists in the runtime.
- "two unrelated projects cannot read/stop each other" — PASS D: a violation in beta-two
  names beta-two only (alpha-one never appears); a `stop-workstream` file inside alpha-one's
  CONTROL is inert (the runtime's stop authority is its own state dir).
- Spec 24's claim-path anchoring (arbitrary-user evidence paths) — PASS E: present path under
  the synthetic home verifies clean, missing one flags.

## Cross-lane findings

CROSS-LANE-FINDING
source workflow/lane: WR-012 WS-48 builder (B-WR-012-WS-48)
affected unit: integration/release owner (9.4 shared-file classes) — `tools/boss-heartbeat-alert`
evidence: `tools/boss-heartbeat-alert` (committed, repo root) is NOT customer-portable: it
sources `$HOME/.openclaw/secrets/.env` and `$HOME/clawd/secrets/.env` (operator secret
stores), defaults the alert target to `RESCUE_RANGERS_HELP_CHAT_ID` /
`OWNER_CHAT_ID` (operator chat IDs, with a hardcoded fallback `5252140759`), the sender
account to `rescue-rangers`, and `OPENCLAW_BIN` to `$HOME/.local/bin/openclaw`. The
checklist E.1 WS-48 criterion ("no generic runtime file contains a developer-specific
absolute home path; arbitrary users work") applies to this file's runtime surface as well.
severity: medium (operator-governance watchdog; env-key absence skips alerts rather than
crashing, so it fails soft — but it cannot run on a customer box by construction)
recommended action: EXECUTION-PLAN 6.2 correction + QC finding 4 already classify
`tools/boss-heartbeat-alert` as repo-root 9.4-class tooling (claim-by-any-lane would breach
9.6 disjointness); per that ruling this lane did NOT touch it. Proposed to the integration
owner: gate the alert transport behind explicit config (default OFF), make the secret-store
paths env-overridable with safe defaults, and treat a missing operator env as a documented
degraded mode — so the watchdog is inert-but-safe on customer boxes and fully armed on the
operator box.

CROSS-LANE-FINDING
source workflow/lane: WR-012 WS-48 builder (B-WR-012-WS-48)
affected unit: WS-08 (state machine; watchdog/census work in flight on `tools/boss-cron`)
evidence: the working tree `tools/boss-cron` carries uncommitted edits (fcntl singleton
lock, LIVE-RUN DEFINITION census) that are the in-flight WS-08 watchdog work, NOT this
lane's. This lane left them untouched and tested the CURRENT tree (its README/behavior is
the file the suite locks). No ownership overlap: WS-08 owns `apps/candice-companion/src/state/**`
per manifest 9.2; the tools/boss-cron tree edits sit under this lane's `tools/boss-cron/**`
glob, so the merge must reconcile WS-08's in-flight watchdog edits with this lane's
committed-file state.
severity: low (no conflict today; the suite tests the working tree as-is)
recommended action: before the WR-012 QC/merge, confirm the in-flight WS-08 watchdog edits
to `tools/boss-cron` land on the branch; the portability suite then re-runs against the
merged file (its env-override and home-derived-path assertions cover the census code too).

CROSS-LANE-FINDING
source workflow/lane: WR-012 WS-48 builder (B-WR-012-WS-48)
affected unit: WS-41 (`tests/contract/**`) — note only, no action required
evidence: `tests/portability/run-portability-suite.py` carries its own verbatim copy of the
runtime's `SANCTIONED_CLASSES` classifier and line-shape regexes (documented in-file as a
deliberate lockstep copy so a runtime re-classification cannot mask a scope violation).
severity: low
recommended action: if the runtime's sanctioned-class set changes, re-sync this copy; the
suite's assertion A/C fail loudly on drift of the path/derivation behavior, and the class
set drift is caught by the suite's own fixture assertions (C1/C2 depend on the exact
finding text).

---

## QC-FIX PROVENANCE 2026-08-21 — QC-Q-WS-48 (sonnet/max), blind verdict FAIL

**Blind verdict:** FAIL — one acceptance gap.

**Finding:** Spec 24 requires tests proving "arbitrary Windows user paths work". The
pre-fix suite exercised only POSIX-shaped synthetic homes (B1/B2), and the pre-fix
checkpoint's E.1 mapping claimed PASS B covers "arbitrary macOS/Windows usernames work"
— an overclaim: no assertion in the suite used a Windows-shaped user path. Everything
else in the deliverable verified green independently (suite re-run, path scan, six-wave
isolation, project isolation, claim anchoring, config-driven wave lock, ownership).

**Fix (all inside owned `tests/portability/**`):**
1. Added assertion B3 to `run-portability-suite.py`: a real live boss-cron cycle under a
   HOME containing backslash segments and a space (`C:\Users\Jane Doe` shape), proving
   session-store name derivation, live-run discovery, and `BOSSCYCLE-CLEAN`.
2. Documented in the suite docstring that native Windows interpreter execution is E.3
   parity territory (`verify-windows.ps1`), while the suite's own Python stays
   platform-neutral (no fcntl anywhere in the suite).
3. Corrected the E.1 criterion mapping in this checkpoint; updated status line and
   verification-evidence block.

**Post-fix run (exit 0):** A, B1, B2, **B3**, C1, C2, D, E all PASS — full output in the
verification-evidence block above.

**Backup of pre-fix state:** `tests/portability/.bak-qc-ws48/{run-portability-suite.py,CHECKPOINT-WS48.md}`.

**Notes for the fresh rechecker:**
- The working-tree `tools/boss-cron` carries uncommitted WS-08 watchdog edits
  (`import fcntl`, singleton flock, LIVE-RUN census) not made by this lane; the suite
  tests the tree as-is and its assertions cover that code's home-derived paths. Real
  Windows-native execution of `tools/boss-cron` is blocked by the unguarded `import
  fcntl` at line 113 — an in-flight WS-08 edit outside this lane's ownership; recorded
  here so the fresh recheck and integration owner see it (E.3 Windows parity gate owns
  the native-interpreter proof).
- No commit made; merge stays with the integration owner.
- **FRESH RECHECK REQUIRED** (this QC-fixer edited the unit and may not final-certify).
