# WF-4B slice 4 evidence — Issue 14 FIX step 4: provider ceilings (ceiling arithmetic, usable rule, dispatch citation)

Wave: WAVE 4, WF-4B (Issue 14 fan-out). Branch: fix/14-fanout.
Slice: FIX step 4 — "Provider ceilings are ceilings, never targets: DeepSeek v4 Flash 2500 concurrent, v4 Pro 500 — per-account limits from the official DeepSeek docs (https://api-docs.deepseek.com/quick_start/rate_limit); exceeding them returns HTTP 429. 9Router itself enforces NO per-model concurrency cap (verified by fetching the 9Router source, https://github.com/decolua/9router — it carries only multi-account round-robin/priority fallback), so the ceiling arithmetic is provider-side plus the Claude Code product caps (16 concurrent agents / 1000 total per workflow run — hard-coded, no setting raises them). Usable = ceiling − reserve (a quarter or two slots, whichever larger, Law 44); the Capacity Ledger computes the governing number and every dispatch cites it."
Ledger line cited: `WAVE 4 DISPATCH 2026-08-16T20:12Z` (real ledger /Users/blackceomacmini/work-999-setup/FIX-LEDGER.md line 70, read this unit).

## Spec citation (authoritative text)

- 999-master-fix-spec-20260815.md line 308 (Issue 14 FIX step 4) — quoted verbatim above.
- Spec line 311 (Issue 14 QC bar): "dispatched width equals the ledger's governing number (or a documented dependency says otherwise); every agent has the four required properties; pairs of five per workflow."
- Spec line 305 (FIX step 1, context): max 10 agents per workflow, max 50 workflows.

## Live verification of the spec's sources (both fetched this unit, 2026-08-16)

