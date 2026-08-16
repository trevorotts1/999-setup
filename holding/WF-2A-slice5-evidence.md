# WF-2A slice 5 — boss-cron ENTRY-MODE allowlist wiring (cross-check)

Slice per WAVE 2 REDISPATCH ledger line (FIX-LEDGER.md line 55):
"WF-2A slice 5 = boss-cron ENTRY-MODE allowlist wiring".

Issue 3 FIX step 2 (999-master-fix-spec-20260815.md lines 58-60): the entry
choice is a required ledger line (`ENTRY-MODE: interview|pointed`); the
self-audit (step 20) and the boss cron both reject a run whose ledger lacks
the line. The boss cron's sanctioned line-class allowlist must therefore
carry `ENTRY-MODE` so the entry line is not a false scope violation.

## Finding: gap

- `tools/boss-cron` lines 62-68: `SANCTIONED_CLASSES` did NOT contain
  `ENTRY-MODE` (full-file read of all 384 lines).
- `tools/boss-cron` lines 236-248 and 251-280: the entry-mode CHECK
  (`ENTRY_MODE_RE`, `entry_mode_line`, `check_entry_mode`) existed (slice 3
  work, commit e40748b) — but the scope check at lines 222-233 would flag any
  ledger line whose class is not in `SANCTIONED_CLASSES`. A run's own
  `ENTRY-MODE: interview|pointed` line (shape `- \`ENTRY-MODE ...\``) would
  have been a false scope violation: the enforcer would stop the very run it
  exists to approve.
- Spec PART 4 sanctioned allowlist (999-master-fix-spec-20260815.md line
  538) already lists `ENTRY-MODE` between `DESIGN-BRIEF` and `BUILD-TARGET`.
  The script drifted from the spec.
- Live repo check: `/Users/blackceomacmini/work-999-setup/tools/boss-cron`
  has zero `ENTRY-MODE` references (grep for `ENTRY-MODE|entry_mode`), so the
  live boss would not have the entry check at all — and the clone's fix is
  the forward-looking patch that lands at merge. Clone is the correct target
  (FIX wave rule: edit the clone, never the live repo).

## Fix applied (one line)

- `tools/boss-cron` line 66 (now): `SANCTIONED_CLASSES` gains `"ENTRY-MODE"`:

```diff
-    "BOSSCYCLE-CLEAN", "WAVE", "LOCKED", "ISSUE-18-EARLY", "REPAIR-DISPATCH",
+    "BOSSCYCLE-CLEAN", "WAVE", "LOCKED", "ISSUE-18-EARLY", "ENTRY-MODE", "REPAIR-DISPATCH",
```

Nothing else touched. `git diff` shows exactly +1 -1.

## Step-20 self-audit verification (spec FIX step 2 second half)

`.claude/skills/spec-protocol/SKILL.md` step 20, "Then the ENTRY-MODE gate",
lines 1254-1256 (read in context, lines 1235-1269): the self-audit requires
`<project>/CONTROL/LEDGER.md` to carry `ENTRY-MODE: interview|pointed`; a
project folder with no `ENTRY-MODE` line — or any other value — is a FAILED
run: reject, record the rejection, restart from the entry gate. Line 1264:
"self-audit never grades or ships a run whose ledger lacks the line."
Lines 960-962 (step 3 ledger write) state the same rejection by self-audit
(step 20) and boss cron. Step-20 rejection names ENTRY-MODE — VERIFIED, no
change needed.

## Verification steps run

1. `python3 -m py_compile tools/boss-cron` — syntax OK.
2. Module load + functional test of `check_scope` (both entry-line shapes):
   - `- \`ENTRY-MODE: interview\`` → `ledger_class` `'ENTRY-MODE:'`, scope
     violations `[]` (passes — and the `:`-suffix fallback at line 230 also
     held, but the set membership is now explicit for the timestamped shape).
   - `- \`ENTRY-MODE 2026-08-16T14:05Z: interview ...\`` → class
     `'ENTRY-MODE'`, scope `[]` — the shape that matters: a real ledger line
     is timestamped, so bare set membership is the load-bearing path.
   - Control `- \`FROBNICATE ...\`` → still flagged (1 violation) — the
     allowlist still discriminates. Assertions all pass.
3. `git diff` verified: one line, one token added, no other files changed.

## Commit

`git log` after: one new commit on `fix/3-entry` citing WAVE 2 REDISPATCH
2026-08-16T15:22Z (FIX-LEDGER.md line 55), base commit e40748b.

VERDICT: DONE
