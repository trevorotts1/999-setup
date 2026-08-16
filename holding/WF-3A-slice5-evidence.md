# WF-3A slice 5 — FIX steps 4-5 verification evidence

Spec: Issue 6 FIX steps 4-5, `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md` lines 144-145.
Branch: `fix/6-design-brief`. Clone: `/Users/blackceomacmini/work-999-setup-fix/WF-3A`.
Dispatch: WAVE 3 DISPATCH 2026-08-16T17:07Z.

## Verdict

**DONE** — FIX step 4 landed in both reference files (verified by grep at HEAD);
FIX step 5 test build exists, renders, contains the design-brief section with
cited sources on every page, and every page's hero/copy traces to the brief.

## FIX step 4 — landing verification (spec line 144)

Spec: "The fix lands in the spec-protocol website/funnel pipeline sections
(`references/interview.md` Step 1d website/funnel branches, lines 665-739, and
`references/funnel-architecture.md`). `references/funnel-architecture.md` MUST
carry these six items so completeness is checkable: (1) FUNNEL-PAGES inventory,
(2) per-page structure, (3) EMAIL-SEQUENCE, (4) INTEGRATION, (5) TRACKING,
(6) staged-pipeline + image-lane binding. The design brief becomes a mandated
step with its own ledger line (`DESIGN-BRIEF: <sources>`)."

### interview.md Step 1d website/funnel branches

- Line 708 (website branch): "After the shape is confirmed, the DESIGN-BRIEF
  step runs first before any page build (see `funnel-architecture.md` §Design
  Brief and Mobbin Check) — the MOBBIN-CHECK is its first action..."
- Line 750 (funnel branch): same DESIGN-BRIEF-first mandate.
- Lines 755-787: DESIGN-BRIEF gate — mandatory ledger line
  `DESIGN-BRIEF: <sources>` (line 761) before ANY funnel page build; brief
  collects researched conversion patterns, the named copy-bar example page
  (Law 48), and reference sites; brief written to document 1 (Law 39 closed
  list); pointer to funnel-architecture.md §16.

### funnel-architecture.md — six required items (spec line 144)

| # | Required item | Location | Verified |
|---|---|---|---|
| 1 | FUNNEL-PAGES inventory | §16 Stage 1, line 797 | Default page-set table for all 5 funnel types; overridable only by client-decision ledger line |
| 2 | per-page structure | §16 Stage 2, line 817 | `FUNNEL-PAGE-<name>: hero + copy + CTA + form fields (<fields> post to <dest>)`; per-page copy rule with trace sentences |
| 3 | EMAIL-SEQUENCE | §16 Stage 3, line 834 | 5 emails per type (confirmation, value, pitch, close, follow-up); `FUNNEL-EMAIL-N` ledger line format |
| 4 | INTEGRATION | §16 Stage 4, line 855 | `FUNNEL-INTEGRATION-<name>` lines; GHL form posts; GHL automations; n8n only with external trigger; PAYMENT-CONTRACT gate |
| 5 | TRACKING | §16 Stage 5, line 876 | `FUNNEL-TRACKING: <events>`; named events pageview, submit, purchase, email-open, email-click |
| 6 | staged-pipeline + image-lane binding | §16 Stage 6, line 886 | Same staged pipeline + same image lane, no per-page exceptions; all six STAGE-* apply to every funnel page; funnel-first build order; shared manifest |

DESIGN-BRIEF mandated step with own ledger line: interview.md line 761 +
funnel-architecture.md lines 718, 736, 784.

## FIX step 5 — test website build (spec line 145)

Spec: "Verification: a test website build contains the design-brief section
with cited sources; every page's hero/copy traces to the brief."

### The build

`holding/slice5-test/site/` — static HTML/CSS sample site "Brightside Family
Dental" (dentist brochure site type, brief block A), 4 pages:
`index.html`, `services.html`, `about.html`, `contact.html`, shared
`styles.css`. Served locally on http://127.0.0.1:8791 and rendered in
Playwright.

### Design-brief section with cited sources — verified per page

`grep -c "Design brief"` → 1 per page (4/4). Each page carries the brief
section listing 8 items, each with a `Source:` citation:
funnel-architecture.md §15 block A, goodui.org named patterns, blog.hubspot.com
landing-page best practices, Mobbin reference screens (Fresha, Heidi,
Care.com), WCAG 2.x understanding documents, and the copy-bar URL with its
live-fetch date. `grep -c "Source:"` → 8 per page (4/4).

Copy bar (Law 48): https://www.fresha.com/ — fetched live 2026-08-16,
HTTP 200 (curl -sI). Bar construction measured from the live page: headline
"Book local selfcare services" (4 words, action + category, no product name);
subhead = who-it-is-for + proof ("trusted by millions"); CTA action-labeled;
social proof = live counter + named reviews. `grep -c "https://www.fresha.com/"`
→ 1 per page (4/4).

### Hero/copy traceability — verified per page

| Page | Hero | Bar trace | Brief trace |
|---|---|---|---|
| index.html | "Gentle dentistry, judgment-free" | 4 words, action + category, no product name | One-line promise = patient outcome; CTA above fold; trust strip under |
| services.html | "Every smile, one practice" | 4 words, action + category, no product name | One-line promise = patient outcome; one action per page |
| about.html | "Dentistry without the dread" | 4 words, action + category, no product name | One-line promise = patient outcome; trust strip under |
| contact.html | "Book your appointment" | Action-labeled CTA construction | Benefit-labeled button; minimized form; labels not placeholders |

Full per-element trace matrix: `holding/slice5-test/traceability.md`.

### Rendered screenshots (blind-critic input)

`holding/slice5-test/screenshots/` — 5 PNGs rendered via Playwright:
`index-desktop.png`, `services-desktop.png`, `about-desktop.png`,
`contact-desktop.png` (1280px viewport), `index-mobile.png` (375px viewport,
sticky booking bar visible). Live DOM check confirmed the "Design brief"
heading and its list render on the served page.

## Controls (instruments proven working)

- `grep -c "Design brief"` returns 1 per page; a control grep for a
  non-existent string returns 0 — instrument discriminates.
- Copy-bar fetch: `curl -sI https://www.fresha.com/` → HTTP/2 200.
- Playwright rendered the served page (title "Brightside Family Dental —
  Gentle Dentistry in Maplewood") and saved screenshots to the named paths
  (verified by `ls` + `file`).

## Commit

One unit, one commit on `fix/6-design-brief` citing WAVE 3 DISPATCH
2026-08-16T17:07Z: test build + traceability + this evidence file.