1. **DeepSeek rate-limit docs** (https://api-docs.deepseek.com/quick_start/rate_limit, WebFetch):
   - Concurrency limits per account: `deepseek-v4-flash: 2500`, `deepseek-v4-pro: 500` — matches spec numbers exactly.
   - Verbatim on exceed: *"when the concurrency limit is exceeded, you will receive an HTTP 429 error code"*.
   - Limits are per ACCOUNT (regardless of which API key); one request = one concurrent connection from send until response completes.
2. **9Router source** (https://github.com/decolua/9router, WebFetch): no per-model or per-provider concurrency limit, no queueing, no max-concurrent anywhere in the docs. Only routing features: multi-account round-robin, priority fallback, 3-tier fallback (Subscription→Cheap→Free), auto-fallback on quota/error. Confirms the spec's claim that 9Router enforces NO concurrency cap.
3. **Claude Code product caps** — already sourced in capacity.md §3: AXIS 1 carries min(16, cores−2) per workflow; AXIS 2 carries the Workflow tool's documented 1,000-agents-lifetime cap per workflow run (code.claude.com/docs/en/sub-agents, fetched 2026-08-12). Both are hard-coded; no setting raises them (spec line 358: "Workflow runtime caps — 16 concurrent agents per run + 1,000 total per run — HARD-CODED — no setting raises them").

## Defect found (full-file read of the touched sections, not grep)

capacity.md already carried the ceiling NUMBERS (2,500 / 500, §2 table, from the operator's 2026-08-11 ruling) and the reserve rule (25% default, two-slot floor, Law 44) — slices 1-2 and prior doctrine put them there. What FIX step 4 requires but was MISSING:

1. **No source attribution on the DeepSeek rows** — the numbers stood on the operator ruling alone, no `[RESEARCHED <url> <date>]` mark, despite the file's own provenance contract (line 21: "Never recite a number from memory"; §4 template line 328: `source: [researched <url> <date>]`).
2. **No 429 consequence anywhere in §2** — 429 appears only in §4-6 mechanics, never tied to the DeepSeek ceilings.
3. **No never-targets statement** — nothing forbade treating the ceiling as a fill-line.
4. **No 9Router no-cap verification** — the router's absence of enforcement was unstated, so the ceiling arithmetic's boundaries were undocumented.
5. **No hard-coded statement on the product caps** — AXIS 1 said "min(16, cores−2)" with no note that the 16 is hard-coded and no setting raises it.
6. **No "whichever larger" phrasing** on the reserve — spec's exact rule ("a quarter or two slots, whichever larger") appeared as two separate clauses (25% default at line 105, two-slot floor at line 106) but never as one formula.
7. **Dispatch-citation requirement weak** — the §4 gate ("every dispatch names the ledger line it derives from") did not require citing the GOVERNING NUMBER nor forbid citing a raw ceiling.

## Change applied (one unit, one file)

File: `.claude/skills/spec-protocol/references/capacity.md` (WF-4B working copy, branch fix/14-fanout). Five edits, all in capacity.md's own voice and structure:

| Site | Before | After |
|---|---|---|
| §2 table, DeepSeek rows | "2,500 concurrent subagents" / "500 concurrent subagents" — no source mark | "2,500 concurrent requests per account [[RESEARCHED](https://api-docs.deepseek.com/quick_start/rate_limit) 2026-08-16]" / "500 concurrent requests per account [RESEARCHED same page 2026-08-16]" |
| §2 after supersession note | (nothing) | New BINDING block "CEILINGS ARE CEILINGS, NEVER TARGETS (2026-08-16, Issue 14 FIX step 4)": 429 verbatim quote, per-account + send-to-complete slot semantics, 9Router no-cap verified (source fetched 2026-08-16), product caps 16/1,000 HARD-CODED no setting raises them, raw ceiling never the governing number on its own |
| §2 reserve paragraph | "Twenty-five percent is the default reserve; two free slots is the floor on small plans." | Adds: "**Usable = ceiling − reserve, where the reserve is a quarter of the ceiling or two slots, WHICHEVER IS LARGER**" |
| §3 AXIS 1 | "Per-workflow concurrency = **min(16, cores−2)**." with no attribution | Adds the hard-coded statement: the 16 is the product's per-workflow concurrent-agent cap, no setting raises it; `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` only moves the session-subagent limiter (ultracode-exempt), never the workflow-run cap |
| §4 gate | "Every dispatch names the ledger line it derives from." | Adds: dispatch "cites the GOVERNING NUMBER the ledger computed — never a raw provider ceiling, never a recalled figure"; citing no ledger OR citing a raw ceiling as width basis = swarm-watch defect |

Line numbers (post-edit, read-back): table rows L81-82; never-targets block L94-113; reserve formula L124-127; AXIS 1 hard-coded note L149-153; gate L432-437.

## Verification

- `git diff` against HEAD: exactly the five hunks above, +35/−5, no other content touched, no other file modified (working tree otherwise clean at base).
- Numbers unchanged: 2,500 / 500 / 1,875 / 375 intact; only attribution, consequence, and doctrine added.
- Consistency with sibling slices (checked, not duplicated): slice 1 owns the 30→50 doctrine; slice 2 owns the forced-width rule + four properties in SKILL.md; slice 3 owns tools/boss-cron; slice 5 owns verification manifests. This slice touches none of those.
- No contradiction with SKILL.md RULE 2 (read this unit): RULE 2's ceiling arithmetic paragraph (SKILL.md lines 99-103) already says "Every dispatch cites the Capacity Ledger's computed number — never a raw provider cap" — the §4 gate now says the same thing with the same severity. No edit needed in SKILL.md; the dispatch-citation requirement lives in both files.
- Backup made before edits: `holding/capacity.md.bak-pre-slice4-provider-ceilings` (102,122 bytes; git hash-object e1afb6a36a235e327956ae27d021bad6972f41d6 == `git rev-parse HEAD:.claude/skills/spec-protocol/references/capacity.md`, byte-identical to the pre-edit file).

## Scope discipline

Touched ONLY `.claude/skills/spec-protocol/references/capacity.md`. Slice 1's out-of-scope list (stale 30/16 doctrine in agent-team.md, gauntlet.md, interview.md, pipeline.md, terminals.md, worked-example.md, tools/capacity-resolver.sh) remains owned by the conductor's post-wave sweep, not this slice.
