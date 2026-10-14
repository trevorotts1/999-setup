---
name: drama-studio
description: >
  Drama Studio connects this computer to the client's Drama Studio, prints the
  client's personal link, and starts a drama order that is waiting — type
  /drama-studio and it shows the link, checks for an order, and starts the run.
  The client answers the questions on the phone, taps Lock it in, and the order
  appears here within about two minutes. Pairing is one command, studio.py pair
  ABCD-2345; it prints the studio link, stores a per-machine key on this computer
  alone, and never prints that key. The key lives in ~/.drama-studio/machine.key,
  folder permission 700 and file permission 600, and it is never written into any
  settings file. studio.py link prints and opens the personal link; link new makes
  a new one and the old link stops working at once. The startup check,
  studio_check.py --hook, answers only a real start, never a resume or a clear,
  stays inside ten seconds with the network call inside three, skips the network
  when the last check was less than sixty seconds ago, and is silent on every
  error with exit status zero. It announces at most one line: Drama Studio, one
  order waiting, then the order title and the hint to start it. A desktop notice
  is off unless the client asks for it. studio_bridge.py poll claims a waiting
  order atomically, replays the client's answers into a run folder, and prints the
  next factory command; factory.py of the sibling drama-song-ad-factory skill then
  drives the stages and the approvals. The whole thing ships as a skills-folder
  plugin: the hook loads from hooks/hooks.json, the Option 2 watcher from
  monitors/monitors.json, the script permissions live in this skill's
  allowed-tools, and nothing is written to any settings.json. The skill root and
  the protected state are separate: the root is ${CLAUDE_PLUGIN_ROOT}, the state
  is ~/.drama-studio, and the two never mix. Option 1 waits for the hook, Option 2
  keeps a session open with --watch, and Option 3 is a background run that stays
  off until Trevor approves that client by name.
allowed-tools: Read, "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/studio.py *)", "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/studio_check.py *)", "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/studio_bridge.py *)", "Bash(python3 ${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory/scripts/core/intake_preflight/factory.py *)"
---

# Drama Studio

The Claude Code and claude-nine half of the drama studio: the client's personal
link, the order check, the run start, pairing, the SessionStart hook and the
Option 2 watcher.

On Windows use `py` everywhere `python3` appears below.

## When you are invoked

The argument after `/drama-studio` picks the action. There is no other entry point
and there is never a status report unless the client asks for one.

### `/drama-studio` (no argument)

1. **Print the personal link and open it.** Run
   `python3 ${CLAUDE_PLUGIN_ROOT}/studio.py link` — it mints a link when the
   computer has none, prints `Your Drama Studio link: <url>` and opens it in the
   browser. The link is the client's own; opening it on this computer shows the
   page as the phone would (a QR code the client can scan). If it refuses with
   `AF-DS-PAIR-FAILED … pair this computer first`, this computer has never been
   paired: stop and run **`/drama-studio pair CODE`** below (step 2 would only
   say the same thing more quietly).
2. **Check for a waiting order.** Run
   `python3 ${CLAUDE_PLUGIN_ROOT}/studio_check.py --order` — a fresh check, no
   cache. It prints `ORDER <id> "<title>"`, `NO-ORDER`, or `NOT-PAIRED … pair it
   first` with exit status 3 when this computer has no studio address at all —
   in that case go to **`/drama-studio pair CODE`** below, do not report "no
   order waiting".
3. **An order waits → start it** (same as `start`, below).
4. **No order waits → one line, then offer the questions:** "Tap **Order a new
   video** on your studio page — or answer the questions here." If the client
   chooses to answer here, run
   `python3 ${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory/scripts/core/intake_preflight/factory.py card --step`
   one question at a time in the terminal, exactly as a Telegram client would
   answer, and lock the order in the same way.

### `/drama-studio link`

Print and open the personal link (`studio.py link`). No new link is made when one
exists.

### `/drama-studio link new`

Make a new link (`studio.py link --new`), print and open it. The old link stops
working immediately. Only do this when the client asks for a new link.

### `/drama-studio start`

1. `python3 ${CLAUDE_PLUGIN_ROOT}/studio_bridge.py poll --skill-root ${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory --runs <runs-dir>`
   — checks in, claims exactly one waiting order (atomic; a lost claim exits
   non-zero), replays the client's answers into the run folder with
   `factory.py card --step --run-dir … --reply r1 … --reply yes`, and prints one
   JSON line with the order id, the run folder and the next command.
2. Run the printed next command and continue the normal skill-75 stage loop with
   `factory.py next` until the first approval stop (script, song pick or
   storyboard), which is published to the studio page for the client to answer.

### `/drama-studio pair CODE`

