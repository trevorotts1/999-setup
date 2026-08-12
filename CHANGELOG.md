# Changelog

## [1.3.0] — 2026-08-12

### Capacity is measured, not remembered — a freshness contract for every number the skill acts on

- **The skill trusted its own memory about a world that moves.** Balances, plan tiers, model
  catalogues and core counts were liable to be recalled from a previous run and used as if
  they were current. A capacity figure that is one run stale is not a smaller number, it is a
  wrong one, and it silently sizes an entire build. The governing rule is now explicit:
  **measure everything that is measurable, every run**; remember only the small set of facts
  that cannot be observed from the machine at all.
- **`tools/capacity-profile.sh` is the one sanctioned memory, and its deny-list is enforced in
  code rather than by good intentions.** It stores only unobservable billing facts and user
  policy — never a balance, never a core count, never anything a run could go and look at. The
  write path refuses a non-sanctioned key by name, refuses a secret-shaped key name, refuses a
  value matching a known secret shape, and refuses any value over 64 characters as a blunt
  anti-secret guard. Every stored value is re-presented as a **proposed answer to be confirmed
  this run, never as an input**.
- **Recall without confirmation was the actual hazard, so recall now ends in a question.** A
  remembered answer is offered back for confirmation instead of being applied. On a machine
  the profile does not belong to, the profile reads as absent-with-a-note and **none of its
  answers is printed** — a profile from another box is not a weaker source, it is the wrong
  source.
- **Every value in the ledger now carries a provenance mark.** `[MEASURED …]`,
  `[RECALLED-CONFIRMED …]`, `[DEFAULT-CONFIRMED …]` and `[ASSUMED …]` make the difference
  between a number that was looked at and a number that was inherited visible on the page.
  An unrecognised mark kind degrades to `ASSUMED` rather than being printed as fact.
  Provenance is presentation only — **a mark never moves a ceiling**.
- **Capacity is re-verified mid-run, and observing capacity is no longer mistaken for
  progress.** Long runs outlive their own measurements, so capacity is re-checked as the run
  proceeds and revisions are recorded rather than overwritten. Because a `CAPACITY-EVENT` line
  is an observation and not work, it is **excluded from the drift fingerprint** — otherwise a
  run could look alive purely by re-reading its own balance. The anti-drift selftest proves
  both directions: the no-delta counter climbs across consecutive capacity events, and a real
  state line resets it.
- **A resumed run re-measures the world before it trusts a word of its own ledger (step 0.5).**
  The ledger describes the world as it was when the run stopped, which may be hours or days
  ago. Step 0.5 re-measures first and produces a revised Capacity Ledger; the later
  reconciliation step orients on that result and deliberately re-measures nothing itself, so
  the two do not overlap or contradict each other.

### The platform contract — a skill that had only ever run on one operating system said so nowhere

- **`references/platform.md` is new, and it exists because the skill was quietly macOS-shaped.**
  It states the detection procedure, what detection writes into the ledger, and how detection
  is allowed to fail. The binding rule throughout: **never infer the operating system from the
  current shell** — PowerShell runs on macOS and bash runs on Windows, so the shell proves
  nothing about the box.
- **A capability matrix now says what each platform can and cannot do**, job by job, with the
  command vocabulary for the same job on each side. The formula is identical everywhere; only
  the instrument changes.
- **Native PowerShell cannot run this skill's bash tools — Git Bash is required on Windows.**
  `anchor.sh`, `ledger.sh`, `env-sweep.sh`, `capacity-resolver.sh` and `capacity-profile.sh`
  are bash scripts. On a native Windows box without Git Bash, every bash-tool verdict is
  **UNDETERMINED and the run says so**. It never pretends the checks ran, and it never converts
  a missing interpreter into a clean result — a missing interpreter reports `127`, which is a
  shell abort and never a fact about the system under test.
- **Unavailable is now `PLATFORM-SKIP` with a named reason, never a silent pass.** A skip
  records which platform, which instrument, and why, so a downstream reader can tell "this box
  cannot do that" apart from "that was checked and was fine". `teammateMode: "tmux"` must never
  be written on Windows, and the Windows peer-messaging gap is surfaced rather than hidden.
