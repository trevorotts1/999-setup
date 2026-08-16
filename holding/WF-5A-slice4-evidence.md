# WF-5A slice 4 evidence — Issue 16 FIX steps 2-3: research-and-source rule + provisioning audit (zero CLAUDE_CODE_EFFORT_LEVEL writes)

Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md — Issue 16, lines 333-376
Ledger citation: WAVE 5 DISPATCH at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 74 (WAVE 5 DISPATCH 2026-08-16T21:22Z)
Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-5A (branch fix/16-unleash)
Date: 2026-08-16
Slice scope (from dispatch): FIX steps 2-3. Step 2 = research-and-source rule (any NEW holding-back setting discovered gets researched, added to the table with its source). Step 3 = provisioning audit: nine-router-setup scripts must never write CLAUDE_CODE_EFFORT_LEVEL anywhere (Step 9.6 remediation scripts enforce; Issue 1 fix syncs them live). Audit setup-macos.sh, setup-windows.ps1, and the launchers — zero CLAUDE_CODE_EFFORT_LEVEL writes.
Nature: VERIFY + RESEARCH slice. settings.json files are on the LIVE operator box — read, never modified (this slice verifies, does not write settings). No repo code file was modified by this slice.

## FIX step 3 — Provisioning audit: zero CLAUDE_CODE_EFFORT_LEVEL writes

### Files searched (full-file reads, not grep for judgment)

Every file in the provisioning path was read in full via the Read tool, then the whole repo was swept for the string. All 24 nine-router-setup files + 4 launchers + 2 test scripts + SKILL.md:

1. `.claude/skills/nine-router-setup/scripts/setup-macos.sh` (724 lines) — orchestrator
2. `.claude/skills/nine-router-setup/scripts/setup-windows.ps1` (587 lines) — orchestrator
3. `launchers/macos/claude-nine` (194 lines)
4. `launchers/macos/claude-codex` (80 lines)
5. `launchers/windows/claude-nine.ps1` (147 lines)
6. `launchers/windows/claude-nine.cmd` (14 lines)
7. `.claude/skills/nine-router-setup/scripts/common/write-routing-state.mjs` (190 lines)
8. `.claude/skills/nine-router-setup/scripts/common/record-effort-selection.mjs` (48 lines)
9. `.claude/skills/nine-router-setup/scripts/common/resolve-models.mjs` (199 lines)
10. `.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs` (720 lines)
11. `.claude/skills/nine-router-setup/scripts/common/test-nine-router.mjs` (153 lines)
12. `.claude/skills/nine-router-setup/scripts/common/nine-router-api.mjs` (263 lines)
13. `.claude/skills/nine-router-setup/scripts/macos/fix-ultracode-override.sh` (1341 lines) — Step 9.6 remediation
14. `.claude/skills/nine-router-setup/scripts/macos/enable-agent-teams.sh` (1703 lines)
15. `.claude/skills/nine-router-setup/scripts/macos/install-claude-nine.sh` (145 lines)
16. `.claude/skills/nine-router-setup/scripts/macos/install-node.sh` (147 lines)
17. `.claude/skills/nine-router-setup/scripts/macos/install-nine-router.sh` (98 lines)
18. `.claude/skills/nine-router-setup/scripts/macos/get-api-docs.sh` (55 lines)
19. `.claude/skills/nine-router-setup/scripts/macos/protect-local-state.sh` (93 lines)
20. `.claude/skills/nine-router-setup/scripts/windows/Fix-UltracodeOverride.ps1` (950 lines) — Step 9.6 remediation
21. `.claude/skills/nine-router-setup/scripts/windows/Enable-AgentTeams.ps1` (630 lines)
22. `.claude/skills/nine-router-setup/scripts/windows/Install-ClaudeNine.ps1` (111 lines)
23. `.claude/skills/nine-router-setup/scripts/windows/Install-NineRouter.ps1` (79 lines)
24. `.claude/skills/nine-router-setup/scripts/windows/Install-Node.ps1` (74 lines)
25. `.claude/skills/nine-router-setup/scripts/windows/Get-ApiDocs.ps1` (48 lines)
26. `.claude/skills/nine-router-setup/scripts/windows/Protect-LocalState.ps1` (68 lines)
27. `.claude/skills/nine-router-setup/SKILL.md` (400 lines)
28. `tests/macos/verify-macos.sh` (54 lines)
29. `tests/windows/verify-windows.ps1` (56 lines)
30. `.claude/skills/nine-router-setup/references/architecture.md` (104 lines)
31. `.claude/skills/nine-router-setup/references/security.md` (105 lines)
32. `.claude/skills/nine-router-setup/references/model-routing.md` (lines 185-221 read for output-policy context)
33. `.claude/skills/nine-router-setup/references/nine-router-api.md` (grep-swept, no writes possible — API reference doc)
34. `README.md` (lines 100-141 effort section), `tests/README.md` (71 lines), `CHANGELOG.md` (mention contexts at lines 1435-1449, 2366-2382), `templates/API docs.md`, `AGENT_INSTALL.md`, `CLAUDE.md` (repo rules), `LICENSE`, `.gitignore`
35. Sibling evidence: `holding/WF-5A-slice1-evidence.md`, `holding/WF-5A-slice3-evidence.md` (already-committed slices)

