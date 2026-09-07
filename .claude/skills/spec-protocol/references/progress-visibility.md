# Progress Visibility + Session Health

The persistent status line and the live task list. This reference is the
full capability contract; SKILL.md carries only the operational requirement (step 2.10 and
the compact threshold table). Spec: operator capability spec 2026-08-16 (17 sections,
captured verbatim at `/tmp/progress-visibility-spec-20260816.md`).

The swarm must be watchable. This is the watchability layer.

## 1. What the status line is, and why Spec Protocol installs it

Claude Code supports a configurable persistent status line — one line rendered beneath the
input box, refreshed on events (and optionally on an interval). Spec Protocol installs it
so the owner of the project can glance at the terminal and answer four questions without
reading the conversation:

1. Is it still working, and when did it last do something?
2. What piece is it on right now?
3. How many pieces are done, out of how many?
4. Is anything waiting on me?

Two conditional segments answer a fifth and a sixth: before the plan exists, how far
through getting ready it is; and on a wave-shaped run, how close the current wave is to
being done.

Deliberately NOT on this list: the model name, the session cost, the git branch, context
usage, and the 5h/7d usage rates. The first three were on the bar until 1.18.0 and were
removed — none of them answers a question the owner asked, and the cost figure priced the
session at list rates a subscriber never pays (§4). Context usage and the usage rates
remain INTERNAL doctrine, never client display (operator order 2026-08-16).

The client bar, exactly:

```text
Working ✓ 2m ago | Now: the booking page | 14 of 40 pieces (35%) | Needs you: nothing
```

Before the plan exists the third segment is replaced:

```text
Getting ready: step 4 of 9
```

A wave-shaped run adds one segment on the end:

```text
… | Wave 2 ██████░░░░ 60%
```

**The client-facing display (operator order 2026-08-16, narrowed 1.18.0): what truly
matters — is it working, what is it on, how far along, does it need me.** Every segment is
a plain-words answer written for a non-technical adult: the piece is "the booking page",
never `U042` (`references/audience.md`, the naming convention). Full derivation and
guardrails, segment by segment, in §6.

Do not fake unavailable information. Only display data Claude Code actually exposes, or
data read from the project's own files on disk (§6). A source that is missing, unreadable,
or malformed drops its OWN segment and leaves the rest of the bar standing.

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
  **disabled by `disableAllHooks`** (never set on the operator box — every governance
  hook lives there). Safe mode shows only the managed/policy status line.

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
| **Working ✓ Nm ago** | **DISPLAYED** | age of the newest line in `CONTROL/HEARTBEAT.md` (§6) |
| **Now: `<piece>`** | **DISPLAYED** | `CONTROL/project_state.json` `.phase`, named through `CONTROL/CHECKLIST.md` then `CONTROL/TODO.md` (§6) |
| **n of N pieces (p%)** | **DISPLAYED** | `CONTROL/project_state.json` `tasks.counts` (§6) |
| **Getting ready: step n of 9** | **DISPLAYED before the plan exists** | `CONTROL/setup_progress.json` (§6) |
| **Needs you: k \| nothing** | **DISPLAYED** | open OPERATOR-ESCALATION and question items in `CONTROL/TODO.md` (§6) |
| Wave progress | DISPLAYED (wave-shaped runs) | derived from `CONTROL/LEDGER.md` (§6) |
| Active model | NOT DISPLAYED (removed 1.18.0) | stdin `model.display_name` — read by nothing; the owner did not ask which model |
| Session cost | NOT DISPLAYED (removed 1.18.0) | no money figure is computed anywhere; see the note below |
| Git branch/status | NOT DISPLAYED (removed 1.18.0) | a branch name is not a plain-words answer to any of the four questions |
| Context % / context bar | INTERNAL ONLY — never client display (operator order 2026-08-16) | stdin `context_window.used_percentage` — ACTED ON per the thresholds (§5); never rendered |
| Session duration | UNDETERMINED | not in stdin; script-side start-time file is the permitted DIY extension |
| 5-hour / 7-day usage | INTERNAL ONLY — never client display (operator order 2026-08-16) | stdin `rate_limits.*` — subscribers only, absent under 9Router; never rendered |

