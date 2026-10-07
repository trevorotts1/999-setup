"""Target-aware Bash check (2026-10-07 redesign): every command goes through the REAL hook entry point (guard.py hook, PreToolUse) of a
governed session on a TEMP state dir. READS of governed material pass; a mutation whose target resolves to governed material is refused;
a target that is not a literal is never guessed at (it runs; the tamper snapshot catches it, see test_tamper.py)."""
import json, os, subprocess, sys
from pathlib import Path
import pytest
from test_enforcement_v22 import Env, st, ROOT, armed  # noqa: F401  (Env/armed are plain helpers, not tests)

DISPATCH_GATE = Path.home() / '.claude' / 'hooks' / 'dispatch-gate.py'


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path)
    e.plan = armed(e)
    (e.proj / 'evidence' / 'W0-01').mkdir(parents=True)
    e.ev = e.proj / 'evidence' / 'W0-01'
    (e.ev / 'W0-01-U1.verdict.json').write_text('{}')
    e.jdir = e.tmp / 'main' / 'subagents' / 'workflows' / 'wf_x'
    e.jdir.mkdir(parents=True)
    (e.jdir / 'journal.jsonl').write_text('{"type":"x"}\n')
    (e.jdir / 'agent-a1.jsonl').write_text('{"type":"y"}\n')
    assert e.pre('Bash', {'command': 'true'})[0] == 0  # creates guard.sqlite3 in the temp state dir
    return e


def run(env, cmd, **kw):
    cmd = cmd.format(plan=env.plan, proj=env.proj, sd=env.sd, qg=env.qg, root=ROOT, ev=env.ev, j=env.jdir, tmp=env.tmp, vf=env.ev / 'W0-01-U1.verdict.json',
                     gate=DISPATCH_GATE, sib=env.proj / 'BM-SWARM-PLAN.json')
    return env.pre('Bash', {'command': cmd}, **kw)


ALLOWED = [
    # 1. copy FROM governed TO /tmp (the case that was still refused)
    'cp {sd}/guard.sqlite3 /private/tmp/guard-plain.sqlite3 && echo "plain-path copy rc=$?"',
    'cp {plan} /private/tmp/plan-copy.json', 'cp -p {plan} {ev}/../../../plan-out-of-tree.json.keep' if False else 'cp -R {proj}/evidence /private/tmp/ev-copy-%d' % os.getpid(),
    'rsync -a {proj}/evidence/ /private/tmp/ev-rsync-%d/' % os.getpid(), 'ditto {sd} /private/tmp/sd-ditto-%d' % os.getpid(),
    'install -m 644 {plan} /private/tmp/plan-installed.json', 'tar -czf /private/tmp/ev.tgz -C {proj} evidence',
    # 2. pure read of a run journal through a heredoc interpreter
    "B={j}; ls -la $B | head; f=$(ls -t $B/agent-*.jsonl | head -1); python3 - \"$f\" <<'EOF'\nimport sys, json\nrows = []\nfor l in open(sys.argv[1]):\n    rows.append(json.loads(l))\nout = []\nout.append(len(rows))\nprint(out)\nEOF",
    # 3. interpreter reads, scripts that write only to /private/tmp
    "python3 -c \"import json; d=json.load(open('{plan}')); print(d['status'], len(d['workflows']))\"",
    "python3 -c \"import json; d=json.load(open('{plan}')); open('/private/tmp/o.txt','w').write(str(d))\"",
    "python3 -c \"import sqlite3; print(sqlite3.connect('file:{sd}/guard.sqlite3?mode=ro', uri=True).execute('select 1').fetchall())\"",
    "python3 -c \"x = 3\nif x > 2 and x >= 3: print('ok', x >= 3, 2 > 1)\"",
    "python3 -c \"print(1 >= 0)\" # {plan}", "python3 -c \"print(2 > 1)\" {plan}",
    "sqlite3 -readonly {sd}/guard.sqlite3 'select count(*) from launches'",
    'python3 {root}/staffing.py status --cwd {proj}', 'python3 {root}/staffing.py start --cwd {proj}', 'python3 {root}/staffing.py retire --cwd {proj} --dry-run',
    'python3 {root}/staffing.py add-plan --src {plan} --dest {proj}/Z-SWARM-PLAN.json --dry-run', 'python3 {root}/staffing.py --selftest',
    'python3 {gate} --selftest',
    'stat {plan}', 'ls -la {sd} {ev}', 'cat {plan} | head -3', 'grep -r running {plan}', 'head -2 {plan}', 'tail -2 {plan}', 'wc -l {plan}',
    'find {proj} -name "*.json" | head', 'find {sd} -type f -newer {plan}', 'sed -n 1,3p {plan}', 'diff {plan} {plan}', 'cat {vf}', 'cat {j}/journal.jsonl',
    'find {proj} -name "*.pyc" -delete', 'find /private/tmp/nonexistent-dir-x -delete', 'cd {proj} && find . -name "*.orig" -exec rm {{}} +',
    'echo hi > /private/tmp/x.txt', 'echo hi >> /dev/null 2>&1', 'git -C {proj} log -1 2>&1 | head -1', 'ls {sd} 2>/dev/null', 'cat {sd}/STATUS.md 2>&1 | head -2',
    "python3 -c \"import shutil; shutil.copy2('{plan}', '/private/tmp/x.json')\"",
    "python3 -c \"import shutil; shutil.copyfile('{sd}/guard.sqlite3', '/private/tmp/guard-roc.sqlite3')\"",
    "python3 -c \"from pathlib import Path; print(Path('{plan}').read_text()[:5])\"",
    "python3 -c \"import json;print(len(json.load(open('{plan}', 'rb'))))\"",
    "python3 -c \"import subprocess; subprocess.run(['cp','{plan}','/private/tmp/p2.json'])\"",
    "node -e \"const fs=require('fs'); console.log(fs.readFileSync('{plan}','utf8').length >= 1)\"",
    'python3 {root}/make-workflow.py --help',
    'for f in {ev}/*.json; do cp $f /private/tmp/; done',
    'cd {sd} && ls && cp guard.sqlite3 /private/tmp/g-rel.sqlite3',
    'python3 -m json.tool {plan} > /private/tmp/pretty.json',
    "echo 'rm {plan} would delete the plan' > /private/tmp/note.txt",
    'grep -n "staffing.py cancel" {root}/WORKFLOW-RELIABILITY.md',
]


