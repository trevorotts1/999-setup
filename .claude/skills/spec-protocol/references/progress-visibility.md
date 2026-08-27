# Progress Visibility + Session Health

The persistent status line and the live task list. This reference is the
full capability contract; SKILL.md carries only the operational requirement (step 2.10 and
the compact threshold table). Spec: operator capability spec 2026-08-16 (17 sections,
captured verbatim at `/tmp/progress-visibility-spec-20260816.md`).

The swarm must be watchable. This is the watchability layer.

## 1. What the status line is, and why Spec Protocol installs it

Claude Code supports a configurable persistent status line — one line rendered beneath the
input box, refreshed on events (and optionally on an interval). Spec Protocol installs it
so the user can glance at the terminal and answer twelve questions without reading the
conversation:

1. What model am I using?
2. What has this session cost?
3. What git branch am I on?
4. What part of the project is currently being built?
5. What has already been completed?
6. What is still left?
7. How close is the project to being DONE?
8. How close is the current wave to being done (wave-shaped runs)?
9. Is anything blocked?
10. Is the work clean in git?

Context usage and 5h/7d usage rates are deliberately NOT on this list — internal
doctrine, never client display (operator order 2026-08-16).

Preferred display, adapted to what the installed version actually exposes (priority order
per spec §1):

```text
Claude Opus | ≈$1.38 api-equiv | main ✓ | Project ████░░░░░░ 40% | Wave 2 ██████░░░░ 60%
```

**The client-facing display (operator order 2026-08-16): what truly matters — model, cost,
git, Project progress, Wave progress. Context usage and 5h/7d usage rates are INTERNAL
doctrine (agent behavior thresholds, §5), never client display.** The Project segment is
THE MAIN METRIC: how close the project is to being done. Full derivation and guardrails
in §6.

Do not fake unavailable information. Only display data Claude Code actually exposes — or
data derived from what it exposes (the cost rule, §4).

## 2. Version facts (verified 2026-08-16, operator Mac Mini)

- Claude Code **2.1.227** on BOTH launch methods. `claude-nine` runs the SAME native
  binary as plain `claude` (`~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`);
  only the config dir differs.
- `/statusline` is a runtime slash command in 2.1.227 — but it is NOT listed in
  `claude --help`. Detect support at runtime, never assume.
- The settings key (native schema):

```json
"statusLine": {
  "type": "command",
  "command": "<script-path-or-command>",
  "padding": <number, optional>,
  "refreshInterval": <seconds ≥ 1, optional>,
  "hideVimModeIndicator": <bool, optional>
}
```

- Convention: one shared script at `~/.claude/statusline-command.sh` referenced from both
  stores. If `~/.claude/settings.json` is a symlink, update the target file instead.
- The statusLine command is **silently skipped** when workspace trust is not accepted, and
  **disabled by `disableAllHooks`** (never set on the operator box — the boss cron lives in
  hooks). Safe mode shows only the managed/policy status line.

## 3. Detection-first — never destroy an existing status line

Before changing anything:

1. Inspect BOTH settings stores (`~/.claude/settings.json` and `~/.claude-nine/settings.json`).
2. Detect whether a statusLine already exists.
3. Back up any settings file that will be modified (state the backup path in the same message).
4. Preserve existing useful customizations.

Existing status line equal or better → DO NOT replace it. Report:

```text
Claude Code Status Line:
Already configured and healthy.
No replacement required.
```

Enhanceable → preserve its behavior, add only the missing Spec Protocol information.

**Idempotency.** Running setup twice must not create duplicate configuration. The installer
detects first, always; a re-run reports already-configured and writes nothing.

**Testing the installer.** `scripts/setup-statusline.sh --check` is a detection-only dry run —
it reports what WOULD happen and writes nothing. Always test with `--check` first; a bare
invocation mutates the settings stores.

Never replace an entire settings file to add one key. Modify only the required key.

## 4. The metric support matrix (verified against the statusLine stdin JSON schema)

The statusLine command receives JSON on stdin. Fields that matter here:

```json
{
  "model": { "id": "string", "display_name": "string" },
  "cwd": "string",
  "context_window": {
    "total_input_tokens": "number", "total_output_tokens": "number",
    "context_window_size": "number",
    "used_percentage": "number|null (0-100, pre-calculated)",
    "remaining_percentage": "number|null (0-100, pre-calculated)"
  },
  "rate_limits": {                          // subscribers only, after first API response
    "five_hour": { "used_percentage": "number", "resets_at": "epoch" },
    "seven_day": { "used_percentage": "number", "resets_at": "epoch" }
  }
}
```