**The cost rule is retired (1.18.0).** There is no cost segment, and no money figure is
computed anywhere in the status line. `cost.total_cost_usd` is present in the stdin schema
and is deliberately not read: it prices the session's tokens at Anthropic pay-per-call list
rates, while an operator on a subscription pays $0 marginal for them, so any figure derived
from it reads as a charge that was never incurred (operator ruling 2026-08-27). On a routed
(claude-nine/9Router) session it was worse than misleading — a captured routed payload
priced 46,536 input tokens at roughly the Anthropic Opus-5 rate for a leg 9Router's own
records show was served by Ollama Cloud. Neither the field, nor a price table, nor the
routed-session gate that used to guard them survives in the script. The bar carries no
number the owner did not ask for.

**Fallback law.** Version-detect at install time. Never hard-code an implementation that
assumes `/statusline`, specific JSON fields, or rate-limit properties stay identical across
versions. Use the native supported mechanism or the closest equivalent. A metric that is
unavailable is OMITTED — the status line still installs with the supported metrics, and the
installation never fails over a missing metric. Report per metric:

```text
Working ✓ Nm ago: Supported — age of the newest line in CONTROL/HEARTBEAT.md (the file's
  modification time when no line carries a parseable stamp); omitted when nothing has
  reported work yet
Now: <piece>: Supported — CONTROL/project_state.json .phase, resolved to its plain-words
  line in CONTROL/CHECKLIST.md then CONTROL/TODO.md (a phase already in plain words is
  shown as it stands); omitted when nothing names it
n of N pieces (p%): Supported — CONTROL/project_state.json tasks.counts; omitted until the
  plan exists
Getting ready: step n of 9: Supported — CONTROL/setup_progress.json, shown only before the
  plan exists
Needs you: Supported — open OPERATOR-ESCALATION and question items in CONTROL/TODO.md;
  reads "nothing" at zero; omitted when the project has no TODO.md
Wave bar: Supported for wave-shaped runs — CONTROL/LEDGER.md; omitted when no wave lines exist
Model name / session cost / git branch: NOT displayed — removed from the client bar in 1.18.0
Session duration: Not exposed by this Claude Code version
Context usage: INTERNAL — tracked and acted on, never displayed (operator order 2026-08-16)
5-hour / 7-day usage: INTERNAL — never displayed (operator order 2026-08-16)
```

## 5. Context health thresholds — INTERNAL doctrine, never client display

