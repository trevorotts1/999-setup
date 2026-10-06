"""Concurrency-based caps, live slot accounting, prompt reaping, scratch cleanup."""
import importlib.util,json,os,shutil,subprocess,sys,tempfile,time,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NODE=os.environ.get('WORKFLOW_GUARD_NODE') or shutil.which('node') or ''
ISO="// SCRATCH ISOLATION lanes/<UNIT-ID>-<box-slug>/\n"
A="agent('x',{model:'opus',phase:'A',label:'a'+u.id})"
B="agent('x',{model:'opus',phase:'B',label:'b'+u.id})"
def validate(body,n=10):
    s="export const meta={name:'tg-W1-build+qc-SKR001..SKR099-%dL',description:'t',phases:[{title:'A'},{title:'B'}]};\n"%n+ISO+body
    a={'units':[{'id':'SKR-%03d'%i} for i in range(10)]}
    return json.loads(subprocess.run([NODE,str(ROOT/'validate.mjs')],input=json.dumps({'script':s,'args':a}),capture_output=True,text=True).stdout)
class Static(unittest.TestCase):
    def test_sequential_awaits_do_not_add_up(self):
        r=validate("const a=await parallel(args.units.map(u=>()=>%s));\nconst b=await parallel(args.units.map(u=>()=>%s));\nreturn [a,b];"%(A,B))
        self.assertTrue(r['ok'],r);self.assertEqual((r['conservativePeak'],r['totalCalls']),(10,20))
    def test_unawaited_overlap_sums(self):
        r=validate("const a=parallel(args.units.map(u=>()=>%s));\nconst b=parallel(args.units.map(u=>()=>%s));\nawait a;await b;return 1;"%(A,B),20)
        self.assertFalse(r['ok']);self.assertEqual(r['conservativePeak'],20);self.assertTrue(any('Computed upper bound 20 concurrent agents exceeds effective cap 10' in e for e in r['errors']),r['errors'])
    def test_concurrent_extras_count(self):
        r=validate("await Promise.all([parallel(args.units.map(u=>()=>%s)),agent('v',{model:'o',phase:'B',label:'v1'}),agent('v',{model:'o',phase:'B',label:'v2'})]);return 1;"%A,12)
        self.assertFalse(r['ok']);self.assertEqual(r['conservativePeak'],12);self.assertTrue(any('Computed upper bound 12 concurrent agents exceeds effective cap 10' in e for e in r['errors']),r['errors'])
    def test_pipeline_two_stages_is_ten_not_twenty(self):
        r=validate("return await pipeline(args.units,u=>%s,(r,u)=>%s);"%(A,B))
        self.assertTrue(r['ok'],r);self.assertEqual(r['conservativePeak'],10)
    def test_total_ceiling(self):
        r=validate("await parallel(args.units.map(u=>()=>%s));\n"%A*21+"return 1;")
        self.assertFalse(r['ok']);self.assertEqual(r['totalCalls'],210);self.assertTrue(any('backstop' in e for e in r['errors']))