One code, one time. The operator issues it and the client hands it over (the
install guide calls this the pairing code: four and four, `ABCD-2345`, no
look-alike characters). Ask the client to paste it straight from wherever they
received it.

1. `python3 ${CLAUDE_PLUGIN_ROOT}/studio.py pair <CODE>` — burns the one-time
   code, stores the machine key (600) in `~/.drama-studio/`, never prints it.
   **No `--studio` flag is needed.** The command finds the studio address on its
   own, in this order: `--studio URL` if given, then `DRAMA_STUDIO_URL`, then
   the address already stored in `~/.drama-studio/studio.url`, and finally this
   distribution's own address, `https://studio.zerohumanworkforce.com`. That
   last one is why the plain command above works on a computer that was never
   paired during install. It writes the address it used back to `studio.url`.
2. Then show the link: the pair step mints one when the computer has none and
   prints it; open it the same way as `link`.
3. **If it refuses.** Read the refusal — it is the whole instruction:
   - `AF-DS-PAIR-SHAPE` — the code is not four and four. Read it back to the
     client character by character; ask for it again.
   - `AF-DS-PAIR-FAILED` with a code name or an error type — the code was
     already burned, expired or never existed. Ask the operator for a fresh one
     and run the command again.
   - `AF-DS-PAIR-FAILED … this build carries no studio address` — only a build
     with no default address can say this. Ask the operator for the studio
     address and run the command once more with `--studio URL`, or set
     `DRAMA_STUDIO_URL` for this session. **Never invent an address**, and
     never hand the client an exit code as an answer: tell them in words that
     the pairing needs one more piece from the operator.
4. The code is consumed by this one call and is never printed back. Pairing this
   computer a second time needs a fresh code and writes a fresh key over the one
   already here, so only do it on the client's say-so.

The hook (`studio_check.py --hook`), the opt-in desktop notice, the Option 2
watcher and the Option 3 background runner are described under Reference; nothing
in this procedure asks the client to run them.

## Commands

```bash
# this skill — the root is the folder holding this file
python3 "${CLAUDE_PLUGIN_ROOT}/studio.py" pair ABCD-2345              # burn a one-time code, then show the link
python3 "${CLAUDE_PLUGIN_ROOT}/studio.py" pair ABCD-2345 --studio URL # same, naming the studio address explicitly (rare)
python3 "${CLAUDE_PLUGIN_ROOT}/studio.py" link                        # print and open the personal link
python3 "${CLAUDE_PLUGIN_ROOT}/studio.py" link --new                  # make a new link (old one stops working)
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --order               # fresh order check: ORDER <id> "<title>" | NO-ORDER | NOT-PAIRED (exit 3)
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --hook                # the SessionStart hook
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --desktop             # the opt-in desktop notice
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --watch --every 120   # the Option-2 watcher
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --claim r_123         # record an order as picked up
python3 "${CLAUDE_PLUGIN_ROOT}/studio_check.py" --print-root          # refuse a wrong root
python3 "${CLAUDE_PLUGIN_ROOT}/studio_bridge.py" poll --skill-root "${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory" --runs <runs-dir>   # claim one order, replay the answers
# the sibling skill — the drama factory that runs the stages
python3 "${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory/scripts/core/intake_preflight/factory.py" card --step
python3 "${CLAUDE_PLUGIN_ROOT}/../drama-song-ad-factory/scripts/core/intake_preflight/factory.py" next
```

Windows: replace `python3` with `py`.

---

# Reference

The design contract this skill was built against. It is kept for anyone changing
these scripts; running `/drama-studio` never needs it.

## What this skill was (units U13 and U14)

The **pair/link command**, the **SessionStart check-in hook**, the **opt-in
desktop notice** and the **Option 2 watcher**. It ships as a **skills-folder
plugin**: the hook loads from `hooks/hooks.json` and the Option-2 watcher from
`monitors/monitors.json`, both inside this folder, and the installer writes
**nothing** to any `settings.json` (decision 11 answered 2026-10-09).

It is a skill folder and two scripts, not a product: no framework, no bundler, no
scheduler, no dashboard, no new management app.

## Ownership — disjoint paths

| Unit | Owns |
| --- | --- |
| **U13** | `999-setup/.claude/skills/drama-studio/**` — the pair/link command, the check-in script, the SessionStart hook, the manifest, this document and the plugin prover |
| **U14 (this unit)** | the Option-2 watcher: `monitors/monitors.json`, the `--watch` / `--claim` behaviour in `studio_check.py`, and `prove/prove_option2_monitor.py` |
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

## The Option-2 watcher (U14)

`monitors/monitors.json` arms one plugin monitor at session start. It runs
`studio_check.py --watch --every 120` for the session and hands each stdout line to
the model as a task event, so the session needs no instruction to arm it. The watcher
is silent while idle. Four behaviours are its contract:

