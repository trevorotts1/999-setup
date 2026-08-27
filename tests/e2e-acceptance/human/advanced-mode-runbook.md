# ADVANCED MODE runbook — FIX-019 human tier

Run twice: once under plain `claude`, once under `claude-nine`. One filled
`trace-template.json` per run. Brief (verbatim, same for every run):

> Build me a simple one-page website for a local coffee shop.

Expected target: Website. Mode answer in this run: **no** to the defaults
offer (records ADVANCED MODE, the ledger line `INTERVIEW-MODE: advanced`).

## Script

| # | Step | Record |
| --- | --- | --- |
| 1 | Start `claude` (or `claude-nine`) in the test workspace. Confirm plain `claude` carries no `CLAUDE_CONFIG_DIR` override (spec 0.3). Note sessionId. | template header |
| 2 | Type `/spec-protocol`, press Enter. Candice wakes (setup-check surface). | — |
| 3 | Say the brief. | — |
| 4 | Count statement BEFORE question 1. On `claude-nine`: Website row — worst-case C = 32, T = 19 (two-number form; pre-statement reads may only LOWER C, never raise it). On plain `claude`: the mode question is still question 1 (R1 asked in BOTH modes — operator ruling 2026-08-14); the C actually spoken stays capped by the Website row after the mode answer. | note C and T |
| 5 | Question 1 of no more than <C>: the defaults offer (R1). Answer **no** (take the detailed calls). The no changes nothing arithmetically — the run stops tracking toward T and tracks toward C; that is said plainly with the remaining count. The fast-path-1 offer is NEVER re-asked after this no (R1). | frame `question-presented` BUILD_TARGET, `answer-submitted` typed, `answer-returned` typed; `countedSequence` entry BUILD_TARGET |
| 6 | A-block one at a time, at the advanced wall: A2 plan tier (per wired provider, measured count from the pre-statement read — the read may price 1 recall question instead of up to 3), then A3–A8. R2/R3 rules apply: A4 helpers cap (with the R2 plain explainer), A5 is the three-seat statement (planner, builder, checker — never two seats). For the Website target: the Step 1d branch (4 questions: Q1 confirm + Q2 + Q3 sequence). Every question numbered "Question <N> of no more than <C>" under the same C. | frame triple per question; `countedSequence` entries |
| 7 | "I don't know" path (required): on ONE branch question (e.g. the delivery-road question), answer "I don't know." The unsure answer records the documented default, marked as a default — the question is counted once, never re-asked. | frame triple; note the default chosen |
| 8 | Small-plan collapse may fire after block A (this brief IS a tiny plan): one yes/no confirmation per collapsed block (B defaults, C defaults). Answer **yes** to each. Say the good-news line per fast-path yes. A no would ask the block in full, still under C. | frame triple per confirmation |
| 9 | R7 items fire only when their trigger is live: helpers cap, three-seat keep-or-change, media model pick (three live options), C4 folder location, B4 never-push list — each condition-dependent, numbered under the same C. | frame triple per fired item |
| 10 | Block D always: D1 example, D2 winning bar, D4 don't-wants, D3 download consent only when no capture tool was found. | frame triple per question |
| 11 | Clarification round trip (required): mid-interview, type "why do you need that?" — a natural answer returns, then the SAME pending governed question is re-presented, NOT marked answered (spec 15), count unchanged. | frames `clarification-asked`, `clarification-returned` |
| 12 | Input-mode check: every question answered `typed`; any real approved mic path records `voice` for that question only; never two modes for one question. | `input-mode-per-question` check |
| 13 | Recap of decided items, then final write-through — spec document + `CONTROL/LEDGER.md` on disk, read back, `verified: true`. | frames `interview-complete`, `write-through` |

## Pass criteria (checked mechanically by record-run.js + QC replay)

1. Frames from the twelve eventKind vocabulary; questionKey values from
   the active inventory only.
2. `countedSequence` replayed by QC against `interview.md` ceiling
   arithmetic: mode question FIRST, ADVANCED MODE wall = Website row
   (C ≤ 32, never crossed; + announced artwork rise only, at measured
   size), every counted question numbered, ceiling changes announced
   before the next question.
3. Fast-path-1 offer never re-asked after the mode no (R1).
4. "I don't know" records the documented default, counted once, never
   re-asked.
5. Clarification did not mark the pending governed question answered;
   same question returned (spec 15).
6. One input mode per question.
7. Write-through files verified on disk.
8. No secret, question text, or answer text anywhere in the filled
   template.

Any deviation is a FAIL for the affected leg.
