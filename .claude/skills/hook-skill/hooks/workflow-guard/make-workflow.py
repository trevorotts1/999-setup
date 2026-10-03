#!/usr/bin/env python3
"""Generate self-contained visible workflows. Does not launch workers or execute input."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE = os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''
PROGRAM_RE = re.compile(r'^[a-z0-9]{2,12}$')
UNIT_ID_RE = re.compile(r'^[A-Z]{2,5}-[0-9]{3,}$')
NAME_RE = re.compile(r'^[a-z0-9]{2,12}-W[0-9]{1,2}-(build\+qc|build|qc|repair|merge|test)-[A-Z]{2,5}[0-9]{3,}(\.\.[A-Z]{2,5}[0-9]{3,})?-[0-9]{1,2}L$')
PHASE_CHOICES = ('build+qc', 'build', 'qc', 'repair', 'merge', 'test')
TEMPLATE = '''
const RESULT = {type:'object', properties:{id:{type:'string'},status:{type:'string',enum:['PASS','FAIL','BLOCKED']},evidence:{type:'string'}}, required:['id','status','evidence']};
log('lanes='+INPUT.units.length+' builder='+BUILDER+' reviewer='+REVIEWER+' overlap=per-unit');
log('Starting '+INPUT.units.length+' independent unit lanes; each unit moves directly from Build to QC.');
const results = await pipeline(INPUT.units,
 (u) => agent('Unit '+u.id+'. Exclusive ownership: '+u.ownership+'. Do not spawn any helpers, agents or workflows. Do not merge or publish. Produce artifact/commit and test evidence, never self-approve. NEVER run `pm2 jlist` or `pm2 describe` (they dump process environments); `pm2 list` only. SCRATCH ISOLATION: write only inside your private lane folder <scratchpad>/lanes/<UNIT-ID>-<box-slug>/ (this lane: lanes/'+u.id+'-lane/; when working inside the run root use '+INPUT.guard.runRoot+'/lanes/'+u.id+'-lane/, which the guard registers and removes after the run ends) and prefix box temp files /tmp/<box-slug>-<UNIT-ID>- . HYGIENE (standing rule): once your work is merged and released on origin/main (after an explicit reconcile confirming the merge commit is preserved on a branch keep-ref), clean up: remove your own git worktree with git worktree remove <path> (never --force), delete the now-merged local branch with git branch -d (never --force), run git worktree prune, and delete your /tmp lane folders prefixed /tmp/<box-slug>-<UNIT-ID>-. Do the worktree, branch and /tmp cleanup ONLY after the merged reconcile confirms the commit is preserved by the keep-ref. NEVER remove unmerged or dirty work. Hygiene cleanup only, never --force. '+u.prompt,
 {model:BUILDER, phase:'Build', label:'build:'+u.id, schema:RESULT}),
 async (built,u) => {
  if (!built || built.status !== 'PASS') return {id:u.id,status:'BLOCKED',evidence:built ? built.evidence : 'Builder returned no result'};
  return agent('Independently QC unit '+u.id+'. Do not spawn helpers. Verify actual files and the exact revision, not the builder narrative. Return FAIL/BLOCKED when evidence is missing. HYGIENE (standing rule): also verify the builder left nothing behind — after merge and release on origin/main (with explicit reconcile confirming the merge commit is preserved on a branch keep-ref) the builder removes its own git worktree (git worktree remove <path>, never --force), deletes its now-merged local branch (git branch -d, never --force), runs git worktree prune, and deletes its /tmp lane folders; NEVER unmerged or dirty work. Flag FAIL in evidence when the builder performed destructive cleanup (--force branch/worktree removal or removal of unmerged work). '+u.qcPrompt+' Builder receipt: '+JSON.stringify(built),
   {model:REVIEWER,phase:'QC',label:'qc:'+u.id,schema:RESULT});
 });
const missing=INPUT.units.filter((u,i)=>!results[i]).map(u=>u.id);
log('Returned '+results.filter(Boolean).length+'/'+INPUT.units.length+' results; missing IDs: '+missing.join(', '));
return {results,missing,complete:missing.length===0 && results.every(r=>r && r.status==='PASS')};
'''


def host_cap():
    """Host ceiling: WORKFLOW_GUARD_CAP when it is an integer 1..10, otherwise cpu_count - 2."""
    raw = os.environ.get('WORKFLOW_GUARD_CAP')
    if raw is not None and raw.strip():
        try:
            requested = int(raw.strip())
        except ValueError:
            requested = 0
        if 1 <= requested <= 10:
            return requested
    return max(1, (os.cpu_count() or 1) - 2)


def load_units(path):
    if path == '-':
        raw = sys.stdin.read()
    else:
        p = Path(path).expanduser()
        if p.is_dir():
            raise ValueError(f'--units must name a JSON FILE, not a directory: {p}')
        try:
            raw = p.read_text(encoding='utf-8')
        except OSError as exc:
            raise ValueError(f'Cannot read --units file {p}: {exc.strerror}. Pass the existing JSON file directly; no python -c extraction is needed.') from exc
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid input JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}. Use a JSON file, not an escaped Python expression.') from exc
    if isinstance(value, dict):
        if 'units' in value:
            value = value['units']
        elif isinstance(value.get('args'), dict) and 'units' in value['args']:
            value = value['args']['units']
        else:
            raise ValueError('Input object needs a units array (or args.units in an existing launch object).')
    if not isinstance(value, list) or not value:
        raise ValueError('Input must be a nonempty JSON array or an object with a nonempty units array. JSON encoded inside a string is not accepted.')
    for i, unit in enumerate(value):
        if not isinstance(unit, dict):
            raise ValueError(f'Unit {i + 1} must be an object.')
        for key in ('id', 'prompt', 'qcPrompt', 'ownership'):
            if not isinstance(unit.get(key), str) or not unit[key].strip():
                raise ValueError(f'Unit {i + 1}: {key} must be a nonempty string.')
        if not UNIT_ID_RE.match(unit['id']):
            raise ValueError(f'Unit {i + 1}: id {unit["id"]!r} must be a finding ID matching ^[A-Z]{{2,5}}-[0-9]{{3,}}$, for example SKR-012 or PRES-007. Rename the id in the input JSON; sequence numbers alone are not accepted.')
        if 'title' in unit and not isinstance(unit['title'], str):
            raise ValueError(f'Unit {i + 1}: title must be a string when present.')
    if len({u['id'] for u in value}) != len(value):
        raise ValueError('Duplicate unit IDs; give each unit a unique ID.')
    return value


def slice_name(program, wave, phase, chunk):
    ids = [u['id'].replace('-', '') for u in chunk]
    span = ids[0] if len(ids) == 1 else f'{ids[0]}..{ids[-1]}'
    return f'{program}-W{wave}-{phase}-{span}-{len(chunk)}L'


def slice_description(chunk):
    titles = [u['title'].strip() for u in chunk if isinstance(u.get('title'), str) and u['title'].strip()]
    text = '; '.join(titles) if titles else '; '.join(u['id'] for u in chunk)
    return text[:300]


def register_program(run_root, program, slices=()):
    """Best effort orchestrator-fence registration. A missing or failing guard command is a warning, never a failure."""
    session = os.environ.get('CLAUDE_SESSION_ID') or os.environ.get('WORKFLOW_GUARD_SESSION') or ''
    guard = ROOT / 'guard.py'
    if not session:
        print(f'make-workflow warning: no CLAUDE_SESSION_ID or WORKFLOW_GUARD_SESSION in the environment; skipped guard.py register for run root {run_root} (program {program}).', file=sys.stderr)
        return
    if not guard.exists():
        print(f'make-workflow warning: {guard} not found; orchestrator fence not registered for {run_root}.', file=sys.stderr)
        return
    try:
        done = subprocess.run([sys.executable, str(guard), 'register', '--session', session, '--run-root', str(run_root)], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f'make-workflow warning: guard.py register did not run ({exc}); orchestrator fence not registered for {run_root}.', file=sys.stderr)
        return
    if done.returncode != 0:
        detail = (done.stderr or done.stdout or '').strip().splitlines()
        first = detail[0][:200] if detail else 'no output'
        print(f'make-workflow warning: guard.py register exited {done.returncode} ({first}); orchestrator fence not registered for {run_root}.', file=sys.stderr)
        return
    # Register each slice's own lane folders so the watchdog can delete them after the run ends.
    for name, dirs in slices:
        try:
            subprocess.run([sys.executable, str(guard), 'register', '--session', session, '--run-root', str(run_root), '--workflow', name] + [x for d in dirs for x in ('--dir', d)], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError) as exc:
            print(f'make-workflow warning: lane folders for {name} not registered for cleanup ({exc}).', file=sys.stderr)


def main():
    if any(arg == '--name' or arg.startswith('--name=') for arg in sys.argv[1:]):
        print('make-workflow.py: error: --name is a removed legacy flag; use --program/--wave/--phase. The workflow name is computed as <program>-W<wave>-<phase>-<firstID>..<lastID>-<lanes>L.', file=sys.stderr)
        return 2
    p = argparse.ArgumentParser(description=__doc__, epilog='Read each generated workflow file in the host session, then call Workflow with the launch object printed below. No args or python -c conversion is needed.')
    p.add_argument('--units', '--input', required=True, help='Existing JSON file: array, {units:[...]}, or {args:{units:[...]}}. Use - for stdin. Each unit needs id (finding ID like SKR-012), prompt, qcPrompt, ownership, and may carry title.')
    p.add_argument('--out-dir', '--out', dest='out_dir', required=True, help='Output DIRECTORY, for example /tmp/pres045-workflows. Never a launch-01.json filename. --out is a compatibility alias.')
    p.add_argument('--provider-slots', type=int, required=True)
    p.add_argument('--reserve', type=int, default=0)
    p.add_argument('--program', required=True, help='Short program slug matching ^[a-z0-9]{2,12}$, for example pres, rr, mmcs.')
    p.add_argument('--wave', type=int, required=True, help='Wave number 0..99.')
    p.add_argument('--phase', default='build+qc', choices=PHASE_CHOICES, help='Workflow phase; default build+qc.')
    p.add_argument('--run-root', dest='run_root', required=True, help='Absolute program run root directory. Recorded in run-root.json and registered with the guard.')
    p.add_argument('--dependency-reason', dest='dependency_reason', default='', help='Written into guard.dependencyReason when a slice is narrower than the ready roster.')
    p.add_argument('--builder', default='opus')
    p.add_argument('--reviewer', default='sonnet')
    a = p.parse_args()
    try:
        if a.provider_slots < 1 or a.reserve < 0:
            raise ValueError('provider-slots must be positive and reserve must be nonnegative.')
        if not PROGRAM_RE.match(a.program):
            raise ValueError(f'--program {a.program!r} must match ^[a-z0-9]{{2,12}}$: two to twelve lowercase letters or digits, no hyphens or spaces. Examples: pres, rr, mmcs.')
        if not 0 <= a.wave <= 99:
            raise ValueError(f'--wave must be an integer 0..99, got {a.wave}.')
        run_root = Path(a.run_root).expanduser()
        if not run_root.is_absolute():
            raise ValueError(f'--run-root must be an absolute directory path, got {a.run_root!r}.')
        run_root = run_root.resolve()
        if run_root.exists() and not run_root.is_dir():
            raise ValueError(f'--run-root is an existing file, not a directory: {run_root}.')
        cap = min(10, host_cap(), a.provider_slots - a.reserve)
        if cap < 1:
            raise ValueError('No available provider slots remain after reserves.')
        if not a.builder.strip() or not a.reviewer.strip() or a.builder == a.reviewer:
            raise ValueError('Builder and independent reviewer must name different nonempty models.')
        units = load_units(a.units)
        out = Path(a.out_dir).expanduser().resolve()
        if out.suffix.lower() in ('.json', '.js', '.mjs', '.jsonl'):
            raise ValueError(f'--out-dir takes a DIRECTORY, not a filename: {out}. Use a folder such as {out.parent / "generated-workflows"}; the generator creates launch-01.json inside it. Existing files/directories were not changed.')
        if out.exists() and not out.is_dir():
            raise ValueError(f'Output path is an existing file: {out}. Choose a directory.')
        planned = [(out / 'run-root.json', json.dumps({'run_root': str(run_root), 'program': a.program}, indent=2) + '\n')]
        slices = []
        for index, start in enumerate(range(0, len(units), cap), 1):
            chunk = units[start:start + cap]
            name = slice_name(a.program, a.wave, a.phase, chunk)
            if not NAME_RE.match(name):
                raise ValueError(f'Computed workflow name {name!r} does not match the required pattern {NAME_RE.pattern}. Check --program, --wave, --phase and the unit ids.')
            ready = len(units) - start
            reason = a.dependency_reason.strip() or ('Final slice has fewer ready units' if ready < cap else '')
            meta = {'name': name, 'description': slice_description(chunk), 'phases': [{'title': 'Build'}, {'title': 'QC'}]}
            embedded = {'units': chunk, 'guard': {'readyUnits': ready, 'providerSlots': cap, 'dependencyReason': reason, 'runRoot': str(run_root)}}
            script = '// workflow-guard self-contained v2; launch with scriptPath only.\n// dep= width is min(ready units, host ceiling, provider allocation minus reserve); see INPUT.guard.\nexport const meta = ' + json.dumps(meta) + ';\nconst INPUT = ' + json.dumps(embedded, ensure_ascii=True) + ';\n' + TEMPLATE.replace('BUILDER', json.dumps(a.builder)).replace('REVIEWER', json.dumps(a.reviewer))
            check = subprocess.run([NODE, str(ROOT / 'validate.mjs')], input=json.dumps({'script': script}), text=True, capture_output=True, timeout=15)
            try:
                verdict = json.loads(check.stdout)
            except ValueError as exc:
                raise ValueError('Validator did not return a JSON verdict. Check Node and the installed Acorn dependency.') from exc
            if check.returncode or not verdict.get('ok'):
                raise ValueError('Generated workflow failed preflight: ' + '; '.join(verdict.get('errors', [])))
            target = out / f'workflow-{index:02}.js'
            launch = {'scriptPath': str(target)}
            planned.extend([(target, script), (out / f'launch-{index:02}.json', json.dumps(launch, indent=2) + '\n')])
            slices.append({'index': index, 'target': target, 'name': name, 'lanes': len(chunk), 'dirs': [str(run_root / 'lanes' / (u['id'] + '-lane')) for u in chunk]})
        # Validate the entire batch and all destinations before writing anything.
        for target, contents in planned:
            if target.exists() and (not target.is_file() or target.read_text() != contents):
                raise ValueError(f'Refusing to overwrite a different existing artifact: {target}. Choose a new --out-dir so a running workflow is preserved.')
        out.mkdir(parents=True, exist_ok=True)
        for target, contents in planned:
            temporary = target.with_name(target.name + f'.{os.getpid()}.tmp')
            temporary.write_text(contents, encoding='utf-8')
            temporary.chmod(0o600)
            temporary.replace(target)
        register_program(run_root, a.program, [(r['name'], r['dirs']) for r in slices])
        for row in slices:
            print(json.dumps({'launch': {'scriptPath': str(row['target'])}, 'launchInput': str(out / f'launch-{row["index"]:02}.json'), 'name': row['name'], 'maximumConcurrentAgents': row['lanes'], 'runRoot': str(run_root), 'status': 'VALIDATED_NOT_LAUNCHED'}))
        for row in slices:
            print(f'LAUNCH: call the Workflow tool with exactly {{"scriptPath": "{row["target"]}"}} (nothing else). Then open /workflows, confirm the name "{row["name"]}" shows {row["lanes"]} lanes, and record the Task ID and Run ID in the ledger.')
        return 0
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        p.error(str(exc))


if __name__ == '__main__':
    sys.exit(main())
