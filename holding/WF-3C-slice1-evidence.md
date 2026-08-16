# WF-3C slice 1 — STAGE-WIREFRAMES (Issue 8, FIX step 1) — evidence

Slice: WF-3C slice 1 of 5. Branch: fix/8-staged-pipeline (clone
/Users/blackceomacmini/work-999-setup-fix/WF-3C). One unit = one commit citing
WAVE 3 DISPATCH in /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 59.

## Claim 1 — STAGE-WIREFRAMES stage reference written

File created: `.claude/skills/spec-protocol/references/wireframes.md` (130
lines).

Contents, each traced to the spec:

- Stage ledger line PER PAGE: `STAGE-WIREFRAMES-<page>: <named sections,
  comma-separated>` — spec Issue 8 FIX step 1 line 183: "STAGE-WIREFRAMES:
  wireframes per page (layout skeletons from the design brief) before any
  code" (spec file lines 175-199, FIX step 1 first bullet at line 183).
- Pass bar verbatim from spec line 183: "Pass = layout skeleton per design
  brief with named sections." Restated mechanically in section 1 (four
  checks: every brief page has a wireframe; sections named; every section
  traces to the brief; no page code before the skeleton).
- Ledger line per page (spec line 183 "per page"; line 142's
  FUNNEL-PAGE-<name> pattern precedent: "each page's ledger lines name which
  page each asset serves").
- Wireframe output location `wireframes/<page>-wireframe.md` — the slot the
  sibling scaffolding template already reserves (templates/scaffolding/
  FILE-STRUCTURE.md lines 26-27, 39-40: "wireframes/ holds ONLY
  STAGE-WIREFRAMES output — the layout skeletons the build's sections must
  match (named sections per brief)").
- Boss-cron gate (section 3) — spec FIX step 2, lines 198-199: "the boss cron
  rejects a STAGE-BUILD line lacking the prior stage lines. The boss cron
  checks each stage's acceptance bar before admitting the next stage (stage N
  must pass before stage N+1 is opened)."
- Stage order consistent with siblings: scaffolding.md line 4 ("runs AFTER
  STAGE-WIREFRAMES (the layout skeletons exist)") and hero-images.md line 118
  (prior-stage list names STAGE-WIREFRAMES first).
- Fail-closed + freshness sections mirror the sibling pattern (scaffolding.md
  section 4, hero-images.md section 4).

## Claim 2 — no other files touched

`git status` before commit: only `?? holding/` and the new wireframes.md.
Sibling slices' files (scaffolding.md, hero-images.md, templates/) left
untouched.

## Claim 3 — commit

Commit message: "STAGE-WIREFRAMES: per-page layout-skeleton stage reference
(Issue 8 FIX step 1)" with body citing FIX-LEDGER.md line 59 (WAVE 3
DISPATCH 2026-08-16T17:07Z), one file changed.

## Verification commands (run at evidence time)

- `git -C /Users/blackceomacmini/work-999-setup-fix/WF-3C log --oneline -1` —
  shows the slice commit.
- `grep -c "STAGE-WIREFRAMES" references/wireframes.md` — 8 hits.
- Cross-reads: scaffolding.md (127 lines), hero-images.md (140 lines),
  FILE-STRUCTURE.md (40 lines) — all consistent with wireframes.md stage
  ordering and folder contract.
