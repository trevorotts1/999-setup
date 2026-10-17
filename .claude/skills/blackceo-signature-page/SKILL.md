---
name: blackceo-signature-page
description: Build, revise, QC, and hand off BlackCEO Signature funnel pages end to end, including Standard or Long-Form copy, font/action planning, desktop/mobile wireframes, visual-direction mockups, image intelligence and prompts, generated-image QC, image maps, responsive HTML, GHL installation/testing, and authorized publishing. Use when a user asks for a BlackCEO Signature landing, opt-in, registration, challenge, sales, booking, squeeze, webinar/event, or comparable focused-conversion page, or asks to apply the BlackCEO page, image, Secret Super Sauce, or visual-direction system.
version: 1.2.14
---

# BlackCEO Signature Page — Skill 71


This is the canonical BlackCEO **single-page** landing-page production skill for OpenClaw. It converts a client brief into a complete Standard or Long-Form BlackCEO Signature Page while preserving BlackCEO copy, design, visual intelligence, image-prompt, QC, and public/private separation rules.

## Route boundaries first

Use this skill for a focused single-page conversion experience: landing page, opt-in/squeeze page, event/registration page, challenge page, booking page, lead-generation page, or comparable page using the BlackCEO Standard or Long-Form system.

Route elsewhere when the assignment is specifically:

- **Skill 49 `signature-funnel`** — multi-step 3/5/7 Signature Funnel with checkout / upsell / downsell / OTO chain.
- **Skill 56 `sales-page-assets`** — Direct-Response / VSL / 8-section main / 9-section upsell / high-ticket / order-bump asset stack.
- **Skill 62 `cinematic-web-funnel-engine`** — animated, immersive, scroll-controlled cinematic website/funnel.
- **Website-craft** — ordinary multi-page marketing website whose governing copy contract is not this BlackCEO single-page system.

If the owner explicitly asks for this BlackCEO Signature Page skill, use it even when the page ultimately hands delivery to another rail.

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
- Standard copy: `references/BlackCEO-Signature-Landing-Page-Standard-v6.md`
- Long-Form copy: `references/BlackCEO-Signature-Landing-Page-Long-Form-v6.md`
- Image planning / art direction / prompts / visual QC: `references/BlackCEO-Signature-Image-Intelligence-and-Prompt-Creation-Guide-v5.md`
- Photographic direction: `references/BlackCEO-Famous-Photographers-DNA-Style-Library-v1.1.md`
- Cinematic/directorial direction: `references/BlackCEO-Cinematic-Image-Style-Systems-v2.0.md`
- Visual-artist direction: `references/BlackCEO-Visual-Artists-AI-Style-Intelligence-Guide-v1.0.md`
- Visual companion: `assets/BlackCEO-Master-Visual-Reference-Guide.png` — an image-style menu only, never a page-layout or page-color reference
- Image and video generation route (KIE): `references/kie-generation-route.md` (policy then transport; read it for any generation stage)
- Artifact and QC contracts: `references/artifact-contracts.md`, `references/qc-contract.md`, `references/stage-contract.json`, `references/html-qc-rubric.md`
- Swarm plan: `references/swarm-plan.md`

Do not load all three style libraries at once. Load only the selected family/style when needed. The exact per-stage reading list is the `reads` field of `references/stage-contract.json` — agents carry only what their stage names, never the full 100-400 KB guides.

### Design / wireframes / mockups

Fonts, colors, logo, and page look come only from the brand file. An agent never proposes page tokens.

## Governing production order

Use the Production/QC SOP as authority. `scripts/stage_gate.py` is mandatory. Before starting any stage run `stage_gate.py check <run_dir> <stage>`; a stage ends only when `stage_gate.py close <run_dir> <stage>` exits 0. A run order or prompt cannot remove or rename stages. If a run order lists fewer stages than `references/stage-contract.json`, follow the contract and record the order's omission in the report.

Stage IDs (canonical, from `references/stage-contract.json`):

`intake, copy, font-action-plan, desktop-wireframe, mobile-tablet, visual-mockup, image-inventory-prompts, image-generation-qc, image-map-upload, final-mockups, responsive-html, ghl-install-test, publish-verify`

Track stage status as `blocked`, `working`, `qc_failed`, or `ready` in the private workflow-state JSON; `scripts/validate_state.py` remains available for that file (back-compat). The gate's receipts under `private/receipts/` are what actually close stages.

### Copy

- Select **Standard** or **Long-Form**; do not silently merge both.
- Copy leads layout; never shorten approved copy to fit a template.
- Keep internal framework labels/counts in the private review source only.
- Derive a clean publication source with no private production labels.
- Use `scripts/validate_public_copy.py` before public HTML/handoff.
- Repair only failed criteria. Maximum three focused repair attempts for failed work; passing work advances immediately.

### Design / wireframes / mockups

- Establish font intelligence and visitor-action plan before full wireframes. Fonts, colors, logo, and page look come only from the brand file; an agent never proposes page tokens.
- Build complete desktop first, then intentionally reflow mobile/tablet; do not merely shrink desktop.
- Resist generic AI-page patterns: repetitive cards, identical section geometry, generic SaaS gradients, sterile stock-office scenes, repeated center alignment, and same-ratio imagery everywhere.
- Use varied visual rhythm, negative space, typography, asymmetry, scale, image shape, and intentional interruptions.
- Keep exact approved copy unless the owner explicitly authorizes copy changes.

For multi-part review exports, keep individual PNGs and use ordered manifests with `scripts/combine_review_pdf.py` and `scripts/validate_review_pdf.py` for separate desktop/mobile wireframe/mockup PDFs.

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

Ask whether the owner/client has an explicit image-engine preference when generation is in scope, and record it at intake with `scripts/write_intake.py <run_dir> ... --image-engine kie|agnes` (default kie). The intake in this edition records `runtime: "claude-nine"`; the intake stage will not close without `image_engine` in `intake.json`, and intake refuses `agnes` in writing when no Agnes key is configured in the environment.

- Every Kie request follows `references/kie-generation-route.md` (this edition's rewrite): the native `kie` skill's policy (copied as data in `references/kie-policy-999.json`), then the native adapter's transport, with `scripts/kie_transport.py` recording the credits pair and the per-task receipt files. Video requests route to the native `motion-video-plus` skill the same way. Never hardcode a model id, price, endpoint or rate figure in this skill; those come from the policy, the adapter's `price` command, and the common rules.
- Model choice follows the standing rule: the client selects their model, or their configured default applies (in this harness, the install's 9Router configuration); the system may recommend with reasons. An explicit client model request or a user pin overrides the default. (The gate maps the receipt value `user-pin` onto its department-pin rule at validation time; the stored receipt keeps `user-pin`.)
- If **Agnes** is explicitly selected, use `scripts/agnes_route.py` in this skill (the honest route name in receipts is `agnes`).
- `stage_gate.py close image-generation-qc` requires the receipt's `transport` block (transport skill `kie` on a claude-nine run, task ids, model ids, model sources, preflight and budget results, N43 ratios, and the per-task result files under `private/receipts/kie74/`); a hand-rolled createTask has no such receipt and cannot close the stage.

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