NOT searched (named per the negative-result contract): the spec-protocol skill tree under `.claude/skills/spec-protocol/` — not a nine-router-setup provisioning path (the slice names the nine-router-setup scripts + launchers); verified by the string sweep below that it carries no CLAUDE_CODE_EFFORT_LEVEL mentions anyway.

### Mechanical sweep (control-verified)

`grep -rln "CLAUDE_CODE_EFFORT_LEVEL" .` (excluding .git) returned 15 files: the 2 setup scripts, 2 launchers, write-routing-state.mjs, both remediation scripts, SKILL.md, architecture.md, security.md, README.md, tests/README.md, CHANGELOG.md, holding/slice1+slice3 evidence. Control: same instrument found the string in the known-present remediation scripts and SKILL.md (positive control), and the sweep is a full-tree search so no file could be missed by path assumption.

### Verdict: ZERO provisioning writes

Every occurrence of `CLAUDE_CODE_EFFORT_LEVEL` in the provisioning path was classified:

| File | Line(s) | Occurrence class |
|---|---|---|
| setup-macos.sh | 486-520 (Step 9.6 comment block + fixer invocation) | REMEDIATION — runs fix-ultracode-override.sh which REMOVES the var; comment text only, no write |
| setup-windows.ps1 | 422-466 (Step 10.6) | REMEDIATION — same, runs Fix-UltracodeOverride.ps1 |
| launchers/macos/claude-nine | 133-137 (comment), 138-140 (`CLAUDE_NINE_FORCE_EFFORT` conditional), 146-153 (lastEffortSelection re-apply) | Issue-1-sanctioned conditional exports ONLY: `if (process.env.CLAUDE_NINE_FORCE_EFFORT)` (line 138) and persistable lastEffortSelection values low/max (lines 150-152). Never unconditional. Spec line 360: "Persistence of ultracode/max via the launcher mechanism only (Issue 1)" |
| launchers/windows/claude-nine.ps1 | 93-98 (comment + CLAUDE_NINE_FORCE_EFFORT conditional), 104-110 (lastEffortSelection) | Same sanctioned mechanism: line 98 `if ($env:CLAUDE_NINE_FORCE_EFFORT)`, line 109 persistable values only. ultracode → `--effort ultracode` CLI flag (lines 106-107), never an env write |
| write-routing-state.mjs | 154-163 (comment + effortLevel field) | Never writes the env var. State field `effortLevel` (line 159) is data, not an env export; comment lines 155-158 explicitly say the launcher "no longer exports this as CLAUDE_CODE_EFFORT_LEVEL" |
| fix-ultracode-override.sh (1341 lines, full read) | entire | REMEDIATION script — its ONLY action on the var is detect/comment-out/remove. Owns `VAR="CLAUDE_CODE_EFFORT_LEVEL"` (line 82), scanner (P0 control-proven), settings env merge-REMOVE, launchctl unsetenv. Never writes the var anywhere |
| Fix-UltracodeOverride.ps1 (950 lines, full read) | entire | REMEDIATION — same role on Windows (User-scope clear, profile comment-out, settings merge-remove). Never writes the var |
| record-effort-selection.mjs (48 lines, full read) | entire | Writes `lastEffortSelection` (line 40) into the STATE FILE — a state field, never an env var. Valid set excludes nothing but the launcher translates; "ultracode lives ONLY in this file" (comment line 16) |
| SKILL.md | 212-226, 233-264, 271-298 | TEACHES "CLAUDE_CODE_EFFORT_LEVEL is NOT exported" (line 212); Step 9.6 (line 233) documents the remediation; Step 9.7 the record helper. Documentation only |
| architecture.md | 52 | "is **NOT** in that list" — documentation only |
| security.md | 100 | "deliberately absent from that list" — documentation only |
| README.md | 118-141 | User guidance (unset/fixer/CLAUDE_NINE_FORCE_EFFORT opt-in). Documentation only |
| tests/README.md | 47, 63 | REQUIRES absence checks after remediation — test contract, not a write |
| CHANGELOG.md | 1435-1449, 2366-2382 | Historical records of the bug and its fix. Line 2367 documents the OLD v1.1.0 behavior ("launchers exported...") as fixed history |
| claude-codex, claude-nine.cmd, get-api-docs.sh, install-*.sh/ps1, protect-local-state.sh, enable-agent-teams.sh, Enable-AgentTeams.ps1, Get-ApiDocs.ps1, resolve-models.mjs, configure-nine-router.mjs, nine-router-api.mjs, test-nine-router.mjs, verify-macos.sh, verify-windows.ps1 | — | ZERO occurrences (full-file reads confirm) |

