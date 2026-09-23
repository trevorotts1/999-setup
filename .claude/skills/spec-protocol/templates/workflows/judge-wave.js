export const meta = {
  name: 'judge-wave',
  description: 'Judge every pushed-but-unjudged unit in the list, one blind judge per unit',
  phases: [{ title: 'Judge' }],
  agentsPerUnit: 1,
}
// agents: args.units.length * 1   (one blind judge per unit; read by the dispatch gate)
// args: { project: "<home>", seats: { judge: "<seat>" },
//         units: [{ id: "U001", card: "<card path>", branch: "unit/U001", repo: "<path>", builtBy: "<builder seat>" }] }
// One judge per unit (SHAPE 2). A judge on the builder's seat is refused (Law 7).
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.judge) throw new Error('args.seats.judge is required')
const same = units.filter((u) => u.builtBy === seats.judge).map((u) => u.id)
if (same.length) throw new Error(`judge seat equals the builder seat for: ${same.join(', ')} (Law 7)`)

const VERDICT = {
  type: 'object',
  properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] }, score: { type: 'number' }, finding: { type: 'string' } },
  required: ['id', 'verdict'],
}

return await pipeline(units,
  (u) => agent(
    `Judge unit ${u.id} blind for the project at ${args.project}. Card: ${u.card}. Branch ${u.branch} in ${u.repo}. ` +
    `Run the card's QC section (never its VERIFY), score it against the ten categories in the QUALITY-CONTROL rulebook, ` +
    `quote the evidence, run the break-it pass. PASS needs 8.5+. Return id, verdict, score, finding.`,
    { model: seats.judge, phase: 'Judge', label: `judge:${u.id}`, schema: VERDICT }),
)
