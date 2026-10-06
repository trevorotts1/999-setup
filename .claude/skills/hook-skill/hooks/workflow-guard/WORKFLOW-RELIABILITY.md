# Visible workflows and stale work supervision

This operating addendum applies to authorized skill repair programs executed with Claude Code or Claude Nine. It governs the coding conductor, not the presentation product's separate job engine. Install and prove supervision before implementation waves. Do not ask the same unsupervised workers to build the only mechanism that will supervise them.

## 1. Hard capacity contract

Never exceed TEN concurrently active agents in one workflow. Count builders, QC, repair and any agent acting as coordinator. A plain JavaScript workflow script and this Python observer are not agents and do not consume model seats. Sequential pipeline stages reuse a lane: ten builders followed individually by ten reviewers means twenty lifetime calls, at most ten active calls. Do not confuse those counts.

UNDER A SWARM PLAN THE DOCUMENT DECIDES THE NUMBERS. When a plan (schema blackceo.swarm-plan/v2) is found from the working directory (`.spec-protocol.json` swarmPlan, `SWARM-PLAN.json`, or `claude-nine-swarm/SWARM-PLAN.json`), the plan says how many workflows run at once (policy.max_active_workflows) and how many agents each has (agent_count = min(cap, len(units)), where cap is the box's measured per-workflow cap (RAM, cores, Docker/Hostinger limits; at most 10; 10 on the operator's Mac), recorded as policy.max_agents_per_workflow and produced by capacity_probe.py; leftover keys builders, checkers, repair_extra_executions_max, max_total_executions are rejected). Launch each workflow with `make-workflow.py --plan <plan> --workflow-id <id> --out-dir <dir>` and call Workflow with exactly the launch object it writes (scriptPath plus args.workflowId and args.units); the hooks refuse any other launch, any hidden Agent/Task build, and a stop while planned workflows are owed. A workflow is done only when its verdict file exists and says PASS. The three maximums below are ceilings a plan may not exceed; they are never targets and never a floor. WITHOUT A PLAN, this paragraph applies: useful width = min(measured per-workflow cap (at most 10; 10 on the operator's Mac), measured host limit, available provider slots after reserves, independent ready units). Use all available useful lanes. If 23 units are ready with ten usable slots per workflow, prepare three visible workflows with 10, 10 and 3 lanes; launch concurrently only when the shared provider/host budget can accommodate all 23. A ten-slot ACCOUNT limit means these three cannot collectively use 23 simultaneously. Capacity is shared across other sessions and programs; do not multiply a provider quota by the number of workflows. Never invent provider capacity from plan names, RAM alone, a model list, or an advertisement.

One unit moves from build to independent QC as soon as its own build finishes. Do not wait for all other builders. Necessary cross-unit dependencies remain prerequisites. File ownership must be exclusive or isolated. Maximum ten active agents per workflow, maximum fifty workflows per program, and all lower actual limits still apply. Maximums are ceilings a plan may not exceed; under a plan, run the plan's own agent counts and its own number of concurrent workflows.

## 2. Installed components

The implementation lives at ~/.claude/hooks/workflow-guard:

- validate.mjs uses pinned Acorn 8.15.0 for static parsing. It never evaluates submitted scripts. It checks literal metadata, explicit model/label/phase, matching phase names, deterministic code, and a conservative concurrency bound. Unknown or mutable fan-out is rejected with a repair message; the generator is the supported fallback.
- guard.py is registered for Workflow prelaunch, postlaunch/failure, session start, task-output polling, and stop feedback in BOTH ~/.claude/settings.json and ~/.claude-nine/settings.json. Existing hooks remain installed.
- make-workflow.py creates tested immutable pipeline scripts and launch JSON. It calculates slices from real input. It does not itself launch workflows or claim they are visible.
- The prelaunch hook snapshots the validated script and uses updatedInput to launch the same bytes. It does not grant permission or change the chosen models.
- The observer records IDs, hashes and counters in state/guard.sqlite3. It does not store provider credentials or copy prompt/output contents into alerts.
- The Mac LaunchAgent com.blackceo.workflow-watchdog runs a bounded observer tick every 30 seconds. STATUS.md and alerts.json contain its current findings; health.checked proves the tick ran.

The static checker deliberately accepts a restricted, measurable JavaScript subset. Multiple sequential pipelines may be conservatively over-counted; split into separately visible workflows or use the generated per-unit pipeline. Do not disable the gate to make unfamiliar JavaScript pass. Nested workflow() calls and hidden helper spawning are excluded. A worker with a recognized agent_id in a guarded session is prevented from using Agent, Task or Workflow to spawn descendants; missing host identity is a capability gap that must be reported, never treated as proof enforcement occurred.

## 3. Generate and launch correctly

Pass an existing JSON file containing an array, an object with units: [...], or an existing launch object with args.units. Each ready unit needs id, prompt, qcPrompt and ownership (all nonempty strings). Do not extract units with python -c or a shell pipeline; the generator reads these shapes directly. No duplicate IDs. Prompts must name the task-specific acceptance tests and actual repository/worktree. Never put credentials into the file.

Run:

    python3 ~/.claude/hooks/workflow-guard/make-workflow.py --units /ABSOLUTE/units.json --out-dir /ABSOLUTE/generated --provider-slots 10 --reserve 0 --program program --wave 1 --run-root /ABSOLUTE/run-root

Replace capacity numbers with measured remaining capacity; provider-slots is the allocation to this invocation before reserve subtraction, not an assumed whole-account entitlement. Default model roles are Opus builder and independent Sonnet reviewer. Explicit --builder and --reviewer overrides must resolve to different available models. This template performs build and QC; failed QC goes to a separate repair unit with the opposite model performing the next QC. It does not automatically merge, release or waive a failed test.

The output must be a DIRECTORY, never a filename ending .json/.js. The generator rejects filename-shaped output paths and refuses to overwrite different existing artifacts. Use a new output directory for revised units. Read every launch-NN.json AND its referenced workflow-NN.js into the same session, then call the actual native Workflow tool with that JSON as its input. New scripts embed their unit data and launch JSON contains only scriptPath. Generator stdout also provides the exact launch object; copy that object, not the surrounding status receipt. No separate args are needed. Keep generated files under that session's working directory or an explicitly added directory. The hook passes the validated source inline to avoid an inaccessible snapshot path. For legacy scripts, args should be a real JSON value. The compatibility hook decodes a single JSON string and can recover missing args from the exact matching sibling launch-NN.json only when its canonical scriptPath matches the submitted script. Malformed/double-encoded arguments remain blocked. This recovery never launches additional workers. Submit ready independent root workflows without waiting for another root to complete when global capacity permits. Keep each agent's phase and model explicit. Do not replace native workflows with Markdown trees, a directory of scripts, ordinary hidden shell jobs or untracked Agent calls.

The prelaunch validator must return success. After the Workflow call, record its actual Task ID and Run ID. Open /workflows in the SAME interactive host session and verify the name, phase groups, labels and actual worker activity. A headless successful launch proves execution only, not graphical rendering. Record visibility evidence separately. If the tool is absent or rendering fails, label VISIBILITY_UNVERIFIED, investigate the host, and do not claim the requirement passed.

Before a large wave, execute one read-only ALIVE canary in each launcher actually used. Then execute a ten-lane synthetic canary, confirm peak <=10 and useful parallel starts, and inject a null builder to prove its unit remains incomplete. No production edits or provider-heavy work are needed for the canary. A provider/authentication failure leaves the live acceptance check incomplete; synthetic tests are not a substitute. Use the host's /hooks view to verify effective registrations; an already-running session may need its settings reloaded or a controlled resume after a checkpoint. Do not stop the user's active session just to reload settings.

## 4. Independent stale work checks

The installed observer reads workflow journals independently of the conductor. It warns after five minutes without new journal progress and raises STALE_REVIEW_REQUIRED after ten. It also reports missing/unreadable journals, malformed events and launches without a matching successful return receipt. It checks existing registered work even if the main agent is blocked. TaskOutput waits longer than 60 seconds are reduced to 60 seconds so the conductor can reassess work.

A workflow journal is coarse evidence: a returned agent is useful to reconcile, but it is not proof of a passed feature. The observer does not know whether a long-running test/provider job is legitimately active. It does not automatically kill, resume or duplicate workers. It provides local alerts and event-hook feedback; it cannot inject a message into an indefinitely hung or disconnected model. Do not label this a fully autonomous restart supervisor.

Read state/STATUS.md at every conductor checkpoint and at least once per minute while waiting. Stop and TaskOutput hooks surface new alert states when the host processes those events. A Stop hook issues at most one continuation request per alert fingerprint and honors stop_hook_active to prevent an infinite stop loop. This is never permission to disregard a user cancellation, exhausted approved budget or a required approval.

When an alert appears, the conductor must: identify the run and pending unit; inspect the actual worker/task state, recent tool output, provider job ID, dependencies and expected stage duration; preserve returned results; determine whether to extend a legitimate operation, correct a dependency, or stop a confirmed failed worker using the host's supported task control. Confirm that the old writer stopped before replacing it. Resume only unfinished work and preserve idempotency for external actions. Limit automatic retries to two with backoff. Keep unrelated ready work and eligible repo batch trains moving. Report the reason, action, owner and next check to the user.

A verified successful TaskStop is a terminal cancellation, not a stale worker to resurrect. The post-tool hook recognizes supported TaskStop receipts for tracked launches. For legacy runs, verify the original stop receipt before using guard.py resolve --journal /ABSOLUTE/journal.jsonl --reason 'verified receipt and task ID'. This resolves only monitoring; it never certifies task QC. Do not clear alerts merely to make the dashboard green.

## 5. Required stronger supervisor in each repair packet

Every future packet must include IMPLEMENTATION-SUPERVISION.md, mapped TODO/QC entries and a SUPERVISOR-ACCEPTANCE.json receipt before W0 advances. Extend the observer with the actual host's supported control/event APIs where full unattended recovery is required. Do not pretend the current journal-only observer implements these additional requirements:

1. Track per-unit lease owner/generation, workflow/task/agent IDs, heartbeat_at, last_useful_progress_at, last artifact/test evidence, stage-specific deadline, blocking reason, provider job ID, retry count and next action. A heartbeat alone cannot renew useful progress indefinitely.
2. Validate global permits against provider, container and host limits. Fence a revoked writer before handing the same unit to another agent. Enforce the shared ten-agent ceiling across nested descendants or disable nested spawning.
3. Run the supervisor outside model workers. It must continue checking when the conductor is waiting and expose its own health. Detect an overdue supervisor tick. On Linux use a user systemd timer; inside Docker use a supervised sidecar/process with persisted state and supported control access. Do not assume cron/systemd exists inside a container. On Mac use launchd.
4. Reconcile actual workers and durable state transactionally. Preserve cancellation, legitimate long operations and completed external side effects. Bound repairs and retries; escalate with evidence when the host cannot safely recover automatically.
5. Separate worker returned, feature QC passed, wave accepted, batch merged and release published. Update checklist projections from exact revision evidence, never from confidence or a process exit code alone. New commits invalidate old QC/merge candidates.
6. Report each accepted wave immediately and automatically start the next eligible wave. Report blocked/recovering transitions promptly and useful progress at least every five minutes. Keep one independent 20-minute batch train per affected repository; respect exact-SHA QC and cross-repository compatibility.

Acceptance must inject invalid syntax, missing model/phase, eleven agents, shared-provider exhaustion, null result, legitimate long test, stale heartbeat, crashed conductor, missing journal, canceled worker, duplicate completion, stale QC SHA and supervisor downtime. Prove only one writer owns a resumed unit and no canceled work restarts. Record actual IDs, timestamps, observed cap and evidence files. A checkbox or hook exit 0 is insufficient.

## 6. Goal and completion requirements

Every goal visibly starts with /goal and points to this addendum. Keep the entire command under 4,900 characters and below the installed host's smaller actual limit. Require supervisor readiness before the main waves; reconcile existing progress rather than restarting W0; keep all original task, QC, batch merge and release obligations. Do not add a standing instruction that overrides future user cancellation.

Complete only after all scoped fixes pass their mapped QC, all required commits are on every affected remote main, versions/README/changelog/tags are aligned, GitHub releases are published, installed-path acceptance is proven, and final ledger/queues have no unexplained work. An observer installation is not proof the presentation department itself is fixed or released.

## 7. Verification and rollback

Run python3 ~/.claude/hooks/workflow-guard/test_guard.py and node ~/.claude/hooks/workflow-guard/test-runtime.mjs. The runtime test uses mocks and is labeled as such. Live host canary receipts remain separate.

Use launchctl print gui/$(id -u)/com.blackceo.workflow-watchdog to inspect the installed Mac service. Its StartInterval is 30 seconds. Inspect state/watchdog.stderr.log on errors. Other hosts must install their own supervised schedule with their actual Python/Node paths; /opt/homebrew paths are Mac-specific.

Before any rollback, preserve evidence. LATEST-BACKUP.txt points to the original settings snapshots. Remove only the hook entries whose command contains workflow-guard/guard.py; preserve unrelated or subsequently added settings. Unload only com.blackceo.workflow-watchdog if reverting this observer. Do not restore an entire old settings file over unrelated new changes. No repository merge or release is needed for this local hook installation unless a later authorized packaging task adds it to a repository.

## 8. Input error prevention (September 8 repair)

- Python SyntaxError at backslash-quote: a shell-generated Python expression was over-escaped. Use the original units JSON directly with --units. Do not keep retrying extraction one-liners. The hook cannot repair arbitrary shell commands before Python executes them; eliminating that preparation step is the fix.
- Is a directory at launch-01.json: --out previously interpreted the supplied filename as a directory. Use --out-dir /ABSOLUTE/generated-wave1; read /ABSOLUTE/generated-wave1/launch-01.json. Existing mistaken directories are preserved because an active session may still reference them.
- Cannot measure pipeline items: the old script used args.units but the actual launch omitted args or supplied JSON as text. Regenerate a self-contained script with the current helper. Compatibility handling also repairs the two observed legacy inputs before validation. Never bypass the concurrency validator.

After generation, status VALIDATED_NOT_LAUNCHED means generation/preflight succeeded; no worker has started yet. Only a successful native Workflow receipt and observed worker activity establish execution. The generic generator is a Build/QC template and forbids merges in its builder prompt; do not use it unchanged for a batch-merge unit. Retain the program's separate merge-train implementation.
