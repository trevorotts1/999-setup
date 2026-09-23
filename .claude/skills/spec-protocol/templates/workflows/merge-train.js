export const meta = {
  name: 'program-W1-merge-UNIT001-1L',
  description: 'Run every repository\'s merge train in one batch with tools/merge-train.sh --batch; the haiku-chain conflict-resolver seat takes any conflict or re-queued unit',
  phases: [{ title: 'Merge' }, { title: 'Resolve' }],
  agentsTotal: 2,
}
// NAME: replace the placeholder for every launch -- <program>-W<wave>-merge-<firstID>[..<lastID>]-1L
// (references/workflows.md section 4): program = project slug, ids with dashes removed, lanes = 1.
// agents: 2   (the merge runner, plus the conflict resolver only when the batch hands it units;
//              read by the dispatch gate)
// args: { project: "<home>", skill: "<spec-protocol skill dir>",
//         seats: { merge: "<seat>", conflict: "<the haiku-chain conflict-resolver seat>" },
//         units: [{ id: "UNIT-001", branch: "unit/UNIT-001" }] }   -- the passed units expected in this batch
// Runs OUTSIDE every build tree (Law 3, SHAPE 5): launch it as its own workflow.
// Normally the tick runs the batch itself every MERGE_BATCH_MINUTES (default 10); this
// template is the conductor's way to run the same batch on demand. The SCRIPT drives every
// train: with no --repo, merge-train.sh runs one train per registered repository, each under
// its own lock -- merges every waiting passed unit in one pass, gates once, pushes once,
// proves each merge, cleans up proven units, bisects a red batch. Nothing is ever merged one
// unit at a time. The conflict-resolver seat is the haiku chain, never a builder seat: it
// only makes a conflicting or re-queued unit branch mergeable again, and the next batch
// merges it.
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.merge || !seats.conflict) throw new Error('args.seats.merge and args.seats.conflict (the haiku-chain conflict-resolver seat) are required')
if (!args.skill || !args.project) throw new Error('args.skill and args.project are required')

const REPORT = {
  type: 'object',
  properties: { rc: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } },
  required: ['rc', 'lines'],
}

const merged = await agent(
  `Run exactly this one command and nothing else, then return its exit code and every LANDED:/MERGED:/` +
  `MERGE-UNPROVEN:/CONFLICT:/REPAIR:/KEPT-UNMERGED:/MERGE-TRAIN line it printed:\n` +
  `bash "${args.skill}/tools/merge-train.sh" "${args.project}" --batch\n` +
  `Expected in this batch: ${units.map((u) => u.branch).join(' ')}.\n` +
  `Do not merge by hand, do not retry, do not edit files. A non-zero exit code is the answer, not a problem to solve.`,
  { model: seats.merge, phase: 'Merge', label: 'merge-train', schema: REPORT })

// Conflicts and units the proof of merge re-queued go to the conflict-resolver seat.
const handoff = (merged.lines || []).filter((l) => /^(CONFLICT|MERGE-UNPROVEN): /.test(l))
if (handoff.length === 0) return { merge: merged, resolved: null }

const resolved = await agent(
  `You are the conflict-resolver seat. For each unit named in these lines from the merge train:\n` +
  `${handoff.join('\n')}\n` +
  `In that unit's own branch (its worktree when one exists), merge the repository's current trunk into it, ` +
  `resolve every conflict keeping the intent of both sides, run the project's test command, and commit on ` +
  `the unit branch. A re-queued unit that merges cleanly needs nothing: leave it. Never merge into the trunk, ` +
  `never push the trunk, never delete a branch or worktree, never run merge-train.sh -- the next batch takes ` +
  `each unit whose branch tip moved. Return rc 0 when every unit is resolved or needed nothing, and one line ` +
  `per unit: "<branch> resolved <commit>" or "<branch> unresolved <reason>".`,
  { model: seats.conflict, phase: 'Resolve', label: 'conflict-resolver', schema: REPORT })

return { merge: merged, resolved }
