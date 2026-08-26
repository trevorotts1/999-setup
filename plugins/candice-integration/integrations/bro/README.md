# Bro — Candice integration

Owned by WS-39 (manifest 9.2 WR-019). The minimum Candice touchpoint for the
Bro skill — nothing more (Master Spec §25: add only the minimum integration
instructions to Bro; no contradictory duplicate instructions).

Candice is an optional presentation surface. **No Candice failure is ever
allowed to destroy, reset, or block Claude** (Master Spec §20). Bro remains
the brain, rules, memory, and source of truth. This integration changes zero
Bro rules — it only lets compact Candice forward the user's own `/bro` to the
same Claude session (Master Spec §13.3, §16; E.1 WS-39).

---

## 1. Activation

Bro is one of the four supported slash commands (Master Spec §3). The Candice
plugin's wake-up hook (`plugins/candice-integration/hooks/hooks.json`, matcher
`bro`) launches/raises the companion and binds it to the current Claude
session and terminal host (Master Spec §13.1). The hook never blocks the
skill.

Bro needs nothing else from Candice. If the plugin or companion is absent,
`/bro` runs exactly as it always has — the skill does not probe the app, and
no Candice step is required.

## 2. What Candice does for /bro

One thing only: after the interview, compact Candice accepts the user's own
typed or spoken `/bro` and submits it to the same Claude session (Master Spec
§13.3, §16). The submission:

- submits only text the user explicitly typed/spoke — never a synthesized or
  hidden prompt (Master Spec §13.3);
- routes through the WS-05 same-session seam
  (`plugins/candice-integration/fallback/terminal-input-adapter.js`) — the
  session ID is the routing authority, never the window (Master Spec §17);
- queues while Claude is busy and shows "Claude is working. I'll send that as
  soon as it's ready." (Master Spec §13.3);
- disables itself when the exact session cannot be proven — the user then
  types `/bro` directly in Claude (Master Spec §17, §20).

Mechanics: `integrations/bro/bro-submission.js` — `normalizeBroCommand()`
maps the user's own input (`/bro`, `/BRO`, spoken "bro") to the canonical
`/bro` command text; `BroSubmission#submit()` hands it to the WS-05 seam.
No question order, ceiling, or count exists for `/bro` — there is nothing in
this integration to modify.

## 3. What Candice never does here

- Never renames the slash command (Master Spec §13.1).
- Never rewrites Bro's rules, example library, or license files — those stay
  owned by the bro skill itself (Master Spec §2, §25).
- Never composes or injects text the user did not give (Master Spec §13.3).
- Never keeps answer/audio/secret state (Master Spec §8, §13.2).
- Never submits into a window that cannot be proven to be the owning session
  (Master Spec §17, §20).

## Tests

```bash
node plugins/candice-integration/integrations/bro/bro.test.js
```

Exits 0 on PASS, 1 on FAIL. Zero dependencies, runs on macOS and Windows
native paths.
