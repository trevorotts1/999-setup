# WF-INTAKE-999 — 999 intake prep (lane `launch-automations/intake-prep`)

Prep only. No version bumps, no shared-file edits, no sends, no client files.

**Bases**
- 999 lane base: `origin/main` @ `2d6c17da8`
- Onboarding source: `origin/main` @ `f795e09ad` (skill versions match the spec rows; onboarding `launch-automations-integration` @ `a3969b650` carries the same skill versions plus the U-CONTRACT/U-GHL-PROBE merges)

## Shipped in this lane

| Item | Detail |
|---|---|
| Skill 50 Email Engine v2.0.3 | Copied whole from `openclaw-onboarding:50-email-engine` @ `origin/main` |
| Real skill dir | `.claude/skills/email-engine/` (142 files) |
| Layout shim | `.claude/skills/50-email-engine -> email-engine` (same pattern as 49/71/78 so onboarding-numbered references resolve) |
| Check | `bash .claude/skills/email-engine/verify.sh` → PASS, rc 0 (20/20 checks) |
| Frontmatter/version guard | `bash scripts/qc-assert-skill-frontmatter-version.sh` → PASS |
| docs-fresh | failure set byte-identical to the baseline (1085 pre-existing tag failures, none new) |

## Sync list (prep evidence, not performed here)

Path map: onboarding `<NN>-name/` → 999 `.claude/skills/<frontmatter-name>/`.
Compared tree-for-tree (`git ls-tree -r` blob SHAs, onboarding `origin/main` vs 999 `origin/main`).

| # | Skill | 999 version | Onboarding version | Tree result | Action |
|---|---|---|---|---|---|
| 38 | `.claude/skills/conversational-ai-system` | v2.0.20 | v2.0.20 | DRIFT: 50 onboarding-only, 1 nine-only (`PACK.md`), 91 content diffs | Not copied — 999 edition is the harness-trimmed copy; lane owner/integrator decides |
| 44 | `.claude/skills/convert-and-flow-operator` | v2.1.20 | v2.1.20 | DRIFT: 78 onboarding-only (public API engine), 1 nine-only (`PACK.md`), 44 content diffs | Not copied — harness edition |
| 49 | `.claude/skills/signature-funnel` | v2.1.18 | v2.1.18 | PARITY 129/129, 0 diffs | Nothing to do |
| 50 | `.claude/skills/email-engine` | v2.0.3 | v2.0.3 | Was absent; shipped here 142/142 | Done |
| 71 | `.claude/skills/blackceo-signature-page` | 1.3.4 | 1.3.4 | DRIFT expected by allowlist: 1 onboarding-only (`scripts/two_strike_adapter.py`), 5 nine-only (vendored/route files), 5 adapter/content diffs | Nothing to do; `scripts/check-skill71-parity.py` owns it |
| 78 | `.claude/skills/signature-product-selection` | 0.2.5 | 0.2.5 | PARITY 53/53, 0 diffs | Nothing to do |
| 83 | `.claude/skills/black-friday-launcher` | 0.2.4 | 0.2.4 | DRIFT: 2 nine-only (`scripts/generate_dist02_manifest.py`, `tests/verify_installer_python_deps.sh`), 2 content diffs (`registration.json`, `requirements.txt`) | Not copied — 999-specific registration |
| intake | `shared-utils/client_intake` | (no version) | (no version) | 7 shared files byte-identical; 2 onboarding-only tests | Tests intentionally stay in onboarding (999 Skill 71 CHANGELOG: they resolve onboarding-numbered repo-root paths) |

## Integrator-owned follow-ups (do not let a lane do these)

1. `CONTROL/bundled-skills.txt` — add `email-engine` (the installers link only what this registry lists; without it Skill 50 does not install).
2. `CONTROL/bundled-components.json` — add the `email-engine` component entry (version `2.0.3`, `installFrom: repo-tree`, `repoPath: .claude/skills/email-engine`).
3. Repo `CHANGELOG.md` / release bookkeeping (checklist M2) — no version bump was made in this lane.
4. Any shared-file lines needed by 38/44/83 sync, if the integrator chooses to take them.