| Metric | Verdict | How |
|---|---|---|
| Active model | DISPLAYED | stdin `model.display_name` |
| **Session cost** | **DISPLAYED — derived, never read from stdin** | see the cost rule below |
| Git branch/status | DISPLAYED | via shell from `cwd` (stdin workspace has no branch field): `git rev-parse --abbrev-ref HEAD`, `git status --porcelain`; skip optional locks |
| Project progress | DISPLAYED — THE MAIN METRIC | derived from `$cwd/CONTROL/project_state.json` (§6) |
| Wave progress | DISPLAYED (wave-shaped runs) | derived from `FIX-LEDGER.md` (§6) |
| Context % / context bar | INTERNAL ONLY — never client display (operator order 2026-08-16) | stdin `context_window.used_percentage` — still READ (token counts feed the cost derivation) and ACTED ON per the thresholds (§5); never rendered |
| Session duration | UNDETERMINED | not in stdin; script-side start-time file is the permitted DIY extension |
| 5-hour / 7-day usage | INTERNAL ONLY — never client display (operator order 2026-08-16) | stdin `rate_limits.*` — subscribers only, absent under 9Router; never rendered |

**The cost rule (operator order 2026-08-16 — cost goes ON the bar).** Cost IS exposed in the
stdin schema — corrected 2026-08-27: `cost.total_cost_usd` was proven present, both by finding
the object-literal construction site in the installed 2.1.227 binary and, later the same day,
by live stdin capture from a running session (`$0` pre-turn, `$0.0554999...` after one turn),
reversing the earlier "not exposed" finding above. Binding, in this order:

- **Routed-session gate runs FIRST, keyed on `model.id`, NEVER `model.display_name`.** Live
  capture 2026-08-27 (both classes, same instrument): a claude-nine/9Router session sends
  `model.id = "opus-chain"` (the raw chain id the router was asked for) but
  `model.display_name = "Opus 5"` — a normal-looking Anthropic name. An earlier version of
  this rule (and an earlier version of the script) gated on `display_name` shape
  (`*-chain`/`fusion-*`); that gate could never fire, because the chain id never reaches
  `display_name` — it was a dead check. `model.id` always starts with `claude-` on a plain
  session (captured: `claude-haiku-4-5`) and never does on a routed one; that prefix is the
  real signal. An absent/unrecognized `model.id` is treated as routed-safe (cost omitted) —
  never guess in the direction of showing a price.
- **A routed session NEVER shows `cost.total_cost_usd` and NEVER gets a price-table figure.**
  Proven wrong, not just untrusted: the captured routed payload had
  `total_input_tokens = 46536`, `total_cost_usd = 0.235748` — the harness priced that turn at
  roughly the real Anthropic Opus-5 input rate ($5/MTok), while 9Router's own request records
  show it was actually served by Ollama Cloud `glm-5.3-flash` (`opus-chain` leg 1),
  flat-subscription traffic with near-zero marginal cost. (The router's per-request cost
  lookup, the `requestDetails` table, is not a viable live substitute either — capped at 1000
  rows, 8+ days stale at last check.) Omit is the only provable-correct behavior — an omitted
  number beats a fabricated one.
- **Plain-session primary:** read `cost.total_cost_usd` from stdin directly and use it
  as-is — Claude Code's own running total for the session, already cumulative. No state file,
  no per-refresh delta math, and no double-counting from `~/.claude` and `~/.claude-nine`
  sharing a state directory (that whole class of bug is eliminated by keeping no cost state at
  all — the old delta-vs-state-file design is retired; see the two defects note below). Used
  directly, never re-priced through the table — being non-routed is what makes the figure
  trustworthy, regardless of which Claude family it names.
