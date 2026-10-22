export const meta = {
  name: 'program-W1-merge-WU001..WU004-4L',
  description: 'Merge-phase integration: one repository train per unit lane, then fresh independent QC of the exact candidate commit',
  phases: [{ title: 'Merge' }, { title: 'QC' }],
  agentsTotal: 4,
}
// NAME: replace the placeholder for every launch -- <program>-W<wave>-merge-<firstID>[..<lastID>]-<lanes>L
// (references/workflows.md section 4). Under a swarm plan the name is computed like make-workflow.py does,
// e.g. swarm-W0-merge-WU001..WU004-4L for a four-unit S75-WM launch; <lanes> is the number of units passed
// to pipeline(args.units) -- the rolling-window rule of the plan mode, peak must equal min(cap, units).
// PHASES: 'Merge' (the integration writer) and 'QC' (fresh independent QC). Labels MUST stay
// build:<unit_id> and qc:<unit_id>: the plan guard counts a unit done only when its verdict file was
// written by the qc:<unit_id> agent of the admitted run and at least one build:<unit_id> agent ran beside
// it on a different model family (staffing.actual_roles_ok).
// MODELS: MODEL_INTEGRATOR is the one named integrator seat, MODEL_QC the fresh independent checker of a
// DIFFERENT model family. Replace both constants with the run's pinned role routes (Skill 75 section 7:
// one named MiMo integrator, fresh GLM 5.3 high QC); never a model on the run's banned list, never an
// auto-router. Section 7.4 role swap applies to authored content: a change authored by the checker's own
// family is never passed on that checker's judgment alone (see the QC prompt).
// ARGS: { workflowId: "<plan workflow id>", units: [<the plan's unit objects, field for field>],
//         attemptId: "<workflowId>-<epoch-ms>" } -- the armed-plan launch contract. The guard admits NO
// other args key (no seats/skill/project in args): paths are filled into the constants below.
// FILL: name, MODEL_INTEGRATOR, MODEL_QC, RUN_ROOT (the plan's folder), SKILL (this spec-protocol skill
// dir), PROJECT (the spec-protocol project home whose repos.json registry names the repositories).
// Runs OUTSIDE every build tree (Law 3, SHAPE 5): launch it as its own workflow, never from the main
// session. The train itself (tools/merge-train.sh) is the only merge writer: one integration writer/lock
// per repository, batches attempted every MERGE_BATCH_MINUTES (default 10) while eligible units exist, a
// red unit bisected out and parked without holding unrelated green units, and the ONLY proof of merge is
// the accepted change reachable on the correct remote main -- never a local merge, a green pull request,
// a branch push, or mergeable:true.
const RUN_ROOT = '<plan run root>';
const SKILL = '<spec-protocol skill dir>';
const PROJECT = '<project home>';
const MODEL_INTEGRATOR = 'openrouter/xiaomi/mimo-v2.6-pro';
const MODEL_QC = 'openrouter/z-ai/glm-5.3';

const REPORT = {
  type: 'object',
  properties: { rc: { type: 'number' }, lines: { type: 'array', items: { type: 'string' } } },
  required: ['rc', 'lines'],
}
const RESULT = {
  type: 'object',
  properties: { id: { type: 'string' }, status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] }, evidence: { type: 'string' } },
  required: ['id', 'status', 'evidence'],
}

log('merge-lanes=' + args.units.length + ' integrator=' + MODEL_INTEGRATOR + ' qc=' + MODEL_QC + ' overlap=per-repository');
log('Each lane runs ONE registered repository train with --repo (serial per repository, one integration writer/lock per repository); its QC lane judges the exact candidate commit.');

