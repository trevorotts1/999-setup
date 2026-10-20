---
name: blackceo-signature-page
description: Build, revise, QC, and hand off BlackCEO Signature funnel pages end to end, including Standard or Long-Form copy, font/action planning, desktop/mobile wireframes, visual-direction mockups, image intelligence and prompts, generated-image QC, image maps, responsive HTML, GHL installation/testing, and authorized publishing. Use when a user asks for a BlackCEO Signature landing, signature sales page, opt-in, registration, challenge, booking, squeeze, webinar/event, or comparable focused-conversion page, or asks to apply the BlackCEO page, image, Secret Super Sauce, or visual-direction system. The signature sales page and the signature landing (opt-in) page are the two page kinds of this skill's landing role (`--page-kind sales|opt_in`). Direct-response sales pages (VSL, 8-section main, high-ticket, order-bump asset stacks) belong to Skill 56 `sales-page-assets`.
version: 1.3.2
---

# BlackCEO Signature Page — Skill 71


This is the canonical BlackCEO **single-page** landing-page production skill for OpenClaw. It converts a client brief into a complete Standard or Long-Form BlackCEO Signature Page while preserving BlackCEO copy, design, visual intelligence, image-prompt, QC, and public/private separation rules.

## Route boundaries first

Use this skill for a focused single-page conversion experience: landing page, signature sales page, opt-in/squeeze page, event/registration page, challenge page, booking page, lead-generation page, or comparable page using the BlackCEO Standard or Long-Form system.

Route elsewhere when the assignment is specifically:

- **Skill 49 `signature-funnel`** — multi-step 3/5/7 Signature Funnel with checkout / upsell / downsell / OTO chain.
- **Skill 56 `sales-page-assets`** — Direct-Response / VSL / 8-section main / 9-section upsell / high-ticket / order-bump asset stack. A request for a *signature sales page* is NOT this: it stays here as page kind `sales`.
- **Skill 62 `cinematic-web-funnel-engine`** — animated, immersive, scroll-controlled cinematic website/funnel.
- **Website-craft** — ordinary multi-page marketing website whose governing copy contract is not this BlackCEO single-page system.

If the owner explicitly asks for this BlackCEO Signature Page skill, use it even when the page ultimately hands delivery to another rail.

For the seven `signature_launch` page roles (`landing`, `product_selection`, `checkout`, `upsell_1`, `downsell_1`, `upsell_2`, `thank_you`), copy and page assembly route as above: landing stays in this skill, product selection to Skill 78, checkout to the native Convert and Flow order form installed by Skill 06, upsell 1 and 2 to Skill 80, downsell to Skill 81, thank-you to Skill 82. All seven roles take their four image stages (desktop wireframe, mobile wireframe, desktop mockup, mobile mockup) from this skill's shared image service, `scripts/shared_page_service.py`, called once from the owning skill's wrapper. The service builds every page from one copy form: `standard` (12 sections) and `long-form` (15) for the landing page, `product-selection` (5 sections: bridge headline, how to choose, packages, compare, questions and trust) for the `product_selection` page, registered in `scripts/copy_forms.py` with its spec in `references/copy-specs/`. A further page type adds one spec file and one registry row; it never gets a second pipeline. Skill 78's `scripts/run_image_stages.py` is the first wrapper that makes the call. A role whose page is not a 12- or 15-section landing has its own section sequence in `references/copy-specs/roles/<role>.json` (checkout today: five sections, built with `build_production_request.py --page-role checkout`); the pipeline, the Design Board, the brand-colour, design-style, composition and hypersaturation rules are the same code for every role. The checkout page's design stages are run by Skill 49's `checkout_wrapper.py`; the order form itself stays the native form installed by Skill 06. The upsell roles (`upsell_1`, `upsell_2`) are wired end to end: the upsell is its own eight-section form, registered in `scripts/copy_forms.py` (`references/copy-specs/upsell-v6.json`, `copy_version: upsell`), `scripts/run_page_type.py` sequences the service, `build_production_request.py --copy-version upsell --copy-json --bundle` and `stage_executor.py` (the per-form layout lines live in `references/wireframe-build-spec.json` `page_type_blocks`), and Skill 49's `upsell_wrapper.py --bridge-config` calls the runner. A page role other than `landing` is checked and drawn against its own canonical section structure, `references/page-structures.json` (today `downsell_1`: eight sections, from Skill 81's page object), with its wireframe lines in `references/wireframe-build-spec.json` `page_profiles`; `scripts/build_production_request.py --page-role <role> --page-copy <page.json>` builds that role's production request. A role without an entry keeps the landing rules.

Each page type has its own canonical sections, so a page is never forced into the landing page's. The landing forms are `standard` (12) and `long-form` (15). A page type with a structure of its own has a copy spec in `references/copy-specs/` carrying a `page_role` key, read through `scripts/page_role.py`: the thank-you page (`thank_you`, copy_version `thank-you`) has five sections (confirmation and welcome, order summary, access, what happens next, help manage and close; one celebration image, no offer button; its layout reference is `82-signature-thank-you/references/wireframe-mockup-layout.md`, proposed pending the owner's approval). Declare it with `write_intake.py --page-version thank-you` (or `shared_page_service.py --page-version thank-you`), which records `page_role` in `intake.json`; the section-count check, `build_production_request.py --copy-version thank-you`, the wireframe and mockup prompts (a `PAGE TYPE STRUCTURE` block), the Design Board and the gate all read that one declaration. `scripts/run_page_role_stages.py` runs the builder and the executor for the wireframe and mockup stages, so a request for this page gets desktop and mobile wireframes and mockups, one long PDF per stage and the overview boards, with client brand colors, the Design Board first, design style A, B or C, composition variety and the hypersaturated grade exactly as for a landing page. A page role with no copy spec yet (for example `product_selection`) keeps its present behavior until its structure is added the same way.

