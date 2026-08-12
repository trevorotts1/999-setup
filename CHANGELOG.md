# Changelog

## [1.2.5] — 2026-08-12

### Correcting 1.2.4 — the Gate-3 critic seat should never have named an alias at all

- **1.2.4's `Fable` pin was incorrect, on two independent counts.** 1.2.4 fixed a real defect
  — the blind comparative critic shared the builder's `Opus` alias — but it fixed it by moving
  the seat onto `Fable`, and `Fable` was the wrong destination. First, on the standard wiring
  this repository's own installer writes
  (`.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs`), the `fable`
  route carries the fusion combo; pinning the critic there commandeers the combo slot for a
  read-only reviewer. Second, `Fable` is already the QC and fixer seat in this skill's own role
  tables, so 1.2.4 made the blind critic share an alias with the agent that FIXES the code it
  later reviews. Neither was caught because the change reasoned about alias NAMES instead of
  resolving them.
- **The deeper error was naming a slot at all.** It is the same mistake as the older
  "`opus` → v4 Pro" block this project already removed: encoding a specific alias instead of
  stating the requirement. The operator rewires between projects, and any hardcoded seat goes
  stale the moment he does.
- **The Gate-3 critic is now a runtime-resolved requirement, not an assignment.** Both role
  tables — the Claude-Nine table in `SKILL.md` and the matching role list in
  `references/interview.md` — state the rule and the selection procedure instead of a name: the
  critic MUST resolve to a different underlying model than the builder; a different alias NAME
  proves nothing, so RESOLVED models are compared at run time; and the preference is expressed
  by PROPERTY — a different provider or model family beats merely a different thinking level on
  the same base model, because a thinking level is not a second lineage and a same-lineage
  reviewer inherits the builder's blind spots.
- **The candidate pool is not the alias set.** Aliases are a convenience layer, not a boundary.
  A live probe against a running 9Router confirmed it: models bound to no alias route at all
  answered normally, while a nonsense model id returned nothing — so the positives are real and
  the instrument discriminates. Independence is therefore normally easy to satisfy, and the
  skill now says so. Under a router, "no independent model available" is a DISCOVERY FAILURE to
  be surfaced and repaired, never an empty pool. On regular Claude Code with no router the pool
  genuinely is the Anthropic models available to that session, and the skill falls back to what
  it can prove it has and says so.
- **`fable` is no longer recommended — only permitted after a check.** It may be considered
  only where, on the box in question, it is neither holding a fusion combo nor serving as the
  fixer seat. If either is true it is not available.
- **A reasoning-model critic needs token headroom.** On a small budget a reasoning model can
  spend the entire allowance thinking and return empty text with `stop_reason: max_tokens`,
  which reads as a dead seat and is not one. Both role entries now say so.
- **Correcting forward, not rewriting.** 1.2.4 stays in history and in this changelog; nothing
  was force-pushed, rebased or reverted. This entry supersedes its `Fable` recommendation.
- **Deliberately unchanged.** The builder's `Opus` assignment and the technical and release
  judge's `Sonnet` assignment both stand — the operator's decisions, not reopened. Every
  concurrency ceiling is untouched, proved by a line-number-independent census keyed on file and
  value, tokenised before filtering so a comma-grouped ceiling can never be miscounted as a
  shorter one; the differ itself was proved by planting a change in a throwaway copy and
  confirming it was caught, and by diffing an unmodified copy and confirming it came back clean.
  `references/gauntlet.md` is byte-identical — §13's six-workflow topology and §14's canonical
  loop with all 19 stations. `tools/ledger.sh` is byte-identical. `tools/anchor.sh --selftest`
  passes 7 of 7 and `tools/capacity-resolver.sh --selftest` passes, both exiting 0.

## [1.2.4] — 2026-08-12

### Gate 3's blind comparative critic was grading its own homework

