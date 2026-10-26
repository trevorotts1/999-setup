# T-44-WIRE — wire `tools/cohort_integration.py` (lane PBB-665)

Unit **T-44** · lane **PBB-665** · role BUILD · repo `trevorotts1/999-setup`
Branch `pb/PBB-665/t-44-wire` · base/measured `origin/main` = `e8dc28ee86045ebc65da4b0dac8f4e149e1c2009`
Commit 1 (call site) `c7d0bcc49` · commit 2 (CI step) `be3bbacfc`

Verdict: **BUILT-WIRED (evidence only, NOT self-approved)** — the wiring is real and measured; the
acceptance verdict belongs to an independent QC lane (`opus-chain`, per `checks.json` C-44).

---

## 0. Instrument proof — both polarities, one shell, one run

Counter: `scratch/lanes/PBB-665/refcount.py <tree> <term> [--self PATH]… [--mode token|path]`.
Whole-token regex `(?<![A-Za-z0-9_])TERM(?![A-Za-z0-9_])`; every matching LINE is classified
`self / test / evidence / changelog / production`. No grep, no helpers, no background shells.

| probe | command | expected | result | rc |
|---|---|---|---|---|
| **EXPECTED-PASS** known-wired module | `refcount.py before-ob required_context_behaviors --self scripts/ci/required_context_behaviors.py` | non-zero | **1 production hit / 1 file** — `.github/workflows/qc-static.yml:80` (13,506 files scanned) | 0 |
| **EXPECTED-PASS** ancestry | `git -C openclaw-onboarding merge-base --is-ancestor 76700ba3648f58472ca9c2111dce717a1cf2c5b7 origin/main` | ancestor | ancestor | **0** |
| control for ancestry | same repo, `origin/main` vs `origin/main` | ancestor | ancestor | **0** |
| **EXPECTED-FAIL** absent term | `refcount.py before-999 zzz_no_such_module_pbb665` | zero | **0 hits / 0 files** (4,344 files scanned) | 0 |
| **EXPECTED-FAIL** unrelated sha | `merge-base --is-ancestor dc5c25aa… origin/main` | non-ancestor | non-ancestor (object exists) | **1** |
| cross-repo sha (fact, not a check) | same sha inside the 999-setup repo | abort | `fatal: Not a valid commit name` | **128** |

The 128 is an **instrument abort, not a fact**: `76700ba3…` is an openclaw-onboarding commit and does
not exist in 999-setup. No other 127/128 was observed. The expected-PASS control is non-zero, so a zero
from this counter is a reading, not a broken probe.

**Collision control (bare stem that is not an import).** Synthetic host file containing
`cohort_integrations_extra = 1` and `my_cohort_integration_helper = 2`:

```
refcount.py collide cohort_integration            -> NON_SELF_PRODUCTION_HITS=0  NON_SELF_PRODUCTION_FILES=0
refcount.py collide cohort_integration --mode path -> NON_SELF_PRODUCTION_HITS=2  NON_SELF_PRODUCTION_FILES=1
```

Whole-token counting ignores both, substring counting sees both. The discrimination is real, not dead.

Log: `instrument.out` (`P1..P6`), `refcount.py`, `probe.py`.

## 1. The deliverable — established from the ledgers, not assumed from the unit id

```
/Users/blackceomacmini/loop-control/Purple-Billboard-Client-System-Build/ledger.json
  (the project ledger at the loop-control ROOT — NOT under this build tree, whose control/ has no ledger.json.
   units[] entry for T-44 = lines 1256-1283; every value below is that line, opened and read)
  :1281   title   "Continuously integrate compatible 999 cohorts and named repairs"
  :1278   repo    /Users/blackceomacmini/999-setup        :1279 repo_slug  trevorotts1/999-setup
  :1280   status  merged      (the merge status. :1272 phase now reads REPAIR — set by the QC FAIL that returned this report)
  :1273   pr      320
  :1265   merge_commit 0e00cbc718bd8caf96cbf01234781ae3518d7b52
  :1263   head    28117a6ddecdcfb68bfcfbdb6f87655b07d90173   (the lane branch head)
  :1267   merge_proof carries the PRE-REPAIR unit head 1d8ea756182a5a2b37ada681a3c5ff163464cd37
  :1262   digest  db83f09e243368c18fd041cdcd73ce13d48ab7d6a92228c25a3e70dd6cdd60fb  (landing digest; see §1.1)
  :1271   owned_paths  []      <- EMPTY

live-ledgers/build.json (tasks[], T-44):
  workflow_id W-14   repo_alias "999"   artifact "999-remote-merge-receipts"
  check_ids   ["C-44","C-F15","C-F20"]   requirement_ids ["R-30","R-36"]
  acceptance  "Single shared target owner; compatible 999 cohorts and explicit distribution/hash order;
               required checks and named repair remote content proof."
  owned_paths: absent (empty in ledger.json)
```

