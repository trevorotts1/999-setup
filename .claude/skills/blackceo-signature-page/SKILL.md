---
name: blackceo-signature-page
description: Build, revise, QC, and hand off BlackCEO Signature funnel pages end to end, including Standard or Long-Form copy, font/action planning, desktop/mobile wireframes, visual-direction mockups, image intelligence and prompts, generated-image QC, image maps, responsive HTML, GHL installation/testing, and authorized publishing. Use when a user asks for a BlackCEO Signature landing, opt-in, registration, challenge, sales, booking, squeeze, webinar/event, or comparable focused-conversion page, or asks to apply the BlackCEO page, image, Secret Super Sauce, or visual-direction system.
---

# BlackCEO Signature Page

Build the page as a governed production workflow, not as a generic AI landing-page template. Preserve the BlackCEO writing, visual, image, QC, and public/private separation rules in the bundled references.

## Core authority

Load only the references needed for the current stage.

1. Read `references/authority-map.md` first.
2. Read `references/BlackCEO-Signature-Landing-Page-Production-and-QC-SOP-v1.md` for stage order, gates, repairs, implementation, and delivery.
3. For copy, read exactly one writing guide unless the user explicitly requests both:
   - Standard: `references/BlackCEO-Signature-Landing-Page-Standard-v6.md`
   - Long form: `references/BlackCEO-Signature-Landing-Page-Long-Form-v6.md`
4. Before image planning or prompt authoring, read `references/BlackCEO-Signature-Image-Intelligence-and-Prompt-Creation-Guide-v5.md`.
5. If a page-level external Creative Direction is active, read only the selected family library and the selected style block:
   - Photographic: `references/BlackCEO-Famous-Photographers-DNA-Style-Library-v1.1.md`
   - Cinematic/directorial: `references/BlackCEO-Cinematic-Image-Style-Systems-v2.0.md`
   - Visual artist: `references/BlackCEO-Visual-Artists-AI-Style-Intelligence-Guide-v1.0.md`
6. Use `assets/BlackCEO-Master-Visual-Reference-Guide.png` as a visual companion, never as a substitute for the written style grammar.

Do not silently reconcile a conflict by inventing a new rule. Apply the authority order in `references/authority-map.md` and record unresolved conflicts.

## Operating principles

- Refuse generic AI-template drift. Do not default to repetitive cards, identical image blocks, generic SaaS gradients, sterile stock-office scenes, repeated center-aligned sections, or one-size-fits-all visual rhythm.
- Copy leads layout. Do not compress or summarize approved copy to make a template fit.
- Keep private production labels out of all public copy, image pixels, mockups, shipped HTML, accessibility text, comments, tooltips, and public implementation names.
- Latest explicit user/client direction wins over defaults.
- Failed work cannot advance. Passing work advances immediately.
- Do not invent completion. A submitted generation is not a finished image; a local test is not a GHL test; a promised file must exist before linking it.
- Never put credentials or client secrets into this skill, generated artifacts, prompts, logs, or public code.
- Do not publish, charge, send, or perform irreversible external actions without the authorization required by the current assignment.

## Production state machine

Use these stages in order unless the SOP explicitly permits parallel independent work:

1. `intake`
2. `copy`
3. `font-action-plan`
4. `desktop-wireframe`
5. `mobile-tablet`
6. `visual-mockup`
7. `image-inventory-prompts`
8. `image-generation-qc`
9. `image-map-upload`
10. `final-mockups`
11. `responsive-html`
12. `ghl-install-test`
13. `publish-verify`

Track stage status as `blocked`, `working`, `qc_failed`, or `ready`. A later stage must not become ready while a required earlier stage is not ready. Use `scripts/validate_state.py` against the private workflow-state JSON.

## Intake

Ask only for genuinely missing information needed to proceed. Reuse supplied files, copy, brand rules, links, references, and prior decisions.

At minimum, resolve when missing:

- page type/name/subject;
- intended visitor action;
- Standard versus Long-Form version;
- hosting/implementation target when implementation is requested;
- supplied materials and existing copy/assets;
- real action URLs, embeds, checkout, booking, form, or delivery destination when required;
- graphics engine preference when image generation is in scope.

For image generation, ask whether the user has a preferred graphics engine. If no preference is given, recommend Kie.ai using the latest generally available GPT image-generation model available through Kie.ai at runtime. Do not hardcode a model version as permanent. Agnes or another configured engine may be used when selected. Verify actual runtime availability before claiming a model or engine can be called.

## Copy workflow

1. Choose Standard or Long-Form based on the assignment.
2. Write the complete copy using that guide.
3. Preserve the internal review manuscript with framework labels and counts.
4. Derive a separate clean public-copy source with no private labels.
5. Run qualitative QC against the writing guide and SOP.
6. Repair only failed criteria, up to three focused repair attempts. Stop when the artifact passes.
7. Run `scripts/validate_public_copy.py` on the intended public source before layout or shipment.

Do not add a separate AI claim-auditing assignment. Missing factual inputs should remain marked privately for the human/client workflow rather than being fabricated.

