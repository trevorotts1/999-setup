"""Generator and validator tests for enforced workflow naming, lane caps and run-root sidecars."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE = os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or '/opt/homebrew/bin/node'


class GeneratorTests(unittest.TestCase):
 def setUp(self):
  self.tmp = tempfile.TemporaryDirectory()
  self.path = Path(self.tmp.name)
  self.run_root = self.path / 'run'
  self.run_root.mkdir()

 def tearDown(self):
  self.tmp.cleanup()

 def env(self, extra=None):
  e = {**os.environ}
  e.pop('WORKFLOW_GUARD_CAP', None)
  if extra:
   e.update(extra)
  return e

 def units(self, count=23, prefix='SKR', titles=True):
  rows = []
  for i in range(1, count + 1):
   unit = {'id': f'{prefix}-{i:03}', 'prompt': 'build it', 'qcPrompt': 'check it', 'ownership': f'file-{i}'}
   if titles:
    unit['title'] = f'Finding {i} title'
   rows.append(unit)
  return rows

 def std(self, program='pres', wave='2'):
  return ['--program', program, '--wave', wave, '--run-root', str(self.run_root)]

 def gen(self, units, *flags, out='gen', env=None):
  f = self.path / 'units.json'
  f.write_text(json.dumps(units))
  argv = ['python3', str(ROOT / 'make-workflow.py'), '--units', str(f), '--out-dir', str(self.path / out), '--provider-slots', '10', *flags]
  return subprocess.run(argv, capture_output=True, text=True, env=self.env(env))

 def rows(self, result):
  return [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]

 def launches(self, result):
  return [line for line in result.stdout.splitlines() if line.startswith('LAUNCH:')]

 def meta_of(self, out, index=1):
  text = (self.path / out / f'workflow-{index:02}.js').read_text()
  line = next(x for x in text.splitlines() if x.startswith('export const meta = '))
  return json.loads(line[len('export const meta = '):].rstrip(';'))

 def helper(self):
  import importlib.util
  spec = importlib.util.spec_from_file_location('staffing_h', ROOT / 'staffing.py')
  m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  return m.WINDOW_HELPER

 def validate(self, script, args=None, env=None):
  p = subprocess.run([NODE, str(ROOT / 'validate.mjs')], input=json.dumps({'script': script, 'args': args, 'windowHelper': self.helper()}), capture_output=True, text=True, env=self.env(env))
  self.assertEqual(p.returncode, 0, p.stderr)
  return json.loads(p.stdout)

 def test_twenty_three_units_partition_with_enforced_names(self):
  r = self.gen(self.units(), *self.std())
  self.assertEqual(r.returncode, 0, r.stderr)
  rows = self.rows(r)
  self.assertEqual([x['maximumConcurrentAgents'] for x in rows], [10, 10, 3])
  self.assertEqual([x['name'] for x in rows], [
   'pres-W2-build+qc-SKR001..SKR010-10L',
   'pres-W2-build+qc-SKR011..SKR020-10L',
   'pres-W2-build+qc-SKR021..SKR023-3L',
  ])
  self.assertEqual(self.meta_of('gen', 1)['name'], 'pres-W2-build+qc-SKR001..SKR010-10L')
  self.assertEqual(self.meta_of('gen', 3)['name'], 'pres-W2-build+qc-SKR021..SKR023-3L')
  for index in (1, 2, 3):
   self.assertTrue(self.validate((self.path / 'gen' / f'workflow-{index:02}.js').read_text())['ok'])

 def test_description_is_the_finding_titles(self):
  self.assertEqual(self.gen(self.units(), *self.std()).returncode, 0)
  self.assertEqual(self.meta_of('gen', 1)['description'], '; '.join(f'Finding {i} title' for i in range(1, 11))[:300])
  self.assertEqual(self.meta_of('gen', 3)['description'], 'Finding 21 title; Finding 22 title; Finding 23 title')

 def test_description_falls_back_to_ids_without_titles(self):
  self.assertEqual(self.gen(self.units(3, titles=False), *self.std()).returncode, 0)
  self.assertEqual(self.meta_of('gen', 1)['description'], 'SKR-001; SKR-002; SKR-003')

 def test_single_unit_name_omits_the_span(self):
  r = self.gen(self.units(1, prefix='ONB'), '--program', 'rr', '--wave', '4', '--phase', 'merge', '--run-root', str(self.run_root))
  self.assertEqual(r.returncode, 0, r.stderr)
  self.assertEqual(self.rows(r)[0]['name'], 'rr-W4-merge-ONB001-1L')

 def test_bad_unit_id_rejected(self):
  units = self.units(3)
  units[1]['id'] = '1'
  r = self.gen(units, *self.std())
  self.assertNotEqual(r.returncode, 0)
  self.assertIn('finding ID', r.stderr)
  self.assertNotIn('Traceback', r.stderr)
  self.assertFalse((self.path / 'gen').exists())

 def test_bad_program_slug_rejected(self):
  r = self.gen(self.units(2), '--program', 'Pres-045', '--wave', '1', '--run-root', str(self.run_root))
  self.assertNotEqual(r.returncode, 0)
  self.assertIn('--program', r.stderr)
  self.assertNotIn('Traceback', r.stderr)

 def test_legacy_name_flag_rejected(self):
  r = self.gen(self.units(2), *self.std(), '--name', 'visible-unit-pipeline')
  self.assertEqual(r.returncode, 2)
  self.assertIn('use --program/--wave/--phase', r.stderr)
  self.assertFalse((self.path / 'gen').exists())

 def test_missing_run_root_rejected(self):
  r = self.gen(self.units(2), '--program', 'pres', '--wave', '2')
  self.assertEqual(r.returncode, 2)
  self.assertIn('--run-root', r.stderr)
  self.assertFalse((self.path / 'gen').exists())

 def test_run_root_sidecar_written(self):
  self.assertEqual(self.gen(self.units(2), *self.std()).returncode, 0)
  sidecar = json.loads((self.path / 'gen' / 'run-root.json').read_text())
  self.assertEqual(sidecar, {'run_root': str(self.run_root.resolve()), 'program': 'pres'})

 def test_host_cap_env_limits_lanes(self):
  r = self.gen(self.units(), *self.std(), env={'WORKFLOW_GUARD_CAP': '4'})
  self.assertEqual(r.returncode, 0, r.stderr)
  rows = self.rows(r)
  self.assertEqual([x['maximumConcurrentAgents'] for x in rows], [4, 4, 4, 4, 4, 3])
  self.assertEqual(rows[0]['name'], 'pres-W2-build+qc-SKR001..SKR004-4L')
  self.assertEqual(rows[5]['name'], 'pres-W2-build+qc-SKR021..SKR023-3L')

 def test_launch_block_printed_for_every_slice(self):
  r = self.gen(self.units(), *self.std())
  lines = self.launches(r)
  self.assertEqual(len(lines), 3)
  self.assertEqual(lines[0], 'LAUNCH: call the Workflow tool with exactly {"scriptPath": "%s"} (nothing else). Then open /workflows, confirm the name "pres-W2-build+qc-SKR001..SKR010-10L" shows 10 lanes, and record the Task ID and Run ID in the ledger.' % (self.path.resolve() / 'gen' / 'workflow-01.js'))

 def test_validator_rejects_a_nonconforming_name(self):
  self.assertEqual(self.gen(self.units(2), *self.std()).returncode, 0)
  script = (self.path / 'gen' / 'workflow-01.js').read_text().replace('pres-W2-build+qc-SKR001..SKR002-2L', 'visible-unit-pipeline-01')
  verdict = self.validate(script)
  self.assertFalse(verdict['ok'])
  self.assertTrue(any('does not match the required pattern' in e and 'pres-W2-build+qc-SKR012..SKR019-8L' in e for e in verdict['errors']), verdict['errors'])

 def test_validator_rejects_a_lane_count_mismatch(self):
  self.assertEqual(self.gen(self.units(2), *self.std()).returncode, 0)
  script = (self.path / 'gen' / 'workflow-01.js').read_text().replace('SKR001..SKR002-2L', 'SKR001..SKR002-9L')
  verdict = self.validate(script)
  self.assertFalse(verdict['ok'])
  self.assertIn('name claims 9 lanes, script has 2', verdict['errors'])


 def plan_gen(self, specs, wid, extra=()):
  import importlib.util
  spec = importlib.util.spec_from_file_location('staffing_t', ROOT / 'staffing.py')
  st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)
  proj = self.path / 'planproj'; proj.mkdir(exist_ok=True)
  st._mkplan(proj, specs)
  argv = ['python3', str(ROOT / 'make-workflow.py'), '--plan', str(proj / 'SWARM-PLAN.json'), '--workflow-id', wid, '--out-dir', str(self.path / 'pg'), *extra]
  return st, proj, subprocess.run(argv, capture_output=True, text=True, env=self.env())

 def test_plan_mode_launch_satisfies_the_launch_contract(self):
  st, proj, r = self.plan_gen({'W0-01': 12, 'W0-02': 3}, 'W0-01')
  self.assertEqual(r.returncode, 0, r.stderr)
  row = json.loads(r.stdout.splitlines()[0])
  self.assertEqual((row['agentCount'], row['units']), (10, 12))
  launch = json.loads((self.path / 'pg' / 'launch-W0-01.json').read_text())
  self.assertEqual(launch['args']['workflowId'], 'W0-01')
  self.assertEqual([u['unit_id'] for u in launch['args']['units']], ['W0-01-U%d' % k for k in range(1, 13)])
  script = Path(launch['scriptPath']).read_text()
  self.assertIn('pipeline(args.units', script)
  self.assertIn("model:", script)
  self.assertTrue(self.validate(script, launch['args'])['ok'])
  state = self.path / 'gstate'; state.mkdir()
  ok, msg = st.check_launch({'scriptPath': launch['scriptPath'], 'args': launch['args']}, proj, session='t', state_dir=state, reap=False)
  self.assertTrue(ok, msg)
  # a launch that drops a unit is refused by the same contract
  short = dict(launch['args'], units=launch['args']['units'][:-1])
  ok, msg = st.check_launch({'scriptPath': launch['scriptPath'], 'args': short}, proj, session='t', state_dir=state, reap=False)
  self.assertFalse(ok); self.assertIn('plans exactly 12', msg)

 def test_plan_mode_cap_6_with_8_units_never_exceeds_6(self):
  import importlib.util
  spec = importlib.util.spec_from_file_location('staffing_t2', ROOT / 'staffing.py')
  st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)
  proj = self.path / 'cap6'; proj.mkdir()
  st._mkplan(proj, {'W6-01': 8}, cap=6)
  argv = ['python3', str(ROOT / 'make-workflow.py'), '--plan', str(proj / 'SWARM-PLAN.json'), '--workflow-id', 'W6-01', '--out-dir', str(self.path / 'pg6')]
  r = subprocess.run(argv, capture_output=True, text=True, env=self.env())
  self.assertEqual(r.returncode, 0, r.stderr)
  row = json.loads(r.stdout.splitlines()[0]); self.assertEqual((row['agentCount'], row['units']), (6, 8))
  launch = json.loads((self.path / 'pg6' / 'launch-W6-01.json').read_text())
  self.assertTrue(launch['args']['attemptId'].startswith('W6-01-'))
  script = Path(launch['scriptPath']).read_text()
  self.assertIn('const WG_WINDOW = 6;', script); self.assertEqual(script.count('wgSlot(() => agent('), 2)
  self.assertIn('-6L', script)
  for needle in ('builder_model', 'reviewer_model', 'attempt_id', 'unit_id'):
   self.assertIn(needle, script)
  self.assertTrue(self.validate(script, launch['args'], {'WORKFLOW_GUARD_CAP': '6'})['ok'])
  self.assertFalse(self.validate(script, launch['args'], {'WORKFLOW_GUARD_CAP': '4'})['ok'])
  ok, msg = st.check_launch({'scriptPath': launch['scriptPath'], 'args': launch['args']}, proj, session='t', state_dir=self.path / 's6', reap=False, record=False)
  self.assertTrue(ok, msg)
  # without the window the same 8 units cannot be shown to respect cap 6, and the message names make-workflow.py
  bare = script.replace('wgSlot(() => agent(', 'agent(').replace('})),', '}),').replace('}));', '});')
  bare = bare.split('const WG_WINDOW', 1)[0] + bare[bare.index('const RESULT'):]
  (self.path / 'bare.js').write_text(bare)
  ok, msg = st.check_launch({'scriptPath': str(self.path / 'bare.js'), 'args': launch['args']}, proj, session='t', state_dir=self.path / 's6', reap=False, record=False)
  self.assertFalse(ok); self.assertIn('per-workflow cap of 6', msg); self.assertIn('make-workflow.py', msg)
  # run the generated script under a mock runtime with an UNBOUNDED pipeline: the window alone must hold peak <= 6
  src = script.replace('export const meta', 'const meta')
  js = ("import vm from 'node:vm';let active=0,peak=0,n=0;"
        "const ctx=vm.createContext({args:%s,log(){},pipeline:(items,...stages)=>Promise.all(items.map(async item=>{let prev=item;for(const s of stages){prev=await s(prev,item);}return prev;})),"
        "agent:async(p,o)=>{active++;peak=Math.max(peak,active);n++;await new Promise(r=>setTimeout(r,5));active--;return {id:o.label.split(':')[1],status:'PASS',evidence:'x'};}});"
        "const res=await new vm.Script('(async()=>{'+%s+'})()').runInContext(ctx,{timeout:5000});"
        "console.log(JSON.stringify({peak,n,complete:res.complete}));") % (json.dumps(launch['args']), json.dumps(src))
  (self.path / 'run.mjs').write_text(js)
  p = subprocess.run([NODE, str(self.path / 'run.mjs')], capture_output=True, text=True)
  self.assertEqual(p.returncode, 0, p.stderr)
  out = json.loads(p.stdout); self.assertEqual((out['peak'], out['n'], out['complete']), (6, 16, True))

 def test_plan_mode_small_workflow_agent_count_is_unit_count(self):
  st, proj, r = self.plan_gen({'W0-01': 3}, 'W0-01')
  self.assertEqual(r.returncode, 0, r.stderr)
  self.assertEqual(json.loads(r.stdout.splitlines()[0])['agentCount'], 3)

 def test_plan_mode_rejects_unknown_workflow_id(self):
  st, proj, r = self.plan_gen({'W0-01': 3}, 'W9-99')
  self.assertNotEqual(r.returncode, 0); self.assertIn('not a workflow', r.stderr)
  self.assertFalse((self.path / 'pg').exists())

 def test_mock_runtime_runs_from_a_path_containing_a_space(self):
  space = self.path / 'dir with space' / 'workflow-guard'
  space.mkdir(parents=True)
  for name in ('make-workflow.py', 'validate.mjs', 'test-runtime.mjs'):
   shutil.copy2(ROOT / name, space / name)
  os.symlink(ROOT / 'node_modules', space / 'node_modules')
  r = subprocess.run([NODE, str(space / 'test-runtime.mjs')], capture_output=True, text=True, cwd=str(space), env=self.env())
  self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
  self.assertEqual(r.stdout.count('PASS mock runtime'), 2)


if __name__ == '__main__':
 unittest.main(verbosity=2)