`owned_paths` is empty in **both** files, so the module could not be read off the ledger. It was
identified from the artifact string plus the repo tree, and the module names itself:

```
tools/cohort_integration.py:2  """Cohort integration gate for the 999-setup repository (PBB-125 / T-44).
tools/tests/test_cohort_integration.py                                    (suite)
.github/workflows/cohort-integration-tests.yml                            (existing suite workflow)
```

### 1.1 Citation repair — the ledger path, and what the digest tracks

The earlier version of this section headed the block `control/ledger.json`. **No such file exists**:
this build tree's `control/` holds 24 entries and none is `ledger.json`; `control/ledger.json`,
`ledger.json` (build tree) and `state/ledger.json` are all absent. The data was right, the path was
not. The ledger is the project ledger at the **loop-control root**:
`/Users/blackceomacmini/loop-control/Purple-Billboard-Client-System-Build/ledger.json`, T-44 at
**lines 1256–1283**, per-line citations above.

Two values moved since the landed read, and both are stated rather than smoothed:

- **`phase`** — the row now reads `"phase": "REPAIR"` (`:1272`), not `MERGED`. It advanced to REPAIR
  because of the QC FAIL on this very report. The merge status is carried by `"status": "merged"`
  (`:1280`), and that is the field the earlier text meant by "phase MERGED".
- **`head`** — the row's `head` is `28117a6dd` (`:1263`), the lane branch head. `1d8ea7561` appears
  only inside `merge_proof` (`:1267`) as the **pre-repair** unit head that PR #320 merged.

**The digest is a landing key, not a branch-head key.** `ledger.json:1262` records
`db83f09e…`, and the same value is the T-44 `digest` in `LEDGER-BINDINGS.json:267`
(`base 317bb2417` / `head 1d8ea7561` / `merge_sha 0e00cbc71`) and `LANDING-KEYS.md:58`
(`patch_id cb06b6b58`). It is computed from the **already-merged landing**, so a documentation
commit on this lane branch does **not** void it and it is **not** recomputable from the branch.
What moves on a commit is the receipt's `head`/`digest` fields, which this lane sets to the branch
head, and the report's own sha256. Both are restated in the receipt, not guessed.

## 2. Re-verified UNWIRED at `origin/main` `e8dc28ee8` (not manufactured)

```
refcount.py before-999 cohort_integration --self tools/cohort_integration.py
  production hits=2 files=1 | self 1/1 | test 4/1 | changelog 1/1 | NON_SELF_PRODUCTION_FILES=1
```

**Both "production" hits are excluded as a filename collision, not a call site.** They are the two
`paths:` filter strings of the existing workflow, which are not an import and not an execution:

```
excluded  .github/workflows/cohort-integration-tests.yml:8   - 'tools/cohort_integration.py'   (paths: push filter)
excluded  .github/workflows/cohort-integration-tests.yml:13  - 'tools/cohort_integration.py'   (paths: pull_request filter)
counted   tools/cohort_integration.py              self  (8 lines)
counted   tools/tests/test_cohort_integration.py   test  (import cohort_integration as ci)
counted   CHANGELOG.md                             changelog
```

API-level terms, same tree, same instrument:

```
shared_file_class  production 0 hits / 0 files   (self 2, test 3)
order_digest       production 0 hits / 0 files   (self 5, test 3)
```

Verdict: **BUILT-UNWIRED confirmed** — the gate was reachable by nothing but its own suite and a
path filter. Its public API was called by its own tests only.

## 3. The wiring — a real call site on the installer's own path

**Host: `installer-registration/bundle_adapter.py`** — "the ONE implementation of the bundled-skill
bundle", executed by both installers (`--list-skills`, `--install-plan`, `--write-digests`, `--check`),
and the CI job `helper-pins` runs it on every push/PR. It already owns the ordered install plan and the
content record; T-44's clauses "compatible 999 cohorts" and "explicit distribution/hash order" land on
exactly those two objects.