Direct-response sales pages (VSL, 8-section main, high-ticket, order-bump asset stacks) belong to Skill 56 `sales-page-assets`.

## OpenClaw ownership and seams

- **Primary department:** Web Development.
- **Primary role:** Landing Page Specialist.
- **Copy collaboration:** Marketing / Conversion Copywriter when the current execution assigns copy work there; this skill's writing references remain the page-specific authority.
- **Images and video:** in this harness (Claude Code, claude-nine), every generation request resolves inside this repo: policy from the native `kie` skill and its vendored helpers under `installer-registration/helpers/`, copied into this skill as data in `references/kie-policy-999.json`; transport through the same native adapter (74-kie-live-adapter) for everything it implements, with `scripts/kie_transport.py` in this skill supplying only the two pieces the capability audit proved absent (the credits before/after pair and the per-task receipt files the gate reads). Video routes to the native `motion-video-plus` skill. Agnes requests route through `scripts/agnes_route.py` in this skill. Do not hand-roll provider calls here either. The full mapping is `repo-integration/skill71-999-route-section.md`.
- **GHL delivery:** delegate media/page build to **Skill 6 `ghl-install-pages`**, the existing GHL delivery rail.
- **Vercel:** use **Skill 8 `vercel-setup`** when that hosting target is selected and configured.
- **Browser automation:** use the repo's managed browser path / Skill 3 conventions when graphical browser work is required.

Do not duplicate another skill's provider client, browser manager, GHL builder, deployment client, or credential storage.

## Read only what the current stage needs

