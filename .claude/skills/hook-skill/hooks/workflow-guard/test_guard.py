import importlib.util,json,os,shutil,sqlite3,subprocess,tempfile,time,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NODE=os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''
class GuardTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)
  self.env={**os.environ,'WORKFLOW_GUARD_STATE':str(self.path/'state')}
  self.env.pop('SKILL_REVIEW_TEST_MODE',None)
 def tearDown(self):self.tmp.cleanup()
 def validate(self,s,args=None):
  p=subprocess.run([NODE,str(ROOT/'validate.mjs')],input=json.dumps({'script':s,'args':args}),capture_output=True,text=True,check=True)
  return json.loads(p.stdout)
 def name(self,lanes=10):return 'tg-W1-build+qc-SKR001..SKR099-%dL'%lanes
 def script(self,lanes=10):return "export const meta={name:'"+self.name(lanes)+"',description:'test',phases:[{title:'Build'},{title:'QC'}]};\nlog('SCRATCH ISOLATION lanes/<UNIT-ID>-<box-slug>/');\nconst r=await pipeline(args.units,u=>agent(u.prompt,{model:'opus',phase:'Build',label:'build:'+u.id}), (b,u)=>agent(u.prompt,{model:'sonnet',phase:'QC',label:'qc:'+u.id}));return r;"
 def args(self,n=10):return {'units':[{'id':'SKR-%03d'%i,'prompt':'test'} for i in range(n)]}
 def hook(self,payload):return subprocess.run(['python3',str(ROOT/'guard.py'),'hook'],input=json.dumps(payload),capture_output=True,text=True,env=self.env)
 def test_ten_parallel_lanes_twenty_lifetime_calls(self):
  r=self.validate(self.script(),self.args());self.assertTrue(r['ok'],r);self.assertEqual(r['conservativePeak'],10)
 def test_eleven_rejected(self):self.assertFalse(self.validate(self.script(11),self.args(11))['ok'])
 def test_missing_phase(self):self.assertFalse(self.validate(self.script().replace("phase:'Build',",''),self.args())['ok'])
 def test_mismatched_phase(self):self.assertFalse(self.validate(self.script().replace("phase:'Build'","phase:'Hidden'"),self.args())['ok'])
 def test_missing_model(self):self.assertFalse(self.validate(self.script().replace("model:'opus',",''),self.args())['ok'])
 def test_syntax_error(self):self.assertFalse(self.validate(self.script()+'log((; ',self.args())['ok'])
 def test_string_decoy(self):self.assertTrue(self.validate(self.script()+"log('agent(bad phase: bad)');",self.args())['ok'])
 def test_unknown_items(self):self.assertFalse(self.validate(self.script(),{})['ok'])
 def test_two_parallel_pipelines_sum(self):self.assertFalse(self.validate(self.script().replace('return r;','')+"const t=pipeline(args.units,u=>agent(u.prompt,{model:'opus',phase:'Build',label:'b'}));",self.args())['ok'])
 def test_nested_workflow(self):self.assertFalse(self.validate(self.script()+"await workflow('child');",self.args())['ok'])
 def test_opaque_callback(self):self.assertFalse(self.validate(self.script()+"args.units.forEach(u=>agent('x',{model:'opus',phase:'Build',label:'b'}));",self.args())['ok'])
 def test_underfill(self):
  args=self.args(2);args['guard']={'readyUnits':10,'providerSlots':10};self.assertFalse(self.validate(self.script(2),args)['ok'])
  args['guard']['dependencyReason']='Eight units depend on these two';self.assertTrue(self.validate(self.script(2),args)['ok'])
 def test_provider_cap(self):
  args=self.args(4);args['guard']={'providerSlots':3};self.assertFalse(self.validate(self.script(4),args)['ok'])
 def test_snapshot_matches_validation_and_preserves_input(self):
  r=self.hook({'tool_name':'Workflow','tool_input':{'script':self.script(),'args':self.args()},'session_id':'test','tool_use_id':'test1'})
  self.assertEqual(r.returncode,0,r.stderr);o=json.loads(r.stdout)['hookSpecificOutput'];self.assertEqual(o['updatedInput']['script'],self.script());self.assertEqual(o['updatedInput']['args'],self.args());self.assertNotIn('permissionDecision',o)
 def test_missing_file_rejected(self):self.assertEqual(self.hook({'tool_name':'Workflow','tool_input':{'scriptPath':'/does-not-exist'}}).returncode,2)
 def test_non_workflow_untouched(self):self.assertEqual(self.hook({'tool_name':'Read','tool_input':{}}).stdout,'')
 def test_watchdog_stale_recovery_and_resolution(self):
  os.environ['WORKFLOW_GUARD_STATE']=str(self.path/'state')
  spec=importlib.util.spec_from_file_location('guard',ROOT/'guard.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
  j=self.path/'journal.jsonl';j.write_text(json.dumps({'type':'started','key':'a'})+'\n');now=time.time();os.utime(j,(now-700,now-700))
  with g.db() as c:c.execute('INSERT INTO watches VALUES(?,?,?,?,?,?)',(str(j),'test',now,'','OBSERVING',''))
  a=g.tick(now);self.assertEqual(a[0]['state'],'STALE_REVIEW_REQUIRED');self.assertEqual(len(g.tick(now+1)),1)
  with j.open('a') as f:f.write(json.dumps({'type':'heartbeat'})+'\n')
  self.assertEqual(g.tick(now+2)[0]['state'],'STALE_REVIEW_REQUIRED')
  with j.open('a') as f:f.write(json.dumps({'type':'result','key':'a'})+'\n')
  self.assertEqual(g.tick(now+2),[])
  with g.db() as c:self.assertEqual(c.execute('SELECT state FROM watches').fetchone()[0],'AGENTS_RETURNED')
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_stop_loop_guard(self):
  d=self.path/'state';d.mkdir();(d/'alerts.json').write_text(json.dumps({'alerts':[{'session':'test','workflow':'w1','state':'STALE_REVIEW_REQUIRED'}]}))
  p={'hook_event_name':'Stop','session_id':'test','stop_hook_active':False}
  r=self.hook(p);self.assertEqual(json.loads(r.stdout)['decision'],'block');self.assertEqual(self.hook(p).stdout,'')
 def test_verified_cancellation_is_terminal(self):
  self.hook({'tool_name':'Workflow','tool_input':{'script':self.script(),'args':self.args()},'session_id':'test','tool_use_id':'test1'})
  self.hook({'hook_event_name':'PostToolUse','tool_name':'Workflow','session_id':'test','tool_use_id':'test1','tool_response':{'taskId':'wka7c9bxn','runId':'wf_60e1d071-a35'}})
  self.hook({'hook_event_name':'PostToolUse','tool_name':'TaskStop','session_id':'test','tool_input':{'task_id':'wka7c9bxn'},'tool_response':{'message':'Successfully stopped task: wka7c9bxn'}})
  import sqlite3
  c=sqlite3.connect(self.path/'state/guard.sqlite3');self.assertEqual(c.execute('SELECT state FROM launches').fetchone()[0],'CANCELLED')
 def test_poll_timeout_capped(self):
  r=self.hook({'hook_event_name':'PreToolUse','tool_name':'TaskOutput','tool_input':{'task_id':'wtest1234','timeout':300000,'block':True}})
  self.assertEqual(json.loads(r.stdout)['hookSpecificOutput']['updatedInput']['timeout'],60000)
 def test_structured_native_receipt(self):
  self.hook({'tool_name':'Workflow','tool_input':{'script':self.script(),'args':self.args()},'session_id':'test','tool_use_id':'test1'})
  self.hook({'hook_event_name':'PostToolUse','tool_name':'Workflow','session_id':'test','tool_use_id':'test1','tool_response':{'taskId':'wka7c9bxn','runId':'wf_60e1d071-a35','status':'running'}})
  import sqlite3
  c=sqlite3.connect(self.path/'state/guard.sqlite3');state,receipt=c.execute('SELECT state,receipt FROM launches').fetchone();self.assertEqual(state,'RETURNED');self.assertEqual(json.loads(receipt)['task_id'],'wka7c9bxn')
 def test_roster_mutation_rejected(self):
  self.assertFalse(self.validate(self.script()+"args.units.push({id:'extra'});",self.args())['ok'])
 def test_helper_alias_rejected(self):
  self.assertFalse(self.validate(self.script()+"const a=agent;",self.args())['ok'])
 def test_factory_partitions_and_validates(self):
  u=[{'id':'SKR-%03d'%i,'prompt':'build','qcPrompt':'check','ownership':f'file-{i}'} for i in range(23)];f=self.path/'units.json';f.write_text(json.dumps(u))
  r=subprocess.run(['python3',str(ROOT/'make-workflow.py'),'--units',str(f),'--out',str(self.path/'out'),'--provider-slots','10',*self.program_flags()],capture_output=True,text=True)
  self.assertEqual(r.returncode,0,r.stderr);rows=[json.loads(x) for x in r.stdout.splitlines() if x.startswith('{')];self.assertEqual([x['maximumConcurrentAgents'] for x in rows],[10,10,3])
 def generate(self,value,out_name='generated',extra=None):
  f=self.path/'input.json';f.write_text(json.dumps(value))
  return subprocess.run(['python3',str(ROOT/'make-workflow.py'),'--units',str(f),'--out-dir',str(self.path/out_name),'--provider-slots','10',*self.program_flags(),*(extra or [])],capture_output=True,text=True)
 def program_flags(self):return ['--program','tg','--wave','1','--run-root',str(self.path/'runroot')]
 def good_units(self):return [{'id':'SKR-001','prompt':'build \"quoted\" text with $dollar and `backticks`','qcPrompt':'check','ownership':'file-one'}]
 def test_generator_accepts_units_object_without_extraction(self):
  r=self.generate({'guard':{},'units':self.good_units()});self.assertEqual(r.returncode,0,r.stderr)
  launch=json.loads((self.path/'generated/launch-01.json').read_text());self.assertEqual(set(launch),{'scriptPath'})
  code=Path(launch['scriptPath']).read_text();self.assertNotIn('args.units',code);self.assertTrue(self.validate(code)['ok'])
  self.assertEqual(self.hook({'tool_name':'Workflow','tool_input':launch}).returncode,0)
 def test_generator_accepts_existing_launch_object(self):self.assertEqual(self.generate({'args':{'units':self.good_units()}}).returncode,0)
 def test_generator_rejects_filename_output_before_creating_it(self):
  r=self.generate(self.good_units(),'launch-01.json');self.assertNotEqual(r.returncode,0);self.assertIn('DIRECTORY',r.stderr);self.assertFalse((self.path/'launch-01.json').exists());self.assertNotIn('Traceback',r.stderr)
 def test_generator_missing_input_is_actionable(self):
  r=subprocess.run(['python3',str(ROOT/'make-workflow.py'),'--units',str(self.path/'missing.json'),'--out-dir',str(self.path/'out'),'--provider-slots','10',*self.program_flags()],capture_output=True,text=True)
  self.assertNotEqual(r.returncode,0);self.assertIn('Cannot read',r.stderr);self.assertNotIn('Traceback',r.stderr)
 def test_generator_preserves_different_existing_artifacts(self):
  self.assertEqual(self.generate(self.good_units()).returncode,0);f=self.path/'generated/workflow-01.js';before=f.read_text();u=self.good_units();u[0]['prompt']='different'
  r=self.generate(u);self.assertNotEqual(r.returncode,0);self.assertEqual(f.read_text(),before)
 def test_generator_idempotent_repeat(self):
  self.assertEqual(self.generate(self.good_units()).returncode,0);self.assertEqual(self.generate(self.good_units()).returncode,0)
 def test_legacy_string_arguments_normalized(self):
  r=self.hook({'tool_name':'Workflow','tool_input':{'script':self.script(),'args':json.dumps(self.args())}})
  self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(r.stdout)['hookSpecificOutput']['updatedInput']['args'],self.args())
 def test_malformed_string_arguments_rejected(self):
  r=self.hook({'tool_name':'Workflow','tool_input':{'script':self.script(),'args':'{bad'}})
  self.assertEqual(r.returncode,2);self.assertIn('invalid JSON text',r.stderr)
 def test_legacy_missing_arguments_recovered_only_from_matching_sidecar(self):
  f=self.path/'workflow-01.js';f.write_text(self.script());side=self.path/'launch-01.json';side.write_text(json.dumps({'scriptPath':str(f),'args':self.args()}))
  r=self.hook({'tool_name':'Workflow','tool_input':{'scriptPath':str(f)}});self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(r.stdout)['hookSpecificOutput']['updatedInput']['args'],self.args())
  side.write_text(json.dumps({'scriptPath':str(self.path/'different.js'),'args':self.args()}))
  self.assertEqual(self.hook({'tool_name':'Workflow','tool_input':{'scriptPath':str(f)}}).returncode,2)
 def load(self,name):
  os.environ['WORKFLOW_GUARD_STATE']=str(self.path/'state')
  spec=importlib.util.spec_from_file_location(name,ROOT/'guard.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
  return g
 def stage(self,g,run,launch_state,roots=('wfroot',)):
  import sqlite3
  now=time.time();paths=[]
  for root in roots:
   j=self.path/root/run/'journal.jsonl';j.parent.mkdir(parents=True,exist_ok=True)
   j.write_text(json.dumps({'type':'started','key':'a'})+'\n');os.utime(j,(now-700,now-700));paths.append(str(j))
  c=g.db()
  for jp in paths:c.execute('INSERT INTO watches VALUES(?,?,?,?,?,?)',(jp,'s1',now,'','OBSERVING',''))
  c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)',('l1','s1','',now,'h',launch_state,'n',1,json.dumps({'run_id':run})))
  c.commit();c.close();return now
 def test_terminal_launch_resolves_residue_watch(self):
  g=self.load('guard_term');now=self.stage(g,'wf_terminal-01','RETURNED')
  self.assertEqual(g.tick(now),[])
  c=g.db();row=c.execute('SELECT state,detail FROM watches').fetchone();c.close()
  self.assertEqual(row[0],'RESOLVED');d=json.loads(row[1])
  self.assertEqual(d['launch_state'],'RETURNED');self.assertEqual(d['prior_state'],'STALE_REVIEW_REQUIRED')
  self.assertIn('seconds_without_journal_progress',d['prior_evidence'])
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_cancelled_launch_resolves_residue_watch(self):
  g=self.load('guard_canc');now=self.stage(g,'wf_cancel-01','CANCELLED')
  self.assertEqual(g.tick(now),[])
  c=g.db();self.assertEqual(c.execute('SELECT state FROM watches').fetchone()[0],'RESOLVED');c.close()
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_active_launch_still_alerts(self):
  g=self.load('guard_act');now=self.stage(g,'wf_active-01','VALIDATED')
  self.assertEqual(g.tick(now)[0]['state'],'STALE_REVIEW_REQUIRED')
  c=g.db();self.assertEqual(c.execute('SELECT state FROM watches').fetchone()[0],'STALE_REVIEW_REQUIRED');c.close()
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_duplicate_project_roots_deduped(self):
  g=self.load('guard_dedup');now=self.stage(g,'wf_dupe-01','VALIDATED',roots=('claude','claude-nine'))
  c=g.db();self.assertEqual(c.execute('SELECT count(*) FROM watches').fetchone()[0],2);c.close()
  alerts=g.tick(now)
  self.assertEqual(len(alerts),1)
  report=json.loads((self.path/'state/alerts.json').read_text());self.assertEqual(len(report['alerts']),1)
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 # ---- Enforcement: retry cap, model canary, continuation cap, fence, runtime peak ----
 def hook_env(self,payload,env):return subprocess.run(['python3',str(ROOT/'guard.py'),'hook'],input=json.dumps(payload),capture_output=True,text=True,env=env)
 def raw_hook(self,text,env=None):return subprocess.run(['python3',str(ROOT/'guard.py'),'hook'],input=text,capture_output=True,text=True,env=env or self.env)
 def cli(self,*a,env=None):return subprocess.run(['python3',str(ROOT/'guard.py'),*a],capture_output=True,text=True,env=env or self.env)
 def pre(self,tool,tool_input,session='canary',**extra):return self.hook({'hook_event_name':'PreToolUse','tool_name':tool,'tool_input':tool_input,'session_id':session,**extra})
 def alerts_file(self,session,workflow):
  d=self.path/'state';d.mkdir(parents=True,exist_ok=True)
  (d/'alerts.json').write_text(json.dumps({'checked_at':time.time(),'alerts':[{'session':session,'workflow':workflow,'state':'STALE_REVIEW_REQUIRED'}]}))
 def test_unparsed_counter_and_model_canary(self):
  for i in range(4):self.assertEqual(self.pre('Read',{'file_path':'/tmp/f%d'%i}).returncode,0)
  self.assertEqual(self.pre('Read',{'file_path':'/tmp/bad','__unparsedToolInput':'{"file_p'}).returncode,0)
  c=json.loads(self.cli('canary','--session','canary').stdout)
  self.assertEqual((c['session'],c['total'],c['unparsed']),('canary',5,1));self.assertGreater(c['rate'],0.02)
  r=self.pre('Workflow',{'script':self.script(),'args':self.args()})
  self.assertEqual(r.returncode,2,r.stdout);self.assertIn('conductor seat',r.stderr);self.assertIn('threshold 2 percent',r.stderr)
 def test_canary_silent_below_threshold(self):
  for i in range(60):self.assertEqual(self.pre('Read',{'file_path':'/tmp/f%d'%i}).returncode,0)
  c=json.loads(self.cli('canary','--session','canary').stdout)
  self.assertEqual((c['total'],c['unparsed']),(60,0))
  self.assertEqual(self.pre('Workflow',{'script':self.script(),'args':self.args()}).returncode,0)
 def test_retry_cap_denies_third_identical_failed_call(self):
  ti={'command':'node /does/not/exist.mjs'}
  self.assertEqual(self.pre('Bash',ti,'retry').returncode,0)
  self.hook({'hook_event_name':'PostToolUseFailure','tool_name':'Bash','tool_input':ti,'session_id':'retry','tool_response':{'stderr':'MODULE_NOT_FOUND sk-live-abcdefg'}})
  self.assertEqual(self.pre('Bash',ti,'retry').returncode,0)
  self.hook({'hook_event_name':'PostToolUseFailure','tool_name':'Bash','tool_input':ti,'session_id':'retry','tool_response':{'stderr':'MODULE_NOT_FOUND again sk-live-abcdefg and key=hunter2'}})
  r=self.pre('Bash',ti,'retry')
  self.assertEqual(r.returncode,2);self.assertIn('Third identical attempt',r.stderr);self.assertIn('Fingerprint ',r.stderr)
  self.assertEqual(self.pre('Bash',{'command':'node /other.mjs'},'retry').returncode,0)
  c=sqlite3.connect(self.path/'state/guard.sqlite3')
  stored=c.execute("SELECT last_error FROM failures WHERE session='retry' AND tool='Bash'").fetchone()[0];c.close()
  self.assertNotIn('sk-live-abcdefg',stored);self.assertIn('<redacted>',stored)
 def test_user_prompt_resets_and_stop_latch(self):
  self.alerts_file('latch','w1')
  self.assertEqual(self.hook({'hook_event_name':'UserPromptSubmit','session_id':'latch','prompt':'STOP ALL WORK','source':'user'}).returncode,0)
  s=self.hook({'hook_event_name':'Stop','session_id':'latch','stop_hook_active':False})
  self.assertEqual((s.returncode,s.stdout),(0,''))
  r=self.pre('Agent',{'prompt':'go'},'latch')
  self.assertEqual(r.returncode,2);self.assertIn('stop order',r.stderr)
  self.hook({'hook_event_name':'UserPromptSubmit','session_id':'latch','prompt':'carry on','source':'user'})
  self.assertEqual(self.pre('Agent',{'prompt':'go'},'latch').returncode,0)
  self.hook({'hook_event_name':'UserPromptSubmit','session_id':'latch','prompt':'please stop now','source':'loop_wakeup'})
  self.assertEqual(self.pre('Agent',{'prompt':'go'},'latch').returncode,0)  # machine traffic never arms the latch
 def test_continuation_cap_stops_blocking_at_three(self):
  for n,w in enumerate(('w1','w2','w3'),start=1):
   self.alerts_file('cont',w)
   r=self.hook({'hook_event_name':'Stop','session_id':'cont','stop_hook_active':False})
   self.assertEqual(json.loads(r.stdout)['decision'],'block',w)
   c=sqlite3.connect(self.path/'state/guard.sqlite3')
   self.assertEqual(c.execute("SELECT count FROM continuations WHERE session='cont'").fetchone()[0],n);c.close()
  self.alerts_file('cont','w4')
  r=self.hook({'hook_event_name':'Stop','session_id':'cont','stop_hook_active':False})
  out=json.loads(r.stdout);self.assertNotIn('decision',out)
  self.assertEqual(out['hookSpecificOutput']['additionalContext'],'Continuation cap reached (3). Ending turn with a status report.')
 def register(self,session='prog'):
  root=self.path/'runroot';root.mkdir(exist_ok=True)
  r=self.cli('register','--session',session,'--run-root',str(root));self.assertEqual(r.returncode,0,r.stderr)
  return root
 def test_orchestrator_fence_paths_and_subagent_exemption(self):
  root=self.register()
  outside=self.pre('Edit',{'file_path':str(self.path/'elsewhere.txt')},'prog')
  self.assertEqual(outside.returncode,2);self.assertIn('Orchestrator fence',outside.stderr)
  self.assertEqual(self.pre('Edit',{'file_path':str(root/'unit.md')},'prog').returncode,0)
  self.assertEqual(self.pre('Edit',{'file_path':str(self.path/'elsewhere.txt')},'prog',agent_id='sub-1').returncode,0)
  self.assertEqual(self.pre('Edit',{'file_path':str(self.path/'elsewhere.txt')},'unregistered').returncode,0)
 def test_orchestrator_fence_bash(self):
  root=self.register('bashprog')
  self.assertEqual(self.pre('Bash',{'command':'git status'},'bashprog').returncode,0)
  self.assertEqual(self.pre('Bash',{'command':'git commit -am x'},'bashprog').returncode,2)
  self.assertEqual(self.pre('Bash',{'command':'rm %s/tmpfile'%root},'bashprog').returncode,0)
  self.assertEqual(self.pre('Bash',{'command':'rm /etc/hosts'},'bashprog').returncode,2)
 def test_orchestrator_fence_blocks_fleet_unless_test_mode(self):
  self.register('fleetprog')
  r=self.pre('Bash',{'command':'ssh remote-host ls'},'fleetprog')
  self.assertEqual(r.returncode,2);self.assertIn('Remote-host and fleet commands',r.stderr)
  allowed=self.hook_env({'hook_event_name':'PreToolUse','tool_name':'Bash','tool_input':{'command':'ssh remote-host ls'},'session_id':'fleetprog'},{**self.env,'SKILL_REVIEW_TEST_MODE':'1'})
  self.assertEqual(allowed.returncode,0,allowed.stderr)
 def test_runtime_peak_recorded_and_cap_alert(self):
  g=self.load('guard_peak');now=time.time()
  j=self.path/'peak.jsonl'
  j.write_text(''.join(json.dumps({'type':'started','key':'a%d'%i})+'\n' for i in range(11)))
  self.assertEqual(g.inspect_journal(j)['runtime_peak'],11)
  c=g.db();c.execute('INSERT INTO watches VALUES(?,?,?,?,?,?)',(str(j),'peak',now,'','OBSERVING',''));c.commit();c.close()
  a=g.tick(now);self.assertEqual(a[0]['state'],'RUNTIME_CAP_EXCEEDED')
  self.assertEqual(json.loads(a[0]['detail'])['runtime_peak'],11)
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_runtime_peak_counts_completions_down(self):
  g=self.load('guard_peak2')
  j=self.path/'peak2.jsonl';lines=[]
  for i in range(11):
   lines.append(json.dumps({'type':'started','key':'b%d'%i}))
   lines.append(json.dumps({'type':'result' if i%2 else 'failed','key':'b%d'%i}))
  j.write_text('\n'.join(lines)+'\n')
  self.assertEqual(g.inspect_journal(j)['runtime_peak'],1)
  os.environ.pop('WORKFLOW_GUARD_STATE',None)
 def test_fail_open_on_malformed_payload(self):
  r=self.hook({'hook_event_name':'PreToolUse','tool_name':'Bash','tool_input':'not-a-dict','session_id':'x'})
  self.assertEqual((r.returncode,r.stdout),(0,''),r.stderr)
  self.assertEqual(self.raw_hook('{not json at all').returncode,0)
  self.assertEqual(self.raw_hook('{"tool_name":"Workflow"').returncode,2)
 def test_fail_open_when_guard_state_is_unusable(self):
  broken={**self.env,'WORKFLOW_GUARD_STATE':'/dev/null/state'}
  r=self.hook_env({'hook_event_name':'PreToolUse','tool_name':'Bash','tool_input':{'command':'ls'},'session_id':'x'},broken)
  self.assertEqual((r.returncode,r.stdout),(0,''),r.stderr)
  w=self.hook_env({'hook_event_name':'PreToolUse','tool_name':'Workflow','tool_input':{'script':self.script(),'args':self.args()},'session_id':'x'},broken)
  self.assertEqual(w.returncode,2)

if __name__=='__main__':unittest.main(verbosity=2)
