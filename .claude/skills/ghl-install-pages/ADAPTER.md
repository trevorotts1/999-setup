# GHL pack adapter contract (claude-nine)

The pack's adapter files change at exactly four seams (Amendment 5,
Row 6A). A fifth seam is a plan amendment, never a local invention:
the pre-copy audit flagged one candidate (host scheduling and host
services, including Skill 6's cron registration surface and the VPS
mount proof pair) and it is recorded in the pack manifest, unresolved,
for the plan owner.

## Seam 1: launch

Browser work in this harness launches through the browser-engine
contract's claude-nine mapping: the Claude Code harness's
agent-browser, driven per Skill 71's browser-engine contract
(`references/browser-engine-contract.md` in blackceo-signature-page,
whose 999 edition maps the engine table to this harness). The
OpenClaw Chrome extension is not available here and is never assumed.

## Seam 2: session seed

Authenticated GHL sessions are seeded from the install's own secrets
environment, using the variable names the audit confirmed for the
caf CLI: the Private Integration Token (preferred variable
GOHIGHLEVEL_API_KEY, with its documented aliases), the location id
(GOHIGHLEVEL_LOCATION_ID and aliases), and, only for workflow writes
through Skill 44's Firebase surface, GOHIGHLEVEL_FIREBASE_REFRESH_TOKEN
and aliases. Presence booleans may be recorded; values never are.

## Seam 3: teardown

Every browser session the pack opens is registered and reaped under
Skill 71's Item 33 browser hygiene discipline (the session registry
and reaper in blackceo-signature-page's scripts/browser_sessions.py),
and the stage's browser-hygiene receipt is written before close.

## Seam 4: paths and secrets

All paths resolve inside this repo and the Claude Code harness's own
directories (`.claude/skills/...`, the install's secrets env). No
`.openclaw` path, no OpenClaw skills tree path, and no cross-repo
reference is permitted in an adapted file.

## The caf CLI prerequisite (declared, Amendment 4)

Skill 44's Tier 0 rail is the caf CLI. The step-zero audit proved
the 999 installer does NOT provision caf (zero hits across the
install corpus). It is therefore declared here as an external
prerequisite: until the install provides it, workflow and funnel API
work falls back to the Tier 4 agent-browser backstop, and receipts
record the backstop as the rail used. The tier doctrine itself
(Tier 0 caf CLI, Tier 1 official MCP, Tier 2 community MCP, Tier 3
direct REST, Tier 4 browser, Tier 5 last resort) is Skill 36's,
vendored as data in this contract per Item 28's sub-dispositions;
Skill 29's role maps by reference onto this pack's rails.