| what | location |
|---|---|
| delegation helper (the call site's definition) | `installer-registration/bundle_adapter.py:591-604` |
| **the import + call** | `:603` `from cohort_integration import order_digest`, called at `:604` |
| cohort → distribution order builder | `:606-625` (`distribution_order`; returns `(order, None)` while any skill lacks a content digest — an unproven identity is never hashed) |
| recorded receipt | `:715`, `:730-734` (`distribution_order: {basis: CONTROL/bundled-skills.txt, order: [...], order_digest: ...}`) |
| production check (`--check`, real CI path) | `:849-870`, added as check **8**, emitted at `:862` (PASS) / `:866` (FAIL) |
| `--write-digests` readback | `:973` prints `distribution_order=<sha256:…>` |

Behaviour on the real path: the ordered cohort identity `(name, content digest, position)` is handed to
the gate's `order_digest()` — one implementation, not a second hash that can drift. `--write-digests`
records the digest; `--check` fails (rc 1, named FAIL) when the registry order or any skill's content
moved since the record. An absent record is a **SKIP with no counter**, never a pass — the same
discipline as the file's existing hash-parity block.

Diff: **2 files, +90/−1** (plus this report). No VERSION, CHANGELOG, ledger, census, DECISIONS or
`CONTROL/bundle-digests.json` byte was touched.

## 4. Proven to bite (same instrument, controls held constant)

| measure | before (`origin/main` e8dc28ee8) | after (`be3bbacfc`) |
|---|---|---|
| `cohort_integration` production hits / files | 2 / **1** (both = CI `paths:` filters, excluded) | **4 / 2** (+ `bundle_adapter.py:592,603`) |
| `cohort_integration` **import-execution** sites | **0** | **1** (`bundle_adapter.py:603`) |
| `order_digest` production hits / files | **0 / 0** | **6 / 1** (`bundle_adapter.py`) |
| `shared_file_class` production | 0 / 0 | 0 / 0 (unchanged — not wired, not claimed) |
| control `required_context_behaviors` (onboarding) | 1 hit / 1 file | **1 hit / 1 file** (constant) |
| control `zzz_no_such_module_pbb665` | 0 / 0 | **0 / 0** (constant) |

**The check bites (throwaway copy `tmp/pbb665/bite`, no committed artifact changed):**

```
--write-digests  -> wrote CONTROL/bundle-digests.json (15 skill(s)) distribution_order=sha256:8ae8a95c…
--check          -> PASS distribution-order 15 skill(s) … equals the recorded receipt   (passed 5 -> 6)
reorder registry (swap first two entries)
--check          -> rc=1
                    FAIL distribution-order recorded sha256:8ae8a95c… != computed sha256:901de8ef…
                    SUMMARY: 5 passed, 1 failed, 1 undetermined
restore registry
--check          -> PASS … equals the recorded receipt
```

**CI leg — exactly one added step, parsed from YAML, not grepped:**

| measure | before | after |
|---|---|---|
| workflow files naming the suite (of 10) | **1 / 10** (`cohort-integration-tests.yml`) | **2 / 10** |
| file changed | — | `.github/workflows/helper-pin-guard.yml` |
| parsed job | `helper-pins` (job `name:` absent) | same job, unchanged |
| parsed step count | **10** | **11** (exactly +1) |
| added step | — | index **10** zero-based (11th one-based), name `Cohort integration gate suite - the order digest the bundle adapter records (T-44, explicit path)` |
| run line | — | `python3 -I -B tools/tests/test_cohort_integration.py` |
| other workflows' step counts | unchanged | unchanged (all 9 others identical) |

The added step was extracted from the parsed YAML and executed verbatim against the worktree:
`GITHUB_WORKSPACE=<worktree> bash added-step.sh` → **rc 0**, `Ran 76 tests … OK`.

**Deviation, stated plainly.** T-44's repository is `999-setup`, which has **10 workflow files and no
`qc-static.yml`** (`git ls-tree -r --name-only origin/main -- .github/workflows/`). `qc-static.yml` and
`scripts/ci/required_context_behaviors.py` exist only in the onboarding repo, which holds no T-44
artifact. The step therefore went into the 999-setup job that guards installer registration and already
executes this adapter (`helper-pins`), not into a file that does not exist in T-44's repo. Creating a
new workflow file was refused as more than "exactly one added step".

## 5. Inverse control

Throwaway copy `tmp/pbb665/inv` = `origin/main` archive + the two candidate files; both files replaced
by `git show origin/main:<path>`, counted, restored from the lane worktree, sha256 compared.

| state | `cohort_integration` production | import sites | workflow files naming suite | `helper-pins` steps |
|---|---|---|---|---|
| candidate | 4 hits / 2 files | 1 | 2 / 10 | 11 |
| **reverted** | **2 / 1** (both = `paths:` filters) | **0** | **1 / 10** | **10** |
| restored | 4 / 2 | 1 | 2 / 10 | 11 |

Both measures return to the baseline, so they respond to exactly this wiring and nothing else. The
residual 2 hits in the reverted state are the excluded filter strings — the import-execution count is
the one that returns to **zero**.

```
CANDIDATE_SHA 6f75932c2476f809…  bundle_adapter.py     f2eb021a2e027e72…  helper-pin-guard.yml
RESTORED_SHA  6f75932c2476f809…  bundle_adapter.py     f2eb021a2e027e72…  helper-pin-guard.yml
SHA256_MATCH: True
```

## 6. Acceptance — T-44's frozen rows, verbatim

> `live-ledgers/build.json:2403` — `"acceptance": "Single shared target owner; compatible 999 cohorts and explicit distribution/hash order; required checks and named repair remote content proof."`

> `TODO.md:705` — `Integration requirements: not a code-integration unit.`
> `TODO.md:707` — ``Output: `999-remote-merge-receipts`.``
> `TODO.md:709` — `Acceptance: Single shared target owner; compatible 999 cohorts and explicit distribution/hash order; required checks and named repair remote content proof.`
> `TODO.md:711` — `Requirements: R-30, R-36. Checks: C-44, C-F15, C-F20.`

> `live-ledgers/checks.json:936` (C-44 `scope`) — `Single shared target owner; compatible 999 cohorts and explicit distribution/hash order; required checks and named repair remote content proof.`  (`"status": "UNVERIFIED"`, `required_qc_alias: "opus-chain"`)
> `live-ledgers/checks.json:1409` (C-F15 `scope`) — `Supervisor takeover/merge due/repair incorporation`
> `live-ledgers/checks.json:1526` (C-F20 `scope`) — `Batch shared-file/reader-writer compatibility and four cleanup dispositions`

> `ACCEPTANCE-MATRIX.md:67` — `| R-30 | 999 bundle, adaptation, provisioning, updates and hash parity | T-02 T-37 T-39 T-44 T-47 T-49 | C-02 C-37 C-39 C-44 C-47 C-49 |`
> `ACCEPTANCE-MATRIX.md:79` — `| R-36 | Immediate compatible per-repository integration and named repair remote proof | T-43 T-44 T-45 | C-43 C-44 C-45 C-F15 C-F20 |`

> `/Users/blackceomacmini/loop-control/Purple-Billboard-Client-System-Build/CHECKLIST.md:46` — the **loop-control root** checklist, a different file from this build tree's `CHECKLIST.md` (whose `:46` is a `Discoveries:` row and whose only T-44 mentions are `:152` and `:182`). Verbatim, including the unchecked box:
>
> `- [ ] T-44 Continuously integrate compatible 999 cohorts and named repairs qc: - merge: 0e00cbc718bd8caf96cbf01234781ae3518d7b52`
>
> The earlier version of this report quoted the same row as `- [x]`. The row is real and the merge
> sha is right; **the checkbox was misquoted** — the file holds `[ ]`.

| clause | verdict | evidence |
|---|---|---|
| single shared target owner | **PASS (clause logic)** | `tools/cohort_integration.py:344-384` — `owner.missing` / `owner.multiple` / `owner.not_holder` / `owner.generation_mismatch` / `owner.expired_requires_fence`; remote lease read-back `:150-162` (`remote.lease_sha_mismatch`, `remote.lease_ref_invalid`). Suite green (76 tests). |
| compatible 999 cohorts | **PASS (clause logic)** | `tools/cohort_integration.py:436` `cohort.unknown_compatibility_case`, `:488` `cohort.shared_file_collision`, `:502` `cohort.dependency_unordered`, `:506` `cohort.dependency_missing`, `:523` `order.edge_missing`. Suite green. |
| explicit distribution + hash order | **PASS (clause logic) and now REACHABLE IN PRODUCTION** | gate `:279 order_digest`, `:459 order.duplicate`, `:527 hash.parity_whole_tree`, `:537 order.digest_mismatch`, `:543 order.hash_order_mismatch`; **production call site** `installer-registration/bundle_adapter.py:603` → `:625`, recorded `:730-734`, checked `:849-870`; bites proven in §4. |
| required checks | **PENDING (needs a live remote run)** | `tools/cohort_integration.py:549-591` (`checks.surface_unproven`, `checks.missing`, `checks.not_success`, `checks.head_stale`) is code-proven, but proving a real head's check surface needs GET-only `gh api` reads against a live target/lease ref. No credentialed remote run was authorized or performed in this lane. |
| named repair remote content proof | **PENDING (needs a live remote run)** | `:251-271` (`remote.repair_sha_mismatch`, `remote.repair_content_mismatch`, `:271 remote.repair_not_contained`), `:672 repair.content_mismatch`, `:677 repair.not_contained`. Same reason: remote tree/containment read-back, not run here. |
| C-44 as a check | **PENDING (independent QC + live remote)** | `checks.json:936` `"status": "UNVERIFIED"`, `required_qc_alias: "opus-chain"`, `different_native_agent_after_repair: true`. Wiring evidence is supplied here; the check is not self-approved. |
| C-F15 supervisor takeover / merge due / repair incorporation | **PENDING (fixture F-15 not run)** | `checks.json:1409`; F-15 is a takeover/merge-due trace over the loop, outside this lane's ownership. |
| C-F20 batch shared-file/reader-writer compatibility + four cleanup dispositions | **PENDING (fixture F-20 not run)** | `checks.json:1526`; cleanup dispositions belong to T-46/T-47. |
| R-30 999 bundle/adaptation/provisioning/updates/hash parity | **PASS (hash-order half) / PENDING (install half)** | `bundle_adapter.py --check` rc 2 **both before and after** wiring, for a **pre-existing** reason (`UNDETERMINED update-stamp drama-studio (no VERSION …)`); the summary line is identical (`5 passed, 0 failed, 1 undetermined, 0 manifest drift`), so the wiring changed no other verdict. In the committed repo the new check states `SKIP … no recorded order digest` (no counter); in the throwaway copy where `--write-digests` had run it states `PASS`, taking passed 5 → 6. Install/update halves were not exercised on a real host. |
| R-36 per-repository integration + named repair remote proof | **PENDING (needs the remote run)** | Same remote reason as the "named repair" clause. |
| note: unit is declared "not a code-integration unit" (`TODO.md:705`) | **recorded verbatim** | The wiring adds no new integration authority: the gate stays read-only (no write/merge/push path in `GhRemote`), and the adapter only records and re-checks an order receipt. |

Suites run (targeted, GREEN):
`python3 -I -B tools/tests/test_cohort_integration.py` → `Ran 76 tests … OK`
`python3 -I -B installer-registration/test_bundle_adapter.py` → `Ran 31 tests … OK`
`python3 -I -B installer-registration/bundle_adapter.py --check` → 6 passed / 0 failed / 1 undetermined (= baseline rc 2, unchanged)

## 7. Staleness — true ahead/behind

```
measured against : e8dc28ee86045ebc65da4b0dac8f4e149e1c2009   (999-setup origin/main, re-fetched
                                                                after the report was pushed)
branch commits   : c7d0bcc49  wiring (call site)
                   be3bbacfc  CI step (helper-pin-guard, +1 step)
                   e6af6f998  this report
                   <tip>      this staleness readback
rev-list --left-right --count origin/main...HEAD  at be3bbacfc -> 0   2   (behind 0, ahead 2)
rev-list --left-right --count origin/main...HEAD  at e6af6f998 -> 0   3   (behind 0, ahead 3)
rev-list --left-right --count origin/main...HEAD  at the readback commit -> 0   4  (behind 0)
merge-base --is-ancestor origin/main HEAD        -> rc 0
ls-remote origin refs/heads/pb/PBB-665/t-44-wire -> the tip; local HEAD agrees (read back, see receipt)
```

`origin/main` did not move during this lane (`0` behind at every readback). Ancestry was checked
directly, not taken from any list; the `3d713566` / PR #2588 note in the task belongs to the
**openclaw-onboarding** repository (`origin/main` = `3d7135664326eeb7857252afcad5506c1381c3d5`,
confirmed by `rev-parse`), not to 999-setup, whose main is `e8dc28ee8` (PR #331).

## 8. Memory

Tier **GREEN** (`loop-control/…/memory_sample.json`). Heavy permit claimed: **none of the 8** — only
two sub-second targeted suite runs (76 tests in 0.004 s; 31 tests in 0.366 s) plus one `--check`.

## 9. Not done (deliberately)

- No merge, no force-push, no ledger/census/DECISIONS edit, no other unit's files.
- `CONTROL/bundle-digests.json` was **not** regenerated: rewriting a shared artifact owned by another
  unit would change a contract this lane does not own. The receipt records itself the next time anyone
  runs `--write-digests`; until then `--check` states `SKIP distribution-order no recorded order
  digest` — a stated absence, never a pass.
- The `helper-pin-guard.yml` `paths:` filter does not include `tools/**`; the gate's own workflow
  covers that path, so the trigger set was left untouched (one added step, nothing restructured).
