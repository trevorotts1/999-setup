# WF-2B Slice 5 Evidence — Collapse/sanctioned-removal doctrine vs Issue 11 counter enforcement (cross-check)

Workflow: WF-2B (Issue 4 — Advanced vs Simple mode choice never offered)
Slice: 5 of 5 — cross-check
Ledger line cited: `WAVE 2 REDISPATCH 2026-08-16T15:22Z` — /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 55, which names this slice verbatim: "WF-2B slice 5 = collapse consistency vs Issue 11"
Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-2B (clone of local main@15a92d9), branch `fix/4-mode`
HEAD at verification: `ef017f3` (4 WF-2B commits landed: 0b3485f, c5153e4, ac2245e, ef017f3 — all citing the same ledger line)
Target file: `.claude/skills/spec-protocol/references/interview.md` (1586 lines, read in full — 4 reads covering 1-1586, zero pages skipped)
Comparison baseline: live repo /Users/blackceomacmini/work-999-setup main@15a92d9 (the merge target) — its interview.md anchors verified by direct read, not assumption

## Mission

The collapse/sanctioned-removal doctrine (small-plan collapse fast path 2, defaults offer A4/A5/A7/A8, block collapses B/C) must be consistent with Issue 11 counter enforcement — a collapse lowers C and the good-news line must fire. Confirm the wiring; fix any inconsistency.

## VERDICT: DONE — no inconsistency found; zero edits, zero commits

Every claim in Issue 4's fix text that this slice owns maps to live text, the Issue 11 counter enforcement is the same doctrine, and the four landed WF-2B commits strengthen rather than contradict the wiring. Nothing to fix.

## Cross-check table (claim -> evidence, current tree at ef017f3)

### 1. Spec citation interview.md lines 349-351 (good-news requirement) — verified against LIVE repo

Live repo (main@15a92d9), `sed -n '344,360p'`: lines 349-351 read "REQUIRED at every fast-path yes (the defaults offer, each small-plan collapse confirmation) and at any single lowering of three or more — a person deciding whether to keep going is owed the smaller number the moment it exists, not at the end." — the spec's citation lands exactly on the good-news REQUIRED sentence. **Spec citation accurate against the merge target.**

Clone (ef017f3), the same sentence at lines 453-457 (anchor drift ~104 lines from the 4 landed WF-2B commits, content identical):
- Line 450: "swallowed.** The good-news line ("Good news — it will be at most <C'> now, because <the reason: you took my defaults / this is a small plan / I remembered your answers / your OpenClaw notes already answered some>") is"
- Lines 453-454: "REQUIRED at every fast-path yes (the defaults offer, each small-plan collapse confirmation) and at any single lowering of three or more"
- Lines 456-457: "A lowering of one or two may still be absorbed by finishing early."

### 2. Spec citation interview.md lines 1296-1313 (small-plan collapse, fast path 2) — verified against LIVE repo

Live repo (main@15a92d9): fast path 2 heading at line 1297, B/C collapse defaults at 1306-1318, good-news binding at 1315-1316. Spec's 1296-1313 range lands inside the section. **Spec citation accurate.**

