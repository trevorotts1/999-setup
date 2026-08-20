# Kaizen scheduling engine — choose the scheduler that will actually work

Do NOT oversimplify to "short = /loop, long = /schedule".

## Current Claude Code constraints (verify against live docs when in doubt)

- `/loop` is session-scoped.
- `/loop` has one-minute granularity.
- Recurring `/loop` tasks expire after seven days.
- Resuming an unexpired session can restore its scheduled task.
- Cloud Routines created with `/schedule` persist independently and run
  remotely.
- Cloud Routines do not automatically see a personal skill that exists only
  in the local `~/.claude/skills/`.
- Desktop scheduled tasks run locally and see local personal skills.
- Cloud execution does not automatically inherit local 9Router routing from
  `claude-nine`.

## Decision inputs

1. requested interval;
2. how long the Loop should live;
3. whether an open session is acceptable;
4. whether local files are required;
5. whether the 9Router/`claude-nine` model route must be preserved;
6. whether Kaizen is available in the remote cloud session;
7. whether Claude Desktop local scheduling is available;
8. whether the target is accessible from a cloud clone;
9. whether the user wants exact elapsed intervals vs calendar cadence.

## Path A — `/loop`

Use when: work is intentionally session-based; the user expects Claude Code
to remain open; the Loop duration is under the seven-day expiry window (or
the user understands it must be rearmed); local files/current session
context matter; the interval is one minute or greater.

Examples:

```text
/loop 5m /kaizen run <loop-id>
/loop 20m /kaizen run <loop-id>
/loop 1h /kaizen run <loop-id>
```

Kaizen must remain model-invocable (never `disable-model-invocation: true`)
for `/loop` iterations to invoke it.

Interval rounding: Claude may round intervals that do not map cleanly to
cron-like scheduling. If the actual schedule differs from the request, tell
the user exactly what was selected.

## Path B — Claude Desktop local scheduled task

Prefer when: scheduling must survive restarts; local files are required; the
machine can remain on at run time; the same local personal Kaizen skill
should load; the user wants local 9Router/`claude-nine` behavior where
supported by the task environment.

If the CLI skill cannot create the Desktop task programmatically, give
precise one-time instructions, or use Path D if the user authorizes
automated local scheduling.

## Path C — cloud `/schedule` Routine

Use ONLY when ALL of these hold:

- durable cloud execution is desired;
- the target repository is accessible to the Routine;
- no required local-only files/tools;
- the user accepts remote/cloud execution;
- Kaizen will be available in the cloud run by one of: skill synced to the
  claude.ai account, Kaizen committed to the target repo's
  `.claude/skills/`, or a repo-declared plugin that supplies it;
- the user does NOT require the local 9Router route for the recurring run.

Never create a Routine that will later say "skill not found".

### Cloud warning for 9Router users (plain language)

> "A cloud schedule keeps working when your Mac is off, but it runs in
> Claude's cloud. It will not automatically use the local 9Router model
> behind `claude-nine`. If you want to keep using that local route, I should
> use a local schedule instead."

## Path D — macOS launchd fallback (tested)

For Macs needing durable `claude-nine` automation without Claude Desktop:

- `launchd` LaunchAgent, one job per Kaizen Loop;
- deterministic label `com.blackceo.kaizen.<short-loop-id>`;
- wrapper script stored under the Loop's local Memory folder (or a stable
  999-managed helper directory);
- job invokes the correct launcher;
- job loads the Loop by Loop ID;
- job contains no secrets.

Use `scripts/macos/install-kaizen-launchagent.sh`. Conceptual invocation:

```text
claude-nine -p "Use the kaizen skill. Run one approved Kaizen cycle for loop <loop-id>. Read its Kaizen Memory first. Follow its Contract exactly."
```

Do not assume an interactive slash command executes correctly inside `-p`.
Test the actual invocation shape at install time (`scripts/macos/run-kaizen-cycle.sh`
does a dry-run validation) and use the trigger description so the skill is
auto-selected reliably.

Restart behavior: a properly installed LaunchAgent persists across
user-session restarts and is reloaded according to macOS behavior. Test
installation, listing, disable, re-enable, and removal with
`scripts/macos/remove-kaizen-launchagent.sh` (the install/remove
scripts are idempotent).

## Windows fallback

Do not regress Windows. Parity via Task Scheduler / `schtasks` with the same
state contract (`LOCAL_STATE.json` holds the task identifier). Mac is the
required primary path.

## Interval mapping

- **Every 5 minutes / 20 minutes / hour (short active session):** `/loop 5m`,
  `/loop 20m`. Explain: "This is a fast check, so I can use a temporary loop
  while Claude stays open."
- **Every hour forever:** do NOT automatically choose `/loop`. Decide from
  cloud vs local, 9Router, machine availability, local files.
- **Every 3 days exact (72h):** durable scheduling; do not fake with a
  calendar expression that resets at month boundaries.
- **Every week:** calendar scheduling is natural.
- **Every 30 days:** ask "exactly every 30 days, or about once a month?"
  Recommend monthly for a normal business cadence.
- **Every 90 days:** ask "exactly every 90 days, or once each quarter?"
  Recommend quarterly when that matches intent.

## Activation language

The user may not know how to run `/loop` or `/schedule`. Offer to do the
setup:

> "I can turn this on for you now. If you would rather do it yourself, I can
> also give you the exact command."

If manual: give the exact command; name the Terminal launcher; if
`claude-nine`, say so; never say "configure cron" without exact steps.
Example:

> "Open Terminal, type `claude-nine`, then paste
> `/loop 20m /kaizen run <loop-id>`."

Only show a command that has been validated for the actual scheduler and
skill availability.
