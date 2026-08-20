# Research sources and licensing boundaries

999-setup is MIT. License hygiene is mandatory.

## Safe to vendor with MIT attribution

- `nathanksou/eli5` — MIT (vendored, see its THIRD_PARTY_LICENSE.md)
- `luchasarie/bro-skill` — MIT (vendored, see its THIRD_PARTY_LICENSE.md)
- `Jcapathy/loop-goal-skills` — MIT (concepts only, not vendored)
- `drivelineresearch/autoresearch-claude-code` — MIT (concepts only)
- Relevant MIT portions of `kenjudy/pdca-agentic-coding-framework` (source
  portions MIT; documentation/prompts CC BY 4.0)

## Do NOT copy directly

- `AgentPilotLab/loop-goal-runner` — non-commercial license. Concepts only:
  goal-scoped state; objective Proof Gate; stop conditions; max attempts;
  credential boundaries; external-service boundaries; human approval
  boundary; no completion without fresh evidence.
- `NeoLabHQ/context-engineering-kit` (Kaizen) — GPL-3.0. Concepts only:
  Kaizen as a selectable analysis method; Gemba; Five Whys; A3/root-cause
  thinking; waste/value-stream analysis.

## Sources whose ideas are independently reimplemented here

- `kenjudy/pdca-agentic-coding-framework` — explicit PDCA phases; search/
  analyze before changing; small testable increments; completeness check;
  retrospection; bounded retry cycles; persistent cross-session tracking.
  NOTE: its human STOP gates after every phase are deliberately NOT adopted —
  Kaizen is more autonomous inside the approved Contract.
- `Jcapathy/loop-goal-skills` — persistent state as a "cockpit"; durable
  memory; Plan-Build-Test-Reflect-Improve cadence; each cycle starts
  smarter.
- ASQ PDCA cycle (https://asq.org/quality-resources/pdca-cycle) — plan a
  change, test it, check actual results, act on what was learned, repeat.
- Lean Enterprise Institute (https://www.lean.org/) — continuous improvement
  as an ongoing scientific learning process, not a one-time audit.

## Rules

- High-level ideas may be independently reimplemented. Never copy exact
  prompt text from GPL-3.0, non-commercial, or CC BY sources without
  attribution.
- Prefer pinning vendored upstream content to a specific commit hash rather
  than silently tracking moving `main`.
- Repo-level `THIRD_PARTY_NOTICES.md` lists every vendored source: copyright/
  author, license, files vendored, upstream URL, pinned commit.
