# WF-2D Slice 4 Evidence — Issue 12 FIX step 4: deleted questions stay deleted (R2)

**Builder:** Opus slice 4 of 5 (WF-2D, Issue 12 wording + never-re-ask).
**Date:** 2026-08-16
**Clone:** `/Users/blackceomacmini/work-999-setup-fix/WF-2D`
**Branch:** `fix/12-wording` (clean — nothing to stage yet; commit follows this report)
**Ledger line cited:** `WAVE 2 REDISPATCH 2026-08-16T15:22Z` (FIX-LEDGER.md line 55)
**Spec:** `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` — Issue 12 FIX step 4 (line 273): "Deleted questions stay deleted (R2, lines 156-233): A4-in-default-mode, A6, A7, A8, the provider-path half of A2, B1/B2, C0-C3, C6-as-question, C1, C2 — the run decides and reports these; it never asks them."
**QC bar (spec line 276):** "every question is one-at-a-time, seventh-grade plain, names its escape, appears once, and is not on the deleted list."
**Backups:** `holding/backups/interview.md.pre-slice4.bak`, `SKILL.md.pre-slice4.bak`, `loops.md.pre-slice4.bak`, `media-pipeline.md.pre-slice4.bak`

## Scope

Issue 12 FIX step 4 only: every question on the R2 deleted list (interview.md lines 156-233) must be rendered unaskable — the run decides and reports these; it never asks them. Touches 5 files inside WF-2D's skill tree. No other file modified. The live repo (`~/work-999-setup`) was never touched.

## Files read in full

- `.claude/skills/spec-protocol/references/interview.md` (1654 lines at HEAD — the primary target; every deleted question verified)
- `.claude/skills/spec-protocol/SKILL.md` (1711 lines — step 6 listing, loops references, RULE 5 table)
- `.claude/skills/spec-protocol/references/loops.md` (552 lines — shape table, C0/C6 mentions, W row)
- `.claude/skills/spec-protocol/references/media-pipeline.md` (2223 lines read in ranges — section 9.4, loss ladder)
- `.claude/skills/spec-protocol/references/terminals.md` (484 lines — C0 reference)
- Spec: 999-master-fix-spec-20260815.md (629 lines)
- Ledger: FIX-LEDGER.md (full)
- Sibling evidence: WF-2B commit diffs, WF-2C commit diffs (boundary verification)
- Checker: `tests/interview/r5-shape-check.mjs` (DELETED array, verification alignment)

## The deleted questions and what was changed

Every entry in the R2 list (interview.md lines 156-233) was found and neutered:

| Deleted question | Change |
|---|---|
| **A4-in-default-mode** | Block A table row (line 1152): old question text replaced with "DELETED in DEFAULT mode (R2) — never asked." ADVANCED mode may still ask it per R2. |
| **A6 (usage window)** | Block A table row (line 1154): old question text replaced with "DELETED (R2) — never asked. Windows are knowable: DeepSeek direct is a topped-up balance with no window; Ollama Cloud and Agnes carry 5-hour windows (verify against the providers' current pages at run time); anything else the run's own watch measures." The `"W"` column changed from "Asked (interview A6)" to "MEASURED by the run, never asked." |
| **A7 (share to leave free)** | Block A table row (line 1155): replaced with "DELETED (R2) — never asked." The reserve is applied as a default; the explanatory paragraph below was updated to note both A7 and A8 are DELETED. |
| **A8 (backups)** | Block A table row (line 1156): replaced with "DELETED (R2) — never asked." The fallback table is READ from the router's wiring, never collected by question. |
| **Provider-path half of A2** | "Resolving which provider path" section (lines 1389-1393): the "Is your DeepSeek account the direct one — the one you topped up with a balance — or are you reaching DeepSeek through Ollama?" question text replaced with a RULE declaration: "the DeepSeek-direct-via-Ollama question is DELETED per R2 — the provider-path rule: when a DeepSeek direct account exists AND its balance is positive, DeepSeek direct is the builder path, period. A hosted DeepSeek (Ollama) is the fallback ONLY when direct is absent or unfunded — that state is REPORTED, never asked about." |
| **B1 (how many repos)** | Block B table row (line 1506): replaced with "DELETED (R2) — never asked. A brand-new project gets ONE brand-new repository, branch main, and the tool pushes." |
| **B2 (main branch, who pushes)** | Block B table row (line 1507): replaced with "DELETED (R2) — never asked." |
| **C0 (once or repeatedly)** | Block C table row (line 1541): replaced with "DELETED (R2) — never asked. The promise of this skill IS 'it runs by itself, continuously, until it is done.'" |
| **C1 (which file holds state)** | Block C table row (line 1542): replaced with "DELETED (R2) — never asked. The skill CREATES the ledger." |
| **C2 (approve merges)** | Block C table row (line 1543): replaced with "DELETED (R2) — never asked. Auto-merge is the product's promise." |
| **C3 (how long without you)** | Block C table row (line 1544): replaced with "DELETED (R2) — never asked. The five survival loops are sized by the Capacity Ledger at run time." |
| **C6-as-question** | Block C table row (line 1547): replaced with "DELETED as a question (R2) — WIRED as the backoff ladder, never asked." The old multi-clause question text replaced with the wired backoff ladder (10s→30s→1m→2m→4m→8m→15m, one-hour note, keep climbing). Policies defaulted: MEDIA_UNATTENDED_POLICY = placeholders-and-manifest, MEDIA_LOSS_POLICY = remake-once-within-budget, premium tier parked. |

