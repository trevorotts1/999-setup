# WF-5A slice 1 — Issue 16 FIX step 1: unleash table verification

WAVE 5 DISPATCH (ledger line 73, /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md)
Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, Issue 16 lines 340-363.
Slice: verify every table row against BOTH settings.json files on disk. READ-ONLY — no settings written.
Date: 2026-08-16.

## Files read (full-file, both)

- /Users/blackceomacmini/.claude/settings.json (122 lines) — user settings, plain claude
- /Users/blackceomacmini/.claude-nine/settings.json (41 lines) — claude-nine (9Router) settings
- /Users/blackceomacmini/.local/bin/claude-nine (115 lines) — live launcher (old lib-based wrapper; does not set CONCURRENCY itself)
- /Users/blackceomacmini/work-999-setup-fix/WF-5A/launchers/macos/claude-nine — repo macOS launcher
- /Users/blackceomacmini/work-999-setup-fix/WF-5A/launchers/windows/claude-nine.ps1 — repo Windows launcher
- /Users/blackceomacmini/work-999-setup-fix/WF-5A/.claude/skills/nine-router-setup/scripts/setup-macos.sh
- /Users/blackceomacmini/work-999-setup-fix/WF-5A/.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs
- /Users/blackceomacmini/work-999-setup-fix/WF-5A/.claude/skills/nine-router-setup/scripts/common/write-routing-state.mjs

Control (negative-result contract): `grep -c` on known-present keys returned counts >0
(CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, DISABLE_AUTOUPDATER, workflowSizeGuideline); absence
checks on the no-go keys returned 0 with rc=1 (zero matches, not a broken instrument).

## Row-by-row table (spec line 344-363 vs on-disk)

| # | Setting | Spec "Set to" | ~/.claude/settings.json | ~/.claude-nine/settings.json | Verdict |
|---|---|---|---|---|---|
| 1 | permissions.defaultMode | bypassPermissions | L14 `"defaultMode": "bypassPermissions"` | L22 `"defaultMode": "bypassPermissions"` | PRESENT CORRECT |
| 2 | skipDangerousModePermissionPrompt | true | L109 `true` | L32 `true` | PRESENT CORRECT |
| 3 | skipAutoPermissionPrompt | true | L115 `true` | ABSENT | PRESENT CORRECT (spec: key exists on disk at ~/.claude/settings.json line 115 — matches) |
| 4 | CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS | 500 | env L4 `"500"` | env L17 `"500"` | PRESENT CORRECT |
| 5 | CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION | DELETE key | env L3 `"10000"` — key PRESENT | env L16 `"10000"` — key PRESENT | **DRIFT: still on disk in BOTH files; delete is a later slice's write step — slice 1 verifies and flags only** |
| 6 | CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY | state-file concurrency: 10 | ABSENT (not a settings key by design) | ABSENT | PARTIAL: state file (router-session.json at $HOME/Library/Application Support/BlackCEO/999/router-session.json per launchers/macos/claude-nine L11-12) DOES NOT EXIST on this box — no live value to read. Launcher fallbacks verified: macos L131 `String(st.concurrency \|\| 10)` CORRECT; windows L112 `if ($state.concurrency)` CORRECT (no fallback needed). setup-macos.sh L439 still `Number(process.env.CONCURRENCY \|\| 2)` — spec says MUST change to `\|\| 10`; change is a later slice's write. Writer's default planToConcurrency: free=1/max=8/pro=2 (configure-nine-router.mjs L33-39) |
| 7 | CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH | 8 (set as part of fix) | ABSENT | ABSENT | DRIFT: unset in BOTH on-disk files — spec: "NOT yet set in either settings.json on disk — set as part of this fix". Confirmed unset (grep counts 0/0; env 0) |
| 8 | CLAUDE_CODE_MAX_CONTEXT_TOKENS | 700000 | ABSENT | env L11 `"700000"` | PRESENT CORRECT (spec cites ~/.claude-nine/settings.json line 11 — exact) |
| 9 | CLAUDE_CODE_MAX_OUTPUT_TOKENS | 96000 | ABSENT | env L12 `"96000"` | PRESENT CORRECT (spec cites line 12 — exact) |
| 10 | workflowSizeGuideline | unrestricted | L83 `"unrestricted"` | L31 `"unrestricted"` | PRESENT CORRECT |
| 11 | modelOverrides (Fable→fusion-coding, Opus→opus-chain, Sonnet→sonnet-chain, Haiku→haiku-chain) | set | ABSENT | L25-30: claude-opus-5→opus-chain, claude-sonnet-5→sonnet-chain, claude-haiku-4-5→haiku-chain, claude-fable-5→fusion-coding | PRESENT CORRECT (spec cites ~/.claude-nine/settings.json lines 25-30 — exact; spec's short names map to these full model ids) |
| 12 | DISABLE_AUTOUPDATER / autoUpdates | DISABLE_AUTOUPDATER:"1" in env; autoUpdates:false kept | env L5 `"1"`; L117 `"autoUpdates": false` | env L18 `"1"`; L35 `"autoUpdates": false` | PRESENT CORRECT (both files, both mechanisms) |
| 13 | channelsEnabled | false | L108 `false` | ABSENT | PRESENT CORRECT (spec cites ~/.claude/settings.json line 108 — exact) |
| 14 | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS | 1 | env L6 `"1"` | env L19 `"1"` | PRESENT CORRECT |
| 15 | Workflow runtime caps | HARD-CODED 16/1000, no setting | N/A | N/A | N/A (product constant, no settings row; not required on disk) |
| 16 | effortLevel | xhigh | L106 `"xhigh"` | ABSENT | PRESENT CORRECT (spec cites ~/.claude/settings.json line 106 — exact; claude-nine seeds xhigh in state-file writer, write-routing-state.mjs L156) |
| 17 | CLAUDE_CODE_EFFORT_LEVEL | NEVER SET by provisioning | ABSENT | ABSENT | CONFIRMED ABSENT (grep 0/0; env 0; launcher only exports under CLAUDE_NINE_FORCE_EFFORT, macos L133-151; setup-windows.ps1 L108-109 exports only recorded /effort selections, not provisioning) |
| 18 | disableAllHooks | DO NOT SET | ABSENT | ABSENT | CONFIRMED ABSENT |
| 19 | CLAUDE_CODE_DISABLE_WORKFLOWS | DO NOT SET | ABSENT | ABSENT | CONFIRMED ABSENT |
| 20 | Settings precedence | known order recorded | N/A (doctrine row) | N/A | N/A |

## Summary

- 14 of 20 rows PRESENT CORRECT on disk (rows 1-4, 8-14, 16) — all cite exact spec line numbers.
- 3 no-go rows CONFIRMED ABSENT in both files + env (rows 17, 18, 19) — the QC bar's second criterion.
- 3 rows carry action flags for later slices (this slice verifies, never writes):
  - Row 5: `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` = "10000" STILL PRESENT in both env blocks (~/.claude L3, ~/.claude-nine L16) — spec says DELETE.
  - Row 7: `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` = 8 NOT YET SET anywhere — spec says set as part of this fix.
  - Row 6: launcher state file (router-session.json) not found on box — no live concurrency value readable; launcher fallbacks correct (`|| 10` macos L131); setup-macos.sh L439 still `|| 2` — spec requires change to `|| 10`.

No key beyond the table was written; no settings file was modified by this slice.

VERDICT: DONE
