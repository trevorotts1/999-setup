# Kaizen testing playbooks — per target type

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
