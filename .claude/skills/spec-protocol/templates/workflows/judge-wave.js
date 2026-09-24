export const meta = {
  name: 'program-W1-qc-UNIT001..UNIT002-2L',
  description: 'Judge every pushed-but-unjudged unit in the list, one blind judge per unit',
  phases: [{ title: 'Judge' }],
  agentsPerUnit: 1,
}
// NAME: replace the placeholder for every launch -- <program>-W<wave>-<phase>-<firstID>[..<lastID>]-<lanes>L
// (references/workflows.md section 4): program = project slug, ids with dashes removed, lanes = units passed (one judge per unit).
// agents: args.units.length * 1   (one blind judge per unit; read by the dispatch gate)
// args: { project: "<home>", seats: { judge: "<seat>" },
//         units: [{ id: "UNIT-001", card: "<card path>", branch: "unit/UNIT-001", repo: "<path>", builtBy: "<builder seat>", builder: "<builder label>" }] }
// judge = policy.qcRoute on a profiled project (tools/project-profile.mjs fields).
// One judge per unit (SHAPE 2). A judge on the builder's seat is refused (Law 7).
// Each verdict carries builtBy/builder through, so a FAIL goes back to the ORIGINAL builder seat.
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.judge) throw new Error('args.seats.judge is required')
const same = units.filter((u) => u.builtBy === seats.judge).map((u) => u.id)
if (same.length) throw new Error(`judge seat equals the builder seat for: ${same.join(', ')} (Law 7)`)

const scratch = (u) => `SCRATCH ISOLATION: write scratch files only inside your private lane folder ` +
  `<scratchpad>/lanes/<UNIT-ID>-<box-slug>/ (this lane: lanes/${u.id}-local/), and prefix any temp file on another machine /tmp/<box-slug>-<UNIT-ID>- . `

const FINDING = {
  type: 'object',
  properties: { repro: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, location: { type: 'string' },
    diagnosis: { type: 'string' }, fix: { type: 'string' }, verify: { type: 'string' } },
  required: ['repro', 'expected', 'actual', 'location', 'diagnosis', 'fix', 'verify'],
}
// finding = the largest gap, one line; findings = EVERY blocking finding, which the
// conductor merges with the other judge's into the unit's ONE repair packet.
const VERDICT = {
  type: 'object',
  properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] }, score: { type: 'number' },
    finding: { type: 'string' }, findings: { type: 'array', items: FINDING } },
  required: ['id', 'verdict'],
}

return await pipeline(units,
  async (u) => ({ ...(await agent(
    `Judge unit ${u.id} blind for the project at ${args.project}. ` + scratch(u) + `Card: ${u.card}. Branch ${u.branch} in ${u.repo}. ` +
    `Run the card's QC section (never its VERIFY), score it against the ten categories in the QUALITY-CONTROL rulebook, ` +
    `quote the evidence, run the break-it pass. PASS needs 8.5+. Return id, verdict, score, finding (the largest gap), and findings: EVERY blocking finding, each with ` +
    `repro, expected, actual, location, diagnosis, the ordered fix, and the exact verify command.`,
    { model: seats.judge, phase: 'Judge', label: `judge:${u.id}`, schema: VERDICT })),
    builtBy: u.builtBy, builder: u.builder }),
)
