# WF-4B slice 2 evidence — Issue 14 FIX step 2: forced-width rule (CAPACITY RULE wiring)

Wave: WAVE 4, WF-4B (Issue 14 fan-out). Branch: fix/14-fanout.
Slice: FIX step 2 — "Forced-width rule: inside the usable number (provider ceiling less Law 44's reserve), never dispatch fewer streams than the work allows — and never pad either (RULE 2's two forbidden defects: TIMIDITY and PADDING, SKILL.md lines 106-112). Every spawned agent carries unique responsibility, evidence to inspect or work to perform, an explicit deliverable, and an acceptance criterion (the CAPACITY RULE from references/gauntlet.md §13.3, lines 962-975)."
Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (real ledger /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70).

## Spec citation (authoritative text)

- 999-master-fix-spec-20260815.md line 306: "Forced-width rule: inside the usable number (provider ceiling less Law 44's reserve), never dispatch fewer streams than the work allows — and never pad either (RULE 2's two forbidden defects: TIMIDITY and PADDING, SKILL.md lines 106-112). Every spawned agent carries unique responsibility, evidence to inspect or work to perform, an explicit deliverable, and an acceptance criterion (the CAPACITY RULE from references/gauntlet.md §13.3, lines 962-975)."
- Spec line 305 (FIX step 1, context): max 10 agents per workflow (5 builders + 5 blind critics), max 50 workflows.
- Spec line 307 (FIX step 3, enforcement context): boss cron width check.
- Spec line 541 (PART 4 check 4): "fan-out below scripted width (10 per workflow, pairs of five; up to 50 workflows — operator doctrine, not a product limit) without a recorded dependency line = violation. Padding past the work = violation."
- Spec line 496 (PART 2 doctrine): "Maximum use, no holding back — inside the usable provider number (ceiling − Law 44 reserve), never below what the work allows, never padded past it. Every agent carries: unique responsibility, evidence to inspect or work to perform, explicit deliverable, acceptance criterion."

## CAPACITY RULE source (gauntlet.md §13.3)

- references/gauntlet.md §13.3 header at line 962: "### 13.3 THE IMPORTANT CAPACITY RULE (verbatim — the operator's own words)".
- Verbatim rule lines 964-969: "Provider capacity is NOT an instruction to maximize agent count. Do not spawn additional agents simply because DeepSeek or OpenRouter can support them. Every spawned agent must have: unique responsibility; evidence to inspect or work to perform; an explicit deliverable; an acceptance criterion. More agents are useful only when the work can actually be decomposed into independent valuable tasks. Quality per agent matters more than raw agent count."
- Cut rule lines 971-973: "A wide ceiling is permission, never instruction. A workflow that cannot name what each of its agents owns is over-wide by definition — cut it to the agents that can be given the four things above."
- Duplicate doctrine in references/capacity.md lines 108-114 (same verbatim quote).

## Defect found (full-file read, not grep)

SKILL.md's dispatch rule (RULE 2, lines 93-140) carried the two forbidden defects (TIMIDITY/PADDING at old line 112) but had NO forced-width statement and NO CAPACITY RULE / four-properties wiring. `grep -n "13.3\|CAPACITY RULE\|unique responsibility\|acceptance criterion\|explicit deliverable"` over SKILL.md returned zero matches before the edit; capacity.md carries the rule at 108-114 and gauntlet.md at 962-975, but the dispatch rule never cited them. A spawned agent therefore had no written guarantee of the four properties — the Issue 14 QC bar ("every agent has the four required properties", spec line 311) was unwireable from the dispatch rule itself.

## Change applied (one unit)

File: .claude/skills/spec-protocol/SKILL.md (WF-4B working copy, branch fix/14-fanout, base dc688c7 = origin/main).
Two blocks inserted after the ceiling/dispatch ordering paragraph (old lines 107-109), before the superseded-defaults paragraph:

1. THE FORCED-WIDTH RULE — new lines 111-119: width forced to the work; never fewer streams than the work allows, never pad; TIMIDITY and PADDING named as the two forbidden defects (definitions mirror old line 112's); under-width = dispatchable unit waits while capacity idle; padded = agent cannot be given the four properties; both are boss-cron width-check violations (PART 4 check 4 — fan-out below scripted width without dependency line, and padding past the work; spec line 541).
2. THE FOUR PROPERTIES — new lines 121-131: every spawned agent MUST carry (1) unique responsibility, (2) evidence to inspect or work to perform, (3) explicit deliverable, (4) acceptance criterion — binding, cited to references/gauntlet.md §13.3 (lines 971-973 for the over-wide cut rule). Agent that cannot be given all four is NOT spawned; width arithmetic beyond the four-property test is padding.

No other content touched. Existing supporting text already consistent: RULE 2 two-defects line (new line 134), DISPATCH INTELLIGENCE SIZE DOWN (line 186: "Padding a dispatch to reach the ceiling is the same violation as timidity — S4 checks the ARITHMETIC, not the ceiling"), S4 width arithmetic (line 220), gauntlet.md §13.3 verbatim (lines 964-969), capacity.md 108-114.

## Line numbers (post-edit, verified by read-back)

- SKILL.md 111-119: THE FORCED-WIDTH RULE block.
- SKILL.md 121-131: THE FOUR PROPERTIES block.
- SKILL.md 134: pre-existing TIMIDITY/PADDING defects line (unchanged).
- SKILL.md 186: pre-existing padding=timidity judgment (unchanged, consistent).
- SKILL.md 220: S4 width arithmetic (unchanged).
- gauntlet.md 962-975: §13.3 CAPACITY RULE (source).
- capacity.md 108-114: CAPACITY RULE duplicate (source).

## Verification

- Full-file read of SKILL.md lines 93-140 (RULE 2) before and after the edit; edit anchors verified unique.
- Post-edit read-back of lines 104-139 confirms both blocks placed and no adjacent text altered.
- diff vs HEAD: exactly the two inserted blocks (working tree otherwise clean).
- No other WF-4B slice had edited SKILL.md before this unit (working tree clean at base; holding backups from a same-minute slice-1 backup are byte-identical, SKILL.md.bak-pre-14-doctrine == SKILL.md.bak-pre-slice2-forced-width).
- Boss cron width check already stops padding (spec PART 4 check 4 line 541) — this edit wires the doctrine into the dispatch rule it was missing from; no boss-cron change needed for this slice (WF-4E owns the boss).

## Backup

holding/SKILL.md.bak-pre-slice2-forced-width (byte-identical to holding/SKILL.md.bak-pre-14-doctrine taken by the parallel slice).