- **Plain-session fallback** (only when `total_cost_usd` is absent/null — older Claude Code
  builds that don't yet emit `cost`): derive from `context_window.total_input_tokens` /
  `.total_output_tokens` — already whole-session cumulative totals per the stdin contract, so
  this needs no delta math either — times PUBLISHED per-model pricing, matched from
  `model.display_name`.
- Display with a `~` marker: computed estimate from real data. Never an invented number.
- A model with no published pricing in the table → the cost segment is OMITTED, not guessed.
- Published pricing, USD per 1M tokens (input / output): fable 10.00/50.00, opus 5.00/25.00,
  sonnet 3.00/15.00, haiku 1.00/5.00. (Corrected 2026-08-27 — the table previously read
  opus 15.00/75.00, sonnet 3.00/15.00, haiku 0.80/4.00, with no fable entry at all: opus was
  3x too high, haiku too low, and every Fable session showed no cost.)

**Fallback law.** Version-detect at install time. Never hard-code an implementation that
assumes `/statusline`, specific JSON fields, or rate-limit properties stay identical across
versions. Use the native supported mechanism or the closest equivalent. A metric that is
unavailable is OMITTED — the status line still installs with the supported metrics, and the
installation never fails over a missing metric. Report per metric:

```text
Model: Supported
Session cost: rendered `≈$N api-equiv` — API-EQUIVALENT, NOT A BILL. Plain sessions use Claude
  Code's own tracked session total when available, else derived from cumulative token counts ×
  published pricing; ALWAYS omitted for routed (claude-nine/9Router) sessions, detected via
  model.id, never display_name. The `api-equiv` suffix is REQUIRED: that total prices the
  session's tokens at Anthropic pay-per-call list rates, but an operator on a Claude
  subscription pays $0 marginal for them, so a bare `~$N` reads as a charge never incurred
  (operator ruling 2026-08-27). Keep the number — it is a real usage meter, dominated by cache
  reads on long sessions — but never present it as money owed.
Session duration: Not exposed by this Claude Code version
Context usage: INTERNAL — tracked and acted on, never displayed (operator order 2026-08-16)
5-hour / 7-day usage: INTERNAL — never displayed (operator order 2026-08-16)
```

## 5. Context health thresholds — INTERNAL doctrine, never client display

Context usage is NOT shown to the client (operator order 2026-08-16 — the client sees
what truly matters: model, cost, git, Project progress, Wave progress). Context thresholds
remain binding on the AGENT: the statusline script still reads the token counts (they feed
the cost derivation) and the agent acts per level:

| Level | Range | Agent behavior |
|---|---|---|
| Normal | 0-69% | Continue normally. |
| Elevated | 70-84% | Verify the active task list. Persist important architectural decisions to project files. Never keep critical project information only in conversation context. |
| High | 85-94% | Persist current implementation state. Update project documentation. Update task state. Record unresolved issues. Preserve important decisions. Prepare for context compaction or continuation. |
| Critical | 95%+ | Do not start a large new phase without first persisting the current project state. Preserve enough state so work continues accurately after compaction or a new session. |

The objective is continuity, not premature stopping. High context never licenses abandoning
active work; it licenses persisting state first.

The agent is ALWAYS aware of context from its own instrumentation (the statusLine stdin the
script receives) — the client simply is not shown it. Display and awareness are separate;
this order kills the display, not the awareness.

## 6. Task tracking (spec §4-9)

- **When:** task list is created after the specification/plan is established — never before,
  never fake busywork tasks to lengthen the list. Track meaningful milestones only.
- **Symbols:** `✓` Complete, `●` In Progress, `○` Pending, `!` Blocked — with the specific
  reason shown (`! Blocked - Supabase authentication required`).
- **Truthfulness law:** a task is Complete ONLY when its required validation is complete —
  never because code was generated. `✓ Backend complete` without validated backend is a
  lie; `✓ Deployment complete` without a tested deployment is a lie. The user must be able
  to understand what is happening from the progress interface without reading the whole
  conversation.
- **Phases** (only applicable ones; subtasks underneath): 01 Discovery, 02 Specification,
  03 Architecture, 04 Design System, 05 Frontend, 06 Backend, 07 Integrations, 08 Testing,
  09 QA, 10 Deployment.
- **Companion skills reflected:** when Frontend Design / UI/UX Pro Max / Supabase /
  Kie.ai / Agnes AI are used, they appear in the task display. Never display providers that
  are not being used in the project.
- **Ctrl+T** toggles the task display (`app:toggleTodos`, Global binding, 2.1.227). Explain
  it to the client in plain English during setup:

```text
Spec Protocol has enabled Claude Code's progress-tracking workflow.

Your persistent status line shows your active model, session cost, Git information, and — the main thing — how close your project is to being DONE.

For larger builds, Claude will also maintain a task list.

Press Ctrl+T inside Claude Code to view or hide task progress when supported by your installed version.
```

### The project completion bar (THE MAIN METRIC — operator order 2026-08-16)

The status line carries a project segment: how close the project is to being DONE. This is
the main thing the bar exists to show — not just session health.

```text
Claude Opus | ≈$1.38 api-equiv | main ✓ | Project ████░░░░░░ 40% | Wave 3 ██░░░░░░░░ 20%
```

**Derivation — disk truth only, never conversation memory.** The statusline script reads
`CONTROL/project_state.json` (schema `spec-protocol/project-state@1`,
references/documents.md). Percent = `tasks.counts.completed / (pending + in_progress +
completed)`, the SAME counts the reconciler audits. The script is a reader; it never
invents numbers and never trusts a stale memory of progress.

**Lookup is a bounded upward walk, not a single check (corrected 2026-08-27).** Spec Protocol
projects are not git repositories, so this cannot use `git rev-parse --show-toplevel` the way
the wave bar does. The script starts at `$cwd` and checks `CONTROL/project_state.json` there,
then walks up one directory at a time, stopping the instant a hit is found. The walk is bounded
at `$HOME` (checked, then stop) with `/` as a hard safety floor for a `$cwd` outside `$HOME`
entirely. Without this walk the Project segment renders correctly from the project root and
then silently vanishes the moment you `cd` into a subdirectory two levels down — the confirmed
defect this fixes; a single `$cwd`-only check is not sufficient.

**Guardrails (binding):**

- No `project_state.json` found anywhere on the walk → the segment is OMITTED (the plan does
  not exist yet; showing 0% before the plan exists is fake progress). Appears from the moment
  step 16.6 initializes the state file. A malformed/corrupt `project_state.json` behaves the
  same way — the Project segment drops, the rest of the bar (model, cost, git) still renders.
- Blocked tasks count in the total. A blocked task is unfinished work; hiding it inflates
  the percent.
- `✓` only after validation, so the bar moves on VALIDATION, never on code generation —
  the counts only advance when tasks complete under the completion law, and a task is
  complete only when its required validation is complete. Generated-but-unverified code
  does not move the bar.
- `run_status` is shown when it is not RUNNING (`[PASS]`, `[STOPPED_CAP]`, …). 100% counts
  with `run_status` still RUNNING render the counts as they are — the merge state is the
  task system's business; the bar never claims delivery.
- Repair loops reopen tasks → completed goes DOWN → the bar goes DOWN. That is correct,
  never a bug. The bar tells the truth even when the truth is backwards movement.
- 100% does not mean shipped. Shipped = merged at HEAD and verified there (the completion
  law). The bar is a progress instrument, not the delivery claim.

### The wave bar (fix executions and wave-shaped runs)

When a wave-shaped run is in progress — the fix execution of the master spec, or any run
whose ledger carries wave lines — the status line adds a wave segment:

```text
... | Wave 3 ██░░░░░░░░ 20%
```

**Derivation.** The script looks for `FIX-LEDGER.md` at `$cwd/FIX-LEDGER.md` first, then at
the **git repo root of `$cwd`**. It NEVER falls back to a hardcoded absolute path to a named
project — a ledger outside the project you are in is ANOTHER project's status, and rendering
it here is a false report.

Current wave = **the highest `WAVE <n>` that has NO `WAVE <n> CLOSED` line.** A closed wave is
history, not status. If every wave is closed there is no wave running and the segment is
OMITTED — this is what lets the bar clear itself.

Total = that wave's **workflow-completion lines** (the `` - `WF-<n>x `` class); done = those
carrying a PASS or DONE marker. Numerator and denominator share the SAME class, so the
locked-wave table row and log lines (DISPATCH / VIOLATION-STOP / CLOSED / REVIEW-FINDING)
that merely MENTION a wave id are never counted as workflows. No wave or workflow lines
→ the segment is OMITTED, never guessed.

**Two defects this derivation exists to prevent** (both live on the operator box, 2026-08-26,
in BOTH config stores):

1. *The bar that could never clear.* The old hardcoded `$HOME/work-999-setup/FIX-LEDGER.md`
   fallback meant every session in every directory rendered that one project's wave. Wave 6
   there closed 2026-08-16 and the bar still read `Wave 6 ██░░░░░░░░ 20%` ten days later.
   **Rule: every bar must have a reachable condition under which it disappears.**
2. *Prose counted as progress.* The old unanchored `grep -c "WF-<n>"` matched any line
   MENTIONING the wave — violation records, review findings, the plan table. The `20%` was
   1 of 5 narrative paragraphs, not 1 of 5 workflows. **Rule: count a line class, anchored,
   never a substring.**

**Installer owns the body; the deployed script is generated.** `scripts/setup-statusline.sh`
carries the script as a quoted heredoc and `~/.claude/statusline-command.sh` is its output.
Fixing the installer WITHOUT re-running it leaves the running code stale — exactly how defect
2 above survived: the installer had the anchored match, the deployed script did not. After any
change, regenerate the deployed copy from the heredoc and diff the two.

**Guardrails:** the bar counts ledger lines, and ledger lines are written only after
verification (the boss enforces claim-vs-ledger). A workflow line without a PASS/DONE
marker counts as not done. A `VIOLATION-STOP` or re-opened workflow drops the percent —
again, correct.

The wave bar and the project bar coexist: the wave bar answers "how long until THIS wave
is done", the project bar answers "how long until THE PROJECT is done".

## 7. Claude-nine compatibility

- Plain `~/.claude/` and `~/.claude-nine/` are SEPARATE config stores (verified). The
  skills symlink farm (`sync-nine-skills.sh`) shares skills — it does NOT cover
  settings.json.
- Therefore: configure the statusLine in BOTH stores — or, preferred, register the SAME
  shared script (`~/.claude/statusline-command.sh`) from both stores.
- **Acceptance requires live proof in a claude-nine session** — same script, same bar,
  same metrics — not just a configured key. A metric observed only under plain claude is
  not claimed for claude-nine.
- 9Router sessions are expected to lack `rate_limits` — omit the 5h/7d segments, never fail.
- DO NOT alter 9Router model-routing rules merely to enable progress visibility. Routing is
  sovereignty; visibility never justifies touching it.

Expected validation outcome (spec §10):

```text
Standard Claude Code
✓ Status line visible
✓ Project progress visible
✓ Wave progress visible (wave-shaped runs)
✓ Task tracking available

Claude-nine
✓ Status line visible
✓ Project progress visible
✓ Wave progress visible (wave-shaped runs)
✓ Task tracking available
```

## 8. Installation checklist (spec §15)

```text
[ ] Claude Code launches successfully
[ ] Existing Claude settings remain intact
[ ] Status line appears
[ ] Active model is displayed
[ ] Session cost displayed in BOTH launch paths (labeled estimate; plain sessions use Claude
    Code's own tracked total when available, else real token counts × published pricing;
    ALWAYS omitted, never Anthropic-priced, for routed/9Router sessions — gate on model.id,
    never display_name, which resolves to a normal Anthropic-looking name even when routed)
[ ] Session duration works when supported
[ ] Git branch/status works inside Git repositories
[ ] Project progress visible and derived from CONTROL/project_state.json
[ ] Wave progress visible when wave lines exist (wave-shaped runs)
[ ] Context usage NOT displayed to the client (internal doctrine only — operator order 2026-08-16)
[ ] 5h/7d usage NOT displayed to the client (internal doctrine only)
[ ] Task tracking is available
[ ] Standard Claude Code works
[ ] Claude-nine works
[ ] 9Router configuration remains unchanged
[ ] Re-running setup does not create duplicate configuration
```

Do not claim a metric works unless it was actually observed.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status line missing in a trusted workspace | workspace trust not accepted | accept trust (`/trust` or the prompt); statusLine is skipped silently otherwise |
| Status line missing everywhere | `disableAllHooks` set | remove it — it also kills the boss cron and every governance hook (PART 4 hook-protection clause) |
| Only the managed line shows in safe mode | safe mode displays policy statusLine only | exit safe mode |
| 5h/7d segments absent | not a subscriber / first API response not yet seen / 9Router session | omit is correct behavior, not a fault |
| Cost segment absent | model not in the pricing table (fallback path only), OR a routed/9Router session (`model.id` doesn't start with `claude-`) | omit is correct — never guess a price, never show an Anthropic price on routed traffic. Note the bar's Model segment still shows a normal-looking name (e.g. "Opus 5") on a routed session — that is `display_name`, not the routing signal; don't mistake it for a plain session |
| `git` segments blank | not inside a git repository | omit branch/status outside repos |
| Project segment absent below the project root | `CONTROL/project_state.json` not found anywhere from `$cwd` up to `$HOME` | omit is correct if truly outside a Spec Protocol project; if inside one, confirm the walk reached the directory that holds `CONTROL/` |

## 10. How to disable / restore

- **Disable:** remove the `statusLine` key from the store(s) that carry it (keep everything
  else in the file). The shared script can stay — it runs only when referenced.
- **Restore previous configuration:** every settings file modified by the installer has a
  dated backup sibling (`.bak-*`). Copy it back.

## 11. Final report format (spec §17 — 15 items)

1. Claude Code version detected.
2. Claude-nine environment detected.
3. Configuration file modified.
4. Backup created.
5. Status-line implementation used.
6. Metrics successfully displayed.
7. Unsupported metrics.
8. Task-progress functionality.
9. Ctrl+T support.
10. Standard Claude Code validation.
11. Claude-nine validation.
12. Whether both environments share configuration.
13. Any existing user configuration preserved.
14. Idempotency test.
15. Any remaining manual action.

Never report the capability complete until it has been tested.