- **The critic and the builder resolved to the same model.** The Gauntlet's Gate-3
  comparative critic exists to deliver a blind A/B verdict against the frozen bar, and the
  skill states the governing rule in two places already — `references/pipeline.md` ("a
  fresh-context critic on a DIFFERENT model from the builder and the judge") and
  `references/interview.md` ("VERIFY the builder, judge, and comparative-critic seats resolve
  to different underlying models — different alias names prove nothing"). Both role tables
  nevertheless assigned the critic seat the **same `Opus` alias as the builder seat**. Since
  1.2.2 moved the builder to `Opus` deliberately — the stronger model, the higher concurrency
  ceiling — the two seats collapsed onto one alias, and on any wiring where that alias
  resolves to a single model the critic was reviewing its own output. A critic on the
  builder's model is not blind; it is grading its own homework, and it fails the exact rule
  the surrounding paragraphs spend two sentences insisting on.
- **The Gate-3 comparative critic now defaults to the `Fable` alias**, in both role tables:
  the Claude-Nine table in `SKILL.md` and the matching role list in `references/interview.md`.
- **Why `Fable`, and why the criterion is model FAMILY rather than model name.** Independence
  is not achieved by a different label, and it is only partly achieved by a different model —
  two models of the same lineage, trained on overlapping data with overlapping methods, share
  their blind spots and will miss the same defect in unison. `Fable` is the remaining seat
  most likely to resolve to a different model family than the builder's alias, which is what
  makes it the most genuinely independent reviewer the alias layer can offer. `Sonnet` was
  unavailable: it is already the technical and release judge seat, and reusing it would
  collapse the critic and the judge into one model, trading one blindness for another.
  `Haiku` is too light to carry a comparative verdict against a frozen external bar.
- **These remain recommendations expressed through the alias layer, resolved at run time.**
  Nothing here asserts what any particular box has wired, and no role is pinned to a raw model
  id. The row still instructs the operator to read the current wiring and report it, and both
  edits carry the standing obligation forward: confirm at run time that the critic's alias
  resolves to a different underlying model than the builder's, because on a router two aliases
  can resolve to the same model.
- **Deliberately unchanged.** The builder's `Opus` assignment and the judge's `Sonnet`
  assignment from 1.2.2 both stand. Every concurrency ceiling is untouched — 2,500 / 500 /
  1,875 / 375 verified identical before and after by a line-number-independent census keyed on
  file and value. `references/gauntlet.md` §13 assigns the planner, builder, blind visual
  judge, technical judge and release judge seats but never the Gate-3 comparative critic, so
  the six-workflow topology needed no edit; §14's canonical loop still carries all 19 stations.
  A skill-wide wrap-tolerant sweep confirmed these two role tables are the only places any
  alias is assigned to the critic seat — the remaining mentions in `pipeline.md`, `loops.md`
  and `gauntlet.md` concern budget and topology and name no alias. `tools/anchor.sh
  --selftest` passes 7 of 7 and `tools/capacity-resolver.sh --selftest` passes, unchanged.

## [1.2.3] — 2026-08-12

### Fresh-clone install blocker — the orchestrator could not execute at all

- **Every shell script in this repository was tracked mode `100644`** — non-executable. A
  fresh `git clone` therefore landed an installer that could not be run at all:
  `AGENT_INSTALL.md`, `SKILL.md`, and `CLAUDE.md` all direct the agent to run
  `scripts/setup-macos.sh` directly, and doing so died instantly with `permission denied`
  before a single line of the script executed. Seven further helper invocations inside
  `setup-macos.sh` would have failed the same way. Reproduced on a clean clone of `main` at
  `21e1aac`: exit code **126**, which is the shell's "found but not executable" — not a
  missing file, and not anything the script itself reported.
- **Fixed on both axes, deliberately.** Ten files are now tracked `100755` — the macOS
  orchestrator, all six of its `scripts/macos/` helpers, `tests/macos/verify-macos.sh`, and
  both macOS launchers — so a plain clone lands them executable. Independently, all seven
  direct helper invocations inside `setup-macos.sh` now carry an explicit `bash` prefix,
  matching the pattern the Agent Teams call already used. The two halves cover different
  failures: the mode bit fixes the entry points that nothing inside the repository can reach,
  and the `bash` prefix keeps the internal calls working even when a delivery path strips the
  mode bit — a GitHub source `.zip`, a copy across an exFAT/SMB volume, an extraction under a
  restrictive umask, or a clone with `core.fileMode=false`.
- **The `.mjs` helpers stay `100644` on purpose.** Every invocation of them — in both
  orchestrators and in `tests/README.md` — passes them to `node` explicitly; none depends on
  the shebang, so an exec bit there would be decoration.
- **Windows is unaffected.** `setup-windows.ps1` invokes `.ps1` files through PowerShell,
  which has no executable bit. No `.ps1`, no `.cmd`, and no Windows launcher was modified,
  and no mode on any of them changed.
- **`launchers/macos/claude-nine` was `100644` too** — harmless in practice, because
  `install-claude-nine.sh` places it with `install -m 700`, which sets the destination mode
  outright regardless of the source. Corrected anyway, so the repository copy is runnable
  where it sits.

### `claude-codex` now ships and installs

- **The macOS launcher set gains `claude-codex`** — `claude-nine` pinned to
  `cx/gpt-5.6-sol(high)` with `--autocompact 350k`. `install-claude-nine.sh` installs it
  alongside `claude-nine` at `$HOME/.local/bin/claude-codex` (mode 700), and `setup-macos.sh`
  passes its source path exactly the way it passes `claude-nine`'s. Idempotent by
  construction: `install -m 700` overwrites with the same bytes and sets the destination mode
  outright, so a rerun changes nothing. A missing source is reported and skipped, never fatal
  — `claude-nine` is the launcher this setup actually provisions routes for.
- **Supersedes the 1.2.0 residual-risk note** recording that this repository ships no
  `claude-codex` launcher. It ships one now.
- **Why the 350K window, preserved in the launcher's own header** — 9Router reports
  `cx/gpt-5.6-sol` with a 372,000-token context window. Claude Code has no per-model context
  setting; the ceiling it believes it has is a single global value for the whole profile. A
  Codex session inheriting a ceiling larger than its own waits for a compaction trigger that
  can never arrive, hits the 372K wall, and dies with no compaction having run.
  `--autocompact` is per **launch**, so it supplies the per-model behaviour the global setting
  cannot — and 350K leaves ~22K of slack, because compaction itself has to send the
  conversation up to summarise it, so triggering flush against the ceiling makes the cleanup
  the thing that fails. The header carries the ceiling table for the other Codex models
  (`gpt-5.5`/`gpt-5.4` at 400K, `gpt-5.6-terra`/`-luna` at 272K) so the model and the window
  are always changed together.
- **It resolves `claude-nine` instead of hardcoding a path** — `$CLAUDE_NINE_BINARY`, then
  `PATH`, then `$HOME/.local/bin/claude-nine`: the same override → PATH → known-location order
  `claude-nine` itself uses to find `9router`. It refuses to run when that resolves back to
  itself, so a bad symlink or a misnamed copy fails with one readable line instead of
  recursing until the process table fills.
- **It requires a `cx/` provider that this setup does not wire.** The orchestrator wires
  DeepSeek Direct, Ollama Cloud, Agnes AI and optionally OpenRouter. The completion report
  reports `INSTALLED` from a real filesystem check and names the missing prerequisite beside
  it; the launcher is deliberately **not** smoke-tested end to end the way `claude-nine` is,
  because there is no provisioned route to test it against and a green line there would be a
  claim nothing proved.

### Repository hygiene

- **A junk file is gone from the repository root** — a tracked, 0-byte file whose 115-byte
  name was the tail of a Python one-liner swallowed by a stray shell redirect
  (`,sorted(v.keys()) … isinstance(v,dict)]\" 2>&1`, plus an embedded newline and a trailing
  quote). It reached a public repository by accident. Its blob was git's canonical empty blob
  `e69de29`, and nothing in the repository referenced it. **Exactly one file was removed**:
  the tracked file count went 68 → 67, and it was both the only tracked path in the
  repository containing shell metacharacters and the only 0-byte tracked file. No sibling
  junk of the same origin exists.

### Known residual risks (accepted, documented)

- **A Windows `claude-codex` is UNDETERMINED** — none is shipped. The source artifact is a
  bash launcher, no Windows equivalent has ever been written or run, and PowerShell is not
  installed on the machine this change was made on: `pwsh` and `powershell` both returned
  exit **127** (a shell abort, not a fact about Windows) against a `bash --version` control on
  the same instrument that returned 0. Nothing could have been syntax-checked there, let alone
  executed, and shipping an unverified `.ps1` into a public cross-platform installer would be
  worse than the gap. Recorded the way `teammateMode` and `SendMessage` already are: a named
  platform gap rather than a silent one.

## [1.2.2] — 2026-08-12

### Spec-protocol builder-role correction — the stronger DeepSeek variant now builds

- **v4 Flash builds, v4 Pro judges — an operator correction.** The skill recommended
  DeepSeek **v4 Pro** for the app-builder role. That was backwards, and it cost twice.
  **v4 Flash is the stronger of the two variants**, and it is the one that carries the
  higher provider ceiling — **2,500 concurrent subagents against v4 Pro's 500**. The
  builder does the most work in the pipeline, so the old recommendation handed the
  heaviest seat the weaker model at one fifth of the available width. The builder role
  is now recommended through the alias that resolves to **v4 Flash**, and **v4 Pro**
  is recommended for the Sonnet-tier technical and release judge seats, where 500 is
  ample for the eight technical and four release judges that use it. Caught by the
  operator against his own live wiring. `references/gauntlet.md` §13.1 already had it
  right — WF02 builds on the Opus alias → v4 Flash, WF04 and WF05 judge on the Sonnet
  alias → v4 Pro — so this brings `SKILL.md`, `references/interview.md`, and
  `references/pipeline.md` into line with the six-workflow spec they were contradicting.
- **No ceiling number moved.** 2,500 stays attached to v4 Flash and 500 stays attached
  to v4 Pro everywhere either appears. `references/capacity.md`,
  `tools/capacity-resolver.sh`, and the Stage-1 concurrency table are untouched, and so
  are all four tools — only the role each variant is recommended FOR changed.
- **Still recommendations, still alias-resolved.** These are starting points for someone
  wiring up from scratch, expressed through the router alias layer. The binding rule is
  unchanged: read the live aliases at run time and report what is actually wired, never
  assume anyone's wiring, never hardcode a raw model id for a role, and verify that the
  builder, judge, and comparative-critic seats resolve to different underlying models —
  different alias names prove nothing.

## [1.2.1] — 2026-08-12

### Spec-protocol clarity fixes — the operating loop reads as steps, Agnes prices read as annual

- **A station is a step, not a window** — the 19-station canonical operating loop
  (`references/gauntlet.md` §14) was read as an instruction to open nineteen windows or
  tabs. It never was. §14 now opens with a plain-language statement before the table: a
  station is a step the lead performs, one trip through all nineteen processes ONE task
  start to finish, and the live-session count is **one** in single-session mode and
  **five** in team mode (the lead plus the four commanders, which the lead spawns
  itself). Nobody opens nineteen of anything, and the client opens nothing at all.
- **The five-phase grouping** — nineteen rows now carry a human-sized handle placed with
  the station table: ORIENT (1–4), ARM (5–6), BUILD (7–10), JUDGE (11–14), CLOSE (15–19),
  compressed to the mnemonic **READ → PICK → BUILD → JUDGE → RECORD → NEXT**. The table
  stays the machine's checklist; the phases are the human's handle. No station is
  renumbered, merged, reordered, or dropped — the count stays 19 and §14.1's source map
  stays accurate.
- **Agnes AI tiers are ANNUAL prices** — the paid tiers were written bare as "$40 plan"
  and "$100 plan", which reads as monthly next to Ollama Cloud's genuinely monthly
  $20/mo and $100/mo rows during the capacity interview. Every Agnes tier mention now
  says so explicitly across `references/capacity.md`, `references/media-pipeline.md`,
  `references/interview.md`, `SKILL.md`, and `tools/capacity-resolver.sh`. **No rate
  limit changed** — free stays 20 requests/minute, $40/year stays 1,500 requests per 5
  hours, $100/year stays 7,500 requests per 5 hours, and the binding rule that Agnes
  limits are re-researched live at `agnes-ai.com` every run (these figures being the
  dated fallback) stands untouched. `AGNES_PLAN=free|40|100` keeps its accepted values,
  so the resolver's interface is unchanged.

## [1.2.0] — 2026-08-12

### Spec-protocol rebuilt — execution architecture, agent teams, capacity, anti-drift

- **Three-layer execution architecture** — the skill no longer keeps its working state
  in a single markdown ledger. State now lives in three layers held together by an
  explicit reconciliation step: `SPEC/PROJECT-MANIFEST.md` (how the project is supposed
  to operate), the native Claude Code task graph (`TaskCreate`/`TaskUpdate` with real
  `blocks`/`blockedBy` edges — what work exists, is ready, is blocked, is done), and
  machine-readable `CONTROL/project_state.json` (round, scores, locks, defects, tests,
  checkpoints, release-ready). The ledger stays what it always should have been: the
  human-readable narrative, one honest layer among three rather than all of them.
- **Seventeen project documents** — `PROJECT-MANIFEST.md` joins the sixteen as document
  17, added through the closed list's own amendment gate rather than around it. No
  existing document is dropped, renamed, or absorbed; the refused artifacts stay
  refused; the 8.5 QC gate stays.
- **The Capacity Ledger** — computed per run *before* any dispatch, on three axes that
  are never conflated: concurrency width (`min(16, cores−2)`, cores measured rather than
  assumed), the session token budget (tracked decrementing), and per-class policy caps.
  Carries the resolved role→alias→model map, the agent-budget declaration, commander
  slots, and a burn governor. `tools/capacity-resolver.sh` computes it.
- **One canonical 19-station operating loop** — the previously competing loop
  descriptions are fused into a single revolution used in both team mode and
  single-session mode. There is no second, competing loop diagram left in the skill.
- **Anti-drift, capture-proof** — `tools/anchor.sh` is a three-way reconciler (manifest
  against task graph against the artifacts actually on disk) that proves its own
  instrument on a known-positive and a known-negative before it is permitted to report
  "clean". It carries a TERMINAL-DRIFT hard stop gated by a flag file that lives
  *outside* the captured context, a repeated-intent stall detector, BEFORE/AFTER ledger
  discipline, and a ban on contentless heartbeats.
- **Agent Teams orchestration** — a Team Lead plus four persistent commanders (Build,
  Visual QA, Technical QA, Release), spawned by the lead through the Agent tool's `name`
  parameter. Commanders are line items in the Capacity Ledger, they challenge each other
  on the record, and they are rebuilt from the three state layers on resume (teammates
  do not survive `/resume`). Persistent teammates are never used as bulk workers — that
  is what dynamic workflows and subagents are for. When the probe fails, consent is
  refused, or the project is too small, the commander stations collapse onto the lead
  and the same single loop runs single-session.
- **The multi-terminal client handoff is retired** — after one consent the skill spawns
  and drives every session itself. Telling the client to open terminal windows survives
  only as a labeled last-resort rung, and only on the client's own request.
- **New in the skill tree** — ten reference documents (`agent-team`, `anti-drift`,
  `capacity`, `command-center-integration`, `execution-architecture`,
  `funnel-architecture`, `media-pipeline`, `resume`, `worked-example`, `workflows`) and
  three tools (`anchor.sh`, `env-sweep.sh`, `capacity-resolver.sh`). The skill grows
  from 13 files to 26; `tools/ledger.sh` is carried across unchanged.

### Critical fixes

- **Ultracode / effort selections no longer revert** — the launchers exported
  `CLAUDE_CODE_EFFORT_LEVEL` into every `claude-nine` session (macOS forced `"max"`
  whenever the routed-session state carried no level; Windows exported whatever the
  state held). Claude Code treats that env var as an override: `/effort ultracode`
  returned *"CLAUDE_CODE_EFFORT_LEVEL=max overrides effort this session"* and the status
  line kept reporting the old level, so the selection appeared to snap back. Both
  launchers now export it **only** when the operator opts in with
  `CLAUDE_NINE_FORCE_EFFORT=<level>`; the routed-session state seeds `effortLevel` at
  `"xhigh"` (the highest level Claude Code can persist — `"max"` is session-scoped);
  the router's own thinking mechanism, the `(max)` route suffixes, is untouched.
  Verified before/after against the launcher's export block; the override branch is
  quoted from the shipped Claude Code binary.
- **Not covered by this change —**
  `client-box env exports: flagged, needs operator GO.`
  Boxes that already export `CLAUDE_CODE_EFFORT_LEVEL=max` from a shell profile,
  `launchd`, or an OpenClaw process still override the picker until that export is
  cleared per box. That is a fleet action on client machines and is not performed here.

### Installers

- **Agent Teams enablement, both platforms** — `setup-macos.sh` runs the new
  `scripts/macos/enable-agent-teams.sh` and `setup-windows.ps1` runs the new
  `scripts/windows/Enable-AgentTeams.ps1`. Both back the settings file up first (never
  overwriting an existing backup), **merge** only the keys they own, validate the result
  including every pre-existing leaf value, and restore the backup on any failure — a
  broken `settings.json` is never left behind. macOS sets
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` plus `teammateMode: "tmux"` and the three
  tmux config lines (idempotently; tmux is installed only when Homebrew already exists,
  and Homebrew is never installed here). Windows sets the env flag only. The enablement
  applies to **new** Claude Code sessions: no running session, workflow, subagent,
  terminal, or tmux server is killed, restarted, signalled, or reloaded, and no team,
  teammate, or pane is created as a side effect. Enablement is never fatal to setup —
  a blocked or failed attempt is reported honestly in the completion report and the
  install still finishes, because routed Claude Code does not depend on Agent Teams.

### Known residual risks (accepted, documented)

- **`teammateMode` on native Windows is UNDETERMINED** — `tmux` is a Unix assumption and
  no Windows teammate display mode has been probed. The Windows enabler therefore does
  **not** write the key, and records it as `DEFERRED-UNDETERMINED`. The skill's runtime
  probe is the only authority on whether teams function there; the installer never is.
- **`SendMessage` (with `ListAgents`) is macOS/Linux only** — a real gap on native
  Windows. Even with the experimental flag set, teammate-to-teammate messaging is
  unavailable, so peer challenge between commanders does not run; that path falls back
  to single-session mode with the disagreement protocol handled by the lead alone.
- **Agent Teams under 9Router is UNDETERMINED** — never proven. A live per-session probe
  ships with the skill and is the only permitted basis for a claim; until it passes,
  single-session mode is the default under `claude-nine` / `claude-codex`. Whether
  teammate sessions share one rate-limit bucket with the lead is also undetermined and
  is budgeted pessimistically as shared.
- **This repository ships no `claude-codex` launcher** — the macOS launchers remain
  `claude-nine` only. The skill detects `claude-codex` when it is present, but nothing
  here installs it.

## [1.1.0] — 2026-08-10

### The fleet-fusion standard (the Spaulding spec, now the default for everyone)

- **DS Max = DeepSeek v4 FLASH + thinking MAX** (was Pro) — the operator's verified
  canary. Custom node on `https://api.deepseek.com`. Routes to **Opus**.
- **DS Light = DeepSeek v4 FLASH + thinking OFF** — custom node, routes to **Haiku**.
- **Sonnet → Agnes 2.5 Flash** (custom provider, the client's OWN Agnes key from their
  secrets env; never the operator's, never Pro Alpha).
- **Fusion combo `FusioN-smartest-agent`** — panels [DS Max Flash-max, GLM 5.2
  (Ollama Cloud), NVIDIA-free (OpenRouter)], judge **DeepSeek v4 Pro max**. Wired as
  **Fable** for every client.
- **NVIDIA-free custom provider** (`openrouter-nvidia-free`) — built from the client's
  OWN OpenRouter key (all secrets envs checked). If the key is absent, the setup still
  proceeds and **requests the key** rather than silently skipping.
- **Missing-key behavior** — if a client's Agnes/OpenRouter/Ollama key is not in their
  secrets env, the setup wires everything it can and tells the user plainly which key
  is needed to continue. Never uses the operator's keys.

### Critical fixes

- **Skill install root fixed** — `setup-macos.sh` now installs skills into
  `~/.claude-nine/skills/` (the config root `claude-nine` actually reads via
  `CLAUDE_CONFIG_DIR`), NOT `~/.claude/skills/` which is invisible to claude-nine
  sessions. This is the fix for `/spec-protocol` and `/nine-router-setup` not appearing.
  Root cause verified by three independent reviews (Opus, GLM 5.2, Kimi 2.6).
- **Spec-protocol updated** to the operator's latest live version (53,266 bytes).

## [1.0.0] — 2026-08-09

### Critical fixes

- **Dashboard password rotation** — setup now rotates the default `123456` password on
  first login (9Router forces `mustChangePassword`). The rotated password reaches the
  orchestrators via `report.dashboardPassword` (the single sanctioned exception to
  "never print keys"); both platform orchestrators consume it for subsequent API calls.
  Fixes the failure where every fresh install broke on password auth after setup.
- **DS Light / DS Max custom provider nodes** — two new DeepSeek custom nodes with
  deterministic thinking control: `ds-light/deepseek-v4-flash` (thinking OFF) and
  `ds-max/deepseek-v4-pro` (thinking MAX). Opus now routes to DS Max; Haiku routes to
  DS Light with an Agnes 2.5 Flash fallback (`blackceo-haiku-fallback` combo).
- **Ultracode / model-choice integrity** — spec-protocol now reads the router's actual
  wiring and reports it before the build; the Claude-Nine role table carries four roles
  (builder, QC/fixer, merger, comparative critic); thinking levels are **verified per
  route with real probes** (1500-token floor) and recorded in `report.thinkingVerified`.
- **Agnes AI roster** — both models (`agnes-2.5-flash`, `agnes-2.5-pro`) registered in
  the `kv` table; `defaultModel` set per connection. (`agnes-2.5-pro-alpha` was an
  unrequested addition and was removed.)
- **`resolvedRoutes` emitted** — the verified live routes reach the orchestrators, so
  completion reports never fall back to hardcoded defaults.

### Fixes found by the DeepSeek v4 Pro review pass

- **Password rotation mismatch** — orchestrators no longer regenerate a DIFFERENT random
  password than the one the configurator set; they consume `report.dashboardPassword`.
- **Stale `providers` array** — `refreshProviders()` re-fetches after every connection
  creation so `defaultModel` is applied to newly created connections, not silently skipped.
- **`haikuFallback` route** — emitted in `resolvedRoutes`, carried by the state writer.
- **Windows python path** — `resolvePython()` probes `python`/`py -3` on win32,
  `/usr/bin/python3`/`python3` on POSIX; `node:sqlite` preferred (Node 22.5+), loud
  warning if both backends missing — never silent.

### Spec-protocol backport

- **Block D** — four measuring-stick questions (D1 gold-standard bar, D2 as-good-as vs
  rulebook, D3 capture-tool download consent, D4 avoid-that list). Runs on BOTH harnesses;
  never collapses on small plans.
- **Law 50** — "the bar wins by default"; BLOCKED/INFEASIBLE/LIMIT REACHED/USER STOPPED
  are never relabeled PASS.
- **Capture-tooling preflight** — Playwright is the default capture tool, install-then-prove.
- **GATE 0** — two-way ultracode instructions (`/effort ultracode` session-wide, or
  `ultracode /spec-protocol` per message); "Nothing has run yet" reassurance.
- **4th role budget** — comparative critic counted in the 9.4 spend-per-window arithmetic.

### Launcher

- All four alias pins carry the production routes with `(max)` suffixes; Haiku fallback
  env var; port-liveness check with bounded retry; dup-fix guard auto-run on every start.

### Known residual risks (accepted, documented)

- Thinking verification probes confirm content returns but do not introspect whether
  thinking tokens were consumed on max lanes — a `(max)` suffix silently dropped would
  still report OK. Mitigation: `providerThinking` is also set per provider as belt-and-braces.
- Dashboard URL is reconstructed from the port with `127.0.0.1` — correct for the
  loopback-only default; a remote `NINEROUTER_BASE` would need the host preserved.
