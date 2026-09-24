# Enforcement — the standards, and the six instruments that check them

SKILL.md states the rules in one sentence each and names the script that
enforces them. This file is where the roster lives: the six instruments, what
each one decides, and the S-table they and the conductor walk. Nothing here is
client-facing.

**The rule this file exists to keep:** a standard with no instrument is a
standard nobody checks. Every S-number below is either owned by a script named
here, or it is explicitly the conductor's to walk by hand on the same five-minute
cadence — there is no third category, and no standard is unassigned.

---

## 1. The six instruments

| Instrument | What it decides | How it is called | Exit codes | Selftest | Node twin (bash absent) |
|---|---|---|---|---|---|
| `tools/width.sh` | The MEASURED width of THIS machine: `CLIENT_CAP = max(2, min(16, cores−2, floor((ram_gb−6)/1.5)))`, plus `BROWSER_CAP` and `WORKFLOW_CEILING=50`, each with the instrument that answered | `bash tools/width.sh` at step 6.5; sourced by `tools/capacity-resolver.sh` | 0 a width was printed (measured, or the marked fallback); 2 NEITHER instrument answered | `bash tools/width.sh --selftest` — three fixtures (12c/24GB → 10, 8c/16GB → 6, 24c/64GB → 16) and the no-instrument case | `node scripts/common/width.mjs` |
| `tools/dispatch-check.sh` | Whether a wave may fire: `floor = min(units, CLIENT_CAP)` (the skill owns the floor; the harness owns the ceiling), and whether the dispatch is padded past the work | `bash tools/dispatch-check.sh <project> <units> <agents> <label> [dep=…] [stages=<n>]` BEFORE the wave | 0 PASS (row written through `ledger.sh`, `agents.executions_total` incremented atomically); 3 UNDER-WIDTH; 5 PADDED; 2 TOOLING FAILURE | `bash tools/dispatch-check.sh --selftest` | `node scripts/common/dispatch-check.mjs` |
| `tools/watch-tick.sh` | The five-minute state of the swarm: it reconciles, counts runnable units and open dispatch rows, and checks S2, S3, S5, S6 and S13 | `*/5 * * * * bash <skill>/tools/watch-tick.sh <project> --log <project>/CONTROL/watch-tick.log`, written and announced at step 3, the moment `CONTROL/` exists | 0 clean (one `S-CHECK \| violations=0 \| runnable=<n> open=<n> trees=<n>` line); 3 findings, one `ACTION\|<verb>\|<target>\|<evidence>` line each; 4 `CONTROL/TERMINAL-DRIFT.flag` exists — nothing dispatches; 2 broken instrument, never an all-clear | `bash tools/watch-tick.sh --selftest` — ten fixtures, read-only | `node scripts/common/watch-tick.mjs` |
| `tools/anchor.sh` | Drift: the three-way reconcile (manifest ↔ native task graph ↔ `project_state.json` ↔ the artifacts on disk), the repeated-intent alarm, the budget audit, the recovery ladder, and the pause-at-cap decision | `bash tools/anchor.sh <home> <unit-or-IDLE> --mode reconcile --tasks CONTROL/task-graph-snapshot.json --state CONTROL/project_state.json` before every dispatch, at every wave boundary, at every tick, after every compaction | 0 clean; 3 alarm with `RECONCILE-ACTIONS`; 4 TERMINAL-DRIFT (the run stops dispatching) | `bash tools/anchor.sh --selftest` | — |
| `tools/ledger.sh` | That a state change is written before the next action: locked, atomic (`.tmp` + rename under a lock), append-only, with upsert-in-place for `HEARTBEAT.md`; and that the line carries its own origin — the WRITER OF RECORD supplies the ISO8601Z clock to any record that arrives without one (a caller's own stamp is kept, never doubled) and signs it ` | writer=ledger.sh` (§5) | `bash tools/ledger.sh <home> <file> <line> [upsert-key]` at every claim, result, score and check | 0 written; non-zero the write did NOT happen — never assume it did | `bash tools/ledger.sh --selftest` | `node scripts/common/ledger.mjs` |
| `tools/speech-check.sh` | Whether a drafted client message may be spoken: it refuses the banned token classes (paths, workflow ids, rule numbers, document names, trends, money, model names, operator headings, scratch paths, backup announcements, jargon) | `bash tools/speech-check.sh <draft> --home <project>` before every client-visible message — SKILL.md RULE 5 owns the procedure, `references/audience.md` §7 the rule | 0 CLEAN; 3 REJECT, classes named; 2 UNDETERMINED; 4 selftest failed | `bash tools/speech-check.sh --selftest` | — |

**A gate whose selftest fails is a BROKEN INSTRUMENT.** Do the arithmetic by
hand, write that fact in the ledger, and never read a broken instrument's
silence as a pass. A zero an instrument cannot prove is written UNDETERMINED.

### The two halves of the five-minute tick

- **The cron half never depends on the model.** The crontab line above keeps
  ticking through a compaction, a crashed session, a context reset and a
  sleeping operator. It never dispatches: a script cannot call session tools. It
  proves the state and writes it down.
- **The model half is the conductor's in-session `/loop 5m`,** on the same
  command, reading the `ACTION|` lines the tick printed (they are in
  `CONTROL/watch-tick.log` too) and doing the dispatching. Command-shaped, never
  free-form — the cron-tick contract is `references/workflows.md` §7.

Either half alone is a partial machine: a tick nobody reads changes nothing, and
a conductor with no tick is the run that drifted. `references/loops.md` Loop 9
owns the loop; this file owns the roster. A missing `S-CHECK` line within two
intervals (10 minutes) means the tick itself stopped — the tick is itself
governed, and its absence is a finding.

### The gate on the gate

`tools/hooks/dispatch-gate.py` is a PreToolUse hook on `Workflow` in both
settings stores. It parses the script's `pipeline(` / `parallel(` item count and
its label and refuses, before the tool runs, an under-width dispatch and the four
forbidden shapes (`parallel(build)` then `parallel(qc)`; a judge phase with fewer
judges than landed units; a tree passing fewer units than the dispatchable set
allows without a `dep=` reason; a merge agent inside a build tree). Its wiring,
its exit codes and its selftest are `references/workflows.md` §13. This skill
never removes, disables or weakens a governance hook, and `disableAllHooks` is
never set.

### SHAPE 7 — the write-ahead booking rule

**The rule:** every tree is booked BEFORE it fires. `tools/dispatch-check.sh`
runs before every wave and writes the `CONTROL/dispatch-log.md` row for the whole
tree's declared agent count; a launch with no such row written in the last 120
seconds is refused. A research reader (one agent, phase research, no build label)
is exempt from booking. `tools/hooks/dispatch-gate.py` points here.

**SHAPE 7 and the residual limit it does NOT cover (written down, not hidden).**
The same hook refuses a launch whose DECLARED agent count — summed across every
stage, so a three-stage tree over ten units is thirty, not ten — is not booked by
a `CONTROL/dispatch-log.md` row written in the last 120 seconds, and its message
names both numbers (`declared=<n> booked=<n>`, or `booked=none`). That makes
SKILL.md §5's write-ahead rule mechanical: `tools/dispatch-check.sh` books the
whole tree write-ahead and rolls the booking back if the row fails to land, so
`agents.executions_total` is exact for every dispatch that CALLS it — on
2026-09-07 ten stage-2 verifiers never called it, and the counter read 6 while 17
agents had run. **The limit: the count is exact for a tree's DECLARED width at
launch and CANNOT see an agent an already-running workflow spawns internally,
because a PreToolUse hook fires once per launch, not once per inner agent.** There
is no harness agent journal to fall back on — the per-session transcript under
`~/.claude/projects/` is a session record keyed by working directory, not a
per-agent ledger, and nothing here is built on it. So `tools/anchor.sh`'s
dispatch-log census stays the cross-check: `agents.executions_total` against the
sum of the `agents=` fields in `CONTROL/dispatch-log.md`. **A divergence between
the two is a FINDING — an unbooked dispatch, named and reconciled — never a
rounding error, and never absorbed silently.**

---

## 2. Who owns which standard

| Owner | Standards |
|---|---|
| `tools/watch-tick.sh` (every five minutes, cron half) | S2, S3, S5, S6, S13, and the `group-abort` alarm (RC-26: two or more agents of one dispatch row ending at an identical timestamp with no completion record — evidence-only, no S-number, like the speech check; wired to `tools/anchor.sh` recovery-ladder rung 1) |
| `tools/dispatch-check.sh` + `tools/width.sh` (before every wave) | S1, S4 |
| `tools/anchor.sh` (every reconcile) | S10, S14 |
| `tools/ledger.sh` (every write) | the provenance half of S15 — the mark is written with the value |
| The conductor, by hand, on the same five-minute cadence | S7, S8, S9, S11, S12, S15, S16, S17, S18, S19 |

The conductor's ten are not weaker standards; they are the ones no script can
see. This table is their only roster, and a run that cannot show its walk of
them has not walked them.

---

## 3. The S-table

Every dispatch is QC'd every five minutes, by an instrument and never by memory.

| Standard | Check | Violation response |
|---|---|---|
| **S1 — Workflow count** | Number of running workflows ≥ number of independent streams with runnable work | Launch missing workflows immediately |
| **S2 — Zero-workflow** | Runnable work exists AND zero workflows running | EMERGENCY — dispatch all runnable work in the same turn |
| **S3 — Prefix visibility** | Every running workflow carries a visible [MODEL xN] prefix | Kill and re-launch without prefix |
| **S4 — Width arithmetic (fail-closed, 2026-08-14; units, not pairs, since S3 2026-09-07)** | Each running tree's item count equals its dispatch-log arithmetic: the UNITS passed to the tree's `pipeline()` call (the build and judge stages are stages of the SAME unit, never a second half of the width), up to the MEASURED clientCap per workflow (10 on this 12-core, 24 GB machine — clientCap = max(2, min(16, cores−2, floor((ram_gb−6)/1.5))), computed by the CLIENT-MACHINE PROBE at step 6.5); the harness owns the ceiling, this check owns the floor — count the items passed in the script, never agents on screen | VIOLATION — the next dispatch for that stream is re-authored to the arithmetic; repeated under-width is logged with the ledger line cited |
| **S5 — Idle capacity** | No capacity sits idle while dispatchable work exists | Dispatch immediately |
| **S6 — Heartbeat freshness** | Every running workflow's heartbeat is fresh (≤10 min for build/QC, ≤20 for merge) | Staleness is a reconciliation signal, not death: query the applicable Workflow or Agent-Team identity through its host driver; proven absent → retire/re-dispatch from slice, proven live → retain, unknown → escalate without replacement |
| **S6 — Tick liveness (the enforcer ran at all)** | `CONTROL/LEDGER.md` carries at least one `S-CHECK` line, and its newest one is no older than two intervals (10 min) — the tick is armed at step 3, the moment `CONTROL/` exists, so a run that reaches handover with zero `S-CHECK` lines never had an enforcer | FAILS S6 — a run whose ledger carries zero `S-CHECK` lines at handover has a broken enforcer: the handover does not fire on it, the fact is said plainly, the tick is armed, and the first `S-CHECK` line is proven before handing over |
| **S7 — One-tree check** | If ≥2 independent streams exist and only 1 workflow tree is visible | VIOLATION — decompose and re-dispatch as N workflows |
| **S8 — Item flow** | Items are moving through the lifecycle independently (not all items blocked at the same stage) | Log bottleneck stage; investigate dependency graph |
| **S9 — Inline-work ban** | No build artifact was edited by the conductor itself: every landing commit has a prior dispatch-log row, and the conductor's own working tree is clean of build files. (Doctrine #2, Level 1: the Team Lead's primary job is ORCHESTRATION — it does NOT personally implement.) | VIOLATION — the unit is re-done by a dispatched agent; the violation is logged; the inline edit is quarantined |
| **S10 — Drift anchor / reconcile** | The conductor's last ledger entry carries a fresh RE-ANCHOR stamp AND the last reconcile pass (tools/anchor.sh --mode reconcile) is no older than the reconcile interval and returned clean or corrected; CLASS 7 (ledger provenance) paired every RESULT unit against a prior CLAIM for the same unit id — a RESULT without its claim is a violation | Run tools/anchor.sh now; if it alarms, stop dispatching and reconcile before anything else; on TERMINAL-DRIFT (exit 4) the run STOPS; an unpaired-claim alarm means missing BEFORE-the-unit CLAIM lines — write them and re-run — see references/anti-drift.md |
| **S11 — Terminal-chore ban** | No user-facing text produced this session instructs the client to open a terminal window (outside the labeled last-resort rung of references/terminals.md) | VIOLATION — the instruction is retracted and replaced with the skill doing the thing itself (references/agent-team.md) |
| **S12 — Worker visibility** | Every build/fix/QC dispatch is workflow-wrapped (visible in `/workflows`); any raw Agent-tool dispatch (research, probe, named fallback) has a dispatch-log row with its purpose and a reap deadline | VIOLATION — log it now, wrap the next dispatch, reap anything running unlogged |
| **S13 — Finished-but-alive reap** | No agent whose output is on disk and whose task has no next instruction is still running (the 2026-08-14 canary's research agent burned 13h of CPU spinning after it finished) | Reconcile the actual Workflow or Agent-Team identity before TaskStop; only the proven matching live process may be stopped, while unknown identity is retained and escalated |
| **S14 — Repeated intent** | No agent is announcing repeatedly while progressing never: K consecutive stated-intent lines (default `ANCHOR_INTENT_K=5`) whose shared token core is ≥60% of the average line, with no new named artifact, no finding, and an unchanged state fingerprint (tools/anchor.sh, exit 3) | `DRIFT-ALARM \| REPEATED-INTENT` — same escalation path as a terminal stall; the agent is stopped and re-dispatched with a concrete next artifact, never left to re-announce (references/anti-drift.md) |
| **S15 — Ledger provenance** | Every Capacity Ledger value carries a provenance mark with a timestamp | Log the bare value as a defect; treat it as ASSUMED until marked |
| **S16 — Media spend gate** | Every gated-family media generation has a matching MEDIA-CONSENT line BEFORE dispatch, and every media batch has a MEDIA ledger line with a cost estimate (references/media-pipeline.md, references/capacity.md 13.8) | A gated dispatch without consent is a defect of the highest class — stop the media lane, report; an unestimated batch is dispatched only after its estimate is written |
| **S17 — Media persistence** | Every media work item marked done carries `stored=` and a `perm-url=` whose read-back proof exists (`persist-proof=`), and NO provider-host URL appears in any deliverable, spec document, generated code, or the shipped app. The deny-set is built mechanically and fail-closed from the run's OWN ledger — every URL recorded in a `provider-url=` field, plus the provider result hosts this run actually observed — so it needs no maintained host list and cannot silently rot. **The pipeline step is ONE unit, never split (Issue 10 FIX step 2 — the time-bounded ordering contract, references/media-pipeline.md 13.1): generate → poll to `state=success` → parse `resultUrls` → download → upload to GHL → read-back → ledger line, in the same step; the GHL upload is the ONLY step that turns a temporary URL into a permanent asset (result URLs expire in 24h, files in 14d, download links in 20 min)** | A done item without a verified permanent URL reverts to GENERATED-CAPTURED/PERSIST-PENDING and is not merge-eligible; a provider URL found in a deliverable is a defect — replace it with the ledger's permanent URL before the pen; an ASSET-LOST-PAID line missing from the completion report is a defect of the highest class; **an item left at "generated, URL in ledger" with the GHL upload deferred is fail-closed STOPPED on that item — the temp URL will expire overnight and the spend is already gone** |
| **S18 — Video duration fit** | Every video work item's requested duration is validated against the seated model's duration×RESOLUTION table at SPEC time — as a pair, never on either axis alone — and every video estimate prices the BILLED unit, not a pro-rata second (references/media-pipeline.md 6d, references/capacity.md 13.8) | An item dispatched past its ceiling, or estimated on pro-rata seconds where the unit is a block, is a defect; a multi-clip parent without a stitch-or-gap answer (ffmpeg detected by execution, or NEEDS-JOINING declared) is not dispatchable |
| **S19 — Orphan accounting (1:1:1)** | Generated = manifest = uploaded; references may be N, each counted. Every generated image has exactly one manifest row and exactly one upload (or an honestly marked gap). Shared-asset rule: one manifest row, one generation, one upload, N references — all N counted, zero uncounted. Zero orphans in either direction: no generation without a manifest row (UNTRACKED-GENERATION), no manifest row without a generation (UNGENERATED-MANIFEST-ROW — a marked gap, never a silent drop), no upload without a reference (UNREFERENCED-UPLOAD), no reference without a counted row (UNCOUNTED-REFERENCE). Ledger classes the sweep reads: `MANIFEST-ROW`, `IMAGE-GENERATED`, `GHL-URL`, `IMAGE-REF` (references/media-pipeline.md §10.1) | VIOLATION-STOP on the media lane — each orphan named by class and file; the lane resumes only when every orphan is reconciled or honestly gapped |
| **Group-abort (no S-number, RC-26)** | Two or more agents of one dispatch row ending at an identical timestamp with no completion record — the canary's three WAVE4 builders sharing one end stamp. Read off `CONTROL/HEARTBEAT.md` (a killed agent's line freezes, so one event shares one last stamp) against `CONTROL/dispatch-log.md` (the row's `run=` id) and the ledger's RESULT set | `DRIFT-ALARM \| group-abort \| row=<run-id> agents=<n> at=<ts>` (`tools/watch-tick.sh`, exit 3) plus `ACTION\|reconcile-native-identity` — the conductor first reconciles each actual Workflow/session/run or Agent-Team identity through its host driver. Only a proven-absent identity may be re-BOOKED through `tools/dispatch-check.sh` from its checkpoint; live or unknown identities are retained/escalated. Honest limit: this detector does not prove process death. |

---

## 4. The status contract and the completion contract

**THE STATUS CONTRACT (2026-08-14 — the canary's stall-impression fix, binding).**
Any status message while the pipeline is mid-flight states, in this order:
(1) WHAT IS RUNNING NOW — each lane with its own progress as counts (n/N units;
a timer is never progress); (2) WHAT IS GATED ON WHAT; (3) WHAT REMAINS before a
link can exist; (4) PERCENT DONE, a number computed from the task graph's
completion conditions. A scoreboard of finished lanes with no still-running
header reads as a halt, and that reading is the reporter's defect. Token
counters are reported honestly: the session's bottom-bar token figure is the
WHOLE session's total, never one agent's — never present it otherwise.
**THE COMPLETION CONTRACT:** the handover fires only when all four stop
conditions hold — every unit at HEAD, zero build errors, an independent QC PASS
whose ten-category score is at least 8.5 and whose mandatory behavior, scope,
evidence, and comparison checks all pass, and the target-specific release proof
(served URL only for a target that promises one; otherwise artifact/native-harness proof). Until
then, RUNNING is the default state to report.
**THE CLIENT-FACING FIRST LINE (binding).** The four-part contract above is the
OPERATOR's status. Any status message a CLIENT sees opens instead with one line
of exactly this shape, and it is the FIRST line, always:

> Still working: 14 of 40 pieces done, 6 being checked right now, nothing waiting on you. Next: the contact page.

The counts and the "Next:" are this run's real ones, read from the task graph and
`CONTROL/CHECKLIST.md` — never rounded, never remembered. A SECOND line follows
only when there is genuinely something for the client, and says what it is.
Nothing else is spoken to the client as status: no lanes, no ledger lines, no token counters

---

## 5. Atomic ledger writes — the anti-drift contract

Every state transition writes to the ledger atomically via `tools/ledger.sh`
before the next action. A crash resumes from the last ledger line. Never proceed
past an unlogged state change. Structured git queries only for provenance and
ancestry (Law 12). Read-only access to external systems. Never print a secret
value; confirm credentials by name only.

**The anti-drift contract (binding — see `references/anti-drift.md` for the full
ritual, the reconciler, and the terminal-drift stop):** the ledger is written
BEFORE each unit (the claim) and AFTER it (the result) — never only at the end. A
heartbeat line must CARRY STATE (counts by status, current unit, next item); a
contentless "auto-tick" heartbeat is a banned write — on the operator's real
ledger, 740 of 2,366 lines (31%) were contentless ticks and the longest run of
them (139 lines, ~7 hours) was the TAIL of the file: the run drifted and never
came back. **The contract is mechanically checked on every reconcile: the
ledger line shapes are `<ISO8601Z> | CLAIM | unit=<id> | agent=<label> |
model=<role> | plan=<one line>` (BEFORE the unit) and `<ISO8601Z> | RESULT |
unit=<id> | PASS|FAIL|BLOCKED | evidence=<path or anchor>` (AFTER it); the
conductor writes both through `tools/ledger.sh`, append-only, never only at
the end of a run. `tools/anchor.sh --mode reconcile` CLASS 7 pairs every
RESULT unit against a prior CLAIM for the SAME unit id and alarms
`unpaired-claim` (exit 3, `ACTION|write-missing-claims`) when RESULT units
exceed `ANCHOR_CLAIM_UNPAIRED_TOL` (default 3) with no CLAIM — the ledger
failing as the single source of truth; an absent ledger is UNDETERMINED, and
an IDLE reconcile claims nothing. A run that ledgers only on completion has
no state to resume from at the moment it most needs one.**

**`tools/ledger.sh` is the WRITER OF RECORD — the clock and the signature
(binding).** A ledger line has to carry two facts about its own origin, and
before this neither was anyone's job: `ledger.sh` appended the caller's string
verbatim, so a caller that supplied no timestamp produced a clockless line and
no reader anywhere complained. One real project ledger reached 30 lines
carrying exactly ONE timestamp while the control project, same instrument and
same day, carried 254. So the writer now supplies both:

- **The clock.** A RECORD line whose first line does not already begin with an
  ISO8601Z gets `<ISO8601Z> | ` prefixed to it, taken under the lock so the
  recorded time orders with the file. A line that ALREADY carries its own
  ISO8601Z keeps it byte-for-byte — `tools/anchor.sh`, `tools/dispatch-check.sh`
  and `tools/speech-check.sh` each stamp every line they write, and stamping
  those again would put two timestamps on every line those three tools have
  ever produced. On a multi-line payload only the FIRST line is stamped; the
  rest is the payload's own body.
- **The signature.** ` | writer=ledger.sh` is appended, so a line the tool wrote
  is distinguishable from one typed in by hand.
- **The one shape that gets neither, and why it is not a softening.** This
  script is the write primitive for ALL project MD files, `CONTROL/TODO.md` and
  `CONTROL/CHECKLIST.md` included, and there a line's SHAPE is its meaning: a
  markdown checklist row, heading, table row, rule, blockquote or blank line is
  written byte-for-byte. Every reader of those rows is anchored to the row start
  — `anchor.sh:770` clears the TERMINAL-DRIFT stop only on a `^`-anchored
  `- [x] BLOCKER-NAMED |` row, `anchor.sh:1691` writes
  `- [ ] OPERATOR-ESCALATION | …` to `CONTROL/TODO.md` through this very script,
  and the open/done census at `anchor.sh:835`/`:843-844` is anchored too — so a
  stamp in FRONT of a row would make the drift stop unclearable and hide the
  escalation the ladder just wrote. The rule is stamp every RECORD, not stamp
  every line.

**`tools/anchor.sh` CLASS 8 (`ledger-unstamped`) is the reader half.** Every
reconcile counts the non-tick RECORD lines in `CONTROL/LEDGER.md` that carry no
ISO8601Z prefix, raises `DRIFT-ALARM | ledger-unstamped(n=<count>)` at exit 3
when that count exceeds zero, emits
`ACTION|route-writes-through-ledger.sh`, and reports
`ledger-stamped(records=…/unstamped=0/structure=…)` when it is clean — the
verdict rides in the RECONCILE line's `classes=` field exactly as the budget
classes do, so the five-minute tick reports it either way. Its census MIRRORS
the writer's own shape rule, so the two agree by construction. **It is a
DETECTION and never a repair:** not one line is rewritten, back-dated,
re-ordered or removed, and no future version may do so — rewriting a ledger's
history is precisely what a ledger must never do, and a back-dated line is a
worse artifact than a clockless one because it looks trustworthy. A run that
finds old unstamped lines REPORTS them and leaves them standing. **The fix is
the writer, never the file.** An absent ledger, or a census that could not run,
is UNDETERMINED naming the path — never a silent zero and never a pass.

At every wave
boundary, at every cron/loop tick start, after every
compaction, and before every dispatch, the conductor runs `tools/anchor.sh
--mode reconcile` — the three-way reconciler (manifest ↔ native task graph ↔
project_state.json ↔ the artifacts on disk, RECONCILE TASKS NOW, addendum §12).
A tick RECONCILES; it never merely appends a heartbeat. Cron and loop prompts are
COMMAND-SHAPED, never free-form — a free-form tick re-plans from decayed memory,
which is how runs drift. The cron half is the script on its crontab line and the
model half launches by `Workflow({scriptPath})`; the contract for both is
`references/workflows.md` §7, and the `ultracode` keyword does NOT start
workflows from a scheduled-task prompt (Claude Code ≥ 2.1.210). Every
loop's precondition #0 checks `CONTROL/TERMINAL-DRIFT.flag`: while it exists,
nothing dispatches — the flag is the capture-proof stop a drifted conductor
cannot tick through. The five-minute tick (`tools/watch-tick.sh`, §1)
reconciles the live ledger against the plan on every cycle. A violation stops the
violating workstream the same cycle: the tick prints one
`ACTION|<verb>|<target>|<evidence>` line carrying the exact finding, exits 3, and
the workstream restarts from its last clean checkpoint — the checkpoint rules
in `CONTROL/project_state.json` (the seven moments, the
`checkpoint/<slug>-<NNN>` tag scheme, and the `best_stable_build` pointer;
`references/pipeline.md` Checkpoints, `references/execution-architecture.md`
§11). One cycle, one outcome: an ACTION list plus checkpoint restart, or
`S-CHECK | violations=0`. The conductor reads the ACTION lines at every dispatch
point and reconciles its actual Workflow/session/run or Agent-Team identity
through the host driver. Only a proven-absent identity may be retired and
re-dispatched from that checkpoint — never a silent re-plan.
`CONTROL/TERMINAL-DRIFT.flag` remains the capture-proof stop: while the flag
exists the tick exits 4, nothing dispatches, and no restart happens — a stop is
lifted only by naming the blocker in `CONTROL/TODO.md`, which clears the flag on
the next reconcile (references/anti-drift.md §6).

**The five-minute tick enforces all of it.**
The instrument is `tools/watch-tick.sh <project>` (crontab `*/5 * * * *`, log
`CONTROL/watch-tick.log`, installed and announced at step 3, the moment
`CONTROL/` exists, and proven again before handover). It reconciles the
live ledger against the plan every cycle and holds stop/restart authority: on
violation it prints one `ACTION|<verb>|<target>|<evidence>` line naming the
workstream and the exact finding, and exits 3; the conductor reads those lines at
every dispatch point and MUST stop the named workstream, then re-dispatch it from
its last clean checkpoint the right way. `CONTROL/workflow-pids.json` remains for
out-of-process runs. On clean it appends one
`S-CHECK | violations=0 | runnable=<n> open=<n> trees=<n>` line through
`tools/ledger.sh` — every pass carries the count, even when it is zero. A missing
`S-CHECK` line within two intervals (10 minutes) means the tick itself stopped —
the tick is itself governed, and its absence is a finding. `bash
tools/watch-tick.sh --selftest` runs its ten fixtures on demand and refuses to
report clean when its own controls fail (exit 2, BROKEN INSTRUMENT). The
hook-protection clause (§1) binds: this skill never removes, disables, or
weakens the tick's crontab entry or any governance hook, and `disableAllHooks` is
never set on the operator box.

---

## 6. Where the rest of the doctrine lives

- The width formula, the Capacity Ledger and the seat table — `references/capacity.md` §3, §4, §11.
- The one swarm shape and the forbidden shapes — `references/gauntlet.md` §13.1.
- The dispatch gate's hook wiring, the script-validation rules and the cron-tick contract — `references/workflows.md` §5, §7, §13.
- The reconciler, the drift classes, the recovery ladder and TERMINAL-DRIFT — `references/anti-drift.md`.
- Loop 9, the loop register and the survival loops — `references/loops.md`.
- The client-facing status bar the tick's counts feed — `references/progress-visibility.md`.
