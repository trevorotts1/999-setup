# dependency-sources.md — AUTHORITATIVE SOURCE REGISTRY

DO NOT search GitHub and choose arbitrary repositories, forks, mirrors, similarly
named skills, or community copies. The URLs below are the ONLY approved sources for
Spec Protocol dependencies. Every installation reads from these, never from search.

If one of these URLs becomes unavailable, STOP and report the failed dependency —
never silently substitute another repository.

## 1. Anthropic Frontend Design

- Plugin repository: https://github.com/anthropics/claude-plugins-official
- Plugin directory: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design
- SKILL.md: https://github.com/anthropics/claude-plugins-official/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md
- Alternative official skills repository: https://github.com/anthropics/skills/tree/main/skills/frontend-design

Purpose: creative direction for production-quality frontend work — websites,
landing pages, SaaS, dashboards, portals, components, visual hierarchy, typography,
layout, spacing, animation, distinctive visual direction, avoiding generic
AI-looking interfaces.

Claude Code install: `/plugin install frontend-design@claude-plugins-official`
(after verifying the plugin marketplace is available; if the installed Claude Code
version uses changed plugin syntax, inspect `/plugin` and the installed help first).
DO NOT download a similarly named third-party `frontend-design` skill when the
official Anthropic version is available. After install, validate discovery of
`frontend-design`.

## 2. UI/UX Pro Max

- Canonical repository: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Releases: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/releases
- Skill: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md
- CLI docs: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/cli/README.md

Purpose: structured design intelligence — design systems, UI styles, color
palettes, font pairings, typography, UX patterns, accessibility guidance,
responsive design, component guidance, dashboard patterns, mobile UI,
stack-specific frontend guidance, design-system generation, UI/UX review.

Complementary to Frontend Design (creative/aesthetic direction + structured
rules/intelligence). For substantial frontend work, make BOTH available.

Install: `npx ui-ux-pro-max-cli init --ai claude` (installed executable: `uipro`).
Global: `npm install -g ui-ux-pro-max-cli@latest` then `uipro init --ai claude`.
Update: `uipro update`. Do not use another GitHub fork merely because it has the
same skill name. Before install, inspect the canonical repository's current
README, release notes, and LICENSE (package names and install syntax can change).
After install, validate discovery of `ui-ux-pro-max`.

## 3. Supabase

- Official agent-skills repository: https://github.com/supabase/agent-skills
  (skills: `supabase`, `supabase-postgres-best-practices`)
  Install: `npx skills add supabase/agent-skills`
  Individual: `npx skills add supabase/agent-skills --skill supabase`
  and `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices`
- Official combined plugin repository: https://github.com/supabase-community/supabase-plugin
  (bundles skills + Supabase MCP + vendor-specific integration)
  Install: `npx plugins add supabase-community/supabase-plugin`
- Plugin docs: https://supabase.com/docs/guides/ai-tools/plugins
- AI tools docs: https://supabase.com/docs/guides/ai-tools
- API-key docs: https://supabase.com/docs/guides/getting-started/api-keys
- Dashboard: https://supabase.com/dashboard

For Claude Code specifically, the official Claude plugin mechanism may also be
used: `claude plugin marketplace add anthropics/claude-plugins-official` then
`claude plugin install supabase@claude-plugins-official`. Inspect the installed
Claude Code version and the official Supabase documentation before choosing
between methods; prefer the method that installs the complete current integration
without creating duplicate installations.

## 3b. Supabase MCP (the live server)

- Hosted endpoint: `https://mcp.supabase.com/mcp` (local dev:
  `http://localhost:54321/mcp`)
- Docs: https://supabase.com/docs/guides/getting-started/mcp

Claude Code add command (project scope):

```bash
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp"
```

Auth: dynamic client registration OAuth — a browser window opens, the client
logs into Supabase and grants access. No personal access token required.

## 3c. GitHub MCP

- Official repository: https://github.com/github/github-mcp-server
- Hosted endpoint: `https://api.githubcopilot.com/mcp/`
  (insiders: `https://api.githubcopilot.com/mcp/insiders` or header
  `"X-MCP-Insiders": "true"`)
- Docs: https://docs.github.com/en/copilot/concepts/agents/model-context-protocol

Auth (default, github.com): OAuth — the official image ships app credentials;
the browser login happens on first use. A GitHub personal access token may be
used instead (it takes precedence over OAuth); a PAT must live in an env file
or secret store, never in the repository.

Docker local form (when a local server is wanted instead of the hosted
endpoint):

```bash
claude mcp add github -e GITHUB_PERSONAL_ACCESS_TOKEN=$GITHUB_PAT -- docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
```

## 3d. Vercel MCP

- Hosted endpoint: `https://mcp.vercel.com` (project-scoped:
  `https://mcp.vercel.com/<org>/<project>`)
- CLI docs: https://vercel.com/docs/cli/mcp
- Server docs: https://vercel.com/docs/agent-resources/vercel-mcp
- Official plugin: `npx plugins add vercel/vercel-plugin`

