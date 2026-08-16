# WF-4D Slice 1 Evidence — Issue 17 QC Protocol Wiring (FIX)

Commit: `4db5951` on `fix/17-qc-protocol` (clone /Users/blackceomacmini/work-999-setup-fix/WF-4D), with the slice-1 FIX commit following it
Cites: WAVE 4 DISPATCH 2026-08-16T20:12Z — /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70
Branch base: dc688c7 (FIX-LEDGER: WF-3A slice 2, WAVE 3 REDISPATCH)
Backups: holding/*.bak-wf4d-s1 (7 files, pre-commit state)

## Slice mandate
"FIX: the QC protocol in PART 1 of the spec is THE one way — a blind critic
reviews the work; PASS = completely exceeds expectation; FAIL = looped to the
builder with the exact finding (max 20 fix-loop cycles, then escalation with
full finding history). Law 49 (critic sees the work, never the effort), Law 7
(judge never built it — no self-QC), Law 50 (the bar wins by default). Wire
this into the spec-protocol skill so every item QC follows the protocol."

## Source of truth (spec, /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md)
- Issue 17 FIX, line 386: "The QC protocol in PART 1 of this document is THE one way: a blind critic reviews the work; PASS = completely exceeds expectation; FAIL = looped to the builder with the exact finding (max 20 fix-loop cycles, then escalation with full finding history). Law 49 (critic sees the work, never the effort), Law 7 (judge never built it — no self-QC), Law 50 (the bar wins by default)."
- PART 1 item 1, line 464: every deliverable judged by a critic agent — never by its builder.
- PART 1 item 2, line 465 (Law 49): critic receives ONLY deliverable + bar; provenance stripped — no timestamps, authorship, history, builder identity, builder reasoning, effort narrative.
- PART 1 item 3, line 466 (Law 7): judge never built the item; different model family rule.
- PART 1 item 4, line 467 (Law 48 + answer-key): named/fetchable bar; answer-key rendered BINARY pass/fail; lead writes it at spec-lock BEFORE build; lives as named section of execution plan (document 16); objectivity guard — unrunnable line is BLOCKED per Law 50.
- PART 1 item 5, line 468: "PASS = 'completely exceeds expectation.' The single pass standard. Not 'acceptable', not 'meets spec'."
- PART 1 item 6, line 469: "FAIL = looped. The item returns to the builder WITH THE CRITIC'S EXACT FINDING. Max 20 fix-loop cycles per finding (operator ruling 2026-08-14). After 20: escalation to the operator with the FULL finding history — never a quiet give-up, never a relabeled pass."
- PART 1 item 7, line 470 (Law 50): bar wins by default; BLOCKED/INFEASIBLE/LIMIT REACHED never relabeled PASS.
- Issue 17 QC bar, line 388: "every record shows a blind critic, a named bar, a binary verdict, and the loop-or-pass outcome; zero self-QC."

## Defects found against the bar (each cited)

### D1. "PASS = completely exceeds expectation" — the pass standard — absent from the skill
Census: `grep -rn "exceeds expectation"` across .claude/skills/spec-protocol → zero hits (only my insertion later). The skill taught "at or above 8.5 the unit passes" (PROMPT-QC-INSTRUCTIONS.md lines 4-5, pre-edit) — an "acceptable/meets-spec" pass standard, the exact defect Issue 17's PROBLEM names ("'good enough' passes", spec line 382).
FIX (initial, this slice's commit): references/pipeline.md Stage 2 opening anchor — "PASS = completely exceeds expectation — the ONE pass standard (Issue 17, PART 1 item 5; binding on every verdict)". Defines exceed-expectation against the bar; "meets the bar exactly" is ITERATE with the returned gap "the bar is matched, not exceeded — exceed it"; answer-key case (PART 1 item 4) — binary PASS IS the exceed standard when the surface is a checkable line; D1/D2 client answers (interview.md Block D) seed the bar, never lower the judge's standard (Law 43).
FIX (completion, after blind-critic FAIL): the initial fix left the conflicting 8.5 pass lane VERBATIM in PROMPT-QC-INSTRUCTIONS.md lines 4-5 and pipeline.md's "The 8.5 gate" section — the dual-standard defect the critic named. Both sites now teach ONLY the binary blind-critic protocol: "The 8.5 gate" section is "The ONE way — a blind critic, a binary verdict" (verdict binary, no numeric pass lane; PASS = completely exceeds expectation; FAIL = looped with the exact finding, max 20 cycles, full-history escalation; Law-50 states never relabeled PASS; the ten categories are the critic's rubric surface mapping to the binary verdict); PROMPT-QC-INSTRUCTIONS.md opening rewritten to the same ONE-way language; the remaining numeric-pass residue in pipeline.md removed ("Passing the 8.5 gate" → "A PASS", Gate 1 and Gate 3 comparative text, Stage 3 "Below 8.5" → "On FAIL", "re-scores" → "re-judges"). Post-fix: zero "8.5" hits in both files.

### D2. Fix loop cap drift: "3-cycle cap" vs the mandated 20
Census (pre-fix): "3-cycle cap (Rule 3.22)" in references/loops.md lines 208/226/231/238/291; references/gauntlet.md lines 505/666/1018; references/documents.md lines 216-217 ("cycle count: n of 3"); pipeline.md "three failed loops" (Stage 3, pre-sibling) + Named Stop 8 "Three failed fix attempts on the same finding" (pipeline.md line 926). The spec mandates max 20 cycles (line 386, 469 — operator ruling 2026-08-14).
FIX (mine): Named Stop 8 → "Twenty failed fix loops on the same finding (Rule 3.22 — 20 cycles per finding, operator ruling 2026-08-14)… escalates WITH THE FULL FINDING HISTORY".
FIX (sibling slices 3/5, verified in commit 4db5951 tree): loops.md register rows + B2H-vs-cap table + Gate loop (bounded at twenty), gauntlet.md §6a worked example, §9 fix-cap reconciliation, §13.5/§13.6, documents.md verdict blocks "cycle count: n of 20" + full history, pipeline.md Stage 3 (bounded-and-recorded + escalation), PROMPT-QC-INSTRUCTIONS.md. Post-fix census: zero "3-cycle"/"n of 3" residue (`grep` rc=1).

### D3. QC RECORD lacked the blind-critic enforcement (Law 49)
The record (sibling slice 2's pipeline.md Stage 2 addition + workflows.md schema + PROMPT-QC-INSTRUCTIONS.md) checked judge-seat-differs (Law 7) but nothing attested provenance stripping — Law 49's mandate (spec line 465). The Issue 17 bar's "every record shows a blind critic" was only half-provable mechanically.
FIX (mine): record gains a sixth field `provenance=<STRIPPED|VIOLATION>` + mechanical check 6 in pipeline.md Stage 2, PROMPT-QC-INSTRUCTIONS.md (canonical source synced), references/documents.md verdict-block text. workflows.md's mechanical `recordShapeOk` (sibling) remains as-is — noted in observations, not touched (parallel-writer separation).

### D4. Answer-key contract (PART 1 item 4) unwired
Census: "answer-key" absent from the skill (only my later references). The bar-when-no-product-exists machinery — binary AK lines, written at spec-lock before build, locked with the wave table, living as a named section of document 16, objectivity guard — had no home.
FIX (mine): references/documents.md Document 16 gains "THE ANSWER KEY" fold: WHO/WHEN (lead, at spec-lock, before any build dispatch, locks with the wave table), WHERE (named section of the execution plan), line format `AK-<NN>: <checkable requirement> -> PASS if <observable condition>, else FAIL` with the spec's example AK-01, OBJECTIVITY GUARD (unrunnable line = BLOCKED per Law 50, rewritten by lead before build), and the bar-fetch citation rule for QC RECORDs. "What makes it wrong" gains the unrunnable-line case.

### D5. The operating loop's VERIFY station carried no QC-protocol binding
§14 station 11 said "REQUIREMENT + ACTUAL OUTPUT + OBJECTIVE BAR → INDEPENDENT VERIFIER" but nothing named the protocol's pass standard, blind stripping, record obligation, or fail-closed rule; station 13's repair carried no loop-cap/escalation language.
FIX (mine): gauntlet.md §14 station 11 gains the protocol binder (blind, Law 49; never built it, Law 7; PASS = completely exceeds expectation; QC RECORD mandatory; un-runnable comparison = BLOCKED, Law 50). Station 13 gains the repair-loop contract (exact finding, max 20 cycles, full-history escalation, never relabeled pass).

## Files touched (all in .claude/skills/spec-protocol/ of the WF-4D clone)
1. references/pipeline.md — Stage 2 PASS-standard anchor (D1), QC RECORD 6th field provenance + check 6 (D3), Named Stop 8 twenty-cycle (D2). [mine]
2. PROMPT-QC-INSTRUCTIONS.md — QC RECORD format synced to six fields + check 6 (D3). [mine]
3. references/documents.md — verdict-block record text (D3), Document 16 THE ANSWER KEY fold + what-makes-it-wrong (D4). [mine]
4. references/gauntlet.md — §14 stations 11/13 protocol binding (D5). [mine]
5. SKILL.md, references/loops.md, references/workflows.md — sibling slices 2/3/5 edits (fix-loop mechanics, QC-record enforcement, self-audit census), verified consistent, committed in same unit. [sibling]

## Verification performed (all commands run, outputs above)
1. `git status` before edits: concurrent-slice uncommitted work detected in 5 shared files — read the full diff before touching; no sibling edit clobbered.
2. Full-file reads (never grep-for-judgment): spec lines 380-390 + PART 1 lines 460-474; SKILL.md (1687 lines); pipeline.md (947); gauntlet.md (1244); PROMPT-QC-INSTRUCTIONS.md; documents.md; loops.md; execution-architecture.md; interview.md Block D region; workflows.md diff.
3. Post-fix census: `grep -rn "3-cycle|n of 3|three failed|bounded at three"` → rc=1 (zero residue). `grep -c "provenance=STRIPPED"` → pipeline.md 1, PROMPT-QC-INSTRUCTIONS.md 0, documents.md 1. `grep -c "completely exceeds expectation"` → pipeline.md 3.
   Census correction (blind critic found the non-reproducing claim): PROMPT-QC-INSTRUCTIONS.md carries the `provenance=<STRIPPED|VIOLATION>` FIELD (line 39, one hit for the field pattern) but no `provenance=STRIPPED` LITERAL — its mechanical-check text writes "provenance=` is STRIPPED". Reported here as 1 for the literal was wrong; actual literal count is 0. The claim's substance — provenance attests the blind critic in all three files — stands via the field (PROMPT) and the literal (pipeline.md 1, documents.md 1).
4. `bash -n tools/ledger.sh` and `bash -n tools/anchor.sh` → syntax OK (record-write path and reconcile path intact).
5. `git show --stat HEAD` — commit 4db5951: 6 files, 140 insertions, 32 deletions; branch fix/17-qc-protocol.

## Observations (out of slice scope, recorded only)
- O1: workflows.md judge-brief/schema (sibling slice 2) does not yet carry the `provenance` field in its mechanical `recordShapeOk` — the schema requires judge/bar/bar_fetch/outcome/self_qc. With the record's field 6 landed in pipeline.md/PROMPT-QC-INSTRUCTIONS.md/documents.md, workflows.md is the next seam; not edited here (one unit = one commit per slice; parallel-writer discipline).
- O2: post-commit SKILL.md shows a further sibling edit (self-audit census text "six mechanical checks") — uncommitted, not mine, left untouched.
- O3: the spec's QC-bar verification (blind critic judging a sample of item QC records) is exercised by sibling slice 5's evidence; no duplicate run here.
- O4 (FIX): the dual-standard defect named above lived in BOTH files the initial fix touched (PROMPT-QC-INSTRUCTIONS.md lines 4-5, pipeline.md "The 8.5 gate" section) — the critic's blind FAIL was exact. The completion commit removes the 8.5 pass lane from both; zero "8.5" residue in the two files post-fix.

## Verdict
VERDICT: DONE
