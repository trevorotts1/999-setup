# Changelog

## [Unreleased]

### Round 8: the "<Name> pictures" Desktop folder and the half-read folder

A real run started inside a project folder that already held about 50 documents and a
`.spec-protocol.json`, yet it still made an empty `~/Desktop/<Name> pictures/` folder and asked
the client to drag material into it. The client read "pictures" as the wrong folder. The run
then said it had read 5 documents when the folder held about 50 across several subfolders.

**A — `SKILL.md`, `tools/hooks/conversation-gate.py`.** When the run starts in, or is pointed
at, a folder that already holds the client's documents or a `.spec-protocol.json`, no Desktop
folder is created. The entry-mode question names that folder instead: "I'll work from everything
in your '<folder name>' folder. Is there anything else you'd like me to read as well, or shall I
start with what's there?" "Start", "that's all" and similar replies count as `pointed`. The
question is still asked once and recorded through `answers.sh`. Otherwise the drop folder is
`~/Desktop/<Name> files/`, never "pictures", and the logo-and-photos question points at it. The
supplied-material read covers every file in the folder and all its subfolders. It skips only
`.git/`, `node_modules/`, build output, and binary files other than images and PDFs. A large set
is split across several reader agents in one visible workflow. The confirm line states the true
count, and a count lower than the folder's readable file count is a defect. The gate's
selftest now checks that both entry-mode shapes pass (#22b), and its two "pictures" mentions
now say "files".

**B — `references/interview.md`, `references/audience.md`, `references/conductor.md`.** Only
these three references changed; no `tools/` script creates or names the Desktop folder, so none
needed a fix. `interview.md` carries the drop-folder wording in three places — the entry-mode
question (section 1, item 5), the artwork/logo/photos ask (item 13), and its restatement near
the end of the block — all now `<Name> files`, and the supplied-folder behaviour matches A.
`audience.md`'s confirm line now states the true count read, citing `interview.md` section 1,
item 5. `conductor.md`'s working-directory rule now says supplied material is read in full,
every file in every subfolder, split across reader agents when large. Mentions of pictures or
images as media (media pipeline, design direction, image generation) are unchanged.

## [nine-router-setup 1.20.0] — 2026-09-24

### A namespaced tool name in a model's reply, and Claude Code rejects the call

Some upstream models answer a tool call with a bogus namespace prefix (`default.Bash`,
`functions.Read`, `tools:Edit`); Claude Code only knows the bare name and refuses the
call ("No such tool available"). 9Router has no setting for this, so
`scripts/common/fix-9router-toolnames.mjs` is new: it patches 9Router's built chunks the
same way `fix-9router-catalog.mjs` patches the DeepSeek catalog. The rule: when the part
after the last `.` or `:` is exactly a tool name the request declared, the reply carries
that name instead; anything else (`mcp__x__y`, an unknown `default.Nope`) is left alone.
It patches three sites — the chat handler that carries the request's declared tool names,
the tool-name-map applier every translated reply passes through, and the same-format
stream passthrough — and writes nothing unless all three are found and every patched
chunk still compiles (exit 2, never a partial patch). `fix-9router-catalog.mjs` now
exports `CHUNKS` and `findPkgs` so the new fix can reuse its chunk discovery instead of
duplicating it. `launchers/macos/claude-nine` and `launchers/windows/claude-nine.ps1` run
it right after the catalog fix and share its restart; `setup-macos.sh` and
`setup-windows.ps1` install it alongside the catalog fix. `references/model-routing.md`
documents it next to the catalog-fix section it rides with.

**Undetermined, out of this pass's testing scope:** the `.ps1` launcher and setup files
were never parsed (no PowerShell interpreter to check them against) — only their `.sh`
and `.mjs` counterparts were verified. The stream-passthrough site is written against an
Anthropic-format upstream talking to Claude Code; Gemini-format passthrough is not
exercised by this fix's own selftest and was not separately verified here.

## [1.30.0] — 2026-09-24

### Round 7: the answer-recognition loop and the blocked reader

A real run looped: a question recorded as a paraphrase was never recognized as recorded, the
block message named no command, and recording the answer four times did not clear it. The
client's pointed reply was treated as an instruction and never recorded; a reader dispatch was
blocked as a build; and `/spec-protocol <description>` in a folder with saved state resumed
instead of opening.

**A — `tools/hooks/conversation-gate.py`.** `_recorded()` now counts a question as recorded when
the normalized question and an Asked line contain one another, when at least 80% of the
question's significant words appear in one Asked line, or when the best-matching Asked entry is
at least 50% related and already has an answer; an unrelated Asked line still does not count.
Block reasons J and D now carry the exact `answers.sh` command to run, with the real skill and
project paths when known; H is unchanged.

**B — `tools/answers.sh`, `tools/hooks/dispatch-gate.py`.** `answers.sh … ask` refuses (exit 2)
words that still hold an unfilled `<…>` placeholder; angle-bracketed URLs and emails are
allowed. An `Agent`/`Task` call is a reader, never a build, when its prompt opens (first 200
characters) with "READ-ONLY", "read-only" or "You are a reader"; or its subagent_type is
exactly Explore; or its description carries a reader word (read/reader/research/explore/
audit-read) with none of the veto words (build/implement/fix/repair/write/edit/code/merge/
deploy) also in that description. Readers are never held to shapes 8–10.

**C — `SKILL.md`.** Any reply to the entry-mode question that points at a folder, files or a
path is the `pointed` answer, recorded with `answers.sh … answer entry-mode` and written as
`ENTRY-MODE: pointed` in the same turn, before anything is read. `answers.sh … ask` records the
question word for word as displayed, every placeholder filled. Resume happens only when the
argument is exactly `resume`; a description or no argument is a new run that begins with the
opening script, even in a folder with saved state.

## [1.29.0] — 2026-09-23

### Round 6: merge trains, proof of merge, cleanup, release hygiene

Four failures closed: old git worktrees left behind eating disk; units reported "merged" or
releases reported "minted" that never landed; merges run one after another for hours and
colliding; tags, changelogs and READMEs never updated. Batch cadence: `MERGE_BATCH_MINUTES`,
default now **10** (was 15). A project may now have more than one repository: the registry is
`repos.json` beside the repo-anchor receipt (`CONTROL/`, or `<statedir>/spec-protocol/` on a
profiled project), one `{"name","root","trunk","remote"}` entry per repository; with no
registry the one repository in `repo-anchor.json` is used, as before. **Proof of merge** — the
only meaning of "merged" — is: after `git fetch`, the unit's commit is an ancestor of
`<remote>/<trunk>` (of the local trunk on a local-only repository). **Proof of mint** is: the
annotated tag is on the remote (`git ls-remote --tags`), points at the release commit, and
VERSION, CHANGELOG and README on that commit carry the same version.

**A — one merge train per repository (`merge-train.sh`, `repo-anchor.sh`, `references/pipeline.md`).**
`merge-train.sh <project> --batch [--repo <name>]`: without `--repo` it runs every registered
repository's train, each under its own lock, so one repository's red gate never stops another's.
`repo-anchor.sh` writes or updates the registry entry for the repository it anchors and keeps
the single `repo-anchor.json` receipt. After every push each unit is proven merged; a unit that
fails the proof is not recorded merged and is re-queued with `MERGE-UNPROVEN: unit=… repo=…
reason=…`. Cleanup follows every proof: the unit's worktree (`--force` only when it holds no
uncommitted changes the merge does not already contain), its local branch, its pushed remote
branch and the scratch files the skill made for it are deleted, and `git worktree prune` runs.
A worktree or branch whose commits are not proven merged is never deleted: `KEPT-UNMERGED: …`.
Each batch appends one line per proven unit under `## [Unreleased]` in that repository's
CHANGELOG.md (created when missing); nothing in the train writes a version number.

**B — the watcher (`watch-tick.sh`, `watch-tick.mjs`).** Every 10 minutes the tick runs every
repository's train with one `merge-train.sh <project> --batch` call, under the same lock. Each
tick also runs a reconcile sweep — every unit the ledger or profiled state calls MERGED,
MERGED_VERIFIED or landed is re-proven, and a failure is `MERGE-CLAIM-FALSE: unit=… repo=…`
and re-queued (a profiled project's state is never written); an orphan sweep per repository —
a worktree whose branch is proven merged is removed with its branch, and one that is not merged
and has had no commits for two hours is `STALE-UNMERGED: …` and re-queued, never deleted, then
`git worktree prune`. Two limits on the sweep, both deliberate: it only recognizes a `--no-ff`
merge commit on the trunk's first-parent line as proof a branch was landed by the train, so a
tip reached by a fast-forward (or a fresh worktree with no commits of its own yet) is left
alone rather than risk sweeping a live builder's tree; and a worktree with uncommitted changes
is never removed even once its branch is proven merged — it is always kept and reported
`KEPT-UNMERGED: … reason=uncommitted-changes`, with no force-remove path in the sweep (unlike
`merge-train.sh`'s own post-batch cleanup, which may force-remove when the uncommitted changes
are already provably contained in the merge). And a mint check — a release or tag the ledger or
state claims is re-proven, and a failure is `MINT-CLAIM-FALSE: …` in the log and in the morning
report's operator notes.

**C — release hygiene (`tools/release.sh`, new; `SKILL.md`, `references/conductor.md`,
`templates/workflows/merge-train.js`).** `release.sh <project> [--repo <name>] --version
<x.y.z> | --bump patch|minor|major` releases every registered repository (or the one named).
Per repository it refuses (`RELEASE-REFUSED: repo=… reason=…`) unless the trunk is checked out
and clean, the remote trunk is already in the local one, no passed unit still waits in that
repository's train, the gate is green (the same test command the train runs), and the tag does
not already exist (a tag is never moved). It then sets VERSION (created when missing), moves
CHANGELOG `[Unreleased]` into `## [x.y.z] — <date>` under a fresh empty `[Unreleased]`, updates
the README's version line (or adds `Version: x.y.z` near the top), commits, creates the
annotated tag `vx.y.z`, pushes trunk and tag in one atomic push, and proves the mint from the
remote before it prints `MINTED: repo=… version=… tag=… commit=…`; any failure is
`MINT-FAILED: repo=… reason=…` and a non-zero exit. A local-only repository gets everything
but the push, proven on the local tag, and `MINTED-LOCAL: …`. Results are recorded in the
ledger (profiled: `<statedir>/spec-protocol/release.log`). `--selftest` mints and proves one
release against a local bare remote and refuses a dirty trunk. `SKILL.md` step 21–22 and
`conductor.md` §9 (items 5 and 7), §12 and §13 now say: one merge train per repository,
driven by the script, batching every 10 minutes, never sequential merging; "merged" means the
proof of merge only; worktrees and branches are deleted right after the proof and unmerged
work never is; the only seat a train gets is the haiku-chain conflict-resolver, for conflicts
and re-queued units, never a builder seat; at the Release Council's PASS (and any declared
milestone) `release.sh` runs for every repository and the run is not done until each prints
`MINTED:` or `MINTED-LOCAL:`; the morning report's operator notes list each repository's
version and tag. The merge-train workflow template runs all repositories' trains (no
`--repo`) and hands any `CONFLICT:` or `MERGE-UNPROVEN:` unit to the conflict-resolver seat
(`args.seats.conflict`, the haiku chain), which fixes the unit branch and never merges or
deletes anything.

## [1.28.0] — 2026-09-23

### Round 5: a supplied, profiled project runs all night unattended

A project folder the client hands over — even one with spaces in its name, its own
`.spec-protocol.json`, its own state writer and its own policy — now runs through the night
under `claude-nine`: every ready stream launches at once as a visible native workflow, merges
land in batches, and nothing stalls or dies silently. New optional profile fields (all argv
arrays, run at the project root, never through a shell): `commands.refresh` (regenerates the
project's own views), `commands.merged` (records one merged unit; `{taskId}` `{commit}`
`{branch}` substituted), and `policy.maxActiveWorkflows` / `maxAgentsPerWorkflow` /
`maxWorkingAgents`, which are a ceiling on width when present. Batch cadence:
`MERGE_BATCH_MINUTES`, default 15.

**A — the tick (`watch-tick.sh`, `watch-tick.mjs`).** The crontab line written by
`--cron-line` / `--arm` single-quotes every path (skill dir, project home, log) and escapes a
bare `%` to `\%` (cron reads an unescaped `%` as a newline), so a folder such as "My Project
Folder" works; every other path use in both files was audited for the same bug. `--arm` and
`--record-session` work on a profiled project, keeping the session record and the auto-resume
lock and log beside the bound state (`<statedir>/spec-protocol/`), never in a `CONTROL/`
folder, so auto-resume fires on profiled projects exactly as on unprofiled ones — and, fixed
after this block first shipped, never fires when the bound state's `run_status` (or `status`,
read as a fallback when `run_status` is absent) is `RELEASE_COMPLETE`, `STOPPED_BY_OWNER`,
`PAUSED_BLOCKED`, `PAUSED_CAP`, or `STOPPED_CAP`, case-insensitive, no matter how stale the
session looks. When the profile has `commands.refresh`, each tick runs it with a timeout and
logs one `PROFILE-REFRESH | <ISO8601Z> | rc=0 | <output>` line on success or
`PROFILE-REFRESH FAILED | ... (logged, not fatal)` on failure or timeout. Every
`MERGE_BATCH_MINUTES` the tick runs `tools/merge-train.sh <project> --batch` when anything is
waiting, under a lock so two batches never overlap, and prints one `MERGE-BATCH | rc=<n> |
<output>` line (or `MERGE-BATCH | held | ...` when a batch is already running).

**B — the batch merge train (`merge-train.sh`, `references/pipeline.md`).** New
`merge-train.sh <project> --batch`: every unit branch that passed its judges is merged into the
integration branch in one pass (each `--no-ff`), the build/test gate runs once for the batch,
and the push happens once. A red batch is bisected to find the unit(s) that broke it; the good
ones land and the bad ones go back to repair with the failing output. A merge conflict skips
that unit and records it for a conflict-resolver seat (haiku chain) without blocking the rest.
Exit codes: 0 (nothing waiting, a batch already running, or everything landed clean), 3 (a
conflict, a red gate, or a push refusal — landed units are still recorded, never lost), 2
(tooling failure). On a profiled project `commands.merged` runs once per merged unit —
including when the repo has no `origin` yet: those units still land locally and are still
recorded through `commands.merged`, just not pushed ("landed only, not merged"). The
single-unit mode still works, and the pipeline's merge sections now say batches every 15
minutes, not one at a time.

**C — profiled-project tools (`ledger.sh`, `repo-anchor.sh`, `publish.sh`, `answers.sh`,
`project-profile.mjs`).** `ledger.sh` writes to `<statedir>/spec-protocol/LEDGER.md` on a
profiled project through the same atomic writer and prints the path, so every "write X through
`tools/ledger.sh`" step works there. `repo-anchor.sh` never creates a GitHub repository for a
profiled project unless the profile names one (`repo.remote`, or `repo.createPrivate` created
private); otherwise it anchors local-only and says so in the receipt. `publish.sh` calls Vercel
only for a web target meant to be hosted there: desktop targets record
`PUBLISHED: <artifact path> target=<t> status=artifact`, and self-hosted/VPS/docker targets
record `HOSTING-SELF: target=<t> package=<path or none> next=<install step>` — neither is a
failure. `answers.sh init` recognises an existing heading with extra text after the key and
never appends a duplicate block. `project-profile.mjs` validates the new `commands.refresh` /
`commands.merged` / `repo.*` fields and gained three read commands the other tools call
instead of re-parsing the profile: `policy <project>` (the ceiling, JSON), `workdir <project>`
(the resolved `<statedir>/spec-protocol` path), and `fields <project>` (workDir, ceiling,
refresh, merged and repo together).

**D — conductor text and templates (`SKILL.md`, `references/conductor.md`,
`references/capacity.md`, `references/workflows.md`, `templates/workflows/*.js`).** RULE 2 and
the capacity doctrine: width = min(harness/provider width, the profile's policy ceiling when
present); the ceiling is never exceeded, and inside it the run still never dispatches fewer
streams than the work allows. RULE 4 and the conductor's dispatch: every dispatchable stream is
launched in the same turn as its own native Workflow run, visible in `/workflows`, filled to
the per-workflow agent cap, never serialised and never hidden in plain Agent calls (readers
excepted); a workflow carrying fewer agents than its ready units allow is under-width. Step 21
and the pipeline: merges run in batches through `merge-train.sh --batch` on the tick's
15-minute cadence, with conflicts going to a haiku-chain resolver seat. RULE 1, step 17 and
step 21 describe what a profile adds: the tick runs `commands.refresh`, merges are recorded
with `commands.merged`, ledger lines land in `<statedir>/spec-protocol/LEDGER.md`, and
repo-anchor follows `repo.*`. The four workflow templates now carry a
`<program>-W<wave>-<phase>-<firstID>[..<lastID>]-<lanes>L` placeholder name and, in every
multi-lane prompt, the SCRATCH ISOLATION line (a private `<scratchpad>/lanes/<UNIT-ID>-<box-slug>/`
folder per lane); the merge-train template runs `merge-train.sh <project> --batch`.

## [1.27.0] — 2026-09-23

### Round 4: the next pass over seven sections

**A — launchers, setup scripts, AGENT_INSTALL.** Setup now writes
`permissions.defaultMode: bypassPermissions` into each root `claude-nine` reads, so an
unattended walk-away run no longer stalls at the first tool-permission prompt — created when
the file is missing, merged in only when no `defaultMode` already exists, backed up first, and
never fatal. On Windows, `claude-nine` shares its config root with plain `claude`, so plain
`claude` picks up the same default. `setup-macos.sh` records the resolved Node directory at
`~/.local/share/999/node-path`, which the macOS launcher prepends along with the 999 npm bin
and common Node locations; the launcher starts 9Router with `</dev/null` and `--skip-update`
for a clean tray start. The Windows launcher gained a `.cmd` sibling shim for plain `claude`
and `--ultracode` / `--no-ultracode` flags, remembered in `lastEffortSelection`.

**B — watch-tick auto-resume, dispatch-gate SHAPE 7 pointer.** Auto-resume now launches with
`-p --permission-mode bypassPermissions --resume <id> "/spec-protocol resume"` (both
`watch-tick.sh` and `watch-tick.mjs`) and sets `PATH` on the resumed process itself — the
recorded node dir, setup's node, `~/.local/bin`, the 999 npm bin, and common node locations —
rather than on the cron line; the fallback node directory is `node/current/bin`, matching what
`setup-macos.sh` writes. `dispatch-gate.py`'s SHAPE 7 refusal now points at
`references/enforcement.md` section 1, "SHAPE 7 — the write-ahead booking rule" (it never lived
in `conductor.md` section 6).

**C — templates, merge-train, provision-db, publish.** `build-wave.js` and `fix-wave.js`
builders now commit on their own branch and never push — the merge train is the only
publisher. `merge-train.sh` runs `gh auth setup-git` before pushing to a `github.com` origin
when `gh` is logged in. `provision-db.sh` writes `DATABASE-BLOCKED` + a next step on every
failure once the project folder is found, instead of failing silently. `publish.sh` also reads
`BUILD-TARGET` from a profiled project's state directory, not only the legacy ledger.

**D — conversation gate, speech-check.** Check E now falls back to the recorded name/idea
answer on a held ledger instead of refusing outright; a mid-turn Skill load only counts as a
run with `gate0.sh --open` or an `answers.sh init` behind it; check L stands down after the
walk-away line or a `watch-tick --record-session`; `speech-check.sh` refuses an unfilled
angle-bracket placeholder (`<Name>`, `$<X>`, `<URL>`) reaching the client; and the counted
question ceiling may rise exactly once, right after the mode question answers whether advanced
mode's extra items apply.

**F — references (except conductor.md).** `interview.md` section 4b lists the answer keys per
mode for `answers.sh init --planned`, the mode question and the update offer are uncounted, and
`C` is stated for the first time only after the mode answer; a stated non-goal is read back
instead of re-asked. `capacity.md`: an undetectable plan tier is recorded UNDETERMINED rather
than asked, and step 6.5's rig-fitness findings are client-absent by design (the conservative
choice, reported in the morning note). `audience.md` gained a local-only opening line and
dropped the GitHub promise from the walk-away speech. `publish.md`'s exit codes now match
`publish.sh` exactly (2 tooling, 3 not live). `build.md` names `tools/publish.sh --draft` as
the draft deploy. `enforcement.md` gave "SHAPE 7 — the write-ahead booking rule" its own
subsection under section 1 for `dispatch-gate.py` to point at (seam-checked against B above).

**G — tools/morning-note.sh (new).** Cuts the Operator Notes section off the morning report,
lints the client-facing copy through `speech-check.sh`, and only then places "Your project is
ready.txt" on the Desktop — exit 3 and nothing written when the lint refuses it.

**E — SKILL.md, conductor.md.** Turn 1 and step 3 plan the opening keys
(`answers.sh … init --planned idea,confirm,entry-mode`, held and supplied-folder forms), and
step 6 opens with `answers.sh <project> init --planned <the mode's counted keys>` (key lists
owned by `references/interview.md`), then `skip`/`stated`. New resume route: `/spec-protocol
resume` skips the greeting, reads the ledger, `CONTROL/auto-resume.txt` and the state file, and
continues from the first open step (`references/resume.md`), speaking only when a question is
genuinely owed. New rule: after the walk-away line the client is absent — the rig-fitness
findings (step 6.5), the feature list and human decisions take the conservative choice and go
into the morning report; the spend pause at the agreed dollar line is the one exception.
Step 22 names `tools/morning-note.sh <project>`. The mode question is now uncounted and the
count is stated only after it; the update offer, which comes before it, is uncounted too. conductor.md
§6: the four budget values precede the first BOOKED dispatch (research-reader exemption), and
the spend-pause question is recorded through `answers.sh`. The description drops "fast paths
for small plans" and "the four Gauntlet questions", which the body no longer has.

## [1.26.0] — 2026-09-23

### Round 3: the next pass over the same nine sections

**A — launchers / installer / install-hooks / AGENT_INSTALL.** The launchers resolve 9Router
across more locations and start it headless (`-p PORT --no-browser`); setup stops only the
router it started and the `claude-nine` probe cold-starts it back up; `install-hooks.sh` /
`.ps1` quote the interpreter and guard the Python version check; both launchers export
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` (below the 256K fallback lane; `claude-codex` keeps
350K); `AGENT_INSTALL.md` gained a background-run-and-monitor path and a visible
`gh auth login --web` step; setup installs the Vercel CLI into the 9Router npm prefix and
records `VERCEL_TOKEN` from the environment only; `claude-nine` runs under `caffeinate -i`
(Windows: `SetThreadExecutionState`, unverified); the skill report checks the `claude-nine`
root and seeds ultracode only when absent; `SPEC_PROTOCOL_OPERATOR_GH_TOKEN` is now accepted
from the environment and merged into `operator.env` at mode 600.

**B — deploy tools.** `publish.sh` locates the Vercel CLI and the operator credential and
passes it only to the `vercel` child, with `HOSTING-BLOCKED` and a next step on any failure;
`--draft` runs a preview deploy, proves a 200, and writes a `DRAFT-LIVE` line, and now also
PATCHes Vercel's preview protection off for that deploy; `--prod` refuses unless
`SHIP-CHECKS` are all passing and every `public-surface.json` row reads 404/403;
`provision-db.sh` links the Vercel project when it is not linked; `dispatch-check.sh` treats
`MOBILE_APP` as served rather than no-URL. New shared helper: `tools/deploy-auth.sh`.

**C — repo anchor.** A failed `gh repo create` now retries `<slug>-2` through `-5` before
falling through to a local-only receipt (`rc 0`) instead of failing with none; the
operator-owner path passes `SPEC_PROTOCOL_OPERATOR_GH_TOKEN` to that one `gh` call only.
`merge-train.sh` picked up the matching addendum: it pushes an operator-owned repo's receipt
with the same operator token, scoped to that one git process, and stops (landed, not merged)
when the token is missing.

**D — dispatch gate + dispatch-check.** The project now resolves from this session's own
`answers.sh` transcript line instead of only the cwd walk-up; a template's declared agent
count (`meta.agentsPerUnit` / `agentsTotal`) now raises the count the gate sees; a one-agent
research-phase dispatch with no build label is exempt from SHAPE 7 booking and from the
Capacity Ledger / Parallelism Plan requirement (still booked, `cap=reader-exempt`) — ported to
`dispatch-check.mjs` for the Windows twin; the write-ahead pointer now names
`references/conductor.md` section 6.

**E — templates + merge-train.** Build/fix-wave builders now work only inside
`<repo>/.worktrees/<id>`, and `merge-train.sh` removes each landed branch's worktree after
merging; every workflow template now declares its own agent count for the dispatch gate's
count check.

**F — watch-tick auto-resume.** `--record-session` records the session id and
`interview=done` at interview end; the stalled-turn and auto-resume checks now cover every
post-interview phase, not just an open build row; ported in full to `watch-tick.mjs` for
Windows, including the launcher resolution and a Windows-installed `claude-nine.cmd`.

**G — conversation gate, speech lint, answers.** The message-shape checks now run on every
turn of a run whether or not a project ledger exists yet, backed by `answers.sh init/hold/flush`
and read back by the ledger path in the hook's own result line; a naming or status sentence
after the final question mark, or more than two question marks in one paragraph, now blocks;
"app / application / program / platform / software" are recognized category words; a mid-turn
Skill-load record no longer counts as a user turn boundary; the speech lint gained
script-name and run-internal classes while letting on-screen UI labels through.

**H1 — SKILL.md / conductor.md / CHANGELOG.** A new walk-away line, an honest question count
in the greeting, `cd` into the project folder the moment it exists (with the matching
`answers.sh init --hold` / `--flush`), a local-only done condition, corrected relaunch and
config-root wording, and the preflight bullets moved out of `SKILL.md` into
`references/conductor.md` §2P (read at step 2, not before the greeting).

**H2 — references.** `interview.md`, `audience.md`, `capacity.md`, `environment-sweep.md`,
`publish.md`, `pipeline.md`, and `enforcement.md` all received their round-3 fixes: the
walk-away line and question count carried through, the spend question fixed as last in both
modes, stale re-ask and defaults-offer language removed, the picture folder made once, and
`publish.md` / `pipeline.md` brought in line with the B and E tool changes above.

**Integration.** One doc fix follows from A4 above: `conductor.md` §2P still described the
`claude-nine` / `claude-codex` compaction target as "the smaller of 500000 and the resolved
seat's measured context ceiling" — the pre-A4 design. It now says what A4 actually ships: the
`claude-nine` launcher sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` directly, ahead of and
overriding whatever `compact-guard.sh` would raise, and `claude-codex` inherits it unless it
sets its own via `--autocompact`.

## [nine-router-setup 1.17.2] — 2026-09-23

### A 9Router update could silently shrink DeepSeek back to 128K

