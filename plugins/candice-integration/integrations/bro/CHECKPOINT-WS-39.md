# CHECKPOINT — WS-39 Bro Candice Integration

Run: WR-021 (candice-final-validation), workstream WS-39
Builder: WS-WS-39 / W3 WR-021 (opus/max)
Worktree: `worktrees/wr001-bootstrap` @ branch `candice/wr001-bootstrap`
Date: 2026-08-21
Status: BUILT — awaiting QC (builder does not self-promote; box-flip per Box-flip rule)

## Deliverable — files created (all under `plugins/candice-integration/integrations/bro/`)

| File | Purpose |
|---|---|
| `README.md` | Minimum Bro integration instructions (Master Spec §25): activation, what Candice does for /bro, what she never does, test command. Zero Bro rule changes. |
| `bro-submission.js` | Compact-companion `/bro` submission path (Master Spec §13.3, §16): `normalizeBroCommand()` maps the user's own typed/spoken input to the canonical `/bro`; `BroSubmission#submit()` routes through the WS-05 same-session seam (`fallback/terminal-input-adapter.js`) with session identity as routing authority, never the window (§17). Busy queue + exact §13.3 note; refuses non-command text; fails soft everywhere (§20). |
| `bro.test.js` | 21 assertions, plain `node`, exit 0 on PASS: normalization, same-session delivery, busy queue + note, unproven-session refusal, no-rule-changes metadata, statelessness, real-seam integration both directions. |

Owned glob per PROJECT-MANIFEST 9.2 WR-019: `plugins/candice-integration/integrations/bro/**` — nothing outside it was created or edited.

## Acceptance evidence (E.1 WS-39 + task-graph snapshot)

1. Bro minimum integration instructions present (spec 25) — `README.md` + header comments in both modules; concise, references the WS-05 seam, no duplicate instructions.
2. Compact-companion `/bro` submission path works (spec 16/13.3) — `bro.test.js` green: 21/21 PASS (evidence above).
3. No rule changes — `integrationInfo().ruleChanges === false`; the lane never writes `.claude/skills/bro/**`; slash command not renamed (`BRO_COMMAND === '/bro'`, spec 13.1).
4. Same-session only — submission goes through the WS-05 adapter with the session as routing authority; unproven session refused with `unproven-session` (spec 17/20; verified against the REAL `fallback/terminal-input-adapter.js`).
5. Fail-soft — every refusal is a decision object, never a throw; `submit()` returns `{ok:false, code, error}` on invalid input, seam failure, or unproven target (spec 20).
6. Stateless — module holds only the adapter reference; no answer/audio/secret store (spec 8/13.2).

## Dependencies honored (snapshot: WS-04, WS-05, WS-36, WS-37, WS-38)

- WS-05 seam consumed read-only: `fallback/terminal-input-adapter.js` (require + real integration tests).
- WS-36 reference docs (`references/candice-companion.md`) style followed for the README.
- WS-37/WS-38 siblings may land concurrently — this lane writes only `integrations/bro/**`, disjoint by construction.

## Cross-lane findings

- CROSS-LANE-FINDING WS-39 -> conductor (severity: informational): `plugins/candice-integration/README.md` Layout table row says `integrations/{kaizen,eli5,bro}/**` owned by "WS-19 lane" — that is the WS-19 SPEECH lane, a WR-014 row; manifest 9.2 WR-019 owns the integrations dirs. The README row predates the reconciliation and is WS-05's file. Suggest conductor correct the owner label to WR-019 (WS-36/37/38/39) — no write done here.

## Verification commands used

```bash
node plugins/candice-integration/integrations/bro/bro.test.js        # 21/21 PASS, exit 0
node -e "...TerminalInputAdapter real-seam probe..."                 # unproven-session confirmed
git status --short                                                   # only integrations/bro/** added by this lane
```

No commit made (per slice instructions).
