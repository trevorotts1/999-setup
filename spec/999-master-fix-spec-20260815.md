# 999 Master Fix Specification — 2026-08-15

**Deliverable:** this document, at `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md`.
**Scope:** the 20 issues below. The list is CLOSED — nothing added, removed, or reworded.
**Target repository:** `~/work-999-setup` (branch `main`, remote `github.com/trevorotts1/999-setup.git`).
**Execution model:** max 10 agents per workflow (5 builders + 5 blind critics = pairs of five), up to 50 workflows (operator doctrine, not a product limit — no product cap exists on concurrent workflow runs; `references/capacity.md` currently says 30 and must be updated to 50), 6 locked waves, batch merge at the end, boss cron enforcing the whole run against the live ledger.
**Audience of this document:** the operator runs this plan through the 9Router fusion combo. Every section is written as executable instruction, not prose.

---

## PART 0 — THE 20 ISSUES, EACH WITH PROBLEM / WHY / FIX / QC

Every issue carries exactly four parts. The QC part names ONE method only — the single way that item is quality-checked (see PART 1 for the QC protocol that governs every one of them).

---

### ISSUE 1 — Ultra Code always reverts to pinned effort (Max) — permanent fix + persistence

**PROBLEM.** A user picks `/effort ultracode` in session and the session reverts to the pinned effort (Max). The pick does not stick within the session and never survives a session boundary.

