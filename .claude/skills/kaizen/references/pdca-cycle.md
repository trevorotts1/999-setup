# Kaizen PDCA engine — exact cycle behavior

One Kaizen Cycle = one Plan -> Do -> Check -> Act pass. Many bounded cycles,
never one unbounded cycle.

## First cycle after Contract approval

1. Create Memory (folder, templates, registry entry).
2. Configure GitHub backup if approved.
3. Establish target access.
4. Determine scheduler (see scheduling.md).
5. Show what scheduler was selected and why.
6. Ask/confirm activation only if not already covered by Contract approval.
7. Start the first cycle IMMEDIATELY unless the user explicitly says to wait.
8. Do not wait for the first scheduled interval to prove the system works.
9. Finish the first cycle.
10. Update Memory.
11. Verify the scheduler is armed.
12. Print the recovery command.

## PLAN

Before changing anything:

1. Load `KAIZEN_CONTRACT.md`, `STATE.json`, `KAIZEN_MEMORY.md`.
2. Load recent cycle records, `BACKLOG.md`, `DECISIONS.md`.
3. Compute/update the Kaizen Fingerprint.
4. Inspect the current target AS IT ACTUALLY RUNS (Gemba): run the app, visit
   the website, walk the process — not only documentation.
5. Establish a fresh baseline (before-metrics for every candidate proof).
6. Identify candidate problems and opportunities — scan broadly.
7. Prioritize (see below).
8. Select no more than the active scope, normally 3–7 (default 5).
9. Define a small hypothesis for each selected item.
10. Define the Proof Gate for each selected item.
11. Decide whether each item is safe to act on autonomously.
12. Move anything requiring human judgment into "Needs approval".

### Candidate categories (use what is relevant, not a mandatory checklist)

correctness; broken functionality; security; privacy; reliability; error
handling; performance; accessibility; mobile/responsive behavior; visual
clarity; UX; forms; buttons/CTAs; checkout/payment; integrations; SEO;
analytics; copy/content clarity; onboarding; trust; tests; code quality;
maintainability; dependency health; deployment health; documentation; process
waste/bottlenecks; user value; business opportunity.

### Kaizen Fingerprint

Fields: git remote URL; current branch; current HEAD commit; dirty/clean
status summary; package lockfile hash; key config file hashes; deployment
URL; app/framework detection; last successful build/test commands; key
page/routes list where practical; last cycle ID; previous selected findings;
previous rejected findings; previous owner decisions. Do not hash the whole
filesystem.

**Hard rule:** never present an old idea as though it were newly discovered.
An old idea may be reconsidered only if: the target changed materially; the
prior blocker disappeared; a previous test became invalid; the user changed
the Contract; or new evidence materially changes priority. If reconsidered,
say why.

### Prioritization without over-restriction

Practical order (the user's direction helps ranking; critical findings can
outrank it):

1. catastrophic / security / data-loss / payment / reliability blocker;
2. broken core functionality;
3. high-impact user/business issue;
4. stated improvement direction;
5. usability / accessibility / performance / SEO / integration quality;
6. maintainability and technical debt;
7. cosmetic / nice-to-have.

Do not blindly apply when context says otherwise. Prefer issues with: high
impact, high confidence, low-to-moderate risk, clear proof, reversible
change, reasonable effort. High impact but highly uncertain → investigate
before modifying.

## DO

Code-backed projects:

1. Prefer isolated work: git branch and/or worktree.
2. Predictable name: `kaizen/<loop-short-id>/<cycle-id>`.
3. Make small reversible changes.
4. Follow existing project conventions.
5. Use tests first where practical.
6. Do not rewrite the whole product to solve a small issue.
7. Do not change unrelated formatting.
8. Do not modify secrets.
9. Do not use live customer/payment data for testing.
10. Keep each selected change attributable to a finding ID (KZ-<cycle>-<n>).

Non-code targets: make the smallest safe process/document/config change
permitted; preserve an undo path; record exactly what changed.

### Retry policy

Per selected improvement: diagnose failure; try a small number of justified
alternatives; default max 3 failed implementation attempts unless context
strongly justifies otherwise; after repeated failure, revert, record
learning, mark blocked/deferred. Do not spend the entire cycle fighting one
issue while ignoring the Contract scope.

## CHECK — mandatory

Never equate "I changed it" with "I improved it." Fresh evidence only.