Claude Code setup (the Vercel CLI configures the client directly):

```bash
vercel mcp --clients "Claude Code"
```

The command is interactive by default; `--clients` is REQUIRED in
non-interactive environments (CI) — without it the command fails with
`missing_clients`. `--project` scopes MCP access to the linked Vercel
project. The command never deploys an MCP server of its own; it only
adjusts client-side configuration.

## 4. KIE.AI

- Website: https://kie.ai/
- API docs: https://docs.kie.ai/
- API quickstart: https://docs.kie.ai/common-api/quickstart
- Marketplace docs: https://docs.kie.ai/market/quickstart
- API base URL: https://api.kie.ai

Purpose: PRIMARY image/video generation — text-to-image, image-to-image, image
editing, text-to-video, image-to-video, video generation, multimodal generation.
Do not replace the existing Kie.ai implementation inside Spec Protocol; preserve
and improve it. Do not commit the Kie.ai API key into the repository.

## 5. Agnes AI

- Website: https://agnes-ai.com/
- Developer docs: https://agnes-ai.com/doc/overview
- API platform: https://platform.agnes-ai.com/
- GitHub model/API repository: https://github.com/AgnesAI-Labs/AgnesAI-Models
- Model catalog: https://github.com/AgnesAI-Labs/AgnesAI-Models/blob/main/MODEL_CATALOG.md
- API base URL: https://apihub.agnes-ai.com/v1

Purpose: APPROVED ALTERNATIVE image/video provider — same generation classes as
Kie.ai. Choose between Kie.ai and Agnes by project needs, available models,
pricing, speed, existing client credentials, and output requirements. Do not
require both providers. Do not create a paid subscription automatically.

## 6. Higgsfield POLICY

Higgsfield is NOT a mandatory dependency. Do not install it automatically, do not
require an account, and do not make a client's implementation depend on it when
Kie.ai or Agnes AI can satisfy the visual-generation requirement.

## 7. Claude Code

- Official repository: https://github.com/anthropics/claude-code

Companion skills must be installed and validated under standard Claude Code.

## 8. Claude-nine / 9Router compatibility

Claude-nine uses 9Router as the model-routing layer. Reference repository
currently associated with that routing system:
https://github.com/nightwalker89/n9router

Do NOT assume Claude-nine has a separate skill system. Inspect the actual local
environment: determine whether standard Claude Code and Claude-nine share
`~/.claude/` and the same plugins, skills, MCP configuration, settings, and
project skill directories.

If they share the same Claude configuration: INSTALL EACH SKILL ONLY ONCE, then
launch both environments and validate that both can discover the installed
capability.

If Claude-nine maintains a genuinely separate configuration directory: install
the companion skills into that environment as well.

DO NOT modify 9Router model-routing rules merely to make a skill available.

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

Both launch paths must be tested.

## 9. Source locking rule

This file IS the dependency registry. `scripts/bootstrap-companions.sh` must
obtain dependencies from THESE sources and nothing else. Prohibited logic:
"search GitHub for frontend design skill", "find a UI UX skill", "look for a
Supabase skill". Explicit approved sources only.

## 10. Dependency verification

After every installation, verify BOTH source and functionality. Report:

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

Do not claim a capability is installed merely because a directory exists.
Actually validate discovery from the AI coding environment.

## 11. Idempotency

The installer must be safe to run repeatedly. On subsequent installs the expected
behavior resembles:

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

Do not create duplicate installations.

## 12. Installation report

At the end of every Spec Protocol bootstrap, report:
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

Every installed third-party dependency MUST include its exact source URL in the
report.

## Supabase client onboarding (when the client does not have Supabase)

Explain: "Supabase will provide the backend infrastructure for your application.
It can handle the PostgreSQL database, authentication and user accounts, APIs,
Row Level Security, realtime data, storage, and backend functions. You can begin
with a free Supabase account."

Send the client to https://supabase.com/dashboard and instruct them to:
1. Create or sign into their Supabase account.
2. Create an organization if they do not already have one.
3. Create a new project for the application.
4. Use the Free plan when it is sufficient for development.
5. Give the project a clear name.
6. Create and securely save the project's database password.
7. Wait for project provisioning to complete.

Getting project credentials (official docs:
https://supabase.com/docs/guides/getting-started/api-keys): open
Supabase Dashboard → Project → Connect, or Project Settings → API Keys.

Commonly needed: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
(Next.js: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).
The publishable key commonly begins `sb_publishable_`; secret server credentials
commonly begin `sb_secret_`.

NEVER place a secret key in browser/client-side code. NEVER put a secret key in
Git, SKILL.md, CLAUDE.md, public configuration, screenshots, logs, or
client-side JavaScript. Prefer OAuth/browser authorization for Supabase MCP
whenever supported rather than asking a client to paste powerful account
credentials into AI chat.
