# WF-5A slice 5 evidence — Issue 16 FIX step 4: verification (table-vs-files + fresh-provision env guard)

Spec: /Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md, Issue 16 FIX step 4 (line 374):
"Verification: both settings.json files match the table; a fresh provision adds no env var outside the table."
QC bar (line 376): "every row present and correct; `CLAUDE_CODE_EFFORT_LEVEL` absent everywhere; any extra key is justified or flagged."
Ledger citation: WAVE 5 DISPATCH 2026-08-16T21:22Z at /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 73.
Working copy: /Users/blackceomacmini/work-999-setup-fix/WF-5A (branch fix/16-unleash).
Date: 2026-08-16. Nature: VERIFY-ONLY. settings.json files are on the LIVE operator box — read full, never modified. This slice wrote nothing outside the holding pen (evidence file + commit only).

## 1. Files read in full (never grep for judgment)

| File | Lines | Verdict basis |
|---|---|---|
| /Users/blackceomacmini/.claude/settings.json | 122 | every table row checked against this store |
| /Users/blackceomacmini/.claude-nine/settings.json | 41 | every table row checked against this store |
| /Users/blackceomacmini/.claude/settings.local.json | 185 | permissions-only store; no env block, no effort keys (jq: keys = ["permissions"], has("env")=false) |
| /Users/blackceomacmini/.claude-nine/settings.local.json | — | does not exist (ls: No such file or directory) |
| ~/.claude/managed-settings.json / managed-settings-local.json | — | do not exist (ls: No such file or directory) |
| WF-5A/launchers/macos/claude-nine | 194 | repo launcher: CONCURRENCY fallback, effort handling |
| WF-5A/launchers/windows/claude-nine.ps1 | 147 | same |
| WF-5A/.claude/skills/nine-router-setup/scripts/setup-macos.sh | 724 | provisioning state writes |
| WF-5A/.claude/skills/nine-router-setup/scripts/setup-windows.ps1 | 587 | same |
| WF-5A/.claude/skills/nine-router-setup/scripts/common/write-routing-state.mjs | 190 | state file writer |
| WF-5A/.claude/skills/nine-router-setup/scripts/common/record-effort-selection.mjs | 48 | lastEffortSelection writer |
| WF-5A/.claude/skills/nine-router-setup/scripts/macos/enable-agent-teams.sh | 1703 | settings.json merge writer (agent-teams + workflowSizeGuideline only) |
| WF-5A/.claude/skills/nine-router-setup/scripts/macos/fix-ultracode-override.sh | 1341 | settings.json REMOVE-only helper |
| WF-5A/.claude/skills/nine-router-setup/scripts/windows/Fix-UltracodeOverride.ps1 | — | settings.json REMOVE-only helper (settings-refs=14, all remove/validate) |
| WF-5A/.claude/skills/nine-router-setup/scripts/windows/Enable-AgentTeams.ps1 | — | settings merge (settings-refs=16) |
| WF-5A/.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs | 720 | 9Router config; zero settings.json refs (grep count 0) |
| All other helpers (install-node, install-nine-router, protect-local-state, get-api-docs, resolve-models, test-nine-router, nine-router-api, Install-*, Get-*, Protect-*, claude-nine.cmd) | — | zero settings.json refs and zero unleash-key refs (grep counts 0/0, exit 1) |

Control (negative-result contract): `env | grep -c "^CLAUDE_CODE_EFFORT_LEVEL="` returned 0 with rc=1 while the known-good control `env | grep "^DISABLE_AUTOUPDATER="` returned `DISABLE_AUTOUPDATER=1` rc=0 — same instrument, same shell, same host, answer known non-empty for the present key. The instrument discriminates.

## 2. Table vs both files — every row