**WHY.** `CLAUDE_CODE_EFFORT_LEVEL` in the environment overrides the in-session `/effort` picker. Valid values are `low|medium|high|xhigh|max|auto`. `ultracode` is NOT a valid value anywhere — it is session-only by design and cannot persist in `settings.json`. It is also NOT a 9Router config key — absent from the installed 9Router code (verified by fetching the 9Router source, https://github.com/decolua/9router); on this box effort selection is implemented as model renames via `modelOverrides`, never through router settings. Sourced mechanics (https://code.claude.com/docs): ultracode = xhigh effort plus automatic dynamic-workflow orchestration (Claude writes and runs a workflow for every substantive task); it is session-only and resets each session; enable via `/effort ultracode`, `claude --effort ultracode` (v2.1.203+; VERIFY: WebFetch https://code.claude.com/docs expecting "v2.1.203 --effort ultracode"), `--settings {"ultracode": true}` (VERIFY: WebFetch https://code.claude.com/docs expecting '--settings {"ultracode": true}'), or Agent SDK `effortLevel: "ultracode"`; a literal `ultracode` keyword in a human-typed prompt triggers a workflow for that task. It is NOT accepted by the `effortLevel` settings key or the `CLAUDE_CODE_EFFORT_LEVEL` env var. STATUS 2026-08-16: the fix is ALREADY IMPLEMENTED and merged (commit 8fac6ce) — the repo launchers re-apply `lastEffortSelection` (macOS `launchers/macos/claude-nine` lines 137-147, Windows `launchers/windows/claude-nine.ps1` lines 97-108, `CLAUDE_NINE_FORCE_EFFORT` wins), the setup scripts seed the key (setup-macos.sh line 442, setup-windows.ps1 line 366), the live skill `~/.claude/skills/nine-router-setup/` matches the repo (diff shows only an extra live `assets/` dir; Step 9 line 212 teaches NOT exported, Step 9.6 at line 233 exists, both remediation scripts present), and the record helper `scripts/common/record-effort-selection.mjs` exists. This issue carries NO work — only verification.

**FIX (verify-only — the implementation already landed in commit 8fac6ce; nothing to apply).**
1. Verify the repo state: `git -C ~/work-999-setup log --oneline -3` shows 8fac6ce; `launchers/macos/claude-nine` lines 137-147 and `launchers/windows/claude-nine.ps1` lines 97-108 re-apply `lastEffortSelection` with `CLAUDE_NINE_FORCE_EFFORT` winning; `setup-macos.sh` line 442 and `setup-windows.ps1` line 366 seed `lastEffortSelection: null`/`$null`; `scripts/common/record-effort-selection.mjs` exists and writes via temp+rename, mode 600, VALID set `low|medium|high|xhigh|max|ultracode`.
2. Verify the live skill matches the repo: `diff -rq ~/work-999-setup/.claude/skills/nine-router-setup ~/.claude/skills/nine-router-setup` shows at most an extra live `assets/` dir — no content drift in SKILL.md, scripts, or references. Step 9 (line 212) teaches "NOT exported"; Step 9.6 (line 233) exists; both remediation scripts present.
3. Verify no provisioning path exports `CLAUDE_CODE_EFFORT_LEVEL`: grep the repo for the export/assignment and name every file searched in the output.
4. Functional verification: launch `claude-nine`, run `/effort ultracode`, exit, relaunch, confirm the session opens at ultracode; confirm `env | grep CLAUDE_CODE_EFFORT_LEVEL` is empty in a fresh shell (names/sources named in the check output, per the negative-result contract).

**QC.** ONE method: a blind critic receives (a) the fixed launcher files and skill files, and (b) the bar — the behavior contract "a fresh `claude-nine` session after `/effort ultracode` reopens at ultracode, and no provisioning path exports `CLAUDE_CODE_EFFORT_LEVEL`" — plus the live run transcript proving it. The critic never sees the builder's reasoning. PASS = completely exceeds expectation: the transcript shows the relaunch at ultracode AND the env sweep names every source checked with none set. FAIL = looped back to the builder with the critic's exact finding (max 20 cycles).

---

### ISSUE 2 — Dashboard password never set to default 123456

**PROBLEM.** After provisioning, the 9Router dashboard password is a random string the user never knew, not the documented default `123456`.

**WHY.** STATUS 2026-08-16: the rotation is ALREADY REMOVED (commit 8fac6ce). `configure-nine-router.mjs` now carries only the advisory `report.mustChangePassword` (lines 690-693); the orchestrators keep the factory password and print the completion line "the password is the default `123456`; change it yourself" (setup-macos.sh lines 670, 715; setup-windows.ps1 lines 533, 577). This issue carries NO work — only verification.

**FIX (verify-only — the removal already landed in commit 8fac6ce; nothing to apply).**
1. Verify the code: grep `configure-nine-router.mjs` for `crypto.randomBytes`, `dashboardPassword`, `dashboardPasswordRotated`, `patchSettings.*password` — all empty; `report.mustChangePassword` present at lines 690-693 (advisory only).
2. Verify the orchestrators: setup-macos.sh and setup-windows.ps1 keep `DASHBOARD_PW`/`$dashPw` default `123456`, have no rotated-password consumption, and print the completion line "the password is the default `123456`; change it yourself in the dashboard when you are ready."
3. Functional verification: provision a fresh router with `mustChangePassword: true`; confirm the settings password hash is unchanged after the run (SHA256 fingerprint before/after must MATCH — the inverse of the old rotation proof) and the report JSON contains no `dashboardPassword` field. NOTE: a running 9Router gateway holds settings in memory and clobbers sqlite edits — stop the gateway before verifying (launchctl bootout → verify → bootstrap); a verification run against a live gateway proves nothing.

**QC.** ONE method: blind critic receives the diff plus the bar — "no code path in the repo changes the dashboard password; a fresh provision leaves it at `123456`; the report carries the advisory flag only" — plus the run output. PASS = completely exceeds expectation: the fingerprint matches, the report has no password field, and the advisory is present. FAIL = looped (max 20 cycles).

---

### ISSUE 3 — Spec-protocol stripped the first two entry options (interview / point-at-folder-document-link)

**PROBLEM.** On `/spec-protocol`, the user is not offered the two entry modes up front; the two-option entry question is not enforced as the first counted interaction.

**WHY.** The repo SKILL.md carries the section "The entry — interview me, or here is the info (ask ONCE)" (SKILL.md lines 771-799: option 1 "Interview me", option 2 "Here is the info — point me at a folder, paste a document, or tell me where the notes are", asked with one plain question). The entry block EXISTS in SKILL.md step 3 (line 875: "Offer entry modes" is in the flow) — what is missing is the enforcement: the two-option question must be the FIRST counted interaction after the opening script and build target, and the ENTRY-MODE ledger line must be enforced.

**FIX.**
1. Restore the entry block as a hard gate at trigger: on `/spec-protocol`, after THE OPENING SCRIPT and THE BUILD TARGET QUESTION, speak the two-option entry question verbatim (SKILL.md lines 773-789) before anything else runs. Exactly two options, asked ONCE:
   - (1) Interview me.
   - (2) Here is the info — point at a folder / paste a document / give a link.
2. Enforcement: make the entry choice a required ledger line (`ENTRY-MODE: interview|pointed`) written before the project folder is created; the self-audit (step 20) and the boss cron both reject a run whose ledger lacks the line.
3. Create the project folder + `00-INPUT/` immediately after the choice (already LAW-23 behavior at SKILL.md lines 794-799 — keep).
4. Verification: trigger `/spec-protocol` in a test session; the first counted interaction after the opening script and build-target exchange is the two-option question; the ledger gains the `ENTRY-MODE` line.

**QC.** ONE method: blind critic receives the session transcript and the bar — "the first thing offered after the opening script and build-target confirmation is exactly two entry options, asked once, and the ledger records the choice." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 4 — Advanced vs Simple mode choice never offered

**PROBLEM.** After choosing "interview me", the user is never offered ADVANCED MODE vs DEFAULT MODE. The mode choice exists in doctrine but is not surfaced.

**WHY.** Ruling R1 in `references/interview.md` (lines 138-154) defines the two modes — DEFAULT MODE (~9 questions, the R6 list) vs ADVANCED MODE (adds the R7 list) — and mandates the offer as the FIRST counted question. The choice is not surfaced in the live run, and the question-count arithmetic is not mapped to the operator's Simple / Advanced framing.

**FIX.**
1. Surface the mode question verbatim at the head of the interview (R1 wording, interview.md lines 141-147): "I can make every technical decision myself and just build it — you'd answer only the few questions about your accounts, your money, and what you like. Or you can make the detailed calls with me as we go. Which do you want?" Record DEFAULT MODE (Simple) or ADVANCED MODE. Record the choice as ledger line `INTERVIEW-MODE: simple|advanced`.
2. Map the counts truthfully: Simple = the R6 list (9 items, about nine typical, usually fewer — the R6 list length is the wall); Advanced C ≤ the target branch's worst-case ceiling from the interview.md ceiling table (lines 100-107): Mobile app 32, Web 31, Mobile AND web 32, Desktop 31, Website 32, Sales funnel 33 (31-33 depending on target, up to 36 with the announced artwork rise) — the ceiling table is the wall no run can cross; the executor computes C per interview.md lines 297-377 and the mode cap IS that table row. Simple stays the R6 list (9 items, usually fewer). Conditionals are priced at measured values. Collapse is not a budget-overflow mechanism — interview.md has no lowest-value collapse order. The small-plan collapse (fast path 2, interview.md lines 1296-1313) fires when block-A answers reveal a TINY PLAN (smallest tier, one or two agents): B1/B2/B4 collapse to defaults (one repository, branch "main", no forbidden push) and C0->C5 collapse to defaults, each with yes/no confirmation. The only sanctioned removals are the defaults offer (A4/A5/A7/A8, CHOICE-DYNAMIC — removed only by the person's own mid-run yes) and the block collapses (B, C). Every lowering is announced before the next question (interview.md lines 349-351 — the good-news requirement; the artwork rise at 329-340 is the only sanctioned rise, spoken at measured size).
3. Truthful numbering (feeds Issue 11): total computed ONCE at the start (C), every question spoken as "Question N of no more than C", any change to C announced BEFORE the next question (lowerings with the good-news line; the only sanctioned rise is artwork's, spoken at its measured size before the question).
4. Verification: run the interview in both modes; Simple never exceeds the R6-list length (nine items, usually fewer); Advanced never exceeds the target's ceiling-table value; the rise over the base ceiling is artwork only, spoken at measured size; every question carries its number and the ceiling never moves silently.

**QC.** ONE method: blind critic receives both transcripts and the bar — "the mode offer is the first counted question; Simple ≤ the R6-list length (usually fewer), Advanced ≤ the target's ceiling-table value (artwork rise announced at measured size); numbering is 'N of C' throughout with every C change announced before the next question." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 5 — Premature research before knowing what to build

**PROBLEM.** Research agents fire before the build target is known — the run researches a domain it has not yet confirmed, or researches before the interview/pointed material is captured.

**WHY.** No ordering gate. SKILL.md's flow dispatches Just-in-Time research at step 3.5 (line 880) "the moment the Build Target is answered", but nothing hard-blocks a research dispatch ahead of the target confirmation or ahead of material capture on the pointed path.

**FIX.**
1. Add a RESEARCH-READY gate: research may not run until BOTH are true — (a) the build target is named (one of the six-way taxonomy `MOBILE_APP | WEB_APP | MOBILE_AND_WEB | DESKTOP_SOFTWARE | WEBSITE | FUNNEL`, asked in prose via the Build Target exchange, NEVER as a menu — SKILL.md lines 636-651), and (b) the interview/pointed material is captured (brainstorm verbatim in `00-INPUT/` on the interview path, or the provided material copied into `00-INPUT/` and the one-paragraph understanding confirmed on the pointed path).
2. Enforcement: the gate is a ledger precondition — a research dispatch without both ledger lines (`BUILD-TARGET: <taxonomy>` and `INPUT-CAPTURED: <path>`) is a violation the boss cron stops (PART 4). The dispatch log line for any research agent must cite both ledger lines.
3. Verification: attempt a research dispatch before capture in a test run — it is refused with the named gate; after capture it proceeds.

**QC.** ONE method: blind critic receives the ledger, dispatch log, and the bar — "no research dispatch exists before both the target and the input-capture ledger lines; every research dispatch cites both." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 6 — Ugly websites: poor copy, no research on best website/UI/UX practices per website type

**PROBLEM.** Websites and funnels ship ugly: weak copy, no design research behind the layout, generic AI-vibe output.

**WHY.** No design-brief step exists in the pipeline: nothing researches sourced UI/UX best practice per site type (hero structure, layout, typography, color, conversion patterns, mobile, accessibility) before the build; no copy bar exists; no image lane feeds the pages (Issues 7-10); no build pipeline stages the work (wireframes → scaffolding → hero → images → build with animations/3D → logo background removal).

**FIX.**
1. Add a DESIGN-BRIEF step to the website/funnel branch, after the RESEARCH-READY gate and before any page build:
   - MOBBIN-CHECK (first action after the RESEARCH-READY gate). Numbered, ordered:
     1. DETECT — Input: the client's box. Check `~/.claude-nine/.claude.json` mcpServers AND `~/.claude.json` mcpServers AND the project `.mcp.json`. Real file check, never an assumption. Output: configured = yes|no. Acceptance: the check names the file(s) read (`~/.claude-nine/.claude.json`, `~/.claude.json`, project `.mcp.json`).
     USAGE: when configured, the run uses the Mobbin MCP server (mobbin, Streamable HTTP https://api.mobbin.com/mcp, OAuth-authenticated by the client) for design reference search; when not configured, usage is the referral-link website as browser reference (the client's account), never MCP tools.
     2. IF CONFIGURED — skip the offer entirely (do not ask someone who already has it). The brief MAY use Mobbin for reference research (named, credited inspiration). Output: ledger `MOBBIN-CHECK: configured`. Acceptance: no purchase offer is spoken.
     3. IF NOT CONFIGURED — HIGHLY RECOMMEND as an OPTIONAL purchase (paid product; the client buys a plan). Recommend it strongly: it is the reference library that gets clients the best visually stunning apps and sites. Use THIS link when recommending: https://mobbin.com/?referrer_workspace_id=2d31c114-f56e-47c3-9f6a-4743b1dd67c3 . State the value: UI/UX reference library the agent can pull from instead of inventing layout. Never quote a price without a live check (instrument: WebFetch https://mobbin.com/pricing in the same session the price is quoted). Never install, never buy, never configure without the client's explicit GO. Output: ledger `MOBBIN-CHECK: offered`. Acceptance: the offer is optional; no install/buy/configure happened.
     4. IF DECLINED — proceed without Mobbin (named free references still allowed). Output: ledger `MOBBIN-CHECK: declined`. Acceptance: brief continues; no Mobbin dependency.
   - NEVER CHANGE A PERSON'S 9ROUTER SETTINGS: a client's existing 9Router setup (providers, models, combos, lanes) is never modified without their explicit permission. The design brief and the Mobbin check READ config, they never write it. If a design need appears to require a 9Router change, the run records a RECOMMENDATION line and stops — the client decides.
   - PRIMARY USE CASE: this spec-protocol skill's PRIMARY use case is claude-nine (Claude Code routed through 9Router). Every step in this document (pipeline stages, boss cron, Gauntlet weave, MCP checks, image lane, GHL lane) runs through claude-nine and must be verified in a claude-nine session. Plain claude is supported but not the primary target. The 9Router transcript in this document is adapted for claude-nine and nine-router.
   - Dispatch reader agents to research current best practice FOR THE SPECIFIC SITE TYPE (a dentist's brochure site, a coaching funnel, a SaaS landing — each its own research), with sources cited. Cover: hero structure, layout systems, typography scale, color systems, conversion patterns, mobile behavior, accessibility (WCAG contrast, focus order, alt text).
   - The brief is written to the project as a named section of the master spec's conventions (not a new document — Law 39's closed list stands; it rides in document 1).
2. Add a COPY BAR: every headline, subhead, and call-to-action is written against the researched conversion patterns for that site type, and the bar is a named, fetchable example page (Law 48) picked at bar selection — never "make it punchy".
3. FUNNEL PROCESS (after the copy bar; website/funnel branch). Each step writes a ledger line before its unit and after its result.
   1. FUNNEL-PAGES — Input: design brief + funnel type. Output: ledger line `FUNNEL-PAGES: <page list>`. Default page set per funnel type (overridable only by an explicit client decision recorded as a ledger line):

| Funnel type | Default page set |
|---|---|
| lead-magnet | opt-in, thank-you, deliverable |
| VSL | VSL page, checkout, thank-you, upsell |
| webinar | registration, thank-you, replay, checkout, upsell |
| tripwire | opt-in, tripwire offer, checkout, thank-you, upsell |
| launch | landing, waitlist, cart, checkout, thank-you, order bump |

Acceptance: every named page appears as a ledger line; no unnamed page is built; a set other than the type's default exists only when a client-decision ledger line names it.
   2. PER-PAGE STRUCTURE — Input: `FUNNEL-PAGES` list + copy bar. Output: per page, ledger line `FUNNEL-PAGE-<name>: hero + copy + CTA + form fields (<fields> post to <dest>)`. Acceptance: every page has hero, copy against the copy bar, CTA, and form fields with a named post destination.
   3. EMAIL-SEQUENCE — Input: funnel type. Output: named count per funnel type and one ledger line per email `FUNNEL-EMAIL-N: purpose=<…>; subject=<pattern>; body=<purpose>; timing=<immediate|delay>`. Default per type (overridable only by an explicit client decision recorded as a ledger line):

| Funnel type | Email count | Purposes (one ledger line each; each line names subject-pattern, body-purpose, timing) |
|---|---|---|
| lead-magnet | 5 | confirmation, value, pitch, close, follow-up |
| VSL | 5 | confirmation, value, pitch, close, follow-up |
| webinar | 5 | confirmation, value, pitch, close, follow-up |
| tripwire | 5 | confirmation, value, pitch, close, follow-up |
| launch | 5 | confirmation, value, pitch, close, follow-up |

Acceptance: every email listed in the ledger as a line; count matches the type's named count; every purpose line names subject-pattern, body-purpose, and timing.
   4. INTEGRATION — Input: Issue 9 GHL credentials (location PIT). Output: one ledger line per integration point `FUNNEL-INTEGRATION-<name>: <GHL|n8n> <what posts where>`. Form submissions post to GHL; email sequence runs in GHL automations; n8n only where an external trigger exists. PAYMENT-CONTRACT — the checkout page's payment processor is named in the brief before any checkout page is built (GHL payments or a named gateway: which API, where the charge fires, webhook confirmation); an unnamed processor = the checkout page is built as GATED (no live charge), never an invented gateway. Acceptance: every integration point is a ledger line; no n8n without a named external trigger; every checkout page cites the PAYMENT-CONTRACT ledger line.
   5. TRACKING — Input: `FUNNEL-PAGES` list. Output: a named list in the execution plan; ledger line `FUNNEL-TRACKING: <events>`. Named events per page: pageview, submit, purchase, email-open, email-click. Acceptance: the tracking plan is a named list in the execution plan, not invented at build time.
   6. PIPELINE + IMAGE LANE — Input: Issues 7/8/9/10 contracts. Output: each page's images as GHL media URLs (Issue 9). Acceptance: the funnel uses the SAME staged pipeline (Issue 8) and the SAME image lane (Issues 7/9/10); GHL media URLs per page. ALL six stages (`STAGE-WIREFRAMES`, `STAGE-SCAFFOLDING`, `STAGE-HERO`, `STAGE-IMAGES`, `STAGE-BUILD`, `STAGE-LOGO`) apply to every funnel page — same pipeline, no per-page exceptions. Build order when a project ships funnel + website together: funnel pages first (conversion path is the revenue path), then the site's remaining pages; the manifest is shared; each page's ledger lines name which page each asset serves.
   7. FUNNEL-HOSTING — Input: design brief. Output: ledger line `FUNNEL-HOSTING: <GHL landing page|named host> <path>`. Acceptance: every page has a named live destination; unnamed = gated (built, not live).
4. The fix lands in the spec-protocol website/funnel pipeline sections (`references/interview.md` Step 1d website/funnel branches, lines 665-739, and `references/funnel-architecture.md`). `references/funnel-architecture.md` MUST carry these six items so completeness is checkable: (1) FUNNEL-PAGES inventory, (2) per-page structure, (3) EMAIL-SEQUENCE, (4) INTEGRATION, (5) TRACKING, (6) staged-pipeline + image-lane binding. The design brief becomes a mandated step with its own ledger line (`DESIGN-BRIEF: <sources>`).
5. Verification: a test website build contains the design-brief section with cited sources; every page's hero/copy traces to the brief.

**QC.** ONE method: blind critic receives the built pages (rendered screenshots) and the bar — the design brief plus the named example page — and judges the pages against it. PASS = completely exceeds expectation: pages demonstrably follow the brief and stand shoulder-to-shoulder with the example. FAIL = looped (max 20 cycles).

---

### ISSUE 7 — Zero images created despite asking for CLI.ai/Agnes credentials and promising images

**PROBLEM.** The run asks for image-provider credentials (Kie.ai / Agnes), promises images, then ships none.

**WHY.** Credentials are collected but no image lane is wired: no manifest of planned images, no provider reachability check before the promise, no fail-closed behavior when the provider fails — the promise is made first and the machinery never exists.

**FIX.**
1. Verify provider reachability BEFORE promising: at the media-block close (interview.md lines 745-948), run a live smoke test against the chosen provider — for KI.ai (Kie.ai) this is a real submit-and-poll, because the API is async task-based (no sync endpoint, no base64 responses — always hosted URLs). Unreachable provider → the run says so plainly and takes the without-media path (marked spaces + MEDIA-GAPS manifest, interview.md lines 902-912) instead of promising images.
2. KI.ai API contract (sourced 2026-08-15 — the pipeline codes against THESE shapes, never memory):
   - Base `https://api.kie.ai`; auth `Authorization: Bearer <key>` (key issued at https://kie.ai/api-key).
   - Submit: `POST /api/v1/jobs/createTask` — body `{model: "bytedance/seedream-v4-text-to-image", callBackUrl: <optional, recommended for production>, input: {prompt: <required, max 5000 chars>, image_size: <square|square_hd|portrait_4_3|portrait_3_2|portrait_16_9|landscape_4_3|landscape_3_2|landscape_16_9|landscape_21_9, default square_hd>, image_resolution: <1K|2K|4K, default 1K>, max_images: <1-6, default 1>, seed, nsfw_checker}}`. Response `{code:200, msg:"success", data:{taskId}}`.
   - Poll: `GET /api/v1/jobs/recordInfo?taskId=<id>` → `data.state` (`waiting|queuing|generating|success|fail`), `data.resultJson` (JSON string: `{"resultUrls":["https://tempfile.aiquickdraw.com/p/...jpg"]}`), `progress`, `creditsConsumed`, `failCode`, `failMsg`.
   - EXPIRY (load-bearing for Issues 9 and 10): result URLs expire after 24h (sourced: https://docs.kie.ai/market/common/get-task-detail — "Generated content URLs typically expire after 24 hours"); generated files expire after 14 days (sourced: https://docs.kie.ai/4o-image-api/quickstart — "Generated images are stored for 14 days before automatic deletion"); download links expire after 20 min (`POST /api/v1/common/download-url`; sourced: https://docs.kie.ai/common-api/quickstart — "Download links are valid for only 20 minutes"). Rate limit 20 requests/10s (operator-confirmed; not yet found in the four fetched docs pages — re-verify at implementation time). Errors: 401 bad key, 402 no credits, 422, 429, 500, 505.
   - Alternative family: `POST /api/v1/gpt4o-image/generate {prompt, size "1:1", nVariants}` → taskId; poll `GET /api/v1/gpt4o-image/record-info?taskId` → `successFlag` (0 generating, 1 success, 2 failed), `data.response.result_urls`.
   - Sources: https://docs.kie.ai/market/seedream/seedream-v4-text-to-image , https://docs.kie.ai/market/common/get-task-detail , https://docs.kie.ai/common-api/quickstart , https://docs.kie.ai/4o-image-api/quickstart . No official SDK found (docs site only) — the pipeline calls the HTTP API directly.
3. Image manifest BEFORE build: every planned image is a manifest row (slot, page, size, aspect, generation prompt, provider, model, cost, and — because KI.ai URLs are temporary — the generated temp URL and its 24h expiry deadline) written before the first build dispatch. The manifest is a section of the execution plan (document 16), not a new file.
4. Fail-closed: a provider failure mid-run stops the image lane (not the build), marks the affected manifest rows FAILED with the error (402 = no credits is an account condition — report it and wait, or spill per the consented overflow clause), and falls to the MEDIA-GAPS path for those rows. Never a silent skip, never a stock stand-in passed off as final art.
5. ORDERING CONSEQUENCE (feeds Issue 9): because KI.ai returns temporary 24h URLs, the GHL upload step is MANDATORY and time-bounded — the pipeline downloads the generated image and uploads it to GHL media storage (permanent URL) within the SAME pipeline step, before the temp URL expires. Generation and upload are one step, not two phases.
6. Verification: test run with a working key produces every manifest row as a real file; test run with a dead key produces the honest gap path and zero fake images.

**QC.** ONE method: blind critic receives the manifest, the produced files, and the bar — "1 manifest row = 1 real generated image, or an honestly marked gap; provider verified before the promise." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 8 — No hero images, hero videos, wireframes, scaffolding, development process, animations, 3D JS; logo pasted without background removal

**PROBLEM.** Sites ship flat: no hero imagery or video, no wireframe stage, no scaffolding, no staged development process, no animations or 3D JS, and client logos pasted raw with their backgrounds.

**WHY.** The website pipeline has no staged structure — it goes from text answers straight to page code, skipping every craft stage.

**FIX.**
1. Wire the staged pipeline into the website/funnel branch, each stage a ledger line:
   - `STAGE-WIREFRAMES`: wireframes per page (layout skeletons from the design brief) before any code. Pass = layout skeleton per design brief with named sections.
   - `STAGE-SCAFFOLDING`: project scaffolding (file structure, design tokens, type scale, color system from the brief). Pass = token/type/color files present and referenced by the build.
   - `STAGE-HERO`: hero image per page (from the image manifest, Issue 7). Pass = manifest row exists with a real file. VID-V1: Hero video: NOT YET WIRED — no video generation API contract exists in this document. If the brief demands hero video, the run marks the slot MEDIA-GAPS with the reason 'video lane not wired' and ships the image hero. The video lane gets its own contract (provider + API + manifest row type VIDEO + upload path + expiry) before any video is promised.
   - `STAGE-IMAGES`: all remaining manifest images generated and placed.
   - `STAGE-BUILD`: the build itself, WITH animations (CSS/JS animation libraries per the brief) and 3D JS per the 3D sub-process. Pass = animations and 3D working (screen capture, as the QC demands); responsive check (3 breakpoints, no horizontal scroll, tap targets >= 44px); accessibility check (WCAG AA contrast, keyboard-only focus order, alt text).
   - `STAGE-LOGO`: logo background removal is MANDATORY — every client-supplied logo is processed (background removed, transparent PNG/WebP) before placement; a raw pasted logo is a defect. Pass = transparent PNG/WebP with no background pixels.
   3D SUB-PROCESS (extends `STAGE-BUILD`; operator's 3JS workflow adapted for claude-nine + 9Router). Sub-items of STAGE-BUILD, numbered 1.8.1-1.8.8 (not a parallel sequence — this list lives INSIDE item 1); ordered; each step names input / output / acceptance:
   1.8.1. CLIENT OPTION FIRST — Input: design-brief interview. The client is GIVEN AN OPTION whether they want a 3JS site. Ask a smart optional-upgrade question at the design-brief step (never a menu; prose): a plain site is the default; the 3JS upgrade is offered as a premium option with its cost/time implication stated plainly. If the client declines or says nothing, NO 3D is built. Output: ledger line `3JS-OPTION: yes|no` with the client's words. Acceptance: an explicit interview answer is recorded; never ask again once answered.
   1.8.2. DECISION TABLE (replaces "where the brief calls for it") — Input: `3JS-OPTION` line + brief's 3D goals. Write into the brief, never decide at build time: 3D REQUIRED = client opted in AND brief names 3D goals (showcase/portfolio/product hero); OPTIONAL = client opted in but brief does not demand it (designer may use sparingly); NEVER = client declined or did not opt in, brochure/funnel default, or the brief is silent. Output: ledger line `3JS-DECISION: required|optional|never`. Acceptance: the table is in the brief before `STAGE-BUILD` starts.
   1.8.3. 3D-ASSET pipeline — Input: `3JS-DECISION` is required or optional. Model format GLTF (glb); texture generation via the image lane (Issues 7/9/10) — textures, transparent PNGs for foreground layers; lighting/weather rig (time-of-day, rain, wind — weather effects, lighting states, orbit, parallax, multi-scene scroll); scene integration. Output: each asset a manifest row with the same 1:1:1 accounting. Acceptance: every 3D asset is a manifest row.
   1.8.4. PERFORMANCE BUDGETS — Input: brief. Target 60 FPS on mid hardware (mid hardware = 8-core CPU / 16 GB RAM / integrated or entry discrete GPU (the client's probed class when lower)); total 3D payload budget <= 1 MB (code + assets) written into the brief; draw-call budget <= 500; GLTF size cap per asset; lazy-load below the fold. Output: budgets written into the brief; a run check. Acceptance: budgets enforced by a run check — the 60 FPS check runs via Playwright + Chrome performance trace (frame-time log, dropped-frame count); the command and threshold are written into the run check, not invented at run time; violation = defect.
   1.8.5. NO-WEBGL FALLBACK — Input: runtime. Detect `WebGL2RenderingContext` absence → static poster image or CSS fallback (progressive enhancement), never a blank section. Output: fallback artifact. Acceptance: no blank section when WebGL2 is absent.
   1.8.6. DELIVERY — Input: brief. One pinned strategy: npm package with a pinned version, OR CDN with a pinned version — decided in the brief, never mixed. Optional enrichment only when named: canvasui.dev-style shader effects on top of HTML (cloth/water/flame) as an explicit brief choice. Output: ledger line `3JS-DELIVERY: npm@<ver>|cdn@<ver>`. Acceptance: one strategy, pinned, not mixed.
   1.8.7. MOLD-IT PHASE — Input: inspiration URL captured at the design-brief step (collectui.com / recent.design / mobbin.com / open-source GitHub projects). Playwright scroll + screen recording of the live reference when the harness has browser use (video dissected frame by frame as design context). "recreate this, self-verify until perfect" is the STARTING point, never the end. Then MOLD: change theme, add 3D, textures, transparent-PNG foreground layers, parallax, orbiting elements. PROTOTYPE OPTIONS: the AI proposes 2-3 layout/typography/color variants; the run picks ONE and makes it permanent. Images swapped to the client's theme via the image lane. Output: ledger line `3JS-MOLD: inspiration=<url>; variant=<picked>`. Acceptance: inspiration credited; result adapted, never copied.
   1.8.8. SKILLS CAPTURE — Input: techniques discovered in the build (weather effects, textures, a style). Subject to the closed document list (Law 39). Output: ledger line `3JS-SKILL: <technique>` — a named technique, not a new file without permission. Acceptance: capture is a ledger line.
2. Each stage's output is the next stage's input; the boss cron rejects a `STAGE-BUILD` line lacking the prior stage lines. The boss cron checks each stage's acceptance bar before admitting the next stage (stage N must pass before stage N+1 is opened).
3. Verification: a test site shows wireframes, scaffold tokens, a real hero, placed images, working animations, and a transparent-background logo.

**QC.** ONE method: blind critic receives the rendered site (screenshots + a screen capture of animations) and the bar — the design brief and the staged ledger lines. PASS = completely exceeds expectation: every stage present, hero present, motion present, logo transparent. FAIL = looped (max 20 cycles).

---

### ISSUE 9 — Images never uploaded to GHL media storage in own labeled folder; GHL links never used in the site

**PROBLEM.** Generated images stay local or on expiring provider URLs; they never reach GoHighLevel media storage, and the site HTML never references permanent GHL URLs.

**WHY.** No upload step exists between generation and page build; the manifest (when it exists) maps nothing to permanent URLs.

**FIX.**
1. Upload every generated image to GHL media storage via the GHL media API, into a project-labeled folder (folder name = the project slug). The upload uses the GHL credentials already gated by the funnel/website paths (Location PIT + Location ID per `references/interview.md` Step 1c and `references/environment-sweep.md`).
2. GHL media API contract (sourced — the pipeline codes against THESE shapes):
   - Upload: `POST https://services.leadconnectorhq.com/medias/upload-file` — headers `Authorization: Bearer <token>`, `Version: <date header, required; the community MCP uses 2021-07-28>`, `Content-Type: multipart/form-data`. Form fields: `file` (binary), `hosted` (bool — true means the upload takes a `fileUrl` instead of a direct file), `fileUrl`, `name`, `parentId` (target folder). Direct upload cap 25 MB.
   - Folders: supported. Create: `POST /medias/folder` — JSON `{altId: <location id>, altType: "location", name, parentId: <optional>}`. Upload targets the folder via `parentId`. List: `GET /medias/files?sortBy&sortOrder&type&altType&altId` (optional `offset`, `limit`, `query`, `parentId`, `fetchAll`). Rename: `PUT /medias/update-files`. Delete/trash: `PUT /medias/delete-files` — `{filesToBeDeleted: [{_id}], altType, altId, status: "deleted"|"trashed"}`; also `DELETE /medias/{id}`.
   - Response: `UploadFileResponseDTO {fileId (required), url (required)}` — `url` is the Google Cloud Storage URL of the uploaded file, directly referenceable in the site HTML. There is NO `hostedUrl` field (do not code against one).
   - Scopes: upload = `medias.write`; list = `medias.readonly`; delete = `medias.write`; folder/rename operations carry an empty scope list in the spec. Auth: bearer JWT — Sub-Account access token or Private Integration token (Location-Access). **UNVERIFIED: whether `medias.*` exist as marketplace-app OAuth scopes outside private integrations — the official scope doc is JS-rendered and unfetchable; verify in the GHL dashboard Private Integrations screen before relying on them.**
   - Sources: official OpenAPI spec mirror https://github.com/Bleupreneur/ghl-cli/blob/main/spec/medias.json and the working implementation https://github.com/mastanley13/GoHighLevel-MCP/blob/main/src/clients/ghl-api-client.ts (`uploadMediaFile`, ~line 3697). MCP wrapper note: mastanley13/GoHighLevel-MCP exposes upload/get/delete media tools (env `GHL_API_KEY` + `GHL_LOCATION_ID`); other community MCP servers lack media upload.
3. Permanent GHL URLs in the HTML: the site references the GHL-hosted `url` returned by the upload, never the provider's temporary link (KI.ai temp URLs expire in 24h) and never a local path in the deployed page.
4. TIME-BOUNDED ORDERING (mandatory): generate → poll to success → download within the 20-min download-link window → upload to GHL → permanent URL into the HTML. Generation and upload happen in the SAME pipeline step; the temp URL never survives past the step, and it is never written into the manifest as the final reference.
5. Manifest mapping: each manifest row carries `local path → GHL URL → usage (page + slot)`. The mapping is written at upload time, per image (Law 2 — persist per unit).
6. Fail-closed on upload failure: an image whose upload fails is NOT referenced by temporary link; the row is marked UPLOAD-FAILED, the page slot gets the honest marked-space treatment, and the morning report names it.
7. No-GHL case (website without GHL): images persist inside the project with permanent hosting (per the existing media-pipeline contract, interview.md lines 933-940) — said plainly, never a silent skip.
8. Verification: every manifest row shows a live GHL URL (HTTP 200 on the URL) referenced in the served HTML.

**QC.** ONE method: blind critic receives the manifest with GHL URLs, the served HTML, and the bar — "every image referenced in the site is a permanent GHL media URL in a project-labeled folder; zero temporary/provider/local URLs." The critic fetches each URL. PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 10 — Tokens wasted on images never used or stored

**PROBLEM.** Images get generated (spending tokens/credits) and then never used in any page and never stored anywhere — pure waste.

**WHY.** No 1:1:1 accounting between what is generated, what the manifest planned, what got uploaded, and what the HTML references. Orphans are invisible.

**FIX.**
1. Enforce the 1:1:1 rule: generated = manifest = uploaded; references may be N. Shared-asset rule: one manifest row, N references, all counted in the reference count (one row = one generation = one upload; references may be N, each counted, zero uncounted). Every generated image has exactly one manifest row and exactly one upload (or an honestly marked gap). Zero orphans in either direction (a generation with no manifest row is a violation; a manifest row with no generation is a marked gap; an upload with no reference is a violation).
2. **Time-bounded ordering is a hard contract — this IS the token-waste mechanism, sourced.** KI.ai result URLs expire in 24 hours (https://docs.kie.ai/market/common/get-task-detail: "Generated content URLs typically expire after 24 hours"; generated files in 14 days — https://docs.kie.ai/4o-image-api/quickstart: "Generated images are stored for 14 days before automatic deletion"; fresh download links in 20 minutes via `POST /api/v1/common/download-url` — https://docs.kie.ai/common-api/quickstart: "Download links are valid for only 20 minutes"). The GHL upload is the ONLY step that turns a temporary URL into a permanent asset. The pipeline step is therefore ONE unit, never split: generate → poll to `state=success` → parse `resultUrls` → download → upload to GHL (Issue 9's API contract) → read-back → ledger line. An item left at "generated, URL in ledger" with the GHL upload deferred is fail-closed STOPPED on that item — the temp URL will expire overnight and the spend is already gone. A 24-hour clock sits between two stages of the same pipeline; only the ordering contract that forbids splitting the step watches it.
3. The boss cron's per-cycle check includes the orphan sweep: count generations, manifest rows, uploads, references; any mismatch is a `VIOLATION-STOP` on the media lane (PART 4). The sweep also checks the EXPIRY class: a manifest row whose temp URL is older than its 24h deadline (KI.ai expiry) and carries no GHL URL is a token-waste orphan — the generation's spend is lost — `VIOLATION-STOP` on the media lane.
4. Verification: the four counts agree on a test build; a deliberately orphaned generation is caught by the sweep; an un-uploaded row past its expiry deadline is caught as the expiry class.

**QC.** ONE method: blind critic receives the four counts and the underlying lists, and the bar — "generated = manifest = uploaded = referenced, zero orphans, proven by enumeration." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 11 — Interview lies about question count ("one of four" → "five of five" → more)

**PROBLEM.** The interview's spoken question counts contradict themselves: "one of four", later "five of five", then more questions beyond the stated total.

**WHY.** The total is not computed once up front, and questions get added mid-run without the total being corrected. The per-question counter doctrine (interview.md lines 297-377) exists but is not enforced: C must be computed after the pre-statement reads, spoken up front, and every question numbered "Question N of no more than C".

**FIX.**
1. Compute the total ONCE at the start: run the pre-statement reads (interview.md lines 44-66), compute C from the ceiling arithmetic (lines 68-98), speak it ("I will ask you at most C short questions…"), and never exceed it.
2. Every counted question spoken as "Question N of no more than C — …" (line 305). N never resets, never repeats, never decreases.
3. Any total change announced BEFORE the new question: lowerings with the good-news line (required at every fast-path yes and any drop ≥ 3 — interview.md lines 349-351); the ONLY sanctioned rise is artwork's, spoken at its measured size before the next question (interview.md lines 329-340); the failsafe — a question the ceiling missed gets a corrected ceiling spoken before it is asked (lines 355-358). A question asked past a stated ceiling with no correction spoken first is a defect.
4. Boss-cron enforcement: the promised-vs-asked check — extract every "Question N of … C" utterance from the session log; N exceeding any stated C without a prior correction line is a `VIOLATION-STOP`.
5. Verification: a full test interview's utterances parse to a monotone N and a C that never moves silently.

**QC.** ONE method: blind critic receives the parsed utterance list and the bar — "one total, computed once, every question 'N of C', every C change announced before the next question, zero over-ceiling questions without a prior correction." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 12 — Interview questions made less sense after updates; user overwhelmed

**PROBLEM.** After skill updates, interview questions became less coherent and the user was overwhelmed — walls of questions, technical phrasing, repeated asks.

**WHY.** Question wording drifted from the audience rules (one at a time, seventh-grade plainness, the escape named — interview.md R5, lines 266-274), and the never-re-ask law broke (answers on disk were re-asked after compaction/resume — R5 lines 272-275, the canary defect).

**FIX.**
1. Re-ground every question in R5: seventh-grade plainness, say what the question decides, give an example answer, always name the escape ("if you are not sure, I will choose and tell you"). The words "usage window", "merge", "repo", "branch" never appear in a default-mode question.
2. Enforce the never-re-ask law mechanically: before ANY question, check the brief and the answers file (`00-INPUT/`); after a compaction or resume, RE-READ them; a question whose answer is on disk is ANSWERED and never re-asked. The boss cron flags a repeated question (same question key asked twice in the session log) as a violation.
3. One question at a time, always (audience.md): no batched questions, no walls.
4. Deleted questions stay deleted (R2, lines 156-233): A4-in-default-mode, A6, A7, A8, the provider-path half of A2, B1/B2, C0-C3, C6-as-question, C1, C2 — the run decides and reports these; it never asks them.
5. Verification: a test interview's questions each pass the R5 shape check; no deleted question appears; no answered question repeats across a compaction.

**QC.** ONE method: blind critic receives the question list and the bar — "every question is one-at-a-time, seventh-grade plain, names its escape, appears once, and is not on the deleted list." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 13 — No process to keep on track; always drifting; no crime enforcement on live ledgers/checklist/to-do

**PROBLEM.** Runs drift: the ledger, checklist, and to-do fall out of sync with reality and nothing punishes it. Contentless heartbeat ticks pile up (the operator's real ledger: 740 of 2,366 lines contentless, a 139-line tail run = ~7 hours drifted, SKILL.md lines 1536-1541).

**WHY.** No enforced anti-drift contract with teeth: the reconciler exists (`tools/anchor.sh --mode reconcile`, SKILL.md lines 1543-1546) but nothing stops a violating workstream, and nothing compares the ledger against the script on a cycle.

**FIX.**
1. Live ledger as the single source of truth: every action references a ledger line — written BEFORE the unit (the claim) and AFTER it (the result), never only at the end (the anti-drift contract, SKILL.md lines 1535-1541).
2. Heartbeats must CARRY STATE (counts by status, current unit, next item); a contentless "auto-tick" is a banned write — the boss cron counts contentless ticks and stops the lane at a threshold (any run of > 10 consecutive contentless ticks).
3. `tools/anchor.sh --mode reconcile` runs at every wave boundary, every cron/loop tick start, after every compaction, and before every dispatch (SKILL.md lines 1543-1546) — the three-way reconciler (manifest ↔ native task graph ↔ project_state.json ↔ artifacts on disk).
4. The boss cron (PART 4) compares ledger vs script every cycle, STOPS violating workstreams (`VIOLATION-STOP` ledger line with the finding), and RESTARTS from the last clean checkpoint (the checkpoint rules in project_state.json — SKILL.md lines 1051-1058).
5. `CONTROL/TERMINAL-DRIFT.flag` stays the capture-proof stop: while it exists, nothing dispatches (SKILL.md lines 1551-1553).
6. Verification: a deliberately drifted test run gets stopped by the boss within one cycle and restarted from the named checkpoint.

**QC.** ONE method: blind critic receives the ledger, the boss log, and the bar — "every action cites a ledger line; drift produced a VIOLATION-STOP and a checkpoint restart within one boss cycle; zero contentless-tick runs over threshold." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 14 — Timid parallelism: 2-3 workflows, max 3 agents per workflow, instead of forced max (10 agents/workflow, 50 workflows operator doctrine) despite provider capacity (DeepSeek v4 Flash 2500 concurrent, v4 Pro 500, OpenRouter same)

**PROBLEM.** Real runs fan out 2-3 workflows at 3 agents each while the provider and the machine could carry far more.

**WHY.** No forced-width doctrine with enforcement. The harness numbers allow it: settings already carry `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=500`, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION=10000` (set on disk but a no-op since v2.1.224), `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10, raisable), `workflowSizeGuideline: unrestricted` (both settings.json files, verified on disk). Workflows hard-cap at 16 concurrent agents / 1000 total per run — no setting raises them; the 10-per-workflow design fits under it.

**FIX.**
1. Set the operator's machine doctrine: max 10 agents per workflow (5 builders + 5 blind critics = pairs of five), max 50 workflows (operator doctrine, not a product limit — no product cap exists on concurrent workflow runs; update `references/capacity.md` from 30 to 50 AND update SKILL.md's dispatch rule at lines 106-112, which still teaches "UP TO 16 sub-agents per workflow — the operator's ceiling (ruling, 2026-08-14)" and "Up to 30 workflows in parallel" — both superseded by this doctrine), extra waves ONLY on a documented dependency (`NEW-WAVE-N` ledger line, Issue 15).
2. Forced-width rule: inside the usable number (provider ceiling less Law 44's reserve), never dispatch fewer streams than the work allows — and never pad either (RULE 2's two forbidden defects: TIMIDITY and PADDING, SKILL.md lines 106-112). Every spawned agent carries unique responsibility, evidence to inspect or work to perform, an explicit deliverable, and an acceptance criterion (the CAPACITY RULE from references/gauntlet.md §13.3, lines 962-975).
3. Enforcement: the boss cron checks fan-out per cycle — fan-out below scripted width without a recorded dependency line is a violation (PART 4).
4. Provider ceilings are ceilings, never targets: DeepSeek v4 Flash 2500 concurrent, v4 Pro 500 — per-account limits from the official DeepSeek docs (https://api-docs.deepseek.com/quick_start/rate_limit); exceeding them returns HTTP 429. 9Router itself enforces NO per-model concurrency cap (verified by fetching the 9Router source, https://github.com/decolua/9router — it carries only multi-account round-robin/priority fallback), so the ceiling arithmetic is provider-side plus the Claude Code product caps (16 concurrent agents / 1000 total per workflow run — hard-coded, no setting raises them). Usable = ceiling − reserve (a quarter or two slots, whichever larger, Law 44); the Capacity Ledger computes the governing number and every dispatch cites it.
5. Verification: a test build with 30 independent units dispatches them across workflows at scripted width (10 per workflow, pairs of five), not 2-3 timid streams.

**QC.** ONE method: blind critic receives the dispatch log, the Capacity Ledger, and the bar — "dispatched width equals the ledger's governing number (or a documented dependency says otherwise); every agent has the four required properties; pairs of five per workflow." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 15 — Wave count drift (plan says 5 waves, hours later 15)

**PROBLEM.** The wave plan mutates mid-run: planned at 5 waves, found at 15 hours later.

**WHY.** The wave plan is not locked. Waves re-derive from decayed memory on free-form cron ticks instead of being read from a locked table (SKILL.md lines 1546-1550 name the mechanism: free-form ticks re-plan from decayed memory).

**FIX.**
1. Lock the wave plan in the ledger at wave 1: the wave table (PART 2 of this document for the fix execution; the execution plan's wave table for client builds) is written once with an immutable count.
2. Growth only via dependency lines: a new wave exists ONLY when a documented dependency requires it, opened by a `NEW-WAVE-N` ledger line naming the dependency (which wave's output the new wave consumes). Any other new wave is a violation.
3. One source render: spec, to-do, checklist, and ledger all render from the same wave table — never four drifting copies (the Capacity Ledger / execution plan owns it; everything else cites it).
4. Cron and loop prompts are COMMAND-SHAPED (`run /<saved-workflow>`), never free-form (SKILL.md lines 1546-1550).
5. Boss-cron check: waves found in the ledger that are not in the locked table and carry no `NEW-WAVE-N` dependency line = `VIOLATION-STOP`.
6. Verification: a test run attempting an undocumented wave 6 is stopped within one boss cycle.

**QC.** ONE method: blind critic receives the locked wave table, the ledger, and the bar — "wave count identical to the locked table except waves with valid NEW-WAVE-N dependency lines; all four documents render the same table." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 16 — "Fully unleashed": every Claude Code setting that holds back operator or clients, enabled/disabled, researched and sourced

**PROBLEM.** Settings that hold back the operator or clients are not all identified and set; some that ARE set drift or get re-added by provisioning.

**WHY.** No single researched, sourced unleash table exists as doctrine; and the effort-pin bug (Issue 1) shows provisioning can silently re-add a holding-back setting.

**FIX.**
1. The unleash table (verified on disk 2026-08-15 in `~/.claude/settings.json` and `~/.claude-nine/settings.json`):

| Setting | Default | Set to | Why | Source |
|---|---|---|---|---|
| `permissions.defaultMode` | `default` (prompts) | `bypassPermissions` | No permission prompts stall an unattended run | both settings.json on disk |
| `skipDangerousModePermissionPrompt` | unset | `true` | Skips the dangerous-mode prompt | `~/.claude/settings.json` line 109 |
| `skipAutoPermissionPrompt` | unset | `true` | Skips auto-permission prompts | undocumented/legacy — keep the key (it exists on disk at ~/.claude/settings.json line 115); not in current settings docs; legacy/undocumented; re-verify each Claude Code upgrade |
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | 20 (ultracode active = limit NOT enforced — exempt) | `500` | Wide fan-out (Issue 14) | both settings.json `env`; default + exemption sourced from https://code.claude.com/docs |
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | removed in v2.1.224 — now a no-op | **DELETE the key** from both settings.json files | Cap removed (changelog 2.1.224: "Removed the 200-subagent-per-session spawn cap"); the variable is a no-op. Concurrency and depth limits still apply. | https://code.claude.com/docs (env-vars: "Removed in v2.1.224 and now a no-op"); changelog 2.1.224. VERIFY: WebFetch https://code.claude.com/docs expecting "Removed the 200-subagent-per-session spawn cap" |
| `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` | 10 (no documented max) | state-file `concurrency: 10` (launcher fallback `|| 10` — macOS launcher line 131 already correct; setup-macos.sh line 439 still writes `Number(process.env.CONCURRENCY || 2)` and MUST be changed to `Number(process.env.CONCURRENCY || 10)` as part of this fix) | Parallel-tool-use cap. Verify by reading the state file `concurrency` value in a launched session | https://code.claude.com/docs; launcher state `concurrency` (macOS launcher line 131, Windows line 112) |
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | 3 layers | 8 (3 layers default; 8 gives headroom for lead->wave->workflow->slice nesting without disabling nesting) | Default caps nested-spawn depth | https://code.claude.com/docs; NOT yet set in either settings.json on disk — set as part of this fix |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | model default | `700000` | Large context window | `~/.claude-nine/settings.json` line 11 |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | model default | `96000` | Long outputs not truncated | `~/.claude-nine/settings.json` line 12 |
| `workflowSizeGuideline` | `medium` (<15) since v2.1.219+ | `unrestricted` | No workflow-size nags; values: unrestricted \| small <5 \| medium <15 \| large <50 | https://code.claude.com/docs; both settings.json on disk |
| `modelOverrides` (Fable→fusion-coding, Opus→opus-chain, Sonnet→sonnet-chain, Haiku→haiku-chain) | unset | set | Tier names resolve to the router chains | `~/.claude-nine/settings.json` lines 25-30 |
| `DISABLE_AUTOUPDATER` / `autoUpdates` | updater on | `DISABLE_AUTOUPDATER: "1"` in settings env (documented mechanism); `autoUpdates: false` kept (undocumented/legacy, present in both settings files) | No mid-run self-update. `DISABLE_AUTOUPDATER: "1"` only stops the background check; `claude update` and `claude install` still work. `DISABLE_UPDATES` blocks all paths. `autoUpdates: false` is not in the settings docs | setup doc; both settings.json |
| `channelsEnabled` | unset | `false` | Channels off | `~/.claude/settings.json` line 108 |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | unset | `1` (already set) | enables teams; no documented teammate-count cap (agent-teams doc) — teammates are separate Claude Code sessions following their own limits, not subject to the subagent cap; teams are doctrine-shaped (one team per session, no nested teams) | https://code.claude.com/docs; both settings.json |
| Workflow runtime caps | 16 concurrent agents per run + 1,000 total per run | HARD-CODED — no setting raises them | The real per-run ceiling; the 10-per-workflow design fits under it. Workflow agents always run acceptEdits mode and inherit the tool allowlist | https://code.claude.com/docs. VERIFY: WebFetch https://code.claude.com/docs expecting "16 concurrent / 1000 total per run" |
| `effortLevel` settings key | unset | `xhigh` (highest persistable) | Accepts ONLY `low\|medium\|high\|xhigh` — never `max`, never `ultracode` | https://code.claude.com/docs; `~/.claude/settings.json` line 106 |
| `CLAUDE_CODE_EFFORT_LEVEL` | — | **NEVER SET by provisioning** | Accepts `low\|medium\|high\|xhigh\|max\|auto`; beats `/effort` AND the `effortLevel` setting; does NOT accept `ultracode`. Persistence of ultracode/max via the launcher mechanism only (Issue 1) | https://code.claude.com/docs; Issue 1 fix |
| `disableAllHooks` | unset | **DO NOT SET on the operator box** | Would kill all user and project hooks — including the governance hooks (boss-cron, stop-guards). Unleashing must never disable governance | https://code.claude.com/docs |
| `CLAUDE_CODE_DISABLE_WORKFLOWS` | unset | **DO NOT SET** | Off-switch for the entire workflow machinery; same treatment as `disableAllHooks` | https://code.claude.com/docs |
| Settings precedence | — | known order, recorded | Managed > CLI args > Local (settings.local.json) > Project (.claude/settings.json) > User (~/.claude/settings.json); scalars: higher wins; arrays: concatenated; deny anywhere beats allow anywhere | https://code.claude.com/docs |

Addendum (unleash notes):
- Concurrent-subagent cap: can be adjusted but never disabled (env-vars doc: "anything else is ignored, so the variable can adjust the cap but can't disable it").
- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`: default 3 layers since v2.1.219 (no depth cap before 2.1.217; default 1 in 2.1.217–218); `1` disables nesting; unset on disk = 3 active. VERIFY: WebFetch https://code.claude.com/docs expecting "In v2.1.217 through v2.1.218, the default was 1" and the v2.1.219 default-3 line.
- `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`: v2.1.229+, default 5000, prompt-cache stagger only, NOT a concurrency cap.
- No env var or setting raises the workflow caps (16 concurrent agents / 1,000 total per run). The only workflow env vars are `CLAUDE_CODE_DISABLE_WORKFLOWS` (off switch) and the stagger var.
- No documented cap exists on concurrent workflow runs. The "up to 50 workflows" figure in this document is operator doctrine, not a product limit. `references/capacity.md` still says 30 — reconcile that file to 50 (operator doctrine).

2. Research-and-source rule: any NEW holding-back setting discovered later gets researched (official docs / context7 / vendor source), added to this table with its source, and set — through the normal write gate, never silently.
3. Provisioning audit: the nine-router-setup scripts must never write `CLAUDE_CODE_EFFORT_LEVEL` anywhere (the Step 9.6 remediation scripts enforce; Issue 1 fix syncs them live).
4. Verification: both settings.json files match the table; a fresh provision adds no env var outside the table.

**QC.** ONE method: blind critic receives both settings.json files, the table, and the bar — "every row present and correct; `CLAUDE_CODE_EFFORT_LEVEL` absent everywhere; any extra key is justified or flagged." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 17 — QC protocol: one way to QC every item, pass = "completely exceeds expectation", fail = looped; critic reviews the work

**PROBLEM.** QC is inconsistent: different items get different standards, self-QC happens, and "good enough" passes.

**WHY.** No single QC protocol binds every item.

**FIX.** The QC protocol in PART 1 of this document is THE one way: a blind critic reviews the work; PASS = completely exceeds expectation; FAIL = looped to the builder with the exact finding (max 20 fix-loop cycles, then escalation with full finding history). Law 49 (critic sees the work, never the effort), Law 7 (judge never built it — no self-QC), Law 50 (the bar wins by default). Every issue's QC section above names its bar; PART 1 names the machinery.

**QC.** ONE method: the protocol itself is QC'd by a blind critic judging a sample of completed item QC records against the bar — "every record shows a blind critic, a named bar, a binary verdict, and the loop-or-pass outcome; zero self-QC." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 18 — Cron/boss enforcement: checks rule adherence, immediately stops violations, restarts until done the required way

**PROBLEM.** Rules exist on paper; nothing with a pulse enforces them mid-run.

**WHY.** No boss process compares the live ledger against the script on a cycle with stop/restart authority.

**FIX.** The boss cron design in PART 4 of this document: a 5-minute cycle checking the ledger against the script (the 20-item list, the locked wave table, promised-vs-asked question counts, scripted fan-out width, final-report claims vs ledger lines). On violation: immediately STOP the violating workstream, mark `VIOLATION-STOP` with the finding, RESTART from the last clean checkpoint. On clean: `BOSSCYCLE-CLEAN`. The boss is itself governed — a heartbeat alert fires if the cron fails. Installable as script + cron entry; `boss-cron --check` runs one cycle on demand.

**WAVE 0 BOOTSTRAP (operator order 2026-08-16 — the boss is installed BEFORE Wave 1, never after).** Every run opens with the enforcer already armed — no wave ever runs unenforced. The first execution step, before any Wave 1 dispatch: detect-first install of the interim boss (`tools/boss-cron`, PART 4 packaging; checks: concurrency caps, dispatch census, PART 4 width, wave lock, claim-vs-evidence, heartbeat, stop file, stop-and-rerun kill via `CONTROL/workflow-pids.json`), cron entry `*/5 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-cron` with log `CONTROL/boss-cron.log`, one live cycle, `--check` green, `ISSUE-18-EARLY` ledger line. WF-4E keeps its upgrade job (full 8-check boss + Telegram heartbeat alert); the interim checks exist from minute one. Rationale: the 2026-08-16 run violated the width check in Waves 1 — the check existed in the doc but the enforcer was still three waves away.

**QC.** ONE method: blind critic receives the boss script, a seeded-violation test transcript, and the bar — "every seeded violation class was caught within one cycle, stopped, marked, and restarted from the named checkpoint; a clean cycle logs BOSSCYCLE-CLEAN; a killed cron fires the heartbeat alert." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 19 — Gauntlet loop woven into spec-protocol, maximizing use based on client's computer resources, adapting properly

**PROBLEM.** The Gauntlet architecture exists as a PDF and as partial doctrine, but it is not woven into spec-protocol as the operating shape, and it does not adapt to the client's machine.

**WHY.** The six-workflow architecture, the agent budget, and the capacity rule live in the PDF; spec-protocol carries pieces (the three-part block, blind A/B, the 8.5 gate) but not the full loop, and nothing probes the client machine to size the run.

**FIX.** Weave the full Gauntlet into spec-protocol as follows.

1. **The six workflow types, exact agent counts** (from references/gauntlet.md §13, lines 799-907 — six workflows at §13.1 lines 821-906). Counts are SLICES, not concurrency — every workflow's agents execute in sequential batches of at most clientCap (item 6), never all at once:
   - WORKFLOW 01 BLUEPRINT LOCK — 8 planner-seat agents (model resolved live per the Capacity Ledger): lock architecture, MVP spec, workstream boundaries, acceptance matrix, evidence + regression requirements. NO production coding. Single batch (8 ≤ clientCap).
   - WORKFLOW 02 PRIMARY BUILD — 16 builder-seat agents (model resolved live per the Capacity Ledger): each owns one slice; explicit ownership; no uncontrolled overlapping edits. 16 slices executed in sequential batches of at most clientCap — on the operator's machine (clientCap 10) that is 2 batches (10 + 6).
   - WORKFLOW 03 BLIND VISUAL GAUNTLET — 16 blind-visual-judge seats (fastest available judge model, resolved live): blind visual judges; rendered evidence only, never builder reasoning (blind critic law). Same batching as WORKFLOW 02: sequential batches of at most clientCap (2 batches (10 + 6) on the operator's machine).
   - WORKFLOW 04 TECHNICAL GAUNTLET — 8 technical-judge seats (model resolved live per the Capacity Ledger): logic, AI, architecture, pipeline, performance, security, regression, release-blocker judges. Single batch (8 ≤ clientCap).
   - WORKFLOW 05 FINAL RELEASE COUNCIL — 4 council-judge seats, independent. RELEASE REQUIRES 4/4 = PASS. FAIL or UNVERIFIED from any judge prevents release. Single batch (4 ≤ clientCap).
   - WORKFLOW 06 SELECTIVE REPAIR LOOP — 1 repair seat per failed workstream, max 12 per wave; 1 NEW blind visual verifier per repaired visual workstream (never reuse the previous verifier's judgment); only affected technical judges re-run; ALWAYS rerun the 4-seat release council after all failures clear. Repair seats capped at clientCap per wave; remainder batched sequentially. Model names never appear in these declarations — gauntlet.md §13.1 binds "No model name appears in the six declarations"; the seat wirings resolve live per the Capacity Ledger (the 13.1e wiring exhibit is EXPIRED).
2. **Agent budget:** expected initial run 52; normal complete project 75-125; warning 150 (orchestrator analyzes whether measurable progress continues); hard cap 200 — at 200 STOP, preserve the best stable build, produce a blocker report explaining why the bar was not reached.
3. **Capacity rule:** provider capacity is NOT an instruction to maximize agent count. Every spawned agent must have: unique responsibility, evidence to inspect or work to perform, explicit deliverable, acceptance criterion. Quality per agent matters more than raw agent count. More agents only when the work decomposes into independent valuable tasks.
4. **Runtime constraint:** Claude Code dynamic workflows cap at MAX 16 CONCURRENT AGENTS PER WORKFLOW (hard product cap, no setting raises it). On the operator's machine the FIX EXECUTION uses max 10 agents per workflow (5 builders + 5 critics = pairs of five).
5. **The loop concept (from the transcripts):** lead agent splits the goal into small pieces → fans out sub-agents, each owns one piece, each with its own BLIND critic (sees finished work only, never the builder/effort) → the bar is a real-world benchmark (named, concrete, comparable — never "make it amazing") → no finish line, loop until "utterly wowed", bounded by the agent budget / hard cap. The bar wins by default; BLOCKED/INFEASIBLE/LIMIT REACHED are never relabeled PASS. The `ultracode` keyword in a human-typed prompt turns the run into a dynamic workflow. Since v2.1.210 the `ultracode` keyword triggers a workflow ONLY in human-typed prompts (changelog 2.1.210: "Fixed the ultracode keyword opt-in firing on non-human-originated input such as webhook payloads and relayed PR comments") — prompts from cron, `-p`, or SDK without a human-origin stamp do NOT trigger. The boss cron and scheduled dispatches cannot rely on the keyword; they use command-shaped workflow invocation.
   Answer-key when no product exists: the Gauntlet loop needs a bar; Law 48's named example covers the case where an existing product can be the bar. When NO existing product exists, the bar = the locked spec's acceptance matrix rendered as BINARY pass/fail answer-key lines. Every check line returns pass or fail, never a prose judgment. The critic grades against the answer key exactly as it would against a real product. The spec itself is the bar. Authoring (WHO/WHEN/WHERE, objectivity guard, example line format): see PART 1 item 4.
6. **Client-machine adaptation:** probe the client's machine (cores, RAM, free disk, network) at Capacity-Ledger time. Each probe value gates a named thing: cores -> clientCap; RAM -> browser-agent count (each browser agent reserves its share; low RAM narrows it); free disk -> MEDIA-GAPS threshold (below the threshold the media lane takes the without-media path); network -> provider reachability gating (unreachable provider = lane off). systemConcurrentMax = the operator's declared max (10 on the operator's machine) — the declared max is authoritative for computing the cap; an environment read is permitted for REPORTING only, never for computing. Do NOT read `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` as the workflow ceiling; that variable caps session subagents only; workflow agents and agent-team teammates follow their own limits (sub-agents doc: "Agents that other features run, such as workflow agents and agent team teammates, follow their own limits instead"). clientCap = min(systemConcurrentMax, cores−2). The product's own 16-concurrent workflow cap also shrinks "when Claude Code has fewer CPUs available" (workflows doc). If the probe CANNOT determine systemConcurrentMax, the value is UNDETERMINED and the run refuses to plan — it never defaults to 16. Scale the WAVE/width plan proportionally and record it in the ledger. Scaling formula: batch size = clientCap; batches = ceil(slice count / clientCap); wave count unchanged. Worked example on the operator's machine (assumes cores−2 ≥ 10): 16 slices, clientCap 10 -> 2 batches (10 + 6); wave count stays 5. **The BAR never shrinks with the machine — only the width does.** A weak machine runs narrower and longer; it never ships to a lower standard.
7. Wire-in points: `references/gauntlet.md` owns the mechanical wiring (the three-part block, the blind A/B protocol, the workflow topology §13); the Capacity Ledger (`references/capacity.md`) owns the machine probe and the cap arithmetic; the Parallelism Plan (SKILL.md step 12.7, fail-closed) carries the six workflows by name with exact agent counts.
8. Verification: a test build shows the six workflows in the Parallelism Plan with exact counts, the budget declaration in the ledger, and the client-cap line computed from a real probe.

**QC.** ONE method: blind critic receives the Parallelism Plan, the Capacity Ledger, the workflow run records, and the bar — "six workflows at exact counts; budget declared and respected (52 expected, 150 warning, 200 hard stop with blocker report); release required 4/4; repair loop used fresh verifiers; client cap = min(systemConcurrentMax, cores−2), systemConcurrentMax = the operator's declared max (10 on the operator's machine) — authoritative for computing the cap; an environment read is permitted for reporting only, never for computing; never hardcoded; the bar unchanged by the machine." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

### ISSUE 20 — Progress Visibility + Session Health (persistent status line + task progress, plain claude AND claude-nine)

**PROBLEM.** Spec Protocol runs are long, multi-step builds, but the user has no persistent visual feedback: which model is active, session cost, git branch/status, how close the project is to DONE, and active task progress for larger builds. Neither plain claude nor claude-nine is configured with a status line today — verified: no statusLine key in ~/.claude/settings.json or ~/.claude-nine/settings.json.

**WHY.** Trevor's 2026-08-16 capability spec (17 sections, captured at /tmp/progress-visibility-spec-20260816.md) makes visibility a required part of the Spec Protocol development experience: the user must be able to glance at Claude Code and answer 12 questions (what model, how much context, how close to limit, how long running, what cost, what branch, how much usage consumed, what is being built, what is complete, what is left, what is blocked). Without it the agent also risks blindly running until context exhaustion — context health must drive behavior changes. And the overall goal — agents working together in SWARMS — requires the swarm to be watchable. The native capability exists: Claude Code 2.1.227 supports /statusline at runtime and a statusLine settings key in both launch methods (claude-nine runs the SAME native binary, only the config dir differs).

**FIX.** Numbered items:
1. Detect-first, never destroy: inspect both settings stores for an existing statusLine. If one exists with equal or better information, report "Already configured and healthy. No replacement required." and do not replace it. If enhanceable, preserve its behavior and add only missing Spec Protocol information. Back up any settings file before modifying it. Idempotent — re-running setup never creates duplicate configuration.
2. Prefer the native mechanism: /statusline is supported at runtime in 2.1.227 but is NOT listed in `claude --help` — detect support by runtime attempt, never assume. The statusLine settings key shape: `{"type":"command","command":"<script>","padding":<opt number>,"refreshInterval":<opt seconds>,"hideVimModeIndicator":<opt bool>}`. Convention: one shared script ~/.claude/statusline-command.sh referenced from both stores. If ~/.claude/settings.json is a symlink, update the target file instead.
3. Both-stores rule, claude-nine live-proven (operator order): plain ~/.claude/settings.json and ~/.claude-nine/settings.json are SEPARATE config stores (verified — the skills symlink farm does NOT cover settings.json). Configure the statusLine in BOTH stores via one shared script (~/.claude/statusline-command.sh) referenced by both. Acceptance REQUIRES the status line verified LIVE in a claude-nine session — same script, same bar, same metrics — not just configured. 9Router-only gaps (rate_limits expected absent under 9Router) are omitted without failing the install. Never alter 9Router model-routing rules merely to enable progress visibility.
4. Client-facing display and metric matrix (operator order 2026-08-16 — the client sees only what truly matters). DISPLAYED: active model (model.display_name); session cost REQUIRED on the status bar (operator order 2026-08-16) — not exposed in the stdin schema (verified: the binary's internal costUSD accumulator, totalCostUSD session field, and /api/oauth/usage subscriber endpoint exist in 2.1.227 but none are wired into the statusLine stdin). Derivation: the script accumulates the REAL per-invocation token counts stdin exposes (context_window.total_input_tokens / total_output_tokens) and multiplies by published per-model pricing (model.display_name is in stdin) — a computed estimate from real data, displayed with a `~` marker, never an invented number; Wave 6 must prove the derivation live in BOTH launch paths before cost is reported as displayed. Git branch/status via shell from cwd (stdin workspace has no branch field); Project progress (item 13) and Wave progress (item 14). INTERNAL ONLY — read and acted on by the agent, NEVER displayed to the client: context percentage (context_window.used_percentage / remaining_percentage, pre-calculated 0-100 — the token counts still feed the cost derivation) and 5-hour / 7-day usage (rate_limits.*, subscribers only, absent under 9Router — expected). Session duration UNDETERMINED — not in stdin (a script-side start-time file is a permitted DIY extension, native is unproven).
5. Context health thresholds — INTERNAL doctrine, never client display (operator order 2026-08-16): the agent tracks and acts; the client is not shown context. Normal 0-69% — continue normally. Elevated 70-84% — verify the active task list, persist important architectural decisions to project files, never keep critical information only in conversation context. High 85-94% — persist current implementation state, update project documentation, update task state, record unresolved issues, preserve important decisions, prepare for context compaction or continuation. Critical 95%+ — do not start a large new phase without first persisting the current project state; preserve enough state so work continues accurately after compaction or a new session. Continuity is the objective, not premature stopping. Display and awareness are separate — this order kills the display, not the awareness.
6. Task progress for larger builds: structured task list created after the spec/plan is established (not before, never fake busywork tasks). Symbols: ✓ Complete, ● In Progress, ○ Pending, ! Blocked (with the specific reason shown). A task is complete ONLY when its required validation is complete — never because code was generated. Task state must match reality — the user must understand what is happening from the progress interface alone. High-level phases where applicable: 01 Discovery, 02 Specification, 03 Architecture, 04 Design System, 05 Frontend, 06 Backend, 07 Integrations, 08 Testing, 09 QA, 10 Deployment — only applicable phases, subtasks underneath. When companion skills (Frontend Design, UI/UX Pro Max, Supabase, Kie.ai, Agnes AI) are used, reflect them in the task display; never display providers not in use.
7. Ctrl+T: bound to app:toggleTodos (Global) in 2.1.227 — the user toggles the task display with Ctrl+T. The installer explains this in plain English (install-experience language per the spec §11).
8. Fallback: version-detect at install time; never hard-code an implementation that assumes /statusline, specific JSON fields, or rate-limit properties stay identical across versions. Use the native supported mechanism or the closest equivalent. If a metric is unavailable, OMIT it — the status line still installs with the supported metrics; installation never fails over a missing metric. A per-metric report states Supported / Not exposed by this Claude Code version.
9. Caveats: the statusLine command is silently skipped when workspace trust is not accepted, and disabled by disableAllHooks — the install report must state these. The boss-cron hook-protection clause of PART 4 is untouched by this issue.
10. Wire-in points: references/progress-visibility.md (the full capability documentation — what the status line is, why Spec Protocol installs it, each metric's meaning, context-health thresholds as INTERNAL doctrine, task tracking, Ctrl+T when supported, claude-nine compatibility, customization, troubleshooting, how to disable, how to restore); SKILL.md carries only the operational requirement (a new step 2.10 Progress Visibility in the setup flow + References item 22 + the compact threshold table); scripts/setup-statusline.sh (new script beside bootstrap-companions.sh, idempotent, name-only output).
11. Validation checklist (mirrors spec §15): Claude Code launches successfully; existing settings intact; status line appears; active model displayed; session cost displayed and computed from real token counts in BOTH launch paths (labeled estimate); session duration when supported; git branch/status inside repos; Project progress visible and derived from CONTROL/project_state.json; Wave progress visible when wave lines exist; context usage NOT displayed to the client (internal doctrine only); 5h/7d usage NOT displayed to the client; task tracking available; plain claude works; claude-nine works; 9Router configuration unchanged; re-running setup creates no duplicates. Do not claim a metric works unless actually observed.
12. Final report (spec §17): Claude Code version detected; claude-nine environment detected; configuration file modified; backup created; status-line implementation used; metrics successfully displayed; unsupported metrics; task-progress functionality; Ctrl+T support; standard Claude Code validation; claude-nine validation; whether both environments share configuration; existing user configuration preserved; idempotency test; remaining manual actions. Never report complete until tested.
13. **Project completion bar — THE MAIN METRIC (operator order 2026-08-16).** The status line shows how close the project is to being DONE. Derivation: `tasks.counts.completed / (pending + in_progress + completed)` read from `$cwd/CONTROL/project_state.json` (schema spec-protocol/project-state@1, references/documents.md) — disk truth only, never conversation memory. Omitted until the state file exists (0% before the plan exists is fake progress). Blocked tasks count in the total. The bar moves on VALIDATION, never on code generation — the counts advance only when tasks complete under the completion law. Repair loops reopen tasks → the bar goes DOWN — truth, not a bug. `run_status` ≠ RUNNING is shown. 100% does not mean shipped — merged at HEAD and verified is the delivery claim.
14. **Wave bar (operator order 2026-08-16).** For wave-shaped runs the status line shows how close the CURRENT wave is to being done: reads `FIX-LEDGER.md` at `$cwd` first, then `$HOME/work-999-setup/FIX-LEDGER.md`; current wave = highest `WAVE <n>` line; percent = that wave's `WF-<n>` lines carrying PASS or DONE divided by its total `WF-<n>` lines. No wave lines → omitted, never guessed. Ledger lines exist only after verification, so the bar inherits the ledger's truthfulness.

**QC.** ONE method: blind critic receives the install report, the settings.json diff (both stores), the status-line script, the live status-line output from BOTH launch paths, and the bar — "detect-first honored (an existing status line was preserved or correctly reported healthy); both stores configured or one shared script referenced from both; the client-facing display shows ONLY what truly matters — model, cost, git, Project, Wave — with every displayed metric actually observed in BOTH launch paths (session cost computed from real token counts × published pricing, labeled as estimate, never invented); context usage and 5h/7d usage are ABSENT from the client display while the agent still tracks and acts on the thresholds; the Project bar derives from CONTROL/project_state.json disk truth (omitted before the state file exists, blocked tasks counted, moves on validation only, can go down on repair, never claims delivery at 100%); the Wave bar derives from FIX-LEDGER.md lines (omitted when absent, PASS/DONE markers only); task list created after the plan, ✓ only after validation, ! shows the blocking reason; Ctrl+T verified live; 9Router routing untouched; re-run idempotent with zero duplicate configuration; 15-item final report complete." PASS = completely exceeds expectation. FAIL = looped (max 20 cycles).

---

## PART 1 — THE QC PROTOCOL (exactly ONE way to QC every item)

This is the single quality-control method. It binds every item in this plan and every work item in any spec-protocol run. There is no second way.

1. **A critic reviews the work.** Every deliverable is judged by a critic agent — never by its builder.
2. **Blind critics (Law 49).** The critic receives ONLY the deliverable and the bar — all provenance stripped: no timestamps, no authorship, no history, no builder identity, no builder reasoning, no effort narrative. The critic compares the work against the bar the way a customer would.
3. **The judge never built the item they judge (Law 7).** No self-QC, ever. Where the platform allows, the critic is a DIFFERENT MODEL from the builder (family rule: strip provider prefix and thinking/version suffixes; same base id = same model = violation).
4. **The bar is concrete (Law 48).** Every item's bar is a named, fetchable, comparable artifact or behavior contract — stated in that item's QC section above. "Good" is not a bar. When no existing product can serve as the bar, the bar = the locked spec's acceptance matrix rendered as BINARY pass/fail answer-key lines — every check line returns pass or fail, never a prose judgment; the critic grades against the answer key exactly as it would against a real product. WHO/WHEN: the lead agent writes the answer key at spec-lock, BEFORE any build dispatch, and it locks with the wave table. WHERE: it lives as a named section of the execution plan (document 16) per Law 39 — no new file. OBJECTIVITY GUARD: every answer-key line must itself be runnable to pass/fail — a line the critic cannot run (e.g. "compelling") is BLOCKED per Law 50 and must be rewritten by the lead before build. EXAMPLE line format: `AK-01: hero section has headline + subhead + CTA -> PASS if all three present, else FAIL.`
5. **PASS = "completely exceeds expectation."** The single pass standard. Not "acceptable", not "meets spec" — the work must completely exceed what the bar demands.
6. **FAIL = looped.** The item returns to the builder WITH THE CRITIC'S EXACT FINDING. Max 20 fix-loop cycles per finding (operator ruling 2026-08-14). After 20: escalation to the operator with the FULL finding history — never a quiet give-up, never a relabeled pass.
7. **The bar wins by default (Law 50).** If the comparison cannot run (bar unreachable, format mismatch, critic cannot render both), the item is BLOCKED, not passed. BLOCKED/INFEASIBLE/LIMIT REACHED are never relabeled PASS.
8. **Repaired visual work gets a NEW blind verifier** — never the previous verifier's judgment reused (Gauntlet WORKFLOW 06 rule).
9. **Release requires the council:** for release-shaped decisions, 4 independent judges, 4/4 = PASS; any FAIL or UNVERIFIED prevents release (Gauntlet WORKFLOW 05 rule).

### CITED AUTHORITIES (executor must have these open)

Laws (one-line):
- Law 39 — closed document list: new content rides in an existing numbered document; no new file without permission.
- Law 44 — reserve: usable = ceiling − reserve (a quarter or two slots, whichever larger).
- Law 48 — concrete bar: every bar is a named, fetchable, comparable artifact or behavior contract.
- Law 49 — blind critics: the critic sees the work, never the effort (no provenance, no builder reasoning).
- Law 50 — the bar wins by default: BLOCKED/INFEASIBLE/LIMIT REACHED are never relabeled PASS.

Reference files (repo skill tree, all exist on disk):
- `.claude/skills/spec-protocol/SKILL.md`
- `references/interview.md`
- `references/funnel-architecture.md`
- `references/capacity.md`
- `references/gauntlet.md`

Purpose: an executor holding only this document can locate every cited authority.

---

## PART 2 — EXECUTION INSTRUCTIONS WITH MAXIMUM PARALLELISM (the locked wave plan)

**Fan-out doctrine for the fix execution:** max 10 agents per workflow — 5 builders + 5 blind critics = pairs of five (each builder paired with its own blind critic). Up to 50 workflows (operator doctrine, not a product limit). Maximum use, no holding back — inside the usable provider number (ceiling − Law 44 reserve), never below what the work allows, never padded past it. Every agent carries: unique responsibility, evidence to inspect or work to perform, explicit deliverable, acceptance criterion.

**THE WAVE PLAN IS LOCKED. Six waves. Additional waves ONLY if one wave depends on another being done first, opened via a documented `NEW-WAVE-N` ledger line naming the dependency.**

| Wave | Issues | Workflows (10 agents each: 5 builders + 5 blind critics) | Dependencies |
|---|---|---|---|
| **WAVE 0** | — | Boss bootstrap (Issue 18 WAVE 0 BOOTSTRAP): interim boss-cron detect-first install + cron entry + one live cycle + `--check` green + `ISSUE-18-EARLY` ledger line. No fix work — the enforcer exists before any wave runs | None — first, always |
| **WAVE 1** | 1 (ultracode revert + persistence), 2 (password 123456) | WF-1A: Issue 1 verification (launcher + skill diff + env sweep + functional relaunch); WF-1B: Issue 2 verification (grep sweep + fresh-provision fingerprint); WF-1C: — | Wave 0 — the boss is already enforcing before Wave 1 dispatches |
| **WAVE 2** | 3 (entry options), 4 (Advanced vs Simple), 11 (count lies), 12 (question sense), 5 (premature research) | WF-2A: Issue 3 entry gate; WF-2B: Issue 4 mode offer + caps; WF-2C: Issue 11 counter enforcement; WF-2D: Issue 12 wording + never-re-ask; WF-2E: Issue 5 RESEARCH-READY gate | Wave 1 (the skill files Wave 2 edits are synced live by Wave 1's mechanism; the interview fixes build on the entry gate existing) |
| **WAVE 3** | 6 (design brief/copy), 7 (image lane), 8 (staged pipeline), 9 (GHL media), 10 (orphan sweep) | WF-3A: Issue 6 design brief + copy bar; WF-3B: Issue 7 manifest + reachability + fail-closed; WF-3C: Issue 8 staged pipeline; WF-3D: Issue 9 GHL upload + URL wiring; WF-3E: Issue 10 1:1:1 accounting | Wave 2 (the website/funnel branch these edit is shaped by the Wave 2 interview gates; the manifest of 7 feeds the pipeline of 8 and the uploads of 9) |
| **WAVE 4** | 13 (anti-drift), 14 (fan-out), 15 (wave lock), 17 (QC protocol), 18 (boss cron) | WF-4A: Issue 13 ledger/anchor enforcement; WF-4B: Issue 14 forced width; WF-4C: Issue 15 wave lock; WF-4D: Issue 17 protocol wiring; WF-4E: Issue 18 boss cron build | Waves 1-3 (the boss enforces the rules Waves 1-3 write; the wave lock must exist before the boss can check it) |
| **WAVE 5** | 16 (unleash table), 19 (gauntlet weave), batch merge | WF-5A: Issue 16 table audit + provisioning guard; WF-5B: Issue 19 six-workflow weave + client adaptation; WF-5C: batch merge (PART 3) — single serial workflow — the merge lands one commit at a time (PART 3); no fan-out, no parallel merges | Waves 1-4 (the gauntlet weave sits on the QC protocol and fan-out doctrine of Wave 4; the merge is last by definition) |
| **WAVE 6** | 20 (progress visibility) | WF-6A: status-line config both stores + shared script + task-progress wiring + validation matrix (5 builders: detect/backup, both-stores config, script authoring, task-progress docs, validation; 5 blind critics) | Wave 5 (sits on the merged skill state from the batch merge; touches settings.json not skill code) |

## PART 2.1 — EXECUTOR MECHANICS

1. Fix-execution ledger path: the boss reads `/Users/blackceomacmini/work-999-setup/FIX-LEDGER.md` (created at wave 1, one line per claim/result; the path is absolute, no per-run invention).
2. Per-workflow working copies: clone command `git clone https://github.com/trevorotts1/999-setup.git` into `/Users/blackceomacmini/work-999-setup-fix/<WF-name>/`. Per-unit branch naming `fix/<issue>-<unit>`. Commit rule: one unit = one commit, message cites the ledger line. Holding-pen path `/Users/blackceomacmini/work-999-setup-fix/<WF-name>/holding/` for passing units awaiting batch merge (PART 3).
3. Launch mechanism for a 10-agent workflow: a command-shaped invocation (`run /<saved-workflow-name>`) per Issue 15 item 4, never free-form. The workflow name is recorded in the ledger line that dispatches it.
4. Sanctioned ledger classes include `PAYMENT-CONTRACT` and `INTERVIEW-MODE` (PART 4 allowlist).

Each workflow's 5 builders take the issue's numbered FIX steps as their slices; the 5 blind critics judge the outputs against the issue's QC bar. The wave table is written to the ledger at wave 1 with immutable count 6.

---

## PART 3 — BATCH MERGE (at the end)

1. All items that PASSED QC merge TOGETHER to `main` and push to origin `github.com/trevorotts1/999-setup.git` (repo `~/work-999-setup`, branch `main`).
2. One batch, one atomic stamp: one version bump + one changelog entry + one annotated tag (`git tag -a`) for the whole batch (Law 10). Clean commits — no Co-Authored-By trailers.
3. Serialized landing: each unit lands serially with `--no-ff` into the integration branch; the full verification suite runs ONCE per batch; fast-forward the trunk; then the ripple in the same commit.
4. Post-merge artifact check: done means MERGED (the merge commit is a proven ancestor of remote `main`) AND verified at HEAD (`git cat-file -e HEAD:<path>` for each key artifact + QC re-run at HEAD passes). Landed is not merged.
5. Backup before the merge: a pre-merge snapshot branch (e.g. `backup/pre-master-fix-20260815`) pushed to origin first, its name stated in the same message as the merge.
6. Nothing merges that did not PASS. A failed item stays in its loop; it never rides the batch.

---

## PART 4 — CRON/BOSS ENFORCEMENT DESIGN

**The boss is a cron cycle, every 5 minutes, comparing the live ledger against the script. It has stop-and-restart authority.**

### Checks per cycle

1. **Scope check:** any ledger item not in the 20-list AND not matching a sanctioned line-class = violation. Sanctioned line-class allowlist: `FUNNEL-*`, `3JS-*`, `STAGE-*`, `MOBBIN-CHECK`, `DESIGN-BRIEF`, `ENTRY-MODE`, `BUILD-TARGET`, `INPUT-CAPTURED`, `STATUSLINE-*`, `NEW-WAVE-N`, `VIOLATION-STOP`, `BOSSCYCLE-CLEAN`, `AK-*`, `PAYMENT-CONTRACT`, `INTERVIEW-MODE`, `ISSUE-18-EARLY` (the Wave 0 bootstrap line, Issue 18 WAVE 0 BOOTSTRAP), `REPAIR`, `REPAIR-DONE`, `DONE`, `FAIL`, `PASS`, `UNDETERMINED`, `OBSERVATION`, `REDISPATCH`, `BUILDER`, `BUILDER-DONE`, `BUILDER-FAIL`, `CRITIC`, `CRITIC-PASS`, `CRITIC-FAIL`, `DISPATCH`, `BASELINE`, `CREATED` (the executor mechanics already in use at run start).
2. **Wave check:** any wave in the ledger not in the locked table (PART 2) without a `NEW-WAVE-N` dependency line = violation.
3. **Count check:** promised vs asked question counts — any "Question N of … C" with N > stated C and no prior correction line = violation.
4. **Width check:** fan-out below scripted width (10 per workflow, pairs of five; up to 50 workflows — operator doctrine, not a product limit) without a recorded dependency line = violation. Padding past the work = violation.
5. **Claim check:** any final-report claim without its ledger lines = violation.
6. **Drift check:** > 10 consecutive contentless heartbeat ticks = violation; a missing `anchor.sh --mode reconcile` at a wave boundary/tick/compaction = violation.
7. **Orphan check (media):** generated ≠ manifest ≠ uploaded ≠ referenced counts = violation.
8. **Statusline check:** statusLine key present in both settings stores (name-only check, never reading values) after Wave 6 = clean; missing after Wave 6 without a `STATUSLINE-REMOVED-<reason>` ledger line = violation.

### On violation

Immediately STOP the violating workstream (no further dispatches on it), mark the ledger `VIOLATION-STOP` with the exact finding, and RESTART the workstream from the last clean checkpoint recorded in project_state.json. The restart re-runs until done the required way — the loop bound is the QC protocol's 20 cycles per finding, then escalation with full history.

### On clean

Write `BOSSCYCLE-CLEAN` with the timestamp and the checks run.

### The boss is governed too

A heartbeat alert fires if the cron itself fails (no `BOSSCYCLE-*` line within two intervals → alert through the operator's Telegram bot chat id (wired channel)). The boss's own log is a ledger the next cycle reads.

**Hook-protection clause (sourced, https://code.claude.com/docs):** the boss and the governance hooks live in settings.json hooks. `disableAllHooks` must NEVER be set on the operator box — it kills every user and project hook, including the boss-cron and stop-guards. Blocking hooks block ONLY on exit code 2 (exit 1 is non-blocking) — every governance hook exits 2 when it must stop a workstream and 0 otherwise. No fix in this plan may remove, disable, or weaken a governance hook; the boss's own cron entry is never removed or disabled by any workstream.

### Packaging

Installable as a script + cron entry:
- Script: `boss-cron` (checks 1-8 above, ledger parser, stop/restart issuer).
- Cron entry: `*/5 * * * * /Users/blackceomacmini/work-999-setup/tools/boss-cron` (absolute install path; the install step copies the script to that path).
- On-demand test: `boss-cron --check` runs exactly one cycle immediately and prints the verdict.

---

## PART 5 — VERIFICATION RULES (binding on every fix, every report)

1. **Verify before reporting.** No "done" without independent proof — a run, a diff, a live call. A subagent's claim is a claim, not evidence.
2. **Known-good control on any negative result.** Same transport, same shell mode, same host, answer known non-empty. If the control also comes back negative, the CHECK is broken, not the target. Name the sources checked and what was not checked. UNDETERMINED is a correct answer — always better than a confident zero.
3. **Exit-code failure ≠ empty result.** `127` is a shell abort — unresolvable command or interpreter — never a fact about what a system has. `grep` rc≥2 = error, not zero matches. Capture stderr (`2>&1`), check `$?`, `set -o pipefail`.
4. **Backup before every write, with the backup path stated in the same message.** The operator must always be one command from their own state. Never overwrite an existing backup.
5. **Prove a negative the way you'd prove a positive.** "Unreachable" requires a failed connection attempt. "Not installed" requires running it. "No rows" requires the query returning from a store you proved you can read.

---

## PART 6 — FUSION BACKGROUND (NOT on the list, NOT in QC)

Background only: the operator runs this master plan through 9Router fusion. Fusion is a COMBO STRATEGY, not a standalone setting — shape `settings.comboStrategies {fallbackStrategy: "fusion", judgeModel: <model>, fusionTuning: {minPanel: 2, stragglerGraceMs: 8000, panelHardTimeoutMs: 90000}}`; panel models are queried in parallel and the judge model picks the result; without `judgeModel` it falls back to the first panel model; ENABLE = route a lane to the combo's name (sources: repo `references/nine-router-api.md` lines 99-110, 211-220, 297-299; https://github.com/decolua/9router — combos documented as the auto-fallback model combination strategy; the word "fusion" is not in the GitHub README). The repo installer wires a DIFFERENT combo name: `fusion-chain` with `{fallbackStrategy: "fusion", judgeModel: ds/deepseek-v4-pro-max}` (configure-nine-router.mjs lines 462, 557) (`configure-nine-router.mjs` lines 520-527 (fusionModels), 527 (upsertCombo), 551-556 (comboStrategies)). On the operator box fusion is ALREADY LIVE: `~/.claude-nine/settings.json` modelOverrides maps `claude-fable-5` → `fusion-coding`; the live operator combo is `fusion-coding` — keep `fusion-chain` and `fusion-coding` distinct — and the live `fusion-coding` combo panels are `openrouter/moonshotai/kimi-k3`, `grok-max/x-ai/grok-4.6`, `openrouter/qwen/qwen3.8-max` with judge `dspro-max/deepseek-v4-pro` (live DB read 2026-08-16) — this session itself runs model `fusion-coding`. FUSION IS NOT ON THE LIST. It carries no fix item, no QC section, and no wave. This paragraph exists so the executor knows the plan's review path; it authorizes no work.

---

## PART 6.5 — COMPANION SKILLS (source-locked registry, detect-first install)

**Weaves into spec-protocol: four companion capabilities + the MCP trio (Supabase/GitHub/Vercel), one authoritative source registry, one idempotent bootstrap.** Not a fix item — a capability contract that ships WITH spec-protocol and installs with it when missing.

1. **Authoritative sources ONLY** (`references/dependency-sources.md` — this file IS the registry): Frontend Design from `https://github.com/anthropics/claude-plugins-official` (plugin dir `plugins/frontend-design`); UI/UX Pro Max from `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`; Supabase from `https://github.com/supabase/agent-skills` (skills) + `https://github.com/supabase-community/supabase-plugin` (plugin); Supabase MCP from `https://mcp.supabase.com/mcp` (docs `https://supabase.com/docs/guides/getting-started/mcp`; OAuth, no PAT); GitHub MCP from `https://github.com/github/github-mcp-server` hosted at `https://api.githubcopilot.com/mcp/` (OAuth default; PAT optional and takes precedence — never stored in the repository); Vercel MCP from `https://vercel.com/docs/cli/mcp` hosted at `https://mcp.vercel.com` (via `vercel mcp --clients "Claude Code"` or `npx plugins add vercel/vercel-plugin`; `--clients` REQUIRED non-interactively); Kie.ai PRIMARY image/video (`https://kie.ai/`, API `https://api.kie.ai`) — do not replace the existing Kie.ai implementation; Agnes AI APPROVED ALTERNATIVE (`https://agnes-ai.com/`, API `https://apihub.agnes-ai.com/v1`) — never require both providers, never auto-create a paid subscription; Higgsfield NOT mandatory — never auto-install; Claude Code repo `https://github.com/anthropics/claude-code`. Prohibited logic: "search GitHub for frontend design skill" — explicit approved sources only. A registry URL unavailable → STOP and report; never substitute.
2. **Detect first, always** (`scripts/bootstrap-companions.sh`): `command -v uipro`; `~/.claude/skills/` (dirs AND symlinks); project `.claude/skills/`; `claude` plugin registries (`~/.claude/plugins/installed_plugins.json` nested `plugins` map, `known_marketplaces.json`); MCP entries in `~/.claude.json` (user scope), `~/.claude-nine/.claude.json`, project `.mcp.json`, AND project-scoped nested entries (`.projects/<path>/mcpServers` in both stores — `claude mcp add --scope project` writes there). Installed = discovery succeeds — a directory alone is not proof. Status per dependency: Installed / Already Installed / Failed; Supabase adds Authentication Required. `claude mcp add` exiting 1 with an existing entry = Already Installed, never Failed.
3. **Install only what detection says is missing**: `/plugin install frontend-design@claude-plugins-official` (verify the installed Claude Code's plugin syntax first); `npx ui-ux-pro-max-cli init --ai claude` (executable `uipro`; CLI not on PATH after npx — `npx ui-ux-pro-max-cli` or global install); `npx skills add supabase/agent-skills`; `npx plugins add supabase-community/supabase-plugin` (the open-plugins installer prompts interactively — answer it, never hang headless); Supabase MCP via the official flow (`https://supabase.com/docs/guides/ai-tools/plugins`).
4. **claude-nine / 9Router compatibility (install-once rule)**: inspect whether `claude` and `claude-nine` share `~/.claude/`. Shared → install each skill ONCE, validate BOTH launch paths. Separate claude-nine config dir (its own `.claude.json`) → MCP servers must be registered in BOTH stores — a server in only `~/.claude.json` is invisible to a claude-nine session (verified on the operator box 2026-08-15: Mobbin MCP was then registered only in `~/.claude.json`; it has since been added to the claude-nine store — the both-stores rule stands). MCP servers load at session start — a running session never sees a later registration. DO NOT modify 9Router model-routing rules merely to make a skill available.
5. **Idempotency**: safe to run repeatedly; re-runs detect, install nothing already installed, no duplicate installs. Expected re-run output: `✓ Installed and healthy` + `Source verified: <org/repo>` per dependency.
6. **12-item installation report** at the end of every bootstrap: capability, exact repository URL, version when available, installation location, installation method, Claude Code discovery status, claude-nine discovery status, Supabase MCP status, Supabase authentication status, Kie.ai configuration status, Agnes AI configuration status, manual client actions. Every installed third-party dependency MUST include its exact source URL.
7. **Supabase client onboarding** (client lacks Supabase): send them to `https://supabase.com/dashboard` — account, organization, project, Free plan when sufficient, save the database password, wait for provisioning; credentials via Project → Connect or Project Settings → API Keys (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_*`; publishable keys begin `sb_publishable_`, secrets `sb_secret_`). NEVER put a secret key in browser/client code, Git, SKILL.md, CLAUDE.md, public config, screenshots, or logs. Prefer OAuth/browser auth for Supabase MCP over asking the client to paste credentials into AI chat.
8. **Where it lives**: `references/dependency-sources.md` (the registry), `references/companion-skills.md` (the lifecycle contract), `scripts/bootstrap-companions.sh` (the installer — wet-run on the operator box 2026-08-16: 6 ok, 0 failed; remaining warnings were true findings: GitHub MCP absent from the claude-nine store (supabase and mobbin ARE present there), uipro not global).

---

## PART 6.6 — PROGRESS VISIBILITY (status-line + task-progress capability contract)

**The watchable-swarm contract: a persistent status line + live task progress, installed detect-first and idempotently, working in BOTH plain claude and claude-nine.** Not a fix item — a capability contract that ships WITH spec-protocol and installs with it when missing (Issue 20).

1. **What installs**: one shared `~/.claude/statusline-command.sh` script (recommended single source, referenced by both stores); a `statusLine` settings key of shape `{"type":"command","command":"<script>","padding":<opt>,"refreshInterval":<opt>,"hideVimModeIndicator":<opt>}` in BOTH `~/.claude/settings.json` and `~/.claude-nine/settings.json` (separate stores — verified; the skills symlink farm does NOT cover settings.json). Native preferred: `/statusline` (supported at runtime in 2.1.227, NOT listed in `claude --help` — detect at runtime, never assume). Preferred display — the CLIENT sees only what truly matters (operator order 2026-08-16): `model | session cost (~-labeled, derived) | git branch + status | Project ████░░░░░░ NN% | Wave N ██░░░░░░░░ NN%` — context usage and 5h/7d usage are INTERNAL doctrine, never client display. Acceptance: the bar verified live in BOTH launch paths — plain claude AND claude-nine — via the same shared script.
2. **Detect-first, never destroy** (spec §2): inspect both stores before writing. Existing status line equal or better → report "Already configured and healthy. No replacement required." Enhanceable → preserve its behavior, add only missing information. Backup every settings file before modifying. Idempotent — re-run creates no duplicates. Never replace an entire settings file to add one key.
3. **Metric support matrix** (verified against the statusLine stdin JSON schema in the 2.1.227 binary): DISPLAYED — model.display_name; session cost REQUIRED — absent from stdin schema (binary internals costUSD/totalCostUSD and /api/oauth/usage exist but are not wired to the statusLine stdin); derived from the real token counts stdin exposes × published per-model pricing, displayed with `~`, never invented; proven live in both launch paths by Wave 6; git branch/status via shell from cwd (stdin has no branch field); Project progress (item 5b) and Wave progress (item 5c). INTERNAL ONLY — never client display (operator order 2026-08-16): context_window.used_percentage/remaining_percentage (still read — the token counts feed the cost derivation) and rate_limits.five_hour/seven_day (subscribers only; under claude-nine/9Router sessions expected absent). Session duration UNDETERMINED — absent from stdin, omit (script-side start-time file is a permitted DIY extension). Unavailable metric = omitted metric, installation still proceeds (spec §14).
4. **Context-health thresholds — INTERNAL doctrine, never client display** (operator order 2026-08-16; full behavior in references/progress-visibility.md): Normal 0-69% — continue normally. Elevated 70-84% — verify task list, persist architectural decisions to project files, never keep critical information only in context. High 85-94% — persist implementation state, update docs, update task state, record unresolved issues, preserve decisions, prepare for compaction. Critical 95%+ — persist state BEFORE any new large phase; continuity, not premature stopping. Display and awareness are separate — the client is not shown context; the agent never stops tracking it.
5. **Task progress** (spec §4-9): task list created after the plan exists, never fake busywork tasks; ✓ Complete (only after validation), ● In Progress, ○ Pending, ! Blocked with the specific reason; phases 01 Discovery–10 Deployment, only applicable ones, subtasks underneath; companion skills (Frontend Design, UI/UX Pro Max, Supabase, Kie.ai, Agnes AI) reflected when used, never displayed when not. Ctrl+T (`app:toggleTodos`, Global binding) toggles the display — explain this to the client in plain English during setup.
5b. **Project completion bar — THE MAIN METRIC (operator order 2026-08-16).** The status line shows how close the project is to being DONE: `tasks.counts.completed / (pending + in_progress + completed)` read from `$cwd/CONTROL/project_state.json` — disk truth only. Omitted until the state file exists; blocked tasks count in the total; moves on validation only; can go DOWN on repair loops; `run_status` ≠ RUNNING shown; 100% never claims delivery.
5c. **Wave bar (operator order 2026-08-16).** The status line shows how close the CURRENT wave is to being done: reads `FIX-LEDGER.md` ($cwd first, then `$HOME/work-999-setup/FIX-LEDGER.md`); current wave = highest `WAVE <n>` line; percent = that wave's `WF-<n>` lines with PASS/DONE markers divided by its total `WF-<n>` lines. No wave lines → omitted, never guessed.
6. **Caveats**: workspace trust not accepted → statusLine silently skipped; `disableAllHooks` → statusLine disabled (never set it on the operator box — PART 4). Safe mode shows only the managed/policy status line.
7. **Validation + report**: the Issue 20 validation checklist (both launch paths, metric truthfulness, 9Router untouched, idempotency) and the 15-item final report (spec §17). Never report complete until tested.
8. **Where it lives**: `references/progress-visibility.md` (full capability documentation — metrics, thresholds, troubleshooting, disable/restore), SKILL.md step 2.10 + References item 22 + compact threshold table (operational only — spec §16), `scripts/setup-statusline.sh` (idempotent installer beside bootstrap-companions.sh).

---

## PART 7 — DELIVERABLE CONTRACT

1. This document, full path: `/Users/blackceomacmini/Downloads/999-master-fix-spec-20260815.md`.
2. All 20 issues, each with PROBLEM / WHY / FIX / QC — PART 0.
3. Exactly one QC method for every item — PART 1.
4. The locked 6-wave plan — PART 2.
5. The batch merge — PART 3.
6. The boss cron design — PART 4.
7. The binding verification rules — PART 5.
8. Fusion marked off-list — PART 6.
9. Progress Visibility capability contract — PART 6.6.