9Router ships its own built-in model catalog, and an update to it could overwrite the
DeepSeek V4 Flash entry this project depends on, silently reverting its 1M context / 384K
output window back to the vendor default of 128K with no error anywhere. `scripts/common/fix-9router-catalog.mjs`
is new: it re-applies the DeepSeek V4 Flash 1M context / 384K output patch to 9Router's
built-in catalog, `--check` reports whether the patch is currently in place without writing
anything, and repeated applies are idempotent no-ops once patched. The `claude-nine` launcher
(macOS and Windows) now runs it before every launch and restarts the router only when it
actually patched something; `setup-macos.sh` and `setup-windows.ps1` run it once right after
installing 9Router. A 9Router update can no longer leave the window at 128K without anyone
noticing.

## [1.25.1] — 2026-09-23

### Fresh-Mac launcher, self-granting below the cost line, and a universality scrub

**`#52` — `claude-nine` starts on a fresh Mac.** The launcher shipped nothing to source
before Homebrew or Node existed: `launchers/macos/claude-code-lib.sh` is new — the shared
helper library `claude-nine` and `get-9router-key.sh` now both source — and
`.claude/skills/nine-router-setup/scripts/setup-macos.sh` writes `~/.claude-nine/settings.json`
only when it is absent, never overwriting an operator's tuned config. The launcher's
operator-only checks are guarded so a client box without those files skips them instead of
failing. A follow-up pass removed stale comments and recorded the DeepSeek 1M context window
in `references/model-routing.md`.

**`#54` — below the client's dollar limit, the run grants itself the next block.**
`dispatch-check.sh` reads the newest `COST-LINE:` in `CONTROL/LEDGER.md`; when the dispatch's
projected `spend_usd=` is still below its `usd=` (or the line reads `COST-LINE: unmetered`),
the checkpoint self-grants — it writes one `PAUSE-GRANT:` line, raises
`agents.pause_blocks_granted`, and proceeds at full width without asking the client. At or
over the line, it still pauses exactly as before. `dispatch-gate.py`'s refusal text,
`anchor.sh`'s tick, and `dispatch-check.sh` now share one `PAUSE-GRANT:` / `COST-LINE:`
vocabulary instead of three worded slightly differently.

**Universality scrub.** Project names left over from earlier fixture and example work were
removed from shipped `SKILL.md`, `references/`, and hook test data — the skill and its
selftests no longer name any one client's project. `README.md` was refreshed to match.

## [1.25.0] — 2026-09-23

### The 51-issue review fixes

Ten fix branches, one per area, merged in sequence with a full selftest pass after every merge.

**Installer / hooks.** `#1 #2 #3 #6 #8 #33 #34 #37 #38` — `install-hooks.sh` and
`install-hooks.ps1` are new: they register the four hooks idempotently, merge foreign keys
instead of clobbering them, and back up `settings.json` once. `hook-check.sh` gained the
missing STALE / ABSENT legs for the stop hooks. `scripts/setup-macos.sh` and
`setup-windows.ps1` and `launchers/macos/claude-nine` picked up the launcher-side half of the
same fixes.

**Conversation hooks.** `#4 #17 #18 #20 #21 #22 #23 #24 #25 #39` — `conversation-gate.py`
now reads the project only from this session's own `answers.sh init` call, runs the jargon
lint before any project exists, stands a statement-yield block down when a HANGING entry is
pending, resets its 3-per-turn block counter on a new turn, and blocks when `ANSWERS.md` goes
missing after this session created it. `gate0-claim-gate.py` and `speech-check.sh` got the
matching evidence and counter fixes.

**Dispatch gate.** `#5` (hook side), `#6`, `#32` — `dispatch-gate.py` gained SHAPE 7-10: a
project must be booked in `CONTROL/dispatch-log.md` (not just claimed), it must show a real
`SEAT-PROBE:` line before a build dispatches, it must carry a proven `repo-anchor.json`
receipt (scoped to both legacy and profiled projects) before any builder runs, and it must
have its start marker and an armed tick (`watch-tick.sh --check` rc 0) before a build dispatches.

**Repo anchor.** `#6` (repo-anchor side), `#49`, `#50` — `repo-anchor.sh` and `anchor.sh`:
a profiled project no longer gets refused outright by the drift reconciler; it now redirects
through the profile's own `commands.validate` and reports a `PROFILE-ANCHOR` line, the same
pattern `watch-tick.sh` already used for `PROFILE-TICK`.

**Tick.** `#32 #35 #40 #48` — `watch-tick.sh` and `scripts/common/watch-tick.mjs` gained the
group-abort, stalled-turn, task-snapshot, and unguarded-publish checks, plus the profiled-project
redirect and cron/schtasks arm-and-check plumbing.

**Preflight / answers.** `#7`, `#51(1)`, `#23`, `#29/#30` (tool side), `#39` — `preflight.sh`
and `answers.sh` are new: a one-line GO/no-go gate and the ledger-backed question/answer
recorder the conversation gate now depends on. `prompt-band.sh` and `ship-guard.sh` picked up
the matching floor/ceiling and fabrication-guard fixes.

**Deploy / templates.** `#41 #42 #45 #46 #47` — `publish.sh`, `provision-db.sh`, and
`merge-train.sh` are new, the 17 apparatus document templates and 4 workflow templates were
added, and the knowledge-pack pin (`references/knowledge-pack.json`) was corrected; a
follow-up fix to the same issue (`#45`) made `scripts/bootstrap-companions.sh` pull
knowledge-pack folders anonymously and refuse a placeholder pin instead of caching it.

**SKILL.md restructure.** `#3 #5 #7 #10 #11 #12 #15 #23 #25 #26 #27 #29 #30 #31 #34 #41 #42
#46 #47 #51(2)(3)(4)` — `SKILL.md` cut from over a thousand lines to a thin dispatcher; the
conductor logic it used to carry inline now lives in the new `references/conductor.md`.

**References.** `5 9 10 11 12 13 14 15 16 19 28 34 41 43 44 45 46` — `audience.md`,
`capacity.md`, `decision-engine.md`, `documents.md`, `environment-sweep.md`,
`funnel-architecture.md`, `gauntlet.md`, `interview.md`, `pipeline.md`, `platform.md`,
`publish.md`, `research.md`, and `workflows.md` all received their matching fixes.

**Integration.** Merging the SKILL.md restructure and the references branch together
surfaced one real interaction: `interview.md`'s three credential-key turns (Private
Integration Token, Firebase refresh token, Location ID) were written as three blockquotes
separated only by a blank line, which the gate's own quote extractor read as a single
four-question turn and correctly rejected. Fixed by inserting one plain-prose line between
each blockquote. Separately, `project-profile-selftest.sh` still asserted the pre-fix
invariant that `anchor.sh` refuses outright on a profiled project; updated it to expect the
new `PROFILE-ANCHOR` redirect instead, matching the assertion already in place for
`watch-tick.sh`.

## [1.24.0] — 2026-09-22

### The skill promised merged-to-GitHub and never made a repository

Line 3 of `SKILL.md` promises a "merged-to-GitHub" build. Section 6 arranges the client's GitHub
login at minute one. Step 17 said "Determine GitHub (new or existing) and smoke-test the token".
`references/pipeline.md` proves every merge as an ancestor of remote main and records an
operator-provided remote when the client declines their own account. `references/documents.md`
places working copies at `repos/<repository-name>/`. And across `SKILL.md`, `references/`,
`tools/`, `scripts/` and `templates/` there was no `git init`, no `gh repo create`, no
`git remote add` — on any project. A real run reached its first QC handoff on a folder that was
not a git repository at all, and nothing had refused the builders. "Determine GitHub" was a
judgement left to the model, and prose fails here roughly always.

