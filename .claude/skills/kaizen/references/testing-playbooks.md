# Kaizen testing playbooks — per target type

## The automated test suite

The skill ships deterministic, fixture-only tests (`.claude/skills/kaizen/tests/`).
They never touch real Downloads, the real `~/.claude`, launchd, or Task Scheduler.

Run everything:

```bash
bash .claude/skills/kaizen/tests/run-all-kaizen-tests.sh
```

Suites:

| Suite | Covers |
|---|---|
| `run-kaizen-tests.sh` | core sections 7.1–7.13 (root resolution, registry, contract, PDCA, scheduler, launchd, plain language, companions, secrets, frontmatter, memory rules) |
| `walkthroughs.sh` | six end-to-end scenarios A–F |
| `fix01-resolver-tests.sh` | memory-root resolution on all three platforms |
| `fix02-init-tests.sh` | deterministic initializer |
| `fix03-registry-tests.sh` | REGISTRY.json schema, migration, lookup |
| `fix04-lock-tests.sh` | atomic token-based cycle lock |
| `fix05-validator-tests.sh` | strict memory validation |
| `fix06-secret-tests.sh` | secret scanner across credential families |
| `fix07-schedule-tests.sh` | scheduler decision engine |
| `fix08-launchd-tests.sh` | launchd install/run/ctl with fake launchers |
| `fix09-windows-notes.sh` | Windows Task Scheduler scripts (structural where pwsh is absent) |
| `fix10-installer-tests.sh` | bundled-skill installer idempotency |
| `fix11-pdca-behavioral.sh` | two-cycle PDCA + fingerprint behavior |
| `fix12-contract-tests.sh` | contract + activation behavior |
| `fix13-provenance-tests.sh` | companion-skill provenance |
| `fix14-static-tests.sh` | static and cross-platform checks |

The runner fails if any suite file is missing — a skipped suite is a gap, not a pass.
CI runs the same suites on macOS and Ubuntu plus the PowerShell self-test on a
Windows runner (`.github/workflows/kaizen-tests.yml`).

## Web app / SaaS

Look at: correctness; auth; permissions; error states; loading states;
mobile; accessibility; forms; API failures; security; performance; tests;
deployment; onboarding; billing/integration where relevant.

Proof: tests + build + user-flow check (Playwright/CUA where available).

## Marketing website

Look at: broken pages/links; mobile; readability; CTAs; forms; trust; SEO;
metadata; accessibility; performance; analytics; conversion path;
security/config.

Proof: Playwright/CUA + links + console + mobile widths + accessibility +
performance where relevant.

## Funnel

Look at: start-to-finish user journey; CTA continuity; forms; thank-you/next
step; tracking; mobile; page speed; broken integrations; lead routing; offer
clarity.

Proof: form/CTA path + tracking + mobile + conversion-related checks.

## Mobile app

Look at: launch; navigation; permissions; offline/error behavior; crash
paths; layout; accessibility; network calls; auth; store/build concerns where
accessible.

## Business process

Look at: unnecessary steps; repeated entry; handoffs; unclear ownership;
waiting; error-prone decisions; missing feedback; missing standard work;
measurable outcome.

Proof: fewer steps, fewer errors, less time, clearer ownership.

## Document / process document

Look at: contradictions; missing steps; unclear language; outdated
references; duplicate sections; ambiguous responsibility; test via
walkthrough.

Proof: completeness, clarity, fewer contradictions, review checklist.

## Browser testing baseline (important web targets)

Consider: desktop; mobile; core landing page; navigation; form; CTA; auth if
test credentials/safe test path exist; checkout in sandbox/test mode; console
errors; obvious accessibility; broken links; response/performance;
screenshots for before/after.

## Payments

- Prefer official test/sandbox mode.
- Never run a real charge just to test.
- Never log full payment credentials.
- Never store secret keys in Memory.
- Live configuration changes remain an approval boundary.
