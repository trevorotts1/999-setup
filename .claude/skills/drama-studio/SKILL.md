---
name: drama-studio
description: >
  Drama Studio pairs this computer with the client's Drama Studio and runs the
  startup check that tells Claude Code an order is waiting. Use it to pair a new
  computer with a one-time code, to show or open the client's studio link, or to
  run the check that the SessionStart hook and the heartbeat job call. Pairing is
  one command, studio.py pair ABCD-2345. It prints the studio link, stores a
  per-machine key on this computer alone, and never prints that key. The key
  lives in ~/.drama-studio/machine.key, folder permission 700 and file permission
  600, and it is never written into any settings file. The check, studio_check.py,
  asks the studio whether an order is waiting and prints at most one line: Drama
  Studio, one order waiting, then the order title and the hint to type
  /drama-studio to start it. The startup hook passes --hook; it answers only a
  real start, never a resume or a clear, and it is silent on every error with
  exit status zero. It keeps the whole hook inside ten seconds, the network call
  inside three, it skips the network when the last check was less than sixty
  seconds ago, and it announces an order once per order per session. A desktop
  notice is off unless the client asks for it. The whole thing ships as a
  skills-folder plugin, so the hook lives in this folder, the two script
  permissions live in this skill's allowed-tools, and nothing is written to any
  settings.json. The skill root and the protected state are separate: the root is
  ${CLAUDE_PLUGIN_ROOT}, the state is ~/.drama-studio, and the two never mix.
  Option 1 waits for this hook, Option 2 keeps a session open with --watch, and
  Option 3 is a background run that stays off until Trevor approves that client by
  name.
allowed-tools: Read, "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/studio.py *)", "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/studio_check.py *)"
---

# Drama Studio (999-setup, unit U13)

The Claude Code and claude-nine half of the drama studio: **pair**, **link**, the
**SessionStart check-in hook**, the **opt-in desktop notice** and the **Option 2
watcher**. It ships as a **skills-folder plugin**: the hook loads from
`hooks/hooks.json` inside this folder, and the installer writes **nothing** to any
`settings.json` (decision 11 answered 2026-10-09).

It is a skill folder and two scripts, not a product: no framework, no bundler, no
scheduler, no dashboard, no new management app.

## Ownership — disjoint paths

| Unit | Owns |
| --- | --- |
| **U13 (this unit)** | `999-setup/.claude/skills/drama-studio/**` — the pair/link command, the check-in script, the hook, the manifest, this document and the prover |
| U14 | the Option-2 watcher's own behaviour, on top of `studio_check.py --watch` |
| U15 | the heartbeat job (launchd/Task Scheduler) that calls `studio_check.py --desktop` |
| U16 | `option3_runner.py` — the Option-3 background run, shipped **off**; a named approval is required before it does anything |
| U12 | the pairing/admin **pages**; this unit calls `POST /api/studio/pair` |
| U2 | the service this unit talks to; never edited here |

Every path this unit creates is inside `.claude/skills/drama-studio/`.

## What it talks to — U2's measured contract

Read from `service/README.md` on `openclaw-onboarding` and verified against the live
code. The shapes this unit sends and reads:

| Route | Caller here | Request | Response it reads |
| --- | --- | --- | --- |
| `POST /api/studio/pair` | `studio.py pair` | `{ code, computer_name, os, tools }` | `201 { ok, client_id, key, tools }` — the key appears once |
| `POST /api/studio/checkin` | `studio_check.py` | header `x-ds-key`, `{ orders: true }` | `{ ok, checked_in_at, line }` — `line` is `DRAMA_ORDER r_123 "Spring Sale"` or `null` |

A refusal is always `{ ok: false, code, message }`. The presented key travels in the
`x-ds-key` header, never in a query string.

## The four rules this unit owns

1. **Startup only, once per order per session.** `--hook` reads the hook JSON on
   stdin and answers `source == "startup"` alone. A resume or a clear prints nothing.
   The dedup marker is `(order id, session id)` in the protected state, so the same
   order cannot announce twice in one session and a later session may show a
   still-waiting order once.
2. **Desktop notice only on request.** Off by default. `--desktop` returns without a
   notice unless the state says the client opted in, and it fires once per order.
4. **Silence on error.** Any error — a timeout, a refused connection, an unreadable
   state — prints nothing and exits 0.
