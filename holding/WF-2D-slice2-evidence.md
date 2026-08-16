# WF-2D Slice 2 Evidence — Issue 12 FIX step 2: never-re-ask law, mechanically enforced

**Builder:** Opus slice 2 of 5 (WF-2D, Issue 12 wording + never-re-ask).
**Date:** 2026-08-16.
**Clone:** `/Users/blackceomacmini/work-999-setup-fix/WF-2D` (branch `fix-12-wording`, base `main@15a92d9`).
**Commit:** `f415a49` on `fix-12-wording`, parent `1b239f0` (slice 1), one unit = one commit.
**Ledger line cited by the commit:** `WAVE 2 REDISPATCH 2026-08-16T15:22Z` — `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` line 55 (WF-2D row names this slice: "Issue 12 wording + never-re-ask").
**Spec:** `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` — Issue 12 FIX step 2, lines 270-271.
**Live repo:** never touched. The live `/Users/blackceomacmini/work-999-setup/tools/boss-cron` (332 lines, untracked on main, the ISSUE-18-EARLY interim boss) has no REASK check — it receives the upgrade at batch merge (PART 3), which is a later wave's job. The clone carries the full REASK-equipped boss-cron (467 lines) on this branch.

## What FIX step 2 requires (spec lines 270-271, exact)

"Enforce the never-re-ask law mechanically: before ANY question, check the brief and the answers file (`00-INPUT/`); after a compaction or a resume, RE-READ them; a question whose answer is on disk is ANSWERED and never re-asked. The boss cron flags a repeated question (same question key asked twice in the session log) as a violation."

## The fix — 5 files, 580 insertions, one commit (f415a49)

