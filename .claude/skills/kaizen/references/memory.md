# Kaizen Memory — canonical storage, structure, safety

## Canonical root rule

Do NOT use a `.kaizen/` folder inside the target project as the canonical
memory root. The canonical memory lives in the user's **Downloads area** using
the OpenClaw Master Files convention.

## Resolve the real Downloads folder

macOS (preferred, then fallback):

```bash
osascript -e 'POSIX path of (path to downloads folder)'
# trim the trailing slash
# fallback: $HOME/Downloads
```

If macOS privacy controls (TCC) block access, do not bypass them. Explain
exactly what access is needed.

Windows: resolve the real Downloads folder (e.g. via
`[Environment]::GetFolderPath('UserProfile')` + Downloads, honoring any
redirection), then follow the same logical folder policy. Mac is the primary
acceptance target; never regress Windows.

## Find OpenClaw Master Files

- Search INSIDE Downloads only, bounded depth (e.g. 3 levels).
- Treat case variations as the same name.
- A reasonable normalized match: a directory whose name corresponds to
  "OpenClaw Master Files". Avoid a folder merely because it contains the word
  "openclaw" if it is clearly unrelated.

Decision rule:

- Exactly one suitable folder found → `<that-folder>/Kaizen`.
- No suitable folder found → `<Downloads>/Kaizen`.
- More than one suitable folder found → do not guess → `<Downloads>/Kaizen`.

Create the Kaizen folder if missing. Use
`scripts/macos/resolve-kaizen-root.sh` on macOS or
`scripts/windows/Resolve-KaizenRoot.ps1` on Windows, so this rule is
deterministic, not re-derived by the model each time.

## Multiple Loops

```text
Downloads/
└── OpenClaw Master Files/
    └── Kaizen/
        ├── INDEX.md
        ├── REGISTRY.json
        ├── .gitignore
        ├── My Website/
        ├── Customer Portal/
        └── Sales Funnel/
```

Fallback shape when no/ambiguous OpenClaw Master Files:

```text
Downloads/
└── Kaizen/
    ├── INDEX.md
    ├── REGISTRY.json
    └── <Loop folders>/
```

Use a filesystem-safe friendly name and a stable UUID Loop ID in state. Do
not silently reuse a folder for a different target just because the name is
similar — check `REGISTRY.json` before claiming a folder.

## Per-Loop files

```text
<Loop folder>/
├── KAIZEN_CONTRACT.md
├── KAIZEN_MEMORY.md
├── STATE.json
├── LOCAL_STATE.json      (never committed)
├── RESUME.md
├── BACKLOG.md
├── DECISIONS.md
├── cycles/2026-08-20-cycle-001.md
└── evidence/manifest.json
```

- `INDEX.md` — human list: friendly name, target, status
  (active/paused/stopped), interval, last run, next expected run, path.
- `REGISTRY.json` — machine registry, minimum schema per
  `templates/STATE.template.json` (schema_version, loops[] with loop_id,
  name, memory_dir, status, target_type, target_remote, target_url,
  last_cycle_id). No secrets.
- `KAIZEN_CONTRACT.md` — the approved Contract.
- `KAIZEN_MEMORY.md` — friendly running history a human can open and
  understand. Sections: What this Kaizen is for / What I am allowed to do /
  Last check / Improvements kept / Improvements rejected or reverted /
  Important things still waiting / Things the owner said "no" to / Lessons
  learned / Next time / How to resume. Periodically compact old detail into a
  summary while preserving individual cycle files.
- `STATE.json` — portable machine-readable state (committable). See template.
- `LOCAL_STATE.json` — machine-specific state: absolute local target path,
  exact local Kaizen root path, local scheduler plist/task identifier, local
  session ID if available, local worktree path, local test artifact paths.
  Never credential values. In `.gitignore`.
- `RESUME.md` — human recovery instructions for THIS Loop: what to type after
  a restart, whether the schedule restarts automatically, whether the machine
  must be on, whether the original session needs resuming, how to run one
  cycle manually, where Memory lives, how to see status. Use the actual
  launcher detected.
- `BACKLOG.md` — important candidates not selected. Per item: stable ID,
  title, why it matters, discovered cycle, priority, status, reason deferred,
  last reconsidered date. Prevents rediscovery churn.
- `DECISIONS.md` — user and agent decisions that should not be forgotten,
  e.g. "Owner rejected redesigning the homepage hero on 2026-08-20.",
  "Keep current brand colors."
- `cycles/<cycle>.md` — technical record per cycle (see
  `templates/CYCLE.template.md`).
- `evidence/manifest.json` — proof metadata: test command, exit code,
  timestamp, screenshot filename if retained, metric before/after, commit
  hash, URL checked. Raw screenshots/videos/logs excluded from Git by
  default unless known safe and useful.

## Write safety

1. Write temp file in the same directory.
2. Validate JSON (use `scripts/common/validate-kaizen-memory.mjs`).
3. Rename atomically.
4. Keep a `.bak` of prior state.

Never corrupt Memory if interrupted mid-write. Use the shared state helper
`scripts/common/kaizen-state.mjs` for all structured state changes — it
implements temp+validate+rename+bak.

## Cycle lock (concurrency / duplicate-run protection)

Before each cycle, detect whether another cycle is already active for this
Loop. The lock file is `<Loop folder>/.cycle-lock.json` with: Loop ID, start
timestamp, process/session info when available, stale policy.

- Previous cycle still running → skip the new cycle, record "skipped because
  prior cycle still active", do not start another branch. Tell the user only
  if relevant.
- Lock stale past the maximum (default 6 hours) → inspect before clearing,
  record the recovery action.
- `kaizen-state.mjs lock|unlock|is-locked` implements this. Keep a single
  writer.

## Secret rules (hard)

Never store or commit: API keys, `.env`, router tokens, OAuth tokens, cookies,
passwords, SSH private keys, browser profiles, Stripe live keys, customer
PII, raw databases, unnecessary local absolute paths, `LOCAL_STATE.json`.
Sanitize URLs that contain secret query strings. `.gitignore` baseline is in
`templates/` and the Kaizen root; filename-based ignoring alone is NOT
enough — inspect content before every commit. Run
`scripts/common/validate-kaizen-memory.mjs --scan-secrets` before any Memory
Git commit.

## GitHub backup

Prefer ONE private GitHub repo per user (`kaizen-memory`) with subfolders per
Loop. Before creating a repo, inspect: is the Kaizen root already inside a
Git repo? Is it private? Does it look like the intended backup? Is `gh`
installed and authenticated? Does `kaizen-memory` already exist? Never create
a nested Git repo blindly. Creating a remote repo is an external account
action — ask once during setup:

> "Would you like me to back up your Kaizen Memory to a private GitHub repo?
> I recommend yes so you can recover it on another computer."

- Never make it public by default.
- Commit the portable Memory files; push after each completed cycle when
  network is available.
- Push failure: do not fail the cycle; record `backup_pending` in STATE;
  retry next cycle; tell the user simply.
- Commit pattern: `kaizen: My Website cycle 007`.
- Never auto-force-push; use pull/rebase or another safe reconciliation.
- `LOCAL_STATE.json` never committed.

## Update compatibility

Skill updates never overwrite user Memory. Templates may update; user
instances remain intact. If a Memory schema changes: bump schema version,
migrate conservatively, back up prior state, never discard unknown fields
silently, validate after migration, keep old cycle records.
