# BUILD REPORT — PD-036 (999 host profile)

- **Unit:** PD-036 — 999 host profile
- **Lane:** FL13 · **Repository:** `trevorotts1/999-setup`
- **Branch:** `pd/fl13-999-version`
- **Build commit:** `b0e53ae68a277496df57bef3d4071f2722334ac7`
- **Prerequisite commit on the same branch:** `462e9786` (PD-035's 999 side, the vendored tree)
- **Merge base:** `91883d8cd079074d7cc49f7e07424a4593a130fd` (`origin/main`)
- **Worktree:** the lane clone (clean; scratch is outside the repository)
- **Status:** BUILT — the change is pushed. Acceptance row A1 is for QC; this report does not claim a PASS.

## Spec quoted (the text implemented)

From `### PD-036 — 999 host profile`, `01-BUILD-SPEC.md`:

> **Read first — consolidation amendments (binding; they override the carried-over text below wherever the two differ):**
>
> Passes 4 and 5 showed a missing operator Cloudflare credential is a warning, not a stop
> (`build_deck.publish_teleprompter`, lines 12932-13095). Read that function first. If it still holds,
> record no waiver: the 999 profile simply delivers the teleprompter as a local file and says no web
> link was made.

> - **Files owned (999 only):** `.claude/skills/signature-presentation/SKILL.md` (the 999 front door), `.claude/skills/signature-presentation/host/999_paths.py`, `.claude/skills/signature-presentation/bin/presentation-999`.
> - **Teleprompter (second pass):** the department's final gate requires the teleprompter to be published with an operator-owned Cloudflare credential (finding PD-043). A 999 machine has none. The 999 profile must record a standing waiver for the publish step and deliver the teleprompter as a local file; read `presentation_job/waivers.py` and `gates.py` to find the waiver key, and if the publish step cannot be waived report `BLOCKED: teleprompter publish cannot be waived` before building anything else.
> - **What it does:** the wrapper sets the department root to the vendored tree (so `bin/presentation`'s exit-61 materialization check is satisfied by pointing `OPENCLAW_WORKSPACE`-style resolution at `host/999_paths.py`); run folders live under the user's chosen project folder; the notify transport is the file queue (`working/outbox.jsonl`), which the Claude Code session reads and shows to the user; the Command Center board mirror is off unless a board address is configured; the image key is read by name from the user's own `API docs.md` (never printed); delivery destination is the run folder plus the user's Downloads folder. The interview is conducted in the Claude Code chat through the same driver, with the session's own user message id as the owner message id.
> - **Acceptance:** on a clean test account with no OpenClaw folder: the wrapper's `--plan` exits 0; the driver interview runs to `--complete`; the dependency gate reports exactly the missing tools by name.

### Teleprompter amendment — read first, no waiver recorded

I read `build_deck.publish_teleprompter` and `_check_teleprompter_published` in the vendored
`scripts/build_deck.py` (lines 12932-13120 of the department source), then `presentation_job/waivers.py`
(162 lines, read whole) and `presentation_job/gates.py` (285 lines, read whole).

The amendment still holds: when `CLOUDFLARE_ZHW_APPS_API_TOKEN` / `CLOUDFLARE_ZHW_ACCOUNT_ID` are
absent, `publish_teleprompter` writes `status: "warned_no_credentials"`, records
`AF-TELEPROMPTER-UNPUBLISHED` in `process_manifest.json.warnings`, prints a WARNING, and **returns**
instead of raising. `_check_teleprompter_published` then returns its reason with `warn_only=True`.
So **no waiver is recorded**: `GATE_KEYS = ("script","teleprompter","prompt_floor","ghl_upload","qc")`
and `teleprompter` is waivable, but nothing needs waiving. The 999 profile documents the local-file
delivery and "no web link was made" in `SKILL.md`; it does not claim a public URL.

## Files changed

Commit `b0e53ae6` (`PD-036: add the 999 host profile front door`), 6 files, +691/−3:

| File | Change |
|---|---|
| `.claude/skills/signature-presentation/bin/presentation-999` | new, mode 100755: `--plan`, `--deps`, `--interview`, `--build`; owner-id persistence; file-queue notify; workspace shim; passthrough to the vendored driver/door |
| `.claude/skills/signature-presentation/host/999_paths.py` | new: department root, project/run folders, workspace + OpenClaw-root shim, API-docs key by name, dependency report, plan, child environment |
| `.claude/skills/signature-presentation/host/test_999_paths.py` | new: 7 stdlib self-check tests, no live action |
| `.claude/skills/signature-presentation/SKILL.md` | +56/−3: the 999 host profile section and the front-door description |
| `CONTROL/bundled-skills.txt` | +1: `signature-presentation` |
| `CONTROL/bundled-components.json` | +1 component entry `signature-presentation` (v2.1.9, repo-tree); registry count 21→22 |

Commit `462e9786` (`PD-035: vendor the Presentations department into 999`) is the prerequisite, not
PD-036 code: 564 byte-copied files produced by onboarding's
`scripts/sync_presentations_to_999.py` from source commit `b624f61aa0e35af2dd89bc924108322885af5125`.
`VENDORED.md` records the 564-file count and tree digest
`sha256:d879c7c184a5eeed359d4103d85efbbf33557174fea56d5eb613587736a08d1a`.

## Acceptance row A1 — proven

### A1.1 — `--plan` exits 0 on a clean test account with no OpenClaw folder

`evidence/PD-036/row-A1-plan.txt` — fresh empty `HOME`, `env -i`, project folder outside the
repository:

```
$ presentation-999 --plan --project-dir <PROJECT>
{
  "profile": "999",
  "skill_root": "<WORKTREE>/.claude/skills/signature-presentation",
  "vendored": {"present": true, "files": 564,
               "tree_digest": "d879c7c184a5eeed359d4103d85efbbf33557174fea56d5eb613587736a08d1a",
               "source_commit": "b624f61aa0e35af2dd89bc924108322885af5125"},
  "dept_scripts": "<WORKTREE>/.claude/skills/signature-presentation/scripts",
  "project_dir": "<SCRATCH>/proj.final.OnHqwB",
  "run_dir": "<PROJECT>/presentation-runs/<stamp>",
  "workspace": "<PROJECT>/.presentation-999/workspace",
  "openclaw_root": "<PROJECT>/.presentation-999/.openclaw",
  "notify": {"transport": "file-queue", "outbox": "<RUN_DIR>/working/outbox.jsonl", ...},
  "command_center": {"board_mirror": "off", "configured_by": null, "host": null},
  "image_key": {"name": null, "present": false, "length": 0, "source": null},
  "delivery": {"run_dir": "<RUN_DIR>/delivery", "downloads": "<HOME>/Downloads"},
  "dependencies": {"missing": ["python:reportlab+pptx","python:pypdf","python:pytesseract"], ...}
}
rc=0
```

Holds at `b0e53ae6`. The plan is read-only (no workspace/run folder is created); it reports missing
dependencies but still exits 0, which is the row's contract.

### A1.2 — the driver interview runs to `--complete`

`evidence/PD-036/row-A1-interview.txt` — same empty `HOME`, no `~/.openclaw` ever created:

```
0 presentation_type -> from_scratch
1 pitch_included -> no
...
46 motion_graphics_declined_reason -> yes
47 NEXT COMPLETE at turn 48
COMPLETE rc 0
{
  "status": "complete",
  "deck_type": "webinar",
  "creation_mode": "from_scratch",
  "presentation_type": "from_scratch",
  "intake_path": "<RUN_DIR>/working/copy/intake.json",
  "intake_transcript_signed": true
}
```

The driver is the vendored `scripts/deck-intake-driver.py` (the same driver, no fork). The wrapper's
`--owner-msg-id` was supplied on the first turn only; the run recorded it in
`working/checkpoints/999-owner.json`, and later `--answer` / `--complete` calls without the flag
still produced:

```
requester {'chat_id': 'msg-abc123', 'client_name': 'operator', 'channel': 'claude-code'}
HOME_OPENCLAW=NO
```

Holds at `b0e53ae6`.

### A1.3 — the dependency gate reports exactly the missing tools by name

`evidence/PD-036/row-A1-deps.txt`:

- Normal PATH: `missing: []`, `required_missing: []`, rc=0 (this shell has the Python packages).
- Minimal PATH (`/usr/bin:/bin`), rc=1:

```
"missing": ["soffice","pdftoppm","python:reportlab+pptx","python:pypdf",
            "ffmpeg","ffprobe","tesseract","python:pytesseract"]
"required_missing": ["soffice","pdftoppm","python:reportlab+pptx",
                     "python:pypdf","tesseract","python:pytesseract"]
```

The names are the `presentation-deps.json` canon's own `name` strings; nothing is invented. The
mutation section proves the checker discriminates: two probe deps appended to a scratch copy —
`probe-python3-present` (binary `python3`) lands in `present`, `probe-fake-tool-missing` lands in
`missing`/`required_missing`, never in `present`; after restoring the canon, no probe name remains.
Holds at `b0e53ae6`.

## Failure proof (the rows can fail)

`evidence/PD-036/row-A1-base-absence.txt` — the artifact is absent before the unit:

```
$ git cat-file -e 91883d8c:.claude/skills/signature-presentation/bin/presentation-999
fatal: path ... exists on disk, but not in '91883d8c'
rc=128
$ git cat-file -e 462e9786:.claude/skills/signature-presentation/bin/presentation-999
fatal: ... not in '462e9786'
rc=128
$ <BASE_CHECKOUT>/.claude/skills/signature-presentation/bin/presentation-999 --plan
... no such file or directory
rc=127
```

`evidence/PD-036/mutation-wrapper.txt` — mutation of the built artifact, then reverted:

```
mut_baseline_rc=0
after_removing_host_module_rc=1
ModuleNotFoundError: No module named '999_paths'
after_restore_rc=0
```

The mutation was made in a scratch copy of the skill tree; the worktree was not mutated. The
dependency-gate mutation is in `row-A1-deps.txt` and was likewise reverted in the copy.

## Tests by id — base and head

There is no numbered test suite in `trevorotts1/999-setup` for this skill. The unit contributes one
stdlib self-check, `host/test_999_paths.py`; its ids and results:

| Test id | Base `91883d8c` | Head `b0e53ae6` |
|---|---|---|
| `HostProfileTests.test_plan_contract_and_run_dir_under_project` | file absent | pass |
| `HostProfileTests.test_image_key_read_by_name_never_in_plan` | file absent | pass |
| `HostProfileTests.test_dependency_gate_names_missing_tool` | file absent | pass |
| `HostProfileTests.test_workspace_link_satisfies_exit_61_paths` | file absent | pass |
| `HostProfileTests.test_env_sets_file_queue_and_owner_identity` | file absent | pass |
| `HostProfileTests.test_owner_persists_across_turns` | file absent | pass |
| `HostProfileTests.test_env_uses_api_docs_key_without_printing` | file absent | pass |

Base proof: `git cat-file -e 91883d8c:.claude/skills/signature-presentation/host/test_999_paths.py`
→ rc=128 (the tree does not exist at base). Head: `Ran 7 tests ... OK`, rc=0
(`evidence/PD-036/self-check.txt`). The test is stdlib only, stubs no transport because it performs
no transport: no network, no model call, no server, no browser.

## Hunk attribution — merge-base `91883d8c` to HEAD

| Commit | Hunks | Owner |
|---|---|---|
| `462e9786` | 564 new files under `.claude/skills/signature-presentation/` + `VENDORED.md` | **PD-035** (sibling unit; its onboarding tool at `b624f61aa`). PD-035's own report pushed only the onboarding script; the 999 side was not yet on this branch, so this unit materialized it with PD-035's unmodified tool. |
| `b0e53ae6` | 6 files: `bin/presentation-999`, `host/999_paths.py`, `host/test_999_paths.py`, `SKILL.md`, `CONTROL/bundled-skills.txt`, `CONTROL/bundled-components.json` | **PD-036** (this unit) |

No other unit's hunk is on the branch. No merge, rebase or force-push.

## Remote-head proof

Push and the 40-character head:

```
$ git push -u origin pd/fl13-999-version
 * [new branch]        pd/fl13-999-version -> pd/fl13-999-version
$ git ls-remote --heads origin refs/heads/pd/fl13-999-version
b0e53ae68a277496df57bef3d4071f2722334ac7	refs/heads/pd/fl13-999-version
```

This report is committed after that push; the branch head then advances to the report commit. Its
exact 40-character value is returned with this report by the builder (`git ls-remote` after the
report push).

## Unproved / known gaps (stated plainly)

1. **`--build` was not executed.** The build path hands off to the vendored
   `bin/presentation` → `presentation-canonical-entry.sh`; a real run renders paid images and is
   barred by the unit's "no live action" rule. The workspace shim is proven structurally instead:
   `host/test_999_paths.py::test_workspace_link_satisfies_exit_61_paths` asserts that
   `<workspace>/departments/Presentations/scripts` resolves to
   `build_deck.py`, `run_signature_deck.py`, and `presentation-canonical-entry.sh`, which is exactly
   what the vendored `bin/presentation` exit-61 check opens. The dependent gate (deps) is proven.
2. **`sync_presentations_to_999.py --check` now exits 1 with `CHANGED SKILL.md`.** This is a
   deliberate consequence of PD-036's owned front door: PD-035's plan copies S51's `SKILL.md` as a
   vendored file, while PD-036 owns that same path as the 999 front door. PD-035's own docstring
   says 999-only front-door files "are not part of the vendor set", but its `walk(s51)` includes
   `SKILL.md`, so the two units contradict. Evidence: `evidence/PD-036/sync-check-after.txt`
   (`CHANGED SKILL.md`; digest `2ce6f64a…` vs recorded `d879c7c1…`). The fix belongs to PD-035 (or
   a follow-up) — exclude `SKILL.md` from the vendor plan or move the 999 front door to a name the
   plan does not claim. PD-036 must not edit the onboarding unit's file.
3. **Windows symlink support not tested.** The workspace shim uses a directory symlink. macOS/Linux
   are proven; on a Windows box without symlink privilege the wrapper refuses with a clear error and
   starts no build.
4. **The vendored tree's own test suite was not run.** Spec rule 9/12: a builder does not run test
   suites; QC runs them.
5. **`own`: the dependency probe's Python-import check runs under the wrapper's interpreter.** It is
   the same interpreter the driver runs under; a different pipeline pin is not measured here.
