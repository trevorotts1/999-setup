"""studio.py link against a fake local server; no real network, no real browser."""
import http.server
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

SKILL = pathlib.Path(__file__).resolve().parents[1]
STUDIO = SKILL / 'studio.py'
LINK1 = 'https://studio.example/#k=' + '1' * 32
LINK2 = 'https://studio.example/#k=' + '2' * 32


class FakeHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get('content-length') or 0)
        body = json.loads(self.rfile.read(size) or b'{}')
        self.server.requests.append({'path': self.path, 'body': body,
                                     'key': self.headers.get('x-ds-key'),
                                     'ua': self.headers.get('User-Agent')})
        out = self.server.responses.pop(0) if self.server.responses else {'ok': False, 'code': 'UNEXPECTED'}
        payload = json.dumps(out).encode('utf-8')
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = pathlib.Path(self.tmp.name) / 'state'
        self.state.mkdir()
        (self.state / 'machine.key').write_text('machine-key-sentinel\n')
        (self.state / 'machine.key').chmod(0o600)
        (self.state / 'studio.url').write_text('https://studio.example\n')
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeHandler)
        self.server.responses = []
        self.server.requests = []
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = 'http://127.0.0.1:%d' % self.server.server_address[1]

    def run_studio(self, *args, env_extra=None):
        env = {k: v for k, v in os.environ.items() if not k.startswith('DRAMA_STUDIO_')}
        env['DRAMA_STUDIO_STATE'] = str(self.state)
        env.update(env_extra or {})
        return subprocess.run([sys.executable, str(STUDIO), *args],
                              capture_output=True, text=True, env=env)

    def test_link_mints_stores_and_prints(self):
        self.server.responses.append({'ok': True, 'link': LINK1})
        proc = self.run_studio('link', '--print', '--studio', self.base)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn('Your Drama Studio link: ' + LINK1, proc.stdout)
        stored = (self.state / 'client.url').read_text().strip()
        self.assertEqual(stored, LINK1)
        self.assertEqual(stat.S_IMODE((self.state / 'client.url').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(len(self.server.requests), 1)
        hit = self.server.requests[0]
        self.assertEqual(hit['path'], '/api/studio/link')
        self.assertEqual(hit['body'], {'rotate': False})
        self.assertEqual(hit['key'], 'machine-key-sentinel')

    def test_second_run_prints_stored_link_without_network(self):
        self.server.responses.append({'ok': True, 'link': LINK1})
        first = self.run_studio('link', '--print', '--studio', self.base)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.server.requests.clear()
        second = self.run_studio('link', '--print', '--studio', self.base)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn('Your Drama Studio link: ' + LINK1, second.stdout)
        self.assertEqual(self.server.requests, [])

    def test_new_rotates(self):
        self.server.responses.append({'ok': True, 'link': LINK1})
        self.run_studio('link', '--print', '--studio', self.base)
        self.server.responses.append({'ok': True, 'link': LINK2})
        proc = self.run_studio('link', '--new', '--print', '--studio', self.base)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn('Your Drama Studio link: ' + LINK2, proc.stdout)
        self.assertNotIn(LINK1, proc.stdout)
        self.assertEqual((self.state / 'client.url').read_text().strip(), LINK2)
        self.assertEqual(self.server.requests[-1]['body'], {'rotate': True})

    def test_exists_on_another_computer_prints_guidance(self):
        self.server.responses.append({'ok': True, 'link': None, 'exists': True})
        proc = self.run_studio('link', '--print', '--studio', self.base)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn('Your link was made on another computer. Run `/drama-studio link new` '
                      'to make a new one (the old one stops working).', proc.stdout)
        self.assertNotIn('Your Drama Studio link:', proc.stdout)
        self.assertFalse((self.state / 'client.url').exists())
        self.assertEqual(self.server.requests[0]['body'], {'rotate': False})

    def test_link_opens_the_page_in_a_browser(self):
        stubdir = pathlib.Path(self.tmp.name) / 'webstub'
        stubdir.mkdir()
        (stubdir / 'webbrowser.py').write_text(
            'import os\n'
            'def open(url, *args, **kwargs):\n'
            '    fd = os.open(os.environ["WEBSTUB_SENTINEL"], '
            'os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)\n'
            '    with os.fdopen(fd, "w") as fh:\n'
            '        fh.write(url)\n'
            '    return True\n')
        sentinel = pathlib.Path(self.tmp.name) / 'opened.txt'
        self.server.responses.append({'ok': True, 'link': LINK1})
        proc = self.run_studio('link', '--studio', self.base,
                               env_extra={'PYTHONPATH': str(stubdir),
                                          'WEBSTUB_SENTINEL': str(sentinel)})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(sentinel.read_text(), LINK1)


if __name__ == '__main__':
    unittest.main()