1. **Option handling.** The watcher acts for **Option 2 alone**. The option is
   resolved flag → env → state → default, and the default is **Option 1 (wait)**, so a
   machine that never chose Option 2 stays silent and spends no network call. When the
   studio's check-in reports the machine's option, it is recorded for the next arm.
2. **Deduplication.** One line per order, however many 120-second cycles pass. The
   marker is the order id in `state.json` (`watch_announced`).
3. **Claimed state.** An order that is picked up — it leaves the waiting line, or the
   run records `studio_check.py --claim <id>` — is marked `watch_claimed` and never
   announced again, even by a later watcher over the same state.
4. **Interactive fallback.** When the host declares it does not honour this skill's
   allowed-tools (`DRAMA_STUDIO_SKILL_LOCAL_PERMS`, or `skill_local_perms` in the
   state), the watcher stops and prints the interactive-fallback line: keep the
   interactive approval, or re-arm the Monitor tool. It never fabricates a settings
   exception and never writes a settings file. The permissions it relies on are
   **skill-local only** — the `Bash(...)` entries in this file's `allowed-tools`.

The watcher's cost is reported, not replaced: no `/loop`, no polling fallback, no
`option2-settings.json` anywhere in the plugin.

## State, root and allowed-tools

| Piece | Where | Who sets it |
| --- | --- | --- |
| Skill root | `${CLAUDE_PLUGIN_ROOT}` (the folder holding this file) | the plugin loader; a wrong root is refused with `AF-DS-ROOT` |
| Protected state | `~/.drama-studio/` (folder 700) | this skill; `machine.key` 600, `studio.url`, `client.url`, `state.json` 600 |
| allowed-tools | the frontmatter above | the script permissions (`studio.py`, `studio_check.py`, `studio_bridge.py`, the sibling `factory.py`) plus `Read` — nothing else |

The root and the state are deliberately different folders: the root is code, the
state is the client's machine. The key is in the state and never in a settings file,
because a launchd or Task Scheduler job cannot read a settings file anyway.

## Runnable checks (real commands, real exit codes)

```bash
node --version >/dev/null 2>&1   # not required; this skill is Python only
python3 "${CLAUDE_PLUGIN_ROOT}/prove/prove_plugin_behaviour.py"   # U13 (the plugin)
python3 "${CLAUDE_PLUGIN_ROOT}/prove/prove_option2_monitor.py"    # U14 (the watcher)
python3 "${CLAUDE_PLUGIN_ROOT}/prove/prove_user_agent.py"         # CHECKIN-UA (the studio User-Agent)
#   exit 0 = every check passed and every planted-bad control was caught
#   exit 2 = a named check failed, or a planted-bad control stayed green (vacuous)
#   exit 3 = the prover could not run
```

`prove_option2_monitor.py` takes `--skill <dir>` so the same checks run against a
pre-change copy of the skill. Run that way they must FAIL (the option, dedup, claimed
and fallback behaviours do not exist there yet); against this skill they must PASS.

The provers exercise the real scripts in a temporary state folder under `/tmp`. They
**install, load or enable nothing**, arm no monitor live, write no settings file, and
never send a notice anywhere: the desktop sink is pointed at a scratch file.

## Option 3 — the background run, shipped OFF (U16)

Option 3 starts a run with nobody present, so it is the highest-risk mode and it ships
**off**. `option3_runner.py` does **nothing** until Trevor has approved that one client
**by name** and the studio admin page has recorded it in `~/.drama-studio/option3-approval.json`.
Until then `check` exits 0 silently: no order lookup, no lock, no child process, no spend.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/option3_runner.py" status      # off | named <client> cap <cap> root <root>
python3 "${CLAUDE_PLUGIN_ROOT}/option3_runner.py" plan        # print the one command it would run (refused while off)
python3 "${CLAUDE_PLUGIN_ROOT}/option3_runner.py" check       # the scheduled entry; silent while off
python3 "${CLAUDE_PLUGIN_ROOT}/option3_runner.py" print-job   # the launchd job as text; installs nothing
python3 "${CLAUDE_PLUGIN_ROOT}/prove/prove_option3_runner.py" # 8 checks, each with a planted-bad control
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

- **No settings write, ever.** The hook loads from `hooks/hooks.json` and the watcher
  from `monitors/monitors.json`; both live inside this folder. There is no
  `option2-settings.json` and the script permissions are skill-local only.
- **No version field here.** Per JOINT PLAN 5.3.2 the version bump and the CHANGELOG
  entry happen once, in the batch pull request.
- **No `/loop`.** The watcher's cost is reported, never silently replaced by a polling
  `/loop`; the interactive fallback says so and stops.
- **The watcher needs no service bridge yet.** It is proven in isolation against the
  check-in contract. End-to-end production waits for the runnable bridge.
