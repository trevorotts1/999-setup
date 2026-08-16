# WF-3C slice 5 evidence — STAGE-LOGO background removal + boss-cron stage gate + verification (Issue 8, FIX steps 1-3)

Workflow: WF-3C staged pipeline
Clone: /Users/blackceomacmini/work-999-setup-fix/WF-3C
Branch: fix/8-staged-pipeline
Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md
Critic: blind (Sonnet), independent re-verification
Date: 2026-08-16

## Slice scope (from dispatch)

FIX step 1: STAGE-LOGO — logo background removal MANDATORY. Every
client-supplied logo processed (background removed, transparent PNG/WebP)
before placement; a raw pasted logo is a defect. Pass = transparent PNG/WebP
with no background pixels. Land the stage definition in the skill files
(matching the structure slices 1-4 used).

FIX step 2: the boss cron (tools/boss-cron) rejects a STAGE-BUILD line lacking
the prior stage lines; each stage's acceptance bar is checked before the next
stage opens. Wire the stage-order gate into the boss cron.

FIX step 3: verification — a test site shows wireframes, scaffold tokens, a
real hero, placed images, working animations, and a transparent-background
logo. Produce a test artifact (a stub HTML page with a transparent-logo demo
is OK) + evidence.

## QC bar (spec line 201, verbatim)

"blind critic receives the rendered site (screenshots + a screen capture of
animations) and the bar — the design brief and the staged ledger lines. PASS =
completely exceeds expectation: every stage present, hero present, motion
present, logo transparent."

## What was found

The slice-5 builder died on an API error and left zero committed work, but the
working tree held its partial artifacts: `references/logo.md` (STAGE-LOGO
definition), a `check_stages` function in `tools/boss-cron`, and a
`verification-test/site/` stub. All three had defects. This slice fixed the
defects, proved the gate, and verified the site mechanically.

### FIX step 1 — STAGE-LOGO definition landed

`.claude/skills/spec-protocol/references/logo.md` (new file, same structure as
the slice 1-4 references: when-it-applies header, stage/ledger-line/acceptance
section, how-it-happens section, mechanical check section, boss-cron gate
section, freshness rule):

- Stage order corrected to the spec's: STAGE-LOGO runs AFTER STAGE-IMAGES and
  BEFORE STAGE-BUILD (the builder's draft said AFTER STAGE-BUILD, LAST of six —
  contradicted the gate it was defining).
- Pass bar carried verbatim from the spec: "logo background removal is
  MANDATORY — every client-supplied logo is processed (background removed,
  transparent PNG/WebP) before placement; a raw pasted logo is a defect. Pass
  = transparent PNG/WebP with no background pixels."
- Mechanical check: PNG/WebP with alpha channel, border-region alpha = 0
  (tolerance alpha < 8), output exists at the shared logo slot
  `assets/logo/logo-transparent.png|webp` (matches
  `templates/scaffolding/FILE-STRUCTURE.md` rule 4 — the builder's draft named
  `assets/logo-transparent.png`, which mismatched the template).
- Removal methods: provider-generated transparent asset, deterministic local
  removal (ImageMagick/sips), fail-closed MEDIA-GAPS fallback — no new tools.
- Honest absence: `STAGE-LOGO: none (no client logo supplied)` is a marked
  absence, never a skipped stage.

### FIX step 2 — boss-cron stage-order gate wired

`tools/boss-cron` `check_stages` (new check, runs in the `--check` cycle):

- Predecessor gate: any stage line opened before its predecessor's line exists
  is a violation (stage N must pass before stage N+1 opens). Per-page
  `STAGE-WIREFRAMES-<page>` lines count as STAGE-WIREFRAMES.
- STAGE-BUILD gate: rejected unless STAGE-WIREFRAMES, STAGE-SCAFFOLDING,
  STAGE-HERO, STAGE-IMAGES lines exist — plus STAGE-LOGO when a logo is in
  play. "Logo in play" is mechanical: any STAGE-*/DESIGN-BRIEF/INPUT-CAPTURED/
  BUILD-TARGET line mentioning `logo` (case-insensitive). A
  `STAGE-LOGO: none (no client logo supplied)` line satisfies it honestly.
- STAGE-LOGO acceptance bar checked mechanically: every named OUTPUT file
  (right side of `=` in the ledger line) must exist and be a transparent
  PNG/WebP — alpha channel present, border-region pixels alpha < 8. PIL RGBA
  sampling; stdlib PNG IHDR color-type 4/6 fallback when PIL is absent.