Context usage is NOT shown to the client (operator order 2026-08-16 — the client sees what
truly matters: is it working, what is it on, how far along, does it need me). Context
thresholds remain binding on the AGENT, which reads them from its own statusLine stdin —
the script itself no longer reads the token counts at all, because nothing on the bar is
derived from them — and the agent acts per level:

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
At the bottom of the window you'll see a bar with how close your project is to done. Press Ctrl and T together to see the list of pieces and which are finished.
```

That is the whole explanation, verbatim (the client-facing texts, 1.18.0). It is two
sentences because the person reading it did not ask for a status system; they asked for a
website. Nothing about models, costs, branches, or "progress-tracking workflows" is said
out loud.

### Finding the project — the bounded upward walk

Every segment below except the wave bar reads a file under the project's own `CONTROL/`
directory, so the script has to find that directory first.

**Lookup is a bounded upward walk, not a single check (corrected 2026-08-27).** Spec Protocol
projects are not git repositories, so this cannot use `git rev-parse --show-toplevel` the way
the wave bar does. The script starts at `$cwd`, checks for a `CONTROL/` directory there, then
walks up one directory at a time, stopping the instant a hit is found. The walk is bounded
at `$HOME` (checked, then stop) with `/` as a hard safety floor for a `$cwd` outside `$HOME`
entirely. Without this walk the segments render correctly from the project root and then
silently vanish the moment you `cd` into a subdirectory two levels down — the confirmed
defect this fixes; a single `$cwd`-only check is not sufficient. The walk keys on `CONTROL/`
rather than on `project_state.json` (as it did before 1.18.0) because `Getting ready` has to
render BEFORE the state file exists.

### Segment 1 — `Working ✓ Nm ago`

The age of the NEWEST line in `CONTROL/HEARTBEAT.md` (document 13: one line per live agent,
`<ISO8601Z> | agent label | work item | stage`, rewritten on every real progress step).
Newest = the highest stamp, which for a fixed-width ISO stamp is the lexicographic maximum.

**Guardrails (binding):**

- No `CONTROL/HEARTBEAT.md` → the segment is OMITTED. Nothing has reported work; a cheerful
  "Working" with no agent behind it is the exact lie this bar exists to not tell.
- A heartbeat file whose lines carry no parseable stamp → the file's own modification time
  is used instead. Still disk truth, never a guess; the metric report says so.
- The number goes UP when work stalls, and that is the point: a client who sees `47m ago`
  has the information the five-minute tick (`tools/watch-tick.sh`) acts on.

### Segment 2 — `Now: <the piece>`

What the run is on right now, in plain words — "the booking page", never `T-07`
(`references/audience.md`, the naming convention). It is read from **documents a
spec-protocol project actually writes**, and from no other shape:

1. `CONTROL/project_state.json` → `.phase`. In the `spec-protocol/project-state@1` schema
   (`references/documents.md`) that field is `"<current task id>"`, written by the conductor
   at station 15 of every revolution; `references/worked-example.md` carries real values
   (`"phase": "T-07"`, `"phase": "T-03"`).
2. `CONTROL/CHECKLIST.md` (document 2, the planner), then `CONTROL/TODO.md` (document 3, the
   orchestrator) → the line where that same id sits next to the sentence a person would say
   out loud. The reader takes the first line carrying the id with an OPEN box (`- [ ]`), else
   any line carrying it, strips the list marker, the box, the id itself, and the punctuation
   that joined them, and shows what is left.

`phase` is a free-text string, so a phase that is already a plain phrase is shown as it
stands and no lookup is needed.

**Why it is written this way (1.18.0).** The first 1.18.0 draft of this segment searched
`project_state.json` for any nested object carrying a `plain_name`/`name`/`title` plus an
`IN_PROGRESS` status. No writer in the skill produces that shape — it is not in the
`project-state@1` schema, not in `anchor.sh`, not in the worked example — so the segment
could only ever render against a fixture built to match the reader. That is the same defect
class as the pre-1.18.0 Wave bar reading `FIX-LEDGER.md` (§4G E5), and it is not repeated:
every source named above is a real document with a named writer in
`references/documents.md`, and the fixture test below is built to the documented schema
rather than to the reader.

**Guardrails (binding):**

- No state file, no `phase`, and no line in `CHECKLIST.md` or `TODO.md` naming it → the
  segment is OMITTED. A name is never manufactured from a file path or a heading, and the
  head of `CONTROL/TODO.md` is never shown on its own — that is what comes NEXT, not what is
  happening now; `TODO.md` is consulted only to put words to the id `phase` already names.
- A bare identifier never reaches the bar. If `phase` names a task neither document carries,
  and the phase is not itself plain words, the segment stays off — an unnamed unit is a
  naming-convention defect upstream, not something to render. A project always has
  `CHECKLIST.md` (document 2 is written by the planner before the first task runs), so this
  is the empty-project case, not the normal one.
- The id is matched literally (`grep -F`) and removed literally, so an id carrying a regex
  metacharacter can never turn into a pattern.
- Byte-wise character classes only when trimming: the separator between id and name is
  usually an em dash, and this bar often runs under a C locale.

**The fixture test (built to the documented schema, never to the reader).** A `CONTROL/`
holding a `project_state.json` that conforms to `project-state@1` with `"run_status":
"RUNNING"`, `"phase": "T-07"` and `tasks.counts` `{pending:20, in_progress:6, completed:14}`,
a `CHECKLIST.md` carrying `- [ ] T-07 — the booking page`, a `TODO.md` with no open question
or escalation, and a `HEARTBEAT.md` stamped two minutes ago, renders exactly:

```text
Working ✓ 2m ago | Now: the booking page | 14 of 40 pieces (35%) | Needs you: nothing
```

Point `phase` at a task neither `CHECKLIST.md` nor `TODO.md` carries and the same bar comes
back WITHOUT the `Now:` segment, every other segment still standing — that is the guardrail
working, and it is what proves the test discriminates rather than always passing.

### Segment 3 — `n of N pieces (p%)`, and `Getting ready: step n of 9` before it

**Derivation — disk truth only, never conversation memory.** The statusline script reads
`CONTROL/project_state.json` (schema `spec-protocol/project-state@1`,
references/documents.md). `n` = `tasks.counts.completed`; `N` = `pending + in_progress +
completed`; `p` = `n × 100 / N`, integer — the SAME counts the reconciler audits. The script
is a reader; it never invents numbers and never trusts a stale memory of progress.

**Before the plan exists** there is nothing to count, and `0%` would be a lie about a
project that has not been planned yet. The conductor writes `CONTROL/setup_progress.json`
at each step of the nine-step setup flow, and this segment reads that instead. One line,
exactly this shape:

```json
{"step":4,"of":9}
```

Both fields are integers; `of` defaults to 9 if absent or non-numeric. The file is written
by the conductor as it enters each step, is never read back by anything but the bar, and is
simply left behind when the plan lands — from the moment `project_state.json` exists the
pieces count wins and `setup_progress.json` is not consulted again.

**Guardrails (binding):**

- No `project_state.json` found anywhere on the walk → the pieces segment is OMITTED and
  `Getting ready: step n of 9` renders in its place when `setup_progress.json` is there.
  Neither file → both are omitted; showing 0% before the plan exists is fake progress. The
  pieces segment appears from the moment step 16.6 initializes the state file. A
  malformed/corrupt `project_state.json` behaves the same way — that segment drops and the
  rest of the bar still renders.
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

### Segment 4 — `Needs you: k` / `Needs you: nothing`

The count of open items in `CONTROL/TODO.md` that are waiting on a person: the reconciler's
`OPERATOR-ESCALATION` rows and the questions the orchestrator parked for a human (document
3 — "the questions waiting on a human with your recommendation"). An UNCHECKED box that
names `OPERATOR-ESCALATION` or `QUESTION`, or asks something with a question mark, counts.

**Guardrails (binding):**

- A checked box never counts. An answered question is history, not a demand on the client.
- Zero waiting items renders the word `nothing`, spelled out — the answer to "is anything
  waiting on me" is a word, not a bare `0` the reader has to interpret.
- No `CONTROL/TODO.md` → the segment is OMITTED, never a cheerful zero. A missing to-do
  list is not proof that nothing needs the client.
- This segment is the client's half of the escalation path. The other half — the ledger
  row, the flag file, the tick's exit code — belongs to `references/anti-drift.md`; the bar
  only counts.

### The wave bar (fix executions and wave-shaped runs)

When a wave-shaped run is in progress — the fix execution of the master spec, or any run
whose ledger carries wave lines — the status line adds a wave segment:

```text
… | Wave 3 ██░░░░░░░░ 20%
```

**Derivation.** The script looks for `CONTROL/LEDGER.md` at `$cwd/CONTROL/LEDGER.md` first,
then at the **git repo root of `$cwd`**. That is the ledger spec-protocol projects actually
write (document 6). Before 1.18.0 it read a fix-execution ledger no project ever writes, so
this segment could never render for a client — the fix is the filename, and the census that
guards it is a count of the old name in the installer, which must be zero. It NEVER falls
back to a hardcoded absolute path to a named project — a ledger outside the project you are
in is ANOTHER project's status, and rendering it here is a false report.

**The ten-block bar is eleven prebuilt literals, printed whole.** It is never built by
translating spaces into block characters with `tr`: that pipeline maps a byte at a time and
corrupts a multi-byte block character under a C locale, which is a locale a status line
often runs in. A literal string printed with `%s` is locale-proof.

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

1. *The bar that could never clear.* The old hardcoded `$HOME/work-999-setup/` ledger
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

The wave bar and the pieces segment coexist: the wave bar answers "how long until THIS wave
is done", the pieces segment answers "how long until THE PROJECT is done".

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
✓ Working / Now / pieces segments visible
✓ Needs you visible
✓ Wave progress visible (wave-shaped runs)
✓ Task tracking available

Claude-nine
✓ Status line visible
✓ Working / Now / pieces segments visible
✓ Needs you visible
✓ Wave progress visible (wave-shaped runs)
✓ Task tracking available
```

