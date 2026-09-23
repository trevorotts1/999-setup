# Project profiles

A provided project may declare `.spec-protocol.json` with schema
`spec-protocol.project-profile/v1`. It adopts supplied documents rather than copying them
into generic apparatus. `documents.state` is the one canonical state; no universal helper
may create or write `CONTROL/project_state.json`, a parallel task graph, or a replacement
ledger for that project. Bound document paths are relative to the project root. An absent
capability document is recorded by the project validator; universal tools do not recreate it.

`commands.validate`, `commands.dispatch`, and `commands.release` are non-empty argv arrays;
`commands.init` is optional. They execute at the project root with no shell evaluation.
An optional `runtime` object is packet-owned declarative data. The universal adapter only
checks that it is an object, then delegates its fields to the project validator. It never
requires Ponytail, a router, or a launcher; installs, enables, changes, and duplicate runtime
configuration are outside the adapter.
`project-profile.mjs bootstrap <project>` checks the bound `documents.state`: only when it
is absent does it run `commands.init`, then it always runs the read-only validator. Init never
overwrites progressed state. A profile with no init command may be adopted when state exists;
a missing state then fails explicitly rather than being guessed or reset.

The validator emits exactly one JSON report. It must contain `ok:true` plus either
`dispatchReady:true` or an explicit `structuralReady:true` / `bootstrapReady:true`. The latter
means only that the packet can decide an exact controlled bootstrap, audit, or route-probe
request; it is not a blanket product-dispatch pass. `dispatchReady:true` additionally means
the current frozen source/profile/policy binding has a current applicable PASS audit (zero
HALT/HARM/SCOPE) and the task lifecycle, route, and policy are ready.

`project-profile.mjs dispatch <project> <units> <agents> <label> ...` forwards the original
positional arguments and flags unchanged to `commands.dispatch` after that structural check.
The packet checker, not the adapter, decides a task-scoped bootstrap/audit/probe exception or
a production request. It is the sole write-ahead intent and attempt-reservation writer; the
adapter does not increment a second counter. `--check` is read-only and `--reserve` is the
packet's explicit lifecycle mutation. Missing, malformed, or non-ready reports fail closed.

The Workflow hook detects this profile before searching for `CONTROL`. A profiled native
Workflow must use the existing supported `tool_input.args` object with this identity:

```json
{
  "specProtocol": {
    "taskId": "<task>",
    "role": "builder|qc|repair|reader",
    "intentId": "<reserved intent>",
    "nativeWorkflowId": "<packet workflow identity>",
    "label": "<reserved label>",
    "units": 1,
    "agents": 1
  }
}
```

**The `reader` role is reservation-exempt.** A reader inspects and reports; it writes nothing,
owns no path, spends no builder or QC counter, and therefore has nothing to reserve. The hook
accepts `role: "reader"` with no intent id and no reservation check, and the packet writer
records no attempt for it. This is not a loophole — it is the fix for one: SKILL.md forbids the
conductor from reading a project document in full in its own context, so a gate that refused
readers would force exactly that, and burn the conductor's context on documents a Haiku agent
should have summarized. A reader that attempts a write, a dispatch, or a state event is a
violation the packet rejects at the writer, where it belongs. Every OTHER role is reserved
first; before launch the hook calls the declared checker with the exact identity and `--check`. Its
single JSON response must prove a matching, revision/source-bound `RESERVED` intent using
`taskAuthorization.kind="reservation-check"`, `readOnly:true`, and the exact echoed fields.
The hook neither creates nor consumes an intent. A native launch is not a receipt; the packet
writer consumes only after an observed native receipt. One reservation maps to one task and
one native workflow and bounds that workflow's direct helpers. When inline script bytes reveal
an exact direct `agent()` count greater than the reserved `agents` count, the hook refuses
before launch and names both counts. Dynamic/named fan-out and name-only workflows have no
honest static count, so they remain exact-reservation checked without a fabricated number. A
batch uses separately reserved task launches. A missing identity, mismatch, consumed intent,
or unreadable report refuses the profiled launch. Legacy hook behavior remains unchanged for
projects without a profile.

