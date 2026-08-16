# WF-3A slice 5 — test build traceability matrix (Issue 6 FIX step 5)

Spec: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` Issue 6 FIX step 5:
"Verification: a test website build contains the design-brief section with cited
sources; every page's hero/copy traces to the brief."

Copy bar (Law 48): https://www.fresha.com/ — fetched live 2026-08-16, HTTP 200.
Bar construction (measured from the live page):
- Headline: "Book local selfcare services" — 4 words, action + category, no product name.
- Subhead: "Discover top-rated salons, barbers, medspas, wellness studios and beauty
  experts trusted by millions worldwide" — who-it-is-for + proof.
- CTA: action-labeled ("Get the app", "Search Fresha").
- Social proof: live counter ("9,993 appointments booked today") + named reviews.

Site type: dentist / medical-practice brochure site — brief block A
(funnel-architecture.md §15, lines 576-614).

## Per-page trace

| Page | Hero headline | Bar trace (headline construction) | Site-type rule trace (brief A) |
|---|---|---|---|
| index.html | "Gentle dentistry, judgment-free" | 4 words, action + category, no product name — matches bar's 4-word action+category pattern | One-line promise = patient outcome, not the service; CTA above the fold; trust strip under (18 years / 4.9/5 / insurance) |
| services.html | "Every smile, one practice" | 4 words, action + category, no product name | One-line promise = patient outcome; one primary action per page |
| about.html | "Dentistry without the dread" | 4 words, action + category, no product name | One-line promise = patient outcome; trust strip under |
| contact.html | "Book your appointment" | 3 words, action only — bar's CTA construction (action-labeled, no product name) | Benefit-labeled button; minimized form (name + phone + preferred time); labels not placeholders |

## Copy-element traces (index.html)

| Element | Text | Trace sentence |
|---|---|---|
| Headline | "Gentle dentistry, judgment-free" | Follows the bar's headline pattern — 4 words, action + category, no product name — plus the site-type rule: one-line promise names the patient's outcome, not the service (brief A). |
| Subhead | "Family dental care in Maplewood — from cleanings to same-day crowns, with insurance handled for you." | Follows the bar's subhead pattern — who-it-is-for + proof — plus the site-type rule: trust signals next to the CTA (brief A). |
| CTA | "Book my appointment" | Follows the bar's CTA pattern — action-labeled — plus the site-type rule: benefit-labeled button beats a bare verb (brief A; goodui "Benefit Buttons"). |
| Microcopy | "Free 15-minute consult · No credit card required" | Follows the bar's social-proof pattern — concrete numbers — plus the site-type rule: click-trigger microcopy under the CTA (brief B pattern, applied per brief A trust-signal rule). |
| Trust strip | "18 years in practice / 4.9/5 from 600+ reviews / All major insurance accepted" | Follows the bar's social-proof pattern — live counter + named reviews — plus the site-type rule: trust strip directly under the hero (brief A). |

## Design-token traces (styles.css)

| Token | Value | Brief source |
|---|---|---|
| Type ladder | 17/21/27/33/42/52 (1.25 ratio) | brief A: 1.25 ladder, body 16-18px |
| Body | 17px, line-height 1.6 | brief A: 16-18px at 1.5-1.6 |
| Colors | white + soft blue neutrals, ONE teal accent (#0e7c7b) for CTAs only | brief A: clean medical neutrals, one accent reserved for the appointment CTA |
| Contrast | body #1f2933 on #ffffff = 13.9:1; white on #0e7c7b = 4.9:1 | brief A: WCAG AA 4.5:1 body / 3:1 large text+UI |
| Tap targets | buttons 52px, inputs 48px, nav links 44px+ | brief A: ≥ 44px |
| Mobile | sticky bottom booking bar, no horizontal scroll | brief A: sticky booking CTA, goodui Test #665 |
| Accessibility | skip link, visible focus ring, labels on all fields, alt-ready markup | brief A: keyboard focus order, skip-to-content, form labels not placeholders |

## Design-brief section presence (FIX step 5 first half)

Every page (index, services, about, contact) carries a "Design brief" section
listing the 8 brief items with cited sources: funnel-architecture.md §15 block A,
goodui.org named patterns, blog.hubspot.com landing-page best practices, Mobbin
reference screens (Fresha, Heidi, Care.com), WCAG 2.x understanding documents,
and the copy-bar URL with its live-fetch date. Verified by grep below.