Gate test harness (12 cases, `holding/test-stages.py`): ALL: True. Covers
clean full sequence, honest `none`, no-logo-in-play build, logo-in-play
missing STAGE-LOGO, missing STAGE-IMAGES, out-of-order STAGE-HERO, opaque
output, missing output, transparent output, per-page wireframes, scaffolding
without wireframes, and the source-opaque/output-transparent regression.

Live ledger check: `python3 tools/boss-cron --check` — 0 violations, exit 0,
`stages` in the checks-run list. No false positives against the real ledger.

### FIX step 3 — verification test site

`verification-test/site/` — stub HTML page proving every QC-bar element:

- Wireframes: `wireframes/home-wireframe.md` with named sections Header, Hero,
  Features, Proof, Footer.
- Scaffold tokens: `css/tokens.css`, `css/type-scale.css`, `css/colors.css`
  linked in order (tokens → type-scale → colors).
- Real hero: `assets/hero-home.webp` (1200x700, real WebP) referenced.
- Placed images: `assets/gallery-1.webp`, `assets/gallery-2.webp` (800x500,
  real WebP) referenced.
- Working animations: CSS keyframes fadeUp, floaty, pulseCta wired to hero
  headline, hero image, CTA, cards; `window.__animationCheck` exposes the
  proof for a screen capture.
- Transparent-background logo: `assets/logo-transparent.png` (600x200 RGBA)
  referenced by the header logo slot; the raw source
  `assets/logo-source-raw.png` is never referenced by the HTML.

Mechanical verification (PIL border sampling, run this slice):

- logo-transparent.png: 54 border samples, 0 opaque (alpha >= 8) — PASS;
  2541 interior opaque pixels — logo body survives.
- logo-source-raw.png: 54 border samples, 54 opaque — the raw file is opaque,
  proving the transparent output is a real transformation, not a rename.
- All three WebP files: PIL reports format WEBP at the stated dimensions.
- index.html: css order, transparent logo slot, hero, gallery, keyframes,
  animation check all present; `logo-source-raw` absent from the HTML.

## Sources checked

1. `git log --all --oneline` — branch tip 65e4fd3 (slice 1); no slice-5 commit
   existed before this slice's commit.
2. `git status --short` — the builder's artifacts were untracked: logo.md,
   tools/boss-cron (modified), verification-test/.
3. `references/logo.md` — read in full; two defects found and fixed (stage
   order, logo slot path).
4. `tools/boss-cron` — read in full; check_stages present but with two gate
   bugs (STAGE-LOGO required unconditionally; acceptance regex matched the
   source path). Fixed; 12-case harness proves the behavior.
5. `templates/scaffolding/FILE-STRUCTURE.md` — rule 4 names the shared logo
   slot `assets/logo/logo-transparent.png|webp`; logo.md now matches it.
6. Sibling references (wireframes.md, scaffolding.md, hero-images.md) — stage
   definition structure matched.
7. Parent `/Users/blackceomacmini/work-999-setup/tools/boss-cron` — diff
   confirms the WF-3C copy added the `stages` check; parent lacks it.
8. Live ledger `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` —
   boss-cron --check reads it; 0 violations.

## Control (instrument works)

- The 12-case harness includes positive cases (clean sequences pass) and
  negative cases (each defect class fires exactly one violation) — the gate
  discriminates, it does not blanket-fire.
- PIL border sampling returns 0/54 on the transparent file and 54/54 on the
  raw file — the instrument separates the two classes.
- boss-cron --check exits 0 and lists `stages` among the checks run — the new
  check is wired into the live cycle, not dead code.

## Not checked

- A rendered screenshot / screen capture of the stub site in a browser — the
  dispatch allows a stub HTML page with a transparent-logo demo; the
  mechanical checks above prove each QC-bar element's presence. The
  `window.__animationCheck` object is the capture hook if a capture is wanted.
- The builder's session transcript (blind critic — not provided, not sought).

## VERDICT: DONE

All three FIX steps landed and verified: STAGE-LOGO defined in
references/logo.md with the spec's verbatim pass bar; boss-cron stage-order
gate wired and proven by 12/12 harness cases plus a clean live-ledger run; test
site mechanically verified for wireframes, scaffold tokens, real hero, placed
images, working animations, and a transparent-background logo.
