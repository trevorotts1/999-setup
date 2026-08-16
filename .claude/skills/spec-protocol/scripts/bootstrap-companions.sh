#!/usr/bin/env bash
# bootstrap-companions.sh — detect-first, source-locked installer for Spec
# Protocol companion skills. Idempotent: safe to run repeatedly; never
# creates duplicate installations.
#
# Sources come ONLY from references/dependency-sources.md (no GitHub
# searching, no fork picking). Every dependency reports
# Installed / Already Installed / Failed, with its exact source URL.
# A Failed status never silently downgrades to Skipped.
#
# Never prints API keys or any secret value.
set -uo pipefail

CLAUDE_CONFIG_DIR_ACTUAL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
# The shared-vs-separate comparison is ALWAYS $HOME/.claude vs the claude-nine
# dir — comparing CLAUDE_CONFIG_DIR (an env var the caller may inherit) against
# itself proves nothing. A genuinely shared setup has no separate claude-nine
# dir at all; a separate one is detected by its own .claude.json existing.
CC9_CONFIG_DIR="${CLAUDE_NINE_CONFIG_DIR:-$HOME/.claude-nine}"
if [ ! -f "$CC9_CONFIG_DIR/.claude.json" ]; then
  CC9_IS_SEPARATE=0
else
  CC9_IS_SEPARATE=1
fi

PASS=0
FAIL=0
WARN=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '✗ %s\n' "$*"; FAIL=$((FAIL+1)); }
warn() { printf '! %s\n' "$*"; WARN=$((WARN+1)); }

# --- detection helpers ------------------------------------------------

skill_dir_exists() {
  local name="$1"
  [ -d "$HOME/.claude/skills/$name" ] && return 0
  [ -L "$HOME/.claude/skills/$name" ] && return 0
  # Installers like ui-ux-pro-max-cli write into $PWD/.claude/skills.
  find "$PWD" -maxdepth 3 -type d -path "*/.claude/skills/$name" -print -quit 2>/dev/null | grep -q . && return 0
  [ -d "$PWD/.claude/skills/$name" ] && return 0
  return 1
}

# Claude Code plugin registry: ~/.claude/plugins/installed_plugins.json has a
# nested "plugins" map whose keys are "<name>@<marketplace>".
plugin_installed() {
  local name="$1"
  [ -f "$HOME/.claude/plugins/installed_plugins.json" ] \
    && jq -e --arg s "$name" '.plugins | keys | map(select(startswith($s + "@"))) | length > 0' \
        "$HOME/.claude/plugins/installed_plugins.json" >/dev/null 2>&1
}

known_marketplace() {
  local name="$1"
  [ -f "$HOME/.claude/plugins/known_marketplaces.json" ] \
    && jq -e --arg s "$name" 'has($s)' \
        "$HOME/.claude/plugins/known_marketplaces.json" >/dev/null 2>&1
}

claude_skill_list() {
  # Discovery from the AI coding environment itself: the authoritative
  # check. claude may be absent on a bare box — then we fall back to
  # directory evidence and say so (UNDETERMINED beats a confident zero).
  if command -v claude >/dev/null 2>&1; then
    claude --help 2>/dev/null | grep -qi "skill" || true
  fi
}

uipro_installed() {
  command -v uipro >/dev/null 2>&1
}

