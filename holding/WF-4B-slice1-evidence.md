# WF-4B slice 1 evidence — Issue 14 FIX step 1: operator machine doctrine (max 10 agents/workflow, max 50 workflows)

Commit: `fix/14-fanout` — cites `WAVE 4 DISPATCH 2026-08-16T20:12Z` (main FIX-LEDGER.md line 70).
Spec authority: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` Issue 14 FIX step 1 (line 305): "max 10 agents per workflow (5 builders + 5 blind critics = pairs of five), max 50 workflows (operator doctrine, not a product limit ... `references/capacity.md` currently says 30 and must be updated to 50) AND update SKILL.md's dispatch rule at lines 106-112, which still teaches 'UP TO 16 sub-agents per workflow' and 'Up to 30 workflows in parallel' — both superseded by this doctrine", plus "extra waves ONLY on a documented dependency (`NEW-WAVE-N` ledger line, Issue 15)". Also spec line 6 (execution model, same doctrine), line 370 (capacity.md 30->50 reconcile), Issue 15 FIX item 2 (line 323, NEW-WAVE-N line naming the dependency), PART 4 check 4 width (line 541).

## Files touched (slice scope only)

1. `.claude/skills/spec-protocol/references/capacity.md` — 30 -> 50 doctrine, 9 edit sites
2. `.claude/skills/spec-protocol/SKILL.md` — dispatch rule + two dependent 30-ceiling references, 3 edit sites

Backups (made before edits, PART 5 rule 4): `holding/capacity.md.bak-pre-14-doctrine`, `holding/SKILL.md.bak-pre-14-doctrine`.

## capacity.md edits (before -> after)

| Site | Before | After |
|---|---|---|
| L142-143 | "**30 workflows** is the hard ceiling per session (the operator's explicit rule) → maximum truly-concurrent agents = 30 × min(16, cores−2) = **300 on this machine**." | "**50 workflows** is the operator's machine doctrine per session (2026-08-16 — operator doctrine, NOT a product limit: no product cap exists on concurrent workflow runs; supersedes the 30-workflow figure) → maximum truly-concurrent agents = 50 × min(16, cores−2) = **500 on this machine**." |
| L235 | "capped at 30 workflows" | "capped at 50 workflows" |
| L244 | "the harness (300) governs long before the provider" | "the harness (500) governs long before the provider" |
| L332 | "WORKFLOW COUNT: <w ÷ k, ≤30>" | "WORKFLOW COUNT: <w ÷ k, ≤50>" |
| L390 | "harness = workflows × k (≤30 workflows)" | "harness = workflows × k (≤50 workflows)" |
| L429 | "Harness: 30 workflows × 10 = **300**." | "Harness: 50 workflows × 10 = **500**." |
| L432 | "**Governing number: 300 (harness).** → wave size 300, **30 workflows × 10 agents**" | "**Governing number: 500 (harness).** → wave size 500, **50 workflows × 10 agents**" |
| L438 | "noise against 300" | "noise against 500" |
| L759 | "capped at 30" | "capped at 50 (operator machine doctrine)" |
| L1045 | "Scenario (b) (harness 300)" | "Scenario (b) (harness 500)" |

## SKILL.md edits

1. L134 (RULE 2 DISPATCH bullet — the dispatch rule the spec names at lines 106-112): "UP TO 16 sub-agents per workflow — the operator's ceiling (ruling, 2026-08-14)" -> "UP TO 10 sub-agents per workflow — max 5 builders + 5 blind critics = pairs of five, the operator's machine doctrine (2026-08-16, superseding the 16-sub-agent ruling of 2026-08-14)"; "capped at 16 ... sixteen independent units get sixteen ... 3 agents while 13 more had independent work waiting ... how many of the 16 run ... correction of his number" -> 10/ten/7; "Up to 30 workflows in parallel" -> "Up to 50 workflows in parallel (the operator's machine doctrine, not a product limit — no product cap exists on concurrent workflow runs)"; appended: "Additional waves ONLY on a documented dependency — a `NEW-WAVE-N` ledger line naming which wave's output the new wave consumes (Issue 15)."
2. L226 (MAXIMUM-WORKFLOW RULE): "up to the 30-workflow ceiling" -> "up to the 50-workflow machine doctrine".
3. L418-420 (regular-Claude-Code defaults, "hard ceiling of 30 workflows") -> "machine-doctrine ceiling of 50 workflows (operator doctrine, not a product limit)".

## Verification (each claim cites its file line)

- `grep -n "30 workflow\|30 ×\|30-workflow\|≤30\|capped at 30\|harness 300\|(300)\|= 300\|300 on\|noise against 300" capacity.md SKILL.md` -> only hit is capacity.md L144's supersession note ("supersedes the 30-workflow figure"), which is the doctrine-correct historical reference, not a live ceiling. Zero live 30-ceilings remain in either touched file.
- `grep -n "UP TO 16\|Up to 30\|capped at 16\|sixteen independent\|how many of the 16\|of the 16"` in the two touched files -> zero hits. All 16-ceiling doctrine removed.
- NEW-WAVE-N clause present at SKILL.md L134.
- capacity.md:50 / SKILL.md:50 arithmetic consistent: 50 × min(16, cores−2) = 500 on the 12-core machine (capacity.md L144).

## Out-of-slice observations (recorded, NOT touched — other WF-4B slices / later waves)

Stale "30 workflows" or "UP TO 16 subagents" doctrine still lives OUTSIDE my two named files:
- references/agent-team.md L1289 ("30 workflows × 10 = 300")
- references/gauntlet.md L978 ("30 workflows ×")
- references/interview.md L1048-1054 ("UP TO 16 subagents — the operator's ruling, 2026-08-14", "hard ceiling 30 workflows")
- references/pipeline.md L100 ("≤ 30 workflows (operator hard ceiling)"), L167 ("30 workflows × 10 = 300")
- references/terminals.md L103 ("Up to 30 workflows, min(16, cores−2) sub-agents each")
- references/worked-example.md L73 ("30 workflows maximum"), L646 ("30 workflows (hard session ceiling) × 10")
- tools/capacity-resolver.sh L56, L76 (`WORKFLOW_CEILING=30`), L344 ("capped at 30 workflows")

These are the same superseded numbers. If any is in another slice's scope, that slice owns it; the conductor should sweep the remainder after Wave 4 slices land. In particular `WORKFLOW_CEILING=30` in tools/capacity-resolver.sh is a live arithmetic constant — the boss width check and the ledger would still compute 300-wide waves from it.
