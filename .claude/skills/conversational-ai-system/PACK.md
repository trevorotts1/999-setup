# GHL pack membership

This skill ships as one third of the GHL pack (fix plan Amendment 5,
Item 28 Rows 6 and 8):

- `conversational-ai-system` (this skill, Skill 38's conversational
  delivery layer only, copied from `38-conversational-ai-system` in the
  onboarding repo; the excluded host-provisioning files are absent by design)
- `convert-and-flow-operator` (copied from Skill 44)
- `conversational-ai-system` (Skill 38's conversational delivery
  layer only; its host-provisioning layer is excluded by design)

**ghl_pack_version: 1.0.0** (recorded in automation-wiring receipts
per Item 31; the binding per-file classification is
`repo-integration/ghl-pack-manifest.json` in the blackceo-signature-page
skill).

Pair rule (Row 8): Skills 6 and 44 ship together or not at all.

Harness status, stated plainly: files the pre-copy audit classified
as neutral are byte-identical copies and work as-is. Files classified
as adapter (by seam: launch, session-seed, teardown, paths-secrets)
are copied but their harness adaptation is PENDING: they still carry
OpenClaw bindings and are named individually in the pack manifest as
adapter-pending. The seam bindings this harness requires are defined
in ADAPTER.md in the ghl-install-pages skill. Nothing in this pack borrows from the
OpenClaw skills tree at runtime.
