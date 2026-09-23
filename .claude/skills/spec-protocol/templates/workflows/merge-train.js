export const meta = {
  name: 'merge-train',
  description: 'The one merge writer: land passed units one at a time with tools/merge-train.sh',
  phases: [{ title: 'Merge' }],
  agentsTotal: 1,
}
// agents: 1   (one merge writer, however many units; read by the dispatch gate)
// args: { project: "<home>", repo: "<repo path>", skill: "<spec-protocol skill dir>", seats: { merge: "<seat>" },
//         units: [{ id: "U001", branch: "unit/U001" }] }   -- PASS verdicts only, in merge order
// Runs OUTSIDE every build tree (Law 3, SHAPE 5): launch it as its own workflow.
// One agent, because merges are serial by definition; the script does the merging and
// removes each landed unit's worktree (<repo>/.worktrees/<id>).
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.merge) throw new Error('args.seats.merge is required')
if (!args.repo || !args.skill || !args.project) throw new Error('args.repo, args.skill and args.project are required')

const branches = units.map((u) => u.branch).join(' ')
const REPORT = {
  type: 'object',
  properties: { rc: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } },
  required: ['rc', 'lines'],
}

return await agent(
  `Run exactly this one command and nothing else, then return its exit code and every LANDED:/MERGED:/MERGE-TRAIN line it printed:\n` +
  `bash "${args.skill}/tools/merge-train.sh" --project "${args.project}" "${args.repo}" ${branches}\n` +
  `Do not merge by hand, do not retry, do not edit files. A non-zero exit code is the answer, not a problem to solve.`,
  { model: seats.merge, phase: 'Merge', label: 'merge-train', schema: REPORT })
