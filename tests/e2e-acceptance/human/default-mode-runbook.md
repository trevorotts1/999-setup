# DEFAULT MODE (simple) runbook — FIX-019 human tier

Run twice: once under plain `claude`, once under `claude-nine`. One filled
`trace-template.json` per run. Brief (verbatim, same for every run):

> Build me a simple one-page website for a local coffee shop.

Expected target: Website. Mode answer in this run: **yes** to the defaults
offer (records DEFAULT MODE, the ledger line `INTERVIEW-MODE: simple`).

## Script

| # | Step | Record |
| --- | --- | --- |
| 1 | Start `claude` (or `claude-nine`) in the test workspace. Confirm the launcher carries no `CLAUDE_CONFIG_DIR` override for plain `claude` (spec 0.3). Note sessionId. | template header |
| 2 | Type `/spec-protocol`, press Enter. Candice wakes (setup-check surface). | — |
| 3 | Say the brief when asked what you want to build. | — |
| 4 | The count statement fires BEFORE question 1: "I will ask you at most <C> short questions…". On `claude-nine` (Website row, both modes priced): C ≤ 32, T = 19, two-number form. On plain `claude` the mode question is still asked (R1 is asked in BOTH modes — operator ruling 2026-08-14 supersedes the older "no defaults offer" line); the ceiling is the DEFAULT MODE wall of nine the moment the mode is chosen. | note C and T in the run notes |
| 5 | Question 1 of no more than <C>: the defaults offer (R1 — "I can make every technical decision myself… Or you can make the detailed calls with me"). Answer **yes** (accept defaults). The good-news line is REQUIRED before question 2: C drops to the R6 wall — nine. | frame `question-presented` BUILD_TARGET, `answer-submitted` typed, `answer-returned` typed; `countedSequence` entry BUILD_TARGET |
| 6 | Remaining R6 items, each spoken "Question <N> of no more than nine": artwork (answer: create it), artwork account (answer: operator handles it; note the overflow clause is stated), plan tier per wired unrecorded provider, then the small-plan collapse confirmations — one yes/no per collapsed block (B defaults: one repository, branch "main", no forbidden push targets; C defaults) — answer **yes** to each; then Block D: D1 example ("A page that shows the menu, hours, and a photo"), D2 winning bar (plain form), D4 don't-wants, D3 download consent ONLY when no capture tool was found, and the done-condition yes/no (answer: yes, the site is done when the page loads and shows the shop info). | one frame triple per question; `countedSequence` entries in order |
| 7 | Watch the counter: DEFAULT MODE never states or crosses a ceiling above nine. A fast-path yes or a condition that does not fire only lowers the run further under nine — never raises it. | `ceiling-count` check |
| 8 | Mid-interview clarification check (required leg): after any counted question is presented, type a plain question in Claude — "why do you need that?" — and confirm: a natural answer returns, then the SAME pending governed question is re-presented, NOT marked answered, count unchanged. | frames `clarification-asked`, `clarification-returned` |
| 9 | Input-mode check (required leg): every question in this run is answered `typed`. If a real approved mic path is used for any question, record that question's `inputMode` as `voice`; every other question records `typed`. No question records two modes. | `input-mode-per-question` check |
| 10 | Interview ends: recap of decided items ("here is what I decided; say the word to change any of it"), then the final write-through — the spec document and `CONTROL/LEDGER.md` exist on disk. Read both; set `verified: true` in the template only after reading. | frames `interview-complete`, `write-through` |

## Pass criteria (checked mechanically by record-run.js + QC replay)

1. Frames only from the twelve eventKind vocabulary; questionKey values
   from the active inventory (BUILD_TARGET only in this run — the R6 items
   are the skill's counted sequence, the single governed protocol key
   drives the companion surface).
2. `countedSequence` length ≤ 9 in DEFAULT MODE, mode question first.
   QC replays the sequence against `interview.md` (R1-first, R6 wall of
   nine, good-news line at the mode answer, numbered question form) and
   `candice-question-contract.md`.
3. Clarification round trip: clarification did not mark the pending
   governed question answered; the same question returned.
4. One input mode per question; terminal fallback (if it occurred)
   recorded `fallback-returned` with `inputMode: terminal`.
5. Write-through files verified on disk.
6. No secret, question text, or answer text anywhere in the filled
   template.

Any deviation recorded above is a FAIL for the affected leg — never a
narrative in the evidence.