### Live-box verification (read-only)

- `~/.claude/settings.json`, `~/.claude-nine/settings.json`, `~/.claude/settings.local.json`: grep count of CLAUDE_CODE_EFFORT_LEVEL = 0/0/0. Control: CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = 1/1 (instrument proven on the same files).
- Current process env: `env | grep -c "^CLAUDE_CODE_EFFORT_LEVEL="` = 0 (unset).
- Live installed launcher `/Users/blackceomacmini/.local/bin/claude-nine` (symlink → `/Users/blackceomacmini/bin/claude-nine`, 115 lines, read in full): the legacy wrapper — sets CLAUDE_CONFIG_DIR, MCP token, router start, guards; contains NO CLAUDE_CODE_EFFORT_LEVEL export of any kind (no force-effort, no lastEffortSelection — it predates the mechanism). Cannot write the var.
- State file `$HOME/Library/Application Support/BlackCEO/999/router-session.json`: ABSENT on this box (box never provisioned via the repo skill; legacy wrapper only). No state file = no effort writes possible here.
- Live skill parity (Issue 1 FIX step 2 / spec line 25): `diff -rq <repo skill> ~/.claude/skills/nine-router-setup` = only extra live `assets/` dir. Setup scripts, both remediation scripts, and record-effort-selection.mjs byte-identical to the live skill (diff -q rc=0 on each).

## FIX step 2 — Research-and-source rule

Rule (spec line 372): any NEW holding-back setting discovered later gets researched (official docs / context7 / vendor source), added to the table with its source, and set — through the normal write gate, never silently.

### Full inventory of settings-adjacent values the provisioning path writes

