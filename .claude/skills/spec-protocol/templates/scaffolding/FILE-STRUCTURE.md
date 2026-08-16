# FILE-STRUCTURE — project scaffolding template (STAGE-SCAFFOLDING)

Copy this tree into the project folder and fill the page names from the design
brief's page inventory. One folder per page; shared assets in `assets/`.

```
<project-slug>/
├── index.html                  # home page (or the funnel's entry page)
├── <page-2>.html               # one file per brief page — fill from the brief
├── <page-3>.html
├── css/
│   ├── tokens.css              # design tokens (spacing, radii, shadows, motion)
│   ├── type-scale.css          # type scale (families, sizes, weights, styles)
│   ├── colors.css              # color system (semantic roles, AA pairs, dark mode)
│   └── <page>.css              # per-page styles — token variables ONLY, no raw values
├── js/
│   ├── main.js                 # behavior + animation entry (STAGE-BUILD)
│   └── <feature>.js            # per-feature behavior, named from the brief
├── assets/
│   ├── images/                 # placed by STAGE-IMAGES (manifest rows, Issue 7)
│   │   ├── hero-<page>.webp    # hero per page (STAGE-HERO)
│   │   └── <manifest-slot>.webp
│   ├── logo/                   # STAGE-LOGO output — transparent PNG/WebP only
│   │   └── logo-transparent.webp
│   └── fonts/                  # only when the brief names webfonts
└── wireframes/                 # STAGE-WIREFRAMES output — layout skeletons per page
    └── <page>-wireframe.md
```

Rules:

1. Every page file in the tree maps to a brief page — no page without a brief
   row, no brief page without a file.
2. `css/` carries the three scaffolded files FIRST (tokens, type, colors); every
   page links them before its own stylesheet (the reference contract).
3. `assets/images/` rows map 1:1 to image-manifest rows (Issue 7) — a file with
   no manifest row, or a manifest row with no file, is a defect.
4. `assets/logo/` holds ONLY STAGE-LOGO output — a raw pasted logo is a defect.
5. `wireframes/` holds ONLY STAGE-WIREFRAMES output — the layout skeletons the
   build's sections must match (named sections per brief).