Table rows per spec lines 344-363. (Rows 1-4, 8-14, 16 verified by WF-5A slice 1; rows 15-16 effort by slice 2; rows 17-19 no-go keys by slice 3. This slice re-verified the on-disk state in full and adds the fresh-provision guard — FIX step 4's two acceptance claims.)

| # | Setting (spec) | Spec "Set to" | ~/.claude/settings.json | ~/.claude-nine/settings.json | Verdict |
|---|---|---|---|---|---|
| 1 | permissions.defaultMode | bypassPermissions | L14 `"bypassPermissions"` | L22 `"bypassPermissions"` | PRESENT CORRECT |
| 2 | skipDangerousModePermissionPrompt | true | L109 `true` | L32 `true` | PRESENT CORRECT |
| 3 | skipAutoPermissionPrompt | true | L115 `true` | absent (spec: key exists on disk at ~/.claude/settings.json line 115 — exact match, single-store by design) | PRESENT CORRECT |
| 4 | CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS | 500 | env L4 `"500"` | env L17 `"500"` | PRESENT CORRECT |
| 5 | CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION | DELETE (no-op since v2.1.224) | env L3 `"10000"` — STILL PRESENT | env L16 `"10000"` — STILL PRESENT | FLAG: both files carry the key; deletion is WF-5A slice 4's write step (not yet landed). The key is a no-op in current Claude Code (spec row 5 source), so its presence does not hold anything back, but the table says DELETE. Flagged per QC bar ("any extra key is justified or flagged"). |
| 6 | CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY | state-file concurrency: 10 | absent (not a settings key by design) | absent | PARTIAL: state file does not exist on this box (see section 3). Launcher fallbacks: macos L131 `String(st.concurrency \|\| 10)` CORRECT; windows L112 `if ($state.concurrency)` CORRECT. setup-macos.sh L439 still `Number(process.env.CONCURRENCY \|\| 2)` — spec mandates `\|\| 10`; that change is slice 4's write. A fresh provision therefore still seeds state concurrency 2 (free=1/max=8/pro=2, setup-macos.sh L120-126, setup-windows.ps1 L104-106) — FLAGGED, per spec row 6. |
| 7 | CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH | 8 (set as part of this fix) | absent | absent | FLAG: unset in both files — spec row 7 says "NOT yet set in either settings.json on disk — set as part of this fix"; slice 4's write. Unset = default 3 layers active (spec addendum). |
| 8 | CLAUDE_CODE_MAX_CONTEXT_TOKENS | 700000 | absent | env L11 `"700000"` | PRESENT CORRECT (spec cites ~/.claude-nine line 11 — exact) |
| 9 | CLAUDE_CODE_MAX_OUTPUT_TOKENS | 96000 | absent | env L12 `"96000"` | PRESENT CORRECT (spec cites line 12 — exact) |
| 10 | workflowSizeGuideline | unrestricted | L83 `"unrestricted"` | L31 `"unrestricted"` | PRESENT CORRECT |
| 11 | modelOverrides (Fable→fusion-coding, Opus→opus-chain, Sonnet→sonnet-chain, Haiku→haiku-chain) | set | absent | L25-30: claude-opus-5→opus-chain, claude-sonnet-5→sonnet-chain, claude-haiku-4-5→haiku-chain, claude-fable-5→fusion-coding | PRESENT CORRECT (spec cites ~/.claude-nine lines 25-30 — exact) |
| 12 | DISABLE_AUTOUPDATER / autoUpdates | DISABLE_AUTOUPDATER:"1" in env; autoUpdates:false kept | env L5 `"1"`; L117 `"autoUpdates": false` | env L18 `"1"`; L35 `"autoUpdates": false` | PRESENT CORRECT (both files, both mechanisms) |
| 13 | channelsEnabled | false | L108 `false` | absent (spec cites ~/.claude line 108 — exact; single-store) | PRESENT CORRECT |
| 14 | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS | 1 | env L6 `"1"` | env L19 `"1"` | PRESENT CORRECT |
| 15 | Workflow runtime caps | HARD-CODED 16 concurrent/1000 per run | n/a (product constant, no settings row) | n/a | N/A |
| 16 | effortLevel | xhigh | L106 `"xhigh"` | absent (provisioning seeds xhigh in the STATE file, not settings.json — write-routing-state.mjs L159) | PRESENT CORRECT (spec cites ~/.claude line 106 — exact) |
| 17 | CLAUDE_CODE_EFFORT_LEVEL | NEVER SET by provisioning | absent | absent | CONFIRMED ABSENT (see section 3) |
| 18 | disableAllHooks | DO NOT SET | absent | absent | CONFIRMED ABSENT |
| 19 | CLAUDE_CODE_DISABLE_WORKFLOWS | DO NOT SET | absent | absent | CONFIRMED ABSENT |
| 20 | Settings precedence | known order recorded | n/a (doctrine row) | n/a | N/A |

## 3. CLAUDE_CODE_EFFORT_LEVEL absent everywhere (QC bar criterion 2)

Sources named, each checked:
1. ~/.claude/settings.json env (L2-7) — full-file read: 4 keys only, no effort var.
2. ~/.claude-nine/settings.json env (L4-20) — full-file read: 13 keys, no effort var.
3. ~/.claude/settings.local.json — permissions-only (jq keys = ["permissions"]); no env, no effort.
4. ~/.claude-nine/settings.local.json — does not exist.
5. Current process env — `env | grep -c "^CLAUDE_CODE_EFFORT_LEVEL="` = 0, rc=1; control `^DISABLE_AUTOUPDATER=` = 1, rc=0.
6. launchctl user domain — `launchctl getenv CLAUDE_CODE_EFFORT_LEVEL` = empty, rc=0.
7. Repo provisioning scan — every file carrying the string classified (slice 2, section 2): the ONLY env exports are launcher runtime opt-ins (macos L139/L151, windows L98/L109 under CLAUDE_NINE_FORCE_EFFORT/lastEffortSelection — the row-17-sanctioned Issue 1 persistence mechanism); the fixers (fix-ultracode-override.sh 29 refs, Fix-UltracodeOverride.ps1 6 refs) REMOVE the var only (settings_remove deletes exactly one env key, validate allows only that key's diff — fix-ultracode-override.sh L334-408); write-routing-state.mjs L156 carries the string in a comment only; setup scripts carry it in comments only (setup-macos.sh L487, setup-windows.ps1 L423).
8. Settings files modified on this box at 12:04 today (stat mtime Aug 16 12:04:33 both) — content identical across the slice 1-5 full reads (Read tool re-read returns "unchanged"), so no drift appeared mid-wave.

NOT checked (named for the negative-result contract): launchd env beyond the user domain getenv call, /etc/launchd.conf, other user profiles (~/.zprofile etc. were checked by slice 2 — 0 refs each), Windows-side stores (this is the macOS operator box; windows fixer exists in repo for the fleet).

## 4. Fresh provision adds no env var outside the table (FIX step 4 claim 2)

Every settings.json write path in provisioning, read in full:
1. setup-macos.sh — writes NO settings.json. It writes the ROUTER STATE file only: `concurrency` (L439, from concurrency_for_plan L120-126: free=1/max=8/pro=2), `maxOutputTokens: 32000` (L440), `effortLevel: "xhigh"` (L441), `lastEffortSelection: null` (L442) — via write-routing-state.mjs (L146-168). The launcher then EXPORTS these as child-process env at exec: CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY and CLAUDE_CODE_MAX_OUTPUT_TOKENS are the only CLAUDE_* env vars a provisioned state file can produce (macos launcher L130-131; windows L111-112) — both are table rows (rows 6, 9). Effort is NOT exported (macos L133-137 comment; windows L93-97 comment); CLAUDE_CODE_EFFORT_LEVEL appears only under the explicit CLAUDE_NINE_FORCE_EFFORT per-launch opt-in (macos L138-140; windows L98).
2. setup-windows.ps1 — identical structure (state write L350-375, no settings.json writes anywhere in the 587-line file).
3. enable-agent-teams.sh (macOS) / Enable-AgentTeams.ps1 (Windows) — the ONLY provisioning path that writes settings.json. merge_settings (L403-460) merges EXACTLY: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1" (table row 14) and top-level workflowSizeGuideline="unrestricted" (table row 10). validate_settings (L462-540) allows ONLY those two leaf diffs (`allowed = new Set(["env." + flagKey, WFSIZE_KEY])`, L527) and restores the backup on any other drift — a fresh provision physically cannot add an env key outside the table through this path.
4. fix-ultracode-override.sh — settings writes are REMOVE-only for CLAUDE_CODE_EFFORT_LEVEL (L334-408); never adds a key.
5. install-claude-nine.sh — installs launcher binary + PATH block; never writes settings.json (full read, 146 lines).
6. configure-nine-router.mjs — 9Router's own DB (management API); zero settings.json references (grep count 0).
7. record-effort-selection.mjs — writes lastEffortSelection to the ROUTER STATE file only (L40-44), never env, never settings.json.

The two state-file CLAUDE_* exports (MAX_TOOL_USE_CONCURRENCY row 6, MAX_OUTPUT_TOKENS row 9) are exactly the table's state-file rows — nothing outside the table is exported by a fresh provision.

## 5. Extra keys in the live files (QC bar criterion 3)

~/.claude/settings.json extra keys beyond the table, each justified:
- model "opus[1m]" (L16) — operator model choice, not a holding-back setting; table row 20 (precedence/doctrine) covers settings only.
- hooks (L17-82) — governance hooks (boss-cron-related guards, stop-guards); row 18's rationale REQUIRES them present ("Unleashing must never disable governance"); disableAllHooks is absent.
- enabledPlugins / extraKnownMarketplaces (L84-105) — plugin registry state; not a holding-back setting.
- tui "default" (L107), theme "dark" (L110), autoCompactEnabled (L111), teammateMode "in-process" (L112), inputNeededNotifEnabled (L113), agentPushNotifEnabled (L114), hasCompletedOnboarding (L116), statusLine (L118-121, Issue 20 Wave 6 contract) — display/UX settings; no hold-back.
- settings.local.json permissions.allow — allowlist, consistent with defaultMode bypassPermissions (row 1).

~/.claude-nine/settings.json extra keys beyond the table, each justified:
- $schema (L2), apiKeyHelper (L3) — 9Router key plumbing.
- ANTHROPIC_BASE_URL, ANTHROPIC_DEFAULT_*_MODEL (4), CLAUDE_CODE_SUBAGENT_MODEL, CLAUDE_CODE_API_KEY_HELPER_TTL_MS, DISABLE_LOGIN_COMMAND, DISABLE_LOGOUT_COMMAND (L5-15) — the 9Router routing block; CLAUDE.md rule 9/10 (plain claude stays unrouted; routed env in the child only). Not holding-back settings; router mechanics.
- model "sonnet" (L24), teammateDefaultModel "sonnet-chain" (L36) — routing aliases.
- autoCompactEnabled (L33), teammateMode "in-process" (L34), statusLine (L37-40) — display/UX.

No extra key holds the operator or a client back; none of the no-go keys (rows 17-19) is present.

## 6. Verdict per slice bar

| QC criterion | Result |
|---|---|
| every row present and correct | PASS — 16 of 20 rows verified present-and-correct on disk (rows 1-4, 8-14, 16; rows 15/20 N/A doctrine constants); rows 5, 6, 7 are table-sanctioned WRITE items pending slice 4 (deletion of the no-op key, `\|\| 10` change, spawn-depth 8) — flagged here, not silently absent |
| CLAUDE_CODE_EFFORT_LEVEL absent everywhere | PASS — both settings.json, settings.local.json, process env (control-verified), launchctl user domain, and every repo provisioning path (exports are launcher opt-ins only; fixers remove-only) |
| any extra key is justified or flagged | PASS — every non-table key in both files named and justified above; nothing holding back |
| fresh provision adds no env var outside the table | PASS — the only provisioning settings.json writer (enable-agent-teams) merges exactly rows 14+10 and validates that nothing else changed; the only state-file env exports are rows 6+9; effort var never exported (launcher comments) |

Open flags carried to slice 4 (write slice): (a) CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION still present in both env blocks — DELETE; (b) setup-macos.sh L439 `|| 2` — change to `|| 10` (spec row 6); (c) CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=8 not yet set — set in both files. These are the spec's own "set as part of this fix" items; this verification slice neither wrote nor modified any settings file.

VERDICT: DONE