## Wireframe and mockup workflow

- Establish font intelligence and the visitor-action plan before full wireframes.
- Produce the complete desktop wireframe first.
- Reflow intentionally for mobile; do not merely shrink desktop.
- Define tablet behavior where needed.
- Let copy length determine layout height.
- Use visual rhythm, asymmetry, varied scale, negative space, typography, image ratios, section pacing, and intentional interruptions to avoid template sameness.
- A section may use a person, environment, still life/object, conceptual visual, typography-as-image, or no generated image when that best serves the page.
- Preserve exact approved copy in visual artifacts unless the user explicitly authorizes copy changes.

### Review PDFs

Keep the individual PNGs. When a wireframe or mockup contains multiple pages/parts, also create one ordered review PDF for each applicable category:

- `desktop-wireframes.pdf`
- `mobile-wireframes.pdf`
- `desktop-mockups.pdf`
- `mobile-mockups.pdf`

Never mix desktop/mobile or wireframe/mockup pages in one review PDF. Use an explicit ordered manifest and run `scripts/combine_review_pdf.py`; then verify it with `scripts/validate_review_pdf.py`. A missing part blocks the review PDF from ready status.

## Page-level Art Direction

A page may use exactly one of these external Creative Direction families, or Secret-Sauce-only:

- one Photographic Direction;
- one Cinematic/Directorial Direction;
- one Visual-Artist Direction;
- no external direction, with the BlackCEO Secret Super Sauce as the primary aesthetic.

Never mix the three external families on one page. Never stack multiple branded styles in this signature-page workflow unless the user explicitly changes this master rule in a later assignment.

The BlackCEO Secret Super Sauce is the only default blend layer. Apply it wherever compatible. If one Sauce dimension conflicts with a defining trait of the selected Creative Direction, the selected style controls that dimension while all compatible BlackCEO quality, representation, anti-generic, and material/skin standards remain active.

Lock the selected direction for the whole page in a private Page Visual Bible. Maintain harmony while varying composition, shot/view scale, ratio, scene type, posture, environment, visual intensity, and typography-led interruptions.

## Image intelligence and generation

Before authoring prompts, read the complete image-intelligence guide and the current image-map entry.

Non-negotiables include:

- one image-map entry -> one complete prompt -> one independently generated asset -> one correctly named file;
- every production prompt is 5,000-20,000 meaningful characters inclusive;
- default authoring target is 8,000-14,000 useful characters for compatibility with the known 19,000-character runtime ceiling described in the guide;
- never silently truncate or disable a validator;
- use camera, lens, aperture/depth, framing, positioning, lighting, body/expression, fashion, skin/hair, color-grade, text-zone, and layout intelligence where applicable;
- use Black representation intelligence when Black/African-descended subjects are present, while preserving real-person identity and recurring-character continuity;
- use typography-as-image when it strengthens page rhythm; do not force a person image into every section;
- use varied supported aspect ratios, including wide cinematic ratios such as 21:9 when the layout and engine support them;
- keep the selected page Art Direction coherent across the image set;
- do not pass human research-source names from the style libraries downstream when the library says to use the branded style grammar instead.

Run `scripts/validate_prompt.py` on each final prompt and `scripts/validate_image_manifest.py` on the image map. Qualitative prompt/image QC still requires an independent reviewer or equivalent separate review pass; the scripts do not replace visual judgment.

## QC and repair

Read `references/qc-contract.md`.

At every stage:

1. QC the current artifact.
2. If it passes, advance it immediately.
3. If it fails, name the exact defect.
4. Repair only the failed content and affected dependencies.
5. Recheck the repaired content and affected dependencies.
6. Stop as soon as it passes.
7. Allow at most three focused repair attempts for failed work; if still blocked, report the exact blocker.

For general page-stage work, every applicable required criterion must be at least 8/10 with no automatic failure. Prompt and generated-image work retain the stricter average >=8.5, each applicable criterion >=8, and zero auto-fails described in the master references.

## Implementation and handoff

- Build responsive HTML only from the current QC-passed copy, wireframes/mockups, image map, font/action plan, and approved assets.
- Keep real forms, checkout, booking, links, embeds, and workflows intact; do not invent substitutes.
- Test in the actual target environment before claiming target-environment success.
- Publish only when authorized, then verify the public result.
- Deliver only current passing versions; do not package rejected predecessors beside them.

## Runtime and connector behavior

Read `references/runtime-adapters.md` when installing or evaluating this skill in Claude Code, Claude-Nine, Codex, or another agent runtime.

The skill contains workflow logic, references, validators, and local install helpers. It does not contain API keys or guarantee that Kie.ai, Agnes, GHL, Vercel, GitHub, a browser, image generation, or another service is connected. Detect available tools/connectors at runtime and report missing integration capability rather than fabricating an action.

For local Phase-1 evaluation, follow `START-HERE.md` and `EVALUATION-CHECKLIST.md`. Do not redesign the BlackCEO methodology during compatibility evaluation.