**Consistency updates beyond the table rows:**

- SKILL.md step 6 (line 974): updated the old "A1–A8, B1/B2/B4 (B3 retired), C0–C6, D1–D4" listing to annotate every deletion in the list itself.
- Block B header (line 1492): heading changed to "Repositories (B1/B2 deleted R2; B4 stands, advanced mode only)"; operator-rulings note updated; "Before asking, go and look" paragraph updated to scope to B4.
- Block C "C0 is numbered zero" paragraph (lines 1549-1558): replaced with consolidated "C0, C1, C2, C3, C6 are all DELETED as questions (R2)" paragraph noting each is decided/wired, C4 defaulted, C5 rewritten.
- C0 consequence paragraphs (lines 1573, 1580): added references to C0/Cx being DELETED as questions, the run decides.
- C5 row (line 1548): rewritten per R2 — now shows the written done-condition yes/no form.
- C5 explanatory paragraph (line 1587): updated to mention rewritten form.
- loops.md: C0 question reference replaced with DELETED notices in header (line 5), shape table intro (line 19), and W row source (line 90): changed from "Asked (interview A6)" to "MEASURED by the run, never asked — A6 deleted (R2)."
- media-pipeline.md section 9.4 (lines 1566-1577): clause-on-a-question text replaced with defaulted-policy text — C6 is DELETED, policies are defaulted and stated in recap.
- media-pipeline.md loss ladder rung 2 (line 1674): "interview C6" reference changed to "R2 — C6 DELETED as question."
- terminals.md (line 119): C0 question reference replaced with "DECIDED by the run — C0 is DELETED as a question R2."

## What was deliberately NOT touched (slice boundaries)

- Ceiling arithmetic (interview.md lines 68-98) — owned by WF-2B (Issue 4). The ceiling arithmetic prices deleted questions at maximum, which is correct: C is a worst-case ceiling. The actual asked count will be lower because the run decides/reports instead of asking.
- Class table (interview.md lines 446-456) — owned by WF-2B/WF-2C reconciliation. The CHOICE-DYNAMIC/STATIC/CONDITION-DYNAMIC classification of deleted questions was not changed.
- "C6 is numbered last" reasoning — removed (paragraph replaced with consolidated deletion notice).
- SKILL.md beyond step 6's annotation — C0 references in the loops/law sections (lines 1210, 1327, 1339, 1439, 1694) are narrative C0-as-derivation references, not question-ask sites. They refer to the concept (zero vs many loops) which still exists as a run decision.
- references/capacity.md — verified: no A4/A6/A7/A8/C0/C1/C2/C3/C6/B1/B2 references present.
- references/gauntlet.md — verified: no deleted-question references present.
- tests/interview/r5-shape-check.mjs — the DELETED array already lists the correct keys matching Issue 12 FIX step 4's enumeration. No changes needed.
- Scripts (bash/shell) — none touched.
- No ledger, no boss-cron, no other skill, no live box.

## Verification

1. **Every R2 deleted question is marked DELETED** — grep for each key confirms the text now says "DELETED (R2)" in the table rows and, where applicable, in the explanatory paragraphs. Output: 12/12 found, each in the exact R2 specification.
2. **No old question text remains for any deleted question** — grep for the old wording patterns (e.g., "usage window", "share of your usage cap", "how many agents do you want", "backup for every role", "how many GitHub repositories", "reaching DeepSeek through Ollama", "run once while you are watching", "which file holds the state", "approve merges", "how long does it run without you", "busy signal") returns only DELETED markers or pre-existing non-question references in audience.md (the banned-words list) and interview.md's R2 section (the deletion declaration itself).
3. **C5 is rewritten, not deleted** — confirmed: C5 row now reads "REWRITTEN (R2) — not deleted." and shows the written done-condition yes/no form.
4. **SKILL.md step 6 lists deletions** — confirmed: line 974 annotates every R2 deletion.
5. **loops.md W row updated** — confirmed: "Asked (interview A6)" changed to "MEASURED by the run, never asked — A6 deleted (R2)."
6. **media-pipeline.md section 9.4 updated** — confirmed: clause-on-a-question text replaced with defaulted-policy text.
7. **terminals.md C0 ref updated** — confirmed: now says "DECIDED by the run — C0 is DELETED as a question R2."
8. **Backups stated at write time** — 4 backup files in `holding/backups/*.pre-slice4.bak`.
9. **Clean working tree before commit** — `git diff --stat` shows 5 files changed, 81 insertions, 80 deletions.

## The R5 checker's deleted-questions enforcement still works

The R5 shape checker (slice 5, commit 83272cc) enforces the DELETED array against spoken question text. Since slice 4 changes the interview document's question ROWS (the source text the checker validates interview fixtures against), and the checker's DELETED array uses phrase-based matching, the alignment between the checker's DELETED array and the interview.md text was verified — they match the R2 list.

## Claims → ledger-line mapping

| Claim | Where proven |
|---|---|
| All 12 R2 deleted questions marked DELETED | interview.md lines 1152, 1154, 1155, 1156, 1390-1393, 1506, 1507, 1541-1544, 1547 |
| SKILL.md step 6 annotated | SKILL.md line 974 |
| loops.md W/C0 refs updated | loops.md lines 5, 19, 22, 90 |
| media-pipeline.md 9.4/loss-ladder updated | media-pipeline.md lines 1566-1577, 1674 |
| terminals.md C0 ref updated | terminals.md line 119 |
| C5 rewritten not deleted | interview.md line 1548 |
| Backups created | 4 files in holding/backups/ |