**`tools/repo-anchor.sh <project>` — step 17 is now a command with an exit code.** On every
project, before any builder: resolves the repo root (`<project>/repos/<slug>/` on a legacy
project; the project home, or the profile's `documents.repo`, on a profiled one); `git init -b
main` and a first commit if there is none; keeps an existing `origin`; otherwise creates a
PRIVATE repository on the client's own GitHub login (`gh repo create … --remote origin --push`,
the token never in a URL) or takes `--operator-remote <url>` when they declined; proves it with
`git ls-remote`; writes the receipt `repo-anchor.json` beside the state (`CONTROL/` legacy, the
`documents.state` directory profiled) and, on legacy, one `REPO-ANCHOR:` ledger line. Exit 0
anchored / 3 already anchored / 2 UNDETERMINED naming the source / 4 declined with no fallback.
`--check` is read-only and cheap. The selftest drives a stub `gh` (`REPO_ANCHOR_GH_CMD`) so no
test ever creates a real repository. 15 selftest checks.

**`dispatch-gate.py` SHAPE 9 — no repository, no builder.** Every build dispatch, legacy or
profiled, is refused until the receipt exists AND `git remote get-url origin` matches the
remote it names. A stale receipt whose remote no longer matches is the discriminating fixture.
34 → 40 selftest checks.

**What the client hears** is one plain sentence inside the turn that runs step 17 — *"I've set
up a private, safe place online where every version of your work is kept as I build it — it's
under your own account, so it's yours."* — proven clean by `tools/speech-check.sh`. Step 17,
the minute-one paragraph, `pipeline.md`'s "new or pre-existing?" section and the `GITHUB:`
ledger paragraph now all point at the tool; the receipt is listed in the storage layout as NOT
one of the seventeen documents.

## [1.23.0] — 2026-09-21

### What the five adversarial agents found, fixed by six more

Five Opus agents (contradictions, hook attack, regression replay, build path, unenforced
invariants) audited the day's releases under Fable discipline. Their three truncated reports were
recovered from disk and every finding re-verified on the instrument before six Opus agents were
dispatched, one per file, to fix them. Nothing below was fixed in prose alone.

**The Stop hooks now know whose session they are in.** Both `gate0-claim-gate.py` and
`conversation-gate.py` fired on the operator session that maintains them — the first because a
tool INPUT quoting the refusal wording counted as speech, the second (1.22.3) because a ledger
near cwd counted as a run. Refusal evidence is now text blocks only, and both hooks require the
harness's own `/spec-protocol` invocation in a user-role record. Proven on both sides: the
operator transcript silent, the real 2026-09-20 refusal and the real 2026-09-21 stall still
blocked. `hook-check.sh` — the staleness guard that knew one hook — now checks all three
(`dispatch-gate`, `gate0-claim-gate`, `conversation-gate`) per root; its live run named the
gate0 copy stale the moment the repo copy changed, which yesterday's script could not see.

**`conversation-gate.py`: eleven fixes, 35 → 71 selftest checks.** The two real failures
the replay agent proved were MISSED are now checks: **I** (a spoken build surface that contradicts
`.spec-protocol.json` `targets[0]` — "an app for their phone" against `desktop-macos-arm64`,
the 10:30 failure) and **J** (the previous turn's question must be on the ledger as *Asked* —
entry-mode was spoken at 10:33 and never written, so nothing owed it, the 10:34 failure). **H**
returns to a spoken-and-blank question before any new one, in both ledger shapes. Seven false
positives removed: the mandated later-turn DEFAULT, the mandated either/or closer, a fullwidth
`？`, a question inside a code fence, the client's own quoted question, a folder literally named
`Website`, and the previous turn's prose leaking into a tool-only turn.

**`gate0-claim-gate.py`: the refusal regex survives wrapping.** A newline, a double space or a
non-breaking space inside the phrase evaded it entirely; it is now whitespace-tolerant. 11 → 19.

**`dispatch-gate.py`: SHAPE 8.** The seat probe was enforced only by `dispatch-check.sh`, a
script the conductor is told to run; the hook that actually intercepts the Workflow call never
asked for it — the 2026-09-08 canary dispatched builders behind a ledger that discussed seats
in prose. A build dispatch in scope now requires the `SEAT-PROBE: seats= callable= dead=
undetermined=` line in `CONTROL/LEDGER.md`; prose about seats still refuses. 27 → 34.

**A profiled project finally has a tick.** `references/project-profile.md` said "a profile
REDIRECTS the helpers; it never switches them off"; `watch-tick.sh` and seven other tools
refused with "use the profile-declared observer" — an observer with no schema key, no validator
and no runner. The tick now redirects: on a profiled project `--arm` installs the same
five-minute cron line logging beside the bound `documents.state`, and each tick runs the
profile's `commands.validate` as argv (no shell) and prints one `PROFILE-TICK` line; a missing
key is UNDETERMINED, never a silent fallback to `CONTROL/`. Shell 35 → 42 selftest cases; the
Node twin `scripts/common/watch-tick.mjs` carries the same path, byte-identical cron line and tick line against the live packet, 10 → 15 selftest cases.
`project-profile-selftest.sh` asserted the old refusal and now asserts the redirect.

**Seven prose contradictions the hook would have blocked.** The Jev offer moved INSIDE the
opening turn before the idea question (it was ordered "after the opening", which ends on a
question); the escape-hatch sentence after "NEVER DELETED" is gone — the client's reply, even
"yes, that's it", is the answer; the two differing "verbatim" entry-mode scripts are now one;
`ANSWERS.md` has one deadline (first counted question; on a supplied folder, before the
opening — the unprofiled folder cannot exist before the client speaks); step 21 arms the tick on
EVERY project; "step 13 of the interview" points at the pictures item that exists; §14 lists
`project-profile.md` as item 26.

**Closed on evidence, no change:** `dispatch-gate` registered on `Workflow` only is correct —
SKILL.md dispatches through Workflow alone (Agent: 0 references). **CORRECTION (recorded after
release): this finding was wrong.** `references/workflows.md` §6 degrades a failed Workflow probe
to `Agent` fan-out, and real runs made Agent calls 102 times against 43 Workflow calls — every
one of them outside the hook. A zero count of the word "Agent" in SKILL.md was evidence about the
prose, not about what runs dispatched. The fix (hook handles `Agent`/`Task` payloads, registered
on `Workflow|Agent|Task`) ships in the next release. The entry-mode question on
the naming line is the mandated ONE-message shape since 1.21.5, not a defect. A stale
`_not yet spoken_` line nagging every build-phase statement is correct behaviour on a correct
ledger: a question still unspoken during the build was skipped.

**Studio Nerds packet (outside this repo, reported for the record):** the qc-coverage bypass
in `scripts/state.mjs` is closed (a builder probe may carry builder provenance only —
`PROBE_PROVENANCE_ROLE`; the test fixture that taught the bypass is split and a negative test
added); the packet is now a git repository on `main` (the state machine's QC handoff needs a
commit to bind to; no remote yet); `PACKET-MANIFEST.sha256` regenerated, 47/47 OK.

## [1.22.3] — 2026-09-21

### The conversation gate caught its own author

The 1.22.2 scope widening (cwd + three ancestors + one level down) made `conversation-gate.py`
decide "this is a spec-protocol run" from **file presence alone**: any session whose `cwd` is
near a folder holding `00-INPUT/ANSWERS.md` was policed as though it were talking to a client.
The operator session that shipped 1.22.2 then `cd`'d into a client packet to repair its build
state — and was blocked on its own Stop with *"TURN ENDED ON A STATEMENT WHILE A QUESTION IS
OWED: entry-mode (step 3)"*. A ledger under cwd is evidence a project exists there, not evidence
that THIS SESSION is the interview.

The gate now also requires proof the session actually **invoked the skill**: a `user`-role
record carrying the harness's own `<command-name>/spec-protocol</command-name>` injection (or
the skill's `Base directory for this skill:` line) as a plain string or `text` block. A
`tool_result` or `tool_use` block that merely *quotes* the marker — an operator reading a run's
transcript, or `SKILL.md` — does not count; the first draft of this fix accepted those and still
blocked the operator, so that case is now a selftest fixture.

Verified live on both sides of the boundary: the operator session's own transcript, cwd'd into
the packet → silent, rc 0. The real stalled 2026-09-21 run → still blocked on the same owed
question. Selftest 31 → 35 checks. No client-facing wording changed.

## [1.22.2] — 2026-09-21

### Four holes the adversarial agents found in yesterday's enforcement

Five Opus agents were dispatched under Fable discipline to attack the day's work. Every finding
below was re-verified by hand with a discriminating control before it was acted on; two agent
claims were corrected in the process.

**The gate would have jammed the next interview.** Check B blocked **15 of 48** mandated
question wordings in `references/interview.md` — every one for "prose after the question mark",
where the prose is the trailing reassurance that makes a question answerable by a
non-technical client: *"Do you already own a website address, something like yourbusiness.com?
If you don't know, that's okay."* The rule was aimed at the naming line and caught the house
style instead. B now fires only on a **new paragraph** after the question; a reassurance or
example list in the same paragraph is correct and passes. 48 wordings, 0 blocked; both real
defects still caught.

**Prose defeated the GATE 0 gate.** `_this_turn` pooled assistant TEXT into the evidence that
the check had run, so a turn could satisfy the gate by merely writing "I would run
`gate0.sh --check-session`" in a sentence — the exact failure the hook exists to prevent.
Evidence now comes from `tool_use` blocks only, a tool RESULT is no longer mistaken for a
tool CALL, and the pattern requires the script and the flag together rather than the bare flag.
Verified with a control: bypass blocked, genuine run still silent.

**Two ledger formats exist and the reader knew one.** The 2026-09-08 runs
(`corner-post-framing`, `maple-street-bakery` — both of which built real output) write
`00-INPUT/ANSWERS.md` as a markdown TABLE; today's runs write key/value. The parser read only
key/value, so on a table ledger the stall guard reported nothing owed and check D fired on
every question. Both shapes are now read. Verified against both real files.

**The scope gate was blind to unprofiled runs.** `_answers_path` joined cwd directly, but the
unprofiled path creates `~/Downloads/projects/<slug>/` while the session may sit in a parent.
It now searches cwd, up to three ancestors, and one level down — bounded, never wandering.

**One stale line nagged every status message.** A leftover "not yet spoken" entry made check A
fire on progress reports for the rest of a build. Messages matching the status contract are
exempt from the stall guard.

## [1.22.1] — 2026-09-21

### The jargon lint finally runs

A Fable diagnostic agent was asked to find every remaining instance of the failure shape that
cost this project a day — *a capable instrument exists and nothing forces the model to run it*.
Its structural finding is the day's bug class in one sentence: a grep for imperative verbs
against tool paths returns **four hits in 87KB of SKILL.md**. Every other instrument is named in
descriptive voice — "`width.sh` measures", "`seat-probe.sh` proves". **Descriptive voice is the
GATE 0 shape in grammar form.** Real enforcement reaches only two carriers: the PreToolUse hook
and the five-minute tick. Anything unreachable from those is advisory, however well written.

**`speech-check.sh` was the worst case, and worse than suspected.** It lints client-facing text
for file paths, workflow ids, law numbers, model names and dollar figures — the exact leakage a
non-technical client must never see. Nothing ever ran it. Its own tick alarm was conditioned on
a drafted message under `CONTROL/.speech/`, so speaking *without* drafting produced no draft,
therefore no alarm, therefore a silent pass: a hole shaped precisely like the failure the
instrument was built to prevent.

`conversation-gate.py` now lints every client-facing message through it. The gate already had
the message in hand and already resolved the project home, so this is one pipe and no new
artifact. Verified directly rather than taken on report: `speech-check.sh - --home <dir>` reads
stdin (`speech-check.sh:43`, `:231`); rc 3 REJECT, rc 0 CLEAN, rc 2 UNDETERMINED.

**Only rc 3 blocks.** An instrument that could not run proves nothing and must never be
reported as a fault in the message — the negative-result rule applies to this gate as much as to
anything else. Its detail lines print the matched token only, never the surrounding sentence, so
a block reason cannot re-leak the message it is objecting to.

Every real question in the interview bank was run through it and passes clean, including the
Convert and Flow key ask that contains the word "Token" — the one sanctioned exception. 25
selftest checks. The gate still catches the 1:47 PM stall by name, is still silent on a session
that merely discusses spec-protocol, and costs 23ms per stop.

### Also found, not yet fixed

`watch-tick.sh --arm` is never forced and is the master dependency — `anchor.sh`, `bar-check.sh`
and every drift alarm are invoked only by the tick. On a PROFILED project `--arm` refuses
outright by design (`watch-tick.sh:712`, PROFILE-OWNED), so a naive crontab check would
false-positive there; the correct detection for a profiled observer is still open.
`seat-probe.sh` is transitively dead: `dispatch-check.sh:1164` exits 11 on a missing
`SEAT-PROBE:` line, but nothing forces `dispatch-check.sh` and the hook that IS forced carries no
such check. `dispatch-gate.py` is registered on the `Workflow` matcher only, so `Agent`/`Task`
dispatches bypass shapes 1-7.

## [1.22.0] — 2026-09-21

### The conversation contract moves out of prose and into a script

Seven releases in one day rewrote this contract in `SKILL.md`, and **every one produced a new
conversational defect on the next run**: a category word where the product had a name; the
entry-mode question bundled onto the naming line; an interrupted question dropped; `ANSWERS.md`
missing; a GATE 0 check reasoned about instead of run; a question that ended its message and
then a turn that stalled on a full stop.

One fix never regressed: `gate0-claim-gate.py`, because it is not prose. Prose in a skill file
is advisory to a model. A Stop hook is not.

**`tools/hooks/conversation-gate.py`** now enforces six invariants when a run yields the turn:

| | Blocks | The defect it would have caught |
|---|---|---|
| **A** | turn ends on a statement while `ANSWERS.md` shows a question `not yet spoken` | 1.21.5 — the 1:47 PM stall |
| **B** | more than 20 characters of prose after the last question mark | 1.21.4 — "Did I get that right?" then the naming line |
| **C** | question marks in two separate paragraphs | the two-question wall |
| **D** | a question asked while the ledger shows nothing awaiting an answer | the unrecorded question |
| **E** | "call it your <category>" where the folder supplies a real name | 1.21.1 — "your computer program" for Studio Nerds |
| **F** | a fork announced and self-resolved in the same breath, turn ending on it | 1.21.4 — "I'm going with the first one unless you say otherwise" |

**C is deliberately not a count of question marks.** "Does it need to remember anything they did
before? Or can it start fresh each time?" is ONE either/or question and must pass; two questions
in separate paragraphs is the wall. **D is deliberately not "is this question in the ledger?"** —
that fires on a question legitimately just asked and would jam the run. It fires only when the
ledger shows nothing pending at all, which is the provable staleness.

**Scope.** Every check is gated on `00-INPUT/ANSWERS.md` existing beneath the session's working
directory — a file that exists only inside a real project folder. A session merely *discussing*
spec-protocol, including the one that wrote this hook, is never evaluated. Verified against this
session's own transcript: silent.

Same contract as the proven gate: always exits 0, blocks only via
`{"decision":"block","reason":…}`, honours `stop_hook_active`, fails silent. 19 selftest checks
plus end-to-end fixtures driven by the real 1:47 PM stalled transcript, which it catches by name
("entry-mode (step 3)"). Registration preserved every existing Stop hook: 6→7 in `~/.claude`,
2→3 in `~/.claude-nine`, none lost.

### Still prose, and honestly at risk

The jargon check is the next GATE 0: `tools/speech-check.sh` exists and nothing forces it to run
before a message is spoken — a capable instrument nobody invokes, which is exactly how the GATE 0
failure worked. The opening script's verbatim text and the question counter (`Question N of no
more than C`) are also unenforced. The hook also sees only the FINAL assistant message of a turn,
so a question buried in an earlier message of the same turn is invisible to it.

## [1.21.5] — 2026-09-21

### The other half: a turn ends ON a question

1.21.4 landed and immediately half-worked. The confirm question ended its message and waited —
the client answered "yes" — and then the run said:

> "Wonderful — that's exactly what I'll build for you. From here on I'll call it Studio Nerds."

…and ended the turn on that full stop. The entry-mode question, which `00-INPUT/ANSWERS.md` was
correctly holding as `_not yet spoken — comes immediately after build-target confirms_`, was
never asked. The session sat idle with nothing pending and the client staring at a statement.

Two things caused it, both introduced the same day. Section 3 said "Speak the naming line,
stop. Then speak this, by itself" — "stop" was meant as *stop the sentence*, and was read as
*end the turn*. And 1.21.4's rule said a question ends the turn, which implies a statement may
end one too.

**The rule has two halves and they are one rule.** Nothing may follow a question — **and a
client-facing turn ends ON a question.** The run never yields on a full stop while anything is
still owed. A short acknowledgement of what the client just said MAY open the message; the
question closes it, and the message ends there. An acknowledgement plus the next question is
ONE screen and ONE thing to answer, which is what the one-question rule always meant; two
QUESTIONS, or a question with prose after it, is the wall it forbids. When the run genuinely
has nothing left to ask, it does not yield at all — it keeps working.

The naming line and the entry-mode question are now explicitly ONE message, in that order,
ending on the question mark.

## [1.21.4] — 2026-09-21

### A question ends the message and ends the turn

A fourth run got the machinery right and the conversation wrong. GATE 0 ran its check and
passed, the decision engine resolved, four `reader` agents dispatched on a profiled project,
`00-INPUT/ANSWERS.md` tracked what was owed, the target came from the declared `targets` array,
and it said "From here on I'll call it Studio Nerds, which is the name already on your notes."

The owner's verdict: **"it never asks me any question."** He was right, and three separate
defects made it true.

**The idea question was deleted.** The client had typed his description into the command
arguments, so the opening's last line — the question itself — was replaced with "You already
told me the idea, so I won't ask you to say it twice", followed by statements. Two rules
written on the same day collided: "the opening script is verbatim, never shortened" lost to
"an answered question is stated back, never re-asked". The opening ended on a full stop. The
idea question is now NEVER deleted, however the idea arrived; a supplied description is
acknowledged in one line before it, and **every opening turn ends on a question mark**.

**The one real question was buried and then talked past.** "Did I get that right?" sat in the
middle of a long message with statements before it and the naming line after it.

**A genuine fork was self-resolved.** The run found a real ambiguity — is Higgsfield the BAR
Studio Nerds is measured against, or the thing to rebuild FROM, two materially different
products — laid out both, and said "I'm going with the first one unless you say otherwise." It
announced a decision only the owner could make and walked on before he could answer.

### The root cause: a hundred rules about what to say, none about when to stop

**THE TURN-YIELD RULE.** A question is the LAST thing in its message and it ENDS the turn.
Nothing follows it: no statement, no naming line, no second question, no "while that lands", no
further tool call, no continued work. A question with prose after it is not a question — it is
a remark the client scrolls past, which is how a run can "ask" a dozen things and leave the
client certain it asked nothing. Bound in `SKILL.md` section 3, `audience.md` §1 and
`interview.md`'s rule list, because it is violated in all three places.

**A genuine fork is asked, never self-resolved.** Two plain options, one sentence saying which
you would pick and why, then STOP. Only after the question has been asked and left unanswered
in a LATER turn may the stated default be taken — and it is then recorded as a DEFAULT, never
as the client's answer.

## [1.21.3] — 2026-09-20

### The GATE 0 rule moves out of the document and into a script

1.21.2 wrote the rule down for the third time. A rule that has been rewritten three times and
broken four is not a wording problem, so it is now enforced by
`tools/hooks/gate0-claim-gate.py`, a Stop hook registered in both config roots.

When a turn speaks the GATE 0 refusal and no `--check-session` call appears anywhere in that
turn, **the hook runs the check itself** and blocks the stop:

- **The check passes** — the refusal was false. Blocked, with the real verdict line handed
  back, and instructions to delete it and continue with the opening script. A session that
  already has ultracode can no longer be told to switch it on.
- **The check fails** — the refusal was right but unproven. Blocked once, to be restated citing
  the verdict line, so the transcript carries the evidence the protocol requires.
- **The check cannot run** — UNDETERMINED, named as such, never "the switch is off".

It never opens a genuinely closed gate; it only ever refuses an UNPROVEN refusal. It follows
the claim-gate contract already on this machine: always exits 0, blocks only by printing
`{"decision":"block","reason":…}`, honours `stop_hook_active`, and fails silent, because a
broken gate must never wedge a session. Eight selftest checks, plus six end-to-end fixtures
covering the real failure, a legitimate refusal, an ordinary turn, re-entrancy, a genuinely
absent ultracode, and malformed input.

Registration preserved every existing Stop hook in both roots — five became six in `~/.claude`,
one became two in `~/.claude-nine`, none lost.

## [1.21.2] — 2026-09-20

### GATE 0 signals 3 and 4 are commands, not judgements

A genuine ultracode session was refused at GATE 0 and told to switch on what it already had.
The launcher had worked perfectly: the title bar read `claude.exe --effort ultracode`, the
status line read `ultracode`, and the process environment carried `CLAUDE_NINE_ULTRACODE=1`
and `CLAUDE_CONFIG_DIR=/Users/…/.claude-nine`. Run by hand,
`gate0.sh --check-session` returns `PASS | witness=launcher-env` with exit 0.

**It was never run.** The whole turn was six seconds and zero tool calls, the thinking reading
"Enforcing GATE0 by stopping and requesting the required ultracode keyword before proceeding".

Root cause is the wording, not the code. GATE 0 listed four signals as one uniform sequence.
Signals 1 and 2 are read from the turn's own text — things a model evaluates in its head — so
signals 3 and 4 were evaluated the same way and came back "no". But 3 and 4 are facts on disk
and in the process environment, and **a model cannot observe its own environment variables by
introspection; it has to ask the shell.** `fff4773` fixed the witness and 1.20.1 made the
launcher set it, yet neither mattered while the check that reads them went unexecuted.

- Signals 3 and 4 are now marked as COMMANDS that are RUN, never reasoned about.
- **The hard stop is forbidden until `gate0.sh --check-session` has run in that turn and exited
  non-zero.** A refusal with no such call in the transcript is a defect, not a gate. A check
  that cannot be run at all is UNDETERMINED — said in one line, treated as a fail, and never
  reported as "the switch is off".
- The rule is repeated where it is acted on: the ordered step list and the never-do list.

## [1.21.1] — 2026-09-20

### Call it by its name

A third real run did almost everything right: ultracode was already on, the opening was plain,
eight readers covered **all 33 documents in the folder before a word was said back**, the
declared targets produced `DESKTOP_SOFTWARE` rather than the phone app of two runs ago, and the
finding was stated rather than asked — "your notes say a desktop program for Mac with a browser
version as well; that's what I'll build unless you tell me otherwise."

Then it said: *"From here on I'll call it your computer program."*

The product is named **Studio Nerds** — in the profile's `project.name`, in the bound state, in
`goal.md`, in the specification's title, and in the folder's own name. All of it had just been
read. The naming line interpolated the six-way taxonomy's category word because that is all
1.20.0 ever told it to interpolate, and the owner's reply was that he hated the name and had
already given one. Reading everything and then calling the thing "your computer program" reads
exactly like having read nothing — the naming defect discredited the reading fix that had just
worked.

**Before speaking the naming line, look for the thing's actual name** in what was already read:
the profile's `project.name`, the bound state, the goal document, the specification title, the
folder name, or the client's own words. If it has a name, use it. The category word survives
only for a genuinely unnamed project, and then as "until you give it a name."

**`00-INPUT/ANSWERS.md` is created before the opening script is spoken, not later.** The run
reached the naming line with no such file, so 1.20.3's interrupted-question tracking had nothing
to write to and no record of the entry-mode question still owed. On a supplied folder it is
created inside that folder — the one MISSING document RULE 1 permits writing there.

## [1.21.0] — 2026-09-20

### The decision engine — small typed judgements, never a dependency

spec-protocol can now use a System One decision model (TypeSafe's Jev) for the small typed
judgements that recur all run: which of six things is being built, whether a sentence carries a
word the client will not know, whether a paid generation is about to exceed what was approved,
whether a repair loop has stopped improving. Roughly 250ms and a hundredth of a cent per call.

**Nothing depends on it.** Every one of the seven call sites carries a named fallback to the
behaviour this skill had before, and `references/decision-engine.md` refuses a new site that
does not add one. A client with no key gets the same finished product by the same route.

**The ladder, resolved silently at step 2.7** by the new `tools/jev-check.sh`: a direct
`JEV_TYPESAFE_API_KEY` always beats a brokered `OPENROUTER_API_KEY` serving `typesafe/jev-1.13`;
neither is ABSENT, which is a fact and not a failure. Keys are resolved by NAME and parsed,
never sourced, and no value reaches a log, a receipt, or a command line. Exit 0 PRESENT, 1
ABSENT, 2 UNDETERMINED — a key that exists but could not be tested is never reported ABSENT, and
HTTP 402 is "the account needs credit", never "no engine".

**`GET /api/v1/models` does not list Jev, and that proves nothing** — the listing covers models
whose output is text, and Jev's modality is `decisions`. Reachability is decided by a real call.
This is written into the tool and the reference because the author of both fell for it first.

**The client hears one sentence, or none.** Present or undetermined: silence, because setup
outcomes are never put to the client. Absent: one plain offer after the opening script, because
credit on an account is the client's money. A decline is a recorded default, never raised again.
The sentence names **typesafe.ai** — `jev.ai` is a parked domain-for-sale listing and is never
given to a client.

### A threshold alone does not protect you

The classification site was built with an 0.85 auto-accept line and then tested against the case
that caused this morning's bug. Bare sentence, no other evidence: `MOBILE_APP` at **0.96
confidence — confidently wrong** for a macOS program. The same sentence with the profile's
targets in the state: 0.61, and correctly uncertain.

So the rule shipped is not the rule designed. **The engine's answer is a PROPOSAL for the confirm
sentence and never a decision; the client confirmation is mandatory at every confidence, and the
engine never records `BUILD-TARGET:` itself.** The threshold governs only whether the either/or
is ALSO offered. The state must carry every piece of evidence the run already holds, and a
declared `targets` array outranks the engine outright and stops it being called at all.

### Where it is never used

No blind visual comparison — it cannot see a rendered page. No PASS verdict, no release council,
no gate of record: ~68% accuracy with no attached evidence cannot license a client's work to
ship. No repair payload — it gives no explanations, so it can say a thing failed and never what
to fix. No builder, fixer or merge writer. And never anything a deterministic instrument already
decides: a script that can prove a fact outranks a model that can only estimate one. The dispatch
risk gate is advisory in one direction only — it may add a refusal and may never turn a gate's
refusal into a pass.

## [1.20.3] — 2026-09-20

### Read first, state what you found, and always ask where the material is

A second real run exposed the parent bug behind 1.20.2's misclassification: nothing forced the
run to READ the supplied material before it said its first sentence back to the client. It
guessed "an app people use on their phone" at 10:30 with nothing read, was corrected, read the
folder only when ordered to at 10:35, and then asked the same confirm question again at 10:42.
Asking before reading and asking after reading are the same defect.

**Read before the first confirm sentence.** When a run starts in a folder holding a profile or
documents, they are read in full through a `reader` dispatch — never grepped — before a word is
said back about what the client wants. The order is fixed: read, state what was found, let them
correct it.

**Stated versus asked, written down.** A fact the documents answer — what the thing is, its
surfaces, its features, its scope — is STATED in one correctable line and counted ANSWERED, not
put as a question. Only what documents cannot answer is asked: money, accounts, taste, and
whether the proposals in the packet are decisions the client actually made. A written spec is
never proof the client approved it — that is why the interview still runs on a profiled project,
and it is equally why the interview must not re-ask what the spec settles. Both halves, or the
rule is broken.

**The working directory is not an answer.** Starting inside a folder is not a pointing gesture,
and a `.spec-protocol.json` sitting there is not the client saying "this is all my material".
The previous wording told the client what they had already given — "you've already pointed me at
notes in this folder" — which answers the entry-mode question on their behalf. Entry mode is now
always asked, in open words that presuppose nothing, and the client may point at material
anywhere on the machine, in any number of places, or do both halves: tell you AND point. What
was read is confirmed back with a count so they can say what is missing.

## [1.20.2] — 2026-09-20

### Three defects found by the first real 1.20.0 run

The opening script, classify-and-confirm and entry mode all fired — the 1.19.5/1.19.6
bypass is genuinely gone. Three faults in the 1.20.0 edit itself surfaced instead.

**A declared `targets` array now DECIDES the taxonomy.** The profile said
`["desktop-macos-arm64","linux-vps-web"]` and the run still classified `MOBILE_APP` from
the client's word "app", then had to be corrected. 1.20.0 said packet documents are a
pre-statement read but never wired `targets` to `BUILD-TARGET`. Each declared target now
maps to its taxonomy value (`desktop-*` → DESKTOP_SOFTWARE, `*-web` → WEB_APP, mobile →
MOBILE_APP, mobile+web → MOBILE_AND_WEB), the FIRST entry is primary, every other declared
target is recorded as an additional delivery surface, and the client is CONFIRMED rather
than interrogated. "App" is ordinary English for any program and is never evidence about a
surface.

**Entry mode is its own message, in the same two-way words.** 1.20.0's profiled framing
turned the choice into a lopsided add-on — "want to add anything in your own words?" —
bundled onto the end of the naming line, which is a statement plus a question in one
message and a standing violation of the one-question rule. The naming line is spoken and
stopped; the entry-mode question follows alone, in the canonical wording, with the supplied
folder named so the choice is real.

**An interrupted question is UNANSWERED, and it comes back.** The entry-mode question was
overtaken by a classification correction thirty-two seconds later and never returned.
Questions are now written to `00-INPUT/ANSWERS.md` under their stable key the moment they
are SPOKEN, with the answer blank; a blank is the re-ask list, read before every question
and after every re-classification. The file exists before the first counted question — on a
supplied folder, inside that folder — and reaching the counted list without it is a defect
the step-20 self-audit rejects. Never re-asking an answered question and never abandoning an
unanswered one are the same rule; only the file distinguishes them.

## [1.20.1] — 2026-09-20

### The macOS launcher: one launcher, and ultracode that sticks

Two macOS launchers had diverged. The one this repo shipped requires a
`router-session.json` state file; the one actually installed and in daily use
(`~/.local/bin/claude-nine`) does not, and that file does not exist on the
reference box — so the repo's copy could not have run there at all, and the
`fff4773` ultracode fix landed in a file nobody executes. The repo now carries
the launcher that is genuinely in service; the previous one remains in history.

**Ultracode is now sticky.** `/effort ultracode` typed inside a session is
invisible to every subprocess — the binary exports only the LEVEL (`xhigh`), so
a later launch could not know ultracode had ever been chosen, and spec-protocol
GATE 0 told the user to switch on what they already had. The launcher now
remembers the choice in its own config root and re-applies it every launch:

    claude-nine --ultracode      turn it on, and remember it
    claude-nine --no-ultracode   turn it off, and forget it

`CLAUDE_NINE_ULTRACODE` in the environment still wins over the remembered value,
and user arguments pass through untouched. Verified across all five states —
off, on, sticky-on, off again, sticky-off — plus argument passthrough; GATE 0
`--check-session` moves from `NO-SESSION-ULTRACODE (rc=1)` to
`PASS | witness=launcher-env (rc=0)`.

`SKILL.md`'s GATE 0 advice was still pointing at the dead route
("relaunch with `claude-nine` after `/effort ultracode`"); it now names
`claude-nine --ultracode`. The Windows launcher is deliberately unchanged — it
cannot be tested from here.

## [1.20.0] — 2026-09-20

### spec-protocol 1.20.0 — the protocol is universal again, and Candace speaks plainly

**The regression.** 1.19.5 and 1.19.6 introduced a second path: any folder containing
`.spec-protocol.json` skipped steps 3 through 22 entirely. On that path `/spec-protocol` became
four commands — bootstrap, validate, dispatch, release — with no opening script, no
classify-and-confirm, no entry mode, no brainstorm, no interview, no Capacity Ledger, no
research, no ratified bar, no design direction, and no five-minute tick. A real run reached
three hours, four compactions and zero lines of application code, having asked the client one
question. This release ends that fork.

**A profile binds state and dispatch. It never cancels the conversation.** It changes exactly
three things inside the one sequence: the canonical state file is `documents.state` rather than
`CONTROL/project_state.json`; dispatch authorization goes through `commands.dispatch` rather
than `tools/dispatch-check.sh`; release proof goes through `commands.release`. Every other step
runs on every project. Where a packet document already answers an interview question, that is a
PRE-STATEMENT READ — stated back in one line and counted ANSWERED — never an assumption, and
never the client's approval of a decision they never made.

**The helpers are redirected, not switched off.** `gate0`, width, ledger, anchor, watch-tick,
state-check and audit-gate all still run on a profiled project, reading and writing the bound
state. GATE 0b now reads "EVERY project, profiled or not"; RULE 5 reads "EVERY dispatch". An
unwatched run was the exact failure these instruments exist to prevent.

**The `reader` role.** SKILL.md forbids the conductor from reading a project document in full in
its own context, yet the profiled dispatch gate accepted only `builder|qc|repair` — so a
profiled run could not dispatch a reader at all, and burned its context on whole documents. A
reservation-exempt `reader` role now exists in `tools/hooks/dispatch-gate.py` and in the profile
contract: it writes nothing, owns no path, spends no counter, and therefore reserves nothing.
Every other role is still reservation-checked; the hook's selftest covers 27 cases.

**The PROFILE-DEFECT escape.** When a packet's own contract is self-contradictory, that is a
defect in the packet, not a blocked run and not a question for the client to unblock. It is
proven once, written to the bound state as `PROFILE-DEFECT: <file>:<line> vs <file>:<line>`, and
raised to the client in one plain sentence within five minutes. Re-validating a proven
contradiction is the drift the tick exists to catch.

### Candace speaks to a sixty-five-year-old, not to an engineer

The client-facing language throughout `SKILL.md` section 3, `references/interview.md` and
`references/audience.md` is rewritten. The engineering logic, the routing, the question keys,
the counters, DEFAULT and ADVANCED mode, the capture behavior and GOAL.md generation are all
unchanged; no required question was removed and none was added.

- **A banned-word list is now binding** (`audience.md` §2): database, hosting, deployment,
  repository, Git, branch, server, provider, API, token, responsive, frontend, backend, CLI,
  environment, runtime, framework, model, endpoint, workflow, agent, context window,
  authentication, OAuth, webhook, DNS. Each has a plain-English replacement that says what the
  thing DOES. "Does the application need a database?" becomes "When someone comes back later,
  does it need to remember anything they did before — their account, appointments, saved work,
  purchases, or progress?" The one standing exception is a label the client must FIND inside
  their own account, such as the Convert and Flow Private Integration Token.
- **Two silent checks run before any question is spoken.** Could a sixty-five-year-old business
  owner understand this immediately? And: am I asking them to decide something I should be
  deciding? A no and a yes each force a rewrite.
- **The recommend-first rule.** When Candace knows enough to choose well, she recommends with one
  ordinary-language reason and asks only for a yes. "I don't know", "whatever you think" and
  "you choose" mean Candace chooses — the decision is never handed back.
- The opening script, all six classify-and-confirm frames, the five either/or questions, entry
  mode, the brainstorm probes, the reflection, the mode question, every Step 1d branch, the six
  content-inventory questions, the artwork question, D1, D4, the done-condition and all five
  advanced-mode questions are rewritten in plain speech.

### New: `references/media-model-selection.md`

The single owner of every image- and video-service recommendation. Candace recommends; the
client never researches AI models and never sees a catalog, a model ID, a benchmark or a
price-per-second. No model version is hard-coded — the live catalog and current pricing are
inspected before any recommendation that costs money, and an unverifiable figure is never
quoted. Images weight quality over small price differences; video is scored on quality, length,
cost, resolution, audio, control and speed with a per-job weighting, estimated as
`shots × seconds × retries × cost-per-second`, and run up a three-level escalation ladder so a
project spends premium money only on the shots that need it. A cost guardrail stops before any
generation that materially exceeds what the client approved. The client approves MONEY; Candace
chooses the technology.

## [1.19.0] — 2026-09-07

### spec-protocol 1.19.0 — the Gauntlet Loop update

A review of the skill against the Gauntlet Loop PDF found three root causes: it
sized its swarm from a declared number instead of the machine, it had no finish
line a judge could apply, and its loops could be switched off. Twenty-six work
items were built in five waves, each judged by a model that did not build it, and
landed through one merge writer. The skill's own VERSION moves 1.17.7 → 1.19.0;
the repository's release sequence continues from `v1.18.0`.

### Width is measured, never declared

`clientCap` is now `max(2, min(16, cores−2, floor((ram_gb−6)/1.5)))`, taken from
the machine at Capacity-Ledger time and marked `[MEASURED <instrument> <ISO>]`.
The operator's `systemConcurrentMax` declaration, the "REPORTING ONLY"
environment read and the run that "refuses to plan" on an undetermined number are
all gone, and so is the 20-agents-per-wave Anthropic cap: width on Anthropic paths
is workflows × clientCap with the burn governor as the only limiter. Hand-made
batching is gone with them — every slice of a workflow goes to ONE `pipeline()`
call and the harness queues the rest as a rolling window. On the operator's
12-core, 24 GB machine that is 10, and an unmeasurable box falls back to 4 and
says so rather than guessing.

### One swarm shape

`gauntlet.md` §13 now carries five workflow types and no others — WF01 Blueprint
Lock, the Unit Gauntlet (build, blind visual judge, technical judge and fix loop
fused into one `pipeline()` per stream), the Integrated Visual Gauntlet, WF05
Release Council and WF06 Selective Repair. The pairs-of-five doctrine and the
third and fourth shapes are deleted. Four forbidden shapes are listed with the fix
for each, and the dispatch gate refuses all four.

### A finish line, one verdict, and scores that only trend

Gate 3 is decided by the frozen relationship — wins-or-ties passes on OURS or TIE,
meet-all-requirements passes when every requirement checked passes — and the judge
never raises the relationship mid-run. The binary verdict decides; the 0–10 score
across the ten categories is recorded for trend only and never decides, so the old
8.5 numeric gate is retired. Every verdict writes a `SCORE` ledger line, the
plateau rule ends a unit honestly when three rounds gain less than 0.3, a new judge
instance re-judges each round, and `CLIENT-ACCEPTED` joins the QC RECORD outcomes.

### Loops always on, drift that recovers itself, a cap that pauses

The "runs once while you watch" branch is deleted: the shape test has one input
and the survival loops are always derived. Terminal drift is now the last rung of
a ladder the run climbs for itself — re-dispatch from checkpoint, a two-hour grace
when the last state change was a capacity event, fall back to other seats, and only
then the flag; a fresh session clears that flag after it writes the named blocker.
The agent cap pauses instead of stopping: `initial = WF01 + units × 3 + 4`, warn at
`max(150, 3 × initial)`, first pause at `max(200, 4 × initial)` with the best stable
build deployed and one plain question, each "keep going" buying another block, and
an absolute ceiling of 2,000 per project counted per project rather than per session.

### The enforcement kit ships as code

Five instruments replace five paragraphs of intention. `tools/width.sh` measures
cores and RAM on macOS, Linux and Windows and prints `CLIENT_CAP` with its mark.
`tools/dispatch-check.sh` refuses an under-width dispatch with no stated dependency
and a padded one alike, and increments `executions_total` atomically on the ones it
passes. `tools/watch-tick.sh` is the five-minute tick — reconcile, then S2, S3, S5,
S6 and S13 — installed as a cron line the skill writes and announces, with the
conductor's in-session loop reading its ACTION lines. `tools/ledger.sh` gained the
`SCORE` class and now writes `CONTROL/last-intents.txt` so the reconciler's
repeated-intent check has an input. `tools/hooks/dispatch-gate.py` blocks the
forbidden shapes before a Workflow launches. Each carries a selftest that proves the
instrument on a known-positive and a known-negative first, each fails open on a
tooling error rather than reporting a comfortable zero, and Node twins under
`scripts/common/` keep the gate, the tick and the ledger working where bash is absent.

### The client hears plainer words

Every client-facing text is the reviewed wording, verbatim: the opening, the
ultracode gate, the entry-mode question, the defaults line, the restart sentence
(now one identical string in four files, with `<launcher>` and
`<Terminal app | PowerShell>` interpolated), the status message, the pause-at-the-cap
question and the morning-report opening. Mac-only keystrokes are gone from every
client sentence. `interview.md` was rewritten from 1,500-odd lines to 435: six
sections, one numbered list per mode, the six content-inventory questions, and a
counter that may only ever be lowered. The audience is "a non-technical adult, often
sixty or older, building for their own business or project."

### A design pipeline every target runs

`design-brief.md` and `design-direction.md` are new and run for websites, funnels,
web apps, mobile apps and desktop software alike — the brief with its Mobbin check
and copy bar, the direction with three rendered variants scored blind and one
locked. `ship-checks.md` adds ten instruments each with a command, a report path
and a threshold, and `publish.md` deploys, proves 200, asks for the domain in the
client's own words and records the live address. The stage order is one string
written identically in every stage file, the bar is frozen as screenshots at
selection rather than held as a URL, and the evidence harness is the first unit of
the first tree with `HARNESS-READY:` gating the first page dispatch.

### The knowledge pack, the funnel gate, and the media split

`references/knowledge-pack.json` names the thirteen onboarding folders the funnel
path needs, and `scripts/bootstrap-companions.sh` resolves each from a local
OpenClaw install, then a local checkout, then reports pull-required — never a
silent fetch. The funnel gate asks for the three keys in the operator's exact
wording and says a Mac is preferred until headless page-building is proven.
`media-pipeline.md` was split into an image file of 670 lines, a `media-video.md`
loaded only when the plan contains video, and a research log never loaded at
runtime; `tools/prompt-band.sh` is now the one prompt gate for every provider.

### Windows, and a SKILL.md a person can read

Git Bash becomes a hard prerequisite the Windows installer places, GATE 0 checks
for it in one plain sentence, and the four Node twins are documented as the
PowerShell fallback. `SKILL.md` is 671 lines, down from 2,156: the laws table, the
S-table, the storage layout and the long essays moved to `references/`, the
standards and their five instruments live in the new `references/enforcement.md`,
and the team path moved to `references/optional/agent-team.md` behind a 15-line
stub. Every reference the file cites exists on disk.

Closes S1–S7, G1–G7, R1–R7, C1–C11, W1–W15, M1–M7, E1–E6, B1–B4, VIS-1–VIS-4,
PLAT-1 and PLAT-2.

## [1.18.0] — 2026-08-30

### Candice Companion removed entirely — eradication campaign

The Candice Companion desktop experiment is over. After two weeks of iteration the
operator ruled (2026-08-30): **NO floating companion AT ALL** — no app, no image, no
hologram, no audio, none of it. The failed experiment is gone root and branch; the
repository returns to its charter: provisioning the local 9Router gateway and the
`claude-nine` command on native Windows and macOS.

Removed (1,262 files, ~203k lines deleted across three commits):

- **Wave 1 `b38e139`** — wholesale trees: `apps/candice-companion/` (the Tauri
  desktop app and its `src-tauri` speech/hologram machinery), `plugins/candice-integration/`
  (the MCP plugin), `packages/candice-protocol/`, six `scripts/candice-*` trees
  (bootstrap, release, updater, upgrade, ci, visual), `spec/` (MASTER-SPEC,
  PROJECT-MANIFEST, CANDICE-WELCOME amendment), 12 Candice test suites,
  `.github/workflows/candice-{ci,release}.yml`, `evidence/`, `holding/`,
  `deny.toml` (cargo-deny whose only subject was the companion crates),
  `CAPACITY-LEDGER.md`, campaign docs.
- **Wave 2 `c197876`** — surviving files: README install section,
  CHANGELOG Candice release entries, THIRD_PARTY_NOTICES speech-runtime section,
  `.gitignore` Candice block, all CONTROL machine-truth Candice fields,
  `scripts/excellence-gate/` (campaign gate with no non-Candice subject),
  the CANDICE section of the spec-protocol skill (its generic
  ask-in-terminal fallback doctrine survives), `tools/boss-cron` comment
  provenance, windows-parity references.
- **Wave 3 `7e3fe57`** — independent Codex gap-review fixes: CONTROL truth
  reconciled to campaign-complete, the windows-parity `env-sweep` self-test
  sandboxed so it can never overwrite the real `~/.env`, `boss-cron --check`
  made genuinely read-only (no singleton lock), the watchdog census fixture's
  broken `OLD_BOSS` path fixed, dangling spec references rewritten
  self-contained.

Verified after removal: a repo-wide census for `candice`, `hologram`, `kokoro`,
`whisper`, `speech-assets` and `ask_user` returns zero real residue (remaining
matches are the literal `tts` inside the `trevorotts1` remote URL and
"companion skills" doctrine meaning the vendored eli5/bro skills, which are
charter-protected). The five bundled skills, four launchers, platform setup
scripts and `tests/{macos,windows,interview}` suites are intact, with skill
versions in lockstep with `CONTROL/bundled-components.json`. The
`candice/*` branches and `candice-v*` release tags were deleted from the
origin remote. Release tags resume at `v1.18.0`.

## [1.17.7] — 2026-08-27

### Statusline: session cost relabelled `≈$N api-equiv` — it is not a bill

The cost segment rendered a bare `~$112.89` on a plain session. The figure itself is sound —
it is Claude Code's own `cost.total_cost_usd`, and an independent recomputation over this
session's transcript (597 turns: 625,998 output, 6,993,513 cache-write, 119,871,445 cache-read
tokens) reproduced it to within ~6% at Anthropic list rates, the residual being cheaper
Haiku/Sonnet subagent turns. What it is NOT is money owed: an operator on a Claude
subscription pays $0 marginal for those tokens, so a bare currency figure reads as a charge
that was never incurred.

Both cost paths (primary `cost.total_cost_usd` and the token-count fallback) now print
`≈$N api-equiv`. The number is deliberately kept — it is a genuine usage meter, and on long
sessions it is dominated by cache reads, which is the most actionable signal on the bar — but
it can no longer be mistaken for an invoice. Routed (claude-nine/9Router) sessions are
unaffected: they still omit the cost segment entirely, per 1.17.6.

Verified on the real captured payloads, bash 3.2.57 and 5.3.12, all six runs rc=0: routed →
`Opus 5` (no figure); plain post-turn → `Haiku 4.5 | ≈$0.06 api-equiv`; plain pre-turn null
guard → `Haiku 4.5 | ≈$0.00 api-equiv`. Installer heredoc and deployed script byte-identical
(md5 `a57471ab001ce348487b559aaa1ab276`).

## [1.17.6] — 2026-08-27

### Statusline: routed-cost defect was still live — the gate in 1.17.5 keyed on the wrong field

1.17.5 gated the routed-session cost exclusion on `model.display_name` shape (`*-chain`,
`fusion-*`). Live stdin capture the same day proved that gate could never fire: a
claude-nine/9Router session sends `model.id = "opus-chain"` (the raw chain id) but
`model.display_name = "Opus 5"` — a normal-looking Anthropic name that matches the `*opus*`
price glob same as a real Opus session. Captured proof of the live consequence: a routed
turn with `total_input_tokens = 46536` reported `cost.total_cost_usd = 0.235748` — priced at
roughly the real Anthropic Opus-5 input rate — while 9Router's own request records show that
turn was actually served by Ollama Cloud `glm-5.3-flash` (`opus-chain` leg 1), flat-subscription
traffic with near-zero marginal cost.

- **Routed detection now keys on `model.id`, never `model.display_name`.** `model.id` starts
  with `claude-` on every plain session (captured: `claude-haiku-4-5`) and never does on a
  routed one (captured: `opus-chain`) — that prefix is the real, live-proven signal. An
  absent/unrecognized `model.id` defaults to routed-safe (cost omitted), never to showing a
  price.
- **Removed the dead `*-chain`/`fusion-*` glob from `price_for()`** — it could never match,
  since the chain id never reaches `display_name`.
- **Plain-session cost now uses `cost.total_cost_usd` directly, unconditionally** (previously
  gated behind a `price_for(display_name)` match even on the primary path, which was
  unnecessary once the routed check runs first — non-routed is what makes the harness's own
  figure trustworthy, regardless of which Claude family it names).
- Fallback (token counts × price table) is unchanged and still applies only when
  `total_cost_usd` is absent/null.

Both claims were independently re-verified against the raw captured payloads (not taken on a
report's word) before this fix was written: `stdin-1787842192834505000.json` (routed,
`id=opus-chain`/`display_name=Opus 5`/`total_cost_usd=0.235748`), `stdin-1787842000536608000.json`
(plain, `id=claude-haiku-4-5`/`total_cost_usd=0.055459`), and the paired `env-*.txt` captures
confirming `CLAUDE_CONFIG_DIR`/`ANTHROPIC_BASE_URL` are set only in the routed child process —
corroborating evidence, not the detection mechanism itself.

Re-tested under system bash 3.2.57 and Homebrew bash 5.3.12 on the real captured payloads:
routed post-turn and pre-turn payloads both show no cost figure; plain post-turn payload shows
`~$0.06` (from `total_cost_usd` directly, not re-priced); plain pre-turn payload
(`total_cost_usd: 0`, `current_usage: null`) renders `~$0.00` without crashing. All prior
1.17.5/1.17.4 regression tests (Project-bar walk-up, corrupted state file, Fable pricing) re-run
clean on both shells.

Deployed `~/.claude/statusline-command.sh` regenerated from the updated heredoc and proven
byte-identical (md5 `5a8827290fea1ef013952330b52dec17`).

## [1.17.5] — 2026-08-27

### Statusline: five defects fixed (Project bar vanish, wrong prices, no Fable price, routed
### sessions mis-priced, bash 3.2 blank-bar risk)

`setup-statusline.sh` and its deployed `~/.claude/statusline-command.sh` carried five
independent defects, all fixed together and proven byte-identical after regeneration
(md5 `092f35e19e0c7450c24ae96d41b688e4`):

- **Project bar vanished outside the project root.** The lookup checked only
  `$cwd/CONTROL/project_state.json`. Spec Protocol projects are not git repos (no
  `git rev-parse --show-toplevel` available), so `cd`-ing one directory down made the
  segment disappear. Fixed with a bounded upward walk from `$cwd` to `$HOME` (hard floor
  `/`), stopping at the first `CONTROL/project_state.json` found.
- **Price table was wrong on three counts, with no Fable entry at all.** Deployed table read
  opus 15.00/75.00, sonnet 3.00/15.00, haiku 0.80/4.00 — opus 3x too high, haiku too low, and
  `price_for()`'s globs (`*opus*`/`*sonnet*`/`*haiku*`) had no `*fable*` branch, so every
  Fable session showed no cost. Corrected to fable 10.00/50.00, opus 5.00/25.00,
  sonnet 3.00/15.00, haiku 1.00/5.00.
- **Routed (claude-nine/9Router) sessions could show an Anthropic-priced number.**
  `model.display_name` on a routed session is a raw chain id (`opus-chain`, `fusion-coding`,
  …) — a live-edited, multi-provider fallback list, not a real Anthropic model — and
  `opus-chain` would silently match the naive `*opus*` glob. `price_for()` now refuses
  anything shaped like a chain id (`*-chain`, `fusion-*`) before testing any Anthropic family
  glob, so a routed session omits cost instead of lying about it.
- **Session cost no longer needs state-file delta math.** Proven (via the installed CLI's own
  payload-construction code) that stdin already carries `cost.total_cost_usd`, cumulative for
  the session. The script now reads it directly; falls back to
  `context_window.total_input_tokens`/`.total_output_tokens` × published pricing only on older
  Claude Code builds that don't yet emit `cost`. This retires the old state-file/delta design
  entirely, closing two live bugs: a corrupted state file used to blank the ENTIRE bar under
  `set -u`, and `~/.claude`/`~/.claude-nine` sharing one state directory (both symlink to the
  same `projects/`, `XDG_STATE_HOME` unset in both) used to double-bill a session that touched
  both harnesses.
- **`declare -A` blanked the whole bar on stock macOS bash.** macOS ships bash 3.2, which has
  no associative arrays; `declare -A` under `set -u` errored out the whole script. Replaced
  with a plain `case` statement — no associative arrays anywhere in the script now.

The routed-session env-var detector a prior review assumed existed (to distinguish a
claude-nine child process from plain claude) was checked directly in the installed CLI binary
and is **UNDETERMINED** — inconclusive due to minified-identifier collisions across bundle
scopes. Nothing shipped depends on it; the chain-id shape exclusion above needs no such
detector.

Tested under both system bash (3.2.57, macOS default) and Homebrew bash (5.3.12): Project bar
from project root and from a subdirectory two levels deep, a corrupted `project_state.json`
(bar still renders minus the Project segment), an `opus-chain`/`fusion-coding` payload (no
cost figure), and a `claude-fable-5[1m]` payload (cost now appears, both from
`cost.total_cost_usd` and from the token-count fallback).

See `.claude/skills/spec-protocol/references/progress-visibility.md` §4/§6 for the corrected
cost rule and Project-bar walk-up.

## [1.17.4] — 2026-08-27

### ENTRY-MODE: the gate was enforced but never written

The master fix spec (Issue 3, item 2) requires every run to record its entry
choice as an `ENTRY-MODE: interview|pointed` ledger line, and `tools/boss-cron`
has enforced it since. But `ENTRY-MODE` appeared **zero times** in SKILL.md — the
skill never wrote it. The enforcement half shipped and the writer half did not, so
the gate could never go green on any run, ever. It had been firing continuously.

- **SKILL.md now writes it**, in all three places that govern the flow: the entry
  question section ("The entry — interview me, or here is the info"), step 3
  (Offer entry modes), and step 20 (the self-audit now checks for the line).
  Written through `tools/ledger.sh` the instant `CONTROL/` exists — the run's
  first ledger line.
- **Explicitly distinguished from `INTERVIEW-MODE: simple|advanced`** (step 6).
  Two different gates: ENTRY-MODE records *how the client handed over material*,
  INTERVIEW-MODE records *how much detail they want to decide*. Both lines exist
  on every run and neither substitutes for the other — stated in the skill and
  enforced by the checker.
- **No backfilling.** Both the step-20 audit text and the skill say it outright:
  a line reconstructed after the fact is a guess wearing a timestamp. A run whose
  entry question was never asked reports as skipped, not as passed.
- **`PROJECTS` is now env-overridable** via `BOSS_PROJECTS`, completing the 1.16.3
  portability pattern that missed it. Without it the entry-mode and RESEARCH-READY
  gates could not be tested without writing fixtures into the operator's real
  `~/Downloads/projects`.

Verified with a two-case fixture proving the gate discriminates: a project whose
ledger carries `ENTRY-MODE: interview` in the real timestamped pipe-delimited
format passes clean, while a project carrying `INTERVIEW-MODE: simple` but no
ENTRY-MODE is still flagged — confirming the new writer format parses (it depends
on the 1.17.3 pipe fix) and that the near-miss line does not satisfy the gate.

## [1.17.3] — 2026-08-27

### Boss gates could not parse the ledger format their own writer emits

The RESEARCH-READY and entry-mode gates matched ledger lines with `^...$`-anchored
regexes against only two line shapes: bare (`BUILD-TARGET: WEBSITE`) and
backtick-wrapped list items. Live projects write a THIRD shape — the timestamped
pipe-delimited row, where the gate line is one field among several:

    2026-08-24T12:00:18Z | BUILD-TARGET: WEBSITE | user words: "..." | confirmed: yes

So the gate reported *"research dispatch-log row exists but NEITHER ledger line is
present"* on a project whose `CONTROL/LEDGER.md` carried both lines, correctly, on
lines 1 and 2 — every cycle, indefinitely. A gate that cannot parse the format its
own writer emits produces false alarms, not findings, and a permanently-red board
trains the operator to ignore it.

New `ledger_candidates()` yields all three shapes; `ledger_line_value()` and the
entry-mode matcher both read through it. Verified against the live project: the
"NEITHER line present" finding is gone and the gate now proceeds to the citation
comparison it was always meant to reach.

**Not silenced — two findings remain open by design:**

- `entry-mode`: the master fix spec requires an `ENTRY-MODE: interview|pointed`
  ledger line, and the boss enforces it, but `ENTRY-MODE` appears **zero times**
  in SKILL.md — the skill never writes it. The enforcement half shipped and the
  writer half did not. Fixing this means teaching the skill to write the line, not
  backfilling it into a finished project's ledger.
- `research` citation drift: the dispatch rows cite
  `INPUT-CAPTURED: 00-INPUT/RESEARCH-FINDINGS-…md` while the ledger's FIRST such
  line reads `00-INPUT/BRAINSTORM-…md`. `ledger_line_value()` returns the first
  match, but the gate's contract says the row must match the ledger's *current*
  line. Whether a later re-capture legitimately supersedes the first, or is itself
  the violation, is a semantics decision — left reporting rather than resolved.

## [1.17.2] — 2026-08-26

### Boss cron: liveness heartbeat split out of the tracked ledger

The boss wrote a `BOSSCYCLE-*` liveness marker into `FIX-LEDGER.md` on every
5-minute cycle. `FIX-LEDGER.md` is git-tracked, so that heartbeat guaranteed a
merge collision on every merge, forever, and buried the findings sitting next to
it. Measured on the operator box: **1552 of 1863 uncommitted ledger lines (83%)
were that one marker**, and the ledger had grown to 667KB — 2.5x its committed
size — entirely from telemetry.

- **Liveness is telemetry, findings are records.** The per-cycle `BOSSCYCLE-CLEAN`
  / `BOSSCYCLE-VIOLATION` / `BOSSCYCLE-ALERT` marker now goes to
  `CONTROL/boss-heartbeat` (new, gitignored), **rewritten** each cycle rather
  than appended, so it never grows. `VIOLATION-STOP` findings are real records
  and stay in `FIX-LEDGER.md`, where they were already deduped.
- **Both readers updated, with a ledger fallback.** `check_heartbeat` in
  `tools/boss-cron` and `tools/boss-heartbeat-alert` read the heartbeat file
  first and fall back to scanning the ledger when it is absent, unreadable, or
  empty — so pre-split installs and other checkouts keep working and an empty
  heartbeat never reads as a dead boss.
- **Env-overridable, matching the 1.16.3 portability pattern**: `BOSS_HEARTBEAT`
  and `BOSS_ALERT_HEARTBEAT`.
- **Runtime state gitignored**: `CONTROL/boss-heartbeat` and
  `CONTROL/stop-workstream` are per-cycle runtime state, not source.

Verified: patched boss runs all 16 checks and reports the same 3 pre-existing
findings (no regression); heartbeat reader **discriminates** — a fresh marker
yields 0 beat findings, a 45-minute-old marker correctly fires
`last BOSSCYCLE-* line 45 min ago (> 2 cycles)`; `boss-heartbeat-alert` logs
`ok: last BOSSCYCLE 0m ago` on fresh and raises the alert on stale (dry-run, no
message sent).

### Watchdog: a dry run disabled the watchdog it was rehearsing

Found while testing the change above. `tools/boss-heartbeat-alert` wrote the
alert-cooldown state file inside its `BOSS_ALERT_DRY_RUN` branch, arming the
60-minute spam guard on a rehearsal that sent nothing. Every dry run therefore
silenced the real alarm for an hour — precisely when someone is most likely to
be poking at the watchdog. The dry-run branch no longer writes state; only a
genuine send arms the cooldown. Proven: a dry run logs the would-send message
and leaves the cooldown byte-unchanged.

### Cycle log reported a write that never happened

`boss-cron` printed an unconditional `ledger appended` on every cycle. Because
findings dedupe by timestamp-stripped comparison, a cycle that re-finds the same
violations writes nothing — so the line told the operator the ledger had moved
when it had not. The cycle log now counts actual writes and reports either
`N ledger line(s) appended` or `ledger unchanged (findings already recorded)`.

### FIX-LEDGER divergence reconciled

Local and origin ledgers had diverged — both **pure appends to the same
1430-line base**, with **zero overlapping lines**, and every appended line on
both sides machine-written by the boss cron (no human or work record at risk on
either side). Reconciled as a chronological union: 1430-line base byte-intact,
1964 unique appended records sorted oldest to newest
(`2026-08-21T08:10:01Z` -> `2026-08-26T23:05:04Z`). Verified zero lines lost
from either side, and the boss reports the same 3 findings against the merged
ledger.

## [1.17.1] — 2026-08-26

### Status line: the Wave bar could never clear, and counted prose as progress

Two independent defects made the Wave bar report a dead project's status
indefinitely, in every session, in every directory, in BOTH config stores
(`~/.claude` and `~/.claude-nine` share one script, so both harnesses showed it).
Observed live as `Wave 6 ██░░░░░░░░ 20%` ten days after that wave closed.

- **Hardcoded foreign-project fallback removed.** The wave lookup fell back to
  `$HOME/work-999-setup/FIX-LEDGER.md` when `$cwd` had no ledger — so a session
  in ANY unrelated directory rendered this repo's wave. It now reads
  `$cwd/FIX-LEDGER.md`, else the ledger at the **git repo root of `$cwd`**, and
  never a hardcoded absolute path. Same defect class as the 1.16.3 boss-tools
  portability fix, in the one script that pass missed.
- **Closed waves no longer render.** Current wave was "highest `WAVE <n>`
  mentioned", which a `WAVE <n> CLOSED` line does not change — so a finished
  wave stayed on screen forever. Current wave is now the highest `WAVE <n>`
  with NO `WAVE <n> CLOSED` line; all waves closed → segment omitted. The bar
  now clears itself when the last wave closes.
- **Prose no longer counts as workflows.** The deployed script matched
  `grep -c "WF-<n>"` unanchored, so violation records, review findings and the
  plan table all counted as workflow rows — the observed `20%` was 1 of 5
  narrative paragraphs, not 1 of 5 workflows. Both numerator and denominator
  now anchor on the `` - `WF-<n>x `` line class.
- **Installer/deployed drift closed.** `scripts/setup-statusline.sh` already
  carried the anchored match; `~/.claude/statusline-command.sh` did not, because
  the installer was fixed but never re-run. The deployed script is now
  regenerated from the installer heredoc and verified byte-identical to it.
  SKILL.md and `references/progress-visibility.md` now state the rule: the
  installer owns the body, the deployed copy is generated, verify with a
  heredoc-extract diff.
- **New doctrine — a progress bar that cannot clear itself is a lie.** Every bar
  must have a condition under which it disappears, reachable from disk truth
  alone. Bars pinned to a path outside `$cwd` are banned.
- **Arithmetic hardening.** `grep` rc≥2 (unreadable file) yields an empty string,
  not `0`; both counts now default before reaching an arithmetic test.

Verified on the operator box with a five-case battery: home dir (bar gone), this
repo with all waves closed (bar gone, Project bar intact), repo subdir
(repo-root walk-up), a synthetic open wave (`Wave 7 ██████░░░░ 60%` — 3 of 5,
correctly ignoring a plan-table row and a prose mention), and a
highest-wave-closed fixture (falls through to the open lower wave).

## [1.16.3] — 2026-08-21

### Boss tools portability — no hardcoded paths or campaign data

- **Script-relative repo root**: `tools/boss-cron`, `tools/anti-stall-watchdog.sh`,
  and `tools/boss-heartbeat-alert` now derive the repo root from their own
  file location instead of a hardcoded machine path, so the boss tools work
  from any checkout on any box.
- **Env-overridable paths**: `BOSS_REPO_ROOT`, `BOSS_STATE_DIR`, `BOSS_LEDGER`,
  `BOSS_WF_ROOT`, and the watchdog/alert equivalents override the derived
  defaults (fixtures and tests use these).
- **Config-driven campaign data**: locked wave table, wave count, entry-gate
  epoch, caps, and sanctioned classes now load from `CONTROL/boss-config.json`
  (box-local, gitignored). A neutral `CONTROL/boss-config.example.json` is
  committed; the first live cycle copies it into place. No config = the
  campaign-specific checks (wave lock, width, statusline) skip cleanly.
- **Neutralized docs**: the spec-protocol SKILL.md boss sections no longer
  reference the operator box, install paths, or any campaign's wave/issue
  history; `boss-cron` violation messages and comments carry the same
  neutralization (functional class names like `ISSUE-18-EARLY` stay sanctioned
  in the allowlist — ledger evidence classes are doctrine, not campaign trivia).
- **spec-protocol and nine-router-setup VERSION 1.16.1 → 1.16.3**.

## [1.16.2] — 2026-08-21

### Kaizen interview order + intention capture

- **Interview order fixed**: the Kaizen Recipe now asks Target first and
  Interval last (Target, Location, Better, Scope, Permission, Proof, Interval).
  Asking "how often should I check on it" before knowing what "it" is read as
  a script, not a conversation, and the answer could not be judged — the
  interval depends on target type and location, which are only known after
  the earlier questions. The order is stated in kaizen SKILL.md §3 and
  `references/onboarding.md`, and regression-pinned by fix14 checks 14.9E/14.9F.
- **Product-intention capture**: the Target question now also asks what the
  thing is supposed to do and who it is for — the invariant golden rule 1
  ("do not change the product intention") protects. Recorded in the Contract
  as "What the target is supposed to do"; `init-kaizen-memory.mjs` fills the
  new placeholder, and unknown intentions get confirmed during the first PLAN.
- **Access question**: for remote targets, the Location question now asks
  whether the user has logins or deploy access — no access makes Mode A
  (recommend-only) the only honest choice and changes how proof works.
- **kaizen VERSION 1.0.0 → 1.0.1**; fix14 suite now 100 checks (was 96).

## [1.16.1] — 2026-08-20

### Kaizen qualification (15 fixes) + auto-compaction

- **Kaizen qualification (15 fixes)**: memory-root resolution, deterministic init,
  REGISTRY.json standardization, atomic token lock, strict validation, secret
  scanning, schedule decision engine, launchd repair, Windows Task Scheduler
  support, installer idempotency, behavioral PDCA/fingerprint, contract/activation,
  provenance, and static + cross-platform tests with CI
  (`.github/workflows/kaizen-tests.yml`: macos-14 + ubuntu-latest unix suites,
  windows pwsh self-test).
- **Windows Kaizen runners**: dry-run seams (`KAIZEN_TASK_DRY_RUN=1` / `-DryRun`)
  on the status, install, cycle, and remove scripts — no real tasks, no real
  cycles, no `schtasks.exe`.
- **Per-skill VERSION files** for all five bundled skills (spec-protocol 1.16.1,
  nine-router-setup 1.16.1, kaizen 1.0.0, eli5 1.0.0, bro 1.0.0).
- **spec-protocol `tools/check-update.sh`** now checks all five bundled skills at
  every spec-protocol launch (exit 0 = current, 1 = update available,
  2 = undetermined); `tools/self-update.sh` still updates spec-protocol itself;
  the other bundled skills refresh via the nine-router-setup installer.
- **Auto-compaction at 500k tokens**: canonical helper
  `.claude/skills/nine-router-setup/scripts/common/apply-auto-compact.mjs` sets
  `autoCompactEnabled: true` + `autoCompactWindow: 500000` top-level in the target
  box's `~/.claude/settings.json`; backs up before overwriting, preserves all other
  keys, refuses non-fatally on invalid JSON, never prints settings contents, and
  takes effect in NEW sessions. Wired into nine-router-setup's `setup-macos.sh` +
  `setup-windows.ps1` installers, plus first-run steps in spec-protocol SKILL.md
  (step 2.6) and kaizen SKILL.md onboarding.
- **Two new test suites**: `fix15` (spec-protocol check-update, offline fixtures)
  and `fix16` (auto-compact helper), wired into
  `.claude/skills/kaizen/tests/run-all-kaizen-tests.sh` (now 17 suites: core,
  walkthroughs, fix01–fix16).
- **README**: kaizen helper-script table and updated test-suite docs.
- **Candace persona**: warm, humorous fairy-godmother launch greeting in the
  spec-protocol first-run launcher ("You make a wish, I make it come true");
  voice-only — protocol gates and laws unchanged.
- **Version detection against main** activates once this release merges: before
  merge, `main` lacks the new VERSION files and the check reports UNDETERMINED for
  those skills — by design, never a false "current".

## [1.16.0] — 2026-08-20

### Kaizen Loop skill + five-skill bundle

- **New `/kaizen` skill**: a Plan-Do-Check-Act continuous-improvement loop for things
  already built (apps, websites, funnels, processes, automations, documents). Bounded
  scope (3–7 items per cycle, default 5), "guide do not cage" (user goals steer but
  never blind discovery), no success claim without fresh evidence, approval boundaries
  for merge/deploy/high-consequence actions, and durable Kaizen Memory in Downloads
  ("OpenClaw Master Files"/Kaizen — never `.kaizen/` in the target). Ships with
  onboarding, contract, memory, PDCA, scheduling, recovery, testing, plain-language,
  and licensing reference docs; contract/memory/state/cycle/resume templates; and
  deterministic state, validation, and launchd-scheduler helper scripts.
- **Bundled-skill manifest**: new `CONTROL/bundled-skills.txt` is the authoritative
  list of skills the installers link (`nine-router-setup`, `spec-protocol`, `kaizen`,
  `eli5`, `bro`). `setup-macos.sh` now reads the manifest (standalone installs fall
  back to the hard-coded baseline), always links on re-run so skills added after a
  first install get picked up, and reports per-skill visibility instead of a single
  path check. `setup-windows.ps1` gains real skill-link parity (junction-based,
  no admin rights or Developer Mode needed) replacing two hardcoded "OK" report lines.
- **Vendored companion skills**: `eli5` (plain-language explanations) and `bro`
  (direct developer talk) bundled under MIT, each with a pinned upstream commit and
  its own `THIRD_PARTY_LICENSE.md`; repo-root `THIRD_PARTY_NOTICES.md` records the
  sources. No GPL or non-commercial code copied.
- **Provenance correction (2026-08-20)**: `THIRD_PARTY_NOTICES.md` misattributed the
  vendored skills to `K-Paxian/eli5` and `K-Paxian/bro` — repositories that do not
  exist on GitHub (API 404). The vendored files are byte-identical (sha256) to the
  owner-selected upstreams at the recorded pins: `nathanksou/eli5` at
  `549364af799a4a0556c5359a0ac3e36d4da5719d` and `luchasarie/bro-skill` at
  `01e51f8092973be58eff3b7271282bd8488a02ae`, both MIT. Notices rewritten with the
  correct attribution; a provenance test suite
  (`.claude/skills/kaizen/tests/fix13-provenance-tests.sh`) now pins it.
- **Docs**: README bundled-skills section covers all five skills and the manifest;
  AGENT_INSTALL.md installs the full manifest and verifies every skill in both
  `claude` and `claude-nine`.

## [1.15.0] — 2026-08-16

### The 999 master fix: all 20 issues closed — the skill is now enforced, not suggested

The full 20-issue master fix landed in six locked waves (spec: `999-master-fix-spec-20260815.md`), merged branch-by-branch to main with serial landing and per-unit QC.

- **Entry gate (Issue 3):** `/spec-protocol` now opens with a hard two-option entry question (Interview me / Here is the info) asked ONCE before anything else runs; the choice is a required ledger line (`ENTRY-MODE`) enforced by the self-audit and the boss cron.
- **Mode offer (Issue 4):** the capacity interview surfaces DEFAULT MODE vs ADVANCED MODE first (R1 wording); Simple = the R6 nine-item wall, Advanced = the ceiling-table row; the mode question is question 1 of the count, never re-asked.
- **Counter enforcement (Issue 11):** the total is computed ONCE and spoken ("at most C questions"); every counted question is "Question N of no more than C"; every change announced before the next question (good-news lowerings; artwork the only sanctioned rise); the boss cron's COUNT check enforces promised-vs-asked mechanically.
- **Wording (Issue 12):** every question re-grounded in R5 (seventh-grade plain, says what it decides, example answer, named escape); the never-re-ask law is mechanically enforced (answers file + ASKED lines + boss RE-ASK sweep); deleted questions stay deleted; one question at a time.
- **Research gate (Issue 5):** research cannot dispatch before BOTH the Build Target taxonomy and the captured input exist (RESEARCH-READY gate, ledger-precondition, boss-enforced).
- **Design brief (Issue 6):** DESIGN-BRIEF step with the MOBBIN-CHECK (configured/offered/declined, never installed without GO), per-site-type researched best practice (hero/layout/typography/color/conversion/mobile/accessibility), the copy bar (a named fetchable example page, never "make it punchy"), and the 7-stage funnel process (pages, per-page structure, email sequence, integration, tracking, pipeline+image lane, hosting).
- **Image lane (Issue 7):** enumerated image manifest before any generation; provider reachability verified BEFORE the promise; fail-closed on provider failure (MEDIA-GAPS, never blank squares).
- **Staged pipeline (Issue 8):** wireframes → scaffolding → hero → images → build (with animations + 3D sub-process 1.8.1-1.8.8) → logo (background removal MANDATORY); the boss rejects a stage opened before its predecessors.
- **GHL media (Issue 9):** every generated image uploads to GHL media storage in a project-labeled folder; the site references permanent GHL URLs only (never 24h-expiring provider links); time-bounded ordering is one unit (generate → poll → download → upload → read-back → ledger); the served-HTML URL-fetch check proves every image live at HTTP 200.
- **Orphan accounting (Issue 10):** 1:1:1:1 — generated = manifest = uploaded, references counted; the boss's ORPHAN sweep catches every orphan class by enumeration, including the EXPIRY class (temp URL past 24h with no GHL upload = token waste, VIOLATION-STOP).
- **Anti-drift (Issue 13):** the live ledger is the single source of truth (claim before, result after); heartbeats must carry state (>10 consecutive contentless ticks = stopped lane); anchor.sh reconcile at every wave boundary/tick/dispatch; the boss compares ledger vs script every cycle and stops/restarts from the named checkpoint; TERMINAL-DRIFT.flag stays the capture-proof stop.
- **Forced fan-out (Issue 14):** operator doctrine 10 agents per workflow (5 builders + 5 blind critics), up to 50 workflows, up to 500 in parallel — NO per-model cap; TIMIDITY and PADDING are forbidden defects; the boss's WIDTH check enforces scripted width per cycle.
- **Wave lock (Issue 15):** the 6-wave table is immutable, written once; new waves only via a NEW-WAVE-N dependency line; the boss's wave-growth check flags undocumented waves and the wave lock blocks wave N+1 before wave N closes.
- **QC protocol (Issue 17):** ONE way — a blind critic, PASS = completely exceeds expectation, FAIL = looped with the exact finding (max 20 cycles, then escalation); Law 49 (critic sees the work, never the effort), Law 7 (no self-QC), Law 50 (the bar wins by default); every record carries the nine QC-RECORD fields, mechanically checkable.
- **Boss cron (Issue 18):** the full PART 4 boss — 16 checks per 5-minute cycle (scope, wave, count, width, claim, drift, orphan, statusline, caps, census, beat, stop, stages, entry-mode, kill) with stop-and-rerun authority, timestamp-blind dedupe, and a governed-boss heartbeat alert through the operator's OpenClaw gateway. WAVE 0 BOOTSTRAP: the boss is armed before any wave dispatches.
- **Unleash (Issue 16):** the researched, sourced unleash table applied to both settings stores (bypassPermissions, MAX_CONCURRENT_SUBAGENTS=500, SPAWN_DEPTH=8, CONTEXT/OUTPUT tokens, workflowSizeGuideline unrestricted, effortLevel=xhigh, DISABLE_AUTOUPDATER, MAX_SUBAGENTS_PER_SESSION deleted); CLAUDE_CODE_EFFORT_LEVEL never set by provisioning; 9Router routing keys justified.
- **Gauntlet weave (Issue 19):** the six workflow types at exact counts (blueprint lock 8, primary build 16, blind visual gauntlet 16, technical gauntlet 8, release council 4/4, selective repair loop 1-per-workstream max 12); agent budget (52 expected / 150 warning / 200 hard stop with blocker report); client-machine adaptation (clientCap = min(systemConcurrentMax, cores−2); the bar never shrinks with the machine — only the width does).
- **Status line (Issue 20):** both settings stores carry the statusLine; the shared script renders task progress (CLIENT bar = model | cost | git | Project% | Wave%).
- **Skill VERSION catch-up (stack review 2026-08-16):** the skill-level `VERSION` (the `tools/check-update.sh` freshness contract) stayed 1.14.2 while the stack changed three skill files (SKILL.md, references/capacity.md, tools/capacity-resolver.sh — Issue 19 clientCap wire-in, resolver defects, six-workflow step 12.7); bumped once to 1.15.0 so boxes polling the published VERSION see the fixes. The v1.15.0 tag was cut before the bump and is not re-created; the bump lands with the next merge.

All 19 fix branches merged serially; the boss cron enforces the whole run against the live ledger.

## [1.14.2] — 2026-08-14

### Nothing hidden: the tmux display is retired; workflows and subagents are the load-bearing path

Operator ruling after the frozen-pane incident (teammates stuck for hours at
prompts nobody could see, timers reading as work) and the Beanline proof that
everything which shipped ran as visible workflows + subagents:

- **Installer (enable-agent-teams, macOS): P5 retired** the way B3 was —
  `teammateMode` is never written again, on any box, tmux present or not; the
  harness's in-process display (teammates visible in the session's own agents
  panel) rules everywhere. The tmux probe stays report-only; P6/P8 tmux
  hygiene unchanged; selftests updated to assert the key stays ABSENT.
  (Windows never wrote it — unchanged.)
- **spec-protocol step 16.9: orchestration default is single-session lead +
  paired-tree workflows.** An Agent Team forms ONLY on the operator's explicit
  request, in their own words — "warranted by shape" no longer suffices. The
  team doctrine (references/agent-team.md) is retained in full for those
  opt-ins.
- Operator boxes flipped the same day: both config roots now carry
  `teammateMode: "in-process"` explicitly.

Files changed:
`.claude/skills/nine-router-setup/scripts/macos/enable-agent-teams.sh`,
`.claude/skills/spec-protocol/SKILL.md`, `.claude/skills/spec-protocol/VERSION`
(1.14.1 → 1.14.2), and this file.

## [1.14.1] — 2026-08-14

### Dispatch intelligence made explicit: size down, scale up, hold by not launching

The three judgments were implied across S1/S2/S4/S5 and the dispatch rules;
they are now stated once, as one block beside the width gate (SKILL.md):
(1) size DOWN — the arithmetic is units × 2, never a quota; padding to the
ceiling equals timidity; (2) scale UP — the dispatchable set is recomputed at
every unit completion and watch-loop tick, and newly unblocked streams launch
immediately; maximum productivity = no runnable unit waiting while capacity
exists; (3) HOLD blocked work by not launching it — never by launching a tree
that idles; blocked streams are named in status as "gated on X" and fire the
moment inputs land. (The per-run version check already exists — SKILL.md step
2.5 runs check-update.sh on every run, every launcher — verified, unchanged.)

Files changed: `.claude/skills/spec-protocol/SKILL.md`, `VERSION`
(1.14.0 → 1.14.1), and this file.

## [1.14.0] — 2026-08-14

### The paired tree and the width gate — the doctrine that produced thirty one-agent trees is retired

The canary's measured gap (ledger authorized 20 trees × 10; dispatch produced
30 trees of mostly 1 agent) traced to the doctrine's own "one item, one tree"
reading. Replaced with the paired tree:

- **The paired tree (SKILL.md parallelism block + workflows.md template +
  gauntlet.md §13.8).** One tree = one stream of up to 8 units; every unit is
  a builder+judge PAIR, both seat-pinned, staged as a pipeline so the judge
  fires the instant its own unit's build lands. Tree width = units × 2, capped
  at the operator's 16-ceiling (hence 8 units per tree). QC capacity is
  planned as an equal half of every dispatch (operator ruling R4). The QC lane
  is visible in the same tree it judges; independence rides the pin, not the
  dispatch mechanism.
- **The width gate (fail-closed).** Every tree's dispatch-log row states its
  arithmetic (units, × 2, the ceiling, the ledger line cited) BEFORE launch; a
  script planning below its arithmetic without a named reason is rejected and
  re-authored (3 attempts, then fail-soft at best width with the shortfall
  named — an overnight run never stalls on a gate). S4 is rewritten from
  log-only to fail-closed enforcement of the same arithmetic.

Files changed: `.claude/skills/spec-protocol/SKILL.md`,
`references/workflows.md`, `references/gauntlet.md`, `VERSION`
(1.13.4 → 1.14.0), and this file.

## [1.13.4] — 2026-08-14

### The canary's own postmortem: invisible workers, unreaped agents, stall-shaped status, and a media API doc bug

Sourced from the Beanline run's written analysis and the operator's screenshots.

- **QC joins the trees (SKILL.md Rule 2).** With seat pinning proven, judges
  run workflow-wrapped and judge-seat-pinned — visible in `/workflows` and to
  the watch-loop like every build lane; independence comes from the pin, not
  the dispatch mechanism. Raw Agent-tool QC is a named fallback only, always
  dispatch-logged with a reap deadline. (The postmortem's proposal to document
  judges as living OUTSIDE the trees was built on the refuted override claim
  and is not adopted; the inverse is.)
- **Two new watch-loop standards.** S12 — every worker visible: build/fix/QC
  dispatches are workflow-wrapped; any raw Agent dispatch carries a
  dispatch-log row and reap deadline. S13 — finished-but-alive reap: an agent
  whose output is on disk and has no next instruction is stopped, never left
  ticking (the research agent that burned 13h CPU after finishing).
- **The status contract (postmortem proposals h+i, adopted and extended).**
  Mid-flight status always states: running-now per lane as counts, what is
  gated on what, what remains before a link, and PERCENT DONE as a number;
  token counters are named as session totals, never per-agent. Handover fires
  only on the four stop conditions; RUNNING is the default state to report.
- **KIE createTask body corrected (media-pipeline.md, postmortem §5a).** The
  body requires a top-level `model` field beside `input`; `{"input":{…}}`
  alone returns HTTP 500 — verified live by two independent agents.

Files changed: `.claude/skills/spec-protocol/SKILL.md`,
`references/media-pipeline.md`, `VERSION` (1.13.3 → 1.13.4), and this file.

## [1.13.3] — 2026-08-14

### Bare agent() calls put the builder's brain in the judge's seat, and the fix cap rose to twenty

- **Seat pinning (SKILL.md swarm rules + workflows.md §0.0).** Every `agent()`
  in every workflow script now carries an explicit `model:` pin for its seat —
  never a bare call. Proven both directions on the operator's box
  (2026-08-14): pins are honored (three lanes each resolved to their own
  router chain inside workflow agents), and bare calls inherit the session
  model (the canary's 19 build workflows and first 5 QC verdicts, all bare,
  all landed on the session brain — the recorded claim that the Workflow tool
  "ignores the model override" is refuted; it was never given one). With
  pins, builders and their paired checkers run inside one workflow on
  different brains.
- **Fix cap: 3 → 20 cycles per finding (operator ruling, 2026-08-14).** Up to
  twenty fix→re-judge rounds before a human sees it; after twenty,
  `blocked-repeated-fail` as before. Updated in SKILL.md (rule text + limits
  table), pipeline.md (streaming self-repair), and gauntlet.md §9 (the
  reconciliation keeps its meaning: a cap-hit is NOT PASSED, never PASS).

Files changed: `.claude/skills/spec-protocol/SKILL.md`,
`references/workflows.md`, `references/pipeline.md`,
`references/gauntlet.md`, `VERSION` (1.13.2 → 1.13.3), and this file.

## [1.13.2] — 2026-08-14

### 16 is the ceiling, not a quota — the operator's clarification of 1.13.1

1.13.1 overcorrected a trim into a quota. The ruling as the operator actually
means it: every workflow carries UP TO 16 subagents, sized to the work with
intelligence — a trivial check gets one agent, sixteen independent units get
sixteen. Two defects, equally forbidden: TIMIDITY (sizing below what the work
supports while independent work waits) and PADDING (inventing agents to hit a
number). The execution-clamp language of 1.13.1 stands unchanged: the cores
clamp is scheduling, never sizing, never a correction of the operator's
ceiling.

Files changed: `.claude/skills/spec-protocol/SKILL.md`,
`.claude/skills/spec-protocol/references/interview.md`, `VERSION`
(1.13.1 → 1.13.2), and this file.

## [1.13.1] — 2026-08-14

### The run trimmed the operator's 16-per-workflow to the hardware clamp and presented it as a correction

Operator ruling, verbatim intent: 16 subagents per workflow is the authorized
DISPATCH size — the number is never changed. min(16, cores−2) is the harness
EXECUTION clamp: it says how many of the 16 run in the same instant (10 on a
12-core box) while the rest queue automatically the moment a slot frees. The
clamp is scheduling, never sizing — dispatching 10-agent workflows because the
clamp says 10, or telling the operator his 16 "really means" fewer, is the
defect. Both numbers are stated wherever width is stated: dispatched width and
executing-at-once. The false-320 lesson stands unchanged: never PROMISE
workflows × 16 as simultaneous execution.

Files changed: `.claude/skills/spec-protocol/SKILL.md` (the width doctrine
bullet), `.claude/skills/spec-protocol/references/interview.md` (the builder
width axis), `VERSION` (1.13.0 → 1.13.1), and this file.

## [1.13.0] — 2026-08-14

### The interview asked a normal person thirty questions; the operator ruled on every one of them

The operator ran the full interview on his own canary box and ruled on all 25
questions asked. `references/interview.md` now opens with THE OPERATOR RULINGS
(2026-08-14) — a binding supersede-in-place section (the agent-team.md §10
pattern), with pointer lines at every block it amends.

- **The defaults offer moves from question eleven to question one** (or two,
  when the archetype truly must be asked): default mode answers ~9 plain
  questions about money, taste, and consent; advanced mode adds the granular
  ones. Everything else is decided by the run and REPORTED — "here is what I
  decided; say the word to change it."
- **Deleted as questions, wired as rules:** archetype derived from the brief;
  DeepSeek direct always wins when funded (hosted DeepSeek is the reported
  fallback); backups read from the router's own wiring; brand-new project →
  one new repo on `main`, tool pushes; continuous-until-done and auto-merge
  are the product's promise, never questions; the loop-state file is the
  skill's own artifact; usage windows are knowable or measured; the busy
  ladder is wired (10s → 30s → 1m → 2m → 4m → 8m, cap 15m; keep working;
  flag past one hour and keep climbing).
- **Rewritten:** the done-condition is written by the run and shown for one
  yes/no; the winning-bar question gets plain words and a default; the
  helpers question (advanced only) carries a plain explainer of workflows
  and sub-agents; the three seats are always planner, builder, AND checker —
  the checker never omitted again.
- **Detection before consent:** the 130 MB browser download is asked only
  when no capture tool is already on the box (the canary had two and was
  still asked), and the consent is remembered per box.
- **Never re-ask:** answers persist to 00-INPUT as given; after a compaction
  the run re-reads them — the canary was asked the same first question twice.
  The question ceiling is stated once; the canary's 32 → 27 → 30 drift is
  named a defect.
- **Recorded doctrine (R4):** for every builder a paired checker — build and
  QC capacity planned as equal halves; the gauntlet-loop mechanics remain
  owned by references/gauntlet.md.

Files changed: `.claude/skills/spec-protocol/references/interview.md`,
`.claude/skills/spec-protocol/VERSION` (1.12.0 → 1.13.0), and this file.

## [1.12.1] — 2026-08-13

### The harness's advisory workflow-size guideline steered every session small, against the operator's width doctrine

- **`enable-agent-teams.sh` (macOS) and `Enable-AgentTeams.ps1` (Windows) now
  merge one more key** in the same atomic write, same backup, same
  validate-or-restore envelope: top-level `"workflowSizeGuideline":
  "unrestricted"` in every configured root. Claude Code's default guideline
  ("medium — keep workflows under 15 agents") is injected into every session
  and pushes dynamic workflows toward timid fan-outs; spec-protocol's width
  governance belongs to the Capacity Ledger, the operator wave cap, and
  provider ceilings — never to an advisory default. A pre-existing different
  value is overwritten, reported as a deferred note, and recoverable from
  that root's backup. The leaves-diff validator's allowed-to-differ set and
  the selftests (merge-into-existing, create-from-absent, multi-root) now
  cover the key; the macOS battery passes 9/9. The Windows script's edits are
  pattern-identical but were not machine-parsed in this release (no
  PowerShell on the authoring box) — its own `-SelfTest` proves them on first
  Windows use.

Files changed:
`.claude/skills/nine-router-setup/scripts/macos/enable-agent-teams.sh`,
`.claude/skills/nine-router-setup/scripts/windows/Enable-AgentTeams.ps1`,
and this file.

## [1.12.0] — 2026-08-13

### Teammates froze forever at the folder-trust dialog, and a routed session could be told to launch an Anthropic-billed worker

- **The trust pre-flight** (`references/agent-team.md` §4.1, wired into
  SKILL.md step 16.9). A teammate is a fresh interactive session; spawned in a
  folder the active state file has not trusted, it stops at the folder-trust
  dialog and waits forever at 0% CPU while the lead's panel timer ticks — the
  timer is time-since-spawn, never work. Proven 2026-08-13 on the operator's
  box: three teammates frozen 4h03m at the dialog; the same evening, with the
  folder pre-trusted, a fresh teammate booted past it, worked, and reported.
  This skill builds in a fresh project directory every run, and a fresh
  directory is always untrusted — so the pre-flight now runs before the first
  spawn of every run: read `projects[<cwd>].hasTrustDialogAccepted` in the
  active state file (`$CLAUDE_CONFIG_DIR/.claude.json` when set, else
  `$HOME/.claude.json`), merge the one key when absent (backup first, verify
  after). §4.1 also carries the probe for an already-frozen teammate and the
  two unstick moves; §10 gained the freeze as a named liveness state; the §0
  fact table gained the row.
- **Harness purity is now one-way** (§0.1, its fact-table row, and
  `references/terminals.md`). A routed session (`claude-nine` /
  `claude-codex`) may NEVER launch plain `claude` — a downgraded worker moves
  its tokens off the client's own router keys onto Anthropic billing,
  silently, and the leak hides in exactly the launch paths the seat templates
  use (a tmux-launched seat or fresh terminal does not inherit the routed
  lead's environment). The upgrade direction stays available and probed: a
  plain `claude` session may launch `claude-nine` workers. In-session spawns
  (subagents, workflows, teammates) inherit the harness automatically.
- **Teammate work completion under 9Router: PROVEN, 2026-08-13.** The fact
  table's open question closed on the operator's box: a teammate spawned from
  a `claude-nine` lead ran its command, reported over `SendMessage`, sent the
  idle notification, and its transcript's `message.model` named a router lane
  on every request. Dated observation, one box; the §3 live probe remains the
  only permitted claim about any session in hand.

Files changed: `.claude/skills/spec-protocol/SKILL.md`,
`.claude/skills/spec-protocol/references/agent-team.md`,
`.claude/skills/spec-protocol/references/terminals.md`,
`.claude/skills/spec-protocol/VERSION` (1.10.0 → 1.12.0), and this file.
The skill VERSION jumps past 1.11.x — those numbers were consumed by
installer-only releases — to stay monotonic and re-join the repository's tag
line.

## [1.11.1] — 2026-08-13

### The fusion smoke test named a combo that v1.11.0 had already renamed away

- **The smoke test still probed `blackceo-fable-fallback`**, the combo
  [1.11.0] renamed to `sonnet-chain`. The check asked for a name nothing
  creates — the same class of defect this file was repaired for in
  [1.10.1]: a test naming something that does not exist reads as known
  noise on every box instead of a signal. It now probes the combo that
  exists, under a label that says what it tests.
- **Coverage added for the other two chains renamed in the same release:**
  the smoke test now also probes `opus-chain` and `haiku-chain`, so all
  three fallback combos the installer creates are checked, not just the
  one this fix was chasing.

One file changed: `.claude/skills/nine-router-setup/scripts/common/test-nine-router.mjs`.
Nothing else in the repository was touched.

## [1.11.0] — 2026-08-13

### Three fallback combos carried the operator's own brand into every client's router database

- **The operator's brand is off client boxes.** The installer created
  `blackceo-fable-fallback`, `blackceo-opus-fallback`, and
  `blackceo-haiku-fallback` — the operator's company name sitting in every
  client's router database, on every fresh install. The three are renamed
  for the lane each one feeds: `opus-chain`, `sonnet-chain`, `haiku-chain`,
  joining the `fusion-chain` combo Fable already used.
- **Three of the four lanes were bypassing their chains entirely.** Only
  Fable routed to a combo; Opus, Sonnet, and Haiku pointed straight at raw
  provider models while their three fallback combos were created and never
  routed to. Every client got three unused combos sitting in the database
  and three lanes with no failover — a provider hiccup took the lane down
  cold instead of failing over to the next model in the chain. **Each lane
  now routes to its own chain.**

### No client's primary model changes

- Each chain leads with the model that lane already resolved to; the
  fallback follows behind it. `opus-chain` and `haiku-chain` keep the same
  `[primary, fallback]` order they were created with. `sonnet-chain` —
  renamed from the combo that used to lead with DeepSeek Flash+max — is
  reordered so Agnes 2.5 Flash stays first, because the combo it was
  renamed from led with a different model than Sonnet had always resolved
  to.
- This is what the operator's own box has always run; the installer now
  builds it for every client too.

One file changed: `.claude/skills/nine-router-setup/scripts/common/configure-nine-router.mjs`.
Nothing else in the repository was touched.

## [1.10.1] — 2026-08-13

### The Fable lane pointed at a fusion combo the router had never created

- **The installer wired every fresh client's Fable lane to a combo that was
  never created.** `configure-nine-router.mjs` created the fusion combo under
  one name, pointed `RESOLVED_ROUTES.fable` at a second name, and the smoke
  test checked a third. Only the first existed. On every fresh install, Fable
  requests hit a combo the router had never heard of and 404'd — and the
  routing state looked valid, because a real string pointing at nothing looks
  exactly like a real string. A client hit this in the field.
- **The smoke test could never have caught it**, because its own name was one
  of the two that did not exist; a red fusion check on every box read as
  known noise rather than a signal.

### The combo is now `fusion-chain` everywhere, and a new assertion closes the class

- **The combo is now `fusion-chain`**, created, referenced, and smoke-tested
  under that single name. The operator renamed it from the previous
  mixed-case name.
- **A new assertion closes the class:** every `RESOLVED_ROUTES` lane must
  resolve to either a raw provider model or a combo actually created in the
  same run. The existing "defense in depth" guard validated provider MODEL
  ids and never combo names — which is precisely how a lane pointing at
  nothing passed a guard written to prevent it. The names are collected as
  the combos are created, so the check cannot go stale.

Two files changed, both in
`.claude/skills/nine-router-setup/scripts/common/`: `configure-nine-router.mjs`
and `test-nine-router.mjs`. Nothing else in the repository was touched.

## [1.10.0] — 2026-08-13

### The question count is now two numbers, because the count is genuinely dynamic

The client now hears a ceiling and an expectation in the same breath:
**"I will ask you at most 29 short questions — most people end up nearer 16,
because they let me choose the routine settings when I offer to."** The
ceiling remains the unbreakable promise; the second number is what the run
actually lands on when the standing offers are accepted. **A number that is
honest and discouraging is still the wrong number to say** — a simple build
was being told "at most 32" and then asked eight. The interview no longer
makes an honest person choose between a ceiling that scares them off and an
expectation that undersells what the ceiling is protecting against; it says
both.

### The ceiling is now computed after mandatory pre-statement reads

Disk only, seconds, never a network call. The earlier arithmetic said to use
a measured service count "when the read has already been taken" — but the
environment sweep runs at flow step 9, AFTER the interview, so that read had
never been taken and the ceiling always priced three paid services whether or
not the client had any. It now reads provider key NAMES, the saved-answers
profile, and the machine fingerprint **before** speaking, and a failed read
prices at maximum rather than blocking the statement on a retry.

### A static/dynamic inventory names the four classes a counted question can belong to

| Class | Meaning | How the ceiling and the expectation treat it |
|---|---|---|
| STATIC | Exists because the run exists | Full price in both numbers |
| RESOLVED-DYNAMIC | Its trigger is already on disk | Measured value in both numbers |
| CHOICE-DYNAMIC | Removed by the person's own yes | Maximum in the ceiling; replaced by the offer that removes it in the expectation |
| CONDITION-DYNAMIC | Turns on a fact learned mid-run | Maximum in the ceiling; kept in the expectation |

The ceiling prices every CHOICE-DYNAMIC and CONDITION-DYNAMIC question at its
maximum, because neither has resolved at statement time. The expectation
prices the same CONDITION-DYNAMIC questions in — a fact still not known — but
replaces every CHOICE-DYNAMIC question with the offer or confirmation that
removes it, because that is the path most people take.

### The good-news line is now required, not optional

At every fast-path yes, and at any single lowering of three or more, the
smaller ceiling is spoken in the same breath as the offer — never held back
for the end of the run. A person deciding whether to keep going is owed the
smaller number the moment it exists.

### The artwork rise is announced at its MEASURED size

Not a blanket "up to three." The rise is three when both artwork keys are
present at the moment it fires — the provider-choice question will be needed
— and two otherwise, spoken before the next question in the same correction
voice this skill has used since [1.9.1].

The skill remains **32 files** — nothing added and **nothing removed** —
`tools/ledger.sh` is byte-identical, and `VERSION` reads **1.10.0**. Four
files changed: `VERSION`; `references/interview.md`, which owns the ceiling
arithmetic, the new pre-statement reads, and the static/dynamic inventory;
`references/audience.md`, which now cites the two-number up-front statement
alongside the single-number form; and `references/openclaw-ingest.md`, whose
ingestion result is now named as one of the mandatory pre-statement reads.

## [1.9.2] — 2026-08-13

### "A few plain questions" was a number, and it was the wrong one

Two client-facing lines in `references/audience.md` — the set-and-forget promise
and the tone example — offered **"a few plain questions"** while the ceiling runs
as high as **33**. Neither line stated a figure, so neither broke the ceiling
arithmetically. But **"a few" means three or four to an ordinary reader**, and a
person told "a few" and then asked twenty-seven has been misled just as surely as
by a wrong number. Both now describe the interview honestly without naming a
count — a proper set of plain questions, a step at a time, with the limit given
up front — leaving `references/interview.md` the sole owner of every figure. The
counter's spoken example drops its hard-coded **"3 of no more than 12"** for
`"Question <N> of no more than <C>"` for the same reason: this page cites the
form, it never supplies the numbers.

The skill remains **32 files** — nothing added and **nothing removed** —
`tools/ledger.sh` is byte-identical, and `VERSION` reads **1.9.2**. Two files
changed: `VERSION` and `references/audience.md`.

## [1.9.1] — 2026-08-13

### The question count is a CEILING, not an exact total

The client now hears **"Question 3 of no more than 32"**, and the up-front
statement promises **"at most <C> short questions — usually fewer"** rather than a
figure presented as the truth. Every conditional question is priced at its
MAXIMUM — the defaults-offer question, the per-service plan questions at their
scripted maximum, both small-plan collapse confirmations, C6, and A1 where
auto-detect was inconclusive. Whatever does not occur simply lands the run under
the ceiling. **Coming in under has kept the promise**, so finishing early needs no
announcement at all, and the good-news line becomes something said when the drop
is worth saying rather than machinery that must fire correctly or the skill has
lied.

### This removes the known limitation [1.9.0] shipped with

[1.9.0] closed with a known limitation: `A2` is asked once per paid service while
the base arithmetic counted it once, so a stated total could be exceeded by one
question per additional service with no upward announcement to cover it. **That
paragraph is superseded by this release.** The [1.9.0] entry above is left exactly
as written and is NOT retro-edited — a changelog that quietly rewrites its own
history stops being evidence of anything.

What changed is the diagnosis rather than the patch. **Six QC rounds found six
distinct ways an exact total could be exceeded**: the maximum path; a wrong
subtraction on regular Claude Code; an unbudgeted fast-path offer; `A2` asked once
per paid service while counted once; a stale *"about eighteen"* / *"twenty-one-plus"*
still spoken to the client; and an approximation-form up-front script. Six rounds
finding six instances of one shape is the shape reporting itself. **An exact total
required the run to know its own shape before it had one** — how many paid
services, whether a fast path would be taken, whether the plan would turn out
tiny, whether it would need artwork — and each new dependency was one more way to
break a small promise to a non-technical person.

**A ceiling cannot be exceeded by construction.** So the class is closed rather
than the instances patched: there is no arithmetic left that can be wrong in the
direction that matters, because every unknown is already paid for at its worst
case before the first question is spoken.

### The only sanctioned upward move, and the failsafe under it

Artwork remains the one priced-at-zero exception: the ceiling rises by up to three
the moment the plan calls for pictures, and **the rise is spoken BEFORE the next
question**, in the correction voice — *"That is a few more than I said — the extra
ones only apply because your plan needs artwork."* Under it sits a failsafe: if a
run ever finds a question the ceiling missed, **the corrected ceiling is stated
before that question is asked.** A question asked past a stated ceiling with no
correction spoken first is a defect. `N` never resets, never repeats, never
decreases; `C` may be lowered at any time and needs no machinery to do it.

The per-target ceilings on Claude-Nine are **31 to 33** depending on the Build
Target — 32 for a mobile app, a mobile-and-web build, or a website; 31 for a web
app or desktop/CLI software; 33 for a sales funnel — each up to three higher only
via artwork's announced rise. On regular Claude Code the same table has **23**
subtracted rather than the 17 [1.9.0] stated, blocks A, B and C not being run
there. A typical run finishes well under its ceiling; that is the design, not an
error.

The skill remains **32 files** — nothing added and **nothing removed** —
`tools/ledger.sh` is byte-identical, and `VERSION` reads **1.9.1**. Three files
changed: `VERSION`; `references/interview.md`, which owns the ceiling arithmetic,
the per-question counter and the two fast paths; and `references/audience.md`,
which cites the counter's spoken form and never computes.

## [1.9.0] — 2026-08-13

### The opening script was never fired by a numbered step — so skipping it broke no rule

The words the client hears first have been in this skill for releases, as prose
under the set-and-forget promise. That section said to say it first. **No
numbered flow step ever fired it.** An agent that skipped it broke no rule that
could be shown to it, because the instruction lived nowhere in the sequence the
agent was actually executing — and text with no step behind it does not hold its
shape. It gets paraphrased on one run, halved on the next, and reduced to a
sentence of throat-clearing on the one after. The first thing the person heard
was different every time, and on some runs there was nothing to hear.

Two changes were both required. The script is now **MANDATED VERBATIM** — word
for word, not paraphrased, not shortened, not skipped on any run, any harness,
any launcher — and it is **SCHEDULED**: flow step 3 speaks it before the Build
Target question and before the entry-mode question. Mandated text that no step
fires is still optional in practice; a scheduled step with no fixed words drifts
anyway. Neither half is the fix on its own.

It was also rewritten, because what it had to do was never only procedural. It
opens on the thing they always dreamed about — an app, a website of their own, a
thing people carry on their phone, a program on their own computer, a funnel that
makes the offer and follows up — and then says plainly why it never happened:
**they did not have the workers, or the assistants, or the money and the capital
to hire them.** That is the sentence the rest of the script earns. The gauntlet
loop is named as what it is rather than hidden behind it. The work is described
as hours, days, weeks if that is what it takes, **without a break, so that they
do not have to** — go to the beach, go to dinner, be with family, while the work
runs around the clock. The finished work lands on GitHub, described as a website
where code is kept safely, and goes live either on Vercel or **right inside their
own Convert and Flow system**, wherever it belongs.

And it makes **"I don't know" a right answer, out loud, before the first
question**: *"I'd rather hear that than a guess. I'll take it from there and make
the best decision for you. You can't get any of this wrong by not knowing
something."* A person who does not know that is told is a person who guesses, and
a guess recorded as an answer is worse than a default recorded as a default.

The resume path is concrete rather than reassuring. If the machine restarts or the
connection drops: type `claude-nine --resume`, **pick your project from the list**,
paste in the one sentence the skill gives you. A promise that nothing is lost with
no keystrokes under it is a promise the person cannot act on at the moment they
need it.

### The Build Target is asked at the ENTRY — and the client is never made to classify

The target question used to fire after the archetype, which put it after the
project folder was created. Every mandated sentence downstream interpolates the
target word, and **a folder named before anyone was asked what was being built
defaults to a lie.** It now fires at the entry: immediately after the opening
script, before the folder exists, before the brainstorm starts.

**The client describes their idea in their own words; the skill classifies it.**
That is the ruling, and it is the substance of the change rather than a wording
preference. The question asked is the easiest one in the interview — *tell me
about it: what is it, and who is it for* — and the skill sorts the answer,
confirms in one warm sentence built from their own words, and moves on.

**The six-way taxonomy is this skill's filing system, never the client's quiz.**
The six-item list is NEVER rendered to the client — not as a menu, not trimmed to
three, not "to help them along." A person who cannot tell a web app from a website
is missing nothing they need; the sorting is this skill's job. Being made to
self-classify is not a neutral inconvenience, and the failure it produces is the
reason this is binding: **a client who wanted a mobile app was pushed into a web
app** by a menu that asked them to name a category they had no way to name. A
person made to self-classify either stalls or guesses, and a wrong guess here
routes the entire build wrongly — different gates, different pipeline, different
bar.

Where a description is genuinely ambiguous, exactly ONE either/or from a written
bank settles it — never three options, never the list, never the same question
twice in the same words. "I don't know" produces at most one question about their
world and then a recommendation with one reason, and the target reached that way
is recorded as **a DEFAULT they confirmed, never as their answer.**

### Six targets replace three, and mobile stops being lumped in with web

`MOBILE_APP | WEB_APP | MOBILE_AND_WEB | DESKTOP_SOFTWARE | WEBSITE | FUNNEL`.
The old table had three rows, and the first of them — *App / Software* — carried
web apps, phone apps, desktop programs and CLI tools in a single cell with one set
of gates and one pipeline. Those are not one thing. **Mobile versus web was the
distinction the old row erased**, and it is the distinction the client was least
equipped to repair by hand.

Each of the six now carries its own credential gates, its own build pipeline and
dependencies, its own Step 1d branch, and **its own Gate 3 viewports** — a
`MOBILE_APP` is captured and judged at the mobile viewport, `WEB_APP` and
`WEBSITE` at desktop and mobile, `MOBILE_AND_WEB` at both viewports per surface.
A mobile build judged against desktop captures was passing a bar it was never
built to clear. `MOBILE_AND_WEB` also carries a real consequence into B1: two
builds may mean two repositories, and two repositories mean two merge trains.

The sweep tool still takes three target values, and the six answers map onto it as
three families — the tool's family sets the SEARCH, the routing table sets the
GATES. No fourth target value was invented in the tool.

### The folder is named from what was confirmed — `unnamed-app` is gone

The slug is the kebab-case of the user's own name for the thing when one was
spoken, and otherwise `<target-word>-YYYY-MM-DD`. **Never `unnamed-app`**, and
never a target word that was not confirmed in the Build Target exchange. The old
placeholder was the visible symptom of the ordering defect: a folder named before
anyone had been asked what was being built. One rename is sanctioned — when the
brainstorm produces the project's real name, and only while the folder holds
nothing but `00-INPUT/`. A folder the operator PROVIDED is never renamed.

### The funnel and website branches are reachable for the first time

Both branches were already written, complete, and correct. Step 1d's funnel
questions, the GoHighLevel hard gate, the website hosting questions — all of it
**was gated on a question no flow step scheduled.** Doctrine that cannot be
reached is not doctrine; it is a file. This is the same class of defect as the
opening script, found in the same pass, and it is why both are in one release.

The funnel classifier now fires on **"follow-up emails or texts" alone** — leads,
offers, selling sequences, or pages that exist to get one thing done. FUNNEL
outranks WEBSITE whenever both patterns appear. The consequence is the point:
**the GoHighLevel hard gate now reaches people who have never heard the word
"funnel."** Under menu self-sorting, a person describing exactly a funnel — pages
plus automatic follow-up — would pick "website," and the three required GHL
credentials would never be asked for. The gate speech fires the moment FUNNEL is
confirmed, whether the person said the word or only described the thing.

### The hosting gate could be missed entirely by a `WEB_APP` build

The credential routing table went from three rows to six, and **Gate 2 was widened
from websites to every hosted app target.** The defect it closes is plain: under
the old table, App / Software ran *none of the three gates* — the general sweep
was the whole credential check — so **a `WEB_APP` build could reach deployment
without ever having been asked for a hosting credential.** A web app lives on a
host. The missing token surfaced at the end, hours after the moment it could have
been asked for painlessly.

Gate 2 now has two halves. The HOSTING half — `VERCEL_TOKEN` + `GITHUB_TOKEN` —
runs for `WEBSITE`, `WEB_APP`, `MOBILE_AND_WEB`, and `MOBILE_APP` on the
home-screen road. The GHL half runs only when a site lands in GoHighLevel, and an
app target never runs it. `DESKTOP_SOFTWARE` runs no hosting gate, and the
`MOBILE_APP` store road runs none either — getting into a store is the user's own
action, not a credential check, and it is written into the to-do list and the
morning report rather than attempted overnight.

### OpenClaw detection and ingestion — `references/openclaw-ingest.md` (new)

Where the client already runs OpenClaw, the skill can stop asking for things that
are already written down. The file that governs it is new, and its shape is
mostly a set of refusals.

- **Detection at step 2.8 is presence-only, from FILE EVIDENCE.** A root candidate
  must exist AND at least one of: a readable `openclaw.json`, a workspace holding
  the content files, or the secrets pointer resolving. **Never `command -v
  openclaw`** — a name resolving proves nothing about what a system has — and
  **never a bare directory-exists**, because an empty leftover folder is not an
  install. One shortcut reports "installed" for a stale folder; the other reports
  it for a name on the PATH. Read the artifact, or report nothing. Every negative
  names every path checked and what was NOT checked, `find` is read by its OUTPUT
  and never its exit code, and UNDETERMINED is a correct answer.
- **The content read happens at step 3 — not at 2.8.** It runs after the client has
  been TOLD, in the opening script's OpenClaw paragraph, and after the project
  folder and `00-INPUT/` exist. Step 2.8 reads no content, writes nothing, and
  announces nothing. Reading a person's business notes before telling them is the
  thing this ordering exists to prevent, and the summary has a durable home before
  it is written.
- **Credential VALUES are never printed, logged, written, or copied — names and
  presence booleans only.** `environment-sweep.md` remains the single owner of
  every key check; `openclaw-ingest.md` adds no key machinery and repeats no alias
  table. The one consequence for the sweep is a flip: on a box where detection
  SUCCEEDED, the OpenClaw-backed stores stop being "harmless when absent" and
  become EXPECTED, so a store that reads empty is a finding to name rather than a
  shrug — with the known-positive control run first, because a detected OpenClaw
  whose every store comes back empty is far likelier a broken reader than an empty
  install.
- **Absent is normal and silent.** Most machines have no OpenClaw. One plain line
  in the record, nothing said to the user, no second look later in the run.

### Every client-facing either/or now asks about the person's world, not the architecture

The questions that offered a choice were written from the build's point of view,
which asked a sixty-eight-year-old to hold a distinction the skill exists to hold
for them. They are rewritten to ask about the person's world and let the skill do
the sorting. The clearest case is the one that named a category outright:
**"command-line tool" became "a program with a window — buttons and things you can
see and click? Or more of a quiet helper that just runs and does its job when you
ask it to?"** A window program is a desktop program; a quiet helper is a CLI tool;
*not sure* records the window program as a default, marked as a default. The list
form of that question survives in the file as the question's substance and is
never spoken to a client on any branch.

The same rewrite runs through the mobile delivery question (the store road
described by what it costs the person in waiting and accounts, not by its name),
the mobile-and-web shape question (*are they both doing the same things?*), and
every entry in the either/or bank. Each one ends with the same sentence: **"And if
you are not sure, that is a fine answer — say so, and I will pick the road that
keeps every door open, and tell you which one I picked."**

### The per-question counter — "Question 3 of 12"

Every counted question is now spoken with its number, so **nobody has to wonder
whether they are in an endless loop.** The opening script, the Build Target
exchange, the entry-mode question and the brainstorm are NOT counted — a
denominator cannot honestly exist before the target is known, and numbering the
brainstorm's open probes would turn a conversation into a questionnaire.

The arithmetic is where this was easy to get wrong, and the rule is stated so it
cannot be. **M is computed on the UN-COLLAPSED base, and that base INCLUDES the
defaults-offer question itself**, because the offer is put to the client on every
Claude-Nine run and a spoken yes/no is a counted question wherever it stands. So a
DECLINED defaults offer moves nothing — the offer was already in M and the blocks
were never discounted. An ACCEPTED one moves M DOWN by the three questions the
defaults cover.

**Conditional collapses are NOT in the base**, and they enter the count only
through a raise announced BEFORE the question that needs it: the small-plan
collapse's confirmation is an extra counted question offered in the same breath as
its own raise — *"One extra question first — it can save you several. Question N of
M+1…"* — and a yes then moves M down by what the block's defaults replace. **A
stated M is never exceeded without the upward announcement firing first. N never
resets, never repeats, never decreases.** `interview.md` remains the only owner of
every count claim in this skill; `audience.md` cites the section and never
computes.

### Known limitation in this release — the question count can run over on some paths

**`A2` is asked once per paid service, and the base arithmetic counts it once.** On
a Claude-Nine run where the environment sweep finds more than one paid service, the
stated total can be exceeded by one question per additional service — for example a
stated 25 followed by 26 or 27 asked — and the recompute triggers do not currently
cover the service count, so no upward announcement fires. The count never runs
UNDER, no build is routed wrongly by it, and every other stated-number path was
verified across four QC rounds. A follow-up release resolves it.

The skill is now **32 files** — one added, `references/openclaw-ingest.md`, and
**nothing removed** — `tools/ledger.sh` is byte-identical, and `VERSION` reads
**1.9.0**. Seven existing skill files changed: `VERSION`; `SKILL.md` (the opening
script, the Build Target question, the folder-name rule, flow steps 2.8/3/3.5, and
reference entry 21); `references/interview.md` (the six-target taxonomy and table,
the per-question counter, the Step 1d branches, the un-collapsed arithmetic);
`references/environment-sweep.md` (the six-row routing table, Gate 2's widening,
the OpenClaw expectation flip); `references/gauntlet.md` (Gate 3 viewports follow
the Build Target); `references/audience.md` (the counter's spoken form); and
`references/media-pipeline.md` (the media question count defers to
`interview.md`).

## [1.8.4] — 2026-08-12

### The recurring defect: a fix lands in ONE file while its siblings keep stating the superseded rule

This release closes no new discovery. It closes the **same defect three releases in a
row have shipped with**, and it is worth naming plainly because naming it is the only
thing that stops it: a rule is corrected where it was found, in the file the
investigation happened to be reading, and every OTHER file that states that rule keeps
stating the old version of it. The corrected file and the stale files then disagree,
and an agent obeys whichever one its step happened to cite.

[1.8.0] demoted `ListAgents` from census authority. [1.8.1] found three passages still
treating it as the instrument of record — **all three inside `references/agent-team.md`**
— and fixed them there. [1.8.3] replaced that file's PRIMARY instrument again, with the
teammate's own transcript, and added §10 as the owner of the procedure. Each of those
was correct. Each of them corrected ONE file. Six other files went on telling agents to
take the census with `ListAgents`, and the skill has been internally contradictory on
its own liveness doctrine since 1.8.0.

The sweep is what this release is. Nothing about Rules A and B changed — they were
already right in `references/agent-team.md`. What changed is that the other six files
now say what that file says.

### `ListAgents` is CORROBORATION, never the census — now stated that way in every file that states it at all

The rule, unchanged and now uniform: **its silence is NEVER evidence of absence.** A
commander or teammate `ListAgents` fails to list is not thereby dead or unspawned.
Proven on the operator's Mac, 2026-08-12 — a live teammate held its own tmux pane while
the session reported *"not active, no pane"*, `ListAgents` never listed it, and
`TaskOutput` answered *"No task found"* for that same teammate while its artifacts sat
on disk.

Six files carried the old wording and now cite the new rule:

- **`SKILL.md`** step 16.9 — spawn confirmation went from *"confirm via `ListAgents`"* to
  verification against each commander's own session transcript, with §10 cited for the
  procedure and never restated.
- **`references/anti-drift.md`** — the re-anchor pass censused the command layer with
  `ListAgents`; it now censuses from the transcripts, and the demotion arrives there as
  a second instance of that file's OWN §1 lesson: a call that could not have found
  anything is not entitled to report nothing found.
- **`references/loops.md`** — the S-check watch tick, both in the roster description and
  in the trap row. The trap row gains the roster-shaped failure explicitly.
- **`references/platform.md`** §2 and §5.2 — the cross-session-messaging row is now
  scoped as a **TRANSPORT verdict only**: it says whether the platform PROVIDES the
  mechanism, never who is alive. Nothing about an OS availability matrix was ever
  entitled to answer a liveness question, and it no longer reads as though it might.
- **`references/worked-example.md`** — the worked run now shows the failure instead of
  describing it: `ListAgents` lists three of four commanders, `TaskOutput` returns "No
  task found" on the fourth, and **nothing is re-spawned**, because that commander holds
  its own transcript and its own pane.
- **`references/resume.md`** — the largest of the six, and the one carrying the hazard.

### The re-spawn collision in `resume.md` — the demotion's dangerous direction

`resume.md` step 8.5 told a resuming lead to census with `ListAgents` and treat every
commander named in `project_state.json` but absent from that census as DEAD. Every other
file's version of this bug produces a false negative in a report. This one produces a
**write**.

There is exactly one team per session. A commander re-spawned on a false DEAD reading
does not replace a dead predecessor — it **collides with one that already exists**, and
the run ends with two writers on one domain, overnight, unattended. Dead is still the
normal case after a crash, and 8.5 still says so; what changed is that it is now a
VERDICT with §10's checks behind it rather than a default inferred from an instrument
whose silence proves nothing.

The same correction lands on two neighbouring steps that were quietly resting on the
same class of evidence: **step 4** (a missing heartbeat line is a HYPOTHESIS about a
teammate, not a death certificate — the heartbeat is an application-level artifact, and
a commander can be alive and working while writing nothing to it) and **step 6**, where
**STALE IS NOT PROOF OF DEATH**: adopting a lane whose writer is still alive puts two
writers on one trunk, which is worse than the re-spawn collision and unrecoverable once
both have pushed. If §10 cannot close it, the lane is OWNED — escalate, do not adopt.

### The inbox artifact is swept out of the siblings too — §10 is the single owner of the instrument

[1.8.3] demoted `{root}/teams/session-{id8}/inboxes/{name}.json` to a **split-pane-only
corroborator and delivery diagnostic** that **may never ground a negative verdict** —
in-process teammates never create one, and in-process has been the documented default
since v2.1.179. That demotion, too, was written into one file. The sibling references
still named the artifact as the PRIMARY, which is the [1.8.1] doctrine [1.8.3] retired.

It is now gone from all of them, and `references/agent-team.md` §10 stands as the
**SINGLE OWNER** of the transcript procedure. Every other file CITES §10 by number and
none restates the nine steps — the restatement is how these files drifted apart in the
first place, so the sweep deliberately does not create six new copies of the thing it
just finished reconciling. `SKILL.md`'s reference index (entry 17) now says so
explicitly, so a reader arriving at the index learns where the procedure lives before
they go looking for it somewhere else.

Two consequences ride along into `references/platform.md` §7.1, whose dated exhibit rows
were recorded under the old instrument and are **corrected in place, by date, with not a
word removed**. Row A's negative half — *"did not engage Agent Teams at all"* — is now
**UNDETERMINED rather than proven**: directory absence cannot carry it, because team
directories are deleted on disband, and the named agent that spawned may have run as an
ordinary subagent in a namespace that never overlaps the teammate one. Row B's inbox
artifact is demoted in its own instrument column. **Both rows' DISPLAY findings stand
unchanged, and §5.1 is untouched** — the pane count answers DISPLAY, the transcript
answers RUN, and the whole correction is the insistence that those are different
questions with different instruments.

### `teammateDefaultModel` was SET and NOT CONSULTED — the proven key is `modelOverrides`

[1.8.0] recorded the teammate default-model failure under a routed profile and named
`teammateDefaultModel` as the fix. That is what the shipped docs say. **It is not what
worked on the box where this was measured.** Dated correction, 2026-08-12, same box:
`teammateDefaultModel` was set and was **not consulted** for an unpinned teammate spawn
under a router-backed profile.

What worked is **`modelOverrides`** in that config root's own `settings.json`, mapping
the literal tier ids onto that box's own router lanes. The proof is mechanical — the
model stamped into `teams/session-*/config.json`: failing spawns stamped
`"claude-opus-5"`, the fixed spawn stamped the router lane.

- **DERIVED PER BOX, NEVER COPIED.** Every value comes from THAT box's own
  `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_` / `_HAIKU_` aliases, read on the box in
  hand at the time of the report. A router lane id is local to the router that serves
  it; a copied one is a fresh outage wearing the shape of a fix. The skill reports the
  alias NAMES and the derivation procedure, never a lane id lifted from anywhere else.
- **REPORTED, NEVER WRITTEN — and the rule is stated at the exact site where the
  temptation lands.** `modelOverrides`, `teammateDefaultModel`, model aliases, routing,
  providers and base URLs are the CLIENT'S own configuration, hand-tuned from their real
  use. **Knowing the fix is not permission to apply it.** The skill hands the operator
  the finding, the derivation and the key name; the operator decides and the operator
  writes. §5.5's merge still touches ONE leaf —
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` — and conditionally `teammateMode`. It touches
  no model key, ever, and neither does any other part of this skill.

The superseded sentence is **kept in place** and labelled as what the shipped docs say,
with the correction beside it as what the box did. §3 stage C step 4 is the single owner
of the correction and its derivation rule; §9's two rows cite it.

### Three corrections

**The second config root requires an EXPORT, not a launcher that merely exists.**
`references/agent-team.md` §5.5 step 2 enumerated `$HOME/.claude-nine` as applicable
when that directory *or* a `claude-nine` launcher existed. The condition is that the
launcher **exports `CLAUDE_CONFIG_DIR`** — a repo-shipped launcher that sets none shares
`$HOME/.claude` with plain `claude`, and the looser reading would invent an orphan
`~/.claude-nine/settings.json` that no launcher on that box ever reads, while the root
actually in use goes unenabled. That is the same single-root darkness the step exists to
remove, arrived at from the other direction. The test is a **READ** of the launcher file
for an exported `CLAUDE_CONFIG_DIR`, or an already-existing directory — never executing
a launcher to see what it exports, never `printenv` on a running session. An unreadable
launcher is a **BROKEN INSTRUMENT** and defers the root; it is never "no second root".

**`AGENT_INSTALL.md` now names a backup location outside `skills/`.** The install step
said to back up an existing skill by moving it aside "with a timestamp suffix" and never
said WHERE. Moved inside `skills/`, the backup is picked up by the harness and registers
as a **phantom duplicate skill** named after the backup directory — which happened on a
real machine, and which `tools/self-update.sh` has documented from direct observation
since it started defaulting its own backups to `$HOME/.spec-protocol-backups`. The
instruction now sends backups to a **home-level directory outside every config root**,
naming the macOS and Windows forms, and keeps the timestamp convention that makes a
repeat run non-destructive. Note that the observed failure was a backup under
`~/.claude/backups/` — *beside* `skills/` is not far enough; anywhere beneath a config
root reproduces it. This file is repo-root and not part of the skill, so the skill's
file count is unaffected.

**An internal infrastructure path is generalized out of a public file.**
`references/environment-sweep.md` hardcoded an absolute path to the Convert-and-Flow
token-liveness checker inside a named operator toolkit. That checker does not ship with
this skill, its location is site-specific, and the path had no business in a public
repository. The row now names the checker by **filename** and the sweep discovers it
with a bounded, read-only, depth-limited `find` over `$HOME` — printing paths, never
contents. Not found is recorded as `FOUND_NOT_VERIFIED` with the search named, never as
an absent credential. And a warning measured that same day rides along: that `find`
returned **exit 1 while printing twenty-five real matches**, because it crossed
directories it could not read. **A nonzero `find` means something was unreadable, never
"not found"** — believing the exit code would report a checker that is plainly installed
as absent.

The skill remains **31 files** — nothing was added or removed in this release —
`tools/ledger.sh` is byte-identical, and `VERSION` reads **1.8.4**. Nine skill files
changed: `VERSION`; `references/agent-team.md` (the model correction and the
config-root nit); `references/environment-sweep.md` (the path generalization); and the
six that carried the swept rules — `SKILL.md`, `references/anti-drift.md`,
`references/loops.md`, `references/platform.md`, `references/resume.md`,
`references/worked-example.md`. Repo-root `AGENT_INSTALL.md` carries the backup-path
correction.

## [1.8.3] — 2026-08-12

### The inbox artifact is written by the SPLIT-PANE BACKENDS ONLY — so the census read every default-mode team as dead

`references/agent-team.md` named `{root}/teams/session-{id8}/inboxes/{name}.json` as
the PRIMARY liveness instrument in three places: §3 stage C step 2(a), §4's spawn
confirmation, and §6 step 1's resume census. **The file existing is the spawn**, each
of them said. That file is created **only by the split-pane backends**. An in-process
teammate never writes one — not on spawn, not on delivery, not ever — and
`in-process` has been the documented default display mode since **v2.1.179**,
recorded in [1.8.2] and carried there as DOC-VERIFIED ONLY.

Put those two facts together and the doctrine inverts. On any box running the
default, the PRIMARY instrument is absent for **every teammate that ever lived**, and
an agent following §6 step 1 to the letter declares a perfectly healthy team DEAD and
re-spawns on top of it. Proven on the authoring box, 2026-08-12: two real teams held
only `config.json`, and `ls .../inboxes` returned *"No such file or directory"* —
while an in-process teammate in a third team was demonstrably alive and answering the
whole time. This is the shape the NEGATIVE-RESULT CONTRACT exists to catch: a check
that comes back negative for an entire CLASS is a class-specific TEST, never a
class-specific FAULT.

### The PRIMARY is now the teammate's OWN TRANSCRIPT, and it is display-mode-blind

Every teammate is a full Claude Code session, and every full session writes a
transcript at `{active config root}/projects/{cwd-slug}/{uuid}.jsonl`. Every message
line of that transcript carries `teamName` and `agentName`. That is the instrument:
**the transcript existing is the start, and its tail is what happened.**

It was verified in **BOTH display modes and BOTH config roots** before it was written
down — a split-pane teammate under `~/.claude` and an in-process teammate under
`~/.claude-nine`, identical line shape in each. Display-mode blindness is precisely
the property the inbox artifact lacks, and it is what lets this serve as a PRIMARY at
all.

- **The procedure is READS ONLY** — a directory listing plus bounded reads of named
  files. **Never a grep.** The operator's rule is not decoration here: the passage
  being replaced is the one that had agents pattern-matching their way to state
  instead of reading it, and repeating that method inside the repair would reproduce
  the defect it exists to remove.
- The control runs **BEFORE any negative** — the lead's own transcript, read from a
  known root and slug. **If the control fails, the instrument is broken** — wrong
  root, wrong slug, permissions — and no verdict about any teammate may be issued
  until it passes.
- The last assistant line carries `message.model`, the **RESOLVED** model actually
  used. That is a better answer than any config stamp, which records what was asked
  for rather than what ran.

### Team directories are DELETED on disband — which is why a roster-based instrument fails too

The obvious repair — read `config.json` and trust its member list — was tried and
rejected on evidence. A team directory cited by name hours earlier was **gone** when
it was read back, while the transcripts of its teammates were still on disk and still
complete. The roster is LIVE STATE, not history: members are removed on spawn-failure
rollback and on leave, and the whole directory goes on disband.

**Rosters vanish; transcripts persist.** A missing member — or a missing team
directory entirely — is therefore never, by itself, evidence about what happened. The
negative branch closes somewhere durable instead: the LEAD's transcript, where the
spawn turn records the Agent call and its result verbatim, and which survives both
the rollback and the deletion.

### A named spawn can come back as a SUBAGENT, and the two namespaces never overlap

Not every named spawn becomes a teammate. The same call can run as an ordinary
subagent — the work runs, the reply arrives, and the team never gains the member. The
shipped docs warn that the agent panel cannot distinguish the two. On disk they are
not ambiguous at all:

- A **teammate** writes a top-level `{uuid}.jsonl` in the project slug directory, and
  its message lines carry `teamName` and `agentName`.
- A **subagent** writes `{slug}/{lead-uuid}/subagents/agent-{hex}.jsonl` — under the
  lead's OWN uuid directory, keyed by the hex `agentId` the tool_result returns.

The namespaces never overlap, so the distinction the panel cannot draw is drawn
**mechanically**, by which path the output landed under. That is now one of three
named closures on the negative branch, beside a spawn that FAILED — where the
tool_result's error text is the whole diagnosis — and a spawn never attempted, where
no Agent call bearing that name exists at all.

### `inboxes/` is DEMOTED, not deleted — and may never ground a negative

The artifact keeps the job it is actually good at: **message-delivery diagnostic and
split-pane corroborator** — *"did the message land?"* — and §9's runtime-paths note
about it is unchanged. What it loses is standing to prove absence, in either display
mode: in-process teammates never create it by design, and in split-pane mode it is
consumed at delivery and cleared to `[]`, so absent-or-empty says nothing about
whether a teammate lives. **No negative verdict may cite it.**

Nothing was deleted to make room for any of this. The three superseded passages are
**superseded IN PLACE, by date** — each now carries a dated amendment pointing at the
new §10, and not a word of the original was removed. Their surrounding logic stands
in full and binds the new procedure identically: census before verdict, `ListAgents`
demoted to corroboration, and `ls` rc ≥ 2 an INSTRUMENT FAILURE rather than an
absence.

### What this supersedes in [1.8.1]

[1.8.1] closed its `ListAgents` section by naming **the on-disk inbox artifact** as
the PRIMARY that the spawn confirmation, the probe stage C wording, and the resume
census should all cite — *"the artifact existing IS the spawn."* **That sentence is
superseded by this release.** Demoting `ListAgents` was right and stands untouched;
the replacement chosen for it was wrong for in-process teams, which are the default.
The [1.8.1] entry above is left exactly as written and is NOT retro-edited — a
changelog that quietly rewrites its own history stops being evidence of anything.

The skill remains **31 files** — nothing was added or removed in this release, and
the change is confined to `references/agent-team.md`, which GREW, plus `VERSION`,
which reads **1.8.3**.

## [1.8.2] — 2026-08-12

### `teammateMode` has four documented values, and the skill still writes only one

`references/platform.md` — the single owner of the value set — now enumerates all
four, rather than leaving a reader to infer the set from the two values the rule
happens to mention. Sources are the shipped docs, read 2026-08-12:
`code.claude.com/docs/en/settings.md` and `code.claude.com/docs/en/agent-teams.md`.

- **`in-process`** — every teammate in the one terminal; "works in any terminal, no
  extra setup required".
- **`auto`** — split panes ONLY if the session is already inside tmux, or inside
  iTerm2 with `it2` on PATH, and **silently falls back to in-process otherwise**.
- **`tmux`** — split-pane mode, which doc-verbatim **"auto-detects whether to use
  tmux or iTerm2 based on your terminal"**. That is why the one value this skill
  writes already serves iTerm2 users, and why there is no second value to pick.
- **`iterm2`** — added v2.1.186; native iTerm2 panes in the CURRENT window via the
  `it2` CLI.

The key still selects **DISPLAY ONLY**, never function, and the skill still writes
at most `"tmux"` and only under §5.5 step 4's two conditions. Naming the whole set
is what makes the protection clause below expressible at all.

### The 2.1.179 default flip is recorded — with the caveat that its changelog is silent

The documented default became **`in-process` as of v2.1.179**; it was **`auto`**
before. The caveat is stated in the file rather than buried, because the sourcing is
thin: **the 2.1.179 changelog entry is SILENT on the flip**, so the two doc pages
above are its SOLE source and there is no changelog corroboration to cite. It is
carried as **DOC-VERIFIED ONLY**, beside floors that are verified by both.

It matters here for one specific reason: this skill's own procedure floor is
**2.1.178** — one version below the flip — so a box sitting exactly on the floor
still has the OLD default. Neither default is ever assumed on a live box; §5.5
step 6 makes that root's own pre-write value the authority instead. Said just as
plainly, so this reads as the caveat it is and not an alarm: `auto` outside
tmux/iTerm2 falls back to in-process anyway, so a plain-terminal client behaves
identically under either default.

### Presence is NECESSARY, never SUFFICIENT — the gate is LAUNCH CONTEXT, not box inventory

v1.8.0 required a split-pane host to be **PROVEN present by RUNNING the probe**, and
v1.8.1 hardened that proof. Both were right, and both are unchanged. The defect was
that presence was also treated as the DECIDER — and it is not.

A box can pass the presence probe while the client sees **nothing**. Where `tmux -V`
returns 0 but the launch happens from a plain terminal, the binary selects
**external session mode** — a SEPARATE tmux session that is **provably never
auto-attached**. Dated observation, not a standing claim (2026-08-12, string
extraction of the installed 2.1.227 binary): `attach-session` occurs **exactly twice
in the entire binary, BOTH inside the unrelated `--worktree --tmux` feature**,
against a passing control of **25** `new-session` occurrences. The same launch can
additionally raise a consent dialog a non-technical client never asked for and
cannot interpret — binary-verbatim, *"Opens teammates in a separate tmux session"*,
with a Cancel/skip option.

The witnessed outcome is the whole point: two live tmux sessions on the authoring
box ran teammates for **over an hour at `session_attached=0`**. The teammates worked
the entire time. Nobody could see them. A command that yields an invisible team and
an unexplained dialog is a support call, not a launch.

So split-pane display is now promised **only where the session will run INSIDE AN
ATTACHED tmux session, or in iTerm2 with `it2` PROVEN present**. "Inside tmux" alone
was an incomplete statement of the gate, because the iTerm2 + `it2` path puts native
panes in the current window with no tmux involved at all. Where that launch context
cannot be GUARANTEED, the key is **OMITTED** and the client is handed the plain
launcher command **even where tmux exists**. The presence of a program is not the
presence of a context, and an unguaranteed context is a "no" here.

Two consequences follow, and neither is a downgrade:

- **The parenthetical that told the client to start `tmux` first is REMOVED.**
  Instructing the client to type `tmux` is a terminal chore, which THE HANDOVER RULE
  forbids outright — the client's entire share of that section is ONE plain sentence
  and ONE copy-paste command. A context the client would have to create with their
  own hands is, by definition, not guaranteed; that case is the plain-launcher
  branch, printed without comment. What is removed is the INSTRUCTION TO THE CLIENT,
  not the operator's reasoning, which is retained and expanded.
- **A no-pane box is still a DEGRADED-DISPLAY box, never a BLOCKED box.** That
  verdict from v1.8.0 is untouched. What changed is which boxes reach it.

### A client's own `teammateMode` is no longer destroyed by a validation that demanded absence

The step 6 validation required `teammateMode` to be **ABSENT** wherever step 4's two
conditions were unmet. On a client box where the client had hand-set `"iterm2"` or
`"auto"` themselves — before this skill ever touched the file — that check failed
against a value **the skill never wrote**, and fired the step-6 restore, **destroying
the client's own configuration while reporting a successful safety action.** A
validation that can only fail on someone else's correct work is not a validation; it
is the bug.

Validation now compares `teammateMode` against the **PRE-WRITE SNAPSHOT**, never
against absence. The rule it enforces is *"this run wrote only what it intended to
write"* — it is **NEVER** *"the file must not contain a value the client chose."* The
check passes when the post-write value equals the pre-write value, or equals `"tmux"`
where step 4's conditions were met and this run therefore wrote it. It fails only on
a value this run put there without meeting those conditions.

- A pre-existing client-set value of **any** documented kind is left exactly as
  found — never overwritten, downgraded, normalised, or deleted — and its presence
  is **never** a validation failure.
- The skill still **NEVER WRITES** `auto` or `iterm2`, and still writes `"tmux"` only
  under step 4's two conditions. It merely stops **destroying** the values it did not
  write.
- The snapshot is taken with the same JSON-aware reader BEFORE the merge, recording
  `teammateMode` as either `<absent>` or its exact value. A snapshot that could not
  be taken is a **BROKEN INSTRUMENT** — do not merge, do not validate against a
  guess, and do not restore over a file you never successfully read. Report and
  defer.
- Every other check in that step stands exactly as written: the parse check, the
  flag-equals-`"1"` check, the key-by-key leaf-preservation check, and the
  restore-that-root's-backup-on-failure rule. The clause is ADDITIVE; it narrows
  nothing except the one comparison that was destroying client state.

## [1.8.1] — 2026-08-12

### Presence is proved by RUNNING the program, never by resolving its name

v1.8.0's P0 detected tmux with `command -v tmux`. That proves a NAME resolves on
PATH — it never proves the program runs. A stale Homebrew shim, a broken symlink,
or a wrong-architecture binary all resolve happily and then fail on first use,
and v1.8.0 would hand such a host `teammateMode: "tmux"` — a display mode pointed
at a binary that cannot start, which is exactly the dead end the release claimed
to have removed.

- **P0 now PROVES presence by INVOKING**: it runs `tmux -V` and reads the exit
  code. P6 re-proves the same way after a `brew install`, so an install that
  reports success but produces an unrunnable binary is still treated as absent.
- The two failure shapes are **reported distinctly**, never collapsed into one
  "not found": **rc 127** — the name resolved to nothing at all; **any other
  non-zero rc** — the name resolved, and running it failed.
- Absence remains a **DEGRADATION, never a blockage**: with no usable tmux the
  key is not written at all and Claude Code's in-process display mode applies.
  Agent Teams stay enabled either way.

### The selftest grew from 8 cases to 9 — the 9th is the regression test

The defect was invisible to a passing selftest because the fake tmux encoded the
same mistake: a two-line no-op that merely resolved. It now ANSWERS `tmux -V`,
because that is what the script actually asks. New case 9 pins the defect: a
tmux NAME that resolves to a binary that cannot run must be treated as ABSENT —
key omitted, degradation reported with the resolved-but-failed reason. It
carries its own two-half control and refuses to render a verdict unless BOTH
halves reproduce — the name must resolve AND running it must fail — so the case
can never pass by failing to arm the trap it exists to spring. Case 7 keeps its
own control requiring rc 127. 9/9 pass.

### The Windows parenthetical is restored, with a single owner

The note that on native Windows `teammateMode: "tmux"` is never written — the
flag alone is set there and the display mode is left unclaimed — went missing
from `references/agent-team.md` while the surrounding section was edited. It is
back, and the two SendMessage rows now cite `references/platform.md` §5.2 as the
SINGLE OWNER of the Windows peer-messaging gap rule instead of restating it, so
the rule has one home and cannot drift again.

### `ListAgents` is corroboration, never the census

v1.8.0 demoted `ListAgents` from census authority but left three passages still
treating it as the instrument of record. The spawn confirmation, the probe stage
C wording, and the resume census now all name the PRIMARY instruments — the
on-disk inbox artifact, plus a tmux list-panes count increment in split-pane
mode. The artifact existing IS the spawn; `ListAgents` silence is never evidence
of absence, and a read error on the inbox directory (`ls` rc >= 2) is an
instrument failure, never an empty census.

The skill remains **31 files** — nothing was added or removed in this release —
and `VERSION` reads **1.8.1**.

## [1.8.0] — 2026-08-12

### Agent Teams are gated PER CONFIG ROOT, and there are exactly two of them

`enable-agent-teams.sh` configured a single config root. That was the headline
defect: the flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is read out of the
settings file of the root the launcher is using, so enabling one root is
**INVISIBLE** to the other launcher. Backup, merge, and validate/restore now all
run **per root**, each with its own backup.

- **`claude` uses `~/.claude`. `claude-nine` uses `~/.claude-nine`.** Measured,
  not assumed: `~/.local/bin/claude-nine` line 32 exports
  `CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude-nine}"`.
- **`claude-codex` is NOT a third root.** `~/.local/bin/claude-codex` line 32 is
  `exec "$HOME/.local/bin/claude-nine"` — it is a pinned front end for the same
  launcher and SHARES `~/.claude-nine`. It is never probed as a separate box and
  never counted as a third root; doing so would double-count one root.
- The routed root is configured **only when its directory already exists**. A
  routed profile the operator never created is never invented.
- `--settings PATH` still forces a single-root run against exactly that file.

### tmux is a DISPLAY verdict — degradation, not a dead end

The documented default display mode is **in-process**, which "works in any
terminal, no extra setup required". `teammateMode` selects DISPLAY ONLY, so tmux
was never a prerequisite for Agent Teams — but the old text let a reader convert
`TMUX INSTALLATION BLOCKED — HOMEBREW NOT FOUND` into a stop gate on the build
itself.

`references/platform.md` §5.1 now states both halves of the rule in the file that
owns it. The per-OS half is unchanged (never `tmux` on Windows). The new per-box
half binds **every** OS: write the key only where tmux — or iTerm2 + `it2` — is
**PROVEN present on that box**, by RUNNING the probe and reading its exit code,
because `command -v` proves only that a name resolves. Absent or UNDETERMINED
takes the ABSENT branch and the key is **OMITTED** — omission is the action;
there is no "write in-process instead" step, the harness's own default applies.
A no-tmux, no-Homebrew Mac is a **DEGRADED-DISPLAY box, never a BLOCKED box**,
and the correct ledger line is a `PLATFORM-SKIP` naming the display consequence
and stating that team formation is UNAFFECTED. The `it2` probe flag is recorded
as **UNDETERMINED** rather than guessed — it was never run on the box, so no flag
string in that file is a measurement.

### The teammate default-model failure — proven, reported, never written

A teammate spawned with **no explicit model** falls back to the provider-default
Opus model, which a local 9Router need not serve. Session `6d3fcc76`: two
teammates, both `"idleReason":"failed"`, `"failureReason":"There's an issue with
the selected model (claude-opus-5). It may not exist or you may not have access
to it."`

The presentation is the dangerous part. Both teammates rendered as **running
spinners from 10:46 to the 14:44 idle notice** — roughly four silent hours,
witnessed. A spinner is therefore not evidence of progress, and "still working"
is never a status a lead may report on a teammate's behalf.

- The stage C probe teammate is now **PINNED to the lead's own current model**, so
  the probe tests team infrastructure instead of model-default resolution.
- Stage C gets its own split verdict — **"infra PASS / teammate model FAIL"** —
  with the `failureReason` string recorded **VERBATIM**, including the model id it
  names, because that string is the whole diagnosis.
- Real commanders are spawned with an explicit model for the same reason.
- The official settings key that fixes it is **`teammateDefaultModel`**. This
  skill **REPORTS that key and NEVER writes it.** Models, routing and providers
  belong to the client, and multiple clients have hand-tuned custom providers that
  must survive untouched.

### A session cannot self-report whether Teams is active — only EXTERNAL instruments count

Proven, and the reason every teams verdict in this release cites an instrument
outside the session under test: a live teammate held its own tmux pane while the
session said "Agent Teams not active, no pane", `ListAgents` never listed it, and
`TaskOutput` errored "No task found" while that teammate's inbox existed on disk.
`ListAgents` is not a census.

The two instruments that do count are named as such: the `tmux list-panes` pane
count, and the on-disk artifact
`{config root}/teams/session-{id8}/inboxes/{name}.json`. This is the control
discipline applied to teams — prove a negative on an instrument you can also see
a positive with.

Recorded alongside it, as a **dated one-box observation and not a standing
claim**: headless `claude -p` did not engage Agent Teams at all. Same flag, same
settings, same binary — a named agent spawned, but no team directory, no tmux
session, no teammate protocol. Teams presented as an interactive-session feature.
Teammates also do not survive `/resume` or `/rewind`; the team config directory is
removed at session end.

### The skill can now tell it is stale, and take the update itself

New `VERSION`, `tools/check-update.sh`, and `tools/self-update.sh`. The check runs
once, the moment the harness and launcher are known, and it is **a check, never a
gate** — no outcome of it ever stops a run.

- **Exit 0** — say nothing and continue. The silence is the point.
- **Exit 1** — tell the operator plainly and **name BOTH versions**; a version
  offer with no numbers is not an offer. On yes, **the skill runs the self-update
  itself** — the client never opens a terminal, which is THE HANDOVER RULE binding
  the skill's own maintenance exactly as it binds everything else. On no, the
  declined offer is recorded and never raised again this run. A failed self-update
  is a finding, never a stopped build.
- **Exit 2** — say **UNDETERMINED** in one line and continue. Never report
  "current" from a check that could not reach its source: an exit code is a fact
  about the check, never a fact about the version.

The outcome is carried into the Capacity Ledger header beside the launcher line,
timestamped.

### `VERSION` replaces the file count as the rollout proof

The skill goes **28 files → 31 files** (`VERSION`, `tools/check-update.sh`,
`tools/self-update.sh` are new; nothing was removed). A file count was never a
version, and it stops being the rollout proof here — a box now proves what it has
by reading `VERSION`, which is a number that can be compared, rather than by
counting files, which cannot distinguish two different trees of the same size.

## [1.7.0] — 2026-08-12

### The pre-fleet-roll review — three blockers closed, and the count/pointer drift swept

A full review of the skill ahead of a fleet roll found three blockers and twelve
defects. All fifteen are closed here. Each blocker was a case of two right-looking
texts that could not both be true, in a file an agent obeys literally.

- **The reserve contradiction, resolved as WIDTH VERSUS WORK.** RULE 2 said
  independent work fans out *"never gated, never reserved"*; Law 44, binding in the
  same file, said hold a quarter of every provider's cap back — so the usable-capacity
  number every dispatch cites differed by 25% depending on which sentence the executing
  agent read. **RULE 2 now governs one question only — do we hold agents back when
  there is work for them? — and Law 44's reserve is untouched in the ceiling
  arithmetic.** The two act on different quantities in a fixed order: ceiling minus
  reserve gives the usable number; dispatch never leaves runnable work idle *inside*
  that number. Consuming 100% of a provider is still a Law 44 violation, and neither
  rule buys the other any slack. The phrases *"no reserve"* and *"never reserved"* are
  gone from the tree.
- **The three-terminal handover is out of the file every client message is written
  from.** `audience.md` §9 still promised *"Terminal 1 builds your app. Terminal 2
  checks the quality and fixes things. Terminal 3 puts the finished work on
  GitHub."* — the exact defect the HANDOVER RULE was written to stop, on the happy
  path, in the one file that governs every user-facing sentence. §9 now says the skill
  spawns and drives its own seats, the client opens nothing, and the only paste they
  ever receive is the single crash-restart command.
- **The wiring report is a SHAPE, not a recital.** `interview.md` told the agent to
  report a client's router wiring by reciting four model names this repo supplied.
  Three of those four are wrong for the wiring the installer actually ships, so an
  agent following the template told a client false facts about their own machine. The
  template is now `"<alias> is currently <resolved model id>"`, every name read live,
  and the old names moved into the dated historical exhibit that already existed
  beside it.

### Seat wirings are expiring exhibits, not standing doctrine

`gauntlet.md` §13 declared each of the six workflows' model seats with a pinned
model id attached — the same defect the wiring report carried, one file over.
**Every seat now declares a REQUIREMENT** (the strongest available lane; vision
proven by probe; rubric depth; a different underlying model from the builder) and
the model names are quarantined in **§13.1e, an exhibit whose authority has
expired** — dated, marked as one machine on one day, kept only for what it teaches
about the shape of a declaration. The topology is unchanged: WF01–WF06, 8/16/16/8/4
agents, repair waves capped at 12, release still requires 4 out of 4, and §14's
nineteen stations are byte-identical. The same cure was applied to the three
remaining recitals in `pipeline.md` (build, QC and merge seats) and two in
`interview.md`. **No pinned model id remains anywhere as doctrine** — every
surviving mention is a family name, a dated exhibit, a sourced quotation, a
prohibition, or an item explicitly marked undetermined.

### Question B3 is retired — the merge cadence is a default, not a question

B3 asked the client how many finished pieces should land per train run. RULE 2 had
already removed the merge count cap, so there was nothing left for that answer to
set: the train is time-triggered and whatever is ready merges as one batch, however
much that is. It was also a question a non-technical client cannot reason about.
**The standard drain timer is now the only path — applied silently and reported,
never asked.** The ids stay B1, B2, B4 with B3 marked RETIRED and dated in the file,
so a later pass cannot quietly restore it. The lettered ceiling drops from 23 to 22
and the attended ceiling from 22 to 21, and every surface that states a count moved
with it.

### The S-check roster updates itself

The swarm watch enumerated S1–S14 while RULE 5 defined sixteen checks, so S15 (media
persistence) and S16 (video duration) were specified but never watched. The tick now
covers all sixteen **and defers to RULE 5 by name as the roster's only owner** — a
seventeenth check is enforced by adding a row, with no edit to the loop. No file
freezes an S-range any more.

### The count and pointer drift sweep

Every remaining defect was a cross-file count or pointer that had gone stale — the
class a publish-time consistency checker would catch mechanically, and the strongest
argument for building one.

- `interview.md` **owns every question-count claim**; other files cite it and now
  agree with it.
- The interview no longer claims regular Claude Code skips it entirely — **Block D
  runs on both harnesses** and never collapses.
- **4 core + 5 survival loops**, corrected where it said four survival.
- The reading order now lists **all twenty references**, including the two largest
  files that were reachable only by accident, each with its load condition
  (`media-pipeline.md` — media builds only; `command-center-integration.md` — funnel
  builds only), and the step pointer that named a step that does not exist is fixed.
- **Line-number citations are gone.** `gauntlet.md` §12 cited a section of
  `pipeline.md` by a line range that had moved 200 lines; it now cites by section
  name and says why a line number is never used.
- `anti-drift.md` cited a case count that its own selftest had outgrown; it now cites
  the selftest's full case list.
- The refused-artifact destinations say **the sixteen prior documents** — accurate,
  because the nine refusals predate document 17 and none of their content routes to it.
- Operator-box snapshots inside binding tables — *"on this box `fable` resolves
  to…"* — are marked as dated examples to be resolved on the machine the run is
  actually on.
- RULE 2 no longer states an unqualified 16 sub-agents per workflow; it is
  `min(16, cores−2)`, measured at run time, everywhere.

### Verified before publish

All four tool selftests pass from a fresh clone — `anchor.sh` 13/13, `env-sweep.sh`
6/6 with zero secret values printed, `capacity-resolver.sh` and `capacity-profile.sh`
full pass. All five tools ship 100755. `ledger.sh` is byte-identical to its recorded
hash. Every ceiling in the tree is unmoved, proved by two independent differs — a
per-file token multiset and a per-file count of each named ceiling — each proved
against its own planted control, including one designed to defeat a differ that only
looks at totals and one designed to defeat a differ that only looks at deleted lines.
The tree carries no operator name, no gendered pronoun referring to the operator, and
no personal path beyond `/Users/yourname` placeholders.

## [1.6.0] — 2026-08-12

### The ultracode fix now reaches the box, not just the launcher

- **v1.2.0 fixed the launcher; it could not fix the machine.** `CLAUDE_CODE_EFFORT_LEVEL`
  in the environment **overrides the in-session `/effort` picker**: with it set to
  anything other than `xhigh`, selecting `ultracode` returns *"CLAUDE_CODE_EFFORT_LEVEL=…
  overrides effort this session — clear it and ultracode takes over"* and the selection is
  never applied, so it looks like it snaps back. The shipped binary's save path accepts only
  `low|medium|high|xhigh`, so **`max` is not persistable at all**. v1.2.0 stopped *this
  repository's* launchers exporting it and named the residual risk in plain words:
  *"boxes that already export `CLAUDE_CODE_EFFORT_LEVEL=max` from a shell profile, `launchd`,
  or an OpenClaw process still override the picker until that export is cleared per box."*
  That residual risk is now closed by the installer instead of by hand, so **a fleet roll
  fixes every box regardless of which source the variable came from.**
- **A new remediation step runs on both platforms** — `scripts/macos/fix-ultracode-override.sh`
  at phase 9.6 of `setup-macos.sh`, and `scripts/windows/Fix-UltracodeOverride.ps1` at phase
  10.6 of `setup-windows.ps1`. Both are also **standalone-runnable on an already-installed
  box**, which is what makes remediating the existing fleet possible without a reinstall.

### What it detects — and what it admits it did not check

- **Every source is named, found or clean.** The current process environment; the launchd
  user domain (macOS) or the **User and Machine** environment scopes (Windows); six shell
  startup files — `.zshrc`, `.zprofile`, `.zshenv`, `.bash_profile`, `.bashrc`, `.profile`
  — or the four PowerShell profiles; the `env` map of `~/.claude/settings.json`,
  `settings.local.json` and the `~/.claude-nine` pair; and candidate service env files.
  `~/.zlogin`, `~/.bash_login` and the `/etc` startup files are checked read-only.
- **Shell matching is tolerant, and classified rather than pattern-matched blindly.** Bare
  assignments, `export`, `declare -x`, `typeset -x`, and a `launchctl setenv` line inside a
  startup file all count — through any quoting and any whitespace. An `unset` line is
  recognised as a **fix, not a fault**, and is never commented out; commenting it out would
  re-break the machine.
- **A negative is proved before it is reported.** The scanner is run against a **planted
  positive and a planted negative on every run**, `launchctl getenv` against a
  known-non-empty name, and each Windows environment scope against `Path`. **A failed control
  degrades the run to detect-only and reports UNDETERMINED — never "clean" — and edits
  nothing**, because acting on an instrument that just failed its own control is worse than
  not acting. `grep` is not used in the detection path at all: its `rc>=2` is an *error* and
  is trivially misread as "no match".
- **The report ends with what was NOT checked** — per-project `.claude/settings.json` files,
  other users' home directories, other processes' environments, and (Windows) `cmd.exe`
  AutoRun entries, Group Policy logon scripts, and WSL — so the report is never read as
  coverage it does not have.

### What it changes — and what it refuses to touch

- **Every mutation is backed up first**, timestamped, **never overwriting an existing
  backup**, with the path printed. A backup that could not be written means the file is not
  edited: nothing is ever changed without a way back.
- **Shell and profile lines are COMMENTED OUT behind a dated marker, never deleted.** A
  commented line is reversible and visible; a deleted one is neither. Restoring it is
  deleting one `#`. A rerun never double-comments — the disabled line is a comment, so it is
  no longer live.
- **`launchctl unsetenv`** for the launchd user domain and
  `[Environment]::SetEnvironmentVariable(...,$null,'User')` for the Windows User scope, each
  **re-read afterwards from launchd or the registry** to prove it took.
- **`settings.json` gets a MERGE-remove of exactly that one key**, validated against **every
  pre-existing leaf value** — model aliases, routing, permissions, hooks, MCP, other env
  vars — with the **backup restored on any failure**. A broken settings file is never left
  behind. Same discipline the Agent Teams enabler already uses.
- **Four sources are deliberately NOT edited, and are reported with the exact manual command
  instead of guessed at**: the current process environment (a child cannot alter its
  parent's), the Windows **Machine** scope and **AllUsers** profiles (administrator-owned,
  shared by every account), **service env files** such as OpenClaw's (credential files whose
  change only takes effect on a restart this installer will never perform), and **any line
  form the scanner does not positively recognise**.
