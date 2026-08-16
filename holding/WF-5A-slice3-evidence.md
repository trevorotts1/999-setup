# WF-5A slice 3 evidence — Issue 16 FIX step 1, rows 17-19 (no-go keys + DISABLE_AUTOUPDATER)

Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md
Ledger citation: WAVE 5 DISPATCH at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 73
Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-5A (branch fix/16-unleash @ dc688c7)
Date: 2026-08-16
Nature: VERIFY-ONLY slice. settings.json files are on the LIVE operator box — read full, NOT modified. This slice wrote nothing outside the holding pen.

## Slice scope (from dispatch)

- `disableAllHooks` DO NOT SET (would kill governance hooks: boss-cron, stop-guards) — verify absent.
- `CLAUDE_CODE_DISABLE_WORKFLOWS` DO NOT SET — verify absent.
- `DISABLE_AUTOUPDATER="1"` present — verify present.

Spec rows read in full (Read tool, lines 330-374):
- Row 17 = line 360: `CLAUDE_CODE_EFFORT_LEVEL` — NEVER SET by provisioning (outside this slice, recorded only)
- Row 18 = line 361: `disableAllHooks` | unset | **DO NOT SET on the operator box** — "Would kill all user and project hooks — including the governance hooks (boss-cron, stop-guards). Unleashing must never disable governance"
- Row 19 = line 362: `CLAUDE_CODE_DISABLE_WORKFLOWS` | unset | **DO NOT SET** — "Off-switch for the entire workflow machinery; same treatment as disableAllHooks"
- Row 11 = line 355: `DISABLE_AUTOUPDATER` / `autoUpdates` | updater on | `DISABLE_AUTOUPDATER: "1"` in settings env (documented mechanism); `autoUpdates: false` kept

## Sources read (full-file reads, no grep for judgment)

1. /Users/blackceomacmini/.claude/settings.json — 122 lines, read in full (Read tool).
2. /Users/blackceomacmini/.claude-nine/settings.json — 41 lines, read in full (Read tool).
3. /Users/blackceomacmini/.claude/settings.local.json — 185 lines, read in full (Read tool).
4. Live shell env of this session: `env | grep -E "^DISABLE_AUTOUPDATER=|^CLAUDE_CODE_DISABLE_WORKFLOWS=|^disableAllHooks="` — ran, rc=0 (known-good control: same instrument, same transport, non-empty for the present key).

NOT checked (named for the negative-result contract): project-level .claude/settings.json (none exists in this working copy — `find /Users/blackceomacmini/work-999-setup-fix/WF-5A -name settings.json` returned zero, only .claude/skills/ exists), managed settings (none exist on this box), launchd env (outside the settings.json files the spec table governs). All three keys live in the settings env per the spec; settings files are the authoritative source for this table.

## Findings

### 1. `disableAllHooks` — ABSENT (spec row 18, line 361: DO NOT SET)

- /Users/blackceomacmini/.claude/settings.json: full-file read shows the key nowhere. Top-level keys present: env, permissions, model, hooks, workflowSizeGuideline, enabledPlugins, extraKnownMarketplaces, effortLevel, tui, channelsEnabled, skipDangerousModePermissionPrompt, theme, autoCompactEnabled, teammateMode, inputNeededNotifEnabled, agentPushNotifEnabled, skipAutoPermissionPrompt, hasCompletedOnboarding, autoUpdates, statusLine. `hooks` block present and populated (lines 17-82: SessionStart, Stop, PreToolUse, SubagentStop — the governance hooks survive; see finding 4).
- /Users/blackceomacmini/.claude-nine/settings.json: key absent (no disableAllHooks anywhere in the 41-line file).
- /Users/blackceomacmini/.claude/settings.local.json: key absent (permissions-only file, no hooks/env blocks).
- Shell env: no disableAllHooks (env var of this name does not exist; case-insensitive reading — env names are uppercase-only in practice; `disableAllHooks` is a settings.json key, not an env var, per spec source https://code.claude.com/docs).

### 2. `CLAUDE_CODE_DISABLE_WORKFLOWS` — ABSENT (spec row 19, line 362: DO NOT SET)

- /Users/blackceomacmini/.claude/settings.json env block (lines 2-7) holds exactly 4 keys: CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, DISABLE_AUTOUPDATER, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS. CLAUDE_CODE_DISABLE_WORKFLOWS not among them.
- /Users/blackceomacmini/.claude-nine/settings.json env block (lines 4-20) holds 13 keys (ANTHROPIC_BASE_URL, 4x ANTHROPIC_DEFAULT_*_MODEL, CLAUDE_CODE_SUBAGENT_MODEL, CLAUDE_CODE_MAX_CONTEXT_TOKENS, CLAUDE_CODE_MAX_OUTPUT_TOKENS, CLAUDE_CODE_API_KEY_HELPER_TTL_MS, DISABLE_LOGIN_COMMAND, DISABLE_LOGOUT_COMMAND, CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, DISABLE_AUTOUPDATER, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS). CLAUDE_CODE_DISABLE_WORKFLOWS not among them.
- /Users/blackceomacmini/.claude/settings.local.json: no env block.
- Shell env grep: no match — the only line returned was DISABLE_AUTOUPDATER=1 (control proves the instrument works).

### 3. `DISABLE_AUTOUPDATER="1"` — PRESENT, exact value "1", in settings env (spec row 11, line 355)

- /Users/blackceomacmini/.claude/settings.json line 5: `"DISABLE_AUTOUPDATER": "1"` inside env block.
- /Users/blackceomacmini/.claude-nine/settings.json line 18: `"DISABLE_AUTOUPDATER": "1"` inside env block.
- Shell env: `DISABLE_AUTOUPDATER=1` (live process env, same value).
- `autoUpdates: false` retained as documented: /Users/blackceomacmini/.claude/settings.json line 117; /Users/blackceomacmini/.claude-nine/settings.json line 35. Spec row 11 says "autoUpdates: false kept (undocumented/legacy, present in both settings files)" — matches.

### 4. Governance hooks intact (guard against the row-18 failure mode)

Row 18's rationale is that setting disableAllHooks would kill governance hooks. Verify hooks survive: /Users/blackceomacmini/.claude/settings.json lines 17-82 carry hooks SessionStart (sync-n8n-mcp-key.sh, sync-github-mcp-key.sh), Stop (reconcile-tasks-reminder.sh, floor-claim-gate.py, goal-claim-gate.py, negative-claim-gate.py), PreToolUse (gate-wait-guard.sh), SubagentStop (subagent-stop-guard.sh). This is read-only evidence for the slice's negative claims; no mutation performed.

## Verdict lines

- disableAllHooks: VERIFIED ABSENT in both settings.json files, settings.local.json, and shell env.
- CLAUDE_CODE_DISABLE_WORKFLOWS: VERIFIED ABSENT in both settings.json files, settings.local.json, and shell env.
- DISABLE_AUTOUPDATER: VERIFIED PRESENT = "1" in both settings.json env blocks and live shell env.

VERDICT: DONE