- **The file is honest about the limits of its own evidence.** The one-box exhibit is dated and
  explicitly marked as not a fleet fact, and **no PowerShell behaviour in the file was verified
  on the machine that wrote it** — `pwsh` and `powershell` both returned `127` there against a
  control that returned 0. Those rows are documented intent, listed as UNDETERMINED, each with
  the specific test that would settle it.

### Model selection — the alias set is not the model pool

- **The skill had been reasoning about alias NAMES instead of the models behind them.** A live
  catalogue query on the operator's box returned **958 models**, and models bound to no alias
  at all were **proven callable**. Choosing from the four or five configured aliases was
  therefore choosing from a hand-drawn subset of what the machine could actually reach.
- **Seats are selected against requirements, with `ceiling-class` as a required per-seat
  field.** A seat now declares whether its ceiling is expressed as concurrency, requests per
  window, or token balance — three quantities that are not interchangeable and cannot be
  compared without saying which one is meant.
- **The role tables no longer name models; they state requirements.** This continues the
  correction 1.2.5 began. A hardcoded seat goes stale the moment the operator rewires, and the
  tables now describe what a seat must be able to do, leaving resolution to run time.

### Corrections

- **The 1,000 figure is operator policy, not a platform cap.** Anthropic documents no limit on
  the total number of subagents a session may spawn, and
  `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` is undocumented upstream — a configuration record,
  now treated as **INERT** wherever it appears. `references/capacity.md` already carried this
  ruling; `references/agent-team.md`, `references/workflows.md` and `references/pipeline.md`
  still asserted the opposite and now agree with it. **The number itself is unchanged.** The
  operator's 1,000-spawn budget stands exactly as it was and remains the only enforcement this
  skill relies on — only the attribution changed, from a platform guarantee that does not exist
  to a policy that does. The Workflow tool's 1,000-agents-lifetime cap per workflow *run* is a
  genuinely different meter that happens to share the number, and both are still tracked.
- **A provider was credited to the wrong vendor.** The remaining `Gemini` attributions were
  corrected to Agnes; the string no longer appears anywhere in the skill.
- **The OpenRouter detection gap is closed.** A present OpenRouter key could go undetected, so
  a configured provider was invisible to capacity planning. It is detected and its row is
  amended: it is no longer "fallback role only", but it still never joins the builder swarm.

### Budget and credential safety

- **`tools/anchor.sh` gained a Class 6 budget audit, with a negative-spend guard.** The
  reconciler compares claimed spend against agents actually dispatched and raises a drift alarm
  on a mismatch, emitting the reconcile action rather than stalling. A **negative** claimed
  spend is caught as its own fault: it is neither laundered into "agreement" by the tolerance
  window nor downgraded to "undetermined" by an absent dispatch log. Absent budget fields
  report `budget-undetermined` instead of a fabricated agreement, and approaching the ceiling
  exits as `STOPPED_CAP`. The selftest covers all five budget states and now runs **13 cases,
  all passing**.
- **`tools/env-sweep.sh` no longer puts credentials where other processes can read them.**
  Bearer tokens were being passed on the command line, which places them in the process table
  for any user on the box to see, and credentials could be interpolated into a URL. Both are
  fixed. The selftest asserts the property directly rather than assuming it: across the whole
  run, **0 secret values printed, 0 bearer credentials on any command line, 0 credentials
  interpolated into a URL**, proved with a known-positive control that plants eight credentials
  and a known-negative control that proves an empty environment reports them missing.

### Interview

- **A repeat run stopped re-asking what it already knew.** Where the provider-path block asked
  four questions every time, a machine whose configuration has not changed now answers them
  with **one confirmation**, folding everything untouched into a single prompt. A machine that
  *has* changed still gets the full set. This joins the existing small-plan collapse; block D
  still never collapses.

### Verification and scope

- **Every tool ships proven, and each selftest proves its instrument in both directions.**
  `anchor.sh` 13/13, `capacity-resolver.sh` PASS, `env-sweep.sh` 5/5, `capacity-profile.sh` 21
  passed / 0 failed. `capacity-profile.sh` additionally proves containment — every file it
  wrote lives under its one sanctioned path, and nothing was created elsewhere under the
  sandbox home. All tests run with `HOME` overridden to a sandbox; none touches a real home
  directory.
- **Deliberately unchanged.** `tools/ledger.sh` is byte-identical. The 1,000 budget, the
  30-workflow session ceiling, the 20-agent wave cap and the `min(16, cores−2)` width formula
  are untouched. No history was rewritten: nothing was force-pushed, rebased or reset.