- **Nothing is killed, signalled, restarted, reloaded, or `exec`ed** — no process, session,
  workflow, subagent, terminal, or tmux server, and no shell-profile reload. The report says
  so line by line. **The change takes effect in NEW shells and NEW sessions**; a terminal
  that is open keeps the environment it started with, and a Claude Code session that is
  running keeps the effort level it is running at.
- **No secret is ever printed.** Settings files are read for this one key's name and value
  only — never dumped, no other value printed. Shell and profile files are reported by line
  **number and classification**, never by line content, so scanning a file that also holds
  credentials cannot leak one.

### Idempotent, self-testing, and honest about the platform it could not run on

- **A rerun is a byte-identical no-op** that says so, writes nothing, and creates no second
  backup.
- **`--selftest` proves detection AND remediation in both directions** in a sandbox `HOME`,
  with a stub `launchctl` so the real user domain is never touched: planted positives in five
  shell files plus `settings.json` plus launchd are all caught and cleared; a clean box is
  left byte-identical with no backup written; `unset` and already-disabled lines survive
  untouched; an existing backup is never overwritten; a forced validation failure restores
  the settings backup byte for byte. **Three of the eleven checks are mutation proofs that
  the checks can fail** — `--dry-run` on a planted positive must still report it and write
  nothing; a `launchctl` whose control answers empty must be UNDETERMINED rather than CLEAN;
  and a scanner stubbed to always answer "clean" must fail its control, poison every negative
  in the report, edit nothing, and exit 2. That third proof caught two real defects during
  development: the script used to keep editing after its own instrument failed, and
  `make_backup` used to swallow a failed `cp`. Both are fixed.
