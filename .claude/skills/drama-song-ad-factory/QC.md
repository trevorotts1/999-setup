# QC Checklist — drama-song-ad-factory (Claude-Nine / Claude Code distribution)

Run this checklist against actual files and actual command output. A README
claim is never evidence (directive: do not let a README claim substitute for
code inspection or testing). Verdicts: `PASS`, `FAIL`, `UNAVAILABLE` — an
unavailable check is recorded as unavailable, never as a pass.

## 1. Package shape (directive 2.2)

- [ ] `SKILL.md`, `INSTRUCTIONS.md`, `INSTALL.md`, `EXAMPLES.md`, `QC.md`,
      `CORE_UPDATES.md`, `CHANGELOG.md`, `PREREQS.json`, `VERSION` present.
- [ ] `references/` (at least `cli-contract.md`, `parity-contract.md`),
      `scripts/core/`, `tests/`, `assets/`, `adapters/` present.
- [ ] `adapters/claude-nine/README.md` and `adapters/claude-code/README.md`
      present; there is exactly ONE skill folder, no second copy anywhere.
- [ ] `SKILL.md` frontmatter `name` is `drama-song-ad-factory` and
      `version:` equals `VERSION`.
- [ ] `PREREQS.json` parses as JSON and every entry has `id`, `type`, `label`,
      `check`, `severity`, `satisfy`.

## 2. Registry and install

- [ ] `CONTROL/bundled-skills.txt` lists `drama-song-ad-factory`.
- [ ] Every entry that was in the manifest before this skill is still there
      (a registration must not drop prior skills).
- [ ] Skill is discoverable from the shared config root in BOTH runtimes, and
      loads `references/`, `scripts/`, `assets/`, `tests/`.
- [ ] Source presence alone is not accepted as proof of installation — the
      registry line is what the installer reads.

## 3. Shared core parity (directive 2.3)

- [ ] `python3 tests/test_parity_layout.py` -> `ALL PASS`.
- [ ] Canonical tree present: packaged `scripts/core/` file set and bytes
      match the canonical OpenClaw core exactly (no hand edits to the copy).
- [ ] Canonical tree absent: output is `PARITY UNDETERMINED` and it is
      recorded as undetermined — never reported as a parity pass.
- [ ] Contract files (`campaign-schema.json`, `artifact-schema.json`,
      `qc-schema.json`, `acceptance-profile.json`) show no one-sided change.

## 4. Envelope and exit-code contract (directive 24.6)

- [ ] `python3 tests/test_cli_smoke.py` -> `ALL PASS`.
- [ ] `intake` on the thin brief exits 2 / `waiting` / `missing-essentials`
      with at most 3 questions; stdout is pure JSON with the exact envelope
      keys; stderr empty.
- [ ] `preflight` without authorization exits 4 / `rejected` /
      `approval-missing` with an actionable `next_action`.
- [ ] A missing required helper exits 1 / `module-unavailable` or
      `tool-unavailable` naming the missing helper — not a silent pass and
      not a static-provider fallback.

## 5. Adapter and routing hygiene

- [ ] No file in this skill assigns a separate config directory
      (`CLAUDE_CONFIG_DIR`), a router/model base URL (`ANTHROPIC_BASE_URL`),
      or a hardcoded local router port.
- [ ] No hardcoded model/role table: model roles resolve against the live
      catalog/rules of the current mode (directive 26).
- [ ] Claude-Nine adapter: orchestrator dispatches through workflows and
      subagents within the repository ceilings; every worker invokes the same
      control entrypoint; a worker prompt cannot bypass a failed shared guard.
- [ ] Plain Claude Code adapter: `claude` stays non-routed; the skill never
      forces router routing or persists router settings globally.
- [ ] Neither adapter duplicates the control layer; both call
      `scripts/core/intake_preflight/factory.py`.

## 6. Secrets and safety (repository rules 4-5)

- [ ] No API key, router token, password or `.env` content anywhere in the
      skill folder; no example embeds real key material.
- [ ] Credential checks are presence-only by name; nothing prints credential
      values.
- [ ] No instruction in any doc tells the operator to paste a secret into the
      repository or into a transcript.
- [ ] A successful diagnostic exit is never presented as proof that paid
      submission occurred.

## 7. Creative/QC integrity (shared with the OpenClaw distribution)

- [ ] Twelve-stage order, sub-avatar targeting, product reveal after the story
      earns it, lyrics-as-sales-copy, no lip-sync default: unchanged from the
      canonical doctrine.
- [ ] `qc_gate.py` runs before each material stage advance; reviewer identity
      is independent of the maker — a maker-authored `PASS` record is not
      independent QC evidence (directive 17.6).
- [ ] `acceptance-profile.json` thresholds are labeled `uncalibrated` until
      calibrated against approved examples; no uncalibrated numeric score is
      claimed as proof of identity.
- [ ] Critical categories (identity, lyrics, offer, claim, product label, CTA)
      are never erased by an aggregate score; CTA `UNAVAILABLE` cannot pass.

## 8. Change control

- [ ] Any core change regenerated `scripts/core/` from canonical, re-ran both
      tests, bumped `VERSION` and added a `CHANGELOG.md` entry
      (`CORE_UPDATES.md`).
- [ ] Core and adapter changes were never applied to only one distribution
      (lockstep defect).
- [ ] Verdicts are written by the checker, never self-approved by the author.