@pytest.mark.parametrize('cmd', ALLOWED)
def test_read_only_and_non_governed_target_commands_allowed(env, cmd):
    rc, out = run(env, cmd)
    assert rc == 0, (cmd, out)


def test_script_file_that_reads_governed_and_writes_only_tmp_allowed(env):
    s = env.tmp / 'readscript.py'
    s.write_text("import json, shutil, sqlite3\nd = json.load(open('%s'))\nrows = sqlite3.connect('file:%s/guard.sqlite3?mode=ro', uri=True).execute('select 1').fetchall()\nshutil.copyfile('%s', '/private/tmp/guard-from-script.json')\nopen('/private/tmp/o2.txt', 'w').write(str(rows) + str(d))\nprint(1 >= 0)\n" % (env.plan, env.sd, env.plan))
    rc, out = run(env, 'python3 %s' % s)
    assert rc == 0, out


REFUSED = [
    # copy / move / install INTO governed, and moving governed OUT
    'cp /tmp/x {plan}', 'cp -f /tmp/x {ev}/', 'cp /tmp/x.json {sib}', 'cp -t {proj}/evidence/W0-01 /tmp/x', 'mv /tmp/x {plan}', 'mv {plan} /tmp/plan-moved.json', 'mv {plan} {proj}/PLAN.bak',
    'mv {ev} /private/tmp/ev-moved', 'rsync -a /tmp/stage/ {proj}/evidence/', 'ditto /tmp/x {plan}', 'install -m 644 /tmp/x {plan}', 'ln -sf /tmp/x {sd}/guard.sqlite3',
    # destructive verbs
    'rm {plan}', 'rm -rf {proj}/evidence', 'rm -f {ev}/W0-01-U1.verdict.json', 'rmdir {ev}', 'truncate -s 0 {plan}', 'touch {plan}', 'tee {sd}/limits.json < /tmp/x',
    'echo x | tee -a {plan}', "sed -i '' s/running/done/ {plan}", 'sed -i.bak s/a/b/ {plan}', 'perl -pi -e s/a/b/ {plan}', 'perl -i.bak -e 1 {plan}', 'chmod 000 {plan}',
    'find {proj} -name "*.verdict.json" -delete', 'find {proj}/evidence -delete', 'find {proj}/evidence -exec rm -f {{}} +', 'rm -rf {j}', 'rm -rf {sd}', 'dd if=/dev/zero of={plan}',
    # redirects
    'echo x > {plan}', 'echo x >> {plan}', 'echo x >| {plan}', 'echo x >{ev}/a.md', 'echo x 2>/dev/null > {plan}', 'cat /tmp/x &> {plan}', "echo '{{}}' >> {j}/journal.jsonl",
    'echo x > ~/.claude/hooks/question-gate/state/S1.json', 'echo x > {qg}/S1.json',
    # sqlite CLI without -readonly, tar/unzip/git into governed
    "sqlite3 {sd}/guard.sqlite3 'delete from launches'", "sqlite3 /tmp/other.db \"attach '{sd}/guard.sqlite3' as g; delete from g.launches\"",
    'tar -xf /tmp/f.tar -C {proj}/evidence', 'unzip -o /tmp/f.zip -d {proj}/evidence', 'git checkout forge -- evidence/W0-01/x.md', 'git -C {proj} checkout -- SWARM-PLAN.json',
    # interpreter code with a literal governed target
    "python3 -c \"open('{plan}','w').write('x')\"", "python3 -c \"open('{plan}','a').write('x')\"", "python3 -c \"open('{plan}','x')\"", "python3 -c \"open('{plan}','w+')\"",
    "python3 -c \"open('{plan}','r+')\"", "python3 -c \"open('{plan}',mode='w')\"", "python3 -c \"m='w';open('{plan}',m)\"", "python3 -c \"import sys;open('{plan}',sys.argv[1])\" w",
    "python3 -c \"import shutil;shutil.copyfile('/tmp/n.json','{plan}')\"", "python3 -c \"import shutil;shutil.copy('/tmp/n.json','{plan}')\"",
    "python3 -c \"import shutil;shutil.copy2('/tmp/n.json','{ev}')\"", "python3 -c \"import shutil;shutil.copytree('/tmp/n','{proj}/evidence/W0-01')\"",
    "python3 -c \"import shutil;shutil.move('{plan}','/tmp/x')\"", "python3 -c \"import shutil;shutil.move('/tmp/x','{plan}')\"", "python3 -c \"import shutil;shutil.rmtree('{proj}/evidence')\"",
    "python3 -c \"import os;os.remove('{plan}')\"", "python3 -c \"import os;os.unlink('{plan}')\"", "python3 -c \"import os;os.rename('{plan}','/tmp/x')\"",
    "python3 -c \"import os;os.replace('/tmp/x','{plan}')\"", "python3 -c \"from pathlib import Path;Path('{plan}').write_text('x')\"",
    "python3 -c \"from pathlib import Path;Path('{plan}').write_bytes(b'x')\"", "python3 -c \"from pathlib import Path;p=Path('{proj}')/'SWARM-PLAN.json';p.write_text('x')\"",
    "python3 -c \"import json;json.dump({{}}, open('{plan}','w'))\"", "python3 -c \"import sqlite3;sqlite3.connect('{sd}/guard.sqlite3').execute('delete from launches')\"",
    "python3 -c \"import shutil;p='{plan}';shutil.copyfile('/tmp/n.json',p)\"", "python3 -c \"import os;os.system('rm {plan}')\"", "python3 -c \"import subprocess;subprocess.run(['rm','-f','{plan}'])\"",
    "python3 -c \"import os;d='{proj}';open(d+'/SWARM-PLAN.json','w')\"", "python3 -c \"open('%s/guard.sqlite3'%'{sd}','wb')\"", "python3 -c \"open('{plan}','w')\" ; echo done",
    "node -e \"require('fs').writeFileSync('{plan}','x')\"", "ruby -e \"File.write('{plan}','x')\"",
    # staffing.py verbs a governed session may not run
    'python3 {root}/staffing.py cancel --plan {plan} --workflow W0-01 --reason r', 'python3 {root}/staffing.py clear-tamper --session S1 --reason r', 'python3 {root}/staffing.py reset --plan {plan}',
    'python3 {root}/staffing.py status --plan {plan}; python3 {root}/staffing.py finish --plan {plan}',
    "python3 -c \"import sys; sys.path.insert(0,'{root}'); import staffing; staffing.cmd_cancel('{plan}','W0-01','r')\"",
    # a write through a link the same command just made to a governed file
    'ln -s {plan} /private/tmp/plan-link-x; echo x > /private/tmp/plan-link-x',
    # chained with an innocent command
    'python3 {root}/staffing.py status --cwd {proj}; rm {plan}', 'ls {sd} && echo x > {plan}', 'cat {plan} | tee {plan}.new {plan}',
]


