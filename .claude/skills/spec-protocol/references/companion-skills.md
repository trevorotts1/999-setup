# companion-skills.md — COMPANION SKILL LIFECYCLE

Spec Protocol has four companion capabilities. This file is the lifecycle
contract: how each is detected, installed, validated, and reported. The
authoritative sources are locked in `references/dependency-sources.md` — the
installer reads ONLY from that registry. There is no GitHub searching, no
fork picking, no "find a similar skill" fallback.

## The four companions

1. **Frontend Design** (Anthropic, official) — creative direction for
   production-quality frontend work.
2. **UI/UX Pro Max** (Next Level Builder) — structured design intelligence,
   design systems, UI patterns, accessibility.
3. **Supabase** (official skills + official community plugin) — backend
   infrastructure: PostgreSQL, auth, APIs, Row Level Security, realtime,
   storage, functions.
4. **Visual generation** — Kie.ai (PRIMARY, preserve the existing
   implementation) and Agnes AI (APPROVED ALTERNATIVE). Never both required.
   Higgsfield is NOT a mandatory dependency and is never auto-installed.

## Detection (ALWAYS BEFORE INSTALL)

The bootstrap runs detection first, for every dependency, in this order:

1. `command -v uipro` — UI/UX Pro Max CLI executable.
2. `ls ~/.claude/skills/` — installed personal skills (look for
   `frontend-design`, `ui-ux-pro-max`, `supabase` directories).
3. `ls <project>/.claude/skills/` — project-local skills.
4. `claude /plugin` help output (or the installed version's plugin command) —
   installed plugins and marketplaces.
5. `jq '.mcpServers' ~/.claude.json` — user-scope MCP servers (look for
   `supabase`).
6. `jq '.mcpServers' ~/.claude-nine/.claude.json` — claude-nine config store
   (see claude-nine compatibility below).

A capability is "Already Installed" ONLY when discovery succeeds — a
directory alone is not proof. Do not claim installed merely because a path
exists.

## claude-nine / 9Router compatibility (install-once rule)

Claude-nine is Claude Code routed through 9Router. It does not have its own
skill system. The bootstrap MUST inspect the actual environment:

1. Check whether plain `claude` and `claude-nine` share `~/.claude/` (personal
   skills, plugins, settings) and the same project directories.
2. If shared: **INSTALL EACH SKILL ONLY ONCE**, then validate BOTH launch
   paths — launch plain `claude` and launch `claude-nine`, and confirm both
   can discover the installed capability.
3. If claude-nine uses a separate config directory (`CLAUDE_CONFIG_DIR` set,
   e.g. `~/.claude-nine`): check ITS config store (`~/.claude-nine/.claude.json`,
   `~/.claude-nine/settings.json`) and install into it as well. MCP servers in
   particular must be registered in the store the launching CLI actually
   reads — a server registered only in `~/.claude.json` is invisible to a
   session running under a separate `CLAUDE_CONFIG_DIR`.
4. **DO NOT modify 9Router model-routing rules** merely to make a skill
   available.

Target state:

```
Standard Claude Code         Claude-nine / 9Router
        ↓                            ↓
spec-protocol                spec-protocol
        +                            +
frontend-design              frontend-design
        +                            +
ui-ux-pro-max                ui-ux-pro-max
        +                            +
Supabase                     Supabase
```

Both launch paths must be tested. Note: MCP servers load at session start —
a session already running when a server is registered cannot see it until a
fresh session starts.

## Installation (only what detection said is missing)

- Frontend Design: `/plugin install frontend-design@claude-plugins-official`
  (verify the installed Claude Code's plugin syntax first).
- UI/UX Pro Max: `npx ui-ux-pro-max-cli init --ai claude` (executable `uipro`;
  global: `npm install -g ui-ux-pro-max-cli@latest` then `uipro init --ai claude`).
- Supabase skills: `npx skills add supabase/agent-skills`
  (individual: `npx skills add supabase/agent-skills --skill supabase` and
  `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices`).
- Supabase plugin: `npx plugins add supabase-community/supabase-plugin`
  (skills + Supabase MCP + vendor integration in one).
- Visual generation: NEVER auto-create paid subscriptions. Kie.ai stays the
  primary; configure Agnes only when the project chooses it.

## Validation (after every install — source AND function)

- Source: the installed artifact's origin matches the locked registry URL.
- Function: actual discovery from the AI coding environment — the skill shows
  in the skill list, the plugin shows in the plugin list, the MCP server shows
  in `/mcp`, the CLI executable runs (`uipro --version` or equivalent).

## Report format (end of every bootstrap)

```
Frontend Design
Source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design
Status: Installed / Already Installed / Failed

UI/UX Pro Max
Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
Status: Installed / Already Installed / Failed

Supabase
Skills source: https://github.com/supabase/agent-skills
Plugin source: https://github.com/supabase-community/supabase-plugin
Status: Installed / Already Installed / Authentication Required / Failed
```

## The 12-item installation report

Every bootstrap ends with this report:
1. Companion capability.
2. Exact repository URL.
3. Installed version when available.
4. Installation location.
5. Installation method.
6. Claude Code discovery status.
7. Claude-nine discovery status.
8. Supabase MCP status.
9. Supabase authentication status.
10. Kie.ai configuration status.
11. Agnes AI configuration status.
12. Anything requiring manual client action.

Every installed third-party dependency MUST include its exact source URL in
the report.

## Idempotency

`scripts/bootstrap-companions.sh` is safe to run repeatedly. Re-runs detect
first, install nothing that is already installed, and never create duplicate
installations. Expected re-run output:

```
Checking Frontend Design...
✓ Installed and healthy
Source verified: anthropics/claude-plugins-official

Checking UI/UX Pro Max...
✓ Installed and healthy
Source verified: nextlevelbuilder/ui-ux-pro-max-skill

Checking Supabase...
✓ Skills installed
✓ Plugin installed
✓ MCP available
Authentication status: Connected
```

## Failure discipline

- Any URL in the source registry unavailable → STOP and report the failed
  dependency. Never substitute another repository.
- Supabase MCP present but unauthenticated → report "Authentication Required"
  and hand the client the OAuth/browser flow — never ask the client to paste
  secret keys into AI chat.
- A Failed status never silently downgrades to Skipped.
