# Kaizen recovery and resume

Kaizen Memory is the primary continuity mechanism. Never make the system
dependent on one giant Claude transcript.

## Named interactive session

For setup and hands-on work, use a friendly session name where practical:
`kaizen-<loop-short-id>`. Claude Code supports named session resume such as:

```bash
claude --resume kaizen-my-website
```

The `claude-nine` launcher forwards normal CLI arguments, so when the session
was actually created through `claude-nine`, the recovery command is:

```bash
claude-nine --resume kaizen-my-website
```

Same pattern for `claude-9` and `claude-codex` (which forwards args to
`claude-nine`). Only use the launcher the session was actually created
through.

## Do not promise a named resume handle unless it was actually set

If Kaizen cannot programmatically rename the active interactive session,
instruct the user one time:

```text
/rename kaizen-my-website
```

Then save the friendly name. Never invent a session ID. If an exact session
ID is available, store it ONLY in `LOCAL_STATE.json`.

## `/loop` recovery

If the loop is still within the seven-day expiry window, resuming the session
can restore the scheduled task. `RESUME.md` should say this plainly:

> "If your Mac restarts, open Terminal and type
> `claude-nine --resume kaizen-my-website`. If the temporary loop has not
> expired, Claude can restore it. If it expired, `/kaizen resume` will
> rebuild it from Kaizen Memory."

## Durable local scheduler recovery (LaunchAgent / Desktop)

- The same session does not need to remain open.
- Memory is the continuity layer.
- `RESUME.md` explains how to check the task status.
- `/kaizen run <loop-id>` always permits a manual cycle.
- `/kaizen resume [loop]` rearms scheduling from Memory.

## Cloud Routine recovery

No local terminal session needs to remain open. Say that clearly.

## RESUME.md required contents (per Loop)

1. What to type after a restart (exact command, correct launcher).
2. Whether the schedule restarts automatically.
3. Whether the machine must be on.
4. Whether the original Claude session needs to be resumed.
5. How to run one cycle manually (`/kaizen run <loop-id>`).
6. Where Memory lives (exact path).
7. How to see status (`/kaizen status <loop-id>`).