@pytest.mark.parametrize('cmd', REFUSED)
def test_mutations_of_governed_targets_refused(env, cmd):
    rc, out = run(env, cmd)
    assert rc == 2 and ('governs the session' in out or 'may not write unit verdict files' in out), (cmd, out)


def test_the_07_11_to_07_23_bypasses_stay_refused(env):
    # a script FILE that shutil.copyfile()s into a governed plan path
    to = env.tmp / 'cp_bm.py'
    to.write_text("import shutil\nshutil.copyfile('/x/a.json', '%s/BM-SWARM-PLAN.json')\n" % env.proj)
    rc, out = run(env, 'python3 %s' % to)
    assert rc == 2 and 'governs the session' in out, out
    # base64-wrapped code (python and shell forms)
    import base64
    code = "open(%r,'w').write('x')" % str(env.plan)
    b = base64.b64encode(code.encode()).decode()
    for cmd in ("python3 -c \"import base64;exec(base64.b64decode('%s'))\"" % b, "echo %s | base64 -d | python3" % b, "python3 -c \"exec(__import__('base64').b64decode('%s').decode())\"" % b):
        rc, out = run(env, cmd)
        assert rc == 2 and 'governs the session' in out, (cmd, out)
    # a script that takes the governed path from an environment variable the COMMAND supplies
    s = env.tmp / 'envscript.py'
    s.write_text("import os, shutil\nSRC = os.environ['GUARD_DB']\nshutil.copyfile('/tmp/x', SRC)\n")
    rc, out = run(env, 'GUARD_DB={sd}/guard.sqlite3 python3 %s' % s)
    assert rc == 2 and 'governs the session' in out, out
    rc, out = run(env, 'export GUARD_DB={sd}/guard.sqlite3; python3 %s' % s)
    assert rc == 2 and 'governs the session' in out, out
    # argv carries the governed path into a heredoc
    rc, out = run(env, "python3 - {plan} <<'EOF'\nimport sys\nopen(sys.argv[1], 'w').write('x')\nEOF")
    assert rc == 2 and 'governs the session' in out, out