**A profile REDIRECTS the helpers; it never switches them off.** On a profiled project the
bound `documents.state` is canonical and the packet's declared `commands` (bootstrap, validate,
dispatch, release) are how the helpers reach it, through `tools/project-profile.mjs`. The
five-minute tick is NEVER skipped: `tools/watch-tick.sh` (and its Node twin) arms the same cron
line on a profiled project, runs `commands.validate` every tick and logs beside the bound state
— an unwatched run is the exact failure these instruments exist to prevent. The remaining
legacy `CONTROL/`-writing helpers (anchor, state-check, audit-gate, seat-probe, and the legacy
GATE 0 marker) still REFUSE on a profiled project by design, naming the refusal `PROFILE-OWNED`:
their job — reconcile, state, audit — is the packet validator's, and a second copy of that
state beside the bound one is what a profile forbids. `tools/ledger.sh` is the one exception:
it never refuses on a profiled project — every `write X through tools/ledger.sh` step in the
skill works on a profiled project exactly as on a legacy one. It REDIRECTS instead: the same
lock, the same atomic writer, the same clock and signature, but the file lands at
`<statedir>/spec-protocol/LEDGER.md` (statedir = the directory of `documents.state`, resolved
by `project-profile.mjs workdir <project>`), with a leading `CONTROL/` dropped from the path
argument, and the resolved path is printed. What a profile forbids is a SECOND copy —
no parallel ledger, no parallel task graph, no `CONTROL/project_state.json` beside the bound
state. `project-profile.mjs resume-authorized
<project>` is the sole narrow GATE 0 resume exception: it requires the current validator to
return `savedResumeAuthorized:true`. It authorizes only that saved profile-bound resumption;
it does not enable a general human-gate bypass.

**Optional fields the profile may declare** (all argv arrays, run at the project root, never
through a shell, validated by `project-profile.mjs` before any helper reads them):
- `commands.refresh` regenerates the project's own human-readable views. `tools/watch-tick.sh`
  (and its Node twin) runs it after every state-changing step and at least every
  `MERGE_BATCH_MINUTES` (default 15) minutes; a failure is logged on the tick's own stdout and
  is never fatal to the tick.
- `commands.merged` records one merged unit in the project's own state, run once per unit by
  `tools/merge-train.sh <project> --batch` with `{taskId}`, `{commit}`, `{branch}` substituted
  — the only command allowed those placeholders.
- `repo.remote` (a git URL) or `repo.createPrivate` (`owner/name`, created private via `gh`):
  on a profiled project `tools/repo-anchor.sh` never creates or names a GitHub repository
  unless one of these is present. Absent both, it anchors LOCAL-ONLY and records that in the
  receipt — the existing unprofiled behavior (the client's own account, or an operator remote)
  is otherwise unchanged.
- `policy.maxActiveWorkflows`, `policy.maxAgentsPerWorkflow`, `policy.maxWorkingAgents`: when
  present, each is the project's own CEILING. Width = `min(harness/provider width, the profile
  ceiling)`, read via `project-profile.mjs policy <project>` (JSON, only the keys the profile
  set) or the combined `project-profile.mjs fields <project>` (workDir, ceiling, refresh,
  merged, repo). Never plan above the ceiling; when a key is absent, current (unprofiled)
  behavior for that key.

**The quality floor is universal.** Every profile retains the ten-category score floor of at
least 8.5 plus mandatory behavior, scope, evidence, and independent reference comparison.
Profiles cannot lower, disable, or replace any of those PASS conditions; their validator may
add project-specific conditions.

**Profile repair and delivery bounds are state-owned.** Do not apply the universal legacy
twenty-cycle finding counter to an adopted profile. Its canonical state applies
`policy.maxBuilderSubmissions` and `policy.maxQCVerdicts` across every child of one root task;
for an adopted profile that is at most its declared builder deliveries for that root, not per
child and not an additional twenty largest-gap retries. The one-largest-gap rule
still determines the next repair payload, but it spends the same root-bound builder/QC budget
and the packet writer rejects a further reservation. The profile may expose a different explicit
repair bound through its validator/state; if it does not, no universal default is inferred.

Profiles are optional. Generic projects retain normal defaults. Record the profile path,
schema, source skill version, and source hash at startup; an active-project migration needs a
durable migration record. A profile is a binding and policy declaration, not a second state
file, ledger, scheduler, router configuration, or a closed document-count requirement.