## [1.2.6] — 2026-08-12

### No personal names in a repository everyone installs, and the skill-root defect that shipped one box's topology to every client

- **A client's surname was naming the standard.** Two places attributed the fleet-fusion
  wiring to a named individual — the `1.1.0` heading in this changelog and a code comment in
  `.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs`. Both now read
  neutrally: "The fleet-fusion standard (now the default for everyone)" and "the operator's
  standard spec". Nothing technical moved — only the naming. This repository ships to
  everyone, the standard is not named after a person, and a public repository is the wrong
  place to carry a client's name at all. This entry deliberately does not repeat the name it
  removes.
- **The whole repository was swept, not just that one name.** A per-name sweep over every
  known client and personal name, plus structural sweeps for possessives, capitalised
  name-pairs, e-mail addresses and telephone numbers, over every tracked file (no binary
  files exist, so nothing was skipped). Every instrument was run with both a known-positive
  and a known-absent control so a zero could be trusted, and the final zero was re-proved by
  planting the name back in, catching it, and removing it again. The only remaining personal
  name is the operator's own, in `LICENSE` — which belongs there.
- **Scope, stated plainly.** This corrects the files as they stand. The name remains in older
  commits and no history was rewritten: nothing was force-pushed, rebased or reset, because
  that would break every existing clone.

### The setup script installed skills where the shipped launcher cannot see them

- **`setup-macos.sh` asserted a launcher behaviour that does not exist.** Its skill-root block
  commented that "the claude-nine launcher sets `CLAUDE_CONFIG_DIR=$HOME/.claude-nine`" and
  defaulted `CLAUDE_SKILLS_ROOT` to that path. The shipped launcher does no such thing —
  `launchers/macos/claude-nine` contains zero `CLAUDE_CONFIG_DIR` references and injects
  routing (base URL, Keychain token, alias exports) into the child process only, leaving the
  config root untouched. So do `claude-codex` and both Windows launchers.
- **The consequence on a client box was real.** Setup installed the skills into
  `~/.claude-nine/skills/` while the launcher there reads `~/.claude` — so `/spec-protocol`
  and `/nine-router-setup` landed exactly where that box could not find them. The `1.1.0`
  "skill-root fix" diagnosed a genuine symptom on the operator's own machine, where a personal
  wrapper does set a separate config root, and then encoded that one machine's topology as the
  default for every client.
- **Worse, it conjured a directory that misleads harness detection.** Creating
  `~/.claude-nine/` on a box that has no such config root plants a false signal for anything
  that probes for that path to decide which harness it is running on.
- **The root is now resolved from the environment, defaulting to the shared root.**
  `CLAUDE_SKILLS_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"`, matching what five sources in
  this repository already state by design — `CLAUDE.md` rule 10, `AGENT_INSTALL.md`,
  `nine-router-setup/SKILL.md` step 10, `references/platform-macos.md`, and the shipped
  launcher itself. An operator whose own wrapper exports `CLAUDE_CONFIG_DIR` is honoured
  automatically, so the script is correct on both topologies without assuming either.
- **Operator-style boxes get both roots, and the directory is never created.** When
  `$HOME/.claude-nine` already exists as a real config root — proved by its own
  `settings.json`, not by a bare directory — the skills are linked into it as well, so both
  topologies see them. The script never creates that directory.
- **Proved in a sandbox with `HOME` overridden, never against a real home directory.** A fresh
  client box resolves to `~/.claude`, links the skills there, and creates no `~/.claude-nine`;
  a box with a real `~/.claude-nine` gets both roots; an exported `CLAUDE_CONFIG_DIR` wins and
  de-duplicates; a bare `~/.claude-nine` with no `settings.json` is correctly not treated as a
  config root. Re-running three times converges instead of nesting links, and a root that
  already holds the real skill directories is not linked onto itself.
- **Deliberately unchanged.** The launchers are correct as shipped and were not touched. The
  documentation stating the one-config-root design was already right and stands as-is.
  `setup-windows.ps1` was read and carries no skills-root resolution at all, so it does not
  share this defect and needed no change. `tools/ledger.sh` is byte-identical.

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

### The fleet-fusion standard (now the default for everyone)

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