- **Brand (every stage):** `references/BlackCEO-Page-Brand-Law.md` and the run's brand file (`intake.json` -> `brand_file`; `assets/brand/blackceo-brand.json` for BlackCEO pages, `assets/brand/client-brand.template.json` filled by the client for client pages). Brand fonts are the one fail-open key: when they are still MUST_SUPPLY, `font_policy` says derive-document — derive the best display/body/accent for the job, document the rationale in the bible (`fonts_source: "derived"` + `font_rationale` + `font_reviewer`), reviewer approves. Never blocked on fonts; every other MUST_SUPPLY value still blocks.
- Production order / gates: `references/BlackCEO-Signature-Landing-Page-Production-and-QC-SOP-v1.md`
- Design style (every wireframe, mockup and image stage): `references/design-styles.md`; data and the intake question in `references/design-styles.json`
- Standard copy: `references/BlackCEO-Signature-Landing-Page-Standard-v6.md`
- Long-Form copy: `references/BlackCEO-Signature-Landing-Page-Long-Form-v6.md`
- Image planning / art direction / prompts / visual QC: `references/BlackCEO-Signature-Image-Intelligence-and-Prompt-Creation-Guide-v5.md`
- Photographic direction: `references/BlackCEO-Famous-Photographers-DNA-Style-Library-v1.1.md`
- Cinematic/directorial direction: `references/BlackCEO-Cinematic-Image-Style-Systems-v2.0.md`
- Visual-artist direction: `references/BlackCEO-Visual-Artists-AI-Style-Intelligence-Guide-v1.0.md`
- Visual companion: `assets/BlackCEO-Master-Visual-Reference-Guide.png` — an image-style menu only, never a page-layout or page-color reference
- Image and video generation route (KIE): `references/kie-generation-route.md` (policy then transport; read it for any generation stage)
- Design Board (stage `design-board`): `references/design-board.md`
- Artifact and QC contracts: `references/artifact-contracts.md`, `references/qc-contract.md`, `references/stage-contract.json`, `references/html-qc-rubric.md`
- Swarm plan: `references/swarm-plan.md`

Do not load all three style libraries at once. Load only the selected family/style when needed. The exact per-stage reading list is the `reads` field of `references/stage-contract.json` — agents carry only what their stage names, never the full 100-400 KB guides.

### Design / wireframes / mockups

Fonts, colors, logo, and page look come only from the brand file. An agent never proposes page tokens. Brand colors are resolved before any wireframe, mockup or image: `scripts/brand_colors.py check <run_dir>` looks up the client's colors in the run's brand file (`private/brand.json`, then `intake.json` -> `brand_file`) and, when none are known, prints the client ask; the operator flow asks the client, then records the answer with `scripts/brand_colors.py record`. No default or other client's palette is ever used, and no image stage starts (`stage_gate.py check`, `stage_executor.py`) without resolved client colors.

## Page kinds: signature sales page and signature landing (opt-in) page

Both are page role `landing`; intake records which one with `write_intake.py --page-kind sales|opt_in` (a production run cannot close intake without it, `gate:intake_page_kind`). The kind is data in `references/page-kinds.json`, read by `scripts/page_kinds.py`:

| Kind | Copy form | Canonical sections | Buttons | Wireframe closing band |
|---|---|---|---|---|
| `sales` (signature sales page) | Standard (default) or Long-Form | 12, or 15 | go to the client's checkout | closing checkout panel, no price, no card fields |
| `opt_in` (signature landing page) | Long-Form only | 15 | open the client's registration form | registration strip, no form fields |

The section sequence is never copied: it is the copy spec's own `sequence` for the form. `stage_executor.py` refuses a kind that does not allow the declared `copy_version`, prints `PREFLIGHT_PAGE` (role, kind, canonical sequence length), and both wireframe stages, the mockup stages and the Design Board carry the kind. Everything else (wireframes, mockups, desktop and mobile, PDFs, overview boards, Design Board, style A/B/C, hypersaturation) is the one pipeline below, never a second one.

## Governing production order

Use the Production/QC SOP as authority. `scripts/stage_gate.py` is mandatory. Before starting any stage run `stage_gate.py check <run_dir> <stage>`; a stage ends only when `stage_gate.py close <run_dir> <stage>` exits 0. A run order or prompt cannot remove or rename stages. If a run order lists fewer stages than `references/stage-contract.json`, follow the contract and record the order's omission in the report.

Stage IDs (canonical, from `references/stage-contract.json`):

`intake, copy, font-action-plan, desktop-wireframe, mobile-tablet, visual-mockup, image-inventory-prompts, image-generation-qc, image-map-upload, design-board, final-mockups, responsive-html, ghl-install-test, publish-verify, automation-wiring`

The workflow has FIFTEEN stage IDs. The last, `automation-wiring`, is conditional: it is required only when the intake records `publish_target: "ghl"` and `automation_scope: "workflows"`. When it does not apply, the gate records the stage `not_applicable` in state and REPORT.md, citing the intake values; it is never silently absent.