| File | Addition | Location |
|---|---|---|
| `references/interview.md` | **R5.1 The never-re-ask law, mechanically enforced (binding — Issue 12 FIX step 2)** — four mandatory mechanical rules: (1) THE NAMED ANSWERS FILE `00-INPUT/ANSWERS.md` (every answer written via `tools/ledger.sh` the moment it is given, shape `Q:<key> \| <answer>`); (2) STABLE QUESTION KEYS (`Q:A1`…`Q:D4`, `Q:ARCHETYPE`, `Q:BUILD-TARGET`, `Q:ENTRY-MODE`, `Q:MODE`, `Q:1D-*`, `Q:MEDIA-*`, `Q:COLLAPSE-B/C`, `Q:TEAM`, `Q:DONE-CONDITION` — key names identity, not phrasing); (3) THE PRE-QUESTION CHECK (hard gate: before ANY question — counted or uncounted, interview, brainstorm, pointed path, recap — the conductor READS the brief and the answers file in full; answer on disk = ANSWERED, stated back in one line, never spoken again); (4) THE SESSION-LOG ASK LINE (`ASKED Q:<key> \| <question N of no more than C> \| <ISO8601>` into `CONTROL/SESSION-LOG.md`, the shape the boss scans) | lines 294-357 (after R5, before R6) |
| `SKILL.md` | **Step 4.5 THE NEVER-RE-ASK MACHINERY (binding)** — same doctrine in the flow: read brief + `00-INPUT/ANSWERS.md` before ANY question; RE-READ after compaction/resume (resume.md steps 0(d) and 2.5); answered = stated back, never re-asked; boss flags a key asked twice | after step 4.4, ~line 953 |
| `references/resume.md` | **Step 0(d) RE-READ THE BRIEF AND THE ANSWERS** — never-re-ask re-armed before ANY question on the resume path: read brief + answers file in full + session log `ASKED` lines; a key with an answer on disk is ANSWERED, a key already in an `ASKED` line is never spoken again | line ~56 |
| `references/resume.md` | **Step 2.5 RE-READ THE BRIEF AND THE ANSWERS FILE** — re-proves the law against the disk's final state before the interview resumes | line ~115 |
| `references/audience.md` | **BINDING — never ask a question the user already answered (Issue 12 fix)** — audience-facing statement of the law: answers live in `00-INPUT/ANSWERS.md` and the brief; asking again (same run, or after compaction/resume) is the canary defect; boss flags repeated keys | line ~116 |
| `tools/boss-cron` | **Check 5.6 RE-ASK** — `check_reask()`: walks every spec-protocol project under `PROJECTS_ROOT`, skips `subagents/` trees (journals/fixtures, never spoken speech — the COUNT check's rule), scans `CONTROL/SESSION-LOG.md` for `ASKED Q:<key>` lines; any key in two or more lines = violation "re-ask: <rel>: question key Q:<key> asked N times in the session log — a repeated question (never-re-ask law, Issue 12)". Wired at line 421; `checks=...reask...` in the cycle string (line 442). Docstring + header note the exact shape interview.md R5.1 binds (lines 17-28, 317-364) | full file 467 lines |

## Verification (independent, run after the commit)

1. **Clause-by-clause vs spec FIX step 2** — every clause present: "before ANY question" (interview.md line 327), "reads the brief and the answers file" (lines 329-331), "after a compaction or a resume, RE-READ them" (lines 353-354 + resume.md 0(d)/2.5 + SKILL.md 4.5), "ANSWERED and never re-asked" (lines 333-336: "The question is NEVER spoken again in the same run, and never after a compaction or a resume"), "boss cron flags a repeated question" (lines 345-347 + boss-cron 5.6).
2. **boss-cron syntax** — `python3 -m py_compile` PASS, `ast.parse` PASS.
3. **boss-cron --check live** — 0 violations, exit 0, checks run include `reask` (`caps,census,width,wavelock,claims,count,reask,beat,stop,scope,kill`).
4. **Seeded discrimination control** (the negative-result contract — detector proven, not assumed): two scratch projects under a control `PROJECTS_ROOT`; project 1 has `ASKED Q:A1` twice + `ASKED Q:DONE-CONDITION` once; project 2 has `ASKED Q:1D-WEB-1` once. `check_reask()` fired exactly one violation (`Q:A1 asked 2 times`), project 2 silent. PASS.
5. **Pattern edge cases** — `REASK_PATTERN` parses hyphenated keys (`1D-WEB-1`, `DONE-CONDITION`), prefixed text, and coexists with `COUNT_PATTERN` (a "Question N of no more than C" inside an ASKED line still parses for the Issue 11 check).
6. **Live-scan baseline** — zero projects under `~/.claude-nine/projects/-Users-blackceomacmini/` currently have `CONTROL/SESSION-LOG.md` (the machinery's files don't exist until a run uses it), so no false positives are possible today; the detector's correctness rests on the seeded control, not on the empty live scan.
7. **File provenance** — backups in `holding/backups/` (`interview.md.pre-slice2.bak`, `SKILL.md.pre-slice2.bak`, `resume.md.pre-slice2.bak`, `audience.md.pre-slice2.bak`) contain NO R5.1 / 0(d) / never-re-ask content — they are pre-slice-2 state, created before the first edit.
8. **Working tree** — `git status --short` clean (only untracked `holding/`).
9. **Commit discipline** — f415a49 parent is 1b239f0 (slice 1), message cites the WAVE 2 REDISPATCH ledger line verbatim; branch carries exactly 4 commits (slice 3 bf1d063, slice 5 83272cc, slice 1 1b239f0, slice 2 f415a49) above base 15a92d9.

## Boundary (what this slice does NOT do)

- Does not touch the live repo (`~/work-999-setup`) — clone-only per the fix-wave doctrine; the live interim boss's REASK upgrade is batch-merge business (PART 3).
- Does not edit the R5 question wordings (slice 1 owns FIX step 1), the one-question-at-a-time rule (slice 3 owns step 3), the deleted-question list (slice 4 owns step 4), or the test checker (slice 5 owns step 5).
- `check_reask` reads only each project's own `CONTROL/SESSION-LOG.md` — never subagent journals, never workflow fixtures, never the ledger.

## Acceptance vs the QC bar (Issue 12, spec line 276)

Bar: "every question is one-at-a-time, seventh-grade plain, names its escape, appears once, and is not on the deleted list." This slice delivers the "appears once" half mechanically: an answer on disk is never re-asked (R5.1 rule 3 + resume 0(d)/2.5 + SKILL 4.5), and a spoken repeat is a boss-cron VIOLATION (check 5.6) whatever the answers file holds. The loop closes across a session boundary: answers file proves an answer exists, `ASKED` lines prove a question was spoken once — one of the two always fires when the law is broken (interview.md lines 349-356).
