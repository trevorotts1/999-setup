export const meta = {
  name: 'program-W1-build+qc-UNIT001..UNIT002-2L',
  description: 'Build every unit in the list, each judged by a different seat the moment it lands',
  phases: [{ title: 'Build' }, { title: 'Judge' }],
  agentsPerUnit: 2,
}
// NAME: replace the placeholder for every launch -- <program>-W<wave>-<phase>-<firstID>[..<lastID>]-<lanes>L
// (references/workflows.md section 4): program = project slug, ids with dashes removed, lanes = units passed (one builder or judge per unit at a time).
// agents: args.units.length * 2   (one builder + one judge per unit; read by the dispatch gate)
// args: { project: "<home>", seats: { build: "<seat>", judge: "<seat>" },
//         units: [{ id: "UNIT-001", card: "SPEC/MASTER-SPEC-<date>.md#UNIT-001", branch: "unit/UNIT-001", repo: "<path>", base: "<frozen base ref>" }] }
// Each builder works ONLY in its own worktree <repo>/.worktrees/<id> on its own branch;
// tools/merge-train.sh merges those branches and removes the worktrees once landed.
// One pipeline: each unit's judge fires as soon as THAT unit's build lands (no barrier).
// Book the tree in CONTROL/dispatch-log.md before launching (SHAPE 7).
const units = args.units
const seats = args.seats
if (!Array.isArray(units) || units.length === 0) throw new Error('args.units must be a non-empty array')
if (!seats || !seats.build || !seats.judge || seats.build === seats.judge) throw new Error('args.seats.build and args.seats.judge are required and must differ (Law 7)')

const wt = (u) => `${u.repo}/.worktrees/${u.id}`
const excl = (u) => `grep -qx '.worktrees/' "$(git -C "${u.repo}" rev-parse --git-path info/exclude)" 2>/dev/null || echo '.worktrees/' >> "$(git -C "${u.repo}" rev-parse --git-path info/exclude)"`

const scratch = (u) => `SCRATCH ISOLATION: write scratch files only inside your private lane folder ` +
  `<scratchpad>/lanes/<UNIT-ID>-<box-slug>/ (this lane: lanes/${u.id}-local/), and prefix any temp file on another machine /tmp/<box-slug>-<UNIT-ID>- . `

const RESULT = {
  type: 'object',
  properties: { id: { type: 'string' }, status: { type: 'string', enum: ['BUILT', 'BLOCKED'] }, commit: { type: 'string' }, note: { type: 'string' } },
  required: ['id', 'status'],
}
const VERDICT = {
  type: 'object',
  properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] }, score: { type: 'number' }, finding: { type: 'string' } },
  required: ['id', 'verdict'],
}

return await pipeline(units,
  (u) => agent(
    `Build unit ${u.id} for the project at ${args.project}. ` + scratch(u) + `Read ONLY spec-common and your card: ${u.card}. ` +
    `Work ONLY in your own worktree, never in ${u.repo} itself. First run: ${excl(u)} ; then ` +
    `git -C "${u.repo}" worktree add "${wt(u)}" -b ${u.branch} ${u.base || 'HEAD'} (the wave's frozen base; if ${wt(u)} ` +
    `already exists, reuse it; if only the branch exists, run the same command without -b and the base; on a git lock error wait a few seconds and retry). ` +
    `cd into ${wt(u)} and do all work there. Touch only the paths your card lists. ` +
    `Run the card's VERIFY commands, commit on your branch (no AI trailers); do not push (the merge train publishes). Return id, status, commit sha.`,
    { model: seats.build, phase: 'Build', label: `build:${u.id}`, schema: RESULT }),
  (built, u) => agent(
    `Judge unit ${u.id} blind: you are not told how it was built. ` + scratch(u) + `Card: ${u.card}. Branch ${u.branch} in ${u.repo}, checked out at ${wt(u)}` +
    (built && built.commit ? ` at ${built.commit}` : '') + `. Run the card's QC section (never its VERIFY), score it against ` +
    `the ten categories in the QUALITY-CONTROL rulebook, quote the evidence. PASS needs 8.5+. Return id, verdict, score, finding.`,
    { model: seats.judge, phase: 'Judge', label: `judge:${u.id}`, schema: VERDICT }),
)