Software proof sources: unit tests; integration tests; end-to-end tests;
lint; typecheck; build; Playwright; Claude `/run` and `/verify` when
appropriate and available; CUA/computer use where available; screenshots;
console errors; network errors; logs; security scanning; dependency checks;
benchmark before/after.

Website/funnel proof sources: page loads; important links work; CTA works;
forms submit in safe/test mode; checkout path tested WITHOUT a real charge;
mobile widths; keyboard/accessibility checks where appropriate; no new
console errors; no obvious broken layout; SEO metadata;
robots/canonical/sitemap where relevant; performance/Lighthouse where
available; analytics/tracking validation where accessible.

Process/document proof sources: fewer steps; fewer handoffs; less ambiguity;
complete required fields; reduced duplication; clearer ownership; no
contradictions; simulation/walkthrough succeeds.

Browser/visual targets: prefer observing the thing actually running. Tool
order: existing project test suite → existing Playwright/Cypress → Claude
`/run`/`/verify` → Playwright added only when justified → CUA when real
interaction is needed → static analysis only when running the app is
impossible. Do not add a large browser-testing dependency to test one
trivial text file. Browser baseline: desktop, mobile, core landing page,
navigation, form, CTA, auth if safe test credentials exist, checkout in
sandbox/test mode, console errors, obvious accessibility, broken links,
response/performance, screenshots for before/after.

Payments: official test/sandbox mode preferred; never a real charge to test;
never log full payment credentials; never store secret keys in Memory; live
configuration changes remain an approval boundary.

### Failed proof

Do not call it a win. Revert when safe. Record why it failed. Preserve useful
learning. Move a revised idea to backlog only if justified. Principle:

> Try -> measure -> keep winners -> discard or revert losers.

## ACT

Per selected item, mark one:

- **KEEP**
- **REVERTED**
- **DEFERRED**
- **NEEDS APPROVAL**
- **BLOCKED**
- **INVALID / NOT ACTUALLY A PROBLEM**

Then:

1. Commit successful safe work to the cycle branch if allowed.
2. Do not merge/deploy without required approval.
3. Update `KAIZEN_MEMORY.md`, `STATE.json`, `BACKLOG.md`, `DECISIONS.md` if
   needed.
4. Write the cycle record (template).
5. Update `evidence/manifest.json`.
6. Commit/push Kaizen Memory backup if configured (failure → `backup_pending`,
   never a cycle failure).
7. Produce the short user-facing summary (plain-language.md §cycle report).
8. Confirm the next run or explain why scheduling is paused.

## Stop rules

Every cycle stops on: success/completion of selected scope; approval
boundary; missing credential/access the user must provide; repeated failed
attempts; test environment impossible to establish; destructive action
required; external service outage; budget/time cap if configured; another
active cycle (lock); Contract conflict. "Continuous improvement" means many
bounded cycles, not one unbounded cycle.

## Safety and approval boundaries

Safe autonomous examples when the Contract permits: create branch/worktree;
add tests; fix a typo; fix broken UI behavior; improve error handling; repair
a dead link; improve accessibility markup; optimize a slow query in a branch;
add validation; improve a component; fix a failing unit test; improve SEO
metadata in a branch; run Playwright; run a build; commit tested branch
changes; update Kaizen Memory.

Stop-for-approval: merge to main/default/protected branch; production deploy;
destructive database migration; delete production data; rotate production
credentials; change payment processor; live Stripe product/price/webhook
changes; send real customer emails/messages; change broad access-control
policy; remove a core integration; irreversible infrastructure action; costly
external purchase/service action; legal/compliance decision requiring owner
judgment.

Security discovery outside the stated goal: prioritize it; explain it
simply; patch/test on a safe branch if within Permission; do not exploit real
users/systems; stop before dangerous production action.

## Borrowed improvement methods (selective use)

- **Five Whys** — for recurring or unclear failures. Stop when the root cause
  is sufficiently supported; do not mechanically ask five times.
- **Gemba-style inspection** — look at the thing as it actually exists and
  runs, not only at documentation.
- **Value-stream thinking** — for funnels, onboarding, business processes,
  multi-step user flows: look for unnecessary waiting, duplicate work,
  handoff failures, confusing steps, bottlenecks.
- **Small experiments** — small testable countermeasures over giant
  speculative rewrites.