def test_non_literal_targets_are_not_guessed_at(env):
    # unknown variable / computed path: not a literal target, so PreToolUse lets it run (the tamper snapshot is the backstop)
    for cmd in ("python3 -c \"import os;open(os.environ['NOT_SET_ANYWHERE'],'w')\"", "python3 -c \"import sys;open(sys.argv[1],'w')\" /private/tmp/x.txt",
                "python3 -c \"import glob;[open(p,'w') for p in glob.glob('/private/tmp/nothing*')]\"", 'cp /tmp/x "$NOT_SET_ANYWHERE"'):
        rc, out = run(env, cmd)
        assert rc == 0, (cmd, out)


def test_subagent_targets_plan_files_and_evidence_anywhere(env):
    other = env.tmp / 'other'; other.mkdir()
    (other / 'evidence').mkdir()
    for cmd in ('echo x > %s/SWARM-PLAN.json' % other, 'rm -rf %s/evidence' % other, 'cp /tmp/x %s/evidence/a.md' % other, "sed -i '' s/a/b/ %s" % env.plan, 'echo x > {sd}/limits.json', 'rm -rf {j}'):
        rc, out = run(env, cmd, agent_id='sub1')
        assert rc == 2 and 'subagent may not' in out.lower(), (cmd, out)
    for ok in ('ls %s' % other, 'cat %s' % env.plan, 'echo hi > %s' % (env.proj / 'out.txt'), 'cp {plan} /private/tmp/sub-copy.json', 'cp {sd}/guard.sqlite3 /private/tmp/sub-g.sqlite3'):
        rc, out = run(env, ok, agent_id='sub1')
        assert rc == 0, (ok, out)
