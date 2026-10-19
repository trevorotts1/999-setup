# Vendored: skill-department-map.json

Only the department registry is vendored; this 999 package does not ship the
rest of `23-ai-workforce-blueprint`.

- Source repo: `trevorotts1/openclaw-onboarding`
- Source ref: `origin/main`
- Source commit: `6de76988d1d17a42198815684374799529b70c2a`
- Git blob: `d91bcf78003c62af61732ce595a3b5b5b35e9010`
- SHA-256: `38343b881165997b316260587a56834fe6b207b9a6cf6987100015faf70f445b`
- Entries: 83 (skill 01 through 83, including `signature-downsell`,
  `signature-thank-you` and `black-friday-launcher`)

Vendored verbatim. Do not edit it here: the Launcher dependency preflight reads
it for registry lines, and a local edit would drift from the canonical
registry. Refresh by re-vendoring from the source commit.

Why the full registry rather than a launcher-scoped subset: a subset would pass
the preflight without being the department registry, and any consumer reading
this path would then see an incomplete inventory. The map is the real artifact;
vendoring it whole keeps the check honest.