4a. **60-second cache.** A check younger than 60 seconds skips the network call.

The hook budget is **10 seconds**; the network budget is **3 seconds**. A copy that
overruns either is rejected: it prints nothing and still exits 0.

## State, root and allowed-tools

| Piece | Where | Who sets it |
| --- | --- | --- |
| Skill root | `${CLAUDE_PLUGIN_ROOT}` (the folder holding this file) | the plugin loader; a wrong root is refused with `AF-DS-ROOT` |
| Protected state | `~/.drama-studio/` (folder 700) | this unit; `machine.key` 600, `studio.url`, `state.json` 600 |
| allowed-tools | the frontmatter above | two script permissions (`studio.py`, `studio_check.py`) plus `Read` — nothing else |

The root and the state are deliberately different folders: the root is code, the
state is the client's machine. The key is in the state and never in a settings file,
because a launchd or Task Scheduler job cannot read a settings file anyway.

## Commands

```bash
python3 .claude/skills/drama-studio/studio.py pair ABCD-2345      # burn a one-time code
python3 .claude/skills/drama-studio/studio.py link --print        # show the studio link
python3 .claude/skills/drama-studio/studio_check.py --hook        # the SessionStart hook
python3 .claude/skills/drama-studio/studio_check.py --desktop     # the opt-in desktop notice
python3 .claude/skills/drama-studio/studio_check.py --print-root  # refuse a wrong root
```

## Runnable checks (real commands, real exit codes)

```bash
node --version >/dev/null 2>&1   # not required; this unit is Python only
python3 .claude/skills/drama-studio/prove/prove_plugin_behaviour.py
#   exit 0 = every check passed and every planted-bad control was caught
#   exit 2 = a named check failed, or a planted-bad control stayed green (vacuous)
#   exit 3 = the prover could not run
```

The prover exercises the real scripts in a temporary state folder under `/tmp`. It
**installs, loads or enables nothing**, registers nothing live, and never sends a
notice anywhere: the desktop sink is pointed at a scratch file.

## Option 3 — the background run, shipped OFF (U16)

Option 3 starts a run with nobody present, so it is the highest-risk mode and it ships
**off**. `option3_runner.py` does **nothing** until Trevor has approved that one client
**by name** and the studio admin page has recorded it in `~/.drama-studio/option3-approval.json`.
Until then `check` exits 0 silently: no order lookup, no lock, no child process, no spend.

```bash
python3 .claude/skills/drama-studio/option3_runner.py status      # off | named <client> cap <cap> root <root>
python3 .claude/skills/drama-studio/option3_runner.py plan        # print the one command it would run (refused while off)
python3 .claude/skills/drama-studio/option3_runner.py check       # the scheduled entry; silent while off
python3 .claude/skills/drama-studio/option3_runner.py print-job   # the launchd job as text; installs nothing
python3 .claude/skills/drama-studio/prove/prove_option3_runner.py # 8 checks, each with a planted-bad control
```

The runner owns five pieces, each stated here and proven by its own check: the
**scoped command** (exactly two script allow-rules plus `Read`, `--permission-mode dontAsk`,
`--permission-prompts none`, never the bare flag and never the bypass mode), the **lock**
(`~/.drama-studio/option3.lock.json`, one run at a time, a stale lock reclaimed), the
**per-run cap** (`--max-budget-usd` from the approval record; there is no default cap), the
**log receipt** (`~/.drama-studio/option3-runs/`, never the machine key) and the
**selected-root child environment** (the child runs in the approved root with
`DRAMA_STUDIO_SELECTED_ROOT` exported and no `CLAUDE_CONFIG_DIR` override).

It **installs nothing, loads nothing and writes no approval**. Installing the scheduled
job is the separately-approved, separately-owned step (JOINT PLAN U19 is the canary), and
production end-to-end waits on the runnable U18 bridge.

## Deliberate limits

- **No settings write, ever.** The hook is registered inside this folder only.
- **No version field here.** Per JOINT PLAN 5.3.2 the version bump and the CHANGELOG
  entry happen once, in the batch pull request.
- **No `/loop`, no polling `--watch` default.** Option 2's cost is reported, not
  silently replaced.
- `--watch` is the shared primitive; **U14** owns its dedup and its interactive
  fallback.