## 8. Installation checklist (spec §15)

```text
[ ] Claude Code launches successfully
[ ] Existing Claude settings remain intact
[ ] Status line appears
[ ] Working ✓ Nm ago tracks the newest line in CONTROL/HEARTBEAT.md
[ ] Now: <piece> names the in-progress unit in PLAIN WORDS, never an identifier
[ ] n of N pieces (p%) matches CONTROL/project_state.json tasks.counts
[ ] Getting ready: step n of 9 renders BEFORE the state file exists
[ ] Needs you reads a count, or the word "nothing" at zero
[ ] Wave progress visible when wave lines exist (wave-shaped runs), read from CONTROL/LEDGER.md
[ ] NO model name, NO cost figure, NO git branch anywhere on the bar
[ ] Context usage NOT displayed to the client (internal doctrine only — operator order 2026-08-16)
[ ] 5h/7d usage NOT displayed to the client (internal doctrine only)
[ ] A heredoc-extract diff between the installer and the deployed script is empty
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
| Status line missing everywhere | `disableAllHooks` set | remove it — it also kills every governance hook (PART 4 hook-protection clause) |
| Only the managed line shows in safe mode | safe mode displays policy statusLine only | exit safe mode |
| 5h/7d segments absent | not a subscriber / first API response not yet seen / 9Router session | omit is correct behavior, not a fault |
| Model, cost or git segment expected but absent | all three were removed from the client bar in 1.18.0 | absence is correct; there is nothing to restore, and no money figure is computed at all |
| Bar blank everywhere | `jq` not on PATH | the deployed script prints nothing rather than a wrong bar; install `jq` and re-run the installer, which refuses with one plain sentence and exit 2 without it |
| Every segment absent below the project root | no `CONTROL/` directory found anywhere from `$cwd` up to `$HOME` | omit is correct if truly outside a Spec Protocol project; if inside one, confirm the walk reached the directory that holds `CONTROL/` |
| `Working` absent while agents are running | no `CONTROL/HEARTBEAT.md`, or agents append instead of upserting through `ledger.sh` | fix the writers (document 13); the bar never invents a heartbeat |
| `Now` absent while a unit is in progress | no unit in `project_state.json` carries an IN_PROGRESS status with a name | the bar never manufactures a piece name; give the unit its plain name |
| `Getting ready` never appears | the conductor is not writing `CONTROL/setup_progress.json` at each flow step | one line, `{"step":n,"of":9}`, written on entering each step |
| Blocks render as `?` or mojibake | a terminal or font without the block glyphs | the bar itself is locale-proof (eleven prebuilt literals); this is a font problem, not a script one |

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