- **The Windows script is UNDETERMINED — written, reviewed, NOT EXECUTED.** No PowerShell
  exists on the machine this was authored on (`pwsh` and `powershell` both returned 127
  against working controls in the same shell), so its `-SelfTest` has never been run. It is
  written to this repository's existing PowerShell conventions and its here-string and brace
  structure was checked against the shipped `Enable-AgentTeams.ps1` as a known-good baseline,
  but **no claim is made that it has been tested.** Run `-SelfTest` on a Windows box before
  trusting it. The macOS twin is fully self-tested.

## [1.5.0] — 2026-08-12

### One key, one bill, and an asset that outlives the link it arrived on

- **kie.ai is an aggregator, and reading a maker's name as a credential requirement was the
  defect.** Every model in the kie catalogue is called with the **same kie key, billed in the
  same kie credits, on the same kie account — no matter who built it**. GPT-Image was built by
  OpenAI; Veo and the Nano Banana imaging engines by Google; Seedance and Seedream by
  ByteDance; Hailuo by MiniMax; Wan by Alibaba; Kling by Kuaishou. The builder's name changes
  **which** model is picked, never **how** it is reached. **No upstream vendor account, key or
  credential exists anywhere in this pipeline: not needed, not checked, not asked for, not
  hunted for, and not accepted if offered.** A vendor name beside a model is *lineage* — what
  the engine is made of, useful when judging output character — and a vendor-prefixed id is a
  catalogue path. Neither is ever an access fact. If a table anywhere in the skill can be read
  as "this model needs a Google key," **the table is wrong, and the fix is wording, never a
  credential.**
