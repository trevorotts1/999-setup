# Kaizen scheduling — the decision engine and the launchd path

Scheduling has two pieces:

1. **Decision engine** — `scripts/common/kaizen-schedule.mjs`. Parses a
   requested cadence, classifies it, and prints a structured recommendation
   (mechanism, clarification question when needed, cloud eligibility,
   machine/session requirements).
2. **macOS launchd machinery** — the scripts under `scripts/macos/` that
   actually install, run, control, and remove a durable local schedule.

Do NOT oversimplify to "short = /loop, long = /schedule". Run the engine and
report its output.

## The decision engine

```text
node scripts/common/kaizen-schedule.mjs '<interval-input>' [--json-context '<json>']
```

Inputs it parses (case-insensitive): `5m`, `20m`, `1h`, `3d`, `every week`,
`weekly`, `every 30 days`, `monthly`, `every 90 days`, `quarterly`,
`first day of every month`, `every Monday at 9 AM`, plus generic `<n><unit>`
forms (`30m`, `2h`, `12d`, `90s`, `every 6 hours`, ...).

Output: structured JSON with `requested_cadence`, `normalized_interval`,
`cadence` (`exact_elapsed` or `calendar`), `clarification_required`,
`clarification_question`, `recommended_mechanism`
(`/loop` | `desktop-task` | `cloud-schedule` | `launchd` | `manual`),
`reason`, `machine_on_required`, `open_session_required`, `local_file_support`,
`cloud_eligible`, `cloud_ineligible_reason`, `preserves_9router`,
`skill_availability_required`, `expires_after_seven_days`, `expiry_days`,
`actual_cadence`, and a plain `explain` sentence. Unparseable input: exit 2
with an error JSON.

Context JSON keys (`--json-context`): `user_accepts_cloud`,
`target_available_from_cloud_clone`, `no_local_only_files`,
`kaizen_available_in_cloud`, `requires_local_9router`, `uses_claude_nine`,
`session_will_stay_open`, `durable`, `requested_mechanism`,
`desktop_task_available`. When `--json-context` is absent every cloud
condition defaults to false, so `cloud_eligible` is false.

### Decision rules (implemented in code, not just prose)

1. `/loop` only for session-based work: intervals under ~1 hour AND
   `session_will_stay_open=true` in the context. `machine_on_required=true`.
   Recognized short-interval inputs include `/loop 5m`, `/loop 20m`, and
   `/loop 1h`, run as:

   ```text
   /loop 5m /kaizen run <loop-id>
   /loop 20m /kaizen run <loop-id>
   /loop 1h /kaizen run <loop-id>
   ```

   Every 3 days (72h exact) is a durable multi-day cadence and is never
   routed to `/loop`.
2. `/loop` recurring tasks expire after seven days. `expiry_days=7` is
   reported whenever `/loop` is recommended, and `/loop` is NEVER recommended
   as a permanent schedule for multi-day cadences (`3d`, weekly, monthly,
   quarterly → never `/loop`).
3. Cloud `/schedule` is eligible only when ALL of the context flags hold:
   `user_accepts_cloud=true`, `target_available_from_cloud_clone=true`,
   `no_local_only_files=true`, `kaizen_available_in_cloud=true`,
   `requires_local_9router=false`. ANY false → `cloud_eligible=false` and
   `cloud_ineligible_reason` names the failing condition.
4. If the user asked for a cloud Routine but cloud is ineligible, the
   recommended mechanism is NOT `cloud-schedule` and
   `clarification_required` is set with the reason.
5. NEVER recommend a cloud Routine when `kaizen_available_in_cloud=false` —
   it would later report "skill not found". The reason says so. Never create a Routine that will later say the skill is not found.
6. `preserves_9router`: true for launchd, `/loop`, desktop-task, and manual;
   for `cloud-schedule` only when `requires_local_9router=false` AND the user
   explicitly accepted. A 9Router user is never silently moved to cloud: if
   `uses_claude_nine=true` and cloud is eligible, clarification asks
   "local 9Router or cloud?".
7. "monthly" / "every 30 days" is ambiguous: clarification asks
   "Exactly every 30 days, or once each calendar month?" (plain-language
   variant: "Exactly every 30 days, or about once a month?"). Either way
   the durable mechanism is launchd; the cadence class (exact_elapsed vs
   calendar) follows the answer.
8. "every 90 days" / "quarterly": same treatment —
   "Exactly every 90 days, or once each calendar quarter?".
9. "first day of every month" → calendar monthly, Day=1, WITHOUT
   clarification.
10. "every Monday at 9 AM" → calendar weekly (Weekday=1, Hour=9, Minute=0),
    `machine_on_required=true`.
11. When a request is mapped to something slightly different (30 days →
    calendar month, 90 days → calendar quarter), `actual_cadence` states the
    real schedule and `reason` discloses the mapping.

## Interval mapping

- **Every 5 minutes / 20 minutes / hour (short active session):** `/loop 5m`,
  `/loop 20m`, `/loop 1h` — but only when the session will stay open.
  Explain: "This is a fast check, so I can use a temporary loop while Claude
  stays open."
- **Every hour forever:** do NOT automatically choose `/loop`. Decide from
  cloud vs local, 9Router, machine availability, local files.
- **Every 3 days exact (72h):** durable scheduling; do not fake with a
  calendar expression that resets at month boundaries. Never `/loop`.
