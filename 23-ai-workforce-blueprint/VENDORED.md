# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `origin/main`
- Source commit: `c4bf7530f6af9bcd0c3e1b55c7b0ae25761f2b8a`
- Git blob: `ce4d5d105a4cf48f946489e545d17fb9e99960e7`
- SHA-256: `ddee7a81ebb251c16f91bb6672491e68a7a69ddaa0d3ca9c63aa56bf219e2165`
- Entries: 83 (skill 01 through 83, including `signature-downsell`,
  `signature-thank-you` and `black-friday-launcher`)

Vendored verbatim. Do not edit it here: the Launcher dependency preflight reads
it for registry lines, and a local edit would drift from the canonical
registry. Refresh by re-vendoring from the source commit.

Why the full registry rather than a launcher-scoped subset: a subset would pass
the preflight without being the department registry, and any consumer reading
this path would then see an incomplete inventory. The map is the real artifact;
vendoring it whole keeps the check honest.