- **TWO DOORS, MANY MAKERS, NO THIRD KEY.** Every media generation walks through exactly one of
  two doors — the kie door (kie key, kie credits, the whole catalogue regardless of builder) or
  the Agnes door (Agnes key, Agnes daily meters, Agnes models). No third door exists and no
  upstream vendor is a door. **GoHighLevel is a warehouse, not a door**: nothing is ever
  generated "on" GHL, and its credentials are storage credentials, never a third media engine.
- **The client is told this in their own words, before a maker's name can mislead them.** "All
  of these picture and video engines — whoever originally made them, Google, OpenAI, anyone —
  run through the one Kie.ai account." When a client **offers** an upstream key — "I have a
  Gemini key, use that" — the answer is a warm no built on two facts: it is not needed, and it
  would not work here. It is never accepted, never asked to be shown, and the exchange is
  recorded in the decision register in their words. Any page the skill points a client at may
  name **kie.ai or agnes-ai.com and nothing else** — a client sent hunting for a Google or
  OpenAI key has been sent on an errand that cannot end.
- **The gated tier is a price gate, never an access gate.** Both the gated path and the default
  path bill the **same kie account in the same kie credits**. "Premium engine" beside a
  ByteDance or MiniMax attribution reads, to a nervous client, like another account they do not
  have; the gate now says in one sentence that nothing about a gated family requires another
  vendor's key, another account, or another signup.