const results = await pipeline(args.units,
 (u) => agent(
  'Integration writer for unit ' + u.unit_id + '. Exclusive ownership: ' + u.owned_output + '. Do not spawn any helpers, agents or workflows. You are the ONE merge writer for this unit\'s repository: never merge by hand, never force-push, never merge on a description\'s claims, never disable the workflow guard, and never run the train from a main session. SCRATCH ISOLATION: write only inside your private lane folder <scratchpad>/lanes/<UNIT-ID>-<box-slug>/ (this lane: lanes/' + u.unit_id + '-lane/) and prefix box temp files /tmp/<box-slug>-<UNIT-ID>- . MERGE-TRAIN INVOCATION CONTRACT: (1) one integration writer/lock per repository -- run exactly ONE repository train, always serially with --repo for this unit\'s registered repository name (read the repo registry the train itself uses, <state>/repos.json; with no registry the project has exactly one repository named after its root): bash "' + SKILL + '/tools/merge-train.sh" "' + PROJECT + '" --batch --repo <registered-name>. Never run bare --batch while a registry lists more than one repository: it fans out concurrently and escapes this serialization. (2) batches are attempted every ten minutes while eligible units exist (MERGE_BATCH_MINUTES, default 10); a batch or gate already running is NEVER restarted because a new window arrived -- when the train reports it is already running, report the active batch and queue the next window. (3) a red unit is isolated (REPAIR:/CONFLICT: parked, bisected out of the batch) without holding unrelated green units; parked units retry once their branch tip moves. (4) fresh independent QC bound to the exact candidate commit: only a unit whose QC judges the exact candidate commit (its QC head equals the live branch tip) is admitted to a batch; a unit whose tip moved after its QC is stale and waits for fresh QC. Return rc and every LANDED:/MERGED:/MERGE-UNPROVEN:/CONFLICT:/REPAIR:/KEPT-UNMERGED:/QC-STALE:/MERGE-TRAIN line it printed. A non-zero exit code is the answer, not a problem to solve. Work: ' + u.work + ' Source: ' + u.source,
  { model: MODEL_INTEGRATOR, phase: 'Merge', label: 'build:' + u.unit_id, schema: REPORT }),
 async (ran, u) => {
  if (!ran || typeof ran.rc !== 'number') return { id: u.unit_id, status: 'BLOCKED', evidence: ran ? 'integrator returned no rc/lines receipt' : 'Integrator returned no result' };
  return agent(
   'Fresh independent QC of unit ' + u.unit_id + '. Do not spawn helpers. You never merge, push, edit files or run the train: you judge and you write the verdict. SCRATCH ISOLATION: write only inside your private lane folder <scratchpad>/lanes/<UNIT-ID>-<box-slug>/ (this lane: lanes/' + u.unit_id + '-lane/) and prefix box temp files /tmp/<box-slug>-<UNIT-ID>- . PROOF OF MERGE -- the accepted change reachable on the correct remote main is the ONLY proof; a local merge, a green pull request, a branch push or mergeable:true is never proof. Judge the EXACT CANDIDATE COMMIT: for every MERGED: line in the integrator receipt below, the commit=<sha> is the candidate; read it live (git show <sha>, git fetch <remote> <trunk>) and prove reachability with git merge-base --is-ancestor <sha> FETCH_HEAD on the trunk the repo registry names. Fresh independent QC bound to that exact candidate commit: you are a different model family from the integrator, judging the candidate state itself, never its narrative; Skill 75 section 7.4 role swap -- when the accepted change was authored by your own model family, a fresh reviewer of the other family must verify it and you never pass it on your own judgment; name the requirement in evidence. A unit whose receipt shows REPAIR:, CONFLICT: or MERGE-UNPROVEN: is FAIL or BLOCKED for that unit alone; a red unit is isolated and never holds unrelated green units. VERDICT FILE: write exactly this JSON to ' + RUN_ROOT + '/' + u.verdict_file + ' (create folders as needed): {"verdict":"PASS" or "FAIL" (PASS only when the accepted change of this unit is proven reachable on the correct remote main and its QC bound to the exact candidate commit),"unit_id":"' + u.unit_id + '","attempt_id":"' + args.attemptId + '","builder_model":"' + MODEL_INTEGRATOR + '","reviewer_model":"' + MODEL_QC + '","head":"the full 40-character commit SHA of the exact candidate commit you judged, read live; NONE if the unit has no candidate commit"}. Write it with the Write tool (not a shell command), exactly once, after judging. You are the checker; the conductor may not write this file. Integrator receipt: ' + JSON.stringify(ran),
   { model: MODEL_QC, phase: 'QC', label: 'qc:' + u.unit_id, schema: RESULT });
 });

const missing = results.map((r, i) => r ? null : 'unit #' + (i + 1)).filter(Boolean);
log('Returned ' + results.filter(Boolean).length + '/' + args.units.length + ' verdicts; missing IDs: ' + missing.join(', '));
// complete = every lane reached a verdict. A red unit isolated and parked is a verdict, not a missing lane.
return { results, missing, complete: missing.length === 0 };
