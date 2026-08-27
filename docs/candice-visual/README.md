# Candice visual authority documents

This directory is the planning authority for the Candice visual domain. Its
asset authority is
[`apps/candice-companion/assets/candice/asset-manifest.json`](../../apps/candice-companion/assets/candice/asset-manifest.json),
contract `candice-operator-originals-v1`.

These documents do **not** approve a visual direction, a crop, a derived
asset, or a runtime state. Every identity-defining assignment is marked
**APPROVAL PENDING** until a named operator records an approval against the
review pack required by `VISUAL-PARITY-CHECKLIST.md`.

Run the reference check after changing a document or the manifest:

```bash
node scripts/candice-visual/verify-doc-asset-references.mjs
```

The check proves every asset ID/hash pair cited in these documents still
matches the canonical manifest. It does not grant visual-parity approval.

