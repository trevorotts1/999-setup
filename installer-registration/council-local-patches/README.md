# Council local patches (999-only)

These patches are NOT in the Council source (`trevorotts1/openclaw-onboarding`,
`77-council-of-wise-elders`). They are 999-setup changes applied on top of the
vendored canonical tree. Whether to upstream them is the Council source owner's decision.

| Patch | Effect |
|---|---|
| `01-dispatcher-skillRootForAssets.patch` | `runtime/src/cli/dispatcher.ts`: exports `skillRootForAssets()` and uses it for advisor loading and the data-dir guard, so the installed binary finds its real skill folder. |
| `02-skill-root.test.ts.patch` | Adds `runtime/src/cli/skill-root.test.ts`, the regression test for that fix. |

Origin: 999-setup commit `0fd08bd4` (diff of `0fd08bd4~1..0fd08bd4`). The patches apply
cleanly (`git apply --check`) to the canonical tree at onboarding
`bf2385c7553cea09d32f68c49b2765acd4867ddb`.

## Re-vendoring

`scripts/vendor-council-bundle.mjs` deletes the vendored folder and copies the canonical
tree, so it drops these changes. Always re-vendor with:

    node scripts/revendor-council.mjs --source <canonical 77-council-of-wise-elders> --source-commit <full sha>
    python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py

`revendor-council.mjs` runs the vendor tool, `git apply`s every `*.patch` here in name
order, then runs `scripts/realign-council-vendor-record.mjs --write`, which declares the
divergence (files, hashes, these patch artifacts) as a `local_divergence` entry in
`installer-registration/council-vendoring.json` and in the bundle's
`DISTRIBUTION-RECONCILIATION.json`. `canonical_files` holds canonical hashes only.

If a patch stops applying after a Council update, the wrapper fails; refresh the patch
against the new canonical file (or drop it once Council carries the fix).
