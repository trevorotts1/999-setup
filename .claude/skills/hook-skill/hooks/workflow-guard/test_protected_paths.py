import json, os, subprocess, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent
REASON = 'governs the session'


class ProtectedPathTests(unittest.TestCase):
    """The Bash protected-path rule guards the LIVE state dirs by resolved path, not by any text that contains their name."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name).resolve()
        self.home = t / 'home'
        self.live = self.home / '.claude/hooks/workflow-guard'          # the running guard's state lives under here
        self.state = t / 'gstate'
        self.state.mkdir(parents=True)
        (self.live / 'state').mkdir(parents=True)
        (self.live / 'state/guard.sqlite3').write_text('')
        (t / 'repo/.claude/skills/hook-skill/hooks/workflow-guard/state').mkdir(parents=True)
        self.repo_file = t / 'repo/.claude/skills/hook-skill/hooks/workflow-guard/state/capacity-probe-cache.json'
        self.repo_file.write_text('{}')
        self.env = {**os.environ, 'HOME': str(self.home), 'WORKFLOW_GUARD_STATE': str(self.state),
                    'QUESTION_GATE_STATE': str(t / 'qg')}
        self.t = t

    def tearDown(self):
        self.tmp.cleanup()

    def run_bash(self, cmd, cwd=None, sub=True):
        p = {'tool_name': 'Bash', 'tool_input': {'command': cmd}, 'session_id': 'pp', 'tool_use_id': 'x',
             'cwd': str(cwd or self.t)}
        if sub:
            p['agent_id'] = 'a1'
        return subprocess.run(['python3', str(ROOT / 'guard.py'), 'hook'], input=json.dumps(p),
                              capture_output=True, text=True, env=self.env)

    def assertRefused(self, cmd, **kw):
        for sub in (True, False):
            r = self.run_bash(cmd, sub=sub, **kw)
            self.assertEqual(r.returncode, 2, (cmd, sub, r.stdout, r.stderr))
            self.assertIn(REASON, r.stderr, (cmd, sub))

    def assertAllowed(self, cmd, **kw):
        for sub in (True, False):
            r = self.run_bash(cmd, sub=sub, **kw)
            self.assertNotIn(REASON, r.stderr, (cmd, sub, r.stderr))
            self.assertEqual(r.returncode, 0, (cmd, sub, r.stderr))

    def test_repo_path_with_same_words_is_allowed(self):
        self.assertAllowed('git restore %s' % self.repo_file, cwd=self.t / 'repo')
        self.assertAllowed('git restore .claude/skills/hook-skill/hooks/workflow-guard/state/capacity-probe-cache.json',
                           cwd=self.t / 'repo')
        self.assertAllowed('rm %s' % self.repo_file)

    def test_rm_live_db_refused(self):
        self.assertRefused('rm ~/.claude/hooks/workflow-guard/state/guard.sqlite3')

    def test_sqlite3_live_db_refused(self):
        self.assertRefused("sqlite3 %s 'delete from x'" % (self.live / 'state/guard.sqlite3'))

    def test_cd_then_relative_refused(self):
        self.assertRefused('cd ~/.claude/hooks/workflow-guard && rm state/guard.sqlite3')

    def test_cwd_relative_refused(self):
        self.assertRefused('rm guard.sqlite3', cwd=self.live / 'state')

    def test_env_state_dir_refused(self):
        self.assertRefused('rm %s/guard.sqlite3' % self.state)
        self.assertRefused('rm %s/limits.json' % self.state)

    def test_symlink_into_live_state_refused(self):
        link = self.t / 'lnk'
        link.symlink_to(self.live / 'state')
        self.assertRefused('rm %s/guard.sqlite3' % link)

    def test_plain_commands_untouched(self):
        self.assertAllowed('ls %s' % self.live)
        self.assertAllowed('rm %s' % (self.t / 'scratch.txt'))


if __name__ == '__main__':
    unittest.main()