Track stage status as `blocked`, `working`, `qc_failed`, or `ready` in the private workflow-state JSON; `scripts/validate_state.py` remains available for that file (back-compat). The gate's receipts under `private/receipts/` are what actually close stages. For itemized stages the gate also exposes the item commands `check-item` / `close-item` / `block-item` (see `references/item-gate-spec.md`): an item closes only from its own validators and reviews, and a stage close fans in its items by name. Review scores are Review Receipt v2 records: they live in `private/reviews/<stage>/<item-id>.review.json`, written by `scripts/write_review.py` from the reviewing session, and the gate validates them at close. A browser-using stage cannot close with unaccounted sessions; REPORT.md carries the hygiene line (see `references/browser-hygiene.md`).

### Copy

- Select **Standard** or **Long-Form**; do not silently merge both.
- Copy leads layout; never shorten approved copy to fit a template.
- Keep internal framework labels/counts in the private review source only.
- Derive a clean publication source with no private production labels.
- Use `scripts/validate_public_copy.py` before public HTML/handoff.
- Repair only failed criteria. Maximum three focused repair attempts for failed work; passing work advances immediately.

### Funnel handoff (the page's own contract)

- Intake records the handoff (`scripts/write_intake.py --handoff-form-name/--handoff-form-id`, or `--handoff-missing-reason` when no form identity exists): the Convert and Flow form's name and object id, the pop behavior, and the step order (signature page, then product selection page, then order form page). A placeholder destination is never a handoff; it is the recorded missing input or a defect.
- The copy manifest's CTA entries carry each button's handoff type (`form_pop`, `in_page_anchor`, `external_link`); the primary CTA's type is `form_pop`. `scripts/validate_handoff.py` verifies the built page against the record at the responsive-html stage, and the funnel-completion receipt proves the pop live at install.

### Design Board (after the images, before the mockup)