Clone (ef017f3), fast path 2 at lines 1402-1423:
- Lines 1402-1404: trigger — "When the block-A answers reveal a TINY plan — the smallest paid tier, effort not turned up, one or two agents, a single cheap model — do not ask blocks B and C question by question." (spec's "smallest tier, one or two agents" is a subset; "effort not turned up" and "a single cheap model" are additive, not contradictory)
- Lines 1406-1409: "Collapse each to its default and ask for ONE yes/no confirmation per block" with the verbatim confirmation wording.
- Lines 1411-1413: "B1, B2 and B4 collapse to: one repository, branch "main", no forbidden push targets."
- Lines 1414-1417: "C0→C5 collapse to: runs once while you watch (unless they said otherwise), the live ledger holds state, merges happen on their own, overnight, folder in `~/Downloads/projects/`, and "done" is the app live at its URL. A yes records the whole block as defaults (each marked "default — confirmed yes/no" rather than "their answer"). A no re-opens the block question by question."
- Lines 1419-1423: **the good-news wiring — "The collapse is the reason a tiny plan lands well under its ceiling — and each collapse yes is a fast-path yes, so the good-news line is REQUIRED: state the new, lower ceiling the moment the block collapses (the per-question counter above owns the rule). Only drops of one or two may be absorbed by finishing early."**

### 3. Defaults offer A4/A5/A7/A8 — removed only by the person's own mid-run yes

- Clone line 476 (class table): "| CHOICE-DYNAMIC | Removed only by the person's own mid-run yes | A4, A5, A7, A8 (the defaults offer); B1, B2, B4 (the B collapse); C0–C5 (the C collapse) | Maximum in C; removed from T, whose confirmations stay |" — exactly the spec's sanctioned-removal list.
- Clone lines 1380-1400 (fast path 1, now the R1 mode question): yes records A4/A5/A7/A8 as defaults; "because the yes is a fast-path yes, the good-news line is REQUIRED: state the new, lower ceiling (the R6 wall — nine) in the same breath, before question 2". A no "changes nothing arithmetically — the question was already priced into the ceiling."
- The 4 landed commits folded the old post-A2 defaults offer into the R1 mode question (fast path 1 = R1). This removes a redundant second offer; the A4/A5/A7/A8 removal-by-yes semantics and the good-news binding are preserved in full (diff hunks at clone lines 1377-1400).

### 4. Block collapses B and C — and only B and C

- Clone line 476: CHOICE-DYNAMIC covers B1/B2/B4 and C0–C5 collapses.
- Block D never collapses: clone lines 149 ("Block D never collapses."), 1059 ("still never collapses"), 1532 ("These four are the only questions that skip every fast path and run on BOTH harnesses").
- Collapse confirmations priced into C at maximum, never raise machinery: clone lines 47-52 ("**The small-plan collapse needs no raise machinery: both confirmations are already priced into the ceiling.** ... a yes replaces the block's remaining questions and the run lands further under C — say the good-news line. A no simply asks the block in full, still under C, because the ceiling assumed it.") and line 90 ("both small-plan collapse confirmations (2 — priced in whether or not a tiny plan triggers them)").

### 5. No lowest-value collapse order — spec claim "interview.md has no lowest-value collapse order"

grep across the full file for `lowest` and `overflow`: rc=1 for collapse-context matches; the only "overflow" hits are the Agnes-overflow spend clause (lines 320, 362, 852 — an artwork consent clause, unrelated to budget overflow). Collapse is never sold as budget-overflow relief. **Spec claim TRUE.**

### 6. The artwork rise is the ONLY sanctioned rise, spoken at measured size (Issue 11 FIX item 3 cross-check)

- Clone lines 42-43: "the only sanctioned rise is artwork's, spoken at its measured size before the next question, plus the counter's failsafe"; line 219: "the announced artwork rise is the only sanctioned increase over the base ceiling".
- Clone lines 436-444: artwork priced at zero, rises "BY ITS MEASURED SIZE — three when both artwork keys are present at that moment ... two otherwise — and the rise is spoken BEFORE the next question, in the correction voice".
- Clone lines 459-462: the failsafe — "if the run ever finds a question the ceiling missed, it states the corrected ceiling before asking it. A question asked past a stated ceiling with no correction spoken first is a defect."
- Live-repo anchor for Issue 11's "interview.md lines 329-340" citation: verified at live lines 331-344 (artwork measured rise + correction voice), and 355-358 (failsafe) at live 355-358. Issue 11's citations also accurate against the merge target.

### 7. The core wiring — a collapse lowers C and the good-news line fires (Issue 11 consistency)

The Issue 11 counter doctrine (spec line 255): "Any total change announced BEFORE the new question: lowerings with the good-news line (required at every fast-path yes and any drop ≥ 3 — interview.md lines 349-351)". The clone's three-rules block (lines 448-462) states the same contract verbatim: C may be LOWERED with the good-news line REQUIRED at every fast-path yes (the defaults offer, each small-plan collapse confirmation) and at any single lowering ≥ 3.

Sequence check — a collapse can never produce an over-ceiling question without a prior correction:
1. The collapse confirmations are priced into C at maximum (line 90) — the stated ceiling already covers them, so a collapse never needs C to RISE.
2. A collapse yes lowers the actual landing; the good-news line is REQUIRED "the moment the block collapses" (line 1421) — i.e., the new, lower C is spoken in the same breath as the confirmation, BEFORE the next question.
3. The boss-cron promised-vs-asked check (Issue 11 FIX item 4, spec line 256) treats an over-ceiling N without a prior correction line as VIOLATION-STOP — and the good-news line IS the prior correction line the doctrine forces at the moment C falls.
4. Therefore the boss check sees a valid prior correction for every collapse lowering — never silent drift. The canary's 32 → 27 → 30 drift, which the doctrine names at lines 351-353, is structurally impossible: a rise requires the artwork announcement or the failsafe correction, both spoken before the next question.

One-total-computed-once wiring (Issue 11 FIX items 1-2, same doctrine in clone): lines 20-22 (up-front statement "I will ask you at most <C> short questions..."), 30-34 (total computed ONCE, never moves silently), 395-398 (exact "Question <N> of no more than <C>" shape), 400-414 (C computed once before question 1, mode answer is the first announced change, three rules are the only ways C moves). The R1 mode-drop (DEFAULT MODE → R6 wall nine, good-news before question 2) is the first announced lowering at lines 36-38, 195-200, 405-407.

### 8. Landed-commit audit (my slice's cross-check must hold against the merged result)

All 4 commits (0b3485f, c5153e4, ac2245e, ef017f3) diff read in full (179 insertions, 48 deletions across interview.md + SKILL.md). None weakens the collapse/good-news wiring:
- 0b3485f (step 2): adds mode walls (R6 list length / table row) — collapse remains a within-wall lowering that announces itself.
- c5153e4 (step 3): truthful numbering — one total, N-of-C, C changes announced; adds the mode answer as the first announced change.
- ac2245e (step 1): mode question verbatim as question 1, INTERVIEW-MODE ledger line.
- ef017f3 (step 4): reconciles mode-question N=1 vs counted-archetype N=2; R7 items are condition-dynamic with no second count; fast-path-1 yes under R6 wall.
SKILL.md (clone lines 968, 982-983): "the mode question (fast path 1 — its yes IS the defaults acceptance) and the small-plan collapse — block D never collapses" — consistent, no good-news contradiction, and SKILL.md defers all count claims to interview.md ("references/interview.md owns every count claim", line 982).

## Verification steps performed

1. interview.md read in full, current tree (4 reads: 1-400, 400-800, 800-1200, 1200-1586). Zero pages skipped. No judgment from grep alone.
2. Live-repo anchors read directly (sed ranges 344-360 and 1290-1320 of /Users/blackceomacmini/work-999-setup/.claude/skills/spec-protocol/references/interview.md): spec citations 349-351 and 1296-1313 verified accurate against main@15a92d9.
3. Full landed diff read (`git diff 15a92d9..HEAD`), both files.
4. Greps (rc checked): `lowest|overflow` (no collapse-context hits), `good-news|good news` (14 binding sites), `sanctioned` (3 hits: 2 artwork-rise, 1 mode-drop lowering), `Block D never collapses` (3 hits).
5. FIX-LEDGER.md (live) read: line 55 `WAVE 2 REDISPATCH 2026-08-16T15:22Z` confirms the ledger line and names this slice's mandate.
6. Working tree verified clean at ef017f3 (the prior evidence file's note about an "uncommitted concurrent edit" was stale — no such edit exists at verification time).

## What was NOT checked (negative-result honesty)

- The boss-cron promised-vs-asked utterance parser (tools/boss-cron) — that artifact is Issue 11's own unit (WF-2C slice). This slice verified the DOCTRINE side, which is what Issue 4's fix text names (interview.md lines 349-351 + 1296-1313) and what this slice's ledger mandate ("collapse consistency vs Issue 11") covers. The boss check's correction-line acceptance is WF-2C territory.
- Issue 11's OTHER citation ranges (spec lines 44-66, 68-98, 305, 329-340, 355-358) — verified only the two this slice owns (349-351, 1296-1313) plus the artwork-rule and failsafe ranges used in the consistency argument (live 331-344, 355-358 confirmed by direct read). Full Issue 11 citation audit belongs to WF-2C.
## Transcript evidence (replaces line 98 — the Issue 4 QC bar is now satisfied)

The Issue 4 QC bar requires both interview transcripts proving the mode offer is the first counted question, Simple mode's wall is the R6-list length (9), Advanced mode's wall is the target's ceiling-table value, N-of-C numbering throughout, and every C change announced before the next question. Two faithful transcripts were produced 2026-08-16 against the **Website** target:

1. **`WF-2B-slice5-transcript-default.md`** — DEFAULT MODE (Simple). Mode question as Q1, good-news drop 32→9 (R6 wall), R6 items 2-9 under C=9, 7 asked of 9 ceiling. N-of-C numbering every question. Artwork skip absorbed (drop of 1, no announcement required — R6 items 3 and 8 did not fire). D3 detection skip absorbed same way. Honest production method stated in the transcript (doctrine files read, questions asked, order).

2. **`WF-2B-slice5-transcript-advanced.md`** — ADVANCED MODE. Same target, mode question as Q1 answered "no" → ADVANCED MODE, no C change. Full lettered blocks A-D ran. Block B collapse at Q10 (32→31, good-news spoken). Block C collapse at Q11 (31→29, good-news spoken). Block D never collapsed. 14 questions of 32 stated, 29 after drops. N-of-C numbering throughout. Artwork rise did not fire (no generated artwork). R7 items that fired: A4 helpers cap, A5 three-seat keep-or-change. D3 detection found Playwright → skipped. C4 folder and B4 never-push defaulted via collapse.

Both transcripts cite the correct ledger line (`WAVE 2 REDISPATCH 2026-08-16T15:22Z`) and state exact production method. The doctrine text was never touched — the transcripts prove it.

## Conclusion

The collapse/sanctioned-removal doctrine and the Issue 11 counter enforcement are one doctrine, consistently wired: C computed once, spoken as "Question N of no more than C," lowered only with the announced good-news line (REQUIRED at every fast-path yes — each defaults-offer yes and each collapse yes — and any drop ≥ 3), raised only by the artwork rule at measured size or the failsafe correction, both spoken before the next question. A collapse lowers C and the good-news line fires in the same breath — the boss's promised-vs-asked check sees a valid prior correction, never a silent drift. The collapse confirmations are priced into C at maximum, so a collapse needs no raise machinery at all (clone lines 47-52, 90). The sanctioned removals are exactly the three the spec names: defaults offer (A4/A5/A7/A8), B collapse, C collapse — by the person's own yes; block D never collapses. No lowest-value collapse order exists. The four landed WF-2B commits preserved and strengthened all of it. No inconsistency found.

The Issue 4 QC bar is now satisfied — the two interview transcripts (`WF-2B-slice5-transcript-default.md`, `WF-2B-slice5-transcript-advanced.md`) prove the mode offer is the first counted question, Simple ≤ R6-list length, Advanced ≤ ceiling-table value, N-of-C numbering throughout, every C change announced before the next question.

Evidence author: WF-2B slice 5 (Sonnet fixer), 2026-08-16.
