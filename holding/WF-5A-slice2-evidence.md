# WF-5A slice 2 evidence — Issue 16 FIX step 1, rows 15-16 (effort levels)

Date: 2026-08-16. Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-5A (branch fix/16-unleash).
Scope: VERIFY ONLY — no settings.json writes (live operator box, read-only).
Spec rows: `999-master-fix-spec-20260815.md` lines 359 (`effortLevel` settings key = `xhigh`) and 360 (`CLAUDE_CODE_EFFORT_LEVEL` NEVER SET by provisioning).

## 1. Live settings files (operator box, full-file reads)

### /Users/blackceomacmini/.claude/settings.json (122 lines, full read)
- Line 106: `"effortLevel": "xhigh"` — row 15 key present, value `xhigh` (highest persistable; never `max`/`ultracode`). PASS.
- env map (lines 2-7): `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — NO `CLAUDE_CODE_EFFORT_LEVEL`. PASS.
- Whole file contains no other effort key.

### /Users/blackceomacmini/.claude-nine/settings.json (41 lines, full read)
- NO `effortLevel` key anywhere in the file (full read, lines 1-41).
- env map (lines 4-20) contains no `CLAUDE_CODE_EFFORT_LEVEL` (grep count 0, independent confirmation).

### Other live stores (absent-everywhere proof)
- /Users/blackceomacmini/.claude/settings.local.json: env map EMPTY (python3 key inspection), no `effortLevel` key.
- /Users/blackceomacmini/.claude-nine/settings.local.json: does not exist (ls: No such file or directory).
- launchd user domain: `launchctl getenv CLAUDE_CODE_EFFORT_LEVEL` returns empty (verified live; grep of output = 0).
- Shell profiles, existing files: ~/.zprofile, ~/.zshrc, ~/.bashrc, ~/.profile, ~/.zshenv each 0 references (grep count per file). ~/.bash_profile does not exist.
- Current process env: `CLAUDE_CODE_EFFORT_LEVEL` not set (verified in this shell).

## 2. Provisioning never sets the var (repo scan, every file carrying the string)

All 13 files containing the string `CLAUDE_CODE_EFFORT_LEVEL` in WF-5A, classified:

WRITE SITES (launcher runtime persistence — the Issue 1 mechanism row 16 explicitly sanctions: "Persistence of ultracode/max via the launcher mechanism only"):
- launchers/macos/claude-nine line 139: `pairs.push(["EFF", "CLAUDE_CODE_EFFORT_LEVEL", process.env.CLAUDE_NINE_FORCE_EFFORT])` — opt-in per launch only.
- launchers/macos/claude-nine line 151: re-applies `lastEffortSelection` (persisted session effort, launcher runtime, not provisioning).
- launchers/windows/claude-nine.ps1 line 98: same `CLAUDE_NINE_FORCE_EFFORT` opt-in.
- launchers/windows/claude-nine.ps1 line 109: same `lastEffortSelection` re-apply.

NEVER-write guards (remove/assert only):
- scripts/macos/fix-ultracode-override.sh (29 refs): detect + comment-out/remediation tool. Header line 3: "CLAUDE_CODE_EFFORT_LEVEL on this Mac, so the in-session /effort picker" — removes the var, never writes it.
- scripts/windows/Fix-UltracodeOverride.ps1 (6 refs): same remove-only role.
- scripts/common/write-routing-state.mjs line 156: comment only — "the launcher no longer exports this as CLAUDE_CODE_EFFORT_LEVEL".

COMMENT/DOC ONLY (docs, changelog, test assertions — zero writes):
- SKILL.md lines 212/223/235/236; references/architecture.md line 52; references/security.md line 100; setup-macos.sh line 487 (comment); setup-windows.ps1 line 423 (comment); CHANGELOG.md 6 refs (historical records); README.md lines 119/139 (user guidance); tests/README.md lines 47/63 (assert ABSENCE after the fixers run).

Script-wide scan (every sh/ps1/mjs in the repo): only fix-ultracode-override.sh, Fix-UltracodeOverride.ps1, write-routing-state.mjs carry the string; all others zero. scripts/macos/enable-agent-teams.sh: zero effort refs (grep count 0, exit 1 = zero matches). scripts/common/record-effort-selection.mjs: writes `lastEffortSelection` to ROUTER STATE only (lines 40-44), never env, never settings.json; VALID set (line 21) includes max/ultracode but writes only the state file. install-claude-nine.sh (full read, 146 lines): installs launcher binary + PATH block only; never writes settings.json.

## 3. Provisioned effortLevel seeding (row 15 path)

Provisioning seeds the settings-key value via the ROUTER STATE file, not settings.json:
- scripts/setup-macos.sh line 441: `effortLevel: "xhigh"` (state input).
- scripts/setup-windows.ps1 line 365: `effortLevel = 'xhigh'` (state input).
- scripts/common/write-routing-state.mjs line 159: `effortLevel: input.effortLevel || "xhigh"` — seeds `xhigh`, the highest persistable; comment lines 154-158 state "max" is session-scoped only and the launcher no longer exports this as the env var.
- SKILL.md lines 212-216: launcher does NOT export the var; "the profile's settings.json effortLevel (seeded xhigh — the highest persistable level) is the recorded default".
- references/architecture.md lines 52-57: same doctrine; "max" is session-scoped and cannot be saved.

No provisioning code writes `effortLevel` to either settings.json (live files verified above: only ~/.claude carries it, value xhigh, line 106; ~/.claude-nine has none — consistent with the state-file seeding path, the settings key applies to the plain-claude store).

## 4. Live launcher state (context for the QC critic)

- /Users/blackceomacmini/.local/bin/claude-nine -> /Users/blackceomacmini/bin/claude-nine (older apiKeyHelper-variant launcher, 115 lines, full read): zero `CLAUDE_CODE_EFFORT_LEVEL`/effort references (grep count 0). Uses `CLAUDE_CONFIG_DIR=$HOME/.claude-nine` (line 32). It predates the repo's state-file launcher; the repo launcher (commit 8fac6ce) carries the opt-in persistence. The current session runs via this live launcher — its process env is clean (verified section 1).
- Live router-session.json not found at $HOME/Library/Application Support/BlackCEO/999/ (dir absent) — consistent with the apiKeyHelper launcher variant on this box; not needed for the effort verdict (state file is a runtime artifact, not a settings.json, and neither settings file carries the env var).

## 5. Verdict per slice bar

| Row | Claim | Result |
|---|---|---|
| 15 | `effortLevel` settings key = `xhigh` (never max/ultracode) | PASS — ~/.claude/settings.json:106; provisioning seeds xhigh (setup-macos.sh:441, setup-windows.ps1:365, write-routing-state.mjs:159); no max/ultracode in any settings key |
| 16 | `CLAUDE_CODE_EFFORT_LEVEL` NEVER SET by provisioning | PASS — provisioning scripts carry the string only as comments (setup-macos.sh:487, setup-windows.ps1:423, write-routing-state.mjs:156) and as remove-only fixer logic; the only env exports are launcher runtime opt-ins (CLAUDE_NINE_FORCE_EFFORT / lastEffortSelection re-apply), the row-16-sanctioned persistence mechanism |

VERDICT: DONE