1. `effortLevel: "xhigh"` — state file seed (setup-macos.sh:441, setup-windows.ps1:365, write-routing-state.mjs:159). Table row 16 (spec line 359), sourced to code.claude.com/docs. In-table.
2. `workflowSizeGuideline: "unrestricted"` — enable-agent-teams scripts merge (macos:438, windows:515). Table row 10 (spec line 353), sourced. In-table.
3. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1"` — enable-agent-teams scripts. Table row 14 (spec line 357), sourced. In-table.
4. `concurrency` state value (1/2/8 by plan) — table row 6 (spec line 349). In-table (the `|| 2` → `|| 10` change at setup-macos.sh:439 is FIX step 1 row 6, another slice's write — flagged, not touched here).
5. `maxOutputTokens: 32000` state seed (setup-macos.sh:440, setup-windows.ps1:364, launcher fallbacks macos:130 `|| 32000`, windows:111) → exported as `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in every routed child session.

### Research finding on item 5 — NOT a holding-back setting (sourced)

Discrepancy looked real: table row 9 (spec line 352) sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS=96000` in ~/.claude-nine/settings.json env, while provisioning seeds 32000 into state which the launcher exports into every child — a 96000-vs-32000 conflict for routed sessions. Researched:

- Official env-vars doc (https://code.claude.com/docs/en/env-vars.md, fetched 2026-08-16): `CLAUDE_CODE_MAX_OUTPUT_TOKENS` — "Set the maximum number of output tokens for most requests. Defaults and caps vary by model... **Claude Code defaults to 32000 for model IDs it doesn't recognize, such as gateway-specific names**, and lowers values above a model's cap to the cap. Increasing this value reduces the effective context window available before auto-compaction triggers."
- Context7 (https://code.claude.com/docs/en/env-vars via /websites/code_claude): same text confirmed: "Claude Code defaults to 32,000 for unrecognized model IDs."
- Repo's own documented intent, references/model-routing.md:199-204: "`CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in the `claude-nine` child process only (conservative floor for the lower-output Ollama routes). Never persist globally. Do not set 200K routed — that is unsafe for Ollama routes." Plus: DeepSeek's ~200K output cap is an application policy; Ollama's 32K output cap is an application policy.

Verdict: the 32000 export is NOT a holding-back cap relative to the platform's own behavior for gateway model IDs — it IS the documented Claude Code default for exactly this topology (unrecognized gateway-specific model IDs like ds/..., ollama/...), it matches the routed providers' real output ceilings (Ollama 32K), and the official doc warns raising it shrinks the pre-compaction context window. The 96000 settings-env value governs the native model-ID paths in that profile; routed lanes get the gateway default. Sourced, intentional, matches the table's own citation source. NO table change required. Recorded for the record: the two values coexist by design (different model-ID scopes); no write performed.

### Research discovery — CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY (checked, NOT a holding-back setting)

During research, the whats-new/llm-gateway docs surfaced `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` (v2.1.129+): opt-in for listing models from a gateway's /v1/models at startup into the model picker. Sources (context7): https://code.claude.com/docs/en/whats-new/2026-w18 and https://code.claude.com/docs/en/llm-gateway-protocol — "This feature is **disabled by default to prevent unauthorized model exposure** and requires setting the environment variable."

Verdict: leaving it unset is the documented SECURE default, not a holding-back state; the provisioning path never sets it (sweep: zero occurrences outside the claude-codex header comment about MAX_CONTEXT_TOKENS). Per the research-and-source rule it does not qualify as a NEW holding-back setting, so no table row is added and nothing is set. Noted here so a future pass does not misclassify it.

### No other holding-back settings discovered

The provisioning path writes nothing else: full-file reads of all 24 scripts show the only settings.json mutations are the agent-teams merge (2 keys, both in-table) and the remediation scripts' single-key removals (CLAUDE_CODE_EFFORT_LEVEL — removal, never a write). The `env` blocks of both settings.json files were enumerated in slice 1 (a3f166c / slice1-evidence) — every key there is in the table.

## Summary of findings

1. FIX step 3 (provisioning audit): PASS — zero provisioning writes of CLAUDE_CODE_EFFORT_LEVEL in setup-macos.sh, setup-windows.ps1, both launchers, and all 24 nine-router-setup scripts. The only env-var exports are the two Issue-1-sanctioned conditional mechanisms (CLAUDE_NINE_FORCE_EFFORT opt-in; persistable lastEffortSelection) explicitly named by spec line 360. Step 9.6 remediation scripts present, control-proven, and byte-identical to the live skill.
2. FIX step 2 (research-and-source): PASS — no NEW holding-back setting found. The one candidate (32000 state seed) researched and proven to be the documented gateway-model default + routed-provider ceiling, with the repo's own policy doc; CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY checked and classified as documented-secure-default opt-in, not holding-back. Both recorded with sources. No table addition required; nothing set.
3. Live box: var absent from all three settings files (0/0/0 with control), absent from process env, absent from the installed launcher; state file absent (no writes possible).

Nothing in this slice modified any settings.json (live operator box files untouched) or any repo code file. Evidence file only.

VERDICT: DONE