### An asset is not done until it is durable

- **The provider's result URL is a dying pointer to something already paid for.** A media work
  item now reaches done only when all of: the bytes are **downloaded and verified**; the asset
  is **stored in the project's own folder in the client's GoHighLevel media storage** (and the
  repo's media directory when the build is a repo); the **permanent URL is recorded** on the
  work item and its ledger line; and the upload is **verified by reading it back** — a file
  that appears in a fresh listing with a non-zero size, never a 200 assumed to mean success.
- **Capture races a clock; persistence does not.** Capture runs **in the same poll iteration
  that observes terminal success**, with nothing scheduled in between — that is the
  money-protection step. Upload is part of the generation step, not a later cleanup pass.
- **A provider URL never enters a deliverable**, a spec document, generated code, or the
  shipped app. This is enforced fail-closed as a new watch check, **S15**, whose deny-set is
  built mechanically from the run's own ledger — every URL it recorded plus the provider hosts
  it actually observed — so it needs no maintained host list and cannot silently rot. A done
  item without a verified permanent URL reverts and is not merge-eligible.
- **Why this is money rather than tidiness:** a measured task showed credits already consumed
  at the **first** poll while the job was still generating. **kie commits billing at submission,
  not at delivery.** An asset whose URL expires before it is captured is an asset that was
  already paid for.

### Four polling contracts, because the four paths genuinely differ

- **kie jobs** poll a task record that outlives the asset, with a documented submission burst
  limit — dispatch caps at **half** the documented burst, the reserve doctrine applied to a
  rate rather than a count.
- **Veo answers in a different envelope** through its own endpoint, with its own success flag
  and its own restrictions; it is read on its own terms rather than assumed to match the jobs
  API.
- **Agnes images are synchronous and return `b64_json`** — the bytes arrive in-band, so there
  is **no URL to race and no expiry to lose**. That is now the design rule for Agnes images,
  not an incidental detail.
- **Agnes video is asynchronous and documents no recovery endpoint at all.** An uncaptured clip
  is unrecoverable, which is precisely why capture is same-iteration.
- **A dropped connection is designed for rather than discovered.** A task that timed out may
  still complete and still bill, so it is recorded failed with its task id and re-checked before
  any resubmit — never blind-resubmitted.

### Video duration stopped being an assumption

- **Per-model clip ceilings are researched, not guessed**, and duration and resolution validate
  **as a pair** — a legal duration at an illegal resolution passes both single-axis checks while
  being impossible to generate. Checking them separately dispatches a request that cannot exist.
- **Agnes's hard ceiling is 441 frames**, not a seconds figure. Seconds are frames divided by
  frame rate, so the same ceiling is about eighteen seconds at the vendor's recommended rate and
  considerably less at a higher one. The ledger records the **frames-and-rate pair**; a bare
  seconds figure is not a ceiling.
- **Multi-clip planning is explicit** — decomposition at shot boundaries, identical parameters
  across siblings, and an honest declaration of what the skill does **not** do: it is not a video
  editor, and where it cannot join, it says so and leaves a declared gap.
- **A new watch check, S16, validates duration before dispatch.** An item dispatched past its
  ceiling, or estimated on pro-rata seconds where the unit is a block, is a defect; a multi-clip
  parent with no stitch-or-gap answer is not dispatchable.

### Stitching is in scope; a video editor is not

- **ffmpeg is detected by execution, never by assumption and never auto-installed.** Both
  `ffmpeg` and `ffprobe` must run and parse. An install is offered only with consent and only
  through a package manager already present; the Windows path is marked undetermined rather than
  invented.
- **Stream-copy where the inputs agree, exactly one re-encode where they do not** — and the
  re-encode is planned, never discovered, because it costs minutes per video-minute.
- **The output is ffprobe-verified and read-back verified**, like every other asset.
- **Local stitching is its own capacity class**: local CPU and wall clock, drawing **no**
  provider meter, no credit balance and no request window. It enters the burn table as time.

### The billing-unit trap

- **Seedance 2.5 bills in thirty-second blocks.** An eight-second clip therefore pays **3.75×**
  what pro-rata arithmetic would predict. Selecting a model by duration without its billing
  granularity wastes money invisibly.
- **Every consent ask now prices the BILLED unit, never the requested duration** — "this clip is
  eight seconds, but that engine charges for thirty no matter what" — so the client's yes is
  informed about the **shape** of the price and not only its size. The estimate that reaches the
  Capacity Ledger is the billed figure too.

### Never blend two ceiling classes

- **A sentence can be true in both halves and wrong as a whole.** Deriving a clip count from a
  seconds-per-day allowance while naming another provider's clip durations is exactly that
  error. **Agnes video's 500 seconds per day is an Agnes meter and nothing else.** kie video —
  Veo, Seedance, Hailuo, every catalogue member — has **no seconds-per-day meter of any kind**;
  it is bounded by the prepaid credit balance and the submission rate cap. kie capacity is
  answered with balance divided by measured billed cost per clip, never with seconds of
  allowance.
- **Every "clips per day" figure names the provider it belongs to, or it does not get written.**

### Corrections of record, each measured rather than argued

- **kie commits credits at submission**, observed directly while a task was still generating.
- **A kie result URL died at roughly forty minutes** — far tighter than the documented
  twenty-four hours — yet the recovery endpoint minted a fresh link that **served verified
  bytes past that death**. Recovery inside the window is now measured, not merely documented,
  and it is a re-fetch, so it is free.
- **The mint does not discriminate.** The same endpoint happily minted a link for a fabricated
  URL, which then failed at fetch. **A successful mint proves nothing; only fetched bytes that
  pass magic-byte and size verification prove recovery** — so the recovery path fetches and
  verifies and never trusts the mint's answer.
- **Agnes has a working liveness endpoint** and is no longer presence-only — and the same call
  returns a machine-readable catalogue scoped to what the key can actually call, which outranks
  the documentation index for discovery: the docs say what is documented, this says what the key
  can call.
- **Agnes video's daily allowance is 500 seconds, not 800.** The 800 was an unverified note; the
  vendor's own plan documentation is the source and it is dated.

### Agnes durability, stated precisely enough to be fair

- **The established weakness is durability, and only durability.** kie results are recoverable
  for a documented retention window; an uncaptured Agnes clip is not recoverable at all. **The
  word "worse" without "on durability" attached is the sentence this skill refuses to write** —
  **Agnes video quality remains undetermined and is labelled as such**, and a preference argued
  from quality is invented rather than sourced.

### The loss decision, designed once instead of improvised per incident

- **A re-fetch is free; a re-spend is gated.** The recovery ladder is explicit: attempt recovery
  first, and only then consider paying again — under stated conditions, with the gated and
  non-gated families split, and governed by a recorded **`MEDIA_LOSS_POLICY`**. The client is
  asked once, at interview time, what they want to happen if artwork is lost after it was paid
  for; the default is conservative and the binding floors hold regardless of the answer.
- **An asset lost after payment is reported by name.** Omitting such a line from the completion
  report is a defect of the highest class.

### Project-local `.env` is no longer a credential store

- **Keys live in home-level stores only.** A project `.env` sits **inside the git repository**,
  and one careless `git add .` — or a scaffold's over-broad commit — publishes every secret in
  it. The sweep never searched project `.env` files; the documentation was the thing that was
  wrong, and it now records the reason at the tool's own definition site so nobody "fixes" the
  omission later. Guided key placement points at `~/.env`, a store the sweep provably sources
  on every box it runs on, so "put it there, then tell me, and I'll look again" actually works.

### The skill now names no person

- **A universality pass removed the operator's name, username, personal paths and every
  gendered pronoun referring to them** from all seventeen reference documents, the skill file
  and the tools. Attribution that carried real authority is **preserved as "the operator"** —
  nothing true was deleted, and every standing ruling still has an owner. What changed is that
  the skill now reads the same for anyone who runs it, on any box.

## [1.4.0] — 2026-08-12

### Media generation became intelligence instead of a hardcoded name

- **The media file named one image model and called it a rule.** "Every image uses
  `gpt-image-2`; no other model is acceptable" is a pin, and a pin is stale the day the vendor
  ships the next version — the same defect the role tables were corrected for. Image and video
  selection are now stated as **requirement families**: the qualifying member is the newest one
  in the family that documents the variants the work needs, passes this run's smoke test, and
  supports the resolutions the work items actually call for. The successor qualifies **the day
  it exists, with no edit to the file.** Every model id that remains is a dated exhibit, a
  sourced fact, a prohibition, or an item marked undetermined — never doctrine.
- **Version succession is a procedure, not a hope.** Once per run, at media-planning time and
  again before the first batch, the run researches the provider's live catalogue, picks the
  newest member, reads that member's own constraint table rather than this file's, and smoke
  tests it. The smoke test is one cheap generation that proves four things at once: the id
  resolves, the auth works, the account has credit, and what the generation really costs. **An
  exhibit id that still passes a live smoke test is a measurement; an exhibit id recited
  without one is folklore, and is never used.**
- **A detection ladder decides the engine, and its fourth rung is a question rather than a
  dead end.** Kie.ai key present recommends Kie.ai; otherwise an Agnes key makes Agnes the
  engine for images and video; both present sets a recommendation but **the client still
  chooses**, because one bills real money per asset and the other carries a daily allowance,
  and cost-is-consent outranks convenience. Neither present, with media wanted, now **asks** —
  five written branches covering has-a-key, has-an-account, has-neither, declines, and
  re-detect-failed. **There is no "paste your key here" flow on any branch**: the skill asks
  whether a key exists and says where to put it, and the only thing it ever learns is present
  or absent.
- **A failed re-detect accuses the instrument before it accuses the client.** When someone says
  they placed a key and the sweep does not see it, the run names the variables and files it
  checked, runs the sweep's own known-positive control, and offers exactly one concrete next
  step. If the control also fails, the finding is **broken instrument**, said plainly as the
  skill's problem and not the client's. A second failure ends the round trips rather than
  starting a third.
- **Video has a default, two affordable backups, and a permanently excluded engine.** The Veo
  family through Kie.ai is the default — quality lane for finals, economy lane for drafts —
  with the model enum read live rather than hardcoded, because the id survived a version
  upgrade unchanged and pinning either the old or the new string would be wrong. Each backup
  must be in the live catalogue, outside the gated tier, and at or under roughly six cents a
  second. Backup two is **named with its price before first use**, never assumed.
- **The gated tier spends nothing without a specific yes, every single time.** Seedance,
  Seedream and Hailuo are gated **by family, matched prefix-insensitively because ids drift**.
  Each generation requires its own permission: no standing pre-authorization, no blanket batch
  consent, and "yes for all of tonight" authorizes only the items enumerated with their prices
  in that same message. **The gate cannot be routed around by using a cheap variant — the
  family is gated, not the price point.** The ask names **both** numbers, the gated one and the
  default path's, so the answer is informed rather than frightened; a refusal generates on the
  default path or skips, recorded either way and never silently substituted. On an unattended
  run the item parks with a note and the build carries on.
- **The honest note that keeps the gate from lying.** These families are not uniformly
  expensive — at default resolutions one of them is cheaper per second than the default path's
  quality lane. Where the money actually runs away is specific and named: a thirty-second
  billing unit charged for a six-second clip, and long clips at the top resolutions. Quoting
  "premium" as if it meant "always dearer" would be a confident wrong number, so the file says
  what is true instead.
- **Polling is the design, not the fallback.** A run executes on the client's own machine,
  which has no public callback receiver, so the callback parameter is an enhancement used only
  when a run has proved a receiver exists. Both providers get written poll schedules, backoffs
  and per-task timeouts, and a conservative poll budget that is safe if polls bill and
  invisible if they do not. **A timed-out task is never blind-resubmitted**: it is recorded
  failed with its task id, because a task that timed out may still complete and still bill, and
  the cost is reconciled from the provider's own record afterwards. Re-check before any
  resubmit, or pay twice.
- **A missing key no longer costs the client the build.** The proceed-without-media path is a
  real path: everything else is built at full quality, every media slot gets a **declared,
  labelled placeholder** with the right dimensions reserved and alt text written, and the
  **MEDIA-GAPS manifest becomes a required deliverable** — one entry per slot with its
  location, size, the fully-prepared generation prompt, and its estimated cost. The moment a
  key exists the whole media pass is one resumable batch with nothing to work out again. It is
  said **up front**, never discovered at the end. A declared gap is honest scaffolding; a stock
  image passed off as final art is a lie.
- **The overnight case is pre-declared, never asked at three in the morning.** When a run is
  unattended and the build generates media, the existing overnight-policy question grows one
  clause — no new question is spent — recording whether a missing or dying key should produce
  placeholders and a manifest (the default), a skip with a note, or a parked media lane. The
  build never stalls waiting for an answer nobody is awake to give, and **the gated tier stays
  parked regardless of that policy**, because it governs the missing-key case and never spend
  authority.

### The sweep now looks for the media keys, and looks where it says it looks

- **The documentation promised two checks the tool did not perform.** The environment sweep
  claimed the two media keys were checked "in the same stores and with the same controls as
  every other check here", and `tools/env-sweep.sh` contained neither name. Both are now real
  phases with their alias spellings, a status line each, and a network-guarded liveness check
  for the one provider that documents a cheap endpoint. The other is **presence-only, and says
  so** rather than implying a check it cannot make. The selftest plants and asserts **10**
  credentials in a known-positive control and proves all 10 report missing in an empty one.
- **`~/.env` was named as a store and never read — which would have broken the guided
  placement flow at exactly the moment it mattered.** The tool now sources it live at every
  run, first in precedence so the canonical stores keep the last word, and the report line
  names it among the stores searched. **The placement target a client is sent to must be a file
  the checker actually reads**, and a third selftest control proves it: a key placed only in
  the sandbox `~/.env` is detected, while a key placed nowhere still reports missing in the
  same run. Without this, every guided placement on a non-fleet machine would have ended in a
  failed re-detect through no fault of the client's.

### Media is a line item in the ledger, never an invisible cost

- **Three meters, one provider, and they are never added together.** An Agnes image draws the
  images-per-day meter, a clip draws the video-seconds-per-day meter, and neither draws the
  five-hour text request window. Budgeting pictures against the request window mis-classes the
  ceiling, and a mis-classed ceiling is discovered at three in the morning. A language-model
  seat on that provider and the media pipeline on the same provider therefore do not compete
  for the same figure. Kie.ai sits in a different class again — a **prepaid credit balance**,
  the token-balance class, checked before every batch and at wave boundaries, with the figure
  going to the burn table and never to the profile.
- **Every planned batch is written before it dispatches**, with its provider, resolved model,
  mode, item count, cost estimate, the meter it draws, and whether it is gated. Every executed
  generation reconciles actual against estimate from the provider's own task record, and **a
  per-item underestimate of more than a quarter re-estimates the rest of the batch before it
  dispatches, out loud** — a two-hundred-image funnel is a real bill, and the moment to mention
  it is before it is spent.
- **The price instrument is ranked, and the run's own measurement wins.** Measured cost from
  this run's smoke test outranks the model's documentation page, which outranks the pricing
  page, which outranks third-party comparisons — and a third-party figure is **never the sole
  support for a spend question** when a measurement is obtainable. A promotional price is a
  price with an expiry nobody announces, so it is re-read every run.
- **A quota refusal that contradicts the claimed allowance corrects the claim, not the
  arithmetic.** A payment-required error arriving while the run's own day-count is still well
  under the documented cap means the claim is wrong — a promotion ended, the plan differs, or
  the account is shared. The run downgrades to measured reality and queues a plain note. **A
  tripwire only ever shrinks a claim, never grows one.**

### One new remembered fact, and three that may never be remembered

- **`MEDIA_PROVIDER_PREF` is the only media fact the capacity profile may store** — which of
  the two providers the client preferred last time, offered back as a default question and
  never silently applied. The allowlist a tool enforces does not grow by implication, so this
  is a real, single-key change to `tools/capacity-profile.sh` with its own round-trip test.
- **Three media facts are refused mechanically, each for a different reason, and the selftest
  proves all three.** A media key name is refused by the deny-list; key *presence* is refused
  because it is measured every run and a remembered presence is a confident wrong branch; and
  **any gated-tier pre-authorization is refused because a stored standing yes-to-spend must be
  impossible rather than merely discouraged.** The suite now runs **23 passed / 0 failed**.

### The corrections of record

- **The daily video allowance is 500 seconds, not 800.** The larger figure was an unverified
  note; the provider's own token-plan documentation is the source, and it is dated. A per-day
  quota is not a per-minute rate — they are different axes and both bind.
- **The provider's live tier names are Starter, Plus and Pro, and they carry weekly caps as
  well as the five-hour window.** The older free / forty-dollar / hundred-dollar mapping is
  remembered *plan membership* rather than doctrine, and a third and larger tier exists that
  the earlier tables never mentioned. The operator's rows stand unchanged as the fallback when
  live research fails, now explicitly scoped to the text window only.
- **"About one image a minute" is not a documented rate.** No provider publishes one. It is a
  planning assumption, it is marked as one, and it is **replaced by measurement** — time the
  run's own first three generations and re-plan the batch from the wall clock. Whether the
  documented daily image allowance extends to a free account is stated as undetermined rather
  than assumed, along with eleven other open questions, each with the exact test that would
  settle it.

### S14 — the media spend gate joins the swarm watch

- **A rule that is only described is not a rule.** The five-minute watch loop gained a
  fourteenth standard: every gated-family generation must have a matching consent line written
  **before** its dispatch, and every media batch must have a ledger line carrying a cost
  estimate. A gated dispatch without consent is a defect of the highest class — the media lane
  stops and the violation is reported; an unestimated batch dispatches only after its estimate
  is written. The watch's own citations were widened from thirteen checks to fourteen wherever
  they appear, including the tick list that enumerates each check by name, so the new standard
  is actually run rather than merely written down.

### Verification and scope

- **Every tool ships proven.** `anchor.sh` 13/13, `capacity-resolver.sh` PASS, `env-sweep.sh`
  6/6, `capacity-profile.sh` 23 passed / 0 failed, all run with `HOME` overridden to a sandbox.
- **Deliberately unchanged.** `tools/ledger.sh` is byte-identical. The document list, the nine
  refused artifacts, the quality gate, the fifty-law table, the three capacity axes and every
  concurrency ceiling are untouched — the ceiling set was extracted, diffed and re-proved with
  a planted control. No history was rewritten: nothing was force-pushed, rebased or reset.

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

## Background: why these rules exist

History moved out of `SKILL.md` when it was cut to its rules (the "this was the defect on date X"
narratives). Each paragraph names the rule it explains; the rule itself stays in `SKILL.md`.

- **The turn-yield rule** (a question ends the message and the turn) was missing while three
  separate runs "asked" a dozen things and the client was never once handed the turn.
- **The conversation Stop hook** exists because seven releases wrote the conversation rules in
  prose and each one produced a new defect on the next run; the only rule that ever held was the
  one in a script.
- **The GATE 0 claim hook** exists because three releases of prose did not stop a refusal spoken
  from an unrun check. Telling a client to switch on something they already have was the single
  most common way this skill failed.
- **The naming rule** ("call it by its name"): a run told someone who wrote "Studio Nerds" across
  thirty-three documents that it would call it "your computer program" — which read as though it
  had read none of them.
- **The targets precedence rule**: a run guessed `MOBILE_APP` from the word "app" while the
  profile beside it said `desktop-macos-arm64` (the 2026-09-21 10:30 failure).
- **The never-deleted idea question**: a run said "You already told me the idea, so I won't ask
  you to say it twice" and followed it with statements — the client was never handed the turn.
- **The stall rule** (a turn ends ON a question): "Wonderful — that's exactly what I'll build for
  you. From here on I'll call it Studio Nerds." followed by silence left the entry-mode question
  unasked (the 2026-09-21 10:34 failure).
- **Entry mode is always asked**: a run said "you've already pointed me at notes in this folder",
  answering the question on the client's behalf because the session started inside the folder.
- **Read before confirming**: runs confirmed from a guess while the answer sat unread in a
  supplied file, then asked again after reading it — the same defect twice.
