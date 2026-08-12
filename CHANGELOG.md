# Changelog

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
