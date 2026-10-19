# Council local patches (999-only)

These patches are 999-setup changes to the vendored Council tree
(`.claude/skills/council-of-wise-elders`) that do **not** exist in the Council
source (`trevorotts1/openclaw-onboarding`, `77-council-of-wise-elders`).

| Patch | Effect |
| --- | --- |
| `01-dispatcher-skillRootForAssets.patch` | `runtime/src/cli/dispatcher.ts`: adds and exports `skillRootForAssets()` and uses it for advisor loading and the data-dir guard, so the installed binary finds its real skill folder. |
| `02-skill-root.test.ts.patch` | New file `runtime/src/cli/skill-root.test.ts`, the regression test for the above (full file). |

Both apply cleanly (`git apply --check`) to the unmodified Council source
dispatcher, whose bytes are identical at the previous vendored commit and at
`bf2385c7553cea09d32f68c49b2765acd4867ddb`.

## Re-vendoring

`scripts/vendor-council-bundle.mjs` deletes the vendored folder and copies the
canonical tree, which silently removes these patches. Always re-vendor with:

```
node scripts/revendor-council.mjs --source <openclaw-onboarding>/77-council-of-wise-elders --source-commit <full sha>
python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py
```

The wrapper vendors, `git apply`s every `*.patch` here in name order, and runs
`scripts/realign-council-vendor-record.mjs --write`, which declares the
divergence as one `local_divergence` entry (file hashes and patch hashes) in
both `installer-registration/council-vendoring.json` and the bundle's
`DISTRIBUTION-RECONCILIATION.json`, then reseals `manifest.json`. The record's
`canonical_files` stays canonical-only. A tree change that no patch covers makes
the realign tool fail instead of being absorbed.

Upstreaming these patches into the Council source is a decision for its owner.
Once upstreamed, delete the patch files and re-vendor: the divergence entry
disappears on its own.
