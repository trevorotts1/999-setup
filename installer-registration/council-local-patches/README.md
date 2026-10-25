# Council local patches (999-only)

These patches are NOT in the Council source (`trevorotts1/openclaw-onboarding`,
`77-council-of-wise-elders`). They are 999-setup changes applied on top of the
vendored canonical tree. Whether to upstream them is the Council source owner's decision.

## Current patches

None. A distribution the release contract governs cannot carry a local divergence:
Council v1.0.59's `manifest.distribution` records the digest of every file the
distribution ships, and `77-council-of-wise-elders/scripts/selected-tree-gate.mjs`
refuses any copy that differs on one byte. A `local_divergence` entry is not a kind
the gate can prove, so a patch here now makes the vendored tree unable to prove it
is the same release.

## Dropped patches (upstreamed — preserved here for intent and provenance)

Earlier patches have since been **upstreamed**, and the canonical tree now carries
each fix (in extended form). Per the policy below ("drop it once Council carries
the fix"), they were dropped at the re-vendor to Council
`77eb96e738b8145877ac0d1729d9aef6b0be9560` (v1.0.51). Their intent is preserved
by the canonical files named here; the patch bytes stay recoverable from
999-setup git history (`0fd08bd4` and the vendoring record they were sealed under).

| Patch | Intent | Disposition at Council v1.0.51 |
|---|---|---|
| `01-dispatcher-skillRootForAssets.patch` | `runtime/src/cli/dispatcher.ts`: export `skillRootForAssets()` — resolve the ACTUAL skill folder (install record first, positive `SKILL.md` + `advisors/` + `manifest.json` ancestor climb second) and use it for advisor loading, the data-dir guard and the readiness probe, so the installed binary finds its real skill folder instead of the bare installed prefix. | **DROPPED — canonical carries the fix.** Canonical `runtime/src/cli/dispatcher.ts` now exports `skillRootForAssets()` (named positively, same two mechanisms) and `runCli` uses `resolvedRoot` for the skill root, the guard (`resolvedRoot === null` refuses) and `executableReady` — a superset: its install-record lookup covers BOTH install layouts (canonical `releases/install-record.json` and the 999 bundle `<prefix>/install-record.json` beside `runtime/dist/<entry>`). Distribution hash of the old patched file: `36a9019d7cb1779b119b30c6f1e14bcb91009bd4eeb98af40b51cae8c8782969`. |
| `02-skill-root.test.ts.patch` | Add `runtime/src/cli/skill-root.test.ts`, the regression test for that fix: source layout resolves to the skill folder; the doctor refuses a data dir inside it and accepts one outside; an installed prefix with an install record measures the RECORDED folder; no record yields no root, never a guess. | **DROPPED — canonical carries the fix.** Canonical ships `runtime/src/cli/skill-root.test.ts` with the same four proofs, extended to run them against BOTH install layouts (onboarding `releases/<id>/dist/...` and 999 `runtime/dist/council-entry.mjs`). Distribution hash of the old added file: `65a1581c4730675a51b6bd7234a1ff20ead019173e33588f545da2702fa38698`. |

Origin of the dropped patches: 999-setup commit `0fd08bd4` (diff of
`0fd08bd4~1..0fd08bd4`). They applied cleanly (`git apply --check`) to the
canonical tree at onboarding `bf2385c7553cea09d32f68c49b2765acd4867ddb`
(Council v1.0.24), which is what the pre-re-vendor distribution carried.

| Patch | Intent | Disposition |
|---|---|---|
| `03-runtime-dist-not-ignored.patch` | `runtime/.gitignore`: stop ignoring `dist/`, so a plain `git add` cannot silently drop `runtime/dist` and recreate the stale source-only package (CWE-040 entry contract). | **DROPPED — the release contract now carries the guard.** v1.0.59's `manifest.distribution` records the digest of `runtime/.gitignore` and of all 336 built files, so this patch made the vendored tree diverge from the release and the tree gate refused it. The guard it provided is replaced, actively: `scripts/vendor-council-bundle.mjs` refuses a distribution whose bytes differ from the recorded contract, and `scripts/test-council-vendor.sh` proves every recorded build file is present and byte-identical, so a `dist` file that exists but was never committed fails CI instead of riding along unverified. Distribution hash of the retired patched file: `1c7b1420c6667210ced7af86c8f893206a572abb508bd1fac912bb90e3edd421`.

## Re-vendoring

`scripts/vendor-council-bundle.mjs` deletes the vendored folder and copies the canonical
tree (shipping `runtime/dist` — the built executable — byte for byte and recording
`runtime_entry {path, sha256, bytes}`), so it drops any 999-only change. Always
re-vendor with:

    node scripts/revendor-council.mjs --source <canonical 77-council-of-wise-elders> --source-commit <full sha>
    python3 .claude/skills/black-friday-launcher/scripts/generate_dist02_manifest.py

Build the canonical runtime first (`npm ci --no-audit --no-fund && npm run build` in
`runtime/`) — a source-only tree (no `runtime/dist/blackceo-council.mjs`) is refused.

`revendor-council.mjs` runs the vendor tool, `git apply`s every `*.patch` here in name
order, then runs `scripts/realign-council-vendor-record.mjs --write`, which declares the
divergence (files, hashes, these patch artifacts) as a `local_divergence` entry in
`installer-registration/council-vendoring.json` and in the bundle's
`DISTRIBUTION-RECONCILIATION.json`. `canonical_files` carries canonical hashes only.

If a patch stops applying after a Council update, the wrapper fails; refresh the patch
against the new canonical file (or drop it once Council carries the fix — the two
above are the worked example, documented in this table).