class Live(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)
        os.environ['WORKFLOW_GUARD_STATE']=str(self.p/'state')
        spec=importlib.util.spec_from_file_location('guard_smart',ROOT/'guard.py');self.g=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.g)
        self.g.LEASE_S=3600
    def tearDown(self):self.tmp.cleanup()
    def launch(self,lid,session='s',run='wf_r1',name='n1',state='RETURNED',peak=10):
        t=self.p/session/'t.jsonl';t.parent.mkdir(parents=True,exist_ok=True)
        j=t.parent/'t'/'subagents'/'workflows'/run/'journal.jsonl';j.parent.mkdir(parents=True,exist_ok=True);j.touch()
        c=self.g.db();c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)',(lid,session,str(t),time.time(),'sha',state,name,peak,json.dumps({'run_id':run,'task_id':'wabcdefgh'})));c.commit();c.close()
        return j
    def jl(self,j,*ev):
        with j.open('a') as f:
            for k,i in ev:f.write(json.dumps({'type':k,'key':'a%d'%i})+'\n')
    def occ(self):
        c=self.g.db()
        try:return self.g.occupancy(c)
        finally:c.close()
    def test_agent_counter_drops_as_agents_finish(self):
        j=self.launch('L')
        self.assertEqual(self.occ()['agents_total'],10)           # no events yet: declared peak
        self.jl(j,*[('started',i) for i in range(10)]);self.assertEqual(self.occ()['agents_total'],10)
        self.jl(j,*[('result',i) for i in range(4)]);self.assertEqual(self.occ()['agents_total'],6)
        self.jl(j,('failed',4));self.assertEqual(self.occ()['agents_total'],5)
        self.jl(j,*[('result',i) for i in range(5,10)]);o=self.occ()
        self.assertEqual((o['workflows'],o['agents_total']),(0,0))   # all returned: released too
    def test_only_running_workflows_count_toward_program_cap(self):
        c=self.g.db()
        for i,st in enumerate(['VALIDATED','RETURNED','COMPLETED','CANCELLED','FAILED','REAPED','COMPLETED']):
            c.execute('INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?)',('x%d'%i,'s','',time.time(),'s',st,'n',1,''))
        c.commit();c.close()
        o=self.occ();self.assertEqual(o['per_program']['s'],2)
    def test_sibling_old_journal_does_not_finish_new_launch(self):
        old=self.launch('OLD',run='wf_old',state='COMPLETED');self.jl(old,('started',1),('result',1))
        c=self.g.db();c.execute("INSERT INTO watches VALUES(?,?,?,?,?,?)",(str(old),'s',time.time(),'','AGENTS_RETURNED',''));c.commit();c.close()
        self.launch('NEW',run='wf_new');self.assertEqual(self.occ()['workflows'],1)
    def test_posttooluse_taskstop_releases_immediately(self):
        self.launch('L');c=self.g.db();c.execute("UPDATE launches SET session='sess'");c.commit();c.close()
        r=subprocess.run([sys.executable,str(ROOT/'guard.py'),'hook'],input=json.dumps({'hook_event_name':'PostToolUse','tool_name':'TaskStop','session_id':'sess','tool_input':{'task_id':'wabcdefgh'},'tool_response':'Successfully stopped task'}),capture_output=True,text=True,env={**os.environ})
        self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(self.occ()['workflows'],0)
    def test_tick_reaps_finished_run(self):
        j=self.launch('L');self.jl(j,('started',1),('result',1))
        c=self.g.db();c.execute("INSERT INTO watches VALUES(?,?,?,?,?,?)",(str(j),'s',time.time(),'','OBSERVING',''));c.commit();c.close()
        self.g.tick();c=self.g.db()
        try:self.assertEqual(c.execute("SELECT state FROM launches").fetchone()[0],'COMPLETED')
        finally:c.close()
    def git(self,*a,cwd):subprocess.run(['git','-c','user.email=a@b','-c','user.name=t']+list(a),cwd=cwd,check=True,capture_output=True)
    def test_cleanup_deletes_only_safe_registered_folders(self):
        root=self.p/'run';plain=root/'lanes'/'U1-lane';plain.mkdir(parents=True);(plain/'f.txt').write_text('x')
        unreg=root/'lanes'/'U9-lane';unreg.mkdir();dirty=root/'lanes'/'U2-lane';dirty.mkdir()
        self.git('init','-q',cwd=dirty);(dirty/'a').write_text('1')           # uncommitted
        unpushed=root/'lanes'/'U3-lane';unpushed.mkdir();self.git('init','-q',cwd=unpushed);(unpushed/'a').write_text('1');self.git('add','.',cwd=unpushed);self.git('commit','-qm','x',cwd=unpushed)
        self.launch('L',name='wfA',state='COMPLETED')
        self.g.register_scratch('s','wfA',root,[plain,dirty,unpushed])
        now=time.time()
        self.g.cleanup_scratch(now);self.assertTrue(plain.exists())           # first sighting stamps the end time
        self.g.cleanup_scratch(now+60);self.assertTrue(plain.exists())        # inside the 30 minute grace
        self.g.cleanup_scratch(now+1900)
        self.assertFalse(plain.exists());self.assertTrue(unreg.exists());self.assertTrue(dirty.exists());self.assertTrue(unpushed.exists())
        log=(self.p/'state'/'cleanup.log').read_text();self.assertIn('DELETED',log);self.assertEqual(log.count('SKIPPED'),2)
    def test_cleanup_waits_for_running_workflow(self):
        root=self.p/'run';d=root/'lanes'/'U1-lane';d.mkdir(parents=True)
        self.launch('L',name='wfB',state='RETURNED');self.g.register_scratch('s','wfB',root,[d])
        self.g.cleanup_scratch(time.time()+99999);self.assertTrue(d.exists())
    def test_generator_ten_unit_build_qc_is_one_workflow_and_registers_lanes(self):
        units=[{'id':'SKR-%03d'%i,'prompt':'p','qcPrompt':'q','ownership':'o'} for i in range(10)]
        (self.p/'u.json').write_text(json.dumps(units));root=self.p/'rr'
        env={**os.environ,'WORKFLOW_GUARD_CAP':'10','WORKFLOW_GUARD_SESSION':'gen'}
        r=subprocess.run([sys.executable,str(ROOT/'make-workflow.py'),'--units',str(self.p/'u.json'),'--out-dir',str(self.p/'out'),'--provider-slots','10','--program','tg','--wave','1','--run-root',str(root)],capture_output=True,text=True,env=env)
        self.assertEqual(r.returncode,0,r.stderr);first=json.loads(r.stdout.splitlines()[0])
        self.assertEqual(first['maximumConcurrentAgents'],10);self.assertEqual(len([l for l in r.stdout.splitlines() if l.startswith('{')]),1)
        v=json.loads(subprocess.run([NODE,str(ROOT/'validate.mjs')],input=json.dumps({'script':Path(first['launch']['scriptPath']).read_text()}),capture_output=True,text=True).stdout)
        self.assertTrue(v['ok'],v);self.assertEqual((v['conservativePeak'],v['totalCalls']),(10,20))
        rows=self.g.read_rows('SELECT path FROM scratch');self.assertEqual(len(rows),10)
if __name__=='__main__':unittest.main()
