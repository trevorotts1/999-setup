export const meta = {
  name: 'program-W1-merge-UNIT001-1L',
  description: 'The one merge writer: land every passed unit in one batch with tools/merge-train.sh --batch',
  phases: [{ title: 'Merge' }],
  agentsTotal: 1,
}
// NAME: replace the placeholder for every launch -- <program>-W<wave>-merge-<firstID>[..<lastID>]-1L
// (references/workflows.md section 4): program = project slug, ids with dashes removed, lanes = 1.
// agents: 1   (one merge writer, however many units; read by the dispatch gate)
// args: { project: "<home>", skill: "<spec-protocol skill dir>", seats: { merge: "<seat>" },
//         units: [{ id: "UNIT-001", branch: "unit/UNIT-001" }] }   -- the passed units expected in this batch
// Runs OUTSIDE every build tree (Law 3, SHAPE 5): launch it as its own workflow.
// Normally the tick runs the batch itself every MERGE_BATCH_MINUTES (default 15); this
// template is the conductor's way to run the same batch on demand. One agent: the script
// merges every waiting passed unit in one pass, gates once, pushes once, bisects a red
// batch and records conflicts for the conflict-resolver seat.
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.merge) throw new Error('args.seats.merge is required')
if (!args.skill || !args.project) throw new Error('args.skill and args.project are required')

const REPORT = {
  type: 'object',
  properties: { rc: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } },
  required: ['rc', 'lines'],
}

return await agent(
  `Run exactly this one command and nothing else, then return its exit code and every LANDED:/MERGED:/MERGE-TRAIN line it printed:\n` +
  `bash "${args.skill}/tools/merge-train.sh" "${args.project}" --batch\n` +
  `Expected in this batch: ${units.map((u) => u.branch).join(' ')}.\n` +
  `Do not merge by hand, do not retry, do not edit files. A non-zero exit code is the answer, not a problem to solve.`,
  { model: seats.merge, phase: 'Merge', label: 'merge-train', schema: REPORT })