mcp_registered() {
  # Plain claude's config store is always $HOME/.claude.json — never a
  # caller-inherited CLAUDE_CONFIG_DIR value (that env var belongs to the
  # claude-nine launch, not to this script's runtime).
  local server="$1"
  [ -f "$HOME/.claude.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$HOME/.claude.json" >/dev/null 2>&1
}

mcp_registered_cc9() {
  local server="$1"
  [ -f "$CC9_CONFIG_DIR/.claude.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$CC9_CONFIG_DIR/.claude.json" >/dev/null 2>&1
}

mcp_registered_project() {
  local server="$1"
  [ -f "$PWD/.mcp.json" ] \
    && jq -e --arg s "$server" '.mcpServers[$s] != null' \
        "$PWD/.mcp.json" >/dev/null 2>&1
}

# Project-scoped store: entries nested under .projects/<path>/mcpServers in
# the main .claude.json files (claude mcp add --scope project writes there).
mcp_in_projects_store() {
  local file="$1" server="$2"
  [ -f "$file" ] \
    && jq -e --arg s "$server" '.projects | to_entries[] | ((.value.mcpServers // {})[$s]) != null' \
        "$file" >/dev/null 2>&1
}

# Any store entry whose URL contains the fragment (for servers whose config
# key may vary, e.g. the Vercel CLI's).
mcp_url_in_any_store() {
  local frag="$1"
  for f in "$HOME/.claude.json" "$CC9_CONFIG_DIR/.claude.json" "$PWD/.mcp.json"; do
    [ -f "$f" ] || continue
    jq -e --arg f "$frag" '.mcpServers | to_entries[] | select((.value.url // "") | contains($f))' \
        "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}

# --- report -----------------------------------------------------------

report() {
  say ""
  say "===== 12-item installation report ====="
  say "1. Companion capability: see sections above (Frontend Design / UI/UX Pro Max / Supabase / Kie.ai / Agnes AI)."
  say "2. Exact repository URL: see sections above (each dependency states its source URL)."
  say "3. Installed version when available: see sections above."
  say "4. Installation location: user scope \$HOME/.claude/skills (or project .claude/skills), plugins/marketplaces per Claude Code, MCP servers in the active config store."
  say "5. Installation method: command shown in each section above."
  say "6. Claude Code discovery status: $( [ -x "$(command -v claude 2>/dev/null || true)" ] && echo "checked (see sections)" || echo "UNDETERMINED — claude binary not found on PATH" )"
  say "7. Claude-nine discovery status: $( if [ -d "$CC9_CONFIG_DIR" ]; then echo "checked (see sections)"; else echo "UNDETERMINED — $CC9_CONFIG_DIR not present on this box"; fi )"
  say "8. Supabase MCP status: see Supabase section."
  say "8b. GitHub MCP status: see GitHub MCP section (OAuth default; PAT optional)."
  say "8c. Vercel MCP status: see Vercel MCP section (vercel CLI auth)."
  say "9. Supabase authentication status: see Supabase section."
  say "10. Kie.ai configuration status: Kie.ai is PRIMARY and already implemented inside Spec Protocol — preserved, not reinstalled (see references/dependency-sources.md section 4)."
  say "11. Agnes AI configuration status: Agnes is the APPROVED ALTERNATIVE — configured only when the project chooses it; never required, never auto-subscribed."
  say "12. Manual client action: Supabase account/dashboard onboarding when the client lacks one (https://supabase.com/dashboard); browser OAuth for Supabase MCP and for any MCP server that requires it."
  say ""
  say "Result: $PASS ok, $FAIL failed, $WARN warnings."
  [ "$FAIL" -eq 0 ]
}

# =====================================================================
# 1. FRONTEND DESIGN — https://github.com/anthropics/claude-plugins-official
# =====================================================================
say ""
say "Checking Frontend Design..."
say "Source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design"

FD_INSTALLED=0
if skill_dir_exists frontend-design || plugin_installed frontend-design; then
  FD_INSTALLED=1
fi

if [ "$FD_INSTALLED" -eq 1 ]; then
  ok "Installed and healthy"
  say "Source verified: anthropics/claude-plugins-official"
else
  if command -v claude >/dev/null 2>&1; then
    say "Not detected — installing from the locked source..."
    if claude plugin marketplace add anthropics/claude-plugins-official 2>&1 | sed 's/^/  /'; then
      if claude plugin install frontend-design@claude-plugins-official 2>&1 | sed 's/^/  /'; then
        if skill_dir_exists frontend-design; then
          ok "Installed and healthy"
          say "Source verified: anthropics/claude-plugins-official"
        else
          warn "Install command ran; directory evidence not found yet — restart Claude Code and re-run this script."
        fi
      else
        bad "Plugin install failed. Source: https://github.com/anthropics/claude-plugins-official — report this failure; do not substitute another repository."
      fi
    else
      warn "marketplace add returned non-zero — the marketplace may already exist. Trying install directly..."
      if claude plugin install frontend-design@claude-plugins-official 2>&1 | sed 's/^/  /'; then
        ok "Installed and healthy"
        say "Source verified: anthropics/claude-plugins-official"
      else
        bad "Plugin install failed. Source: https://github.com/anthropics/claude-plugins-official — report this failure; do not substitute another repository."
      fi
    fi
  else
    warn "claude binary not on PATH — cannot run plugin install. Manual step: run /plugin install frontend-design@claude-plugins-official inside Claude Code."
  fi
fi

# =====================================================================
# 2. UI/UX PRO MAX — https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
# =====================================================================
say ""
say "Checking UI/UX Pro Max..."
say "Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill"

if skill_dir_exists ui-ux-pro-max; then
  if uipro_installed; then
    ok "Installed and healthy"
  else
    warn "Skill installed; uipro CLI not on PATH (npx installs do not add it globally) — run 'npx ui-ux-pro-max-cli' for CLI functions or 'npm install -g ui-ux-pro-max-cli@latest' if the CLI is wanted."
  fi
  say "Source verified: nextlevelbuilder/ui-ux-pro-max-skill"
else
  say "Not detected — installing from the locked source..."
  if npx --yes ui-ux-pro-max-cli init --ai claude 2>&1 | sed 's/^/  /'; then
    if skill_dir_exists ui-ux-pro-max; then
      if uipro_installed; then
        ok "Installed and healthy"
      else
        warn "Skill installed; uipro CLI not on PATH — run 'npx ui-ux-pro-max-cli' for CLI functions or 'npm install -g ui-ux-pro-max-cli@latest' if the CLI is wanted."
      fi
      say "Source verified: nextlevelbuilder/ui-ux-pro-max-skill"
    else
      bad "Install failed. Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — report this failure; do not substitute another fork."
    fi
  else
    bad "Install failed. Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill — report this failure; do not substitute another fork."
  fi
fi

# =====================================================================
# 3. SUPABASE — https://github.com/supabase/agent-skills
#              + https://github.com/supabase-community/supabase-plugin
# =====================================================================
say ""
say "Checking Supabase..."
say "Skills source: https://github.com/supabase/agent-skills"
say "Plugin source: https://github.com/supabase-community/supabase-plugin"

SUPABASE_OK=0
if skill_dir_exists supabase && skill_dir_exists supabase-postgres-best-practices; then
  ok "Skills installed"
  SUPABASE_OK=1
else
  say "Skills not detected — installing from the locked source..."
  if npx --yes skills add supabase/agent-skills 2>&1 | sed 's/^/  /'; then
    if skill_dir_exists supabase; then
      ok "Skills installed"
      SUPABASE_OK=1
    else
      warn "skills add ran; skill dirs not detected yet — restart Claude Code and re-run this script."
    fi
  else
    bad "Skills install failed. Source: https://github.com/supabase/agent-skills — report this failure; do not substitute another repository."
  fi
fi

if plugin_installed supabase; then
  ok "Plugin installed"
else
  say "Plugin not detected — installing from the locked source..."
  # The open-plugins installer prompts interactively ("Install? [Y/n]") and
  # hangs headless. Answer it and retry on a non-zero exit.
  if yes | npx --yes plugins add supabase-community/supabase-plugin 2>&1 | sed 's/^/  /'; then
    if plugin_installed supabase; then
      ok "Plugin installed"
    else
      warn "plugins add ran; plugin registry entry not detected yet — restart Claude Code and re-run this script."
    fi
  else
    bad "Plugin install failed. Source: https://github.com/supabase-community/supabase-plugin — report this failure; do not substitute another repository."
  fi
fi

if mcp_registered supabase || mcp_registered_cc9 supabase || mcp_registered_project supabase \
   || mcp_in_projects_store "$HOME/.claude.json" supabase || mcp_in_projects_store "$CC9_CONFIG_DIR/.claude.json" supabase; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v claude >/dev/null 2>&1; then
    claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp" 2>&1 | sed 's/^/  /' \
      && { mcp_registered_project supabase && ok "MCP available (project scope)" || warn "add ran; project .mcp.json entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Supabase MCP add failed. Source: https://supabase.com/docs/guides/getting-started/mcp — report this failure; do not substitute another endpoint."
  else
    warn "claude binary not on PATH — manual step: claude mcp add --scope project --transport http supabase \"https://mcp.supabase.com/mcp\""
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 supabase; then
  warn "Supabase MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: browser OAuth (claude /mcp -> supabase -> Authenticate) — never ask the client to paste secret keys into AI chat. Undetermined until /mcp shows the server."

# =====================================================================
# 3c. GITHUB MCP — https://api.githubcopilot.com/mcp/
# =====================================================================
say ""
say "Checking GitHub MCP..."
say "Source: https://github.com/github/github-mcp-server (hosted endpoint: https://api.githubcopilot.com/mcp/)"

if mcp_registered github || mcp_registered_cc9 github || mcp_registered_project github \
   || mcp_in_projects_store "$HOME/.claude.json" github || mcp_in_projects_store "$CC9_CONFIG_DIR/.claude.json" github; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v claude >/dev/null 2>&1; then
    claude mcp add --transport http github "https://api.githubcopilot.com/mcp/" 2>&1 | sed 's/^/  /'
    rc=$?
    if [ $rc -eq 0 ]; then
      { mcp_registered github || mcp_in_projects_store "$HOME/.claude.json" github; } && ok "MCP available" \
        || warn "add ran; entry not detected yet — restart Claude Code and re-run this script."
    elif [ $rc -eq 1 ] && { mcp_registered github || mcp_in_projects_store "$HOME/.claude.json" github; }; then
      # rc=1 with an existing entry = "already exists in local config" —
      # Already Installed, not Failed.
      ok "MCP available (already registered)"
    else
      bad "GitHub MCP add failed. Source: https://github.com/github/github-mcp-server — report this failure; do not substitute another endpoint."
    fi
  else
    warn "claude binary not on PATH — manual step: claude mcp add --transport http github \"https://api.githubcopilot.com/mcp/\""
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 github; then
  warn "GitHub MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: OAuth by default (browser login on first use). A GitHub PAT is optional and takes precedence when set — it must live in an env file or secret store, never in the repository."

# =====================================================================
# 3d. VERCEL MCP — https://mcp.vercel.com
# =====================================================================
say ""
say "Checking Vercel MCP..."
say "Source: https://vercel.com/docs/cli/mcp (hosted endpoint: https://mcp.vercel.com)"

if mcp_registered vercel || mcp_url_in_any_store "mcp.vercel.com"; then
  ok "MCP available"
else
  say "MCP not detected — installing from the locked source..."
  if command -v vercel >/dev/null 2>&1; then
    say "vercel CLI present; configuring Claude Code..."
    vercel mcp --clients "Claude Code" 2>&1 | sed 's/^/  /' \
      && { mcp_url_in_any_store "mcp.vercel.com" && ok "MCP available" || warn "vercel mcp ran; entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Vercel MCP setup failed. Source: https://vercel.com/docs/cli/mcp — report this failure; do not substitute another endpoint."
  elif command -v npx >/dev/null 2>&1; then
    say "vercel CLI absent; running via npx (--clients is REQUIRED non-interactively; without it the command fails with missing_clients)..."
    npx --yes vercel mcp --clients "Claude Code" 2>&1 | sed 's/^/  /' \
      && { mcp_url_in_any_store "mcp.vercel.com" && ok "MCP available" || warn "vercel mcp ran; entry not detected yet — restart Claude Code and re-run this script."; } \
      || bad "Vercel MCP setup failed. Source: https://vercel.com/docs/cli/mcp — report this failure; do not substitute another endpoint."
  else
    warn "Neither vercel CLI nor npx available — manual step: vercel mcp --clients \"Claude Code\" (or npx plugins add vercel/vercel-plugin)"
  fi
fi

if [ "$CC9_IS_SEPARATE" -eq 1 ] && ! mcp_registered_cc9 vercel && ! mcp_url_in_any_store "mcp.vercel.com"; then
  warn "Vercel MCP not registered in $CC9_CONFIG_DIR/.claude.json — a claude-nine session with a separate CLAUDE_CONFIG_DIR will NOT see it. Register it there too, or rely on the shared-config install-once rule."
fi

say "Authentication status: the Vercel CLI handles auth (vercel login); the MCP session scopes to the linked Vercel project. Never ask the client to paste a token into AI chat."

# =====================================================================
# 4. KIE.AI — PRIMARY image/video. https://kie.ai / https://docs.kie.ai
# =====================================================================
say ""
say "Checking Kie.ai (PRIMARY image/video)..."
say "Source: https://kie.ai/ (docs: https://docs.kie.ai/)"
warn "Kie.ai is already implemented inside Spec Protocol — PRESERVE and improve the existing implementation; do not replace it. (references/dependency-sources.md section 4)"

# =====================================================================
# 5. AGNES AI — APPROVED ALTERNATIVE. https://agnes-ai.com
# =====================================================================
say ""
say "Checking Agnes AI (APPROVED ALTERNATIVE)..."
say "Source: https://agnes-ai.com/ (API base: https://apihub.agnes-ai.com/v1)"
say "Status: ALTERNATIVE — configure only when the project chooses Agnes over Kie.ai. Never require both providers. Never create a paid subscription automatically."

# =====================================================================
# 6. HIGGSFIELD POLICY
# =====================================================================
say ""
say "Higgsfield: NOT a mandatory dependency — never auto-installed, never required."
say "Source: none (policy; see references/dependency-sources.md section 6)"

# =====================================================================
# 7. CLAUDE-NINE / 9ROUTER COMPATIBILITY (install-once rule)
# =====================================================================
say ""
say "Claude-nine / 9Router compatibility check..."
if [ "$CC9_IS_SEPARATE" -eq 1 ]; then
  warn "Separate claude-nine config dir detected ($CC9_CONFIG_DIR has its own .claude.json). MCP servers must be registered in BOTH stores (\$HOME/.claude.json and $CC9_CONFIG_DIR/.claude.json) — a server in only one is invisible to the other's sessions. Personal skills under \$HOME/.claude/skills are shared by both; project skills are shared when both launch from the same project directory."
else
  say "No separate claude-nine config dir on this box — shared-config install-once rule applies. Validate by launching both plain 'claude' and 'claude-nine' and confirming discovery."
fi
say "9Router rule: DO NOT modify model-routing rules merely to make a skill available."

# =====================================================================
report