- Every page the funnel has (landing, order, checkout, upsell, downsell, thank-you) gets one Design Board: the client's brand colors, logo and the page's actual section images on one sheet, approved by the client before the page is built. It is made once the page's images have been created, never from art-direction text. Contract: `references/design-board.md`.
- Stage `design-board` follows `image-map-upload` (every image slot has its file) and precedes `final-mockups`. Colors come from the brand-color resolution (`scripts/brand_colors.py`); the board never picks them. A slot with no image refuses the board.
- The mockup and everything after it does not start for a page without a current recorded client approval of that page's board: `stage_gate.py` refuses `final-mockups` until `design-board` closes, and `stage_executor.py` refuses `final-mockups` on the same record (`scripts/design_board.py gate`).
- Record the approval with `scripts/design_board.py approve <run_dir> --by <client> --evidence <ref>`; it is bound to the board, the image set (re-derived from the run's own artifacts at every check) and the palette, so a remade board, a replaced or edited image or a changed palette needs a fresh approval.
- The board's read-back is checked against the board image by `tesseract` (`finalize`, `validate`, `gate`); it is never taken on the caller's word, and a box without tesseract cannot validate a board.

### Design / wireframes / mockups

- Establish font intelligence and visitor-action plan before full wireframes. Fonts, colors, logo, and page look come only from the brand file; an agent never proposes page tokens. Brand colors are resolved before any wireframe, mockup or image: `scripts/brand_colors.py check <run_dir>` looks up the client's colors in the run's brand file (`private/brand.json`, then `intake.json` -> `brand_file`) and, when none are known, prints the client ask; the operator flow asks the client, then records the answer with `scripts/brand_colors.py record`. No default or other client's palette is ever used, and no image stage starts (`stage_gate.py check`, `stage_executor.py`) without resolved client colors.
- The `desktop-wireframe` and `mobile-tablet` stages must produce `section-plan.json` as a required output.
- Every image slot in `section-plan.json` declares a composition `treatment` (`references/composition-treatments.json`; read `references/composition-patterns.md`): words over images, shaped crops (circle, arch, pill, angled cut) and a very light full-width field are first-class, and a photo column beside a text column is only one of the allowed treatments. The wireframe draws the treatment, the prompts ask for it, the mockup keeps it, the HTML builds it in CSS with `data-treatment`, and the per-page budget gates it. Typed hosted reference images are in `assets/visual-standards/reference-catalog.json`.
- The `visual-mockup` stage produces the page visual bible and an internal layout proof only. The layout proof is never presented to the client as the mockup and is never client-judged.
- Image generation (prompts, generation/QC, image map) completes before the mockup stage opens. `final-mockups` is the single client-judged mockup: produced per section with real photography in every slot, with supplied assets placed as files and never generated.
- Build complete desktop first, then intentionally reflow mobile/tablet; do not merely shrink desktop.
- Resist generic AI-page patterns: repetitive cards, identical section geometry, generic SaaS gradients, sterile stock-office scenes, repeated center alignment, and same-ratio imagery everywhere.
- Use varied visual rhythm, negative space, typography, asymmetry, scale, image shape, and intentional interruptions.
- Keep exact approved copy unless the owner explicitly authorizes copy changes.

The client never receives loose section images: every image stage ends with `scripts/combine_review_pdf.py <run_dir> --stage <stage>` (run automatically by `stage_executor.py`), which combines the sections in order into validator-gated desktop and mobile PDFs under `review-pdfs/` (see references/artifact-contracts.md, Review-PDF manifest). **No notes between sections: the PDF reads as one continuous page, top to bottom, with one title band at the top of page 1 only.** Never put a header, footer, caption or label band between or after sections; `validate_review_pdf.py` fails any PDF that does, and a failing PDF is never delivered. Keep the individual PNGs as internal inputs.

## Design style: A Block, B Circle, C Hybrid

At intake the client chooses one page design style after seeing an example link for each: ask with
`python3 scripts/design_style.py question`, record with `scripts/write_intake.py ... --design-style A|B|C`.
A production run cannot close `intake` without the choice (`gate:intake_design_style`). The choice drives the
wireframe and mockup prompts (`scripts/stage_executor.py` adds the style block), each image slot's `shape`
(`rect` or `circle`), and the shape QC check. Circle slots are generated SQUARE (subject centered, safe margins),
then masked by `scripts/circle_image.py` into an RGBA PNG with a transparent outside, so any agent can place
a round photo as an ordinary square file. Colors always come from the client's brand file, never from the examples.
Full definitions: `references/design-styles.md`.

## Page-level Creative Direction

A page may use exactly one external Creative Direction family/style, or Secret-Sauce-only:

- one Photographic Direction; or
- one Cinematic/Directorial Direction; or
- one Visual-Artist Direction; or
- no external direction, with the BlackCEO Secret Super Sauce primary.

If the intake does not name an external Creative Direction, the page is `SECRET_SAUCE_ONLY`. "No direction supplied" never means "choice delegated to the agent". An external style is used only when the owner names it at intake. `scripts/validate_visual_direction.py` enforces this at the visual-mockup gate.

Never mix external families on one page. The Secret Super Sauce is the adaptive BlackCEO house layer, not a second external style. Where a Sauce dimension conflicts with a defining trait of the selected style, the selected style wins for that dimension and compatible BlackCEO qualities remain active.

## Image planning and generation

Read only what the stage contract's `reads` field names for image stages (the v5 image guide sections needed, brand law, the grade block), never the whole library bundle.

Non-negotiables:

- one image-map entry -> one complete prompt -> one independently generated asset -> one correctly named file;
- production prompt length follows the KIE prompt budget (`07-kie-setup/references/kie-common-rules.md` rule 12): 95 to 100 percent of the chosen model's character maximum, never below 80 percent, read from Skill 74 `prompt-budget` and never from memory. This supersedes the older 5,000-20,000 house band, the 8,000-14,000 working target and the 19,000 compatibility ceiling;
- never silently truncate a prompt or disable validation; fix a budget failure by adding or cutting the exact characters `prompt-budget --check` reports;
- in `SECRET_SAUCE_ONLY`, the prompt's color-grade element starts with the Signature Grade Block from `assets/brand/signature-grade-block.txt`, verbatim (`scripts/validate_prompt.py --sauce-only` enforces it);
- use camera, lens, aperture/depth, composition, subject placement, lighting, posture/expression, fashion, skin/hair, color-grade, typography-as-image, and negative-space intelligence where applicable;
- preserve real-person identity and recurring-character continuity;
- use the Black representation intelligence in the image guide when Black/African-descended subjects are present;
- keep one page-level Art Direction coherent while varying shot/view scale, ratio, environment, posture, scene type, and intensity;
- never pass human research-lineage names downstream when a style library requires branded, descriptive execution grammar.

Run `scripts/validate_prompt.py` on final prompts (with `--sauce-only` on `SECRET_SAUCE_ONLY` pages; it checks anatomy, placeholders, padding and the grade block) and `scripts/validate_image_manifest.py` (with `--inventory` and `--measure`) on the image map. The length budget is decided by Skill 74 `prompt-budget --check` for the chosen model (rule 12); if the validator's own length check ever disagrees with it, the budget wins.

### Image and video engine routing (claude-nine)

Ask whether the owner/client has an explicit image-engine preference when generation is in scope, and record it at intake with `scripts/write_intake.py <run_dir> ... --image-engine kie|agnes` (default kie). In this edition, pass `--runtime claude-nine` on every run: it records `runtime: "claude-nine"` in `intake.json` (the gate's Kie transport alias keys off it; without it a `kie` receipt is refused) and makes intake refuse `agnes` in writing when no Agnes key is configured in the environment. The intake stage will not close without `image_engine` in `intake.json`.

- Every Kie request follows `references/kie-generation-route.md` (this edition's rewrite): the native `kie` skill's policy (copied as data in `references/kie-policy-999.json`), then the native adapter's transport, with `scripts/kie_transport.py` recording the credits pair and the per-task receipt files. Video requests route to the native `motion-video-plus` skill the same way. Never hardcode a model id, price, endpoint or rate figure in this skill; those come from the policy, the adapter's `price` command, and the common rules.
- Model choice follows the standing rule: the client selects their model, or their configured default applies (in this harness, the install's 9Router configuration); the system may recommend with reasons. An explicit client model request or a user pin overrides the default. (The gate maps the receipt value `user-pin` onto its department-pin rule at validation time; the stored receipt keeps `user-pin`.)
- If **Agnes** is explicitly selected, use `scripts/agnes_route.py` in this skill (the honest route name in receipts is `agnes`).
- `stage_gate.py close image-generation-qc` requires the receipt's `transport` block (transport skill `kie` on a claude-nine run, task ids, model ids, model sources, preflight and budget results, N43 ratios, and the per-task result files under `private/receipts/kie74/`); a hand-rolled createTask has no such receipt and cannot close the stage.

### Section count: one image per copy section

The selected `copy_version` fixes the canonical section count: Standard 12, Long-Form 15 (`references/copy-specs/standard-v6.json` and `long-form-v6.json`, `sequence`; Long-Form inserts 2A, 3A and 4A, and may expand Section 5 into 5A, 5B and 5C). Every image stage renders one image per canonical section, per platform. A request never merges sections into bands. Operator step, copy stage closed: `python3 scripts/build_production_request.py --copy-version <standard|long-form> --manuscript <run_dir>/copy/internal-manuscript.md --stage <stage> --out <run_dir>/production-request.json` (it refuses a manuscript that lacks a canonical section), then `python3 scripts/stage_executor.py <run_dir> --preflight --stages <stage>` and read its `PREFLIGHT_SECTIONS` and `PREFLIGHT_CTA` lines. `stage_executor.py` fails closed before any prompt or call when the request's section ids differ from the selected form's sequence, the request's copy source, or `copy/copy-manifest.json`; a paid run also refuses a request whose form is not declared. Contract: `references/generation-execution.md`.

A page type's own form follows the same rule: `build_production_request.py --copy-version thank-you` reads `references/copy-specs/thank-you-v1.json` (5 sections, ids 1 to 5), and `stage_executor.py --preflight` prints `PREFLIGHT_SECTIONS ... page_role=thank_you sections=5` and, per slice, `PREFLIGHT_BLOCKS` naming the prompt's blocks. A landing-shaped request (12 sections) for that page is refused by name, and so is a `page_role` that disagrees with the declared `copy_version`.

### Generation execution path

`scripts/stage_executor.py` is the single execution entry point for the four image stages (`desktop-wireframe`, `mobile-tablet`, `visual-mockup`, `final-mockups`) and for one `image-generation-qc` item. It is the production command `scripts/shared_page_service.py --pipeline-command` passes, and the command a `scripts/swarm_runner.py --worker-cmd` worker runs for one item. It calls Skill 74 once per image and writes the files into the stage folders with a `<stage>/stage-executor-record.json`. It never closes a stage and never writes a gate receipt. `--provider stub` (the default) is inert and writes placeholders; the real switch is `--provider kie --allow-paid` with `KIE_API_KEY` set. Contract: `references/generation-execution.md`.

Paid-call approvals, client-owned credentials, provider limits, and retry rules remain owned by the executing provider skill and fleet policy.

### Harness dependency declarations

- **Skill 5 (setup and provisioning): DECLARE.** Provisioning of the harness itself is a prerequisite owned by the 999 install, not by this skill.
- **Skill 29 (GHL Convert and Flow API): MAP by reference.** Its role in this harness is served by the GHL pack that ships with this edition (`.claude/skills/ghl-install-pages/`, `.claude/skills/convert-and-flow-operator/`, `.claude/skills/conversational-ai-system/`), whose Tier 0 caf CLI rail and API rail are the routes the funnel work names. No separate copy of Skill 29 is vendored.
- **Skill 36 (GHL MCP setup doctrine): VENDOR as data.** The tier doctrine (Tier 0 caf CLI first, browser as the Tier 4 backstop) is carried as data in the GHL pack's adapter contract (`.claude/skills/ghl-install-pages/ADAPTER.md`), not as a skill copy.
- **The caf CLI is an external prerequisite in this harness.** The step-zero audit proved the 999 installer does not provision it. Until the install provisions it, the pack's API rail is unavailable and funnel and workflow work falls to the Tier 4 agent-browser backstop, recorded as such in receipts.

## Swarm execution

Run stages as `references/swarm-plan.md` defines: one agent per item, reviewers start when their item lands, never fixed-size chunks. Every agent writes its receipt to `private/receipts/` and its files to the run folder. The orchestrator learns results only from `stage_gate.py check/close` output, never from an agent's chat reply. No re-read or recovery lanes.

## QC and repair

Read `references/qc-contract.md`.

- General page-stage criteria: each applicable criterion >=8/10 with no auto-fail (responsive-html is scored on `references/html-qc-rubric.md`).
- Prompt/generated-image work: retain the stricter average >=8.5, each applicable criterion >=8, zero auto-fails where the governing references require it.
- A failed artifact is repaired and rechecked before downstream use.
- Do not rework passing artifacts without a dependency reason.
- Do not invent completion: submitted generation is not completed imagery; local preview is not target-environment verification.

## Delivery

- Build only from current QC-passed copy, visual plan, approved assets, image map, and action plan. The final mockups are the visual target; the HTML must match them section by section.
- Preserve real forms, checkout, booking, URLs, embeds, and workflows; do not invent substitutes.
- For GHL, hand the delivery bundle to Skill 6 rather than bypassing its rail.
- Publish only when authorization is present under the current OpenClaw policy; otherwise deliver preview/staging artifacts and exact remaining action.

## Reporting

Report to the owner by pasting `REPORT.md`'s overall line, stage table, and cost line — `REPORT.md` is written only by `scripts/stage_gate.py report`. Do not write your own summary of stage status. Nothing marked "pending confirmation" may ship; pending means BLOCKED — except derived fonts: brand fonts missing are derived-and-documented per `font_policy` and reviewed, never blocked (the reviewer's approval of `fonts_source`/`font_rationale`/`font_reviewer` in the bible is the confirmation, and an unapproved derived-font bible still ships nothing).

## Installation / maintenance boundary

`verify.sh` is an **install/update maintenance check**, not a normal page-build step. Do not run the complete skill verification every time this skill is invoked.

For onboarding-repo integration, read `REPO-INTEGRATION.md`. The repo's native-skill binding lives in `23-ai-workforce-blueprint/skill-department-map.json`; generated role blocks must be refreshed with the repo's stamper rather than hand-edited.