- **Every week:** calendar scheduling is natural.
- **Every 30 days:** ask "exactly every 30 days, or about once a month?"
  Recommend monthly for a normal business cadence.
- **Every 90 days:** ask "exactly every 90 days, or once each quarter?"
  Recommend quarterly when that matches intent.

## Current Claude Code constraints (verify against live docs when in doubt)

- `/loop` is session-scoped and has one-minute granularity.
- Recurring `/loop` tasks expire after seven days.
- Resuming an unexpired session can restore its scheduled task.
- Cloud Routines created with `/schedule` persist independently and run
  remotely.
- Cloud Routines do not automatically see a personal skill that exists only
  in the local `~/.claude/skills/`.
- Desktop scheduled tasks run locally and see local personal skills.
- Cloud execution does not automatically inherit local 9Router routing from
  `claude-nine`: a cloud Routine will not automatically use the local 9Router model.

## The macOS launchd path (tested)

For Macs needing durable `claude-nine` automation without Claude Desktop:

- `launchd` LaunchAgent, one job per Kaizen Loop;
- deterministic label `com.blackceo.kaizen.<short-loop-id>`;
- exact elapsed schedules use `StartInterval` (seconds);
- calendar schedules use `StartCalendarInterval` with these defaults
  (overridable via `--hour/--minute/--weekday/--day`):
  - weekly → `{ Weekday: 1, Hour: 9, Minute: 0 }` (Monday 9:00)
  - monthly → `{ Day: 1, Hour: 9, Minute: 0 }`
  - quarterly → `{ Month: [1,4,7,10], Day: 1, Hour: 9, Minute: 0 }`
- job invokes the correct launcher (`--launcher`, default `claude-nine`);
- job loads the Loop by Loop ID;
- job contains no secrets.

### Install

```text
scripts/macos/install-kaizen-launchagent.sh <loop-id> <interval> \
  [--calendar weekly|monthly|quarterly] [--launcher claude-nine] \
  [--hour H] [--minute M] [--weekday W] [--day D]
```

`interval` is `daily | weekly | monthly | quarterly | 90days | <seconds>`.
The generated plist is validated with `plutil -lint` (install fails if lint
fails; skipped only when `plutil` is missing AND dry-run). All inserted
values are XML-escaped. The scheduler state (mechanism, label, plist path,
cadence, interval, calendar flag) is stored atomically in the loop's
`LOCAL_STATE.json` under `scheduler`. Re-installing unloads the old job and
rewrites the plist (idempotent).

Dry-run: `KAIZEN_LAUNCHD_DRY_RUN=1` writes the plist into the (fake) HOME
LaunchAgents directory, skips `launchctl`, prints `dry-run`, and does NOT
touch `LOCAL_STATE.json` (it prints what would be written).

### Run

`scripts/macos/run-kaizen-cycle.sh <loop-id> [--launcher X]` resolves the
loop dir via `kaizen-state.mjs locate-loop`, falling back to the registry
root and then `resolve-kaizen-root.sh`; fails only when no path has a
`STATE.json`. It runs the launcher with a natural-language prompt (NOT a
slash command):

```text
Use the kaizen skill. Run one approved Kaizen cycle for Loop ID <loop-id>.
Read its Kaizen Contract and Kaizen Memory first. Follow the approved
Contract exactly. Do not merge or deploy. Update Memory and record fresh
proof.
```

Working directory is `local_target_path` from `LOCAL_STATE.json` when set
and present, else the loop dir. The skill path is exported as
`KAIZEN_SKILL_DIR` (explicit env, then `~/.claude/skills/kaizen`, then the
script's own repo location). Each run records `cycles/launchd-run-<ts>.json`
(started_at, ended_at, launcher, exit_code, result ok/failed, log path)
next to the raw `cycles/launchd-run-<ts>.log`. Exit code mirrors the
launcher — exit 0 only when the launcher exited 0. On failure a
`scheduler_failure` entry `{at, exit_code, log}` is appended to
`LOCAL_STATE.json`; only the log path is printed, never the log contents.
A held cycle lock (via `kaizen-state.mjs is-locked`) → skipped JSON, exit 0.

Logs live under `cycles/`; keep them out of version control via the memory
`.gitignore` (the memory initializer owns that file — add
`**/cycles/*.log` and `**/cycles/*.json` there).

### Control and removal

```text
scripts/macos/kaizen-launchagent-ctl.sh <loop-id> <status|disable|enable|reinstall>
```

- `status` → JSON `{installed, label, plist_path, loaded, last_run_from_local_state, enabled}`;
- `disable` → `launchctl unload -w`, `LOCAL_STATE.json scheduler.enabled=false`;
- `enable` → `launchctl load -w`, `scheduler.enabled=true`;
- `reinstall` → re-runs the install script with the stored interval and
  calendar flag.

`scripts/macos/remove-kaizen-launchagent.sh <loop-id>` is idempotent:
unloads, deletes the plist, and clears the `scheduler` field from
`LOCAL_STATE.json` only when the plist was actually removed. Both scripts
respect `KAIZEN_LAUNCHD_DRY_RUN=1` (print-only, no launchctl, no state
changes).

## Windows fallback

Do not regress Windows. Parity via Task Scheduler / `schtasks` with the same
state contract (`LOCAL_STATE.json` holds the task identifier). Mac is the
required primary path.

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
skill availability. If the engine says clarification is required, ask the
question before installing anything.
