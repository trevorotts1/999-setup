# ELI5 — Candice integration

Owned by WS-38 (manifest 9.2 WR-019). The minimum Candice touchpoint for the
ELI5 skill — nothing more (Master Spec §25: add only the minimum integration
instructions to ELI5; no contradictory duplicate instructions).

Candice is an optional presentation surface. **No Candice failure is ever
allowed to destroy, reset, or block Claude** (Master Spec §20). ELI5 remains
the brain, rules, memory, and source of truth. This integration changes zero
ELI5 rules — it only lets compact Candice forward the user's own `/eli5` to
the same Claude session (Master Spec §13.3, §16; E.1 WS-38).

---

## 1. Activation

ELI5 is one of the four supported slash commands (Master Spec §3). The
Candice plugin's wake-up hook (`plugins/candice-integration/hooks/hooks.json`,
matcher `eli5`) launches/raises the companion and binds it to the current
Claude session and terminal host (Master Spec §13.1). The hook never blocks
the skill.

ELI5 needs nothing else from Candice. If the plugin or companion is absent,
`/eli5` runs exactly as it always has — the skill does not probe the app, and
no Candice step is required.

## 2. What Candice does for /eli5

One thing only: after the interview, compact Candice accepts the user's own
typed or spoken `/eli5` and submits it to the same Claude session (Master Spec
§13.3, §16). The submission:

- submits only text the user explicitly typed/spoke — never a synthesized or
  hidden prompt (Master Spec §13.3);
- preserves ELI5's own documented switch: when the user gives one of the
  skill's level arguments (`/eli5 easy|chill|quick` — eli5 SKILL.md "Switch"),
  the argument is carried through verbatim; the module never invents a level
  the user did not give;
- routes through the WS-05 same-session seam
  (`plugins/candice-integration/fallback/terminal-input-adapter.js`) — the
  session ID is the routing authority, never the window (Master Spec §17);
- queues while Claude is busy and shows "Claude is working. I'll send that as
  soon as it's ready." (Master Spec §13.3);
- disables itself when the exact session cannot be proven — the user then
  types `/eli5` directly in Claude (Master Spec §17, §20).

Mechanics: `integrations/eli5/eli5-submission.js` — `normalizeEli5Command()`
maps the user's own input (`/eli5`, `/ELI5`, spoken "eli5", plus the
documented level argument) to the canonical `/eli5` command text;
`Eli5Submission#submit()` hands it to the WS-05 seam. ELI5 has no governed
questions — there is no question order, ceiling, or count in this integration
to modify.

## 3. What Candice never does here

- Never renames the slash command (Master Spec §13.1).
- Never rewrites ELI5's rules, levels, or license file — those stay owned by
  the eli5 skill itself (Master Spec §2, §25).
- Never composes or injects text the user did not give, including never
  inventing a level argument (Master Spec §13.3).
- Never keeps answer/audio/secret state (Master Spec §8, §13.2).
- Never submits into a window that cannot be proven to be the owning session
  (Master Spec §17, §20).

## Tests

```bash
node plugins/candice-integration/integrations/eli5/eli5.test.js
```

Exits 0 on PASS, 1 on FAIL. Zero dependencies, runs on macOS and Windows
native paths.
